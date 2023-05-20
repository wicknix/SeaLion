/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsMailGNOMEIntegration.h"
#include "nsIGConfService.h"
#include "nsIGIOService.h"
#include "nsCOMPtr.h"
#include "nsIServiceManager.h"
#include "prenv.h"
#include "nsIFile.h"
#include "nsIStringBundle.h"
#include "nsIPromptService.h"
#include "nsIPrefService.h"
#include "nsIPrefBranch.h"
#include "nsDirectoryServiceDefs.h"
#include "nsDirectoryServiceUtils.h"
#include "nsEmbedCID.h"
#include "mozilla/ArrayUtils.h"
#include "mozilla/Services.h"

#include <glib.h>
#include <limits.h>
#include <stdlib.h>

using mozilla::ArrayLength;

static const char* const sMailProtocols[] = {
  "mailto"
};

static const char* const sNewsProtocols[] = {
  "news",
  "snews",
  "nntp"
};

static const char* const sFeedProtocols[] = {
  "feed"
};

struct AppTypeAssociation {
  uint16_t type;
  const char * const *protocols;
  unsigned int protocolsLength;
  const char *mimeType;
  const char *extensions;
};

static const AppTypeAssociation sAppTypes[] = {
  {
    nsIShellService::MAIL, sMailProtocols, ArrayLength(sMailProtocols),
    "message/rfc822",
    nullptr // don't associate .eml extension, as that breaks printing those
  },
  {
    nsIShellService::NEWS, sNewsProtocols, ArrayLength(sNewsProtocols),
    nullptr, nullptr
  },
  {
    nsIShellService::RSS, sFeedProtocols, ArrayLength(sFeedProtocols),
    "application/rss+xml", "rss"
  }
};

nsMailGNOMEIntegration::nsMailGNOMEIntegration():
                          mCheckedThisSession(false),
                          mAppIsInPath(false)
{}

nsresult
nsMailGNOMEIntegration::Init()
{
  nsresult rv;

  // GConf _must_ be available, or we do not allow CreateInstance to succeed.

  nsCOMPtr<nsIGConfService> gconf = do_GetService(NS_GCONFSERVICE_CONTRACTID);
  nsCOMPtr<nsIGIOService> giovfs = do_GetService(NS_GIOSERVICE_CONTRACTID);

  if (!gconf && !giovfs)
    return NS_ERROR_NOT_AVAILABLE;

  // Check G_BROKEN_FILENAMES.  If it's set, then filenames in glib use
  // the locale encoding.  If it's not set, they use UTF-8.
  mUseLocaleFilenames = PR_GetEnv("G_BROKEN_FILENAMES") != nullptr;

  if (GetAppPathFromLauncher())
      return NS_OK;

  nsCOMPtr<nsIFile> appPath;
  rv = NS_GetSpecialDirectory(NS_XPCOM_CURRENT_PROCESS_DIR,
                              getter_AddRefs(appPath));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = appPath->AppendNative(NS_LITERAL_CSTRING(MOZ_APP_NAME));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = appPath->GetNativePath(mAppPath);
  return rv;
}

NS_IMPL_ISUPPORTS(nsMailGNOMEIntegration, nsIShellService)

bool
nsMailGNOMEIntegration::GetAppPathFromLauncher()
{
  gchar *tmp;

  const char *launcher = PR_GetEnv("MOZ_APP_LAUNCHER");
  if (!launcher)
    return false;

  if (g_path_is_absolute(launcher)) {
    mAppPath = launcher;
    tmp = g_path_get_basename(launcher);
    gchar *fullpath = g_find_program_in_path(tmp);
    if (fullpath && mAppPath.Equals(fullpath)) {
      mAppIsInPath = true;
    }
    g_free(fullpath);
  } else {
    tmp = g_find_program_in_path(launcher);
    if (!tmp)
      return false;
    mAppPath = tmp;
    mAppIsInPath = true;
  }

  g_free(tmp);
  return true;
}

NS_IMETHODIMP
nsMailGNOMEIntegration::IsDefaultClient(bool aStartupCheck, uint16_t aApps, bool * aIsDefaultClient)
{
  *aIsDefaultClient = true;

  for (unsigned int i = 0; i < MOZ_ARRAY_LENGTH(sAppTypes); i++) {
    if (aApps & sAppTypes[i].type)
      *aIsDefaultClient &= checkDefault(sAppTypes[i].protocols,
                                        sAppTypes[i].protocolsLength);
  }

  // If this is the first mail window, maintain internal state that we've
  // checked this session (so that subsequent window opens don't show the
  // default client dialog).
  if (aStartupCheck)
    mCheckedThisSession = true;
  return NS_OK;
}

NS_IMETHODIMP
nsMailGNOMEIntegration::SetDefaultClient(bool aForAllUsers, uint16_t aApps)
{
  nsresult rv = NS_OK;
  for (unsigned int i = 0; i < MOZ_ARRAY_LENGTH(sAppTypes); i++) {
    if (aApps & sAppTypes[i].type) {
      nsresult tmp = MakeDefault(sAppTypes[i].protocols,
                                 sAppTypes[i].protocolsLength,
                                 sAppTypes[i].mimeType,
                                 sAppTypes[i].extensions);
      if (NS_FAILED(tmp)) {
        rv = tmp;
      }
    }
  }

  return rv;
}

NS_IMETHODIMP
nsMailGNOMEIntegration::GetShouldCheckDefaultClient(bool* aResult)
{
  if (mCheckedThisSession)
  {
    *aResult = false;
    return NS_OK;
  }

  nsCOMPtr<nsIPrefBranch> prefs(do_GetService(NS_PREFSERVICE_CONTRACTID));
  return prefs->GetBoolPref("mail.shell.checkDefaultClient", aResult);
}

