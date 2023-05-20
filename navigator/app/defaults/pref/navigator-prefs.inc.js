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

pref("browser.chromeURL","chrome://navigator/content/navigator.xul");
pref("browser.hiddenWindowChromeURL", "chrome://navigator/content/hiddenWindow.xul");

pref("browser.urlbar.historyEnabled",       true);

// 0 = blank, 1 = home (browser.startup.homepage), 2 = last visited page, 3 = resume previous browser session
pref("browser.startup.page",                1);
pref("browser.startup.homepage",	   "chrome://branding/locale/brand.properties");
pref("browser.startup.homepage.count", 1);

pref("browser.warnOnQuit", true);
pref("browser.warnOnRestart", true);

// disable this until it can be disabled on a per-docshell basis (see bug 319368)
pref("browser.send_pings", false);

pref("browser.chrome.site_icons", true);
pref("browser.chrome.favicons", true);

// Output console.log/info/warn/error to the Error Console
pref("browser.dom.window.console.enabled", false);

// Use the findbar instead of the dialog box
pref("browser.findbar.enabled", true);

// search engines URL
pref("browser.search.searchEnginesURL", "about:blank");

// pointer to the default engine name
pref("browser.search.defaultenginename", "chrome://communicator-region/locale/region.properties");

// Disable logging for the search service by default.
pref("browser.search.log", false);

// Ordering of Search Engines in the Engine list.
pref("browser.search.order.1", "chrome://communicator-region/locale/region.properties");
pref("browser.search.order.2", "chrome://communicator-region/locale/region.properties");
pref("browser.search.order.3", "chrome://communicator-region/locale/region.properties");
pref("browser.search.order.4", "chrome://communicator-region/locale/region.properties");
pref("browser.search.order.4", "chrome://communicator-region/locale/region.properties");

// Search (side)bar results always open in a new tab.
pref("browser.search.openintab", true);

// Open context search results in either a new window or tab.
pref("browser.search.opentabforcontextsearch", true);

// Send ping to the server to update.
pref("browser.search.update", true);

// Disable logging for the search service update system by default.
pref("browser.search.update.log", false);

// Check whether we need to perform engine updates every 6 hours
pref("browser.search.update.interval", 21600);

// enable search suggestions by default
pref("browser.search.suggest.enabled", true);

pref("browser.urlbar.autocomplete.enabled", true);
pref("browser.urlbar.formatting.enabled", true);
pref("browser.urlbar.highlight.secure", true);
pref("browser.urlbar.clickSelectsAll", true);
// when clickSelectsAll=true, does it also apply when the click is past end of text?
pref("browser.urlbar.clickAtEndSelects", true);

pref("browser.urlbar.autoFill", false);
pref("browser.urlbar.showPopup", true);
pref("browser.urlbar.showSearch", true);
// 0: Match anywhere (e.g., middle of words)
// 1: Match on word boundaries and then try matching anywhere
// 2: Match only on word boundaries (e.g., after / or .)
// 3: Match at the beginning of the url or title
pref("browser.urlbar.matchBehavior", 1);

pref("browser.urlbar.suggest.history", true);
pref("browser.urlbar.suggest.bookmark", false);
// SeaMonkey doesn't support this.
pref("browser.urlbar.suggest.openpage", false);

pref("browser.urlbar.suggest.history.onlyTyped", false);

pref("browser.urlbar.filter.javascript", true);

// Size of "chunks" affects the number of places to process between each search
// timeout (ms). Too big and the UI will be unresponsive; too small and we'll
// be waiting on the timeout too often without many results.
pref("browser.urlbar.search.chunkSize", 1000);
pref("browser.urlbar.search.timeout", 100);

// The special characters below can be typed into the urlbar to either restrict
// the search to visited history, bookmarked, tagged pages; or force a match on
// just the title text or url.
pref("browser.urlbar.restrict.history", "^");
pref("browser.urlbar.restrict.bookmark", "*");
pref("browser.urlbar.restrict.tag", "+");
pref("browser.urlbar.restrict.openpage", "%");
pref("browser.urlbar.restrict.typed", "~");
pref("browser.urlbar.match.title", "#");
pref("browser.urlbar.match.url", "@");

