/* -*- Mode: Javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource:///modules/MailUtils.js");

/**
 * Get the identity that most likely is the best one to use, given the hint.
 * @param identities    nsIArray<nsIMsgIdentity> of identities
 * @param optionalHint  string containing comma separated mailboxes
 * @param useDefault    If true, use the default identity of the default
 *                      account as last choice. This is useful when all
 *                      identities are passed in. Otherwise, use the first
 *                      entity in the list.
 */
function getBestIdentity(identities, optionalHint, useDefault = false)
{
  let identityCount = identities.length;
  if (identityCount < 1)
    return null;

  // If we have more than one identity and a hint to help us pick one.
  if (identityCount > 1 && optionalHint) {
    // Normalize case on the optional hint to improve our chances of
    // finding a match.
    optionalHint = optionalHint.toLowerCase();
    let hints = optionalHint.toLowerCase().split(",");

    for (let i = 0 ; i < hints.length; i++) {
      for (let identity in fixIterator(identities,
                                       Components.interfaces.nsIMsgIdentity)) {
        if (!identity.email)
          continue;
        if (hints[i].trim() == identity.email.toLowerCase() ||
            hints[i].includes("<" + identity.email.toLowerCase() + ">"))
          return identity;
      }
    }
  }

  // Still no matches? Give up and pick the default or the first one.
  if (useDefault) {
    let defaultAccount = accountManager.defaultAccount;
    if (defaultAccount && defaultAccount.defaultIdentity)
      return defaultAccount.defaultIdentity;
  }

  return identities.queryElementAt(0, Components.interfaces.nsIMsgIdentity);
}

function getIdentityForServer(server, optionalHint)
{
  var identities = accountManager.getIdentitiesForServer(server);
  return getBestIdentity(identities, optionalHint);
}

/**
 * Get the identity for the given header.
 * @param hdr nsIMsgHdr message header
 * @param type nsIMsgCompType compose type the identity ise used for.
 */
function getIdentityForHeader(hdr, type)
{
  function findDeliveredToIdentityEmail() {
    // This function reads from currentHeaderData, which is only useful if we're
    // looking at the currently-displayed message. Otherwise, just return
    // immediately so we don't waste time.
    if (hdr != gMessageDisplay.displayedMessage)
      return "";

    // Get the delivered-to headers.
    let key = "delivered-to";
    let deliveredTos = new Array();
    let index = 0;
    let header = "";
    while ((header = currentHeaderData[key])) {
      deliveredTos.push(header.headerValue.toLowerCase().trim());
      key = "delivered-to" + index++;
    }

    // Reverse the array so that the last delivered-to header will show at front.
    deliveredTos.reverse();

    for (let i = 0; i < deliveredTos.length; i++) {
      for (let identity in fixIterator(accountManager.allIdentities,
                                       Components.interfaces.nsIMsgIdentity)) {
        if (!identity.email)
          continue;
        // If the deliver-to header contains the defined identity, that's it.
        if (deliveredTos[i] == identity.email.toLowerCase() ||
            deliveredTos[i].includes("<" + identity.email.toLowerCase() + ">"))
          return identity.email;
      }
    }
    return "";
  }

  let server = null;
  let identity = null;
  let folder = hdr.folder;
  if (folder) {
    server = folder.server;
    identity = folder.customIdentity;
    if (identity)
      return identity;
  }

  if (!server) {
    let accountKey = hdr.accountKey;
    if (accountKey) {
      let account = accountManager.getAccount(accountKey);
      if (account)
        server = account.incomingServer;
    }
  }

  let hintForIdentity = "";
  if (type == Components.interfaces.nsIMsgCompType.ReplyToList)
    hintForIdentity = findDeliveredToIdentityEmail();
  else if (type == Components.interfaces.nsIMsgCompType.Template)
    hintForIdentity = hdr.author;
  else
    hintForIdentity = hdr.recipients + "," + hdr.ccList + "," +
                      findDeliveredToIdentityEmail();

  if (server)
    identity = getIdentityForServer(server, hintForIdentity);

  if (!identity)
    identity = getBestIdentity(accountManager.allIdentities,
                               hintForIdentity, true);

  return identity;
}

function GetNextNMessages(folder)
{
  if (folder) {
    var newsFolder = folder.QueryInterface(
                     Components.interfaces.nsIMsgNewsFolder);
    if (newsFolder) {
      newsFolder.getNextNMessages(msgWindow);
    }
  }
}

