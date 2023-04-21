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

// prompt for Master Password on startup
pref("signon.startup.prompt",               true);

pref("javascript.options.showInConsole",    true);

pref("offline.startup_state",            0);
pref("offline.send.unsent_messages",            0);
pref("offline.download.download_messages",  0);

// allow offline web apps to store data but ask for permission by default
pref("offline-apps.allow_by_default", false);
pref("browser.offline-apps.notify", true);

// Built-in default permissions.
pref("permissions.manager.defaultsUrl", "resource:///defaults/permissions");

pref("privacy.popups.sound_enabled",              false);
pref("privacy.popups.sound_type",                 1);
pref("privacy.popups.sound_url",                  "");
pref("privacy.popups.statusbar_icon_enabled",     true);
pref("privacy.popups.prefill_whitelist",          false);
pref("privacy.popups.remove_blacklist",           true);
pref("privacy.popups.showBrowserMessage",         true);

// sanitize (clear private data) options
pref("privacy.item.history",     true);
pref("privacy.item.urlbar",      true);
pref("privacy.item.formdata",    true);
pref("privacy.item.passwords",   false);
pref("privacy.item.downloads",   true);
pref("privacy.item.cookies",     false);
pref("privacy.item.cache",       true);
pref("privacy.item.sessions",    true);
pref("privacy.item.offlineApps", false);

pref("privacy.sanitize.sanitizeOnShutdown", false);
pref("privacy.sanitize.promptOnSanitize", true);

pref("privacy.warn_tracking_content", true);



// Name of alternate about: page for certificate errors (when undefined, defaults to about:neterror)
pref("security.alternate_certificate_error_page", "certerror");
pref("security.warn_entering_secure", false);
pref("security.warn_leaving_secure", false);
pref("security.warn_submit_insecure", false);
pref("security.warn_viewing_mixed", false);
pref("security.warn_mixed_active_content", true);
pref("security.warn_mixed_display_content", true);
// Block insecure active content on https pages
pref("security.mixed_content.block_active_content", true);
// Turn on the CSP 1.0 parser for Content Security Policy headers
pref("security.csp.speccompliant", true);

// Some of these prefs are specified even though they may be redundant; they are given
// here for clarity and end-user experiments with platform-provided geolocation.
#ifdef XP_WIN
pref("geo.provider.ms-windows-location", false);
#else
pref("geo.provider.use_gpsd", false);
#endif

pref("geo.wifi.uri", "https://www.googleapis.com/geolocation/v1/geolocate?key=%GOOGLE_API_KEY%");

