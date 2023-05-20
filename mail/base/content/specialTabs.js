/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/AddonManager.jsm");
Components.utils.import("resource:///modules/StringBundle.js");
Components.utils.import("resource://gre/modules/BrowserUtils.jsm");

function tabProgressListener(aTab, aStartsBlank) {
  this.mTab = aTab;
  this.mBrowser = aTab.browser;
  this.mBlank = aStartsBlank;
  this.mProgressListener = null;
}

tabProgressListener.prototype =
{
  mTab: null,
  mBrowser: null,
  mBlank: null,
  mProgressListener: null,

  // cache flags for correct status bar update after tab switching
  mStateFlags: 0,
  mStatus: 0,
  mMessage: "",

  // count of open requests (should always be 0 or 1)
  mRequestCount: 0,

  addProgressListener: function tPL_addProgressListener(aProgressListener) {
    this.mProgressListener = aProgressListener;
  },

  onProgressChange: function tPL_onProgressChange(aWebProgress, aRequest,
                                                  aCurSelfProgress,
                                                  aMaxSelfProgress,
                                                  aCurTotalProgress,
                                                  aMaxTotalProgress) {
    if (this.mProgressListener)
      this.mProgressListener.onProgressChange(aWebProgress, aRequest,
        aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress,
        aMaxTotalProgress);
  },
  onProgressChange64: function tPL_onProgressChange64(aWebProgress, aRequest,
                                                      aCurSelfProgress,
                                                      aMaxSelfProgress,
                                                      aCurTotalProgress,
                                                      aMaxTotalProgress) {
    if (this.mProgressListener)
      this.mProgressListener.onProgressChange64(aWebProgress, aRequest,
        aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress,
        aMaxTotalProgress);
  },
  onLocationChange: function tPL_onLocationChange(aWebProgress, aRequest,
                                                  aLocationURI, aFlags) {
    if (this.mProgressListener)
      this.mProgressListener.onLocationChange(aWebProgress, aRequest,
        aLocationURI, aFlags);
    // onLocationChange is called for both the top-level content
    // and the subframes.
    if (aWebProgress.DOMWindow == this.mBrowser.contentWindow) {
      // Don't clear the favicon if this onLocationChange was triggered
      // by a pushState or a replaceState. See bug 550565.
      if (aWebProgress.isLoadingDocument &&
          !(this.mBrowser.docShell.loadType &
            Components.interfaces.nsIDocShell.LOAD_CMD_PUSHSTATE))
        this.mBrowser.mIconURL = null;

      var location = aLocationURI ? aLocationURI.spec : "";

      // Set the reload command only if this is a report that is coming in about
      // the top-level content location change.
      if (aWebProgress.DOMWindow == this.mBrowser.contentWindow) {
        // Although we're unlikely to be loading about:blank, we'll check it
        // anyway just in case. The second condition is for new tabs, otherwise
        // the reload function is enabled until tab is refreshed.
        this.mTab.reloadEnabled =
          !((location == "about:blank" && !this.mBrowser.contentWindow.opener) ||
            location == "");
      }
    }
  },
  onStateChange: function tPL_onStateChange(aWebProgress, aRequest, aStateFlags,
                                            aStatus) {
    if (this.mProgressListener)
      this.mProgressListener.onStateChange(aWebProgress, aRequest, aStateFlags,
        aStatus);

    if (!aRequest)
      return;

    var oldBlank = this.mBlank;

    const nsIWebProgressListener = Components.interfaces.nsIWebProgressListener;
    const nsIChannel = Components.interfaces.nsIChannel;
    let tabmail = document.getElementById("tabmail");

    if (aStateFlags & nsIWebProgressListener.STATE_START) {
      this.mRequestCount++;
    }
    else if (aStateFlags & nsIWebProgressListener.STATE_STOP) {
      // Since we (try to) only handle STATE_STOP of the last request,
      // the count of open requests should now be 0.
      this.mRequestCount = 0;
    }

    if (aStateFlags & nsIWebProgressListener.STATE_START &&
        aStateFlags & nsIWebProgressListener.STATE_IS_NETWORK) {
      if (!this.mBlank) {
        this.mTab.title = specialTabs.contentTabType.loadingTabString;
        tabmail.setTabBusy(this.mTab, true);
        tabmail.setTabTitle(this.mTab);
      }

      // Set our unit testing variables accordingly
      this.mTab.pageLoading = true;
      this.mTab.pageLoaded = false;
    }
    else if (aStateFlags & nsIWebProgressListener.STATE_STOP &&
             aStateFlags & nsIWebProgressListener.STATE_IS_NETWORK) {
      this.mBlank = false;
      tabmail.setTabBusy(this.mTab, false);
      tabmail.setTabTitle(this.mTab);

      // Set our unit testing variables accordingly
      this.mTab.pageLoading = false;
      this.mTab.pageLoaded = true;

      // If we've finished loading, and we've not had an icon loaded from a
      // link element, then we try using the default icon for the site.
      if (aWebProgress.DOMWindow == this.mBrowser.contentWindow &&
        !this.mBrowser.mIconURL)
        specialTabs.useDefaultIcon(this.mTab);
    }
  },
  onStatusChange: function tPL_onStatusChange(aWebProgress, aRequest, aStatus,
                                              aMessage) {
    if (this.mProgressListener)
      this.mProgressListener.onStatusChange(aWebProgress, aRequest, aStatus,
        aMessage);
  },
  onSecurityChange: function tPL_onSecurityChange(aWebProgress, aRequest,
                                                  aState) {
    if (this.mProgressListener)
      this.mProgressListener.onSecurityChange(aWebProgress, aRequest, aState);
  },
  onRefreshAttempted: function tPL_OnRefreshAttempted(aWebProgress, aURI,
                                                      aDelay, aSameURI) {
    if (this.mProgressListener)
      this.mProgressListener.onRefreshAttempted(aWebProgress, aURI, aDelay,
        aSameURI);
  },
  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIWebProgressListener,
                                         Components.interfaces.nsIWebProgressListener2,
                                         Components.interfaces.nsISupportsWeakReference])
};

