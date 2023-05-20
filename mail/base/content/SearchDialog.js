/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource:///modules/MailUtils.js");
Components.utils.import("resource://gre/modules/PluralForm.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

var gCurrentFolder;

var gFolderDisplay;
// Although we don't display messages, we have a message display object to
//  simplify our code.  It's just always disabled.
var gMessageDisplay;

var nsIMsgWindow = Components.interfaces.nsIMsgWindow;

var gFolderPicker;
var gStatusFeedback;
var gTimelineEnabled = false;
var RDF;
var gSearchBundle;

// Datasource search listener -- made global as it has to be registered
// and unregistered in different functions.
var gDataSourceSearchListener;
var gViewSearchListener;

var gSearchStopButton;

// Should we try to search online?
var gSearchOnline = false;

// Controller object for search results thread pane
var nsSearchResultsController =
{
    supportsCommand: function(command)
    {
        switch(command) {
        case "cmd_delete":
        case "cmd_shiftDelete":
        case "button_delete":
        case "cmd_open":
        case "file_message_button":
        case "open_in_folder_button":
        case "saveas_vf_button":
        case "cmd_selectAll":
            return true;
        default:
            return false;
        }
    },

    // this controller only handles commands
    // that rely on items being selected in
    // the search results pane.
    isCommandEnabled: function(command)
    {
        var enabled = true;

        switch (command) {
          case "open_in_folder_button":
            if (gFolderDisplay.selectedCount != 1)
              enabled = false;
            break;
          case "cmd_delete":
          case "cmd_shiftDelete":
          case "button_delete":
            // this assumes that advanced searches don't cross accounts
            if (gFolderDisplay.selectedCount <= 0)
              enabled = false;
            break;
          case "saveas_vf_button":
              // need someway to see if there are any search criteria...
              return true;
          case "cmd_selectAll":
            return true;
          default:
            if (gFolderDisplay.selectedCount <= 0)
              enabled = false;
            break;
        }

        return enabled;
    },

    doCommand: function(command)
    {
        switch(command) {
        case "cmd_open":
            MsgOpenSelectedMessages();
            return true;

        case "cmd_delete":
        case "button_delete":
            MsgDeleteSelectedMessages(nsMsgViewCommandType.deleteMsg);
            return true;
        case "cmd_shiftDelete":
            MsgDeleteSelectedMessages(nsMsgViewCommandType.deleteNoTrash);
            return true;

        case "open_in_folder_button":
            OpenInFolder();
            return true;

        case "saveas_vf_button":
            saveAsVirtualFolder();
            return true;

        case "cmd_selectAll":
            // move the focus to the search results pane
            GetThreadTree().focus();
            gFolderDisplay.doCommand(nsMsgViewCommandType.selectAll);
            return true;

        default:
            return false;
        }

    },

    onEvent: function(event)
    {
    }
}

function UpdateMailSearch(caller)
{
  document.commandDispatcher.updateCommands('mail-search');
}
/**
 * FolderDisplayWidget currently calls this function when the command updater
 *  notification for updateCommandStatus is called.  We don't have a toolbar,
 *  but our 'mail-search' command set serves the same purpose.
 */
var UpdateMailToolbar = UpdateMailSearch;

/**
 * No-op clear message pane function for FolderDisplayWidget.
 */
function ClearMessagePane() {
}

function SetAdvancedSearchStatusText(aNumHits)
{
}

/**
 * Subclass the FolderDisplayWidget to deal with UI specific to the search
 *  window.
 */
function SearchFolderDisplayWidget(aMessageDisplay) {
  FolderDisplayWidget.call(this, /* no tab info */ null, aMessageDisplay);
}

SearchFolderDisplayWidget.prototype = {
  __proto__: FolderDisplayWidget.prototype,

  /// folder display will want to show the thread pane; we need do nothing
  _showThreadPane: function () {},

  onSearching: function SearchFolderDisplayWidget_onSearch(aIsSearching) {
    if (aIsSearching) {
      // Search button becomes the "stop" button
      gSearchStopButton.setAttribute(
        "label", gSearchBundle.getString("labelForStopButton"));
      gSearchStopButton.setAttribute(
        "accesskey", gSearchBundle.getString("labelForStopButton.accesskey"));

      // update our toolbar equivalent
      UpdateMailSearch("new-search");
      // spin the meteors
      gStatusFeedback._startMeteors();
      // tell the user that we're searching
      gStatusFeedback.showStatusString(
        gSearchBundle.getString("searchingMessage"));
    }
    else {
      // Stop button resumes being the "search" button
      gSearchStopButton.setAttribute(
        "label", gSearchBundle.getString("labelForSearchButton"));
      gSearchStopButton.setAttribute(
        "accesskey", gSearchBundle.getString("labelForSearchButton.accesskey"));

      // update our toolbar equivalent
      UpdateMailSearch("done-search");
      // stop spining the meteors
      gStatusFeedback._stopMeteors();
      // set the result test
      this.updateStatusResultText();
    }
  },

  /**
   * If messages were removed, we might have lost some search results and so
   *  should update our search result text.  Also, defer to our super-class.
   */
  onMessagesRemoved: function SearchFolderDisplayWidget_onMessagesRemoved() {
    // result text is only for when we are not searching
    if (!this.view.searching)
      this.updateStatusResultText();
    this.__proto__.__proto__.onMessagesRemoved.call(this);
  },

  updateStatusResultText: function() {
    let rowCount = this.view.dbView.rowCount;
    let statusMsg;

    if (rowCount == 0) {
      statusMsg = gSearchBundle.getString("noMatchesFound");
    }
    else {
      statusMsg = PluralForm.get(rowCount,
                                 gSearchBundle.getString("matchesFound"));
      statusMsg = statusMsg.replace("#1", rowCount);
    }

    gStatusFeedback.showStatusString(statusMsg);
  },
};


function searchOnLoad()
{
  initializeSearchWidgets();
  initializeSearchWindowWidgets();
  messenger = Components.classes["@mozilla.org/messenger;1"]
                        .createInstance(Components.interfaces.nsIMessenger);

  gSearchBundle = document.getElementById("bundle_search");
  gSearchStopButton.setAttribute("label", gSearchBundle.getString("labelForSearchButton"));
  gSearchStopButton.setAttribute("accesskey", gSearchBundle.getString("labelForSearchButton.accesskey"));

  gMessageDisplay = new NeverVisisbleMessageDisplayWidget();
  gFolderDisplay = new SearchFolderDisplayWidget(gMessageDisplay);
  gFolderDisplay.messenger = messenger;
  gFolderDisplay.msgWindow = msgWindow;
  gFolderDisplay.tree = document.getElementById("threadTree");
  gFolderDisplay.treeBox = gFolderDisplay.tree.boxObject.QueryInterface(
                             Components.interfaces.nsITreeBoxObject);
  gFolderDisplay.view.openSearchView();
  gFolderDisplay.makeActive();

  gFolderDisplay.setColumnStates({
    subjectCol: { visible: true },
    correspondentCol: { visible: Services.prefs.getBoolPref("mail.threadpane.use_correspondents") },
    senderCol: { visible: !Services.prefs.getBoolPref("mail.threadpane.use_correspondents") },
    dateCol: { visible: true },
    locationCol: { visible: true },
  });

  if (window.arguments && window.arguments[0])
      updateSearchFolderPicker(window.arguments[0].folder);

  // trigger searchTermOverlay.js to create the first criterion
  onMore(null);
  // make sure all the buttons are configured
  UpdateMailSearch("onload");
}

function searchOnUnload()
{
  gFolderDisplay.close();
  top.controllers.removeController(nsSearchResultsController);

  // release this early because msgWindow holds a weak reference
  msgWindow.rootDocShell = null;
}

function initializeSearchWindowWidgets()
{
    gFolderPicker = document.getElementById("searchableFolders");
    gSearchStopButton = document.getElementById("search-button");
    hideMatchAllItem();

    msgWindow = Components.classes["@mozilla.org/messenger/msgwindow;1"]
                          .createInstance(nsIMsgWindow);
    msgWindow.domWindow = window;
    msgWindow.rootDocShell.appType = Components.interfaces.nsIDocShell.APP_TYPE_MAIL;

    gStatusFeedback = new nsMsgStatusFeedback();
    msgWindow.statusFeedback = gStatusFeedback;

    // functionality to enable/disable buttons using nsSearchResultsController
    // depending of whether items are selected in the search results thread pane.
    top.controllers.insertControllerAt(0, nsSearchResultsController);
}


function onSearchStop() {
  gFolderDisplay.view.search.session.interruptSearch();
}

function onResetSearch(event) {
  onReset(event);
  gFolderDisplay.view.search.clear();

  gStatusFeedback.showStatusString("");
}

function updateSearchFolderPicker(folder)
{
  gCurrentFolder = folder;
  gFolderPicker.menupopup.selectFolder(folder);

  var searchOnline = document.getElementById("checkSearchOnline");
  // We will hide and disable the search online checkbox if we are offline, or
  // if the folder does not support online search.

  // Any offlineSupportLevel > 0 is an online server like IMAP or news.
  if (gCurrentFolder.server.offlineSupportLevel &&
      !Services.io.offline)
  {
    searchOnline.hidden = false;
    searchOnline.disabled = false;
  }
  else
  {
    searchOnline.hidden = true;
    searchOnline.disabled = true;
  }
  setSearchScope(GetScopeForFolder(gCurrentFolder));
}

function updateSearchLocalSystem()
{
  setSearchScope(GetScopeForFolder(gCurrentFolder));
}

function UpdateAfterCustomHeaderChange()
{
  updateSearchAttributes();
}

function onEnterInSearchTerm()
{
  // on enter
  // if not searching, start the search
  // if searching, stop and then start again
  if (gSearchStopButton.getAttribute("label") == gSearchBundle.getString("labelForSearchButton")) {
     onSearch();
  }
  else {
     onSearchStop();
     onSearch();
  }
}

function onSearch()
{
  let viewWrapper = gFolderDisplay.view;
  let searchTerms = getSearchTerms();

  viewWrapper.beginViewUpdate();
  viewWrapper.search.userTerms = searchTerms.length ? searchTerms : null;
  viewWrapper.search.onlineSearch = gSearchOnline;
  viewWrapper.searchFolders = getSearchFolders();
  viewWrapper.endViewUpdate();
}

/**
 * Get the current set of search terms, returning them as a list.  We filter out
 *  dangerous and insane predicates.
 */
function getSearchTerms() {
  let termCreator = gFolderDisplay.view.search.session;

  let searchTerms = [];
  // searchTermOverlay stores wrapper objects in its gSearchTerms array.  Pluck
  //  them.
  for (let iTerm = 0; iTerm < gSearchTerms.length; iTerm++) {
    let termWrapper = gSearchTerms[iTerm].obj;
    let realTerm = termCreator.createTerm();
    termWrapper.saveTo(realTerm);
    // A header search of "" is illegal for IMAP and will cause us to
    //  explode.  You don't want that and I don't want that.  So let's check
    //  if the bloody term is a subject search on a blank string, and if it
    //  is, let's secretly not add the term.  Everyone wins!
    if ((realTerm.attrib != Components.interfaces.nsMsgSearchAttrib.Subject) ||
        (realTerm.value.str != ""))
      searchTerms.push(realTerm);
  }

  return searchTerms;
}

/**
 * @return the list of folders the search should cover.
 */
function getSearchFolders() {
  let searchFolders = [];

  if (!gCurrentFolder.isServer && !gCurrentFolder.noSelect)
    searchFolders.push(gCurrentFolder);

  var searchSubfolders =
    document.getElementById("checkSearchSubFolders").checked;
  if (gCurrentFolder &&
      (searchSubfolders || gCurrentFolder.isServer || gCurrentFolder.noSelect))
    AddSubFolders(gCurrentFolder, searchFolders);

  return searchFolders;
}

function AddSubFolders(folder, outFolders) {
  var subFolders = folder.subFolders;
  while (subFolders.hasMoreElements()) {
    var nextFolder =
      subFolders.getNext().QueryInterface(Components.interfaces.nsIMsgFolder);

    if (!(nextFolder.flags & Components.interfaces.nsMsgFolderFlags.Virtual)) {
      if (!nextFolder.noSelect)
        outFolders.push(nextFolder);

      AddSubFolders(nextFolder, outFolders);
    }
  }
}

function AddSubFoldersToURI(folder)
{
  var returnString = "";

  var subFolders = folder.subFolders;

  while (subFolders.hasMoreElements())
  {
    var nextFolder =
      subFolders.getNext().QueryInterface(Components.interfaces.nsIMsgFolder);

    if (!(nextFolder.flags & Components.interfaces.nsMsgFolderFlags.Virtual))
    {
      if (!nextFolder.noSelect && !nextFolder.isServer)
      {
        if (returnString.length > 0)
          returnString += '|';
        returnString += nextFolder.URI;
      }
      var subFoldersString = AddSubFoldersToURI(nextFolder);
      if (subFoldersString.length > 0)
      {
        if (returnString.length > 0)
          returnString += '|';
        returnString += subFoldersString;
      }
    }
  }
  return returnString;
}

/**
 * Determine the proper search scope to use for a folder, so that the user is
 *  presented with a correct list of search capabilities. The user may manually
 *  request on online search for certain server types. To determine if the
 *  folder body may be searched, we ignore whether autosync is enabled,
 *  figuring that after the user manually syncs, they would still expect that
 *  body searches would work.
 *
 * The available search capabilities also depend on whether the user is
 *  currently online or offline. Although that is also checked by the server,
 *  we do it ourselves because we have a more complex response to offline
 *  than the server's searchScope attribute provides.
 *
 * This method only works for real folders.
 */
function GetScopeForFolder(folder)
{
  let searchOnline = document.getElementById("checkSearchOnline");
  if (!searchOnline.disabled && searchOnline.checked)
  {
    gSearchOnline = true;
    return folder.server.searchScope;
  }
  gSearchOnline = false;

  // We are going to search offline. The proper search scope may depend on
  // whether we have the body and/or junk available or not.
  let localType;
  try
  {
    localType = folder.server.localStoreType;
  }
  catch (e) {} // On error, we'll just assume the default mailbox type

  let hasBody = folder.getFlag(Components.interfaces.nsMsgFolderFlags.Offline);
  let nsMsgSearchScope = Components.interfaces.nsMsgSearchScope;
  switch (localType)
  {
    case "news":
      // News has four offline scopes, depending on whether junk and body
      // are available.
      let hasJunk =
        folder.getInheritedStringProperty("dobayes.mailnews@mozilla.org#junk")
               == "true";
      if (hasJunk && hasBody)
        return nsMsgSearchScope.localNewsJunkBody;
      if (hasJunk) // and no body
        return nsMsgSearchScope.localNewsJunk;
      if (hasBody) // and no junk
        return nsMsgSearchScope.localNewsBody;
      // We don't have offline message bodies or junk processing.
      return nsMsgSearchScope.localNews;

    case "imap":
      // Junk is always enabled for imap, so the offline scope only depends on
      // whether the body is available.

      // If we are the root folder, use the server property for body rather
      // than the folder property.
      if (folder.isServer)
      {
        let imapServer = folder.server
                               .QueryInterface(Components.interfaces.nsIImapIncomingServer);
        if (imapServer && imapServer.offlineDownload)
          hasBody = true;
      }

      if (!hasBody)
        return nsMsgSearchScope.onlineManual;
        // fall through to default
    default:
      return nsMsgSearchScope.offlineMail;
  }

}

var nsMsgViewSortType = Components.interfaces.nsMsgViewSortType;
var nsMsgViewSortOrder = Components.interfaces.nsMsgViewSortOrder;
var nsMsgViewFlagsType = Components.interfaces.nsMsgViewFlagsType;
var nsMsgViewCommandType = Components.interfaces.nsMsgViewCommandType;

function goUpdateSearchItems(commandset)
{
  for (var i = 0; i < commandset.childNodes.length; i++)
  {
    var commandID = commandset.childNodes[i].getAttribute("id");
    if (commandID)
    {
      goUpdateCommand(commandID);
    }
  }
}

// used to toggle functionality for Search/Stop button.
function onSearchButton(event)
{
    if (event.target.label == gSearchBundle.getString("labelForSearchButton"))
        onSearch();
    else
        onSearchStop();
}

function MsgDeleteSelectedMessages(aCommandType)
{
    gFolderDisplay.hintAboutToDeleteMessages();
    gFolderDisplay.doCommand(aCommandType);
}

function MoveMessageInSearch(destFolder)
{
  // Get the msg folder we're moving messages into.
  // If the id (uri) is not set, use file-uri which is set for
  // "File Here".
  let destUri = destFolder.getAttribute('id');
  if (destUri.length == 0)
    destUri = destFolder.getAttribute('file-uri');

  let destMsgFolder = MailUtils.getFolderForURI(destUri)
    .QueryInterface(Components.interfaces.nsIMsgFolder);

  gFolderDisplay.hintAboutToDeleteMessages();
  gFolderDisplay.doCommandWithFolder(nsMsgViewCommandType.moveMessages,
                                     destMsgFolder);
}

function OpenInFolder()
{
  MailUtils.displayMessageInFolderTab(gFolderDisplay.selectedMessage);
}

function saveAsVirtualFolder()
{
  var searchFolderURIs = gCurrentFolder.URI;

  var searchSubfolders = document.getElementById("checkSearchSubFolders").checked;
  if (gCurrentFolder && (searchSubfolders || gCurrentFolder.isServer || gCurrentFolder.noSelect))
  {
    var subFolderURIs = AddSubFoldersToURI(gCurrentFolder);
    if (subFolderURIs.length > 0)
      searchFolderURIs += '|' + subFolderURIs;
  }

  var searchOnline = document.getElementById("checkSearchOnline");
  var doOnlineSearch = searchOnline.checked && !searchOnline.disabled;

  var dialog = window.openDialog("chrome://messenger/content/virtualFolderProperties.xul", "",
                                 "chrome,titlebar,modal,centerscreen",
                                 {folder: window.arguments[0].folder,
                                  searchTerms: getSearchTerms(),
                                  searchFolderURIs: searchFolderURIs,
                                  searchOnline: doOnlineSearch});
}
