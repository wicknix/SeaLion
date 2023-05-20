/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//****************************************************************************//
// Constants & Enumeration Values

var PREF_DISABLED_PLUGIN_TYPES = "plugin.disable_full_page_plugin_for_types";

// Preferences that affect which entries to show in the list.
var PREF_SHOW_PLUGINS_IN_LIST = "browser.download.show_plugins_in_list";
var PREF_HIDE_PLUGINS_WITHOUT_EXTENSIONS =
  "browser.download.hide_plugins_without_extensions";

// The nsHandlerInfoAction enumeration values in nsIHandlerInfo identify
// the actions the application can take with content of various types.
// But since nsIHandlerInfo doesn't support plugins, there's no value
// identifying the "use plugin" action, so we use this constant instead.
var kActionUsePlugin = 5;

// For CSS. Can be one of "ask", "save", "plugin" or "feed". If absent, the icon URL
// was set by us to a custom handler icon and CSS should not try to override it.
var APP_ICON_ATTR_NAME = "appHandlerIcon";

// CloudFile account tools used by gCloudFileTab.
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource:///modules/cloudFileAccounts.js");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

//****************************************************************************//
// Utilities

function getDisplayNameForFile(aFile) {
  if (AppConstants.platform == "win") {
    if (aFile instanceof Components.interfaces.nsILocalFileWin) {
      try {
        return aFile.getVersionInfoField("FileDescription");
      }
      catch(ex) {
        // fall through to the file name
      }
    }
  }
  else if (AppConstants.platform == "macosx") {
    if (aFile instanceof Components.interfaces.nsILocalFileMac) {
      try {
        return aFile.bundleDisplayName;
      }
      catch(ex) {
        // fall through to the file name
      }
    }
  }

  return aFile.leafName;
}

function getLocalHandlerApp(aFile) {
  var localHandlerApp = Components.classes["@mozilla.org/uriloader/local-handler-app;1"]
                                  .createInstance(Components.interfaces.nsILocalHandlerApp);
  localHandlerApp.name = getDisplayNameForFile(aFile);
  localHandlerApp.executable = aFile;

  return localHandlerApp;
}

/**
 * An enumeration of items in a JS array.
 *
 * FIXME: use ArrayConverter once it lands (bug 380839).
 *
 * @constructor
 */
function ArrayEnumerator(aItems) {
  this._index = 0;
  this._contents = aItems;
}

ArrayEnumerator.prototype = {
  _index: 0,

  hasMoreElements: function() {
    return this._index < this._contents.length;
  },

  getNext: function() {
    return this._contents[this._index++];
  }
};

//****************************************************************************//
// HandlerInfoWrapper

/**
 * This object wraps nsIHandlerInfo with some additional functionality
 * the Applications prefpane needs to display and allow modification of
 * the list of handled types.
 *
 * We create an instance of this wrapper for each entry we might display
 * in the prefpane, and we compose the instances from various sources,
 * including navigator.plugins and the handler service.
 *
 * We don't implement all the original nsIHandlerInfo functionality,
 * just the stuff that the prefpane needs.
 *
 * In theory, all of the custom functionality in this wrapper should get
 * pushed down into nsIHandlerInfo eventually.
 */
function HandlerInfoWrapper(aType, aHandlerInfo) {
  this._type = aType;
  this.wrappedHandlerInfo = aHandlerInfo;
}

HandlerInfoWrapper.prototype = {
  // The wrapped nsIHandlerInfo object.  In general, this object is private,
  // but there are a couple cases where callers access it directly for things
  // we haven't (yet?) implemented, so we make it a public property.
  wrappedHandlerInfo: null,

  //**************************************************************************//
  // Convenience Utils

  _handlerSvc: Components.classes["@mozilla.org/uriloader/handler-service;1"]
                         .getService(Components.interfaces.nsIHandlerService),

  _categoryMgr: Components.classes["@mozilla.org/categorymanager;1"]
                          .getService(Components.interfaces.nsICategoryManager),

  //**************************************************************************//
  // nsIHandlerInfo

  // The MIME type or protocol scheme.
  _type: null,
  get type() {
    return this._type;
  },

  get description() {
    if (this.wrappedHandlerInfo.description)
      return this.wrappedHandlerInfo.description;

    if (this.primaryExtension) {
      var extension = this.primaryExtension.toUpperCase();
      return document.getElementById("bundlePreferences")
                     .getFormattedString("fileEnding", [extension]);
    }
    return this.type;
  },

  get preferredApplicationHandler() {
    return this.wrappedHandlerInfo.preferredApplicationHandler;
  },

  set preferredApplicationHandler(aNewValue) {
    this.wrappedHandlerInfo.preferredApplicationHandler = aNewValue;

    // Make sure the preferred handler is in the set of possible handlers.
    if (aNewValue)
      this.addPossibleApplicationHandler(aNewValue)
  },

  get possibleApplicationHandlers() {
    return this.wrappedHandlerInfo.possibleApplicationHandlers;
  },

  addPossibleApplicationHandler: function(aNewHandler) {
    try {
      if (this.possibleApplicationHandlers.indexOf(0, aNewHandler) != -1)
        return;
    } catch (e) { }
    this.possibleApplicationHandlers.appendElement(aNewHandler, false);
  },

  removePossibleApplicationHandler: function(aHandler) {
    var defaultApp = this.preferredApplicationHandler;
    if (defaultApp && aHandler.equals(defaultApp)) {
      // If the app we remove was the default app, we must make sure
      // it won't be used anymore
      this.alwaysAskBeforeHandling = true;
      this.preferredApplicationHandler = null;
    }

    try {
      var handlerIdx = this.possibleApplicationHandlers.indexOf(0, aHandler);
      this.possibleApplicationHandlers.removeElementAt(handlerIdx);
    } catch (e) { }
  },

  get hasDefaultHandler() {
    return this.wrappedHandlerInfo.hasDefaultHandler;
  },

  get defaultDescription() {
    return this.wrappedHandlerInfo.defaultDescription;
  },

  // What to do with content of this type.
  get preferredAction() {
    // If we have an enabled plugin, then the action is to use that plugin.
    if (this.plugin && !this.isDisabledPluginType)
      return kActionUsePlugin;

    // If the action is to use a helper app, but we don't have a preferred
    // handler app, then switch to using the system default, if any; otherwise
    // fall back to saving to disk, which is the default action in nsMIMEInfo.
    // Note: "save to disk" is an invalid value for protocol info objects,
    // but the alwaysAskBeforeHandling getter will detect that situation
    // and always return true in that case to override this invalid value.
    if (this.wrappedHandlerInfo.preferredAction ==
          Components.interfaces.nsIHandlerInfo.useHelperApp &&
        !gApplicationsPane.isValidHandlerApp(this.preferredApplicationHandler)) {
      if (this.wrappedHandlerInfo.hasDefaultHandler)
        return Components.interfaces.nsIHandlerInfo.useSystemDefault;
      else
        return Components.interfaces.nsIHandlerInfo.saveToDisk;
    }

    return this.wrappedHandlerInfo.preferredAction;
  },

  set preferredAction(aNewValue) {
    // We don't modify the preferred action if the new action is to use a plugin
    // because handler info objects don't understand our custom "use plugin"
    // value.  Also, leaving it untouched means that we can automatically revert
    // to the old setting if the user ever removes the plugin.

    if (aNewValue != kActionUsePlugin)
      this.wrappedHandlerInfo.preferredAction = aNewValue;
  },

  get alwaysAskBeforeHandling() {
    // If this type is handled only by a plugin, we can't trust the value
    // in the handler info object, since it'll be a default based on the absence
    // of any user configuration, and the default in that case is to always ask,
    // even though we never ask for content handled by a plugin, so special case
    // plugin-handled types by returning false here.
    if (this.plugin && this.handledOnlyByPlugin)
      return false;

    // If this is a protocol type and the preferred action is "save to disk",
    // which is invalid for such types, then return true here to override that
    // action.  This could happen when the preferred action is to use a helper
    // app, but the preferredApplicationHandler is invalid, and there isn't
    // a default handler, so the preferredAction getter returns save to disk
    // instead.
    if (!(this.wrappedHandlerInfo instanceof Components.interfaces.nsIMIMEInfo) &&
        this.preferredAction == Components.interfaces.nsIHandlerInfo.saveToDisk)
      return true;

    return this.wrappedHandlerInfo.alwaysAskBeforeHandling;
  },

  set alwaysAskBeforeHandling(aNewValue) {
    this.wrappedHandlerInfo.alwaysAskBeforeHandling = aNewValue;
  },


  //**************************************************************************//
  // nsIMIMEInfo

  // The primary file extension associated with this type, if any.
  //
  // XXX Plugin objects contain an array of MimeType objects with "suffixes"
  // properties; if this object has an associated plugin, shouldn't we check
  // those properties for an extension?
  get primaryExtension() {
    try {
      if (this.wrappedHandlerInfo instanceof Components.interfaces.nsIMIMEInfo &&
          this.wrappedHandlerInfo.primaryExtension)
        return this.wrappedHandlerInfo.primaryExtension;
    } catch(ex) {}

    return null;
  },


  //**************************************************************************//
  // Plugin Handling

  // A plugin that can handle this type, if any.
  //
  // Note: just because we have one doesn't mean it *will* handle the type.
  // That depends on whether or not the type is in the list of types for which
  // plugin handling is disabled.
  plugin: null,

  // Whether or not this type is only handled by a plugin or is also handled
  // by some user-configured action as specified in the handler info object.
  //
  // Note: we can't just check if there's a handler info object for this type,
  // because OS and user configuration is mixed up in the handler info object,
  // so we always need to retrieve it for the OS info and can't tell whether
  // it represents only OS-default information or user-configured information.
  //
  // FIXME: once handler info records are broken up into OS-provided records
  // and user-configured records, stop using this boolean flag and simply
  // check for the presence of a user-configured record to determine whether
  // or not this type is only handled by a plugin.  Filed as bug 395142.
  handledOnlyByPlugin: undefined,

  get isDisabledPluginType() {
    return this._getDisabledPluginTypes().includes(this.type);
  },

  _getDisabledPluginTypes: function() {
    var types = "";

    if (Services.prefs.prefHasUserValue(PREF_DISABLED_PLUGIN_TYPES))
      types = Services.prefs.getCharPref(PREF_DISABLED_PLUGIN_TYPES);

    // Only split if the string isn't empty so we don't end up with an array
    // containing a single empty string.
    return types ? types.split(",") : [];
  },

  disablePluginType: function() {
    var disabledPluginTypes = this._getDisabledPluginTypes();

    if (!disabledPluginTypes.includes(this.type))
      disabledPluginTypes.push(this.type);

    Services.prefs.setCharPref(PREF_DISABLED_PLUGIN_TYPES,
                               disabledPluginTypes.join(","));

    // Update the category manager so existing browser windows update.
    this._categoryMgr.deleteCategoryEntry("Gecko-Content-Viewers",
                                          this.type,
                                          false);
  },

  enablePluginType: function() {
    var disabledPluginTypes = this._getDisabledPluginTypes();

    var type = this.type;
    disabledPluginTypes = disabledPluginTypes.filter(v => v != type);

    Services.prefs.setCharPref(PREF_DISABLED_PLUGIN_TYPES,
                               disabledPluginTypes.join(","));

    // Update the category manager so existing browser windows update.
    this._categoryMgr.
      addCategoryEntry("Gecko-Content-Viewers",
                       this.type,
                       "@mozilla.org/content/plugin/document-loader-factory;1",
                       false,
                       true);
  },


  //**************************************************************************//
  // Storage

  store: function() {
    this._handlerSvc.store(this.wrappedHandlerInfo);
  },

  remove: function() {
    this._handlerSvc.remove(this.wrappedHandlerInfo);
  },


  //**************************************************************************//
  // Icons

  get smallIcon() {
    return this._getIcon(16);
  },

  get largeIcon() {
    return this._getIcon(32);
  },

  _getIcon: function(aSize) {
    if (this.primaryExtension)
      return "moz-icon://goat." + this.primaryExtension + "?size=" + aSize;

    if (this.wrappedHandlerInfo instanceof Components.interfaces.nsIMIMEInfo)
      return "moz-icon://goat?size=" + aSize + "&contentType=" + this.type;

    // FIXME: consider returning some generic icon when we can't get a URL for
    // one (for example in the case of protocol schemes).  Filed as bug 395141.
    return null;
  }
};

