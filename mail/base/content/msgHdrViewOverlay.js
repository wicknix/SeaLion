/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Functions related to displaying the headers for a selected message in the
 * message pane.
 */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource:///modules/displayNameUtils.js");
Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource:///modules/gloda/utils.js");

////////////////////////////////////////////////////////////////////////////////////
// Warning: It's critical that the code in here for displaying the message
// headers for a selected message remain as fast as possible. In particular,
// right now, we only introduce one reflow per message. i.e. if you click on
// a message in the thread pane, we batch up all the changes for displaying
// the header pane (to, cc, attachements button, etc.) and we make a single
// pass to display them. It's critical that we maintain this one reflow per
// message view in the message header pane.
////////////////////////////////////////////////////////////////////////////////////

var gViewAllHeaders = false;
var gMinNumberOfHeaders = 0;
var gDummyHeaderIdIndex = 0;
var gBuildAttachmentsForCurrentMsg = false;
var gBuiltExpandedView = false;
var gHeadersShowReferences = false;

/**
 * Show the friendly display names for people I know,
 * instead of the name + email address.
 */
var gShowCondensedEmailAddresses;

/**
 * Other components may listen to on start header & on end header notifications
 * for each message we display: to do that you need to add yourself to our
 * gMessageListeners array with an object that supports the three properties:
 * onStartHeaders, onEndHeaders and onEndAttachments.
 *
 * Additionally, if your object has an onBeforeShowHeaderPane() method, it will
 * be called at the appropriate time.  This is designed to give add-ons a
 * chance to examine and modify the currentHeaderData array before it gets
 * displayed.
 */
var gMessageListeners = new Array();

/**
 * This expanded header view shows many of the more common (and useful) headers.
 *
 * For every possible "view" in the message pane, you need to define the header
 * names you want to see in that view. In addition, include information
 * describing how you want that header field to be presented. i.e. if it's an
 * email address field, if you want a toggle inserted on the node in case
 * of multiple email addresses, etc. We'll then use this static table to
 * dynamically generate header view entries which manipulate the UI.
 * When you add a header to one of these view lists you can specify
 * the following properties:
 * name:           the name of the header. i.e. "to", "subject". This must be in
 *                 lower case and the name of the header is used to help
 *                 dynamically generate ids for objects in the document. (REQUIRED)
 * useToggle:      true if the values for this header are multiple email
 *                 addresses and you want a (more) toggle to show a short
 *                 vs. long list (DEFAULT: false)
 * outputFunction: this is a method which takes a headerEntry (see the definition
 *                 below) and a header value. This allows you to provide your own
 *                 methods for actually determining how the header value
 *                 is displayed. (DEFAULT: updateHeaderValue which just sets the
 *                 header value on the text node)
 */
var gExpandedHeaderList = [
  { name: "subject" },
  { name: "from", useToggle:true, outputFunction: OutputEmailAddresses },
  { name: "reply-to", useToggle:true, outputFunction: OutputEmailAddresses },
  { name: "to", useToggle:true, outputFunction: OutputEmailAddresses },
  { name: "cc", useToggle:true, outputFunction: OutputEmailAddresses },
  { name: "bcc", useToggle:true, outputFunction: OutputEmailAddresses },
  { name: "newsgroups", outputFunction: OutputNewsgroups },
  { name: "references", outputFunction: OutputMessageIds },
  { name: "followup-to", outputFunction: OutputNewsgroups },
  { name: "content-base" },
  { name: "tags" } ];

/**
 * These are all the items that use a mail-multi-emailHeaderField widget and
 * therefore may require updating if the address book changes.
 */
var gEmailAddressHeaderNames = ["from", "reply-to",
                                  "to", "cc", "bcc", "toCcBcc"];

/**
 * Now, for each view the message pane can generate, we need a global table of
 * headerEntries. These header entry objects are generated dynamically based on
 * the static data in the header lists (see above) and elements we find in the
 * DOM based on properties in the header lists.
 */
var gExpandedHeaderView  = {};

/**
 * This is an array of header name and value pairs for the currently displayed
 * message. It's purely a data object and has no view information. View
 * information is contained in the view objects.
 * For a given entry in this array you can ask for:
 * .headerName   name of the header (i.e. 'to'). Always stored in lower case
 * .headerValue  value of the header "johndoe@example.com"
 */
var currentHeaderData = {};

/**
 * CurrentAttachments is an array of AttachmentInfo objects.
 */
var currentAttachments = new Array();

var nsIAbDirectory = Components.interfaces.nsIAbDirectory;
var nsIAbListener = Components.interfaces.nsIAbListener;
var nsIAbCard = Components.interfaces.nsIAbCard;

/**
 * Our constructor method which creates a header Entry based on an entry
 * in one of the header lists. A header entry is different from a header list.
 * A header list just describes how you want a particular header to be
 * presented. The header entry actually has knowledge about the DOM
 * and the actual DOM elements associated with the header.
 *
 * @param prefix  the name of the view (e.g. "expanded")
 * @param headerListInfo  entry from a header list.
 */
function createHeaderEntry(prefix, headerListInfo)
{
  var partialIDName = prefix + headerListInfo.name;
  this.enclosingBox = document.getElementById(partialIDName + "Box");
  this.enclosingRow = document.getElementById(partialIDName + "Row");
  this.textNode = document.getElementById(partialIDName + "Value");
  this.isNewHeader = false;
  this.valid = false;

  if ("useToggle" in headerListInfo) {
    this.useToggle = headerListInfo.useToggle;
    if (this.useToggle) {
      // find the toggle icon in the document
      this.toggleIcon = this.enclosingBox.toggleIcon;
      this.longTextNode = this.enclosingBox.longEmailAddresses;
      this.textNode = this.enclosingBox.emailAddresses;
    }
  }
  else
   this.useToggle = false;

  if ("outputFunction" in headerListInfo)
    this.outputFunction = headerListInfo.outputFunction;
  else
    this.outputFunction = updateHeaderValue;

  // Stash this so that the <mail-multi-emailheaderfield/> binding can
  // later attach it to any <mail-emailaddress> tags it creates for later
  // extraction and use by UpdateEmailNodeDetails.
  this.enclosingBox.headerName = headerListInfo.name;

}

function initializeHeaderViewTables()
{
  // Iterate over each header in our header list arrays and create header entries
  // for each one. These header entries are then stored in the appropriate header
  // table.
  var index;
  for (index = 0; index < gExpandedHeaderList.length; index++) {
    var headerName = gExpandedHeaderList[index].name;
    gExpandedHeaderView[headerName] =
      new createHeaderEntry("expanded", gExpandedHeaderList[index]);
  }

  var extraHeaders =
    Services.prefs.getCharPref("mailnews.headers.extraExpandedHeaders").split(" ");
  for (index = 0; index < extraHeaders.length; index++) {
    var extraHeader = extraHeaders[index];
    gExpandedHeaderView[extraHeader.toLowerCase()] =
      new HeaderView(extraHeader, extraHeader);
  }

  if (Services.prefs.getBoolPref("mailnews.headers.showOrganization")) {
    var organizationEntry = { name: "organization",
                              outputFunction: updateHeaderValue };
    gExpandedHeaderView[organizationEntry.name] =
      new createHeaderEntry("expanded", organizationEntry);
  }

  if (Services.prefs.getBoolPref("mailnews.headers.showUserAgent")) {
    var userAgentEntry = { name: "user-agent", outputFunction: updateHeaderValue };
    gExpandedHeaderView[userAgentEntry.name] =
      new createHeaderEntry("expanded", userAgentEntry);
  }

  if (Services.prefs.getBoolPref("mailnews.headers.showMessageId")) {
    var messageIdEntry = { name: "message-id", outputFunction: OutputMessageIds };
    gExpandedHeaderView[messageIdEntry.name] =
      new createHeaderEntry("expanded", messageIdEntry);
  }

  if (Services.prefs.getBoolPref("mailnews.headers.showSender")) {
    var senderEntry = { name: "sender", outputFunction: OutputEmailAddresses };
    gExpandedHeaderView[senderEntry.name] =
      new createHeaderEntry("expanded", senderEntry);
  }
}

function OnLoadMsgHeaderPane()
{
  // HACK...force our XBL bindings file to be load before we try to create our
  // first xbl widget.... otherwise we have problems.
  document.loadBindingDocument("chrome://messenger/content/mailWidgets.xml");

  // Load any preferences that at are global with regards to
  // displaying a message...
  gMinNumberOfHeaders = Services.prefs.getIntPref("mailnews.headers.minNumHeaders");
  gShowCondensedEmailAddresses = Services.prefs.getBoolPref("mail.showCondensedAddresses");
  gHeadersShowReferences = Services.prefs.getBoolPref("mailnews.headers.showReferences");

  // listen to the
  Services.prefs.addObserver("mail.showCondensedAddresses", MsgHdrViewObserver, false);
  Services.prefs.addObserver("mailnews.headers.showReferences", MsgHdrViewObserver, false);
  Services.prefs.addObserver("mailnews.header.toolbar", MsgHdrViewObserver, false);

  initializeHeaderViewTables();

  // Add an address book listener so we can update the header view when things
  // change.
  MailServices.ab.addAddressBookListener(AddressBookListener,
                                         Components.interfaces.nsIAbListener.all);

  // If an invalid index is selected; reset to 0.  One way this can happen
  // is if a value of 1 was persisted to localStore.rdf by Tb2 (when there were
  // two panels), and then the user upgraded to Tb3, which only has one.
  // Presumably this can also catch cases of extension uninstalls as well.
  let deckElement = document.getElementById("msgHeaderViewDeck")

  // If the selectedIndex was 0, then we were using the compact header, (if we
  // were coming from TB2, but we'll check that in the feature configurator).
  deckElement.usedCompactHeader = (deckElement.selectedIndex == 0);

  if (deckElement.selectedIndex < 0 ||
      deckElement.selectedIndex >= deckElement.childElementCount) {
    deckElement.selectedIndex = 0;
  }

  initToolbarMenu();

  // Only offer openInTab and openInNewWindow if this window supports tabs...
  // (i.e. is not a standalone message window), since those actions are likely
  // to be significantly less common in that case.
  if (document.getElementById("otherActionsOpenIn")) {
    let opensAreHidden = document.getElementById("tabmail") ? false : true;
    document.getElementById("otherActionsOpenIn").hidden = opensAreHidden;
  }

  // Dispatch an event letting any listeners know that we have loaded
  // the message pane.
  var headerViewElement = document.getElementById("msgHeaderView");
  headerViewElement.dispatchEvent(new Event("messagepane-loaded",
    { bubbles: false, cancelable: true }));

  initInlineToolbox("header-view-toolbox", "header-view-toolbar",
                    "CustomizeHeaderToolbar", function() {
                      UpdateJunkButton();
                      UpdateReplyButtons();
                    });
  initInlineToolbox("attachment-view-toolbox", "attachment-view-toolbar",
                    "CustomizeAttachmentToolbar", function () {
                      updateSaveAllAttachmentsButton();
                    });

  top.controllers.appendController(AttachmentMenuController);
}

/**
 * Initialize an inline toolbox and its toolbar to have the appropriate
 * attributes necessary for customization and persistence.
 *
 * @param toolboxId  the id for the toolbox to initialize
 * @param toolbarId  the id for the toolbar to initialize
 * @param popupId  the id for the menupopup to initialize
 * @param customizeChange  (optional) a function to call when a toolbar button
 *                         has been added or removed from the toolbar
 */
