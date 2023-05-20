/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var StarUI = {
  _itemId: -1,
  uri: null,
  _batching: false,

  _element: function(aID) {
    return document.getElementById(aID);
  },

  // Edit-bookmark panel
  get panel() {
    delete this.panel;
    var element = this._element("editBookmarkPanel");
    // initially the panel is hidden
    // to avoid impacting startup / new window performance
    element.hidden = false;
    element.addEventListener("popuphidden", this, false);
    element.addEventListener("keypress", this, false);
    return this.panel = element;
  },

  // Array of command elements to disable when the panel is opened.
  get _blockedCommands() {
    delete this._blockedCommands;
    return this._blockedCommands =
      ["cmd_close", "cmd_closeWindow"].map(id => this._element(id));
  },

  _blockCommands: function SU__blockCommands() {
    this._blockedCommands.forEach(function (elt) {
      // make sure not to permanently disable this item (see bug 409155)
      if (elt.hasAttribute("wasDisabled"))
        return;
      if (elt.getAttribute("disabled") == "true") {
        elt.setAttribute("wasDisabled", "true");
      } else {
        elt.setAttribute("wasDisabled", "false");
        elt.setAttribute("disabled", "true");
      }
    });
  },

  _restoreCommandsState: function SU__restoreCommandsState() {
    this._blockedCommands.forEach(function (elt) {
      if (elt.getAttribute("wasDisabled") != "true")
        elt.removeAttribute("disabled");
      elt.removeAttribute("wasDisabled");
    });
  },

  // nsIDOMEventListener
  handleEvent: function SU_handleEvent(aEvent) {
    switch (aEvent.type) {
      case "popuphidden":
        if (aEvent.originalTarget == this.panel) {
          if (!this._element("editBookmarkPanelContent").hidden)
            this.quitEditMode();

          this._restoreCommandsState();
          this._itemId = -1;
          if (this._batching) {
            PlacesUtils.transactionManager.endBatch(false);
            this._batching = false;
          }

          switch (this._actionOnHide) {
            case "cancel": {
              PlacesUtils.transactionManager.undoTransaction();
              break;
            }
            case "remove": {
              // Remove all bookmarks for the bookmark's url, this also removes
              // the tags for the url.
              PlacesUtils.transactionManager.beginBatch(null);
              let itemIds = PlacesUtils.getBookmarksForURI(this._uriForRemoval);
              for (let i = 0; i < itemIds.length; i++) {
                let txn = new PlacesRemoveItemTransaction(itemIds[i]);
                PlacesUtils.transactionManager.doTransaction(txn);
              }
              PlacesUtils.transactionManager.endBatch(false);
              this._uriForRemoval = null;
              break;
            }
          }
          this._actionOnHide = "";
        }
        break;
      case "keypress":
        if (aEvent.defaultPrevented) {
          // The event has already been consumed inside of the panel.
          break;
        }
        switch (aEvent.keyCode) {
          case KeyEvent.DOM_VK_ESCAPE:
            if (!this._element("editBookmarkPanelContent").hidden)
              this.cancelButtonOnCommand();
            break;
          case KeyEvent.DOM_VK_RETURN:
            if (aEvent.target.className == "expander-up" ||
                aEvent.target.className == "expander-down" ||
                aEvent.target.id == "editBMPanel_newFolderButton") {
              //XXX Why is this necessary? The defaultPrevented check should
              //    be enough.
              break;
            }
            this.panel.hidePopup();
            break;
        }
        break;
    }
  },

  _overlayLoaded: false,
  _overlayLoading: false,
  showEditBookmarkPopup:
  function SU_showEditBookmarkPopup(aItemId, aAnchorElement, aPosition) {
    // Performance: load the overlay the first time the panel is opened
    // (see bug 392443).
    if (this._overlayLoading)
      return;

    if (this._overlayLoaded) {
      this._doShowEditBookmarkPanel(aItemId, aAnchorElement, aPosition);
      return;
    }

    this._overlayLoading = true;
    document.loadOverlay(
      "chrome://communicator/content/bookmarks/editBookmarkOverlay.xul",
      (function (aSubject, aTopic, aData) {
        // Move the header (star, title, button) into the grid,
        // so that it aligns nicely with the other items (bug 484022).
        let header = this._element("editBookmarkPanelHeader");
        let rows = this._element("editBookmarkPanelGrid").lastChild;
        rows.insertBefore(header, rows.firstChild);
        header.hidden = false;

        this._overlayLoading = false;
        this._overlayLoaded = true;
        this._doShowEditBookmarkPanel(aItemId, aAnchorElement, aPosition);
      }).bind(this)
    );
  },

  _doShowEditBookmarkPanel:
  function SU__doShowEditBookmarkPanel(aItemId, aAnchorElement, aPosition) {
    if (this.panel.state != "closed")
      return;

    this._blockCommands(); // un-done in the popuphiding handler

    // Set panel title:
    // if we are batching, i.e. the bookmark has been added now,
    // then show Page Bookmarked, else if the bookmark did already exist,
    // we are about editing it, then use Edit This Bookmark.
    this._element("editBookmarkPanelTitle").value =
      this._batching ?
        gNavigatorBundle.getString("editBookmarkPanel.pageBookmarkedTitle") :
        gNavigatorBundle.getString("editBookmarkPanel.editBookmarkTitle");

    this._element("editBookmarkPanelBottomButtons").hidden = false;
    this._element("editBookmarkPanelContent").hidden = false;

    // The remove button is shown only if we're not already batching, i.e.
    // if the cancel button/ESC does not remove the bookmark.
    this._element("editBookmarkPanelRemoveButton").hidden = this._batching;

    // The label of the remove button differs if the URI is bookmarked
    // multiple times.
    var bookmarks = PlacesUtils.getBookmarksForURI(gBrowser.currentURI);
    var forms = gNavigatorBundle.getString("editBookmark.removeBookmarks.label");
    var label = PluralForm.get(bookmarks.length, forms).replace("#1", bookmarks.length);
    this._element("editBookmarkPanelRemoveButton").label = label;

    this._itemId = aItemId !== undefined ? aItemId : this._itemId;
    this.beginBatch();

    // Consume dismiss clicks, see bug 400924
    this.panel.popupBoxObject
        .setConsumeRollupEvent(PopupBoxObject.ROLLUP_CONSUME);
    
    let onPanelReady = fn => {
      let target = this.panel;
      if (target.parentNode) {
        // By targeting the panel's parent and using a capturing listener, we
        // can have our listener called before others waiting for the panel to
        // be shown (which probably expect the panel to be fully initialized)
        target = target.parentNode;
      }
      target.addEventListener("popupshown", function(event) {
        fn();
      }, {"capture": true, "once": true});
    };

    gEditItemOverlay.initPanel(this._itemId,
                               { onPanelReady, 
                                 hiddenRows: ["description", "location",
                                              "keyword"] });
    this.panel.openPopup(aAnchorElement, aPosition);
  },

  panelShown:
  function SU_panelShown(aEvent) {
    if (aEvent.target == this.panel) {
      if (!this._element("editBookmarkPanelContent").hidden) {
        let fieldToFocus = "editBMPanel_" +
          Services.prefs.getCharPref("browser.bookmarks.editDialog.firstEditField");
        var elt = this._element(fieldToFocus);
        elt.focus();
        elt.select();
      }
      else {
        // Note this isn't actually used anymore, we should remove this
        // once we decide not to bring back the page bookmarked notification
        this.panel.focus();
      }
    }
  },

  quitEditMode: function SU_quitEditMode() {
    this._element("editBookmarkPanelContent").hidden = true;
    this._element("editBookmarkPanelBottomButtons").hidden = true;
    gEditItemOverlay.uninitPanel(true);
  },

  editButtonCommand: function SU_editButtonCommand() {
    this.showEditBookmarkPopup();
  },

  cancelButtonOnCommand: function SU_cancelButtonOnCommand() {
    this._actionOnHide = "cancel";
    this.panel.hidePopup();
  },

  removeBookmarkButtonCommand: function SU_removeBookmarkButtonCommand() {
    this._uriForRemoval = PlacesUtils.bookmarks.getBookmarkURI(this._itemId);
    this._actionOnHide = "remove";
    this.panel.hidePopup();
  },

  beginBatch: function SU_beginBatch() {
    if (!this._batching) {
      PlacesUtils.transactionManager.beginBatch(null);
      this._batching = true;
    }
  }
}

