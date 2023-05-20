/* -*- Mode: Javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource:///modules/mailServices.js");

top.MAX_RECIPIENTS = 1; /* for the initial listitem created in the XUL */

var inputElementType = "";
var selectElementType = "";
var selectElementIndexTable = null;

var gNumberOfCols = 0;

var gDragService = Components.classes["@mozilla.org/widget/dragservice;1"]
                             .getService(Components.interfaces.nsIDragService);

var test_addresses_sequence = false;

try {
  if (sPrefs)
    test_addresses_sequence = sPrefs.getBoolPref("mail.debug.test_addresses_sequence");
}
catch (ex) {}

function awGetMaxRecipients()
{
  return top.MAX_RECIPIENTS;
}

function awGetNumberOfCols()
{
  if (gNumberOfCols == 0)
  {
    var listbox = document.getElementById('addressingWidget');
    var listCols = listbox.getElementsByTagName('listcol');
    gNumberOfCols = listCols.length;
    if (!gNumberOfCols)
      gNumberOfCols = 1;  /* if no cols defined, that means we have only one! */
  }

  return gNumberOfCols;
}

/**
 * Adjust the default and minimum number of visible recipient rows for addressingWidget
 */
function awInitializeNumberOfRowsShown()
{
  let msgHeadersToolbar = document.getElementById("MsgHeadersToolbar");
  let addressingWidget = document.getElementById("addressingWidget");
  let awNumRowsShownDefault =
    Services.prefs.getIntPref("mail.compose.addresswidget.numRowsShownDefault");

  // Work around bug 966655: extraHeight 2 pixels for msgHeadersToolbar ensures
  // visibility of recipient rows per awNumRowsShownDefault and prevents scrollbar
  // on empty Address Widget, depending on OS screen resolution dpi scaling
  // (> 100%; thresholds differ).
  let extraHeight = 2;

  // Set minimum number of rows shown for address widget, per hardwired
  // rows="1" attribute of addressingWidget, to prevent resizing the
  // subject and format toolbar over the address widget.
  // This lets users shrink the address widget to one row (with delicate UX)
  // and thus maximize the space available for composition body,
  // especially on small screens.
  msgHeadersToolbar.minHeight = msgHeadersToolbar.boxObject.height;

  // Set default number of rows shown for address widget.
  addressingWidget.setAttribute("rows", awNumRowsShownDefault);
  msgHeadersToolbar.height = msgHeadersToolbar.boxObject.height + extraHeight;

  // Update addressingWidget internals.
  awCreateOrRemoveDummyRows();
}

function awInputElementName()
{
  if (inputElementType == "")
    inputElementType = document.getElementById("addressCol2#1").localName;
  return inputElementType;
}

function awSelectElementName()
{
  if (selectElementType == "")
      selectElementType = document.getElementById("addressCol1#1").localName;
  return selectElementType;
}

// TODO: replace awGetSelectItemIndex with recipient type index constants

function awGetSelectItemIndex(itemData)
{
  if (selectElementIndexTable == null)
  {
    selectElementIndexTable = new Object();
    var selectElem = document.getElementById("addressCol1#1");
    for (var i = 0; i < selectElem.childNodes[0].childNodes.length; i ++)
    {
      var aData = selectElem.childNodes[0].childNodes[i].getAttribute("value");
      selectElementIndexTable[aData] = i;
    }
  }

  return selectElementIndexTable[itemData];
}

function Recipients2CompFields(msgCompFields)
{
  if (!msgCompFields) {
    throw new Error("Message Compose Error: msgCompFields is null (ExtractRecipients)");
    return;
  }
    var i = 1;
    var addrTo = "";
    var addrCc = "";
    var addrBcc = "";
    var addrReply = "";
    var addrNg = "";
    var addrFollow = "";
    var to_Sep = "";
    var cc_Sep = "";
    var bcc_Sep = "";
    var reply_Sep = "";
    var ng_Sep = "";
    var follow_Sep = "";

    var recipientType;
    var inputField;
    var fieldValue;
    var recipient;
    while ((inputField = awGetInputElement(i)))
    {
      fieldValue = inputField.value;
      if (fieldValue != "")
      {
        recipientType = awGetPopupElement(i).value;
        recipient = null;

        switch (recipientType)
        {
          case "addr_to"    :
          case "addr_cc"    :
          case "addr_bcc"   :
          case "addr_reply" :
            try {
              let headerParser = MailServices.headerParser;
              recipient =
                headerParser.makeFromDisplayAddress(fieldValue, {})
                            .map(fullValue => headerParser.makeMimeAddress(fullValue.name,
                                                                           fullValue.email))
                            .join(", ");
            } catch (ex) {
              recipient = fieldValue;
            }
            break;
        }

        switch (recipientType)
        {
          case "addr_to"          : addrTo += to_Sep + recipient; to_Sep = ",";               break;
          case "addr_cc"          : addrCc += cc_Sep + recipient; cc_Sep = ",";               break;
          case "addr_bcc"         : addrBcc += bcc_Sep + recipient; bcc_Sep = ",";            break;
          case "addr_reply"       : addrReply += reply_Sep + recipient; reply_Sep = ",";      break;
          case "addr_newsgroups"  : addrNg += ng_Sep + fieldValue; ng_Sep = ",";              break;
          case "addr_followup"    : addrFollow += follow_Sep + fieldValue; follow_Sep = ",";  break;
          case "addr_other":
            let headerName = awGetPopupElement(i).label;
            headerName = headerName.substring(0, headerName.indexOf(':'));
            msgCompFields.setRawHeader(headerName, fieldValue, null);
            break;
        }
      }
      i ++;
    }

    msgCompFields.to = addrTo;
    msgCompFields.cc = addrCc;
    msgCompFields.bcc = addrBcc;
    msgCompFields.replyTo = addrReply;
    msgCompFields.newsgroups = addrNg;
    msgCompFields.followupTo = addrFollow;
}