function initInlineToolbox(toolboxId, toolbarId, popupId, customizeChange) {
  var headerBox = document.getElementById("msgHeaderView");
  headerBox.setAttribute("showToolbar", Services.prefs.getBoolPref("mailnews.header.toolbar"));
  let toolbox = document.getElementById(toolboxId);
  toolbox.customizeDone = function(aEvent) {
    MailToolboxCustomizeDone(aEvent, popupId);
  };
  if (customizeChange)
    toolbox.customizeChange = customizeChange;

  let toolbarset = document.getElementById("customToolbars");
  toolbox.toolbarset = toolbarset;

  // Check whether we did an upgrade to a customizable header pane.
  // If yes, set the header pane toolbar mode to icons besides text
  let toolbar = document.getElementById(toolbarId);
  if (toolbox && toolbar) {
    if (!toolbox.getAttribute("mode")) {

      /* set toolbox attributes to default values */
      let mode = toolbox.getAttribute("defaultmode");
      let align = toolbox.getAttribute("defaultlabelalign");
      let iconsize = toolbox.getAttribute("defaulticonsize");
      toolbox.setAttribute("mode", mode);
      toolbox.setAttribute("labelalign", align);
      toolbox.setAttribute("iconsize", iconsize);
      toolbox.ownerDocument.persist(toolbox.id, "mode");
      toolbox.ownerDocument.persist(toolbox.id, "iconsize");
      toolbox.ownerDocument.persist(toolbox.id, "labelalign");

      /* set toolbar attributes to default values */
      iconsize = toolbar.getAttribute("defaulticonsize");
      toolbar.setAttribute("iconsize", iconsize);
      toolbar.ownerDocument.persist(toolbar.id, "iconsize");
    }
  }
}

function initToolbarMenu() {
  // Get the mode as persisted on the toolbar itself.
  let mode = document.getElementById("header-view-toolbar")
                     .getAttribute("mode");

  return;
}

function OnUnloadMsgHeaderPane()
{
  Services.prefs.removeObserver("mail.showCondensedAddresses", MsgHdrViewObserver);
  Services.prefs.removeObserver("mailnews.headers.showReferences", MsgHdrViewObserver);
  Services.prefs.removeObserver("mailnews.header.toolbar", MsgHdrViewObserver);

  MailServices.ab.removeAddressBookListener(AddressBookListener);

  // dispatch an event letting any listeners know that we have unloaded
  // the message pane
  var headerViewElement = document.getElementById("msgHeaderView");
  headerViewElement.dispatchEvent(new Event("messagepane-unloaded",
    { bubbles: false, cancelable: true }));
}

var MsgHdrViewObserver =
{
  observe: function(subject, topic, prefName)
  {
    // verify that we're changing the mail pane config pref
    if (topic == "nsPref:changed") {
      if (prefName == "mail.showCondensedAddresses") {
        gShowCondensedEmailAddresses =
          Services.prefs.getBoolPref("mail.showCondensedAddresses");
        ReloadMessage();
      }
      else if (prefName == "mailnews.headers.showReferences") {
        gHeadersShowReferences =
          Services.prefs.getBoolPref("mailnews.headers.showReferences");
        ReloadMessage();
      }
      else if (prefName == "mailnews.header.toolbar") {
        var headerBox = document.getElementById("msgHeaderView");
        headerBox.setAttribute("showToolbar", Services.prefs.getBoolPref("mailnews.header.toolbar"));
      }
    }
  }
};

var AddressBookListener =
{
  onItemAdded: function(aParentDir, aItem) {
    OnAddressBookDataChanged(nsIAbListener.itemAdded,
                             aParentDir, aItem);
  },
  onItemRemoved: function(aParentDir, aItem) {
    OnAddressBookDataChanged(aItem instanceof nsIAbCard ?
                               nsIAbListener.directoryItemRemoved :
                               nsIAbListener.directoryRemoved,
                             aParentDir, aItem);
  },
  onItemPropertyChanged: function(aItem, aProperty, aOldValue, aNewValue) {
    // We only need updates for card changes, address book and mailing list
    // ones don't affect us here.
    if (aItem instanceof Components.interfaces.nsIAbCard)
      OnAddressBookDataChanged(nsIAbListener.itemChanged, null, aItem);
  }
};

function OnAddressBookDataChanged(aAction, aParentDir, aItem) {
  gEmailAddressHeaderNames.forEach(function (headerName) {
    let headerEntry = null;

    if (headerName in gExpandedHeaderView) {
      headerEntry = gExpandedHeaderView[headerName];
      if (headerEntry)
        headerEntry.enclosingBox.updateExtraAddressProcessing(aAction,
                                                              aParentDir,
                                                              aItem);
    }
  });
}

/**
 * The messageHeaderSink is the class that gets notified of a message's headers
 * as we display the message through our mime converter.
 */
var messageHeaderSink = {
    QueryInterface: XPCOMUtils.generateQI(
      [Components.interfaces.nsIMsgHeaderSink]),
    onStartHeaders: function()
    {
      this.mSaveHdr = null;
      // Every time we start to redisplay a message, check the view all headers
      // pref...
      var showAllHeadersPref = Services.prefs.getIntPref("mail.show_headers");
      if (showAllHeadersPref == 2) {
        gViewAllHeaders = true;
      } else {
        if (gViewAllHeaders) {
          // If we currently are in view all header mode, rebuild our header
          // view so we remove most of the header data.
          hideHeaderView(gExpandedHeaderView);
          RemoveNewHeaderViews(gExpandedHeaderView);
          gDummyHeaderIdIndex = 0;
          gExpandedHeaderView = {};
          initializeHeaderViewTables();
        }

        gViewAllHeaders = false;
      }

      ClearCurrentHeaders();
      gBuiltExpandedView = false;
      gBuildAttachmentsForCurrentMsg = false;
      ClearAttachmentList();
      gMessageNotificationBar.clearMsgNotifications();

      for (let index in gMessageListeners)
        gMessageListeners[index].onStartHeaders();
    },

    onEndHeaders: function()
    {
      // Give add-ons a chance to modify currentHeaderData before it actually
      // gets displayed.
      for (let index in gMessageListeners)
        if ("onBeforeShowHeaderPane" in gMessageListeners[index])
          gMessageListeners[index].onBeforeShowHeaderPane();

      // Load feed web page if so configured. This entry point works for
      // messagepane loads in 3pane folder tab, 3pane message tab, and the
      // standalone message window.
      if (!FeedMessageHandler.shouldShowSummary(gMessageDisplay.displayedMessage, false))
        FeedMessageHandler.setContent(gMessageDisplay.displayedMessage, false);

      ShowMessageHeaderPane();
      // WARNING: This is the ONLY routine inside of the message Header Sink
      // that should trigger a reflow!
      ClearHeaderView(gExpandedHeaderView);

      // Make sure there is a subject even if it's empty so we'll show the
      // subject and the twisty.
      EnsureSubjectValue();

      // Only update the expanded view if it's actually selected (an
      // extension-provided panel could be visible instead) and needs updating.
      if (document.getElementById("msgHeaderViewDeck").selectedIndex == 0 &&
          !gBuiltExpandedView) {
        UpdateExpandedMessageHeaders();
      }

      gMessageNotificationBar.setDraftEditMessage();
      UpdateJunkButton();

      for (let index in gMessageListeners)
        gMessageListeners[index].onEndHeaders();
    },

    processHeaders: function(headerNameEnumerator, headerValueEnumerator,
                             dontCollectAddress)
    {
      this.onStartHeaders();

      const kMailboxSeparator = ", ";
      var index = 0;
      while (headerNameEnumerator.hasMore()) {
        var header = new Object;
        header.headerValue = headerValueEnumerator.getNext();
        header.headerName = headerNameEnumerator.getNext();

        // For consistency's sake, let us force all header names to be lower
        // case so we don't have to worry about looking for: Cc and CC, etc.
        var lowerCaseHeaderName = header.headerName.toLowerCase();

        // If we have an x-mailer, x-mimeole, or x-newsreader string,
        // put it in the user-agent slot which we know how to handle already.
        if (/^x-(mailer|mimeole|newsreader)$/.test(lowerCaseHeaderName))
          lowerCaseHeaderName = "user-agent";

        if (this.mDummyMsgHeader) {
          if (lowerCaseHeaderName == "from")
            this.mDummyMsgHeader.author = header.headerValue;
          else if (lowerCaseHeaderName == "to")
            this.mDummyMsgHeader.recipients = header.headerValue;
          else if (lowerCaseHeaderName == "cc")
            this.mDummyMsgHeader.ccList = header.headerValue;
          else if (lowerCaseHeaderName == "subject")
            this.mDummyMsgHeader.subject = header.headerValue;
          else if (lowerCaseHeaderName == "reply-to")
            this.mDummyMsgHeader.replyTo = header.headerValue;
          else if (lowerCaseHeaderName == "message-id")
            this.mDummyMsgHeader.messageId = header.headerValue;
          else if (lowerCaseHeaderName == "list-post")
            this.mDummyMsgHeader.listPost = header.headerValue;
          else if (lowerCaseHeaderName == "delivered-to")
            this.mDummyMsgHeader.deliveredTo = header.headerValue;
          else if (lowerCaseHeaderName == "date")
            this.mDummyMsgHeader.date = Date.parse(header.headerValue) * 1000;
        }
        // according to RFC 2822, certain headers
        // can occur "unlimited" times
        if (lowerCaseHeaderName in currentHeaderData) {
          // Sometimes, you can have multiple To or Cc lines....
          // In this case, we want to append these headers into one.
          if (lowerCaseHeaderName == "to" || lowerCaseHeaderName == "cc") {
            currentHeaderData[lowerCaseHeaderName].headerValue =
              currentHeaderData[lowerCaseHeaderName].headerValue + "," +
                header.headerValue;
          } else {
            // Use the index to create a unique header name like:
            // received5, received6, etc
            currentHeaderData[lowerCaseHeaderName + index++] = header;
          }
        }
        else
         currentHeaderData[lowerCaseHeaderName] = header;
      } // while we have more headers to parse

      // Process message tags as if they were headers in the message.
      SetTagHeader();

      if (("from" in currentHeaderData) && ("sender" in currentHeaderData)) {
        var senderMailbox = kMailboxSeparator +
          MailServices.headerParser.extractHeaderAddressMailboxes(
            currentHeaderData.sender.headerValue) + kMailboxSeparator;
        var fromMailboxes = kMailboxSeparator +
          MailServices.headerParser.extractHeaderAddressMailboxes(
            currentHeaderData.from.headerValue) + kMailboxSeparator;
        if (fromMailboxes.includes(senderMailbox))
          delete currentHeaderData.sender;
      }

      // We don't need to show the reply-to header if its value is either
      // the From field (totally pointless) or the To field (common for
      // mailing lists, but not that useful).
      if (("from" in currentHeaderData) &&
          ("to" in currentHeaderData) &&
          ("reply-to" in currentHeaderData)) {
        var replyToMailbox = MailServices.headerParser.extractHeaderAddressMailboxes(
            currentHeaderData["reply-to"].headerValue);
        var fromMailboxes = MailServices.headerParser.extractHeaderAddressMailboxes(
            currentHeaderData.from.headerValue);
        var toMailboxes = MailServices.headerParser.extractHeaderAddressMailboxes(
            currentHeaderData.to.headerValue);

        if (replyToMailbox == fromMailboxes || replyToMailbox == toMailboxes)
          delete currentHeaderData["reply-to"];
      }

      let expandedfromLabel = document.getElementById("expandedfromLabel");
      if (gFolderDisplay.selectedMessageIsFeed)
        expandedfromLabel.value = expandedfromLabel.getAttribute("valueAuthor");
      else
        expandedfromLabel.value = expandedfromLabel.getAttribute("valueFrom");

      this.onEndHeaders();
    },

    handleAttachment: function(contentType, url, displayName, uri,
                               isExternalAttachment)
    {
      this.skipAttachment = true;

      // Don't show vcards as external attachments in the UI. libmime already
      // renders them inline.
      if (!this.mSaveHdr)
        this.mSaveHdr = messenger.messageServiceFromURI(uri)
                                 .messageURIToMsgHdr(uri);
      if (contentType == "text/x-vcard") {
        var inlineAttachments = Services.prefs.getBoolPref("mail.inline_attachments");
        var displayHtmlAs = Services.prefs.getIntPref("mailnews.display.html_as");
        if (inlineAttachments && !displayHtmlAs)
          return;
      }

      var size = null;
      if (isExternalAttachment && url.startsWith("file:")) {
        let fileHandler = Services.io.getProtocolHandler("file")
          .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
        try {
          let file = fileHandler.getFileFromURLSpec(url);
          // Can't get size for detached attachments which are no longer
          // available on the specified location.
          if (file.exists())
            size = file.fileSize;
        }
        catch(e) {
          Components.utils.reportError("Couldn't open external attachment; " +
                                       "url=" + url + "; " + e);
        }
      }

      currentAttachments.push(new AttachmentInfo(contentType, url, displayName,
                                                 uri, isExternalAttachment,
                                                 size));
      this.skipAttachment = false;

      // If we have an attachment, set the nsMsgMessageFlags.Attachment flag
      // on the hdr to cause the "message with attachment" icon to show up
      // in the thread pane.
      // We only need to do this on the first attachment.
      var numAttachments = currentAttachments.length;
      if (numAttachments == 1) {
        // We also have to enable the Message/Attachments menuitem.
        var node = document.getElementById("msgAttachmentMenu");
        if (node)
          node.removeAttribute("disabled");

        // convert the uri into a hdr
        this.mSaveHdr.markHasAttachments(true);
        // we also do the same on appmenu
        let appmenunode = document.getElementById("appmenu_msgAttachmentMenu");
        if (appmenunode)
          appmenunode.removeAttribute("disabled");

        // convert the uri into a hdr
        this.mSaveHdr.markHasAttachments(true);
      }
    },

    addAttachmentField: function(field, value)
    {
      if (this.skipAttachment)
        return;

      let last = currentAttachments[currentAttachments.length - 1];
      if (field == "X-Mozilla-PartSize" && !last.url.startsWith("file") &&
          !last.isDeleted) {
        let size = parseInt(value);

        if (last.isExternalAttachment && last.url.startsWith("http")) {
          // Check if an external link attachment's reported size is sane.
          // A size of < 2 isn't sensical so ignore such placeholder values.
          // Don't accept a size with any non numerics. Also cap the number.
          if (isNaN(size) || size.toString().length != value.length || size < 2)
            size = -1;
          if (size > Number.MAX_SAFE_INTEGER)
            size = Number.MAX_SAFE_INTEGER;
        }

        // libmime returns -1 if it never managed to figure out the size.
        if (size != -1)
          last.size = size;
      }
      else if (field == "X-Mozilla-PartDownloaded" && value == "0") {
        // We haven't downloaded the attachment, so any size we get from
        // libmime is almost certainly inaccurate. Just get rid of it. (Note:
        // this relies on the fact that PartDownloaded comes after PartSize from
        // the MIME emitter.)
        last.size = null;
      }
    },

    onEndAllAttachments: function()
    {
      displayAttachmentsForExpandedView();

      for (let listener of gMessageListeners) {
        if ("onEndAttachments" in listener)
          listener.onEndAttachments();
      }
    },

    /**
     * This event is generated by nsMsgStatusFeedback when it gets an
     * OnStateChange event for STATE_STOP.  This is the same event that
     * generates the "msgLoaded" property flag change event.  This best
     * corresponds to the end of the streaming process.
     */
    onEndMsgDownload: function(url)
    {
      gMessageDisplay.onLoadCompleted();

      let expanded = Services.prefs.getBoolPref(
        "mailnews.attachments.display.start_expanded");

      if (expanded)
        toggleAttachmentList(true);

      // if we don't have any attachments, turn off the attachments flag
      if (!this.mSaveHdr) {
        var messageUrl = url.QueryInterface(Components.interfaces.nsIMsgMessageUrl);
        this.mSaveHdr = messenger.msgHdrFromURI(messageUrl.uri);
      }
      if (!currentAttachments.length && this.mSaveHdr)
        this.mSaveHdr.markHasAttachments(false);

      let browser = getBrowser();
      if (currentAttachments.length &&
          Services.prefs.getBoolPref("mail.inline_attachments") &&
          this.mSaveHdr && gFolderDisplay.selectedMessageIsFeed &&
          browser && browser.contentDocument && browser.contentDocument.body) {
        for (let img of browser.contentDocument.body.getElementsByClassName("moz-attached-image")) {
          for (let attachment of currentAttachments) {
            let partID = img.src.split("&part=")[1];
            partID = partID ? partID.split("&")[0] : null;
            if (attachment.partID && partID == attachment.partID) {
              img.src = attachment.url;
              break;
            }
          }

          img.addEventListener("load", function(event) {
            if (this.clientWidth > this.parentNode.clientWidth) {
              img.setAttribute("overflowing", "true");
              img.setAttribute("shrinktofit", "true");
            }
          });
        }
      }

      OnMsgParsed(url);
    },

    onEndMsgHeaders: function(url)
    {
      OnMsgLoaded(url);
    },

    onMsgHasRemoteContent: function(aMsgHdr, aContentURI, aCanOverride)
    {
      gMessageNotificationBar.setRemoteContentMsg(aMsgHdr, aContentURI, aCanOverride);
    },

    mSecurityInfo  : null,
    mSaveHdr: null,
    get securityInfo()
    {
      return this.mSecurityInfo;
    },
    set securityInfo(aSecurityInfo)
    {
      this.mSecurityInfo = aSecurityInfo;
    },

    mDummyMsgHeader: null,

    get dummyMsgHeader()
    {
      if (!this.mDummyMsgHeader)
        this.mDummyMsgHeader = new nsDummyMsgHeader();
      // The URI resolution will never work on the dummy header;
      // save it now... we know it will be needed eventually.
      // (And save it every time we come through here, not just when
      // we create it; the onStartHeaders might come after creation!)
      this.mSaveHdr = this.mDummyMsgHeader;
      return this.mDummyMsgHeader;
    },
    mProperties: null,
    get properties()
    {
      if (!this.mProperties)
        this.mProperties = Components.classes["@mozilla.org/hash-property-bag;1"].
          createInstance(Components.interfaces.nsIWritablePropertyBag2);
      return this.mProperties;
    },

    resetProperties: function() {
      this.mProperties = null;
    }
};

