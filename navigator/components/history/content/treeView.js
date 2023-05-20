/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function PlacesTreeView() {
  this._tree = null;
  this._result = null;
  this._selection = null;
  this._rows = [];
  this._rootNode = null;
}

PlacesTreeView.prototype = {
  __dateService: null,
  get _dateService() {
    if (!this.__dateService) {
      this.__dateService = Components.classes["@mozilla.org/intl/scriptabledateformat;1"]
                                     .getService(Components.interfaces.nsIScriptableDateFormat);
    }
    return this.__dateService;
  },

  QueryInterface: function PTV_QueryInterface(aIID) {
    if (aIID.equals(Components.interfaces.nsITreeView) ||
        aIID.equals(Components.interfaces.nsINavHistoryResultObserver) ||
        aIID.equals(Components.interfaces.nsINavHistoryResultTreeViewer) ||
        aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
        aIID.equals(Components.interfaces.nsISupports))
      return this;

    throw Components.results.NS_ERROR_NO_INTERFACE;
  },

  /**
   * This is called once both the result and the tree are set.
   */
  _finishInit: function PTV__finishInit() {
    var selection = this.selection;
    if (selection)
      selection.selectEventsSuppressed = true;

    if (!this._rootNode.containerOpen) {
      // This triggers containerStateChanged which then builds the visible section.
      this._rootNode.containerOpen = true;
    }
    else
      this.invalidateContainer(this._rootNode);

    // "Activate" the sorting column and update commands.
    this.sortingChanged(this._result.sortingMode);

    if (selection)
      selection.selectEventsSuppressed = false;
  },

  /**
   * Plain Container: container result nodes which may never include sub
   * hierarchies.
   *
   * When the rows array is constructed, we don't set the children of plain
   * containers.  Instead, we keep placeholders for these children.  We then
   * build these children lazily as the tree asks us for information about each
   * row.  Luckily, the tree doesn't ask about rows outside the visible area.
   *
   * @see _getNodeForRow and _getRowForNode for the actual magic.
   *
   * @note It's guaranteed that all containers are listed in the rows
   * elements array.
   *
   * @param aContainer
   *        A container result node.
   *
   * @return true if aContainer is a plain container, false otherwise.
   */
  _isPlainContainer: function PTV__isPlainContainer(aContainer) {
    // All history containers are query containers, but we need to QI
    aContainer.QueryInterface(Components.interfaces.nsINavHistoryQueryResultNode);

    // Of all history containers, only URI containers are flat, and they don't
    // contain folders, no need to check that either.
    return aContainer.queryOptions.resultType ==
               Components.interfaces.nsINavHistoryQueryOptions.RESULTS_AS_URI;
  },

  /**
   * Gets the row number for a given node.  Assumes that the given node is
   * visible (i.e. it's not an obsolete node).
   *
   * @param aNode
   *        A result node.  Do not pass an obsolete node, or any
   *        node which isn't supposed to be in the tree.
   * @param [optional] aForceBuild
   *        @see _isPlainContainer.
   *        If true, the row will be computed even if the node still isn't set
   *        in our rows array.
   * @param [optional] aParentRow
   *        The row of aNode's parent.
   *        DO NOT compute this yourself for the purpose of calling this
   *        function.  However, do pass it if you have it handy.
   *        Ignored for the root node.
   * @param [optional] aNodeIndex
   *        The index of aNode in its parent.  Only used if aParentRow is
   *        set too.
   *
   * @throws if aNode is invisible.
   * @return aNode's row if it's in the rows list or if aForceBuild is set, -1
   *         otherwise.
   */
  _getRowForNode:
  function PTV__getRowForNode(aNode, aForceBuild, aParentRow, aNodeIndex) {
    if (aNode == this._rootNode)
      throw new Error("The root node is never visible");

    // A node is removed form the view either if it has no parent or if its
    // root-ancestor is not the root node (in which case that's the node
    // for which nodeRemoved was called).
    let ancestors = Array.from(PlacesUtils.nodeAncestors(aNode));
    if (ancestors.length == 0 ||
        ancestors[ancestors.length - 1] != this._rootNode) {
      throw new Error("Removed node passed to _getRowForNode");
    }

    // Ensure that the entire chain is open, otherwise that node is invisible.
    for (let ancestor of ancestors) {
      if (!ancestor.containerOpen)
        throw new Error("Invisible node passed to _getRowForNode");
    }

    // Non-plain containers are initially built with their contents.
    let parent = aNode.parent;
    let parentIsPlain = this._isPlainContainer(parent);
    if (!parentIsPlain) {
      if (parent == this._rootNode)
        return this._rows.indexOf(aNode);

      return this._rows.indexOf(aNode, aParentRow);
    }

    let row = -1;
    let useNodeIndex = typeof(aNodeIndex) == "number";
    if (parent == this._rootNode)
      row = useNodeIndex ? aNodeIndex : this._rootNode.getChildIndex(aNode);
    else if (useNodeIndex && typeof(aParentRow) == "number") {
      // If we have both the row of the parent node, and the node's index, we
      // can avoid searching the rows array if the parent is a plain container.
      row = aParentRow + aNodeIndex + 1;
    }
    else {
      // Look for the node in the nodes array.  Start the search at the parent
      // row.  If the parent row isn't passed, we'll pass undefined to indexOf,
      // which is fine.
      row = this._rows.indexOf(aNode, aParentRow);
      if (row == -1 && aForceBuild) {
        let parentRow = typeof(aParentRow) == "number" ? aParentRow
                                                       : this._getRowForNode(parent);
        row = parentRow + parent.getChildIndex(aNode) + 1;
      }
    }

    if (row != -1)
      this._rows[row] = aNode;

    return row;
  },

  /**
   * Given a row, finds and returns the parent details of the associated node.
   *
   * @param aChildRow
   *        Row number.
   * @return [parentNode, parentRow]
   */
  _getParentByChildRow: function PTV__getParentByChildRow(aChildRow) {
    let parent = this._getNodeForRow(aChildRow).parent;

    // The root node is never visible
    if (parent == this._rootNode)
      return [this._rootNode, -1];

    let parentRow = this._rows.lastIndexOf(parent, aChildRow - 1);
    return [parent, parentRow];
  },

  /**
   * Gets the node at a given row.
   */
  _getNodeForRow: function PTV__getNodeForRow(aRow) {
    let node = this._rows[aRow];
    if (node !== undefined)
      return node;

    // Find the nearest node.
    let rowNode, row;
    for (let i = aRow - 1; i >= 0 && rowNode === undefined; i--) {
      rowNode = this._rows[i];
      row = i;
    }

    // If there's no container prior to the given row, it's a child of
    // the root node (remember: all containers are listed in the rows array).
    if (!rowNode)
      return this._rows[aRow] = this._rootNode.getChild(aRow);

    // Unset elements may exist only in plain containers.  Thus, if the nearest
    // node is a container, it's the row's parent, otherwise, it's a sibling.
    if (rowNode instanceof Components.interfaces.nsINavHistoryContainerResultNode)
      return this._rows[aRow] = rowNode.getChild(aRow - row - 1);

    let [parent, parentRow] = this._getParentByChildRow(row);
    return this._rows[aRow] = parent.getChild(aRow - parentRow - 1);
  },

  /**
   * This takes a container and recursively appends our rows array per its
   * contents.  Assumes that the rows arrays has no rows for the given
   * container.
   *
   * @param [in] aContainer
   *        A container result node.
   * @param [in] aFirstChildRow
   *        The first row at which nodes may be inserted to the row array.
   *        In other words, that's aContainer's row + 1.
   * @param [out] aToOpen
   *        An array of containers to open once the build is done.
   *
   * @return the number of rows which were inserted.
   */
  _buildVisibleSection:
  function PTV__buildVisibleSection(aContainer, aFirstChildRow, aToOpen)
  {
    // There's nothing to do if the container is closed.
    if (!aContainer.containerOpen)
      return 0;

    // Inserting the new elements into the rows array in one shot (by
    // Array.concat) is faster than resizing the array (by splice) on each loop
    // iteration.
    var cc = aContainer.childCount;
    var newElements = new Array(cc);
    this._rows = this._rows.splice(0, aFirstChildRow)
                           .concat(newElements, this._rows);

    if (this._isPlainContainer(aContainer))
      return cc;

    var sortingMode = this._result.sortingMode;

    var rowsInserted = 0;
    for (let i = 0; i < cc; i++) {
      var curChild = aContainer.getChild(i);
      var curChildType = curChild.type;

      var row = aFirstChildRow + rowsInserted;

      this._rows[row] = curChild;
      rowsInserted++;

      // recursively do containers
      if (curChild instanceof Components.interfaces.nsINavHistoryContainerResultNode) {
        NS_ASSERT(curChild.uri, "if there is no uri, we can't persist the open state");
        var isopen = curChild.uri &&
                     PlacesUIUtils.xulStore.hasValue(location, curChild.uri, "open");
        if (isopen != curChild.containerOpen)
          aToOpen.push(curChild);
        else if (curChild.containerOpen && curChild.childCount > 0)
          rowsInserted += this._buildVisibleSection(curChild, row + 1, aToOpen);
      }
    }

    return rowsInserted;
  },

  /**
   * This counts how many rows a node takes in the tree.  For containers it
   * will count the node itself plus any child node following it.
   */
  _countVisibleRowsForNodeAtRow:
  function PTV__countVisibleRowsForNodeAtRow(aNodeRow) {
    let node = this._rows[aNodeRow];

    // If it's not listed yet, we know that it's a leaf node (instanceof also
    // null-checks).
    if (!(node instanceof Components.interfaces.nsINavHistoryContainerResultNode))
      return 1;

    let outerLevel = node.indentLevel;
    for (let i = aNodeRow + 1; i < this._rows.length; i++) {
      let rowNode = this._rows[i];
      if (rowNode && rowNode.indentLevel <= outerLevel)
        return i - aNodeRow;
    }

    // This node plus its children take up the bottom of the list.
    return this._rows.length - aNodeRow;
  },

  _getSelectedNodesInRange:
  function PTV__getSelectedNodesInRange(aFirstRow, aLastRow) {
    var selection = this.selection;
    var rc = selection.getRangeCount();
    if (rc == 0)
      return [];

    // The visible-area borders are needed for checking whether a
    // selected row is also visible.
    var firstVisibleRow = this._tree.getFirstVisibleRow();
    var lastVisibleRow = this._tree.getLastVisibleRow();

    var nodesInfo = [];
    for (let rangeIndex = 0; rangeIndex < rc; rangeIndex++) {
      let min = { }, max = { };
      selection.getRangeAt(rangeIndex, min, max);

      // If this range does not overlap the replaced chunk, we don't need to
      // persist the selection.
      if (max.value < aFirstRow || min.value > aLastRow)
        continue;

      let firstRow = Math.max(min.value, aFirstRow);
      let lastRow = Math.min(max.value, aLastRow);
      for (let i = firstRow; i <= lastRow; i++) {
        nodesInfo.push({
          node: this._rows[i],
          oldRow: i,
          wasVisible: i >= firstVisibleRow && i <= lastVisibleRow
        });
      }
    }

    return nodesInfo;
  },

  /**
   * Tries to find an equivalent node for a node which was removed.  We first
   * look for the original node, in case it was just relocated.  Then, if we
   * that node was not found, we look for a node that has the same itemId, uri
   * and time values.
   *
   * @param aUpdatedContainer
   *        An ancestor of the node which was removed.  It does not have to be
   *        its direct parent.
   * @param aOldNode
   *        The node which was removed.
   *
   * @return the row number of an equivalent node for aOldOne, if one was
   *         found, -1 otherwise.
   */
  _getNewRowForRemovedNode:
  function PTV__getNewRowForRemovedNode(aUpdatedContainer, aOldNode) {
    var parent = aOldNode.parent;
    if (parent) {
      // If the node's parent is still set, the node is not obsolete
      // and we should just find out its new position.
      // However, if any of the node's ancestor is closed, the node is
      // invisible.
      let ancestors = PlacesUtils.nodeAncestors(aOldNode);
      for (let ancestor of ancestors) {
        if (!ancestor.containerOpen)
          return -1;
      }

      return this._getRowForNode(aOldNode, true);
    }

    // There's a broken edge case here.
    // If a visit appears in two queries, and the second one was
    // the old node, we'll select the first one after refresh.  There's
    // nothing we could do about that, because aOldNode.parent is
    // gone by the time invalidateContainer is called.
    var newNode = aUpdatedContainer.findNodeByDetails(aOldNode.uri,
                                                      aOldNode.time,
                                                      aOldNode.itemId,
                                                      true);
    if (!newNode)
      return -1;

    return this._getRowForNode(newNode, true);
  },

  /**
   * Restores a given selection state as near as possible to the original
   * selection state.
   *
   * @param aNodesInfo
   *        The persisted selection state as returned by
   *        _getSelectedNodesInRange.
   * @param aUpdatedContainer
   *        The container which was updated.
   */
  _restoreSelection:
  function PTV__restoreSelection(aNodesInfo, aUpdatedContainer) {
    if (aNodesInfo.length == 0)
      return;

    var selection = this.selection;

    // Attempt to ensure that previously-visible selection will be visible
    // if it's re-selected.  However, we can only ensure that for one row.
    var scrollToRow = -1;
    for (let i = 0; i < aNodesInfo.length; i++) {
      let nodeInfo = aNodesInfo[i];
      let row = this._getNewRowForRemovedNode(aUpdatedContainer,
                                              aNodesInfo[i].node);
      // Select the found node, if any.
      if (row != -1) {
        selection.rangedSelect(row, row, true);
        if (nodeInfo.wasVisible && scrollToRow == -1)
          scrollToRow = row;
      }
    }

    // If only one node was previously selected and there's no selection now,
    // select the node at its old row, if any.
    if (aNodesInfo.length == 1 && selection.count == 0) {
      let row = Math.min(aNodesInfo[0].oldRow, this._rows.length - 1);
      selection.rangedSelect(row, row, true);
      if (aNodesInfo[0].wasVisible && scrollToRow == -1)
        scrollToRow = aNodesInfo[0].oldRow;
    }

    if (scrollToRow != -1)
      this._tree.ensureRowIsVisible(scrollToRow);
  },

  _convertPRTimeToString: function PTV__convertPRTimeToString(aTime) {
    var timeInMilliseconds = aTime / 1000; // PRTime is in microseconds
    var timeObj = new Date(timeInMilliseconds);

    // Check if it is today and only display the time.  Only bother
    // checking for today if it's within the last 24 hours, since
    // computing midnight is not really cheap. Sometimes we may get dates
    // in the future, so always show those.
    var ago = Date.now() - timeInMilliseconds;
    var dateFormat = Components.interfaces.nsIScriptableDateFormat.dateFormatShort;
    if (ago > -10000 && ago < (1000 * 24 * 60 * 60)) {
      var midnight = new Date();
      midnight.setHours(0);
      midnight.setMinutes(0);
      midnight.setSeconds(0);
      midnight.setMilliseconds(0);

      if (timeInMilliseconds > midnight.getTime())
        dateFormat = Components.interfaces.nsIScriptableDateFormat.dateFormatNone;
    }

    return (this._dateService.FormatDateTime("", dateFormat,
      Components.interfaces.nsIScriptableDateFormat.timeFormatNoSeconds,
      timeObj.getFullYear(), timeObj.getMonth() + 1,
      timeObj.getDate(), timeObj.getHours(),
      timeObj.getMinutes(), timeObj.getSeconds()));
  },

  // nsINavHistoryResultObserver
  nodeInserted: function PTV_nodeInserted(aParentNode, aNode, aNewIndex) {
    NS_ASSERT(this._result, "Got a notification but have no result!");
    if (!this._tree || !this._result)
      return;

    var parentRow;
    if (aParentNode != this._rootNode) {
      parentRow = this._getRowForNode(aParentNode);

      // Update parent when inserting the first item, since twisty has changed.
      if (aParentNode.childCount == 1)
        this._tree.invalidateRow(parentRow);
    }

    // Compute the new row number of the node.
    var row = -1;
    if (aNewIndex == 0 || this._isPlainContainer(aParentNode)) {
      // We don't need to worry about sub hierarchies of the parent node
      // if it's a plain container, or if the new node is its first child.
      if (aParentNode == this._rootNode)
        row = aNewIndex;
      else
        row = parentRow + aNewIndex + 1;
    }
    else {
      // Here, we try to find the next visible element in the child list so we
      // can set the new visible index to be right before that. Note that we
      // have to search down instead of up, because some siblings could have
      // children themselves that would be in the way.
      if (aNewIndex + 1 < aParentNode.childCount) {
        let node = aParentNode.getChild(aNewIndex + 1);
        // The children have not been shifted so the next item will have what
        // should be our index.
        row = this._getRowForNode(node, false, parentRow, i);
      }
      if (row < 0) {
        // At the end of the child list without finding a visible sibling. This
        // is a little harder because we don't know how many rows the last node
        // in our list takes up (it could be a container with many children).
        let prevChild = aParentNode.getChild(aNewIndex - 1);
        let prevIndex = this._getRowForNode(prevChild, false, parentRow,
                                            aNewIndex - 1);
        row = prevIndex + this._countVisibleRowsForNodeAtRow(prevIndex);
      }
    }

    this._rows.splice(row, 0, aNode);
    this._tree.rowCountChanged(row, 1);

    if (PlacesUtils.nodeIsContainer(aNode) && PlacesUtils.asContainer(aNode).containerOpen)
      this.invalidateContainer(aNode);
  },

  /**
   * THIS FUNCTION DOES NOT HANDLE cases where a collapsed node is being
   * removed but the node it is collapsed with is not being removed (this then
   * just swap out the removee with its collapsing partner). The only time
   * when we really remove things is when deleting URIs, which will apply to
   * all collapsees. This function is called sometimes when resorting nodes.
   * However, we won't do this when sorted by date because dates will never
   * change for visits, and date sorting is the only time things are collapsed.
   */
  nodeRemoved: function PTV_nodeRemoved(aParentNode, aNode, aOldIndex) {
    NS_ASSERT(this._result, "Got a notification but have no result!");
    if (!this._tree || !this._result)
      return;

    // XXX bug 517701: We don't know what to do when the root node is removed.
    if (aNode == this._rootNode)
      throw Components.results.NS_ERROR_NOT_IMPLEMENTED;

    let oldRow = this._getRowForNode(aNode, true);
    if (oldRow < 0)
      throw Components.results.NS_ERROR_UNEXPECTED;

    // If the node was exclusively selected, the node next to it will be
    // selected.
    var selectNext = false;
    var selection = this.selection;
    if (selection.getRangeCount() == 1) {
      let min = { }, max = { };
      selection.getRangeAt(0, min, max);
      if (min.value == max.value &&
          this.nodeForTreeIndex(min.value) == aNode)
        selectNext = true;
    }

    // Remove the node and its children, if any.
    var count = this._countVisibleRowsForNodeAtRow(oldRow);
    this._rows.splice(oldRow, count);
    this._tree.rowCountChanged(oldRow, -count);

    // Redraw the parent if its twisty state has changed.
    if (aParentNode != this._rootNode && !aParentNode.hasChildren) {
      let parentRow = oldRow - 1;
      this._tree.invalidateRow(parentRow);
    }

    // Restore selection if the node was exclusively selected.
    if (!selectNext)
      return;

    // Restore selection.
    var rowToSelect = Math.min(oldRow, this._rows.length - 1);
    this.selection.rangedSelect(rowToSelect, rowToSelect, true);
  },

  nodeMoved:
  function PTV_nodeMoved(aNode, aOldParent, aOldIndex, aNewParent, aNewIndex) {
    NS_ASSERT(this._result, "Got a notification but have no result!");
    if (!this._tree || !this._result)
      return;

    var oldRow = this._getRowForNode(aNode, true);

    // If this node is a container it could take up more than one row.
    var count = this._countVisibleRowsForNodeAtRow(oldRow);

    // Persist selection state.
    var nodesToReselect =
      this._getSelectedNodesInRange(oldRow, oldRow + count);
    if (nodesToReselect.length > 0)
      this.selection.selectEventsSuppressed = true;

    // Redraw the parent if its twisty state has changed.
    if (aOldParent != this._rootNode && !aOldParent.hasChildren) {
      let parentRow = oldRow - 1;
      this._tree.invalidateRow(parentRow);
    }

    // Remove node and its children, if any, from the old position.
    this._rows.splice(oldRow, count);
    this._tree.rowCountChanged(oldRow, -count);

    // Insert the node into the new position
    this.nodeInserted(aNewParent, aNode, aNewIndex);

    // Restore selection
    if (nodesToReselect.length > 0) {
      this._restoreSelection(nodesToReselect, aNewParent);
      this.selection.selectEventsSuppressed = false;
    }
  },

  /**
   * Be careful, the parameter 'aIndex' here specifies the node's index in the
   * parent node, not the visible index.
   */
  nodeReplaced:
  function PTV_nodeReplaced(aParentNode, aOldNode, aNewNode, aIndexDoNotUse) {
    NS_ASSERT(this._result, "Got a notification but have no result!");
    if (!this._tree || !this._result)
      return;

    // Nothing to do if the replaced node was not set.
    var row = this._getRowForNode(aOldNode);
    if (row != -1) {
      this._rows[row] = aNewNode;
      this._tree.invalidateRow(row);
    }
  },

  // This is _invalidateCellValue in the original implementation.
  invalidateNode: function PTV_invalidateNode(aNode) {
    NS_ASSERT(this._result, "Got a notification but have no result!");
    var viewIndex = aNode.viewIndex;
    if (this._tree && viewIndex >= 0)
      this._tree.invalidateRow(viewIndex);
  },

  nodeTitleChanged: function PTV_nodeTitleChanged(aNode, aNewTitle) {
    this.invalidateNode(aNode);
  },

  nodeURIChanged: function PTV_nodeURIChanged(aNode, aNewURI) { },

  nodeIconChanged: function PTV_nodeIconChanged(aNode) { },

  nodeHistoryDetailsChanged:
  function PTV_nodeHistoryDetailsChanged(aNode, aUpdatedVisitDate,
                                         aUpdatedVisitCount) {
    this.invalidateNode(aNode);
  },

  nodeTagsChanged: function PTV_nodeTagsChanged(aNode) { },

  nodeKeywordChanged: function PTV_nodeKeywordChanged(aNode, aNewKeyword) { },

  nodeAnnotationhanged: function PTV_nodeAnnotationhanged(aNode, aAnno) { },

  nodeDateAddedChanged: function PTV_nodeDateAddedChanged(aNode, aNewValue) { },

  nodeLastModifiedChanged: function PTV_nodeLastModifiedChanged(aNode, aNewValue) { },

  containerStateChanged:
  function PTV_containerStateChanged(aNode, aOldState, aNewState) {
    this.invalidateContainer(aNode);
  },

  invalidateContainer: function PTV_invalidateContainer(aContainer) {
    NS_ASSERT(this._result, "Need to have a result to update");
    if (!this._tree)
      return;

    var startReplacement, replaceCount;
    if (aContainer == this._rootNode) {
      startReplacement = 0;
      replaceCount = this._rows.length;

      // If the root node is now closed, the tree is empty.
      if (!this._rootNode.containerOpen) {
        this._rows = [];
        if (replaceCount)
          this._tree.rowCountChanged(startReplacement, -replaceCount);

        return;
      }
    }
    else {
      // Update the twisty state.
      let row = this._getRowForNode(aContainer);
      this._tree.invalidateRow(row);

      // We don't replace the container node itself, so we should decrease the
      // replaceCount by 1.
      startReplacement = row + 1;
      replaceCount = this._countVisibleRowsForNodeAtRow(row) - 1;
    }

    // Persist selection state.
    var nodesToReselect =
      this._getSelectedNodesInRange(startReplacement,
                                    startReplacement + replaceCount);

    // Now update the number of elements.
    this.selection.selectEventsSuppressed = true;

    // First remove the old elements
    this._rows.splice(startReplacement, replaceCount);

    // If the container is now closed, we're done.
    if (!aContainer.containerOpen) {
      let oldSelectionCount = this.selection.count;
      if (replaceCount)
        this._tree.rowCountChanged(startReplacement, -replaceCount);

      // Select the row next to the closed container if any of its
      // children were selected, and nothing else is selected.
      if (nodesToReselect.length > 0 &&
          nodesToReselect.length == oldSelectionCount) {
        this.selection.rangedSelect(startReplacement, startReplacement, true);
        this._tree.ensureRowIsVisible(startReplacement);
      }

      this.selection.selectEventsSuppressed = false;
      return;
    }

    // Otherwise, start a batch first.
    this._tree.beginUpdateBatch();
    if (replaceCount)
      this._tree.rowCountChanged(startReplacement, -replaceCount);

    var toOpenElements = [];
    var elementsAddedCount = this._buildVisibleSection(aContainer,
                                                       startReplacement,
                                                       toOpenElements);
    if (elementsAddedCount)
      this._tree.rowCountChanged(startReplacement, elementsAddedCount);

    // Now, open any containers that were persisted.
    for (let i = 0; i < toOpenElements.length; i++) {
      let item = toOpenElements[i];
      let parent = item.parent;

      // Avoid recursively opening containers.
      while (parent) {
        if (parent.uri == item.uri)
          break;
        parent = parent.parent;
      }

      // If we don't have a parent, we made it all the way to the root
      // and didn't find a match, so we can open our item.
      if (!parent && !item.containerOpen)
        item.containerOpen = true;
    }

    this._tree.endUpdateBatch();

    // Restore selection.
    this._restoreSelection(nodesToReselect, aContainer);
    this.selection.selectEventsSuppressed = false;
  },

  sortingChanged: function PTV__sortingChanged(aSortingMode) {
    if (!this._tree || !this._result)
      return;

    // Depending on the sort mode, certain commands may be disabled
    window.updateCommands("sort");

    var columns = this._tree.columns;

    // Clear old sorting indicator
    var sortedColumn = columns.getSortedColumn();
    if (sortedColumn)
      sortedColumn.element.removeAttribute("sortDirection");

    switch (aSortingMode) {
      case Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_TITLE_ASCENDING:
        columns.Name.element.setAttribute("sortDirection", "ascending");
        break;
      case Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_TITLE_DESCENDING:
        columns.Name.element.setAttribute("sortDirection", "descending");
        break;
      case Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_DATE_ASCENDING:
        columns.Date.element.setAttribute("sortDirection", "ascending");
        break;
      case Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_DATE_DESCENDING:
        columns.Date.element.setAttribute("sortDirection", "descending");
        break;
      case Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_URI_ASCENDING:
        columns.URL.element.setAttribute("sortDirection", "ascending");
        break;
      case Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_URI_DESCENDING:
        columns.URL.element.setAttribute("sortDirection", "descending");
        break;
      case Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_VISITCOUNT_ASCENDING:
        columns.VisitCount.element.setAttribute("sortDirection", "ascending");
        break;
      case Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_VISITCOUNT_DESCENDING:
        columns.VisitCount.element.setAttribute("sortDirection", "descending");
        break;
    }
  },

  _inBatchMode: false,
  batching: function PTV_batching(aBatching) {
    if (aBatching == this._inBatchMode)
      return;
    this._inBatchMode = this.selection.selectEventsSuppressed = aBatching;
    if (aBatching)
      this._tree.beginUpdateBatch();
    else
      this._tree.endUpdateBatch();
  },

  get result() {
    return this._result;
  },

  set result(val) {
    if (this._result) {
      this._result.removeObserver(this);
      this._rootNode.containerOpen = false;
    }

    if (val) {
      this._result = val;
      this._rootNode = val.root;
      this._cellProperties = new Map();
    }
    else if (this._result) {
      delete this._result;
      delete this._rootNode;
      delete this._cellProperties;
    }

    // If the tree is not set yet, setTree will call finishInit.
    if (this._tree && val)
      this._finishInit();

    return val;
  },

  nodeForTreeIndex: function PTV_nodeForTreeIndex(aIndex) {
    if (aIndex > this._rows.length)
      throw Components.results.NS_ERROR_INVALID_ARG;

    return this._getNodeForRow(aIndex);
  },

  treeIndexForNode: function PTV_treeNodeForIndex(aNode) {
    // The API allows passing invisible nodes.
    try {
      return this._getRowForNode(aNode, true);
    }
    catch(ex) { }

    return Components.interfaces.nsINavHistoryResultTreeViewer.INDEX_INVISIBLE;
  },

  // nsITreeView
  get rowCount() {
    return this._rows.length;
  },

  get selection() {
    return this._selection;
  },

  set selection(val) {
    return this._selection = val;
  },

  getRowProperties: function PTV_getRowProperties(aRow) { return ""; },

  getCellProperties: function PTV_getCellProperties(aRow, aColumn) {
    if (aColumn.id != "Name")
      return "";

    let node = this._getNodeForRow(aRow);
    let properties = this._cellProperties.get(node);
    if (!properties) {
      properties = "Name";
      if (node.type == Components.interfaces.nsINavHistoryResultNode.RESULT_TYPE_QUERY) {
        properties += " query";
        if (PlacesUtils.nodeIsDay(node))
          properties += " dayContainer";
        else if (PlacesUtils.nodeIsHost(node))
          properties += " hostContainer";
      }

      this._cellProperties.set(node, properties);
    }
    return properties;
  },

  getColumnProperties: function(aColumn) { return ""; },

  isContainer: function PTV_isContainer(aRow) {
    // Only leaf nodes aren't listed in the rows array.
    var node = this._rows[aRow];
    if (node === undefined)
      return false;

    if (PlacesUtils.nodeIsContainer(node)) {
      // the root node is always expandable
      if (!node.parent)
        return true;

      // treat non-expandable childless queries as non-containers
      if (PlacesUtils.nodeIsQuery(node)) {
        let parent = node.parent;
        if ((PlacesUtils.nodeIsQuery(parent) ||
             PlacesUtils.nodeIsFolder(parent)) &&
            !node.hasChildren)
          return PlacesUtils.asQuery(parent).queryOptions.expandQueries;
      }
      return true;
    }
    return false;
  },

  isContainerOpen: function PTV_isContainerOpen(aRow) {
    // All containers are listed in the rows array.
    return this._rows[aRow].containerOpen;
  },

  isContainerEmpty: function PTV_isContainerEmpty(aRow) {
    // All containers are listed in the rows array.
    return !this._rows[aRow].hasChildren;
  },

  isSeparator: function PTV_isSeparator(aRow) { return false; },

  isSorted: function PTV_isSorted() {
    return this._result.sortingMode !=
           Components.interfaces.nsINavHistoryQueryOptions.SORT_BY_NONE;
  },

  canDrop: function PTV_canDrop(aRow, aOrientation, aDataTransfer) { return false; },
  drop: function PTV_drop(aRow, aOrientation, aDataTransfer) { return; },

  getParentIndex: function PTV_getParentIndex(aRow) {
    let [parentNode, parentRow] = this._getParentByChildRow(aRow);
    return parentRow;
  },

  hasNextSibling: function PTV_hasNextSibling(aRow, aAfterIndex) {
    if (aRow == this._rows.length - 1) {
      // The last row has no sibling.
      return false;
    }

    var node = this._rows[aRow];
    if (node === undefined || this._isPlainContainer(node.parent)) {
      // The node is a child of a plain container.
      // If the next row is either unset or has the same parent,
      // it's a sibling.
      let nextNode = this._rows[aRow + 1];
      return (nextNode == undefined || nextNode.parent == node.parent);
    }

    var thisLevel = node.indentLevel;
    for (let i = aAfterIndex + 1; i < this._rows.length; ++i) {
      let rowNode = this._getNodeForRow(i);
      let nextLevel = rowNode.indentLevel;
      if (nextLevel == thisLevel)
        return true;
      if (nextLevel < thisLevel)
        break;
    }

    return false;
  },

  getLevel: function(aRow) {
    return this._getNodeForRow(aRow).indentLevel;
  },

  getImageSrc: function PTV_getImageSrc(aRow, aColumn) {
    // Only the title column has an image.
    if (aColumn.id != "Name")
      return "";

    return this._getNodeForRow(aRow).icon;
  },

  getProgressMode: function(aRow, aColumn) { },
  getCellValue: function(aRow, aColumn) { },

  getCellText: function PTV_getCellText(aRow, aColumn) {
    var node = this._getNodeForRow(aRow);
    switch (aColumn.id) {
      case "Name":
        // normally, this is just the title, but we don't want empty nodes in
        // the tree view so return a special string if the title is empty.
        // Do it here so that callers can still get at the 0 length title
        // if they go through the "result" API.
        return PlacesUIUtils.getBestTitle(node);
      case "URL":
        if (PlacesUtils.nodeIsURI(node))
          return node.uri;
        return "";
      case "Date":
        if (node.time == 0 || !PlacesUtils.nodeIsURI(node)) {
          // hosts and days shouldn't have a value for the date column.
          // Actually, you could argue this point, but looking at the
          // results, seeing the most recently visited date is not what
          // I expect, and gives me no information I know how to use.
          // Only show this for URI-based nodes.
          return "";
        }
        return this._convertPRTimeToString(node.time);
      case "VisitCount":
        return node.accessCount || "";
    }
    return "";
  },

  setTree: function PTV_setTree(aTree) {
    // If we are replacing the tree during a batch, there is a concrete risk
    // that the treeView goes out of sync, thus it's safer to end the batch now.
    // This is a no-op if we are not batching.
    this.batching(false);

    var hasOldTree = this._tree != null;
    this._tree = aTree;

    if (this._result) {
      if (hasOldTree) {
        // detach from result when we are detaching from the tree.
        // This breaks the reference cycle between us and the result.
        if (!aTree) {
          this._result.removeObserver(this);
          this._rootNode.containerOpen = false;
        }
      }
      if (aTree)
        this._finishInit();
    }
  },

  toggleOpenState: function PTV_toggleOpenState(aRow) {
    if (!this._result)
      throw Components.results.NS_ERROR_UNEXPECTED;

    var node = this._rows[aRow];
    NS_ASSERT(node.uri, "if there is no uri, we can't persist the open state");

    if (node.uri) {
      if (node.containerOpen)
        PlacesUIUtils.xulStore.removeValue(location, node.uri, "open");
      else
        PlacesUIUtils.xulStore.setValue(location, node.uri, "open", "true");
    }

    // 474287 Places enforces title sorting for groups, which we don't want.
    if (!node.containerOption && PlacesUtils.asQuery(node).queryOptions.resultType ==
        Components.interfaces.nsINavHistoryQueryOptions.RESULTS_AS_URI)
      node.queryOptions.sortingMode = this._result.sortingMode;
    node.containerOpen = !node.containerOpen;
  },

  cycleHeader: function PTV_cycleHeader(aColumn) {
    if (!this._result)
      throw Components.results.NS_ERROR_UNEXPECTED;

    var oldSort = this._result.sortingMode;
    const NHQO = Components.interfaces.nsINavHistoryQueryOptions;
    var newSort = NHQO.SORT_BY_NONE;
    switch (aColumn.id) {
      case "SortAscending":
        // this bit-twiddling only subtracts one from even numbers
        newSort = (oldSort - 1) | 1;
        break;

      case "SortDescending":
        // add one to odd numbers (ascending sorts are all odd)
        newSort = oldSort + (oldSort & 1);
        break;

      case "SortByName":
      case "Name":
        if (oldSort == NHQO.SORT_BY_TITLE_ASCENDING)
          newSort = NHQO.SORT_BY_TITLE_DESCENDING;
        else if (oldSort != NHQO.SORT_BY_TITLE_DESCENDING)
          newSort = NHQO.SORT_BY_TITLE_ASCENDING;
        break;

      case "SortByURL":
      case "URL":
        if (oldSort == NHQO.SORT_BY_URI_ASCENDING)
          newSort = NHQO.SORT_BY_URI_DESCENDING;
        else if (oldSort != NHQO.SORT_BY_URI_DESCENDING)
          newSort = NHQO.SORT_BY_URI_ASCENDING;
        break;

        // date default is unusual because we sort by descending
        // by default because you are most likely to be looking for
        // recently visited sites when you click it
      case "SortByDate":
      case "Date":
        if (oldSort == NHQO.SORT_BY_DATE_DESCENDING)
          newSort = NHQO.SORT_BY_DATE_ASCENDING;
        else if (oldSort != NHQO.SORT_BY_DATE_ASCENDING)
          newSort = NHQO.SORT_BY_DATE_DESCENDING;
        break;

      case "SortByVisitCount":
      case "VisitCount":
        // visit count default is unusual because we sort by descending
        // by default because you are most likely to be looking for
        // highly visited sites when you click it
        if (oldSort == NHQO.SORT_BY_VISITCOUNT_DESCENDING)
          newSort = NHQO.SORT_BY_VISITCOUNT_ASCENDING;
        else if (oldSort != NHQO.SORT_BY_VISITCOUNT_ASCENDING)
          newSort = NHQO.SORT_BY_VISITCOUNT_DESCENDING;
        break;

      default:
        if (oldSort == newSort)
          return;
    }
    this._result.sortingMode = newSort;
  },

  isEditable: function(aRow, aColumn) { return false; },
  setCellText: function(aRow, aColumn, aText) { },
  selectionChanged: function() { },
  cycleCell: function(aRow, aColumn) { },
  isSelectable: function(aRow, aColumn) { return false; },
  performAction: function(aAction) { },
  performActionOnRow: function(aAction, aRow) { },
  performActionOnCell: function(aAction, aRow, aColumn) { }
};
