/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef SuiteDirectoryProvider_h__
#define SuiteDirectoryProvider_h__

#include "nsCOMArray.h"
#include "nsIDirectoryService.h"
#include "nsIFile.h"
#include "nsISimpleEnumerator.h"
#include "nsStringAPI.h"
#include "nsCOMPtr.h"
#include "nsIProperties.h"
#include "mozilla/Attributes.h"

#define NS_SUITEDIRECTORYPROVIDER_CONTRACTID "@binaryoutcast.com/navigator/directory-provider;1"
// {9aa21826-9d1d-433d-8c10-f313b26fa9dd}
#define NS_SUITEDIRECTORYPROVIDER_CID \
  { 0x9aa21826, 0x9d1d, 0x433d, { 0x8c, 0x10, 0xf3, 0x13, 0xb2, 0x6f, 0xa9, 0xdd } }

#define NS_APP_BOOKMARKS_50_FILE "BMarks"

class nsSuiteDirectoryProvider final : public nsIDirectoryServiceProvider2
{
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIDIRECTORYSERVICEPROVIDER
  NS_DECL_NSIDIRECTORYSERVICEPROVIDER2

private:
  ~nsSuiteDirectoryProvider() {}

  void EnsureProfileFile(const nsACString& aLeafName,
                         nsIFile* aParentDir, nsIFile* aTarget);

  void AppendDistroSearchDirs(nsIProperties* aDirSvc,
                              nsCOMArray<nsIFile> &array);

  void AppendFileKey(const char *key, nsIProperties* aDirSvc,
                     nsCOMArray<nsIFile> &array);

  class AppendingEnumerator final : public nsISimpleEnumerator
  {
  public:
    NS_DECL_ISUPPORTS
    NS_DECL_NSISIMPLEENUMERATOR

    AppendingEnumerator(nsISimpleEnumerator* aBase,
                        const char* const aLeafName);

  private:
    ~AppendingEnumerator() {}
    void GetNext();

    nsCOMPtr<nsISimpleEnumerator> mBase;
    nsDependentCString            mLeafName;
    nsCOMPtr<nsIFile>             mNext;
  };
};

#endif
