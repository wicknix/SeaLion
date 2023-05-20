/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported ltnInitMailIdentitiesRow, ltnSaveMailIdentitySelection */

Components.utils.import("resource:///modules/iteratorUtils.jsm");
Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource://calendar/modules/calUtils.jsm");

/**
 * Gets the value of a string in a .properties file from the lightning bundle
 *
 * @param aBundleName  the name of the properties file.  It is assumed that the
 *                     file lives in chrome://lightning/locale/
 * @param aStringName  the name of the string within the properties file
 * @param aParams      optional array of parameters to format the string
 */
function ltnGetString(aBundleName, aStringName, aParams) {
    return cal.calGetString(aBundleName, aStringName, aParams, "lightning");
}

// shared by lightning-calendar-properties.js and lightning-calendar-creation.js:
function ltnInitMailIdentitiesRow() {
    if (!gCalendar) {
        collapseElement("calendar-email-identity-row");
    }

    let imipIdentityDisabled = gCalendar.getProperty("imip.identity.disabled");
    setElementValue("calendar-email-identity-row",
                    imipIdentityDisabled && "true",
                    "collapsed");

    if (imipIdentityDisabled) {
        // If the imip identity is disabled, we don't have to set up the
        // menulist.
        return;
    }

    // If there is no transport but also no organizer id, then the
    // provider has not statically configured an organizer id. This is
    // basically what happens when "None" is selected.
    let menuPopup = document.getElementById("email-identity-menupopup");

    // Remove all children from the email list to avoid duplicates if the list
    // has already been populated during a previous step in the calendar
    // creation wizard.
    while (menuPopup.hasChildNodes()) {
        menuPopup.lastChild.remove();
    }

    addMenuItem(menuPopup, ltnGetString("lightning", "imipNoIdentity"), "none");
    let identities;
    if (gCalendar && gCalendar.aclEntry && gCalendar.aclEntry.hasAccessControl) {
        identities = gCalendar.aclEntry.getOwnerIdentities({});
    } else {
        identities = MailServices.accounts.allIdentities;
    }
    for (let identity in fixIterator(identities, Components.interfaces.nsIMsgIdentity)) {
        addMenuItem(menuPopup, identity.identityName, identity.key);
    }
    try {
        let sel = gCalendar.getProperty("imip.identity");
        if (sel) {
            sel = sel.QueryInterface(Components.interfaces.nsIMsgIdentity);
        }
        menuListSelectItem("email-identity-menulist", sel ? sel.key : "none");
    } catch (exc) {
        // Don't select anything if the message identity can't be found
    }
}

function ltnSaveMailIdentitySelection() {
    if (!gCalendar) {
        return;
    }
    let sel = "none";
    let imipIdentityDisabled = gCalendar.getProperty("imip.identity.disabled");
    let selItem = document.getElementById("email-identity-menulist").selectedItem;
    if (!imipIdentityDisabled && selItem) {
        sel = selItem.getAttribute("value");
    }
    // no imip.identity.key will default to the default account/identity, whereas
    // an empty key indicates no imip; that identity will not be found
    gCalendar.setProperty("imip.identity.key", sel == "none" ? "" : sel);
}