function SetTagHeader()
{
  // It would be nice if we passed in the msgHdr from the back end.
  var msgHdr = gFolderDisplay.selectedMessage;
  if (!msgHdr)
    return; // no msgHdr to add our tags to

  // get the list of known tags
  var tagArray = MailServices.tags.getAllTags({});
  var tagKeys = {};
  for (var tagInfo of tagArray)
    if (tagInfo.tag)
      tagKeys[tagInfo.key] = true;

  // extract the tag keys from the msgHdr
  var msgKeyArray = msgHdr.getStringProperty("keywords").split(" ");

  // attach legacy label to the front if not already there
  var label = msgHdr.label;
  if (label) {
    let labelKey = "$label" + label;
    if (!msgKeyArray.includes(labelKey))
      msgKeyArray.unshift(labelKey);
  }

  // Rebuild the keywords string with just the keys that are actual tags or
  // legacy labels and not other keywords like Junk and NonJunk.
  // Retain their order, though, with the label as oldest element.
  for (let i = msgKeyArray.length - 1; i >= 0; --i)
    if (!(msgKeyArray[i] in tagKeys))
      msgKeyArray.splice(i, 1); // remove non-tag key
  var msgKeys = msgKeyArray.join(" ");

  if (msgKeys)
    currentHeaderData.tags = {headerName: "tags", headerValue: msgKeys};
  else // no more tags, so clear out the header field
    delete currentHeaderData.tags;
}

function EnsureSubjectValue()
{
  if (!("subject" in currentHeaderData)) {
    let foo = new Object;
    foo.headerValue = "";
    foo.headerName = "subject";
    currentHeaderData[foo.headerName] = foo;
  }
}

function OnTagsChange()
{
  // rebuild the tag headers
  SetTagHeader();

  // Now update the expanded header view to rebuild the tags,
  // and then show or hide the tag header box.
  if (gBuiltExpandedView) {
    let headerEntry = gExpandedHeaderView.tags;
    if (headerEntry) {
      headerEntry.valid = ("tags" in currentHeaderData);
      if (headerEntry.valid)
        headerEntry.outputFunction(headerEntry,
                                   currentHeaderData.tags.headerValue);

      // we may need to collapse or show the tag header row...
      headerEntry.enclosingRow.collapsed = !headerEntry.valid;
      // ... and ensure that all headers remain correctly aligned
      syncGridColumnWidths();
    }
  }
}

/**
 * Flush out any local state being held by a header entry for a given table.
 *
 * @param aHeaderTable Table of header entries
 */
function ClearHeaderView(aHeaderTable)
{
  for (let name in aHeaderTable) {
    let headerEntry = aHeaderTable[name];
    if (headerEntry.enclosingBox.clearHeaderValues)
      headerEntry.enclosingBox.clearHeaderValues();

    headerEntry.valid = false;
  }
}

/**
 * Make sure that any valid header entry in the table is collapsed.
 *
 * @param aHeaderTable Table of header entries
 */
function hideHeaderView(aHeaderTable)
{
  for (let name in aHeaderTable) {
    let headerEntry = aHeaderTable[name];
    headerEntry.enclosingRow.collapsed = true;
  }
}

/**
 * Make sure that any valid header entry in the table specified is visible.
 *
 * @param aHeaderTable Table of header entries
 */
function showHeaderView(aHeaderTable)
{
  for (let name in aHeaderTable) {
    let headerEntry = aHeaderTable[name];
    if (headerEntry.valid) {
      headerEntry.enclosingRow.collapsed = false;
    } else {
      // if the entry is invalid, always make sure it's collapsed
      headerEntry.enclosingRow.collapsed = true;
    }
  }
}

/**
 * Enumerate through the list of headers and find the number that are visible
 * add empty entries if we don't have the minimum number of rows.
 */
function EnsureMinimumNumberOfHeaders (headerTable)
{
  // 0 means we don't have a minimum... do nothing special
  if (!gMinNumberOfHeaders)
    return;

  var numVisibleHeaders = 0;
  for (let name in headerTable) {
    let headerEntry = headerTable[name];
    if (headerEntry.valid)
      numVisibleHeaders ++;
  }

  if (numVisibleHeaders < gMinNumberOfHeaders) {
    // How many empty headers do we need to add?
    var numEmptyHeaders = gMinNumberOfHeaders - numVisibleHeaders;

    // We may have already dynamically created our empty rows and we just need
    // to make them visible.
    for (let index in headerTable) {
      let headerEntry = headerTable[index];
      if (index.startsWith("Dummy-Header") && numEmptyHeaders) {
        headerEntry.valid = true;
        numEmptyHeaders--;
      }
    }

    // Ok, now if we have any extra dummy headers we need to add, create a new
    // header widget for them.
    while (numEmptyHeaders) {
      var dummyHeaderId = "Dummy-Header" + gDummyHeaderIdIndex;
      gExpandedHeaderView[dummyHeaderId] = new HeaderView(dummyHeaderId, "");
      gExpandedHeaderView[dummyHeaderId].valid = true;

      gDummyHeaderIdIndex++;
      numEmptyHeaders--;
    }

  }
}

/**
 * Make sure the appropriate fields in the expanded header view are collapsed
 * or visible...
 */
function updateExpandedView()
{
  // If the expanded view isn't selected, don't bother updating it.
  if (document.getElementById("msgHeaderViewDeck").selectedIndex != 0)
    return;

  if (gMinNumberOfHeaders)
    EnsureMinimumNumberOfHeaders(gExpandedHeaderView);
  showHeaderView(gExpandedHeaderView);

  // Now that we have all the headers, ensure that the name columns of both
  // grids are the same size so that they don't look weird.
  syncGridColumnWidths();

  UpdateJunkButton();
  UpdateReplyButtons();
  displayAttachmentsForExpandedView();

  try {
    AdjustHeaderView(Services.prefs.getIntPref("mail.show_headers"));
  } catch (e) { logException(e); }
}

/**
 * Ensure that the name columns in both grids are the same size, since the only
 * reason that we're using two grids at all is to workaround the XUL box
 * model's inability to float elements.
 */
function syncGridColumnWidths()
{
  let nameColumn = document.getElementById("expandedHeadersNameColumn");
  let nameColumn2 = document.getElementById("expandedHeaders2NameColumn");

  // Reset the minimum widths to 0 so that clientWidth will return the
  // preferred intrinsic width of each column.
  nameColumn.minWidth = nameColumn2.minWidth = 0;

  // Set minWidth on the smaller of the two columns to be the width of the
  // larger of the two.
  if (nameColumn.clientWidth > nameColumn2.clientWidth) {
    nameColumn2.minWidth = nameColumn.clientWidth;
  } else if (nameColumn.clientWidth < nameColumn2.clientWidth) {
    nameColumn.minWidth = nameColumn2.clientWidth;
  }
}

