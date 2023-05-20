/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported getElementValue, setBooleanAttribute, showElement, hideElement,
 *          uncollapseElement, collapseElement, disableElementWithLock,
 *          enableElementWithLock, uncheckChildNodes, removeChildren,
 *          appendCalendarItems, setAttributeToChildren, checkRadioControl,
 *          processEnableCheckbox, updateListboxDeleteButton,
 *          updateUnitLabelPlural, updateMenuLabelsPlural, menuListSelectItem,
 *          getOptimalMinimumWidth, getOptimalMinimumHeight,
 *          getOtherOrientation, updateSelectedLabel, setupAttendanceMenu
 */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");
Components.utils.import("resource://gre/modules/PluralForm.jsm");

/**
 * Helper function for filling the form,
 * Set the value of a property of a XUL element
 *
 * @param aElement      ID of XUL element to set, or the element node itself
 * @param aNewValue     value to set property to ( if undefined no change is made )
 * @param aPropertyName OPTIONAL name of property to set, default is "value",
 *                        use "checked" for radios & checkboxes, "data" for
 *                        drop-downs
 */
function setElementValue(aElement, aNewValue, aPropertyName) {
    cal.ASSERT(aElement, "aElement");

    if (aNewValue !== undefined) {
        if (typeof aElement == "string") {
            aElement = document.getElementById(aElement);
            cal.ASSERT(aElement, "aElement");
        }

        if (!aElement) { return; }

        if (aNewValue === false) {
            try {
                aElement.removeAttribute(aPropertyName);
            } catch (e) {
                cal.ERROR("setElementValue: aElement.removeAttribute couldn't remove " +
                aPropertyName + " from " + (aElement && aElement.localName) + " e: " + e + "\n");
            }
        } else if (aPropertyName) {
            try {
                aElement.setAttribute(aPropertyName, aNewValue);
            } catch (e) {
                cal.ERROR("setElementValue: aElement.setAttribute couldn't set " +
                aPropertyName + " from " + (aElement && aElement.localName) + " to " + aNewValue +
                " e: " + e + "\n");
            }
        } else {
            aElement.value = aNewValue;
        }
    }
}

/**
 * Helper function for getting data from the form,
 * Get the value of a property of a XUL element
 *
 * @param aElement      ID of XUL element to set, or the element node itself
 * @param propertyName  OPTIONAL name of property to set, default is "value",
 *                        use "checked" for radios & checkboxes, "data" for
 *                        drop-downs
 * @return newValue     Value of property
 *
 */
function getElementValue(aElement, aPropertyName) {
    if (typeof aElement == "string") {
        aElement = document.getElementById(aElement);
    }
    return aElement[aPropertyName || "value"];
}

/**
 * Sets the value of a boolean attribute by either setting the value or
 * removing the attribute
 *
 * @param aXulElement     The XUL element/string ID the attribute is applied to.
 * @param aAttribute      The name of the attribute
 * @param aValue          The boolean value
 * @return                Returns aValue (for chaining)
 */
function setBooleanAttribute(aXulElement, aAttribute, aValue) {
    setElementValue(aXulElement, aValue ? "true" : false, aAttribute);
    return aValue;
}

/**
 * Unconditionally show the element (hidden attribute)
 *
 * @param aElement      ID of XUL element to set, or the element node itself
 */
function showElement(aElement) {
    setElementValue(aElement, false, "hidden");
}

/**
 * Unconditionally hide the element (hidden attribute)
 *
 * @param aElement      ID of XUL element to set, or the element node itself
 */
function hideElement(aElement) {
    setElementValue(aElement, "true", "hidden");
}

/**
 * Unconditionally show the element (collapsed attribute)
 *
 * @param aElement      ID of XUL element to set, or the element node itself
 */
function uncollapseElement(aElement) {
    setElementValue(aElement, false, "collapsed");
}

/**
 * Unconditionally hide the element (collapsed attribute)
 *
 * @param aElement      ID of XUL element to set, or the element node itself
 */
function collapseElement(aElement) {
    setElementValue(aElement, "true", "collapsed");
}

/**
 * Unconditionally enable the element (hidden attribute)
 *
 * @param aElement      ID of XUL element to set, or the element node itself
 */
function enableElement(aElement) {
    setElementValue(aElement, false, "disabled");
}

/**
 * Unconditionally disable the element (hidden attribute)
 *
 * @param aElement      ID of XUL element to set, or the element node itself
 */
