/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["PlacesUIUtils"];

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyGetter(this, "PlacesUtils", function() {
  Components.utils.import("resource://gre/modules/PlacesUtils.jsm");
  return PlacesUtils;
});

// This function isn't public both because it's synchronous and because it is
// going to be removed in bug 1072833.

function IsLivemark(aItemId) {
  // Since this check may be done on each dragover event, it's worth maintaining
  // a cache.
  let self = IsLivemark;
  if (!("ids" in self)) {
    const LIVEMARK_ANNO = PlacesUtils.LMANNO_FEEDURI;

    let idsVec = PlacesUtils.annotations.getItemsWithAnnotation(LIVEMARK_ANNO);
    self.ids = new Set(idsVec);

    let obs = {
      QueryInterface: XPCOMUtils.generateQI(Components.interfaces.nsIAnnotationObserver),

      onItemAnnotationSet(itemId, annoName) {
        if (annoName == LIVEMARK_ANNO)
          self.ids.add(itemId);
      },

      onItemAnnotationRemoved(itemId, annoName) {
        // If annoName is set to an empty string, the item is gone.
        if (annoName == LIVEMARK_ANNO || annoName == "")
          self.ids.delete(itemId);
      },

      onPageAnnotationSet() { },
      onPageAnnotationRemoved() { },
    };
    PlacesUtils.annotations.addObserver(obs);
    PlacesUtils.registerShutdownFunction(() => {
      PlacesUtils.annotations.removeObserver(obs);
    });
  }
  return self.ids.has(aItemId);
}

