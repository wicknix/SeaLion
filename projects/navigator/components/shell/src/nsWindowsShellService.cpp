/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "imgIContainer.h"
#include "imgIRequest.h"
#include "mozilla/gfx/2D.h"
#include "mozilla/RefPtr.h"
#include "nsIDOMHTMLImageElement.h"
#include "nsIImageLoadingContent.h"
#include "nsIPrefService.h"
#include "nsIPrefLocalizedString.h"
#include "nsWindowsShellService.h"
#include "nsIProcess.h"
#include "windows.h"
#include "nsIFile.h"
#include "nsNetUtil.h"
#include "nsNativeCharsetUtils.h"
#include "nsUnicharUtils.h"
#include "nsIStringBundle.h"
#include "nsIServiceManager.h"
#include "nsServiceManagerUtils.h"
#include "nsAppDirectoryServiceDefs.h"
#include "nsDirectoryServiceDefs.h"
#include "nsDirectoryServiceUtils.h"
#include "nsIWindowsRegKey.h"
#include "nsIWinTaskbar.h"
#include "nsISupportsPrimitives.h"
#include "nsXULAppAPI.h"
#include <mbstring.h>
#include "mozilla/Services.h"

#ifdef _WIN32_WINNT
#undef _WIN32_WINNT
#endif
#define _WIN32_WINNT 0x0600
#define INITGUID
#include <shlobj.h>

#ifndef MAX_BUF
#define MAX_BUF 4096
#endif

#define REG_SUCCEEDED(val) \
  (val == ERROR_SUCCESS)

#define REG_FAILED(val) \
  (val != ERROR_SUCCESS)

#define NS_TASKBAR_CONTRACTID "@mozilla.org/windows-taskbar;1"

using namespace mozilla;
using namespace mozilla::gfx;

NS_IMPL_ISUPPORTS(nsWindowsShellService, nsIWindowsShellService, nsIShellService)

static nsresult
OpenKeyForReading(HKEY aKeyRoot, const wchar_t* aKeyName, HKEY* aKey)
{
  DWORD res = ::RegOpenKeyExW(aKeyRoot, aKeyName, 0, KEY_READ, aKey);
  switch (res) {
  case ERROR_SUCCESS:
   break;
  case ERROR_ACCESS_DENIED:
    return NS_ERROR_FILE_ACCESS_DENIED;
  case ERROR_FILE_NOT_FOUND:
    return NS_ERROR_NOT_AVAILABLE;
  }

  return NS_OK;
}

