/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var gSignedUINode = null;
var gEncryptedUINode = null;
var gSMIMEContainer = null;
var gStatusBar = null;

var gEncryptedURIService = null;
var gMyLastEncryptedURI = null;

var gSMIMEBundle = null;

var gSignatureStatusForURI = null;
var gEncryptionStatusForURI = null;

// manipulates some globals from msgReadSMIMEOverlay.js

var nsICMSMessageErrors = Components.interfaces.nsICMSMessageErrors;

/// Get the necko URL for the message URI.
function neckoURLForMessageURI(aMessageURI)
{
  let msgSvc = Components.classes["@mozilla.org/messenger;1"]
    .createInstance(Components.interfaces.nsIMessenger)
    .messageServiceFromURI(aMessageURI);
  let neckoURI = {};
  msgSvc.GetUrlForUri(aMessageURI, neckoURI, null);
  return neckoURI.value.spec;
}

var smimeHeaderSink =
{
  maxWantedNesting: function()
  {
    return 1;
  },

  /**
   * @return the URI of the selected message, or null if the current
   *         message displayed isn't in a folder, for example if the
   *         message is displayed in a separate window.
   */
  getSelectedMessageURI() {
    if (!gFolderDisplay.selectedMessage.folder) {
      // The folder should be absent only if the message gets opened
      // from an external file (.eml), which is opened in its own window.
      // That window won't get reused for other messages. We conclude
      // the incoming status is for this window.
      // This special handling is necessary, because the necko URL for
      // separate windows that is seen by the MIME code differs from the
      // one we see here in JS.
      return null;
    }

    return neckoURLForMessageURI(gFolderDisplay.selectedMessageUris[0]);
  },

  signedStatus(aNestingLevel, aSignatureStatus, aSignerCert,
                      aMsgNeckoURL)
  {
    if (aNestingLevel > 1) {
      // we are not interested
      return;
    }

    if (aMsgNeckoURL != this.getSelectedMessageURI()) {
      // Status isn't for selected message.
      return;
    }

    if (gSignatureStatusForURI == aMsgNeckoURL) {
      // We already received a status previously for this URL.
      // Don't allow overriding an existing bad status.
      if (gSignatureStatus != Ci.nsICMSMessageErrors.SUCCESS) {
        return;
      }
    }

    gSignatureStatusForURI = aMsgNeckoURL;
    gSignatureStatus = aSignatureStatus;
    gSignerCert = aSignerCert;

    gSMIMEContainer.collapsed = false;
    gSignedUINode.collapsed = false;

    switch (aSignatureStatus) {
      case nsICMSMessageErrors.SUCCESS:
        gSignedUINode.setAttribute("signed", "ok");
        gStatusBar.setAttribute("signed", "ok");
        break;

      case nsICMSMessageErrors.VERIFY_NOT_YET_ATTEMPTED:
        gSignedUINode.setAttribute("signed", "unknown");
        gStatusBar.setAttribute("signed", "unknown");
        this.showSenderIfSigner();
        break;

      case nsICMSMessageErrors.VERIFY_CERT_WITHOUT_ADDRESS:
      case nsICMSMessageErrors.VERIFY_HEADER_MISMATCH:
        gSignedUINode.setAttribute("signed", "mismatch");
        gStatusBar.setAttribute("signed", "mismatch");
        this.showSenderIfSigner();
        break;

      default:
        gSignedUINode.setAttribute("signed", "notok");
        gStatusBar.setAttribute("signed", "notok");
        break;
    }
  },

  /**
   * Force showing Sender if we have a Sender and it's not signed by From.
   * For a valid cert that means the Sender signed it - and the signed mismatch
   * mark is shown. To understand why it's not a confirmed signing it's useful
   * to have the Sender header showing.
   */
  showSenderIfSigner: function() {
    if (!("sender" in currentHeaderData))
      return; // Sender not set, or same as From (so no longer present).

    if (Services.prefs.getBoolPref("mailnews.headers.showSender"))
      return; // Sender header will be show due to pref - nothing more to do.

    let fromMailboxes = MailServices.headerParser.extractHeaderAddressMailboxes(
            currentHeaderData.from.headerValue).split(",");
    for (let i = 0; i < fromMailboxes.length; i++) {
      if (gSignerCert.containsEmailAddress(fromMailboxes[i])) {
        return; // It's signed by a From. Nothing more to do
      }
    }

    let senderInfo = { name: "sender", outputFunction: OutputEmailAddresses };
    let senderEntry = new createHeaderEntry("expanded", senderInfo);

    gExpandedHeaderView[senderInfo.name] = senderEntry;
    UpdateExpandedMessageHeaders();
  },

  encryptionStatus(aNestingLevel, aEncryptionStatus, aRecipientCert,
                   aMsgNeckoURL)
  {
    if (aNestingLevel > 1) {
      // we are not interested
      return;
    }

    if (aMsgNeckoURL != this.getSelectedMessageURI()) {
      // Status isn't for selected message.
      return;
    }

    if (gEncryptionStatusForURI == aMsgNeckoURL) {
      // We already received a status previously for this URL.
      // Don't allow overriding an existing bad status.
      if (gEncryptionStatus != Ci.nsICMSMessageErrors.SUCCESS) {
        return;
      }
    }

    gEncryptionStatusForURI = aMsgNeckoURL;
    gEncryptionStatus = aEncryptionStatus;
    gEncryptionCert = aRecipientCert;

    gSMIMEContainer.collapsed = false;
    gEncryptedUINode.collapsed = false;

    if (nsICMSMessageErrors.SUCCESS == aEncryptionStatus)
    {
      gEncryptedUINode.setAttribute("encrypted", "ok");
      gStatusBar.setAttribute("encrypted", "ok");
    }
    else
    {
      gEncryptedUINode.setAttribute("encrypted", "notok");
      gStatusBar.setAttribute("encrypted", "notok");
    }

    if (gEncryptedURIService)
    {
      // Remember the message URI and the corresponding necko URI.
      gMyLastEncryptedURI = gFolderDisplay.selectedMessageUris[0];
      gEncryptedURIService.rememberEncrypted(gMyLastEncryptedURI);
      gEncryptedURIService.rememberEncrypted(
        neckoURLForMessageURI(gMyLastEncryptedURI));
    }

    switch (aEncryptionStatus)
    {
    case nsICMSMessageErrors.SUCCESS:
    case nsICMSMessageErrors.ENCRYPT_INCOMPLETE:
      break;
    default:
      var brand = document.getElementById("bundle_brand")
                          .getString("brandShortName");
      var title = gSMIMEBundle.getString("CantDecryptTitle").replace(/%brand%/g,brand);
      var body = gSMIMEBundle.getString("CantDecryptBody").replace(/%brand%/g,brand);

      // insert our message
      msgWindow.displayHTMLInMessagePane(title,
       "<html>\n"+
       "<body bgcolor=\"#fafaee\">\n"+
       "<center><br><br><br>\n"+
       "<table>\n"+
       "<tr><td>\n"+
       "<center><strong><font size=\"+3\">\n"+
       title+"</font></center><br>\n"+
       body+"\n"+
       "</td></tr></table></center></body></html>", false);
      break;
    }
  },

  QueryInterface : function(iid)
  {
    if (iid.equals(Components.interfaces.nsIMsgSMIMEHeaderSink) || iid.equals(Components.interfaces.nsISupports))
      return this;
    throw Components.results.NS_NOINTERFACE;
  }
};

