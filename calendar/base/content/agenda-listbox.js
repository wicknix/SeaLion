/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function Synthetic(aOpen, aDuration, aMultiday) {
    this.open = aOpen;
    this.duration = aDuration;
    this.multiday = aMultiday;
}

var agendaListbox = {
    agendaListboxControl: null,
    mPendingRefreshJobs: null,
    kDefaultTimezone: null,
    showsToday: false,
    soonDays: 5
};

/**
 * Initialize the agenda listbox, used on window load.
 */
agendaListbox.init = function() {
    this.agendaListboxControl = document.getElementById("agenda-listbox");
    this.agendaListboxControl.removeAttribute("suppressonselect");
    let showTodayHeader = (document.getElementById("today-header-hidden").getAttribute("checked") == "true");
    let showTomorrowHeader = (document.getElementById("tomorrow-header-hidden").getAttribute("checked") == "true");
    let showSoonHeader = (document.getElementById("nextweek-header-hidden").getAttribute("checked") == "true");
    this.today = new Synthetic(showTodayHeader, 1, false);
    this.addPeriodListItem(this.today, "today-header");
    this.tomorrow = new Synthetic(showTomorrowHeader, 1, false);
    this.soonDays = getSoondaysPreference();
    this.soon = new Synthetic(showSoonHeader, this.soonDays, true);
    this.periods = [this.today, this.tomorrow, this.soon];
    this.mPendingRefreshJobs = new Map();

    let prefObserver = {
        observe: function(aSubject, aTopic, aPrefName) {
            switch (aPrefName) {
                case "calendar.agendaListbox.soondays":
                    agendaListbox.soonDays = getSoondaysPreference();
                    agendaListbox.updateSoonSection();
                    break;
            }
        }
    };
    Services.prefs.addObserver("calendar.agendaListbox", prefObserver, false);

    // Make sure the agenda listbox is unloaded
    window.addEventListener("unload", () => {
        Services.prefs.removeObserver("calendar.agendaListbox", prefObserver);
        this.uninit();
    }, false);
};

/**
 * Clean up the agenda listbox, used on window unload.
 */
agendaListbox.uninit = function() {
    if (this.calendar) {
        this.calendar.removeObserver(this.calendarObserver);
    }

    for (let period of this.periods) {
        if (period.listItem) {
            period.listItem.getCheckbox()
                  .removeEventListener("CheckboxStateChange",
                                       this.onCheckboxChange,
                                       true);
        }
    }
};

/**
 * Adds a period item to the listbox. This is a section of the today pane like
 * "Today", "Tomorrow", and is usually a <agenda-checkbox-richlist-item> tag. A
 * copy of the template node is made and added to the agenda listbox.
 *
 * @param aPeriod       The period item to add.
 * @param aItemId       The id of an <agenda-checkbox-richlist-item> to add to,
 *                        without the "-hidden" suffix.
 */
agendaListbox.addPeriodListItem = function(aPeriod, aItemId) {
    aPeriod.listItem = document.getElementById(aItemId + "-hidden").cloneNode(true);
    agendaListbox.agendaListboxControl.appendChild(aPeriod.listItem);
    aPeriod.listItem.id = aItemId;
    aPeriod.listItem.getCheckbox().setChecked(aPeriod.open);
    aPeriod.listItem.getCheckbox().addEventListener("CheckboxStateChange", this.onCheckboxChange, true);
};

/**
 * Remove a period item from the agenda listbox.
 * @see agendaListbox::addPeriodListItem
 */
agendaListbox.removePeriodListItem = function(aPeriod) {
    if (aPeriod.listItem) {
        aPeriod.listItem.getCheckbox().removeEventListener("CheckboxStateChange", this.onCheckboxChange, true);
        if (aPeriod.listItem) {
            aPeriod.listItem.remove();
            aPeriod.listItem = null;
        }
    }
};

/**
 * Handler function called when changing the checkbox state on period items.
 *
 * @param event     The DOM event that triggered the checkbox state change.
 */
agendaListbox.onCheckboxChange = function(event) {
    let periodCheckbox = event.target;
    let lopen = (periodCheckbox.getAttribute("checked") == "true");
    let listItem = getParentNodeOrThis(periodCheckbox, "agenda-checkbox-richlist-item");
    let period = listItem.getItem();
    period.open = lopen;
    // as the agenda-checkboxes are only transient we have to set the "checked"
    // attribute at their hidden origins to make that attribute persistent.
    document.getElementById(listItem.id + "-hidden").setAttribute("checked",
                            periodCheckbox.getAttribute("checked"));
    if (lopen) {
        agendaListbox.refreshCalendarQuery(period.start, period.end);
    } else {
        listItem = listItem.nextSibling;
        let leaveloop;
        do {
            leaveloop = (listItem == null);
            if (!leaveloop) {
                let nextItemSibling = listItem.nextSibling;
                leaveloop = !agendaListbox.isEventListItem(listItem);
                if (!leaveloop) {
                    listItem.remove();
                    listItem = nextItemSibling;
                }
            }
        } while (!leaveloop);
    }
    calendarController.onSelectionChanged({ detail: [] });
};