/**
 * Default method for updating a header value into a header entry
 *
 * @param aHeaderEntry  A single header from currentHeaderData
 * @param aHeaderValue  The new value for headerEntry
 */
function updateHeaderValue(aHeaderEntry, aHeaderValue)
{
  aHeaderEntry.enclosingBox.headerValue = aHeaderValue;
}

/**
 * Create the DOM nodes (aka "View") for a non-standard header and insert them
 * into the grid.  Create and return the corresponding headerEntry object.
 *
 * @param {String} headerName  name of the header we're adding, all lower-case;
 *                             used to construct element ids
 * @param {String} label       name of the header as displayed in the UI
 */
function HeaderView(headerName, label)
{
  let rowId = "expanded" + headerName + "Row";
  let idName = "expanded" + headerName + "Box";
  let newHeaderNode;
  // If a row for this header already exists, do not create another one.
  let newRowNode = document.getElementById(rowId);
  if (!newRowNode) {
    // Create new collapsed row.
    newRowNode = document.createElement("row");
    newRowNode.setAttribute("id", rowId);
    newRowNode.collapsed = true;

    // Create and append the label which contains the header name.
    let newLabelNode = document.createElement("label");
    newLabelNode.setAttribute("id", "expanded" + headerName + "Label");
    newLabelNode.setAttribute("value", label);
    newLabelNode.setAttribute("class", "headerName");
    newLabelNode.setAttribute("control", idName);
    newRowNode.appendChild(newLabelNode);

    // Create and append the new header value.
    newHeaderNode = document.createElement("mail-headerfield");
    newHeaderNode.setAttribute("id", idName);
    newHeaderNode.setAttribute("flex", "1");

    newRowNode.appendChild(newHeaderNode);

    // This new element needs to be inserted into the view...
    let topViewNode = document.getElementById("expandedHeader2Rows");
    topViewNode.appendChild(newRowNode);
    this.isNewHeader = true;
  } else {
    newHeaderNode = document.getElementById(idName);
    this.isNewHeader = false;
  }

  this.enclosingBox = newHeaderNode;
  this.enclosingRow = newRowNode;
  this.valid = false;
  this.useToggle = false;
  this.outputFunction = updateHeaderValue;
}

/**
 * Removes all non-predefined header nodes from the view.
 *
 * @param aHeaderTable  Table of header entries.
 */
function RemoveNewHeaderViews(aHeaderTable)
{
  for (let name in aHeaderTable) {
    let headerEntry = aHeaderTable[name];
    if (headerEntry.isNewHeader)
      headerEntry.enclosingRow.remove();
  }
}

/**
 * UpdateExpandedMessageHeaders: Iterate through all the current header data
 * we received from mime for this message for the expanded header entry table,
 * and see if we have a corresponding entry for that header (i.e.
 * whether the expanded header view cares about this header value)
 * If so, then call updateHeaderEntry
 */
function UpdateExpandedMessageHeaders() {
  // Iterate over each header we received and see if we have a matching entry
  // in each header view table...
  var headerName;

  // Remove the height attr so that it redraws correctly. Works around a problem
  // that attachment-splitter causes if it's moved high enough to affect
  // the header box:
  document.getElementById("msgHeaderView").removeAttribute("height");
  // This height attribute may be set by toggleWrap() if the user clicked
  // the "more" button" in the header.
  // Remove it so that the height is determined automatically.
  document.getElementById("expandedHeaderView").removeAttribute("height");

  for (headerName in currentHeaderData) {
    var headerField = currentHeaderData[headerName];
    var headerEntry = null;

    if (headerName in gExpandedHeaderView)
        headerEntry = gExpandedHeaderView[headerName];

    if (!headerEntry && gViewAllHeaders) {
      // for view all headers, if we don't have a header field for this
      // value....cheat and create one....then fill in a headerEntry
      if (headerName == "message-id" || headerName == "in-reply-to") {
        var messageIdEntry = {
          name: headerName,
          outputFunction: OutputMessageIds
        };
        gExpandedHeaderView[headerName] = new createHeaderEntry("expanded",
                                                                messageIdEntry);
      }
      // Don't bother showing X-Mozilla-LocalizedDate, since that value is
      // displayed below the message header toolbar.
      else if (headerName != "x-mozilla-localizeddate") {
        gExpandedHeaderView[headerName] =
          new HeaderView(headerName, currentHeaderData[headerName].headerName);
      }

      headerEntry = gExpandedHeaderView[headerName];
    }

    if (headerEntry) {
      if (headerName == "references" &&
          !(gViewAllHeaders || gHeadersShowReferences ||
            gFolderDisplay.view.isNewsFolder)) {
        // Hide references header if view all headers mode isn't selected, the
        // pref show references is deactivated and the currently displayed
        // message isn't a newsgroup posting.
        headerEntry.valid = false;
      } else {
        headerEntry.outputFunction(headerEntry, headerField.headerValue);
        headerEntry.valid = true;
      }
    }
  }

  let dateLabel = document.getElementById("dateLabel");
  if ("x-mozilla-localizeddate" in currentHeaderData) {
    document.getElementById("dateLabel").textContent =
      currentHeaderData["x-mozilla-localizeddate"].headerValue;
    dateLabel.collapsed = false;
  } else {
    dateLabel.collapsed = true;
  }

  gBuiltExpandedView = true;

  // Now update the view to make sure the right elements are visible.
  updateExpandedView();
}

function ClearCurrentHeaders()
{
  currentHeaderData = {};
  currentAttachments = new Array();
}

function ShowMessageHeaderPane()
{
  document.getElementById("msgHeaderView").collapsed = false;
}

function HideMessageHeaderPane()
{
  document.getElementById("msgHeaderView").collapsed = true;

  // Disable the Message/Attachments menuitem.
  document.getElementById("msgAttachmentMenu").setAttribute("disabled", "true");

  // If the App Menu is being used, disable the attachment menu in there as
  // well.
  let appMenuNode = document.getElementById("appmenu_msgAttachmentMenu");
  if (appMenuNode)
    appMenuNode.setAttribute("disabled", "true");

  // disable the attachment box
  document.getElementById("attachmentView").collapsed = true;
  document.getElementById("attachment-splitter").collapsed = true;

  gMessageNotificationBar.clearMsgNotifications();
}

/**
 * Take string of newsgroups separated by commas, split it
 * into newsgroups and send them to the corresponding
 * mail-newsgroups-headerfield element.
 *
 * @param headerEntry  the entry data structure for this header
 * @param headerValue  the string value for the header from the message
 */
function OutputNewsgroups(headerEntry, headerValue)
{
  headerValue.split(",").forEach(
    newsgroup => headerEntry.enclosingBox.addNewsgroupView(newsgroup));

  headerEntry.enclosingBox.buildViews();
}

/**
 * Take string of message-ids separated by whitespace, split it
 * into message-ids and send them together with the index number
 * to the corresponding mail-messageids-headerfield element.
 */
function OutputMessageIds(headerEntry, headerValue)
{
  let messageIdArray = headerValue.split(/\s+/);

  headerEntry.enclosingBox.clearHeaderValues();
  for (let i = 0; i < messageIdArray.length; i++)
    headerEntry.enclosingBox.addMessageIdView(messageIdArray[i]);

  headerEntry.enclosingBox.fillMessageIdNodes();
}

/**
 * OutputEmailAddresses: knows how to take a comma separated list of email
 * addresses, extracts them one by one, linkifying each email address into
 * a mailto url. Then we add the link-ified email address to the parentDiv
 * passed in.
 *
 * @param headerEntry     parent div
 * @param emailAddresses  comma separated list of the addresses for this
 *                        header field
 */
function OutputEmailAddresses(headerEntry, emailAddresses)
{
  if (!emailAddresses)
    return;

  // The email addresses are still RFC2047 encoded but libmime has already converted from
  // "raw UTF-8" to "wide" (UTF-16) characters.
  var addresses = MailServices.headerParser.parseEncodedHeaderW(emailAddresses);

  if (headerEntry.useToggle)
    headerEntry.enclosingBox.resetAddressView(); // make sure we start clean
  if (addresses.length == 0 && emailAddresses.includes(":")) {
    // No addresses and a colon, so an empty group like "undisclosed-recipients: ;".
    // Add group name so at least something displays.
    let address = { displayName: emailAddresses };
    if (headerEntry.useToggle)
      headerEntry.enclosingBox.addAddressView(address);
    else
      updateEmailAddressNode(headerEntry.enclosingBox.emailAddressNode, address);
  }
  for (let addr of addresses) {
    // If we want to include short/long toggle views and we have a long view,
    // always add it. If we aren't including a short/long view OR if we are and
    // we haven't parsed enough addresses to reach the cutoff valve yet then add
    // it to the default (short) div.
    let address = {};
    address.emailAddress = addr.email;
    address.fullAddress = addr.toString();
    address.displayName = addr.name;
    if (headerEntry.useToggle)
      headerEntry.enclosingBox.addAddressView(address);
    else
      updateEmailAddressNode(headerEntry.enclosingBox.emailAddressNode, address);
  }

  if (headerEntry.useToggle)
    headerEntry.enclosingBox.buildViews();
}

function updateEmailAddressNode(emailAddressNode, address)
{
  emailAddressNode.setAttribute("emailAddress", address.emailAddress || "");
  emailAddressNode.setAttribute("fullAddress", address.fullAddress || "");
  emailAddressNode.setAttribute("displayName", address.displayName || "");

  if (address.emailAddress)
    UpdateEmailNodeDetails(address.emailAddress, emailAddressNode);
}

function UpdateEmailNodeDetails(aEmailAddress, aDocumentNode, aCardDetails) {
  // If we haven't been given specific details, search for a card.
  var cardDetails = aCardDetails ? aCardDetails :
                                   getCardForEmail(aEmailAddress);
  aDocumentNode.cardDetails = cardDetails;

  if (!cardDetails.card) {
    aDocumentNode.setAttribute("hascard", "false");
    aDocumentNode.setAttribute("tooltipstar",
      document.getElementById("addToAddressBookItem").label);
  }
  else {
    aDocumentNode.setAttribute("hascard", "true");
    aDocumentNode.setAttribute("tooltipstar",
      document.getElementById("editContactItem").label);
  }

  // When we are adding cards, we don't want to move the display around if the
  // user has clicked on the star, therefore if it is locked, just exit and
  // leave the display updates until later.
  if (aDocumentNode.hasAttribute("updatingUI"))
    return;

  var displayName = FormatDisplayName(aEmailAddress,
                                      aDocumentNode.getAttribute("displayName"),
                                      aDocumentNode.getAttribute("headerName"),
                                      aDocumentNode.cardDetails.card);

  if (gShowCondensedEmailAddresses && displayName) {
    aDocumentNode.setAttribute("label", displayName);
    aDocumentNode.setAttribute("tooltiptext", aEmailAddress);
  }
  else {
    aDocumentNode.setAttribute("label",
      aDocumentNode.getAttribute("fullAddress") ||
      aDocumentNode.getAttribute("displayName"));
  }
}

function UpdateEmailPresenceDetails(aDocumentNode, aChatContact) {
  aDocumentNode.removeAttribute("chatStatus");
  aDocumentNode.removeAttribute("presenceTooltip");
}