///////////////////////////////////////////////////////////////////////////////
// Default SeaMonkey OS integration Registry Settings
// Note: Some settings only exist when using the installer!
//       The setting of SeaMonkey as default application is made by a helper
//       application since writing those values may require elevation.
//
// Default Browser settings:
// - File Extension Mappings
//   -----------------------
//   The following file extensions:
//    .htm .html .shtml .xht .xhtml
//   are mapped like so:
//
//   HKCU\SOFTWARE\Classes\.<ext>\      (default)         REG_SZ   SeaMonkeyHTML
//
//   as aliases to the class:
//
//   HKCU\SOFTWARE\Classes\SeaMonkeyHTML\
//     DefaultIcon                      (default)         REG_SZ     <appfolder>\chrome\icons\default\html-file.ico
//     shell\open\command               (default)         REG_SZ     <apppath> -url "%1"
//
// - Windows Vista Protocol Handler
//
//   HKCU\SOFTWARE\Classes\SeaMonkeyURL\(default)         REG_SZ     <appname> URL
//                                      EditFlags         REG_DWORD  2
//                                      FriendlyTypeName  REG_SZ     <appname> URL
//     DefaultIcon                      (default)         REG_SZ     <apppath>,1
//     shell\open\command               (default)         REG_SZ     <apppath> -requestPending -osint -url "%1"
//     shell\open\ddeexec               (default)         REG_SZ     "%1",,0,0,,,,
//     shell\open\ddeexec               NoActivateHandler REG_SZ
//                       \Application   (default)         REG_SZ     SeaMonkey
//                       \Topic         (default)         REG_SZ     WWW_OpenURL
//
// - Protocol Mappings
//   -----------------
//   The following protocols:
//    HTTP, HTTPS, FTP
//   are mapped like so:
//
//   HKCU\SOFTWARE\Classes\<protocol>\
//     DefaultIcon                      (default)         REG_SZ     <apppath>,0
//     shell\open\command               (default)         REG_SZ     <apppath> -requestPending -osint -url "%1"
//     shell\open\ddeexec               (default)         REG_SZ     "%1",,0,0,,,,
//     shell\open\ddeexec               NoActivateHandler REG_SZ
//                       \Application   (default)         REG_SZ     SeaMonkey
//                       \Topic         (default)         REG_SZ     WWW_OpenURL
//
// - Windows Start Menu (Win2K SP2, XP SP1, and newer)
//   -------------------------------------------------
//   The following keys are set to make SeaMonkey appear in the Start Menu as the
//   browser:
//
//   HKCU\SOFTWARE\Clients\StartMenuInternet\SEAMONKEY.EXE\
//                                      (default)         REG_SZ     <appname>
//     DefaultIcon                      (default)         REG_SZ     <apppath>,0
//     InstallInfo                      HideIconsCommand  REG_SZ     <uninstpath> /HideShortcuts
//     InstallInfo                      IconsVisible      REG_DWORD  1
//     InstallInfo                      ReinstallCommand  REG_SZ     <uninstpath> /SetAsDefaultAppGlobal
//     InstallInfo                      ShowIconsCommand  REG_SZ     <uninstpath> /ShowShortcuts
//     shell\open\command               (default)         REG_SZ     <apppath>
//     shell\properties                 (default)         REG_SZ     <appname> &Preferences
//     shell\properties\command         (default)         REG_SZ     <apppath> -preferences
//     shell\safemode                   (default)         REG_SZ     <appname> &Safe Mode
//     shell\safemode\command           (default)         REG_SZ     <apppath> -safe-mode
//
//
//
// Default Mail&News settings
//
// - File Extension Mappings
//   -----------------------
//   The following file extension:
//    .eml
//   is mapped like this:
//
//   HKCU\SOFTWARE\Classes\.eml         (default)         REG_SZ    SeaMonkeyEML
//
//   That aliases to this class:
//   HKCU\SOFTWARE\Classes\SeaMonkeyEML\ (default)        REG_SZ    SeaMonkey (Mail) Document
//                                      FriendlyTypeName  REG_SZ    SeaMonkey (Mail) Document
//     DefaultIcon                      (default)         REG_SZ    <appfolder>\chrome\icons\default\misc-file.ico
//     shell\open\command               (default)         REG_SZ    <apppath> "%1"
//
// - Windows Vista Protocol Handler
//
//   HKCU\SOFTWARE\Classes\SeaMonkeyCOMPOSE (default)     REG_SZ    SeaMonkey (Mail) URL
//                                       DefaultIcon      REG_SZ    <apppath>,0
//                                       EditFlags        REG_DWORD 2
//     shell\open\command                (default)        REG_SZ    <apppath> -osint -compose "%1"
//
//   HKCU\SOFTWARE\Classes\SeaMonkeyNEWS (default)        REG_SZ    SeaMonkey (News) URL
//                                       DefaultIcon      REG_SZ    <apppath>,0
//                                       EditFlags        REG_DWORD 2
//     shell\open\command                (default)        REG_SZ    <apppath> -osint -news "%1"
//
//
// - Protocol Mappings
//   -----------------
//   The following protocol:
//    mailto
//   is mapped like this:
//
//   HKCU\SOFTWARE\Classes\mailto\       (default)       REG_SZ     SeaMonkey (Mail) URL
//                                       EditFlags       REG_DWORD  2
//                                       URL Protocol    REG_SZ
//    DefaultIcon                        (default)       REG_SZ     <apppath>,0
//    shell\open\command                 (default)       REG_SZ     <apppath> -osint -compose "%1"
//
//   The following protocols:
//    news,nntp,snews
//   are mapped like this:
//
//   HKCU\SOFTWARE\Classes\<protocol>\   (default)       REG_SZ     SeaMonkey (News) URL
//                                       EditFlags       REG_DWORD  2
//                                       URL Protocol    REG_SZ
//    DefaultIcon                        (default)       REG_SZ     <appath>,0
//    shell\open\command                 (default)       REG_SZ     <appath> -osint -news "%1"
//
// - Windows Start Menu (Win2K SP2, XP SP1, and newer)
//   -------------------------------------------------
//   The following keys are set to make SeaMonkey appear in the Start Menu as
//   the default mail program:
//
//   HKCU\SOFTWARE\Clients\Mail\SeaMonkey
//                                   (default)           REG_SZ     <appname>
//                                   DLLPath             REG_SZ     <appfolder>\mozMapi32.dll
//    DefaultIcon                    (default)           REG_SZ     <apppath>,0
//    InstallInfo                    HideIconsCommand    REG_SZ     <uninstpath> /HideShortcuts
//    InstallInfo                    ReinstallCommand    REG_SZ     <uninstpath> /SetAsDefaultAppGlobal
//    InstallInfo                    ShowIconsCommand    REG_SZ     <uninstpath> /ShowShortcuts
//    shell\open\command             (default)           REG_SZ     <apppath> -mail
//    shell\properties               (default)           REG_SZ     <appname> &Preferences
//    shell\properties\command       (default)           REG_SZ     <apppath> -preferences
//
//   Also set SeaMonkey as News reader (Usenet), though Windows does currently
//   not expose a default news reader to UI. Applications like Outlook Express
//   also add themselves to this registry key
//
//   HKCU\SOFTWARE\Clients\News\SeaMonkey
//                                   (default)           REG_SZ     <appname>
//                                   DLLPath             REG_SZ     <appfolder>\mozMapi32.dll
//    DefaultIcon                    (default)           REG_SZ     <apppath>,0
//    shell\open\command             (default)           REG_SZ     <apppath> -news
//
///////////////////////////////////////////////////////////////////////////////


