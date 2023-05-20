/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this file,
* You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["ShellService"];

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "WindowsRegistry",
                                  "resource://gre/modules/WindowsRegistry.jsm");

/**
 * Internal functionality to save and restore the docShell.allow* properties.
 */
var ShellServiceInternal = {
  /**
   * Used to determine whether or not to offer "Set as desktop background"
   * functionality. Even if shell service is available it is not
   * guaranteed that it is able to set the background for every desktop
   * which is especially true for Linux with its many different desktop
   * environments.
   */
  get canSetDesktopBackground() {
#ifdef XP_LINUX
    if (this.nsIShellService) {
      let linuxShellService = this.nsIShellService
                                  .QueryInterface(Components.interfaces.nsIGNOMEShellService);
      return linuxShellService.canSetDesktopBackground;
    }
#elif defined(XP_WIN) || defined(XP_MACOSX)
    return true;
#else
    return false;
#endif
  },

  /**
   * Used to determine whether or not to show a "Set Default Browser"
   * query dialog. This attribute is true if the application is starting
   * up and "browser.shell.checkDefaultBrowser" is true, otherwise it
   * is false.
   */
  _checkedThisSession: false,
  get shouldCheckDefaultBrowser() {
    // If we've already checked, the browser has been started and this is a
    // new window open, and we don't want to check again.
    if (this._checkedThisSession) {
      return false;
    }

    if (!Services.prefs.getBoolPref("browser.shell.checkDefaultBrowser", false)) {
      return false;
    }

#ifdef XP_WIN
    let optOutValue = WindowsRegistry.readRegKey(Components.interfaces.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,
                                                 "Software\\Binary Outcast\\Borealis",
                                                 "DefaultBrowserOptOut");
    WindowsRegistry.removeRegKey(Components.interfaces.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,
                                 "Software\\Binary Outcast\\Borealis",
                                 "DefaultBrowserOptOut");
    if (optOutValue == "True") {
      Services.prefs.setBoolPref("browser.shell.checkDefaultBrowser", false);
      return false;
    }
#endif

    return true;
  },

  set shouldCheckDefaultBrowser(shouldCheck) {
    Services.prefs.setBoolPref("browser.shell.checkDefaultBrowser", !!shouldCheck);
  },

  isDefaultBrowser(startupCheck, forAllTypes) {
    // If this is the first browser window, maintain internal state that we've
    // checked this session (so that subsequent window opens don't show the
    // default browser dialog).
    if (startupCheck) {
      this._checkedThisSession = true;
    }
    if (this.nsIShellService) {
      return this.nsIShellService.isDefaultBrowser(startupCheck, forAllTypes);
    }
    return false;
  }
};

XPCOMUtils.defineLazyServiceGetter(ShellServiceInternal,
                                   "nsIShellService",
                                   "@binaryoutcast.com/navigator/shell-service;1",
                                   Components.interfaces.nsIShellService);

/**
 * The external API exported by this module.
 */
this.ShellService = new Proxy(ShellServiceInternal, {
  get(target, name) {
    if (name in target) {
      return target[name];
    }
    if (target.nsIShellService) {
      return target.nsIShellService[name];
    }
    Services.console.logStringMessage(`${name} not found in ShellService: ${target.nsIShellService}`);
    return undefined;
  }
});