/**
 * Handler function called when an agenda listbox item is selected
 *
 * @param aListItem     The agenda-base-richlist-item that was selected.
 */
agendaListbox.onSelect = function(aListItem) {
    let listbox = document.getElementById("agenda-listbox");
    let item = aListItem || listbox.selectedItem;
    if (aListItem) {
        listbox.selectedItem = item;
    }
    calendarController.onSelectionChanged({ detail: agendaListbox.getSelectedItems() });
};

/**
 * Handler function called when the agenda listbox becomes focused
 */
agendaListbox.onFocus = function() {
    calendarController.onSelectionChanged({ detail: agendaListbox.getSelectedItems() });
};

/**
 * Handler function called when the agenda listbox loses focus.
 */
agendaListbox.onBlur = function() {
    calendarController.onSelectionChanged({ detail: [] });
};


/**
 * Handler function called when a key was pressed on the agenda listbox
 */
agendaListbox.onKeyPress = function(aEvent) {
    let listItem = aEvent.target;
    if (listItem.localName == "richlistbox") {
        listItem = listItem.selectedItem;
    }
    switch (aEvent.keyCode) {
        case aEvent.DOM_VK_RETURN:
            document.getElementById("agenda_edit_event_command").doCommand();
            break;
        case aEvent.DOM_VK_DELETE:
            document.getElementById("agenda_delete_event_command").doCommand();
            aEvent.stopPropagation();
            aEvent.preventDefault();
            break;
        case aEvent.DOM_VK_LEFT:
            if (!this.isEventListItem(listItem)) {
                listItem.getCheckbox().setChecked(false);
            }
            break;
        case aEvent.DOM_VK_RIGHT:
            if (!this.isEventListItem(listItem)) {
                listItem.getCheckbox().setChecked(true);
            }
            break;
    }
};

/**
 * Calls the event dialog to edit the currently selected item
 */
agendaListbox.editSelectedItem = function() {
    let listItem = document.getElementById("agenda-listbox").selectedItem;
    if (listItem) {
        modifyEventWithDialog(listItem.occurrence, null, true);
    }
};

/**
 * Finds the appropriate period for the given item, i.e finds "Tomorrow" if the
 * item occurrs tomorrow.
 *
 * @param aItem     The item to find the period for.
 */
agendaListbox.findPeriodsForItem = function(aItem) {
    let retPeriods = [];
    for (let i = 0; i < this.periods.length; i++) {
        if (this.periods[i].open) {
            if (checkIfInRange(aItem, this.periods[i].start, this.periods[i].end)) {
                retPeriods.push(this.periods[i]);
            }
        }
    }
    return retPeriods;
};

/**
 * Gets the start of the earliest period shown in the agenda listbox
 */
agendaListbox.getStart = function() {
    let retStart = null;
    for (let i = 0; i < this.periods.length; i++) {
        if (this.periods[i].open) {
            retStart = this.periods[i].start;
            break;
        }
    }
    return retStart;
};

/**
 * Gets the end of the latest period shown in the agenda listbox
 */
agendaListbox.getEnd = function() {
    let retEnd = null;
    for (let i = this.periods.length - 1; i >= 0; i--) {
        if (this.periods[i].open) {
            retEnd = this.periods[i].end;
            break;
        }
    }
    return retEnd;
};

/**
 * Adds an item to an agenda period before another existing item.
 *
 * @param aNewItem      The calIItemBase to add.
 * @param aAgendaItem   The existing item to insert before.
 * @param aPeriod       The period to add the item to.
 * @param visible       If true, the item should be visible.
 * @return              The newly created XUL element.
 */
agendaListbox.addItemBefore = function(aNewItem, aAgendaItem, aPeriod, visible) {
    let newelement = null;
    if (aNewItem.startDate.isDate) {
        newelement = createXULElement("agenda-allday-richlist-item");
    } else {
        newelement = createXULElement("agenda-richlist-item");
    }
    // set the item at the richlistItem. When the duration of the period
    // is bigger than 1 (day) the starttime of the item has to include
    // information about the day of the item
    if (aAgendaItem == null) {
        this.agendaListboxControl.appendChild(newelement);
    } else {
        this.agendaListboxControl.insertBefore(newelement, aAgendaItem);
    }
    newelement.setOccurrence(aNewItem, aPeriod);
    newelement.removeAttribute("selected");
    return newelement;
};