typedef enum {
  NO_SUBSTITUTION           = 0x00,
  APP_PATH_SUBSTITUTION     = 0x01
} SettingFlags;

#define APP_REG_NAME L"Borealis"
// APP_REG_NAME_MAIL and APP_REG_NAME_NEWS should be kept in synch with
// AppRegNameMail and AppRegNameNews in the installer file: defines.nsi.in
#define APP_REG_NAME_MAIL L"Borealis (Mail)"
#define APP_REG_NAME_NEWS L"Borealis (News)"
#define CLS_HTML "BorealisHTML"
#define CLS_URL "BorealisURL"
#define CLS_EML "BorealisEML"
#define CLS_MAILTOURL "BorealisCOMPOSE"
#define CLS_NEWSURL "BorealisNEWS"
#define CLS_FEEDURL "BorealisFEED"
#define SMI "SOFTWARE\\Clients\\StartMenuInternet\\"
#define DI "\\DefaultIcon"
#define II "\\InstallInfo"
#define SOP "\\shell\\open\\command"

#define VAL_ICON "%APPPATH%,0"
#define VAL_HTML_OPEN "\"%APPPATH%\" -url \"%1\""
#define VAL_URL_OPEN "\"%APPPATH%\" -requestPending -osint -url \"%1\""
#define VAL_MAIL_OPEN "\"%APPPATH%\" \"%1\""

#define MAKE_KEY_NAME1(PREFIX, MID) \
  PREFIX MID

// The DefaultIcon registry key value should never be used (e.g. NON_ESSENTIAL)
// when checking if SeaMonkey is the default browser since other applications
// (e.g. MS Office) may modify the DefaultIcon registry key value to add Icon
// Handlers.
// see http://msdn2.microsoft.com/en-us/library/aa969357.aspx for more info.
static SETTING gBrowserSettings[] = {
  // File Extension Class - as of 1.8.1.2 the value for VAL_URL_OPEN is also
  // checked for CLS_HTML since SeaMonkey should also own opening local files
  // when set as the default browser.
  { MAKE_KEY_NAME1(CLS_HTML, SOP), "", VAL_HTML_OPEN, APP_PATH_SUBSTITUTION },

  // Protocol Handler Class - for Vista and above
  { MAKE_KEY_NAME1(CLS_URL, SOP), "", VAL_URL_OPEN, APP_PATH_SUBSTITUTION },

  // Protocol Handlers
  { MAKE_KEY_NAME1("HTTP", DI),    "", VAL_ICON, APP_PATH_SUBSTITUTION },
  { MAKE_KEY_NAME1("HTTP", SOP),   "", VAL_URL_OPEN, APP_PATH_SUBSTITUTION },
  { MAKE_KEY_NAME1("HTTPS", DI),   "", VAL_ICON, APP_PATH_SUBSTITUTION },
  { MAKE_KEY_NAME1("HTTPS", SOP),  "", VAL_URL_OPEN, APP_PATH_SUBSTITUTION }

  // These values must be set by hand, since they contain localized strings.
  //   seamonkey.exe\shell\properties   (default)   REG_SZ  SeaMonkey &Preferences
  //   seamonkey.exe\shell\safemode     (default)   REG_SZ  SeaMonkey &Safe Mode
};

 static SETTING gMailSettings[] = {
   // File Extension Aliases
   { ".eml", "", CLS_EML, NO_SUBSTITUTION },
   // File Extension Class
   { MAKE_KEY_NAME1(CLS_EML, SOP), "",  VAL_MAIL_OPEN, APP_PATH_SUBSTITUTION},

   // Protocol Handler Class - for Vista and above
   { MAKE_KEY_NAME1(CLS_MAILTOURL, SOP), "", "\"%APPPATH%\" -osint -compose \"%1\"", APP_PATH_SUBSTITUTION },

   // Protocol Handlers
   { MAKE_KEY_NAME1("mailto", SOP), "", "\"%APPPATH%\" -osint -compose \"%1\"", APP_PATH_SUBSTITUTION }
 };

 static SETTING gNewsSettings[] = {
    // Protocol Handler Class - for Vista and above
   { MAKE_KEY_NAME1(CLS_NEWSURL, SOP), "", "\"%APPPATH%\" -osint -mail \"%1\"",  APP_PATH_SUBSTITUTION },

   // Protocol Handlers
   { MAKE_KEY_NAME1("news", SOP), "", "\"%APPPATH%\" -osint -mail \"%1\"", APP_PATH_SUBSTITUTION },
   { MAKE_KEY_NAME1("nntp", SOP), "", "\"%APPPATH%\" -osint -mail \"%1\"", APP_PATH_SUBSTITUTION },
};

 static SETTING gFeedSettings[] = {
   // Protocol Handler Class - for Vista and above
   { MAKE_KEY_NAME1(CLS_FEEDURL, SOP), "", "\"%APPPATH%\" -osint -mail \"%1\"", APP_PATH_SUBSTITUTION },

   // Protocol Handlers
   { MAKE_KEY_NAME1("feed", SOP), "", "\"%APPPATH%\" -osint -mail \"%1\"", APP_PATH_SUBSTITUTION },
};