var PlacesCommandHook = {
  /**
   * Adds a bookmark to the page loaded in the given browser.
   *
   * @param aBrowser
   *        a <browser> element.
   * @param [optional] aParent
   *        The folder in which to create a new bookmark if the page loaded in
   *        aBrowser isn't bookmarked yet, defaults to the unfiled root.
   * @param [optional] aShowEditUI
   *        whether or not to show the edit-bookmark UI for the bookmark item
   */
  bookmarkPage: function PCH_bookmarkPage(aBrowser, aParent, aShowEditUI) {
    var uri = aBrowser.currentURI;
    var itemId = PlacesUtils.getMostRecentBookmarkForURI(uri);
    if (itemId == -1) {
      // Copied over from addBookmarkForBrowser:
      // Bug 52536: We obtain the URL and title from the nsIWebNavigation
      // associated with a <browser/> rather than from a DOMWindow.
      // This is because when a full page plugin is loaded, there is
      // no DOMWindow (?) but information about the loaded document
      // may still be obtained from the webNavigation.
      var webNav = aBrowser.webNavigation;
      var url = webNav.currentURI;
      var title;
      var description;
      var charset;
      try {
        title = webNav.document.title || url.spec;
        description = PlacesUIUtils.getDescriptionFromDocument(webNav.document);
        charset = webNav.document.characterSet;
      }
      catch (e) { }

      if (aShowEditUI) {
        // If we bookmark the page here (i.e. page was not "starred" already)
        // but open right into the "edit" state, start batching here, so
        // "Cancel" in that state removes the bookmark.
        StarUI.beginBatch();
      }

      var parent = aParent || PlacesUtils.unfiledBookmarksFolderId;
      var descAnno = { name: PlacesUIUtils.DESCRIPTION_ANNO, value: description };
      var txn = new PlacesCreateBookmarkTransaction(uri, parent,
                                                    PlacesUtils.bookmarks.DEFAULT_INDEX,
                                                    title, null, [descAnno]);
      PlacesUtils.transactionManager.doTransaction(txn);
      // Set the character-set
      if (charset)
        PlacesUtils.setCharsetForURI(uri, charset);
      itemId = PlacesUtils.getMostRecentBookmarkForURI(uri);
    }

    // dock the panel to the star icon when possible, otherwise dock
    // it to the content area
    if (aBrowser.contentWindow == window.content) {
      let ubIcons = aBrowser.ownerDocument.getElementById("urlbar-icons");
      if (ubIcons) {
        if (aShowEditUI)
          StarUI.showEditBookmarkPopup(itemId, ubIcons, "bottomcenter topright");
        return;
      }
    }

    StarUI.showEditBookmarkPopup(itemId, aBrowser, "overlap");
  },

  /**
   * Adds a bookmark to the page loaded in the given browser using the
   * properties dialog.
   *
   * @param aBrowser
   *        a <browser> element.
   * @param [optional] aParent
   *        The folder in which to create a new bookmark if the page loaded in
   *        aBrowser isn't bookmarked yet, defaults to the unfiled root.
   */
  bookmarkPageAs: function PCH_bookmarkPageAs(aBrowser, aParent) {
    var uri = aBrowser.currentURI;
    var webNav = aBrowser.webNavigation;
    var url = webNav.currentURI;
    var title;
    var description;
    try {
      title = webNav.document.title || url.spec;
      description = PlacesUIUtils.getDescriptionFromDocument(webNav.document);
    }
    catch (e) { }

    var parent = aParent || PlacesUtils.bookmarksMenuFolderId;

    var insertPoint = new InsertionPoint(parent,
                                         PlacesUtils.bookmarks.DEFAULT_INDEX);
    var hiddenRows = [];
    PlacesUIUtils.showAddBookmarkUI(uri, title, description, insertPoint, true,
                                    null, null, null, null, hiddenRows);
  },

  /**
   * Adds a bookmark to the page loaded in the current tab.
   */
  bookmarkCurrentPage: function PCH_bookmarkCurrentPage(aShowEditUI, aParent) {
    this.bookmarkPage(gBrowser.selectedBrowser, aParent, aShowEditUI);
  },

  /**
   * Adds a bookmark to the page targeted by a link.
   * @param aParent
   *        The folder in which to create a new bookmark if aURL isn't
   *        bookmarked.
   * @param aURL (string)
   *        the address of the link target
   * @param aTitle
   *        The link text
   */
  bookmarkLink: function PCH_bookmarkLink(aParent, aURL, aTitle) {
    var linkURI = makeURI(aURL);
    var itemId = PlacesUtils.getMostRecentBookmarkForURI(linkURI);
    if (itemId == -1)
      PlacesUIUtils.showMinimalAddBookmarkUI(linkURI, aTitle);
    else {
      PlacesUIUtils.showItemProperties(itemId,
                                       PlacesUtils.bookmarks.TYPE_BOOKMARK);
    }
  },

  /**
   * This function returns a list of nsIURI objects characterizing the
   * tabs currently open in the browser.  The URIs will appear in the
   * list in the order in which their corresponding tabs appeared.  However,
   * only the first instance of each URI will be returned.
   *
   * @returns a list of nsIURI objects representing unique locations open
   */
  _getUniqueTabInfo: function BATC__getUniqueTabInfo(aTitles) {
    var tabList = [];
    var seenURIs = {};

    var browsers = gBrowser.browsers;
    for (var i = 0; i < browsers.length; ++i) {
      let uri = browsers[i].currentURI;

      // skip redundant entries
      if (uri.spec in seenURIs)
        continue;

      // add to the set of seen URIs
      seenURIs[uri.spec] = null;
      tabList.push(uri);
      if (aTitles)
        aTitles.push(browsers[i].contentTitle);
    }
    return tabList;
  },

  /**
   * Adds a folder with bookmarks to all of the currently open tabs in this
   * window.
   */
  bookmarkCurrentPages: function PCH_bookmarkCurrentPages() {
    var titles = [];
    var tabURIs = this._getUniqueTabInfo(titles);
    PlacesUIUtils.showMinimalAddMultiBookmarkUI(tabURIs, titles);
  },


  /**
   * Adds a Live Bookmark to a feed associated with the current page.
   * @param     url
   *            The nsIURI of the page the feed was attached to
   * @title     title
   *            The title of the feed. Optional.
   * @subtitle  subtitle
   *            A short description of the feed. Optional.
   */
  addLiveBookmark: function PCH_addLiveBookmark(url, feedTitle, feedSubtitle) {
    var feedURI = makeURI(url);

    var doc = gBrowser.contentDocument;
    var title = (arguments.length > 1) ? feedTitle : doc.title;

    var description;
    if (arguments.length > 2)
      description = feedSubtitle;
    else
      description = PlacesUIUtils.getDescriptionFromDocument(doc);

    var toolbarIP =
      new InsertionPoint(PlacesUtils.bookmarks.toolbarFolder, -1);
    PlacesUIUtils.showMinimalAddLivemarkUI(feedURI, gBrowser.currentURI,
                                           title, description, toolbarIP, true);
  },

  /**
   * Opens the bookmarks manager.
   * @param   aLeftPaneRoot
   *          The query to select in the organizer window - options
   *          are: AllBookmarks, BookmarksMenu, BookmarksToolbar,
   *          UnfiledBookmarks and Tags.
   */
  showBookmarksManager: function PCH_showBookmarksManager(aLeftPaneRoot) {
    var manager = Services.wm.getMostRecentWindow("bookmarks:manager");
    // Due to bug 528706, getMostRecentWindow can return closed windows.
    if (!manager || manager.closed) {
      // No currently open places window, so open one with the specified mode.
      openDialog("chrome://communicator/content/bookmarks/bookmarksManager.xul",
                 "", "all,dialog=no", aLeftPaneRoot);
    }
    else {
      manager.PlacesOrganizer.selectLeftPaneQuery(aLeftPaneRoot);
      manager.focus();
    }
  }
};