/**
 * Adds an item to the agenda listbox. This function finds the correct period
 * for the item and inserts it correctly so the period stays sorted.
 *
 * @param aItem         The calIItemBase to add.
 * @return              The newly created XUL element.
 */
agendaListbox.addItem = function(aItem) {
    if (!isEvent(aItem)) {
        return null;
    }
    let periods = this.findPeriodsForItem(aItem);
    if (periods.length == 0) {
        return null;
    }
    let newlistItem = null;
    for (let i = 0; i < periods.length; i++) {
        let period = periods[i];
        let complistItem = period.listItem;
        let visible = complistItem.getCheckbox().checked;
        if (aItem.startDate.isDate && period.duration == 1 && aItem.duration.days == 1) {
            if (this.getListItems(aItem, period).length == 0) {
                this.addItemBefore(aItem, period.listItem.nextSibling, period, visible);
            }
        } else {
            do {
                complistItem = complistItem.nextSibling;
                if (this.isEventListItem(complistItem)) {
                    let compitem = complistItem.occurrence;
                    if (this.isSameEvent(aItem, compitem)) {
                        // The same event occurs on several calendars but we only
                        // display the first one.
                        // TODO: find a way to display this special circumstance
                        break;
                    } else if (this.isBefore(aItem, compitem, period)) {
                        if (this.isSameEvent(aItem, compitem)) {
                            newlistItem = this.addItemBefore(aItem, complistItem, period, visible);
                            break;
                        } else {
                            newlistItem = this.addItemBefore(aItem, complistItem, period, visible);
                            break;
                        }
                    }
                } else {
                    newlistItem = this.addItemBefore(aItem, complistItem, period, visible);
                    break;
                }
            } while (complistItem);
        }
    }
    return newlistItem;
};

/**
 * Checks if the given item happens before the comparison item.
 *
 * @param aItem         The item to compare.
 * @param aCompItem     The item to compare with.
 * @param aPeriod       The period where the items are inserted.
 * @return              True, if the aItem happens before aCompItem.
 */
agendaListbox.isBefore = function(aItem, aCompItem, aPeriod) {
    let itemDate = this.comparisonDate(aItem, aPeriod);
    let compItemDate = this.comparisonDate(aCompItem, aPeriod);
    let itemDateEndDate = itemDate.clone();
    itemDateEndDate.day++;

    if (compItemDate.day == itemDate.day) {
        // In the same day the order is:
        // - all-day events (single day);
        // - all-day events spanning multiple days: start, end, intermediate;
        // - events and events spanning multiple days: start, end, (sorted by
        //   time) and intermediate.
        if (itemDate.isDate && aItem.duration.days == 1) {
            // all-day events with duration one day
            return true;
        } else if (itemDate.isDate) {
            if (aItem.startDate.compare(itemDate) == 0) {
                // starting day of an all-day events spannig multiple days
                return !compItemDate.isDate || aCompItem.duration.days != 1;
            } else if (aItem.endDate.compare(itemDateEndDate) == 0) {
                // ending day of an all-day events spannig multiple days
                return !compItemDate.isDate ||
                       (aCompItem.duration.days != 1 &&
                        aCompItem.startDate.compare(compItemDate) != 0);
            } else {
                // intermediate day of an all-day events spannig multiple days
                return !compItemDate.isDate;
            }
        } else if (aCompItem.startDate.isDate) {
            return false;
        }
    }
    // Non all-day event sorted by date-time. When equal, sorted by start
    // date-time then by end date-time.
    let comp = itemDate.compare(compItemDate);
    if (comp == 0) {
        comp = aItem.startDate.compare(aCompItem.startDate);
        if (comp == 0) {
            comp = aItem.endDate.compare(aCompItem.endDate);
        }
    }
    return (comp <= 0);
};

/**
 * Returns the start or end date of an item according to which of them
 * must be displayed in a given period of the agenda
 *
 * @param aItem         The item to compare.
 * @param aPeriod       The period where the item is inserted.
 * @return              The start or end date of the item showed in the agenda.
 */