pref("browser.history.last_page_visited", "about:blank");
pref("browser.history.grouping", "day");
pref("browser.sessionhistory.max_entries", 50);

// By default, do not export HTML at shutdown.
// If true, at shutdown the bookmarks in your menu and toolbar will
// be exported as HTML to the bookmarks.html file.
pref("browser.bookmarks.autoExportHTML", false);

// The maximum number of daily bookmark backups to
// keep in {PROFILEDIR}/bookmarkbackups. Special values:
// -1: unlimited
//  0: no backups created (and deletes all existing backups)
pref("browser.bookmarks.max_backups", 10);

// Don't try to alter this pref. It will be reset the next time you use the
// bookmarking dialog.
pref("browser.bookmarks.editDialog.firstEditField", "namePicker");

// Tabbed browser
pref("browser.tabs.loadDivertedInBackground", false);
pref("browser.tabs.loadInBackground", true);
pref("browser.tabs.opentabfor.doubleclick", false);
pref("browser.tabs.opentabfor.middleclick", true);
pref("browser.tabs.opentabfor.urlbar", true);
pref("browser.tabs.tooltippreview.enable", true);
pref("browser.tabs.tooltippreview.width", 300);
pref("browser.tabs.autoHide", false);
pref("browser.tabs.forceHide", false);
pref("browser.tabs.closeWindowWithLastTab", true);
pref("browser.tabs.warnOnClose", true);
pref("browser.tabs.warnOnCloseOther", true);
pref("browser.tabs.warnOnOpen", true);
pref("browser.tabs.maxOpenBeforeWarn", 15);
pref("browser.tabs.insertRelatedAfterCurrent", true);
// 0 = append, 1 = replace
pref("browser.tabs.loadGroup", 1);

// how many browsers can be saved in the DOM (by the tabbed browser)
pref("browser.tabs.max_tabs_undo", 3);
// should popups by saved in the DOM (by the tabbed browser)
pref("browser.tabs.cache_popups", false);

// tab width and clipping
pref("browser.tabs.tabMinWidth", 100);
pref("browser.tabs.tabMaxWidth", 250);
pref("browser.tabs.tabClipWidth", 140);

// Where to show tab close buttons:
// 0  on active tab only
// 1  on all tabs until tabClipWidth is reached, then active tab only
// 2  no close buttons at all
// 3  at the end of the tabstrip
pref("browser.tabs.closeButtons", 3);

// Mouse wheel action when over the tab bar:
// false  The mouse wheel scrolls the whole tab bar like Firefox (default).
// true   The mouse wheel advances the selected tab.
pref("browser.tabs.mouseScrollAdvancesTab", false);

// Whether to fade tab labels instead of using ellipses when cutting off
// long page titles.
pref("browser.tabs.fadeLabels", true);

// lets new tab/window load something different than first window
// -1 - use navigator startup preference
//  0 - loads blank page
//  1 - loads home page
//  2 - loads last page visited
pref("browser.tabs.loadOnNewTab", 0);
pref("browser.windows.loadOnNewWindow", 1);

// external link handling in tabbed browsers. values from nsIBrowserDOMWindow.
// 0=default window, 1=current window/tab, 2=new window, 3=new tab in most recent window
pref("browser.link.open_external", 3);
// internal links handling in tabbed browsers. see .open_external for values.
pref("browser.link.open_newwindow", 3);

// 0: no restrictions - divert everything
// 1: don't divert window.open at all
// 2: don't divert window.open with features
pref("browser.link.open_newwindow.restriction", 2);

// Translation service
pref("browser.translation.service", "chrome://navigator-region/locale/region.properties");
pref("browser.translation.serviceDomain", "chrome://navigator-region/locale/region.properties");
pref("browser.validate.html.service", "chrome://navigator-region/locale/region.properties");

// 0 goes back
// 1 act like pgup
// 2 and other values, nothing
pref("browser.backspace_action", 0);

// Controls behavior of the "Add Exception" dialog launched from SSL error pages:
// 0 - don't pre-populate anything.
// 1 - pre-populate site URL, but don't fetch certificate.
// 2 - pre-populate site URL and pre-fetch certificate.
pref("browser.ssl_override_behavior", 2);

