/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Base abstraction for message display along the line of FolderDisplayWidget,
 *  but for message display.  This really only exists to keep
 *  FolderDisplayWidget manageable and free from taking on responsibility for
 *  the (different) horrors of message display.  The reality of the situation
 *  is that FolderDisplayWidget still has a lot to do with message display,
 *  and so we are just where helper logic gets to live, but the FDW still
 *  may deal with some things internally.
 * You should not use this class directly, but rather its friendly subclasses
 *  that live later in this file.
 */
function MessageDisplayWidget() {
}
MessageDisplayWidget.prototype = {
  _active: false,
  get active() {
    return this._active;
  },

  _haveDisplayedStartPage: false,

  /**
   * Track whether the single message display pane is desired to be displayed
   *  (it is actually displayed when active, doesn't matter when not), or
   *  otherwise the multiple message display pane is desired to be displayed.
   */
  _singleMessageDisplay: null,
  get singleMessageDisplay() {
    // when null, assume single message display
    return this._singleMessageDisplay != false;
  },
  set singleMessageDisplay(aSingleDisplay) {
    if (this._singleMessageDisplay != aSingleDisplay) {
      this._singleMessageDisplay = aSingleDisplay;
      if (this._active)
        this._updateActiveMessagePane();
    }
  },

  /**
   * Set pane visibility based on this.singleMessageDisplay.
   */
  _updateActiveMessagePane: function MessageDisplayWidget_updateMessagePane() {
    // If we're summarizing, might as well clear the message display so that
    // when we return to it, we don't display prev selected message.  If we're
    // *not* summarizing, clear the summary display so that the summary can
    // clean itself up.
    if (!this.singleMessageDisplay)
      this.clearDisplay();
    else
      gSummaryFrameManager.clear();

    // _singleMessageDisplay can be null, so use the property (getter)
    document.getElementById("singlemessage").hidden =
      !this.singleMessageDisplay;
    document.getElementById("multimessage").hidden =
      this.singleMessageDisplay;

    // If the message pane is currently focused, make sure we have the
    // currently-visible content window (single- or multi-message) focused.
    if (this.folderDisplay.focusedPane ==
        document.getElementById("messagepanebox")) {
      if (this.singleMessageDisplay)
        document.getElementById("messagepane").focus();
      else
        document.getElementById("multimessage").focus();
    }
  },

  /**
   * Cleanup the MessageDisplayWidget in preparation for going away.  Called by
   *  FolderDisplayWidget's close method.
   */
  _close: function MessageDisplayWidget_close() {
    // mark ourselves inactive without doing any work.
    this._active = false;
  },

  /**
   * @name Displayed
   */
  //@{

  /**
   * The FolderDisplayWidget that owns us.
   */
  folderDisplay: null,
  /**
   * The currently displayed message's nsIMsgDBHdr.  null if there's no message.
   */
  displayedMessage: null,
  /**
   * The key of the message for which a charset override was last set,
   * null if it was never set. Note that a stale value can hang around.
   */
  keyForCharsetOverride: null,

  /**
   * Indicate whether the message being displayed is a 'dummy' because it is
   *  backed not by an nsIMsgDBHdr but instead by a file on disk or an
   *  attachment on some mail message.
   */
  isDummy: false,
  //@}

  /**
   * @name FolderDisplayWidget Notifications
   * @private
   */
  //@{

  /**
   * Unit testing support variable that tracks whether a message load is in
   *  process.  This is set to true when |onDisplayingMessage| is invoked and
   *  cleared by invoking |clearDisplay| or when the message finishes streaming
   *  and |messageLoaded| is set to true.
   */
  messageLoading: false,
  /**
   * Unit testing support variable that tracks whether there is currently a
   *  fully displayed message.  This is cleared when |clearDisplay| is invoked
   *  or we hear that a new message begins streaming via |onDisplayingMessage|.
   */
  messageLoaded: false,

  /**
   * This is meant to be called immediately after a message or summary load is
   * started.
   */
  onLoadStarted: function MessageDisplayWidget_onLoadStarted() {
    this.messageLoading = true;
    this.messageLoaded = false;
  },

  /**
   * This is meant to be called immediately after a message or summary load is
   * completed.
   */
  onLoadCompleted: function MessageDisplayWidget_onLoadCompleted() {
    this.messageLoading = false;
    this.messageLoaded = true;
  },

  clearDisplay: function MessageDisplayWidget_clearDisplay() {
    this.displayedMessage = null;
    this.messageLoading = false;
    this.messageLoaded = false;
    ClearPendingReadTimer();
    ClearMessagePane();
  },

  onCreatedView: function MessageDisplayWidget_onCreatedView() {
    // we need to compel setting this because nsMsgSearchDBView defaults it on
    this.folderDisplay.view.dbView.suppressMsgDisplay = !this.visible;
  },

  /**
   * FolderDisplayWidget tells us when it is killing the view, which means our
   *  displayed message is no longer valid.
   */
  onDestroyingView: function MessageDisplayWidget_onDestroyingView(
      aFolderIsComingBack) {
    this.displayedMessage = null;
    // The only time we want to do anything is when the folder is not coming
    //  back.  If it is coming back, we can handle things when it shows up.
    if (!aFolderIsComingBack && this._active) {
      // and in this case, we just want to clear things.
      this.clearDisplay();
      this.singleMessageDisplay = true;
    }
  },

  /**
   * FolderDisplayWidget tells us when a message is being displayed.
   */
  onDisplayingMessage: function MessageDisplayWidget_onDisplayingMessage(
      aMsgHdr) {
    this.displayedMessage = aMsgHdr;
    this.onLoadStarted();
  },
  //@}

  /**
   * @name Summarization
   * @protected
   */
  //@{

  /**
   * FolderDisplayWidget tells us when the set of selected messages has changed.
   *  FDW is doing this because an nsMsgDBView/subclass called
   *  summarizeSelection.  Although the call is purely an outgrowth of the
   *  introduction of folder summaries, it also provides a means for us to
   *  completely replace the nsMsgDBView logic.  Namely, we get first bat at
   *  taking an action as a result of the selection change, and we can cause the
   *  nsMsgDBView to not do anything (by returning true).
   * This notification will come prior to an onDisplayingMessage notification,
   *  and we will only get that notification if we return false and the
   *  nsMsgDBView logic wanted to display a message (read: there is exactly
   *  one message displayed and it wasn't already displayed.)
   *
   * The prime responsibilities of this function are:
   * - To make sure the right message pane (single or multi) is displayed.
   * - To kick off a multi-message or thread summarization if multiple messages
   *   are selected.
   * - To throttle the rate at which we perform summarizations in case the
   *   selection is being updated frequently.  This could be as a result of the
   *   user holding down shift and using their keyboard to expand the selection,
   *   use of the archive mechanism, or other.
   * - To clear the message pane if no messages are selected.  This used to be
   *   triggered by nsMsgDBView::SelectionChanged but is now our responsibility.
   *
   * In the event that the controlling preference for message summarization is
   *  not enabled (mail.operate_on_msgs_in_collapsed_threads), and there is a
   *  multi-selection, we just clear the display.
   *
   * @return true if we handled the selection notification and the nsMsgDBView
   *  should do nothing, false if we did not and the nsMsgDBView should use its
   *  logic to display a message.
   */
  onSelectedMessagesChanged:
      function MessageDisplayWidget_onSelectedMessagesChanged() {
    // If we are not active, we should not be touching things.  pretend we are
    //  handling whatever is happening so the nsMsgDBView doesn't try and do
    //  anything.  makeActive will trigger a fake SelectionChanged notification
    //  when we switch, which should put everything in its right place.
    if (!this.active)
      return true;

    ClearPendingReadTimer();

    if (this.folderDisplay.selectedCount == 1) {
      // the display of the message is happening without us
      this.singleMessageDisplay = true;

      // This is the only case we don't handle and want the nsMsgDBView to
      //  take care of.
      return false;
    }
    // Else defer to showSummary to work it out based on thread selection.
    return this._showSummary();
  },

  /**
   * FolderDisplayWidget will alert us when a message has been removed so that
   * we can decide whether we want to handle it here, e.g. by closing the
   * window/tab.
   *
   * @return true if the MessageDisplayWidget handled this event and the
   *         FolderDisplayWidget should stop processing
   */
  onMessagesRemoved: function MessageDisplayWidget_onMessagesRemoved() {
  },

  /**
   * If we are already summarized and we get a new request to summarize, require
   *  that the selection has been stable for at least this many milliseconds
   *  before resummarizing.
   * Unit tests know about this variable and poke at it, so don't change the name
   *  without making sure you update the unit tests.  (Not that you would commit
   *  code without first running all tests yourself...)
   * @private
   */
  SUMMARIZATION_SELECTION_STABILITY_INTERVAL_MS: 100,
  /**
   * The timeout ID resulting from the call to window.setTimeout that we are
   *  using to require the selection be 'stabilized' before re-summarizing.
   */
  _summaryStabilityTimeout: null,

  /**
   * Updates message summaries with care to throttle the summarization when the
   *  selection is rapidly changing.  We require that either we have not
   *  summarized anything 'recently', or that the selection has been stable for
   *  SUMMARIZATION_SELECTION_STABILITY_INTERVAL_MS ms before we update the
   *  summary.  'Recently' for our purposes means that it has been at least
   *  SUMMARIZATION_SELECTION_STABILITY_INTERVAL_MS ms since our last summary.
   *
   * Example event sequences (assuming a 100ms stability interval):
   * - User selects a collapsed thread => we summarize the selection and set a
   *    100ms timer set to call _clearSummaryTimer.
   * - User extends the selection 50ms later => the timer has not elapsed so we
   *    reset it to 100ms to call _showSummary.
   * - User extends the selection yet again 50ms later => timer has not elapsed
   *    so we reset it to 100ms to call _showSummary.
   * - 100ms later, the timer elapses => we call _showSummary which updates the
   *    summary.
   * - 2 seconds later, the user selects some other messages => we summarize the
   *    select and set a 100ms timer set to call _clearSummaryTimer.
   * - 100ms later, _clearSummaryTimer clears _summaryStabilityTimeout so that
   *    the next selection change will immediately summarize.
   *
   * @param aIsCallback Is this a callback to ourselves?  Callers should not set
   *     this, leaving it undefined.
   * @return true if we handled the selection notification and the nsMsgDBView
   *  should do nothing, false if we did not and the nsMsgDBView should use its
   *  logic to display a message.
   */
  _showSummary: function MessageDisplayWidget_showSummary(aIsCallback) {
    // Note: if we are in this function, we already know that summaries are
    // enabled.

    // Don't summarize if a mass move is currently active. We'll get notified
    // to summarize later. This occurs when we archive a single message and are
    // about to select a thread next, but haven't actually selected anything
    // yet.
    if (this.folderDisplay._massMoveActive)
      return true;

    // If this is not a callback from the timeout and we currently have a
    // timeout, that means that we need to wait for the selection to stabilize.
    // The fact that we are getting called means the selection has just changed
    // yet again and is not stable, so reset the timer for the full duration.
    if (!aIsCallback && this._summaryStabilityTimeout != null) {
      clearTimeout(this._summaryStabilityTimeout);
      this._summaryStabilityTimeout =
        setTimeout(this._wrapShowSummary,
                   this.SUMMARIZATION_SELECTION_STABILITY_INTERVAL_MS,
                   this);
      return true;
    }

    // Bail if our selection count has stabilized outside an acceptable range.
    let selectedCount = this.folderDisplay.selectedCount;
    if (selectedCount == 1)
      return true;

    // Setup a timeout call to _clearSummaryTimer so that we don't try and
    // summarize again within 100ms of now.  Do this before calling the
    // summarization logic in case it throws an exception.
    this._summaryStabilityTimeout =
      setTimeout(this._clearSummaryTimer,
                 this.SUMMARIZATION_SELECTION_STABILITY_INTERVAL_MS,
                 this);

    if (this.folderDisplay.selectedCount == 0) {
      // If there are no messages selected, show the folder summary. Gloda will
      // break if passed empty selectedMessages, so do not use any tree row
      // count value to indicate messages (dummy rows are not messages).
      summarizeFolder(this);
    }
    else {
      // If there are some messages selected, show the multi-message summary
      // (unless this folder doesn't support summarizing selections).
      if (!this.folderDisplay.summarizeSelectionInFolder) {
        this.singleMessageDisplay = true;
        return false;
      }

      summarizeSelection(this);
    }
    return true;
  },
  _wrapShowSummary: function MessageDisplayWidget__wrapShowSummary(aThis) {
    aThis._showSummary(true);
  },
  /**
   * Just clears the _summaryStabilityTimeout attribute so we can use it as a
   *  means of checking if we are allowed to display the summary immediately.
   */
  _clearSummaryTimer: function MessageDisplayWidget__clearSummaryTimer(aThis) {
    aThis._summaryStabilityTimeout = null;
  },
  //@}

  /**
   * @name Activity Control
   * @protected FolderDisplayWidget
   */
  //@{

  /**
   * Called by the FolderDisplayWidget when it is being made active again and
   *  it's time for us to step up and re-display or clear the message as
   *  demanded by our multiplexed tab implementation.
   *
   *  @param aDontReloadMessage [optional] true if you don't want to make us
   *                            call reloadMessage even if the conditions are
   *                            right for doing so. Use only when you're sure
   *                            that you've already triggered a message load,
   *                            and that a message reload would be harmful.
   */
  makeActive: function MessageDisplayWidget_makeActive(aDontReloadMessage) {
    let wasInactive = !this._active;
    this._active = true;

    if (wasInactive) {
      let dbView = this.folderDisplay.view.dbView;
      // (see our usage below)
      let preDisplayedViewIndex =
          dbView.currentlyDisplayedMessage;
      // Force a synthetic selection changed event.  This will propagate through
      //  to a call to onSelectedMessagesChanged who will handle making sure the
      //  right message pane is in use, etc.
      dbView.selectionChanged();
      // The one potential problem is that the message view only triggers message
      //  streaming if it doesn't think the message is already displayed.  In that
      //  case we need to force a re-display by calling reloadMessage.  We can
      //  detect that case by seeing if the preDisplayedViewIndex corresponds to
      //  the current value of displayedMessage, since if it doesn't, the value
      //  of displayedMessage has changed during this call (because we will
      //  receive a onDisplayingMessage notification).  If we should be
      //  displaying a single message but the value does not change, we need to
      //  force a re-display.
      // We used to use the value of this.displayedMessage prior to the
      //  selectionChanged() call here instead of preDisplayedViewIndex, but we
      //  don't do that any more because this.displayedMessage might be out of
      //  sync with reality for an inactive tab.
      if (!aDontReloadMessage && this.singleMessageDisplay &&
          this.displayedMessage &&
          (preDisplayedViewIndex != nsMsgViewIndex_None) &&
          (this.displayedMessage == dbView.getMsgHdrAt(preDisplayedViewIndex)))
        dbView.reloadMessage();
    }

    this._updateActiveMessagePane();
  },

  /**
   * Called by the FolderDisplayWidget when it is being made inactive or no
   *  longer requires messages to be displayed.
   */
  makeInactive: function MessageDisplayWidget_makeInactive() {
    this._active = false;
  }
  //@}
};