agendaListbox.comparisonDate = function(aItem, aPeriod) {
    let periodStartDate = aPeriod.start.clone();
    periodStartDate.isDate = true;
    let periodEndDate = aPeriod.end.clone();
    periodEndDate.day--;
    let startDate = aItem.startDate.clone();
    startDate.isDate = true;
    let endDate = aItem.endDate.clone();

    let endDateToReturn = aItem.endDate.clone();
    if (aItem.startDate.isDate && aPeriod.duration == 1) {
        endDateToReturn = periodEndDate.clone();
    } else if (endDate.isDate) {
        endDateToReturn.day--;
    } else if (endDate.hour == 0 && endDate.minute == 0) {
        // End at midnight -> end date in the day where midnight occurs
        endDateToReturn.day--;
        endDateToReturn.hour = 23;
        endDateToReturn.minute = 59;
        endDateToReturn.second = 59;
    }
    endDate.isDate = true;
    if (startDate.compare(endDate) != 0 &&
         startDate.compare(periodStartDate) < 0) {
        // returns a end date when the item is a multiday event AND
        // it starts before the given period
        return endDateToReturn;
    }
    return aItem.startDate.clone();
};

/**
 * Gets the listitems for a given item, possibly in a given period.
 *
 * @param aItem         The item to get the list items for.
 * @param aPeriod       (optional) the period to search in.
 * @return              An array of list items for the given item.
 */
agendaListbox.getListItems = function(aItem, aPeriod) {
    let retlistItems = [];
    let periods = [aPeriod];
    if (!aPeriod) {
        periods = this.findPeriodsForItem(aItem);
    }
    if (periods.length > 0) {
        for (let i = 0; i < periods.length; i++) {
            let period = periods[i];
            let complistItem = period.listItem;
            let leaveloop;
            do {
                complistItem = complistItem.nextSibling;
                leaveloop = !this.isEventListItem(complistItem);
                if (!leaveloop) {
                    if (this.isSameEvent(aItem, complistItem.occurrence)) {
                        retlistItems.push(complistItem);
                        break;
                    }
                }
            } while (!leaveloop);
        }
    }
    return retlistItems;
};

/**
 * Removes the given item from the agenda listbox
 *
 * @param aItem             The item to remove.
 * @param aMoveSelection    If true, the selection will be moved to the next
 *                            sibling that is not an period item.
 * @return                  Returns true if the removed item was selected.
 */
agendaListbox.deleteItem = function(aItem, aMoveSelection) {
    let isSelected = false;
    let listItems = this.getListItems(aItem);
    if (listItems.length > 0) {
        for (let i = listItems.length - 1; i >= 0; i--) {
            let listItem = listItems[i];
            let isSelected2 = listItem.selected;
            if (isSelected2 && !isSelected) {
                isSelected = true;
                if (aMoveSelection) {
                    this.moveSelection();
                }
            }
            listItem.remove();
        }
    }
    return isSelected;
};

/**
 * Remove all items belonging to the specified calendar.
 *
 * @param aCalendar         The item to compare.
 */
agendaListbox.deleteItemsFromCalendar = function(aCalendar) {
    let childNodes = Array.from(this.agendaListboxControl.childNodes);
    for (let childNode of childNodes) {
        if (childNode && childNode.occurrence &&
            childNode.occurrence.calendar.id == aCalendar.id) {
            childNode.remove();
        }
    }
};

/**
 * Compares two items to see if they have the same id and their start date
 * matches
 *
 * @param aItem         The item to compare.
 * @param aCompItem     The item to compare with.
 * @return              True, if the items match with the above noted criteria.
 */
agendaListbox.isSameEvent = function(aItem, aCompItem) {
    return aItem.id == aCompItem.id &&
           aItem[calGetStartDateProp(aItem)].compare(aCompItem[calGetStartDateProp(aCompItem)]) == 0;
};

/**
 * Checks if the currently selected node in the listbox is an Event item (not a
 * period item).
 *
 * @return              True, if the node is not a period item.
 */
agendaListbox.isEventSelected = function() {
    let listItem = this.agendaListboxControl.selectedItem;
    if (listItem) {
        return this.isEventListItem(listItem);
    }
    return false;
};

/**
 * Delete the selected item from its calendar (if it is an event item)
 *
 * @param aDoNotConfirm     If true, the user will not be prompted.
 */
agendaListbox.deleteSelectedItem = function(aDoNotConfirm) {
    let listItem = this.agendaListboxControl.selectedItem;
    if (this.isEventListItem(listItem)) {
        let selectedItems = [listItem.occurrence];
        calendarViewController.deleteOccurrences(selectedItems.length,
                                                 selectedItems,
                                                 false,
                                                 aDoNotConfirm);
    }
};

/**
 * If a Period item is targeted by the passed DOM event, opens the event dialog
 * with the period's start date prefilled.
 *
 * @param aEvent            The DOM event that targets the period.
 */
