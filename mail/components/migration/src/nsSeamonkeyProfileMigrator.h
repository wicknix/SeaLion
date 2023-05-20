/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef seamonkeyprofilemigrator___h___
#define seamonkeyprofilemigrator___h___

#include "nsIMailProfileMigrator.h"
#include "nsIMutableArray.h"
#include "nsNetscapeProfileMigratorBase.h"

class nsIPrefBranch;
class nsIPrefService;

class nsSeamonkeyProfileMigrator : public nsNetscapeProfileMigratorBase
{
public:
  NS_DECL_ISUPPORTS_INHERITED

  nsSeamonkeyProfileMigrator();

  // nsIMailProfileMigrator methods
  NS_IMETHOD Migrate(uint16_t aItems, nsIProfileStartup* aStartup,
                        const char16_t* aProfile) override;
  NS_IMETHOD GetMigrateData(const char16_t* aProfile, bool aReplace,
                            uint16_t* aResult) override;
  NS_IMETHOD GetSourceProfiles(nsIArray** aResult) override;

protected:
  virtual ~nsSeamonkeyProfileMigrator();
  nsresult FillProfileDataFromSeamonkeyRegistry();
  nsresult GetSourceProfile(const char16_t* aProfile);

  nsresult CopyPreferences(bool aReplace);
  nsresult TransformPreferences(const nsAString& aSourcePrefFileName,
                                const nsAString& aTargetPrefFileName);

  nsresult DummyCopyRoutine(bool aReplace);
  nsresult CopyJunkTraining(bool aReplace);
  nsresult CopyPasswords(bool aReplace);
  nsresult CopyMailFolders(PBStructArray &aMailServers,
                           nsIPrefService* aPrefBranch);
  nsresult CopyAddressBookDirectories(PBStructArray &aLdapServers,
                                      nsIPrefService* aPrefService);
  nsresult CopySignatureFiles(PBStructArray &aIdentities,
                              nsIPrefService* aPrefBranch);

  void ReadBranch(const char *branchName,  nsIPrefService *aPrefService,
                  PBStructArray &aPrefs);
  void WriteBranch(const char *branchName, nsIPrefService *aPrefService,
                   PBStructArray &aPrefs);

private:
  nsCOMPtr<nsIMutableArray> mProfileNames;
  nsCOMPtr<nsIMutableArray> mProfileLocations;
};

#endif