function CompFields2Recipients(msgCompFields)
{
  if (msgCompFields) {
    let listbox = document.getElementById('addressingWidget');
    let newListBoxNode = listbox.cloneNode(false);
    let listBoxColsClone = listbox.firstChild.cloneNode(true);
    newListBoxNode.appendChild(listBoxColsClone);
    let templateNode = listbox.querySelector("listitem");
    // dump("replacing child in comp fields 2 recips \n");
    listbox.parentNode.replaceChild(newListBoxNode, listbox);

    top.MAX_RECIPIENTS = 0;
    let msgReplyTo = msgCompFields.replyTo;
    let msgTo = msgCompFields.to;
    let msgCC = msgCompFields.cc;
    let msgBCC = msgCompFields.bcc;
    let msgNewsgroups = msgCompFields.newsgroups;
    let msgFollowupTo = msgCompFields.followupTo;
    let havePrimaryRecipient = false;
    if (msgReplyTo)
      awSetInputAndPopupFromArray(msgCompFields.splitRecipients(msgReplyTo, false, {}),
                                  "addr_reply", newListBoxNode, templateNode);
    if (msgTo)
    {
      let rcp = msgCompFields.splitRecipients(msgTo, false, {});
      if (rcp.length)
      {
        awSetInputAndPopupFromArray(rcp, "addr_to", newListBoxNode, templateNode);
        havePrimaryRecipient = true;
      }
    }
    if (msgCC)
      awSetInputAndPopupFromArray(msgCompFields.splitRecipients(msgCC, false, {}),
                                  "addr_cc", newListBoxNode, templateNode);
    if (msgBCC)
      awSetInputAndPopupFromArray(msgCompFields.splitRecipients(msgBCC, false, {}),
                                  "addr_bcc", newListBoxNode, templateNode);
    if (msgNewsgroups)
    {
      awSetInputAndPopup(msgNewsgroups, "addr_newsgroups", newListBoxNode, templateNode);
      havePrimaryRecipient = true;
    }
    if (msgFollowupTo)
      awSetInputAndPopup(msgFollowupTo, "addr_followup", newListBoxNode, templateNode);

    // If it's a new message, we need to add an extra empty recipient.
    if (!havePrimaryRecipient)
      _awSetInputAndPopup("", "addr_to", newListBoxNode, templateNode);
    awFitDummyRows(2);

    // CompFields2Recipients is called whenever a user replies or edits an existing message. We want to
    // add all of the non-empty recipients for this message to the ignore list for spell check
    let currentAddress = gCurrentIdentity ? gCurrentIdentity.fullAddress : "";
    addRecipientsToIgnoreList([currentAddress,msgTo,msgCC,msgBCC].filter(adr => adr).join(", "));
  }
}

function awSetInputAndPopupId(inputElem, popupElem, rowNumber)
{
  popupElem.id = "addressCol1#" + rowNumber;
  inputElem.id = "addressCol2#" + rowNumber;
  inputElem.setAttribute("aria-labelledby", popupElem.id);
}

/**
 * Set value of the recipient input field at row rowNumber and set up
 * the recipient type menulist.
 *
 * @param inputElem                 recipient input element
 * @param inputValue                recipient value (address)
 * @param popupElem                 recipient type menulist element
 * @param popupValue
 * @param aNotifyRecipientsChanged  Notify that the recipients have changed.
 *                                  Generally we notify unless recipients are
 *                                  added in batch when the caller takes care
 *                                  of the notification.
 */