function disableElement(aElement) {
    setElementValue(aElement, "true", "disabled");
}

/**
 * This function unconditionally disables the element for
 * which the id has been passed as argument. Furthermore, it
 * remembers who was responsible for this action by using
 * the given key (lockId). In case the control should be
 * enabled again the lock gets removed, but the control only
 * gets enabled if *all* possibly held locks have been removed.
 *
 * @param elementId     The element ID of the element to disable.
 * @param lockId        The ID of the lock to set.
 */
function disableElementWithLock(elementId, lockId) {
    // unconditionally disable the element.
    disableElement(elementId);

    // remember that this element has been locked with
    // the key passed as argument. we keep a primitive
    // form of ref-count in the attribute 'lock'.
    let element = document.getElementById(elementId);
    if (element) {
        if (!element.hasAttribute(lockId)) {
            element.setAttribute(lockId, "true");
            let n = parseInt(element.getAttribute("lock") || 0, 10);
            element.setAttribute("lock", n + 1);
        }
    }
}

/**
 * This function is intended to be used in tandem with the
 * above defined function 'disableElementWithLock()'.
 * See the respective comment for further details.
 *
 * @see disableElementWithLock
 * @param elementId     The element ID of the element to enable.
 * @param lockId        The ID of the lock to set.
 */
function enableElementWithLock(elementId, lockId) {
    let element = document.getElementById(elementId);
    if (!element) {
        dump("unable to find " + elementId + "\n");
        return;
    }

    if (element.hasAttribute(lockId)) {
        element.removeAttribute(lockId);
        let n = parseInt(element.getAttribute("lock") || 0, 10) - 1;
        if (n > 0) {
            element.setAttribute("lock", n);
        } else {
            element.removeAttribute("lock");
        }
        if (n <= 0) {
            enableElement(elementId);
        }
    }
}

/**
 * Unchecks the commands of the child elements of a DOM-tree-node i.e of a menu
 *
 * @param aEvent    The event from which the target is taken to retrieve the
 *                    child elements
 */
function uncheckChildNodes(aEvent) {
    let liveList = aEvent.target.getElementsByAttribute("checked", "true");
    for (let i = liveList.length - 1; i >= 0; i--) {
        let commandName = liveList.item(i).getAttribute("command");
        let command = document.getElementById(commandName);
        if (command) {
            command.setAttribute("checked", "false");
        }
    }
}

/**
 * Removes all child nodes of the given node
 *
 * @param aElement  The Node (or its id) to remove children from
 */
function removeChildren(aElement) {
    if (typeof aElement == "string") {
        aElement = document.getElementById(aElement);
    }

    while (aElement.firstChild) {
        aElement.lastChild.remove();
    }
}

/**
 * Sorts a sorted array of calendars by pref |calendar.list.sortOrder|.
 * Repairs that pref if dangling entries exist.
 *
 * @param calendars     An array of calendars to sort.
 */
function sortCalendarArray(calendars) {
    let ret = calendars.concat([]);
    let sortOrder = {};
    let sortOrderPref = Preferences.get("calendar.list.sortOrder", "").split(" ");
    for (let i = 0; i < sortOrderPref.length; ++i) {
        sortOrder[sortOrderPref[i]] = i;
    }
    function sortFunc(cal1, cal2) {
        let orderIdx1 = sortOrder[cal1.id] || -1;
        let orderIdx2 = sortOrder[cal2.id] || -1;
        if (orderIdx1 < orderIdx2) {
            return -1;
        }
        if (orderIdx1 > orderIdx2) {
            return 1;
        }
        return 0;
    }
    ret.sort(sortFunc);

    // check and repair pref:
    let sortOrderString = Preferences.get("calendar.list.sortOrder", "");
    let wantedOrderString = ret.map(calendar => calendar.id).join(" ");
    if (wantedOrderString != sortOrderString) {
        Preferences.set("calendar.list.sortOrder", wantedOrderString);
    }

    return ret;
}

