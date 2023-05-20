/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var gGeneralPane = {
  mPane: null,
  mStartPageUrl: "",

  _loadInContent: Services.prefs.getBoolPref("mail.preferences.inContent"),

  init: function ()
  {
    this.mPane = document.getElementById("paneGeneral");

    this.updateStartPage();
    this.updatePlaySound();
    this.updateCustomizeAlert();
    this.updateWebSearch();

    if (this._loadInContent) {
      gSubDialog.init();
    }
  },

  /**
   * Restores the default start page as the user's start page
   */
  restoreDefaultStartPage: function()
  {
    var startPage = document.getElementById("mailnews.start_page.url");
    startPage.value = startPage.defaultValue;
  },

  /**
   * Returns a formatted url corresponding to the value of mailnews.start_page.url
   * Stores the original value of mailnews.start_page.url
   */
  readStartPageUrl: function()
  {
    var pref = document.getElementById("mailnews.start_page.url");
    this.mStartPageUrl = pref.value;
    return Services.urlFormatter.formatURL(this.mStartPageUrl);
  },

  /**
   * Returns the value of the mailnews start page url represented by the UI.
   * If the url matches the formatted version of our stored value, then
   * return the unformatted url.
   */
  writeStartPageUrl: function()
  {
    var startPage = document.getElementById('mailnewsStartPageUrl');
    return Services.urlFormatter.formatURL(this.mStartPageUrl) == startPage.value ? this.mStartPageUrl : startPage.value;
  },

  customizeMailAlert: function()
  {
    if (this._loadInContent) {
      gSubDialog.open("chrome://messenger/content/preferences/notifications.xul",
                      "resizable=no");
    } else {
      document.documentElement
              .openSubDialog("chrome://messenger/content/preferences/notifications.xul",
                              "", null);
    }
  },

  configureDockOptions: function()
  {
    if (this._loadInContent) {
      gSubDialog.open("chrome://messenger/content/preferences/dockoptions.xul",
                      "resizable=no");
    } else {
      document.documentElement
              .openSubDialog("chrome://messenger/content/preferences/dockoptions.xul",
                              "", null);
    }
  },

  convertURLToLocalFile: function(aFileURL)
  {
    // convert the file url into a nsILocalFile
    if (aFileURL)
    {
      return Services.io
                     .getProtocolHandler("file")
                     .QueryInterface(Components.interfaces.nsIFileProtocolHandler)
                     .getFileFromURLSpec(aFileURL);
    }
    else
      return null;
  },

  readSoundLocation: function()
  {
    var soundUrlLocation = document.getElementById("soundUrlLocation");
    soundUrlLocation.value = document.getElementById("mail.biff.play_sound.url").value;
    if (soundUrlLocation.value)
    {
      soundUrlLocation.label = this.convertURLToLocalFile(soundUrlLocation.value).leafName;
      soundUrlLocation.image = "moz-icon://" + soundUrlLocation.label + "?size=16";
    }
    return undefined;
  },

  previewSound: function ()
  {
    let sound = Components.classes["@mozilla.org/sound;1"]
                          .createInstance(Components.interfaces.nsISound);

    let soundLocation;
    // soundType radio-group isn't used for macOS so it is not in the XUL file
    // for the platform.
    soundLocation = (AppConstants.platform == "macosx" ||
                     document.getElementById('soundType').value == 1) ?
                       document.getElementById('soundUrlLocation').value : "";

    if (!soundLocation.includes("file://")) {
      // User has not set any custom sound file to be played
      sound.playEventSound(Components.interfaces.nsISound.EVENT_NEW_MAIL_RECEIVED);
    } else {
      // User has set a custom audio file to be played along the alert.
      sound.play(Services.io.newURI(soundLocation, null, null));
    }
  },

  browseForSoundFile: function ()
  {
    const nsIFilePicker = Components.interfaces.nsIFilePicker;
    var fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);

    // if we already have a sound file, then use the path for that sound file
    // as the initial path in the dialog.
    var localFile = this.convertURLToLocalFile(document.getElementById('soundUrlLocation').value);
    if (localFile)
      fp.displayDirectory = localFile.parent;

    // XXX todo, persist the last sound directory and pass it in
    fp.init(window, document.getElementById("bundlePreferences").getString("soundFilePickerTitle"), nsIFilePicker.modeOpen);

    // On Mac, allow AIFF and CAF files too
    var bundlePrefs = document.getElementById("bundlePreferences");
    var soundFilesText = bundlePrefs.getString("soundFilesDescription");
    if (AppConstants.platform == "macosx")
      fp.appendFilter(soundFilesText, "*.wav; *.aif; *.aiff; *.caf; *.mp3");
    else if (AppConstants.platform == "linux")
      fp.appendFilter(soundFilesText, "*.wav; *.ogg");
    else
      fp.appendFilter(soundFilesText, "*.wav");

    var ret = fp.show();
    if (ret == nsIFilePicker.returnOK)
    {
      // convert the nsILocalFile into a nsIFile url
      document.getElementById("mail.biff.play_sound.url").value = fp.fileURL.spec;
      this.readSoundLocation(); // XXX We shouldn't have to be doing this by hand
      this.updatePlaySound();
    }
  },

  updatePlaySound: function()
  {
    // Update the sound type radio buttons based on the state of the
    // play sound checkbox.
    var soundsDisabled = !document.getElementById('newMailNotification').checked;
    var soundUrlLocation = document.getElementById('soundUrlLocation').value;

    // The UI is different on OS X as the user can only choose between letting
    // the system play a default sound or setting a custom one. Therefore,
    // "soundTypeEl" does not exist on OS X.
    if (AppConstants.platform != "macosx") {
      var soundTypeEl = document.getElementById('soundType');
      soundTypeEl.disabled = soundsDisabled;
      document.getElementById('browseForSound').disabled =
        soundsDisabled || soundTypeEl.value != 1;
      document.getElementById('playSound').disabled =
        soundsDisabled || (!soundUrlLocation && soundTypeEl.value != 0);
    } else {
      // On OS X, if there is no selected custom sound then default one will
      // be played. We keep consistency by disabling the "Play sound" checkbox
      // if the user hasn't selected a custom sound file yet.
      document.getElementById('newMailNotification').disabled = !soundUrlLocation;
      document.getElementById('playSound').disabled = !soundUrlLocation;
      // The sound type radiogroup is hidden, but we have to keep the
      // play_sound.type pref set appropriately.
      document.getElementById("mail.biff.play_sound.type").value =
        (!soundsDisabled && soundUrlLocation) ? 1 : 0;
    }
  },

  updateStartPage: function()
  {
    document.getElementById("mailnewsStartPageUrl").disabled =
      !document.getElementById("mailnewsStartPageEnabled").checked;
  },

  updateCustomizeAlert: function()
  {
    // The button does not exist on all platforms.
    let customizeAlertButton = document.getElementById("customizeMailAlert");
    if (customizeAlertButton) {
      customizeAlertButton.disabled =
        !document.getElementById("newMailNotificationAlert").checked;
    }
  },

  updateWebSearch: function() {
    let self = this;
    Services.search.init({
      onInitComplete: function() {
        let engineList = document.getElementById("defaultWebSearch");
        for (let engine of Services.search.getVisibleEngines()) {
          let item = engineList.appendItem(engine.name);
          item.engine = engine;
          item.className = "menuitem-iconic";
          item.setAttribute(
            "image", engine.iconURI ? engine.iconURI.spec :
                     "resource://gre-resources/broken-image.png"
          );
          if (engine == Services.search.currentEngine)
            engineList.selectedItem = item;
        }
        self.defaultEngines = Services.search.getDefaultEngines();
        self.updateRemoveButton();

        engineList.addEventListener("command", function() {
          Services.search.currentEngine = engineList.selectedItem.engine;
          self.updateRemoveButton();
        });
      }
    });
  },

  // Caches the default engines so we only retrieve them once.
  defaultEngines: null,

  updateRemoveButton() {
    let engineList = document.getElementById("defaultWebSearch");
    let removeButton = document.getElementById("removeSearchEngine");
    if (this.defaultEngines.includes(Services.search.currentEngine)) {
      // Don't allow deletion of a default engine (saves us having a 'restore' button).
      removeButton.disabled = true;
    } else {
      // Don't allow removal of last engine. This shouldn't happen since there should
      // always be default engines.
      removeButton.disabled = engineList.itemCount <= 1;
    }
  },

  addSearchEngine() {
    let fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
    fp.init(window, "", Components.interfaces.nsIFilePicker.modeOpen);

    // Filter on XML files only
    fp.appendFilter("XML", "*.xml");

    fp.open(rv => {
      if (rv != Components.interfaces.nsIFilePicker.returnOK || !fp.file) {
        return;
      }
      let engineAdd = "";
      engineAdd = fp.fileURL.spec;
      let self = this;
      Services.search.addEngine(engineAdd, null, "", false, {
        onSuccess(engine) {
          // Add new engine to the list.
          let engineList = document.getElementById("defaultWebSearch");

          let item = engineList.appendItem(engine.name);
          item.engine = engine;
          item.className = "menuitem-iconic";
          item.setAttribute(
            "image", engine.iconURI ? engine.iconURI.spec :
                     "resource://gre-resources/broken-image.png"
          );

          self.updateRemoveButton();
        },
        onError(errCode) { /* no-op so far */
        },
      });
    });
  },

  removeSearchEngine() {
    // Deletes the current engine. Firefox does a better job since it
    // shows all the engines in the list. But better than nothing.
    let engineList = document.getElementById("defaultWebSearch");
    for (let i = 0; i < engineList.itemCount; i++) {
      let item = engineList.getItemAtIndex(i);
      if (item.engine == Services.search.currentEngine) {
        item.remove();
        engineList.selectedIndex = 0;
        Services.search.removeEngine(item.engine);
        this.updateRemoveButton();
        break;
      }
    }
  },
};