agendaListbox.createNewEvent = function(aEvent) {
    if (!this.isEventListItem(aEvent.target)) {
        // Create new event for the date currently displayed in the agenda. Setting
        // isDate = true automatically makes the start time be the next full hour.
        let eventStart = agendaListbox.today.start.clone();
        eventStart.isDate = true;
        if (calendarController.isCommandEnabled("calendar_new_event_command")) {
            createEventWithDialog(getSelectedCalendar(), eventStart);
        }
    }
};

/**
 * Sets up the context menu for the agenda listbox
 *
 * @param popup         The <menupopup> element to set up.
 */
agendaListbox.setupContextMenu = function(popup) {
    let listItem = this.agendaListboxControl.selectedItem;
    let enabled = this.isEventListItem(listItem);
    let menuitems = popup.childNodes;
    for (let i = 0; i < menuitems.length; i++) {
        setBooleanAttribute(menuitems[i], "disabled", !enabled);
    }

    let menu = document.getElementById("calendar-today-pane-menu-attendance-menu");
    setupAttendanceMenu(menu, agendaListbox.getSelectedItems({}));
};


/**
 * Refreshes the agenda listbox. If aStart or aEnd is not passed, the agenda
 * listbox's limiting dates will be used.
 *
 * @param aStart        (optional) The start date for the item query.
 * @param aEnd          (optional) The end date for the item query.
 * @param aCalendar     (optional) If specified, the single calendar from
 *                                   which the refresh will occur.
 */
agendaListbox.refreshCalendarQuery = function(aStart, aEnd, aCalendar) {
    let refreshJob = {
        QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
        agendaListbox: this,
        calendar: null,
        calId: null,
        operation: null,
        cancelled: false,

        onOperationComplete: function(aOpCalendar, aStatus, aOperationType, aId, aDateTime) {
            if (this.agendaListbox.mPendingRefreshJobs.has(this.calId)) {
                this.agendaListbox.mPendingRefreshJobs.delete(this.calId);
            }

            if (!this.cancelled) {
                setCurrentEvent();
            }
        },

        onGetResult: function(aOpCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
            if (this.cancelled || !Components.isSuccessCode(aStatus)) {
                return;
            }
            for (let item of aItems) {
                this.agendaListbox.addItem(item);
            }
        },

        cancel: function() {
            this.cancelled = true;
            let operation = cal.wrapInstance(this.operation, Components.interfaces.calIOperation);
            if (operation && operation.isPending) {
                operation.cancel();
                this.operation = null;
            }
        },

        execute: function() {
            if (!(aStart || aEnd || aCalendar)) {
                this.agendaListbox.removeListItems();
            }

            if (!aCalendar) {
                aCalendar = this.agendaListbox.calendar;
            }
            if (!aStart) {
                aStart = this.agendaListbox.getStart();
            }
            if (!aEnd) {
                aEnd = this.agendaListbox.getEnd();
            }
            if (!(aStart || aEnd || aCalendar)) {
                return;
            }

            if (aCalendar.type == "composite") {
                // we're refreshing from the composite calendar, so we can cancel
                // all other pending refresh jobs.
                this.calId = "composite";
                for (let job of this.agendaListbox.mPendingRefreshJobs.values()) {
                    job.cancel();
                }
                this.agendaListbox.mPendingRefreshJobs.clear();
            } else {
                this.calId = aCalendar.id;
                if (this.agendaListbox.mPendingRefreshJobs.has(this.calId)) {
                    this.agendaListbox.mPendingRefreshJobs.get(this.calId).cancel();
                    this.agendaListbox.mPendingRefreshJobs.delete(this.calId);
                }
            }
            this.calendar = aCalendar;

            let filter = this.calendar.ITEM_FILTER_CLASS_OCCURRENCES |
                         this.calendar.ITEM_FILTER_TYPE_EVENT;
            let operation = this.calendar.getItems(filter, 0, aStart, aEnd, this);
            operation = cal.wrapInstance(operation, Components.interfaces.calIOperation);
            if (operation && operation.isPending) {
                this.operation = operation;
                this.agendaListbox.mPendingRefreshJobs.set(this.calId, this);
            }
        }
    };

    refreshJob.execute();
};

/**
 * Sets up the calendar for the agenda listbox.
 */
agendaListbox.setupCalendar = function() {
    this.init();
    if (this.calendar == null) {
        this.calendar = getCompositeCalendar();
    }
    if (this.calendar) {
        // XXX This always gets called, does that happen on purpose?
        this.calendar.removeObserver(this.calendarObserver);
    }
    this.calendar.addObserver(this.calendarObserver);
    if (this.mListener) {
        this.mListener.updatePeriod();
    }
};