var DOMLinkHandler = {
  handleEvent: function (event) {
    switch (event.type) {
    case "DOMLinkAdded":
      this.onLinkAdded(event);
      break;
    }
  },
  onLinkAdded: function (event) {
    let link = event.originalTarget;
    let rel = link.rel && link.rel.toLowerCase();
    if (!link || !link.ownerDocument || !rel || !link.href)
      return;

    if (rel.split(/\s+/).includes("icon")) {
      if (!Services.prefs.getBoolPref("browser.chrome.site_icons"))
        return;

      let targetDoc = link.ownerDocument;
      let uri = makeURI(link.href, targetDoc.characterSet);

      // Is this a failed icon?
      if (specialTabs.mFaviconService.isFailedFavicon(uri))
        return;

      // Verify that the load of this icon is legal.
      // Some error or special pages can load their favicon.
      // To be on the safe side, only allow chrome:// favicons.
      let isAllowedPage = (targetDoc.documentURI == "about:home") ||
        ["about:neterror?",
         "about:blocked?",
         "about:certerror?"
        ].some(function (aStart) { targetDoc.documentURI.startsWith(aStart); });

      if (!isAllowedPage || !uri.schemeIs("chrome")) {
        // Be extra paraniod and just make sure we're not going to load
        // something we shouldn't. Firefox does this, so we're doing the same.
          try {
            Services.scriptSecurityManager.checkLoadURIWithPrincipal(targetDoc.nodePrincipal, uri,
                                           Components.interfaces.nsIScriptSecurityManager.DISALLOW_SCRIPT);
          }
          catch (ex) {
            return;
          }
      }

      const nsIContentPolicy = Components.interfaces.nsIContentPolicy;

      try {
        var contentPolicy = Components.classes["@mozilla.org/layout/content-policy;1"]
          .getService(nsIContentPolicy);
      }
      catch (e) {
        // Refuse to load if we can't do a security check.
        return;
      }

      // Security says okay, now ask content policy. This is probably trying to
      // ensure that the image loaded always obeys the content policy. There
      // may have been a chance that it was cached and we're trying to load it
      // direct from the cache and not the normal route.
      if (contentPolicy.shouldLoad(nsIContentPolicy.TYPE_IMAGE,
                                   uri, targetDoc.documentURIObject,
                                   link, link.type, null) !=
                                   nsIContentPolicy.ACCEPT)
        return;

      let tab = document.getElementById("tabmail")
                        .getBrowserForDocument(targetDoc.defaultView);

      // If we don't have a browser/tab, then don't load the icon.
      if (!tab)
        return;

      // Just set the url on the browser and we'll display the actual icon
      // when we finish loading the page.
      specialTabs.setTabIcon(tab, link.href);
    }
  }
};