// Keep the stop button always active
// The stop button WILL remain initally disabled until SOME navigation event
// has occured since it lives in onStateChange.
pref("browser.stopButton.alwaysEnabled", false);

// if true, use full page zoom instead of text zoom
pref("browser.zoom.full", true);

// Whether or not to save and restore zoom levels on a per-site basis.
pref("browser.zoom.siteSpecific", true);

// Whether or not to update background tabs to the current zoom level
// once they come to the foreground (i.e. get activated).
pref("browser.zoom.updateBackgroundTabs", true);

#ifdef XP_WIN
pref("browser.preferences.instantApply", false);
#else
pref("browser.preferences.instantApply", true);
#endif

pref("browser.preferences.animateFadeIn", false);

// initial web feed readers list - add enough entries for locales to add theirs
pref("browser.contentHandlers.types.0.title", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.0.uri", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.0.type", "application/vnd.mozilla.maybe.feed");
pref("browser.contentHandlers.types.1.title", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.1.uri", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.1.type", "application/vnd.mozilla.maybe.feed");
pref("browser.contentHandlers.types.2.title", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.2.uri", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.2.type", "application/vnd.mozilla.maybe.feed");
pref("browser.contentHandlers.types.3.title", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.3.uri", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.3.type", "application/vnd.mozilla.maybe.feed");
pref("browser.contentHandlers.types.4.title", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.4.uri", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.4.type", "application/vnd.mozilla.maybe.feed");
pref("browser.contentHandlers.types.5.title", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.5.uri", "chrome://navigator-region/locale/region.properties");
pref("browser.contentHandlers.types.5.type", "application/vnd.mozilla.maybe.feed");

pref("browser.feeds.handler", "ask");
pref("browser.videoFeeds.handler", "ask");
pref("browser.audioFeeds.handler", "ask");

// Overriding defaults defined in all.js (no UI yet covering these cases)
pref("browser.safebrowsing.downloads.remote.block_potentially_unwanted", false);
pref("browser.safebrowsing.downloads.remote.block_uncommon", false);

// Overriding defaults defined in all.js (use full version 2.x, bypassing bug 1077874)
pref("browser.safebrowsing.provider.google.updateURL", "https://safebrowsing.google.com/safebrowsing/downloads?client=SAFEBROWSING_ID&appver=%VERSION%&pver=2.2&key=%GOOGLE_API_KEY%");
pref("browser.safebrowsing.provider.google.gethashURL", "https://safebrowsing.google.com/safebrowsing/gethash?client=SAFEBROWSING_ID&appver=%VERSION%&pver=2.2");
pref("browser.safebrowsing.provider.mozilla.updateURL", "https://shavar.services.mozilla.com/downloads?client=SAFEBROWSING_ID&appver=%VERSION%&pver=2.2");
pref("browser.safebrowsing.provider.mozilla.gethashURL", "https://shavar.services.mozilla.com/gethash?client=SAFEBROWSING_ID&appver=%VERSION%&pver=2.2");

//Theoretically the "client ID" sent in updates should be appinfo.name but
//anything except "Firefox" or "navclient-auto-ffox" will cause safebrowsing
//updates to fail. So we pretend to be Firefox here.
pref("browser.safebrowsing.id", "navclient-auto-ffox");

// Those are only used in our utilityOverlay.js (see bug 1270168)
pref("browser.safebrowsing.warning.infoURL", "https://www.mozilla.org/%LOCALE%/firefox/phishing-protection/");
pref("browser.safebrowsing.controlledAccess.infoURL", "https://support.mozilla.org/kb/controlledaccess/");

pref("browser.sessionstore.resume_from_crash", true);
pref("browser.sessionstore.resume_session_once", false);

// minimal interval between two save operations in milliseconds
pref("browser.sessionstore.interval", 15000);

// maximum amount of POSTDATA to be saved in bytes per history entry (-1 = all of it)
// (NB: POSTDATA will be saved either entirely or not at all)
pref("browser.sessionstore.postdata", 0);

// on which sites to save text data, POSTDATA and cookies
// 0 = everywhere, 1 = unencrypted sites, 2 = nowhere
pref("browser.sessionstore.privacy_level", 0);

// the same as browser.sessionstore.privacy_level, but for saving deferred session data
pref("browser.sessionstore.privacy_level_deferred", 2);

// number of crashes that can occur before the about:sessionrestore page is displayed
// (this pref has no effect if more than 6 hours have passed since the last crash)
pref("browser.sessionstore.max_resumed_crashes", 1);

// how many tabs can be reopened (per window)
pref("browser.sessionstore.max_tabs_undo", 10);

// how many windows can be reopened (per session) - on non-OS X platforms this
// pref may be ignored when dealing with pop-up windows to ensure proper startup
pref("browser.sessionstore.max_windows_undo", 3);

// The number of tabs that can restore concurrently:
// < 0 = All tabs can restore at the same time
//   0 = Only the selected tab in each window will load.
//   N = N tabs should restore at the same time
pref("browser.sessionstore.max_concurrent_tabs", 3);

#ifdef XP_WIN
pref("browser.taskbar.lists.enabled", false);
pref("browser.taskbar.lists.frequent.enabled", false);
pref("browser.taskbar.lists.recent.enabled", false);
pref("browser.taskbar.lists.maxListItemCount", 7);
pref("browser.taskbar.lists.tasks.enabled", false);
pref("browser.taskbar.lists.refreshInSeconds", 120);
pref("browser.taskbar.previews.enable", false);
pref("browser.taskbar.previews.max", 20);
pref("browser.taskbar.previews.cachetime", 5);
#endif

pref("browser.throbber.url","chrome://branding/locale/brand.properties");

// Show XUL error pages instead of alerts for errors
pref("browser.xul.error_pages.enabled", true);
pref("browser.xul.error_pages.expert_bad_cert", false);

#ifdef XP_UNIX
// Mouse wheel action when over the tab bar:
// false  The mouse wheel scrolls the whole tab bar like Firefox.
// true   The mouse wheel advances the selected tab.
pref("browser.tabs.mouseScrollAdvancesTab", true);

pref("browser.urlbar.clickSelectsAll", false);

// 0 goes back
// 1 act like pgup
// 2 and other values, nothing
pref("browser.backspace_action", 2);
#endif

// FAQ URLs
pref("browser.geolocation.warning.infoURL", "about:blank");

pref("browser.rights.version", 1);
pref("browser.rights.1.shown", true);

pref("browser.rights.override", true);

pref("browser.formfill.expire_days", 180);

pref("suite.manager.addons.openAsDialog", false);

// Customizable toolbar stuff
pref("custtoolbar.personal_toolbar_folder", "");
// Use a popup window for the customize toolbar UI
pref("toolbar.customization.usesheet", false);

pref("sidebar.customize.all_panels.url", "chrome://communicator/content/sidebar/all-panels.rdf");
pref("sidebar.customize.directory.url", "https://edmullen.net/mozilla/moz_sidebar.php");
pref("sidebar.customize.more_panels.url", "https://edmullen.net/mozilla/moz_sidebar.php");
pref("sidebar.num_tabs_in_view", 8);

// pref to control the alert notification
pref("alerts.slideIncrement", 1);
pref("alerts.slideIncrementTime", 10);
pref("alerts.totalOpenTime", 10000);

// Smart Browsing prefs
pref("keyword.enabled", true);
// Override the default keyword.URL. Empty value means
// "use the search service's default engine"
pref("keyword.URL", "");

// Blocks auto refresh if true
pref("accessibility.blockautorefresh", false);

// special TypeAheadFind settings
// Use the findbar for type ahead find, instead of the XPFE implementation
pref("accessibility.typeaheadfind.usefindbar", true);
pref("accessibility.typeaheadfind.flashBar", 0);
#ifndef XP_UNIX
pref("accessibility.typeaheadfind.soundURL", "default");
#endif

// Setting this pref to |true| forces BiDi UI menu items and keyboard shortcuts
// to be exposed. By default, only expose it for bidi-associated system locales.
pref("bidi.browser.ui", false);

// Zoom levels for View > Zoom and Ctrl +/- keyboard shortcuts
pref("toolkit.zoomManager.zoomValues", "0.2,0.3,0.5,0.67,0.8,0.9,1,1.1,1.2,1.33,1.5,1.7,2,2.4,3,4,5,6,7,8");