/**
 * Refreshes the period dates, especially when a period is showing "today".
 * Usually called at midnight to update the agenda pane. Also retrieves the
 * items from the calendar.
 *
 * @see #refreshCalendarQuery
 * @param newDate       The first date to show if the agenda pane doesn't show
 *                        today.
 */
agendaListbox.refreshPeriodDates = function(newDate) {
    this.kDefaultTimezone = calendarDefaultTimezone();
    // Today: now until midnight of tonight
    let oldshowstoday = this.showstoday;
    this.showstoday = this.showsToday(newDate);
    if ((this.showstoday) && (!oldshowstoday)) {
        this.addPeriodListItem(this.tomorrow, "tomorrow-header");
        this.addPeriodListItem(this.soon, "nextweek-header");
    } else if (!this.showstoday) {
        this.removePeriodListItem(this.tomorrow);
        this.removePeriodListItem(this.soon);
    }
    newDate.isDate = true;
    for (let i = 0; i < this.periods.length; i++) {
        let curPeriod = this.periods[i];
        newDate.hour = newDate.minute = newDate.second = 0;
        if (i == 0 && this.showstoday) {
            curPeriod.start = now();
        } else {
            curPeriod.start = newDate.clone();
        }
        newDate.day += curPeriod.duration;
        curPeriod.end = newDate.clone();
        curPeriod.listItem.setItem(curPeriod, this.showstoday);
    }
    this.refreshCalendarQuery();
};

/**
 * Adds a listener to this agenda listbox.
 *
 * @param aListener     The listener to add.
 */
agendaListbox.addListener = function(aListener) {
    this.mListener = aListener;
};

/**
 * Checks if the agenda listbox is showing "today". Without arguments, this
 * function assumes the today attribute of the agenda listbox.
 *
 * @param aStartDate    (optional) The day to check if its "today".
 * @return              Returns true if today is shown.
 */
agendaListbox.showsToday = function(aStartDate) {
    let lstart = aStartDate;
    if (!lstart) {
        lstart = this.today.start;
    }
    let lshowsToday = sameDay(now(), lstart);
    if (lshowsToday) {
        this.periods = [this.today, this.tomorrow, this.soon];
    } else {
        this.periods = [this.today];
    }
    return lshowsToday;
};

/**
 * Moves the selection. Moves down unless the next item is a period item, in
 * which case the selection moves up.
 */
agendaListbox.moveSelection = function() {
    if (this.isEventListItem(this.agendaListboxControl.selectedItem.nextSibling)) {
        this.agendaListboxControl.goDown();
    } else {
        this.agendaListboxControl.goUp();
    }
};

/**
 * Gets an array of selected items. If a period node is selected, it is not
 * included.
 *
 * @return      An array with all selected items.
 */
agendaListbox.getSelectedItems = function() {
    let items = [];
    if (this.isEventListItem(this.agendaListboxControl.selectedItem)) {
        // If at some point we support selecting multiple items, this array can
        // be expanded.
        items = [this.agendaListboxControl.selectedItem.occurrence];
    }
    return items;
};

/**
 * Checks if the passed node in the listbox is an Event item (not a
 * period item).
 *
 * @param aListItem     The node to check for.
 * @return              True, if the node is not a period item.
 */
agendaListbox.isEventListItem = function(aListItem) {
    let isListItem = (aListItem != null);
    if (isListItem) {
        let localName = aListItem.localName;
        isListItem = (localName == "agenda-richlist-item" ||
                      localName == "agenda-allday-richlist-item");
    }
    return isListItem;
};

/**
 * Removes all Event items, keeping the period items intact.
 */
agendaListbox.removeListItems = function() {
    let listItem = this.agendaListboxControl.lastChild;
    if (listItem) {
        let leaveloop = false;
        do {
            let newlistItem = null;
            if (listItem) {
                newlistItem = listItem.previousSibling;
            } else {
                leaveloop = true;
            }
            if (this.isEventListItem(listItem)) {
                if (listItem == this.agendaListboxControl.firstChild) {
                    leaveloop = true;
                } else {
                    listItem.remove();
                }
            }
            listItem = newlistItem;
        } while (!leaveloop);
    }
};

/**
 * Gets the list item node by its associated event's hashId.
 *
 * @return The XUL node if successful, otherwise null.
 */
agendaListbox.getListItemByHashId = function(ahashId) {
    let listItem = this.agendaListboxControl.firstChild;
    let leaveloop = false;
    do {
        if (this.isEventListItem(listItem)) {
            if (listItem.occurrence.hashId == ahashId) {
                return listItem;
            }
        }
        listItem = listItem.nextSibling;
        leaveloop = (listItem == null);
    } while (!leaveloop);
    return null;
};