var PlacesUIUtils = {
  ORGANIZER_LEFTPANE_VERSION: 6,
  ORGANIZER_FOLDER_ANNO: "PlacesOrganizer/OrganizerFolder",
  ORGANIZER_QUERY_ANNO: "PlacesOrganizer/OrganizerQuery",

  LOAD_IN_SIDEBAR_ANNO: "bookmarkProperties/loadInSidebar",
  DESCRIPTION_ANNO: "bookmarkProperties/description",

  TYPE_TAB_DROP: "application/x-moz-tabbrowser-tab",

  /**
   * Makes a URI from a spec, and do fixup
   * @param   aSpec
   *          The string spec of the URI
   * @returns A URI object for the spec.
   */
  createFixedURI: function PUIU_createFixedURI(aSpec) {
    return URIFixup.createFixupURI(aSpec, Components.interfaces.nsIURIFixup.FIXUP_FLAG_NONE);
  },

  /**
   * Wraps a string in a nsISupportsString wrapper
   * @param   aString
   *          The string to wrap
   * @returns A nsISupportsString object containing a string.
   */
  _wrapString: function PUIU__wrapString(aString) {
    var s = Components.classes["@mozilla.org/supports-string;1"]
                      .createInstance(Components.interfaces.nsISupportsString);
    s.data = aString;
    return s;
  },

  getFormattedString: function PUIU_getFormattedString(key, params) {
    return bundle.formatStringFromName(key, params, params.length);
  },

  getString: function PUIU_getString(key) {
    return bundle.GetStringFromName(key);
  },

  /**
   * Get a transaction for copying a uri item (either a bookmark or a
   * history entry) from one container to another.
   *
   * @param   aData
   *          JSON object of dropped or pasted item properties
   * @param   aContainer
   *          The container being copied into
   * @param   aIndex
   *          The index within the container the item is copied to
   * @return  A nsITransaction object that performs the copy.
   *
   * @note Since a copy creates a completely new item, only some internal
   *       annotations are synced from the old one.
   * @see this._copyableAnnotations for the list of copyable annotations.
   */
   _getURIItemCopyTransaction:
   function PUIU__getURIItemCopyTransaction(aData, aContainer, aIndex)
   {
     let transactions = [];
     if (aData.dateAdded)
       transactions.push(
         new PlacesEditItemDateAddedTransaction(null, aData.dateAdded)
       );

     if (aData.lastModified)
       transactions.push(
         new PlacesEditItemLastModifiedTransaction(null, aData.lastModified)
       );

     let keyword = aData.keyword || null;
     let annos = [];
     if (aData.annos) {
       annos = aData.annos.filter(function (aAnno) {
         return this._copyableAnnotations.indexOf(aAnno.name) != -1;
       }, this);
     }

     return new PlacesCreateBookmarkTransaction(PlacesUtils._uri(aData.uri),
                                                aContainer, aIndex, aData.title,
                                                keyword, annos, transactions);
  },

  /**
   * Gets a transaction for copying (recursively nesting to include children)
   * a folder (or container) and its contents from one folder to another.
   *
   * @param   aData
   *          Unwrapped dropped folder data - Obj containing folder and children
   * @param   aContainer
   *          The container we are copying into
   * @param   aIndex
   *          The index in the destination container to insert the new items
   * @return  A nsITransaction object that will perform the copy.
   *
   * @note Since a copy creates a completely new item, only some internal
   *       annotations are synced from the old one.
   * @see this._copyableAnnotations for the list of copyable annotations.
   */
  _getFolderCopyTransaction:
  function PUIU__getFolderCopyTransaction(aData, aContainer, aIndex) {
    function getChildItemsTransactions(aChildren) {
      let transactions = [];
      let index = aIndex;
      aChildren.forEach(function (node, i) {
        // Make sure that items are given the correct index, this will be
        // passed by the transaction manager to the backend for the insertion.
        // Insertion behaves differently for DEFAULT_INDEX (append).
        if (aIndex != PlacesUtils.bookmarks.DEFAULT_INDEX)
          index = i;

        if (node.type == PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER)
          transactions.push(
            PlacesUIUtils._getFolderCopyTransaction(node, aContainer, index)
          );
        else if (node.type == PlacesUtils.TYPE_X_MOZ_PLACE_SEPARATOR)
          transactions.push(new PlacesCreateSeparatorTransaction(-1, index));
        else if (node.type == PlacesUtils.TYPE_X_MOZ_PLACE)
          transactions.push(
            PlacesUIUtils._getURIItemCopyTransaction(node, -1, index)
          );
        else
          throw new Error("Unexpected item under a bookmarks folder");
      });
      return transactions;
    }

    if (aContainer == PlacesUtils.tagsFolderId) { // Copying a tag folder.
      let transactions = [];
      if (aData.children) {
        aData.children.forEach(function(aChild) {
          transactions.push(
            new PlacesTagURITransaction(PlacesUtils._uri(aChild.uri),
                                        [aData.title])
          );
        });
      }
      return new PlacesAggregatedTransaction("addTags", transactions);
    }

    if (aData.livemark && aData.annos) // Copying a livemark.
      return this._getLivemarkCopyTransaction(aData, aContainer, aIndex);

    let transactions = getChildItemsTransactions(aData.children);
    if (aData.dateAdded)
      transactions.push(
        new PlacesEditItemDateAddedTransaction(null, aData.dateAdded)
      );
    if (aData.lastModified)
      transactions.push(
        new PlacesEditItemLastModifiedTransaction(null, aData.lastModified)
    );

    let annos = [];
    if (aData.annos) {
      annos = aData.annos.filter(function (aAnno) {
        return this._copyableAnnotations.indexOf(aAnno.name) != -1;
      }, this);
    }

    return new PlacesCreateFolderTransaction(aData.title, aContainer,
                                             aIndex, annos,
                                             transactions);
  },

// Backwards Compatible shim or some dipshit
  _isLivemark:
  function PUIU__isLivemark(aItemId)
  {
    return IsLivemark(aItemId);
  },

   /**
   * Gets a transaction for copying a live bookmark item from one container to
   * another.
   *
   * @param   aData
   *          Unwrapped live bookmarkmark data
   * @param   aContainer
   *          The container we are copying into
   * @param   aIndex
   *          The index in the destination container to insert the new items
   * @return A nsITransaction object that will perform the copy.
   *
   * @note Since a copy creates a completely new item, only some internal
   *       annotations are synced from the old one.
   * @see this._copyableAnnotations for the list of copyable annotations.
   */
  _getLivemarkCopyTransaction:
  function PUIU__getLivemarkCopyTransaction(aData, aContainer, aIndex) {
    if (!aData.livemark || !aData.annos)
      throw("node is not a livemark");

    let feedURI = null;
    let siteURI = null;
    if (aData.annos) {
      annos = aData.annos.filter(function(aAnno) {
        if (aAnno.name == PlacesUtils.LMANNO_FEEDURI) {
          feedURI = PlacesUtils._uri(aAnno.value);
        }
        else if (aAnno.name == PlacesUtils.LMANNO_SITEURI) {
          siteURI = PlacesUtils._uri(aAnno.value);
        }
        return this._copyableAnnotations.indexOf(aAnno.name) != -1
      }, this);
    }

    return new PlacesCreateLivemarkTransaction(feedURI, siteURI, aData.title,
                                               aContainer, aIndex, annos);
  },

  /**
   * Constructs a Transaction for the drop or paste of a blob of data into
   * a container.
   * @param   data
   *          The unwrapped data blob of dropped or pasted data.
   * @param   type
   *          The content type of the data
   * @param   container
   *          The container the data was dropped or pasted into
   * @param   index
   *          The index within the container the item was dropped or pasted at
   * @param   copy
   *          The drag action was copy, so don't move folders or links.
   * @returns An object implementing nsITransaction that can perform
   *          the move/insert.
   */
  makeTransaction: function PUIU_makeTransaction(data, type, container,
                                                 index, copy) {
    switch (data.type) {
      case PlacesUtils.TYPE_X_MOZ_PLACE_CONTAINER:
        if (copy)
          return this._getFolderCopyTransaction(data, container, index);
        // Otherwise move the item.
        return new PlacesMoveItemTransaction(data.id, container, index);
        break;
      case PlacesUtils.TYPE_X_MOZ_PLACE:
        if (copy || data.id == -1) // id is -1 if the place is not bookmarked
          return this._getURIItemCopyTransaction(data, container, index);

        // Otherwise move the item.
        return new PlacesMoveItemTransaction(data.id, container, index);
        break;
      case PlacesUtils.TYPE_X_MOZ_PLACE_SEPARATOR:
        if (copy) {
          // There is no data in a separator, so copying it just amounts to
          // inserting a new separator.
          return new PlacesCreateSeparatorTransaction(container, index);
        }

        return new PlacesMoveItemTransaction(data.id, container, index);
        break;
      default:
        if (type == PlacesUtils.TYPE_X_MOZ_URL ||
            type == PlacesUtils.TYPE_UNICODE ||
            type == this.TYPE_TAB_DROP) {
          let title = (type != PlacesUtils.TYPE_UNICODE) ? data.title :
                                                             data.uri;
          return new PlacesCreateBookmarkTransaction(PlacesUtils._uri(data.uri),
                                                     container, index, title);
        }
    }
    return null;
  },

  /**
   * Methods to show the bookmarkProperties dialog in its various modes.
   *
   * The showMinimalAdd* methods open the dialog by its alternative URI. Thus
   * they persist the dialog dimensions separately from the showAdd* methods.
   * Note these variants also do not return the dialog "performed" state since
   * they may not open the dialog modally.
   */

  /**
   * Shows the "Add Bookmark" dialog.
   *
   * @param [optional] aURI
   *        An nsIURI object for which the "add bookmark" dialog is
   *        to be shown.
   * @param [optional] aTitle
   *        The default title for the new bookmark.
   * @param [optional] aDescription
            The default description for the new bookmark
   * @param [optional] aDefaultInsertionPoint
   *        The default insertion point for the new item. If set, the folder
   *        picker would be hidden unless aShowPicker is set to true, in which
   *        case the dialog only uses the folder identifier from the insertion
   *        point as the initially selected item in the folder picker.
   * @param [optional] aShowPicker
   *        see above
   * @param [optional] aKeyword
   *        The default keyword for the new bookmark. The keyword field
   *        will be shown in the dialog if this is used.
   * @param [optional] aPostData
   *        POST data for POST-style keywords.
   * @param [optional] aCharSet
   *        The character set for the bookmarked page.
   * @param [optional] aHiddenRows
   *        An array of rows to hide that is passed through to the
            bookmark properties dialog.
   * @return true if any transaction has been performed.
   *
   * Notes:
   *  - the location and description fields are
   *    visible only if there is no initial URI (aURI is null).
   *  - When aDefaultInsertionPoint is not set, the dialog defaults to the
   *    bookmarks root folder.
   */
  showAddBookmarkUI: function PUIU_showAddBookmarkUI(aURI,
                                                     aTitle,
                                                     aDescription,
                                                     aDefaultInsertionPoint,
                                                     aShowPicker,
                                                     aLoadInSidebar,
                                                     aKeyword,
                                                     aPostData,
                                                     aCharSet,
                                                     aHiddenRows) {
    var info = {
      action: "add",
      type: "bookmark"
    };

    if (aURI)
      info.uri = aURI;

    // allow default empty title
    if (typeof(aTitle) == "string")
      info.title = aTitle;

    if (aDescription)
      info.description = aDescription;

    info.hiddenRows = aHiddenRows || [];

    if (aDefaultInsertionPoint) {
      info.defaultInsertionPoint = aDefaultInsertionPoint;
      if (!aShowPicker)
        info.hiddenRows.push("folderPicker");
    }

    if (typeof(aKeyword) == "string") {
      info.keyword = aKeyword;
      if (typeof(aPostData) == "string")
        info.postData = aPostData;
      if (typeof(aCharSet) == "string")
        info.charSet = aCharSet;
    }

    return this._showBookmarkDialog(info);
  },

  /**
   * @see showAddBookmarkUI
   * This opens the dialog with only the name and folder pickers visible by
   * default.
   *
   * You can still pass in the various paramaters as the default properties
   * for the new bookmark.
   *
   * The keyword field will be visible only if the aKeyword parameter
   * was used.
   */
  showMinimalAddBookmarkUI:
  function PUIU_showMinimalAddBookmarkUI(aURI, aTitle, aDescription,
                                         aDefaultInsertionPoint, aShowPicker,
                                         aLoadInSidebar, aKeyword, aPostData,
                                         aCharSet) {
    var info = {
      action: "add",
      type: "bookmark",
      hiddenRows: ["description"]
    };
    if (aURI)
      info.uri = aURI;

    // allow default empty title
    if (typeof(aTitle) == "string")
      info.title = aTitle;

    if (aDescription)
      info.description = aDescription;

    if (aDefaultInsertionPoint) {
      info.defaultInsertionPoint = aDefaultInsertionPoint;
      if (!aShowPicker)
        info.hiddenRows.push("folderPicker");
    }

    info.hiddenRows = info.hiddenRows.concat(["location"]);

    if (typeof(aKeyword) == "string") {
      info.keyword = aKeyword;
      // Hide the Tags field if we are adding a keyword.
      info.hiddenRows.push("tags");
      // Keyword related params.
      if (typeof(aPostData) == "string")
        info.postData = aPostData;
      if (typeof(aCharSet) == "string")
        info.charSet = aCharSet;
    }
    else
      info.hiddenRows.push("keyword");

    return this._showBookmarkDialog(info);
  },

  /**
   * Shows the "Add Live Bookmark" dialog.
   *
   * @param [optional] aFeedURI
   *        The feed URI for which the dialog is to be shown (nsIURI).
   * @param [optional] aSiteURI
   *        The site URI for the new live-bookmark (nsIURI).
   * @param [optional] aDefaultInsertionPoint
   *        The default insertion point for the new item. If set, the folder
   *        picker would be hidden unless aShowPicker is set to true, in which
   *        case the dialog only uses the folder identifier from the insertion
   *        point as the initially selected item in the folder picker.
   * @param [optional] aShowPicker
   *        see above
   * @return true if any transaction has been performed.
   *
   * Notes:
   *  - the feedURI and description fields are visible only if there is no
   *    initial feed URI (aFeedURI is null).
   *  - When aDefaultInsertionPoint is not set, the dialog defaults to the
   *    bookmarks root folder.
   */
  showAddLivemarkUI: function PUIU_showAddLivemarkURI(aFeedURI,
                                                      aSiteURI,
                                                      aTitle,
                                                      aDescription,
                                                      aDefaultInsertionPoint,
                                                      aShowPicker) {
    var info = {
      action: "add",
      type: "livemark"
    };

    if (aFeedURI)
      info.feedURI = aFeedURI;
    if (aSiteURI)
      info.siteURI = aSiteURI;

    // allow default empty title
    if (typeof(aTitle) == "string")
      info.title = aTitle;

    if (aDescription)
      info.description = aDescription;

    if (aDefaultInsertionPoint) {
      info.defaultInsertionPoint = aDefaultInsertionPoint;
      if (!aShowPicker)
        info.hiddenRows = ["folderPicker"];
    }
    return this._showBookmarkDialog(info);
  },

  /**
   * @see showAddLivemarkUI
   * This opens the dialog with only the name and folder pickers visible by
   * default.
   *
   * You can still pass in the various paramaters as the default properties
   * for the new live-bookmark.
   */
  showMinimalAddLivemarkUI:
  function PUIU_showMinimalAddLivemarkURI(aFeedURI, aSiteURI, aTitle,
                                          aDescription, aDefaultInsertionPoint,
                                          aShowPicker) {
    var info = {
      action: "add",
      type: "livemark",
      hiddenRows: ["feedLocation", "siteLocation", "description"]
    };

    if (aFeedURI)
      info.feedURI = aFeedURI;
    if (aSiteURI)
      info.siteURI = aSiteURI;

    // allow default empty title
    if (typeof(aTitle) == "string")
      info.title = aTitle;

    if (aDescription)
      info.description = aDescription;

    if (aDefaultInsertionPoint) {
      info.defaultInsertionPoint = aDefaultInsertionPoint;
      if (!aShowPicker)
        info.hiddenRows.push("folderPicker");
    }
    return this._showBookmarkDialog(info);
  },

  /**
   * Show an "Add Bookmarks" dialog to allow the adding of a folder full
   * of bookmarks corresponding to the objects in the uriList.  This will
   * be called most often as the result of a "Bookmark All Tabs..." command.
   *
   * @param aURIList  List of nsIURI objects representing the locations
   *                  to be bookmarked.
   * @param aTitleList  Optional list of strings giving the page titles.
   * @return true if any transaction has been performed.
   */
  showMinimalAddMultiBookmarkUI: function PUIU_showAddMultiBookmarkUI(aURIList, aTitleList) {
    if (aURIList.length == 0)
      throw("showAddMultiBookmarkUI expects a list of nsIURI objects");
    var info = {
      action: "add",
      type: "folder",
      hiddenRows: ["description"],
      URIList: aURIList
    };

    if (aTitleList)
      info.titleList = aTitleList;

    return this._showBookmarkDialog(info);
  },

  /**
   * Opens the properties dialog for a given item identifier.
   *
   * @param aItemId
   *        item identifier for which the properties are to be shown
   * @param aType
   *        item type, either "bookmark" or "folder"
   * @param [optional] aReadOnly
   *        states if properties dialog should be readonly
   * @return true if any transaction has been performed.
   */
  showItemProperties: function PUIU_showItemProperties(aItemId, aType, aReadOnly) {
    var info = {
      action: "edit",
      type: aType,
      itemId: aItemId,
      readOnly: aReadOnly
    };
    return this._showBookmarkDialog(info);
  },

  /**
   * Shows the "New Folder" dialog.
   *
   * @param [optional] aTitle
   *        The default title for the new bookmark.
   * @param [optional] aDefaultInsertionPoint
   *        The default insertion point for the new item. If set, the folder
   *        picker would be hidden unless aShowPicker is set to true, in which
   *        case the dialog only uses the folder identifier from the insertion
   *        point as the initially selected item in the folder picker.
   * @param [optional] aShowPicker
   *        see above
   * @return true if any transaction has been performed.
   */
  showAddFolderUI:
  function PUIU_showAddFolderUI(aTitle, aDefaultInsertionPoint, aShowPicker) {
    var info = {
      action: "add",
      type: "folder",
      hiddenRows: []
    };

    // allow default empty title
    if (typeof(aTitle) == "string")
      info.title = aTitle;

    if (aDefaultInsertionPoint) {
      info.defaultInsertionPoint = aDefaultInsertionPoint;
      if (!aShowPicker)
        info.hiddenRows.push("folderPicker");
    }
    return this._showBookmarkDialog(info);
  },

  /**
   * Shows the bookmark dialog corresponding to the specified info
   *
   * @param aInfo
   *        Describes the item to be edited/added in the dialog.
   *        See documentation at the top of bm-props.js
   * @param aMinimalUI
   *        [optional] if true, the dialog is opened by its alternative
   *        chrome: uri.
   *
   * @return true if any transaction has been performed, false otherwise.
   */
  _showBookmarkDialog: function PUIU__showBookmarkDialog(aInfo) {
    // Preserve size attributes differently based on the fact the dialog has
    // a folder picker or not, since it needs more horizontal space than the
    // other controls.
    let hasFolderPicker = !("hiddenRows" in aInfo) ||
                          !aInfo.hiddenRows.includes("folderPicker");
    // Use a different chrome url to persist different sizes.
    let dialogURL = hasFolderPicker ?
                    "chrome://communicator/content/bookmarks/bm-props2.xul" :
                    "chrome://communicator/content/bookmarks/bm-props.xul";

    let features = "centerscreen,chrome,modal,resizable=yes";
    this._getCurrentActiveWin().openDialog(dialogURL, "", features, aInfo);
    return ("performed" in aInfo && aInfo.performed);
  },

  _getTopBrowserWin: function PUIU__getTopBrowserWin() {
    return this._getCurrentActiveWin().gPrivate ||
           Services.wm.getMostRecentWindow("navigator:browser");
  },

  _getCurrentActiveWin: function PUIU__getCurrentActiveWin() {
    return focusManager.activeWindow || Services.wm.getMostRecentWindow(null);
  },

  /**
   * Returns the closet ancestor places view for the given DOM node
   * @param aNode
   *        a DOM node
   * @return the closet ancestor places view if exists, null otherwsie.
   */
  getViewForNode: function PUIU_getViewForNode(aNode) {
    let node = aNode;

    // The view for a <menu> of which its associated menupopup is a places
    // view, is the menupopup.
    if (node.localName == "menu" && !node._placesNode &&
        node.lastChild._placesView)
      return node.lastChild._placesView;

    while (node instanceof Components.interfaces.nsIDOMElement) {
      if (node._placesView)
        return node._placesView;
      if (node.localName == "tree" && node.getAttribute("type") == "places")
        return node;

      node = node.parentNode;
    }

    return null;
  },

  /**
   * By calling this before visiting an URL, the visit will be associated to a
   * TRANSITION_TYPED transition (if there is no a referrer).
   * This is used when visiting pages from the history menu, history sidebar,
   * url bar, url autocomplete results, and history searches from the places
   * organizer.  If this is not called visits will be marked as
   * TRANSITION_LINK.
   */
  markPageAsTyped: function PUIU_markPageAsTyped(aURL) {
    PlacesUtils.history.markPageAsTyped(this.createFixedURI(aURL));
  },

  /**
   * By calling this before visiting an URL, the visit will be associated to a
   * TRANSITION_BOOKMARK transition.
   * This is used when visiting pages from the bookmarks menu,
   * personal toolbar, and bookmarks from within the places organizer.
   * If this is not called visits will be marked as TRANSITION_LINK.
   */
  markPageAsFollowedBookmark: function PUIU_markPageAsFollowedBookmark(aURL) {
    PlacesUtils.history.markPageAsFollowedBookmark(this.createFixedURI(aURL));
  },

  /**
   * By calling this before visiting an URL, any visit in frames will be
   * associated to a TRANSITION_FRAMED_LINK transition.
   * This is actually used to distinguish user-initiated visits in frames
   * so automatic visits can be correctly ignored.
   */
  markPageAsFollowedLink: function PUIU_markPageAsFollowedLink(aURL) {
    PlacesUtils.history.markPageAsFollowedLink(this.createFixedURI(aURL));
  },

  /**
   * Allows opening of javascript/data URI only if the given node is
   * bookmarked (see bug 224521).
   * @param aURINode
   *        a URI node
   * @param aWindow
   *        a window on which a potential error alert is shown on.
   * @return true if it's safe to open the node in the browser, false otherwise.
   *
   */
  checkURLSecurity: function PUIU_checkURLSecurity(aURINode, aWindow) {
    if (PlacesUtils.nodeIsBookmark(aURINode))
      return true;

    var uri = PlacesUtils._uri(aURINode.uri);
    if (uri.schemeIs("javascript") || uri.schemeIs("data")) {
      const BRANDING_BUNDLE_URI = "chrome://branding/locale/brand.properties";
      var brandShortName = Components.classes["@mozilla.org/intl/stringbundle;1"]
                                     .getService(Components.interfaces.nsIStringBundleService)
                                     .createBundle(BRANDING_BUNDLE_URI)
                                     .GetStringFromName("brandShortName");

      var errorStr = this.getString("load-js-data-url-error");
      Services.prompt.alert(aWindow, brandShortName, errorStr);
      return false;
    }
    return true;
  },

  /**
   * Get the description associated with a document, as specified in a <META>
   * element.
   * @param   doc
   *          A DOM Document to get a description for
   * @returns A description string if a META element was discovered with a
   *          "description" or "httpequiv" attribute, empty string otherwise.
   */
  getDescriptionFromDocument: function PUIU_getDescriptionFromDocument(doc) {
    var metaElements = doc.getElementsByTagName("META");
    for (var i = 0; i < metaElements.length; ++i) {
      if (metaElements[i].name.toLowerCase() == "description" ||
          metaElements[i].httpEquiv.toLowerCase() == "description") {
        return metaElements[i].content;
      }
    }
    return "";
  },

  /**
   * Retrieve the description of an item
   * @param aItemId
   *        item identifier
   * @returns the description of the given item, or an empty string if it is
   * not set.
   */
  getItemDescription: function PUIU_getItemDescription(aItemId) {
    if (PlacesUtils.annotations.itemHasAnnotation(aItemId, this.DESCRIPTION_ANNO))
      return PlacesUtils.annotations.getItemAnnotation(aItemId, this.DESCRIPTION_ANNO);
    return "";
  },

   /**
   * Check whether or not the given node represents a removable entry (either in
   * history or in bookmarks).
   *
   * @param aNode
   *        a node, except the root node of a query.
   * @return true if the aNode represents a removable entry, false otherwise.
   */
  canUserRemove: function (aNode) {
    let parentNode = aNode.parent;
    if (!parentNode)
      throw new Error("canUserRemove doesn't accept root nodes");

    // If it's not a bookmark, we can remove it unless it's a child of a
    // livemark.
    if (aNode.itemId == -1) {
      // Rather than executing a db query, checking the existence of the feedURI
      // annotation, detect livemark children by the fact that they are the only
      // direct non-bookmark children of bookmark folders.
      return !PlacesUtils.nodeIsFolder(parentNode);
    }

    // Generally it's always possible to remove children of a query.
    if (PlacesUtils.nodeIsQuery(parentNode))
      return true;

    // Otherwise it has to be a child of an editable folder.
    return !this.isContentsReadOnly(parentNode);
  },

  /**
   * DO NOT USE THIS API IN ADDONS. IT IS VERY LIKELY TO CHANGE WHEN THE SWITCH
   * TO GUIDS IS COMPLETE (BUG 1071511).
   *
   * Check whether or not the given node or item-id points to a folder which
   * should not be modified by the user (i.e. its children should be unremovable
   * and unmovable, new children should be disallowed, etc).
   * These semantics are not inherited, meaning that read-only folder may
   * contain editable items (for instance, the places root is read-only, but all
   * of its direct children aren't).
   *
   * You should only pass folder item ids or folder nodes for aNodeOrItemId.
   * While this is only enforced for the node case (if an item id of a separator
   * or a bookmark is passed, false is returned), it's considered the caller's
   * job to ensure that it checks a folder.
   * Also note that folder-shortcuts should only be passed as result nodes.
   * Otherwise they are just treated as bookmarks (i.e. false is returned).
   *
   * @param aNodeOrItemId
   *        any item id or result node.
   * @throws if aNodeOrItemId is neither an item id nor a folder result node.
   * @note livemark "folders" are considered read-only (but see bug 1072833).
   * @return true if aItemId points to a read-only folder, false otherwise.
   */
  isContentsReadOnly: function (aNodeOrItemId) {
    let itemId;
    if (typeof(aNodeOrItemId) == "number") {
      itemId = aNodeOrItemId;
    }
    else if (PlacesUtils.nodeIsFolder(aNodeOrItemId)) {
      itemId = PlacesUtils.getConcreteItemId(aNodeOrItemId);
    }
    else {
      throw new Error("invalid value for aNodeOrItemId");
    }

    if (itemId == PlacesUtils.placesRootId || IsLivemark(itemId))
      return true;

    // leftPaneFolderId, and as a result, allBookmarksFolderId, is a lazy getter
    // performing at least a synchronous DB query (and on its very first call
    // in a fresh profile, it also creates the entire structure).
    // Therefore we don't want to this function, which is called very often by
    // isCommandEnabled, to ever be the one that invokes it first, especially
    // because isCommandEnabled may be called way before the left pane folder is
    // even created (for example, if the user only uses the bookmarks menu or
    // toolbar for managing bookmarks).  To do so, we avoid comparing to those
    // special folder if the lazy getter is still in place.  This is safe merely
    // because the only way to access the left pane contents goes through
    // "resolving" the leftPaneFolderId getter.
    if ("get" in Object.getOwnPropertyDescriptor(this, "leftPaneFolderId"))
      return false;

    return itemId == this.leftPaneFolderId ||
           itemId == this.allBookmarksFolderId;;
  },

  /**
   * Gives the user a chance to cancel loading lots of tabs at once
   */
  _confirmOpenInTabs: function PUIU__confirmOpenInTabs(numTabsToOpen) {
    const WARN_ON_OPEN_PREF = "browser.tabs.warnOnOpen";
    var reallyOpen = true;

    if (Services.prefs.getBoolPref(WARN_ON_OPEN_PREF)) {
      if (numTabsToOpen >= Services.prefs.getIntPref("browser.tabs.maxOpenBeforeWarn")) {
        // default to true: if it were false, we wouldn't get this far
        var warnOnOpen = { value: true };

        var messageKey = "tabs.openWarningMultipleBranded";
        var openKey = "tabs.openButtonMultiple";
        const BRANDING_BUNDLE_URI = "chrome://branding/locale/brand.properties";
        var brandShortName = Components.classes["@mozilla.org/intl/stringbundle;1"]
                                       .getService(Components.interfaces.nsIStringBundleService)
                                       .createBundle(BRANDING_BUNDLE_URI)
                                       .GetStringFromName("brandShortName");

        var buttonPressed = Services.prompt.confirmEx(
          this._getCurrentActiveWin(),
          this.getString("tabs.openWarningTitle"),
          this.getFormattedString(messageKey, [numTabsToOpen, brandShortName]),
          (Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
            (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1),
          this.getString(openKey), null, null,
          this.getFormattedString("tabs.openWarningPromptMeBranded",
                                  [brandShortName]),
          warnOnOpen
        );

        reallyOpen = (buttonPressed == 0);
        // don't set the pref unless they press OK and it's false
        if (reallyOpen && !warnOnOpen.value)
          Services.prefs.setBoolPref(WARN_ON_OPEN_PREF, false);
      }
    }

    return reallyOpen;
  },

  /** aItemsToOpen needs to be an array of objects of the form:
    * {uri: string, isBookmark: boolean}
    */
  _openTabset: function (aItemsToOpen, aEvent, aWhere) {
    if (!aItemsToOpen.length)
      return;

    var urls = [];
    for (let item of aItemsToOpen) {
      if (item.isBookmark)
        this.markPageAsFollowedBookmark(item.uri);
      else
        this.markPageAsTyped(item.uri);

      urls.push(item.uri);
    }

    var browserWindow = this._getTopBrowserWin();
    if (browserWindow) {
      let where = aWhere || browserWindow.whereToOpenLink(aEvent, false, true);
      browserWindow.openUILinkArrayIn(urls, where);
    }
    else {
      let win = this._getCurrentActiveWin();
      win.openDialog(win.getBrowserURL(), "_blank",
                     "chrome,all,dialog=no", urls.join("\n"));
    }
  },

  openContainerNodeInTabs: function PUIU_openContainerInTabs(aNode, aEvent, aWhere) {
    var urlsToOpen = PlacesUtils.getURLsForContainerNode(aNode);
    if (!this._confirmOpenInTabs(urlsToOpen.length))
      return;

    this._openTabset(urlsToOpen, aEvent, aWhere);
  },

  openURINodesInTabs: function PUIU_openURINodesInTabs(aNodes, aEvent) {
    this.openSelectionIn(aNodes, null, aEvent);
  },

  openSelectionIn: function (aNodes, aWhere, aEvent) {
    var urlsToOpen = [];
    for (let node of aNodes) {
      // skip over separators and folders
      if (PlacesUtils.nodeIsURI(node))
        urlsToOpen.push({uri: node.uri, isBookmark: PlacesUtils.nodeIsBookmark(node)});
    }
    this._openTabset(urlsToOpen, aEvent, aWhere);
  },

  /**
   * Loads the node's URL in the appropriate tab or window or as a web
   * panel given the user's preference specified by modifier keys tracked by a
   * DOM mouse/key event.
   * @param   aNode
   *          An uri result node.
   * @param   aEvent
   *          The DOM mouse/key event with modifier keys set that track the
   *          user's preferred destination window or tab.
   */
  openNodeWithEvent: function PUIU_openNodeWithEvent(aNode, aEvent) {
    this.openNodeIn(aNode, this._getCurrentActiveWin().whereToOpenLink(aEvent, false, true));
  },

  /**
   * Loads the node's URL in the appropriate tab or window or as a
   * web panel.
   * see also openUILinkIn
   */
  openNodeIn: function PUIU_openNodeIn(aNode, aWhere) {
    if (!aNode || !aWhere)
      return;
    var win = this._getCurrentActiveWin();
    if (PlacesUtils.nodeIsContainer(aNode) && aWhere != "current") {
      this.openContainerNodeInTabs(aNode, null, aWhere);
    } else if (PlacesUtils.nodeIsURI(aNode) && this.checkURLSecurity(aNode, win)) {
      var isBookmark = PlacesUtils.nodeIsBookmark(aNode);

      if (isBookmark)
        this.markPageAsFollowedBookmark(aNode.uri);
      else
        this.markPageAsTyped(aNode.uri);

      win.openUILinkIn(aNode.uri, aWhere);
    }
  },

  /**
   * Helper for guessing scheme from an url string.
   * Used to avoid nsIURI overhead in frequently called UI functions.
   *
   * @param aUrlString the url to guess the scheme from.
   *
   * @return guessed scheme for this url string.
   *
   * @note this is not supposed be perfect, so use it only for UI purposes.
   */
  guessUrlSchemeForUI: function PUIU_guessUrlSchemeForUI(aUrlString) {
    return aUrlString.substr(0, aUrlString.indexOf(":"));
  },

  getBestTitle: function PUIU_getBestTitle(aNode) {
    var title;
    if (!aNode.title && PlacesUtils.nodeIsURI(aNode)) {
      // if node title is empty, try to set the label using host and filename
      // PlacesUtils._uri() will throw if aNode.uri is not a valid URI
      try {
        var uri = PlacesUtils._uri(aNode.uri);
        var host = uri.host;
        var fileName = uri.QueryInterface(Components.interfaces.nsIURL).fileName;
        // if fileName is empty, use path to distinguish labels
        title = host + (fileName ?
                        (host ? "/" + this.ellipsis + "/" : "") + fileName :
                        uri.path);
      }
      catch (e) {
        // Use (no title) for non-standard URIs (data:, javascript:, ...)
        title = "";
      }
    }
    else
      title = aNode.title;

    return title || this.getString("noTitle");
  },

  get leftPaneQueries() {
    // build the map
    this.leftPaneFolderId;
    return this.leftPaneQueries;
  },

  // Get the folder id for the organizer left-pane folder.
  get leftPaneFolderId() {
    let leftPaneRoot = -1;
    let allBookmarksId;

    // Shortcuts to services.
    let bs = PlacesUtils.bookmarks;
    let as = PlacesUtils.annotations;

    // This is the list of the left pane queries.
    let queries = {
      "PlacesRoot": { title: "" },
      "History": { title: this.getString("OrganizerQueryHistory") },
      "Tags": { title: this.getString("OrganizerQueryTags") },
      "AllBookmarks": { title: this.getString("OrganizerQueryAllBookmarks") },
      "BookmarksToolbar":
        { title: null,
          concreteTitle: PlacesUtils.getString("BookmarksToolbarFolderTitle"),
          concreteId: PlacesUtils.toolbarFolderId },
      "BookmarksMenu":
        { title: null,
          concreteTitle: PlacesUtils.getString("BookmarksMenuFolderTitle"),
          concreteId: PlacesUtils.bookmarksMenuFolderId },
      "UnfiledBookmarks":
        { title: null,
          concreteTitle: PlacesUtils.getString("OtherBookmarksFolderTitle"),
          concreteId: PlacesUtils.unfiledBookmarksFolderId },
    };
    // All queries but PlacesRoot.
    const EXPECTED_QUERY_COUNT = 6;

    // Removes an item and associated annotations, ignoring eventual errors.
    function safeRemoveItem(aItemId) {
      try {
        if (as.itemHasAnnotation(aItemId, PlacesUIUtils.ORGANIZER_QUERY_ANNO) &&
            !(as.getItemAnnotation(aItemId, PlacesUIUtils.ORGANIZER_QUERY_ANNO) in queries)) {
          // Some extension annotated their roots with our query annotation,
          // so we should not delete them.
          return;
        }
        // removeItemAnnotation does not check if item exists, nor the anno,
        // so this is safe to do.
        as.removeItemAnnotation(aItemId, PlacesUIUtils.ORGANIZER_FOLDER_ANNO);
        as.removeItemAnnotation(aItemId, PlacesUIUtils.ORGANIZER_QUERY_ANNO);
        // This will throw if the annotation is an orphan.
        bs.removeItem(aItemId);
      }
      catch(e) { /* orphan anno */ }
    }

    // Returns true if item really exists, false otherwise.
    function itemExists(aItemId) {
      try {
        bs.getItemIndex(aItemId);
        return true;
      }
      catch(e) {
        return false;
      }
    }

    // Get all items marked as being the left pane folder.
    let items = as.getItemsWithAnnotation(this.ORGANIZER_FOLDER_ANNO);
    if (items.length > 1) {
      // Something went wrong, we cannot have more than one left pane folder,
      // remove all left pane folders and continue.  We will create a new one.
      items.forEach(safeRemoveItem);
    }
    else if (items.length == 1 && items[0] != -1) {
      leftPaneRoot = items[0];
      // Check that organizer left pane root is valid.
      let version = as.getItemAnnotation(leftPaneRoot, this.ORGANIZER_FOLDER_ANNO);
      if (version != this.ORGANIZER_LEFTPANE_VERSION ||
          !itemExists(leftPaneRoot)) {
        // Invalid root, we must rebuild the left pane.
        safeRemoveItem(leftPaneRoot);
        leftPaneRoot = -1;
      }
    }

    if (leftPaneRoot != -1) {
      // A valid left pane folder has been found.
      // Build the leftPaneQueries Map.  This is used to quickly access them,
      // associating a mnemonic name to the real item ids.
      delete this.leftPaneQueries;
      this.leftPaneQueries = {};

      let items = as.getItemsWithAnnotation(this.ORGANIZER_QUERY_ANNO);
      // While looping through queries we will also check for their validity.
      let queriesCount = 0;
      for (let i = 0; i < items.length; i++) {
        let queryName = as.getItemAnnotation(items[i], this.ORGANIZER_QUERY_ANNO);

        // Some extension did use our annotation to decorate their items
        // with icons, so we should check only our elements, to avoid dataloss.
        if (!(queryName in queries))
          continue;

        let query = queries[queryName];
        query.itemId = items[i];

        if (!itemExists(query.itemId)) {
          // Orphan annotation, bail out and create a new left pane root.
          break;
        }

        // Check that all queries have valid parents.
        let parentId = bs.getFolderIdForItem(query.itemId);
        if (items.indexOf(parentId) == -1 && parentId != leftPaneRoot) {
          // The parent is not part of the left pane, bail out and create a new
          // left pane root.
          break;
        }

        // Titles could have been corrupted or the user could have changed his
        // locale.  Check title and eventually fix it.
        if (bs.getItemTitle(query.itemId) != query.title)
          bs.setItemTitle(query.itemId, query.title);
        if ("concreteId" in query) {
          if (bs.getItemTitle(query.concreteId) != query.concreteTitle)
            bs.setItemTitle(query.concreteId, query.concreteTitle);
        }

        // Add the query to our cache.
        this.leftPaneQueries[queryName] = query.itemId;
        queriesCount++;
      }

      if (queriesCount != EXPECTED_QUERY_COUNT) {
        // Queries number is wrong, so the left pane must be corrupt.
        // Note: we can't just remove the leftPaneRoot, because some query could
        // have a bad parent, so we have to remove all items one by one.
        items.forEach(safeRemoveItem);
        safeRemoveItem(leftPaneRoot);
      }
      else {
        // Everything is fine, return the current left pane folder.
        delete this.leftPaneFolderId;
        return this.leftPaneFolderId = leftPaneRoot;
      }
    }

    // Create a new left pane folder.
    var callback = {
      // Helper to create an organizer special query.
      create_query: function CB_create_query(aQueryName, aParentId, aQueryUrl) {
        let itemId = bs.insertBookmark(aParentId,
                                       PlacesUtils._uri(aQueryUrl),
                                       bs.DEFAULT_INDEX,
                                       queries[aQueryName].title);
        // Mark as special organizer query.
        as.setItemAnnotation(itemId, PlacesUIUtils.ORGANIZER_QUERY_ANNO, aQueryName,
                             0, as.EXPIRE_NEVER);
        // We should never backup this, since it changes between profiles.
        as.setItemAnnotation(itemId, PlacesUtils.EXCLUDE_FROM_BACKUP_ANNO, 1,
                             0, as.EXPIRE_NEVER);
        // Add to the queries map.
        PlacesUIUtils.leftPaneQueries[aQueryName] = itemId;
        return itemId;
      },

      // Helper to create an organizer special folder.
      create_folder: function CB_create_folder(aFolderName, aParentId, aIsRoot) {
              // Left Pane Root Folder.
        let folderId = bs.createFolder(aParentId,
                                       queries[aFolderName].title,
                                       bs.DEFAULT_INDEX);
        // We should never backup this, since it changes between profiles.
        as.setItemAnnotation(folderId, PlacesUtils.EXCLUDE_FROM_BACKUP_ANNO, 1,
                             0, as.EXPIRE_NEVER);

        if (aIsRoot) {
          // Mark as special left pane root.
          as.setItemAnnotation(folderId, PlacesUIUtils.ORGANIZER_FOLDER_ANNO,
                               PlacesUIUtils.ORGANIZER_LEFTPANE_VERSION,
                               0, as.EXPIRE_NEVER);
        }
        else {
          // Mark as special organizer folder.
          as.setItemAnnotation(folderId, PlacesUIUtils.ORGANIZER_QUERY_ANNO,
                               aFolderName, 0, as.EXPIRE_NEVER);
          PlacesUIUtils.leftPaneQueries[aFolderName] = folderId;
        }
        return folderId;
      },

      runBatched: function CB_runBatched(aUserData) {
        delete PlacesUIUtils.leftPaneQueries;
        PlacesUIUtils.leftPaneQueries = { };

        // Left Pane Root Folder.
        leftPaneRoot = this.create_folder("PlacesRoot", bs.placesRoot, true);

        // Tags Query.
        this.create_query("Tags", leftPaneRoot,
                          "place:type=" +
                          Components.interfaces.nsINavHistoryQueryOptions.RESULTS_AS_TAG_QUERY +
                          "&sort=" +
                          Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_TITLE_ASCENDING);

        // All Bookmarks Folder.
        allBookmarksId = this.create_folder("AllBookmarks", leftPaneRoot, false);

        // All Bookmarks->Bookmarks Toolbar Query.
        this.create_query("BookmarksToolbar", allBookmarksId,
                          "place:folder=TOOLBAR");

        // All Bookmarks->Bookmarks Menu Query.
        this.create_query("BookmarksMenu", allBookmarksId,
                          "place:folder=BOOKMARKS_MENU");

        // All Bookmarks->Unfiled Bookmarks Query.
        this.create_query("UnfiledBookmarks", allBookmarksId,
                          "place:folder=UNFILED_BOOKMARKS");
      }
    };
    bs.runInBatchMode(callback, null);

    delete this.leftPaneFolderId;
    return this.leftPaneFolderId = leftPaneRoot;
  },

  /**
   * Get the folder id for the organizer left-pane folder.
   */
  get allBookmarksFolderId() {
    // ensure the left-pane root is initialized;
    this.leftPaneFolderId;
    delete this.allBookmarksFolderId;
    return this.allBookmarksFolderId = this.leftPaneQueries["AllBookmarks"];
  },

  /**
   * If an item is a left-pane query, returns the name of the query
   * or an empty string if not.
   *
   * @param aItemId id of a container
   * @returns the name of the query, or empty string if not a left-pane query
   */
  getLeftPaneQueryNameFromId: function PUIU_getLeftPaneQueryNameFromId(aItemId) {
    var queryName = "";
    // If the let pane hasn't been built, use the annotation service
    // directly, to avoid building the left pane too early.
    if (Object.getOwnPropertyDescriptor(this, "leftPaneFolderId").value === undefined) {
      try {
        queryName = PlacesUtils.annotations.
                                getItemAnnotation(aItemId, this.ORGANIZER_QUERY_ANNO);
      }
      catch (ex) {
        // doesn't have the annotation
        queryName = "";
      }
    }
    else {
      // If the left pane has already been built, use the name->id map
      // cached in PlacesUIUtils.
      for (let [name, id] in Iterator(this.leftPaneQueries)) {
        if (aItemId == id)
          queryName = name;
      }
    }
    return queryName;
  }
};

XPCOMUtils.defineLazyServiceGetter(PlacesUIUtils, "xulStore",
                                   "@mozilla.org/xul/xulstore;1",
                                   "nsIXULStore");

XPCOMUtils.defineLazyGetter(PlacesUIUtils, "ellipsis", function() {
  return Services.prefs.getComplexValue("intl.ellipsis",
                                        Components.interfaces.nsIPrefLocalizedString).data;
});

XPCOMUtils.defineLazyServiceGetter(this, "URIFixup",
                                   "@mozilla.org/docshell/urifixup;1",
                                   "nsIURIFixup");

XPCOMUtils.defineLazyGetter(this, "bundle", function() {
  const PLACES_STRING_BUNDLE_URI =
    "chrome://communicator/locale/places/places.properties";
  return Components.classes["@mozilla.org/intl/stringbundle;1"]
                   .getService(Components.interfaces.nsIStringBundleService)
                   .createBundle(PLACES_STRING_BUNDLE_URI);
});

XPCOMUtils.defineLazyServiceGetter(this, "focusManager",
                                   "@mozilla.org/focus-manager;1",
                                   "nsIFocusManager");

/**
 * This is a compatibility shim for old PUIU.ptm users.
 *
 * If you're looking for transactions and writing new code using them, directly
 * use the transactions objects exported by the PlacesUtils.jsm module.
 *
 * This object will be removed once enough users are converted to the new API.
 */
XPCOMUtils.defineLazyGetter(PlacesUIUtils, "ptm", function() {
  // Ensure PlacesUtils is imported in scope.
  PlacesUtils;

  return {
    aggregateTransactions: function(aName, aTransactions) {
      return new PlacesAggregatedTransaction(aName, aTransactions);
    },

    createFolder: function(aName, aContainer, aIndex, aAnnotations,
                           aChildItemsTransactions) {
      return new PlacesCreateFolderTransaction(aName, aContainer, aIndex, aAnnotations,
                                               aChildItemsTransactions);
    },

    createItem: function(aURI, aContainer, aIndex, aTitle, aKeyword,
                         aAnnotations, aChildTransactions) {
      return new PlacesCreateBookmarkTransaction(aURI, aContainer, aIndex, aTitle,
                                                 aKeyword, aAnnotations,
                                                 aChildTransactions);
    },

    createSeparator: function(aContainer, aIndex) {
      return new PlacesCreateSeparatorTransaction(aContainer, aIndex);
    },

    createLivemark: function(aFeedURI, aSiteURI, aName, aContainer, aIndex,
                             aAnnotations) {
      return new PlacesCreateLivemarkTransaction(aFeedURI, aSiteURI, aName, aContainer,
                                                 aIndex, aAnnotations);
    },

    moveItem: function(aItemId, aNewContainer, aNewIndex) {
      return new PlacesMoveItemTransaction(aItemId, aNewContainer, aNewIndex);
    },

    removeItem: function(aItemId) {
      return new PlacesRemoveItemTransaction(aItemId);
    },

    editItemTitle: function(aItemId, aNewTitle) {
      return new PlacesEditItemTitleTransaction(aItemId, aNewTitle);
    },

    editBookmarkURI: function(aItemId, aNewURI) {
      return new PlacesEditBookmarkURITransaction(aItemId, aNewURI);
    },

    setItemAnnotation: function(aItemId, aAnnotationObject) {
      return new PlacesSetItemAnnotationTransaction(aItemId, aAnnotationObject);
    },

    setPageAnnotation: function(aURI, aAnnotationObject) {
      return new PlacesSetPageAnnotationTransaction(aURI, aAnnotationObject);
    },

    editBookmarkKeyword: function(aItemId, aNewKeyword) {
      return new PlacesEditBookmarkKeywordTransaction(aItemId, aNewKeyword);
    },

    editBookmarkPostData: function(aItemId, aPostData) {
      return new PlacesEditBookmarkPostDataTransaction(aItemId, aPostData);
    },

    editLivemarkSiteURI: function(aLivemarkId, aSiteURI) {
      return new PlacesEditLivemarkSiteURITransaction(aLivemarkId, aSiteURI);
    },

    editLivemarkFeedURI: function(aLivemarkId, aFeedURI) {
      return new PlacesEditLivemarkFeedURITransaction(aLivemarkId, aFeedURI);
    },

    editItemDateAdded: function(aItemId, aNewDateAdded) {
      return new PlacesEditItemDateAddedTransaction(aItemId, aNewDateAdded);
    },

    editItemLastModified: function(aItemId, aNewLastModified) {
      return new PlacesEditItemLastModifiedTransaction(aItemId, aNewLastModified);
    },

    sortFolderByName: function(aFolderId) {
      return new PlacesSortFolderByNameTransaction(aFolderId);
    },

    tagURI: function(aURI, aTags) {
      return new PlacesTagURITransaction(aURI, aTags);
    },

    untagURI: function(aURI, aTags) {
      return new PlacesUntagURITransaction(aURI, aTags);
    },

   /**
    * Transaction for editing the description of a bookmark or a folder.
    *
    * @param aItemId
    *        id of the item to edit.
    * @param aDescription
    *        new description.
    * @returns nsITransaction object.
    */
    editItemDescription: function(aItemId, aDescription)
    {
      let annoObj = { name: PlacesUIUtils.DESCRIPTION_ANNO,
                      type: Components.interfaces.nsIAnnotationService.TYPE_STRING,
                      flags: 0,
                      value: aDescription,
                      expires: Components.interfaces.nsIAnnotationService.EXPIRE_NEVER };
      return new PlacesSetItemAnnotationTransaction(aItemId, annoObj);
    },

    ////////////////////////////////////////////////////////////////////////////
    //// nsITransactionManager forwarders.

    beginBatch: function() {
      PlacesUtils.transactionManager.beginBatch(null);
    },

    endBatch: function() {
      PlacesUtils.transactionManager.endBatch(false);
    },

    doTransaction: function(txn) {
      PlacesUtils.transactionManager.doTransaction(txn);
    },

    undoTransaction: function() {
      PlacesUtils.transactionManager.undoTransaction();
    },

    redoTransaction: function() {
      PlacesUtils.transactionManager.redoTransaction();
    },

    get numberOfUndoItems() {
      return PlacesUtils.transactionManager.numberOfUndoItems;
    },
    get numberOfRedoItems() {
      return PlacesUtils.transactionManager.numberOfRedoItems;
    },
    get maxTransactionCount() {
      return PlacesUtils.transactionManager.maxTransactionCount;
    },
    set maxTransactionCount(val) {
      return PlacesUtils.transactionManager.maxTransactionCount = val;
    },

    clear: function() {
      PlacesUtils.transactionManager.clear();
    },

    peekUndoStack: function() {
      return PlacesUtils.transactionManager.peekUndoStack();
    },

    peekRedoStack: function() {
      return PlacesUtils.transactionManager.peekRedoStack();
    },

    getUndoStack: function() {
      return PlacesUtils.transactionManager.getUndoStack();
    },

    getRedoStack: function() {
      return PlacesUtils.transactionManager.getRedoStack();
    },

    AddListener: function(aListener) {
      PlacesUtils.transactionManager.AddListener(aListener);
    },

    RemoveListener: function(aListener) {
      PlacesUtils.transactionManager.RemoveListener(aListener);
    }
  }
});

XPCOMUtils.defineLazyGetter(PlacesUIUtils, "_copyableAnnotations", function() {
  return [this.DESCRIPTION_ANNO,
          this.LOAD_IN_SIDEBAR_ANNO,
          PlacesUtils.POST_DATA_ANNO,
          PlacesUtils.READ_ONLY_ANNO]
});