/**
 * Display widget abstraction for the 3-pane message view's preview pane/message
 *  pane. Like the DisplayWidget, it is multiplexed.
 */
function MessagePaneDisplayWidget(aBeVisible) {
  MessageDisplayWidget.call(this);
  this._visible = aBeVisible == undefined ? true : aBeVisible;
}
MessagePaneDisplayWidget.prototype = {
  __proto__: MessageDisplayWidget.prototype,

  get visible() {
    return this._visible;
  },
  /**
   * Tell us whether the message pane is visible or not; this should reflect
   *  reality and does not define reality.  (Setting this to false does not
   *  hide the message pane, it merely makes us think it is hidden.)
   */
  set visible(aVisible) {
    // Ignore this if we are inactive.  We don't want to get faked out by things
    //  happening after our tab has closed up shop.
    if (!this._active)
      return;

    // no-op if it's the same
    if (aVisible == this._visible)
      return;

    this._visible = aVisible;
    // Update suppression.  If we were not visible and now are visible, the db
    //  view itself will handle triggering the message display for us if the
    //  message was not currently being displayed...
    let dbView = this.folderDisplay.view.dbView;
    if (dbView) {
      let treeSelection = this.folderDisplay.treeSelection;
      // flag if we need to force the redisplay manually...
      let needToReloadMessage = treeSelection.count &&
        dbView.currentlyDisplayedMessage == treeSelection.currentIndex;
      dbView.suppressMsgDisplay = !this._visible;
      if (needToReloadMessage)
        dbView.reloadMessage();
    }
    // But if we are no longer visible, it's on us to clear the display.
    if (!aVisible)
      this.clearDisplay();
  },
};

