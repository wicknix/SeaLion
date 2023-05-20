/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var FullScreen =
{
  toggle: function()
  {
    var show = !window.fullScreen;
    // show/hide all menubars, toolbars, and statusbars (except the full screen toolbar)
    this.showXULChrome("toolbar", show);
    this.showXULChrome("statusbar", show);

    var toolbox = getNavToolbox();
    if (show)
      toolbox.removeAttribute("inFullscreen");
    else
      toolbox.setAttribute("inFullscreen", true);

    var controls = document.getElementsByAttribute("fullscreencontrol", "true");
    for (let i = 0; i < controls.length; ++i)
      controls[i].hidden = show;

    controls = document.getElementsByAttribute("domfullscreenhidden", "true");
    if (document.mozFullScreen) {
      for (let i = 0; i < controls.length; ++i)
        controls[i].setAttribute("moz-collapsed", "true");
      getBrowser().mStrip.setAttribute("moz-collapsed", "true");
    } else {
      for (let i = 0; i < controls.length; ++i)
        controls[i].removeAttribute("moz-collapsed");
      getBrowser().mStrip.removeAttribute("moz-collapsed");
    }
    getBrowser().getNotificationBox().notificationsHidden = document.mozFullScreen;
  },

  showXULChrome: function(aTag, aShow)
  {
    var XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    var els = document.getElementsByTagNameNS(XULNS, aTag);

    var i;
    for (i = 0; i < els.length; ++i) {
      // XXX don't interfere with previously collapsed toolbars
      if (els[i].getAttribute("fullscreentoolbar") == "true" &&
          !document.mozFullScreen) {
        if (!aShow) {
          var toolbarMode = els[i].getAttribute("mode");
          if (toolbarMode != "text") {
            els[i].setAttribute("saved-mode", toolbarMode);
            els[i].setAttribute("saved-iconsize",
                                els[i].getAttribute("iconsize"));
            els[i].setAttribute("mode", "icons");
            els[i].setAttribute("iconsize", "small");
          }

          // XXX See bug 202978: we disable the context menu
          // to prevent customization while in fullscreen, which
          // causes menu breakage.
          els[i].setAttribute("saved-context",
                              els[i].getAttribute("context"));
          els[i].removeAttribute("context");

          // Set the inFullscreen attribute to allow specific styling
          // in fullscreen mode
          els[i].setAttribute("inFullscreen", true);
        }
        else {
          this.restoreAttribute(els[i], "mode");
          this.restoreAttribute(els[i], "iconsize");
          this.restoreAttribute(els[i], "context"); // XXX see above

          els[i].removeAttribute("inFullscreen");
          els[i].removeAttribute("moz-collapsed");
        }
      } else if (els[i].getAttribute("type") == "menubar") {
        if (aShow) {
          this.restoreAttribute(els[i], "autohide");
        }
        else {
          els[i].setAttribute("saved-autohide",
                              els[i].getAttribute("autohide"));
          els[i].setAttribute("autohide", "true");
        }
      } else {
        // use moz-collapsed so it doesn't persist hidden/collapsed,
        // so that new windows don't have missing toolbars
        if (aShow)
          els[i].removeAttribute("moz-collapsed");
        else
          els[i].setAttribute("moz-collapsed", "true");
      }
    }
  },

  restoreAttribute: function(element, attributeName)
  {
    var savedAttribute = "saved-" + attributeName;
    if (element.hasAttribute(savedAttribute)) {
      var savedValue = element.getAttribute(savedAttribute);
      element.setAttribute(attributeName, savedValue);
      element.removeAttribute(savedAttribute);
    }
  }

};