var gApplicationsTabController = {
  mInitialized: false,
  // We default to displaying the Outgoing tab, which is the tab at index 1
  // of the attachmentPrefs tabs.
  mDefaultIndex: 1,

  init: function() {
    if (this.mInitialized)
      return;

    gApplicationsPane.init();

    let tabbox = document.getElementById("attachmentPrefs");

    // If BigFiles is disabled, hide the "Outgoing" tab, and the tab
    // selectors, and bail out.
    if (!Services.prefs.getBoolPref("mail.cloud_files.enabled")) {
      // Default to the first tab, "Incoming"
      tabbox.selectedIndex = 0;
      // Hide the tab selector
      let tabs = document.getElementById("attachmentPrefsTabs");
      tabs.hidden = true;
      this.mInitialized = true;
      return;
    }

    gCloudFileTab.init();

    if (!(("arguments" in window) && window.arguments[1])) {
      // If no tab was specified, select the last used tab.
      let preference = document.getElementById("mail.preferences.applications.selectedTabIndex");
      tabbox.selectedIndex = preference.value != null ? preference.value : this.mDefaultIndex;
    }

    let loadInContent = Services.prefs.getBoolPref("mail.preferences.inContent");
    if (loadInContent) {
      gSubDialog.init();
    }

    this.mInitialized = true;
  },

  tabSelectionChanged: function() {
    if (this.mInitialized)
      document.getElementById("mail.preferences.applications.selectedTabIndex")
              .valueFromPreferences = document.getElementById("attachmentPrefs")
              .selectedIndex;
  },

}

var gCloudFileController = {
  commands: {
    cmd_addCloudfileAccount: {
      isEnabled: function() {
        return true;
      },
      doCommand: function() {
        gCloudFileTab.addCloudFileAccount();
      },
    },

    cmd_removeCloudfileAccount: {
      isEnabled: function() {
        let listbox = document.getElementById("cloudFileView");
        return listbox.selectedCount > 0;
      },
      doCommand: function() {
        gCloudFileTab.removeCloudFileAccount();
      },
    },

    cmd_reauthCloudfileAccount: {
      isEnabled: function() {
        return true;
      },
      doCommand: function() {
        gCloudFileTab.authSelected();
      },
    },

  },

  supportsCommand: function(aCommand) {
    return (aCommand in this.commands);
  },

  isCommandEnabled: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return false;
    return this.commands[aCommand].isEnabled();
  },

  doCommand: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return;

    let cmd = this.commands[aCommand];

    if (!cmd.isEnabled())
      return;

    cmd.doCommand();
  },
  onEvent: function(event) {},
}

function CommandUpdate_CloudFile() {
  goUpdateCommand("cmd_removeCloudfileAccount");
  goUpdateCommand("cmd_addCloudfileAccount");
}