/**
 * Message display widget for the "message" tab that is the tab-based equivalent
 *  of the standalone message window.
 */
function MessageTabDisplayWidget() {
  MessageDisplayWidget.call(this);
}
MessageTabDisplayWidget.prototype = {
  __proto__: MessageDisplayWidget.prototype,

  /**
   * The message tab always has a visible message pane.
   */
  get visible() {
    return true;
  },
  set visible(aIgnored) {
  },

  onSelectedMessagesChanged:
      function MessageTabDisplayWidget_onSelectedMessagesChanged() {
    // Look at the number of messages left in the db view. If there aren't any,
    // close the tab.
    if (this.folderDisplay.view.dbView.rowCount == 0) {
      if (!this.closing) {
        this.closing = true;
        document.getElementById('tabmail').closeTab(
            this.folderDisplay._tabInfo, true);
      }
      return true;
    }
    else {
      if (!this.closing)
        document.getElementById('tabmail').setTabTitle(
            this.folderDisplay._tabInfo);

      // The db view shouldn't do anything if we're inactive or about to close
      if (!this.active || this.closing)
        return true;

      // No summaries in a message tab
      this.singleMessageDisplay = true;
      return false;
    }
  },

  onMessagesRemoved: function MessageTabDisplayWidget_onMessagesRemoved() {
    if (!this.folderDisplay.treeSelection)
      return true;

    if (this.folderDisplay.treeSelection.count == 0 &&
        Services.prefs.getBoolPref("mail.close_message_window.on_delete")) {
      document.getElementById("tabmail").closeTab(this.folderDisplay._tabInfo,
                                                  true);
      return true;
    }
    return false;
  },

  /**
   * A message tab should never ever be blank.  Close the tab if we become
   *  blank.
   */
  clearDisplay: function MessageTabDisplayWidget_clearDisplay() {
    if (!this.closing) {
      this.closing = true;
      document.getElementById('tabmail').closeTab(this.folderDisplay._tabInfo,
                                                  true);
    }
  }
};

/**
 * The search dialog has no message preview pane, and so wants a message
 *  display widget that is never visible.  No one other than the search
 *  dialog should use this because the search dialog is bad UI.
 */
function NeverVisisbleMessageDisplayWidget() {
  MessageDisplayWidget.call(this);
}
NeverVisisbleMessageDisplayWidget.prototype = {
  __proto__: MessageDisplayWidget.prototype,
  get visible() {
    return false;
  },
  onSelectedMessagesChanged: function() {
    return false;
  },
  _updateActiveMessagePane: function() {
  },
};
