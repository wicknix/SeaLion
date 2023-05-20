/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Load DownloadUtils module for convertByteUnits
Components.utils.import("resource://gre/modules/DownloadUtils.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

var gAdvancedPane = {
  mPane: null,
  mInitialized: false,
  mShellServiceWorking: false,

  _loadInContent: Services.prefs.getBoolPref("mail.preferences.inContent"),

  init: function ()
  {
    this.mPane = document.getElementById("paneAdvanced");
    this.updateCompactOptions();

    if (!(("arguments" in window) && window.arguments[1]))
    {
      // If no tab was specified, select the last used tab.
      let preference = document.getElementById("mail.preferences.advanced.selectedTabIndex");
      if (preference.value)
        document.getElementById("advancedPrefs").selectedIndex = preference.value;
    }
    if (AppConstants.MOZ_UPDATER)
      this.updateReadPrefs();

    // Default store type initialization.
    let storeTypeElement = document.getElementById("storeTypeMenulist");
    // set the menuitem to match the account
    let defaultStoreID = Services.prefs.getCharPref("mail.serverDefaultStoreContractID");
    let targetItem = storeTypeElement.getElementsByAttribute("value", defaultStoreID);
    storeTypeElement.selectedItem = targetItem[0];

    if (AppConstants.MOZ_CRASHREPORTER)
      this.initSubmitCrashes();
    this.updateActualCacheSize();

    // If the shell service is not working, disable the "Check now" button
    // and "perform check at startup" checkbox.
    try {
      let shellSvc = Components.classes["@mozilla.org/mail/shell-service;1"]
                               .getService(Components.interfaces.nsIShellService);
      this.mShellServiceWorking = true;
    } catch (ex) {
      // The elements may not exist if HAVE_SHELL_SERVICE is off.
      if (document.getElementById("alwaysCheckDefault")) {
        document.getElementById("alwaysCheckDefault").disabled = true;
        document.getElementById("alwaysCheckDefault").checked = false;
      }
      if (document.getElementById("checkDefaultButton"))
        document.getElementById("checkDefaultButton").disabled = true;
      this.mShellServiceWorking = false;
    }

    if (this._loadInContent) {
      gSubDialog.init();
    }

    this.mInitialized = true;
  },

  tabSelectionChanged: function ()
  {
    if (this.mInitialized)
    {
      document.getElementById("mail.preferences.advanced.selectedTabIndex")
              .valueFromPreferences = document.getElementById("advancedPrefs").selectedIndex;
    }
  },

  /**
   * Checks whether Thunderbird is currently registered with the operating
   * system as the default app for mail, rss and news.  If Thunderbird is not
   * currently the default app, the user is given the option of making it the
   * default for each type; otherwise, the user is informed that Thunderbird is
   * already the default.
   */
  checkDefaultNow: function (aAppType)
  {
    if (!this.mShellServiceWorking)
      return;

    // otherwise, bring up the default client dialog
    if (this._loadInContent) {
      gSubDialog.open("chrome://messenger/content/systemIntegrationDialog.xul",
                      "resizable=no", "calledFromPrefs");
    } else {
      window.openDialog("chrome://messenger/content/systemIntegrationDialog.xul",
                        "SystemIntegration",
                        "modal,centerscreen,chrome,resizable=no", "calledFromPrefs");
    }
  },

  showConfigEdit: function()
  {
    if (this._loadInContent) {
      gSubDialog.open("chrome://global/content/config.xul");
    } else {
      document.documentElement.openWindow("Preferences:ConfigManager",
                                          "chrome://global/content/config.xul",
                                          "", null);
    }
  },

  /**
   * Set the default store contract ID.
   */
  updateDefaultStore: function(storeID)
  {
    Services.prefs.setCharPref("mail.serverDefaultStoreContractID", storeID);
  },

  // NETWORK TAB

  /*
   * Preferences:
   *
   * browser.cache.disk.capacity
   * - the size of the browser cache in KB
   */

  // Retrieves the amount of space currently used by disk cache
  updateActualCacheSize: function()
  {
    let actualSizeLabel = document.getElementById("actualDiskCacheSize");
    let prefStrBundle = document.getElementById("bundlePreferences");

    // Needs to root the observer since cache service keeps only a weak reference.
    this.observer = {
      onNetworkCacheDiskConsumption: function(consumption) {
        let size = DownloadUtils.convertByteUnits(consumption);
        // The XBL binding for the string bundle may have been destroyed if
        // the page was closed before this callback was executed.
        if (!prefStrBundle.getFormattedString) {
          return;
        }
        actualSizeLabel.value = prefStrBundle.getFormattedString("actualDiskCacheSize", size);
      },

      QueryInterface: XPCOMUtils.generateQI([
        Components.interfaces.nsICacheStorageConsumptionObserver,
        Components.interfaces.nsISupportsWeakReference
      ])
    };

    actualSizeLabel.value = prefStrBundle.getString("actualDiskCacheSizeCalculated");

    try {
      let cacheService =
        Components.classes["@mozilla.org/netwerk/cache-storage-service;1"]
                  .getService(Components.interfaces.nsICacheStorageService);
      cacheService.asyncGetDiskConsumption(this.observer);
    } catch (e) {}
  },

  /**
   * Converts the cache size from units of KB to units of MB and returns that
   * value.
   */
  readCacheSize: function ()
  {
    var preference = document.getElementById("browser.cache.disk.capacity");
    return preference.value / 1024;
  },

  /**
   * Converts the cache size as specified in UI (in MB) to KB and returns that
   * value.
   */
  writeCacheSize: function ()
  {
    var cacheSize = document.getElementById("cacheSize");
    var intValue = parseInt(cacheSize.value, 10);
    return isNaN(intValue) ? 0 : intValue * 1024;
  },

  /**
   * Clears the cache.
   */
  clearCache: function ()
  {
    try {
      let cache = Components.classes["@mozilla.org/netwerk/cache-storage-service;1"]
                            .getService(Components.interfaces.nsICacheStorageService);
      cache.clear();
    } catch (ex) {}
    this.updateActualCacheSize();
  },

  updateButtons: function (aButtonID, aPreferenceID)
  {
    var button = document.getElementById(aButtonID);
    var preference = document.getElementById(aPreferenceID);
    // This is actually before the value changes, so the value is not as you expect.
    button.disabled = preference.value == true;
    return undefined;
  },

/**
 * Selects the item of the radiogroup based on the pref values and locked
 * states.
 *
 * UI state matrix for update preference conditions
 *
 * UI Components:                              Preferences
 * Radiogroup                                  i   = app.update.enabled
 *                                             ii  = app.update.auto
 *
 * Disabled states:
 * Element           pref  value  locked  disabled
 * radiogroup        i     t/f    f       false
 *                   i     t/f    *t*     *true*
 *                   ii    t/f    f       false
 *                   ii    t/f    *t*     *true*
 */
updateReadPrefs: function ()
{
  var enabledPref = document.getElementById("app.update.enabled");
  var autoPref = document.getElementById("app.update.auto");
  var radiogroup = document.getElementById("updateRadioGroup");

  if (!enabledPref.value)   // Don't care for autoPref.value in this case.
    radiogroup.value="manual"     // 3. Never check for updates.
  else if (autoPref.value)  // enabledPref.value && autoPref.value
    radiogroup.value="auto";      // 1. Automatically install updates
  else                      // enabledPref.value && !autoPref.value
    radiogroup.value="checkOnly"; // 2. Check, but let me choose

  var canCheck = Components.classes["@mozilla.org/updates/update-service;1"].
                   getService(Components.interfaces.nsIApplicationUpdateService).
                   canCheckForUpdates;

  // canCheck is false if the enabledPref is false and locked,
  // or the binary platform or OS version is not known.
  // A locked pref is sufficient to disable the radiogroup.
  radiogroup.disabled = !canCheck || enabledPref.locked || autoPref.locked;
},

/**
 * Sets the pref values based on the selected item of the radiogroup.
 */
updateWritePrefs: function ()
{
  var enabledPref = document.getElementById("app.update.enabled");
  var autoPref = document.getElementById("app.update.auto");
  var radiogroup = document.getElementById("updateRadioGroup");
  switch (radiogroup.value) {
    case "auto":      // 1. Automatically install updates
      enabledPref.value = true;
      autoPref.value = true;
      break;
    case "checkOnly": // 2. Check, but but let me choose
      enabledPref.value = true;
      autoPref.value = false;
      break;
    case "manual":    // 3. Never check for updates.
      enabledPref.value = false;
      autoPref.value = false;
  }
},

  showUpdates: function ()
  {
    var prompter = Components.classes["@mozilla.org/updates/update-prompt;1"]
                             .createInstance(Components.interfaces.nsIUpdatePrompt);
    prompter.showUpdateHistory(window);
  },

  updateCompactOptions: function(aCompactEnabled)
  {
    document.getElementById("offlineCompactFolderMin").disabled =
      !document.getElementById("offlineCompactFolder").checked ||
      document.getElementById("mail.purge_threshhold_mb").locked;
  },

  updateSubmitCrashReports: function(aChecked)
  {
    Components.classes["@mozilla.org/toolkit/crash-reporter;1"]
              .getService(Components.interfaces.nsICrashReporter)
              .submitReports = aChecked;
  },
  /**
   * Display the return receipts configuration dialog.
   */
  showReturnReceipts: function()
  {
    if (this._loadInContent) {
      gSubDialog.open("chrome://messenger/content/preferences/receipts.xul",
                      "resizable=no");
    } else {
      document.documentElement
              .openSubDialog("chrome://messenger/content/preferences/receipts.xul",
                             "", null);
    }
  },

  /**
   * Display the the connection settings dialog.
   */
  showConnections: function ()
  {
    if (this._loadInContent) {
      gSubDialog.open("chrome://messenger/content/preferences/connection.xul",
                      "resizable=no");
    } else {
      document.documentElement
              .openSubDialog("chrome://messenger/content/preferences/connection.xul",
                             "", null);
    }
  },

  /**
   * Display the the offline settings dialog.
   */
  showOffline: function()
  {
    if (this._loadInContent) {
      gSubDialog.open("chrome://messenger/content/preferences/offline.xul",
                      "resizable=no");
    } else {
      document.documentElement
              .openSubDialog("chrome://messenger/content/preferences/offline.xul",
                             "", null);
    }
  },

  /**
   * Display the user's certificates and associated options.
   */
  showCertificates: function ()
  {
    if (this._loadInContent) {
      gSubDialog.open("chrome://pippki/content/certManager.xul");
    } else {
      document.documentElement.openWindow("mozilla:certmanager",
                                          "chrome://pippki/content/certManager.xul",
                                          "", null);
    }
  },

  /**
   * security.OCSP.enabled is an integer value for legacy reasons.
   * A value of 1 means OCSP is enabled. Any other value means it is disabled.
   */
  readEnableOCSP: function ()
  {
    var preference = document.getElementById("security.OCSP.enabled");
    // This is the case if the preference is the default value.
    if (preference.value === undefined) {
      return true;
    }
    return preference.value == 1;
  },

  /**
   * See documentation for readEnableOCSP.
   */
  writeEnableOCSP: function ()
  {
    var checkbox = document.getElementById("enableOCSP");
    return checkbox.checked ? 1 : 0;
  },

  /**
   * Display a dialog from which the user can manage his security devices.
   */
  showSecurityDevices: function ()
  {
    if (this._loadInContent) {
      gSubDialog.open("chrome://pippki/content/device_manager.xul");
    } else {
      document.documentElement.openWindow("mozilla:devicemanager",
                                          "chrome://pippki/content/device_manager.xul",
                                          "", null);
    }
  },

#ifdef XP_WIN
  /**
   * When the user toggles the layers.acceleration.enabled pref,
   * sync its new value to the gfx.direct2d.disabled pref too.
   */
  updateHardwareAcceleration: function(aVal)
  {
    Services.prefs.setBoolPref("gfx.direct2d.disabled", !aVal);
  },
#endif

  // DATA CHOICES TAB

  /**
   * Open a text link.
   */
  openTextLink: function (evt) {
    // Opening links behind a modal dialog is poor form. Work around flawed
    // text-link handling by opening in browser if we'd instead get a content
    // tab behind the modal options dialog.
    if (Services.prefs.getBoolPref("browser.preferences.instantApply")) {
      return true; // Yes, open the link in a content tab.
    }
    var url = evt.target.getAttribute("href");
    var messenger = Components.classes["@mozilla.org/messenger;1"]
      .createInstance(Components.interfaces.nsIMessenger);
    messenger.launchExternalURL(url);
    evt.preventDefault();
    return false;
  },

  /**
   * Set up or hide the Learn More links for various data collection options
   */
  _setupLearnMoreLink: function (pref, element) {
    // set up the Learn More link with the correct URL
    let url = Services.prefs.getCharPref(pref);
    let el = document.getElementById(element);

    if (url) {
      el.setAttribute("href", url);
    } else {
      el.setAttribute("hidden", "true");
    }
  },

  initSubmitCrashes: function ()
  {
    var checkbox = document.getElementById("submitCrashesBox");
    try {
      var cr = Components.classes["@mozilla.org/toolkit/crash-reporter;1"].
               getService(Components.interfaces.nsICrashReporter);
      checkbox.checked = cr.submitReports;
    } catch (e) {
      checkbox.style.display = "none";
    }
    this._setupLearnMoreLink("toolkit.crashreporter.infoURL", "crashReporterLearnMore");
  },

  updateSubmitCrashes: function ()
  {
    var checkbox = document.getElementById("submitCrashesBox");
    try {
      var cr = Components.classes["@mozilla.org/toolkit/crash-reporter;1"].
               getService(Components.interfaces.nsICrashReporter);
      cr.submitReports = checkbox.checked;
    } catch (e) { }
  },
};