function UpdateExtraAddressProcessing(aAddressData, aDocumentNode, aAction,
                                      aParentDir, aItem)
{
  switch (aAction) {
  case nsIAbListener.itemChanged:
    if (aAddressData &&
        aDocumentNode.cardDetails.card &&
        aItem.hasEmailAddress(aAddressData.emailAddress)) {
      aDocumentNode.cardDetails.card = aItem;
      var displayName = FormatDisplayName(aAddressData.emailAddress,
                                          aDocumentNode.getAttribute("displayName"),
                                          aDocumentNode.getAttribute("headerName"),
                                          aDocumentNode.cardDetails.card);

      if (gShowCondensedEmailAddresses && displayName) {
        aDocumentNode.setAttribute("label", displayName);
      } else {
        aDocumentNode.setAttribute("label",
                                   aDocumentNode.getAttribute("fullAddress") ||
                                   aDocumentNode.getAttribute("displayName"));
      }
    }
    break;
  case nsIAbListener.itemAdded:
    // Is it a new address book?
    if (aItem instanceof nsIAbDirectory) {
      // If we don't have a match, search again for updates (e.g. a interface
      // to an existing book may just have been added).
      if (!aDocumentNode.cardDetails.card)
        UpdateEmailNodeDetails(aAddressData.emailAddress, aDocumentNode);
    }
    else if (aItem instanceof nsIAbCard) {
      // If we don't have a card, does this new one match?
      if (aDocumentNode.cardDetails && !aDocumentNode.cardDetails.card &&
          aItem.hasEmailAddress(aAddressData.emailAddress)) {
        // Just in case we have a bogus parent directory.
        if (aParentDir instanceof nsIAbDirectory) {
          var cardDetails = { book: aParentDir, card: aItem };
          UpdateEmailNodeDetails(aAddressData.emailAddress, aDocumentNode,
                                 cardDetails);
        } else {
          UpdateEmailNodeDetails(aAddressData.emailAddress, aDocumentNode);
        }
      }
    }
    break;
  case nsIAbListener.directoryItemRemoved:
    // Unfortunately we don't necessarily get the same card object back.
    if (aAddressData && aDocumentNode.cardDetails &&
        aDocumentNode.cardDetails.card &&
        aDocumentNode.cardDetails.book == aParentDir &&
        aItem.hasEmailAddress(aAddressData.emailAddress)) {
      UpdateEmailNodeDetails(aAddressData.emailAddress, aDocumentNode);
    }
    break;
  case nsIAbListener.directoryRemoved:
    if (aDocumentNode.cardDetails.book == aItem)
      UpdateEmailNodeDetails(aAddressData.emailAddress, aDocumentNode);
    break;
  }
}

function findEmailNodeFromPopupNode(elt, popup)
{
  // This annoying little function is needed because in the binding for
  // mail-emailaddress, we set the context on the <description>, but that if
  // the user clicks on the label, then popupNode is set to it, rather than
  // the description.  So we have walk up the parent until we find the
  // element with the popup set, and then return its parent.

  while (elt.getAttribute("popup") != popup) {
    elt = elt.parentNode;
    if (elt == null)
      return null;
  }
  return elt.parentNode;
}

function hideEmailNewsPopup(addressNode)
{
  // highlight the emailBox/newsgroupBox
  addressNode.removeAttribute("selected");
}

function setupEmailAddressPopup(emailAddressNode)
{
  var emailAddressPlaceHolder = document.getElementById("emailAddressPlaceHolder");
  var emailAddress = emailAddressNode.getPart("emaillabel").value;
  emailAddressNode.setAttribute("selected", "true");
  emailAddressPlaceHolder.setAttribute("label", emailAddress);

  if (emailAddressNode.cardDetails && emailAddressNode.cardDetails.card) {
    document.getElementById("addToAddressBookItem").setAttribute("hidden", true);
    if (!emailAddressNode.cardDetails.book.readOnly) {
      document.getElementById("editContactItem").removeAttribute("hidden");
      document.getElementById("viewContactItem").setAttribute("hidden", true);
    } else {
      document.getElementById("editContactItem").setAttribute("hidden", true);
      document.getElementById("viewContactItem").removeAttribute("hidden");
    }
  } else {
    document.getElementById("addToAddressBookItem").removeAttribute("hidden");
    document.getElementById("editContactItem").setAttribute("hidden", true);
    document.getElementById("viewContactItem").setAttribute("hidden", true);
  }
}

/**
 * Returns an object with two properties, book and card. If the email address
 * is found in the address books, then the book will contain an nsIAbDirectory,
 * and card will contain an nsIAbCard. If the email address is not found, both
 * items will contain null.
 *
 * @param emailAddress  address to look for
 * @return              an object with two properties, .book and .card
 */
function getCardForEmail(emailAddress)
{
  // Email address is searched for in any of the address books that support
  // the cardForEmailAddress function.
  // Future expansion could be to domain matches

  var books = MailServices.ab.directories;

  var result = { book: null, card: null };

  while (!result.card && books.hasMoreElements()) {
    var ab = books.getNext().QueryInterface(nsIAbDirectory);
    try {
      var card = ab.cardForEmailAddress(emailAddress);
      if (card) {
        result.book = ab;
        result.card = card;
      }
    }
    catch (ex) { }
  }

  return result;
}

function onClickEmailStar(event, emailAddressNode)
{
  // Only care about left-click events
  if (event.button != 0)
    return;

  if (emailAddressNode && emailAddressNode.cardDetails &&
      emailAddressNode.cardDetails.card) {
    EditContact(emailAddressNode);
  } else {
    AddContact(emailAddressNode);
  }
}

function onClickEmailPresence(event, emailAddressNode)
{
  // Only care about left-click events
  if (event.button != 0)
    return;

  let prplConv = emailAddressNode.chatContact.createConversation();
  let uiConv = Services.conversations.getUIConversation(prplConv);

  let win = window;
  if (!("focusConversation" in chatHandler)) {
    win = Services.wm.getMostRecentWindow("mail:3pane");
    if (win)
      win.focus();
    else {
      window.openDialog("chrome://messenger/content/", "_blank",
                        "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar", null,
                        {tabType: "chat",
                         tabParams: {convType: "focus", conv: uiConv}});
      return;
    }
  }

  win.showChatTab();
  win.chatHandler.focusConversation(uiConv);
}

/**
 * Takes the email address node, adds a new contact from the node's
 * displayName and emailAddress attributes to the personal address book.
 *
 * @param emailAddressNode  a node with displayName and emailAddress attributes
 */
function AddContact(emailAddressNode)
{
  // When we collect an address, it updates the AB which sends out
  // notifications to update the UI. In the add case we don't want to update
  // the UI so that accidentally double-clicking on the star doesn't lead
  // to something strange (i.e star would be moved out from underneath,
  // leaving something else there).
  emailAddressNode.setAttribute("updatingUI", true);

  const kPersonalAddressbookURI = "moz-abmdbdirectory://abook.mab";
  let addressBook = MailServices.ab.getDirectory(kPersonalAddressbookURI);

  let card = Components.classes["@mozilla.org/addressbook/cardproperty;1"]
                       .createInstance(Components.interfaces.nsIAbCard);
  card.displayName = emailAddressNode.getAttribute("displayName");
  card.primaryEmail = emailAddressNode.getAttribute("emailAddress");

  // Just save the new node straight away.
  addressBook.addCard(card);

  emailAddressNode.removeAttribute("updatingUI");
}

function EditContact(emailAddressNode)
{
  if (emailAddressNode.cardDetails.card)
    editContactInlineUI.showEditContactPanel(emailAddressNode.cardDetails,
                                             emailAddressNode);
}

/**
 * Takes the email address title button, extracts the email address we stored
 * in there and opens a compose window with that address.
 *
 * @param addressNode  a node which has a "fullAddress" or "newsgroup" attribute
 * @param aEvent       the event object when user triggers the menuitem
 */
function SendMailToNode(addressNode, aEvent)
{
  let fields = Components.classes["@mozilla.org/messengercompose/composefields;1"]
                         .createInstance(Components.interfaces.nsIMsgCompFields);
  let params = Components.classes["@mozilla.org/messengercompose/composeparams;1"]
                         .createInstance(Components.interfaces.nsIMsgComposeParams);

  fields.newsgroups = addressNode.getAttribute("newsgroup");
  if (addressNode.hasAttribute("fullAddress")) {
    let addresses = MailServices.headerParser.makeFromDisplayAddress(
      addressNode.getAttribute("fullAddress"), {});
    if (addresses.length > 0)
      fields.to = MailServices.headerParser.makeMimeHeader(addresses, 1);
  }

  params.type = Components.interfaces.nsIMsgCompType.New;

  // If aEvent is passed, check if Shift key was pressed for composition in
  // non-default format (HTML vs. plaintext).
  params.format = (aEvent && aEvent.shiftKey) ?
    Components.interfaces.nsIMsgCompFormat.OppositeOfDefault :
    Components.interfaces.nsIMsgCompFormat.Default;

  if (gFolderDisplay.displayedFolder) {
    params.identity = accountManager.getFirstIdentityForServer(
                        gFolderDisplay.displayedFolder.server);
  }
  params.composeFields = fields;
  MailServices.compose.OpenComposeWindowWithParams(null, params);
}

/**
 * Takes the email address or newsgroup title button, extracts the address/name
 * we stored in there and copies it to the clipboard.
 *
 * @param addressNode  a node which has an "emailAddress" or "newsgroup"
 *                     attribute
 * @param aIncludeName when true, also copy the name onto the clipboard,
 *                     otherwise only the email address
 */
function CopyEmailNewsAddress(addressNode, aIncludeName = false)
{
  let clipboard = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                            .getService(Components.interfaces.nsIClipboardHelper);
  let address = addressNode.getAttribute(aIncludeName ? "fullAddress"
                                                      : "emailAddress") ||
                addressNode.getAttribute("newsgroup");
  clipboard.copyString(address);
}

/**
 * Causes the filter dialog to pop up, prefilled for the specified e-mail
 * address or header value.
 *
 * @param aHeaderNode  A node which has an "emailAddress" attribute
 *                     or a "headerName" attribute.
 * @param aMessage     Optional nsIMsgHdr of the message from which the values
 *                     are taken. Will be used to preselect its folder in the
 *                     filter list.
 */
function CreateFilter(aHeaderNode, aMessage)
{
  let nodeIsAddress = aHeaderNode.hasAttribute("emailAddress");
  let nodeValue = nodeIsAddress ? aHeaderNode.getAttribute("emailAddress") :
                                  document.getAnonymousNodes(aHeaderNode)[0].textContent;
  let folder = aMessage ? aMessage.folder : null;
  top.MsgFilters(nodeValue, folder, aHeaderNode.getAttribute("headerName"));
}

/**
 * Get the newsgroup server corresponding to the currently selected message.
 *
 * @return nsISubscribableServer for the newsgroup, or null
 */
function GetNewsgroupServer()
{
  if (gFolderDisplay.selectedMessageIsNews) {
    let server = gFolderDisplay.selectedMessage.folder.server;
    if (server)
      return server.QueryInterface(Components.interfaces.nsISubscribableServer);
  }
  return null;
}

/**
 * Initialize the newsgroup popup, showing/hiding menu items as appropriate.
 *
 * @param newsgroupNode  a node which has a "newsgroup" attribute
 */
function setupNewsgroupPopup(newsgroupNode)
{
  let newsgroupPlaceHolder = document.getElementById("newsgroupPlaceHolder");
  let newsgroup = newsgroupNode.getAttribute("newsgroup");
  newsgroupNode.setAttribute("selected", "true");
  newsgroupPlaceHolder.setAttribute("label", newsgroup);

  let server = GetNewsgroupServer();
  if (server) {
    // XXX Why is this necessary when nsISubscribableServer contains
    // |isSubscribed|?
    server = server.QueryInterface(Components.interfaces.nsINntpIncomingServer);
    if (!server.containsNewsgroup(newsgroup)) {
      document.getElementById("subscribeToNewsgroupItem")
              .removeAttribute("hidden");
      document.getElementById("subscribeToNewsgroupSeparator")
              .removeAttribute("hidden");
      return;
    }
  }
  document.getElementById("subscribeToNewsgroupItem")
          .setAttribute("hidden", true);
  document.getElementById("subscribeToNewsgroupSeparator")
          .setAttribute("hidden", true);
}

/**
 * Subscribe to a newsgroup based on the newsgroup title button
 *
 * @param newsgroupNode  a node which has a "newsgroup" attribute
 */
function SubscribeToNewsgroup(newsgroupNode)
{
  let server = GetNewsgroupServer();
  if (server) {
    let newsgroup = newsgroupNode.getAttribute("newsgroup");
    server.subscribe(newsgroup);
    server.commitSubscribeChanges();
  }
}

/**
 * Takes the newsgroup address title button, extracts the newsgroup name we
 * stored in there and copies it to the clipboard.
 *
 * @param newsgroupNode  a node which has a "newsgroup" attribute
 */