function forgetEncryptedURI()
{
  if (gMyLastEncryptedURI && gEncryptedURIService)
  {
    gEncryptedURIService.forgetEncrypted(gMyLastEncryptedURI);
    gEncryptedURIService.forgetEncrypted(
      neckoURLForMessageURI(gMyLastEncryptedURI));
    gMyLastEncryptedURI = null;
  }
}

function onSMIMEStartHeaders()
{
  gEncryptionStatus = -1;
  gSignatureStatus = -1;

  gSignatureStatusForURI = null;
  gEncryptionStatusForURI = null;

  gSignerCert = null;
  gEncryptionCert = null;

  gSMIMEContainer.collapsed = true;

  gSignedUINode.collapsed = true;
  gSignedUINode.removeAttribute("signed");
  gStatusBar.removeAttribute("signed");

  gEncryptedUINode.collapsed = true;
  gEncryptedUINode.removeAttribute("encrypted");
  gStatusBar.removeAttribute("encrypted");

  forgetEncryptedURI();
}

function onSMIMEEndHeaders() {
}

function onSmartCardChange()
{
  // only reload encrypted windows
  if (gMyLastEncryptedURI && gEncryptionStatus != -1) {
    ReloadMessage();
  }
}

function onSMIMEBeforeShowHeaderPane() {
  // For signed messages with differing Sender as signer we force showing Sender.
  // If we're now in a different message, hide the (old) sender row and remove
  // it from the header view, so that Sender normally isn't shown.
  if ("sender" in gExpandedHeaderView &&
      !Services.prefs.getBoolPref("mailnews.headers.showSender")) {
    gExpandedHeaderView.sender.enclosingRow.collapsed = true;
    delete gExpandedHeaderView.sender;
  }
}

