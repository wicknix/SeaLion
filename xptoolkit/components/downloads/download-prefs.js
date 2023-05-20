/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

pref("browser.download.finished_download_sound", false);
pref("browser.download.finished_sound_url", "");
pref("browser.download.useDownloadDir", false);
pref("browser.download.folderList", 1);

pref("browser.download.manager.useToolkitUI", false);
pref("browser.download.manager.showAlertOnComplete", true);
pref("browser.download.manager.showAlertInterval", 2000);
pref("browser.download.manager.retention", 2);
pref("browser.download.manager.quitBehavior", 0);
pref("browser.download.manager.addToRecentDocs", true);
pref("browser.download.manager.scanWhenDone", true);
pref("browser.download.manager.resumeOnWakeDelay", 10000);
pref("browser.download.manager.flashCount", 2);
pref("browser.download.manager.showWhenStarting", true);
pref("browser.download.manager.focusWhenStarting", false);
pref("browser.download.manager.closeWhenDone", false);
pref("browser.download.progress.closeWhenDone", false);

pref("browser.download.show_plugins_in_list", true);
pref("browser.download.hide_plugins_without_extensions", true);

// Number of milliseconds to wait for the http headers (and thus
// the Content-Disposition filename) before giving up and falling back to
// picking a filename without that info in hand so that the user sees some
// feedback from their action.
pref("browser.download.saveLinkAsFilenameTimeout", 4000);

// 0 opens the download manager
// 1 opens a progress dialog
// 2 and other values, no download manager, no progress dialog.
pref("browser.download.manager.behavior", 0);
#ifdef XP_UNIX
// For the download dialog
pref("browser.download.progressDnldDialog.enable_launch_reveal_buttons", false);
#endif