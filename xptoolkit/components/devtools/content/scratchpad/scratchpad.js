/* vim:set ts=2 sw=2 sts=2 et:
 * ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Scratchpad.
 *
 * The Initial Developer of the Original Code is
 * The Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Rob Campbell <robcee@mozilla.com> (original author)
 *   Erik Vold <erikvvold@gmail.com>
 *   David Dahl <ddahl@mozilla.com>
 *   Mihai Sucan <mihai.sucan@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK *****/

/*
 * Original version history can be found here:
 * https://github.com/mozilla/workspace
 *
 * Copied and relicensed from the Public Domain.
 * See bug 653934 for details.
 * https://bugzilla.mozilla.org/show_bug.cgi?id=653934
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource:///modules/communicator/devtools/PropertyPanel.jsm");

const SCRATCHPAD_CONTEXT_CONTENT = 1;
const SCRATCHPAD_CONTEXT_BROWSER = 2;
const SCRATCHPAD_WINDOW_URL = "chrome://communicator/content/devtools/scratchpad.xul";
const SCRATCHPAD_L10N = "chrome://communicator/locale/devtools/scratchpad.properties";
const SCRATCHPAD_WINDOW_FEATURES = "chrome,titlebar,toolbar,centerscreen,resizable,dialog=no";
const DEVTOOLS_CHROME_ENABLED = "devtools.chrome.enabled";

const PREF_TABSIZE = "devtools.editor.tabsize";
const PREF_EXPANDTAB = "devtools.editor.expandtab";

/**
 * The scratchpad object handles the Scratchpad window functionality.
 */