var contentTabBaseType = {
  inContentWhitelist: ['about:addons', 'about:preferences'],
  shouldSwitchTo: function onSwitchTo({contentPage: aContentPage}) {
    let tabmail = document.getElementById("tabmail");
    let tabInfo = tabmail.tabInfo;

    // Remove any anchors - especially for the about: pages, we just want
    // to re-use the same tab.
    let regEx = new RegExp("#.*");

    let contentUrl = aContentPage.replace(regEx, "");

    for (let selectedIndex = 0; selectedIndex < tabInfo.length;
         ++selectedIndex) {
      if (tabInfo[selectedIndex].mode.name == this.name &&
          tabInfo[selectedIndex].browser.currentURI.spec
                                .replace(regEx, "") == contentUrl) {
        // Ensure we go to the correct location on the page.
        tabInfo[selectedIndex].browser
                              .setAttribute("src", aContentPage);
        return selectedIndex;
      }
    }
    return -1;
  },

  closeTab: function onTabClosed(aTab) {
    aTab.browser.removeEventListener("DOMTitleChanged",
                                     aTab.titleListener, true);
    aTab.browser.removeEventListener("DOMWindowClose",
                                     aTab.closeListener, true);
    aTab.browser.removeEventListener("DOMLinkAdded", DOMLinkHandler, false);
    gPluginHandler.removeEventListeners(aTab.browser);
    aTab.browser.webProgress.removeProgressListener(aTab.filter);
    aTab.filter.removeProgressListener(aTab.progressListener);
    aTab.browser.destroy();
  },

  saveTabState: function onSaveTabState(aTab) {
    aTab.browser.setAttribute("type", "content-targetable");
  },

  showTab: function onShowTab(aTab) {
    aTab.browser.setAttribute("type", "content-primary");
  },

  getBrowser: function getBrowser(aTab) {
    return aTab.browser;
  },

  hideChromeForLocation: function hideChromeForLocation(aLocation) {
    return this.inContentWhitelist.includes(aLocation);
  },

  /* _setUpLoadListener attaches a load listener to the tab browser that
   * checks the loaded URL to see if it matches the inContentWhitelist.
   * If so, then we apply the disablechrome attribute to the contentTab
   * container.
   */
  _setUpLoadListener: function setUpLoadListener(aTab) {
    let self = this;

    function onLoad(aEvent) {
      let doc = aEvent.originalTarget;
      if (self.hideChromeForLocation(doc.defaultView.location.href)) {
        aTab.root.setAttribute("disablechrome", "true");
      } else {
        doc.documentElement.removeAttribute("disablechrome");
      }
    }

    aTab.loadListener = onLoad;
    aTab.browser.addEventListener("load", aTab.loadListener, true);
  },

  // Internal function used to set up the title listener on a content tab.
  _setUpTitleListener: function setUpTitleListener(aTab) {
    function onDOMTitleChanged(aEvent) {
      aTab.title = aTab.browser.contentTitle;
      document.getElementById("tabmail").setTabTitle(aTab);
    }
    // Save the function we'll use as listener so we can remove it later.
    aTab.titleListener = onDOMTitleChanged;
    // Add the listener.
    aTab.browser.addEventListener("DOMTitleChanged", aTab.titleListener, true);
  },

    /**
     * Internal function used to set up the close window listener on a content
     * tab.
     */
  _setUpCloseWindowListener: function setUpCloseWindowListener(aTab) {
    function onDOMWindowClose(aEvent) {
      if (!aEvent.isTrusted)
        return;

      // Redirect any window.close events to closing the tab. As a 3-pane tab
      // must be open, we don't need to worry about being the last tab open.
      document.getElementById("tabmail").closeTab(aTab);
      aEvent.preventDefault();
    }
    // Save the function we'll use as listener so we can remove it later.
    aTab.closeListener = onDOMWindowClose;
    // Add the listener.
    aTab.browser.addEventListener("DOMWindowClose", aTab.closeListener, true);
  },

  supportsCommand: function supportsCommand(aCommand, aTab) {
    switch (aCommand) {
      case "cmd_fullZoomReduce":
      case "cmd_fullZoomEnlarge":
      case "cmd_fullZoomReset":
      case "cmd_fullZoomToggle":
      case "cmd_find":
      case "cmd_findAgain":
      case "cmd_findPrevious":
      case "cmd_printSetup":
      case "cmd_print":
      case "button_print":
      case "cmd_stop":
      case "cmd_reload":
      // XXX print preview not currently supported - bug 497994 to implement.
      // case "cmd_printpreview":
        return true;
      default:
        return false;
    }
  },

  isCommandEnabled: function isCommandEnabled(aCommand, aTab) {
    switch (aCommand) {
      case "cmd_fullZoomReduce":
      case "cmd_fullZoomEnlarge":
      case "cmd_fullZoomReset":
      case "cmd_fullZoomToggle":
      case "cmd_find":
      case "cmd_findAgain":
      case "cmd_findPrevious":
      case "cmd_printSetup":
      case "cmd_print":
      case "button_print":
      // XXX print preview not currently supported - bug 497994 to implement.
      // case "cmd_printpreview":
        return true;
      case "cmd_reload":
        return aTab.reloadEnabled;
      case "cmd_stop":
        return aTab.busy;
      default:
        return false;
    }
  },

  doCommand: function doCommand(aCommand, aTab) {
    switch (aCommand) {
      case "cmd_fullZoomReduce":
        ZoomManager.reduce();
        break;
      case "cmd_fullZoomEnlarge":
        ZoomManager.enlarge();
        break;
      case "cmd_fullZoomReset":
        ZoomManager.reset();
        break;
      case "cmd_fullZoomToggle":
        ZoomManager.toggleZoom();
        break;
      case "cmd_find":
        aTab.findbar.onFindCommand();
        break;
      case "cmd_findAgain":
        aTab.findbar.onFindAgainCommand(false);
        break;
      case "cmd_findPrevious":
        aTab.findbar.onFindAgainCommand(true);
        break;
      case "cmd_printSetup":
        PrintUtils.showPageSetup();
        break;
      case "cmd_print":
        let browser = this.getBrowser(aTab);
        PrintUtils.printWindow(browser.outerWindowID, browser);
        break;
      // XXX print preview not currently supported - bug 497994 to implement.
      //case "cmd_printpreview":
      //  PrintUtils.printPreview();
      //  break;
      case "cmd_stop":
        aTab.browser.stop();
        break;
      case "cmd_reload":
        aTab.browser.reload();
        break;
    }
  },
};