/**
 * Figure out the message key from the message uri.
 * @param uri string defining internal storage
 */
function GetMsgKeyFromURI(uri) {
  // Format of 'uri' : protocol://email/folder#key?params
  //                   '?params' are optional
  //   ex : mailbox-message://john%2Edoe@pop.isp.invalid/Drafts#123456?fetchCompleteMessage=true
  //   ex : mailbox-message://john%2Edoe@pop.isp.invalid/Drafts#12345
  // We keep only the part after '#' and before an optional '?'.
  // The regexp expects 'key' to be an integer (a serie of digits) : '\d+'.
  let match = /.+#(\d+)/.exec(uri);
  return (match) ? match[1] : null;
}

/**
 * Compose a message.
 *
 * @param type   nsIMsgCompType    Type of composition (new message, reply, draft, etc.)
 * @param format nsIMsgCompFormat  Requested format (plain text, html, default)
 * @param folder nsIMsgFolder      Folder where the original message is stored
 * @param messageArray             Array of messages to process, often only holding one element.
 */
function ComposeMessage(type, format, folder, messageArray)
{
  let msgComposeType = Components.interfaces.nsIMsgCompType;
  let ignoreQuote = false;
  let msgKey;
  if (messageArray && messageArray.length == 1) {
    msgKey = GetMsgKeyFromURI(messageArray[0]);
    if (msgKey != gMessageDisplay.keyForCharsetOverride) {
      msgWindow.charsetOverride = false;
    }
    if (type == msgComposeType.Reply ||
        type == msgComposeType.ReplyAll ||
        type == msgComposeType.ReplyToSender ||
        type == msgComposeType.ReplyToGroup ||
        type == msgComposeType.ReplyToSenderAndGroup ||
        type == msgComposeType.ReplyToList) {
      let displayKey = (gMessageDisplay.displayedMessage &&
                        "messageKey" in gMessageDisplay.displayedMessage) ?
        gMessageDisplay.displayedMessage.messageKey : null;
      if (msgKey != displayKey) {
        // Not replying to the displayed message, so remove the selection
        // in order not to quote from the wrong message.
        ignoreQuote = true;
      }
    }
  }

  // Check if the draft is already open in another window. If it is, just focus the window.
  if (type == msgComposeType.Draft && messageArray.length == 1) {
    // We'll search this uri in the opened windows.
    let wenum = Services.wm.getEnumerator("");
    while (wenum.hasMoreElements()) {
      let w = wenum.getNext();
      // Check if it is a compose window.
      if (w.document.defaultView.gMsgCompose && w.document.defaultView.gMsgCompose.compFields.draftId) {
        let wKey = GetMsgKeyFromURI(w.document.defaultView.gMsgCompose.compFields.draftId);
        if (wKey == msgKey) {
          // Found ! just focus it...
          w.focus();
          // ...and nothing to do anymore.
          return;
        }
      }
    }
  }
  var identity = null;
  var newsgroup = null;
  var hdr;

  // dump("ComposeMessage folder=" + folder + "\n");
  try
  {
    if (folder)
    {
      // Get the incoming server associated with this uri.
      var server = folder.server;

      // If they hit new or reply and they are reading a newsgroup,
      // turn this into a new post or a reply to group.
      if (!folder.isServer && server.type == "nntp" && type == msgComposeType.New)
      {
        type = msgComposeType.NewsPost;
        newsgroup = folder.folderURL;
      }

      identity = folder.customIdentity;
      if (!identity)
        identity = getIdentityForServer(server);
      // dump("identity = " + identity + "\n");
    }
  }
  catch (ex)
  {
    dump("failed to get an identity to pre-select: " + ex + "\n");
  }

  // dump("\nComposeMessage from XUL: " + identity + "\n");

  switch (type)
  {
    case msgComposeType.New: //new message
      // dump("OpenComposeWindow with " + identity + "\n");

      // If the addressbook sidebar panel is open and has focus, get
      // the selected addresses from it.
      if (document.commandDispatcher.focusedWindow &&
          document.commandDispatcher.focusedWindow
                  .document.documentElement.hasAttribute("selectedaddresses"))
        NewMessageToSelectedAddresses(type, format, identity);
      else
        MailServices.compose.OpenComposeWindow(null, null, null, type,
                                               format, identity, msgWindow);
      return;
    case msgComposeType.NewsPost:
      // dump("OpenComposeWindow with " + identity + " and " + newsgroup + "\n");
      MailServices.compose.OpenComposeWindow(null, null, newsgroup, type,
                                             format, identity, msgWindow);
      return;
    case msgComposeType.ForwardAsAttachment:
      if (messageArray && messageArray.length)
      {
        // If we have more than one ForwardAsAttachment then pass null instead
        // of the header to tell the compose service to work out the attachment
        // subjects from the URIs.
        hdr = messageArray.length > 1 ? null : messenger.msgHdrFromURI(messageArray[0]);
        MailServices.compose.OpenComposeWindow(null, hdr, messageArray.join(','),
                                               type, format, identity, msgWindow);
        return;
      }
    default:
      if (!messageArray)
        return;

      // Limit the number of new compose windows to 8. Why 8 ?
      // I like that number :-)
      if (messageArray.length > 8)
        messageArray.length = 8;

      for (var i = 0; i < messageArray.length; ++i)
      {
        var messageUri = messageArray[i];
        hdr = messenger.msgHdrFromURI(messageUri);
        if (FeedMessageHandler.isFeedMessage(hdr))
        {
          // Do not use the header derived identity for feeds, pass on only a
          // possible server identity from above.
          openComposeWindowForRSSArticle(null, hdr, messageUri, type,
                                         format, identity, msgWindow);
        }
        else
        {
          // Replies come here.
          let hdrIdentity = getIdentityForHeader(hdr, type);
          if (ignoreQuote)
            type += msgComposeType.ReplyIgnoreQuote;
          MailServices.compose.OpenComposeWindow(null, hdr, messageUri, type,
                                                 format, hdrIdentity, msgWindow);
        }
      }
  }
}