var Scratchpad = {
  /**
   * The script execution context. This tells Scratchpad in which context the
   * script shall execute.
   *
   * Possible values:
   *   - SCRATCHPAD_CONTEXT_CONTENT to execute code in the context of the current
   *   tab content window object.
   *   - SCRATCHPAD_CONTEXT_BROWSER to execute code in the context of the
   *   currently active chrome window object.
   */
  executionContext: SCRATCHPAD_CONTEXT_CONTENT,

  /**
   * Retrieve the xul:textbox DOM element. This element holds the source code
   * the user writes and executes.
   */
  get textbox() document.getElementById("scratchpad-textbox"),

  /**
   * Retrieve the xul:statusbarpanel DOM element. The status bar tells the
   * current code execution context.
   */
  get statusbarStatus() document.getElementById("scratchpad-status"),

  /**
   * Get the selected text from the textbox.
   */
  get selectedText()
  {
    return this.textbox.value.substring(this.textbox.selectionStart,
                                        this.textbox.selectionEnd);
  },

  /**
   * Get the most recent chrome window of type navigator:browser.
   */
  get browserWindow() Services.wm.getMostRecentWindow("navigator:browser"),

  /**
   * Reference to the last chrome window of type navigator:browser. We use this
   * to check if the chrome window changed since the last code evaluation.
   */
  _previousWindow: null,

  /**
   * Get the gBrowser object of the most recent browser window.
   */
  get gBrowser()
  {
    let recentWin = this.browserWindow;
    return recentWin ? recentWin.gBrowser : null;
  },

  insertIntro: function SP_insertIntro()
  {
    this.textbox.value = this.strings.GetStringFromName("scratchpadIntro");
  },

  /**
   * Cached Cu.Sandbox object for the active tab content window object.
   */
  _contentSandbox: null,

  /**
   * Get the Cu.Sandbox object for the active tab content window object. Note
   * that the returned object is cached for later reuse. The cached object is
   * kept only for the current location in the current tab of the current
   * browser window and it is reset for each context switch,
   * navigator:browser window switch, tab switch or navigation.
   */
  get contentSandbox()
  {
    if (!this.browserWindow) {
      Cu.reportError(this.strings.
                     GetStringFromName("browserWindow.unavailable"));
      return;
    }

    if (!this._contentSandbox ||
        this.browserWindow != this._previousBrowserWindow ||
        this._previousBrowser != this.gBrowser.selectedBrowser ||
        this._previousLocation != this.gBrowser.contentWindow.location.href) {
      let contentWindow = this.gBrowser.selectedBrowser.contentWindow;
      this._contentSandbox = new Cu.Sandbox(contentWindow,
        { sandboxPrototype: contentWindow, wantXrays: false });

      this._previousBrowserWindow = this.browserWindow;
      this._previousBrowser = this.gBrowser.selectedBrowser;
      this._previousLocation = contentWindow.location.href;
    }

    return this._contentSandbox;
  },

  /**
   * Cached Cu.Sandbox object for the most recently active navigator:browser
   * chrome window object.
   */
  _chromeSandbox: null,

  /**
   * Get the Cu.Sandbox object for the most recently active navigator:browser
   * chrome window object. Note that the returned object is cached for later
   * reuse. The cached object is kept only for the current browser window and it
   * is reset for each context switch or navigator:browser window switch.
   */
  get chromeSandbox()
  {
    if (!this.browserWindow) {
      Cu.reportError(this.strings.
                     GetStringFromName("browserWindow.unavailable"));
      return;
    }

    if (!this._chromeSandbox ||
        this.browserWindow != this._previousBrowserWindow) {
      this._chromeSandbox = new Cu.Sandbox(this.browserWindow,
        { sandboxPrototype: this.browserWindow, wantXrays: false });

      this._previousBrowserWindow = this.browserWindow;
    }

    return this._chromeSandbox;
  },

  /**
   * Drop the textbox selection.
   */
  deselect: function SP_deselect()
  {
    this.textbox.selectionEnd = this.textbox.selectionStart;
  },

  /**
   * Select a specific range in the Scratchpad xul:textbox.
   *
   * @param number aStart
   *        Selection range start.
   * @param number aEnd
   *        Selection range end.
   */
  selectRange: function SP_selectRange(aStart, aEnd)
  {
    this.textbox.selectionStart = aStart;
    this.textbox.selectionEnd = aEnd;
  },

  /**
   * Evaluate a string in the active tab content window.
   *
   * @param string aString
   *        The script you want evaluated.
   * @return mixed
   *         The script evaluation result.
   */
  evalInContentSandbox: function SP_evalInContentSandbox(aString)
  {
    let result;
    try {
      result = Cu.evalInSandbox(aString, this.contentSandbox, "1.8",
                                "Scratchpad", 1);
    }
    catch (ex) {
      this.openWebConsole();

      let contentWindow = this.gBrowser.selectedBrowser.contentWindow;

      let scriptError = Cc["@mozilla.org/scripterror;1"].
                        createInstance(Ci.nsIScriptError);

      scriptError.initWithWindowID(ex.message + "\n" + ex.stack, ex.fileName,
                                   "", ex.lineNumber, 0, scriptError.errorFlag,
                                   "content javascript",
                                   this.getWindowId(contentWindow));

      Services.console.logMessage(scriptError);
    }

    return result;
  },

  /**
   * Evaluate a string in the most recent navigator:browser chrome window.
   *
   * @param string aString
   *        The script you want evaluated.
   * @return mixed
   *         The script evaluation result.
   */
  evalInChromeSandbox: function SP_evalInChromeSandbox(aString)
  {
    let result;
    try {
      result = Cu.evalInSandbox(aString, this.chromeSandbox, "1.8",
                                "Scratchpad", 1);
    }
    catch (ex) {
      Cu.reportError(ex);
      Cu.reportError(ex.stack);
      this.openErrorConsole();
    }

    return result;
  },

  /**
   * Evaluate a string in the currently desired context, that is either the
   * chrome window or the tab content window object.
   *
   * @param string aString
   *        The script you want to evaluate.
   * @return mixed
   *         The script evaluation result.
   */
  evalForContext: function SP_evaluateForContext(aString)
  {
    return this.executionContext == SCRATCHPAD_CONTEXT_CONTENT ?
           this.evalInContentSandbox(aString) :
           this.evalInChromeSandbox(aString);
  },

  /**
   * Execute the selected text (if any) or the entire textbox content in the
   * current context.
   */
  run: function SP_run()
  {
    let selection = this.selectedText || this.textbox.value;
    let result = this.evalForContext(selection);
    this.deselect();
    return [selection, result];
  },

  /**
   * Execute the selected text (if any) or the entire textbox content in the
   * current context. The resulting object is opened up in the Property Panel
   * for inspection.
   */
  inspect: function SP_inspect()
  {
    let [selection, result] = this.run();

    if (result) {
      this.openPropertyPanel(selection, result);
    }
  },

  /**
   * Execute the selected text (if any) or the entire textbox content in the
   * current context. The evaluation result is inserted into the textbox after
   * the selected text, or at the end of the textbox value if there is no
   * selected text.
   */
  display: function SP_display()
  {
    let selectionStart = this.textbox.selectionStart;
    let selectionEnd = this.textbox.selectionEnd;
    if (selectionStart == selectionEnd) {
      selectionEnd = this.textbox.value.length;
    }

    let [selection, result] = this.run();
    if (!result) {
      return;
    }

    let firstPiece = this.textbox.value.slice(0, selectionEnd);
    let lastPiece = this.textbox.value.
                    slice(selectionEnd, this.textbox.value.length);

    let newComment = "/*\n" + result.toString() + "\n*/";

    this.textbox.value = firstPiece + newComment + lastPiece;

    // Select the added comment.
    this.selectRange(firstPiece.length, firstPiece.length + newComment.length);
  },

  /**
   * Open the Property Panel to inspect the given object.
   *
   * @param string aEvalString
   *        The string that was evaluated. This is re-used when the user updates
   *        the properties list, by clicking the Update button.
   * @param object aOutputObject
   *        The object to inspect, which is the aEvalString evaluation result.
   * @return object
   *         The PropertyPanel object instance.
   */
  openPropertyPanel: function SP_openPropertyPanel(aEvalString, aOutputObject)
  {
    let self = this;
    let propPanel;
    // The property panel has a button:
    // `Update`: reexecutes the string executed on the command line. The
    // result will be inspected by this panel.
    let buttons = [];

    // If there is a evalString passed to this function, then add a `Update`
    // button to the panel so that the evalString can be reexecuted to update
    // the content of the panel.
    if (aEvalString !== null) {
      buttons.push({
        label: this.strings.
               GetStringFromName("propertyPanel.updateButton.label"),
        accesskey: this.strings.
                   GetStringFromName("propertyPanel.updateButton.accesskey"),
        oncommand: function () {
          try {
            let result = self.evalForContext(aEvalString);

            if (result !== undefined) {
              propPanel.treeView.data = result;
            }
          }
          catch (ex) { }
        }
      });
    }

    let doc = this.browserWindow.document;
    let parent = doc.getElementById("mainPopupSet");
    let title = aOutputObject.toString();
    propPanel = new PropertyPanel(parent, doc, title, aOutputObject, buttons);

    let panel = propPanel.panel;
    panel.setAttribute("class", "scratchpad_propertyPanel");
    panel.openPopup(null, "after_pointer", 0, 0, false, false);
    panel.sizeTo(200, 400);

    return propPanel;
  },

  // Menu Operations

  /**
   * Open a new Scratchpad window.
   */
  openScratchpad: function SP_openScratchpad()
  {
    Services.ww.openWindow(null, SCRATCHPAD_WINDOW_URL, "_blank",
                           SCRATCHPAD_WINDOW_FEATURES, null);
  },

  /**
   * Export the textbox content to a file.
   *
   * @param nsILocalFile aFile
   *        The file where you want to save the textbox content.
   * @param boolean aNoConfirmation
   *        If the file already exists, ask for confirmation?
   * @param boolean aSilentError
   *        True if you do not want to display an error when file save fails,
   *        false otherwise.
   * @param function aCallback
   *        Optional function you want to call when file save completes. It will
   *        get the following arguments:
   *        1) the nsresult status code for the export operation.
   */
  exportToFile: function SP_exportToFile(aFile, aNoConfirmation, aSilentError,
                                         aCallback)
  {
    if (!aNoConfirmation && aFile.exists() &&
        !window.confirm(this.strings.
                        GetStringFromName("export.fileOverwriteConfirmation"))) {
      return;
    }

    let fs = Cc["@mozilla.org/network/file-output-stream;1"].
             createInstance(Ci.nsIFileOutputStream);
    let modeFlags = 0x02 | 0x08 | 0x20;
    fs.init(aFile, modeFlags, 0644, fs.DEFER_OPEN);

    let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
                    createInstance(Ci.nsIScriptableUnicodeConverter);
    converter.charset = "UTF-8";
    let input = converter.convertToInputStream(this.textbox.value);

    let self = this;
    NetUtil.asyncCopy(input, fs, function(aStatus) {
      if (!aSilentError && !Components.isSuccessCode(aStatus)) {
        window.alert(self.strings.GetStringFromName("saveFile.failed"));
      }

      if (aCallback) {
        aCallback.call(self, aStatus);
      }
    });
  },

  /**
   * Read the content of a file and put it into the textbox.
   *
   * @param nsILocalFile aFile
   *        The file you want to save the textbox content into.
   * @param boolean aSilentError
   *        True if you do not want to display an error when file load fails,
   *        false otherwise.
   * @param function aCallback
   *        Optional function you want to call when file load completes. It will
   *        get the following arguments:
   *        1) the nsresult status code for the import operation.
   *        2) the data that was read from the file, if any.
   */
  importFromFile: function SP_importFromFile(aFile, aSilentError, aCallback)
  {
    // Prevent file type detection.
    let channel = NetUtil.newChannel(aFile);
    channel.contentType = "application/javascript";

    let self = this;
    NetUtil.asyncFetch(channel, function(aInputStream, aStatus) {
      let content = null;

      if (Components.isSuccessCode(aStatus)) {
        content = NetUtil.readInputStreamToString(aInputStream,
                                                  aInputStream.available());
        self.textbox.value = content;
      }
      else if (!aSilentError) {
        window.alert(self.strings.GetStringFromName("openFile.failed"));
      }

      if (aCallback) {
        aCallback.call(self, aStatus, content);
      }
    });
  },

  /**
   * Open a file to edit in the Scratchpad.
   */
  openFile: function SP_openFile()
  {
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, this.strings.GetStringFromName("openFile.title"),
            Ci.nsIFilePicker.modeOpen);
    fp.defaultString = "";
    if (fp.show() != Ci.nsIFilePicker.returnCancel) {
      document.title = this.filename = fp.file.path;
      this.importFromFile(fp.file);
    }
  },

  /**
   * Save the textbox content to the currently open file.
   */
  saveFile: function SP_saveFile()
  {
    if (!this.filename) {
      return this.saveFileAs();
    }

    let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    file.initWithPath(this.filename);
    this.exportToFile(file, true);
  },

  /**
   * Save the textbox content to a new file.
   */
  saveFileAs: function SP_saveFileAs()
  {
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, this.strings.GetStringFromName("saveFileAs"),
            Ci.nsIFilePicker.modeSave);
    fp.defaultString = "scratchpad.js";
    if (fp.show() != Ci.nsIFilePicker.returnCancel) {
      document.title = this.filename = fp.file.path;
      this.exportToFile(fp.file, true);
    }
  },

  /**
   * Open the Error Console.
   */
  openErrorConsole: function SP_openErrorConsole()
  {
    this.browserWindow.toJavaScriptConsole();
  },

  /**
   * Open the Web Console.
   */
  openWebConsole: function SP_openWebConsole()
  {
    try {
      if (!this.browserWindow.HUDConsoleUI.getOpenHUD()) {
        this.browserWindow.HUDConsoleUI.toggleHUD();
      }
      this.browserWindow.focus();
    }
    catch (ex) {
      this.openErrorConsole();
    }
  },

  /**
   * Set the current execution context to be the active tab content window.
   */
  setContentContext: function SP_setContentContext()
  {
    let content = document.getElementById("sp-menu-content");
    document.getElementById("sp-menu-browser").removeAttribute("checked");
    content.setAttribute("checked", true);
    this.executionContext = SCRATCHPAD_CONTEXT_CONTENT;
    this.statusbarStatus.label = content.getAttribute("label");
    this.resetContext();
  },

  /**
   * Set the current execution context to be the most recent chrome window.
   */
  setBrowserContext: function SP_setBrowserContext()
  {
    let browser = document.getElementById("sp-menu-browser");
    document.getElementById("sp-menu-content").removeAttribute("checked");
    browser.setAttribute("checked", true);
    this.executionContext = SCRATCHPAD_CONTEXT_BROWSER;
    this.statusbarStatus.label = browser.getAttribute("label");
    this.resetContext();
  },

  /**
   * Reset the cached Cu.Sandbox object for the current context.
   */
  resetContext: function SP_resetContext()
  {
    this._chromeSandbox = null;
    this._contentSandbox = null;
    this._previousWindow = null;
    this._previousBrowser = null;
    this._previousLocation = null;
  },

  /**
   * Gets the ID of the outer window of the given DOM window object.
   *
   * @param nsIDOMWindow aWindow
   * @return integer
   *         the outer window ID
   */
  getWindowId: function SP_getWindowId(aWindow)
  {
    return aWindow.QueryInterface(Ci.nsIInterfaceRequestor).
           getInterface(Ci.nsIDOMWindowUtils).outerWindowID;
  },

  /**
   * The Scratchpad window DOMContentLoaded event handler.
   */
  onLoad: function SP_onLoad()
  {
    let chromeContextMenu = document.getElementById("sp-menu-browser");
    let errorConsoleMenu = document.getElementById("sp-menu-errorConsole");
    let errorConsoleCommand = document.getElementById("sp-cmd-errorConsole");
    let chromeContextCommand = document.getElementById("sp-cmd-browserContext");

    let chrome = Services.prefs.getBoolPref(DEVTOOLS_CHROME_ENABLED, true);
    if (chrome) {
      chromeContextMenu.removeAttribute("hidden");
      errorConsoleMenu.removeAttribute("hidden");
      errorConsoleCommand.removeAttribute("disabled");
      chromeContextCommand.removeAttribute("disabled");
    }

    let tabsize = Services.prefs.getIntPref(PREF_TABSIZE, 2);
    if (tabsize < 1) {
      // tabsize is invalid, clear back to the default value.
      Services.prefs.clearUserPref(PREF_TABSIZE);
      tabsize = Services.prefs.getIntPref(PREF_TABSIZE, 2);
    }

    let expandtab = Services.prefs.getBoolPref(PREF_EXPANDTAB, true);
    this._tabCharacter = expandtab ? (new Array(tabsize + 1)).join(" ") : "\t";
    this.textbox.style.MozTabSize = tabsize;

    // Force LTR direction (otherwise the textbox inherits the locale direction)
    this.textbox.style.direction = "ltr";
    
    this.textbox.style.border = "none";

    this.insertIntro();

    // Make the Tab key work.
    this.textbox.addEventListener("keypress", this.onKeypress.bind(this), false);

    this.textbox.focus();
  },

  /**
   * The textbox keypress event handler which allows users to indent code using
   * the Tab key.
   *
   * @param nsIDOMEvent aEvent
   */
  onKeypress: function SP_onKeypress(aEvent)
  {
    if (aEvent.keyCode == aEvent.DOM_VK_TAB) {
      this.insertTextAtCaret(this._tabCharacter);
      aEvent.preventDefault();
    }
  },

  /**
   * Insert text at the current caret location.
   *
   * @param string aText
   */
  insertTextAtCaret: function SP_insertTextAtCaret(aText)
  {
    let firstPiece = this.textbox.value.substring(0, this.textbox.selectionStart);
    let lastPiece = this.textbox.value.substring(this.textbox.selectionEnd);
    this.textbox.value = firstPiece + aText + lastPiece;

    let newCaretPosition = firstPiece.length + aText.length;
    this.selectRange(newCaretPosition, newCaretPosition);
  },
};

XPCOMUtils.defineLazyGetter(Scratchpad, "strings", function () {
  return Services.strings.createBundle(SCRATCHPAD_L10N);
});

addEventListener("DOMContentLoaded", Scratchpad.onLoad.bind(Scratchpad), false);

