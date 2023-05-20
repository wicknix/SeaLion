/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/PlacesUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

var gShowBiDi = false;

function getBrowserURL() {
  return Services.prefs.getCharPref("browser.chromeURL");
}

// update menu items that rely on focus
function goUpdateGlobalEditMenuItems()
{
  goUpdateCommand('cmd_undo');
  goUpdateCommand('cmd_redo');
  goUpdateCommand('cmd_cut');
  goUpdateCommand('cmd_copy');
  goUpdateCommand('cmd_paste');
  goUpdateCommand('cmd_selectAll');
  goUpdateCommand('cmd_delete');
  if (gShowBiDi)
    goUpdateCommand('cmd_switchTextDirection');
}

// update menu items that rely on the current selection
function goUpdateSelectEditMenuItems()
{
  goUpdateCommand('cmd_cut');
  goUpdateCommand('cmd_copy');
  goUpdateCommand('cmd_delete');
  goUpdateCommand('cmd_selectAll');
}

// update menu items that relate to undo/redo
function goUpdateUndoEditMenuItems()
{
  goUpdateCommand('cmd_undo');
  goUpdateCommand('cmd_redo');
}

// update menu items that depend on clipboard contents
function goUpdatePasteMenuItems()
{
  goUpdateCommand('cmd_paste');
}

function goCopyImage() {
  let img = document.popupNode;
  if (/^(https?|data):/i.test(img.src)) {
    goDoCommand("cmd_copyImage");
    return;
  }
  // A mailbox/imap URL then... copy only data then since the HTML data is
  // not that useful for pasting when the image won't be resolved.
  let param = Components.classes["@mozilla.org/embedcomp/command-params;1"]
                        .createInstance(Components.interfaces.nsICommandParams);
  param.setLongValue("imageCopy",
                     Components.interfaces.nsIContentViewerEdit.COPY_IMAGE_DATA);
  document.commandDispatcher.getControllerForCommand("cmd_copyImage")
          .QueryInterface(Components.interfaces.nsICommandController)
          .doCommandWithParams("cmd_copyImage", param);
}

// update Find As You Type menu items, they rely on focus
function goUpdateFindTypeMenuItems()
{
  goUpdateCommand('cmd_findTypeText');
  goUpdateCommand('cmd_findTypeLinks');
}

// Gather all descendent text under given document node.
function gatherTextUnder ( root )
{
  var text = "";
  var node = root.firstChild;
  var depth = 1;
  while ( node && depth > 0 ) {
    // See if this node is text.
    if ( node.nodeType == Node.TEXT_NODE ) {
      // Add this text to our collection.
      text += " " + node.data;
    } else if ( node instanceof HTMLImageElement ) {
      // If it has an alt= attribute, add that.
      var altText = node.getAttribute( "alt" );
      if ( altText && altText != "" ) {
        text += " " + altText;
      }
    }
    // Find next node to test.
    // First, see if this node has children.
    if ( node.hasChildNodes() ) {
      // Go to first child.
      node = node.firstChild;
      depth++;
    } else {
      // No children, try next sibling.
      if ( node.nextSibling ) {
        node = node.nextSibling;
      } else {
        // Last resort is a sibling of an ancestor.
        while ( node && depth > 0 ) {
          node = node.parentNode;
          depth--;
          if ( node.nextSibling ) {
            node = node.nextSibling;
            break;
          }
        }
      }
    }
  }
  // Strip leading and trailing whitespace.
  text = text.trim();
  // Compress remaining whitespace.
  text = text.replace( /\s+/g, " " );
  return text;
}

function GenerateValidFilename(filename, extension)
{
  if (filename) // we have a title; let's see if it's usable
  {
    // clean up the filename to make it usable and
    // then trim whitespace from beginning and end
    filename = validateFileName(filename).trim();
    if (filename.length > 0)
      return filename + extension;
  }
  return null;
}

