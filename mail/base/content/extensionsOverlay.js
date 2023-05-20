/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/AddonManager.jsm");
Components.utils.import("resource:///modules/StringBundle.js");
Components.utils.import("resource://gre/modules/BrowserUtils.jsm");

// NOTE: For some reason we can't use "this." when functions are fired from an observer
var extensionsOverlay = {
  init: function() {
    // Remove the observer that fired for when the Add-ons Manager is loaded
    Services.obs.removeObserver(extensionsOverlay.init, "EM-loaded");

    // Add XPInstall observers
    Services.obs.addObserver(extensionsOverlay.XPInstallObserver,
                             "addon-install-disabled", false);
    Services.obs.addObserver(extensionsOverlay.XPInstallObserver,
                             "addon-install-blocked", false);
    Services.obs.addObserver(extensionsOverlay.XPInstallObserver,
                             "addon-install-failed", false);
    Services.obs.addObserver(extensionsOverlay.XPInstallObserver,
                             "addon-install-complete", false);

    // We want to cleanup xpinstall observers when the Window/Tab is closed
    window.addEventListener("unload", extensionsOverlay.onunload, false);
  },
  XPInstallObserver: function (aSubject, aTopic, aData) {
    let brandBundle = document.getElementById("bundle_brand");
    let extensionsOverlayBundle = document.getElementById("bundle_extensionsOverlay");
    let installInfo = aSubject.QueryInterface(Components.interfaces.amIWebInstallInfo);
    let notificationID = aTopic;
    let brandShortName = brandBundle.getString("brandShortName");
    let notificationName, messageString, buttons;
    
    switch(aTopic) {
      // This case doesn't seem to apply for local installs
      case "addon-install-disabled":
        notificationID = "xpinstall-disabled";

        if (Services.prefs.prefIsLocked("xpinstall.enabled")) {
          messageString = extensionsOverlayBundle.getString("xpinstallDisabledMessageLocked");
          buttons = [];
        }
        else {
          messageString = extensionsOverlayBundle.getString("xpinstallDisabledMessage");

          buttons = [{
            label: extensionsOverlayBundle.getString("xpinstallDisabledButton"),
            accessKey: extensionsOverlayBundle.getString("xpinstallDisabledButton.accesskey"),
            popup: null,
            callback: function editPrefs() {
              Services.prefs.setBoolPref("xpinstall.enabled", true);
              return false;
            }
          }];
        }

        extensionsOverlay.notification(notificationID, messageString, "critical", buttons);
        break;
      case "addon-install-blocked":
        messageString =
          extensionsOverlayBundle.getFormattedString("xpinstallPromptWarning",
                                                    [brandShortName, installInfo.originatingURI.host]);

        buttons = [{
          label: extensionsOverlayBundle.getString("xpinstallPromptAllowButton"),
          accessKey: extensionsOverlayBundle.getString("xpinstallPromptAllowButton.accesskey"),
          popup: null,
          callback: function() {
            installInfo.install();
          }
        }];

        extensionsOverlay.notification(notificationID, messageString, "warning", buttons);
        break;
      case "addon-install-failed":
        // XXXThunderbird: This isn't terribly ideal for the multiple failure case
        for (let [, install] in Iterator(installInfo.installs)) {
          let host = (installInfo.originatingURI instanceof Components.interfaces.nsIStandardURL) && installInfo.originatingURI.host;

          if (!host) {
            host = (install.sourceURI instanceof Components.interfaces.nsIStandardURL) && install.sourceURI.host;
          }

          let error = (host || install.error == 0) ? "addonError" : "addonLocalError";

          if (host == "mozapps") {
            error = "addonLocalError";
          }

          if (install.error != 0) {
            error += install.error;
          }
          else if (install.addon.blocklistState == Components.interfaces.nsIBlocklistService.STATE_BLOCKED) {
            error = "addonErrorBlocklisted";
          }
          else {
            error = "addonErrorIncompatible";
          }

          messageString = extensionsOverlayBundle.getString(error);
          messageString = messageString.replace("#1", install.name);

          if (host) {
            messageString = messageString.replace("#2", host);
          }

          messageString = messageString.replace("#3", brandShortName);
          messageString = messageString.replace("#4", Services.appinfo.version);

          extensionsOverlay.notification(notificationID, messageString, "critical");
        }      
        break;
      case "addon-install-complete":
        let needsRestart = installInfo.installs.some(function(i) {
            return i.addon.pendingOperations != AddonManager.PENDING_NONE;
        });

        if (needsRestart) {
          messageString = extensionsOverlayBundle.getString("addonsInstalledNeedsRestart");
          buttons = [{
            label: extensionsOverlayBundle.getString("addonInstallRestartButton"),
            accessKey: extensionsOverlayBundle.getString("addonInstallRestartButton.accesskey"),
            popup: null,
            callback: function() {
              BrowserUtils.restartApplication();
            }
          }];
        }
        else {
          messageString = extensionsOverlayBundle.getString("addonsInstalled");
          buttons = [];
        }

        messageString = PluralForm.get(installInfo.installs.length, messageString);
        messageString = messageString.replace("#1", installInfo.installs[0].name);
        messageString = messageString.replace("#2", installInfo.installs.length);
        messageString = messageString.replace("#3", brandShortName);

        extensionsOverlay.notification(notificationID, messageString, null, buttons);
        break;
      default:
        extensionsOverlay.notification(notificationID, "Unhandled " + notificationID + " topic", "warning");
    }
  },
  notification: function(aID, aMessage, aSeverity = null, aButtons = null) {
    let notificationBox = document.getElementById("addons-notifications");

    let severity;
    switch (aSeverity) {
      case "warning":
        severity = notificationBox.PRIORITY_WARNING_MEDIUM;
        break;
      case "critical":
        severity = notificationBox.PRIORITY_CRITICAL_HIGH;
        break;
      default:
        severity = notificationBox.PRIORITY_INFO_MEDIUM;
    }

    if (notificationBox) {
      notificationBox.appendNotification(aMessage, aID, null, severity, aButtons);
    }
  },
  onunload: function() {
    // Clean up the unload event listener
    window.removeEventListener("unload", extensionsOverlay.onunload, false);
    
    // Clean up XPInstall observers
    Services.obs.removeObserver(extensionsOverlay.XPInstallObserver,
                                "addon-install-disabled");
    Services.obs.removeObserver(extensionsOverlay.XPInstallObserver,
                                "addon-install-blocked");
    Services.obs.removeObserver(extensionsOverlay.XPInstallObserver,
                                "addon-install-failed");
    Services.obs.removeObserver(extensionsOverlay.XPInstallObserver,
                                "addon-install-complete");
  }
};

// We don't want to init the extensionsOverlay code until the Add-ons Manager
// is fully loaded because xul elements are most likely non-existant at this 
// point so set an observer to fire the init code instead
Services.obs.addObserver(extensionsOverlay.init, "EM-loaded", false);
