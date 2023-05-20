/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["Communicator"];

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

this.Communicator = {
  service: Services,
  xpcom: XPCOMUtils,
  platform:
#ifdef MOZ_WIDGET_GTK
    "linux",
#elif XP_WIN
    "win",
#elif XP_MACOSX
    "macosx",
#elif MOZ_WIDGET_ANDROID
    "android",
#elif XP_LINUX
    "linux",
#else
    "other",
#endif
  isPlatformAndVersionAtLeast: function(platform, version) {
    let platformVersion = Services.sysinfo.getProperty("version");
    return platform == this.platform &&
           Services.vc.compare(platformVersion, version) >= 0;
  },
  isPlatformAndVersionAtMost: function(platform, version) {
    let platformVersion = Services.sysinfo.getProperty("version");
    return platform == this.platform &&
           Services.vc.compare(platformVersion, version) <= 0;
  },
  showLicenseWindow: function() {
    var eulaDone = null;
    eulaDone = Services.prefs.getBoolPref("app.eula.accepted", false);

    if (!eulaDone) {
      Services.ww.openWindow(null, "chrome://communicator/content/eula/eula.xul",
                           "_blank", "chrome,centerscreen,modal,resizable=no", null);
    }
  },
  readfile: function(aDSDir, aFile) {
    Components.utils.import("resource://gre/modules/FileUtils.jsm");
    Components.utils.import("resource://gre/modules/NetUtil.jsm");
    
    var file = FileUtils.getFile(aDSDir, [aFile]);
    
    if (!file.exists()) {
      Components.utils.reportError("Communicator.readfile: " + aFile + " does not exist in " + aDSDir);
      return "No Data";
    }
    
    var stream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                                   .createInstance(Components.interfaces.nsIFileInputStream);

    try {
      stream.init(file, -1, 0, 0);
      var data = NetUtil.readInputStreamToString(stream, stream.available());
    }
    catch (ex) {
      Components.utils.reportError("Communicator.readfile: file stream failure in " + aDSdir + "/" + aFile);
      return "No data";
    }

    stream.close();

    return data;
  },
}