NS_IMETHODIMP
nsMailGNOMEIntegration::SetShouldCheckDefaultClient(bool aShouldCheck)
{
  nsCOMPtr<nsIPrefBranch> prefs(do_GetService(NS_PREFSERVICE_CONTRACTID));
  return prefs->SetBoolPref("mail.shell.checkDefaultClient", aShouldCheck);
}

bool
nsMailGNOMEIntegration::KeyMatchesAppName(const char *aKeyValue) const
{
  gchar *commandPath;
  if (mUseLocaleFilenames) {
    gchar *nativePath = g_filename_from_utf8(aKeyValue, -1, NULL, NULL, NULL);
    if (!nativePath) {
      NS_ERROR("Error converting path to filesystem encoding");
      return false;
    }

    commandPath = g_find_program_in_path(nativePath);
    g_free(nativePath);
  } else {
    commandPath = g_find_program_in_path(aKeyValue);
  }

  if (!commandPath)
    return false;

  bool matches = mAppPath.Equals(commandPath);
  g_free(commandPath);
  return matches;
}

bool
nsMailGNOMEIntegration::CheckHandlerMatchesAppName(const nsACString &handler) const
{
  gint argc;
  gchar **argv;
  nsAutoCString command(handler);

  if (g_shell_parse_argv(command.get(), &argc, &argv, NULL)) {
    command.Assign(argv[0]);
    g_strfreev(argv);
  } else {
    return false;
  }

  return KeyMatchesAppName(command.get());
}

bool
nsMailGNOMEIntegration::checkDefault(const char* const *aProtocols, unsigned int aLength)
{
  nsCOMPtr<nsIGConfService> gconf = do_GetService(NS_GCONFSERVICE_CONTRACTID);
  nsCOMPtr<nsIGIOService> giovfs = do_GetService(NS_GIOSERVICE_CONTRACTID);

  bool enabled;
  nsAutoCString handler;
  nsresult rv;

  for (unsigned int i = 0; i < aLength; ++i) {
    if (gconf) {
      handler.Truncate();
      rv = gconf->GetAppForProtocol(nsDependentCString(aProtocols[i]),
                                    &enabled, handler);
      if (NS_SUCCEEDED(rv) && (!CheckHandlerMatchesAppName(handler) || !enabled)) {
        return false;
      }
    }

    if (giovfs) {
      handler.Truncate();
      nsCOMPtr<nsIGIOMimeApp> app;
      rv = giovfs->GetAppForURIScheme(nsDependentCString(aProtocols[i]),
                                      getter_AddRefs(app));
      if (NS_FAILED(rv) || !app) {
        return false;
      }
      rv = app->GetCommand(handler);
      if (NS_SUCCEEDED(rv) && !CheckHandlerMatchesAppName(handler)) {
        return false;
      }
    }
  }

  return true;
}

nsresult
nsMailGNOMEIntegration::MakeDefault(const char* const *aProtocols,
                                    unsigned int aProtocolsLength,
                                    const char *aMimeType,
                                    const char *aExtensions)
{
  nsAutoCString appKeyValue;
  nsCOMPtr<nsIGConfService> gconf = do_GetService(NS_GCONFSERVICE_CONTRACTID);
  nsCOMPtr<nsIGIOService> giovfs = do_GetService(NS_GIOSERVICE_CONTRACTID);
  if(mAppIsInPath) {
    // mAppPath is in the users path, so use only the basename as the launcher
    gchar *tmp = g_path_get_basename(mAppPath.get());
    appKeyValue = tmp;
    g_free(tmp);
  } else {
    appKeyValue = mAppPath;
  }

  appKeyValue.AppendLiteral(" %s");

  nsresult rv;
  if (gconf) {
    for (unsigned int i = 0; i < aProtocolsLength; ++i) {
      rv = gconf->SetAppForProtocol(nsDependentCString(aProtocols[i]),
                                    appKeyValue);
      NS_ENSURE_SUCCESS(rv, rv);
    }
  }

  if (giovfs) {
    nsCOMPtr<nsIStringBundleService> bundleService =
      mozilla::services::GetStringBundleService();
    NS_ENSURE_TRUE(bundleService, NS_ERROR_UNEXPECTED);

    nsCOMPtr<nsIStringBundle> brandBundle;
    rv = bundleService->CreateBundle(BRAND_PROPERTIES, getter_AddRefs(brandBundle));
    NS_ENSURE_SUCCESS(rv, rv);

    nsString brandShortName;
    brandBundle->GetStringFromName(u"brandShortName",
                                   getter_Copies(brandShortName));

    // use brandShortName as the application id.
    NS_ConvertUTF16toUTF8 id(brandShortName);

    nsCOMPtr<nsIGIOMimeApp> app;
    rv = giovfs->CreateAppFromCommand(mAppPath, id, getter_AddRefs(app));
    NS_ENSURE_SUCCESS(rv, rv);

    for (unsigned int i = 0; i < aProtocolsLength; ++i) {
      rv = app->SetAsDefaultForURIScheme(nsDependentCString(aProtocols[i]));
      NS_ENSURE_SUCCESS(rv, rv);
      if (aMimeType)
        rv = app->SetAsDefaultForMimeType(nsDependentCString(aMimeType));
      NS_ENSURE_SUCCESS(rv, rv);
      if (aExtensions)
        rv = app->SetAsDefaultForFileExtensions(nsDependentCString(aExtensions));
      NS_ENSURE_SUCCESS(rv, rv);
    }
  }

  return NS_OK;
}
