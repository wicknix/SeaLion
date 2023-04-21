/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/DownloadTaskbarProgress.jsm");
Components.utils.import("resource:///modules/WindowsPreviewPerTab.jsm");

this.__defineGetter__("PluralForm", function() {
  Components.utils.import("resource://gre/modules/PluralForm.jsm");
  return this.PluralForm;
});
this.__defineSetter__("PluralForm", function (val) {
  delete this.PluralForm;
  return this.PluralForm = val;
});

const REMOTESERVICE_CONTRACTID = "@mozilla.org/toolkit/remote-service;1";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
var gURLBar = null;
var gProxyButton = null;
var gProxyFavIcon = null;
var gProxyDeck = null;
var gNavigatorBundle;
var gBrandBundle;
var gNavigatorRegionBundle;
var gLastValidURLStr = "";
var gLastValidURL = null;
var gClickSelectsAll = false;
var gClickAtEndSelects = false;
var gIgnoreFocus = false;
var gIgnoreClick = false;
var gURIFixup = null;

var gInitialPages = new Set([
  "about:blank",
  "about:logopage",
  "about:privatebrowsing",
  "about:sessionrestore"
]);

//cached elements
var gBrowser = null;

const gTabStripPrefListener =
{
  domain: "browser.tabs.autoHide",
  observe: function(subject, topic, prefName)
  {
    // verify that we're changing the tab browser strip auto hide pref
    if (topic != "nsPref:changed")
      return;

    if (gBrowser.tabContainer.childNodes.length == 1 && window.toolbar.visible) {
      var stripVisibility = !Services.prefs.getBoolPref(prefName);
      gBrowser.setStripVisibilityTo(stripVisibility);
      Services.prefs.setBoolPref("browser.tabs.forceHide", false);
    }
  }
};

const gHomepagePrefListener =
{
  domain: "browser.startup.homepage",
  observe: function(subject, topic, prefName)
  {
    // verify that we're changing the home page pref
    if (topic != "nsPref:changed")
      return;

    updateHomeButtonTooltip();
  }
};

const gStatusBarPopupIconPrefListener =
{
  domain: "privacy.popups.statusbar_icon_enabled",
  observe: function(subject, topic, prefName)
  {
    if (topic != "nsPref:changed" || prefName != this.domain)
      return;

    var popupIcon = document.getElementById("popupIcon");
    if (!Services.prefs.getBoolPref(prefName))
      popupIcon.hidden = true;

    else if (gBrowser.getNotificationBox().popupCount)
      popupIcon.hidden = false;
  }
};

// popup window permission change listener
const gPopupPermListener = {

  observe: function(subject, topic, data) {
    if (topic == "popup-perm-close") {
      // close the window if we're a popup and our opener's URI matches
      // the URI in the notification
      var popupOpenerURI = maybeInitPopupContext();
      if (popupOpenerURI) {
        closeURI = Services.io.newURI(data, null, null);
        if (closeURI.host == popupOpenerURI.host)
          window.close();
      }
    }
  }
};

const gFormSubmitObserver = {
  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIFormSubmitObserver,
                                         Components.interfaces.nsIObserver]),

  panel: null,

  init: function()
  {
    this.panel = document.getElementById("invalid-form-popup");
  },

  notifyInvalidSubmit: function (aFormElement, aInvalidElements)
  {
    // We are going to handle invalid form submission attempt by focusing the
    // first invalid element and show the corresponding validation message in a
    // panel attached to the element.
    if (!aInvalidElements.length) {
      return;
    }

    // Don't show the popup if the current tab doesn't contain the invalid form.
    if (aFormElement.ownerDocument.defaultView.top != content) {
      return;
    }

    let element = aInvalidElements.queryElementAt(0, Components.interfaces.nsISupports);

    if (!(element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLButtonElement)) {
      return;
    }

    this.panel.firstChild.textContent = element.validationMessage;

    element.focus();

    // If the user interacts with the element and makes it valid or leaves it,
    // we want to remove the popup.
    // We could check for clicks but a click already removes the popup.
    function blurHandler() {
      gFormSubmitObserver.panel.hidePopup();
    }
    function inputHandler(e) {
      if (e.originalTarget.validity.valid) {
        gFormSubmitObserver.panel.hidePopup();
      } else {
        // If the element is now invalid for a new reason, we should update the
        // error message.
        if (gFormSubmitObserver.panel.firstChild.textContent !=
              e.originalTarget.validationMessage) {
          gFormSubmitObserver.panel.firstChild.textContent =
            e.originalTarget.validationMessage;
        }
      }
    }
    element.addEventListener("input", inputHandler, false);
    element.addEventListener("blur", blurHandler, false);

    // One event to bring them all and in the darkness bind them.
    this.panel.addEventListener("popuphiding", function popupHidingHandler(aEvent) {
      aEvent.target.removeEventListener("popuphiding", popupHidingHandler, false);
      element.removeEventListener("input", inputHandler, false);
      element.removeEventListener("blur", blurHandler, false);
    }, false);

    this.panel.hidden = false;

    var win = element.ownerDocument.defaultView;
    var style = win.getComputedStyle(element, null);
    var scale = win.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                   .getInterface(Components.interfaces.nsIDOMWindowUtils)
                   .fullZoom;

    var offset = style.direction == 'rtl' ? parseInt(style.paddingRight) +
                                            parseInt(style.borderRightWidth) :
                                            parseInt(style.paddingLeft) +
                                            parseInt(style.borderLeftWidth);

    offset = Math.round(offset * scale);
    this.panel.openPopup(element, "after_start", offset, 0);
  }
};

/**
* Pref listener handler functions.
* Both functions assume that observer.domain is set to
* the pref domain we want to start/stop listening to.
*/
function addPrefListener(observer)
{
  try {
    Services.prefs.addObserver(observer.domain, observer, false);
  } catch(ex) {
    dump("Failed to observe prefs: " + ex + "\n");
  }
}

function removePrefListener(observer)
{
  try {
    Services.prefs.removeObserver(observer.domain, observer);
  } catch(ex) {
    dump("Failed to remove pref observer: " + ex + "\n");
  }
}

function addPopupPermListener(observer)
{
  Services.obs.addObserver(observer, "popup-perm-close", false);
}

function removePopupPermListener(observer)
{
  Services.obs.removeObserver(observer, "popup-perm-close");
}

function addFormSubmitObserver(observer)
{
  observer.init();
  Services.obs.addObserver(observer, "invalidformsubmit", false);
}

function removeFormSubmitObserver(observer)
{
  Services.obs.removeObserver(observer, "invalidformsubmit");
}

/**
* We can avoid adding multiple load event listeners and save some time by adding
* one listener that calls all real handlers.
*/

function pageShowEventHandlers(event)
{
  checkForDirectoryListing();
}

/**
 * Determine whether or not the content area is displaying a page with frames,
 * and if so, toggle the display of the 'save frame as' menu item.
 **/
function getContentAreaFrameCount()
{
  var saveFrameItem = document.getElementById("saveframe");
  if (!content || !content.frames.length || !isContentFrame(document.commandDispatcher.focusedWindow))
    saveFrameItem.setAttribute("hidden", "true");
  else {
    var autoDownload = Services.prefs.getBoolPref("browser.download.useDownloadDir");
    goSetMenuValue("saveframe", autoDownload ? "valueSave" : "valueSaveAs");
    saveFrameItem.removeAttribute("hidden");
  }
}

function saveFrameDocument()
{
  var focusedWindow = document.commandDispatcher.focusedWindow;
  if (isContentFrame(focusedWindow))
    saveDocument(focusedWindow.document, true);
}

function updateHomeButtonTooltip()
{
  var homePage = getHomePage();
  var tooltip = document.getElementById("home-button-tooltip-inner");

  while (tooltip.hasChildNodes())
    tooltip.lastChild.remove();

  for (var i in homePage) {
    var label = document.createElementNS(XUL_NS, "label");
    label.setAttribute("value", homePage[i]);
    tooltip.appendChild(label);
  }
}

function getBrowser()
{
  if (!gBrowser)
    gBrowser = document.getElementById("content");
  return gBrowser;
}

function getHomePage()
{
  var URIs = [];
  URIs[0] = GetLocalizedStringPref("browser.startup.homepage");
  var count = Services.prefs.getIntPref("browser.startup.homepage.count");
  for (var i = 1; i < count; ++i)
    URIs[i] = GetLocalizedStringPref("browser.startup.homepage." + i);

  return URIs;
}