function CopyNewsgroupName(newsgroupNode)
{
  let clipboard = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                            .getService(Components.interfaces.nsIClipboardHelper);
  clipboard.copyString(newsgroupNode.getAttribute("newsgroup"));
}

/**
 * Takes the newsgroup address title button, extracts the newsgroup name we
 * stored in there and copies it URL to it.
 *
 * @param newsgroupNode  a node which has a "newsgroup" attribute
 */
function CopyNewsgroupURL(newsgroupNode)
{
  let server = GetNewsgroupServer();
  if (!server)
    return;

  let ng = newsgroupNode.getAttribute("newsgroup");

  let url;
  if (server.socketType != Components.interfaces.nsMsgSocketType.SSL) {
    url = "news://" + server.hostName;
    if (server.port != Components.interfaces.nsINntpUrl.DEFAULT_NNTP_PORT)
      url += ":" + server.port;
    url += "/" + ng;
  } else {
    url = "snews://" + server.hostName;
    if (server.port != Components.interfaces.nsINntpUrl.DEFAULT_NNTPS_PORT)
      url += ":" + server.port;
    url += "/" + ng;
  }

  try {
    let uri = Services.io.newURI(url, null, null);
    let clipboard = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                              .getService(Components.interfaces.nsIClipboardHelper);
    clipboard.copyString(decodeURI(uri.spec));
  } catch(e) {
     Components.utils.reportError("Invalid URL: "+ url);
  }
}

/**
 * Create a new attachment object which goes into the data attachment array.
 * This method checks whether the passed attachment is empty or not.
 *
 * @param contentType  The attachment's mimetype
 * @param url  The URL for the attachment
 * @param name  The name to be displayed for this attachment (usually the
 *              filename)
 * @param uri  The URI for the message containing the attachment
 * @param isExternalAttachment  True if the attachment has been detached
 * @param size  The size in bytes of the attachment
 */
function AttachmentInfo(contentType, url, name, uri,
                        isExternalAttachment, size)
{
  this.contentType = contentType;
  this.name = name;
  this.uri = uri;
  this.isExternalAttachment = isExternalAttachment;
  this.size = size;
  let match;

  // Remove [?&]part= from remote urls, after getting the partID.
  // Remote urls, unlike non external mail part urls, may also contain query
  // strings starting with ?; PART_RE does not handle this.
  if (url.startsWith("http") || url.startsWith("file")) {
    match = url.match(/[?&]part=[^&]+$/);
    match = match && match[0];
    this.partID = match && match.split("part=")[1];
    url = url.replace(match, "");
  }
  else {
    match = GlodaUtils.PART_RE.exec(url);
    this.partID = match && match[1];
  }

  this.url = url;
}

AttachmentInfo.prototype = {
  /**
   * Save this attachment to a file.
   */
  save: function AttachmentInfo_save()
  {
    messenger.saveAttachment(this.contentType, this.url,
                             encodeURIComponent(this.name),
                             this.uri, this.isExternalAttachment);
  },

  /**
   * Open this attachment.
   */
  open: function AttachmentInfo_open()
  {
    if (!this.hasFile)
      return;

    if (this.isEmpty) {
      var prompt = document.getElementById("bundle_messenger")
                           .getString("emptyAttachment");
      msgWindow.promptDialog.alert(null, prompt);
    } else {
      messenger.openAttachment(this.contentType, this.url,
                               encodeURIComponent(this.name),
                               this.uri, this.isExternalAttachment);
    }
  },

  /**
   * Detach this attachment from the message.
   *
   * @param aSaveFirst  true if the attachment should be saved before detaching,
   *                    false otherwise
   */
  detach: function AttachmentInfo_detach(aSaveFirst)
  {
    messenger.detachAttachment(this.contentType, this.url,
                               encodeURIComponent(this.name),
                               this.uri, aSaveFirst);
  },

  /**
   * This method checks whether the attachment has been deleted or not.
   *
   * @return true if the attachment has been deleted, false otherwise
   */
  get isDeleted()
  {
    return this.contentType == "text/x-moz-deleted";
  },

  /**
   * This method checks whether the attachment has an associated file or not.
   * Deleted attachments or detached attachments with missing external files
   * do *not* have a file.
   *
   * @return true if the attachment has an associated file, false otherwise
   */
  get hasFile()
  {
    if (this.isDeleted)
      return false;
    if (this.isExternalAttachment && this.url.startsWith("file:") &&
        this.size === null)
      return false;

    return true;
  },

  /**
   * This method checks whether the attachment is empty or not.
   *
   * @return  true if the attachment is empty, false otherwise
   */
  get isEmpty()
  {
    // Create an input stream on the attachment url.
    let url = Services.io.newURI(this.url, null, null);
    let channel = Services.io.newChannelFromURI2(url,
                                                 null,
                                                 Services.scriptSecurityManager.getSystemPrincipal(),
                                                 null,
                                                 Components.interfaces.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_DATA_IS_NULL,
                                                 Components.interfaces.nsIContentPolicy.TYPE_OTHER);
    let stream = channel.open();

    let inputStream = Components.classes["@mozilla.org/binaryinputstream;1"]
                                .createInstance(Components.interfaces.nsIBinaryInputStream);
    inputStream.setInputStream(stream);

    let bytesAvailable = 0;

    if (inputStream.isNonBlocking()) {
      // If the stream does not block, test on two conditions:
      //   - attachment is empty     -> 0 bytes will be returned on readBytes()
      //   - attachment is not empty -> NS_BASE_STREAM_WOULD_BLOCK exception is
      //                                thrown
      let chunk = null;

      try {
        chunk = inputStream.readBytes(1);
      } catch (ex) {
        if (ex.result == Components.results.NS_BASE_STREAM_WOULD_BLOCK) {
          bytesAvailable = 1;
        } else {
          throw ex;
        }
      }
      if (chunk)
        bytesAvailable = chunk.length;
    } else {
      // If the stream blocks, we can rely on available() to return the correct
      // number.
      bytesAvailable = inputStream.available();
    }

    return (bytesAvailable == 0);
  },
};

/**
 * Return true if possible attachments in the currently loaded message can be
 * deleted/detached.
 */
function CanDetachAttachments()
{
  var canDetach = !gFolderDisplay.selectedMessageIsNews &&
                  (!gFolderDisplay.selectedMessageIsImap ||
                   MailOfflineMgr.isOnline());
  if (canDetach && ("content-type" in currentHeaderData))
    canDetach = !ContentTypeIsSMIME(currentHeaderData["content-type"].headerValue);
  return canDetach;
}

/**
 * Return true if the content type is an S/MIME one.
 */
function ContentTypeIsSMIME(contentType)
{
  // S/MIME is application/pkcs7-mime and application/pkcs7-signature
  // - also match application/x-pkcs7-mime and application/x-pkcs7-signature.
  return /application\/(x-)?pkcs7-(mime|signature)/.test(contentType);
}

function onShowAttachmentToolbarContextMenu()
{
  let expandBar = document.getElementById("context-expandAttachmentBar");
  let expanded = Services.prefs.getBoolPref(
    "mailnews.attachments.display.start_expanded");
  expandBar.setAttribute("checked", expanded);
}

/**
 * Set up the attachment item context menu, showing or hiding the appropriate
 * menu items.
 */
function onShowAttachmentItemContextMenu()
{
  let attachmentList = document.getElementById("attachmentList");
  let attachmentInfo = document.getElementById("attachmentInfo");
  let attachmentName = document.getElementById("attachmentName");
  let contextMenu    = document.getElementById("attachmentItemContext");
  let openMenu       = document.getElementById("context-openAttachment");
  let saveMenu       = document.getElementById("context-saveAttachment");
  let detachMenu     = document.getElementById("context-detachAttachment");
  let deleteMenu     = document.getElementById("context-deleteAttachment");
  let copyUrlMenuSep = document.getElementById("context-menu-copyurl-separator");
  let copyUrlMenu    = document.getElementById("context-copyAttachmentUrl");

  // If we opened the context menu from the attachment info area (the paperclip,
  // "1 attachment" label, filename, or file size, just grab the first (and
  // only) attachment as our "selected" attachments.
  var selectedAttachments;
  if (contextMenu.triggerNode == attachmentInfo ||
      contextMenu.triggerNode.parentNode == attachmentInfo) {
    selectedAttachments = [attachmentList.getItemAtIndex(0).attachment];
    if (contextMenu.triggerNode == attachmentName)
      attachmentName.setAttribute("selected", true);
  }
  else {
    selectedAttachments =
      [...attachmentList.selectedItems].map(item => item.attachment);
  }
  contextMenu.attachments = selectedAttachments;

  var allSelectedDetached = selectedAttachments.every(function(attachment) {
    return attachment.isExternalAttachment;
  });
  var allSelectedDeleted = selectedAttachments.every(function(attachment) {
    return !attachment.hasFile;
  });
  var canDetachSelected = CanDetachAttachments() && !allSelectedDetached &&
                          !allSelectedDeleted;
  let allSelectedHttp = selectedAttachments.every(function(attachment) {
    return attachment.url.startsWith("http");
  });

  openMenu.disabled = allSelectedDeleted;
  saveMenu.disabled = allSelectedDeleted;
  detachMenu.disabled = !canDetachSelected;
  deleteMenu.disabled = !canDetachSelected;
  copyUrlMenuSep.hidden = copyUrlMenu.hidden = !allSelectedHttp;
}

/**
 * Close the attachment item context menu, performing any cleanup as necessary.
 */
function onHideAttachmentItemContextMenu()
{
  let attachmentName = document.getElementById("attachmentName");
  let contextMenu = document.getElementById("attachmentItemContext");

  // If we opened the context menu from the attachmentName label, we need to
  // get rid of the "selected" attribute.
  if (contextMenu.triggerNode == attachmentName)
    attachmentName.removeAttribute("selected");
}

/**
 * Enable/disable menu items as appropriate for the single-attachment save all
 * toolbar button.
 */
function onShowSaveAttachmentMenuSingle()
{
  let openItem   = document.getElementById('button-openAttachment');
  let saveItem   = document.getElementById('button-saveAttachment');
  let detachItem = document.getElementById('button-detachAttachment');
  let deleteItem = document.getElementById('button-deleteAttachment');

  let detached = currentAttachments[0].isExternalAttachment;
  let deleted  = !currentAttachments[0].hasFile;
  let canDetach = CanDetachAttachments() && !deleted && !detached;

  openItem.disabled = deleted;
  saveItem.disabled = deleted;
  detachItem.disabled = !canDetach;
  deleteItem.disabled = !canDetach;
}

/**
 * Enable/disable menu items as appropriate for the multiple-attachment save all
 * toolbar button.
 */
function onShowSaveAttachmentMenuMultiple()
{
  let openAllItem   = document.getElementById('button-openAllAttachments');
  let saveAllItem   = document.getElementById('button-saveAllAttachments');
  let detachAllItem = document.getElementById('button-detachAllAttachments');
  let deleteAllItem = document.getElementById('button-deleteAllAttachments');

  let allDetached = currentAttachments.every(function(attachment) {
    return attachment.isExternalAttachment;
  });
  let allDeleted = currentAttachments.every(function(attachment) {
    return !attachment.hasFile;
  });
  let canDetach = CanDetachAttachments() && !allDeleted && !allDetached;

  openAllItem.disabled = allDeleted;
  saveAllItem.disabled = allDeleted;
  detachAllItem.disabled = !canDetach;
  deleteAllItem.disabled = !canDetach;
}

function MessageIdClick(node, event)
{
  if (event.button == 0) {
    var messageId = GetMessageIdFromNode(node, true);
    OpenMessageForMessageId(messageId);
  }
}

/**
 * This is our oncommand handler for the attachment list items. A double click
 * or enter press in an attachmentitem simulates "opening" the attachment.
 *
 * @param event  the event object
 */
function attachmentItemCommand(event)
{
  HandleSelectedAttachments("open");
}