function awSetInputAndPopupValue(inputElem, inputValue, popupElem, popupValue, rowNumber, aNotifyRecipientsChanged = true)
{
  inputElem.value = inputValue.trimLeft();

  popupElem.selectedItem = popupElem.childNodes[0].childNodes[awGetSelectItemIndex(popupValue)];
  // TODO: can there be a row without ID yet?
  if (rowNumber >= 0)
    awSetInputAndPopupId(inputElem, popupElem, rowNumber);

  _awSetAutoComplete(popupElem, inputElem);

  if (aNotifyRecipientsChanged)
    onRecipientsChanged(true);
}

function _awSetInputAndPopup(inputValue, popupValue, parentNode, templateNode)
{
    top.MAX_RECIPIENTS++;

    var newNode = templateNode.cloneNode(true);
    parentNode.appendChild(newNode); // we need to insert the new node before we set the value of the select element!

    var input = newNode.getElementsByTagName(awInputElementName());
    var select = newNode.getElementsByTagName(awSelectElementName());

    if (input && input.length == 1 && select && select.length == 1)
      awSetInputAndPopupValue(input[0], inputValue, select[0], popupValue, top.MAX_RECIPIENTS)
}

function awSetInputAndPopup(inputValue, popupValue, parentNode, templateNode)
{
  if ( inputValue && popupValue )
  {
    var addressArray = inputValue.split(",");

    for ( var index = 0; index < addressArray.length; index++ )
        _awSetInputAndPopup(addressArray[index], popupValue, parentNode, templateNode);
  }
}

function awSetInputAndPopupFromArray(inputArray, popupValue, parentNode, templateNode)
{
  if (popupValue)
  {
    for (let recipient of inputArray)
      _awSetInputAndPopup(recipient, popupValue, parentNode, templateNode);
  }
}

function awRemoveRecipients(msgCompFields, recipientType, recipientsList)
{
  if (!msgCompFields || !recipientsList)
    return;

  var recipientArray = msgCompFields.splitRecipients(recipientsList, false, {});

  for (var index = 0; index < recipientArray.length; index++)
    for (var row = 1; row <= top.MAX_RECIPIENTS; row ++)
    {
      var popup = awGetPopupElement(row);
      if (popup.value == recipientType)
      {
        var input = awGetInputElement(row);
        if (input.value == recipientArray[index])
        {
          awSetInputAndPopupValue(input, "", popup, "addr_to", -1);
          break;
        }
      }
    }
}

/**
 * Adds a batch of new rows matching recipientType and drops in the list of addresses.
 *
 * @param msgCompFields  A nsIMsgCompFields object that is only used as a helper,
 *                       it will not get the addresses appended.
 * @param recipientType  Type of recipient, e.g. "addr_to".
 * @param recipientList  A string of addresses to add.
 */
function awAddRecipients(msgCompFields, recipientType, recipientsList)
{
  if (!msgCompFields || !recipientsList)
    return;

  var recipientArray = msgCompFields.splitRecipients(recipientsList, false, {});
  awAddRecipientsArray(recipientType, recipientArray);
}

/**
 * Adds a batch of new rows matching recipientType and drops in the array of addresses.
 *
 * @param aRecipientType  Type of recipient, e.g. "addr_to".
 * @param aAddressArray   An array of recipient addresses (strings) to add.
 */
function awAddRecipientsArray(aRecipientType, aAddressArray)
{
  // Find rows that are empty so that we can fill them.
  let emptyRows = [];
  for (let row = 1; row <= top.MAX_RECIPIENTS; row ++)
  {
    if (awGetInputElement(row).value == "")
      emptyRows.push(row);
  }

  // Push the new recipients into the found empty rows or append new rows when needed.
  let row = 1;
  for (let address of aAddressArray)
  {
    if (emptyRows.length > 0)
    {
      row = emptyRows.shift();
    }
    else
    {
      awAppendNewRow(false);
      row = top.MAX_RECIPIENTS;
    }

    awSetInputAndPopupValue(awGetInputElement(row), address,
                            awGetPopupElement(row), aRecipientType,
                            row, false);
  }

  // Be sure we still have an empty row left.
  if ((emptyRows.length == 0) && (awGetInputElement(top.MAX_RECIPIENTS).value != ""))
  {
    // Insert empty row at the end and focus.
    awAppendNewRow(true);
    awSetInputAndPopupValue(awGetInputElement(top.MAX_RECIPIENTS), "",
                            awGetPopupElement(top.MAX_RECIPIENTS), "addr_to",
                            top.MAX_RECIPIENTS, false);
  } else {
    // Focus the next empty row, if any, or the pre-existing empty last row.
    row = (emptyRows.length > 0) ? emptyRows.shift() : top.MAX_RECIPIENTS;
    awSetFocus(row, awGetInputElement(row));
  }

  onRecipientsChanged(true);

  // Add the recipients to our spell check ignore list.
  addRecipientsToIgnoreList(aAddressArray.join(", "));
}

