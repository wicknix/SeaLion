/* -*- Mode: Java; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource:///modules/editorUtilities.jsm");
Components.utils.import("resource://gre/modules/AppConstants.jsm");

/* Main Composer window UI control */

var gComposerWindowControllerID = 0;
var prefAuthorString = "";

var kDisplayModeNormal = 0;
var kDisplayModeAllTags = 1;
var kDisplayModeSource = 2;
var kDisplayModePreview = 3;

const kDisplayModeMenuIDs = ["viewNormalMode", "viewAllTagsMode", "viewSourceMode", "viewPreviewMode"];
const kDisplayModeTabIDS = ["NormalModeButton", "TagModeButton", "SourceModeButton", "PreviewModeButton"];
const kNormalStyleSheet = "chrome://editor/content/EditorContent.css";
const kAllTagsStyleSheet = "chrome://editor/content/EditorAllTags.css";
const kContentEditableStyleSheet = "resource://gre/res/contenteditable.css";

var kTextMimeType = "text/plain";
var kHTMLMimeType = "text/html";
var kXHTMLMimeType = "application/xhtml+xml";

var gPreviousNonSourceDisplayMode = 1;
var gEditorDisplayMode = -1;
var gDocWasModified = false;  // Check if clean document, if clean then unload when user "Opens"
var gContentWindow = 0;
var gSourceContentWindow = 0;
var gSourceTextEditor = null;
var gContentWindowDeck;
var gFormatToolbar;
var gFormatToolbarHidden = false;
var gViewFormatToolbar;
var gChromeState;
var gColorObj = { LastTextColor:"", LastBackgroundColor:"", LastHighlightColor:"",
                  Type:"", SelectedType:"", NoDefault:false, Cancel:false,
                  HighlightColor:"", BackgroundColor:"", PageColor:"",
                  TextColor:"", TableColor:"", CellColor:""
                };
var gDefaultTextColor = "";
var gDefaultBackgroundColor = "";
var gCSSPrefListener;
var gEditorToolbarPrefListener;
var gReturnInParagraphPrefListener;
var gLocalFonts = null;

var gLastFocusNode = null;
var gLastFocusNodeWasSelected = false;

// These must be kept in synch with the XUL <options> lists
var gFontSizeNames = ["xx-small","x-small","small","medium","large","x-large","xx-large"];

var nsIFilePicker = Components.interfaces.nsIFilePicker;

var kEditorToolbarPrefs = "editor.toolbars.showbutton.";
var kUseCssPref         = "editor.use_css";
var kCRInParagraphsPref = "editor.CR_creates_new_p";

function ShowHideToolbarSeparators(toolbar) {
  // Make sure the toolbar actually exists.
  if (!toolbar)
    return;
  var childNodes = toolbar.childNodes;
  var separator = null;
  var hideSeparator = true;
  for (var i = 0; childNodes[i].localName != "spacer"; i++) {
    if (childNodes[i].localName == "toolbarseparator") {
      if (separator)
        separator.hidden = true;
      separator = childNodes[i];
    } else if (!childNodes[i].hidden) {
      if (separator)
        separator.hidden = hideSeparator;
      separator = null;
      hideSeparator = false;
    }
  }
}

function ShowHideToolbarButtons()
{
  let array = Services.prefs.getChildList(kEditorToolbarPrefs);
  for (let i in array) {
    let prefName = array[i];
    let id = prefName.substr(kEditorToolbarPrefs.length);
    let button = document.getElementById(id + "Button") ||
                 document.getElementById(id + "-button");
    if (button)
      button.hidden = !Services.prefs.getBoolPref(prefName);
  }
  ShowHideToolbarSeparators(document.getElementById("EditToolbar"));
  ShowHideToolbarSeparators(document.getElementById("FormatToolbar"));
}
  
function nsPrefListener(prefName)
{
  this.startup(prefName);
}

// implements nsIObserver
nsPrefListener.prototype =
{
  domain: "",
  startup: function(prefName)
  {
    this.domain = prefName;
    try {
      Services.prefs.addObserver(this.domain, this, false);
    } catch(ex) {
      dump("Failed to observe prefs: " + ex + "\n");
    }
  },
  shutdown: function()
  {
    try {
      Services.prefs.removeObserver(this.domain, this);
    } catch(ex) {
      dump("Failed to remove pref observers: " + ex + "\n");
    }
  },
  observe: function(subject, topic, prefName)
  {
    if (!IsHTMLEditor())
      return;
    // verify that we're changing a button pref
    if (topic != "nsPref:changed")
      return;
    
    let editor = GetCurrentEditor();
    if (prefName == kUseCssPref)
    {
      let cmd = document.getElementById("cmd_highlight");
      if (cmd) {
        let useCSS = Services.prefs.getBoolPref(prefName);

        if (useCSS && editor) {
          let mixedObj = {};
          let state = editor.getHighlightColorState(mixedObj);
          cmd.setAttribute("state", state);
          cmd.collapsed = false;
        }      
        else {
          cmd.setAttribute("state", "transparent");
          cmd.collapsed = true;
        }

        if (editor)
          editor.isCSSEnabled = useCSS;
      }
    }
    else if (prefName.startsWith(kEditorToolbarPrefs))
    {
      let id = prefName.substr(kEditorToolbarPrefs.length) + "Button";
      let button = document.getElementById(id);
      if (button) {
        button.hidden = !Services.prefs.getBoolPref(prefName);
        ShowHideToolbarSeparators(button.parentNode);
      }
    }
    else if (editor && (prefName == kCRInParagraphsPref))
      editor.returnInParagraphCreatesNewParagraph = Services.prefs.getBoolPref(prefName);
  }
}

const gSourceTextListener =
{
  NotifyDocumentCreated: function NotifyDocumentCreated() {},
  NotifyDocumentWillBeDestroyed: function NotifyDocumentWillBeDestroyed() {},
  NotifyDocumentStateChanged: function NotifyDocumentStateChanged(isChanged)
  {
    window.updateCommands("save");
  }
};

const gSourceTextObserver =
{
  observe: function observe(aSubject, aTopic, aData)
  {
    // we currently only use this to update undo
    window.updateCommands("undo");
  }
};

// This should be called by all editor users when they close their window.
function EditorCleanup()
{
  SwitchInsertCharToAnotherEditorOrClose();
}

var DocumentReloadListener =
{
  NotifyDocumentCreated: function() {},
  NotifyDocumentWillBeDestroyed: function() {},

  NotifyDocumentStateChanged:function( isNowDirty )
  {
    var editor = GetCurrentEditor();
    try {
      // unregister the listener to prevent multiple callbacks
      editor.removeDocumentStateListener( DocumentReloadListener );

      var charset = editor.documentCharacterSet;

      // update the META charset with the current presentation charset
      editor.documentCharacterSet = charset;

    } catch (e) {}
  }
};

// implements nsIObserver
var gEditorDocumentObserver =
{ 
  observe: function(aSubject, aTopic, aData)
  {
    // Should we allow this even if NOT the focused editor?
    var commandManager = GetCurrentCommandManager();
    if (commandManager != aSubject)
      return;

    var editor = GetCurrentEditor();
    switch(aTopic)
    {
      case "obs_documentCreated":
        // Just for convenience
        gContentWindow = window.content;

        // Get state to see if document creation succeeded
        var params = newCommandParams();
        if (!params)
          return;

        try {
          commandManager.getCommandState(aTopic, gContentWindow, params);
          var errorStringId = 0;
          var editorStatus = params.getLongValue("state_data");
          if (!editor && editorStatus == nsIEditingSession.eEditorOK)
          {
            dump("\n ****** NO EDITOR BUT NO EDITOR ERROR REPORTED ******* \n\n");
            editorStatus = nsIEditingSession.eEditorErrorUnknown;
          }

          switch (editorStatus)
          {
            case nsIEditingSession.eEditorErrorCantEditFramesets:
              errorStringId = "CantEditFramesetMsg";
              break;
            case nsIEditingSession.eEditorErrorCantEditMimeType:
              errorStringId = "CantEditMimeTypeMsg";
              break;
            case nsIEditingSession.eEditorErrorUnknown:
              errorStringId = "CantEditDocumentMsg";
              break;
            // Note that for "eEditorErrorFileNotFound, 
            // network code popped up an alert dialog, so we don't need to
          }
          if (errorStringId)
            Services.prompt.alert(window, "", GetString(errorStringId));
        } catch(e) { dump("EXCEPTION GETTING obs_documentCreated state "+e+"\n"); }

        // We have a bad editor -- nsIEditingSession will rebuild an editor
        //   with a blank page, so simply abort here
        if (editorStatus)
          return; 

        if (!("InsertCharWindow" in window))
          window.InsertCharWindow = null;

        try {
          editor.QueryInterface(nsIEditorStyleSheets);

          //  and extra styles for showing anchors, table borders, smileys, etc
          editor.addOverrideStyleSheet(kNormalStyleSheet);

          // remove contenteditable stylesheets if they were applied by the
          // editingSession
          editor.removeOverrideStyleSheet(kContentEditableStyleSheet);
        } catch (e) {}

        // Things for just the Web Composer application
        if (IsWebComposer())
        {
          InlineSpellCheckerUI.init(editor);
          document.getElementById('menu_inlineSpellCheck').setAttribute('disabled', !InlineSpellCheckerUI.canSpellCheck);

          editor.returnInParagraphCreatesNewParagraph = Services.prefs.getBoolPref(kCRInParagraphsPref);

          // Set focus to content window if not a mail composer
          // Race conditions prevent us from setting focus here
          //   when loading a url into blank window
          setTimeout(SetFocusOnStartup, 0);

          // Call EditorSetDefaultPrefsAndDoctype first so it gets the default author before initing toolbars
          editor.enableUndo(false);
          EditorSetDefaultPrefsAndDoctype();
          editor.resetModificationCount();
          editor.enableUndo(true);

          // We may load a text document into an html editor,
          //   so be sure editortype is set correctly
          // XXX We really should use the "real" plaintext editor for this!
          if (editor.contentsMIMEType == "text/plain")
          {
            try {
              GetCurrentEditorElement().editortype = "text";
            } catch (e) { dump (e)+"\n"; }

            // Hide or disable UI not used for plaintext editing
            HideItem("FormatToolbar");
            HideItem("EditModeToolbar");
            HideItem("formatMenu");
            HideItem("tableMenu");
            HideItem("menu_validate");
            HideItem("sep_validate");
            HideItem("previewButton");
            HideItem("imageButton");
            HideItem("linkButton");
            HideItem("namedAnchorButton");
            HideItem("hlineButton");
            HideItem("tableButton");

            HideItem("fileExportToText");
            HideItem("previewInBrowser");

/* XXX When paste actually converts formatted rich text to pretty formatted plain text
       and pasteNoFormatting is fixed to paste the text without formatting (what paste
       currently does), then this item shouldn't be hidden: */
            HideItem("menu_pasteNoFormatting"); 

            HideItem("cmd_viewFormatToolbar");
            HideItem("cmd_viewEditModeToolbar");

            HideItem("viewSep1");
            HideItem("viewNormalMode");
            HideItem("viewAllTagsMode");
            HideItem("viewSourceMode");
            HideItem("viewPreviewMode");

            HideItem("structSpacer");

            // Hide everything in "Insert" except for "Symbols"
            let menuPopupChildren = document.querySelectorAll('[id="insertMenuPopup"] > :not(#insertChars)');
            for (let i = 0; i < menuPopupChildren.length; i++)
              menuPopupChildren.item(i).hidden = true;
          }
    
          // Set window title
          UpdateWindowTitle();

          // We must wait until document is created to get proper Url
          // (Windows may load with local file paths)
          SetSaveAndPublishUI(GetDocumentUrl());

          // Start in "Normal" edit mode
          SetDisplayMode(kDisplayModeNormal);
        }

        // Add mouse click watcher if right type of editor
        if (IsHTMLEditor())
        {
          // Force color widgets to update
          onFontColorChange();
          onBackgroundColorChange();
        }
        break;

      case "cmd_setDocumentModified":
        window.updateCommands("save");
        break;

      case "obs_documentWillBeDestroyed":
        dump("obs_documentWillBeDestroyed notification\n");
        break;

      case "obs_documentLocationChanged":
        // Ignore this when editor doesn't exist,
        //   which happens once when page load starts
        if (editor)
          try {
            editor.updateBaseURL();
          } catch(e) { dump (e); }
        break;

      case "cmd_bold":
        // Update all style items
        // cmd_bold is a proxy; see EditorSharedStartup (above) for details
        window.updateCommands("style");
        window.updateCommands("undo");
        break;
    }
  }
}