/**
 * Functions for handling events in the Bookmarks Toolbar and menu.
 */
var BookmarksEventHandler = {
  /**
   * Handler for click event for an item in the bookmarks toolbar or menu.
   * Menus and submenus from the folder buttons bubble up to this handler.
   * Left-click is handled in the onCommand function.
   * When items are middle-clicked (or clicked with modifier), open in tabs.
   * If the click came through a menu, close the menu.
   * @param aEvent
   *        DOMEvent for the click
   */
  onClick: function BEH_onClick(aEvent) {
    // Only handle middle-click or left-click with modifiers.
    if (aEvent.button == 2 || (aEvent.button == 0 && !aEvent.shiftKey &&
                               !aEvent.ctrlKey && !aEvent.metaKey))
      return;

    var target = aEvent.originalTarget;
    // If this event bubbled up from a menu or menuitem, close the menus.
    // Do this before opening tabs, to avoid hiding the open tabs confirm-dialog.
    if (target.localName == "menu" || target.localName == "menuitem") {
      for (node = target.parentNode; node; node = node.parentNode) {
        if (node.localName == "menupopup")
          node.hidePopup();
        else if (node.localName != "menu")
          break;
      }
    }

    if (target._placesNode && PlacesUtils.nodeIsContainer(target._placesNode)) {
      // Don't open the root folder in tabs when the empty area on the toolbar
      // is middle-clicked or when a non-bookmark item except for Open in Tabs)
      // in a bookmarks menupopup is middle-clicked.
      if (target.localName == "menu" || target.localName == "toolbarbutton")
        PlacesUIUtils.openContainerNodeInTabs(target._placesNode, aEvent);
    }
    else if (aEvent.button == 1) {
      // left-clicks with modifier are already served by onCommand
      this.onCommand(aEvent);
    }
  },

  /**
   * Handler for command event for an item in the bookmarks toolbar.
   * Menus and submenus from the folder buttons bubble up to this handler.
   * Opens the item.
   * @param aEvent
   *        DOMEvent for the command
   */
  onCommand: function BEH_onCommand(aEvent) {
    var target = aEvent.originalTarget;
    if (target._placesNode)
      PlacesUIUtils.openNodeWithEvent(target._placesNode, aEvent);
  },

  onPopupShowing: function BEH_onPopupShowing(aEvent) {
    var browser = getBrowser();
    if (!aEvent.currentTarget.parentNode._placesView)
      new PlacesMenu(aEvent, 'place:folder=BOOKMARKS_MENU');

    document.getElementById("Browser:BookmarkAllTabs")
            .setAttribute("disabled", !browser || browser.tabs.length == 1);
  },

  fillInBHTooltip: function BEH_fillInBHTooltip(aDocument, aEvent) {
    var node;
    var cropped = false;
    var targetURI;

    if (aDocument.tooltipNode.localName == "treechildren") {
      var tree = aDocument.tooltipNode.parentNode;
      var tbo = tree.treeBoxObject;
      var cell = tbo.getCellAt(aEvent.clientX, aEvent.clientY);
      if (cell.row == -1)
        return false;
      node = tree.view.nodeForTreeIndex(cell.row);
      cropped = tbo.isCellCropped(cell.row, cell.col);
    }
    else {
      // Check whether the tooltipNode is a Places node.
      // In such a case use it, otherwise check for targetURI attribute.
      var tooltipNode = aDocument.tooltipNode;
      if (tooltipNode._placesNode)
        node = tooltipNode._placesNode;
      else {
        // This is a static non-Places node.
        targetURI = tooltipNode.getAttribute("targetURI");
      }
    }

    if (!node && !targetURI)
      return false;

    // Show node.label as tooltip's title for non-Places nodes.
    var title = node ? node.title : tooltipNode.label;

    // Show URL only for Places URI-nodes or nodes with a targetURI attribute.
    var url;
    if (targetURI || PlacesUtils.nodeIsURI(node))
      url = targetURI || node.uri;

    // Show tooltip for containers only if their title is cropped.
    if (!cropped && !url)
      return false;

    var tooltipTitle = aDocument.getElementById("bhtTitleText");
    tooltipTitle.hidden = (!title || (title == url));
    if (!tooltipTitle.hidden)
      tooltipTitle.textContent = title;

    var tooltipUrl = aDocument.getElementById("bhtUrlText");
    tooltipUrl.hidden = !url;
    if (!tooltipUrl.hidden)
      tooltipUrl.value = url;

    // Show tooltip.
    return true;
  }
};