function msgHdrViewSMIMEOnLoad(event)
{
  window.crypto.enableSmartCardEvents = true;
  document.addEventListener("smartcard-insert", onSmartCardChange, false);
  document.addEventListener("smartcard-remove", onSmartCardChange, false);
  if (!gSMIMEBundle)
    gSMIMEBundle = document.getElementById("bundle_read_smime");

  // we want to register our security header sink as an opaque nsISupports
  // on the msgHdrSink used by mail.....
  msgWindow.msgHeaderSink.securityInfo = smimeHeaderSink;

  gSignedUINode = document.getElementById('signedHdrIcon');
  gEncryptedUINode = document.getElementById('encryptedHdrIcon');
  gSMIMEContainer = document.getElementById('smimeBox');
  gStatusBar = document.getElementById('status-bar');

  // Add ourself to the list of message display listeners so we get notified
  // when we are about to display a message.
  var listener = {};
  listener.onStartHeaders = onSMIMEStartHeaders;
  listener.onEndHeaders = onSMIMEEndHeaders;
  listener.onBeforeShowHeaderPane = onSMIMEBeforeShowHeaderPane;
  gMessageListeners.push(listener);

  gEncryptedURIService =
    Components.classes["@mozilla.org/messenger-smime/smime-encrypted-uris-service;1"]
    .getService(Components.interfaces.nsIEncryptedSMIMEURIsService);
}

function msgHdrViewSMIMEOnUnload(event)
{
  window.crypto.enableSmartCardEvents = false;
  document.removeEventListener("smartcard-insert", onSmartCardChange, false);
  document.removeEventListener("smartcard-remove", onSmartCardChange, false);
  forgetEncryptedURI();
  removeEventListener('messagepane-loaded', msgHdrViewSMIMEOnLoad, true);
  removeEventListener('messagepane-unloaded', msgHdrViewSMIMEOnUnload, true);
  removeEventListener('messagepane-hide', msgHdrViewSMIMEOnMessagePaneHide, true);
  removeEventListener('messagepane-unhide', msgHdrViewSMIMEOnMessagePaneUnhide, true);
}

function msgHdrViewSMIMEOnMessagePaneHide()
{
  gSMIMEContainer.collapsed = true;
  gSignedUINode.collapsed = true;
  gEncryptedUINode.collapsed = true;
}

function msgHdrViewSMIMEOnMessagePaneUnhide()
{
  if (gEncryptionStatus != -1 || gSignatureStatus != -1)
  {
    gSMIMEContainer.collapsed = false;

    if (gSignatureStatus != -1)
    {
      gSignedUINode.collapsed = false;
    }

    if (gEncryptionStatus != -1)
    {
      gEncryptedUINode.collapsed = false;
    }
  }
}

addEventListener('messagepane-loaded', msgHdrViewSMIMEOnLoad, true);
addEventListener('messagepane-unloaded', msgHdrViewSMIMEOnUnload, true);
addEventListener('messagepane-hide', msgHdrViewSMIMEOnMessagePaneHide, true);
addEventListener('messagepane-unhide', msgHdrViewSMIMEOnMessagePaneUnhide, true);