nsresult
GetHelperPath(nsString& aPath)
{
  nsresult rv;
  nsCOMPtr<nsIProperties> directoryService =
    do_GetService(NS_DIRECTORY_SERVICE_CONTRACTID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIFile> appHelper;
  rv = directoryService->Get(XRE_EXECUTABLE_FILE,
                             NS_GET_IID(nsIFile),
                             getter_AddRefs(appHelper));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = appHelper->SetNativeLeafName(NS_LITERAL_CSTRING("uninstall"));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = appHelper->AppendNative(NS_LITERAL_CSTRING("helper.exe"));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = appHelper->GetPath(aPath);

  aPath.Insert('"', 0);
  aPath.Append('"');

  return rv;
}

nsresult
LaunchHelper(const nsString& aPath)
{
  STARTUPINFOW si = {sizeof(si), 0};
  PROCESS_INFORMATION pi = {0};

  BOOL ok = CreateProcessW(nullptr, (LPWSTR)aPath.get(), nullptr, nullptr,
                           FALSE, 0, nullptr, nullptr, &si, &pi);

  if (!ok)
    return NS_ERROR_FAILURE;

  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  return NS_OK;
}

NS_IMETHODIMP
nsWindowsShellService::ShortcutMaintenance()
{
  nsresult rv;

  // Launch helper.exe so it can update the application user model ids on
  // shortcuts in the user's taskbar and start menu. This keeps older pinned
  // shortcuts grouped correctly after major updates. Note, we also do this
  // through the upgrade installer script, however, this is the only place we
  // have a chance to trap links created by users who do control the install/
  // update process of the browser.

  nsCOMPtr<nsIWinTaskbar> taskbarInfo =
    do_GetService(NS_TASKBAR_CONTRACTID);
  if (!taskbarInfo) // If we haven't built with win7 sdk features, this fails.
    return NS_OK;

  // Avoid if this isn't Win7+
  bool isSupported = false;
  taskbarInfo->GetAvailable(&isSupported);
  if (!isSupported)
    return NS_OK;

  nsAutoString appId;
  if (NS_FAILED(taskbarInfo->GetDefaultGroupId(appId)))
    return NS_ERROR_UNEXPECTED;

  NS_NAMED_LITERAL_CSTRING(prefName, "browser.taskbar.lastgroupid");
  nsCOMPtr<nsIPrefService> prefs =
    do_GetService(NS_PREFSERVICE_CONTRACTID);
  if (!prefs)
    return NS_ERROR_UNEXPECTED;

  nsCOMPtr<nsIPrefBranch> prefBranch;
  prefs->GetBranch(nullptr, getter_AddRefs(prefBranch));
  if (!prefBranch)
    return NS_ERROR_UNEXPECTED;

  nsCOMPtr<nsISupportsString> prefString;
  rv = prefBranch->GetComplexValue(prefName.get(),
                                   NS_GET_IID(nsISupportsString),
                                   getter_AddRefs(prefString));
  if (NS_SUCCEEDED(rv)) {
    nsAutoString version;
    prefString->GetData(version);
    if (version.Equals(appId)) {
      // We're all good, get out of here.
      return NS_OK;
    }
  }
  // Update the version in prefs
  prefString = do_CreateInstance(NS_SUPPORTS_STRING_CONTRACTID, &rv);
  if (NS_FAILED(rv))
    return rv;

  prefString->SetData(appId);
  rv = prefBranch->SetComplexValue(prefName.get(),
                                   NS_GET_IID(nsISupportsString),
                                   prefString);
  if (NS_FAILED(rv)) {
    NS_WARNING("Couldn't set last user model id!");
    return NS_ERROR_UNEXPECTED;
  }

  nsAutoString appHelperPath;
  if (NS_FAILED(GetHelperPath(appHelperPath)))
    return NS_ERROR_UNEXPECTED;

  appHelperPath.AppendLiteral(" /UpdateShortcutAppUserModelIds");

  return LaunchHelper(appHelperPath);
}

/* helper routine. Iterate over the passed in settings object,
   testing each key to see if we are handling it.
*/
bool
nsWindowsShellService::TestForDefault(SETTING aSettings[], int32_t aSize)
{
  wchar_t currValue[MAX_BUF];
  SETTING* end = aSettings + aSize;
  for (SETTING * settings = aSettings; settings < end; ++settings) {
    NS_ConvertUTF8toUTF16 dataLongPath(settings->valueData);
    NS_ConvertUTF8toUTF16 dataShortPath(settings->valueData);
    NS_ConvertUTF8toUTF16 key(settings->keyName);
    NS_ConvertUTF8toUTF16 value(settings->valueName);
    if (settings->flags & APP_PATH_SUBSTITUTION) {
      int32_t offset = dataLongPath.Find("%APPPATH%");
      dataLongPath.Replace(offset, 9, mAppLongPath);
      // Remove the quotes around %APPPATH% in VAL_OPEN for short paths
      int32_t offsetQuoted = dataShortPath.Find("\"%APPPATH%\"");
      if (offsetQuoted != -1)
        dataShortPath.Replace(offsetQuoted, 11, mAppShortPath);
      else
        dataShortPath.Replace(offset, 9, mAppShortPath);
    }

    ::ZeroMemory(currValue, sizeof(currValue));
    HKEY theKey;
    nsresult rv = OpenKeyForReading(HKEY_CLASSES_ROOT, key.get(), &theKey);
    if (NS_FAILED(rv))
      // Key does not exist
      return false;

    DWORD len = sizeof currValue;
    DWORD res = ::RegQueryValueExW(theKey, value.get(),
                                   nullptr, nullptr, (LPBYTE)currValue, &len);
    // Close the key we opened.
    ::RegCloseKey(theKey);
    if (REG_FAILED(res) ||
        _wcsicmp(dataLongPath.get(), currValue) &&
        _wcsicmp(dataShortPath.get(), currValue)) {
      // Key wasn't set, or was set to something else (something else became the default client)
      return false;
    }
  }

  return true;
}

nsresult nsWindowsShellService::Init()
{
  wchar_t appPath[MAX_BUF];
  if (!::GetModuleFileNameW(0, appPath, MAX_BUF))
    return NS_ERROR_FAILURE;

  mAppLongPath.Assign(appPath);

  // Support short path to the exe so if it is already set the user is not
  // prompted to set the default mail client again.
  if (!::GetShortPathNameW(appPath, appPath, MAX_BUF))
    return NS_ERROR_FAILURE;

  mAppShortPath.Assign(appPath);

  return NS_OK;
}

bool
nsWindowsShellService::IsDefaultClientVista(uint16_t aApps, bool* aIsDefaultClient)
{
  IApplicationAssociationRegistration* pAAR;

  HRESULT hr = CoCreateInstance(CLSID_ApplicationAssociationRegistration,
                                nullptr,
                                CLSCTX_INPROC,
                                IID_IApplicationAssociationRegistration,
                                (void**)&pAAR);

  if (SUCCEEDED(hr)) {
    BOOL isDefaultBrowser = true;
    BOOL isDefaultMail    = true;
    BOOL isDefaultNews    = true;
    if (aApps & nsIShellService::BROWSER)
      pAAR->QueryAppIsDefaultAll(AL_EFFECTIVE, APP_REG_NAME, &isDefaultBrowser);
    if (aApps & nsIShellService::MAIL)
      pAAR->QueryAppIsDefaultAll(AL_EFFECTIVE, APP_REG_NAME_MAIL, &isDefaultMail);
    if (aApps & nsIShellService::NEWS)
      pAAR->QueryAppIsDefaultAll(AL_EFFECTIVE, APP_REG_NAME_NEWS, &isDefaultNews);

    *aIsDefaultClient = isDefaultBrowser && isDefaultNews && isDefaultMail;

    pAAR->Release();
    return true;
  }
  return false;
}

NS_IMETHODIMP
nsWindowsShellService::IsDefaultClient(bool aStartupCheck, uint16_t aApps, bool *aIsDefaultClient)
{
  // If this is the first application window, maintain internal state that we've
  // checked this session (so that subsequent window opens don't show the
  // default client dialog).
  if (aStartupCheck)
    mCheckedThisSessionClient = true;

  *aIsDefaultClient = true;

  // for each type, check if it is the default app
  // browser check needs to be at the top
  if (aApps & nsIShellService::BROWSER) {
    *aIsDefaultClient &= TestForDefault(gBrowserSettings, sizeof(gBrowserSettings)/sizeof(SETTING));
    // Only check if this app is default on Vista if the previous checks
    // indicate that this app is the default.
    if (*aIsDefaultClient)
      IsDefaultClientVista(nsIShellService::BROWSER, aIsDefaultClient);
  }
  if (aApps & nsIShellService::MAIL) {
    *aIsDefaultClient &= TestForDefault(gMailSettings, sizeof(gMailSettings)/sizeof(SETTING));
    // Only check if this app is default on Vista if the previous checks
    // indicate that this app is the default.
    if (*aIsDefaultClient)
      IsDefaultClientVista(nsIShellService::MAIL, aIsDefaultClient);
  }
  if (aApps & nsIShellService::NEWS) {
    *aIsDefaultClient &= TestForDefault(gNewsSettings, sizeof(gNewsSettings)/sizeof(SETTING));
    // Only check if this app is default on Vista if the previous checks
    // indicate that this app is the default.
    if (*aIsDefaultClient)
      IsDefaultClientVista(nsIShellService::NEWS, aIsDefaultClient);
  }

  return NS_OK;
}


NS_IMETHODIMP
nsWindowsShellService::SetDefaultClient(bool aForAllUsers,
                                        bool aClaimAllTypes, uint16_t aApps)
{
  nsAutoString appHelperPath;
  if (NS_FAILED(GetHelperPath(appHelperPath)))
    return NS_ERROR_UNEXPECTED;

  if (aForAllUsers)
    appHelperPath.AppendLiteral(" /SetAsDefaultAppGlobal");
  else {
    appHelperPath.AppendLiteral(" /SetAsDefaultAppUser");
    if (aApps & nsIShellService::BROWSER)
      appHelperPath.AppendLiteral(" Browser");

    if (aApps & nsIShellService::MAIL)
      appHelperPath.AppendLiteral(" Mail");

    if (aApps & nsIShellService::NEWS)
      appHelperPath.AppendLiteral(" News");
   }

  STARTUPINFOW si = {sizeof(si), 0};
  PROCESS_INFORMATION pi = {0};

  BOOL ok = CreateProcessW(nullptr, (LPWSTR)appHelperPath.get(), nullptr,
                           nullptr, FALSE, 0, nullptr, nullptr, &si, &pi);

  if (!ok)
    return NS_ERROR_FAILURE;

  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);

  return NS_OK;
}