// Handles special drag and drop functionality for Places menus that are not
// part of a Places view (e.g. the bookmarks menu in the menubar).
var PlacesMenuDNDHandler = {
  _springLoadDelay: 350, // milliseconds
  _loadTimer: null,

  /**
   * Called when the user enters the <menu> element during a drag.
   * @param   event
   *          The DragEnter event that spawned the opening.
   */
  onDragEnter: function PMDH_onDragEnter(event) {
    // Opening menus in a Places popup is handled by the view itself.
    if (!this._isStaticContainer(event.target))
      return;

    this._loadTimer = Components.classes["@mozilla.org/timer;1"]
                                .createInstance(Components.interfaces.nsITimer);
    this._loadTimer.initWithCallback(function() {
      PlacesMenuDNDHandler._loadTimer = null;
      event.target.lastChild.setAttribute("autoopened", "true");
      event.target.lastChild.showPopup(event.target.lastChild);
    }, this._springLoadDelay, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
    event.preventDefault();
    event.stopPropagation();
  },

  /**
   * Handles dragexit on the <menu> element.
   * @returns true if the element is a container element (menu or
   *          menu-toolbarbutton), false otherwise.
   */
  onDragExit: function PMDH_onDragExit(event) {
    // Closing menus in a Places popup is handled by the view itself.
    if (!this._isStaticContainer(event.target))
      return;

    if (this._loadTimer) {
      this._loadTimer.cancel();
      this._loadTimer = null;
    }
    let closeTimer = Components.classes["@mozilla.org/timer;1"]
                               .createInstance(Components.interfaces.nsITimer);
    closeTimer.initWithCallback(function() {
      let node = PlacesControllerDragHelper.currentDropTarget;
      let inHierarchy = false;
      while (node && !inHierarchy) {
        inHierarchy = node == event.target;
        node = node.parentNode;
      }
      if (!inHierarchy && event.target.lastChild &&
          event.target.lastChild.hasAttribute("autoopened")) {
        event.target.lastChild.removeAttribute("autoopened");
        event.target.lastChild.hidePopup();
      }
    }, this._springLoadDelay, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  },

  /**
   * Determines if a XUL element represents a static container.
   * @returns true if the element is a container element (menu or
   *          menu-toolbarbutton), false otherwise.
   */
  _isStaticContainer: function PMDH__isContainer(node) {
    let isMenu = node.localName == "menu" ||
                 (node.localName == "toolbarbutton" &&
                  node.getAttribute("type") == "menu");
    let isStatic = !("_placesNode" in node) && node.lastChild &&
                   node.lastChild.hasAttribute("placespopup") &&
                   !node.parentNode.hasAttribute("placespopup");
    return isMenu && isStatic;
  },

  /**
   * Called when the user drags over the <menu> element.
   * @param   event
   *          The DragOver event.
   */
  onDragOver: function PMDH_onDragOver(event) {
    let ip = new InsertionPoint(PlacesUtils.bookmarksMenuFolderId,
                                PlacesUtils.bookmarks.DEFAULT_INDEX,
                                Components.interfaces.nsITreeView.DROP_ON);
    if (ip && PlacesControllerDragHelper.canDrop(ip, event.dataTransfer))
      event.preventDefault();

    event.stopPropagation();
  },

  /**
   * Called when the user drops on the <menu> element.
   * @param   event
   *          The Drop event.
   */
  onDrop: function PMDH_onDrop(event) {
    // Put the item at the end of bookmark menu.
    let ip = new InsertionPoint(PlacesUtils.bookmarksMenuFolderId,
                                PlacesUtils.bookmarks.DEFAULT_INDEX,
                                Components.interfaces.nsITreeView.DROP_ON);
    PlacesControllerDragHelper.onDrop(ip, event.dataTransfer);
    event.stopPropagation();
  }
};


var PlacesStarButton = {
  _hasBookmarksObserver: false,

  uninit: function PSB_uninit()
  {
    if (this._hasBookmarksObserver) {
      PlacesUtils.bookmarks.removeObserver(this);
    }

    if (this._pendingStmt) {
      this._pendingStmt.cancel();
      delete this._pendingStmt;
    }
  },

  QueryInterface: XPCOMUtils.generateQI([
    Components.interfaces.nsINavBookmarkObserver
  ]),

  get _starredTooltip()
  {
    delete this._starredTooltip;
    return this._starredTooltip =
      gNavigatorBundle.getString("starButtonOn.tooltip");
  },
  get _unstarredTooltip()
  {
    delete this._unstarredTooltip;
    return this._unstarredTooltip =
      gNavigatorBundle.getString("starButtonOff.tooltip");
  },

  updateState: function PSB_updateState()
  {
    if (this._uri && gBrowser.currentURI.equals(this._uri)) {
      return;
    }

    // Reset tracked values.
    this._uri = gBrowser.currentURI;
    this._itemIds = [];

    if (this._pendingStmt) {
      this._pendingStmt.cancel();
      delete this._pendingStmt;
    }

    this._pendingStmt = PlacesUtils.asyncGetBookmarkIds(this._uri, (aItemIds, aURI) => {
      // Safety check that the bookmarked URI equals the tracked one.
      if (!aURI.equals(this._uri)) {
        Components.utils.reportError("PlacesStarButton did not receive current URI");
        return;
      }

      // It's possible that onItemAdded gets called before the async statement
      // calls back.  For such an edge case, retain all unique entries from both
      // arrays.
      this._itemIds = this._itemIds.filter(
        id => aItemIds.indexOf(id) == -1
      ).concat(aItemIds);
      this._updateStateInternal();

      // Start observing bookmarks if needed.
      if (!this._hasBookmarksObserver) {
        try {
          PlacesUtils.bookmarks.addObserver(this, false);
          this._hasBookmarksObserver = true;
        } catch(ex) {
          Components.utils.reportError("PlacesStarButton failed adding a bookmarks observer: " + ex);
        }
      }

      delete this._pendingStmt;
    });
  },

  _updateStateInternal: function PSB__updateStateInternal()
  {
    let starIcon = document.getElementById("star-button");
    if (this._itemIds.length > 0) {
      starIcon.setAttribute("starred", "true");
      starIcon.setAttribute("tooltiptext", this._starredTooltip);
    }
    else {
      starIcon.removeAttribute("starred");
      starIcon.setAttribute("tooltiptext", this._unstarredTooltip);
    }
  },

  onClick: function PSB_onClick(aEvent)
  {
    // Ignore clicks on the star while we update its state.
    if (aEvent.button == 0 && !this._pendingStmt)
      PlacesCommandHook.bookmarkCurrentPage(this._itemIds.length > 0);
  },

  // nsINavBookmarkObserver
  onItemAdded:
  function PSB_onItemAdded(aItemId, aFolder, aIndex, aItemType, aURI)
  {
    if (aURI && aURI.equals(this._uri)) {
      // If a new bookmark has been added to the tracked uri, register it.
      if (this._itemIds.indexOf(aItemId) == -1) {
        this._itemIds.push(aItemId);
        this._updateStateInternal();
      }
    }
  },

  onItemRemoved:
  function PSB_onItemRemoved(aItemId, aFolder, aIndex, aItemType)
  {
    let index = this._itemIds.indexOf(aItemId);
    // If one of the tracked bookmarks has been removed, unregister it.
    if (index != -1) {
      this._itemIds.splice(index, 1);
      this._updateStateInternal();
    }
  },

  onItemChanged:
  function PSB_onItemChanged(aItemId, aProperty, aIsAnnotationProperty,
                             aNewValue, aLastModified, aItemType)
  {
    if (aProperty == "uri") {
      let index = this._itemIds.indexOf(aItemId);
      // If the changed bookmark was tracked, check if it is now pointing to
      // a different uri and unregister it.
      if (index != -1 && aNewValue != this._uri.spec) {
        this._itemIds.splice(index, 1);
        this._updateStateInternal();
      }
      // If another bookmark is now pointing to the tracked uri, register it.
      else if (index == -1 && aNewValue == this._uri.spec) {
        this._itemIds.push(aItemId);
        this._updateStateInternal();
      }
    }
  },

  onBeginUpdateBatch: function () {},
  onEndUpdateBatch: function () {},
  onItemVisited: function () {},
  onItemMoved: function () {}
};


// This object handles the initialization and uninitialization of the bookmarks
// toolbar.  updateState is called when the browser window is opened and
// after closing the toolbar customization dialog.
var PlacesToolbarHelper = {
  _place: "place:folder=TOOLBAR",
  get _viewElt() {
    return document.getElementById("PlacesToolbar");
  },

  init: function PTH_init() {
    let viewElt = this._viewElt;
    if (!viewElt || viewElt._placesView)
      return;

    // There is no need to initialize the toolbar if customizing because
    // init() will be called when the customization is done.
    if (this._isCustomizing)
      return;

    new PlacesToolbar(this._place);
  },

  customizeStart: function PTH_customizeStart() {
    let viewElt = this._viewElt;
    if (viewElt && viewElt._placesView)
      viewElt._placesView.uninit();

    this._isCustomizing = true;
  },

  customizeDone: function PTH_customizeDone() {
    this._isCustomizing = false;
    this.init();
  }
};


// Handles the bookmarks menu popup
var BookmarksMenu = {
  _popupInitialized: {},
  onPopupShowing: function BM_onPopupShowing(aEvent, aPrefix) {
    if (!(aPrefix in this._popupInitialized)) {
      // First popupshowing event, initialize immutable attributes.
      this._popupInitialized[aPrefix] = true;

      // Need to set the label on Unsorted Bookmarks menu.
      let unsortedBookmarksElt =
        document.getElementById(aPrefix + "unsortedBookmarksFolderMenu");
      unsortedBookmarksElt.label =
        PlacesUtils.getString("OtherBookmarksFolderTitle");
    }
  },
};

// Handles the bookmarks menu popup
function HistoryMenu(aPopupShowingEvent) {
  // Workaround for Bug 610187.  The sidebar does not include all the Places
  // views definitions, and we don't need them there.
  // Defining the prototype inheritance in the prototype itself would cause
  // browser.js to halt on "PlacesMenu is not defined" error.
  this.__proto__.__proto__ = PlacesMenu.prototype;
  PlacesMenu.call(this, aPopupShowingEvent, "place:queryType=0&sort=4&maxResults=15"); 
}

HistoryMenu.prototype = {};