function UpdateBackForwardButtons()
{
  var backBroadcaster = document.getElementById("canGoBack");
  var forwardBroadcaster = document.getElementById("canGoForward");
  var upBroadcaster = document.getElementById("canGoUp");
  var browser = getBrowser();

  // Avoid setting attributes on broadcasters if the value hasn't changed!
  // Remember, guys, setting attributes on elements is expensive!  They
  // get inherited into anonymous content, broadcast to other widgets, etc.!
  // Don't do it if the value hasn't changed! - dwh

  var backDisabled = backBroadcaster.hasAttribute("disabled");
  var forwardDisabled = forwardBroadcaster.hasAttribute("disabled");
  var upDisabled = upBroadcaster.hasAttribute("disabled");
  if (backDisabled == browser.canGoBack) {
    if (backDisabled)
      backBroadcaster.removeAttribute("disabled");
    else
      backBroadcaster.setAttribute("disabled", true);
  }
  if (forwardDisabled == browser.canGoForward) {
    if (forwardDisabled)
      forwardBroadcaster.removeAttribute("disabled");
    else
      forwardBroadcaster.setAttribute("disabled", true);
  }
  if (upDisabled != !browser.currentURI.spec.replace(/[#?].*$/, "").match(/\/[^\/]+\/./)) {
    if (upDisabled)
      upBroadcaster.removeAttribute("disabled");
    else
      upBroadcaster.setAttribute("disabled", true);
  }
}

const nsIBrowserDOMWindow = Components.interfaces.nsIBrowserDOMWindow;
const nsIInterfaceRequestor = Components.interfaces.nsIInterfaceRequestor;

function nsBrowserAccess() {
}

nsBrowserAccess.prototype = {

  openURI: function openURI(aURI, aOpener, aWhere, aFlags) {

    var isExternal = !!(aFlags & nsIBrowserDOMWindow.OPEN_EXTERNAL);

    if (aOpener && isExternal) {
      Components.utils.reportError("nsBrowserAccess.openURI did not expect an opener to be " +
                                   "passed if the context is OPEN_EXTERNAL.");
      throw Components.results.NS_ERROR_FAILURE;
    }

    if (aWhere == nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW) {
      if (isExternal)
        aWhere = Services.prefs.getIntPref("browser.link.open_external");
      else
        aWhere = Services.prefs.getIntPref("browser.link.open_newwindow");
    }

    var referrer = aOpener ? aOpener.QueryInterface(nsIInterfaceRequestor)
                                    .getInterface(nsIWebNavigation)
                                    .currentURI : null;
    var uri = aURI ? aURI.spec : "about:blank";

    switch (aWhere) {
      case nsIBrowserDOMWindow.OPEN_NEWWINDOW:
        return window.openDialog(getBrowserURL(), "_blank", "all,dialog=no",
                                 uri, null, referrer);
      case nsIBrowserDOMWindow.OPEN_NEWTAB:
        var bgLoad = Services.prefs.getBoolPref("browser.tabs.loadDivertedInBackground");
        var isRelated = referrer ? true : false;
        // If we have an opener, that means that the caller is expecting access
        // to the nsIDOMWindow of the opened tab right away.
        let userContextId = aOpener && aOpener.document
                            ? aOpener.document.nodePrincipal.originAttributes.userContextId
                           : Components.interfaces.nsIScriptSecurityManager.DEFAULT_USER_CONTEXT_ID;
        let openerWindow = (aFlags & nsIBrowserDOMWindow.OPEN_NO_OPENER) ? null : aOpener;

        var newTab = gBrowser.loadOneTab(uri, {inBackground: bgLoad,
                                               fromExternal: isExternal,
                                               relatedToCurrent: isRelated,
                                               referrerURI: referrer,
                                               userContextId: userContextId,
                                               opener: openerWindow,
                                               });
        var contentWin = gBrowser.getBrowserForTab(newTab).contentWindow;
        if (!bgLoad)
          contentWin.focus();
        return contentWin;
      default:
        var loadflags = isExternal ?
                        nsIWebNavigation.LOAD_FLAGS_FROM_EXTERNAL :
                        nsIWebNavigation.LOAD_FLAGS_NONE;

        if (!aOpener) {
          if (aURI)
            gBrowser.loadURIWithFlags(aURI.spec, loadflags);
          return content;
        }
        aOpener = aOpener.top;
        if (aURI) {
          try {
            aOpener.QueryInterface(nsIInterfaceRequestor)
                   .getInterface(nsIWebNavigation)
                   .loadURI(uri, loadflags, referrer, null, null);
          } catch (e) {}
        }
        return aOpener;
    }
  },
  isTabContentWindow: function isTabContentWindow(aWindow) {
    return gBrowser.browsers.some(browser => browser.contentWindow == aWindow);
  }
}

function HandleAppCommandEvent(aEvent)
{
  aEvent.stopPropagation();
  switch (aEvent.command) {
    case "Back":
      BrowserBack();
      break;
    case "Forward":
      BrowserForward();
      break;
    case "Reload":
      BrowserReloadSkipCache();
      break;
    case "Stop":
      BrowserStop();
      break;
    case "Search":
      BrowserSearch.webSearch();
      break;
    case "Bookmarks":
      toBookmarksManager();
      break;
    case "Home":
      BrowserHome(null);
      break;
    default:
      break;
  }
}

/* window.arguments[0]: URL(s) to load
                        (string, with one or more URLs separated by \n)
 *                 [1]: character set (string)
 *                 [2]: referrer (nsIURI)
 *                 [3]: postData (nsIInputStream)
 *                 [4]: allowThirdPartyFixup (bool)
 */
function Startup()
{
  // init globals
  gNavigatorBundle = document.getElementById("bundle_navigator");
  gBrandBundle = document.getElementById("bundle_brand");
  gNavigatorRegionBundle = document.getElementById("bundle_navigator_region");

  gBrowser = document.getElementById("content");
  gURLBar = document.getElementById("urlbar");

  SetPageProxyState("invalid", null);

  var webNavigation;
  try {
    webNavigation = getWebNavigation();
    if (!webNavigation)
      throw "no XBL binding for browser";
  } catch (e) {
    alert("Error launching browser window:" + e);
    window.close(); // Give up.
    return;
  }

  // Do all UI building here:
  UpdateNavBar();
  updateWindowState();

  // set home button tooltip text
  updateHomeButtonTooltip();

  var lc = window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                 .getInterface(Components.interfaces.nsIWebNavigation)
                 .QueryInterface(Components.interfaces.nsILoadContext);
  if (lc.usePrivateBrowsing) {
    gPrivate = window;
    document.documentElement.removeAttribute("windowtype");
    var titlemodifier = document.documentElement.getAttribute("titlemodifier");
    if (titlemodifier)
      titlemodifier += " ";
    titlemodifier += document.documentElement.getAttribute("titleprivate");
    document.documentElement.setAttribute("titlemodifier", titlemodifier);
    document.title = titlemodifier;
  }

  // initialize observers and listeners
  var xw = lc.QueryInterface(Components.interfaces.nsIDocShellTreeItem)
             .treeOwner
             .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
             .getInterface(Components.interfaces.nsIXULWindow);
  xw.XULBrowserWindow = window.XULBrowserWindow = new nsBrowserStatusHandler();

  addPrefListener(gTabStripPrefListener);
  addPrefListener(gHomepagePrefListener);
  addPrefListener(gStatusBarPopupIconPrefListener);
  addPopupPermListener(gPopupPermListener);
  addFormSubmitObserver(gFormSubmitObserver);

  window.browserContentListener =
    new nsBrowserContentListener(window, getBrowser());

  // Add a capturing event listener to the content area
  // (rjc note: not the entire window, otherwise we'll get sidebar pane loads too!)
  //  so we'll be notified when onloads complete.
  var contentArea = document.getElementById("appcontent");
  contentArea.addEventListener("pageshow", function callPageShowHandlers(aEvent) {
    // Filter out events that are not about the document load we are interested in.
    if (aEvent.originalTarget == content.document)
      setTimeout(pageShowEventHandlers, 0, aEvent);
  }, true);

  // Set a sane starting width/height for all resolutions on new profiles.
  if (!document.documentElement.hasAttribute("width")) {
    var defaultHeight = screen.availHeight;
    var defaultWidth= screen.availWidth;

    // Create a narrower window for large or wide-aspect displays, to suggest
    // side-by-side page view.
    if (screen.availWidth >= 1440)
      defaultWidth /= 2;

    // Tweak sizes to be sure we don't grow outside the screen
    defaultWidth = defaultWidth - 20;
    defaultHeight = defaultHeight - 10;

    // On X, we're not currently able to account for the size of the window
    // border.  Use 28px as a guess (titlebar + bottom window border)
    if (navigator.appVersion.indexOf("X11") != -1)
      defaultHeight -= 28;

    // On small screens, default to maximized state
    if (defaultHeight <= 600)
      document.documentElement.setAttribute("sizemode", "maximized");

    document.documentElement.setAttribute("width", defaultWidth);
    document.documentElement.setAttribute("height", defaultHeight);
    // Make sure we're safe at the left/top edge of screen
    document.documentElement.setAttribute("screenX", screen.availLeft);
    document.documentElement.setAttribute("screenY", screen.availTop);
  }

  // hook up UI through progress listener
  getBrowser().addProgressListener(window.XULBrowserWindow);
  // setup the search service DOMLinkAdded listener
  getBrowser().addEventListener("DOMLinkAdded", BrowserSearch, false);
  // hook up drag'n'drop
  getBrowser().droppedLinkHandler = handleDroppedLink;

  var uriToLoad = "";

  // Check window.arguments[0]. If not null then use it for uriArray
  // otherwise the new window is being called when another browser
  // window already exists so use the New Window pref for uriArray
  if ("arguments" in window && window.arguments.length >= 1) {
    var uriArray;
    if (window.arguments[0]) {
      uriArray = window.arguments[0].toString().split('\n'); // stringify and split
    } else {
      switch (GetIntPref("browser.windows.loadOnNewWindow", 0))
      {
        default:
          uriArray = ["about:blank"];
          break;
        case 1:
          uriArray = getHomePage();
          break;
        case 2:
          uriArray = [GetStringPref("browser.history.last_page_visited")];
          break;
      }
    }
    uriToLoad = uriArray.splice(0, 1)[0];

    if (uriArray.length > 0)
      window.setTimeout(function(arg) { for (var i in arg) gBrowser.addTab(arg[i]); }, 0, uriArray);
  }

  if (/^\s*$/.test(uriToLoad))
    uriToLoad = "about:blank";

  var browser = getBrowser();

  if (uriToLoad != "about:blank") {
    if (!gInitialPages.has(uriToLoad)) {
      gURLBar.value = uriToLoad;
      browser.userTypedValue = uriToLoad;
    }
    if ("arguments" in window && window.arguments.length >= 3) {
      loadURI(uriToLoad, window.arguments[2], window.arguments[3] || null,
              window.arguments[4] || false, window.arguments[5] || false);
    } else {
      loadURI(uriToLoad);
    }
  }

  // Focus content area unless we're loading a blank or other initial
  // page, or if we weren't passed any arguments. This "breaks" the
  // javascript:window.open(); case where we don't get any arguments
  // either, but we're loading about:blank, but focusing the content
  // area is arguably correct in that case as well since the opener
  // is very likely to put some content in the new window, and then
  // the focus should be in the content area.
  var navBar = document.getElementById("nav-bar");
  if ("arguments" in window && gInitialPages.has(uriToLoad) &&
      isElementVisible(gURLBar))
    setTimeout(WindowFocusTimerCallback, 0, gURLBar);
  else
    setTimeout(WindowFocusTimerCallback, 0, content);

  // hook up browser access support
  window.browserDOMWindow = new nsBrowserAccess();

  // hook up remote support
  if (!gPrivate && REMOTESERVICE_CONTRACTID in Components.classes) {
    var remoteService =
      Components.classes[REMOTESERVICE_CONTRACTID]
                .getService(Components.interfaces.nsIRemoteService);
    remoteService.registerWindow(window);
  }

  // ensure login manager is loaded
  Components.classes["@mozilla.org/login-manager;1"].getService();

  // called when we go into full screen, even if it is
  // initiated by a web page script
  addEventListener("fullscreen", onFullScreen, true);

  addEventListener("PopupCountChanged", UpdateStatusBarPopupIcon, true);

  addEventListener("AppCommand", HandleAppCommandEvent, true);

  addEventListener("sizemodechange", updateWindowState, false);

  // does clicking on the urlbar select its contents?
  gClickSelectsAll = Services.prefs.getBoolPref("browser.urlbar.clickSelectsAll");
  gClickAtEndSelects = Services.prefs.getBoolPref("browser.urlbar.clickAtEndSelects");

  // BiDi UI
  gShowBiDi = isBidiEnabled();
  if (gShowBiDi) {
    document.getElementById("documentDirection-swap").hidden = false;
    document.getElementById("textfieldDirection-separator").hidden = false;
    document.getElementById("textfieldDirection-swap").hidden = false;
  }

  // Before and after callbacks for the customizeToolbar code
  getNavToolbox().customizeInit = BrowserToolboxCustomizeInit;
  getNavToolbox().customizeDone = BrowserToolboxCustomizeDone;
  getNavToolbox().customizeChange = BrowserToolboxCustomizeChange;

  PlacesToolbarHelper.init();

  AeroPeek.onOpenWindow(window);

  if (!gPrivate) {
    DownloadTaskbarProgress.onBrowserWindowLoad(window);

    // initialize the session-restore service
    setTimeout(InitSessionStoreCallback, 0);
  }

  window.addEventListener("MozAfterPaint", DelayedStartup, false);
}

// Minimal gBrowserInit shim to keep the Addon-SDK happy.
var gBrowserInit = {
  delayedStartupFinished: false,
}

function DelayedStartup() {
  window.removeEventListener("MozAfterPaint", DelayedStartup);

  gBrowserInit.delayedStartupFinished = true;
  Services.obs.notifyObservers(window, "browser-delayed-startup-finished", "");
}

function UpdateNavBar()
{
  var elements = getNavToolbox().getElementsByClassName("nav-bar-class");
  for (var i = 0; i < elements.length; i++) {
    var element = elements[i];
    element.classList.remove("nav-bar-last");
    element.classList.remove("nav-bar-first");
    var next = element.nextSibling;
    if (!next || !next.classList.contains("nav-bar-class"))
      element.classList.add("nav-bar-last");
    var previous = element.previousSibling;
    if (!previous || !previous.classList.contains("nav-bar-class"))
      element.classList.add("nav-bar-first");
  }
  UpdateUrlbarSearchSplitterState();
}

function UpdateUrlbarSearchSplitterState()
{
  var splitter = document.getElementById("urlbar-search-splitter");
  var urlbar = document.getElementById("nav-bar-inner");
  var searchbar = document.getElementById("search-container");

  var ibefore = null;
  if (isElementVisible(urlbar) && isElementVisible(searchbar)) {
    if (searchbar.matches("#nav-bar-inner ~ #search-container"))
      ibefore = searchbar;
    else if (urlbar.matches("#search-container ~ #nav-bar-inner"))
      ibefore = searchbar.nextSibling;
  }

  if (ibefore) {
    splitter = document.createElement("splitter");
    splitter.id = "urlbar-search-splitter";
    splitter.setAttribute("resizebefore", "flex");
    splitter.setAttribute("resizeafter", "flex");
    splitter.setAttribute("skipintoolbarset", "true");
    splitter.setAttribute("overflows", "false");
    splitter.classList.add("chromeclass-toolbar-additional",
                           "nav-bar-class");
    ibefore.parentNode.insertBefore(splitter, ibefore);
  }
}

function updateWindowState()
{
  // XXXTobin: This is totally busted and shows when coming out of both
  // full screen modes so set it to false and revisit later
  getBrowser().showWindowResizer = false;

  getBrowser().docShellIsActive =
      window.windowState != window.STATE_MINIMIZED;
}

function InitSessionStoreCallback()
{
  try {
    var ss = Components.classes["@mozilla.org/suite/sessionstore;1"]
                       .getService(Components.interfaces.nsISessionStore);
    ss.init(window);

    //Check if we have "Deferred Session Restore"
    let restoreItem = document.getElementById("historyRestoreLastSession");

    if (ss.canRestoreLastSession)
      restoreItem.removeAttribute("disabled");
  } catch(ex) {
    dump("nsSessionStore could not be initialized: " + ex + "\n");
  }
}

function WindowFocusTimerCallback(element)
{
  // This function is a redo of the fix for jag bug 91884.
  // See Bug 97067 and Bug 89214 for details.
  if (window == Services.ww.activeWindow) {
    element.focus();
  } else {
    // set the element in command dispatcher so focus will restore properly
    // when the window does become active

    if (element instanceof Components.interfaces.nsIDOMWindow) {
      document.commandDispatcher.focusedWindow = element;
      document.commandDispatcher.focusedElement = null;
    } else if (element instanceof Components.interfaces.nsIDOMElement) {
      document.commandDispatcher.focusedWindow = element.ownerDocument.defaultView;
      document.commandDispatcher.focusedElement = element;
    }
  }
}

function Shutdown()
{
  AeroPeek.onCloseWindow(window);

  PlacesStarButton.uninit();

  // shut down browser access support
  window.browserDOMWindow = null;

  getBrowser().removeEventListener("DOMLinkAdded", BrowserSearch, false);

  try {
    getBrowser().removeProgressListener(window.XULBrowserWindow);
  } catch (ex) {
    // Perhaps we didn't get around to adding the progress listener
  }

  window.XULBrowserWindow.destroy();
  window.XULBrowserWindow = null;
  window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
        .getInterface(Components.interfaces.nsIWebNavigation)
        .QueryInterface(Components.interfaces.nsIDocShellTreeItem).treeOwner
        .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
        .getInterface(Components.interfaces.nsIXULWindow)
        .XULBrowserWindow = null;

  // unregister us as a pref listener
  removePrefListener(gTabStripPrefListener);
  removePrefListener(gHomepagePrefListener);
  removePrefListener(gStatusBarPopupIconPrefListener);
  removePopupPermListener(gPopupPermListener);
  removeFormSubmitObserver(gFormSubmitObserver);

  window.browserContentListener.close();
}

function Translate()
{
  var service = GetLocalizedStringPref("browser.translation.service");
  var serviceDomain = GetLocalizedStringPref("browser.translation.serviceDomain");
  var targetURI = getWebNavigation().currentURI.spec;

  // if we're already viewing a translated page, then just reload
  if (targetURI.indexOf(serviceDomain) >= 0)
    BrowserReload();
  else {
    loadURI(encodeURI(service) + encodeURIComponent(targetURI));
  }
}

function GetTypePermFromId(aId)
{
  // Get type and action from splitting id, first is type, second is action.
  var [type, action] = aId.split("_");
  var perm = "ACCESS_" + action.toUpperCase();
  return [type, Components.interfaces.nsICookiePermission[perm]];
}

function CheckForVisibility(aEvent, aNode)
{
  CheckPermissionsMenu("popup", aNode);
  
  var uri = getBrowser().currentURI;
  var allowBlocking = Services.prefs.getBoolPref("dom.disable_open_during_load");

  // set enabled state for popup_ menu items.
  var items = aEvent.target.getElementsByAttribute("name", "popup");
  for (let item of items) {
    if (allowBlocking)
      item.removeAttribute("disabled");
    else
      item.setAttribute("disabled", "true");
  }

  document.getElementById("popupMenuSeparator").hidden = !allowBlocking;
  document.getElementById("menuitem_PopupsManage").hidden = !allowBlocking;

}

// Determine current state and check/uncheck the appropriate menu items.
function CheckPermissionsMenu(aType, aNode)
{
  var currentPerm = Services.perms.testPermission(getBrowser().currentURI, aType);
  var items = aNode.getElementsByAttribute("name", aType);
  for (let item of items) {
    // Get type and perm from id.
    var [type, perm] = GetTypePermFromId(item.id);
    item.setAttribute("checked", perm == currentPerm);
  }
}

// Perform a Cookie, Image or Popup action.
function CookieImagePopupAction(aElement)
{
  var uri = getBrowser().currentURI;
  // Get type and perm from id.
  var [type, perm] = GetTypePermFromId(aElement.id);
  if (Services.perms.testPermission(uri, type) == perm)
    return;

  Services.perms.add(uri, type, perm);

  Services.prompt.alert(window, aElement.getAttribute("title"),
                        aElement.getAttribute("msg"));
}
function OpenSessionHistoryIn(aWhere, aDelta, aTab)
{
  var win = aWhere == "window" ? null : window;
  aTab = aTab || getBrowser().selectedTab;
  var tab = Components.classes["@mozilla.org/suite/sessionstore;1"]
                      .getService(Components.interfaces.nsISessionStore)
                      .duplicateTab(win, aTab, aDelta, true);

  var loadInBackground = GetBoolPref("browser.tabs.loadInBackground", false);

  switch (aWhere) {
  case "tabfocused":
    // forces tab to be focused
    loadInBackground = true;
    // fall through
  case "tabshifted":
    loadInBackground = !loadInBackground;
    // fall through
  case "tab":
    if (!loadInBackground) {
      getBrowser().selectedTab = tab;
      window.content.focus();
    }
  }
}

/* Firefox compatibility shim *
 * duplicateTabIn duplicates tab in a place specified by the parameter |where|.
 *
 * |where| can be:
 *  "tab"         new tab
 *  "tabshifted"  same as "tab" but in background if default is to select new
 *                tabs, and vice versa
 *  "tabfocused"  same as "tab" but override any background preferences and
 *                focus the new tab
 *  "window"      new window
 *
 * delta is the offset to the history entry that you want to load.
 */
function duplicateTabIn(aTab, aWhere, aDelta)
{
  OpenSessionHistoryIn(aWhere, aDelta, aTab);
}

function gotoHistoryIndex(aEvent)
{
  var index = aEvent.target.getAttribute("index");
  if (!index)
    return false;

  var where = whereToOpenLink(aEvent);
  if (where == "current") {
    // Normal click. Go there in the current tab and update session history.
    try {
      getWebNavigation().gotoIndex(index);
    }
    catch(ex) {
      return false;
    }
  }
  else {
    // Modified click. Go there in a new tab/window. Include session history.
    var delta = index - getWebNavigation().sessionHistory.index;
    OpenSessionHistoryIn(where, delta);
  }
  return true;
}

function BrowserBack(aEvent)
{
  var where = whereToOpenLink(aEvent, false, true);

  if (where == "current") {
    try {
      getBrowser().goBack();
    }
    catch(ex) {}
  }
  else {
    OpenSessionHistoryIn(where, -1);
  }
}

function BrowserHandleBackspace()
{
  switch (Services.prefs.getIntPref("browser.backspace_action")) {
    case 0:
      BrowserBack();
      break;
    case 1:
      goDoCommand("cmd_scrollPageUp");
      break;
  }
}

function BrowserForward(aEvent)
{
  var where = whereToOpenLink(aEvent, false, true);

  if (where == "current") {
    try {
      getBrowser().goForward();
    }
    catch(ex) {
    }
  }
  else {
    OpenSessionHistoryIn(where, 1);
  }
}

function BrowserUp()
{
  loadURI(getBrowser().currentURI.spec.replace(/[#?].*$/, "").replace(/\/[^\/]*.$/, "/"));
}

function BrowserHandleShiftBackspace()
{
  switch (Services.prefs.getIntPref("browser.backspace_action")) {
    case 0:
      BrowserForward();
      break;
    case 1:
      goDoCommand("cmd_scrollPageDown");
      break;
  }
}

function SetGroupHistory(popupMenu, direction)
{
  while (popupMenu.hasChildNodes())
    popupMenu.lastChild.remove();

  var menuItem = document.createElementNS(XUL_NS, "menuitem");
  var label = gNavigatorBundle.getString("tabs.historyItem");
  menuItem.setAttribute("label", label);
  menuItem.setAttribute("index", direction);
  popupMenu.appendChild(menuItem);
}

function BrowserBackMenu(event)
{
  if (gBrowser.backBrowserGroup.length != 0) {
    SetGroupHistory(event.target, "back");
    return true;
  }

  return FillHistoryMenu(event.target, "back");
}

function BrowserForwardMenu(event)
{
  if (gBrowser.forwardBrowserGroup.length != 0) {
    SetGroupHistory(event.target, "forward");
    return true;
  }

  return FillHistoryMenu(event.target, "forward");
}

function BrowserStop()
{
  try {
    const stopFlags = nsIWebNavigation.STOP_ALL;
    getWebNavigation().stop(stopFlags);
  }
  catch(ex) {
  }
}

function BrowserReload(aEvent)
{
  var where = whereToOpenLink(aEvent, false, true);
  if (where == "current")
    BrowserReloadWithFlags(nsIWebNavigation.LOAD_FLAGS_NONE);
  else if (where == null && aEvent.shiftKey)
    BrowserReloadSkipCache();
  else
    OpenSessionHistoryIn(where, 0);
}

function BrowserReloadSkipCache()
{
  // Bypass proxy and cache.
  const reloadFlags = nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY | nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE;
  BrowserReloadWithFlags(reloadFlags);
}

function BrowserHome(aEvent)
{
  var homePage = getHomePage();
  var where = whereToOpenLink(aEvent, false, true);
  openUILinkArrayIn(homePage, where);
}

var BrowserSearch = {
  handleEvent: function (event) { // "DOMLinkAdded" event
    var link = event.originalTarget;

    var isSearch = /(?:^|\s)search(?:\s|$)/i.test(link.rel) && link.title &&
                   /^(https?|ftp):/i.test(link.href) &&
                   /(?:^|\s)application\/opensearchdescription\+xml(?:;?.*)$/i.test(link.type);

    if (isSearch) {
      this.addEngine(link, link.ownerDocument);
    }
  },

  addEngine: function(engine, targetDoc) {
    if (!this.searchBar)
      return;

    var browser = getBrowser().getBrowserForDocument(targetDoc);
    // ignore search engines from subframes (see bug 479408)
    if (!browser)
      return;

    // Check to see whether we've already added an engine with this title
    if (browser.engines) {
      if (browser.engines.some(e => e.title == engine.title))
        return;
    }

    // Append the URI and an appropriate title to the browser data.
    // Use documentURIObject in the check so that we do the right
    // thing with about:-style error pages.  Bug 453442
    var iconURL = null;
    var aURI = targetDoc.documentURIObject;
    try {
      aURI = Services.uriFixup.createExposableURI(aURI);
    } catch (e) {
    }

    if (aURI && ("schemeIs" in aURI) &&
        (aURI.schemeIs("http") || aURI.schemeIs("https")))
      iconURL = getBrowser().buildFavIconString(aURI);

    var hidden = false;
    // If this engine (identified by title) is already in the list, add it
    // to the list of hidden engines rather than to the main list.
    // XXX This will need to be changed when engines are identified by URL;
    // see bug 335102.
    if (Services.search.getEngineByName(engine.title))
      hidden = true;

    var engines = (hidden ? browser.hiddenEngines : browser.engines) || [];

    engines.push({ uri: engine.href,
                   title: engine.title,
                   icon: iconURL });

    if (hidden)
      browser.hiddenEngines = engines;
    else {
      browser.engines = engines;
      if (browser == getBrowser().selectedBrowser)
        this.updateSearchButton();
    }
  },

  /**
   * Update the browser UI to show whether or not additional engines are
   * available when a page is loaded or the user switches tabs to a page that
   * has search engines.
   */
  updateSearchButton: function() {
    var searchBar = this.searchBar;

    // The search bar binding might not be applied even though the element is
    // in the document (e.g. when the navigation toolbar is hidden), so check
    // for .searchButton specifically.
    if (!searchBar || !searchBar.searchButton)
      return;

    searchBar.updateSearchButton();
  },

  /**
   * Gives focus to the search bar, if it is present on the toolbar, or to the
   * search sidebar, if it is open, or loads the default engine's search form
   * otherwise. For Mac, opens a new window or focuses an existing window, if
   * necessary.
   */
  webSearch: function BrowserSearch_webSearch() {
    if (!gBrowser) {
      var win = getTopWin();
      if (win) {
        // If there's an open browser window, it should handle this command
        win.focus();
        win.BrowserSearch.webSearch();
        return;
      }

      // If there are no open browser windows, open a new one
      function webSearchCallback() {
        // This needs to be in a timeout so that we don't end up refocused
        // in the url bar
        setTimeout(BrowserSearch.webSearch, 0);
      }

      win = window.openDialog(getBrowserURL(), "_blank",
                              "chrome,all,dialog=no", "about:blank");
      win.addEventListener("load", webSearchCallback, false);
      return;
    }

    if (isElementVisible(this.searchBar)) {
      this.searchBar.select();
      this.searchBar.focus();
    } else if (this.searchSidebar) {
      this.searchSidebar.focus();
    } else {
      loadURI(Services.search.defaultEngine.searchForm);
      window.content.focus();
    }
  },

  /**
   * Loads a search results page, given a set of search terms. Uses the current
   * engine if the search bar is visible, or the default engine otherwise.
   *
   * @param aSearchText
   *        The search terms to use for the search.
   *
   * @param [optional] aNewWindowOrTab
   *        A boolean if set causes the search to load in a new window or tab
   *        (depending on "browser.search.openintab"). Otherwise the search
   *        loads in the current tab.
   *
   * @param [optional] aEvent
   *        The event object passed from the caller.
   */
  loadSearch: function BrowserSearch_search(aSearchText, aNewWindowOrTab, aEvent) {
    var engine;

    // If the search bar is visible, use the current engine, otherwise, fall
    // back to the default engine.
    if (isElementVisible(this.searchBar) ||
        this.searchSidebar)
      engine = Services.search.currentEngine;
    else
      engine = Services.search.defaultEngine;

    var submission = engine.getSubmission(aSearchText); // HTML response

    // getSubmission can return null if the engine doesn't have a URL
    // with a text/html response type.  This is unlikely (since
    // SearchService._addEngineToStore() should fail for such an engine),
    // but let's be on the safe side.
    // If you change the code here, remember to make the corresponding
    // changes in suite/mailnews/mailWindowOverlay.js->MsgOpenSearch
    if (!submission)
      return;

    if (aNewWindowOrTab) {
      let newTabPref = Services.prefs.getBoolPref("browser.search.opentabforcontextsearch");
      let where = newTabPref ? aEvent && aEvent.shiftKey ? "tabshifted" : "tab" : "window";
      openUILinkIn(submission.uri.spec, where, null, submission.postData);
      if (where == "window")
        return;
    } else {
      loadURI(submission.uri.spec, null, submission.postData, false);
      window.content.focus();
    }

    // should we try and open up the sidebar to show the "Search Results" panel?
    if (GetBoolPref("browser.search.opensidebarsearchpanel", false))
      this.revealSidebar();
  },

  /**
   * Returns the search bar element if it is present in the toolbar, null otherwise.
   */
  get searchBar() {
    return document.getElementById("searchbar");
  },

  /**
   * Returns the search sidebar textbox if the search sidebar is present in
   * the sidebar and selected, null otherwise.
   */
  get searchSidebar() {
    if (sidebarObj.never_built)
      return null;
    var panel = sidebarObj.panels.get_panel_from_id("urn:sidebar:panel:search");
    return panel && isElementVisible(panel.get_iframe()) &&
           panel.get_iframe()
                .contentDocument.getElementById("sidebar-search-text");
  },

  loadAddEngines: function BrowserSearch_loadAddEngines() {
    loadAddSearchEngines(); // for compatibility
  },

  /**
   * Reveal the search sidebar panel.
   */
  revealSidebar: function BrowserSearch_revealSidebar() {
    // first lets check if the search panel will be shown at all
    // by checking the sidebar datasource to see if there is an entry
    // for the search panel, and if it is excluded for navigator or not

    var searchPanelExists = false;

    var myPanel = document.getElementById("urn:sidebar:panel:search");
    if (myPanel) {
      var panel = sidebarObj.panels.get_panel_from_header_node(myPanel);
      searchPanelExists = !panel.is_excluded();

    } else if (sidebarObj.never_built) {
      // XXXsearch: in theory, this should work when the sidebar isn't loaded,
      //            in practice, it fails as sidebarObj.datasource_uri isn't defined
      try {
        var datasource = RDF.GetDataSourceBlocking(sidebarObj.datasource_uri);
        var aboutValue = RDF.GetResource("urn:sidebar:panel:search");

        // check if the panel is even in the list by checking for its content
        var contentProp = RDF.GetResource("http://home.netscape.com/NC-rdf#content");
        var content = datasource.GetTarget(aboutValue, contentProp, true);

        if (content instanceof Components.interfaces.nsIRDFLiteral) {
          // the search panel entry exists, now check if it is excluded
          // for navigator
          var excludeProp = RDF.GetResource("http://home.netscape.com/NC-rdf#exclude");
          var exclude = datasource.GetTarget(aboutValue, excludeProp, true);

          if (exclude instanceof Components.interfaces.nsIRDFLiteral) {
            searchPanelExists = (exclude.Value.indexOf("navigator:browser") < 0);
          } else {
            // panel exists and no exclude set
            searchPanelExists = true;
          }
        }
      } catch (e) {
        searchPanelExists = false;
      }
    }

    if (searchPanelExists) {
      // make sure the sidebar is open, else SidebarSelectPanel() will fail
      if (sidebar_is_hidden())
        SidebarShowHide();

      if (sidebar_is_collapsed())
        SidebarExpandCollapse();

      var searchPanel = document.getElementById("urn:sidebar:panel:search");
      if (searchPanel)
        SidebarSelectPanel(searchPanel, true, true); // lives in sidebarOverlay.js
    }
  }
}

function QualifySearchTerm()
{
  // If the text in the URL bar is the same as the currently loaded
  // page's URL then treat this as an empty search term.  This way
  // the user is taken to the search page where s/he can enter a term.
  if (gBrowser.userTypedValue !== null)
    return gURLBar.value;
  return "";
}

function BrowserOpenWindow()
{
  //opens a window where users can select a web location to open
  var params = { action: gPrivate ? "4" : "0", url: "" };
  openDialog("chrome://communicator/content/openLocation.xul", "_blank",
             "chrome,modal,titlebar", params);

  getShortcutOrURIAndPostData(params.url).then(data => {
    switch (params.action) {
      case "0": // current window
        loadURI(data.url, null, data.postData, true);
        break;
      case "1": // new window
        openDialog(getBrowserURL(), "_blank", "all,dialog=no", data.url, null, null,
                   data.postData, true);
        break;
      case "2": // edit
        editPage(data.url);
        break;
      case "3": // new tab
        gBrowser.selectedTab = gBrowser.addTab(data.url,
                                               {allowThirdPartyFixup: true,
                                                postData: data.postData});
        break;
      case "4": // private
        openNewPrivateWith(params.url);
        break;
    }
  });
}

function BrowserOpenTab()
{
  if (!gInPrintPreviewMode) {
    var uriToLoad;
    var tabPref = GetIntPref("browser.tabs.loadOnNewTab",0);
    switch (tabPref)
    {
      default:
        uriToLoad = "about:logopage";
        break;
      case 1:
        uriToLoad = GetLocalizedStringPref("browser.startup.homepage");
        break;
      case 2:
        uriToLoad = GetStringPref("browser.history.last_page_visited");
        break;
    }

    if (!gBrowser) {
      var win = getTopWin();
      if (win) {
        // If there's an open browser window, it should handle this command
        win.focus();
        win.BrowserOpenTab();
        return;
      }

      // If there are no open browser windows, open a new one
      openDialog(getBrowserURL(), "_blank", "chrome,all,dialog=no", uriToLoad);
      return;
    }

    if (tabPref == 2)
      OpenSessionHistoryIn("tabfocused", 0);
    else
      gBrowser.selectedTab = gBrowser.addTab(uriToLoad);

    if (uriToLoad == "about:blank" && isElementVisible(gURLBar))
      setTimeout(WindowFocusTimerCallback, 0, gURLBar);
    else
      setTimeout(WindowFocusTimerCallback, 0, content);
  }
}

function BrowserOpenTabFromTabBarDblClick(e)
{
  if ('object' === typeof e && e.button == 0) {
    BrowserOpenTab();
  }
}

function BrowserOpenTabFromTabBarMiddleClick(e)
{
  if ('object' === typeof e && e.button == 1) {
    BrowserOpenTab();
  }
}

/* Show file picker dialog configured for opening a file, and return
 * the selected nsIFileURL instance. */
function selectFileToOpen(label, prefRoot)
{
  var fileURL = null;

  // Get filepicker component.
  const nsIFilePicker = Components.interfaces.nsIFilePicker;
  var fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
  fp.init(window, gNavigatorBundle.getString(label), nsIFilePicker.modeOpen);
  fp.appendFilters(nsIFilePicker.filterAll | nsIFilePicker.filterText | nsIFilePicker.filterImages |
                   nsIFilePicker.filterXML | nsIFilePicker.filterHTML);

  const filterIndexPref = prefRoot + "filterIndex";
  const lastDirPref = prefRoot + "dir";

  // use a pref to remember the filterIndex selected by the user.
  fp.filterIndex = GetIntPref(filterIndexPref, 0);

  // use a pref to remember the displayDirectory selected by the user.
  try {
    fp.displayDirectory = Services.prefs.getComplexValue(lastDirPref,
                              Components.interfaces.nsILocalFile);
  } catch (ex) {
  }

  if (fp.show() == nsIFilePicker.returnOK) {
    Services.prefs.setIntPref(filterIndexPref, fp.filterIndex);
    Services.prefs.setComplexValue(lastDirPref,
                                   Components.interfaces.nsILocalFile,
                                   fp.file.parent);
    fileURL = fp.fileURL;
  }

  return fileURL;
}

function BrowserOpenFileWindow()
{
  try {
    openTopWin(selectFileToOpen("openFile", "browser.open.").spec);
  } catch (e) {}
}

function updateCloseItems()
{
  var browser = getBrowser();

  var hideCloseWindow = Services.prefs.getBoolPref("browser.tabs.closeWindowWithLastTab") &&
                        (!browser || browser.tabContainer.childNodes.length <= 1);
  document.getElementById("menu_closeWindow").hidden = hideCloseWindow;
  var closeItem = document.getElementById("menu_close");
  if (hideCloseWindow) {
    closeItem.setAttribute("label", gNavigatorBundle.getString("tabs.close.label"));
    closeItem.setAttribute("accesskey", gNavigatorBundle.getString("tabs.close.accesskey"));
  } else {
    closeItem.setAttribute("label", gNavigatorBundle.getString("tabs.closeTab.label"));
    closeItem.setAttribute("accesskey", gNavigatorBundle.getString("tabs.closeTab.accesskey"));
  }

  var hideCloseOtherTabs = !browser || !browser.getStripVisibility() || hideCloseWindow;
  document.getElementById("menu_closeOtherTabs").hidden = hideCloseOtherTabs;
}

function updateRecentMenuItems()
{
  var browser = getBrowser();
  var ss = Components.classes["@mozilla.org/suite/sessionstore;1"]
                     .getService(Components.interfaces.nsISessionStore);

  var recentTabsItem = document.getElementById("menu_recentTabs");
  recentTabsItem.setAttribute("disabled", !browser || browser.getUndoList().length == 0);
  var recentWindowsItem = document.getElementById("menu_recentWindows");
  recentWindowsItem.setAttribute("disabled", ss.getClosedWindowCount() == 0);
}

function updateRecentTabs(menupopup)
{
  var browser = getBrowser();

  while (menupopup.hasChildNodes())
    menupopup.lastChild.remove();

  var list = browser.getUndoList();
  for (var i = 0; i < list.length; i++) {
    var menuitem = document.createElement("menuitem");
    var label = list[i];
    if (i < 9) {
      label = gNavigatorBundle.getFormattedString("tabs.recentlyClosed.format", [i + 1, label]);
      menuitem.setAttribute("accesskey", i + 1);
    }

    if (i == 0)
      menuitem.setAttribute("key", "key_restoreTab");

    menuitem.setAttribute("label", label);
    menuitem.setAttribute("value", i);
    menupopup.appendChild(menuitem);
  }
}

function updateRecentWindows(menupopup)
{
  var ss = Components.classes["@mozilla.org/suite/sessionstore;1"]
                     .getService(Components.interfaces.nsISessionStore);

  while (menupopup.hasChildNodes())
    menupopup.lastChild.remove();

  var undoItems = JSON.parse(ss.getClosedWindowData());
  for (var i = 0; i < undoItems.length; i++) {
    var menuitem = document.createElement("menuitem");
    var label = undoItems[i].title;
    if (i < 9) {
      label = gNavigatorBundle.getFormattedString("windows.recentlyClosed.format", [i + 1, label]);
      menuitem.setAttribute("accesskey", i + 1);
    }

    if (i == 0)
      menuitem.setAttribute("key", "key_restoreWindow");

    menuitem.setAttribute("label", label);
    menuitem.setAttribute("value", i);
    menupopup.appendChild(menuitem);
  }
}

function undoCloseWindow(aIndex)
{
  var ss = Components.classes["@mozilla.org/suite/sessionstore;1"]
                     .getService(Components.interfaces.nsISessionStore);

  return ss.undoCloseWindow(aIndex);
}

function restoreLastSession() {
  let ss = Components.classes["@mozilla.org/suite/sessionstore;1"]
                     .getService(Components.interfaces.nsISessionStore);
  ss.restoreLastSession();
}

/*
 * Determines if a tab is "empty" using isBrowserEmpty from utilityOverlay.js
 */
function isTabEmpty(aTab)
{
  return isBrowserEmpty(aTab.linkedBrowser);
}

function BrowserCloseOtherTabs()
{
  var browser = getBrowser();
  browser.removeAllTabsBut(browser.mCurrentTab);
}

function BrowserCloseTabOrWindow()
{
  var browser = getBrowser();
  if (browser.tabContainer.childNodes.length > 1 ||
      !Services.prefs.getBoolPref("browser.tabs.closeWindowWithLastTab")) {
    // Just close up a tab.
    browser.removeCurrentTab();
    return;
  }

  BrowserCloseWindow();
}

function BrowserTryToCloseWindow()
{
  if (WindowIsClosing())
    BrowserCloseWindow();
}

function BrowserCloseWindow()
{
  // This code replicates stuff in Shutdown().  It is here because
  // window.screenX and window.screenY have real values.  We need
  // to fix this eventually but by replicating the code here, we
  // provide a means of saving position (it just requires that the
  // user close the window via File->Close (vs. close box).

  // Get the current window position/size.
  var x = window.screenX;
  var y = window.screenY;
  var h = window.outerHeight;
  var w = window.outerWidth;

  // Store these into the window attributes (for persistence).
  var win = document.getElementById( "main-window" );
  win.setAttribute( "x", x );
  win.setAttribute( "y", y );
  win.setAttribute( "height", h );
  win.setAttribute( "width", w );

  window.close();
}

function loadURI(uri, referrer, postData, allowThirdPartyFixup)
{
  try {
    var flags = nsIWebNavigation.LOAD_FLAGS_NONE;
    if (allowThirdPartyFixup) {
      flags = nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP |
              nsIWebNavigation.LOAD_FLAGS_FIXUP_SCHEME_TYPOS;
    }
    if (!flags && typeof postData == "number") {
      // Deal with legacy code that passes load flags in the third argument.
      flags = postData;
      postData = null;
    }
    gBrowser.loadURIWithFlags(uri, flags, referrer, null, postData);
  } catch (e) {
  }
}

function handleURLBarCommand(aUserAction, aTriggeringEvent)
{
  // Remove leading and trailing spaces first
  var url = gURLBar.value.trim();
  try {
    addToUrlbarHistory(url);
  } catch (ex) {
    // Things may go wrong when adding url to the location bar history,
    // but don't let that interfere with the loading of the url.
  }

  if (url.match(/^view-source:/)) {
    gViewSourceUtils.viewSource(url.replace(/^view-source:/, ""), null, null);
    return;
  }

  getShortcutOrURIAndPostData(url).then(data => {
    // Check the pressed modifiers: (also see bug 97123)
    // Modifier Mac | Modifier PC | Action
    // -------------+-------------+-----------
    // Command      | Control     | New Window/Tab
    // Shift+Cmd    | Shift+Ctrl  | New Window/Tab behind current one
    // Option       | Shift       | Save URL (show Filepicker)

    // If false, the save modifier is Alt, which is Option on Mac.
    var modifierIsShift = GetBoolPref("ui.key.saveLink.shift", true);

    var shiftPressed = false;
    var saveModifier = false; // if the save modifier was pressed
    if (aTriggeringEvent && 'shiftKey' in aTriggeringEvent &&
        'altKey' in aTriggeringEvent) {
      saveModifier = modifierIsShift ? aTriggeringEvent.shiftKey
                     : aTriggeringEvent.altKey;
      shiftPressed = aTriggeringEvent.shiftKey;
    }

    var browser = getBrowser();
    // Accept both Control and Meta (=Command) as New-Window-Modifiers
    if (aTriggeringEvent &&
        (('ctrlKey' in aTriggeringEvent && aTriggeringEvent.ctrlKey) ||
         ('metaKey' in aTriggeringEvent && aTriggeringEvent.metaKey) ||
         ('button'  in aTriggeringEvent && aTriggeringEvent.button == 1))) {
      // Check if user requests Tabs instead of windows
      if (GetBoolPref("browser.tabs.opentabfor.urlbar", false)) {
        // Reset url in the urlbar
        URLBarSetURI();
        // Open link in new tab
        var t = browser.addTab(data.url, {
                  postData: data.postData,
                  allowThirdPartyFixup: true,
                });

        // Focus new tab unless shift is pressed
        if (!shiftPressed)
          browser.selectedTab = t;
      } else {
        // Open a new window with the URL
        var newWin = openDialog(getBrowserURL(), "_blank", "all,dialog=no", data.url,
                                null, null, data.postData, true);
        // Reset url in the urlbar
        URLBarSetURI();

        // Focus old window if shift was pressed, as there's no
        // way to open a new window in the background
        // XXX this doesn't seem to work
        if (shiftPressed) {
          //newWin.blur();
          content.focus();
        }
      }
    } else if (saveModifier) {
      try {
        // Firstly, fixup the url so that (e.g.) "www.foo.com" works
        const nsIURIFixup = Components.interfaces.nsIURIFixup;
        if (!gURIFixup)
          gURIFixup = Components.classes["@mozilla.org/docshell/urifixup;1"]
                                .getService(nsIURIFixup);
        url = gURIFixup.createFixupURI(data.url, nsIURIFixup.FIXUP_FLAGS_MAKE_ALTERNATE_URI).spec;
        // Open filepicker to save the url
        saveURL(url, null, null, false, true, null, document);
      }
      catch(ex) {
        // XXX Do nothing for now.
        // Do we want to put up an alert in the future?  Mmm, l10n...
      }
    } else {
      // No modifier was pressed, load the URL normally and
      // focus the content area
      loadURI(data.url, null, data.postData, true);
      content.focus();
    }
  });
}

/**
 * Given a string, will generate a more appropriate urlbar value if a Places
 * keyword or a search alias is found at the beginning of it.
 *
 * @param url
 *        A string that may begin with a keyword or an alias.
 *
 * @return {Promise}
 * @resolves { url, postData, mayInheritPrincipal }. If it's not possible
 *           to discern a keyword or an alias, url will be the input string.
 */
function getShortcutOrURIAndPostData(url) {
  return Task.spawn(function* () {
    let mayInheritPrincipal = false;
    let postData = null;
    // Split on the first whitespace.
    let [keyword, param = ""] = url.trim().split(/\s(.+)/, 2);

    if (!keyword) {
      return { url, postData, mayInheritPrincipal };
    }

    let engine = Services.search.getEngineByAlias(keyword);
    if (engine) {
      let submission = engine.getSubmission(param, null, "keyword");
      return { url: submission.uri.spec,
               postData: submission.postData,
               mayInheritPrincipal };
    }

    // A corrupt Places database could make this throw, breaking navigation
    // from the location bar.
    let entry = null;
    try {
      entry = yield PlacesUtils.keywords.fetch(keyword);
    } catch (ex) {
      Components.utils.reportError(`Unable to fetch Places keyword "${keyword}": ${ex}`);
    }
    if (!entry || !entry.url) {
      // This is not a Places keyword.
      return { url, postData, mayInheritPrincipal };
    }

    try {
      [url, postData] =
        yield BrowserUtils.parseUrlAndPostData(entry.url.href,
                                               entry.postData,
                                               param);
      if (postData) {
        postData = getPostDataStream(postData);
      }

      // Since this URL came from a bookmark, it's safe to let it inherit the
      // current document's principal.
      mayInheritPrincipal = true;
    } catch (ex) {
      // It was not possible to bind the param, just use the original url value.
    }

    return { url, postData, mayInheritPrincipal };
  }).then(data => {
    return data;
  });
}

function getPostDataStream(aStringData, aKeyword, aEncKeyword, aType)
{
  var dataStream = Components.classes["@mozilla.org/io/string-input-stream;1"]
                             .createInstance(Components.interfaces.nsIStringInputStream);
  aStringData = aStringData.replace(/%s/g, aEncKeyword).replace(/%S/g, aKeyword);
  dataStream.data = aStringData;

  var mimeStream = Components.classes["@mozilla.org/network/mime-input-stream;1"]
                             .createInstance(Components.interfaces.nsIMIMEInputStream);
  mimeStream.addHeader("Content-Type", aType);
  mimeStream.addContentLength = true;
  mimeStream.setData(dataStream);
  return mimeStream.QueryInterface(Components.interfaces.nsIInputStream);
}

// handleDroppedLink has the following 2 overloads:
//   handleDroppedLink(event, url, name)
//   handleDroppedLink(event, links)
function handleDroppedLink(event, urlOrLinks, name)
{
  let links;
  if (Array.isArray(urlOrLinks)) {
    links = urlOrLinks;
  } else {
    links = [{ url: urlOrLinks, name, type: "" }];
  }

  let lastLocationChange = gBrowser.selectedBrowser.lastLocationChange;

  // Usually blank for SeaMonkey.
  let userContextId = gBrowser.selectedBrowser.getAttribute("usercontextid");

  // event is null if links are dropped in content process.
  // inBackground should be false, as it's loading into current browser.
  let inBackground = false;
  if (event) {
    inBackground = Services.prefs.getBoolPref("browser.tabs.loadInBackground");
    if (event.shiftKey)
      inBackground = !inBackground;
  }

  Task.spawn(function*() {
    let urls = [];
    let postDatas = [];
    for (let link of links) {
      let data = yield getShortcutOrURIAndPostData(link.url);
      urls.push(data.url);
      postDatas.push(data.postData);
    }
    if (lastLocationChange == gBrowser.selectedBrowser.lastLocationChange) {
      gBrowser.loadTabs(urls, {
        inBackground,
        replace: true,
        allowThirdPartyFixup: false,
        postDatas,
        userContextId,
      });
    }
  });

  // If links are dropped in content process, event.preventDefault() should be
  // called in content process.
  if (event) {
    // Keep the event from being handled by the dragDrop listeners
    // built-in to gecko if they happen to be above us.
    event.preventDefault();
  }
}

function readFromClipboard()
{
  var url;

  try {
    // Get the clipboard.
    var clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
                              .getService(Components.interfaces.nsIClipboard);

    // Create a transferable that will transfer the text.
    var trans = Components.classes["@mozilla.org/widget/transferable;1"]
                          .createInstance(Components.interfaces.nsITransferable);

    trans.init(null);
    trans.addDataFlavor("text/unicode");
    // If available, use the selection clipboard, otherwise use the global one.
    if (clipboard.supportsSelectionClipboard())
      clipboard.getData(trans, clipboard.kSelectionClipboard);
    else
      clipboard.getData(trans, clipboard.kGlobalClipboard);

    var data = {};
    trans.getTransferData("text/unicode", data, {});

    if (data.value) {
      data = data.value.QueryInterface(Components.interfaces.nsISupportsString);
      url = data.data;
    }
  } catch (ex) {
  }

  return url;
}

/**
 * Open the View Source dialog.
 *
 * @param aArgsOrDocument
 *        Either an object or a Document. Passing a Document is deprecated,
 *        and is not supported with e10s. This function will throw if
 *        aArgsOrDocument is a CPOW.
 *
 *        If aArgsOrDocument is an object, that object can take the
 *        following properties:
 *
 *        URL (required):
 *          A string URL for the page we'd like to view the source of.
 *        browser (optional):
 *          The browser containing the document that we would like to view the
 *          source of. This is required if outerWindowID is passed.
 *        outerWindowID (optional):
 *          The outerWindowID of the content window containing the document that
 *          we want to view the source of. You only need to provide this if you
 *          want to attempt to retrieve the document source from the network
 *          cache.
 *        lineNumber (optional):
 *          The line number to focus on once the source is loaded.
 */
function BrowserViewSourceOfDocument(aArgsOrDocument) {
  if (aArgsOrDocument instanceof Document) {
    // Deprecated API - callers should pass args object instead.
    if (Components.utils.isCrossProcessWrapper(aArgsOrDocument)) {
      throw new Error("BrowserViewSourceOfDocument cannot accept a CPOW " +
                      "as a document.");
    }

    let requestor = aArgsOrDocument.defaultView
                                   .QueryInterface(Components.interfaces.nsIInterfaceRequestor);
    let browser = requestor.getInterface(Components.interfaces.nsIWebNavigation)
                           .QueryInterface(Components.interfaces.nsIDocShell)
                           .chromeEventHandler;
    let outerWindowID = requestor.getInterface(Components.interfaces.nsIDOMWindowUtils)
                                 .outerWindowID;
    let URL = browser.currentURI.spec;
    aArgsOrDocument = { browser, outerWindowID, URL };
  }

  gViewSourceUtils.viewSource(aArgsOrDocument);
}

/**
 * Opens the View Source dialog for the source loaded in the root
 * top-level document of the browser.
 *
 * @param aBrowser
 *        The browser that we want to load the source of.
 */
function BrowserViewSource(aBrowser) {
  gViewSourceUtils.viewSource({
    browser: aBrowser,
    outerWindowID: aBrowser.outerWindowID,
    URL: aBrowser.currentURI.spec,
  });
}

// doc - document to use for source, or null for the current tab
// initialTab - id of the initial tab to display, or null for the first tab
function BrowserPageInfo(doc, initialTab)
{
  if (!doc)
    doc = window.content.document;
  var relatedUrl = doc.location.toString();
  var args = {doc: doc, initialTab: initialTab};

  var enumerator = Services.wm.getEnumerator("Browser:page-info");
  // Check for windows matching the url
  while (enumerator.hasMoreElements()) {
    let win = enumerator.getNext();
    if (win.document.documentElement
           .getAttribute("relatedUrl") == relatedUrl) {
      win.focus();
      win.resetPageInfo(args);
      return win;
    }
  }
  // We didn't find a matching window, so open a new one.
  return window.openDialog("chrome://navigator/content/pageinfo/pageInfo.xul",
                           "_blank",
                           "chrome,dialog=no",
                           args);
}

function hiddenWindowStartup()
{
  // focus the hidden window
  window.focus();

  // Disable menus which are not appropriate
  var disabledItems = ['cmd_close', 'cmd_sendPage', 'Browser:SendLink',
                       'Browser:EditPage', 'Browser:SavePage', 'cmd_printSetup',
                       'cmd_print', 'canGoBack', 'canGoForward',
                       'Browser:AddBookmark', 'Browser:AddBookmarkAs',
                       'cmd_undo', 'cmd_redo', 'cmd_cut', 'cmd_copy',
                       'cmd_paste', 'cmd_delete', 'cmd_selectAll',
                       'cmd_findTypeText', 'cmd_findTypeLinks', 'cmd_find',
                       'cmd_findNext', 'cmd_findPrev', 'menu_Toolbars',
                       'menuitem_reload', 'menu_UseStyleSheet', 'charsetMenu',
                       'View:PageSource', 'View:PageInfo', 'menu_translate',
                       'cookie_deny', 'cookie_default', 'View:FullScreen',
                       'cookie_session', 'cookie_allow', 'image_deny',
                       'image_default', 'image_allow', 'popup_deny',
                       'popup_default','popup_allow', 'menu_zoom',
                       'cmd_minimizeWindow', 'cmd_zoomWindow'];
  var broadcaster;

  for (var id in disabledItems) {
    broadcaster = document.getElementById(disabledItems[id]);
    if (broadcaster)
      broadcaster.setAttribute("disabled", "true");
  }

  // also hide the window list separator
  var separator = document.getElementById("sep-window-list");
  if (separator)
    separator.setAttribute("hidden", "true");

  // init string bundles
  gNavigatorBundle = document.getElementById("bundle_navigator");
  gNavigatorRegionBundle = document.getElementById("bundle_navigator_region");
  gBrandBundle = document.getElementById("bundle_brand");
}

function checkForDirectoryListing()
{
  if ( "HTTPIndex" in content &&
       content.HTTPIndex instanceof Components.interfaces.nsIHTTPIndex ) {
    var forced = getBrowser().docShell.forcedCharset;
    if (forced) {
      content.defaultCharacterset = forced;
    }
  }
}

function URLBarSetURI(aURI, aValid) {
  var uri = aURI || getWebNavigation().currentURI;
  var value;

  // If the url has "wyciwyg://" as the protocol, strip it off.
  // Nobody wants to see it on the urlbar for dynamically generated pages.
  if (!gURIFixup)
    gURIFixup = Components.classes["@mozilla.org/docshell/urifixup;1"]
                          .getService(Components.interfaces.nsIURIFixup);
  try {
    uri = gURIFixup.createExposableURI(uri);
  } catch (ex) {}

  // Replace "about:blank" and other initial pages with an empty string
  // only if there's no opener (bug 370555).
  if (gInitialPages.has(uri.spec))
    value = (content.opener || getWebNavigation().canGoBack) ? uri.spec : "";
  else
    value = losslessDecodeURI(uri);

  gURLBar.value = value;
  // In some cases, setting the urlBar value causes userTypedValue to
  // become set because of oninput, so reset it to null.
  getBrowser().userTypedValue = null;

  SetPageProxyState((value && (!aURI || aValid)) ? "valid" : "invalid", uri);
}

function losslessDecodeURI(aURI) {
  var value = aURI.spec;
  var scheme = aURI.scheme;

  var decodeASCIIOnly = !["https", "http", "file", "ftp"].includes(scheme);
  // Try to decode as UTF-8 if there's no encoding sequence that we would break.
  if (!/%25(?:3B|2F|3F|3A|40|26|3D|2B|24|2C|23)/i.test(value)) {
    if (decodeASCIIOnly) {
      // This only decodes ascii characters (hex) 20-7e, except 25 (%).
      // This avoids both cases stipulated below (%-related issues, and \r, \n
      // and \t, which would be %0d, %0a and %09, respectively) as well as any
      // non-US-ascii characters.
      value = value.replace(/%(2[0-4]|2[6-9a-f]|[3-6][0-9a-f]|7[0-9a-e])/g, decodeURI);
    } else {
      try {
        value = decodeURI(value)
                  // decodeURI decodes %25 to %, which creates unintended
                  // encoding sequences. Re-encode it, unless it's part of
                  // a sequence that survived decodeURI, i.e. one for:
                  // ';', '/', '?', ':', '@', '&', '=', '+', '$', ',', '#'
                  // (RFC 3987 section 3.2)
                  .replace(/%(?!3B|2F|3F|3A|40|26|3D|2B|24|2C|23)/ig,
                           encodeURIComponent);
      } catch (e) {}
    }
  }

  // Encode invisible characters (soft hyphen, zero-width space, BOM,
  // line and paragraph separator, word joiner, invisible times,
  // invisible separator, object replacement character,
  // C0/C1 controls). (bug 452979, bug 909264)
  // Encode bidirectional formatting characters.
  // (RFC 3987 sections 3.2 and 4.1 paragraph 6)
  // Re-encode whitespace so that it doesn't get eaten away
  // by the location bar (bug 410726).
  return value.replace(/[\u0000-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180d\u200b\u200e\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8\ufffc]|\ud834[\udd73-\udd7a]|[\udb40-\udb43][\udc00-\udfff]/g, encodeURIComponent);
}

/**
 * Use Stylesheet functions.
 *     Written by Tim Hill (bug 6782)
 *     Frameset handling by Neil Rashbrook <neil@parkwaycc.co.uk>
 **/
/**
 * Adds this frame's stylesheet sets to the View > Use Style submenu
 *
 * If the frame has no preferred stylesheet set then the "Default style"
 * menuitem should be shown. Note that it defaults to checked, hidden.
 *
 * If this frame has a selected stylesheet set then its menuitem should
 * be checked (unless the "None" style is currently selected), and the
 * "Default style" menuitem should to be unchecked.
 *
 * The stylesheet sets may match those of other frames. In that case, the
 * checkmark should be removed from sets that are not selected in this frame.
 *
 * @param menuPopup          The submenu's popup child
 * @param frame              The frame whose sets are to be added
 * @param styleDisabled      True if the "None" style is currently selected
 * @param itemPersistentOnly The "Default style" menuitem element
 */
function stylesheetFillFrame(menuPopup, frame, styleDisabled, itemPersistentOnly)
{
  if (!frame.document.preferredStyleSheetSet)
    itemPersistentOnly.hidden = false;

  var title = frame.document.selectedStyleSheetSet;
  if (title)
    itemPersistentOnly.removeAttribute("checked");

  var styleSheetSets = frame.document.styleSheetSets;
  for (var i = 0; i < styleSheetSets.length; i++) {
    var styleSheetSet = styleSheetSets[i];
    var menuitem = menuPopup.getElementsByAttribute("data", styleSheetSet).item(0);
    if (menuitem) {
      if (styleSheetSet != title)
        menuitem.removeAttribute("checked");
    } else {
      var menuItem = document.createElement("menuitem");
      menuItem.setAttribute("type", "radio");
      menuItem.setAttribute("label", styleSheetSet);
      menuItem.setAttribute("data", styleSheetSet);
      menuItem.setAttribute("checked", styleSheetSet == title && !styleDisabled);
      menuPopup.appendChild(menuItem);
    }
  }
}
/**
 * Adds all available stylesheet sets to the View > Use Style submenu
 *
 * If all frames have preferred stylesheet sets then the "Default style"
 * menuitem should remain hidden, otherwise it should be shown, and
 * if some frames have a selected stylesheet then the "Default style"
 * menuitem should be unchecked, otherwise it should remain checked.
 *
 * A stylesheet set's menuitem should not be checked if the "None" style
 * is currently selected. Otherwise a stylesheet set may be available in
 * more than one frame. In such a case the menuitem should only be checked
 * if it is selected in all frames in which it is available.
 *
 * @param menuPopup          The submenu's popup child
 * @param frameset           The frameset whose sets are to be added
 * @param styleDisabled      True if the "None" style is currently selected
 * @param itemPersistentOnly The "Default style" menuitem element
 */
function stylesheetFillAll(menuPopup, frameset, styleDisabled, itemPersistentOnly)
{
  stylesheetFillFrame(menuPopup, frameset, styleDisabled, itemPersistentOnly);
  for (var i = 0; i < frameset.frames.length; i++) {
    stylesheetFillAll(menuPopup, frameset.frames[i], styleDisabled, itemPersistentOnly);
  }
}
/**
 * Populates the View > Use Style submenu with all available stylesheet sets
 * @param menuPopup The submenu's popup child
 */
function stylesheetFillPopup(menuPopup)
{
  /* Clear menu */
  var itemPersistentOnly = menuPopup.firstChild.nextSibling;
  while (itemPersistentOnly.nextSibling)
    itemPersistentOnly.nextSibling.remove();

  /* Reset permanent items */
  var styleDisabled = getMarkupDocumentViewer().authorStyleDisabled;
  menuPopup.firstChild.setAttribute("checked", styleDisabled);
  itemPersistentOnly.setAttribute("checked", !styleDisabled);
  itemPersistentOnly.hidden = true;

  stylesheetFillAll(menuPopup, window.content, styleDisabled, itemPersistentOnly);
}
/**
 * Switches all frames in a frameset to the same stylesheet set
 *
 * Only frames that support the given title will be switched
 *
 * @param frameset The frameset whose frames are to be switched
 * @param title    The name of the stylesheet set to switch to
 */
function stylesheetSwitchAll(frameset, title) {
  if (!title || frameset.document.styleSheetSets.contains(title)) {
    frameset.document.selectedStyleSheetSet = title;
  }
  for (var i = 0; i < frameset.frames.length; i++) {
    stylesheetSwitchAll(frameset.frames[i], title);
  }
}

function setStyleDisabled(disabled) {
  getMarkupDocumentViewer().authorStyleDisabled = disabled;
}

function URLBarFocusHandler(aEvent)
{
  if (gIgnoreFocus)
    gIgnoreFocus = false;
  else if (gClickSelectsAll)
    gURLBar.select();
}

function URLBarMouseDownHandler(aEvent)
{
  if (gURLBar.hasAttribute("focused")) {
    gIgnoreClick = true;
  } else {
    gIgnoreFocus = true;
    gIgnoreClick = false;
    gURLBar.setSelectionRange(0, 0);
  }
}

function URLBarClickHandler(aEvent)
{
  if (!gIgnoreClick && gClickSelectsAll && gURLBar.selectionStart == gURLBar.selectionEnd)
    if (gClickAtEndSelects || gURLBar.selectionStart < gURLBar.value.length)
      gURLBar.select();
}

function ShowAndSelectContentsOfURLBar()
{
  if (!isElementVisible(gURLBar)) {
    BrowserOpenWindow();
    return;
  }

  if (gURLBar.value)
    gURLBar.select();
  else
    gURLBar.focus();
}

// If "ESC" is pressed in the url bar, we replace the urlbar's value with the url of the page
// and highlight it, unless it is about:blank, where we reset it to "".
function handleURLBarRevert()
{
  var url = getWebNavigation().currentURI.spec;
  var throbberElement = document.getElementById("navigator-throbber");

  var isScrolling = gURLBar.userAction == "scrolling";

  // don't revert to last valid url unless page is NOT loading
  // and user is NOT key-scrolling through autocomplete list
  if (!throbberElement.hasAttribute("busy") && !isScrolling) {
    URLBarSetURI();

    // If the value isn't empty, select it.
    if (gURLBar.value)
      gURLBar.select();
  }

  // tell widget to revert to last typed text only if the user
  // was scrolling when they hit escape
  return isScrolling;
}

function UpdatePageProxyState()
{
  if (gURLBar.value != gLastValidURLStr)
    SetPageProxyState("invalid", null);
}

function SetPageProxyState(aState, aURI)
{
  if (!gProxyButton)
    gProxyButton = document.getElementById("page-proxy-button");
  if (!gProxyFavIcon)
    gProxyFavIcon = document.getElementById("page-proxy-favicon");
  if (!gProxyDeck)
    gProxyDeck = document.getElementById("page-proxy-deck");

  gProxyButton.setAttribute("pageproxystate", aState);

  if (aState == "valid") {
    gLastValidURLStr = gURLBar.value;
    gURLBar.addEventListener("input", UpdatePageProxyState, false);
    if (gBrowser.shouldLoadFavIcon(aURI)) {
      var favStr = gBrowser.buildFavIconString(aURI);
      if (favStr != gProxyFavIcon.src) {
        gBrowser.loadFavIcon(aURI, "src", gProxyFavIcon);
        gProxyDeck.selectedIndex = 0;
      }
      else gProxyDeck.selectedIndex = 1;
    }
    else {
      gProxyDeck.selectedIndex = 0;
      gProxyFavIcon.removeAttribute("src");
    }
  } else if (aState == "invalid") {
    gURLBar.removeEventListener("input", UpdatePageProxyState, false);
    gProxyDeck.selectedIndex = 0;
    gProxyFavIcon.removeAttribute("src");
  }
}

function handlePageProxyClick(aEvent)
{
  switch (aEvent.button) {
  case 0:
    // bug 52784 - select location field contents
    gURLBar.select();
    break;
  case 1:
    // bug 111337 - load url/keyword from clipboard
    middleMousePaste(aEvent);
    break;
  }
}

function updateComponentBarBroadcaster()
{
  var compBarBroadcaster = document.getElementById('cmd_viewcomponentbar');
  var taskBarBroadcaster = document.getElementById('cmd_viewtaskbar');
  var compBar = document.getElementById('component-bar');
  if (taskBarBroadcaster.getAttribute('checked') == 'true') {
    compBarBroadcaster.removeAttribute('disabled');
    if (compBar.getAttribute('hidden') != 'true')
      compBarBroadcaster.setAttribute('checked', 'true');
  }
  else {
    compBarBroadcaster.setAttribute('disabled', 'true');
    compBarBroadcaster.removeAttribute('checked');
  }
}

function updateToolbarStates(aEvent)
{
  onViewToolbarsPopupShowing(aEvent);
  updateComponentBarBroadcaster();

  const tabbarMenuItem = document.getElementById("menuitem_showhide_tabbar");
  // Make show/hide menu item reflect current state
  const visibility = gBrowser.getStripVisibility();
  tabbarMenuItem.setAttribute("checked", visibility);

  // Don't allow the tab bar to be shown/hidden when more than one tab is open
  // or when we have 1 tab and the autoHide pref is set
  const disabled = gBrowser.browsers.length > 1 ||
                   Services.prefs.getBoolPref("browser.tabs.autoHide");
  tabbarMenuItem.setAttribute("disabled", disabled);
}

function showHideTabbar()
{
  const visibility = gBrowser.getStripVisibility();
  Services.prefs.setBoolPref("browser.tabs.forceHide", visibility);
  gBrowser.setStripVisibilityTo(!visibility);
}

function BrowserFullScreen()
{
  window.fullScreen = !window.fullScreen;
}

function onFullScreen()
{
  FullScreen.toggle();
}

function UpdateStatusBarPopupIcon(aEvent)
{
  if (aEvent && aEvent.originalTarget != gBrowser.getNotificationBox())
    return;

  var showIcon = Services.prefs.getBoolPref("privacy.popups.statusbar_icon_enabled");
  if (showIcon) {
    var popupIcon = document.getElementById("popupIcon");
    popupIcon.hidden = !gBrowser.getNotificationBox().popupCount;
  }
}
function StatusbarViewPopupManager()
{
  // Open Data Manager permissions pane site and type prefilled to add.
  toDataManager(hostUrl() + "|permissions|add|popup");
}

function popupBlockerMenuShowing(event)
{
  var separator = document.getElementById("popupMenuSeparator");

  if (separator)
    separator.hidden = !createShowPopupsMenu(event.target, gBrowser.selectedBrowser);
}

function toHistory()
{
  toOpenWindowByType("history:manager", "chrome://communicator/content/history/history.xul");
}

// opener may not have been initialized by load time (chrome windows only)
// so call this function some time later.
function maybeInitPopupContext()
{
  // it's not a popup with no opener
  if (!window.content.opener)
    return null;

  try {
    // are we a popup window?
    const CI = Components.interfaces;
    var xulwin = window
                 .QueryInterface(CI.nsIInterfaceRequestor)
                 .getInterface(CI.nsIWebNavigation)
                 .QueryInterface(CI.nsIDocShellTreeItem).treeOwner
                 .QueryInterface(CI.nsIInterfaceRequestor)
                 .getInterface(CI.nsIXULWindow);
    if (xulwin.contextFlags &
        CI.nsIWindowCreator2.PARENT_IS_LOADING_OR_RUNNING_TIMEOUT) {
      // return our opener's URI
      return Services.io.newURI(window.content.opener.location.href, null, null);
    }
  } catch(e) {
  }
  return null;
}

function WindowIsClosing()
{
  var browser = getBrowser();
  var cn = browser.tabContainer.childNodes;
  var numtabs = cn.length;
  var reallyClose = true;

  if (!gPrivate && !/Mac/.test(navigator.platform) && isClosingLastBrowser()) {
    let closingCanceled = Components.classes["@mozilla.org/supports-PRBool;1"]
                                    .createInstance(Components.interfaces.nsISupportsPRBool);
    Services.obs.notifyObservers(closingCanceled, "browser-lastwindow-close-requested", null);
    if (closingCanceled.data)
      return false;

    Services.obs.notifyObservers(null, "browser-lastwindow-close-granted", null);

    return true;
  }

  if (!gPrivate && numtabs > 1) {
    var shouldPrompt = Services.prefs.getBoolPref("browser.tabs.warnOnClose");
    if (shouldPrompt) {
      //default to true: if it were false, we wouldn't get this far
      var warnOnClose = {value:true};

       var buttonPressed = Services.prompt.confirmEx(window,
         gNavigatorBundle.getString('tabs.closeWarningTitle'),
         gNavigatorBundle.getFormattedString("tabs.closeWarning", [numtabs]),
         (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0)
            + (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1),
            gNavigatorBundle.getString('tabs.closeButton'),
            null, null,
            gNavigatorBundle.getString('tabs.closeWarningPromptMe'),
            warnOnClose);
      reallyClose = (buttonPressed == 0);
      //don't set the pref unless they press OK and it's false
      if (reallyClose && !warnOnClose.value) {
        Services.prefs.setBoolPref("browser.tabs.warnOnClose", false);
      }
    } //if the warn-me pref was true
  } //if multiple tabs are open

  for (var i = 0; reallyClose && i < numtabs; ++i) {
    var ds = browser.getBrowserForTab(cn[i]).docShell;

    if (ds.contentViewer && !ds.contentViewer.permitUnload())
      reallyClose = false;
  }

  return reallyClose;
}

/**
 * Checks whether this is the last full *browser* window around.
 * @returns true if closing last browser window, false if not.
 */
function isClosingLastBrowser() {
  // Popups aren't considered full browser windows.
  if (!toolbar.visible)
    return false;

  // Figure out if there's at least one other browser window around.
  var e = Services.wm.getEnumerator("navigator:browser");
  while (e.hasMoreElements()) {
    let win = e.getNext();
    if (win != window && win.toolbar.visible)
      return false;
  }

  return true;
}

/**
 * file upload support
 */

/* This function returns the URI of the currently focused content frame
 * or frameset.
 */
function getCurrentURI()
{
  const CI = Components.interfaces;

  var focusedWindow = document.commandDispatcher.focusedWindow;
  var contentFrame = isContentFrame(focusedWindow) ? focusedWindow : window.content;

  var nav = contentFrame.QueryInterface(CI.nsIInterfaceRequestor)
                        .getInterface(CI.nsIWebNavigation);
  return nav.currentURI;
}

function uploadFile(fileURL)
{
  const CI = Components.interfaces;

  var targetBaseURI = getCurrentURI();

  // generate the target URI.  we use fileURL.file.leafName to get the
  // unicode value of the target filename w/o any URI-escaped chars.
  // this gives the protocol handler the best chance of generating a
  // properly formatted URI spec.  we pass null for the origin charset
  // parameter since we want the URI to inherit the origin charset
  // property from targetBaseURI.

  var leafName = fileURL.QueryInterface(CI.nsIFileURL).file.leafName;

  var targetURI = Services.io.newURI(leafName, null, targetBaseURI);

  // ok, start uploading...
  openDialog("chrome://communicator/content/downloads/uploadProgress.xul", "",
             "titlebar,centerscreen,minimizable,dialog=no", fileURL, targetURI);
}

function BrowserUploadFile()
{
  try {
    uploadFile(selectFileToOpen("uploadFile", "browser.upload."));
  } catch (e) {}
}

/* This function is called whenever the file menu is about to be displayed.
 * Enable the upload menu item if appropriate. */
function updateFileUploadItem()
{
  var canUpload = false;
  try {
    canUpload = getCurrentURI().schemeIs('ftp');
  } catch (e) {}

  var item = document.getElementById('Browser:UploadFile');
  if (canUpload)
    item.removeAttribute('disabled');
  else
    item.setAttribute('disabled', 'true');
}

function isBidiEnabled()
{
  var rv = false;

  var systemLocale;
  try {
    systemLocale = Services.locale.getSystemLocale()
                                  .getCategory("NSILOCALE_CTYPE");
    rv = /^(he|ar|syr|fa|ur)-/.test(systemLocale);
  } catch (e) {}

  if (!rv) {
    // check the overriding pref
    rv = Services.prefs.getBoolPref("bidi.browser.ui");
  }

  return rv;
}

function SwitchDocumentDirection(aWindow)
{
  aWindow.document.dir = (aWindow.document.dir == "ltr" ? "rtl" : "ltr");

  for (var run = 0; run < aWindow.frames.length; run++)
    SwitchDocumentDirection(aWindow.frames[run]);
}

function updateSavePageItems()
{
  var autoDownload = Services.prefs
                             .getBoolPref("browser.download.useDownloadDir");
  goSetMenuValue("savepage", autoDownload ? "valueSave" : "valueSaveAs");
}

function convertFromUnicode(charset, str)
{
  try {
    var unicodeConverter = Components
       .classes["@mozilla.org/intl/scriptableunicodeconverter"]
       .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
    unicodeConverter.charset = charset;
    str = unicodeConverter.ConvertFromUnicode(str);
    return str + unicodeConverter.Finish();
  } catch(ex) {
    return null;
  }
}

function getNotificationBox(aWindow)
{
  return aWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                .getInterface(Components.interfaces.nsIWebNavigation)
                .QueryInterface(Components.interfaces.nsIDocShell)
                .chromeEventHandler.parentNode.wrappedJSObject;
}

function BrowserToolboxCustomizeInit()
{
  SetPageProxyState("invalid", null);
  toolboxCustomizeInit("main-menubar");
  PlacesToolbarHelper.customizeStart();

  var splitter = document.getElementById("urlbar-search-splitter");
  if (splitter)
    splitter.remove();
}

function BrowserToolboxCustomizeDone(aToolboxChanged)
{
  toolboxCustomizeDone("main-menubar", getNavToolbox(), aToolboxChanged);

  UpdateNavBar();

  // Update the urlbar
  var value = gBrowser.userTypedValue;
  if (value == null)
    URLBarSetURI();
  else
    gURLBar.value = value;

  PlacesToolbarHelper.customizeDone();
}

function BrowserToolboxCustomizeChange(event)
{
  toolboxCustomizeChange(getNavToolbox(), event);
}

function AddKeywordForSearchField() {
  var node = document.popupNode;
  var doc = node.ownerDocument;
  var charset = doc.characterSet;
  var title = gNavigatorBundle.getFormattedString("addKeywordTitleAutoFill",
                                                  [doc.title]);
  var description = PlacesUIUtils.getDescriptionFromDocument(doc);
  var postData = null;
  var form = node.form;
  var spec = form.action || doc.documentURI;

  function encodeNameValuePair(aName, aValue) {
    return encodeURIComponent(aName) + "=" + encodeURIComponent(aValue);
  }

  let el = null;
  let type = null;
  let formData = [];
  for (var i = 0; i < form.elements.length; i++) {
    el = form.elements[i];

    if (!el.type) // happens with fieldsets
      continue;

    if (el == node) {
      formData.push(encodeNameValuePair(el.name, "") + "%s");
      continue;
    }

    type = el.type;

    if (((el instanceof HTMLInputElement && el.mozIsTextField(true)) ||
        type == "hidden" || type == "textarea") ||
        ((type == "checkbox" || type == "radio") && el.checked)) {
      formData.push(encodeNameValuePair(el.name, el.value));
    } else if (el instanceof HTMLSelectElement && el.selectedIndex >= 0) {
      for (var j = 0; j < el.options.length; j++) {
        if (el.options[j].selected)
          formData.push(encodeNameValuePair(el.name, el.options[j].value));
      }
    }
  }

  if (form.method == "post" &&
      form.enctype == "application/x-www-form-urlencoded") {
    postData = formData.join("&");
  } else { // get
    spec += spec.indexOf("?") != -1 ? "&" : "?";
    spec += formData.join("&");
  }

  PlacesUIUtils.showMinimalAddBookmarkUI(makeURI(spec), title, description, null,
                                         null, null, "", postData, charset);
}

function getCert()
{
  var sslStatus = getBrowser().securityUI
                              .QueryInterface(Components.interfaces.nsISSLStatusProvider)
                              .SSLStatus;

  return sslStatus && sslStatus.serverCert;
}

function viewCertificate()
{
  var cert = getCert();

  if (cert)
  {
    Components.classes["@mozilla.org/nsCertificateDialogs;1"]
              .getService(Components.interfaces.nsICertificateDialogs)
              .viewCert(window, cert);
  }
}

function openCertManager()
{
  toOpenWindowByType("mozilla:certmanager", "chrome://pippki/content/certManager.xul",
                     "resizable,dialog=no,centerscreen");
}

function onViewSecurityContextMenu()
{
  document.getElementById("viewCertificate").disabled = !getCert();
}
