/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

// XXXmano: we should move most/all of these constants to PlacesUtils
const ORGANIZER_ROOT_BOOKMARKS = "place:folder=BOOKMARKS_MENU&excludeItems=1&queryType=1";

// No change to the view, preserve current selection
const RELOAD_ACTION_NOTHING = 0;
// Inserting items new to the view, select the inserted rows
const RELOAD_ACTION_INSERT = 1;
// Removing items from the view, select the first item after the last selected
const RELOAD_ACTION_REMOVE = 2;
// Moving items within a view, don't treat the dropped items as additional
// rows.
const RELOAD_ACTION_MOVE = 3;

// when removing a bunch of pages we split them in chunks to avoid passing
// a too big array to RemovePages
// 300 is the best choice with an history of about 150000 visits
// smaller chunks could cause a Slow Script warning with a huge history
const REMOVE_PAGES_CHUNKLEN = 300;
// if we are removing less than this pages we will remove them one by one
// since it will be reflected faster on the UI
// 10 is a good compromise, since allows the user to delete a little amount of
// urls for privacy reasons, but does not cause heavy disk access
const REMOVE_PAGES_MAX_SINGLEREMOVES = 10;

// XXX: should pull in from global definition, see bug 585500
var TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";

/**
 * Represents an insertion point within a container where we can insert
 * items.
 * @param   aItemId
 *          The identifier of the parent container
 * @param   aIndex
 *          The index within the container where we should insert
 * @param   aOrientation
 *          The orientation of the insertion. NOTE: the adjustments to the
 *          insertion point to accommodate the orientation should be done by
 *          the person who constructs the IP, not the user. The orientation
 *          is provided for informational purposes only!
 * @param   [optional] aIsTag
 *          Indicates if parent container is a tag
 * @param   [optional] aDropNearItemId
 *          When defined we will calculate index based on this itemId
 * @constructor
 */
function InsertionPoint(aItemId, aIndex, aOrientation, aIsTag,
                        aDropNearItemId) {
  this.itemId = aItemId;
  this._index = aIndex;
  this.orientation = aOrientation;
  this.isTag = aIsTag;
  this.dropNearItemId = aDropNearItemId;
}

InsertionPoint.prototype = {
  set index(val) {
    return this._index = val;
  },

  get index() {
    if (this.dropNearItemId > 0) {
      // If dropNearItemId is set up we must calculate the real index of
      // the item near which we will drop.
      var index = PlacesUtils.bookmarks.getItemIndex(this.dropNearItemId);
      return this.orientation == Components.interfaces.nsITreeView.DROP_BEFORE ? index : index + 1;
    }
    return this._index;
  }
};

/**
 * Places Controller
 */

function PlacesController(aView) {
  this._view = aView;
  XPCOMUtils.defineLazyServiceGetter(this, "clipboard",
                                     "@mozilla.org/widget/clipboard;1",
                                     "nsIClipboard");
  this._cachedLivemarkInfoObjects = new Map();
}