function NewMessageToSelectedAddresses(type, format, identity) {
  var abSidebarPanel = document.commandDispatcher.focusedWindow;
  var abResultsTree = abSidebarPanel.document.getElementById("abResultsTree");
  var abResultsBoxObject = abResultsTree.treeBoxObject;
  var abView = abResultsBoxObject.view;
  abView = abView.QueryInterface(Components.interfaces.nsIAbView);
  var addresses = abView.selectedAddresses;
  var params = Components.classes["@mozilla.org/messengercompose/composeparams;1"].createInstance(Components.interfaces.nsIMsgComposeParams);
  if (params) {
    params.type = type;
    params.format = format;
    params.identity = identity;
    var composeFields = Components.classes["@mozilla.org/messengercompose/composefields;1"].createInstance(Components.interfaces.nsIMsgCompFields);
    if (composeFields) {
      var addressList = "";
      for (var i = 0; i < addresses.Count(); i++) {
        addressList = addressList + (i > 0 ? ",":"") + addresses.QueryElementAt(i,Components.interfaces.nsISupportsString).data;
      }
      composeFields.to = addressList;
      params.composeFields = composeFields;
      MailServices.compose.OpenComposeWindowWithParams(null, params);
    }
  }
}

function Subscribe(preselectedMsgFolder)
{
  window.openDialog("chrome://messenger/content/subscribe.xul",
                    "subscribe", "chrome,modal,titlebar,resizable=yes",
                    {folder:preselectedMsgFolder,
                      okCallback:SubscribeOKCallback});
}

function SubscribeOKCallback(changeTable)
{
  for (var serverURI in changeTable) {
    var folder = MailUtils.getFolderForURI(serverURI, true);
    var server = folder.server;
    var subscribableServer =
          server.QueryInterface(Components.interfaces.nsISubscribableServer);

    for (var name in changeTable[serverURI]) {
      if (changeTable[serverURI][name] == true) {
        try {
          subscribableServer.subscribe(name);
        }
        catch (ex) {
          dump("failed to subscribe to " + name + ": " + ex + "\n");
        }
      }
      else if (changeTable[serverURI][name] == false) {
        try {
          subscribableServer.unsubscribe(name);
        }
        catch (ex) {
          dump("failed to unsubscribe to " + name + ": " + ex + "\n");
        }
      }
      else {
        // no change
      }
    }

    try {
      subscribableServer.commitSubscribeChanges();
    }
    catch (ex) {
      dump("failed to commit the changes: " + ex + "\n");
    }
  }
}