function SetFocusOnStartup()
{
  gContentWindow.focus();
}

function EditorLoadUrl(url)
{
  try {
    if (url)
      GetCurrentEditorElement().webNavigation.loadURI(url,                // uri string
         Components.interfaces.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE,  // load flags
         null,                                                            // referrer
         null,                                                            // post-data stream
         null);
  } catch (e) { dump(" EditorLoadUrl failed: "+e+"\n"); }
}

// This should be called by all Composer types
function EditorSharedStartup()
{
  // Just for convenience
  gContentWindow = window.content;

  // Disable DNS Prefetching on the docshell - we don't need it for composer
  // type windows.
  GetCurrentEditorElement().docShell.allowDNSPrefetch = false;

  // Set up the mime type and register the commands.
  if (IsHTMLEditor())
    SetupHTMLEditorCommands();
  else
    SetupTextEditorCommands();

  // add observer to be called when document is really done loading 
  // and is modified
  // Note: We're really screwed if we fail to install this observer!
  try {
    var commandManager = GetCurrentCommandManager();
    commandManager.addCommandObserver(gEditorDocumentObserver, "obs_documentCreated");
    commandManager.addCommandObserver(gEditorDocumentObserver, "cmd_setDocumentModified");
    commandManager.addCommandObserver(gEditorDocumentObserver, "obs_documentWillBeDestroyed");
    commandManager.addCommandObserver(gEditorDocumentObserver, "obs_documentLocationChanged");

    // Until nsIControllerCommandGroup-based code is implemented,
    //  we will observe just the bold command to trigger update of
    //  all toolbar style items
    commandManager.addCommandObserver(gEditorDocumentObserver, "cmd_bold");
  } catch (e) { dump(e); }

  var isMac = AppConstants.platform == "macosx";

  // Set platform-specific hints for how to select cells
  // Mac uses "Cmd", all others use "Ctrl"
  var tableKey = GetString(isMac ? "XulKeyMac" : "TableSelectKey");
  var dragStr = tableKey+GetString("Drag");
  var clickStr = tableKey+GetString("Click");

  var delStr = GetString(isMac ? "Clear" : "Del");

  SafeSetAttribute("menu_SelectCell", "acceltext", clickStr);
  SafeSetAttribute("menu_SelectRow", "acceltext", dragStr);
  SafeSetAttribute("menu_SelectColumn", "acceltext", dragStr);
  SafeSetAttribute("menu_SelectAllCells", "acceltext", dragStr);
  // And add "Del" or "Clear"
  SafeSetAttribute("menu_DeleteCellContents", "acceltext", delStr);

  // Set text for indent, outdent keybinding

  // hide UI that we don't have components for
  RemoveInapplicableUIElements();

  // Use browser colors as initial values for editor's default colors
  var BrowserColors = GetDefaultBrowserColors();
  if (BrowserColors)
  {
    gDefaultTextColor = BrowserColors.TextColor;
    gDefaultBackgroundColor = BrowserColors.BackgroundColor;
  }

  // For new window, no default last-picked colors
  gColorObj.LastTextColor = "";
  gColorObj.LastBackgroundColor = "";
  gColorObj.LastHighlightColor = "";
}

function SafeSetAttribute(nodeID, attributeName, attributeValue)
{
    var theNode = document.getElementById(nodeID);
    if (theNode)
        theNode.setAttribute(attributeName, attributeValue);
}

function DocumentHasBeenSaved()
{
  var fileurl = "";
  try {
    fileurl = GetDocumentUrl();
  } catch (e) {
    return false;
  }

  if (!fileurl || IsUrlAboutBlank(fileurl))
    return false;

  // We have a file URL already
  return true;
}

function CheckAndSaveDocument(command, allowDontSave)
{
  var document;
  try {
    // if we don't have an editor or an document, bail
    var editor = GetCurrentEditor();
    document = editor.document;
    if (!document)
      return true;
  } catch (e) { return true; }

  if (!IsDocumentModified() && !IsHTMLSourceChanged())
    return true;

  // call window.focus, since we need to pop up a dialog
  // and therefore need to be visible (to prevent user confusion)
  top.document.commandDispatcher.focusedWindow.focus();  

  var scheme = GetScheme(GetDocumentUrl());
  var doPublish = (scheme && scheme != "file");

  var strID;
  switch (command)
  {
    case "cmd_close":
      strID = "BeforeClosing";
      break;
    case "cmd_preview":
      strID = "BeforePreview";
      break;
    case "cmd_editSendPage":
      strID = "SendPageReason";
      break;
    case "cmd_validate":
      strID = "BeforeValidate";
      break;
  }
    
  var reasonToSave = strID ? GetString(strID) : "";

  var title = document.title || GetString("untitledDefaultFilename");

  var dialogTitle = GetString(doPublish ? "PublishPage" : "SaveDocument");
  var dialogMsg = GetString(doPublish ? "PublishPrompt" : "SaveFilePrompt");
  dialogMsg = (dialogMsg.replace(/%title%/,title)).replace(/%reason%/,reasonToSave);

  let result = {value:0};
  let promptFlags = Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1;
  let button1Title = null;
  let button3Title = null;

  if (doPublish)
  {
    promptFlags += Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0;
    button1Title = GetString("Publish");
    button3Title = GetString("DontPublish");    
  }
  else
  {
    promptFlags += Services.prompt.BUTTON_TITLE_SAVE * Services.prompt.BUTTON_POS_0;
  }

  // If allowing "Don't..." button, add that
  if (allowDontSave)
    promptFlags += doPublish ?
        (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_2)
        : (Services.prompt.BUTTON_TITLE_DONT_SAVE * Services.prompt.BUTTON_POS_2);
  
  result = Services.prompt.confirmEx(window, dialogTitle, dialogMsg, promptFlags,
                          button1Title, null, button3Title, null, {value:0});

  if (result == 0)
  {
    // Save, but first finish HTML source mode
    SetEditMode(gPreviousNonSourceDisplayMode);
    if (doPublish)
    {
      // We save the command the user wanted to do in a global
      // and return as if user canceled because publishing is asynchronous
      // This command will be fired when publishing finishes
      gCommandAfterPublishing = command;
      goDoCommand("cmd_publish");
      return false;
    }

    // Save to local disk
    return SaveDocument(false, false, editor.contentsMIMEType);
  }

  if (result == 2) // "Don't Save"
    return true;

  // Default or result == 1 (Cancel)
  return false;
}

// --------------------------- View menu ---------------------------

function EditorSetCharacterSet(aEvent)
{
  try {
    var editor = GetCurrentEditor();
    if (aEvent.target.hasAttribute("charset"))
      editor.documentCharacterSet = aEvent.target.getAttribute("charset");
    var docUrl = GetDocumentUrl();
    if( !IsUrlAboutBlank(docUrl))
    {
      // reloading the document will reverse any changes to the META charset, 
      // we need to put them back in, which is achieved by a dedicated listener
      editor.addDocumentStateListener( DocumentReloadListener );
      EditorLoadUrl(docUrl);
    }
  } catch (e) {}
}

// --------------------------- Text style ---------------------------

function onParagraphFormatChange(paraMenuList, commandID)
{
  if (!paraMenuList)
    return;

  var commandNode = document.getElementById(commandID);
  var state = commandNode.getAttribute("state");

  // force match with "normal"
  if (state == "body")
    state = "";

  if (state == "mixed")
  {
    //Selection is the "mixed" ( > 1 style) state
    paraMenuList.selectedItem = null;
    paraMenuList.setAttribute("label",GetString('Mixed'));
  }
  else
  {
    var menuPopup = document.getElementById("ParagraphPopup");
    var menuItems = menuPopup.childNodes;
    for (var i=0; i < menuItems.length; i++)
    {
      var menuItem = menuItems.item(i);
      if ("value" in menuItem && menuItem.value == state)
      {
        paraMenuList.selectedItem = menuItem;
        break;
      }
    }
  }
}

/**
 * Selects the current font face in the menulist.
 *
 * @param fontFaceMenuList  The menulist element containing the list of fonts.
 * @param commandID         The commandID which holds the current font name
 *                          in its "state" attribute.
 */
