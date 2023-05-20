/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* A note to the curious: a large portion of this code was copied over from
 * mozilla/browser/base/content/browser.js
 */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/AppConstants.jsm");

if (AppConstants.MOZ_CRASHREPORTER) {
  XPCOMUtils.defineLazyServiceGetter(this, "gCrashReporter",
                                     "@mozilla.org/xre/app-info;1",
                                     "nsICrashReporter");
}

function getPluginInfo(pluginElement)
{
  var tagMimetype;
  var pluginsPage;
  if (pluginElement instanceof HTMLAppletElement) {
    tagMimetype = "application/x-java-vm";
  } else {
    if (pluginElement instanceof HTMLObjectElement) {
      pluginsPage = pluginElement.getAttribute("codebase");
    } else {
      pluginsPage = pluginElement.getAttribute("pluginspage");
    }

    // only attempt if a pluginsPage is defined.
    if (pluginsPage) {
      var doc = pluginElement.ownerDocument;
      var docShell = findChildShell(doc, gBrowser.docShell, null);
      try {
        pluginsPage = makeURI(pluginsPage, doc.characterSet, docShell.currentURI).spec;
      } catch (ex) {
        pluginsPage = "";
      }
    }

    tagMimetype = pluginElement.QueryInterface(Components.interfaces.nsIObjectLoadingContent)
                 .actualType;

    if (tagMimetype == "") {
      tagMimetype = pluginElement.type;
    }
  }

  return {mimetype: tagMimetype, pluginsPage: pluginsPage};
}

/**
 * Format a URL
 * eg:
 * echo formatURL("https://addons.mozilla.org/%LOCALE%/%APP%/%VERSION%/");
 * > https://addons.mozilla.org/en-US/firefox/3.0a1/
 *
 * Currently supported built-ins are LOCALE, APP, and any value from nsIXULAppInfo, uppercased.
 */
function formatURL(aFormat, aIsPref) {
  var formatter = Services.urlFormatter;
  return aIsPref ? formatter.formatURLPref(aFormat) : formatter.formatURL(aFormat);
}