function validateFileName(aFileName)
{
  var re = /[\/]+/g;
  if (navigator.appVersion.includes("Windows")) {
    re = /[\\\/\|]+/g;
    aFileName = aFileName.replace(/[\"]+/g, "'");
    aFileName = aFileName.replace(/[\*\:\?]+/g, " ");
    aFileName = aFileName.replace(/[\<]+/g, "(");
    aFileName = aFileName.replace(/[\>]+/g, ")");
  }
  else if (navigator.appVersion.includes("Macintosh"))
    re = /[\:\/]+/g;

  if (Services.prefs.getBoolPref("mail.save_msg_filename_underscores_for_space"))
    aFileName = aFileName.replace(/ /g, "_");

  return aFileName.replace(re, "_");
}

function goToggleToolbar( id, elementID )
{
  var toolbar = document.getElementById( id );
  var element = document.getElementById( elementID );
  if ( toolbar )
  {
    var isHidden = toolbar.getAttribute("hidden") == "true";
    toolbar.setAttribute("hidden", !isHidden);
    if ( element )
      element.setAttribute("checked", isHidden)
    document.persist(id, 'hidden');
    document.persist(elementID, 'checked');
  }
}

#ifdef MOZ_UPDATER
/**
 * Opens the update manager and checks for updates to the application.
 */
function checkForUpdates()
{
  var um =
      Components.classes["@mozilla.org/updates/update-manager;1"].
      getService(Components.interfaces.nsIUpdateManager);
  var prompter =
      Components.classes["@mozilla.org/updates/update-prompt;1"].
      createInstance(Components.interfaces.nsIUpdatePrompt);
  // If there's an update ready to be applied, show the "Update Downloaded"
  // UI instead and let the user know they have to restart the application for
  // the changes to be applied.
  if (um.activeUpdate && um.activeUpdate.state == "pending")
    prompter.showUpdateDownloaded(um.activeUpdate);
  else
    prompter.checkForUpdates();
}
#endif

/**
 * Set up the help menu software update items to show proper status,
 * also disabling the items if update is disabled.
 */
function buildHelpMenu()
{
#ifdef MOZ_UPDATER
  var updates =
      Components.classes["@mozilla.org/updates/update-service;1"].
      getService(Components.interfaces.nsIApplicationUpdateService);
  var um =
      Components.classes["@mozilla.org/updates/update-manager;1"].
      getService(Components.interfaces.nsIUpdateManager);

  // Disable the UI if the update enabled pref has been locked by the
  // administrator or if we cannot update for some other reason.
  var checkForUpdates = document.getElementById("checkForUpdates");
  var canCheckForUpdates = updates.canCheckForUpdates;
  checkForUpdates.setAttribute("disabled", !canCheckForUpdates);
  if (!canCheckForUpdates)
    return;

  var strings = document.getElementById("bundle_messenger");
  var activeUpdate = um.activeUpdate;

  // If there's an active update, substitute its name into the label
  // we show for this item, otherwise display a generic label.
  function getStringWithUpdateName(key) {
    if (activeUpdate && activeUpdate.name)
      return strings.getFormattedString(key, [activeUpdate.name]);
    return strings.getString(key + "Fallback");
  }

  // By default, show "Check for Updates..." from updatesItem_default or
  // updatesItem_defaultFallback
  var key = "default";
  if (activeUpdate) {
    switch (activeUpdate.state) {
    case "downloading":
      // If we're downloading an update at present, show the text:
      // "Downloading Thunderbird x.x..." from updatesItem_downloading or
      // updatesItem_downloadingFallback, otherwise we're paused, and show
      // "Resume Downloading Thunderbird x.x..." from updatesItem_resume or
      // updatesItem_resumeFallback
      key = updates.isDownloading ? "downloading" : "resume";
      break;
    case "pending":
      // If we're waiting for the user to restart, show: "Apply Downloaded
      // Updates Now..." from updatesItem_pending or
      // updatesItem_pendingFallback
      key = "pending";
      break;
    }
  }

  checkForUpdates.label = getStringWithUpdateName("updatesItem_" + key);
  // updatesItem_default.accesskey, updatesItem_downloading.accesskey,
  // updatesItem_resume.accesskey or updatesItem_pending.accesskey
  checkForUpdates.accessKey = strings.getString("updatesItem_" + key +
                                                ".accesskey");
  if (um.activeUpdate && updates.isDownloading)
    checkForUpdates.setAttribute("loading", "true");
  else
    checkForUpdates.removeAttribute("loading");
#else
#ifndef XP_MACOSX
  // Some extensions may rely on these being present so only hide the about
  // separator when there are no elements besides the check for updates menuitem
  // in between the about separator and the updates separator.
  var updatesSeparator = document.getElementById("updatesSeparator");
  var aboutSeparator = document.getElementById("aboutSeparator");
  var checkForUpdates = document.getElementById("checkForUpdates");
  if (updatesSeparator.nextSibling === checkForUpdates &&
      checkForUpdates.nextSibling === aboutSeparator)
    updatesSeparator.hidden = true;
#endif
#endif
}

/**
 * Toggle a splitter to show or hide some piece of UI (e.g. the message preview
 * pane).
 *
 * @param splitterId the splliter that should be toggled
 */
function togglePaneSplitter(splitterId)
{
  var splitter = document.getElementById(splitterId);
  var state = splitter.getAttribute("state");
  if (state == "collapsed")
    splitter.setAttribute("state", "open");
  else
    splitter.setAttribute("state", "collapsed")
}

// openUILink handles clicks on UI elements that cause URLs to load.
// Firefox and SeaMonkey have a function with the same name,
// so extensions can use this everywhere to open links.
// We currently only react to left click in Thunderbird.
function openUILink(url, event)
{
  if (!event.button) {
    PlacesUtils.asyncHistory.updatePlaces({
      uri: makeURI(url),
      visits:  [{
        visitDate: Date.now() * 1000,
        transitionType: Components.interfaces.nsINavHistoryService.TRANSITION_LINK
      }]
    });
    messenger.launchExternalURL(url);
  }
}

function openWhatsNew()
{
  openContentTab(Services.urlFormatter.formatURLPref("mailnews.start_page.override_url"));
}

/**
 * Open a web search in the default browser for a given query.
 *
 * @param query the string to search for
 * @param engine (optional) the search engine to use
 */
function openWebSearch(query, engine)
{
  Services.search.init({
    onInitComplete: function() {
      if (!engine)
        engine = Services.search.currentEngine;
      openLinkExternally(engine.getSubmission(query).uri.spec);
    }
  });
}

/**
 * Open the specified tab type (possibly in a new window)
 *
 * @param tabType the tab type to open (e.g. "contentTab")
 * @param tabParams the parameters to pass to the tab
 * @param where 'tab' to open in a new tab (default) or 'window' to open in a
 *        new window
 */
function openTab(tabType, tabParams, where)
{
  if (where != "window") {
    let tabmail = document.getElementById("tabmail");
    if (!tabmail) {
      // Try opening new tabs in an existing 3pane window
      let mail3PaneWindow = Services.wm.getMostRecentWindow("mail:3pane");
      if (mail3PaneWindow) {
        tabmail = mail3PaneWindow.document.getElementById("tabmail");
        mail3PaneWindow.focus();
      }
    }

    if (tabmail) {
      tabmail.openTab(tabType, tabParams);
      return;
    }
  }

  // Either we explicitly wanted to open in a new window, or we fell through to
  // here because there's no 3pane.
  window.openDialog("chrome://messenger/content/", "_blank",
                    "chrome,dialog=no,all", null,
                    { tabType: tabType, tabParams: tabParams });
}

/**
 * Open the specified URL as a content tab (or window)
 *
 * @param url the location to open
 * @param where 'tab' to open in a new tab (default) or 'window' to open in a
 *        new window
 * @param handlerRegExp a regular expression (as a string) to use for the
 *        siteClickHandler for determining whether a link should be opened in
 *        Thunderbird or passed to the system
 */
function openContentTab(url, where, handlerRegExp)
{
  let clickHandler = null;
  if (handlerRegExp)
    clickHandler = "specialTabs.siteClickHandler(event, new RegExp(\"" + handlerRegExp + "\"));";

  openTab("contentTab", {contentPage: url, clickHandler: clickHandler}, where);
}

/**
 * Open the preferences page for the specified query in a new tab.
 *
 * @param paneID     ID of prefpane to select automatically.
 * @param tabID      ID of tab to select on the prefpane.
 * @param otherArgs  other prefpane specific arguments.
 */
function openPreferencesTab(paneID, tabID, otherArgs)
{
  let url = "about:preferences";
  let params = {
    contentPage: url,
    paneID: paneID,
    tabID: tabID,
    otherArgs: otherArgs,
    onLoad: function(aEvent, aBrowser) {
      let prefWindow = aBrowser.contentDocument.getElementById("MailPreferences");
      aBrowser.contentWindow.selectPaneAndTab(prefWindow, paneID, tabID, otherArgs);
    }
  };
  openTab("preferencesTab", params);
}

/**
 * Open the dictionary list in a new content tab, if possible in an available
 * mail:3pane window, otherwise by opening a new mail:3pane.
 *
 * @param where the context to open the dictionary list in (e.g. 'tab',
 *        'window'). See openContentTab for more details.
 */
function openDictionaryList(where) {
  let dictUrl = Services.urlFormatter
    .formatURLPref("spellchecker.dictionaries.download.url");
  openContentTab(dictUrl, where, "^https://addons.mozilla.org/");
}

/**
 * Gets the filename from string
 *
 * @param Filename string
 */
function GetFileFromString(aString)
{
  // If empty string just return null.
  if (!aString)
    return null;

  let commandLine = Components.classes["@mozilla.org/toolkit/command-line;1"]
                              .createInstance(Components.interfaces.nsICommandLine);
  let uri = commandLine.resolveURI(aString);
  return uri instanceof Components.interfaces.nsIFileURL ?
         uri.file.QueryInterface(Components.interfaces.nsILocalFile) : null;
}