/**
 * Adds a new row matching recipientType and drops in the single address.
 *
 * This is mostly used by addons, even though they should use AddRecipient().
 *
 * @param aRecipientType  Type of recipient, e.g. addr_to.
 * @param aAddress        A string with recipient address.
 */
function awAddRecipient(aRecipientType, aAddress)
{
  awAddRecipientsArray(aRecipientType, [aAddress]);
}

function awTestRowSequence()
{
  /*
    This function is for debug and testing purpose only, normal user should not run it!

    Everytime we insert or delete a row, we must be sure we didn't break the ID sequence of
    the addressing widget rows. This function will run a quick test to see if the sequence still ok

    You need to define the pref mail.debug.test_addresses_sequence to true in order to activate it
  */

  if (!test_addresses_sequence)
    return true;

  /* debug code to verify the sequence still good */

  let listbox = document.getElementById('addressingWidget');
  let listitems = listbox.getElementsByTagName('listitem');
  if (listitems.length >= top.MAX_RECIPIENTS )
  {
    for (let i = 1; i <= listitems.length; i ++)
    {
      let item = listitems [i - 1];
      let inputID = item.querySelector(awInputElementName()).id.split("#")[1];
      let popupID = item.querySelector(awSelectElementName()).id.split("#")[1];
      if (inputID != i || popupID != i)
      {
        dump("#ERROR: sequence broken at row " + i + ", inputID=" + inputID + ", popupID=" + popupID + "\n");
        return false;
      }
      dump("---SEQUENCE OK---\n");
      return true;
    }
  }
  else
    dump("#ERROR: listitems.length(" + listitems.length + ") < top.MAX_RECIPIENTS(" + top.MAX_RECIPIENTS + ")\n");

  return false;
}

function awCleanupRows()
{
  var maxRecipients = top.MAX_RECIPIENTS;
  var rowID = 1;

  for (var row = 1; row <= maxRecipients; row ++)
  {
    var inputElem = awGetInputElement(row);
    if (inputElem.value == "" && row < maxRecipients)
      awRemoveRow(awGetRowByInputElement(inputElem));
    else
    {
      awSetInputAndPopupId(inputElem, awGetPopupElement(row), rowID);
      rowID ++;
    }
  }

  awTestRowSequence();
}

function awDeleteRow(rowToDelete)
{
  // When we delete a row, we must reset the id of other rows in order to not break the sequence.
  var maxRecipients = top.MAX_RECIPIENTS;
  awRemoveRow(rowToDelete);

  // assume 2 column update (input and popup)
  for (var row = rowToDelete + 1; row <= maxRecipients; row ++)
    awSetInputAndPopupId(awGetInputElement(row), awGetPopupElement(row), (row-1));

  awTestRowSequence();
}

function awClickEmptySpace(target, setFocus)
{
  if (document.getElementById("addressCol2#1").disabled || target == null ||
      (target.localName != "listboxbody" &&
      target.localName != "listcell" &&
      target.localName != "listitem"))
    return;

  var lastInput = awGetInputElement(top.MAX_RECIPIENTS);

  if ( lastInput && lastInput.value )
    awAppendNewRow(setFocus);
  else
    if (setFocus)
      awSetFocus(top.MAX_RECIPIENTS, lastInput);
}

function awReturnHit(inputElement)
{
  var row = awGetRowByInputElement(inputElement);
  var nextInput = awGetInputElement(row+1);

  if ( !nextInput )
  {
    if ( inputElement.value )
      awAppendNewRow(true);
    else // No address entered, switch to Subject field
    {
      var subjectField = document.getElementById( 'msgSubject' );
      subjectField.select();
      subjectField.focus();
    }
  }
  else
  {
    nextInput.select();
    awSetFocus(row+1, nextInput);
  }

  // be sure to add the user add recipient to our ignore list
  // when the user hits enter in an autocomplete widget...
  addRecipientsToIgnoreList(inputElement.value);
}

function awDeleteHit(inputElement)
{
  var row = awGetRowByInputElement(inputElement);

  /* 1. don't delete the row if it's the last one remaining, just reset it! */
  if (top.MAX_RECIPIENTS <= 1)
  {
    inputElement.value = "";
    return;
  }

  /* 2. Set the focus to the previous field if possible */
  if (row > 1)
    awSetFocus(row - 1, awGetInputElement(row - 1))
  else
    awSetFocus(1, awGetInputElement(2))   /* We have to cheat a little bit because the focus will */
                                          /* be set asynchronusly after we delete the current row, */
                                          /* therefore the row number still the same! */

  /* 3. Delete the row */
  awDeleteRow(row);
}

function awInputChanged(inputElement)
{
  //Do we need to add a new row?
  var lastInput = awGetInputElement(top.MAX_RECIPIENTS);
  if ( lastInput && lastInput.value && !top.doNotCreateANewRow)
    awAppendNewRow(false);
  top.doNotCreateANewRow = false;
}