PlacesController.prototype = {
  /**
   * The places view.
   */
  _view: null,

  supportsCommand: function PC_supportsCommand(aCommand) {
    //LOG("supportsCommand: " + command);
    // Non-Places specific commands that we also support
    switch (aCommand) {
    case "cmd_undo":
    case "cmd_redo":
    case "cmd_cut":
    case "cmd_copy":
    case "cmd_paste":
    case "cmd_delete":
    case "cmd_selectAll":
      return true;
    }

    // All other Places Commands are prefixed with "placesCmd_" ... this
    // filters out other commands that we do _not_ support (see 329587).
    const CMD_PREFIX = "placesCmd_";
    return (aCommand.substr(0, CMD_PREFIX.length) == CMD_PREFIX);
  },

  isCommandEnabled: function PC_isCommandEnabled(aCommand) {
    switch (aCommand) {
    case "cmd_undo":
      return PlacesUtils.transactionManager.numberOfUndoItems > 0;
    case "cmd_redo":
      return PlacesUtils.transactionManager.numberOfRedoItems > 0;
    case "cmd_cut":
    case "placesCmd_cut":
    case "placesCmd_moveBookmarks":
      for (let node of this._view.selectedNodes) {
        // If selection includes history nodes or tags-as-bookmark,
        // disallow cutting.
        if (node.itemId == -1 ||
            (node.parent && PlacesUtils.nodeIsTagQuery(node.parent))) {
          return false;
        }
      }
      // Otherwise fall through the cmd_delete check.
    case "cmd_delete":
    case "placesCmd_delete":
    case "placesCmd_deleteDataHost":
      return this._hasRemovableSelection();
    case "cmd_copy":
    case "placesCmd_copy":
      return this._view.hasSelection;
    case "cmd_paste":
    case "placesCmd_paste":
      return this._canInsert(true) && this._isClipboardDataPasteable();
    case "cmd_selectAll":
      if (this._view.selType != "single") {
        let rootNode = this._view.result.root;
        if (rootNode.containerOpen && rootNode.childCount > 0)
          return true;
      }
      return false;
    case "placesCmd_open":
    case "placesCmd_open:tab":
    case "placesCmd_open:window":
    case "placesCmd_open:privatewindow":
      var selectedNode = this._view.selectedNode;
      return selectedNode && PlacesUtils.nodeIsURI(selectedNode);
    case "placesCmd_new:folder":
    case "placesCmd_new:livemark":
      return this._canInsert();
    case "placesCmd_new:bookmark":
      return this._canInsert();
    case "placesCmd_new:separator":
      return this._canInsert() &&
             !PlacesUtils.asQuery(this._view.result.root).queryOptions.excludeItems &&
             this._view.result.sortingMode ==
                 Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_NONE;
    case "placesCmd_show:info":
      var selectedNode = this._view.selectedNode;
      return selectedNode && PlacesUtils.getConcreteItemId(selectedNode) != -1;
    case "placesCmd_reload":
      // Livemark containers
      var selectedNode = this._view.selectedNode;
      return selectedNode && this.hasCachedLivemarkInfo(selectedNode);
    case "placesCmd_sortBy:name":
      var selectedNode = this._view.selectedNode;
      return selectedNode &&
             PlacesUtils.nodeIsFolder(selectedNode) &&
             !PlacesUIUtils.isContentsReadOnly(selectedNode) &&
             this._view.result.sortingMode ==
                 Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_NONE;
    case "placesCmd_createBookmark":
      var node = this._view.selectedNode;
      return node && PlacesUtils.nodeIsURI(node) && node.itemId == -1;
    default:
      return false;
    }
  },

  doCommand: function PC_doCommand(aCommand) {
    switch (aCommand) {
    case "cmd_undo":
      PlacesUtils.transactionManager.undoTransaction();
      break;
    case "cmd_redo":
      PlacesUtils.transactionManager.redoTransaction();
      break;
    case "cmd_cut":
    case "placesCmd_cut":
      this.cut();
      break;
    case "cmd_copy":
    case "placesCmd_copy":
      this.copy();
      break;
    case "cmd_paste":
    case "placesCmd_paste":
      this.paste();
      break;
    case "cmd_delete":
    case "placesCmd_delete":
      this.remove("Remove Selection");
      break;
    case "placesCmd_deleteDataHost":
      var host;
      if (PlacesUtils.nodeIsHost(this._view.selectedNode)) {
        var queries = this._view.selectedNode.getQueries();
        host = queries[0].domain;
      }
      else
        host = PlacesUtils._uri(this._view.selectedNode.uri).host;
      break;
    case "cmd_selectAll":
      this.selectAll();
      break;
    case "placesCmd_open":
      PlacesUIUtils.openNodeIn(this._view.selectedNode, "current");
      break;
    case "placesCmd_open:tab":
      PlacesUIUtils.openNodeIn(this._view.selectedNode, "tab");
      break;
    case "placesCmd_open:window":
      PlacesUIUtils.openNodeIn(this._view.selectedNode, "window");
      break;
    case "placesCmd_open:privatewindow":
      PlacesUIUtils.openNodeIn(this._view.selectedNode, "private");
      break;
    case "placesCmd_new:folder":
      this.newItem("folder");
      break;
    case "placesCmd_new:bookmark":
      this.newItem("bookmark");
      break;
    case "placesCmd_new:livemark":
      this.newItem("livemark");
      break;
    case "placesCmd_new:separator":
      this.newSeparator();
      break;
    case "placesCmd_show:info":
      var dds = document.getElementById("detailsDeck-splitter");
      if (dds) {
        dds.removeAttribute("state");
        document.getElementById("editBMPanel_namePicker").focus();
      } else {
        this.showBookmarkPropertiesForSelection();
      }
      break;
    case "placesCmd_moveBookmarks":
      this.moveSelectedBookmarks();
      break;
    case "placesCmd_reload":
      this.reloadSelectedLivemark();
      break;
    case "placesCmd_sortBy:name":
      this.sortFolderByName();
      break;
    case "placesCmd_createBookmark":
      var node = this._view.selectedNode;
      PlacesUIUtils.showMinimalAddBookmarkUI(PlacesUtils._uri(node.uri), node.title);
      break;
    }
  },

  onEvent: function PC_onEvent(eventName) { },

  /**
   * Determine whether or not the selection can be removed, either by the
   * delete or cut operations based on whether or not any of its contents
   * are non-removable. We don't need to worry about recursion here since it
   * is a policy decision that a removable item not be placed inside a non-
   * removable item.
   *
   * @returns true if all nodes in the selection can be removed,
   *          false otherwise.
   */
  _hasRemovableSelection() {
    var ranges = this._view.removableSelectionRanges;
    if (!ranges.length)
      return false;

    var root = this._view.result.root;

    for (var j = 0; j < ranges.length; j++) {
      var nodes = ranges[j];
      for (var i = 0; i < nodes.length; ++i) {
        // Disallow removing the view's root node
        if (nodes[i] == root)
          return false;

        if (!PlacesUIUtils.canUserRemove(nodes[i]))
          return false;
      }
    }

    return true;
  },

  /**
   * Determines whether or not nodes can be inserted relative to the selection.
   */
  _canInsert: function PC__canInsert(isPaste) {
    var ip = this._view.insertionPoint;
    return ip != null && (isPaste || ip.isTag != true);
  },

  /**
   * Determines whether or not the root node for the view is selected
   */
  rootNodeIsSelected: function PC_rootNodeIsSelected() {
    var nodes = this._view.selectedNodes;
    var root = this._view.result.root;
    for (var i = 0; i < nodes.length; ++i) {
      if (nodes[i] == root)
        return true;
    }

    return false;
  },

  /**
   * Looks at the data on the clipboard to see if it is paste-able.
   * Paste-able data is:
   *   - in a format that the view can receive
   * @returns true if: - clipboard data is of a TYPE_X_MOZ_PLACE_* flavor,
                       - clipboard data is of type TEXT_UNICODE and
                         is a valid URI.
   */
  _isClipboardDataPasteable: function PC__isClipboardDataPasteable() {
    // if the clipboard contains TYPE_X_MOZ_PLACE_* data, it is definitely
    // pasteable, with no need to unwrap all the nodes.

    var flavors = PlacesControllerDragHelper.placesFlavors;
    var clipboard = this.clipboard;
    var hasPlacesData =
      clipboard.hasDataMatchingFlavors(flavors, flavors.length,
                                       Components.interfaces.nsIClipboard.kGlobalClipboard);
    if (hasPlacesData)
      return this._view.insertionPoint != null;

    // if the clipboard doesn't have TYPE_X_MOZ_PLACE_* data, we also allow
    // pasting of valid "text/unicode" and "text/x-moz-url" data
    var xferable = Components.classes["@mozilla.org/widget/transferable;1"]
                             .createInstance(Components.interfaces.nsITransferable);

    xferable.init(null);
    xferable.addDataFlavor(PlacesUtils.TYPE_X_MOZ_URL);
    xferable.addDataFlavor(PlacesUtils.TYPE_UNICODE);
    clipboard.getData(xferable, Components.interfaces.nsIClipboard.kGlobalClipboard);

    try {
      // getAnyTransferData will throw if no data is available.
      var data = { }, type = { };
      xferable.getAnyTransferData(type, data, { });
      data = data.value.QueryInterface(Components.interfaces.nsISupportsString).data;
      if (type.value != PlacesUtils.TYPE_X_MOZ_URL &&
          type.value != PlacesUtils.TYPE_UNICODE)
        return false;

      // unwrapNodes() will throw if the data blob is malformed.
      var unwrappedNodes = PlacesUtils.unwrapNodes(data, type.value);
      return this._view.insertionPoint != null;
    }
    catch (e) {
      // getAnyTransferData or unwrapNodes failed
      return false;
    }
  },

  /**
   * Gathers information about the selected nodes according to the following
   * rules:
   *    "link"              node is a URI
   *    "bookmark"          node is a bookamrk
   *    "livemarkChild"     node is a child of a livemark
   *    "tagChild"          node is a child of a tag
   *    "folder"            node is a folder
   *    "query"             node is a query
   *    "separator"         node is a separator line
   *    "host"              node is a host
   *
   * @returns an array of objects corresponding the selected nodes. Each
   *          object has each of the properties above set if its corresponding
   *          node matches the rule. In addition, the annotations names for each
   *          node are set on its corresponding object as properties.
   * Notes:
   *   1) This can be slow, so don't call it anywhere performance critical!
   *   2) A single-object array corresponding the root node is returned if
   *      there's no selection.
   */
  _buildSelectionMetadata: function PC__buildSelectionMetadata() {
    var metadata = [];
    var root = this._view.result.root;
    var nodes = this._view.selectedNodes;
    if (nodes.length == 0)
      nodes.push(root); // See the second note above

    for (var i = 0; i < nodes.length; i++) {
      var nodeData = {};
      var node = nodes[i];
      var nodeType = node.type;
      var uri = null;

      // We don't use the nodeIs* methods here to avoid going through the type
      // property way too often
      switch (nodeType) {
        case Components.interfaces.nsINavHistoryResultNode.RESULT_TYPE_QUERY:
          nodeData["query"] = true;
          if (node.parent) {
            switch (PlacesUtils.asQuery(node.parent).queryOptions.resultType) {
              case Components.interfaces.nsINavHistoryQueryOptions.RESULTS_AS_SITE_QUERY:
                nodeData["host"] = true;
                break;
              case Components.interfaces.nsINavHistoryQueryOptions.RESULTS_AS_DATE_SITE_QUERY:
              case Components.interfaces.nsINavHistoryQueryOptions.RESULTS_AS_DATE_QUERY:
                nodeData["day"] = true;
                break;
            }
          }
          break;
        case Components.interfaces.nsINavHistoryResultNode.RESULT_TYPE_FOLDER:
        case Components.interfaces.nsINavHistoryResultNode.RESULT_TYPE_FOLDER_SHORTCUT:
          nodeData["folder"] = true;
          break;
        case Components.interfaces.nsINavHistoryResultNode.RESULT_TYPE_SEPARATOR:
          nodeData["separator"] = true;
          break;
        case Components.interfaces.nsINavHistoryResultNode.RESULT_TYPE_URI:
          nodeData["link"] = true;
          uri = PlacesUtils._uri(node.uri);
          if (PlacesUtils.nodeIsBookmark(node)) {
            nodeData["bookmark"] = true;
            PlacesUtils.nodeIsTagQuery(node.parent)

            var parentNode = node.parent;
            if (parentNode) {
              if (PlacesUtils.nodeIsTagQuery(parentNode))
                nodeData["tagChild"] = true;
              else if (this.hasCachedLivemarkInfo(parentNode))
                nodeData["livemarkChild"] = true;
            }
          }
          break;
      }

      // annotations
      if (uri) {
        let names = PlacesUtils.annotations.getPageAnnotationNames(uri);
        for (let j = 0; j < names.length; ++j)
          nodeData[names[j]] = true;
      }

      // For items also include the item-specific annotations
      if (node.itemId != -1) {
        let names = PlacesUtils.annotations
                               .getItemAnnotationNames(node.itemId);
        for (let j = 0; j < names.length; ++j)
          nodeData[names[j]] = true;
      }
      metadata.push(nodeData);
    }

    return metadata;
  },

  /**
   * Determines if a context-menu item should be shown
   * @param   aMenuItem
   *          the context menu item
   * @param   aMetaData
   *          meta data about the selection
   * @returns true if the conditions (see buildContextMenu) are satisfied
   *          and the item can be displayed, false otherwise.
   */
  _shouldShowMenuItem: function PC__shouldShowMenuItem(aMenuItem, aMetaData) {
    var selectiontype = aMenuItem.getAttribute("selectiontype");
    if (selectiontype == "multiple" && aMetaData.length == 1)
      return false;
    if (selectiontype == "single" && aMetaData.length != 1)
      return false;

    var forceHideAttr = aMenuItem.getAttribute("forcehideselection");
    if (forceHideAttr) {
      var forceHideRules = forceHideAttr.split("|");
      for (let i = 0; i < aMetaData.length; ++i) {
        for (let j = 0; j < forceHideRules.length; ++j) {
          if (forceHideRules[j] in aMetaData[i])
            return false;
        }
      }
    }

    var selectionAttr = aMenuItem.getAttribute("selection");
    if (selectionAttr) {
      if (selectionAttr == "any")
        return true;

      var showRules = selectionAttr.split("|");
      var anyMatched = false;
      function metaDataNodeMatches(metaDataNode, rules) {
        for (var i=0; i < rules.length; i++) {
          if (rules[i] in metaDataNode)
            return true;
        }

        return false;
      }
      for (var i = 0; i < aMetaData.length; ++i) {
        if (metaDataNodeMatches(aMetaData[i], showRules))
          anyMatched = true;
        else
          return false;
      }
      return anyMatched;
    }

    return !aMenuItem.hidden;
  },

  /**
   * Detects information (meta-data rules) about the current selection in the
   * view (see _buildSelectionMetadata) and sets the visibility state for each
   * of the menu-items in the given popup with the following rules applied:
   *  1) The "selectiontype" attribute may be set on a menu-item to "single"
   *     if the menu-item should be visible only if there is a single node
   *     selected, or to "multiple" if the menu-item should be visible only if
   *     multiple nodes are selected. If the attribute is not set or if it is
   *     set to an invalid value, the menu-item may be visible for both types of
   *     selection.
   *  2) The "selection" attribute may be set on a menu-item to the various
   *     meta-data rules for which it may be visible. The rules should be
   *     separated with the | character.
   *  3) A menu-item may be visible only if at least one of the rules set in
   *     its selection attribute apply to each of the selected nodes in the
   *     view.
   *  4) The "forcehideselection" attribute may be set on a menu-item to rules
   *     for which it should be hidden. This attribute takes priority over the
   *     selection attribute. A menu-item would be hidden if at least one of the
   *     given rules apply to one of the selected nodes. The rules should be
   *     separated with the | character.
   *  5) The "hideifnoinsertionpoint" attribute may be set on a menu-item to
   *     true if it should be hidden when there's no insertion point
   *  6) The "hideifprivatebrowsing" attribute may be set on a menu-item to
   *     true if it should be hidden in a private window
   *  7) The visibility state of a menu-item is unchanged if none of these
   *     attribute are set.
   *  8) These attributes should not be set on separators for which the
   *     visibility state is "auto-detected."
   * @param   aPopup
   *          The menupopup to build children into.
   * @return true if at least one item is visible, false otherwise.
   */
  buildContextMenu: function PC_buildContextMenu(aPopup) {
    var metadata = this._buildSelectionMetadata();
    var ip = this._view.insertionPoint;
    var noIp = !ip || ip.isTag;

    var separator = null;
    var visibleItemsBeforeSep = false;
    var anyVisible = false;
    for (var i = 0; i < aPopup.childNodes.length; ++i) {
      var item = aPopup.childNodes[i];
      if (item.localName != "menuseparator") {
        // We allow pasting into tag containers, so special case that.
        var hideIfNoIP = item.hasAttribute("hideifnoinsertionpoint") &&
                         noIp && !(ip && ip.isTag && item.id == "placesContext_paste");
        var hideIfPrivate = item.hasAttribute("hideifprivatebrowsing") && top.gPrivate;
        item.hidden = hideIfNoIP || hideIfPrivate ||
                      !this._shouldShowMenuItem(item, metadata);

        if (!item.hidden) {
          visibleItemsBeforeSep = true;
          anyVisible = true;

          // Show the separator above the menu-item if any
          if (separator) {
            separator.hidden = false;
            separator = null;
          }
        }
      }
      else { // menuseparator
        // Initially hide it. It will be unhidden if there will be at least one
        // visible menu-item above and below it.
        item.hidden = true;

        // We won't show the separator at all if no items are visible above it
        if (visibleItemsBeforeSep)
          separator = item;

        // New separator, count again:
        visibleItemsBeforeSep = false;
      }
    }

    // Set Open Folder/Links In Tabs items enabled state if they're visible
    if (anyVisible) {
      var openContainerInTabsItem = document.getElementById("placesContext_openContainer:tabs");
      if (!openContainerInTabsItem.hidden && this._view.selectedNode &&
          PlacesUtils.nodeIsContainer(this._view.selectedNode)) {
        openContainerInTabsItem.disabled =
          !PlacesUtils.hasChildURIs(this._view.selectedNode);
      }
      else {
        // see selectiontype rule in the overlay
        var openLinksInTabsItem = document.getElementById("placesContext_openLinks:tabs");
        openLinksInTabsItem.disabled = openLinksInTabsItem.hidden;
      }
    }

    return anyVisible;
  },

  /**
   * Select all links in the current view.
   */
  selectAll: function PC_selectAll() {
    this._view.selectAll();
  },

  /**
   * Opens the bookmark properties for the selected URI Node.
   */
  showBookmarkPropertiesForSelection:
  function PC_showBookmarkPropertiesForSelection() {
    var node = this._view.selectedNode;
    if (!node)
      return;

    var itemType = PlacesUtils.nodeIsFolder(node) ||
                   PlacesUtils.nodeIsTagQuery(node) ? "folder" : "bookmark";
    var concreteId = PlacesUtils.getConcreteItemId(node);
    var isRootItem = PlacesUtils.isRootItem(concreteId);
    var itemId = node.itemId;
    if (isRootItem || PlacesUtils.nodeIsTagQuery(node)) {
      // If this is a root or the Tags query we use the concrete itemId to catch
      // the correct title for the node.
      itemId = concreteId;
    }

    PlacesUIUtils.showItemProperties(itemId, itemType,
                                     isRootItem /* read only */);
  },

  /**
   * This method can be run on a URI parameter to ensure that it didn't
   * receive a string instead of an nsIURI object.
   */
  _assertURINotString: function PC__assertURINotString(value) {
    NS_ASSERT((typeof(value) == "object") && !(value instanceof String),
           "This method should be passed a URI as a nsIURI object, not as a string.");
  },

  /**
   * Reloads the selected livemark if any.
   */
  reloadSelectedLivemark: function PC_reloadSelectedLivemark() {
    var selectedNode = this._view.selectedNode;
    if (selectedNode)
      PlacesUtils.livemarks.getLivemark({ id: selectedNode.itemId })
                           .then(aLivemark => aLivemark.reload(true));
  },

  /**
   * Gives the user a chance to cancel loading lots of tabs at once
   */
  _confirmOpenTabs: function(numTabsToOpen) {
    const kWarnOnOpenPref = "browser.tabs.warnOnOpen";
    var reallyOpen = true;
    if (Services.prefs.getBoolPref(kWarnOnOpenPref)) {
      if (numTabsToOpen >= Services.prefs.getIntPref("browser.tabs.maxOpenBeforeWarn")) {
        var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                      .getService(Components.interfaces.nsIPromptService);

        // default to true: if it were false, we wouldn't get this far
        var warnOnOpen = { value: true };

        var messageKey = "tabs.openWarningMultipleBranded";
        var openKey = "tabs.openButtonMultiple";
        const BRANDING_BUNDLE_URI = "chrome://branding/locale/brand.properties";
        var brandShortName = Components.classes["@mozilla.org/intl/stringbundle;1"]
                                       .getService(Components.interfaces.nsIStringBundleService)
                                       .createBundle(BRANDING_BUNDLE_URI)
                                       .GetStringFromName("brandShortName");

        var buttonPressed = promptService.confirmEx(window,
          PlacesUIUtils.getString("tabs.openWarningTitle"),
          PlacesUIUtils.getFormattedString(messageKey,
            [numTabsToOpen, brandShortName]),
          (promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_0)
          + (promptService.BUTTON_TITLE_CANCEL * promptService.BUTTON_POS_1),
          PlacesUIUtils.getString(openKey),
          null, null,
          PlacesUIUtils.getFormattedString("tabs.openWarningPromptMeBranded",
            [brandShortName]),
          warnOnOpen);

         reallyOpen = (buttonPressed == 0);
         // don't set the pref unless they press OK and it's false
         if (reallyOpen && !warnOnOpen.value)
           Services.prefs.setBoolPref(kWarnOnOpenPref, false);
      }
    }
    return reallyOpen;
  },

  /**
   * Opens the links in the selected folder, or the selected links in new tabs.
   */
  openSelectionInTabs: function PC_openLinksInTabs(aEvent) {
    var node = this._view.selectedNode;
    if (node && PlacesUtils.nodeIsContainer(node))
      PlacesUIUtils.openContainerNodeInTabs(this._view.selectedNode, aEvent);
    else
      PlacesUIUtils.openURINodesInTabs(this._view.selectedNodes, aEvent);
  },

  /**
   * Shows the Add Bookmark UI for the current insertion point.
   *
   * @param aType
   *        the type of the new item (bookmark/livemark/folder)
   */
  newItem: function PC_newItem(aType) {
    var ip = this._view.insertionPoint;
    if (!ip)
      throw Components.results.NS_ERROR_NOT_AVAILABLE;

    var performed = false;
    if (aType == "bookmark")
      performed = PlacesUIUtils.showAddBookmarkUI(null, null, null, ip);
    else if (aType == "livemark")
      performed = PlacesUIUtils.showAddLivemarkUI(null, null, null, null, ip);
    else // folder
      performed = PlacesUIUtils.showAddFolderUI(null, ip);

    if (performed) {
      // select the new item
      var insertedNodeId = PlacesUtils.bookmarks
                                      .getIdForItemAt(ip.itemId, ip.index);
      this._view.selectItems([insertedNodeId], false);
    }
  },


  /**
   * Create a new Bookmark folder somewhere. Prompts the user for the name
   * of the folder.
   */
  newFolder: function PC_newFolder() {
    var ip = this._view.insertionPoint;
    if (!ip)
      throw Components.results.NS_ERROR_NOT_AVAILABLE;

    var performed = false;
    performed = PlacesUIUtils.showAddFolderUI(null, ip);
    if (performed) {
      // select the new item
      var insertedNodeId = PlacesUtils.bookmarks
                                      .getIdForItemAt(ip.itemId, ip.index);
      this._view.selectItems([insertedNodeId], false);
    }
  },

  /**
   * Create a new Bookmark separator somewhere.
   */
  newSeparator: function PC_newSeparator() {
    var ip = this._view.insertionPoint;
    if (!ip)
      throw Components.results.NS_ERROR_NOT_AVAILABLE;
    var txn = new PlacesCreateSeparatorTransaction(ip.itemId, ip.index);
    PlacesUtils.transactionManager.doTransaction(txn);
    // select the new item
    var insertedNodeId = PlacesUtils.bookmarks
                                    .getIdForItemAt(ip.itemId, ip.index);
    this._view.selectItems([insertedNodeId], false);
  },

  /**
   * Opens a dialog for moving the selected nodes.
   */
  moveSelectedBookmarks: function PC_moveBookmarks() {
    window.openDialog("chrome://communicator/content/bookmarks/moveBookmarks.xul",
                      "", "chrome,modal,resizable=yes",
                      this._view.selectedNodes);
  },

  /**
   * Sort the selected folder by name
   */
  sortFolderByName: function PC_sortFolderByName() {
    var itemId = PlacesUtils.getConcreteItemId(this._view.selectedNode);
    var txn = new PlacesSortFolderByNameTransaction(itemId);
    PlacesUtils.transactionManager.doTransaction(txn);
  },

  /**
   * Walk the list of folders we're removing in this delete operation, and
   * see if the selected node specified is already implicitly being removed
   * because it is a child of that folder.
   * @param   node
   *          Node to check for containment.
   * @param   pastFolders
   *          List of folders the calling function has already traversed
   * @returns true if the node should be skipped, false otherwise.
   */
  _shouldSkipNode: function PC_shouldSkipNode(node, pastFolders) {
    /**
     * Determines if a node is contained by another node within a resultset.
     * @param   node
     *          The node to check for containment for
     * @param   parent
     *          The parent container to check for containment in
     * @returns true if node is a member of parent's children, false otherwise.
     */
    function isContainedBy(node, parent) {
      var cursor = node.parent;
      while (cursor) {
        if (cursor == parent)
          return true;
        cursor = cursor.parent;
      }
      return false;
    }

      for (var j = 0; j < pastFolders.length; ++j) {
        if (isContainedBy(node, pastFolders[j]))
          return true;
      }
      return false;
  },

  /**
   * Creates a set of transactions for the removal of a range of items.
   * A range is an array of adjacent nodes in a view.
   * @param   [in] range
   *          An array of nodes to remove. Should all be adjacent.
   * @param   [out] transactions
   *          An array of transactions.
   * @param   [optional] removedFolders
   *          An array of folder nodes that have already been removed.
   */
  _removeRange: function PC__removeRange(range, transactions, removedFolders) {
    NS_ASSERT(transactions instanceof Array, "Must pass a transactions array");
    if (!removedFolders)
      removedFolders = [];

    for (var i = 0; i < range.length; ++i) {
      var node = range[i];
      if (this._shouldSkipNode(node, removedFolders))
        continue;

      if (PlacesUtils.nodeIsTagQuery(node.parent)) {
        // This is a uri node inside a tag container.  It needs a special
        // untag transaction.
        var tagItemId = PlacesUtils.getConcreteItemId(node.parent);
        var uri = PlacesUtils._uri(node.uri);
        let txn = new PlacesUntagURITransaction(uri, [tagItemId]);
        transactions.push(txn);
      }
      else if (PlacesUtils.nodeIsTagQuery(node) && node.parent &&
               PlacesUtils.nodeIsQuery(node.parent) &&
               PlacesUtils.asQuery(node.parent).queryOptions.resultType ==
                 Components.interfaces.nsINavHistoryQueryOptions.RESULTS_AS_TAG_QUERY) {
        // This is a tag container.
        // Untag all URIs tagged with this tag only if the tag container is
        // child of the "Tags" query in the library, in all other places we
        // must only remove the query node.
        var tag = node.title;
        var URIs = PlacesUtils.tagging.getURIsForTag(tag);
        for (var j = 0; j < URIs.length; j++) {
          let txn = new PlacesUntagURITransaction(URIs[j], [tag]);
          transactions.push(txn);
        }
      }
      else if (PlacesUtils.nodeIsURI(node) &&
               PlacesUtils.nodeIsQuery(node.parent) &&
               PlacesUtils.asQuery(node.parent).queryOptions.queryType ==
                 Components.interfaces.nsINavHistoryQueryOptions.QUERY_TYPE_HISTORY) {
        // This is a uri node inside an history query.
        var bhist = PlacesUtils.history.QueryInterface(Components.interfaces.nsIBrowserHistory);
        bhist.removePage(PlacesUtils._uri(node.uri));
        // History deletes are not undoable, so we don't have a transaction.
      }
      else if (node.itemId == -1 &&
               PlacesUtils.nodeIsQuery(node) &&
               PlacesUtils.asQuery(node).queryOptions.queryType ==
                 Components.interfaces.nsINavHistoryQueryOptions.QUERY_TYPE_HISTORY) {
        // This is a dynamically generated history query, like queries
        // grouped by site, time or both.  Dynamically generated queries don't
        // have an itemId even if they are descendants of a bookmark.
        this._removeHistoryContainer(node);
        // History deletes are not undoable, so we don't have a transaction.
      }
      else {
        // This is a common bookmark item.
        if (PlacesUtils.nodeIsFolder(node)) {
          // If this is a folder we add it to our array of folders, used
          // to skip nodes that are children of an already removed folder.
          removedFolders.push(node);
        }
        let txn = new PlacesRemoveItemTransaction(node.itemId);
        transactions.push(txn);
      }
    }
  },

  /**
   * Removes the set of selected ranges from bookmarks.
   * @param   txnName
   *          See |remove|.
   */
  _removeRowsFromBookmarks: function PC__removeRowsFromBookmarks(txnName) {
    var ranges = this._view.removableSelectionRanges;
    var transactions = [];
    var removedFolders = [];

    for (var i = 0; i < ranges.length; i++)
      this._removeRange(ranges[i], transactions, removedFolders);

    if (transactions.length > 0) {
      var txn = new PlacesAggregatedTransaction(txnName, transactions);
      PlacesUtils.transactionManager.doTransaction(txn);
    }
  },

  /**
   * Removes the set of selected ranges from history.
   */
  _removeRowsFromHistory: function PC__removeRowsFromHistory() {
    // Other containers are history queries, just delete from history
    // history deletes are not undoable.
    var nodes = this._view.selectedNodes;
    var URIs = [];
    var bhist = PlacesUtils.history.QueryInterface(Components.interfaces.nsIBrowserHistory);
    var root = this._view.result.root;

    for (var i = 0; i < nodes.length; ++i) {
      var node = nodes[i];
      if (PlacesUtils.nodeIsURI(node)) {
        var uri = PlacesUtils._uri(node.uri);
        // avoid trying to delete the same url twice
        if (URIs.indexOf(uri) < 0) {
          URIs.push(uri);
        }
      }
      else if (PlacesUtils.nodeIsQuery(node) &&
               PlacesUtils.asQuery(node).queryOptions.queryType ==
                 Components.interfaces.nsINavHistoryQueryOptions.QUERY_TYPE_HISTORY)
        this._removeHistoryContainer(node);
    }

    // if we have to delete a lot of urls RemovePage will be slow, it's better
    // to delete them in bunch and rebuild the full treeView
    if (URIs.length > REMOVE_PAGES_MAX_SINGLEREMOVES) {
      // do removal in chunks to avoid passing a too big array to removePages
      for (var i = 0; i < URIs.length; i += REMOVE_PAGES_CHUNKLEN) {
        var URIslice = URIs.slice(i, i + REMOVE_PAGES_CHUNKLEN);
        // set DoBatchNotify (third param) only on the last chunk, so we update
        // the treeView when we are done.
        bhist.removePages(URIslice, URIslice.length,
                          (i + REMOVE_PAGES_CHUNKLEN) >= URIs.length);
      }
    }
    else {
      // if we have to delete fewer urls, removepage will allow us to avoid
      // rebuilding the full treeView
      for (var i = 0; i < URIs.length; ++i)
        bhist.removePage(URIs[i]);
    }
  },

  /**
   * Removes history visits for an history container node.
   * @param   [in] aContainerNode
   *          The container node to remove.
   */
  _removeHistoryContainer: function PC_removeHistoryContainer(aContainerNode) {
    var bhist = PlacesUtils.history.QueryInterface(Components.interfaces.nsIBrowserHistory);
    if (PlacesUtils.nodeIsHost(aContainerNode)) {
      // Site container.
      bhist.removePagesFromHost(aContainerNode.title, true);
    }
    else if (PlacesUtils.nodeIsDay(aContainerNode)) {
      // Day container.
      var query = aContainerNode.getQueries()[0];
      var beginTime = query.beginTime;
      var endTime = query.endTime;
      NS_ASSERT(query && beginTime && endTime,
                "A valid date container query should exist!");
      // We want to exclude beginTime from the removal because
      // removePagesByTimeframe includes both extremes, while date containers
      // exclude the lower extreme.  So, if we would not exclude it, we would
      // end up removing more history than requested.
      bhist.removePagesByTimeframe(beginTime+1, endTime);
    }
  },

  /**
   * Removes the selection
   * @param   aTxnName
   *          A name for the transaction if this is being performed
   *          as part of another operation.
   */
  remove: function PC_remove(aTxnName) {
    if (!this._hasRemovableSelection())
      return;

    NS_ASSERT(aTxnName !== undefined, "Must supply Transaction Name");

    var root = this._view.result.root;

    if (PlacesUtils.nodeIsFolder(root))
      this._removeRowsFromBookmarks(aTxnName);
    else if (PlacesUtils.nodeIsQuery(root)) {
      var queryType = PlacesUtils.asQuery(root).queryOptions.queryType;
      if (queryType == Components.interfaces.nsINavHistoryQueryOptions.QUERY_TYPE_BOOKMARKS)
        this._removeRowsFromBookmarks(aTxnName);
      else if (queryType == Components.interfaces.nsINavHistoryQueryOptions.QUERY_TYPE_HISTORY)
        this._removeRowsFromHistory();
      else
        NS_ASSERT(false, "implement support for QUERY_TYPE_UNIFIED");
    }
    else
      NS_ASSERT(false, "unexpected root");
  },

  /**
   * Fills a DataTransfer object with the content of the selection that can be
   * dropped elsewhere.
   * @param   aEvent
   *          The dragstart event.
   */
  setDataTransfer: function PC_setDataTransfer(aEvent) {
    let dt = aEvent.dataTransfer;
    let doCopy = ["copyLink", "copy", "link"].indexOf(dt.effectAllowed) != -1;

    let result = this._view.result;
    let didSuppressNotifications = result.suppressNotifications;
    if (!didSuppressNotifications)
      result.suppressNotifications = true;

    try {
      let nodes = this._view.draggableSelection;
      for (let i = 0; i < nodes.length; ++i) {
        var node = nodes[i];

        function addData(type, index, overrideURI) {
          let wrapNode = PlacesUtils.wrapNode(node, type, overrideURI, doCopy);
          dt.mozSetDataAt(type, wrapNode, index);
        }

        function addURIData(index, overrideURI) {
          addData(PlacesUtils.TYPE_X_MOZ_URL, index, overrideURI);
          addData(PlacesUtils.TYPE_UNICODE, index, overrideURI);
          addData(PlacesUtils.TYPE_HTML, index, overrideURI);
        }

        // This order is _important_! It controls how this and other
        // applications select data to be inserted based on type.
        addData(PlacesUtils.TYPE_X_MOZ_PLACE, i);

        // Drop the feed uri for livemark containers
        let livemarkInfo = this.getCachedLivemarkInfo(node);
        if (livemarkInfo)
          addURIData(i, livemarkInfo.feedURI.spec);
        else if (node.uri)
          addURIData(i);
      }
    }
    finally {
      if (!didSuppressNotifications)
        result.suppressNotifications = false;
    }
  },

  /**
   * Copy Bookmarks and Folders to the clipboard
   */
  copy: function PC_copy() {
    let result = this._view.result;

    let didSuppressNotifications = result.suppressNotifications;
    if (!didSuppressNotifications)
      result.suppressNotifications = true;

    try {
      let nodes = this._view.selectedNodes;

      let xferable = Components.classes["@mozilla.org/widget/transferable;1"]
                               .createInstance(Components.interfaces.nsITransferable);
      xferable.init(null);
      let foundFolder = false, foundLink = false;
      let copiedFolders = [];
      let placeString, mozURLString, htmlString, unicodeString;
      placeString = mozURLString = htmlString = unicodeString = "";

      for (let i = 0; i < nodes.length; ++i) {
        let node = nodes[i];
        if (this._shouldSkipNode(node, copiedFolders))
          continue;
        if (PlacesUtils.nodeIsFolder(node))
          copiedFolders.push(node);

        let self = this;
        function generateChunk(type, overrideURI) {
          let suffix = i < (nodes.length - 1) ? PlacesUtils.endl : "";
          let uri = overrideURI;

          let livemarkInfo = self.getCachedLivemarkInfo(node);
          if (livemarkInfo)
            uri = livemarkInfo.feedURI.spec;

          mozURLString += (PlacesUtils.wrapNode(node, PlacesUtils.TYPE_X_MOZ_URL,
                                                 uri) + suffix);
          unicodeString += (PlacesUtils.wrapNode(node, PlacesUtils.TYPE_UNICODE,
                                                 uri) + suffix);
          htmlString += (PlacesUtils.wrapNode(node, PlacesUtils.TYPE_HTML,
                                                 uri) + suffix);

          let placeSuffix = i < (nodes.length - 1) ? "," : "";
          let resolveShortcuts = !PlacesControllerDragHelper.canMoveNode(node);
          return PlacesUtils.wrapNode(node, type, overrideURI, resolveShortcuts) + placeSuffix;
        }

        // all items wrapped as TYPE_X_MOZ_PLACE
        placeString += generateChunk(PlacesUtils.TYPE_X_MOZ_PLACE);
      }

      function addData(type, data) {
        xferable.addDataFlavor(type);
        xferable.setTransferData(type, PlacesUIUtils._wrapString(data), data.length * 2);
      }
      // This order is _important_! It controls how this and other applications
      // select data to be inserted based on type.
      if (placeString)
        addData(PlacesUtils.TYPE_X_MOZ_PLACE, placeString);
      if (mozURLString)
        addData(PlacesUtils.TYPE_X_MOZ_URL, mozURLString);
      if (unicodeString)
        addData(PlacesUtils.TYPE_UNICODE, unicodeString);
      if (htmlString)
        addData(PlacesUtils.TYPE_HTML, htmlString);

      if (placeString || unicodeString || htmlString || mozURLString) {
        this.clipboard.setData(xferable, null,
                               Components.interfaces.nsIClipboard.kGlobalClipboard);
      }
    }
    finally {
      if (!didSuppressNotifications)
        result.suppressNotifications = false;
    }
  },

  /**
   * Cut Bookmarks and Folders to the clipboard
   */
  cut: function PC_cut() {
    this.copy();
    this.remove("Cut Selection");
  },

  /**
   * Paste Bookmarks and Folders from the clipboard
   */
  paste: function PC_paste() {
    // Strategy:
    //
    // There can be data of various types (folder, separator, link) on the
    // clipboard. We need to get all of that data and build edit transactions
    // for them. This means asking the clipboard once for each type and
    // aggregating the results.

    /**
     * Constructs a transferable that can receive data of specific types.
     * @param   types
     *          The types of data the transferable can hold, in order of
     *          preference.
     * @returns The transferable.
     */
    function makeXferable(types) {
      var xferable =
          Components.classes["@mozilla.org/widget/transferable;1"]
                    .createInstance(Components.interfaces.nsITransferable);

      xferable.init(null);
      for (var i = 0; i < types.length; ++i)
        xferable.addDataFlavor(types[i]);
      return xferable;
    }

    var clipboard = this.clipboard;

    var ip = this._view.insertionPoint;
    if (!ip)
      throw Components.results.NS_ERROR_NOT_AVAILABLE;

    /**
     * Gets a list of transactions to perform the paste of specific types.
     * @param   types
     *          The types of data to form paste transactions for
     * @returns An array of transactions that perform the paste.
     */
    function getTransactions(types) {
      var xferable = makeXferable(types);
      clipboard.getData(xferable, Components.interfaces.nsIClipboard.kGlobalClipboard);

      var data = { }, type = { };
      try {
        xferable.getAnyTransferData(type, data, { });
        data = data.value.QueryInterface(Components.interfaces.nsISupportsString).data;
        var items = PlacesUtils.unwrapNodes(data, type.value);
        var transactions = [];
        var index = ip.index;
        for (var i = 0; i < items.length; ++i) {
          var txn;
          if (ip.isTag) {
            var uri = PlacesUtils._uri(items[i].uri);
            txn = new PlacesTagURITransaction(uri, [ip.itemId]);
          }
          else {
            // adjusted to make sure that items are given the correct index
            // transactions insert differently if index == -1
            // transaction will enqueue the item.
            if (ip.index > -1)
              index = ip.index + i;
            txn = PlacesUIUtils.makeTransaction(items[i], type.value,
                                                ip.itemId, index, true);
          }
          transactions.push(txn);
        }
        return transactions;
      }
      catch (e) {
        // getAnyTransferData will throw if there is no data of the specified
        // type on the clipboard.
        // unwrapNodes will throw if the data that is present is malformed in
        // some way.
        // In either case, don't fail horribly, just return no data.
      }
      return [];
    }

    // Get transactions to paste any folders, separators or links that might
    // be on the clipboard, aggregate them and execute them.
    var transactions = getTransactions([PlacesUtils.TYPE_X_MOZ_PLACE,
                                        PlacesUtils.TYPE_X_MOZ_URL,
                                        PlacesUtils.TYPE_UNICODE]);
    let aggregatedTxn = new PlacesAggregatedTransaction("Paste", transactions);
    PlacesUtils.transactionManager.doTransaction(aggregatedTxn);

    // select the pasted items, they should be consecutive
    var insertedNodeIds = [];
    for (var i = 0; i < transactions.length; ++i)
      insertedNodeIds.push(PlacesUtils.bookmarks
                                      .getIdForItemAt(ip.itemId, ip.index + i));
    if (insertedNodeIds.length > 0)
      this._view.selectItems(insertedNodeIds, false);
  },


  /**
   * Cache the livemark info for a node.  This allows the controller and the
   * views to treat the given node as a livemark.
   * @param aNode
   *        a places result node.
   * @param aLivemarkInfo
   *        a mozILivemarkInfo object.
   */
  cacheLivemarkInfo: function PC_cacheLivemarkInfo(aNode, aLivemarkInfo) {
    this._cachedLivemarkInfoObjects.set(aNode, aLivemarkInfo);
  },

  /**
   * Returns whether or not there's cached mozILivemarkInfo object for a node.
   * @param aNode
   *        a places result node.
   * @return true if there's a cached mozILivemarkInfo object for
   * aNode, false otherwise.
   */
  hasCachedLivemarkInfo: function PC_hasCachedLivemarkInfo(aNode) {
    return this._cachedLivemarkInfoObjects.has(aNode);
  },

  /**
   * Returns the cached livemark info for a node, if set by cacheLivemarkInfo,
   * null otherwise.
   * @param aNode
   *        a places result node.
   * @return the mozILivemarkInfo object for aNode, if set, null otherwise.
   */
  getCachedLivemarkInfo: function PC_getCachedLivemarkInfo(aNode) {
    return this._cachedLivemarkInfoObjects.get(aNode, null);
  }
};

