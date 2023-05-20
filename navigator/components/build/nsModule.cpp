/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/ModuleUtils.h"
#include "nsSuiteDirectoryProvider.h"
#include "nsNetCID.h"
#include "nsRDFCID.h"
#include "nsFeedSniffer.h"

#if defined(XP_WIN)
#include "nsWindowsShellService.h"
#elif defined(XP_MACOSX)
#include "nsMacShellService.h"
#elif defined(MOZ_WIDGET_GTK)
#include "nsGNOMEShellService.h"
#endif

/////////////////////////////////////////////////////////////////////////////

NS_GENERIC_FACTORY_CONSTRUCTOR(nsSuiteDirectoryProvider)
NS_GENERIC_FACTORY_CONSTRUCTOR(nsFeedSniffer)
#if defined(XP_WIN)
NS_GENERIC_FACTORY_CONSTRUCTOR(nsWindowsShellService)
#elif defined(XP_MACOSX)
NS_GENERIC_FACTORY_CONSTRUCTOR(nsMacShellService)
#elif defined(MOZ_WIDGET_GTK)
NS_GENERIC_FACTORY_CONSTRUCTOR_INIT(nsGNOMEShellService, Init)
#endif

NS_DEFINE_NAMED_CID(NS_SUITEDIRECTORYPROVIDER_CID);
NS_DEFINE_NAMED_CID(NS_FEEDSNIFFER_CID);
#if defined(XP_WIN) || defined(XP_MACOSX) || defined(MOZ_WIDGET_GTK)
NS_DEFINE_NAMED_CID(NS_SHELLSERVICE_CID);
#endif

/////////////////////////////////////////////////////////////////////////////

static const mozilla::Module::CIDEntry kNavigatorCIDs[] = {
  { &kNS_SUITEDIRECTORYPROVIDER_CID, false, nullptr, nsSuiteDirectoryProviderConstructor },
  { &kNS_FEEDSNIFFER_CID, false, nullptr, nsFeedSnifferConstructor },
#if defined(XP_WIN)
  { &kNS_SHELLSERVICE_CID, false, nullptr, nsWindowsShellServiceConstructor },
#elif defined(XP_MACOSX)
  { &kNS_SHELLSERVICE_CID, false, nullptr, nsMacShellServiceConstructor },
#elif defined(MOZ_WIDGET_GTK)
  { &kNS_SHELLSERVICE_CID, false, nullptr, nsGNOMEShellServiceConstructor },
#endif
  { nullptr }
};

static const mozilla::Module::ContractIDEntry kNavigatorContracts[] = {
  { NS_SUITEDIRECTORYPROVIDER_CONTRACTID, &kNS_SUITEDIRECTORYPROVIDER_CID },
  { NS_FEEDSNIFFER_CONTRACTID, &kNS_FEEDSNIFFER_CID },
#if defined(XP_WIN) || defined(XP_MACOSX) || defined(MOZ_WIDGET_GTK)
  { NS_SHELLSERVICE_CONTRACTID, &kNS_SHELLSERVICE_CID },
#endif
  { nullptr }
};

static const mozilla::Module::CategoryEntry kNavigatorCategories[] = {
  { XPCOM_DIRECTORY_PROVIDER_CATEGORY, "suite-directory-provider", NS_SUITEDIRECTORYPROVIDER_CONTRACTID },
  { NS_CONTENT_SNIFFER_CATEGORY, "Feed Sniffer", NS_FEEDSNIFFER_CONTRACTID },
  { nullptr }
};

static const mozilla::Module kNavigatorModule = {
  mozilla::Module::kVersion,
  kNavigatorCIDs,
  kNavigatorContracts,
  kNavigatorCategories
};

NSMODULE_DEFN(nsNavigatorCompsModule) = &kNavigatorModule;