function awAppendNewRow(setFocus)
{
  var listbox = document.getElementById('addressingWidget');
  var listitem1 = awGetListItem(1);

  if ( listbox && listitem1 )
  {
    var lastRecipientType = awGetPopupElement(top.MAX_RECIPIENTS).value;

    var nextDummy = awGetNextDummyRow();
    var newNode = listitem1.cloneNode(true);
    if (nextDummy)
      listbox.replaceChild(newNode, nextDummy);
    else
      listbox.appendChild(newNode);

    top.MAX_RECIPIENTS++;

    var input = newNode.getElementsByTagName(awInputElementName());
    if ( input && input.length == 1 )
    {
      input[0].value = "";

      // We always clone the first row.  The problem is that the first row
      // could be focused.  When we clone that row, we end up with a cloned
      // XUL textbox that has a focused attribute set.  Therefore we think
      // we're focused and don't properly refocus.  The best solution to this
      // would be to clone a template row that didn't really have any presentation,
      // rather than using the real visible first row of the listbox.
      //
      // For now we'll just put in a hack that ensures the focused attribute
      // is never copied when the node is cloned.
      input[0].removeAttribute("focused");

      // Reset autocomplete attribute "nomatch" so we don't cause red addresses
      // on a cloned row.
      input[0].removeAttribute("nomatch");
    }
    var select = newNode.getElementsByTagName(awSelectElementName());
    if ( select && select.length == 1 )
    {
      // It only makes sense to clone some field types; others
      // should not be cloned, since it just makes the user have
      // to go to the trouble of selecting something else. In such
      // cases let's default to 'To' (a reasonable default since
      // we already default to 'To' on the first dummy field of
      // a new message).
      switch (lastRecipientType)
      {
        case  "addr_reply":
        case  "addr_other":
          select[0].selectedIndex = awGetSelectItemIndex("addr_to");
          break;
        case "addr_followup":
          select[0].selectedIndex = awGetSelectItemIndex("addr_newsgroups");
          break;
        default:
        // e.g. "addr_to","addr_cc","addr_bcc","addr_newsgroups":
          select[0].selectedIndex = awGetSelectItemIndex(lastRecipientType);
      }

      awSetInputAndPopupId(input[0], select[0], top.MAX_RECIPIENTS);

      if (input)
        _awSetAutoComplete(select[0], input[0]);
    }

    // focus on new input widget
    if (setFocus && input[0] )
      awSetFocus(top.MAX_RECIPIENTS, input[0]);
  }
}

// functions for accessing the elements in the addressing widget

/**
 * Returns the recipient type popup for a row.
 *
 * @param row  Index of the recipient row to return. Starts at 1.
 * @return     This returns the menulist (not its child menupopup), despite the function name.
 */
function awGetPopupElement(row)
{

    return document.getElementById("addressCol1#" + row);
}

/**
 * Returns the recipient inputbox for a row.
 *
 * @param row  Index of the recipient row to return. Starts at 1.
 * @return     This returns the textbox element.
 */
function awGetInputElement(row)
{
    return document.getElementById("addressCol2#" + row);
}

function awGetElementByCol(row, col)
{
  var colID = "addressCol" + col + "#" + row;
  return document.getElementById(colID);
}

function awGetListItem(row)
{
  var listbox = document.getElementById('addressingWidget');

  if ( listbox && row > 0)
  {
    var listitems = listbox.getElementsByTagName('listitem');
    if ( listitems && listitems.length >= row )
      return listitems[row-1];
  }
  return 0;
}

function awGetRowByInputElement(inputElement)
{
  var row = 0;
  if (inputElement) {
    var listitem = inputElement.parentNode.parentNode;
    while (listitem) {
      if (listitem.localName == "listitem")
        ++row;
      listitem = listitem.previousSibling;
    }
  }
  return row;
}


// Copy Node - copy this node and insert ahead of the (before) node.  Append to end if before=0
function awCopyNode(node, parentNode, beforeNode)
{
  var newNode = node.cloneNode(true);

  if ( beforeNode )
    parentNode.insertBefore(newNode, beforeNode);
  else
    parentNode.appendChild(newNode);

    return newNode;
}

// remove row

function awRemoveRow(row)
{
  awGetListItem(row).remove();
  awFitDummyRows();

  top.MAX_RECIPIENTS --;
}


function awSetFocus(row, inputElement)
{
  top.awRow = row;
  top.awInputElement = inputElement;
  setTimeout(_awSetFocus, 0);
}

