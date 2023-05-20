/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var Ci = Components.interfaces;
var Cc = Components.classes;
var Cu = Components.utils;

Cu.import("resource://gre/modules/Communicator.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource:///modules/distribution.js");
Cu.import("resource:///modules/mailMigrator.js");

/**
 * Glue code that should be executed before any windows are opened. Any
 * window-independent helper methods (a la nsBrowserGlue.js) should go in
 * MailUtils.js instead.
 */

function MailGlue() {
  XPCOMUtils.defineLazyGetter(this, "_sanitizer",
    function() {
      let sanitizerScope = {};
      Services.scriptloader.loadSubScript("chrome://messenger/content/sanitize.js", sanitizerScope);
      return sanitizerScope.Sanitizer;
    });

  this._init();
}

MailGlue.prototype = {
  // init (called at app startup)
  _init: function MailGlue__init() {
    Services.obs.addObserver(this, "xpcom-shutdown", false);
    Services.obs.addObserver(this, "final-ui-startup", false);
    Services.obs.addObserver(this, "mail-startup-done", false);
    Services.obs.addObserver(this, "handle-xul-text-link", false);
    Services.obs.addObserver(this, "profile-after-change", false);
  },

  // cleanup (called at shutdown)
  _dispose: function MailGlue__dispose() {
    Services.obs.removeObserver(this, "xpcom-shutdown");
    Services.obs.removeObserver(this, "final-ui-startup");
    Services.obs.removeObserver(this, "mail-startup-done");
    Services.obs.removeObserver(this, "handle-xul-text-link");
    Services.obs.removeObserver(this, "profile-after-change");
  },

  // nsIObserver implementation
  observe: function MailGlue_observe(aSubject, aTopic, aData) {
    switch (aTopic) {
    case "xpcom-shutdown":
      this._dispose();
      break;
    case "final-ui-startup":
      this._onProfileStartup();
      break;
    case "mail-startup-done":
      this._onMailStartupDone();
      break;
    case "handle-xul-text-link":
      this._handleLink(aSubject, aData);
      break;
    case "profile-after-change":
      Communicator.showLicenseWindow();
      this._promptForMasterPassword();

      // Override Toolkit's nsITransfer implementation with the one from the
      // JavaScript API for downloads. This will eventually be removed when
      // we use Downloads.jsm - bug 907732, bug 1087233.
      Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar)
        .registerFactory(Components.ID("{b02be33b-d47c-4bd3-afd9-402a942426b0}"),
                         "", "@mozilla.org/transfer;1", null);
      break;
    }
  },

  //nsIMailGlue implementation
  sanitize: function MG_sanitize(aParentWindow) {
    this._sanitizer.sanitize(aParentWindow);
  },

  _promptForMasterPassword: function()
  {
    if (!Services.prefs.getBoolPref("signon.startup.prompt", true))
      return;

    // Try to avoid the multiple master password prompts on startup scenario
    // by prompting for the master password upfront.
    let token = Components.classes["@mozilla.org/security/pk11tokendb;1"]
                          .getService(Components.interfaces.nsIPK11TokenDB)
                          .getInternalKeyToken();

    // Only log in to the internal token if it is already initialized,
    // otherwise we get a "Change Master Password" dialog.
    try {
      if (!token.needsUserInit)
        token.login(false);
    } catch (ex) {
      // If user cancels an exception is expected.
    }
  },

  _onProfileStartup: function MailGlue__onProfileStartup() {
    TBDistCustomizer.applyPrefDefaults();

    // handle any migration work that has to happen at profile startup
    MailMigrator.migrateAtProfileStartup();

    // check if we're in safe mode
    if (Services.appinfo.inSafeMode) {
      Services.ww.openWindow(null, "chrome://messenger/content/safeMode.xul",
                             "_blank", "chrome,centerscreen,modal,resizable=no", null);
    }
  },

  _onMailStartupDone: function MailGlue__onMailStartupDone() {
    // On Windows 7 and above, initialize the jump list module.
    const WINTASKBAR_CONTRACTID = "@mozilla.org/windows-taskbar;1";
    if (WINTASKBAR_CONTRACTID in Cc &&
        Cc[WINTASKBAR_CONTRACTID].getService(Ci.nsIWinTaskbar).available) {
      Cu.import("resource:///modules/windowsJumpLists.js");
      WinTaskbarJumpList.startup();
    }

    // For any add-ons that were installed disabled and can be enabled, offer
    // them to the user.
    var win = Services.wm.getMostRecentWindow("mail:3pane");
    var tabmail = win.document.getElementById("tabmail");
    var changedIDs = AddonManager.getStartupChanges(AddonManager.STARTUP_CHANGE_INSTALLED);
    AddonManager.getAddonsByIDs(changedIDs, function (aAddons) {
      aAddons.forEach(function(aAddon) {
        // If the add-on isn't user disabled or can't be enabled then skip it.
        if (!aAddon.userDisabled || !(aAddon.permissions & AddonManager.PERM_CAN_ENABLE))
          return;

        tabmail.openTab("contentTab",
                        { contentPage: "about:newaddon?id=" + aAddon.id,
                          clickHandler: null });
      });
    });
  },

  _handleLink: function MailGlue__handleLink(aSubject, aData) {
    let linkHandled = aSubject.QueryInterface(Ci.nsISupportsPRBool);
    if (!linkHandled.data) {
      let win = Services.wm.getMostRecentWindow("mail:3pane");
      aData = JSON.parse(aData);
      let tabParams = { contentPage: aData.href, clickHandler: null };
      if (win) {
        let tabmail = win.document.getElementById("tabmail");
        if (tabmail) {
          tabmail.openTab("contentTab", tabParams);
          win.focus();
          linkHandled.data = true;
          return;
        }
      }

      // If we didn't have an open 3 pane window, try and open one.
      Services.ww.openWindow(null, "chrome://messenger/content/", "_blank",
                             "chrome,dialog=no,all",
                             { type: "contentTab",
                               tabParams: tabParams });
      linkHandled.data = true;
    }
  },

  // for XPCOM
  classID: Components.ID("{eb239c82-fac9-431e-98d7-11cacd0f71b8}"),
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
                                         Ci.nsIMailGlue]),
};

var components = [MailGlue];
var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