function onFontFaceChange(fontFaceMenuList, commandID)
{
  var commandNode = document.getElementById(commandID);
  var editorFont = commandNode.getAttribute("state");

  // Strip quotes in font names. Experiments have shown that we only
  // ever get double quotes around the font name, never single quotes,
  // even if they were in the HTML source. Also single or double
  // quotes within the font name are never returned.
  editorFont = editorFont.replace(/"/g, "");

  switch (editorFont) {
  case "mixed":
    // Selection is the "mixed" ( > 1 style) state.
    fontFaceMenuList.selectedItem = null;
    fontFaceMenuList.setAttribute("label",GetString('Mixed'));
    return;
  case "":
  case "serif":
  case "sans-serif":
    // Generic variable width.
    fontFaceMenuList.selectedIndex = 0;
    return;
  case "tt":
  case "monospace":
    // Generic fixed width.
    fontFaceMenuList.selectedIndex = 1;
    return;
  default:
  }

  let menuPopup = fontFaceMenuList.menupopup;
  let menuItems = menuPopup.childNodes;

  const genericFamilies = [ "serif", "sans-serif", "monospace", "fantasy", "cursive" ];
  // Bug 1139524: Normalise before we compare: Make it lower case
  // and replace ", " with "," so that entries like
  // "Helvetica, Arial, sans-serif" are always recognised correctly
  let editorFontToLower = editorFont.toLowerCase().replace(/, /g, ",");
  let foundFont = null;
  let exactMatch = false;
  let usedFontsSep = menuPopup.querySelector("menuseparator.fontFaceMenuAfterUsedFonts");
  let editorFontOptions = editorFontToLower.split(",");
  let editorOptionsCount = editorFontOptions.length;
  let matchedFontIndex = editorOptionsCount; // initialise to high invalid value

  // The font menu has this structure:
  // 0: Variable Width
  // 1: Fixed Width
  // 2: Separator
  // 3: Helvetica, Arial (stored as Helvetica, Arial, sans-serif)
  // 4: Times (stored as Times New Roman, Times, serif)
  // 5: Courier (stored as Courier New, Courier, monospace)
  // 6: Separator, "menuseparator.fontFaceMenuAfterDefaultFonts"
  // from 7: Used Font Section (for quick selection)
  // followed by separator, "menuseparator.fontFaceMenuAfterUsedFonts"
  // followed by all other available fonts.
  // The following variable keeps track of where we are when we loop over the menu.
  let afterUsedFontSection = false;

  // The menu items not only have "label" and "value", but also some other attributes:
  // "value_parsed": Is the toLowerCase() and space-stripped value.
  // "value_cache":  Is a concatenation of all editor fonts that were ever mapped
  //                 onto this menu item. This is done for optimization.
  // "used":         This item is in the used font section.

  for (let i = 0; i < menuItems.length; i++)
  {
    let menuItem = menuItems.item(i);
    if (menuItem.hasAttribute("label") && menuItem.hasAttribute("value_parsed"))
    {
      // The element seems to represent a font <menuitem>.
      let fontMenuValue = menuItem.getAttribute("value_parsed");
      if (fontMenuValue == editorFontToLower ||
          (menuItem.hasAttribute("value_cache") &&
           menuItem.getAttribute("value_cache").split("|").includes(editorFontToLower)))
      {
        // This menuitem contains the font we are looking for.
        foundFont = menuItem;
        exactMatch = true;
        break;
      }
      else if (editorOptionsCount > 1 && afterUsedFontSection)
      {
        // Once we are in the list of all other available fonts,
        // we will find the one that best matches one of the options.
        let matchPos = editorFontOptions.indexOf(fontMenuValue);
        if (matchPos >= 0 && matchPos < matchedFontIndex)
        {
          // This menu font comes earlier in the list of options,
          // so prefer it.
          matchedFontIndex = matchPos;
          foundFont = menuItem;
          // If we matched the first option, we don't need to look for
          // a better match.
          if (matchPos == 0)
            break;
        }
      }
    }
    else
    {
      // Some other element type.
      if (menuItem == usedFontsSep)
      {
        // We have now passed the section of used fonts and are now in the list of all.
        afterUsedFontSection = true;
      }
    }
  }

  if (foundFont)
  {
    let defaultFontsSep = menuPopup.querySelector("menuseparator.fontFaceMenuAfterDefaultFonts");
    if (exactMatch)
    {
      if (afterUsedFontSection)
      {
        // Copy the matched font into the section of used fonts.
        // We insert after the separator following the default fonts,
        // so right at the beginning of the used fonts section.
        let copyItem = foundFont.cloneNode(true);
        menuPopup.insertBefore(copyItem, defaultFontsSep.nextSibling);
        usedFontsSep.hidden = false;
        foundFont = copyItem;
        foundFont.setAttribute("used", "true");
      }
    }
    else
    {
      // Keep only the found font and generic families in the font string.
      editorFont = editorFont.replace(/, /g, ",").split(",").filter(
        font => ((font.toLowerCase() == foundFont.getAttribute("value_parsed")) ||
                 genericFamilies.includes(font))).join(",");

      // Check if such an item is already in the used font section.
      if (afterUsedFontSection)
        foundFont = menuPopup.querySelector('menuitem[used="true"][value_parsed="'+
                    editorFont.toLowerCase()+'"]');
      // If not, create a new entry which will be inserted into that section.
      if (!foundFont)
        foundFont = createFontFaceMenuitem(editorFont, editorFont, menuPopup);

      // Add the editor font string into the 'cache' attribute in the element
      // so we can later find it quickly without building the reduced string again.
      let fontCache = "";
      if (foundFont.hasAttribute("value_cache"))
        fontCache = foundFont.getAttribute("value_cache");
      foundFont.setAttribute("value_cache", fontCache + "|" + editorFontToLower);

      // If we created a new item, set it up and insert.
      if (!foundFont.hasAttribute("used")) {
        foundFont.setAttribute("used", "true");
        usedFontsSep.hidden = false;
        menuPopup.insertBefore(foundFont, defaultFontsSep.nextSibling);
      }
    }
  }
  else
  {
    // The editor encountered a font that is not installed on this system.
    // Add it to the font menu now, in the used-fonts section right at the
    // bottom before the separator of the section.
    let fontLabel = GetFormattedString("NotInstalled", editorFont);
    foundFont = createFontFaceMenuitem(fontLabel, editorFont, menuPopup);
    foundFont.setAttribute("used", "true");
    usedFontsSep.hidden = false;
    menuPopup.insertBefore(foundFont, usedFontsSep);
  }
  fontFaceMenuList.selectedItem = foundFont;
}

/**
 * Clears the used fonts list from all the font face menulists.
 */
function ClearUsedFonts()
{
  let userFontSeps = document.querySelectorAll("menuseparator.fontFaceMenuAfterDefaultFonts");
  for (let userFontSep of userFontSeps) {
    let parentList = userFontSep.parentNode;
    while (true) {
      let nextNode = userFontSep.nextSibling;
      if (nextNode.tagName != "menuseparator") {
        nextNode.remove();
      } else {
        if (nextNode.classList.contains("fontFaceMenuAfterUsedFonts")) {
          nextNode.hidden = true;
          break;
        }
      }
    }
  }
}

function EditorSelectFontSize()
{
  var select = document.getElementById("FontSizeSelect");
  if (select)
  {
    if (select.selectedIndex == -1)
      return;

    EditorSetFontSize(gFontSizeNames[select.selectedIndex]);
  }
}

function onFontSizeChange(fontSizeMenulist, commandID)
{
  // If we don't match anything, set to "0 (normal)"
  var newIndex = 2;
  var size = fontSizeMenulist.getAttribute("size");
  if ( size == "mixed")
  {
    // No single type selected
    newIndex = -1;
  }
  else
  {
    for (var i = 0; i < gFontSizeNames.length; i++)
    {
      if( gFontSizeNames[i] == size )
      {
        newIndex = i;
        break;
      }
    }
  }
  if (fontSizeMenulist.selectedIndex != newIndex)
    fontSizeMenulist.selectedIndex = newIndex;
}

function EditorSetFontSize(size)
{
  if( size == "0" || size == "normal" ||
      size == "medium" )
  {
    EditorRemoveTextProperty("font", "size");
    // Also remove big and small,
    //  else it will seem like size isn't changing correctly
    EditorRemoveTextProperty("small", "");
    EditorRemoveTextProperty("big", "");
  } else {
    // Temp: convert from new CSS size strings to old HTML size strings
    switch (size)
    {
      case "xx-small":
      case "x-small":
        size = "-2";
        break;
      case "small":
        size = "-1";
        break;
      case "large":
        size = "+1";
        break;
      case "x-large":
        size = "+2";
        break;
      case "xx-large":
        size = "+3";
        break;
    }
    EditorSetTextProperty("font", "size", size);
  }
  gContentWindow.focus();
}

function initFontFaceMenu(menuPopup)
{
  initLocalFontFaceMenu(menuPopup);

  if (menuPopup)
  {
    var children = menuPopup.childNodes;
    if (!children) return;

    var mixed = { value: false };
    var editorFont = GetCurrentEditor().getFontFaceState(mixed);

    // Strip quotes in font names. Experiments have shown that we only
    // ever get double quotes around the font name, never single quotes,
    // even if they were in the HTML source. Also single or double
    // quotes within the font name are never returned.
    editorFont = editorFont.replace(/"/g, "");

    if (!mixed.value)
    {
      switch (editorFont)
      {
      case "":
      case "serif":
      case "sans-serif":
        // Generic variable width.
        editorFont = "";
        break;
      case "tt":
      case "monospace":
        // Generic fixed width.
        editorFont = "tt";
        break;
      default:
        editorFont = editorFont.toLowerCase().replace(/, /g, ","); // bug 1139524
      }
    }

    var editorFontOptions = editorFont.split(',');
    var matchedOption = editorFontOptions.length;  // initialise to high invalid value
    for (var i = 0; i < children.length; i++)
    {
      var menuItem = children[i];
      if (menuItem.localName == "menuitem")
      {
        var matchFound = false;
        if (!mixed.value)
        {
          var menuFont = menuItem.getAttribute("value").toLowerCase().replace(/, /g, ",");

          // First compare the entire font string to match items that contain commas.
          if (menuFont == editorFont)
          {
            menuItem.setAttribute("checked", "true");
            break;
          }

          // Next compare the individual options.
          else if (editorFontOptions.length > 1)
          {
            var matchPos = editorFontOptions.indexOf(menuFont);
            if (matchPos >= 0 && matchPos < matchedOption) {
              // This menu font comes earlier in the list of options,
              // so prefer it.
              menuItem.setAttribute("checked", "true");

              // If we matched the first option, we don't need to look for
              // a better match.
              if (matchPos == 0)
                break;

              matchedOption = matchPos;
              matchFound = true;
            }
          }
        }

        // In case this item doesn't match, make sure we've cleared the checkmark.
        if (!matchFound)
          menuItem.removeAttribute("checked");
      }
    }
  }
}

// Number of fixed font face menuitems, these are:
// Variable Width
// Fixed Width
// ==separator
// Helvetica, Arial
// Times
// Courier
// ==separator
// ==separator
const kFixedFontFaceMenuItems = 8;

function initLocalFontFaceMenu(menuPopup)
{
  if (!gLocalFonts)
  {
    // Build list of all local fonts once per editor
    try 
    {
      var enumerator = Components.classes["@mozilla.org/gfx/fontenumerator;1"]
                                 .getService(Components.interfaces.nsIFontEnumerator);
      var localFontCount = { value: 0 }
      gLocalFonts = enumerator.EnumerateAllFonts(localFontCount);
    }
    catch(e) { }
  }

  // Don't use radios for menulists.
  let useRadioMenuitems = (menuPopup.parentNode.localName == "menu");
  menuPopup.setAttribute("useRadios", useRadioMenuitems);
  if (menuPopup.childNodes.length == kFixedFontFaceMenuItems)
  {
    if (gLocalFonts.length == 0) {
      menuPopup.querySelector(".fontFaceMenuAfterDefaultFonts").hidden = true;
    }
    for (let i = 0; i < gLocalFonts.length; ++i)
    {
      // Remove Linux system generic fonts that collide with CSS generic fonts.
      if (gLocalFonts[i] != "" &&
          gLocalFonts[i] != "serif" &&
          gLocalFonts[i] != "sans-serif" &&
          gLocalFonts[i] != "monospace")
      {
        let itemNode = createFontFaceMenuitem(gLocalFonts[i], gLocalFonts[i], menuPopup);
        menuPopup.appendChild(itemNode);
      }
    }
  }
}

/**
 * Creates a menuitem element for the font faces menulist. Returns the menuitem
 * but does not add it automatically to the menupopup.
 *
 * @param aFontLabel  Label to be displayed for the item.
 * @param aFontName   The font face value to be used for the item.
 *                    Will be used in <font face="value"> in the edited document.
 * @param aMenuPopup  The menupopup for which this menuitem is created.
 */
function createFontFaceMenuitem(aFontLabel, aFontName, aMenuPopup)
{
  let itemNode = document.createElementNS(XUL_NS, "menuitem");
  itemNode.setAttribute("label", aFontLabel);
  itemNode.setAttribute("value", aFontName);
  itemNode.setAttribute("value_parsed", aFontName.toLowerCase().replace(/, /g, ","));
  itemNode.setAttribute("tooltiptext", aFontLabel);
  if (aMenuPopup.getAttribute("useRadios") == "true") {
    itemNode.setAttribute("type", "radio");
    itemNode.setAttribute("observes", "cmd_renderedHTMLEnabler");
  }
  return itemNode;
}

/**
 * Helper function
 */
function getFontSizeIndex()
{
  var firstHas = { value: false };
  var anyHas = { value: false };
  var allHas = { value: false };

  var fontSize = EditorGetTextProperty("font", "size", null, firstHas, anyHas, allHas);

  // If the element has no size attribute and no size was found at all,
  // we assume "medium" size. This is highly problematic since
  // CSS sizes are not recognised and will show as "medium" as well.
  // Currently we can't distinguish between "no attribute" which
  // can imply "medium" and "CSS attribute present" which should not
  // imply "medium".
  if (!anyHas.value)
    return 2;

  // Mixed selection.
  if (!allHas.value)
    return -1;

  switch (fontSize)
  {
    case "-3":
    case "-2":
    case "0":
    case "1":
      // x-small.
      return 0;
    case "-1":
    case "2":
      // small.
      return 1;
    case "3":
      // medium.
      return 2;
    case "+1":
    case "4":
      // large.
      return 3;
    case "+2":
    case "5":
      // x-large.
      return 4;
    case "+3":
    case "+4":
    case "6":
    case "7":
      // xx-large.
      return 5;
  }

  // We shouldn't get here. All the selection has a value we don't understand.
  return -1;
}

function initFontSizeMenu(menuPopup, fullMenu)
{
  if (menuPopup)
  {
    var children = menuPopup.childNodes;
    if (!children)
      return;

    // Fixed size items start after menu separator depending on whether it is
    // a full menu.
    var menuIndex = fullMenu ? 3 : 0;

    var setIndex = getFontSizeIndex();
    if (setIndex >= 0)
    {
      children[menuIndex + setIndex].setAttribute("checked", true);
    }
    else
    {
      // In case of mixed, clear all items.
      for (var i = menuIndex; i < children.length; i++) {
        children[i].setAttribute("checked", false);
      }
    }

    // Some configurations might not have the "small/big" indicator as
    // last item. If there is no indicator, we are done.
    if (!menuPopup.lastChild.id.includes("smallBigInfo"))
      return;

    // While it would be better to show the number of levels,
    // at least this tells user if either of them are set.
    var firstHas = { value: false };
    var anyHas = { value: false };
    var allHas = { value: false };

    // Show "small"/"big" indicator.
    var htmlInfo = "";
    EditorGetTextProperty("small", "", "", firstHas, anyHas, allHas);
    if (anyHas.value)
      htmlInfo = "<small>";
    EditorGetTextProperty("big", "", "", firstHas, anyHas, allHas);
    if (anyHas.value)
      htmlInfo += "<big>";

    if (htmlInfo)
    {
      menuPopup.lastChild.hidden = false;
      menuPopup.lastChild.setAttribute("label", "HTML: " + htmlInfo);
      menuPopup.lastChild.setAttribute("checked", true);
    }
    else
    {
      menuPopup.lastChild.hidden = true;
    }
  }
}

function onHighlightColorChange()
{
  ChangeButtonColor("cmd_highlight", "HighlightColorButton",
                    "transparent");
}

function onFontColorChange()
{
  ChangeButtonColor("cmd_fontColor", "TextColorButton",
                    gDefaultTextColor);
}

function onBackgroundColorChange()
{
  ChangeButtonColor("cmd_backgroundColor", "BackgroundColorButton",
                    gDefaultBackgroundColor);
}

/* Helper function that changes the button color.
 *   commandID - The ID of the command element.
 *   id - The ID of the button needing to be changed.
 *   defaultColor - The default color the button gets set to.
 */
function ChangeButtonColor(commandID, id, defaultColor) {
  var commandNode = document.getElementById(commandID);
  if (commandNode)
  {
    var color = commandNode.getAttribute("state");
    var button = document.getElementById(id);
    if (button)
    {
      button.setAttribute("color", color);

      // No color or a mixed color - get color set on page or other defaults.
      if (!color || color == "mixed")
        color = defaultColor;

      button.setAttribute("style", "background-color:" + color + " !important");
    }
  }
}

// Call this when user changes text and/or background colors of the page
function UpdateDefaultColors()
{
  var BrowserColors = GetDefaultBrowserColors();
  var bodyelement = GetBodyElement();
  var defTextColor = gDefaultTextColor;
  var defBackColor = gDefaultBackgroundColor;

  if (bodyelement)
  {
    var color = bodyelement.getAttribute("text");
    if (color)
      gDefaultTextColor = color;
    else if (BrowserColors)
      gDefaultTextColor = BrowserColors.TextColor;

    color = bodyelement.getAttribute("bgcolor");
    if (color)
      gDefaultBackgroundColor = color;
    else if (BrowserColors)
      gDefaultBackgroundColor = BrowserColors.BackgroundColor;
  }

  // Trigger update on toolbar
  if (defTextColor != gDefaultTextColor)
  {
    goUpdateCommandState("cmd_fontColor");
    onFontColorChange();
  }
  if (defBackColor != gDefaultBackgroundColor)
  {
    goUpdateCommandState("cmd_backgroundColor");
    onBackgroundColorChange();
  }
}

function GetBackgroundElementWithColor()
{
  var editor = GetCurrentTableEditor();
  if (!editor)
    return null;

  gColorObj.Type = "";
  gColorObj.PageColor = "";
  gColorObj.TableColor = "";
  gColorObj.CellColor = "";
  gColorObj.BackgroundColor = "";
  gColorObj.SelectedType = "";

  var tagNameObj = { value: "" };
  var element;
  try {
    element = editor.getSelectedOrParentTableElement(tagNameObj, {value:0});
  }
  catch(e) {}

  if (element && tagNameObj && tagNameObj.value)
  {
    gColorObj.BackgroundColor = GetHTMLOrCSSStyleValue(element, "bgcolor", "background-color");
    gColorObj.BackgroundColor = ConvertRGBColorIntoHEXColor(gColorObj.BackgroundColor);
    if (tagNameObj.value.toLowerCase() == "td")
    {
      gColorObj.Type = "Cell";
      gColorObj.CellColor = gColorObj.BackgroundColor;

      // Get any color that might be on parent table
      var table = GetParentTable(element);
      gColorObj.TableColor = GetHTMLOrCSSStyleValue(table, "bgcolor", "background-color");
      gColorObj.TableColor = ConvertRGBColorIntoHEXColor(gColorObj.TableColor);
    }
    else
    {
      gColorObj.Type = "Table";
      gColorObj.TableColor = gColorObj.BackgroundColor;
    }
    gColorObj.SelectedType = gColorObj.Type;
  }
  else
  {
    let IsCSSPrefChecked = Services.prefs.getBoolPref(kUseCssPref);
    if (IsCSSPrefChecked && IsHTMLEditor())
    {
      let selection = editor.selection;
      if (selection)
      {
        element = selection.focusNode;
        while (!editor.nodeIsBlock(element))
          element = element.parentNode;
      }
      else
      {
        element = GetBodyElement();
      }
    }
    else
    {
      element = GetBodyElement();
    }
    if (element)
    {
      gColorObj.Type = "Page";
      gColorObj.BackgroundColor = GetHTMLOrCSSStyleValue(element, "bgcolor", "background-color");
      if (gColorObj.BackgroundColor == "")
      {
        gColorObj.BackgroundColor = "transparent";
      }
      else
      {
        gColorObj.BackgroundColor = ConvertRGBColorIntoHEXColor(gColorObj.BackgroundColor);
      }
      gColorObj.PageColor = gColorObj.BackgroundColor;
    }
  }
  return element;
}

function SetSmiley(smileyText)
{
  try {
    GetCurrentEditor().insertText(smileyText);
    gContentWindow.focus();
  }
  catch(e) {}
}

function EditorSelectColor(colorType, mouseEvent)
{
  var editor = GetCurrentEditor();
  if (!editor || !gColorObj)
    return;

  // Shift + mouse click automatically applies last color, if available
  var useLastColor = mouseEvent ? ( mouseEvent.button == 0 && mouseEvent.shiftKey ) : false;
  var element;
  var table;
  var currentColor = "";
  var commandNode;

  if (!colorType)
    colorType = "";

  if (colorType == "Text")
  {
    gColorObj.Type = colorType;

    // Get color from command node state
    commandNode = document.getElementById("cmd_fontColor");
    currentColor = commandNode.getAttribute("state");
    currentColor = ConvertRGBColorIntoHEXColor(currentColor);
    gColorObj.TextColor = currentColor;

    if (useLastColor && gColorObj.LastTextColor )
      gColorObj.TextColor = gColorObj.LastTextColor;
    else
      useLastColor = false;
  }
  else if (colorType == "Highlight")
  {
    gColorObj.Type = colorType;

    // Get color from command node state
    commandNode = document.getElementById("cmd_highlight");
    currentColor = commandNode.getAttribute("state");
    currentColor = ConvertRGBColorIntoHEXColor(currentColor);
    gColorObj.HighlightColor = currentColor;

    if (useLastColor && gColorObj.LastHighlightColor )
      gColorObj.HighlightColor = gColorObj.LastHighlightColor;
    else
      useLastColor = false;
  }
  else
  {
    element = GetBackgroundElementWithColor();
    if (!element)
      return;

    // Get the table if we found a cell
    if (gColorObj.Type == "Table")
      table = element;
    else if (gColorObj.Type == "Cell")
      table = GetParentTable(element);

    // Save to avoid resetting if not necessary
    currentColor = gColorObj.BackgroundColor;

    if (colorType == "TableOrCell" || colorType == "Cell")
    {
      if (gColorObj.Type == "Cell")
        gColorObj.Type = colorType;
      else if (gColorObj.Type != "Table")
        return;
    }
    else if (colorType == "Table" && gColorObj.Type == "Page")
      return;

    if (colorType == "" && gColorObj.Type == "Cell")
    {
      // Using empty string for requested type means
      //  we can let user select cell or table
      gColorObj.Type = "TableOrCell";
    }

    if (useLastColor && gColorObj.LastBackgroundColor )
      gColorObj.BackgroundColor = gColorObj.LastBackgroundColor;
    else
      useLastColor = false;
  }
  // Save the type we are really requesting
  colorType = gColorObj.Type;

  if (!useLastColor)
  {
    // Avoid the JS warning
    gColorObj.NoDefault = false;

    // Launch the ColorPicker dialog
    // TODO: Figure out how to position this under the color buttons on the toolbar
    window.openDialog("chrome://editor/content/EdColorPicker.xul", "_blank", "chrome,close,titlebar,modal", "", gColorObj);

    // User canceled the dialog
    if (gColorObj.Cancel)
      return;
  }

  if (gColorObj.Type == "Text")
  {
    if (currentColor != gColorObj.TextColor)
    {
      if (gColorObj.TextColor)
        EditorSetTextProperty("font", "color", gColorObj.TextColor);
      else
        EditorRemoveTextProperty("font", "color");
    }
    // Update the command state (this will trigger color button update)
    goUpdateCommandState("cmd_fontColor");
  }
  else if (gColorObj.Type == "Highlight")
  {
    if (currentColor != gColorObj.HighlightColor)
    {
      if (gColorObj.HighlightColor)
        EditorSetTextProperty("font", "bgcolor", gColorObj.HighlightColor);
      else
        EditorRemoveTextProperty("font", "bgcolor");
    }
    // Update the command state (this will trigger color button update)
    goUpdateCommandState("cmd_highlight");
  }
  else if (element)
  {
    if (gColorObj.Type == "Table")
    {
      // Set background on a table
      // Note that we shouldn't trust "currentColor" because of "TableOrCell" behavior
      if (table)
      {
        var bgcolor = table.getAttribute("bgcolor");
        if (bgcolor != gColorObj.BackgroundColor)
        try {
          if (gColorObj.BackgroundColor)
            editor.setAttributeOrEquivalent(table, "bgcolor", gColorObj.BackgroundColor, false);
          else
            editor.removeAttributeOrEquivalent(table, "bgcolor", false);
        } catch (e) {}
      }
    }
    else if (currentColor != gColorObj.BackgroundColor && IsHTMLEditor())
    {
      editor.beginTransaction();
      try
      {
        editor.setBackgroundColor(gColorObj.BackgroundColor);

        if (gColorObj.Type == "Page" && gColorObj.BackgroundColor)
        {
          // Set all page colors not explicitly set,
          //  else you can end up with unreadable pages
          //  because viewer's default colors may not be same as page author's
          var bodyelement = GetBodyElement();
          if (bodyelement)
          {
            var defColors = GetDefaultBrowserColors();
            if (defColors)
            {
              if (!bodyelement.getAttribute("text"))
                editor.setAttributeOrEquivalent(bodyelement, "text", defColors.TextColor, false);

              // The following attributes have no individual CSS declaration counterparts
              // Getting rid of them in favor of CSS implies CSS rules management
              if (!bodyelement.getAttribute("link"))
                editor.setAttribute(bodyelement, "link", defColors.LinkColor);

              if (!bodyelement.getAttribute("alink"))
                editor.setAttribute(bodyelement, "alink", defColors.ActiveLinkColor);

              if (!bodyelement.getAttribute("vlink"))
                editor.setAttribute(bodyelement, "vlink", defColors.VisitedLinkColor);
            }
          }
        }
      }
      catch(e) {}

      editor.endTransaction();
    }

    goUpdateCommandState("cmd_backgroundColor");
  }
  gContentWindow.focus();
}

function GetParentTable(element)
{
  var node = element;
  while (node)
  {
    if (node.nodeName.toLowerCase() == "table")
      return node;

    node = node.parentNode;
  }
  return node;
}

function GetParentTableCell(element)
{
  var node = element;
  while (node)
  {
    if (node.nodeName.toLowerCase() == "td" || node.nodeName.toLowerCase() == "th")
      return node;

    node = node.parentNode;
  }
  return node;
}

function EditorDblClick(event)
{
  // We check event.explicitOriginalTarget here because .target will never
  // be a textnode (bug 193689)
  if (event.explicitOriginalTarget)
  {
    // Only bring up properties if clicked on an element or selected link
    var element;
    try {
      element = event.explicitOriginalTarget.QueryInterface(
                    Components.interfaces.nsIDOMElement);
    } catch (e) {}

     //  We use "href" instead of "a" to not be fooled by named anchor
    if (!element)
      try {
        element = GetCurrentEditor().getSelectedElement("href");
      } catch (e) {}

    // Don't fire for body/p and other block elements.
    // It's common that people try to double-click
    // to select a word, but the click hits an empty area.
    if (element &&
        !["body","p","h1","h2","h3","h4","h5","h6","blockquote","div","pre"]
         .includes(element.nodeName.toLowerCase()))
    {
      goDoCommand("cmd_objectProperties");  
      event.preventDefault();
    }
  }
}

function EditorClick(event)
{
  // For Web Composer: In Show All Tags Mode,
  // single click selects entire element,
  //  except for body and table elements
  if (gEditorDisplayMode == kDisplayModeAllTags)
  {
    try
    {
      // We check event.explicitOriginalTarget here because .target will never
      // be a textnode (bug 193689)
      var element = event.explicitOriginalTarget.QueryInterface(
                        Components.interfaces.nsIDOMElement);
      var name = element.localName;
      if (!["body", "caption", "table", "td", "th", "tr"].includes(name))
      {          
        GetCurrentEditor().selectElement(event.explicitOriginalTarget);
        event.preventDefault();
      }
    } catch (e) {}
  }
}

/*TODO: We need an oncreate hook to do enabling/disabling for the
        Format menu. There should be code like this for the
        object-specific "Properties" item
*/
// For property dialogs, we want the selected element,
//  but will accept a parent link, list, or table cell if inside one
function GetObjectForProperties()
{
  var editor = GetCurrentEditor();
  if (!editor || !IsHTMLEditor())
    return null;

  var element;
  try {
    element = editor.getSelectedElement("");
  } catch (e) {}
  if (element) {
    if (element.namespaceURI == "http://www.w3.org/1998/Math/MathML") {
      // If the object is a MathML element, we collapse the selection on it and
      // we return its <math> ancestor. Hence the math dialog will be used.
      GetCurrentEditor().selection.collapse(element, 0);
    } else
      return element;
  }

  // Find nearest parent of selection anchor node
  //   that is a link, list, table cell, or table

  var anchorNode
  var node;
  try {
    anchorNode = editor.selection.anchorNode;
    if (anchorNode.firstChild)
    {
      // Start at actual selected node
      var offset = editor.selection.anchorOffset;
      // Note: If collapsed, offset points to element AFTER caret,
      //  thus node may be null
      node = anchorNode.childNodes.item(offset);
    }
    if (!node)
      node = anchorNode;
  } catch (e) {}

  while (node)
  {
    if (node.nodeName)
    {
      var nodeName = node.nodeName.toLowerCase();

      // Done when we hit the body
      if (nodeName == "body") break;

      if ((nodeName == "a" && node.href) ||
          nodeName == "ol" || nodeName == "ul" || nodeName == "dl" ||
          nodeName == "td" || nodeName == "th" ||
          nodeName == "table" || nodeName == "math")
      {
        return node;
      }
    }
    node = node.parentNode;
  }
  return null;
}

function SetEditMode(mode)
{
  if (!IsHTMLEditor())
    return;

  var bodyElement = GetBodyElement();
  if (!bodyElement)
  {
    dump("SetEditMode: We don't have a body node!\n");
    return;
  }

  // must have editor if here!
  var editor = GetCurrentEditor();
  var inlineSpellCheckItem = document.getElementById('menu_inlineSpellCheck');

  // Switch the UI mode before inserting contents
  //   so user can't type in source window while new window is being filled
  var previousMode = gEditorDisplayMode;
  if (!SetDisplayMode(mode))
    return;

  if (mode == kDisplayModeSource)
  {
    // Display the DOCTYPE as a non-editable string above edit area
    var domdoc;
    try { domdoc = editor.document; } catch (e) { dump( e + "\n");}
    if (domdoc)
    {
      var doctypeNode = document.getElementById("doctype-text");
      var dt = domdoc.doctype;
      if (doctypeNode)
      {
        if (dt)
        {
          doctypeNode.collapsed = false;
          var doctypeText = "<!DOCTYPE " + domdoc.doctype.name;
          if (dt.publicId)
            doctypeText += " PUBLIC \"" + domdoc.doctype.publicId;
          if (dt.systemId)
            doctypeText += " \"" + dt.systemId;
          doctypeText += "\">"
          doctypeNode.setAttribute("value", doctypeText);
        }
        else
          doctypeNode.collapsed = true;
      }
    }
    // Get the entire document's source string

    var flags = (editor.documentCharacterSet == "ISO-8859-1")
      ? kOutputEncodeLatin1Entities
      : kOutputEncodeBasicEntities;
    try { 
      let encodeEntity = Services.prefs.getCharPref("editor.encode_entity");
      switch (encodeEntity) {
        case "basic"  : flags = kOutputEncodeBasicEntities; break;
        case "latin1" : flags = kOutputEncodeLatin1Entities; break;
        case "html"   : flags = kOutputEncodeHTMLEntities; break;
        case "none"   : flags = 0;     break;
      }
    } catch (e) { }

    if (Services.prefs.getBoolPref("editor.prettyprint"))
      flags |= kOutputFormatted;

    flags |= kOutputLFLineBreak;
    var source = editor.outputToString(editor.contentsMIMEType, flags);
    var start = source.search(/<html/i);
    if (start == -1) start = 0;
    gSourceTextEditor.insertText(source.slice(start));
    gSourceTextEditor.resetModificationCount();
    gSourceTextEditor.addDocumentStateListener(gSourceTextListener);
    gSourceTextEditor.enableUndo(true);
    gSourceContentWindow.commandManager.addCommandObserver(gSourceTextObserver, "cmd_undo");
    gSourceContentWindow.contentWindow.focus();
    goDoCommand("cmd_moveTop");
  }
  else if (previousMode == kDisplayModeSource)
  {
    // Only rebuild document if a change was made in source window
    if (IsHTMLSourceChanged())
    {
      // Disable spell checking when rebuilding source
      InlineSpellCheckerUI.enabled = false;
      inlineSpellCheckItem.removeAttribute('checked');

      // Reduce the undo count so we don't use too much memory
      //   during multiple uses of source window 
      //   (reinserting entire doc caches all nodes)
      try {
        editor.transactionManager.maxTransactionCount = 1;
      } catch (e) {}

      editor.beginTransaction();
      try {
        // We are coming from edit source mode,
        //   so transfer that back into the document
        source = gSourceTextEditor.outputToString(kTextMimeType, kOutputLFLineBreak).trim();
        if (editor.contentsMIMEType != kXHTMLMimeType)
          editor.rebuildDocumentFromSource(source);
        else {
          var fragment = editor.document.createRange().createContextualFragment(source);
          editor.enableUndo(false);
          GetBodyElement().remove();
          editor.document.replaceChild(fragment.firstChild, editor.document.documentElement);
          editor.enableUndo(true);
        }

        // Get the text for the <title> from the newly-parsed document
        // (must do this for proper conversion of "escaped" characters)
        let titleNode = editor.document.querySelector("title");
        SetDocumentTitle(titleNode ? titleNode.textContent : "");

      } catch (ex) {
        dump(ex);
      }
      editor.endTransaction();

      // Restore unlimited undo count
      try {
        editor.transactionManager.maxTransactionCount = -1;
      } catch (e) {}
    }

    // Clear out the string buffers
    gSourceContentWindow.commandManager.removeCommandObserver(gSourceTextObserver, "cmd_undo");
    gSourceTextEditor.removeDocumentStateListener(gSourceTextListener);
    gSourceTextEditor.enableUndo(false);
    gSourceTextEditor.selectAll();
    gSourceTextEditor.deleteSelection(gSourceTextEditor.eNone,
                                      gSourceTextEditor.eStrip);
    gSourceTextEditor.resetModificationCount();

    gContentWindow.focus();
    //goDoCommand("cmd_moveTop");
  }

  switch (mode) {
    case kDisplayModePreview:
      // Disable spell checking when previewing
      InlineSpellCheckerUI.enabled = false;
      inlineSpellCheckItem.removeAttribute('checked');
      // fall through
    case kDisplayModeSource:
      inlineSpellCheckItem.setAttribute('disabled', 'true');
      break;
    default:
      inlineSpellCheckItem.setAttribute('disabled', !InlineSpellCheckerUI.canSpellCheck);
      break;
  }
}

function CancelHTMLSource()
{
  // Don't convert source text back into the DOM document
  gSourceTextEditor.resetModificationCount();
  SetDisplayMode(gPreviousNonSourceDisplayMode);
}

function SetDisplayMode(mode)
{
  if (!IsHTMLEditor())
    return false;

  // Already in requested mode:
  //  return false to indicate we didn't switch
  if (mode == gEditorDisplayMode)
    return false;

  var previousMode = gEditorDisplayMode;
  gEditorDisplayMode = mode;

  ResetStructToolbar();
  if (mode == kDisplayModeSource)
  {
    // Switch to the sourceWindow (second in the deck)
    gContentWindowDeck.selectedIndex = 1;

    //Hide the formatting toolbar if not already hidden
    gFormatToolbarHidden = gFormatToolbar.hidden;
    gFormatToolbar.hidden = true;
    gViewFormatToolbar.hidden = true;

    gSourceContentWindow.contentWindow.focus();
  }
  else
  {
    // Save the last non-source mode so we can cancel source editing easily
    gPreviousNonSourceDisplayMode = mode;

    // Load/unload appropriate override style sheet
    try {
      var editor = GetCurrentEditor();
      editor.QueryInterface(nsIEditorStyleSheets);
      editor instanceof Components.interfaces.nsIHTMLObjectResizer;

      switch (mode)
      {
        case kDisplayModePreview:
          // Disable all extra "edit mode" style sheets 
          editor.enableStyleSheet(kNormalStyleSheet, false);
          editor.enableStyleSheet(kAllTagsStyleSheet, false);
          editor.objectResizingEnabled = true;
          break;

        case kDisplayModeNormal:
          editor.addOverrideStyleSheet(kNormalStyleSheet);
          // Disable ShowAllTags mode
          editor.enableStyleSheet(kAllTagsStyleSheet, false);
          editor.objectResizingEnabled = true;
          break;

        case kDisplayModeAllTags:
          editor.addOverrideStyleSheet(kNormalStyleSheet);
          editor.addOverrideStyleSheet(kAllTagsStyleSheet);
          // don't allow resizing in AllTags mode because the visible tags
          // change the computed size of images and tables...
          if (editor.resizedObject) {
            editor.hideResizers();
          }
          editor.objectResizingEnabled = false;
          break;
      }
    } catch(e) {}

    // Switch to the normal editor (first in the deck)
    gContentWindowDeck.selectedIndex = 0;

    // Restore menus and toolbars
    gFormatToolbar.hidden = gFormatToolbarHidden;
    gViewFormatToolbar.hidden = false;

    gContentWindow.focus();
  }

  // update commands to disable or re-enable stuff
  window.updateCommands("mode_switch");

  // Set the selected tab at bottom of window:
  // (Note: Setting "selectedIndex = mode" won't redraw tabs when menu is used.)
  document.getElementById("EditModeTabs").selectedItem = document.getElementById(kDisplayModeTabIDS[mode]);

  // Uncheck previous menuitem and set new check since toolbar may have been used
  if (previousMode >= 0)
    document.getElementById(kDisplayModeMenuIDs[previousMode]).setAttribute("checked","false");
  document.getElementById(kDisplayModeMenuIDs[mode]).setAttribute("checked","true");
  

  return true;
}

function UpdateWindowTitle()
{
  try {
    var filename = "";
    var windowTitle = "";
    var title = GetDocumentTitle();

    // Append just the 'leaf' filename to the Doc. Title for the window caption
    var docUrl = GetDocumentUrl();
    if (docUrl && !IsUrlAboutBlank(docUrl))
    {
      var scheme = GetScheme(docUrl);
      filename = GetFilename(docUrl);
      if (filename)
        windowTitle = " [" + scheme + ":/.../" + filename + "]";

      var fileType = IsHTMLEditor() ? "html" : "text";
      // Save changed title in the recent pages data in prefs
      SaveRecentFilesPrefs(title, fileType);
    }

    // Set window title with " - Composer" or " - Text Editor" appended.
    var xulWin = document.documentElement;

    document.title = (title || filename || gUntitledString) +
                     windowTitle +
                     xulWin.getAttribute("titlemenuseparator") + 
                     xulWin.getAttribute("titlemodifier");
  } catch (e) { dump(e); }
}

function SaveRecentFilesPrefs(aTitle, aFileType)
{
  var curUrl = StripPassword(GetDocumentUrl());
  var historyCount = Services.prefs.getIntPref("editor.history.url_maximum");

  var titleArray = [];
  var urlArray = [];
  var typeArray = [];

  if (historyCount && !IsUrlAboutBlank(curUrl) &&  GetScheme(curUrl) != "data")
  {
    titleArray.push(aTitle);
    urlArray.push(curUrl);
    typeArray.push(aFileType);
  }

  for (let i = 0; i < historyCount && urlArray.length < historyCount; i++)
  {
    let url = GetStringPref("editor.history_url_" + i);

    // Continue if URL pref is missing because 
    //  a URL not found during loading may have been removed

    // Skip over current an "data" URLs
    if (url && url != curUrl && GetScheme(url) != "data")
    {
      let title = GetStringPref("editor.history_title_" + i);
      let fileType = GetStringPref("editor.history_type_" + i);
      titleArray.push(title);
      urlArray.push(url);
      typeArray.push(fileType);
    }
  }

  // Resave the list back to prefs in the new order
  for (let i = 0; i < urlArray.length; i++)
  {
    SetStringPref("editor.history_title_" + i, titleArray[i]);
    SetStringPref("editor.history_url_" + i, urlArray[i]);
    SetStringPref("editor.history_type_" + i, typeArray[i]);
  }
}

function EditorInitFormatMenu()
{
  try {
    InitObjectPropertiesMenuitem();
    InitRemoveStylesMenuitems("removeStylesMenuitem", "removeLinksMenuitem", "removeNamedAnchorsMenuitem");
  } catch(ex) {}
}

function InitObjectPropertiesMenuitem()
{
  // Set strings and enable for the [Object] Properties item
  // Note that we directly do the enabling instead of
  // using goSetCommandEnabled since we already have the command.
  var cmd = document.getElementById("cmd_objectProperties");
  if (!cmd)
    return null;

  var element;
  var menuStr = GetString("AdvancedProperties");
  var name;

  if (IsEditingRenderedHTML())
    element = GetObjectForProperties();

  if (element && element.nodeName)
  {
    var objStr = "";
    cmd.removeAttribute("disabled");
    name = element.nodeName.toLowerCase();
    switch (name)
    {
      case "img":
        // Check if img is enclosed in link
        //  (use "href" to not be fooled by named anchor)
        try
        {
          if (GetCurrentEditor().getElementOrParentByTagName("href", element))
          {
            objStr = GetString("ImageAndLink");
            // Return "href" so it is detected as a link.
            name = "href";
          }
        } catch(e) {}
        
        if (objStr == "")
          objStr = GetString("Image");
        break;
      case "hr":
        objStr = GetString("HLine");
        break;
      case "table":
        objStr = GetString("Table");
        break;
      case "th":
        name = "td";
      case "td":
        objStr = GetString("TableCell");
        break;
      case "ol":
      case "ul":
      case "dl":
        objStr = GetString("List");
        break;
      case "li":
        objStr = GetString("ListItem");
        break;
      case "form":
        objStr = GetString("Form");
        break;
      case "input":
        var type = element.getAttribute("type");
        if (type && type.toLowerCase() == "image")
          objStr = GetString("InputImage");
        else
          objStr = GetString("InputTag");
        break;
      case "textarea":
        objStr = GetString("TextArea");
        break;
      case "select":
        objStr = GetString("Select");
        break;
      case "button":
        objStr = GetString("Button");
        break;
      case "label":
        objStr = GetString("Label");
        break;
      case "fieldset":
        objStr = GetString("FieldSet");
        break;
      case "a":
        if (element.name)
        {
          objStr = GetString("NamedAnchor");
          name = "anchor";
        }
        else if(element.href)
        {
          objStr = GetString("Link");
          name = "href";
        }
        break;
    }
    if (objStr)
      menuStr = GetString("ObjectProperties").replace(/%obj%/,objStr);
  }
  else
  {
    // We show generic "Properties" string, but disable the command.
    cmd.setAttribute("disabled", "true");
  }
  cmd.setAttribute("label", menuStr);
  cmd.setAttribute("accesskey", GetString("ObjectPropertiesAccessKey"));
  return name;
}

function InitParagraphMenu()
{
  var mixedObj = { value: null };
  var state;
  try {
    state = GetCurrentEditor().getParagraphState(mixedObj);
  }
  catch(e) {}
  var IDSuffix;

  // PROBLEM: When we get blockquote, it masks other styles contained by it
  // We need a separate method to get blockquote state

  // We use "x" as uninitialized paragraph state
  if (!state || state == "x")
    IDSuffix = "bodyText" // No paragraph container
  else
    IDSuffix = state;

  // Set "radio" check on one item, but...
  var menuItem = document.getElementById("menu_"+IDSuffix);
  menuItem.setAttribute("checked", "true");

  // ..."bodyText" is returned if mixed selection, so remove checkmark
  if (mixedObj.value)
    menuItem.setAttribute("checked", "false");
}

function GetListStateString()
{
  try {
    var editor = GetCurrentEditor();

    var mixedObj = { value: null };
    var hasOL = { value: false };
    var hasUL = { value: false };
    var hasDL = { value: false };
    editor.getListState(mixedObj, hasOL, hasUL, hasDL);

    if (mixedObj.value)
      return "mixed";
    if (hasOL.value)
      return "ol";
    if (hasUL.value)
      return "ul";

    if (hasDL.value)
    {
      var hasLI = { value: false };
      var hasDT = { value: false };
      var hasDD = { value: false };
      editor.getListItemState(mixedObj, hasLI, hasDT, hasDD);
      if (mixedObj.value)
        return "mixed";
      if (hasLI.value)
        return "li";
      if (hasDT.value)
        return "dt";
      if (hasDD.value)
        return "dd";
    }
  } catch (e) {}

  // return "noList" if we aren't in a list at all
  return "noList";
}

function InitListMenu()
{
  if (!IsHTMLEditor())
    return;

  var IDSuffix = GetListStateString();

  // Set enable state for the "None" menuitem
  goSetCommandEnabled("cmd_removeList", IDSuffix != "noList");

  // Set "radio" check on one item, but...
  // we won't find a match if it's "mixed"
  var menuItem = document.getElementById("menu_"+IDSuffix);
  if (menuItem)
    menuItem.setAttribute("checked", "true");
}

function GetAlignmentString()
{
  var mixedObj = { value: null };
  var alignObj = { value: null };
  try {
    GetCurrentEditor().getAlignment(mixedObj, alignObj);
  } catch (e) {}

  if (mixedObj.value)
    return "mixed";
  if (alignObj.value == nsIHTMLEditor.eLeft)
    return "left";
  if (alignObj.value == nsIHTMLEditor.eCenter)
    return "center";
  if (alignObj.value == nsIHTMLEditor.eRight)
    return "right";
  if (alignObj.value == nsIHTMLEditor.eJustify)
    return "justify";

  // return "left" if we got here
  return "left";
}

function InitAlignMenu()
{
  if (!IsHTMLEditor())
    return;

  var IDSuffix = GetAlignmentString();

  // we won't find a match if it's "mixed"
  var menuItem = document.getElementById("menu_"+IDSuffix);
  if (menuItem)
    menuItem.setAttribute("checked", "true");
}

function EditorSetDefaultPrefsAndDoctype()
{
  var editor = GetCurrentEditor();

  var domdoc;
  try { 
    domdoc = editor.document;
  } catch (e) { dump( e + "\n"); }
  if ( !domdoc )
  {
    dump("EditorSetDefaultPrefsAndDoctype: EDITOR DOCUMENT NOT FOUND\n");
    return;
  }

  // Insert a doctype element 
  // if it is missing from existing doc
  if (!domdoc.doctype)
  {
    var newdoctype = domdoc.implementation.createDocumentType("HTML", "-//W3C//DTD HTML 4.01 Transitional//EN","");
    if (newdoctype)
      domdoc.insertBefore(newdoctype, domdoc.firstChild);
  }
  
  // search for head; we'll need this for meta tag additions
  let headelement = domdoc.querySelector("head");
  if (!headelement)
  {
    headelement = domdoc.createElement("head");
    if (headelement)
      domdoc.insertAfter(headelement, domdoc.firstChild);
  }

  /* only set default prefs for new documents */
  if (!IsUrlAboutBlank(GetDocumentUrl()))
    return;

  // search for author meta tag.
  // if one is found, don't do anything.
  // if not, create one and make it a child of the head tag
  //   and set its content attribute to the value of the editor.author preference.

  if (domdoc.querySelector("meta"))
  {
    // we should do charset first since we need to have charset before
    // hitting other 8-bit char in other meta tags
    // grab charset pref and make it the default charset
    var element;
    var prefCharsetString = Services.prefs.getCharPref("intl.charset.fallback.override");
    if (prefCharsetString)
      editor.documentCharacterSet = prefCharsetString;

    // let's start by assuming we have an author in case we don't have the pref

    var prefAuthorString = null;
    let authorFound = domdoc.querySelector('meta[name="author"]');
    try
    {
      prefAuthorString = Services.prefs.getComplexValue("editor.author",
                                                        Components.interfaces.nsISupportsString).data;
    }
    catch (ex) {}
    if (prefAuthorString && prefAuthorString != 0 && !authorFound && headelement)
    {
      // create meta tag with 2 attributes
      element = domdoc.createElement("meta");
      if (element)
      {
        element.setAttribute("name", "author");
        element.setAttribute("content", prefAuthorString);
        headelement.appendChild(element);
      }
    }
  }

  // add title tag if not present
  if (headelement && !editor.document.querySelector("title"))
  {
     var titleElement = domdoc.createElement("title");
     if (titleElement)
       headelement.appendChild(titleElement);
  }

  // find body node
  var bodyelement = GetBodyElement();
  if (bodyelement)
  {
    if (Services.prefs.getBoolPref("editor.use_custom_colors"))
    {
      let text_color = Services.prefs.getCharPref("editor.text_color");
      let background_color = Services.prefs.getCharPref("editor.background_color");

      // add the color attributes to the body tag.
      // and use them for the default text and background colors if not empty
      editor.setAttributeOrEquivalent(bodyelement, "text", text_color, true);
      gDefaultTextColor = text_color;
      editor.setAttributeOrEquivalent(bodyelement, "bgcolor", background_color, true);
      gDefaultBackgroundColor = background_color
      bodyelement.setAttribute("link", Services.prefs.getCharPref("editor.link_color"));
      bodyelement.setAttribute("alink", Services.prefs.getCharPref("editor.active_link_color"));
      bodyelement.setAttribute("vlink", Services.prefs.getCharPref("editor.followed_link_color"));
    }
    // Default image is independent of Custom colors???
    try {
      let background_image = Services.prefs.getCharPref("editor.default_background_image");
      if (background_image)
        editor.setAttributeOrEquivalent(bodyelement, "background", background_image, true);
    } catch (e) {dump("BACKGROUND EXCEPTION: "+e+"\n"); }

  }
  // auto-save???
}

function GetBodyElement()
{
  try {
    return GetCurrentEditor().rootElement;
  }
  catch (ex) {
    dump("no body tag found?!\n");
    //  better have one, how can we blow things up here?
  }
  return null;
}

// --------------------------- Logging stuff ---------------------------

function EditorGetNodeFromOffsets(offsets)
{
  var node = null;
  try {
    node = GetCurrentEditor().document;

    for (var i = 0; i < offsets.length; i++)
      node = node.childNodes[offsets[i]];
  } catch (e) {}
  return node;
}

function EditorSetSelectionFromOffsets(selRanges)
{
  try {
    var editor = GetCurrentEditor();
    var selection = editor.selection;
    selection.removeAllRanges();

    var rangeArr, start, end, node, offset;
    for (var i = 0; i < selRanges.length; i++)
    {
      rangeArr = selRanges[i];
      start    = rangeArr[0];
      end      = rangeArr[1];

      var range = editor.document.createRange();

      node   = EditorGetNodeFromOffsets(start[0]);
      offset = start[1];

      range.setStart(node, offset);

      node   = EditorGetNodeFromOffsets(end[0]);
      offset = end[1];

      range.setEnd(node, offset);

      selection.addRange(range);
    }
  } catch (e) {}
}

//--------------------------------------------------------------------
function initFontStyleMenu(menuPopup)
{
  for (var i = 0; i < menuPopup.childNodes.length; i++)
  {
    var menuItem = menuPopup.childNodes[i];
    var theStyle = menuItem.getAttribute("state");
    if (theStyle)
    {
      menuItem.setAttribute("checked", theStyle);
    }
  }
}

//--------------------------------------------------------------------
function onButtonUpdate(button, commmandID)
{
  var commandNode = document.getElementById(commmandID);
  var state = commandNode.getAttribute("state");
  button.checked = state == "true";
}

//--------------------------------------------------------------------
function onStateButtonUpdate(button, commmandID, onState)
{
  var commandNode = document.getElementById(commmandID);
  var state = commandNode.getAttribute("state");

  button.checked = state == onState;
}

// --------------------------- Status calls ---------------------------
function getColorAndSetColorWell(ColorPickerID, ColorWellID)
{
  var colorWell;
  if (ColorWellID)
    colorWell = document.getElementById(ColorWellID);

  var colorPicker = document.getElementById(ColorPickerID);
  if (colorPicker)
  {
    // Extract color from colorPicker and assign to colorWell.
    var color = colorPicker.getAttribute("color");

    if (colorWell && color)
    {
      // Use setAttribute so colorwell can be a XUL element, such as button
      colorWell.setAttribute("style", "background-color: " + color);
    }
  }
  return color;
}

//-----------------------------------------------------------------------------------
function IsSpellCheckerInstalled()
{
  return "@mozilla.org/spellchecker;1" in Components.classes;
}

//-----------------------------------------------------------------------------------
function IsFindInstalled()
{
  return "@mozilla.org/embedcomp/rangefind;1" in Components.classes
          && "@mozilla.org/find/find_service;1" in Components.classes;
}

//-----------------------------------------------------------------------------------
function RemoveInapplicableUIElements()
{
  // For items that are in their own menu block, remove associated separator
  // (we can't use "hidden" since class="hide-in-IM" CSS rule interferes)

   // if no find, remove find ui
  if (!IsFindInstalled())
  {
    HideItem("menu_find");
    HideItem("menu_findnext");
    HideItem("menu_replace");
    HideItem("menu_find");
    RemoveItem("sep_find");
  }

   // if no spell checker, remove spell checker ui
  if (!IsSpellCheckerInstalled())
  {
    HideItem("spellingButton");
    HideItem("menu_checkspelling");
    RemoveItem("sep_checkspelling");
  }

  // Remove menu items (from overlay shared with HTML editor) in non-HTML.
  if (!IsHTMLEditor())
  {
    HideItem("insertAnchor");
    HideItem("insertImage");
    HideItem("insertHline");
    HideItem("insertTable");
    HideItem("insertHTML");
    HideItem("insertFormMenu");
    HideItem("fileExportToText");
    HideItem("viewFormatToolbar");
    HideItem("viewEditModeToolbar");
  }
}

function HideItem(id)
{
  var item = document.getElementById(id);
  if (item)
    item.hidden = true;
}

function RemoveItem(id)
{
  var item = document.getElementById(id);
  if (item)
    item.remove();
}

// Command Updating Strategy:
//   Don't update on on selection change, only when menu is displayed,
//   with this "oncreate" hander:
function EditorInitTableMenu()
{
  try {
    InitJoinCellMenuitem("menu_JoinTableCells");
  } catch (ex) {}

  // Set enable states for all table commands
  goUpdateTableMenuItems(document.getElementById("composerTableMenuItems"));
}

function InitJoinCellMenuitem(id)
{
  // Change text on the "Join..." item depending if we
  //   are joining selected cells or just cell to right
  // TODO: What to do about normal selection that crosses
  //       table border? Try to figure out all cells
  //       included in the selection?
  var menuText;
  var menuItem = document.getElementById(id);
  if (!menuItem) return;

  // Use "Join selected cells if there's more than 1 cell selected
  var numSelected;
  var foundElement;
  
  try {
    var tagNameObj = {};
    var countObj = {value:0}
    foundElement = GetCurrentTableEditor().getSelectedOrParentTableElement(tagNameObj, countObj);
    numSelected = countObj.value
  }
  catch(e) {}
  if (foundElement && numSelected > 1)
    menuText = GetString("JoinSelectedCells");
  else
    menuText = GetString("JoinCellToRight");

  menuItem.setAttribute("label",menuText);
  menuItem.setAttribute("accesskey",GetString("JoinCellAccesskey"));
}

function InitRemoveStylesMenuitems(removeStylesId, removeLinksId, removeNamedAnchorsId)
{
  var editor = GetCurrentEditor();
  if (!editor)
    return;

  // Change wording of menuitems depending on selection
  var stylesItem = document.getElementById(removeStylesId);
  var linkItem = document.getElementById(removeLinksId);

  var isCollapsed = editor.selection.isCollapsed;
  if (stylesItem)
  {
    stylesItem.setAttribute("label", isCollapsed ? GetString("StopTextStyles") : GetString("RemoveTextStyles"));
    stylesItem.setAttribute("accesskey", GetString("RemoveTextStylesAccesskey"));
  }
  if (linkItem)
  {
    linkItem.setAttribute("label", isCollapsed ? GetString("StopLinks") : GetString("RemoveLinks"));
    linkItem.setAttribute("accesskey", GetString("RemoveLinksAccesskey"));
    // Note: disabling text style is a pain since there are so many - forget it!

    // Disable if not in a link, but always allow "Remove"
    //  if selection isn't collapsed since we only look at anchor node
    try {
      SetElementEnabled(linkItem, !isCollapsed ||
                      editor.getElementOrParentByTagName("href", null));
    } catch(e) {}      
  }
  // Disable if selection is collapsed
  SetElementEnabledById(removeNamedAnchorsId, !isCollapsed);
}

function goUpdateTableMenuItems(commandset)
{
  var editor = GetCurrentTableEditor();
  if (!editor)
  {
    dump("goUpdateTableMenuItems: too early, not initialized\n");
    return;
  }

  var enabled = false;
  var enabledIfTable = false;

  var flags = editor.flags;
  if (!(flags & nsIPlaintextEditor.eEditorReadonlyMask) &&
      IsEditingRenderedHTML())
  {
    var tagNameObj = { value: "" };
    var element;
    try {
      element = editor.getSelectedOrParentTableElement(tagNameObj, {value:0});
    }
    catch(e) {}

    if (element)
    {
      // Value when we need to have a selected table or inside a table
      enabledIfTable = true;

      // All others require being inside a cell or selected cell
      enabled = (tagNameObj.value == "td");
    }
  }

  // Loop through command nodes
  for (var i = 0; i < commandset.childNodes.length; i++)
  {
    var commandID = commandset.childNodes[i].getAttribute("id");
    if (commandID)
    {
      if (commandID == "cmd_InsertTable" ||
          commandID == "cmd_JoinTableCells" ||
          commandID == "cmd_SplitTableCell" ||
          commandID == "cmd_ConvertToTable")
      {
        // Call the update method in the command class
        goUpdateCommand(commandID);
      }
      // Directly set with the values calculated here
      else if (commandID == "cmd_DeleteTable" ||
               commandID == "cmd_NormalizeTable" ||
               commandID == "cmd_editTable" ||
               commandID == "cmd_TableOrCellColor" ||
               commandID == "cmd_SelectTable")
      {
        goSetCommandEnabled(commandID, enabledIfTable);
      } else {
        goSetCommandEnabled(commandID, enabled);
      }
    }
  }
}

//-----------------------------------------------------------------------------------
// Helpers for inserting and editing tables:

function IsInTable()
{
  var editor = GetCurrentEditor();
  try {
    var flags = editor.flags;
    return (IsHTMLEditor() &&
            !(flags & nsIPlaintextEditor.eEditorReadonlyMask) &&
            IsEditingRenderedHTML() &&
            null != editor.getElementOrParentByTagName("table", null));
  } catch (e) {}
  return false;
}

function IsInTableCell()
{
  try {
    var editor = GetCurrentEditor();
    var flags = editor.flags;
    return (IsHTMLEditor() &&
            !(flags & nsIPlaintextEditor.eEditorReadonlyMask) && 
            IsEditingRenderedHTML() &&
            null != editor.getElementOrParentByTagName("td", null));
  } catch (e) {}
  return false;

}

function IsSelectionInOneCell()
{
  try {
    var editor = GetCurrentEditor();
    var selection = editor.selection;

    if (selection.rangeCount == 1)
    {
      // We have a "normal" single-range selection
      if (!selection.isCollapsed &&
         selection.anchorNode != selection.focusNode)
      {
        // Check if both nodes are within the same cell
        var anchorCell = editor.getElementOrParentByTagName("td", selection.anchorNode);
        var focusCell = editor.getElementOrParentByTagName("td", selection.focusNode);
        return (focusCell != null && anchorCell != null && (focusCell == anchorCell));
      }
      // Collapsed selection or anchor == focus (thus must be in 1 cell)
      return true;
    }
  } catch (e) {}
  return false;
}

// Call this with insertAllowed = true to allow inserting if not in existing table,
//   else use false to do nothing if not in a table
function EditorInsertOrEditTable(insertAllowed)
{
  if (IsInTable())
  {
    // Edit properties of existing table
    window.openDialog("chrome://editor/content/EdTableProps.xul", "_blank", "chrome,close,titlebar,modal", "","TablePanel");
    gContentWindow.focus();
  } 
  else if (insertAllowed)
  {
    try {
      if (GetCurrentEditor().selection.isCollapsed)
        // If we have a caret, insert a blank table...
        EditorInsertTable();
      else
        // else convert the selection into a table
        goDoCommand("cmd_ConvertToTable");
    } catch (e) {}
  }
}

function EditorInsertTable()
{
  // Insert a new table
  window.openDialog("chrome://editor/content/EdInsertTable.xul", "_blank", "chrome,close,titlebar,modal", "");
  gContentWindow.focus();
}

function EditorTableCellProperties()
{
  if (!IsHTMLEditor())
    return;

  try {
    var cell = GetCurrentEditor().getElementOrParentByTagName("td", null);
    if (cell) {
      // Start Table Properties dialog on the "Cell" panel
      window.openDialog("chrome://editor/content/EdTableProps.xul", "_blank", "chrome,close,titlebar,modal", "", "CellPanel");
      gContentWindow.focus();
    }
  } catch (e) {}
}

function GetNumberOfContiguousSelectedRows()
{
  if (!IsHTMLEditor())
    return 0;

  var rows = 0;
  try {
    var editor = GetCurrentTableEditor();
    var rowObj = { value: 0 };
    var colObj = { value: 0 };
    var cell = editor.getFirstSelectedCellInTable(rowObj, colObj);
    if (!cell)
      return 0;

    // We have at least one row
    rows++;

    var lastIndex = rowObj.value;
    do {
      cell = editor.getNextSelectedCell({value:0});
      if (cell)
      {
        editor.getCellIndexes(cell, rowObj, colObj);
        var index = rowObj.value;
        if (index == lastIndex + 1)
        {
          lastIndex = index;
          rows++;
        }
      }
    }
    while (cell);
  } catch (e) {}

  return rows;
}

function GetNumberOfContiguousSelectedColumns()
{
  if (!IsHTMLEditor())
    return 0;

  var columns = 0;
  try {
    var editor = GetCurrentTableEditor();
    var colObj = { value: 0 };
    var rowObj = { value: 0 };
    var cell = editor.getFirstSelectedCellInTable(rowObj, colObj);
    if (!cell)
      return 0;

    // We have at least one column
    columns++;

    var lastIndex = colObj.value;
    do {
      cell = editor.getNextSelectedCell({value:0});
      if (cell)
      {
        editor.getCellIndexes(cell, rowObj, colObj);
        var index = colObj.value;
        if (index == lastIndex +1)
        {
          lastIndex = index;
          columns++;
        }
      }
    }
    while (cell);
  } catch (e) {}

  return columns;
}

function EditorOnFocus()
{
  // Current window already has the InsertCharWindow
  if ("InsertCharWindow" in window && window.InsertCharWindow) return;

  // Find window with an InsertCharsWindow and switch association to this one
  var windowWithDialog = FindEditorWithInsertCharDialog();
  if (windowWithDialog)
  {
    // Switch the dialog to current window
    // this sets focus to dialog, so bring focus back to editor window
    if (SwitchInsertCharToThisWindow(windowWithDialog))
      top.document.commandDispatcher.focusedWindow.focus();
  }
}

function SwitchInsertCharToThisWindow(windowWithDialog)
{
  if (windowWithDialog && "InsertCharWindow" in windowWithDialog &&
      windowWithDialog.InsertCharWindow)
  {
    // Move dialog association to the current window
    window.InsertCharWindow = windowWithDialog.InsertCharWindow;
    windowWithDialog.InsertCharWindow = null;

    // Switch the dialog's opener to current window's
    window.InsertCharWindow.opener = window;

    // Bring dialog to the forground
    window.InsertCharWindow.focus();
    return true;
  }
  return false;
}

function FindEditorWithInsertCharDialog()
{
  try {
    // Find window with an InsertCharsWindow and switch association to this one
    let enumerator = Services.wm.getEnumerator(null);

    while (enumerator.hasMoreElements())
    {
      var tempWindow = enumerator.getNext();

      if (tempWindow != window && "InsertCharWindow" in tempWindow &&
          tempWindow.InsertCharWindow)
      {
        return tempWindow;
      }
    }
  }
  catch(e) {}
  return null;
}

function EditorFindOrCreateInsertCharWindow()
{
  if ("InsertCharWindow" in window && window.InsertCharWindow)
    window.InsertCharWindow.focus();
  else
  {
    // Since we switch the dialog during EditorOnFocus(),
    //   this should really never be found, but it's good to be sure
    var windowWithDialog = FindEditorWithInsertCharDialog();
    if (windowWithDialog)
    {
      SwitchInsertCharToThisWindow(windowWithDialog);
    }
    else
    {
      // The dialog will set window.InsertCharWindow to itself
      window.openDialog("chrome://editor/content/EdInsertChars.xul", "_blank", "chrome,close,titlebar", "");
    }
  }
}

// Find another HTML editor window to associate with the InsertChar dialog
//   or close it if none found  (May be a mail composer)
function SwitchInsertCharToAnotherEditorOrClose()
{
  if ("InsertCharWindow" in window && window.InsertCharWindow)
  {
    var enumerator;
    try {
      enumerator = Services.wm.getEnumerator(null);
    }
    catch(e) {}
    if (!enumerator) return;

    // TODO: Fix this to search for command controllers and look for "cmd_InsertChars"
    // For now, detect just Web Composer and HTML Mail Composer
    while ( enumerator.hasMoreElements()  )
    {
      var  tempWindow = enumerator.getNext();
      if (tempWindow != window && tempWindow != window.InsertCharWindow &&
          "GetCurrentEditor" in tempWindow && tempWindow.GetCurrentEditor())
      {
        tempWindow.InsertCharWindow = window.InsertCharWindow;
        window.InsertCharWindow = null;
        tempWindow.InsertCharWindow.opener = tempWindow;
        return;
      }
    }
    // Didn't find another editor - close the dialog
    window.InsertCharWindow.close();
  }
}

function ResetStructToolbar()
{
  gLastFocusNode = null;
  UpdateStructToolbar();
}

function newCommandListener(element)
{
  return function() { return SelectFocusNodeAncestor(element); };
}

function newContextmenuListener(button, element)
{
  return function() { return InitStructBarContextMenu(button, element); };
}

function UpdateStructToolbar()
{
  var editor = GetCurrentEditor();
  if (!editor) return;

  var mixed = GetSelectionContainer();
  if (!mixed) return;
  var element = mixed.node;
  var oneElementSelected = mixed.oneElementSelected;

  if (!element) return;

  if (element == gLastFocusNode &&
      oneElementSelected == gLastFocusNodeWasSelected)
    return;

  gLastFocusNode = element;
  gLastFocusNodeWasSelected = mixed.oneElementSelected;

  var toolbar = document.getElementById("structToolbar");
  if (!toolbar) return;
  // We need to leave the <label> to flex the buttons to the left.
  for (let node of toolbar.querySelectorAll("toolbarbutton")) {
    node.remove();
  }

  toolbar.removeAttribute("label");

  if ( IsInHTMLSourceMode() ) {
    // we have destroyed the contents of the status bar and are
    // about to recreate it ; but we don't want to do that in
    // Source mode
    return;
  }

  var tag, button;
  var bodyElement = GetBodyElement();
  var isFocusNode = true;
  var tmp;
  do {
    tag = element.nodeName.toLowerCase();

    button = document.createElementNS(XUL_NS, "toolbarbutton");
    button.setAttribute("label",   "<" + tag + ">");
    button.setAttribute("value",   tag);
    button.setAttribute("context", "structToolbarContext");
    button.className = "struct-button";

    toolbar.insertBefore(button, toolbar.firstChild);

    button.addEventListener("command", newCommandListener(element), false);

    button.addEventListener("contextmenu", newContextmenuListener(button, element), false);

    if (isFocusNode && oneElementSelected) {
      button.setAttribute("checked", "true");
      isFocusNode = false;
    }

    tmp = element;
    element = element.parentNode;

  } while (tmp != bodyElement);
}

function SelectFocusNodeAncestor(element)
{
  var editor = GetCurrentEditor();
  if (editor) {
    if (element == GetBodyElement())
      editor.selectAll();
    else
      editor.selectElement(element);
  }
  ResetStructToolbar();
}

function GetSelectionContainer()
{
  var editor = GetCurrentEditor();
  if (!editor) return null;

  try {
    var selection = editor.selection;
    if (!selection) return null;
  }
  catch (e) { return null; }

  var result = { oneElementSelected:false };

  if (selection.isCollapsed) {
    result.node = selection.focusNode;
  }
  else {
    var rangeCount = selection.rangeCount;
    if (rangeCount == 1) {
      result.node = editor.getSelectedElement("");
      var range = selection.getRangeAt(0);

      // check for a weird case : when we select a piece of text inside
      // a text node and apply an inline style to it, the selection starts
      // at the end of the text node preceding the style and ends after the
      // last char of the style. Assume the style element is selected for
      // user's pleasure
      if (!result.node &&
          range.startContainer.nodeType == Node.TEXT_NODE &&
          range.startOffset == range.startContainer.length &&
          range.endContainer.nodeType == Node.TEXT_NODE &&
          range.endOffset == range.endContainer.length &&
          range.endContainer.nextSibling == null &&
          range.startContainer.nextSibling == range.endContainer.parentNode)
        result.node = range.endContainer.parentNode;

      if (!result.node) {
        // let's rely on the common ancestor of the selection
        result.node = range.commonAncestorContainer;
      }
      else {
        result.oneElementSelected = true;
      }
    }
    else {
      // assume table cells !
      var i, container = null;
      for (i = 0; i < rangeCount; i++) {
        range = selection.getRangeAt(i);
        if (!container) {
          container = range.startContainer;
        }
        else if (container != range.startContainer) {
          // all table cells don't belong to same row so let's
          // select the parent of all rows
          result.node = container.parentNode;
          break;
        }
        result.node = container;
      }
    }
  }

  // make sure we have an element here
  while (result.node.nodeType != Node.ELEMENT_NODE)
    result.node = result.node.parentNode;

  // and make sure the element is not a special editor node like
  // the <br> we insert in blank lines
  // and don't select anonymous content !!! (fix for bug 190279)
  while (result.node.hasAttribute("_moz_editor_bogus_node") ||
         editor.isAnonymousElement(result.node))
    result.node = result.node.parentNode;

  return result;
}

function FillInHTMLTooltipEditor(tooltip)
{
  const XLinkNS = "http://www.w3.org/1999/xlink";
  var tooltipText = null;
  var node;
  if (IsInPreviewMode()) {
    for (node = document.tooltipNode; node; node = node.parentNode) {
      if (node.nodeType == Node.ELEMENT_NODE) {
        tooltipText = node.getAttributeNS(XLinkNS, "title");
        if (tooltipText && /\S/.test(tooltipText)) {
          tooltip.setAttribute("label", tooltipText);
          return true;
        }
        tooltipText = node.getAttribute("title");
        if (tooltipText && /\S/.test(tooltipText)) {
          tooltip.setAttribute("label", tooltipText);
          return true;
        }
      }
    }
  } else {
    for (node = document.tooltipNode; node; node = node.parentNode) {
      if (node instanceof Components.interfaces.nsIDOMHTMLImageElement ||
          node instanceof Components.interfaces.nsIDOMHTMLInputElement)
        tooltipText = node.getAttribute("src");
      else if (node instanceof Components.interfaces.nsIDOMHTMLAnchorElement)
        tooltipText = node.getAttribute("href") || node.name;
      if (tooltipText) {
        tooltip.setAttribute("label", tooltipText);
        return true;
      }
    }
  }
  return false;
}

function UpdateTOC()
{
  window.openDialog("chrome://editor/content/EdInsertTOC.xul",
                    "_blank", "chrome,close,modal,titlebar");
  window.content.focus();
}

function InitTOCMenu()
{
  var elt = GetCurrentEditor().document.getElementById("mozToc");
  var createMenuitem = document.getElementById("insertTOCMenuitem");
  var updateMenuitem = document.getElementById("updateTOCMenuitem");
  var removeMenuitem = document.getElementById("removeTOCMenuitem");
  if (removeMenuitem && createMenuitem && updateMenuitem) {
    if (elt) {
      createMenuitem.setAttribute("disabled", "true");
      updateMenuitem.removeAttribute("disabled");
      removeMenuitem.removeAttribute("disabled");
    }
    else {
      createMenuitem.removeAttribute("disabled");
      removeMenuitem.setAttribute("disabled", "true");
      updateMenuitem.setAttribute("disabled", "true");
    }
  }
}

function RemoveTOC()
{
  var theDocument = GetCurrentEditor().document;
  var elt = theDocument.getElementById("mozToc");
  if (elt) {
    elt.remove();
  }

  let anchorNodes = theDocument.querySelectorAll('a[name^="mozTocId"]');
  for (let node of anchorNodes) {
    if (node.parentNode) {
      node.remove();
    }
  }
}
