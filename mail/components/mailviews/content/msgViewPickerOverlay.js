/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource:///modules/mailViewManager.js");

// these constants are now authoritatively defined in mailViewManager.js (above)
// tag views have kViewTagMarker + their key as value
var kViewItemAll         = MailViewConstants.kViewItemAll;
var kViewItemUnread      = MailViewConstants.kViewItemUnread;
var kViewItemTags        = MailViewConstants.kViewItemTags; // former labels used values 2-6
var kViewItemNotDeleted  = MailViewConstants.kViewItemNotDeleted;
// not a real view! a sentinel value to pop up a dialog
var kViewItemVirtual     = MailViewConstants.kViewItemVirtual;
// not a real view! a sentinel value to pop up a dialog
var kViewItemCustomize   = MailViewConstants.kViewItemCustomize;
var kViewItemFirstCustom = MailViewConstants.kViewItemFirstCustom;

var kViewCurrent    = MailViewConstants.kViewCurrent;
var kViewCurrentTag = MailViewConstants.kViewCurrentTag;
var kViewTagMarker  = MailViewConstants.kViewTagMarker;

/**
 * A reference to the nsIMsgMailViewList service that tracks custom mail views.
 */
var gMailViewList = null;

var nsMsgSearchScope  = Components.interfaces.nsMsgSearchScope;
var nsMsgSearchAttrib = Components.interfaces.nsMsgSearchAttrib;
var nsMsgSearchOp     = Components.interfaces.nsMsgSearchOp;

var nsMsgMessageFlags = Components.interfaces.nsMsgMessageFlags;

// perform the view/action requested by the aValue string
// and set the view picker label to the aLabel string
function ViewChange(aValue)
{
  if (aValue == kViewItemCustomize || aValue == kViewItemVirtual)
  {
    // restore to the previous view value, in case they cancel
    ViewPickerBinding.updateDisplay();
    if (aValue == kViewItemCustomize)
      LaunchCustomizeDialog();
    else
      gFolderTreeController.newVirtualFolder(
        ViewPickerBinding.currentViewLabel,
        gFolderDisplay.view.search.viewTerms);
    return;
  }

  // tag menuitem values are of the form :<keyword>
  if (isNaN(aValue))
  {
    // split off the tag key
    var tagkey = aValue.substr(kViewTagMarker.length);
    gFolderDisplay.view.setMailView(kViewItemTags, tagkey);
  }
  else
  {
    var numval = Number(aValue);
    gFolderDisplay.view.setMailView(numval, null);
  }
  ViewPickerBinding.updateDisplay();
}


function ViewChangeByMenuitem(aMenuitem)
{
  // Mac View menu menuitems don't have XBL bindings
  ViewChange(aMenuitem.getAttribute("value"));
}

/**
 * Mediates interaction with the #viewPickerPopup.  In theory this should be
 *  an XBL binding, but for the insanity where the view picker may not be
 *  visible at all times (or ever).  No view picker widget, no binding.
 */
var ViewPickerBinding = {
  _init: function ViewPickerBinding_init() {
    window.addEventListener(
      "MailViewChanged",
      function(aEvent) { ViewPickerBinding.updateDisplay(aEvent); },
      false);
  },

  /**
   * Return true if the view picker is visible.  This is used by the
   *  FolderDisplayWidget to know whether or not to actually use mailviews. (The
   *  idea is that if we are not visible, then it would be confusing to the user
   *  if we filtered their mail since they would have no feedback about this and
   *  no way to change it.)
   */
  get isVisible() {
    return document.getElementById("viewPicker") != null;
  },

  /**
   * Return the string value representing the current mail view value as
   *  understood by the view picker widgets.  The value is the index for
   *  everything but tags.  for tags it's the ":"-prefixed tagname.
   */
  get currentViewValue() {
    if (gFolderDisplay.view.mailViewIndex == kViewItemTags)
      return kViewTagMarker + gFolderDisplay.view.mailViewData;
    else
      return gFolderDisplay.view.mailViewIndex + "";
  },

  /**
   * @return The label for the current mail view value.
   */
  get currentViewLabel() {
    let viewPicker = document.getElementById("viewPicker");
    return viewPicker.getAttribute("label");
  },

  /**
   * The effective view has changed, update the widget.
   */
  updateDisplay: function ViewPickerBinding_updateDisplay(aEvent, aGiveUpIfNotFound) {
    let viewPicker = document.getElementById("viewPicker");
    if (viewPicker) {
      let value = this.currentViewValue;

      let viewPickerPopup = document.getElementById("viewPickerPopup");
      let selectedItem =
        viewPickerPopup.querySelector('[value="' + value + '"]');
      if (!selectedItem)
      {
        // we may have a new item, so refresh to make it show up
        RefreshAllViewPopups(viewPickerPopup, true);
        selectedItem = viewPickerPopup.querySelector('[value="' + value + '"]');
      }
      viewPicker.setAttribute("label",
                              selectedItem && selectedItem.getAttribute("label"));
    }
  },
};
ViewPickerBinding._init();