function _awSetFocus()
{
  var listbox = document.getElementById('addressingWidget');
  var theNewRow = awGetListItem(top.awRow);

  // Warning: firstVisibleRow is zero base but top.awRow is one base!
  var firstVisibleRow = listbox.getIndexOfFirstVisibleRow();
  var numOfVisibleRows = listbox.getNumberOfVisibleRows();

  // Do we need to scroll in order to see the selected row?
  if (top.awRow <= firstVisibleRow)
    listbox.scrollToIndex(top.awRow - 1);
  else if (top.awRow - 1 >= (firstVisibleRow + numOfVisibleRows))
    listbox.scrollToIndex(top.awRow - numOfVisibleRows);

  top.awInputElement.focus();
}

function awTabFromRecipient(element, event)
{
  // If we are the last element in the listbox, we don't want to create a new row.
  if (element == awGetInputElement(top.MAX_RECIPIENTS))
    top.doNotCreateANewRow = true;

  var row = awGetRowByInputElement(element);
  if (!event.shiftKey && row < top.MAX_RECIPIENTS) {
    var listBoxRow = row - 1; // listbox row indices are 0-based, ours are 1-based.
    var listBox = document.getElementById("addressingWidget");
    listBox.listBoxObject.ensureIndexIsVisible(listBoxRow + 1);
  }

  // be sure to add the user add recipient to our ignore list
  // when the user tabs out of an autocomplete line...
  addRecipientsToIgnoreList(element.value);
}

function awTabFromMenulist(element, event)
{
  var row = awGetRowByInputElement(element);
  if (event.shiftKey && row > 1) {
    var listBoxRow = row - 1; // listbox row indices are 0-based, ours are 1-based.
    var listBox = document.getElementById("addressingWidget");
    listBox.listBoxObject.ensureIndexIsVisible(listBoxRow - 1);
  }
}

function awGetNumberOfRecipients()
{
    return top.MAX_RECIPIENTS;
}

function DragOverAddressingWidget(event)
{
  var validFlavor = false;
  var dragSession = dragSession = gDragService.getCurrentSession();

  if (dragSession.isDataFlavorSupported("text/x-moz-address"))
    validFlavor = true;

  if (validFlavor)
    dragSession.canDrop = true;
}

function DropOnAddressingWidget(event)
{
  var dragSession = gDragService.getCurrentSession();

  var trans = Components.classes["@mozilla.org/widget/transferable;1"].createInstance(Components.interfaces.nsITransferable);
  trans.init(getLoadContext());
  trans.addDataFlavor("text/x-moz-address");

  for ( var i = 0; i < dragSession.numDropItems; ++i )
  {
    dragSession.getData ( trans, i );
    var dataObj = new Object();
    var bestFlavor = new Object();
    var len = new Object();
    trans.getAnyTransferData ( bestFlavor, dataObj, len );
    if ( dataObj )
      dataObj = dataObj.value.QueryInterface(Components.interfaces.nsISupportsString);
    if ( !dataObj )
      continue;

    // pull the address out of the data object
    var address = dataObj.data.substring(0, len.value);
    if (!address)
      continue;

    DropRecipient(event.target, address);
  }
}

function DropRecipient(target, recipient)
{
  // break down and add each address
  return parseAndAddAddresses(recipient, awGetPopupElement(top.MAX_RECIPIENTS).value);
}

function _awSetAutoComplete(selectElem, inputElem)
{
  let params = JSON.parse(inputElem.getAttribute('autocompletesearchparam'));
  params.type = selectElem.value;
  inputElem.setAttribute('autocompletesearchparam', JSON.stringify(params));
}

function awSetAutoComplete(rowNumber)
{
    var inputElem = awGetInputElement(rowNumber);
    var selectElem = awGetPopupElement(rowNumber);
    _awSetAutoComplete(selectElem, inputElem)
}

function awRecipientTextCommand(enterEvent, element)
{
  // Only add new row when enter was hit (not for tab/autocomplete select).
  if (enterEvent)
    awReturnHit(element);
}

function awRecipientKeyPress(event, element)
{
  switch(event.keyCode) {
  case KeyEvent.DOM_VK_RETURN:
  case KeyEvent.DOM_VK_TAB:
    // if the user text contains a comma or a line return, ignore
    if (element.value.includes(','))
    {
      var addresses = element.value;
      element.value = ""; // clear out the current line so we don't try to autocomplete it..
      parseAndAddAddresses(addresses, awGetPopupElement(awGetRowByInputElement(element)).value);
    }
    else if (event.keyCode == KeyEvent.DOM_VK_TAB)
      awTabFromRecipient(element, event);

    break;
  }
}

function awRecipientKeyDown(event, element)
{
  switch(event.keyCode) {
  case KeyEvent.DOM_VK_DELETE:
  case KeyEvent.DOM_VK_BACK_SPACE:
    if (!element.value)
      awDeleteHit(element);

    // We need to stop the event else the listbox will receive it and the
    // function awKeyDown will be executed!
    event.stopPropagation();
    break;
  }
}