NS_IMETHODIMP
nsWindowsShellService::GetShouldCheckDefaultClient(bool* aResult)
{
  if (mCheckedThisSessionClient) {
    *aResult = false;
    return NS_OK;
  }

  nsresult rv;
  nsCOMPtr<nsIPrefBranch> prefs(do_GetService(NS_PREFSERVICE_CONTRACTID, &rv));
  NS_ENSURE_SUCCESS(rv, rv);
  return prefs->GetBoolPref(PREF_CHECKDEFAULTCLIENT, aResult);
}



NS_IMETHODIMP
nsWindowsShellService::SetShouldCheckDefaultClient(bool aShouldCheck)
{
  nsCOMPtr<nsIPrefBranch> prefs(do_GetService(NS_PREFSERVICE_CONTRACTID));
  NS_ENSURE_TRUE(prefs, NS_ERROR_FAILURE);
  return prefs->SetBoolPref(PREF_CHECKDEFAULTCLIENT, aShouldCheck);
}

NS_IMETHODIMP
nsWindowsShellService::GetShouldBeDefaultClientFor(uint16_t* aApps)
{
  nsresult rv;
  nsCOMPtr<nsIPrefBranch> prefs(do_GetService(NS_PREFSERVICE_CONTRACTID, &rv));
  NS_ENSURE_SUCCESS(rv, rv);
  int32_t result;
  rv = prefs->GetIntPref("shell.checkDefaultApps", &result);
  *aApps = result;
  return rv;
}