var specialTabs = {
  _kAboutRightsVersion: 1,
  get _protocolSvc() {
    delete this._protocolSvc;
    return this._protocolSvc =
      Components.classes["@mozilla.org/uriloader/external-protocol-service;1"]
                .getService(Components.interfaces.nsIExternalProtocolService);
  },

  get mFaviconService() {
    delete this.mFaviconService;
    return this.mFaviconService =
      Components.classes["@mozilla.org/browser/favicon-service;1"]
                .getService(Components.interfaces.nsIFaviconService);
  },

  /**
   * We use an html image node to test the favicon, errors are well returned.
   * Returning a url for nsITreeView.getImageSrc() will not indicate any
   * error, and setAndFetchFaviconForPage() can't be used to detect
   * failed icons due to Bug 740457. This also ensures 301 Moved or
   * redirected urls will work (they won't otherwise in getImageSrc).
   *
   * @param  function successFunc - caller's success function.
   * @param  function errorFunc   - caller's error function.
   * @param  string iconUrl       - url to load.
   * @return HTMLImageElement imageNode
   */
  loadFaviconImageNode: function(successFunc, errorFunc, iconUrl) {
    let HTMLNS = "http://www.w3.org/1999/xhtml";
    let imageNode = document.createElementNS(HTMLNS, "img");
    imageNode.style.visibility = "collapse";
    imageNode.addEventListener("load", event => successFunc(event, iconUrl),
                               {capture: false, once: true});
    imageNode.addEventListener("error", event => errorFunc(event, iconUrl),
                               {capture: false, once: true});
    imageNode.src = iconUrl;
    return imageNode;
  },

  /**
   * Favicon request timeout, 20 seconds.
   */
  REQUEST_TIMEOUT: 20 * 1000,

  /**
   * Get the favicon by parsing for <link rel=""> with "icon" from the page's
   * dom <head>.
   *
   * @param  string aUrl          - a url from whose homepage to get a favicon.
   * @param  function aCallback   - callback.
   */
  getFaviconFromPage: function(aUrl, aCallback) {
    let url, uri;
    try {
      url = Services.io.newURI(aUrl, null, null).prePath;
      uri = Services.io.newURI(url, null, null);
    }
    catch (ex) {
      if (aCallback)
        aCallback("");
      return;
    }

    let onLoadSuccess = (aEvent => {
      let iconUri = Services.io.newURI(aEvent.target.src, null, null);
      specialTabs.mFaviconService.setAndFetchFaviconForPage(
        uri, iconUri, false,
        specialTabs.mFaviconService.FAVICON_LOAD_NON_PRIVATE,
        null, Services.scriptSecurityManager.getSystemPrincipal());

      if (aCallback)
        aCallback(iconUri.spec);
    });

    let onDownloadError = (aEvent => {
      if (aCallback)
        aCallback("");
    });

    let onDownload = (aEvent => {
      let request = aEvent.target;
      let dom = request.response;
      if (request.status != 200 || !(dom instanceof Ci.nsIDOMHTMLDocument)) {
        onDownloadError(aEvent);
        return;
      }

      let iconUri;
      let linkNode = dom.head.querySelector('link[rel="shortcut icon"],' +
                                            'link[rel="icon"]');
      let href = linkNode ? linkNode.href : null;
      try {
        iconUri = Services.io.newURI(href, null, null);
      }
      catch (ex) {
        onDownloadError(aEvent);
        return;
      }

      specialTabs.loadFaviconImageNode(onLoadSuccess, onDownloadError,
                                       iconUri.spec);
    });

    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
                    .createInstance(Ci.nsIXMLHttpRequest);
    request.open("GET", url, true);
    request.responseType = "document";
    request.onload = onDownload;
    request.onerror = onDownloadError;
    request.timeout = this.REQUEST_TIMEOUT;
    request.ontimeout = onDownloadError;
    request.send(null);
  },

  // This will open any special tabs if necessary on startup.
  openSpecialTabsOnStartup: function() {
    let browser = document.getElementById("dummycontentbrowser");

    // Manually hook up session and global history for the first browser
    // so that we don't have to load global history before bringing up a
    // window.
    // Wire up session and global history before any possible
    // progress notifications for back/forward button updating
    browser.webNavigation.sessionHistory =
      Components.classes["@mozilla.org/browser/shistory;1"]
                .createInstance(Components.interfaces.nsISHistory);
    Services.obs.addObserver(browser, "browser:purge-session-history", false);

    // remove the disablehistory attribute so the browser cleans up, as
    // though it had done this work itself
    browser.removeAttribute("disablehistory");

    // enable global history
    try {
      browser.docShell.useGlobalHistory = true;
    } catch(ex) {
      Components.utils.reportError("Places database may be locked: " + ex);
    }

    let tabmail = document.getElementById('tabmail');

    tabmail.registerTabType(this.contentTabType);
    tabmail.registerTabType(this.chromeTabType);

    // If we've upgraded (note: always get these values so that we set
    // the mstone preference for the new version):
    let [fromVer, toVer] = this.getApplicationUpgradeVersions();

    // Although this might not be really necessary because of the version checks, we'll
    // check this pref anyway and clear it so that we are consistent with what Firefox
    // actually does. It will help developers switching between branches without updating.
    if (Services.prefs.prefHasUserValue("app.update.postupdate")) {
      Services.prefs.clearUserPref("app.update.postupdate");
    }
  },

  /**
   * A tab to show content pages.
   */
  contentTabType: {
    __proto__: contentTabBaseType,
    name: "contentTab",
    perTabPanel: "vbox",
    lastBrowserId: 0,
    get loadingTabString() {
      delete this.loadingTabString;
      return this.loadingTabString = document.getElementById("bundle_messenger")
                                             .getString("loadingTab");
    },

    modes: {
      contentTab: {
        type: "contentTab",
        maxTabs: 10
      }
    },

    /**
     * This is the internal function used by content tabs to open a new tab. To
     * open a contentTab, use specialTabs.openTab("contentTab", aArgs)
     *
     * @param aArgs The options that content tabs accept.
     * @param aArgs.contentPage A string that holds the URL that is to be opened
     * @param aArgs.clickHandler The click handler for that content tab. See the
     *  "Content Tabs" article on MDC.
     * @param aArgs.onLoad A function that takes an Event and a DOMNode. It is
     *  called when the content page is done loading. The first argument is the
     *  load event, and the second argument is the xul:browser that holds the
     *  contentPage. You can access the inner tab's window object by accessing
     *  the second parameter's contentWindow property.
     */
    openTab: function contentTab_onTabOpened(aTab, aArgs) {
      if (!"contentPage" in aArgs)
        throw("contentPage must be specified");

      // First clone the page and set up the basics.
      let clone = document.getElementById("contentTab").firstChild.cloneNode(true);

      clone.setAttribute("id", "contentTab" + this.lastBrowserId);
      clone.setAttribute("collapsed", false);

      let toolbox = clone.firstChild;
      toolbox.setAttribute("id", "contentTabToolbox" + this.lastBrowserId);

      // XXXTobin: This will mean that any content tab that wants to have a toolbox
      // MUST pass {"toolbox": true} in aArgs
      if (!aArgs.toolbox) {
        toolbox.setAttribute("collapsed", true);
      }

      toolbox.firstChild.setAttribute("id", "contentTabToolbar" + this.lastBrowserId);

      aTab.panel.appendChild(clone);
      aTab.root = clone;

      // Start setting up the browser.
      aTab.browser = aTab.panel.querySelector("browser");
      aTab.toolbar = aTab.panel.querySelector(".contentTabToolbar");

      // As we're opening this tab, showTab may not get called, so set
      // the type according to if we're opening in background or not.
      let background = ("background" in aArgs) && aArgs.background;
      aTab.browser.setAttribute("type", background ? "content-targetable" :
                                                     "content-primary");

      aTab.browser.setAttribute("id", "contentTabBrowser" + this.lastBrowserId);

      aTab.clickHandler = "clickHandler" in aArgs && aArgs.clickHandler ?
                          aArgs.clickHandler :
                          "specialTabs.defaultClickHandler(event);";
      aTab.browser.setAttribute("onclick", aTab.clickHandler);

      // Set this attribute so that when favicons fail to load, we remove the
      // image attribute and just show the default tab icon.
      aTab.tabNode.setAttribute("onerror", "this.removeAttribute('image');");

      aTab.browser.addEventListener("DOMLinkAdded", DOMLinkHandler, false);
      gPluginHandler.addEventListeners(aTab.browser);

      // Now initialise the find bar.
      aTab.findbar = aTab.panel.querySelector("findbar");
      aTab.findbar.setAttribute("browserid",
                                "contentTabBrowser" + this.lastBrowserId);

      // Default to reload being disabled.
      aTab.reloadEnabled = false;

      // Now set up the listeners.
      this._setUpLoadListener(aTab);
      this._setUpTitleListener(aTab);
      this._setUpCloseWindowListener(aTab);

      if ("onLoad" in aArgs) {
        aTab.browser.addEventListener("load", function _contentTab_onLoad (event) {
          aArgs.onLoad(event, aTab.browser);
          aTab.browser.removeEventListener("load", _contentTab_onLoad, true);
        }, true);
      }

      // Create a filter and hook it up to our browser
      let filter = Components.classes["@mozilla.org/appshell/component/browser-status-filter;1"]
                             .createInstance(Components.interfaces.nsIWebProgress);
      aTab.filter = filter;
      aTab.browser.webProgress.addProgressListener(filter, Components.interfaces.nsIWebProgress.NOTIFY_ALL);

      // Wire up a progress listener to the filter for this browser
      aTab.progressListener = new tabProgressListener(aTab, false);

      filter.addProgressListener(aTab.progressListener, Components.interfaces.nsIWebProgress.NOTIFY_ALL);

      if ("onListener" in aArgs)
        aArgs.onListener(aTab.browser, aTab.progressListener);

      // Initialize our unit testing variables.
      aTab.pageLoading = false;
      aTab.pageLoaded = false;

      // Now start loading the content.
      aTab.title = this.loadingTabString;

      aTab.browser.loadURI(aArgs.contentPage);

      this.lastBrowserId++;
    },
    tryCloseTab: function onTryCloseTab(aTab) {
      let docShell = aTab.browser.docShell;
      // If we have a docshell, a contentViewer, and it forbids us from closing
      // the tab, then we return false, which means, we can't close the tab. All
      // other cases return true.
      return !(docShell && docShell.contentViewer
        && !docShell.contentViewer.permitUnload());
    },
    persistTab: function onPersistTab(aTab) {
      if (aTab.browser.currentURI.spec == "about:blank")
        return null;

      let onClick = aTab.clickHandler;

      return {
        tabURI: aTab.browser.currentURI.spec,
        clickHandler: onClick ? onClick : null
      };
    },
    restoreTab: function onRestoreTab(aTabmail, aPersistedState) {
      aTabmail.openTab("contentTab", { contentPage: aPersistedState.tabURI,
                                       clickHandler: aPersistedState.clickHandler,
                                       background: true } );
    },
  },

  /**
   * Split a version number into a triple (major, minor, extension)
   * For example, 7.0.1 => [7, 0, 1]
   *             10.1a3 => [10, 1, a3]
   *             10.0 => [10, 0, ""]
   * This could be a static function, but no current reason for it to
   * be available outside this object's scope; as a method, it doesn't
   * pollute anyone else's namespace
   */
  splitVersion: function(version) {
    let re = /^(\d+)\.(\d+)\.?(.*)$/;
    let fields = re.exec(version);
    if (fields === null)
      return null;
    /* First element of the array from regex match is the entire string; drop that */
    fields.shift();
    return fields;
  },

  /**
   * In the case of an upgrade, returns the version we're upgrading
   * from, as well as the current version.  In the case of a fresh profile,
   * or the pref being set to ignore - return null and the current version.
   * In either case, updates the pref with the latest version.
   */
  getApplicationUpgradeVersions: function() {
    let savedAppVersion = null;
    let prefstring = "mailnews.start_page_override.mstone";

    try {
      savedAppVersion = Services.prefs.getCharPref(prefstring);
    } catch (ex) {}

    let currentApplicationVersion = Services.appinfo.version;

    if (savedAppVersion == "ignore")
      return [null, this.splitVersion(currentApplicationVersion)];

    if (savedAppVersion != currentApplicationVersion)
      Services.prefs.setCharPref(prefstring, currentApplicationVersion);

    return [this.splitVersion(savedAppVersion), this.splitVersion(currentApplicationVersion)];
  },

  /**
   * Looks at the existing prefs and determines if we should show about:rights
   * or not.
   *
   * This is controlled by two prefs:
   *
   *   mail.rights.override
   *     If this pref is set to false, always show the about:rights
   *     notification.
   *     If this pref is set to true, never show the about:rights notification.
   *     If the pref doesn't exist, then we fallback to checking
   *     mail.rights.version.
   *
   *   mail.rights.version
   *     If this pref isn't set or the value is less than the current version
   *     then we show the about:rights notification.
   */
  shouldShowAboutRightsNotification: function() {
    try {
      return !Services.prefs.getBoolPref("mail.rights.override");
    } catch (e) { }

    return Services.prefs.getIntPref("mail.rights.version") < this._kAboutRightsVersion;
  },

  showAboutRightsNotification: function() {
    var notifyBox = document.getElementById("mail-notification-box");

    var brandBundle =
      Services.strings.createBundle("chrome://branding/locale/brand.properties");
    var rightsBundle =
      Services.strings.createBundle("chrome://messenger/locale/aboutRights.properties");

    var productName = brandBundle.GetStringFromName("brandFullName");
    var notifyRightsText = rightsBundle.formatStringFromName("notifyRightsText",
                                                             [productName], 1);

    var buttons = [
      {
        label: rightsBundle.GetStringFromName("buttonLabel"),
        accessKey: rightsBundle.GetStringFromName("buttonAccessKey"),
        popup: null,
        callback: function(aNotificationBar, aButton) {
          // Show the about:rights tab
          document.getElementById('tabmail')
                  .openTab("contentTab", { contentPage: "about:rights",
                                           clickHandler: "specialTabs.aboutClickHandler(event);" });
        }
      }
    ];

    var box = notifyBox.appendNotification(notifyRightsText, "about-rights",
                                           null, notifyBox.PRIORITY_INFO_LOW,
                                           buttons);
    // arbitrary number, just so bar sticks around for a bit
    box.persistence = 3;

    // Set the pref to say we've displayed the notification.
    Services.prefs.setIntPref("mail.rights.version", this._kAboutRightsVersion);
  },

  /**
   * Handles links when displaying about: pages. Anything that is an about:
   * link can be loaded internally, other links are redirected to an external
   * browser.
   */
  aboutClickHandler: function aboutClickHandler(aEvent) {
    // Don't handle events that: a) aren't trusted, b) have already been
    // handled or c) aren't left-click.
    if (!aEvent.isTrusted || aEvent.defaultPrevented || aEvent.button)
      return true;

    let href = hRefForClickEvent(aEvent, true);
    if (href) {
      let uri = makeURI(href);
      if (!this._protocolSvc.isExposedProtocol(uri.scheme) ||
          uri.schemeIs("http") || uri.schemeIs("https")) {
        aEvent.preventDefault();
        openLinkExternally(href);
      }
    }
    return false;
  },

  /**
   * The default click handler for content tabs. Any clicks on links will get
   * redirected to an external browser - effectively keeping the user on one
   * page.
   */
  defaultClickHandler: function defaultClickHandler(aEvent) {
    // Don't handle events that: a) aren't trusted, b) have already been
    // handled or c) aren't left-click.
    if (!aEvent.isTrusted || aEvent.defaultPrevented || aEvent.button)
      return true;

    let href = hRefForClickEvent(aEvent, true);

    // We've explicitly allowed http, https and about as additional exposed
    // protocols in our default prefs, so these are the ones we need to check
    // for here.
    if (href) {
      let uri = makeURI(href);
      if (!this._protocolSvc.isExposedProtocol(uri.scheme) ||
          uri.schemeIs("http") || uri.schemeIs("https") ||
          uri.schemeIs("about")) {
        aEvent.preventDefault();
        openLinkExternally(href);
      }
    }
    return false;
  },

  /**
   * A site click handler for extensions to use. This does its best to limit
   * loading of links that match the regexp to within the content tab it applies
   * to within Thunderbird. Links that do not match the regexp will be loaded
   * in the external browser.
   *
   * Note: Due to the limitations of http and the possibility for redirects, if
   * sites change or use javascript, this function may not be able to ensure the
   * contentTab stays "within" a site. Extensions using this function should
   * consider this when implementing the extension.
   *
   * @param aEvent      The onclick event that is being handled.
   * @param aSiteRegexp A regexp to match against to determine if the link
   *                    clicked on should be loaded within the browser or not.
   */
  siteClickHandler: function siteClickHandler(aEvent, aSiteRegexp) {
    // Don't handle events that: a) aren't trusted, b) have already been
    // handled or c) aren't left-click.
    if (!aEvent.isTrusted || aEvent.defaultPrevented || aEvent.button)
      return true;

    let href = hRefForClickEvent(aEvent, true);

    // We've explicitly allowed http, https and about as additional exposed
    // protocols in our default prefs, so these are the ones we need to check
    // for here.
    if (href) {
      let uri = makeURI(href);
      if (!this._protocolSvc.isExposedProtocol(uri.scheme) ||
          ((uri.schemeIs("http") || uri.schemeIs("https") ||
            uri.schemeIs("about")) && !aSiteRegexp.test(uri.spec))) {
        aEvent.preventDefault();
        openLinkExternally(href);
      }
    }
    return false;
  },

  chromeTabType: {
    name: "chromeTab",
    perTabPanel: "vbox",
    lastBrowserId: 0,
    get loadingTabString() {
      delete this.loadingTabString;
      return this.loadingTabString = document.getElementById("bundle_messenger")
                                             .getString("loadingTab");
    },

    modes: {
      chromeTab: {
        type: "chromeTab",
        maxTabs: 10
      }
    },

    shouldSwitchTo: ({ chromePage: x }) =>
      contentTabBaseType.shouldSwitchTo({ contentPage: x }),

    /**
     * This is the internal function used by chrome tabs to open a new tab. To
     * open a chromeTab, use specialTabs.openTab("chromeTab", aArgs)
     *
     * @param aArgs The options that chrome tabs accept.
     * @param aArgs.chromePage A string that holds the URL that is to be opened
     * @param aArgs.clickHandler The click handler for that chrome tab. See the
     *  "Content Tabs" article on MDC.
     * @param aArgs.onLoad A function that takes an Event and a DOMNode. It is
     *  called when the chrome page is done loading. The first argument is the
     *  load event, and the second argument is the xul:browser that holds the
     *  chromePage. You can access the inner tab's window object by accessing
     *  the second parameter's chromeWindow property.
     */
    openTab: function chromeTab_onTabOpened(aTab, aArgs) {
      if (!"chromePage" in aArgs)
        throw("chromePage must be specified");

      // First clone the page and set up the basics.
      let clone = document.getElementById("chromeTab").firstChild.cloneNode(true);

      clone.setAttribute("id", "chromeTab" + this.lastBrowserId);
      clone.setAttribute("collapsed", false);

      let toolbox = clone.firstChild;
      toolbox.setAttribute("id", "chromeTabToolbox" + this.lastBrowserId);

      // XXXTobin: This will mean that any chrome tab that wants to have a toolbox
      // MUST pass {"toolbox": true} in aArgs
      if (!aArgs.toolbox) {
        toolbox.setAttribute("collapsed", true);
      }

      toolbox.firstChild.setAttribute("id", "chromeTabToolbar" + this.lastBrowserId);

      aTab.panel.appendChild(clone);

      // Start setting up the browser.
      aTab.browser = aTab.panel.querySelector("browser");

      // As we're opening this tab, showTab may not get called, so set
      // the type according to if we're opening in background or not.
      let background = ("background" in aArgs) && aArgs.background;
      // XXX not setting type as it's chrome
      //aTab.browser.setAttribute("type", background ? "content-targetable" :
      //                                               "content-primary");

      aTab.browser.setAttribute("onclick",
                                "clickHandler" in aArgs && aArgs.clickHandler ?
                                aArgs.clickHandler :
                                "specialTabs.defaultClickHandler(event);");

      // Set this attribute so that when favicons fail to load, we remove the
      // image attribute and just show the default tab icon.
      aTab.tabNode.setAttribute("onerror", "this.removeAttribute('image');");

      aTab.browser.addEventListener("DOMLinkAdded", DOMLinkHandler, false);


      aTab.browser.setAttribute("id", "chromeTabBrowser" + this.lastBrowserId);

      // Now set up the listeners.
      this._setUpTitleListener(aTab);
      this._setUpCloseWindowListener(aTab);
      if ("onLoad" in aArgs) {
        aTab.browser.addEventListener("load", function _chromeTab_onLoad (event) {
          aArgs.onLoad(event, aTab.browser);
          aTab.browser.removeEventListener("load", _chromeTab_onLoad, true);
        }, true);
      }

      // Now start loading the content.
      aTab.title = this.loadingTabString;
      aTab.browser.loadURI(aArgs.chromePage);

      this.lastBrowserId++;
    },
    tryCloseTab: function onTryCloseTab(aTab) {
      let docShell = aTab.browser.docShell;
      // If we have a docshell, a contentViewer, and it forbids us from closing
      // the tab, then we return false, which means, we can't close the tab. All
      // other cases return true.
      return !(docShell && docShell.contentViewer
        && !docShell.contentViewer.permitUnload());
    },
    closeTab: function onTabClosed(aTab) {
      aTab.browser.removeEventListener("load", aTab.loadListener, true);
      aTab.browser.removeEventListener("DOMTitleChanged",
                                       aTab.titleListener, true);
      aTab.browser.removeEventListener("DOMWindowClose",
                                       aTab.closeListener, true);
      aTab.browser.removeEventListener("DOMLinkAdded", DOMLinkHandler, false);
      aTab.browser.destroy();
    },
    saveTabState: function onSaveTabState(aTab) {
    },
    showTab: function onShowTab(aTab) {
    },
    persistTab: function onPersistTab(aTab) {
      if (aTab.browser.currentURI.spec == "about:blank")
        return null;

      let onClick = aTab.browser.getAttribute("onclick");

      return {
        tabURI: aTab.browser.currentURI.spec,
        clickHandler: onClick ? onClick : null
      };
    },
    restoreTab: function onRestoreTab(aTabmail, aPersistedState) {
      aTabmail.openTab("chromeTab", { chromePage: aPersistedState.tabURI,
                                      clickHandler: aPersistedState.clickHandler,
                                      background: true } );
    },
    onTitleChanged: function onTitleChanged(aTab) {
      aTab.title = aTab.browser.contentDocument.title;
    },
    supportsCommand: function supportsCommand(aCommand, aTab) {
      switch (aCommand) {
        case "cmd_fullZoomReduce":
        case "cmd_fullZoomEnlarge":
        case "cmd_fullZoomReset":
        case "cmd_fullZoomToggle":
        case "cmd_printSetup":
        case "cmd_print":
        case "button_print":
        // XXX print preview not currently supported - bug 497994 to implement.
        // case "cmd_printpreview":
          return true;
        default:
          return false;
      }
    },
    isCommandEnabled: function isCommandEnabled(aCommand, aTab) {
      switch (aCommand) {
        case "cmd_fullZoomReduce":
        case "cmd_fullZoomEnlarge":
        case "cmd_fullZoomReset":
        case "cmd_fullZoomToggle":
        case "cmd_printSetup":
        case "cmd_print":
        case "button_print":
        // XXX print preview not currently supported - bug 497994 to implement.
        // case "cmd_printpreview":
          return true;
        default:
          return false;
      }
    },
    doCommand: function isCommandEnabled(aCommand, aTab) {
      switch (aCommand) {
        case "cmd_fullZoomReduce":
          ZoomManager.reduce();
          break;
        case "cmd_fullZoomEnlarge":
          ZoomManager.enlarge();
          break;
        case "cmd_fullZoomReset":
          ZoomManager.reset();
          break;
        case "cmd_fullZoomToggle":
          ZoomManager.toggleZoom();
          break;
        case "cmd_printSetup":
          PrintUtils.showPageSetup();
          break;
        case "cmd_print":
          let browser = this.getBrowser(aTab);
          PrintUtils.printWindow(browser.outerWindowID, browser);
          break;
        // XXX print preview not currently supported - bug 497994 to implement.
        //case "cmd_printpreview":
        //  PrintUtils.printPreview();
        //  break;
      }
    },
    getBrowser: function getBrowser(aTab) {
      return aTab.browser;
    },
    // Internal function used to set up the title listener on a content tab.
    _setUpTitleListener: function setUpTitleListener(aTab) {
      function onDOMTitleChanged(aEvent) {
        document.getElementById("tabmail").setTabTitle(aTab);
      }
      // Save the function we'll use as listener so we can remove it later.
      aTab.titleListener = onDOMTitleChanged;
      // Add the listener.
      aTab.browser.addEventListener("DOMTitleChanged",
                                    aTab.titleListener, true);
    },
    /**
     * Internal function used to set up the close window listener on a content
     * tab.
     */
    _setUpCloseWindowListener: function setUpCloseWindowListener(aTab) {
      function onDOMWindowClose(aEvent) {
      try {
        if (!aEvent.isTrusted)
          return;

        // Redirect any window.close events to closing the tab. As a 3-pane tab
        // must be open, we don't need to worry about being the last tab open.
        document.getElementById("tabmail").closeTab(aTab);
        aEvent.preventDefault();
      } catch (e) {
        logException(e);
      }
      }
      // Save the function we'll use as listener so we can remove it later.
      aTab.closeListener = onDOMWindowClose;
      // Add the listener.
      aTab.browser.addEventListener("DOMWindowClose",
                                    aTab.closeListener, true);
    }
  },

  /**
   * Determine if we should load fav icons or not.
   *
   * @param aURI  An nsIURI containing the current url.
   */
  _shouldLoadFavIcon: function shouldLoadFavIcon(aURI) {
    return (aURI &&
            Services.prefs.getBoolPref("browser.chrome.site_icons") &&
            Services.prefs.getBoolPref("browser.chrome.favicons") &&
            ("schemeIs" in aURI) &&
            (aURI.schemeIs("http") || aURI.schemeIs("https")));
  },

  /**
   * Tries to use the default favicon for a webpage for the specified tab.
   * If the web page is just an image, then we'll use the image itself it it
   * isn't too big.
   * Otherwise we'll use the site's favicon.ico if prefs allow us to.
   */
  useDefaultIcon: function useDefaultIcon(aTab) {
    let tabmail = document.getElementById('tabmail');
    var docURIObject = aTab.browser.contentDocument.documentURIObject;
    var icon = null;
    if (aTab.browser.contentDocument instanceof ImageDocument) {
      if (Services.prefs.getBoolPref("browser.chrome.site_icons")) {
        let sz = Services.prefs.getIntPref("browser.chrome.image_icons.max_size");
        try {
          let req = aTab.browser.contentDocument.imageRequest;
          if (req && req.image && req.image.width <= sz &&
              req.image.height <= sz)
            icon = aTab.browser.currentURI.spec;
        }
        catch (e) { }
      }
    }
    // Use documentURIObject in the check for shouldLoadFavIcon so that we do
    // the right thing with about:-style error pages.
    else if (this._shouldLoadFavIcon(docURIObject)) {
      let url = docURIObject.prePath + "/favicon.ico";

      if (!specialTabs.mFaviconService.isFailedFavicon(makeURI(url)))
        icon = url;
    }

    specialTabs.setTabIcon(aTab, icon);
  },

  /**
   * This sets the specified tab to load and display the given icon for the
   * page shown in the browser. It is assumed that the preferences have already
   * been checked before calling this function apprioriately.
   *
   * @param aTab  The tab to set the icon for.
   * @param aIcon A string based URL of the icon to try and load.
   */
  setTabIcon: function(aTab, aIcon) {
    if (aIcon && this.mFaviconService)
      this.mFaviconService.setAndFetchFaviconForPage(
        aTab.browser.currentURI, makeURI(aIcon), false,
        this.mFaviconService.FAVICON_LOAD_NON_PRIVATE,
        null, aTab.browser.contentPrincipal);

    // Save this off so we know about it later,
    aTab.browser.mIconURL = aIcon;
    // and display the new icon.
    document.getElementById("tabmail").setTabIcon(aTab, aIcon);
  }
};
