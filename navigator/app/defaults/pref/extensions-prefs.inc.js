/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* The prefs in this file are specific to the seamonkey (toolkit) browser.
 * Generic default prefs that would be useful to embedders belong in
 * modules/libpref/src/init/all.js
 */

/* filter substitution
 *
 * SYNTAX HINTS:
 *
 *  - Dashes are delimiters; use underscores instead.
 *  - The first character after a period must be alphabetic.
 *  - Computed values (e.g. 50 * 1024) don't work.
 */

// Extension preferences

// Show the Discover Pane
pref("extensions.getAddons.showPane", false);

// Enables some extra Extension System Logging (can reduce performance)
pref("extensions.logging.enabled", false);

// Disables strict compatibility, making addons compatible-by-default.
pref("extensions.strictCompatibility", true);

// Specifies a minimum maxVersion an addon needs to say it's compatible with
// for it to be compatible by default.
pref("extensions.minCompatibleAppVersion", "32.1.1");


// Update preferences for installed Extensions and Themes.
// Symmetric (can be overridden by individual extensions),
// e.g.
//  extensions.{GUID}.update.enabled
//  extensions.{GUID}.update.url
//  extensions.{GUID}.update.interval
//  extensions.{GUID}.update.autoUpdateDefault
//  .. etc ..
//
pref("extensions.update.enabled", false);
pref("extensions.update.url", "");
pref("extensions.update.interval", 86400);         // Check daily for updates to add-ons
pref("extensions.update.autoUpdateDefault", true); // Download and install automatically

// Disable add-ons installed into the shared user and shared system areas by
// default. This does not include the application directory. See the SCOPE
// constants in AddonManager.jsm for values to use here.
pref("extensions.autoDisableScopes", 15);

// Preferences for AMO integration
pref("extensions.getAddons.cache.enabled", false);  // also toggles personalized recommendations
pref("extensions.getAddons.maxResults", 15);
pref("extensions.getAddons.get.url", "");
pref("extensions.getAddons.getWithPerformance.url", "");
pref("extensions.getAddons.link.url", "");
pref("extensions.getAddons.recommended.url", "");
pref("extensions.getAddons.search.browseURL", "");
pref("extensions.getAddons.search.url", "");
pref("extensions.webservice.discoverURL", "");

// getMoreThemes is used by our UI under our switch theme menu
pref("extensions.getMoreThemesURL", "chrome://branding/locale/brand.properties");
pref("extensions.getPersonasURL", "chrome://branding/locale/brand.properties");
pref("extensions.dss.enabled", false);          // Dynamic Skin Switching
pref("extensions.dss.switchPending", false);    // Non-dynamic switch pending after next
                                                // restart.

pref("lightweightThemes.update.enabled", false);

pref("xpinstall.enabled", true);
pref("xpinstall.signatures.required", false);