NS_IMETHODIMP
nsWindowsShellService::SetShouldBeDefaultClientFor(uint16_t aApps)
{
  nsresult rv;
  nsCOMPtr<nsIPrefBranch> prefs(do_GetService(NS_PREFSERVICE_CONTRACTID, &rv));
  NS_ENSURE_SUCCESS(rv, rv);
  return prefs->SetIntPref("shell.checkDefaultApps", aApps);
}

NS_IMETHODIMP
nsWindowsShellService::GetCanSetDesktopBackground(bool* aResult)
{
  *aResult = true;
  return NS_OK;
}

static nsresult
WriteBitmap(nsIFile* aFile, imgIContainer* aImage)
{
  nsresult rv;

  RefPtr<SourceSurface> surface =
    aImage->GetFrame(imgIContainer::FRAME_CURRENT,
                     imgIContainer::FLAG_SYNC_DECODE);
  NS_ENSURE_TRUE(surface, NS_ERROR_FAILURE);

  // For either of the following formats we want to set the biBitCount member
  // of the BITMAPINFOHEADER struct to 32, below. For that value the bitmap
  // format defines that the A8/X8 WORDs in the bitmap byte stream be ignored
  // for the BI_RGB value we use for the biCompression member.
  MOZ_ASSERT(surface->GetFormat() == SurfaceFormat::B8G8R8A8 ||
             surface->GetFormat() == SurfaceFormat::B8G8R8X8);

  RefPtr<DataSourceSurface> dataSurface = surface->GetDataSurface();
  NS_ENSURE_TRUE(dataSurface, NS_ERROR_FAILURE);

  int32_t width = dataSurface->GetSize().width;
  int32_t height = dataSurface->GetSize().height;
  int32_t bytesPerPixel = 4 * sizeof(uint8_t);
  int32_t bytesPerRow = bytesPerPixel * width;

  // initialize these bitmap structs which we will later
  // serialize directly to the head of the bitmap file
  BITMAPINFOHEADER bmi;
  bmi.biSize = sizeof(BITMAPINFOHEADER);
  bmi.biWidth = width;
  bmi.biHeight = height;
  bmi.biPlanes = 1;
  bmi.biBitCount = (WORD)bytesPerPixel*8;
  bmi.biCompression = BI_RGB;
  bmi.biSizeImage = bytesPerRow * height;
  bmi.biXPelsPerMeter = 0;
  bmi.biYPelsPerMeter = 0;
  bmi.biClrUsed = 0;
  bmi.biClrImportant = 0;

  BITMAPFILEHEADER bf;
  bf.bfType = 0x4D42; // 'BM'
  bf.bfReserved1 = 0;
  bf.bfReserved2 = 0;
  bf.bfOffBits = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);
  bf.bfSize = bf.bfOffBits + bmi.biSizeImage;

  // get a file output stream
  nsCOMPtr<nsIOutputStream> stream;
  rv = NS_NewLocalFileOutputStream(getter_AddRefs(stream), aFile);
  NS_ENSURE_SUCCESS(rv, rv);

  DataSourceSurface::MappedSurface map;
  if (!dataSurface->Map(DataSourceSurface::MapType::READ, &map)) {
    return NS_ERROR_FAILURE;
  }

  // write the bitmap headers and rgb pixel data to the file
  rv = NS_ERROR_FAILURE;
  if (stream) {
    uint32_t written;
    stream->Write((const char*)&bf, sizeof(BITMAPFILEHEADER), &written);
    if (written == sizeof(BITMAPFILEHEADER)) {
      stream->Write((const char*)&bmi, sizeof(BITMAPINFOHEADER), &written);
      if (written == sizeof(BITMAPINFOHEADER)) {
        // write out the image data backwards because the desktop won't
        // show bitmaps with negative heights for top-to-bottom
        uint32_t i = map.mStride * height;
        rv = NS_OK;
        do {
          i -= map.mStride;
          stream->Write(((const char*)map.mData) + i, bytesPerRow, &written);
          if (written != bytesPerRow) {
            rv = NS_ERROR_FAILURE;
            break;
          }
        } while (i != 0);
      }
    }

    stream->Close();
  }

  dataSurface->Unmap();

  return rv;
}