function LaunchCustomizeDialog()
{
  OpenOrFocusWindow({}, "mailnews:mailviewlist", "chrome://messenger/content/mailViewList.xul");
}

/**
 * All of these Refresh*ViewPopup* methods have to deal with two menu
 *  variations.  They are accessible from the "View... Messages" menu as well as
 *  the view picker menu list in the toolbar.  aIsMenulist will be false in the
 *  former case and true in the latter case.
 */
function RefreshAllViewPopups(aViewPopup)
{
  RefreshViewPopup(aViewPopup);
  var menupopups = aViewPopup.getElementsByTagName("menupopup");
  if (menupopups.length > 1)
  {
    // when we have menupopups, we assume both tags and custom views are there
    RefreshTagsPopup(menupopups[0]);
    RefreshCustomViewsPopup(menupopups[1]);
  }
}


function RefreshViewPopup(aViewPopup)
{
  // mark default views if selected
  let currentViewValue = ViewPickerBinding.currentViewValue;

  let viewAll = aViewPopup.querySelector('[value="' + kViewItemAll + '"]');
  viewAll.setAttribute("checked", currentViewValue == kViewItemAll);
  let viewUnread =
    aViewPopup.querySelector('[value="' + kViewItemUnread + '"]');
  viewUnread.setAttribute("checked", currentViewValue == kViewItemUnread);

  let viewNotDeleted =
    aViewPopup.querySelector('[value="' + kViewItemNotDeleted + '"]');
  var folderArray = GetSelectedMsgFolders();
  if (folderArray.length == 0)
    return;

  // only show the "Not Deleted" item for IMAP servers that are using the IMAP
  // delete model
  viewNotDeleted.setAttribute("hidden", true);
  var msgFolder = folderArray[0];
  var server = msgFolder.server;
  if (server.type == "imap")
  {
    let imapServer =
      server.QueryInterface(Components.interfaces.nsIImapIncomingServer);
    if (imapServer.deleteModel == 0) { // nsMsgImapDeleteModels.IMAPDelete
      viewNotDeleted.setAttribute("hidden", false);
      viewNotDeleted.setAttribute("checked",
                                  currentViewValue == kViewItemNotDeleted);
    }
  }
}


function RefreshCustomViewsPopup(aMenupopup)
{
  // for each mail view in the msg view list, add an entry in our combo box
  if (!gMailViewList)
    gMailViewList = Components.classes["@mozilla.org/messenger/mailviewlist;1"]
                              .getService(Components.interfaces.nsIMsgMailViewList);
  // remove all menuitems
  while (aMenupopup.hasChildNodes())
    aMenupopup.lastChild.remove();

  // now rebuild the list
  var currentView = ViewPickerBinding.currentViewValue;
  var numItems = gMailViewList.mailViewCount;
  for (var i = 0; i < numItems; ++i)
  {
    var viewInfo = gMailViewList.getMailViewAt(i);
    var menuitem = document.createElement("menuitem");
    menuitem.setAttribute("label", viewInfo.prettyName);
    menuitem.setAttribute("value", kViewItemFirstCustom + i);
    menuitem.setAttribute("type", "radio");
    if (kViewItemFirstCustom + i == currentView)
      menuitem.setAttribute("checked", true);
    aMenupopup.appendChild(menuitem);
  }
}


function RefreshTagsPopup(aMenupopup)
{
  // remove all menuitems
  while (aMenupopup.hasChildNodes())
    aMenupopup.lastChild.remove();

  // create tag menuitems
  let currentTagKey = gFolderDisplay.view.mailViewIndex == kViewItemTags ?
                        gFolderDisplay.view.mailViewData : "";
  let tagArray = MailServices.tags.getAllTags({});
  for (let i = 0; i < tagArray.length; ++i)
  {
    let tagInfo = tagArray[i];
    let menuitem = document.createElement("menuitem");
    menuitem.setAttribute("label", tagInfo.tag);
    menuitem.setAttribute("value", kViewTagMarker + tagInfo.key);
    menuitem.setAttribute("type", "radio");
    if (tagInfo.key == currentTagKey)
      menuitem.setAttribute("checked", true);
    let color = tagInfo.color;
    if (color)
      menuitem.setAttribute("class", "lc-" + color.substr(1));
    aMenupopup.appendChild(menuitem);
  }
}

function ViewPickerOnLoad()
{
  var viewPickerPopup = document.getElementById("viewPickerPopup");
  if (viewPickerPopup)
    RefreshAllViewPopups(viewPickerPopup, true);
}


window.addEventListener("load", ViewPickerOnLoad, false);