function awKeyDown(event, listboxElement)
{
  switch(event.keyCode) {
  case KeyEvent.DOM_VK_DELETE:
  case KeyEvent.DOM_VK_BACK_SPACE:
    /* Warning, the listboxElement.selectedItems will change everytime we delete a row */
    var length = listboxElement.selectedCount;
    for (var i = 1; i <= length; i++) {
      var inputs = listboxElement.selectedItem.getElementsByTagName(awInputElementName());
      if (inputs && inputs.length == 1)
        awDeleteHit(inputs[0]);
    }
    break;
  }
}

function awMenulistKeyPress(event, element)
{
  switch(event.keyCode) {
  case KeyEvent.DOM_VK_TAB:
    awTabFromMenulist(element, event);
    break;
  }
}

/* ::::::::::: addressing widget dummy rows ::::::::::::::::: */

var gAWContentHeight = 0;
var gAWRowHeight = 0;

function awFitDummyRows()
{
  awCalcContentHeight();
  awCreateOrRemoveDummyRows();
}

function awCreateOrRemoveDummyRows()
{
  let listbox = document.getElementById("addressingWidget");
  let listboxHeight = listbox.boxObject.height;

  // remove rows to remove scrollbar
  let kids = listbox.querySelectorAll('[_isDummyRow]');
  for (let i = kids.length - 1; gAWContentHeight > listboxHeight && i >= 0; --i) {
    gAWContentHeight -= gAWRowHeight;
    kids[i].remove();
  }

  // add rows to fill space
  if (gAWRowHeight) {
    while (gAWContentHeight + gAWRowHeight < listboxHeight) {
      awCreateDummyItem(listbox);
      gAWContentHeight += gAWRowHeight;
    }
  }
}

function awCalcContentHeight()
{
  var listbox = document.getElementById("addressingWidget");
  var items = listbox.getElementsByTagName("listitem");

  gAWContentHeight = 0;
  if (items.length > 0) {
    // all rows are forced to a uniform height in xul listboxes, so
    // find the first listitem with a boxObject and use it as precedent
    var i = 0;
    do {
      gAWRowHeight = items[i].boxObject.height;
      ++i;
    } while (i < items.length && !gAWRowHeight);
    gAWContentHeight = gAWRowHeight*items.length;
  }
}

function awCreateDummyItem(aParent)
{
  var titem = document.createElement("listitem");
  titem.setAttribute("_isDummyRow", "true");
  titem.setAttribute("class", "dummy-row");

  for (var i = awGetNumberOfCols(); i > 0; i--)
    awCreateDummyCell(titem);

  if (aParent)
    aParent.appendChild(titem);

  return titem;
}

function awCreateDummyCell(aParent)
{
  var cell = document.createElement("listcell");
  cell.setAttribute("class", "addressingWidgetCell dummy-row-cell");
  if (aParent)
    aParent.appendChild(cell);

  return cell;
}

function awGetNextDummyRow()
{
  // gets the next row from the top down
  return document.querySelector('#addressingWidget > [_isDummyRow]');
}

function awSizerListen()
{
  // when splitter is clicked, fill in necessary dummy rows each time the mouse is moved
  awCalcContentHeight(); // precalculate
  document.addEventListener("mousemove", awSizerMouseMove, true);
  document.addEventListener("mouseup", awSizerMouseUp, {capture: false, once: true});
}

function awSizerMouseMove()
{
  awCreateOrRemoveDummyRows(2);
}

function awSizerMouseUp()
{
  document.removeEventListener("mousemove", awSizerMouseMove, true);
}

function awDocumentKeyPress(event)
{
  try {
    var id = event.target.id;
    if (id.startsWith('addressCol1'))
      awMenulistKeyPress(event, event.target);
  } catch (e) { }
}

// Given an arbitrary block of text like a comma delimited list of names or a names separated by spaces,
// we will try to autocomplete each of the names and then take the FIRST match for each name, adding it the
// addressing widget on the compose window.

var gAutomatedAutoCompleteListener = null;

function parseAndAddAddresses(addressText, recipientType)
{
  // strip any leading >> characters inserted by the autocomplete widget
  var strippedAddresses = addressText.replace(/.* >> /, "");

  let addresses = MailServices.headerParser
                              .makeFromDisplayAddress(strippedAddresses);

  if (addresses.length > 0)
  {
    // we need to set up our own autocomplete session and search for results
    if (!gAutomatedAutoCompleteListener)
      gAutomatedAutoCompleteListener = new AutomatedAutoCompleteHandler();

    gAutomatedAutoCompleteListener.init(addresses.map(addr => addr.toString()),
                                        recipientType);
  }
}

function AutomatedAutoCompleteHandler()
{
}

// state driven self contained object which will autocomplete a block of addresses without any UI.
// force picks the first match and adds it to the addressing widget, then goes on to the next
// name to complete.