var gPluginHandler = {
  addEventListeners: function ph_addEventListeners(browser) {
    // Note that the XBL binding is untrusted
    browser.addEventListener("PluginBindingAttached", gPluginHandler, true, true);
    browser.addEventListener("PluginCrashed",         gPluginHandler, true);
    browser.addEventListener("PluginOutdated",        gPluginHandler, true);
    browser.addEventListener("NewPluginInstalled",    gPluginHandler, true);
  },

  removeEventListeners: function ph_removeEventListeners(browser) {
    browser.removeEventListener("PluginBindingAttached", gPluginHandler);
    browser.removeEventListener("PluginCrashed", gPluginHandler);
    browser.removeEventListener("PluginOutdated", gPluginHandler);
    browser.removeEventListener("NewPluginInstalled", gPluginHandler);
  },

  getPluginUI: function (plugin, anonId) {
    return plugin.ownerDocument.getAnonymousElementByAttribute(plugin, "anonid", anonId);
  },

  get CrashSubmit() {
    delete this.CrashSubmit;
    Components.utils.import("resource://gre/modules/CrashSubmit.jsm", this);
    return this.CrashSubmit;
  },

  // Map the plugin's name to a filtered version more suitable for user UI.
  makeNicePluginName : function ph_makeNicePluginName(aName, aFilename) {
    if (aName == "Shockwave Flash")
      return "Adobe Flash";

    // Clean up the plugin name by stripping off any trailing version numbers
    // or "plugin". EG, "Foo Bar Plugin 1.23_02" --> "Foo Bar"
    return aName.replace(/\bplug-?in\b/i, "").replace(/[\s\d\.\-\_\(\)]+$/, "");
  },

  /**
   * Update the visibility of the plugin overlay.
   */
  setVisibility : function (plugin, overlay, shouldShow) {
    overlay.classList.toggle("visible", shouldShow);
  },

  /**
   * Check whether the plugin should be visible on the page. A plugin should
   * not be visible if the overlay is too big, or if any other page content
   * overlays it.
   *
   * This function will handle showing or hiding the overlay.
   * @returns true if the plugin is invisible.
   */
  shouldShowOverlay : function (plugin, overlay) {
    // If the overlay size is 0, we haven't done layout yet. Presume that
    // plugins are visible until we know otherwise.
    if (overlay.scrollWidth == 0) {
      return true;
    }

    // Is the <object>'s size too small to hold what we want to show?
    let pluginRect = plugin.getBoundingClientRect();
    // XXX bug 446693. The text-shadow on the submitted-report text at
    //     the bottom causes scrollHeight to be larger than it should be.
    let overflows = (overlay.scrollWidth > pluginRect.width) ||
                    (overlay.scrollHeight - 5 > pluginRect.height);
    if (overflows) {
      return false;
    }

    // Is the plugin covered up by other content so that it is not clickable?
    // Floating point can confuse .elementFromPoint, so inset just a bit
    let left = pluginRect.left + 2;
    let right = pluginRect.right - 2;
    let top = pluginRect.top + 2;
    let bottom = pluginRect.bottom - 2;
    let centerX = left + (right - left) / 2;
    let centerY = top + (bottom - top) / 2;
    let points = [[left, top],
                   [left, bottom],
                   [right, top],
                   [right, bottom],
                   [centerX, centerY]];

    if (right <= 0 || top <= 0) {
      return false;
    }

    for (let [x, y] of points) {
      let el = plugin.ownerDocument.elementFromPoint(x, y);
      if (el !== plugin) {
        return false;
      }
    }

    return true;
  },

  addLinkClickCallback: function ph_addLinkClickCallback(linkNode, callbackName /*callbackArgs...*/) {
    // XXX just doing (callback)(arg) was giving a same-origin error. bug?
    let self = this;
    let callbackArgs = Array.prototype.slice.call(arguments).slice(2);
    linkNode.addEventListener("click",
                              function(evt) {
                                if (!evt.isTrusted)
                                  return;
                                evt.preventDefault();
                                if (callbackArgs.length == 0)
                                  callbackArgs = [ evt ];
                                (self[callbackName]).apply(self, callbackArgs);
                              },
                              true);

    linkNode.addEventListener("keydown",
                              function(evt) {
                                if (!evt.isTrusted)
                                  return;
                                if (evt.keyCode == evt.DOM_VK_RETURN) {
                                  evt.preventDefault();
                                  if (callbackArgs.length == 0)
                                    callbackArgs = [ evt ];
                                  evt.preventDefault();
                                  (self[callbackName]).apply(self, callbackArgs);
                                }
                              },
                              true);
  },

  // Helper to get the binding handler type from a plugin object
  _getBindingType : function(plugin) {
    let Ci = Components.interfaces;

    if (!(plugin instanceof Ci.nsIObjectLoadingContent))
      return null;

    switch (plugin.pluginFallbackType) {
      case Ci.nsIObjectLoadingContent.PLUGIN_UNSUPPORTED:
        return "PluginNotFound";
      case Ci.nsIObjectLoadingContent.PLUGIN_DISABLED:
        return "PluginDisabled";
      case Ci.nsIObjectLoadingContent.PLUGIN_BLOCKLISTED:
        return "PluginBlocklisted";
      case Ci.nsIObjectLoadingContent.PLUGIN_OUTDATED:
        return "PluginOutdated";
      case Ci.nsIObjectLoadingContent.PLUGIN_CLICK_TO_PLAY:
        return "PluginClickToPlay";
      case Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_UPDATABLE:
        return "PluginVulnerableUpdatable";
      case Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_NO_UPDATE:
        return "PluginVulnerableNoUpdate";
      case Ci.nsIObjectLoadingContent.PLUGIN_PLAY_PREVIEW:
        return "PluginPlayPreview";
      default:
        // Not all states map to a handler
        return null;
    }
  },

  handleEvent : function ph_handleEvent(event) {
    let self = gPluginHandler;
    let plugin = event.target;
    let doc = plugin.ownerDocument;

    // We're expecting the target to be a plugin.
    if (!(plugin instanceof Components.interfaces.nsIObjectLoadingContent))
      return;

    let eventType = event.type;
    if (eventType == "PluginBindingAttached") {
      // The plugin binding fires this event when it is created.
      // As an untrusted event, ensure that this object actually has a binding
      // and make sure we don't handle it twice
      let overlay = this.getPluginUI(plugin, "main");
      if (!overlay || overlay._bindingHandled) {
        return;
      }
      overlay._bindingHandled = true;

      // Lookup the handler for this binding
      eventType = self._getBindingType(plugin);
      if (!eventType) {
        // Not all bindings have handlers
        return;
      }
    }

    switch (eventType) {
      case "PluginCrashed":
        self.pluginInstanceCrashed(plugin, event);
        break;

      case "PluginNotFound":
        // NOP. Plugin finder service (PFS) is dead.
        break;

      case "PluginBlocklisted":
      case "PluginOutdated":
      case "npapi-carbon-event-model-failure":
        self.pluginUnavailable(plugin, eventType);
        break;

      case "PluginDisabled":
        let manageLink = this.getPluginUI(plugin, "managePluginsLink");
        self.addLinkClickCallback(manageLink, "managePlugins");
        break;
    }

    // Hide the in-content UI if it's too big. The crashed plugin handler already did this.
    if (eventType != "PluginCrashed") {
      let overlay = this.getPluginUI(plugin, "main");
      if (overlay != null) {
        this.setVisibility(plugin, overlay,
                           this.shouldShowOverlay(plugin, overlay));
        let resizeListener = (event) => {
          this.setVisibility(plugin, overlay,
            this.shouldShowOverlay(plugin, overlay));
          this._setPluginNotificationIcon(browser);
        };
        plugin.addEventListener("overflow", resizeListener);
        plugin.addEventListener("underflow", resizeListener);
      }
    }
  },

  newPluginInstalled : function(event) {
    // browser elements are anonymous so we can't just use target.
    var browser = event.originalTarget;

    // reload the browser to make the new plugin show.
    browser.reload();
  },

  // Callback for user clicking on a disabled plugin
  managePlugins: function ph_managePlugins(aEvent) {
    openAddonsMgr("addons://list/plugin");
  },

  // Callback for user clicking "submit a report" link
  submitReport : function ph_submitReport(pluginDumpID, browserDumpID, plugin) {
    let keyVals = {};
    if (plugin) {
      let userComment = this.getPluginUI(plugin, "submitComment").value.trim();
      if (userComment)
        keyVals.PluginUserComment = userComment;
      if (this.getPluginUI(plugin, "submitURLOptIn").checked)
        keyVals.PluginContentURL = plugin.ownerDocument.URL;
    }
    var curBrowser = document.getElementById('tabmail').getBrowserForSelectedTab();
    this.CrashSubmit.submit(pluginDumpID, { extraExtraKeyVals: keyVals });
    if (browserDumpID)
      this.CrashSubmit.submit(browserDumpID);
  },

  // Callback for user clicking a "reload page" link
  reloadPage: function ph_reloadPage(browser) {
    browser.reload();
  },

  // Callback for user clicking the help icon
  openPluginCrashHelpPage: function ph_openHelpPage() {
    // Grab the plugin crash support URL
    let url = Services.urlFormatter.formatURLPref("plugins.crash.supportUrl");
    // Now open up a content tab to display it in
    let tabmail = document.getElementById('tabmail');
    tabmail.openTab("contentTab", {contentPage: url,
                                   background: false});
  },

  // Event listener for blocklisted/outdated/carbonFailure plugins.
  pluginUnavailable: function(plugin, eventType) {
    let Cc = Components.classes;
    let Ci = Components.interfaces;
    var tabmail = document.getElementById('tabmail');
    let browser = tabmail.getBrowserForDocument(plugin.ownerDocument
                                                .defaultView).browser;

    var notificationBox = getNotificationBox(browser.contentWindow);

    // Should only display one of these warnings per page.
    // In order of priority, they are: outdated > blocklisted
    let outdatedNotification = notificationBox.getNotificationWithValue("outdated-plugins");
    let blockedNotification  = notificationBox.getNotificationWithValue("blocked-plugins");

    function showBlocklistInfo() {
      var url = formatURL("extensions.blocklist.detailsURL", true);
      tabmail.openTab("contentTab", {contentPage: url,
                                     background: false});
      return true;
    }

    function showOutdatedPluginsInfo() {
      Services.prefs.setBoolPref("plugins.update.notifyUser", false);
      var url = formatURL("plugins.update.url", true);
      tabmail.openTab("contentTab", {contentPage: url,
                                     background: false});
      return true;
    }

    function carbonFailurePluginsRestartBrowser()
    {
      // Notify all windows that an application quit has been requested.
      let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"].
                         createInstance(Ci.nsISupportsPRBool);
      Services.obs.notifyObservers(cancelQuit, "quit-application-requested", null);

      // Something aborted the quit process.
      if (cancelQuit.data)
        return;

      Services.startup.quit(Ci.nsIAppStartup.eRestarti386 |
                            Ci.nsIAppStartup.eRestart |
                            Ci.nsIAppStartup.eAttemptQuit);
    }

    let messengerBundle = document.getElementById("bundle_messenger");

    let notifications = {
      PluginBlocklisted : {
        barID: "blocked-plugins",
        iconURL: "chrome://mozapps/skin/plugins/pluginGeneric-16.png",
        message: messengerBundle.getString("blockedpluginsMessage.title"),
        buttons: [{
          label: messengerBundle.getString("blockedpluginsMessage.infoButton.label"),
          accessKey: messengerBundle.getString("blockedpluginsMessage.infoButton.accesskey"),
          popup: null,
          callback: showBlocklistInfo
        },
        {
          label: messengerBundle.getString("blockedpluginsMessage.searchButton.label"),
          accessKey: messengerBundle.getString("blockedpluginsMessage.searchButton.accesskey"),
          popup: null,
          callback: showOutdatedPluginsInfo
        }],
      },
      PluginOutdated: {
        barID: "outdated-plugins",
        iconURL: "chrome://mozapps/skin/plugins/pluginGeneric-16.png",
        message: messengerBundle.getString("outdatedpluginsMessage.title"),
        buttons: [{
          label: messengerBundle.getString("outdatedpluginsMessage.updateButton.label"),
          accessKey: messengerBundle.getString("outdatedpluginsMessage.updateButton.accesskey"),
          popup: null,
          callback: showOutdatedPluginsInfo
        }],
      }
    };
    if (AppConstants.platform == "macosx") {
      notifications["npapi-carbon-event-model-failure"] = {
        barID: "carbon-failure-plugins",
        iconURL: "chrome://mozapps/skin/plugins/pluginGeneric-16.png",
        message: messengerBundle.getString("carbonFailurePluginsMessage.message"),
        buttons: [{
          label: messengerBundle.getString("carbonFailurePluginsMessage.restartButton.label"),
          accessKey: messengerBundle.getString("carbonFailurePluginsMessage.restartButton.accesskey"),
          popup: null,
          callback: carbonFailurePluginsRestartBrowser
        }],
      }
    }

    // If there is already an outdated plugin notification then do nothing
    if (outdatedNotification)
      return;

    if ((AppConstants.platform == "macosx") &&
        (eventType == "npapi-carbon-event-model-failure")) {
      if (Services.prefs.getBoolPref("plugins.hide_infobar_for_carbon_failure_plugin"))
        return;

      let carbonFailureNotification =
        notificationBox.getNotificationWithValue("carbon-failure-plugins");

      if (carbonFailureNotification)
         carbonFailureNotification.close();

      let macutils = Cc["@mozilla.org/xpcom/mac-utils;1"].getService(Ci.nsIMacUtils);
      // if this is not a Universal build, just follow PluginNotFound path
      if (!macutils.isUniversalBinary)
        eventType = "PluginNotFound";
    }

    if (eventType == "PluginBlocklisted") {
      if (blockedNotification)
        return;
    }
    else if (eventType == "PluginOutdated") {
      if (Services.prefs.getBoolPref("plugins.hide_infobar_for_outdated_plugin"))
        return;

      // Cancel any notification about blocklisted plugins.
      if (blockedNotification)
        blockedNotification.close();
    }
    else if (eventType == "PluginNotFound") {
      return;
    }

    let notify = notifications[eventType];
    notificationBox.appendNotification(notify.message, notify.barID, notify.iconURL,
                                       notificationBox.PRIORITY_WARNING_MEDIUM,
                                       notify.buttons);
  },

  // Crashed-plugin observer. Notified once per plugin crash, before events
  // are dispatched to individual plugin instances.
  pluginCrashed : function(subject, topic, data) {
    let propertyBag = subject;
    if (!(propertyBag instanceof Components.interfaces.nsIPropertyBag2) ||
        !(propertyBag instanceof Components.interfaces.nsIWritablePropertyBag2))
     return;

    if (AppConstants.MOZ_CRASHREPORTER) {
      let pluginDumpID = propertyBag.getPropertyAsAString("pluginDumpID");
      let browserDumpID = propertyBag.getPropertyAsAString("browserDumpID");
      let shouldSubmit = gCrashReporter.submitReports;
      let doPrompt = true; // XXX followup to get via gCrashReporter

      // Submit automatically when appropriate.
      if (pluginDumpID && shouldSubmit && !doPrompt) {
        this.submitReport(pluginDumpID, browserDumpID);
        // Submission is async, so we can't easily show failure UI.
        propertyBag.setPropertyAsBool("submittedCrashReport", true);
      }
    }
  },

  // Crashed-plugin event listener. Called for every instance of a
  // plugin in content.
  pluginInstanceCrashed: function (plugin, aEvent) {
    if (!(aEvent instanceof PluginCrashedEvent))
      return;

    let submittedReport = aEvent.submittedCrashReport;
    let doPrompt        = true; // XXX followup for aEvent.doPrompt;
    let submitReports   = true; // XXX followup for aEvent.submitReports;
    let pluginName      = aEvent.pluginName;
    let pluginFilename  = aEvent.pluginFilename;
    let pluginDumpID    = aEvent.pluginDumpID;
    let browserDumpID   = aEvent.browserDumpID;

    let messengerBundle = document.getElementById("bundle_messenger");
    let tabmail = document.getElementById('tabmail');

    // Remap the plugin name to a more user-presentable form.
    pluginName = this.makeNicePluginName(pluginName, pluginFilename);

    let messageString = messengerBundle.getFormattedString("crashedpluginsMessage.title", [pluginName]);

    //
    // Configure the crashed-plugin placeholder.
    //


    // Force a layout flush so the binding is attached.
    plugin.clientTop;
    let doc = plugin.ownerDocument;
    let overlay = this.getPluginUI(plugin, "main");
    let statusDiv = this.getPluginUI(plugin, "submitStatus");

    if (AppConstants.MOZ_CRASHREPORTER) {
      let status;

      // Determine which message to show regarding crash reports.
      if (submittedReport) { // submitReports && !doPrompt, handled in observer
        status = "submitted";
      }
      else if (!submitReports && !doPrompt) {
        status = "noSubmit";
      }
      else { // doPrompt
        status = "please";
        // XXX can we make the link target actually be blank?
        this.getPluginUI(plugin, "submitButton").addEventListener("click",
          function (event) {
            if (event.button != 0 || !event.isTrusted)
              return;
            this.submitReport(pluginDumpID, browserDumpID, plugin);
            pref.setBoolPref("", optInCB.checked);
          }.bind(this));
        let optInCB = this.getPluginUI(plugin, "submitURLOptIn");
        let pref = Services.prefs.getBranch("dom.ipc.plugins.reportCrashURL");
        optInCB.checked = pref.getBoolPref("");
      }

      // If we don't have a minidumpID, we can't (or didn't) submit anything.
      // This can happen if the plugin is killed from the task manager.
      if (!pluginDumpID) {
        status = "noReport";
      }

      statusDiv.setAttribute("status", status);

      let helpIcon = this.getPluginUI(plugin, "helpIcon");
      this.addLinkClickCallback(helpIcon, "openPluginCrashHelpPage");

      // If we're showing the link to manually trigger report submission, we'll
      // want to be able to update all the instances of the UI for this crash to
      // show an updated message when a report is submitted.
      if (doPrompt) {
        let observer = {
          QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIObserver,
                                                 Components.interfaces.nsISupportsWeakReference]),
          observe : function(subject, topic, data) {
            let propertyBag = subject;
            if (!(propertyBag instanceof Components.interfaces.nsIPropertyBag2))
              return;
            // Ignore notifications for other crashes.
            if (propertyBag.get("minidumpID") != pluginDumpID)
              return;
            statusDiv.setAttribute("status", data);
          },

          handleEvent : function(event) {
              // Not expected to be called, just here for the closure.
          }
        };

        // Use a weak reference, so we don't have to remove it...
        Services.obs.addObserver(observer, "crash-report-status", true);
        // ...alas, now we need something to hold a strong reference to prevent
        // it from being GC. But I don't want to manually manage the reference's
        // lifetime (which should be no greater than the page).
        // Clever solution? Use a closue with an event listener on the document.
        // When the doc goes away, so do the listener references and the closure.
        doc.addEventListener("mozCleverClosureHack", observer, false);
      }
    }

    let crashText = this.getPluginUI(plugin, "crashedText");
    crashText.textContent = messageString;
    let browser = tabmail.getBrowserForSelectedTab();

    let link = this.getPluginUI(plugin, "reloadLink");
    this.addLinkClickCallback(link, "reloadPage", browser);

    let notificationBox = getNotificationBox(browser.contentWindow);

    let isShowing = this.shouldShowOverlay(plugin, overlay);

    // Is the <object>'s size too small to hold what we want to show?
    if (!isShowing) {
      // First try hiding the crash report submission UI.
      statusDiv.removeAttribute("status");

      isShowing = this.shouldShowOverlay(plugin, overlay);
    }
    this.setVisibility(plugin, overlay, isShowing);

    if (isShowing) {
      // If a previous plugin on the page was too small and resulted in adding a
      // notification bar, then remove it because this plugin instance is big
      // enough to serve as in-content notification.
      hideNotificationBar();
      doc.mozNoPluginCrashedNotification = true;
    } else {
      // If another plugin on the page was large enough to show our UI, we don't
      // want to show a notification bar.
      if (!doc.mozNoPluginCrashedNotification)
        showNotificationBar(pluginDumpID, browserDumpID);
    }

    function hideNotificationBar() {
      let notification = notificationBox.getNotificationWithValue("plugin-crashed");
      if (notification)
        notificationBox.removeNotification(notification, true);
    }

    function showNotificationBar(pluginDumpID, browserDumpID) {
      // If there's already an existing notification bar, don't do anything.
      let messengerBundle = document.getElementById("bundle_messenger");
      let notification = notificationBox.getNotificationWithValue("plugin-crashed");
      if (notification)
        return;

      // Configure the notification bar
      let priority = notificationBox.PRIORITY_WARNING_MEDIUM;
      let iconURL = "chrome://mozapps/skin/plugins/pluginGeneric-16.png";
      let reloadLabel = messengerBundle.getString("crashedpluginsMessage.reloadButton.label");
      let reloadKey   = messengerBundle.getString("crashedpluginsMessage.reloadButton.accesskey");
      let submitLabel = messengerBundle.getString("crashedpluginsMessage.submitButton.label");
      let submitKey   = messengerBundle.getString("crashedpluginsMessage.submitButton.accesskey");

      let buttons = [{
        label: reloadLabel,
        accessKey: reloadKey,
        popup: null,
        callback: function() { browser.reload(); },
      }];
      if (AppConstants.MOZ_CRASHREPORTER) {
        let submitButton = {
          label: submitLabel,
          accessKey: submitKey,
          popup: null,
            callback: function() { gPluginHandler.submitReport(pluginDumpID, browserDumpID); },
        };
        if (pluginDumpID)
          buttons.push(submitButton);
      }

      notification = notificationBox.appendNotification(messageString, "plugin-crashed",
                                                        iconURL, priority, buttons);

      // Add the "learn more" link.
      let XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
      let link = notification.ownerDocument.createElementNS(XULNS, "label");
      let crashHelpUrl = Services.urlFormatter
                                 .formatURLPref("plugins.crash.supportUrl");
      link.className = "text-link";
      link.setAttribute("value", messengerBundle.getString("crashedpluginsMessage.learnMore"));
      link.href = crashHelpUrl;
      let description = notification.ownerDocument.getAnonymousElementByAttribute(notification, "anonid", "messageText");
      description.appendChild(link);

      // Remove the notfication when the page is reloaded.
      doc.defaultView.top.addEventListener("unload", function() {
        notificationBox.removeNotification(notification);
      }, false);
    }

  }
};