var gCloudFileTab = {
  _initialized: false,
  _list: null,
  _settings: null,
  _settingsDeck: null,
  _tabpanel: null,
  _accountCache: {},
  _settingsPanelWrap: null,
  _defaultPanel: null,
  _loadingPanel: null,
  _authErrorPanel: null,

  get _strings() {
    return Services.strings
                   .createBundle("chrome://messenger/locale/preferences/applications.properties");
  },

  init: function() {
    if (this._initialized)
      return;

    this._list = document.getElementById("cloudFileView");
    this._settingsDeck = document.getElementById("cloudFileSettingsDeck");
    this._defaultPanel = document.getElementById("cloudFileDefaultPanel");
    this._settingsPanelWrap = document.getElementById("cloudFileSettingsWrapper");
    this._loadingPanel = document.getElementById("cloudFileLoadingPanel");
    this._authErrorPanel = document.getElementById("cloudFileAuthErrorPanel");

    top.controllers.appendController(gCloudFileController);

    this.rebuildView();

    if (this._list.itemCount > 0)
      this._list.selectedIndex = 0;

    window.addEventListener("unload", this, {capture: false, once: true});
    CommandUpdate_CloudFile();

    this.updateThreshold();

    this._initialized = true;
  },

  destroy: function CFT_destroy() {
    // Remove any controllers or observers here.
    top.controllers.removeController(gCloudFileController);
  },

  makeRichListItemForAccount: function CFT_makeRichListItemForAccount(aAccount) {
    let rli = document.createElement("richlistitem");
    rli.value = aAccount.accountKey;
    rli.setAttribute("value", aAccount.accountKey);
    rli.setAttribute("class", "cloudfileAccount");
    rli.setAttribute("state", "waiting-to-connect");

    if (aAccount.iconClass)
      rli.style.listStyleImage = "url('" + aAccount.iconClass + "')";

    let displayName = cloudFileAccounts.getDisplayName(aAccount.accountKey);
    // Quick and ugly - accountKey:displayName for now
    let status = document.createElement("image");
    status.setAttribute("class", "typeIcon");

    rli.appendChild(status);
    let descr = document.createElement("label");
    descr.setAttribute("value", displayName);
    rli.appendChild(descr);

    // Set the state of the richlistitem, if applicable
    if (aAccount.accountKey in this._accountCache) {
      let result = this._accountCache[aAccount.accountKey].result;
      this._mapResultToState(rli, result);
      this._accountCache[aAccount.accountKey].listItem = rli;
    }

    return rli;
  },

  clearEntries: function CFT_clearEntries() {
    // Clear the list of entries.
    while (this._list.hasChildNodes())
      this._list.lastChild.remove();
  },

  rebuildView: function CFT_rebuildView() {
    this.clearEntries();
    let accounts = cloudFileAccounts.accounts;

    // Sort the accounts by displayName.
    function sortAccounts(a, b) {
      let aName = cloudFileAccounts.getDisplayName(a.accountKey)
                                   .toLowerCase();
      let bName = cloudFileAccounts.getDisplayName(b.accountKey)
                                   .toLowerCase();

      if (aName < bName)
        return -1;
      if (aName > bName)
        return 1;
      return 0;
    }

    accounts.sort(sortAccounts);

    for (let account of accounts) {
      let rli = this.makeRichListItemForAccount(account);
      this._list.appendChild(rli);
      if (!(account.accountKey in this._accountCache))
        this.requestUserInfoForItem(rli, false);
    }
  },

  requestUserInfoForItem: function CFT_requestUserInfoForItem(aItem, aWithUI) {
    let Cr = Components.results;
    let accountKey = aItem.value;
    let account = cloudFileAccounts.getAccount(accountKey);

    let observer = {
      onStopRequest: function(aRequest, aContext, aStatusCode) {
        gCloudFileTab._accountCache[accountKey].result = aStatusCode;
        gCloudFileTab.onUserInfoRequestDone(accountKey);
      },
      onStartRequest: function(aRequest, aContext) {
        aItem.setAttribute("state", "connecting");
      },
    };

    let accountInfo = {account: account,
                       listItem: aItem,
                       result: Cr.NS_ERROR_NOT_AVAILABLE}

    this._accountCache[accountKey] = accountInfo;

    this._settingsDeck.selectedPanel = this._loadingPanel;
    account.refreshUserInfo(aWithUI, observer);
  },

  onUserInfoRequestDone: function CFT_onUserInfoRequestDone(aAccountKey) {
    this.updateRichListItem(aAccountKey);

    if (this._list.selectedItem &&
        this._list.selectedItem.value == aAccountKey)
      this._showAccountInfo(aAccountKey);
  },

  updateRichListItem: function CFT_updateRichListItem(aAccountKey) {
    let accountInfo = this._accountCache[aAccountKey];
    if (!accountInfo)
      return;

    let item = accountInfo.listItem;
    let result = accountInfo.result;
    this._mapResultToState(item, result);
  },

  _mapResultToState: function CFT__mapResultToState(aItem, aResult) {
    let Cr = Components.results;
    let Ci = Components.interfaces;
    let itemState = "no-connection";

    if (aResult == Cr.NS_OK)
      itemState = "connected";
    else if (aResult == Ci.nsIMsgCloudFileProvider.authErr)
      itemState = "auth-error";
    else if (aResult == Cr.NS_ERROR_NOT_AVAILABLE)
      itemState = "no-connection";
    // TODO: What other states are there?

    aItem.setAttribute("state", itemState);
  },


  onSelectionChanged: function CFT_onSelectionChanged() {
    // Get the selected item
    let selection = this._list.selectedItem;
    if (!selection)
      return;

    // The selection tells us the key.  We need the actual
    // provider here.
    let accountKey = selection.value;
    this._showAccountInfo(accountKey);
  },

  _showAccountInfo: function CFT__showAccountInfo(aAccountKey) {
    let Ci = Components.interfaces;
    let Cr = Components.results;
    let account = this._accountCache[aAccountKey].account;
    let result = this._accountCache[aAccountKey].result;

    if (result == Cr.NS_ERROR_NOT_AVAILABLE)
      this._settingsDeck.selectedPanel = this._loadingPanel;
    else if (result == Cr.NS_OK) {
      this._settingsDeck.selectedPanel = this._settingsPanelWrap;
      this._showAccountManagement(account);
    }
    else if (result == Ci.nsIMsgCloudFileProvider.authErr) {
      this._settingsDeck.selectedPanel = this._authErrorPanel;
    }
    else {
      Components.utils.reportError("Unexpected connection error.");
    }
  },

  _showAccountManagement: function CFT__showAccountManagement(aProvider) {
    let iframe = document.createElement('iframe');

    iframe.setAttribute("src", aProvider.managementURL);
    iframe.setAttribute("flex", "1");

    // If we have a past iframe, we replace it. Else append
    // to the wrapper.
    if (this._settings)
      this._settings.remove();

    this._settingsPanelWrap.appendChild(iframe);
    this._settings = iframe;

    // When the iframe loads, populate it with the provider.
    this._settings.contentWindow.addEventListener("load",
      function loadProvider() {
        try {
          iframe.contentWindow
                .wrappedJSObject
                .onLoadProvider(aProvider);
        } catch(e) {
          Components.utils.reportError(e);
        }
      }, {capture: false, once: true});

    // When the iframe (or any subcontent) fires the DOMContentLoaded event,
    // attach the _onClickLink handler to any anchor elements that we can find.
    this._settings.contentWindow.addEventListener("DOMContentLoaded",
      function addClickListeners(e) {
        let doc = e.originalTarget;
        let links = doc.getElementsByTagName("a");

        for (let link of links)
          link.addEventListener("click", gCloudFileTab._onClickLink);
      }, {capture: false, once: true});

    CommandUpdate_CloudFile();
  },

  _onClickLink: function CFT__onClickLink(aEvent) {
    aEvent.preventDefault();
    let href = aEvent.target.getAttribute("href");
    openLinkExternally(href);
  },

  authSelected: function CFT_authSelected() {
    let item = this._list.selectedItem;

    if (!item)
      return;

    this.requestUserInfoForItem(item, true);
  },

  addCloudFileAccount: function CFT_addCloudFileAccount() {
    let accountKey = cloudFileAccounts.addAccountDialog();
    if (!accountKey)
      return;

    this.rebuildView();
    let newItem = this._list.querySelector("richlistitem[value='" + accountKey + "']");
    this._list.selectItem(newItem);
  },

  removeCloudFileAccount: function CFT_removeCloudFileAccount() {
    // Get the selected account key
    let selection = this._list.selectedItem;
    if (!selection)
      return;

    let accountKey = selection.value;
    let accountName = cloudFileAccounts.getDisplayName(accountKey);
    // Does the user really want to remove this account?
    let confirmMessage = this._strings
                             .formatStringFromName("dialog_removeAccount",
                                                   [accountName], 1);

    if (Services.prompt.confirm(null, "", confirmMessage)) {
      this._list.clearSelection();
      cloudFileAccounts.removeAccount(accountKey);
      this.rebuildView();
      this._settingsDeck.selectedPanel = this._defaultPanel;
      delete this._accountCache[accountKey];
      // For some reason, the focus event isn't fired, so I think
      // we have to update the buttons manually...
      CommandUpdate_CloudFile();
    }
  },

  handleEvent: function CFT_handleEvent(aEvent) {
    if (aEvent.type == "unload")
      this.destroy();
  },

  readThreshold: function CFT_readThreshold() {
    let pref = document.getElementById("mail.compose.big_attachments.threshold_kb");
    return pref.value / 1024;
  },

  writeThreshold: function CFT_writeThreshold() {
    let threshold = document.getElementById("cloudFileThreshold");
    let intValue = parseInt(threshold.value, 10);
    return isNaN(intValue) ? 0 : intValue * 1024;
  },

  updateThreshold: function CFT_updateThreshold() {
    document.getElementById("cloudFileThreshold").disabled =
    !document.getElementById("enableThreshold").checked;
  },

  QueryInterface: XPCOMUtils.generateQI([Components.interfaces
                                                   .nsIObserver,
                                         Components.interfaces
                                                   .nsISupportsWeakReference])
}