/**
* Fills up a menu - either a menupopup or a menulist - with menuitems that refer
* to calendars.
*
* @param aItem                 The event or task
* @param aCalendarMenuParent   The direct parent of the menuitems - either a
*                                menupopup or a menulist
* @param aCalendarToUse        The default-calendar
* @param aOnCommand            A string that is applied to the "oncommand"
*                                attribute of each menuitem
* @return                      The index of the calendar that matches the
*                                default-calendar. By default 0 is returned.
*/
function appendCalendarItems(aItem, aCalendarMenuParent, aCalendarToUse, aOnCommand) {
    let calendarToUse = aCalendarToUse || aItem.calendar;
    let calendars = sortCalendarArray(cal.getCalendarManager().getCalendars({}));
    let indexToSelect = 0;
    let index = -1;
    for (let i = 0; i < calendars.length; ++i) {
        let calendar = calendars[i];
        if (calendar.id == calendarToUse.id ||
            (calendar &&
             isCalendarWritable(calendar) &&
             (userCanAddItemsToCalendar(calendar) ||
              (calendar == aItem.calendar && userCanModifyItem(aItem))) &&
             isItemSupported(aItem, calendar))) {
            let menuitem = addMenuItem(aCalendarMenuParent, calendar.name, calendar.name);
            menuitem.calendar = calendar;
            index++;
            if (aOnCommand) {
                menuitem.setAttribute("oncommand", aOnCommand);
            }
            if (aCalendarMenuParent.localName == "menupopup") {
                menuitem.setAttribute("type", "checkbox");
            }
            if (calendarToUse && calendarToUse.id == calendar.id) {
                indexToSelect = index;
            }
        }
    }
    return indexToSelect;
}

/**
 * Helper function to add a menuitem to a menulist or similar.
 *
 * @param aParent     The XUL node to add the menuitem to.
 * @param aLabel      The label string of the menuitem.
 * @param aValue      The value attribute of the menuitem.
 * @param aCommand    The oncommand attribute of the menuitem.
 * @return            The newly created menuitem
 */
function addMenuItem(aParent, aLabel, aValue, aCommand) {
    let item = null;
    if (aParent.localName == "menupopup") {
        item = createXULElement("menuitem");
        item.setAttribute("label", aLabel);
        if (aValue) {
            item.setAttribute("value", aValue);
        }
        if (aCommand) {
            item.command = aCommand;
        }
        aParent.appendChild(item);
    } else if (aParent.localName == "menulist") {
        item = aParent.appendItem(aLabel, aValue);
    }
    return item;
}

/**
 * Sets a given attribute value on the children of a passed node
 *
 * @param aParent           The parent node.
 * @param aAttribute        The name of the attribute to be set.
 * @param aValue            The value of the attribute.
 * @param aFilterAttribute  (optional) The name of an attribute that the child nodes carry
 *                            and that is used to filter the childnodes.
 * @param aFilterValue      (optional) The value of the filterattribute. If set only those
 *                            childnodes are modified that have an attribute
 *                            'aFilterAttribute' with the given value
 *                            'aFilterValue' set.
 */
function setAttributeToChildren(aParent, aAttribute, aValue, aFilterAttribute, aFilterValue) {
    for (let i = 0; i < aParent.childNodes.length; i++) {
        let element = aParent.childNodes[i];
        if (aFilterAttribute == null) {
            setElementValue(element, aValue, aAttribute);
        } else if (element.hasAttribute(aFilterAttribute)) {
            let compValue = element.getAttribute(aFilterAttribute);
            if (compValue === aFilterValue) {
                setElementValue(element, aValue, aAttribute);
            }
        }
    }
}

/**
 * Checks a radio control or a radio-menuitem.
 *
 * @param aParent  The parent node of the 'radio controls', either radios
 *                  or menuitems of the type 'radio'.
 * @param avalue   The value of the radio control bound to be checked.
 * @return         True or false depending on if the a 'radio control' with the
 *                  given value could be checked.
 */