NS_IMETHODIMP
nsWindowsShellService::SetDesktopBackground(nsIDOMElement* aElement,
                                            int32_t aPosition)
{
  nsresult rv;

  nsCOMPtr<imgIContainer> container;

  nsCOMPtr<nsIDOMHTMLImageElement> imgElement(do_QueryInterface(aElement));
  if (!imgElement) {
    // XXX write background loading stuff!
    return NS_ERROR_NOT_AVAILABLE;
  }
  else {
    nsCOMPtr<nsIImageLoadingContent> imageContent =
      do_QueryInterface(aElement, &rv);
    if (!imageContent)
      return rv;

    // get the image container
    nsCOMPtr<imgIRequest> request;
    rv = imageContent->GetRequest(nsIImageLoadingContent::CURRENT_REQUEST,
                                  getter_AddRefs(request));
    if (!request)
      return rv;
    rv = request->GetImage(getter_AddRefs(container));
  }

  if (!container)
    return NS_ERROR_FAILURE;

  // get the file name from localized strings
  nsCOMPtr<nsIStringBundleService> bundleService =
    mozilla::services::GetStringBundleService();
  NS_ENSURE_TRUE(bundleService, NS_ERROR_UNEXPECTED);

  nsCOMPtr<nsIStringBundle> shellBundle;
  rv = bundleService->CreateBundle(SHELLSERVICE_PROPERTIES,
                                   getter_AddRefs(shellBundle));
  NS_ENSURE_SUCCESS(rv, rv);

  // e.g. "Desktop Background.bmp"
  nsString fileLeafName;
  rv = shellBundle->GetStringFromName
                      (u"desktopBackgroundLeafNameWin",
                       getter_Copies(fileLeafName));
  NS_ENSURE_SUCCESS(rv, rv);

  // get the profile root directory
  nsCOMPtr<nsIFile> file;
  rv = NS_GetSpecialDirectory(NS_APP_APPLICATION_REGISTRY_DIR,
                              getter_AddRefs(file));
  NS_ENSURE_SUCCESS(rv, rv);

  // eventually, the path is "%APPDATA%\Mozilla\SeaMonkey\Desktop Background.bmp"
  rv = file->Append(fileLeafName);
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoString path;
  rv = file->GetPath(path);
  NS_ENSURE_SUCCESS(rv, rv);

  // write the bitmap to a file in the profile directory
  rv = WriteBitmap(file, container);

  // if the file was written successfully, set it as the system wallpaper
  if (NS_SUCCEEDED(rv)) {
    nsCOMPtr<nsIWindowsRegKey> key(do_CreateInstance("@mozilla.org/windows-registry-key;1", &rv));
    NS_ENSURE_SUCCESS(rv, rv);

    rv = key->Create(nsIWindowsRegKey::ROOT_KEY_CURRENT_USER,
                     NS_LITERAL_STRING("Control Panel\\Desktop"),
                     nsIWindowsRegKey::ACCESS_SET_VALUE);
    NS_ENSURE_SUCCESS(rv, rv);

    int style = 0;
    switch (aPosition) {
      case BACKGROUND_STRETCH:
        style = 2;
        break;
      case BACKGROUND_FILL:
        style = 10;
        break;
      case BACKGROUND_FIT:
        style = 6;
        break;
    }

    nsString value;
    value.AppendInt(style);
    rv = key->WriteStringValue(NS_LITERAL_STRING("WallpaperStyle"), value);
    NS_ENSURE_SUCCESS(rv, rv);

    value.Assign(aPosition == BACKGROUND_TILE ? '1' : '0');
    rv = key->WriteStringValue(NS_LITERAL_STRING("TileWallpaper"), value);
    NS_ENSURE_SUCCESS(rv, rv);

    rv = key->Close();
    NS_ENSURE_SUCCESS(rv, rv);

    ::SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, (PVOID)path.get(),
                            SPIF_UPDATEINIFILE | SPIF_SENDWININICHANGE);
  }
  return rv;
}