var AttachmentListController =
{
  supportsCommand: function(command)
  {
    switch (command) {
      case "cmd_selectAll":
      case "cmd_delete":
      case "cmd_shiftDelete":
      case "cmd_saveAsFile":
        return true;
      default:
        return false;
    }
  },

  isCommandEnabled: function(command)
  {
    switch (command) {
      case "cmd_selectAll":
      case "cmd_delete":
      case "cmd_shiftDelete":
      case "cmd_saveAsFile":
        return true;
      default:
        return false;
    }
  },

  doCommand: function(command)
  {
    // If the user invoked a key short cut then it is possible that we got here
    // for a command which is really disabled. kick out if the command should
    // be disabled.
    if (!this.isCommandEnabled(command))
      return;

    var attachmentList = document.getElementById("attachmentList");

    switch (command) {
      case "cmd_selectAll":
        attachmentList.selectAll();
        return;
      case "cmd_delete":
      case "cmd_shiftDelete":
        HandleSelectedAttachments("delete");
        return;
      case "cmd_saveAsFile":
        HandleSelectedAttachments("saveAs");
        return;
    }
  },

  onEvent: function(event)
  {}
};

var AttachmentMenuController = {
  commands: {
    cmd_openAllAttachments: {
      isEnabled: function() {
        return AttachmentMenuController._someFilesAvailable();
      },

      doCommand: function() {
        HandleAllAttachments("open");
      },
    },

    cmd_saveAllAttachments: {
      isEnabled: function() {
        return AttachmentMenuController._someFilesAvailable();
      },

      doCommand: function() {
        HandleAllAttachments("save");
      },
    },

    cmd_detachAllAttachments: {
      isEnabled: function() {
        return AttachmentMenuController._canDetachFiles();
      },

      doCommand: function() {
        HandleAllAttachments("detach");
      },
    },

    cmd_deleteAllAttachments: {
      isEnabled: function() {
        return AttachmentMenuController._canDetachFiles();
      },

      doCommand: function() {
        HandleAllAttachments("delete");
      },
    },
  },

  _canDetachFiles: function() {
    let someNotDetached = currentAttachments.some(function(aAttachment) {
      return !aAttachment.isExternalAttachment;
    });

    return CanDetachAttachments() &&
           someNotDetached &&
           this._someFilesAvailable();
  },

  _someFilesAvailable: function() {
    return currentAttachments.some(function(aAttachment) {
      return aAttachment.hasFile;
    });
  },

  supportsCommand: function(aCommand) {
    return (aCommand in this.commands);
  },

  isCommandEnabled: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return false;

    return this.commands[aCommand].isEnabled();
  },

  doCommand: function(aCommand) {
    if (!this.supportsCommand(aCommand))
      return;
    let cmd = this.commands[aCommand];
    if (!cmd.isEnabled())
      return;
    cmd.doCommand();
  },

  onEvent: function(aEvent) {}
};

function goUpdateAttachmentCommands() {
  goUpdateCommand('cmd_openAllAttachments');
  goUpdateCommand('cmd_saveAllAttachments');
  goUpdateCommand('cmd_detachAllAttachments');
  goUpdateCommand('cmd_deleteAllAttachments');
}

function displayAttachmentsForExpandedView()
{
  var bundle = document.getElementById("bundle_messenger");
  var numAttachments = currentAttachments.length;
  var totalSize = 0;
  var attachmentView = document.getElementById("attachmentView");
  var attachmentSplitter = document.getElementById("attachment-splitter");

  if (numAttachments <= 0) {
    attachmentView.collapsed = true;
    attachmentSplitter.collapsed = true;
  }
  else if (!gBuildAttachmentsForCurrentMsg) {
    attachmentView.collapsed = false;

    var attachmentList = document.getElementById("attachmentList");

    var viewMode = Services.prefs.getIntPref("mailnews.attachments.display.view");
    var views = ["small", "large", "tile"];
    attachmentList.view = views[viewMode];
    attachmentList.controllers.appendController(AttachmentListController);

    toggleAttachmentList(false);

    var lastPartID;
    var unknownSize = false;
    for (let attachment of currentAttachments) {
      // Create a new attachment widget
      var displayName = SanitizeAttachmentDisplayName(attachment);
      var item = attachmentList.appendItem(attachment, displayName);
      item.setAttribute("tooltiptext", attachment.name);
      item.addEventListener("command", attachmentItemCommand, false);

      // Check if this attachment's part ID is a child of the last attachment
      // we counted. If so, skip it, since we already accounted for its size
      // from its parent.
      if (!lastPartID || attachment.partID.indexOf(lastPartID) != 0) {
        lastPartID = attachment.partID;
        if (attachment.size !== null)
          totalSize += attachment.size;
        else if (!attachment.isDeleted)
          unknownSize = true;
      }
    }

    // Show the appropriate toolbar button and label based on the number of
    // attachments.
    updateSaveAllAttachmentsButton();

    let attachmentInfo = document.getElementById("attachmentInfo");
    let attachmentCount = document.getElementById("attachmentCount");
    let attachmentName = document.getElementById("attachmentName");
    let attachmentSize = document.getElementById("attachmentSize");

    if (numAttachments == 1) {
      let count = bundle.getString("attachmentCountSingle");
      let name = SanitizeAttachmentDisplayName(currentAttachments[0]);

      attachmentInfo.setAttribute("contextmenu", "attachmentItemContext");
      attachmentCount.setAttribute("value", count);
      attachmentName.hidden = false;
      attachmentName.setAttribute("value", name);
    } else {
      let words = bundle.getString("attachmentCount");
      let count = PluralForm.get(currentAttachments.length, words)
                            .replace("#1", currentAttachments.length);

      attachmentInfo.setAttribute("contextmenu", "attachmentListContext");
      attachmentCount.setAttribute("value", count);
      attachmentName.hidden = true;
    }

    let sizeStr = messenger.formatFileSize(totalSize);
    if (unknownSize) {
      if (totalSize == 0)
        sizeStr = bundle.getString("attachmentSizeUnknown");
      else
        sizeStr = bundle.getFormattedString("attachmentSizeAtLeast", [sizeStr]);
    }
    attachmentSize.setAttribute("value", sizeStr);

    gBuildAttachmentsForCurrentMsg = true;
  }
}

/**
 * Update the "save all attachments" button in the attachment pane, showing
 * the proper button and enabling/disabling it as appropriate.
 */
function updateSaveAllAttachmentsButton()
{
  let saveAllSingle   = document.getElementById("attachmentSaveAllSingle");
  let saveAllMultiple = document.getElementById("attachmentSaveAllMultiple");

  // If we can't find the buttons, they're not on the toolbar, so bail out!
  if (!saveAllSingle || !saveAllMultiple)
    return;

  let allDeleted = currentAttachments.every(function(attachment) {
    return !attachment.hasFile;
  });
  let single = (currentAttachments.length == 1);

  saveAllSingle.hidden = !single;
  saveAllMultiple.hidden = single;
  saveAllSingle.disabled = saveAllMultiple.disabled = allDeleted;
}

/**
 * Expand/collapse the attachment list. When expanding it, automatically resize
 * it to an appropriate height (1/4 the message pane or smaller).
 *
 * @param expanded  True if the attachment list should be expanded, false
 *                  otherwise. If |expanded| is not specified, toggle the state.
 * @param updateFocus  (optional) True if the focus should be updated, focusing
 *                     on the attachmentList when expanding, or the messagepane
 *                     when collapsing (but only when the attachmentList was
 *                     originally focused).
 */
function toggleAttachmentList(expanded, updateFocus)
{
  var attachmentView = document.getElementById("attachmentView");
  var attachmentBar = document.getElementById("attachmentBar");
  var attachmentToggle = document.getElementById("attachmentToggle");
  var attachmentList = document.getElementById("attachmentList");
  var attachmentSplitter = document.getElementById("attachment-splitter");
  var bundle = document.getElementById("bundle_messenger");

  if (expanded === undefined)
    expanded = !attachmentToggle.checked;

  attachmentToggle.checked = expanded;

  if (expanded) {
    attachmentList.collapsed = false;
    if (!attachmentView.collapsed)
      attachmentSplitter.collapsed = false;
    attachmentBar.setAttribute("tooltiptext", bundle.getString(
      "collapseAttachmentPaneTooltip"));

    attachmentList.setOptimumWidth();

    var attachmentHeight = attachmentView.boxObject.height -
      attachmentList.boxObject.height + attachmentList.preferredHeight;

    // If the attachments box takes up too much of the message pane, downsize:
    var maxAttachmentHeight = document.getElementById("messagepanebox")
                                      .boxObject.height / 4;

    attachmentView.setAttribute("height", Math.min(attachmentHeight,
                                                   maxAttachmentHeight));
    attachmentView.setAttribute("maxheight", attachmentHeight);

    if (updateFocus)
      attachmentList.focus();
  } else {
    attachmentList.collapsed = true;
    attachmentSplitter.collapsed = true;
    attachmentBar.setAttribute("tooltiptext", bundle.getString(
      "expandAttachmentPaneTooltip"));
    attachmentView.removeAttribute("height");
    attachmentView.removeAttribute("maxheight");

    if (updateFocus && document.activeElement == attachmentList)
      SetFocusMessagePane();
  }
}

/**
 * Pick out a nice icon for the attachment.
 * @param attachment  the nsIMsgAttachment object to show icon for
 */
function getIconForAttachment(attachment)
{
  if (attachment.isDeleted) {
    return "chrome://messenger/skin/icon/attachment-deleted.png";
  } else {
    return "moz-icon://" + attachment.name + "?size=16&amp;contentType=" +
           attachment.contentType;
  }
}

/**
 * Public method called when we create the attachments file menu
 */
function FillAttachmentListPopup(aEvent, aPopup)
{
  // First clear out the old view...
  ClearAttachmentMenu(aPopup);

  for (let [attachmentIndex, attachment] of currentAttachments.entries())
    addAttachmentToPopup(aPopup, attachment, attachmentIndex);

  goUpdateAttachmentCommands();
}

// Public method used to clear the file attachment menu
function ClearAttachmentMenu(popup)
{
  if (popup) {
    while (popup.firstChild.localName == "menu")
      popup.firstChild.remove();
  }
}

/**
 * Create a menu for a single attachment.
 *
 * @param popup  the popup to add the menu to
 * @param attachment  the AttachmentInfo object to add
 * @param attachmentIndex  the index (starting at 0) of this attachment
 */
function addAttachmentToPopup(popup, attachment, attachmentIndex)
{
  if (!popup)
    return;

  var item = document.createElement("menu");
  if (!item)
    return;

  function getString(aName) {
    return document.getElementById("bundle_messenger").getString(aName);
  }

  // Insert the item just before the separator. The separator is the 2nd to
  // last element in the popup.
  item.setAttribute("class", "menu-iconic");
  item.setAttribute("image", getIconForAttachment(attachment));

  var numItemsInPopup = popup.childNodes.length;
  // find the separator
  var indexOfSeparator = 0;
  while (popup.childNodes[indexOfSeparator].localName != "menuseparator")
    indexOfSeparator++;
  // We increment the attachmentIndex here since we only use it for the
  // label and accesskey attributes, and we want the accesskeys for the
  // attachments list in the menu to be 1-indexed.
  attachmentIndex++;
  var displayName = SanitizeAttachmentDisplayName(attachment);
  var label = document.getElementById("bundle_messenger")
                      .getFormattedString("attachmentDisplayNameFormat",
                                          [attachmentIndex, displayName]);
  item.setAttribute("crop", "center");
  item.setAttribute("label", label);
  item.setAttribute("accesskey", attachmentIndex % 10);

  // Each attachment in the list gets its own menupopup with options for
  // saving, deleting, detaching, etc.
  var openpopup = document.createElement("menupopup");
  openpopup = item.appendChild(openpopup);
  openpopup.addEventListener("popupshowing", function(aEvent) {
    aEvent.stopPropagation();
  });

  // Due to Bug #314228, we must append our menupopup to the new attachment
  // menu item before we inserting the attachment menu into the popup. If we
  // don't, our attachment menu items will not show up.
  item = popup.insertBefore(item, popup.childNodes[indexOfSeparator]);

  var detached = attachment.isExternalAttachment;
  var deleted  = !attachment.hasFile;
  var canDetach = CanDetachAttachments() && !deleted && !detached;

  if (deleted) {
    // We can't do anything with a deleted attachment, so just return.
    item.disabled = true;
    return;
  }

  // Create the "open" menu item
  var menuitementry = document.createElement("menuitem");
  menuitementry.attachment = attachment;
  menuitementry.setAttribute("oncommand", "this.attachment.open();");
  menuitementry.setAttribute("label", getString("openLabel"));
  menuitementry.setAttribute("accesskey", getString("openLabelAccesskey"));
  menuitementry.setAttribute("disabled", deleted);
  menuitementry = openpopup.appendChild(menuitementry);

  // Create a menuseparator
  var menuseparator = document.createElement("menuseparator");
  openpopup.appendChild(menuseparator);

  // Create the "save" menu item
  menuitementry = document.createElement("menuitem");
  menuitementry.attachment = attachment;
  menuitementry.setAttribute("oncommand", "this.attachment.save();");
  menuitementry.setAttribute("label", getString("saveLabel"));
  menuitementry.setAttribute("accesskey", getString("saveLabelAccesskey"));
  menuitementry.setAttribute("disabled", deleted);
  menuitementry = openpopup.appendChild(menuitementry);

  // Create the "detach" menu item
  menuitementry = document.createElement("menuitem");
  menuitementry.attachment = attachment;
  menuitementry.setAttribute("oncommand", "this.attachment.detach(true);");
  menuitementry.setAttribute("label", getString("detachLabel"));
  menuitementry.setAttribute("accesskey", getString("detachLabelAccesskey"));
  menuitementry.setAttribute("disabled", !canDetach);
  menuitementry = openpopup.appendChild(menuitementry);

  // Create the "delete" menu item
  menuitementry = document.createElement("menuitem");
  menuitementry.attachment = attachment;
  menuitementry.setAttribute("oncommand", "this.attachment.detach(false);");
  menuitementry.setAttribute("label", getString("deleteLabel"));
  menuitementry.setAttribute("accesskey", getString("deleteLabelAccesskey"));
  menuitementry.setAttribute("disabled", !canDetach);
  menuitementry = openpopup.appendChild(menuitementry);
}