function SaveAsFile(uris)
{
  if (uris.length == 1) {
    let uri = uris[0];
    let msgHdr = messenger.messageServiceFromURI(uri)
                          .messageURIToMsgHdr(uri);
    let name = msgHdr.mime2DecodedSubject;
    if (msgHdr.flags & Components.interfaces.nsMsgMessageFlags.HasRe)
      name = (name) ? "Re: " + name : "Re: ";

    let filename = GenerateValidFilename(name, ".eml");
    messenger.saveAs(uri, true, null, filename);
  }
  else {
    let filenames = [];
    for (let i = 0; i < uris.length; i++) {
      let msgHdr = messenger.messageServiceFromURI(uris[i])
                            .messageURIToMsgHdr(uris[i]);

      let nameBase = GenerateFilenameFromMsgHdr(msgHdr);
      let name = GenerateValidFilename(nameBase, ".eml");

      let number = 2;
      while (filenames.includes(name)) { // should be unlikely
        name = GenerateValidFilename(nameBase + "-" + number, ".eml");
        number++;
      }
      filenames.push(name);
    }
    messenger.saveMessages(uris.length, filenames, uris);
  }
}

function GenerateFilenameFromMsgHdr(msgHdr) {

  function MakeIS8601ODateString(date) {
    function pad(n) {return n < 10 ? "0" + n : n;}
    return date.getFullYear() + "-" +
           pad(date.getMonth() + 1)  + "-" +
           pad(date.getDate())  + " " +
           pad(date.getHours())  + "" +
           pad(date.getMinutes()) + "";
  }

  let filename;
  if (msgHdr.flags & Components.interfaces.nsMsgMessageFlags.HasRe)
    filename = (msgHdr.mime2DecodedSubject) ? "Re: " + msgHdr.mime2DecodedSubject : "Re: ";
  else
    filename = msgHdr.mime2DecodedSubject;

  filename += " - ";
  filename += msgHdr.mime2DecodedAuthor  + " - ";
  filename += MakeIS8601ODateString(new Date(msgHdr.date/1000));

  return filename;

}

function saveAsUrlListener(aUri, aIdentity) {
  this.uri = aUri;
  this.identity = aIdentity;
}

saveAsUrlListener.prototype = {
  OnStartRunningUrl: function(aUrl) {
  },
  OnStopRunningUrl: function(aUrl, aExitCode) {
    messenger.saveAs(this.uri, false, this.identity, null);
  }
};

function SaveAsTemplate(uri) {
  if (uri) {
    const Ci = Components.interfaces;
    let hdr = messenger.msgHdrFromURI(uri);
    let identity = getIdentityForHeader(hdr, Ci.nsIMsgCompType.Template);
    let templates = MailUtils.getFolderForURI(identity.stationeryFolder, false);
    if (!templates.parent) {
      templates.setFlag(Ci.nsMsgFolderFlags.Templates);
      let isAsync = templates.server.protocolInfo.foldersCreatedAsync;
      templates.createStorageIfMissing(new saveAsUrlListener(uri, identity));
      if (isAsync)
        return;
    }
    messenger.saveAs(uri, false, identity, null);
  }
}

function MarkSelectedMessagesRead(markRead)
{
  ClearPendingReadTimer();
  gDBView.doCommand(markRead ? nsMsgViewCommandType.markMessagesRead : nsMsgViewCommandType.markMessagesUnread);
}

function MarkSelectedMessagesFlagged(markFlagged)
{
  gDBView.doCommand(markFlagged ? nsMsgViewCommandType.flagMessages : nsMsgViewCommandType.unflagMessages);
}

function ViewPageSource(messages)
{
  var numMessages = messages.length;

  if (numMessages == 0)
  {
    dump("MsgViewPageSource(): No messages selected.\n");
    return false;
  }

  var browser = getBrowser();

  try {
    for (var i = 0; i < numMessages; i++)
    {
      // Now, we need to get a URL from a URI
      var url = MailServices.mailSession.ConvertMsgURIToMsgURL(messages[i], msgWindow);

      // Strip out the message-display parameter to ensure that attached emails
      // display the message source, not the processed HTML.
      url = url.replace(/type=application\/x-message-display&/, "");
      window.openDialog("chrome://global/content/viewSource.xul",
                        "_blank", "all,dialog=no",
                        {URL: url, browser: browser,
                         outerWindowID: browser.outerWindowID});
    }
    return true;
  } catch (e) {
    // Couldn't get mail session
    return false;
  }
}