NS_IMETHODIMP
nsWindowsShellService::GetDesktopBackgroundColor(uint32_t* aColor)
{
  uint32_t color = ::GetSysColor(COLOR_DESKTOP);
  *aColor = (GetRValue(color) << 16) | (GetGValue(color) << 8) | GetBValue(color);
  return NS_OK;
}

NS_IMETHODIMP
nsWindowsShellService::SetDesktopBackgroundColor(uint32_t aColor)
{
  int parameter = COLOR_DESKTOP;
  BYTE r = (aColor >> 16);
  BYTE g = (aColor << 16) >> 24;
  BYTE b = (aColor << 24) >> 24;
  COLORREF color = RGB(r,g,b);

  ::SetSysColors(1, &parameter, &color);

  nsresult rv;
  nsCOMPtr<nsIWindowsRegKey> key(do_CreateInstance("@mozilla.org/windows-registry-key;1", &rv));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = key->Create(nsIWindowsRegKey::ROOT_KEY_CURRENT_USER,
                   NS_LITERAL_STRING("Control Panel\\Colors"),
                   nsIWindowsRegKey::ACCESS_SET_VALUE);
  NS_ENSURE_SUCCESS(rv, rv);

  wchar_t rgb[12];
  _snwprintf(rgb, 12, L"%u %u %u", r, g, b);
  rv = key->WriteStringValue(NS_LITERAL_STRING("Background"),
                             nsDependentString(rgb));
  NS_ENSURE_SUCCESS(rv, rv);

  return key->Close();
}

NS_IMETHODIMP
nsWindowsShellService::OpenApplicationWithURI(nsIFile* aApplication,
                                              const nsACString& aURI)
{
  nsresult rv;
  nsCOMPtr<nsIProcess> process =
    do_CreateInstance("@mozilla.org/process/util;1", &rv);
  if (NS_FAILED(rv))
    return rv;

  rv = process->Init(aApplication);
  if (NS_FAILED(rv))
    return rv;

  const nsCString& spec = PromiseFlatCString(aURI);
  const char* specStr = spec.get();
  return process->Run(false, &specStr, 1);
}

NS_IMETHODIMP
nsWindowsShellService::GetDefaultFeedReader(nsIFile** _retval)
{
  *_retval = nullptr;

  nsresult rv;
  nsCOMPtr<nsIWindowsRegKey> key(do_CreateInstance("@mozilla.org/windows-registry-key;1", &rv));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = key->Open(nsIWindowsRegKey::ROOT_KEY_CLASSES_ROOT,
                 NS_LITERAL_STRING("feed\\shell\\open\\command"),
                 nsIWindowsRegKey::ACCESS_READ);
  NS_ENSURE_SUCCESS(rv, rv);

  nsString path;
  rv = key->ReadStringValue(EmptyString(), path);
  NS_ENSURE_SUCCESS(rv, rv);
  if (path.IsEmpty())
    return NS_ERROR_FAILURE;

  if (path.First() == '"') {
    // Everything inside the quotes
    path = Substring(path, 1, path.FindChar('"', 1) - 1);
  } else {
    // Everything up to the first space
    path = Substring(path, 0, path.FindChar(' '));
  }

  nsCOMPtr<nsIFile> defaultReader =
    do_CreateInstance("@mozilla.org/file/local;1", &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = defaultReader->InitWithPath(path);
  NS_ENSURE_SUCCESS(rv, rv);

  bool exists;
  rv = defaultReader->Exists(&exists);
  NS_ENSURE_SUCCESS(rv, rv);
  if (!exists)
    return NS_ERROR_FAILURE;

  NS_ADDREF(*_retval = defaultReader);
  return NS_OK;
}