/**
 * Open an attachment from the attachment bar.
 *
 * @param event the event that triggered this action
 */
function OpenAttachmentFromBar(event)
{
  if (event.button == 0) {
    // Only open on the first click; ignore double-clicks so that the user
    // doesn't end up with the attachment opened multiple times.
    if (event.detail == 1)
      TryHandleAllAttachments('open');
    RestoreFocusAfterHdrButton();
    event.stopPropagation();
  }
}

/**
 * Handle all the attachments in this message (save them, open them, etc).
 *
 * @param action one of "open", "save", "saveAs", "detach", or "delete"
 */
function HandleAllAttachments(action)
{
  HandleMultipleAttachments(currentAttachments, action);
}

/**
 * Try to handle all the attachments in this message (save them, open them,
 * etc). If the action fails for whatever reason, catch the error and report it.
 *
 * @param action  one of "open", "save", "saveAs", "detach", or "delete"
 */
function TryHandleAllAttachments(action)
{
  try {
    HandleAllAttachments(action)
  }
  catch (e) {
    Components.utils.reportError(e);
  }
}

/**
 * Handle the currently-selected attachments in this message (save them, open
 * them, etc).
 *
 * @param action  one of "open", "save", "saveAs", "detach", or "delete"
 */
function HandleSelectedAttachments(action)
{
  let attachmentList = document.getElementById("attachmentList");
  let selectedAttachments = [];
  for (let item of attachmentList.selectedItems) {
    selectedAttachments.push(item.attachment);
  }

  HandleMultipleAttachments(selectedAttachments, action);
}

/**
 * Perform an action on multiple attachments (e.g. open or save)
 *
 * @param attachments  an array of AttachmentInfo objects to work with
 * @param action  one of "open", "save", "saveAs", "detach", or "delete"
 */
function HandleMultipleAttachments(attachments, action)
{
  // convert our attachment data into some c++ friendly structs
  var attachmentContentTypeArray = [];
  var attachmentUrlArray = [];
  var attachmentDisplayNameArray = [];
  var attachmentMessageUriArray = [];

  // populate these arrays..
  var actionIndex = 0;
  for (let attachment of attachments) {
    // Exclude attachment which are 1) deleted, or 2) detached with missing
    // external files.
    if (!attachment.hasFile)
      continue;

    attachmentContentTypeArray[actionIndex] = attachment.contentType;
    attachmentUrlArray[actionIndex] = attachment.url;
    attachmentDisplayNameArray[actionIndex] = encodeURI(attachment.name);
    attachmentMessageUriArray[actionIndex] = attachment.uri;
    ++actionIndex;
  }

  // The list has been built. Now call our action code...
  switch (action) {
    case "save":
      messenger.saveAllAttachments(attachmentContentTypeArray.length,
                                   attachmentContentTypeArray,
                                   attachmentUrlArray,
                                   attachmentDisplayNameArray,
                                   attachmentMessageUriArray);
      return;
    case "detach":
      // "detach" on a multiple selection of attachments is so far not really
      // supported. As a workaround, resort to normal detach-"all". See also
      // the comment on 'detaching a multiple selection of attachments' below.
      if (attachments.length == 1)
        attachments[0].detach(true);
      else
        messenger.detachAllAttachments(attachmentContentTypeArray.length,
                                       attachmentContentTypeArray,
                                       attachmentUrlArray,
                                       attachmentDisplayNameArray,
                                       attachmentMessageUriArray,
                                       true); // save
      return;
    case "delete":
      messenger.detachAllAttachments(attachmentContentTypeArray.length,
                                     attachmentContentTypeArray,
                                     attachmentUrlArray,
                                     attachmentDisplayNameArray,
                                     attachmentMessageUriArray,
                                     false); // don't save
      return;
    case "open":
    case "saveAs":
      // XXX hack alert. If we sit in tight loop and open/save multiple
      // attachments, we get chrome errors in layout as we start loading the
      // first helper app dialog then before it loads, we kick off the next
      // one and the next one. Subsequent helper app dialogs were failing
      // because we were still loading the chrome files for the first attempt
      // (error about the xul cache being empty). For now, work around this by
      // doing the first helper app dialog right away, then waiting a bit
      // before we launch the rest.

      var actionFunction = null;
      if (action == "open")
        actionFunction = function(aAttachment) { aAttachment.open(); };
      else
        actionFunction = function(aAttachment) { aAttachment.save(); };

      for (let i = 0; i < attachments.length; i++) {
        if (i == 0)
          actionFunction(attachments[i]);
        else
          setTimeout(actionFunction, 100, attachments[i]);
      }
      return;
    case "copyUrl":
      // Copy external http url(s) to clipboard. The menuitem is hidden unless
      // all selected attachment urls are http.
      let clipboard = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                                .getService(Components.interfaces.nsIClipboardHelper);
      clipboard.copyString(attachmentUrlArray.join("\n"));
      return;
    default:
      throw new Error("unknown HandleMultipleAttachments action: " + action);
  }
}

function ClearAttachmentList()
{
  // We also have to disable the Message/Attachments menuitem.
  var node = document.getElementById("msgAttachmentMenu");
  if (node)
    node.setAttribute("disabled", "true");
  // Do the same on appmenu.
  let appmenunode = document.getElementById("appmenu_msgAttachmentMenu");
  if (appmenunode)
    appmenunode.setAttribute("disabled", "true");

  // clear selection
  var list = document.getElementById("attachmentList");
  list.clearSelection();

  while (list.hasChildNodes())
    list.lastChild.remove();
}

var attachmentListDNDObserver = {
  onDragStart: function (aEvent, aAttachmentData, aDragAction)
  {
    let target = aEvent.target;

    if (target.localName == "attachmentitem") {
      let selection = target.parentNode.selectedItems;
      aAttachmentData.data = new TransferDataSet();
      for (let item of selection) {
        let transferData = CreateAttachmentTransferData(item.attachment);
        if (transferData)
          aAttachmentData.data.push(transferData);
      }
    }
  }
};

var attachmentNameDNDObserver = {
  onDragStart: function (aEvent, aAttachmentData, aDragAction)
  {
    var attachmentList = document.getElementById("attachmentList");
    aAttachmentData.data = CreateAttachmentTransferData(
      attachmentList.getItemAtIndex(0).attachment);
  }
};

/**
 * CopyWebsiteAddress takes the website address title button, extracts
 * the website address we stored in there and copies it to the clipboard
 */
function CopyWebsiteAddress(websiteAddressNode)
{
  if (websiteAddressNode) {
    var websiteAddress = websiteAddressNode.textContent;

    var contractid = "@mozilla.org/widget/clipboardhelper;1";
    var iid = Components.interfaces.nsIClipboardHelper;
    var clipboard = Components.classes[contractid].getService(iid);
    clipboard.copyString(websiteAddress);
  }
}

function nsDummyMsgHeader()
{
}

nsDummyMsgHeader.prototype =
{
  mProperties : new Array,
  getStringProperty : function(aProperty) {
    if (aProperty in this.mProperties)
      return this.mProperties[aProperty];
    return "";
  },
  setStringProperty : function(aProperty, aVal) {
    this.mProperties[aProperty] = aVal;
  },
  getUint32Property : function(aProperty) {
    if (aProperty in this.mProperties)
      return parseInt(this.mProperties[aProperty]);
    return 0;
  },
  setUint32Property: function(aProperty, aVal) {
    this.mProperties[aProperty] = aVal.toString();
  },
  markHasAttachments : function(hasAttachments) {},
  messageSize : 0,
  recipients : null,
  author: null,
  subject : "",
  get mime2DecodedSubject() { return this.subject; },
  ccList : null,
  listPost : null,
  messageId : null,
  date : 0,
  accountKey : "",
  flags : 0,
  // If you change us to return a fake folder, please update
  // folderDisplay.js's FolderDisplayWidget's selectedMessageIsExternal getter.
  folder : null
};

function onShowOtherActionsPopup()
{
  // Enable/disable the Open Conversation button.
  let glodaEnabled = Services.prefs.getBoolPref("mailnews.database.global.indexer.enabled");

  let openConversation = document.getElementById("otherActionsOpenConversation");
  openConversation.disabled = !glodaEnabled;
  if (glodaEnabled && gFolderDisplay.selectedCount > 0) {
    let message = gFolderDisplay.selectedMessage;
    let isMessageIndexed = Gloda.isMessageIndexed(message);
    openConversation.disabled = !isMessageIndexed;
  }

  if (SelectedMessagesAreRead()) {
    document.getElementById("markAsReadMenuItem").setAttribute("hidden", true);
    document.getElementById("markAsUnreadMenuItem").removeAttribute("hidden");
  } else {
    document.getElementById("markAsReadMenuItem").removeAttribute("hidden");
    document.getElementById("markAsUnreadMenuItem").setAttribute("hidden",
                                                                 true);
  }
}

function ConversationOpener()
{
}

ConversationOpener.prototype = {
  openConversationForMessages: function(messages) {
    if (messages.length < 1)
      return;
    try {
      this._items = [];
      this._msgHdr = messages[0];
      this._queries = [Gloda.getMessageCollectionForHeaders(messages, this)];
    } catch (e) {
      logException(e);
    }
  },
  isSelectedMessageIndexed: function() {
    let glodaEnabled = Services.prefs
      .getBoolPref("mailnews.database.global.indexer.enabled");

    if (glodaEnabled && gFolderDisplay.selectedCount > 0) {
      let message = gFolderDisplay.selectedMessage;
      return Gloda.isMessageIndexed(message);
    }
    return false;
  },
  onItemsAdded: function(aItems) {
  },
  onItemsModified: function(aItems) {
  },
  onItemsRemoved: function(aItems) {
  },
  onQueryCompleted: function(aCollection) {
    try {
      if (!aCollection.items.length) {
        Components.utils.reportError("Couldn't find a collection for msg: " +
                                     this._msgHdr);
      } else {
        let aMessage = aCollection.items[0];
        let tabmail = document.getElementById("tabmail");
        tabmail.openTab("glodaList", {
          conversation: aMessage.conversation,
          message: aMessage,
          title: aMessage.conversation.subject,
          background: false
        });
      }
    } catch (e) {
      logException(e);
    }
  }
}

var gConversationOpener = new ConversationOpener();