/**
 * Handles drag and drop operations for views. Note that this is view agnostic!
 * You should not use PlacesController._view within these methods, since
 * the view that the item(s) have been dropped on was not necessarily active.
 * Drop functions are passed the view that is being dropped on.
 */
var PlacesControllerDragHelper = {
  /**
   * DOM Element currently being dragged over
   */
  currentDropTarget: null,

  /**
   * Determines if the mouse is currently being dragged over a child node of
   * this menu. This is necessary so that the menu doesn't close while the
   * mouse is dragging over one of its submenus
   * @param   node
   *          The container node
   * @returns true if the user is dragging over a node within the hierarchy of
   *          the container, false otherwise.
   */
  draggingOverChildNode: function PCDH_draggingOverChildNode(node) {
    let currentNode = this.currentDropTarget;
    while (currentNode) {
      if (currentNode == node)
        return true;
      currentNode = currentNode.parentNode;
    }
    return false;
  },

  /**
   * @returns The current active drag session. Returns null if there is none.
   */
  getSession: function PCDH__getSession() {
    return this.dragService.getCurrentSession();
  },

  /**
   * Extract the first accepted flavor from a flavors array.
   * @param aFlavors
   *        The flavors array.
   */
  getFirstValidFlavor: function PCDH_getFirstValidFlavor(aFlavors) {
    for (let i = 0; i < aFlavors.length; i++) {
      if (this.GENERIC_VIEW_DROP_TYPES.indexOf(aFlavors[i]) != -1)
        return aFlavors[i];
    }
    return null;
  },

  /**
   * Determines whether or not the data currently being dragged can be dropped
   * on a places view.
   * @param ip
   *        The insertion point where the items should be dropped.
   */
  canDrop: function PCDH_canDrop(ip, dt) {
    let dropCount = dt.mozItemCount;

    // Check every dragged item.
    for (let i = 0; i < dropCount; i++) {
      let flavor = this.getFirstValidFlavor(dt.mozTypesAt(i));
      if (!flavor)
        return false;

      // Urls can be dropped on any insertionpoint.
      // XXXmano: remember that this method is called for each dragover event!
      // Thus we shouldn't use unwrapNodes here at all if possible.
      // I think it would be OK to accept bogus data here (e.g. text which was
      // somehow wrapped as TAB_DROP_TYPE, this is not in our control, and
      // will just case the actual drop to be a no-op), and only rule out valid
      // expected cases, which are either unsupported flavors, or items which
      // cannot be dropped in the current insertionpoint. The last case will
      // likely force us to use unwrapNodes for the private data types of
      // places.
      if (flavor == TAB_DROP_TYPE)
        continue;

      let data = dt.mozGetDataAt(flavor, i);
      let dragged;
      try {
        dragged = PlacesUtils.unwrapNodes(data, flavor)[0];
      }
      catch (e) {
        return false;
      }

      // Only bookmarks and urls can be dropped into tag containers.
      if (ip.isTag && ip.orientation == Components.interfaces.nsITreeView.DROP_ON &&
          dragged.type != PlacesUtils.TYPE_X_MOZ_URL &&
          (dragged.type != PlacesUtils.TYPE_X_MOZ_PLACE ||
           /^place:/.test(dragged.uri)))
        return false;

      // The following loop disallows the dropping of a folder on itself or
      // on any of its descendants.
      if (dragged.type == PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER ||
          /^place:/.test(dragged.uri)) {
        let parentId = ip.itemId;
        while (parentId != PlacesUtils.placesRootId) {
          if (dragged.concreteId == parentId || dragged.id == parentId)
            return false;
          parentId = PlacesUtils.bookmarks.getFolderIdForItem(parentId);
        }
      }
    }
    return true;
  },


  /**
   * Determines if a node can be moved.
   *
   * @param   aNode
   *          A nsINavHistoryResultNode node.
   * @returns True if the node can be moved, false otherwise.
   */
  canMoveNode:
  function PCDH_canMoveNode(aNode) {
    // Only bookmark items are movable.
    if (aNode.itemId == -1)
      return false;
    // Once tags and bookmarked are divorced, the tag-query check should be
    // removed.
    let parentNode = aNode.parent;
    return parentNode &&
           !(PlacesUtils.nodeIsFolder(parentNode) &&
             PlacesUIUtils.isContentsReadOnly(parentNode)) &&
           !PlacesUtils.nodeIsTagQuery(parentNode);
    },

  /**
   * Handles the drop of one or more items onto a view.
   * @param   insertionPoint
   *          The insertion point where the items should be dropped
   */
  onDrop: function PCDH_onDrop(insertionPoint, dt) {
    let doCopy = ["copy", "link"].indexOf(dt.dropEffect) != -1;

    let transactions = [];
    let dropCount = dt.mozItemCount;
    let movedCount = 0;
    for (let i = 0; i < dropCount; ++i) {
      let flavor = this.getFirstValidFlavor(dt.mozTypesAt(i));
      if (!flavor)
        return;

      let data = dt.mozGetDataAt(flavor, i);
      let unwrapped;
      if (flavor != TAB_DROP_TYPE) {
        // There's only ever one in the D&D case.
        unwrapped = PlacesUtils.unwrapNodes(data, flavor)[0];
      }
      else if (data instanceof XULElement && data.localName == "tab" &&
               data.ownerDocument.defaultView instanceof ChromeWindow) {
        let uri = data.linkedBrowser.currentURI;
        let spec = uri ? uri.spec : "about:blank";
        let title = data.label;
        unwrapped = { uri: spec,
                      title: data.label,
                      type: PlacesUtils.TYPE_X_MOZ_URL};
      }
      else
        throw("bogus data was passed as a tab")

      let index = insertionPoint.index;

      // Adjust insertion index to prevent reversal of dragged items. When you
      // drag multiple elts upward: need to increment index or each successive
      // elt will be inserted at the same index, each above the previous.
      let dragginUp = insertionPoint.itemId == unwrapped.parent &&
                      index < PlacesUtils.bookmarks.getItemIndex(unwrapped.id);
      if (index != -1 && dragginUp)
        index+= movedCount++;

      // If dragging over a tag container we should tag the item.
      if (insertionPoint.isTag &&
          insertionPoint.orientation == Components.interfaces.nsITreeView.DROP_ON) {
        let uri = PlacesUtils._uri(unwrapped.uri);
        let tagItemId = insertionPoint.itemId;
        let tagTxn = new PlacesTagURITransaction(uri, [tagItemId]);
        transactions.push(tagTxn);
      }
      else {
        transactions.push(PlacesUIUtils.makeTransaction(unwrapped,
                          flavor, insertionPoint.itemId,
                          index, doCopy));
      }
    }

    let txn = new PlacesAggregatedTransaction("DropItems", transactions);
    PlacesUtils.transactionManager.doTransaction(txn);
  },

  /**
   * Checks if we can insert into a container.
   * @param   aContainer
   *          The container were we are want to drop
   */
  disallowInsertion: function(aContainer) {
    NS_ASSERT(aContainer, "empty container");
    // Allow dropping into Tag containers and editable folders.
    return !PlacesUtils.nodeIsTagQuery(aContainer) &&
           (!PlacesUtils.nodeIsFolder(aContainer) ||
            PlacesUIUtils.isContentsReadOnly(aContainer));
  },

  placesFlavors: [PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER,
                  PlacesUtils.TYPE_X_MOZ_PLACE_SEPARATOR,
                  PlacesUtils.TYPE_X_MOZ_PLACE],

  // The order matters.
  GENERIC_VIEW_DROP_TYPES: [PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER,
                            PlacesUtils.TYPE_X_MOZ_PLACE_SEPARATOR,
                            PlacesUtils.TYPE_X_MOZ_PLACE,
                            PlacesUtils.TYPE_X_MOZ_URL,
                            TAB_DROP_TYPE,
                            PlacesUtils.TYPE_UNICODE],
};