//****************************************************************************//
// Prefpane Controller

var gApplicationsPane = {
  // The set of types the app knows how to handle.  A hash of HandlerInfoWrapper
  // objects, indexed by type.
  _handledTypes: {},

  // The list of types we can show, sorted by the sort column/direction.
  // An array of HandlerInfoWrapper objects.  We build this list when we first
  // load the data and then rebuild it when users change a pref that affects
  // what types we can show or change the sort column/direction.
  // Note: this isn't necessarily the list of types we *will* show; if the user
  // provides a filter string, we'll only show the subset of types in this list
  // that match that string.
  _visibleTypes: [],

  // A count of the number of times each visible type description appears.
  // We use these counts to determine whether or not to annotate descriptions
  // with their types to distinguish duplicate descriptions from each other.
  // A hash of integer counts, indexed by string description.
  _visibleTypeDescriptionCount: [],


  //**************************************************************************//
  // Convenience & Performance Shortcuts

  // These get defined by init().
  _brandShortName : null,
  _prefsBundle    : null,
  _list           : null,
  _filter         : null,

  _mimeSvc      : Components.classes["@mozilla.org/mime;1"]
                            .getService(Components.interfaces.nsIMIMEService),

  _helperAppSvc : Components.classes["@mozilla.org/uriloader/external-helper-app-service;1"]
                            .getService(Components.interfaces.nsIExternalHelperAppService),

  _handlerSvc   : Components.classes["@mozilla.org/uriloader/handler-service;1"]
                            .getService(Components.interfaces.nsIHandlerService),

  _loadInContent: Services.prefs.getBoolPref("mail.preferences.inContent"),

  //**************************************************************************//
  // Initialization & Destruction

  init: function() {
    // Initialize shortcuts to some commonly accessed elements & values.
    this._brandShortName =
      document.getElementById("bundleBrand").getString("brandShortName");
    this._prefsBundle = document.getElementById("bundlePreferences");
    this._list = document.getElementById("handlersView");
    this._filter = document.getElementById("filter");

    // Observe preferences that influence what we display so we can rebuild
    // the view when they change.
    Services.prefs.addObserver(PREF_SHOW_PLUGINS_IN_LIST, this, false);
    Services.prefs.addObserver(PREF_HIDE_PLUGINS_WITHOUT_EXTENSIONS, this, false);

    // Listen for window unload so we can remove our preference observers.
    window.addEventListener("unload", this, {capture: false, once: true});

    // Figure out how we should be sorting the list.  We persist sort settings
    // across sessions, so we can't assume the default sort column/direction.
    // XXX should we be using the XUL sort service instead?
    this._sortColumn = document.getElementById("typeColumn")
    if (document.getElementById("actionColumn").hasAttribute("sortDirection")) {
      this._sortColumn = document.getElementById("actionColumn");
      // The typeColumn element always has a sortDirection attribute,
      // either because it was persisted or because the default value
      // from the xul file was used.  If we are sorting on the other
      // column, we should remove it.
      document.getElementById("typeColumn").removeAttribute("sortDirection");
    }

    // By doing this in a timeout, we let the preferences dialog resize itself
    // to an appropriate size before we add a bunch of items to the list.
    // Otherwise, if there are many items, and the Applications prefpane
    // is the one that gets displayed when the user first opens the dialog,
    // the dialog might stretch too much in an attempt to fit them all in.
    // XXX Shouldn't we perhaps just set a max-height on the richlistbox?
    var _delayedPaneLoad = function(self) {
      self._loadData();
      self._rebuildVisibleTypes();
      self._sortVisibleTypes();
      self.rebuildView();

      // Notify observers that the UI is now ready
      Services.obs.notifyObservers(window, "app-handler-pane-loaded", null);
    }
    setTimeout(_delayedPaneLoad, 0, this);
  },

  destroy: function() {
    Services.prefs.removeObserver(PREF_SHOW_PLUGINS_IN_LIST, this);
    Services.prefs.removeObserver(PREF_HIDE_PLUGINS_WITHOUT_EXTENSIONS, this);
  },


  //**************************************************************************//
  // nsISupports

  QueryInterface: function(aIID) {
    if (aIID.equals(Components.interfaces.nsIObserver) ||
        aIID.equals(Components.interfaces.nsIDOMEventListener ||
        aIID.equals(Components.interfaces.nsISupports)))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  },


  //**************************************************************************//
  // nsIObserver

  observe: function (aSubject, aTopic, aData) {
    // Rebuild the list when there are changes to preferences that influence
    // whether or not to show certain entries in the list.
    if (aTopic == "nsPref:changed" && !this._storingAction) {
      // These two prefs alter the list of visible types, so we have to rebuild
      // that list when they change.
      if (aData == PREF_SHOW_PLUGINS_IN_LIST ||
          aData == PREF_HIDE_PLUGINS_WITHOUT_EXTENSIONS) {
        this._rebuildVisibleTypes();
        this._sortVisibleTypes();
      }

      // All the prefs we observe can affect what we display, so we rebuild
      // the view when any of them changes.
      this.rebuildView();
    }
  },


  //**************************************************************************//
  // nsIDOMEventListener

  handleEvent: function(aEvent) {
    if (aEvent.type == "unload")
      this.destroy();
  },


  //**************************************************************************//
  // Composed Model Construction

  _loadData: function() {
    this._loadPluginHandlers();
    this._loadApplicationHandlers();
  },

  /**
   * Load the set of handlers defined by plugins.
   *
   * Note: if there's more than one plugin for a given MIME type, we assume
   * the last one is the one that the application will use.  That may not be
   * correct, but it's how we've been doing it for years.
   *
   * Perhaps we should instead query navigator.mimeTypes for the set of types
   * supported by the application and then get the plugin from each MIME type's
   * enabledPlugin property.  But if there's a plugin for a type, we need
   * to know about it even if it isn't enabled, since we're going to give
   * the user an option to enable it.
   *
   * I'll also note that my reading of nsPluginTag::RegisterWithCategoryManager
   * suggests that enabledPlugin is only determined during registration
   * and does not get updated when plugin.disable_full_page_plugin_for_types
   * changes (unless modification of that preference spawns reregistration).
   * So even if we could use enabledPlugin to get the plugin that would be used,
   * we'd still need to check the pref ourselves to find out if it's enabled.
   */
  _loadPluginHandlers: function() {
    for (let i = 0; i < navigator.plugins.length; ++i) {
      let plugin = navigator.plugins[i];
      for (let j = 0; j < plugin.length; ++j) {
        let type = plugin[j].type;

        let handlerInfoWrapper;
        if (type in this._handledTypes)
          handlerInfoWrapper = this._handledTypes[type];
        else {
          let wrappedHandlerInfo =
            this._mimeSvc.getFromTypeAndExtension(type, null);
          handlerInfoWrapper = new HandlerInfoWrapper(type, wrappedHandlerInfo);
          handlerInfoWrapper.handledOnlyByPlugin = true;
          this._handledTypes[type] = handlerInfoWrapper;
        }

        handlerInfoWrapper.plugin = plugin;
      }
    }
  },

  /**
   * Load the set of handlers defined by the application datastore.
   */
  _loadApplicationHandlers: function() {
    var wrappedHandlerInfos = this._handlerSvc.enumerate();
    while (wrappedHandlerInfos.hasMoreElements()) {
      let wrappedHandlerInfo =
        wrappedHandlerInfos.getNext().QueryInterface(Components.interfaces.nsIHandlerInfo);
      let type = wrappedHandlerInfo.type;

      let handlerInfoWrapper;
      if (type in this._handledTypes) {
        handlerInfoWrapper = this._handledTypes[type];
      }
      else {
        handlerInfoWrapper = new HandlerInfoWrapper(type, wrappedHandlerInfo);
        this._handledTypes[type] = handlerInfoWrapper;
      }

      handlerInfoWrapper.handledOnlyByPlugin = false;
    }
  },

  //**************************************************************************//
  // View Construction

  _rebuildVisibleTypes: function() {
    // Reset the list of visible types and the visible type description counts.
    this._visibleTypes = [];
    this._visibleTypeDescriptionCount = [];

    // Get the preferences that help determine what types to show.
    var showPlugins = Services.prefs.getBoolPref(PREF_SHOW_PLUGINS_IN_LIST);
    var hidePluginsWithoutExtensions =
      Services.prefs.getBoolPref(PREF_HIDE_PLUGINS_WITHOUT_EXTENSIONS);

    for (let type in this._handledTypes) {
      let handlerInfo = this._handledTypes[type];

      // Hide plugins without associated extensions if so prefed so we don't
      // show a whole bunch of obscure types handled by plugins on Mac.
      // Note: though protocol types don't have extensions, we still show them;
      // the pref is only meant to be applied to MIME types, since plugins are
      // only associated with MIME types.
      // FIXME: should we also check the "suffixes" property of the plugin?
      // Filed as bug 395135.
      if (hidePluginsWithoutExtensions && handlerInfo.handledOnlyByPlugin &&
          handlerInfo.wrappedHandlerInfo instanceof Components.interfaces.nsIMIMEInfo &&
          !handlerInfo.primaryExtension)
        continue;

      // Hide types handled only by plugins if so prefed.
      if (handlerInfo.handledOnlyByPlugin && !showPlugins)
        continue;

      // We couldn't find any reason to exclude the type, so include it.
      this._visibleTypes.push(handlerInfo);

      if (handlerInfo.description in this._visibleTypeDescriptionCount)
        this._visibleTypeDescriptionCount[handlerInfo.description]++;
      else
        this._visibleTypeDescriptionCount[handlerInfo.description] = 1;
    }
  },

  rebuildView: function() {
    // Clear the list of entries.
    while (this._list.childNodes.length > 1)
      this._list.lastChild.remove();
    var visibleTypes = this._visibleTypes;

    // If the user is filtering the list, then only show matching types.
    if (this._filter.value)
      visibleTypes = visibleTypes.filter(this._matchesFilter, this);

    for (let visibleType of visibleTypes) {
      let item = document.createElement("richlistitem");
      item.setAttribute("type", visibleType.type);
      item.setAttribute("typeDescription", this._describeType(visibleType));
      item.setAttribute("shortTypeDescription", visibleType.description);
      item.setAttribute("shortTypeDetails", this._typeDetails(visibleType));
      if (visibleType.smallIcon)
        item.setAttribute("typeIcon", visibleType.smallIcon);
      item.setAttribute("actionDescription",
                        this._describePreferredAction(visibleType));

      if (!this._setIconClassForPreferredAction(visibleType, item)) {
        item.setAttribute("actionIcon",
                          this._getIconURLForPreferredAction(visibleType));
      }

      this._list.appendChild(item);
    }

    this._selectLastSelectedType();
  },

  _matchesFilter: function(aType) {
    var filterValue = this._filter.value.toLowerCase();
    return this._describeType(aType).toLowerCase().includes(filterValue) ||
           this._describePreferredAction(aType).toLowerCase().includes(filterValue);
  },

  /**
   * Describe, in a human-readable fashion, the type represented by the given
   * handler info object.  Normally this is just the description provided by
   * the info object, but if more than one object presents the same description,
   * then we annotate the duplicate descriptions with the type itself to help
   * users distinguish between those types.
   *
   * @param aHandlerInfo {nsIHandlerInfo} the type being described
   * @return {string} a description of the type
   */
  _describeType: function(aHandlerInfo) {
    let details = this._typeDetails(aHandlerInfo);

    if (details)
      return this._prefsBundle.getFormattedString("typeDescriptionWithDetails",
                                                  [aHandlerInfo.description,
                                                   details]);
    return aHandlerInfo.description;
  },

  /**
   * Get the details for the type represented by the given handler info
   * object.
   *
   * @param aHandlerInfo {nsIHandlerInfo} the type to get the extensions for.
   * @return {string} the extensions for the type
   */
  _typeDetails: function(aHandlerInfo) {
    let exts = [];
    if (aHandlerInfo.wrappedHandlerInfo instanceof Components.interfaces.nsIMIMEInfo) {
      let extIter = aHandlerInfo.wrappedHandlerInfo.getFileExtensions();
      while(extIter.hasMore()) {
        let ext = "."+extIter.getNext();
        if (!exts.includes(ext))
          exts.push(ext);
      }
    }
    exts.sort();
    exts = exts.join(", ");
    if (this._visibleTypeDescriptionCount[aHandlerInfo.description] > 0) {
      if (exts)
        return this._prefsBundle.getFormattedString("typeDetailsWithTypeAndExt",
                                                    [aHandlerInfo.type,
                                                     exts]);
      return this._prefsBundle.getFormattedString("typeDetailsWithTypeOrExt",
                                                  [ aHandlerInfo.type]);
    }
    if (exts)
      return this._prefsBundle.getFormattedString("typeDescriptionWithExt",
                                                  [exts]);
    return exts;
  },
  /**
   * Describe, in a human-readable fashion, the preferred action to take on
   * the type represented by the given handler info object.
   *
   * XXX Should this be part of the HandlerInfoWrapper interface?  It would
   * violate the separation of model and view, but it might make more sense
   * nonetheless (f.e. it would make sortTypes easier).
   *
   * @param aHandlerInfo {nsIHandlerInfo} the type whose preferred action
   *                                      is being described
   * @return {string} a description of the action
   */
  _describePreferredAction: function(aHandlerInfo) {
    // alwaysAskBeforeHandling overrides the preferred action, so if that flag
    // is set, then describe that behavior instead.  For most types, this is
    // the "alwaysAsk" string, but for the feed type we show something special.
    if (aHandlerInfo.alwaysAskBeforeHandling)
        return this._prefsBundle.getString("alwaysAsk");

    switch (aHandlerInfo.preferredAction) {
      case Components.interfaces.nsIHandlerInfo.saveToDisk:
        return this._prefsBundle.getString("saveFile");

      case Components.interfaces.nsIHandlerInfo.useHelperApp:
        var preferredApp = aHandlerInfo.preferredApplicationHandler;
        var name;
        if (preferredApp instanceof Components.interfaces.nsILocalHandlerApp)
          name = getDisplayNameForFile(preferredApp.executable);
        else
          name = preferredApp.name;
        return this._prefsBundle.getFormattedString("useApp", [name]);

      case Components.interfaces.nsIHandlerInfo.handleInternally:
        // For other types, handleInternally looks like either useHelperApp
        // or useSystemDefault depending on whether or not there's a preferred
        // handler app.
        if (this.isValidHandlerApp(aHandlerInfo.preferredApplicationHandler))
          return aHandlerInfo.preferredApplicationHandler.name;

        return aHandlerInfo.defaultDescription;

        // XXX Why don't we say the app will handle the type internally?
        // Is it because the app can't actually do that?  But if that's true,
        // then why would a preferredAction ever get set to this value
        // in the first place?

      case Components.interfaces.nsIHandlerInfo.useSystemDefault:
        return this._prefsBundle.getFormattedString("useDefault",
                                                    [aHandlerInfo.defaultDescription]);

      case kActionUsePlugin:
        return this._prefsBundle.getFormattedString("usePluginIn",
                                                    [aHandlerInfo.plugin.name,
                                                     this._brandShortName]);
      default:
        // Hopefully this never happens.
        Components.utils.reportError("No description for action " + aHandlerInfo.preferredAction + " found!");
        return "";
    }
  },

  _selectLastSelectedType: function() {
    // If the list is disabled by the pref.downloads.disable_button.edit_actions
    // preference being locked, then don't select the type, as that would cause
    // it to appear selected, with a different background and an actions menu
    // that makes it seem like you can choose an action for the type.
    if (this._list.disabled)
      return;

    var lastSelectedType = this._list.getAttribute("lastSelectedType");
    if (!lastSelectedType)
      return;

    let item = this._list.querySelector('[type="' + lastSelectedType + '"]');
    if (!item)
      return;

    this._list.selectedItem = item;
  },

  /**
   * Whether or not the given handler app is valid.
   * @param aHandlerApp {nsIHandlerApp} the handler app in question
   * @return {boolean} whether or not it's valid
   */
  isValidHandlerApp: function(aHandlerApp) {
    if (!aHandlerApp)
      return false;

    if (aHandlerApp instanceof Components.interfaces.nsILocalHandlerApp)
      return this._isValidHandlerExecutable(aHandlerApp.executable);

    if (aHandlerApp instanceof Components.interfaces.nsIWebHandlerApp)
      return aHandlerApp.uriTemplate;

    if (aHandlerApp instanceof Components.interfaces.nsIWebContentHandlerInfo)
      return aHandlerApp.uri;

    return false;
  },

  _isValidHandlerExecutable: function(aExecutable) {
    let isExecutable = aExecutable &&
                       aExecutable.exists() &&
                       aExecutable.isExecutable();
// XXXben - we need to compare this with the running instance executable
//          just don't know how to do that via script...
// XXXmano TBD: can probably add this to nsIShellService
    if (AppConstants.platform == "win")
      return isExecutable && (aExecutable.leafName != (AppConstants.MOZ_APP_NAME + ".exe"));

    if (AppConstants.platform == "macosx")
      return isExecutable && (aExecutable.leafName != AppConstants.MOZ_MACBUNDLE_NAME);

    return isExecutable && (aExecutable.leafName != (AppConstants.MOZ_APP_NAME + "-bin"));
  },

  /**
   * Rebuild the actions menu for the selected entry.  Gets called by
   * the richlistitem constructor when an entry in the list gets selected.
   */
  rebuildActionsMenu: function() {
    var typeItem = this._list.selectedItem;

    if (!typeItem)
      return;

    var handlerInfo = this._handledTypes[typeItem.type];
    var menu =
      document.getAnonymousElementByAttribute(typeItem, "class", "actionsMenu");
    var menuPopup = menu.menupopup;

    // Clear out existing items.
    while (menuPopup.hasChildNodes())
      menuPopup.lastChild.remove();

    var askMenuItem = document.createElement("menuitem");
    askMenuItem.setAttribute("alwaysAsk", "true");
    {
      let label = this._prefsBundle.getString("alwaysAsk");
      askMenuItem.setAttribute("label", label);
      askMenuItem.setAttribute("tooltiptext", label);
      askMenuItem.setAttribute(APP_ICON_ATTR_NAME, "ask");
      menuPopup.appendChild(askMenuItem);
    }

    // Create a menu item for saving to disk.
    // Note: this option isn't available to protocol types, since we don't know
    // what it means to save a URL having a certain scheme to disk.
    if ((handlerInfo.wrappedHandlerInfo instanceof Components.interfaces.nsIMIMEInfo)) {
      var saveMenuItem = document.createElement("menuitem");
      saveMenuItem.setAttribute("action", Components.interfaces.nsIHandlerInfo.saveToDisk);
      let label = this._prefsBundle.getString("saveFile");
      saveMenuItem.setAttribute("label", label);
      saveMenuItem.setAttribute("tooltiptext", label);
      saveMenuItem.setAttribute(APP_ICON_ATTR_NAME, "save");
      menuPopup.appendChild(saveMenuItem);
    }

    // Add a separator to distinguish these items from the helper app items
    // that follow them.
    let menuItem = document.createElement("menuseparator");
    menuPopup.appendChild(menuItem);

    // Create a menu item for the OS default application, if any.
    if (handlerInfo.hasDefaultHandler) {
      var defaultMenuItem = document.createElement("menuitem");
      defaultMenuItem.setAttribute("action", Components.interfaces.nsIHandlerInfo.useSystemDefault);
      let label = this._prefsBundle.getFormattedString("useDefault",
                                                       [handlerInfo.defaultDescription]);
      defaultMenuItem.setAttribute("label", label);
      defaultMenuItem.setAttribute("tooltiptext", handlerInfo.defaultDescription);
      defaultMenuItem.setAttribute("image", this._getIconURLForSystemDefault(handlerInfo));

      menuPopup.appendChild(defaultMenuItem);
    }

    // Create menu items for possible handlers.
    let preferredApp = handlerInfo.preferredApplicationHandler;
    let possibleApps = handlerInfo.possibleApplicationHandlers.enumerate();
    var possibleAppMenuItems = [];
    while (possibleApps.hasMoreElements()) {
      let possibleApp = possibleApps.getNext();
      if (!this.isValidHandlerApp(possibleApp))
        continue;

      let menuItem = document.createElement("menuitem");
      menuItem.setAttribute("action", Components.interfaces.nsIHandlerInfo.useHelperApp);
      let label;
      if (possibleApp instanceof Components.interfaces.nsILocalHandlerApp)
        label = getDisplayNameForFile(possibleApp.executable);
      else
        label = possibleApp.name;
      label = this._prefsBundle.getFormattedString("useApp", [label]);
      menuItem.setAttribute("label", label);
      menuItem.setAttribute("tooltiptext", label);
      menuItem.setAttribute("image", this._getIconURLForHandlerApp(possibleApp));

      // Attach the handler app object to the menu item so we can use it
      // to make changes to the datastore when the user selects the item.
      menuItem.handlerApp = possibleApp;

      menuPopup.appendChild(menuItem);
      possibleAppMenuItems.push(menuItem);
    }

    // Create a menu item for the plugin.
    if (handlerInfo.plugin) {
      var pluginMenuItem = document.createElement("menuitem");
      pluginMenuItem.setAttribute("action", kActionUsePlugin);
      let label = this._prefsBundle.getFormattedString("usePluginIn",
                                                       [handlerInfo.plugin.name,
                                                        this._brandShortName]);
      pluginMenuItem.setAttribute("label", label);
      pluginMenuItem.setAttribute("tooltiptext", label);
      pluginMenuItem.setAttribute(APP_ICON_ATTR_NAME, "plugin");
      menuPopup.appendChild(pluginMenuItem);
    }

    // Create a menu item for selecting a local application.
    let createItem = true;
    if (AppConstants.platform == "win") {
      // On Windows, selecting an application to open another application
      // would be meaningless so we special case executables.
      var executableType = Components.classes["@mozilla.org/mime;1"]
                                     .getService(Components.interfaces.nsIMIMEService)
                                     .getTypeFromExtension("exe");
      if (handlerInfo.type == executableType)
        createItem = false;
    }

    if (createItem)
    {
      let menuItem = document.createElement("menuitem");
      menuItem.setAttribute("oncommand", "gApplicationsPane.chooseApp(event)");
      let label = this._prefsBundle.getString("useOtherApp");
      menuItem.setAttribute("label", label);
      menuItem.setAttribute("tooltiptext", label);
      menuPopup.appendChild(menuItem);
    }

    // Create a menu item for managing applications.
    if (possibleAppMenuItems.length) {
      let menuItem = document.createElement("menuseparator");
      menuPopup.appendChild(menuItem);
      menuItem = document.createElement("menuitem");
      menuItem.setAttribute("oncommand", "gApplicationsPane.manageApp(event)");
      menuItem.setAttribute("label", this._prefsBundle.getString("manageApp"));
      menuPopup.appendChild(menuItem);
    }

    menuItem = document.createElement("menuseparator");
    menuPopup.appendChild(menuItem);
    menuItem = document.createElement("menuitem");
    menuItem.setAttribute("oncommand", "gApplicationsPane.confirmDelete(event)");
    menuItem.setAttribute("label", this._prefsBundle.getString("delete"));
    menuPopup.appendChild(menuItem);

    // Select the item corresponding to the preferred action.  If the always
    // ask flag is set, it overrides the preferred action.  Otherwise we pick
    // the item identified by the preferred action (when the preferred action
    // is to use a helper app, we have to pick the specific helper app item).
    if (handlerInfo.alwaysAskBeforeHandling)
      menu.selectedItem = askMenuItem;
    else switch (handlerInfo.preferredAction) {
      case Components.interfaces.nsIHandlerInfo.handleInternally:
        menu.selectedItem = internalMenuItem;
        break;
      case Components.interfaces.nsIHandlerInfo.useSystemDefault:
        menu.selectedItem = defaultMenuItem;
        break;
      case Components.interfaces.nsIHandlerInfo.useHelperApp:
        if (preferredApp)
          menu.selectedItem =
            possibleAppMenuItems.filter(v => v.handlerApp.equals(preferredApp))[0];
        break;
      case kActionUsePlugin:
        menu.selectedItem = pluginMenuItem;
        break;
      case Components.interfaces.nsIHandlerInfo.saveToDisk:
        menu.selectedItem = saveMenuItem;
        break;
    }
    // menu.selectedItem may be null if the preferredAction is
    // useSystemDefault, but handlerInfo.hasDefaultHandler returns false.
    // For now, we'll just use the askMenuItem to avoid ugly exceptions.
    menu.previousSelectedItem = menu.selectedItem || askMenuItem;
  },


  //**************************************************************************//
  // Sorting & Filtering

  _sortColumn: null,

  /**
   * Sort the list when the user clicks on a column header.
   */
  sort: function (event) {
    var column = event.target;

    // If the user clicked on a new sort column, remove the direction indicator
    // from the old column.
    if (this._sortColumn && this._sortColumn != column)
      this._sortColumn.removeAttribute("sortDirection");

    this._sortColumn = column;

    // Set (or switch) the sort direction indicator.
    if (column.getAttribute("sortDirection") == "ascending")
      column.setAttribute("sortDirection", "descending");
    else
      column.setAttribute("sortDirection", "ascending");

    this._sortVisibleTypes();
    this.rebuildView();
  },

  /**
   * Sort the list of visible types by the current sort column/direction.
   */
  _sortVisibleTypes: function() {
    if (!this._sortColumn)
      return;

    var t = this;

    function sortByType(a, b) {
      return t._describeType(a).toLowerCase()
              .localeCompare(t._describeType(b).toLowerCase());
    }

    function sortByAction(a, b) {
      return t._describePreferredAction(a).toLowerCase()
              .localeCompare(t._describePreferredAction(b).toLowerCase());
    }

    switch (this._sortColumn.getAttribute("value")) {
      case "type":
        this._visibleTypes.sort(sortByType);
        break;
      case "action":
        this._visibleTypes.sort(sortByAction);
        break;
    }

    if (this._sortColumn.getAttribute("sortDirection") == "descending")
      this._visibleTypes.reverse();
  },

  focusFilterBox: function() {
    this._filter.focus();
    this._filter.select();
  },

  //**************************************************************************//
  // Changes

  onSelectAction: function(aActionItem) {
    this._storingAction = true;

    let typeItem = this._list.selectedItem;
    let menu = document.getAnonymousElementByAttribute(typeItem, "class",
                                                       "actionsMenu");
    menu.previousSelectedItem = aActionItem;
    try {
      this._storeAction(aActionItem);
    }
    finally {
      this._storingAction = false;
    }
  },

  _storeAction: function(aActionItem) {
    var typeItem = this._list.selectedItem;
    var handlerInfo = this._handledTypes[typeItem.type];

    if (aActionItem.hasAttribute("alwaysAsk")) {
      handlerInfo.alwaysAskBeforeHandling = true;
    }
    else if (aActionItem.hasAttribute("action")) {
      let action = parseInt(aActionItem.getAttribute("action"));

      // Set the plugin state if we're enabling or disabling a plugin.
      if (action == kActionUsePlugin)
        handlerInfo.enablePluginType();
      else if (handlerInfo.plugin && !handlerInfo.isDisabledPluginType)
        handlerInfo.disablePluginType();

      // Set the preferred application handler.
      // We leave the existing preferred app in the list when we set
      // the preferred action to something other than useHelperApp so that
      // legacy datastores that don't have the preferred app in the list
      // of possible apps still include the preferred app in the list of apps
      // the user can choose to handle the type.
      if (action == Components.interfaces.nsIHandlerInfo.useHelperApp)
        handlerInfo.preferredApplicationHandler = aActionItem.handlerApp;

      // Set the "always ask" flag.
      handlerInfo.alwaysAskBeforeHandling = false;

      // Set the preferred action.
      handlerInfo.preferredAction = action;
    }

    handlerInfo.store();

    // Make sure the handler info object is flagged to indicate that there is
    // now some user configuration for the type.
    handlerInfo.handledOnlyByPlugin = false;

    // Update the action label and image to reflect the new preferred action.
    typeItem.setAttribute("actionDescription",
                          this._describePreferredAction(handlerInfo));
    if (!this._setIconClassForPreferredAction(handlerInfo, typeItem)) {
      typeItem.setAttribute("actionIcon",
                            this._getIconURLForPreferredAction(handlerInfo));
    }
  },

  manageApp: function(aEvent) {
    // Don't let the normal "on select action" handler get this event,
    // as we handle it specially ourselves.
    aEvent.stopPropagation();

    var typeItem = this._list.selectedItem;
    var handlerInfo = this._handledTypes[typeItem.type];

    if (this._loadInContent) {
      gSubDialog.open(
        "chrome://messenger/content/preferences/applicationManager.xul",
        "resizable=no", handlerInfo);
    } else {
      document.documentElement.openSubDialog(
        "chrome://messenger/content/preferences/applicationManager.xul",
        "", handlerInfo);
    };

    // Rebuild the actions menu so that we revert to the previous selection,
    // or "Always ask" if the previous default application has been removed
    this.rebuildActionsMenu();

    // update the richlistitem too. Will be visible when selecting another row
    typeItem.setAttribute("actionDescription",
                          this._describePreferredAction(handlerInfo));
    if (!this._setIconClassForPreferredAction(handlerInfo, typeItem)) {
      typeItem.setAttribute("actionIcon",
                            this._getIconURLForPreferredAction(handlerInfo));
    }
  },

  chooseApp: function(aEvent) {
    // Don't let the normal "on select action" handler get this event,
    // as we handle it specially ourselves.
    aEvent.stopPropagation();

    var handlerApp;

    if (AppConstants.platform == "win") {
    var params = {};
    var handlerInfo = this._handledTypes[this._list.selectedItem.type];

    params.mimeInfo = handlerInfo.wrappedHandlerInfo;

    params.title         = this._prefsBundle.getString("fpTitleChooseApp");
    params.description   = handlerInfo.description;
    params.filename      = null;
    params.handlerApp    = null;

    if (this._loadInContent) {
      gSubDialog.open("chrome://global/content/appPicker.xul",
                      "resizable=no", params);
    } else {
      window.openDialog("chrome://global/content/appPicker.xul", null,
                        "chrome,modal,centerscreen,titlebar,dialog=yes",
                        params);
    };

    if (params.handlerApp &&
        params.handlerApp.executable &&
        params.handlerApp.executable.isFile()) {
      handlerApp = params.handlerApp;

      // Add the app to the type's list of possible handlers.
      handlerInfo.addPossibleApplicationHandler(handlerApp);
    }
    } else {
    var fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
    var winTitle = this._prefsBundle.getString("fpTitleChooseApp");
    fp.init(window, winTitle, Components.interfaces.nsIFilePicker.modeOpen);
    fp.appendFilters(Components.interfaces.nsIFilePicker.filterApps);

    // Prompt the user to pick an app.  If they pick one, and it's a valid
    // selection, then add it to the list of possible handlers.
    if (fp.show() == Components.interfaces.nsIFilePicker.returnOK && fp.file &&
        this._isValidHandlerExecutable(fp.file)) {
      handlerApp = Components.classes["@mozilla.org/uriloader/local-handler-app;1"]
                             .createInstance(Components.interfaces.nsILocalHandlerApp);
      handlerApp.name = getDisplayNameForFile(fp.file);
      handlerApp.executable = fp.file;

      // Add the app to the type's list of possible handlers.
      let handlerInfo = this._handledTypes[this._list.selectedItem.type];
      handlerInfo.addPossibleApplicationHandler(handlerApp);
    }
    }

    // Rebuild the actions menu whether the user picked an app or canceled.
    // If they picked an app, we want to add the app to the menu and select it.
    // If they canceled, we want to go back to their previous selection.
    this.rebuildActionsMenu();

    // If the user picked a new app from the menu, select it.
    if (handlerApp) {
      let typeItem = this._list.selectedItem;
      let actionsMenu =
        document.getAnonymousElementByAttribute(typeItem, "class", "actionsMenu");
      let menuItems = actionsMenu.menupopup.childNodes;
      for (let i = 0; i < menuItems.length; i++) {
        let menuItem = menuItems[i];
        if (menuItem.handlerApp && menuItem.handlerApp.equals(handlerApp)) {
          actionsMenu.selectedIndex = i;
          this.onSelectAction(menuItem);
          break;
        }
      }
    }
  },

  // Mark which item in the list was last selected so we can reselect it
  // when we rebuild the list or when the user returns to the prefpane.
  onSelectionChanged: function() {
    if (this._list.selectedItem)
      this._list.setAttribute("lastSelectedType",
                              this._list.selectedItem.getAttribute("type"));
  },

  confirmDelete: function(aEvent) {
    aEvent.stopPropagation();
    if (Services.prompt.confirm(null,
                                this._prefsBundle.getString("confirmDeleteTitle"),
                                this._prefsBundle.getString("confirmDeleteText")))
      this.onDelete(aEvent);
    else {
      // They hit cancel, so return them to the previously selected item.
      let typeItem = this._list.selectedItem;
      let menu = document.getAnonymousElementByAttribute(this._list.selectedItem,
                                                         "class", "actionsMenu");
      menu.selectedItem = menu.previousSelectedItem;
    }
  },

  onDelete: function(aEvent) {
    // We want to delete if either the request came from the confirmDelete
    // method (which is the only thing that populates the aEvent parameter),
    // or we've hit the delete/backspace key while the list has focus.
    if ((aEvent || document.commandDispatcher.focusedElement == this._list) &&
        this._list.selectedIndex != -1) {
      let typeItem = this._list.getItemAtIndex(this._list.selectedIndex);
      let handlerInfo = this._handledTypes[typeItem.type];
      this._list.removeItemAt(this._list.selectedIndex);
      let index = this._visibleTypes.indexOf(handlerInfo);
      if (index != -1)
        this._visibleTypes.splice(index, 1);
      handlerInfo.remove();
      delete this._handledTypes[typeItem.type];
    }
  },

  _setIconClassForPreferredAction: function(aHandlerInfo, aElement) {
    // If this returns true, the attribute that CSS sniffs for was set to something
    // so you shouldn't manually set an icon URI.
    // This removes the existing actionIcon attribute if any, even if returning false.
    aElement.removeAttribute("actionIcon");

    if (aHandlerInfo.alwaysAskBeforeHandling) {
      aElement.setAttribute(APP_ICON_ATTR_NAME, "ask");
      return true;
    }

    switch (aHandlerInfo.preferredAction) {
      case Components.interfaces.nsIHandlerInfo.saveToDisk:
        aElement.setAttribute(APP_ICON_ATTR_NAME, "save");
        return true;

      case Components.interfaces.nsIHandlerInfo.handleInternally:
        break;

      case kActionUsePlugin:
        aElement.setAttribute(APP_ICON_ATTR_NAME, "plugin");
        return true;
    }
    aElement.removeAttribute(APP_ICON_ATTR_NAME);
    return false;
  },

  _getIconURLForPreferredAction: function(aHandlerInfo) {
    switch (aHandlerInfo.preferredAction) {
      case Components.interfaces.nsIHandlerInfo.useSystemDefault:
        return this._getIconURLForSystemDefault(aHandlerInfo);

      case Components.interfaces.nsIHandlerInfo.useHelperApp:
        let preferredApp = aHandlerInfo.preferredApplicationHandler;
        if (this.isValidHandlerApp(preferredApp))
          return this._getIconURLForHandlerApp(preferredApp);
    }
    // This should never happen, but if preferredAction is set to some weird
    // value, then fall back to the generic application icon.
    return ICON_URL_APP;
  },

  _getIconURLForHandlerApp: function(aHandlerApp) {
    if (aHandlerApp instanceof Components.interfaces.nsILocalHandlerApp)
      return this._getIconURLForFile(aHandlerApp.executable);

    if (aHandlerApp instanceof Components.interfaces.nsIWebHandlerApp)
      return this._getIconURLForWebApp(aHandlerApp.uriTemplate);

    if (aHandlerApp instanceof Components.interfaces.nsIWebContentHandlerInfo)
      return this._getIconURLForWebApp(aHandlerApp.uri)

    // We know nothing about other kinds of handler apps.
    return "";
  },

  _getIconURLForFile: function(aFile) {
    let urlSpec = Services.io.getProtocolHandler("file")
      .QueryInterface(Components.interfaces.nsIFileProtocolHandler)
      .getURLSpecFromFile(aFile);

    return "moz-icon://" + urlSpec + "?size=16";
  },

  _getIconURLForWebApp: function(aWebAppURITemplate) {
    var uri = Services.io.newURI(aWebAppURITemplate, null, null);

    // Unfortunately we can't use the favicon service to get the favicon,
    // because the service looks in the annotations table for a record with
    // the exact URL we give it, and users won't have such records for URLs
    // they don't visit, and users won't visit the web app's URL template,
    // they'll only visit URLs derived from that template (i.e. with %s
    // in the template replaced by the URL of the content being handled).

    if (/^https?/.test(uri.scheme))
      return uri.prePath + "/favicon.ico";

    return /^https?/.test(uri.scheme) ? uri.resolve("/favicon.ico") : "";
  },

  _getIconURLForSystemDefault: function(aHandlerInfo) {
    // Handler info objects for MIME types on some OSes implement a property bag
    // interface from which we can get an icon for the default app, so if we're
    // dealing with a MIME type on one of those OSes, then try to get the icon.
    if ("wrappedHandlerInfo" in aHandlerInfo) {
      let wrappedHandlerInfo = aHandlerInfo.wrappedHandlerInfo;

      if (wrappedHandlerInfo instanceof Components.interfaces.nsIMIMEInfo &&
          wrappedHandlerInfo instanceof Components.interfaces.nsIPropertyBag) {
        try {
          let url = wrappedHandlerInfo.getProperty("defaultApplicationIconURL");
          if (url)
            return url + "?size=16";
        }
        catch(ex) { }
      }
    }

    // If this isn't a MIME type object on an OS that supports retrieving
    // the icon, or if we couldn't retrieve the icon for some other reason,
    // then use a generic icon.
    return ICON_URL_APP;
  }
};