AutomatedAutoCompleteHandler.prototype =
{
  param: this,
  sessionName: null,
  namesToComplete: null,
  numNamesToComplete: 0,
  indexIntoNames: 0,
  finalAddresses: null,

  numSessionsToSearch: 0,
  numSessionsSearched: 0,
  recipientType: null,
  searchResults: null,

  init:function(namesToComplete, recipientType)
  {
    this.indexIntoNames = 0;
    this.numNamesToComplete = namesToComplete.length;
    this.namesToComplete = namesToComplete;
    this.finalAddresses = [];

    this.recipientType = recipientType ? recipientType : "addr_to";

    // set up the auto complete sessions to use
    this.autoCompleteNextAddress();
  },

  autoCompleteNextAddress:function()
  {
    this.numSessionsToSearch = 0;
    this.numSessionsSearched = 0;
    this.searchResults = [];

    if (this.indexIntoNames < this.numNamesToComplete)
    {
      if (this.namesToComplete[this.indexIntoNames])
      {
      /* XXX This is used to work, until switching to the new toolkit broke it
         We should fix it see bug 456550.
      if (!this.namesToComplete[this.indexIntoNames].includes('@')) // don't autocomplete if address has an @ sign in it
      {
        // make sure total session count is updated before we kick off ANY actual searches
        if (gAutocompleteSession)
          this.numSessionsToSearch++;

        if (gLDAPSession && gCurrentAutocompleteDirectory)
          this.numSessionsToSearch++;

        if (gAutocompleteSession)
        {
           gAutocompleteSession.onAutoComplete(this.namesToComplete[this.indexIntoNames], null, this);
           // AB searches are actually synchronous. So by the time we get here we have already looked up results.

           // if we WERE going to also do an LDAP lookup, then check to see if we have a valid match in the AB, if we do
           // don't bother with the LDAP search too just return

           if (gLDAPSession && gCurrentAutocompleteDirectory && this.searchResults[0] && this.searchResults[0].defaultItemIndex != -1)
           {
             this.processAllResults();
             return;
           }
        }

        if (gLDAPSession && gCurrentAutocompleteDirectory)
          gLDAPSession.onStartLookup(this.namesToComplete[this.indexIntoNames], null, this);
      }
      */

        if (!this.numSessionsToSearch)
          this.processAllResults(); // ldap and ab are turned off, so leave text alone.
      }
    }
    else
    {
      this.finish();
    }
  },

  onStatus:function(aStatus)
  {
    return;
  },

  onAutoComplete: function(aResults, aStatus)
  {
    // store the results until all sessions are done and have reported in
    if (aResults)
      this.searchResults[this.numSessionsSearched] = aResults;

    this.numSessionsSearched++; // bump our counter

    if (this.numSessionsToSearch <= this.numSessionsSearched)
      setTimeout(gAutomatedAutoCompleteListener.processAllResults, 0); // we are all done
  },

  processAllResults: function()
  {
    // Take the first result and add it to the compose window
    var addressToAdd;

    // loop through the results looking for the non default case (default case is the address book with only one match, the default domain)
    var sessionIndex;

    var searchResultsForSession;

    for (sessionIndex in this.searchResults)
    {
      searchResultsForSession = this.searchResults[sessionIndex];
      if (searchResultsForSession && searchResultsForSession.defaultItemIndex > -1)
      {
        addressToAdd = searchResultsForSession.items.QueryElementAt(searchResultsForSession.defaultItemIndex, Components.interfaces.nsIAutoCompleteItem).value;
        break;
      }
    }

    // still no match? loop through looking for the -1 default index
    if (!addressToAdd)
    {
      for (sessionIndex in this.searchResults)
      {
        searchResultsForSession = this.searchResults[sessionIndex];
        if (searchResultsForSession && searchResultsForSession.defaultItemIndex == -1)
        {
          addressToAdd = searchResultsForSession.items.QueryElementAt(0, Components.interfaces.nsIAutoCompleteItem).value;
          break;
        }
      }
    }

    // no matches anywhere...just use what we were given
    if (!addressToAdd)
      addressToAdd = this.namesToComplete[this.indexIntoNames];

    this.finalAddresses.push(addressToAdd);

    this.indexIntoNames++;
    this.autoCompleteNextAddress();
  },

  finish: function()
  {
    // This will now append all the recipients, set the focus on a new
    // available row, and make sure it is visible.
    awAddRecipientsArray(this.recipientType, this.finalAddresses);
  },

  QueryInterface : function(iid)
  {
      if (iid.equals(Components.interfaces.nsIAutoCompleteListener) ||
          iid.equals(Components.interfaces.nsISupports))
        return this;
      throw Components.results.NS_NOINTERFACE;
  }
}

// Returns the load context for the current window
function getLoadContext() {
  return window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
               .getInterface(Components.interfaces.nsIWebNavigation)
               .QueryInterface(Components.interfaces.nsILoadContext);
}
