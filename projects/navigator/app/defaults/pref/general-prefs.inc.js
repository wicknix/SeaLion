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

#ifdef MOZ_DEVTOOLS
// Most DevTools prefs are set from the shared file
// devtools/client/preferences/devtools.js, but this one is currently set
// per-app or per-channel.
// Number of usages of the web console or scratchpad. If this is less than 5,
// then pasting code into the web console or scratchpad is disabled
pref("devtools.selfxss.count", 5);
#endif

#ifdef MOZ_OFFICIAL_BRANDING
pref("general.skins.selectedSkin", "modern/1.0");
#else
pref("general.skins.selectedSkin", "modern/1.0");
#endif

pref("general.startup.browser",             true);
pref("general.startup.mail",                false);
pref("general.startup.news",                false);
pref("general.startup.editor",              false);
pref("general.startup.compose",             false);
pref("general.startup.addressbook",         false);

pref("general.open_location.last_url",      "");
pref("general.open_location.last_window_choice", 0);

pref("general.smoothScroll", false);
pref("general.autoScroll", true);

pref("general.useragent.compatMode.firefox", false);
pref("general.useragent.compatMode.gecko", false);
pref("general.useragent.complexOverride.moodle", false); // bug 797703; bug 815801
// pref("general.useragent.override", "SpiderWeb/2.2.5 (Macintosh; Intel Mac OS X; Mobile; rv:60.0) Gecko/60");

#ifdef XP_UNIX
pref("general.autoScroll", false);
#endif