function checkRadioControl(aParent, aValue) {
    for (let i = 0; i < aParent.childNodes.length; i++) {
        let element = aParent.childNodes[i];
        if (element.hasAttribute("value")) {
            let compValue = element.getAttribute("value");
            if (compValue == aValue) {
                if (element.localName == "menuitem") {
                    if (element.getAttribute("type") == "radio") {
                        element.setAttribute("checked", "true");
                        return true;
                    }
                } else if (element.localName == "radio") {
                    element.radioGroup.selectedItem = element;
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Enables or disables the given element depending on the checkbox state.
 *
 * @param checkboxId    The ID of the XUL checkbox element.
 * @param elementId     The element to change the disabled state on.
 */
function processEnableCheckbox(checkboxId, elementId) {
    let checked = document.getElementById(checkboxId).checked;
    setElementValue(elementId, !checked && "true", "disabled");
}

/**
 * Enable/disable button if there are children in a listbox
 *
 * XXX This function needs renaming, it can do more than just buttons.
 *
 * @param listboxId     The ID of the listbox to check.
 * @param buttonId      The element to change the disabled state on.
 */
function updateListboxDeleteButton(listboxId, buttonId) {
    let rowCount = document.getElementById(listboxId).getRowCount();
    setElementValue(buttonId, rowCount < 1 && "true", "disabled");
}

/**
 * Gets the correct plural form of a given unit.
 *
 * @param aLength         The number to use to determine the plural form
 * @param aUnit           The unit to find the plural form of
 * @param aIncludeLength  (optional) If true, the length will be included in the
 *                          result. If false, only the pluralized unit is returned.
 * @return                A string containg the pluralized version of the unit
 */
function unitPluralForm(aLength, aUnit, aIncludeLength=true) {
    let unitProp = {
        minutes: "unitMinutes",
        hours: "unitHours",
        days: "unitDays",
        weeks: "unitWeeks"
    }[aUnit] || "unitMinutes";

    return PluralForm.get(aLength, cal.calGetString("calendar", unitProp))
                     .replace("#1", aIncludeLength ? aLength : "").trim();
}

/**
 * Update the given unit label to show the correct plural form.
 *
 * @param aLengthFieldId     The ID of the element containing the number
 * @param aLabelId           The ID of the label to update.
 * @param aUnit              The unit to use for the label.
 */
function updateUnitLabelPlural(aLengthFieldId, aLabelId, aUnit) {
    let label = document.getElementById(aLabelId);
    let length = Number(document.getElementById(aLengthFieldId).value);

    label.value = unitPluralForm(length, aUnit, false);
}

/**
 * Update the given menu to show the correct plural form in the list.
 *
 * @param aLengthFieldId    The ID of the element containing the number
 * @param aMenuId           The menu to update labels in.
 */
function updateMenuLabelsPlural(aLengthFieldId, aMenuId) {
    let menu = document.getElementById(aMenuId);
    let length = Number(document.getElementById(aLengthFieldId).value);

    // update the menu items
    let items = menu.getElementsByTagName("menuitem");
    for (let menuItem of items) {
        menuItem.label = unitPluralForm(length, menuItem.value, false);
    }

    // force the menu selection to redraw
    let saveSelectedIndex = menu.selectedIndex;
    menu.selectedIndex = -1;
    menu.selectedIndex = saveSelectedIndex;
}

/**
 * Select value in menuList. Throws string if no such value.
 *
 * XXX Isn't it enough to just do menuList.value = value ?
 *
 * @param menuListId    The ID of the menulist to check.
 * @param value         The value to set.
 * @throws              String error if value not found.
 */
function menuListSelectItem(menuListId, value) {
    let menuList = document.getElementById(menuListId);
    let index = menuListIndexOf(menuList, value);
    if (index == -1) {
        throw "menuListSelectItem: No such Element: " + value;
    } else {
        menuList.selectedIndex = index;
    }
}

/**
 * Find index of menuitem with the given value, or return -1 if not found.
 *
 * @param menuListId    The XUL menulist node to check.
 * @param value         The value to look for.
 * @return              The child index of the node that matches, or -1.
 */
function menuListIndexOf(menuList, value) {
    let items = menuList.menupopup.childNodes;
    let index = -1;
    for (let i = 0; i < items.length; i++) {
        let element = items[i];
        if (element.nodeName == "menuitem") {
            index++;
        }
        if (element.getAttribute("value") == value) {
            return index;
        }
    }
    return -1; // not found
}

/**
 * Creates the given element in the XUL namespace.
 *
 * @param elem      The local name of the element to create.
 * @return          The XUL element requested.
 */
function createXULElement(elem) {
    return document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", elem);
}

/**
 * A helper function to calculate and add up certain css-values of a box.
 * It is required, that all css values can be converted to integers
 * see also
 * http://www.w3.org/TR/DOM-Level-2-Style/css.html#CSS-CSSview-getComputedStyle
 * @param aXULElement   The xul element to be inspected.
 * @param aStyleProps   The css style properties for which values are to be retrieved
 *                        e.g. 'font-size', 'min-width" etc.
 * @return              An integer value denoting the optimal minimum width
 */
function getSummarizedStyleValues(aXULElement, aStyleProps) {
    let retValue = 0;
    let cssStyleDeclares = document.defaultView.getComputedStyle(aXULElement, null);
    for (let prop of aStyleProps) {
        retValue += parseInt(cssStyleDeclares.getPropertyValue(prop), 10);
    }
    return retValue;
}

/**
 * Calculates the optimal minimum width based on the set css style-rules
 * by considering the css rules for the min-width, padding, border, margin
 * and border of the box.
 *
 * @param aXULElement   The xul element to be inspected.
 * @return              An integer value denoting the optimal minimum width
 */
function getOptimalMinimumWidth(aXULElement) {
    return getSummarizedStyleValues(aXULElement, ["min-width",
                                                  "padding-left", "padding-right",
                                                  "margin-left", "margin-top",
                                                  "border-left-width", "border-right-width"]);
}

/**
 * Calculates the optimal minimum height based on the set css style-rules
 * by considering the css rules for the font-size, padding, border, margin
 * and border of the box. In its current state the line-height is considered
 * by assuming that it's size is about one third of the size of the font-size
 *
 * @param aXULElement   The xul-element to be inspected.
 * @return              An integer value denoting the optimal minimum height
 */
function getOptimalMinimumHeight(aXULElement) {
    // the following line of code presumes that the line-height is set to "normal"
    // which is supposed to be a "reasonable distance" between the lines
    let firstEntity = parseInt(1.35 * getSummarizedStyleValues(aXULElement, ["font-size"]), 10);
    let secondEntity = getSummarizedStyleValues(aXULElement,
                                                ["padding-bottom", "padding-top",
                                                "margin-bottom", "margin-top",
                                                "border-bottom-width", "border-top-width"]);
    return (firstEntity + secondEntity);
}

/**
 * Gets the "other" orientation value, i.e if "horizontal" is passed, "vertical"
 * is returned and vice versa.
 *
 * @param aOrientation    The orientation value to turn around.
 * @return                The opposite orientation value.
 */
function getOtherOrientation(aOrientation) {
    return (aOrientation == "horizontal" ? "vertical" : "horizontal");
}

/**
 * Setting labels on a menuitem doesn't update the label that is shown when the
 * menuitem is selected. This function takes care by reselecting the item
 *
 * @param aElement  The element to update, or its id as a string
 */
function updateSelectedLabel(aElement) {
    if (typeof aElement == "string") {
        aElement = document.getElementById(aElement);
    }
    let selectedIndex = aElement.selectedIndex;
    aElement.selectedIndex = -1;
    aElement.selectedIndex = selectedIndex;
}

/**
 * Sets up the attendance context menu, based on the given items
 *
 * @param aMenu     The DOM Node of the menupopup to set up
 * @param aItems    The array of items to consider
 */
function setupAttendanceMenu(aMenu, aItems) {
    function getInvStat(item) {
        let attendee = null;
        if (cal.isInvitation(item)) {
            attendee = cal.getInvitedAttendee(item);
        } else if (item.organizer) {
            let calOrgId = item.calendar.getProperty("organizerId");
            if (calOrgId == item.organizer.id && item.getAttendees({}).length) {
                attendee = item.organizer;
            }
        }
        return attendee && attendee.participationStatus;
    }

    goUpdateCommand("calendar_attendance_command");

    let allSingle = aItems.every(x => !x.recurrenceId);
    setElementValue(aMenu, allSingle ? "single" : "recurring", "itemType");

    let firstStatusOccurrences = aItems.length && getInvStat(aItems[0]);
    let firstStatusParents = aItems.length && getInvStat(aItems[0].parentItem);
    let sameStatusOccurrences = aItems.every(x => getInvStat(x) == firstStatusOccurrences);
    let sameStatusParents = aItems.every(x => getInvStat(x.parentItem) == firstStatusParents);

    let occurrenceChildren = aMenu.getElementsByAttribute("value", firstStatusOccurrences);
    let parentsChildren = aMenu.getElementsByAttribute("value", firstStatusParents);

    if (sameStatusOccurrences && occurrenceChildren[0]) {
        occurrenceChildren[0].setAttribute("checked", "true");
    }

    if (sameStatusParents && parentsChildren[1]) {
        parentsChildren[1].setAttribute("checked", "true");
    }

    return true;
}