XPCOMUtils.defineLazyServiceGetter(PlacesControllerDragHelper, "dragService",
                                   "@mozilla.org/widget/dragservice;1",
                                   "nsIDragService");

function goUpdatePlacesCommands() {
  // Get the controller for one of the places commands.
  var placesController = doGetPlacesControllerForCommand("placesCmd_open");
  if (!placesController)
    return;

  function updatePlacesCommand(aCommand) {
    goSetCommandEnabled(aCommand, placesController.isCommandEnabled(aCommand));
  }

  updatePlacesCommand("placesCmd_open");
  updatePlacesCommand("placesCmd_open:tab");
  updatePlacesCommand("placesCmd_open:window");
  updatePlacesCommand("placesCmd_open:privatewindow");
  updatePlacesCommand("placesCmd_new:folder");
  updatePlacesCommand("placesCmd_new:bookmark");
  updatePlacesCommand("placesCmd_new:livemark");
  updatePlacesCommand("placesCmd_new:separator");
  updatePlacesCommand("placesCmd_show:info");
  updatePlacesCommand("placesCmd_moveBookmarks");
  updatePlacesCommand("placesCmd_reload");
  updatePlacesCommand("placesCmd_sortBy:name");
  updatePlacesCommand("placesCmd_cut");
  updatePlacesCommand("placesCmd_copy");
  updatePlacesCommand("placesCmd_paste");
  updatePlacesCommand("placesCmd_delete");
}

function doGetPlacesControllerForCommand(aCommand)
{
  // A context menu may be built for non-focusable views.  Thus, we first try
  // to look for a view associated with document.popupNode
  let popupNode = document.popupNode;
  if (popupNode) {
    let view = PlacesUIUtils.getViewForNode(popupNode);
    if (view && view._contextMenuShown)
      return view.controllers.getControllerForCommand(aCommand);
  }

  // When we're not building a context menu, only focusable views
  // are possible.  Thus, we can safely use the command dispatcher.
  let controller = top.document.commandDispatcher
                      .getControllerForCommand(aCommand);
  if (controller)
    return controller;

  return null;
}

function goDoPlacesCommand(aCommand)
{
  let controller = doGetPlacesControllerForCommand(aCommand);
  if (controller && controller.isCommandEnabled(aCommand))
    controller.doCommand(aCommand);
}