/**
 * The operation listener used for calendar queries.
 * Implements calIOperationListener.
 */
agendaListbox.calendarOpListener = { agendaListbox: agendaListbox };

/**
 * Calendar and composite observer, used to keep agenda listbox up to date.
 * @see calIObserver
 * @see calICompositeObserver
 */
agendaListbox.calendarObserver = { agendaListbox: agendaListbox };

agendaListbox.calendarObserver.QueryInterface = function(aIID) {
    if (!aIID.equals(Components.interfaces.calIObserver) &&
        !aIID.equals(Components.interfaces.calICompositeObserver) &&
        !aIID.equals(Components.interfaces.nsISupports)) {
        throw Components.results.NS_ERROR_NO_INTERFACE;
    }
    return this;
};

// calIObserver:
agendaListbox.calendarObserver.onStartBatch = function() {
};

agendaListbox.calendarObserver.onEndBatch = function() {
};

agendaListbox.calendarObserver.onLoad = function() {
    this.agendaListbox.refreshCalendarQuery();
};

agendaListbox.calendarObserver.onAddItem = function(item) {
    if (!isEvent(item)) {
        return;
    }
    // get all sub items if it is a recurring item
    let occs = this.getOccurrencesBetween(item);
    occs.forEach(this.agendaListbox.addItem, this.agendaListbox);
    setCurrentEvent();
};

agendaListbox.calendarObserver.getOccurrencesBetween = function(aItem) {
    let occs = [];
    let start = this.agendaListbox.getStart();
    let end = this.agendaListbox.getEnd();
    if (start && end) {
        occs = aItem.getOccurrencesBetween(start, end, {});
    }
    return occs;
};

agendaListbox.calendarObserver.onDeleteItem = function(item, rebuildFlag) {
    this.onLocalDeleteItem(item, true);
};

agendaListbox.calendarObserver.onLocalDeleteItem = function(item, moveSelection) {
    if (!isEvent(item)) {
        return false;
    }
    let selectedItemHashId = -1;
    // get all sub items if it is a recurring item
    let occs = this.getOccurrencesBetween(item);
    for (let i = 0; i < occs.length; i++) {
        let isSelected = this.agendaListbox.deleteItem(occs[i], moveSelection);
        if (isSelected) {
            selectedItemHashId = occs[i].hashId;
        }
    }
    return selectedItemHashId;
};

agendaListbox.calendarObserver.onModifyItem = function(newItem, oldItem) {
    let selectedItemHashId = this.onLocalDeleteItem(oldItem, false);
    if (!isEvent(newItem)) {
        return;
    }
    this.onAddItem(newItem);
    if (selectedItemHashId != -1) {
        let listItem = agendaListbox.getListItemByHashId(selectedItemHashId);
        if (listItem) {
            agendaListbox.agendaListboxControl.clearSelection();
            agendaListbox.agendaListboxControl.ensureElementIsVisible(listItem);
            agendaListbox.agendaListboxControl.selectedItem = listItem;
        }
    }
    setCurrentEvent();
};

agendaListbox.calendarObserver.onError = function(cal, errno, msg) {};

agendaListbox.calendarObserver.onPropertyChanged = function(aCalendar, aName, aValue, aOldValue) {
    switch (aName) {
        case "disabled":
            this.agendaListbox.refreshCalendarQuery();
            break;
        case "color":
            for (let node = agendaListbox.agendaListboxControl.firstChild;
                 node;
                 node = node.nextSibling) {
                // Change color on all nodes that don't do so themselves, which
                // is currently only he agenda-richlist-item
                if (node.localName != "agenda-richlist-item") {
                    continue;
                }
                node.refreshColor();
            }
            break;
    }
};

agendaListbox.calendarObserver.onPropertyDeleting = function(aCalendar, aName) {
    this.onPropertyChanged(aCalendar, aName, null, null);
};


agendaListbox.calendarObserver.onCalendarRemoved = function(aCalendar) {
    if (!aCalendar.getProperty("disabled")) {
        this.agendaListbox.deleteItemsFromCalendar(aCalendar);
    }
};

agendaListbox.calendarObserver.onCalendarAdded = function(aCalendar) {
    if (!aCalendar.getProperty("disabled")) {
        this.agendaListbox.refreshCalendarQuery(null, null, aCalendar);
    }
};

agendaListbox.calendarObserver.onDefaultCalendarChanged = function(aCalendar) {
};

/**
 * Updates the "Upcoming" section of today pane when preference soondays changes
 **/
