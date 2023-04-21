/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function nsBrowserStatusHandler()
{
  this.init();
}

nsBrowserStatusHandler.prototype =
{
  // Stored Status, Link and Loading values
  status : "",
  defaultStatus : "",
  jsStatus : "",
  jsDefaultStatus : "",
  overLink : "",
  feeds : [],

  QueryInterface : function(aIID)
  {
    if (aIID.equals(Components.interfaces.nsIWebProgressListener) ||
        aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
        aIID.equals(Components.interfaces.nsIXULBrowserWindow) ||
        aIID.equals(Components.interfaces.nsISupports))
      return this;
    throw Components.results.NS_NOINTERFACE;
  },

  init : function()
  {
    this.urlBar          = document.getElementById("urlbar");
    this.throbberElement = document.getElementById("navigator-throbber");
    this.statusMeter     = document.getElementById("statusbar-icon");
    this.statusPanel     = document.getElementById("statusbar-progresspanel");
    this.stopButton      = document.getElementById("stop-button");
    this.stopMenu        = document.getElementById("menuitem-stop");
    this.stopContext     = document.getElementById("context-stop");
    this.statusTextField = document.getElementById("statusbar-display");
    this.isImage         = document.getElementById("isImage");
    this.securityButton  = document.getElementById("security-button");
    // XXXTobin: This thing is gross
    // this.evButton        = document.getElementById("ev-button");
    this.feedsMenu       = document.getElementById("feedsMenu");
    this.feedsButton     = document.getElementById("feedsButton");

    // Initialize the security button's state and tooltip text
    const nsIWebProgressListener = Components.interfaces.nsIWebProgressListener;
    this.onSecurityChange(null, null, nsIWebProgressListener.STATE_IS_INSECURE);
  },

  destroy : function()
  {
    // XXXjag to avoid leaks :-/, see bug 60729
    this.urlBar          = null;
    this.throbberElement = null;
    this.statusMeter     = null;
    this.statusPanel     = null;
    this.stopButton      = null;
    this.stopMenu        = null;
    this.stopContext     = null;
    this.statusTextField = null;
    this.isImage         = null;
    this.securityButton  = null;
    // this.evButton        = null;
    this.feedsButton     = null;
    this.feedsMenu       = null;
  },

  // nsIXULBrowserWindow
  setJSStatus : function(status)
  {
    this.jsStatus = status;
    this.updateStatusField();
  },

  // nsIXULBrowserWindow
  setJSDefaultStatus : function(status)
  {
    this.jsDefaultStatus = status;
    this.updateStatusField();
  },

  setDefaultStatus : function(status)
  {
    this.defaultStatus = status;
    this.updateStatusField();
  },

  // nsIXULBrowserWindow
  setOverLink : function(link, context)
  {
    this.overLink = link;
    /* clear out 'Done' (or other message) on first hover
    if (this.defaultStatus)
      this.defaultStatus = "";
    */
    this.updateStatusField();
    if (link)
      this.statusTextField.setAttribute('crop', 'center');
    else
      this.statusTextField.setAttribute('crop', 'end');
  },

  // nsIXULBrowserWindow
  // Called before links are navigated to to allow us to retarget them if needed.
  onBeforeLinkTraversal: function(originalTarget, linkURI, linkNode, isAppTab) {
    return originalTarget;
  },

  updateStatusField : function()
  {
    var text = this.overLink || this.status || this.jsStatus || this.jsDefaultStatus || this.defaultStatus;

    // check the current value so we don't trigger an attribute change
    // and cause needless (slow!) UI updates
    if (this.statusTextField.label != text)
      this.statusTextField.label = text;
  },

/**
 * Returns true if |aMimeType| is text-based, false otherwise.
 *
 * @param aMimeType
 *        The MIME type to check.
 *
 * If adding types to this function, please also check the similar
 * function in mozilla/toolkit/content/widgets/findbar.xml.
 */
  mimeTypeIsTextBased : function(contentType)
  {
    return /^text\/|\+xml$/.test(contentType) ||
           contentType == "application/x-javascript" ||
           contentType == "application/javascript" ||
           contentType == "application/xml" ||
           contentType == "mozilla.application/cached-xul";
  },

  populateFeeds : function(popup)
  {
    // First clear out any old items
    while (popup.hasChildNodes())
      popup.lastChild.remove();

    for (var i = 0; i < this.feeds.length; i++) {
      var link = this.feeds[i];
      var menuitem = document.createElement("menuitem");
      menuitem.className = "menuitem-iconic bookmark-item";
      menuitem.statusText = link.href;
      menuitem.setAttribute("label", link.title || link.href);
      popup.appendChild(menuitem);
    }
  },

  onFeedAvailable : function(aLink)
  {
    this.feeds.push(aLink);
    this.feedsMenu.removeAttribute("disabled");
    this.feedsButton.hidden = false;
  },

  onLinkIconAvailable : function(aHref)
  {
    if (aHref && gProxyFavIcon &&
        Services.prefs.getBoolPref("browser.chrome.site_icons")) {
      var browser = getBrowser();
      if (browser.userTypedValue === null)
        gProxyFavIcon.setAttribute("src", aHref);
    }
  },

  onProgressChange : function (aWebProgress, aRequest,
                               aCurSelfProgress, aMaxSelfProgress,
                               aCurTotalProgress, aMaxTotalProgress)
  {
    if (aMaxTotalProgress > 0) {
      // This is highly optimized.  Don't touch this code unless
      // you are intimately familiar with the cost of setting
      // attrs on XUL elements. -- hyatt
      var percentage = (aCurTotalProgress * 100) / aMaxTotalProgress;
      this.statusMeter.value = percentage;
    }
  },

  onStateChange : function(aWebProgress, aRequest, aStateFlags, aStatus)
  {
    const nsIWebProgressListener = Components.interfaces.nsIWebProgressListener;
    const nsIChannel = Components.interfaces.nsIChannel;
    var ctype;
    if (aStateFlags & nsIWebProgressListener.STATE_START) {
      // This (thanks to the filter) is a network start or the first
      // stray request (the first request outside of the document load),
      // initialize the throbber and his friends.

      // Call start document load listeners (only if this is a network load)
      if (aStateFlags & nsIWebProgressListener.STATE_IS_NETWORK &&
          aRequest && aWebProgress.isTopLevel)
        this.startDocumentLoad(aRequest);

      if (!(aStateFlags & nsIWebProgressListener.STATE_RESTORING)) {
        // Show the progress meter
        this.statusPanel.collapsed = false;
        // Turn the throbber on.
        this.throbberElement.setAttribute("busy", "true");
      }

      // XXX: These need to be based on window activity...
      this.stopButton.disabled = false;
      this.stopMenu.removeAttribute('disabled');
      this.stopContext.removeAttribute('disabled');
    }
    else if (aStateFlags & nsIWebProgressListener.STATE_STOP) {
      if (aStateFlags & nsIWebProgressListener.STATE_IS_NETWORK) {
        if (aRequest) {
          if (aWebProgress.isTopLevel)
            this.endDocumentLoad(aRequest, aStatus);
        }
      }

      // This (thanks to the filter) is a network stop or the last
      // request stop outside of loading the document, stop throbbers
      // and progress bars and such
      if (aRequest) {
        var msg = "";
        // Get the channel if the request is a channel
        if (aRequest instanceof nsIChannel) {
          var location = aRequest.URI.spec;
          if (location != "about:blank") {
            switch (aStatus) {
              case Components.results.NS_BINDING_ABORTED:
                msg = gNavigatorBundle.getString("nv_stopped");
                break;
              case Components.results.NS_ERROR_NET_TIMEOUT:
                msg = gNavigatorBundle.getString("nv_timeout");
                break;
            }
          }
        }
        // If msg is false then we did not have an error (channel may have
        // been null, in the case of a stray image load).
        if (!msg) {
          msg = gNavigatorBundle.getString("nv_done");
        }
        this.status = "";
        this.setDefaultStatus(msg);

        // Disable menu entries for images, enable otherwise
        if (content.document && this.mimeTypeIsTextBased(content.document.contentType))
          this.isImage.removeAttribute('disabled');
        else
          this.isImage.setAttribute('disabled', 'true');
      }

      // Turn the progress meter and throbber off.
      this.statusPanel.collapsed = true;
      this.statusMeter.value = 0;  // be sure to clear the progress bar
      this.throbberElement.removeAttribute("busy");

      // XXX: These need to be based on window activity...
      // XXXjag: <command id="cmd_stop"/> ?
      this.stopButton.disabled = true;
      this.stopMenu.setAttribute('disabled', 'true');
      this.stopContext.setAttribute('disabled', 'true');
    }
  },

  onLocationChange : function(aWebProgress, aRequest, aLocation, aFlags)
  {
    const nsIWebProgressListener = Components.interfaces.nsIWebProgressListener;
    if (gContextMenu) {
      // Optimise for the common case
      if (aWebProgress.isTopLevel)
        document.getElementById("contentAreaContextMenu").hidePopup();
      else {
        for (var contextWindow = gContextMenu.target.ownerDocument.defaultView;
             contextWindow != contextWindow.parent;
             contextWindow = contextWindow.parent) {
          if (contextWindow == aWebProgress.DOMWindow) {
            document.getElementById("contentAreaContextMenu").hidePopup();
            break;
          }
        }
      }
    }

   if (document.tooltipNode) {
     // Optimise for the common case
     if (aWebProgress.isTopLevel) {
       document.getElementById("aHTMLTooltip").hidePopup();
       document.tooltipNode = null;
     } else {
       for (var tooltipWindow = document.tooltipNode.ownerDocument.defaultView;
            tooltipWindow != tooltipWindow.parent;
            tooltipWindow = tooltipWindow.parent) {
         if (tooltipWindow == aWebProgress.DOMWindow) {
           document.getElementById("aHTMLTooltip").hidePopup();
           document.tooltipNode = null;
           break;
         }
       }
     }
   }

    // Hide the form invalid popup.
    if (gFormSubmitObserver.panel) {
      gFormSubmitObserver.panel.hidePopup();
    }

    // XXX temporary hack for bug 104532.
    // Depends heavily on setOverLink implementation
    if (!aRequest)
      this.status = this.jsStatus = this.jsDefaultStatus = "";

    this.setOverLink("");

    // Disable menu entries for images, enable otherwise
    if (content.document && this.mimeTypeIsTextBased(content.document.contentType))
      this.isImage.removeAttribute('disabled');
    else
      this.isImage.setAttribute('disabled', 'true');

    // We should probably not do this if the value has changed since the user
    // searched
    // Update urlbar only if a new page was loaded on the primary content area
    // Do not update urlbar if there was a subframe navigation

    var browser = getBrowser().selectedBrowser;
    if (aWebProgress.isTopLevel) {
      var userTypedValue = browser.userTypedValue;
      if (userTypedValue === null) {
        URLBarSetURI(aLocation, true);
      } else {
        this.urlBar.value = userTypedValue;
        SetPageProxyState("invalid", null);
      }

      PlacesStarButton.updateState();

      this.feedsMenu.setAttribute("disabled", "true");
      this.feedsButton.hidden = true;
      this.feeds = [];

      // When background tab comes into foreground or loading a new page
      // (aRequest set), might want to update zoom.
      if (FullZoom.updateBackgroundTabs || aRequest)
        FullZoom.onLocationChange(getBrowser().currentURI, !aRequest, browser);
    }
    UpdateBackForwardButtons();

    UpdateStatusBarPopupIcon();

    BrowserSearch.updateSearchButton();
  },

  onStatusChange : function(aWebProgress, aRequest, aStatus, aMessage)
  {
    this.status = aMessage;
    this.updateStatusField();
  },

  onSecurityChange : function(aWebProgress, aRequest, aState)
  {
    const wpl = Components.interfaces.nsIWebProgressListener;
    const wpl_security_bits = wpl.STATE_IS_SECURE |
                              wpl.STATE_IS_BROKEN |
                              wpl.STATE_IS_INSECURE;

    var highlightSecure =
      Services.prefs.getBoolPref("browser.urlbar.highlight.secure");

    /* aState is defined as a bitmask that may be extended in the future.
     * We filter out any unknown bits before testing for known values.
     */
    switch (aState & wpl_security_bits) {
      case wpl.STATE_IS_SECURE:
        const nsISSLStatusProvider = Components.interfaces.nsISSLStatusProvider;
        var cert = getBrowser().securityUI.QueryInterface(nsISSLStatusProvider)
                               .SSLStatus.serverCert;
        var issuerName = cert.issuerOrganization ||
                         cert.issuerCommonName || cert.issuerName;
        this.securityButton.setAttribute("tooltiptext",
          gNavigatorBundle.getFormattedString("securityButtonTooltipSecure",
                                              [issuerName]));
        this.securityButton.setAttribute("level", "high");
        if (highlightSecure)
          this.urlBar.setAttribute("level", "high");
        else
          this.urlBar.removeAttribute("level");
        break;
      case wpl.STATE_IS_BROKEN:
        this.securityButton.setAttribute("tooltiptext",
          gNavigatorBundle.getString("securityButtonTooltipMixedContent"));
        this.securityButton.setAttribute("level", "broken");
        if (highlightSecure)
          this.urlBar.setAttribute("level", "broken");
        else
          this.urlBar.removeAttribute("level");
        break;
      case wpl.STATE_IS_INSECURE:
      default:
        this.securityButton.setAttribute("tooltiptext",
          gNavigatorBundle.getString("securityButtonTooltipInsecure"));
        this.securityButton.removeAttribute("level");
        this.urlBar.removeAttribute("level");
        break;
    }

    if (aState & wpl.STATE_IDENTITY_EV_TOPLEVEL) {
      var organization =
        getBrowser().securityUI
                    .QueryInterface(Components.interfaces.nsISSLStatusProvider)
                    .SSLStatus
                    .QueryInterface(Components.interfaces.nsISSLStatus)
                    .serverCert.organization;
      this.securityButton.setAttribute("label", organization);
      // this.evButton.setAttribute("tooltiptext", organization);
      // this.evButton.hidden = false;
    } else {
      this.securityButton.removeAttribute("label");
      // this.evButton.hidden = true;
    }
  },

  startDocumentLoad : function(aRequest)
  {
    var uri = aRequest.QueryInterface(Components.interfaces.nsIChannel).originalURI;

    // clear out search-engine data
    getBrowser().selectedBrowser.engines = null;

    // Set the URI now if it isn't already set, so that the user can tell which
    // site is loading. Only do this if user requested the load via chrome UI,
    // to minimise spoofing risk.
    if (!content.opener &&
        !gURLBar.value &&
        getWebNavigation().currentURI.spec == "about:blank")
      URLBarSetURI(uri);

    try {
      Services.obs.notifyObservers(content, "StartDocumentLoad", uri.spec);
    } catch (e) {
    }
  },

  endDocumentLoad : function(aRequest, aStatus)
  {
    const nsIChannel = Components.interfaces.nsIChannel;
    var urlStr = aRequest.QueryInterface(nsIChannel).originalURI.spec;

    if (Components.isSuccessCode(aStatus))
      dump("Document "+urlStr+" loaded successfully\n"); // per QA request
    else {
      // per QA request
      var e = new Components.Exception("", aStatus);
      var name = e.name;
      dump("Error loading URL "+urlStr+" : "+
           Number(aStatus).toString(16));
      if (name)
           dump(" ("+name+")");
      dump('\n');
    }

    var notification = Components.isSuccessCode(aStatus) ? "EndDocumentLoad" : "FailDocumentLoad";
    try {
      Services.obs.notifyObservers(content, notification, urlStr);
    } catch (e) {
    }
  }
}