agendaListbox.updateSoonSection = function() {
    this.soon.duration = this.soonDays;
    this.soon.open = true;
    let soonHeader = document.getElementById("nextweek-header");
    if (soonHeader) {
        soonHeader.setItem(this.soon, true);
        agendaListbox.refreshPeriodDates(now());
    }
};

/**
 * Updates the event considered "current". This goes through all "today" items
 * and sets the "current" attribute on all list items that are currently
 * occurring.
 *
 * @see scheduleNextCurrentEventUpdate
 */
function setCurrentEvent() {
    if (!agendaListbox.showsToday() || !agendaListbox.today.open) {
        return;
    }

    let msScheduleTime = -1;
    let complistItem = agendaListbox.tomorrow.listItem.previousSibling;
    let removelist = [];
    let anow = now();
    let msuntillend = 0;
    let msuntillstart = 0;
    let leaveloop;
    do {
        leaveloop = !agendaListbox.isEventListItem(complistItem);
        if (!leaveloop) {
            msuntillstart = complistItem.occurrence.startDate
                                        .getInTimezone(agendaListbox.kDefaultTimezone)
                                        .subtractDate(anow).inSeconds;
            if (msuntillstart <= 0) {
                msuntillend = complistItem.occurrence.endDate
                                          .getInTimezone(agendaListbox.kDefaultTimezone)
                                          .subtractDate(anow).inSeconds;
                if (msuntillend > 0) {
                    complistItem.setAttribute("current", "true");
                    if (msuntillend < msScheduleTime || msScheduleTime == -1) {
                        msScheduleTime = msuntillend;
                    }
                } else {
                    removelist.push(complistItem);
                }
            } else {
                complistItem.removeAttribute("current");
            }
            if (msScheduleTime == -1 || msuntillstart < msScheduleTime) {
                if (msuntillstart > 0) {
                    msScheduleTime = msuntillstart;
                }
            }
        }
        if (!leaveloop) {
            complistItem = complistItem.previousSibling;
        }
    } while (!leaveloop);

    if (msScheduleTime > -1) {
        scheduleNextCurrentEventUpdate(setCurrentEvent, msScheduleTime * 1000);
    }

    if (removelist) {
        if (removelist.length > 0) {
            for (let i = 0; i < removelist.length; i++) {
                removelist[i].remove();
            }
        }
    }
}

var gEventTimer;

/**
 * Creates a timer that will fire after the next event is current.
 *  Pass in a function as aRefreshCallback that should be called at that time.
 *
 * @param aRefreshCallback      The function to call when the next event is
 *                                current.
 * @param aMsUntil              The number of milliseconds until the next event
 *                                is current.
 */
function scheduleNextCurrentEventUpdate(aRefreshCallback, aMsUntil) {
    // Is an nsITimer/callback extreme overkill here? Yes, but it's necessary to
    // workaround bug 291386.  If we don't, we stand a decent chance of getting
    // stuck in an infinite loop.
    let udCallback = {
        notify: function(timer) {
            aRefreshCallback();
        }
    };

    if (gEventTimer) {
        gEventTimer.cancel();
    } else {
        // Observer for wake after sleep/hibernate/standby to create new timers and refresh UI
        let wakeObserver = {
            observe: function(aSubject, aTopic, aData) {
                if (aTopic == "wake_notification") {
                    aRefreshCallback();
                }
            }
        };
        // Add observer
        Services.obs.addObserver(wakeObserver, "wake_notification", false);

        // Remove observer on unload
        window.addEventListener("unload", () => {
            Services.obs.removeObserver(wakeObserver, "wake_notification");
        }, false);

        gEventTimer = Components.classes["@mozilla.org/timer;1"]
                                   .createInstance(Components.interfaces.nsITimer);
    }
    gEventTimer.initWithCallback(udCallback, aMsUntil, gEventTimer.TYPE_ONE_SHOT);
}

/**
 * Gets a right value for calendar.agendaListbox.soondays preference, avoid
 * erroneus values edited in the lightning.js preference file
 **/
function getSoondaysPreference() {
    let prefName = "calendar.agendaListbox.soondays";
    let soonpref = Preferences.get(prefName, 5);

    if (soonpref > 0 && soonpref <= 28) {
        if (soonpref % 7 != 0) {
            let intSoonpref = Math.floor(soonpref / 7) * 7;
            soonpref = (intSoonpref == 0 ? soonpref : intSoonpref);
            Preferences.set(prefName, soonpref, "INT");
        }
    } else {
        soonpref = soonpref > 28 ? 28 : 1;
        Preferences.set(prefName, soonpref, "INT");
    }
    return soonpref;
}
