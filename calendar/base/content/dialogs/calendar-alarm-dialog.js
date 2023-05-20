/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported onDismissAllAlarms, setupWindow, finishWindow, addWidgetFor,
 *         removeWidgetFor, onSelectAlarm, ensureCalendarVisible
 */

Components.utils.import("resource://gre/modules/PluralForm.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

/**
 * Helper function to get the alarm service and cache it.
 *
 * @return The alarm service component
 */
function getAlarmService() {
    if (!("mAlarmService" in window)) {
        window.mAlarmService = Components.classes["@mozilla.org/calendar/alarm-service;1"]
                                         .getService(Components.interfaces.calIAlarmService);
    }
    return window.mAlarmService;
}

/**
 * Event handler for the 'snooze' event. Snoozes the given alarm by the given
 * number of minutes using the alarm service.
 *
 * @param event     The snooze event
 */
function onSnoozeAlarm(event) {
    // reschedule alarm:
    let duration = getDuration(event.detail);
    if (aboveSnoozeLimit(duration)) {
        // we prevent snoozing too far if the alarm wouldn't be displayed
        return;
    }
    getAlarmService().snoozeAlarm(event.target.item, event.target.alarm, duration);
}

/**
 * Event handler for the 'dismiss' event. Dismisses the given alarm using the
 * alarm service.
 *
 * @param event     The snooze event
 */
function onDismissAlarm(event) {
    getAlarmService().dismissAlarm(event.target.item, event.target.alarm);
}

/**
 * Called to dismiss all alarms in the alarm window.
 */
function onDismissAllAlarms() {
    // removes widgets on the fly:
    let alarmRichlist = document.getElementById("alarm-richlist");
    let parentItems = {};

    // Make a copy of the child nodes as they get modified live
    for (let node of alarmRichlist.childNodes) {
        // Check if the node is a valid alarm and is still part of DOM
        if (node.parentNode && node.item && node.alarm &&
            !(node.item.parentItem.hashId in parentItems)) {
            // We only need to acknowledge one occurrence for repeating items
            parentItems[node.item.parentItem.hashId] = node.item.parentItem;
            getAlarmService().dismissAlarm(node.item, node.alarm);
        }
    }
}

/**
 * Event handler fired when the alarm widget's "Details..." label was clicked.
 * Open the event dialog in the most recent Thunderbird window.
 *
 * @param event     The itemdetails event.
 */
function onItemDetails(event) {
    // We want this to happen in a calendar window if possible. Otherwise open
    // it using our window.
    let calWindow = cal.getCalendarWindow();
    if (calWindow) {
        calWindow.modifyEventWithDialog(event.target.item, null, true);
    } else {
        modifyEventWithDialog(event.target.item, null, true);
    }
}

/**
 * Sets up the alarm dialog, initializing the default snooze length and setting
 * up the relative date update timer.
 */
var gRelativeDateUpdateTimer;
function setupWindow() {
    // We want to update when we are at 0 seconds past the minute. To do so, use
    // setTimeout to wait until we are there, then setInterval to execute every
    // minute. Since setInterval is not totally exact, we may run into problems
    // here. I hope not!
    let current = new Date();

    let timeout = (60 - current.getSeconds()) * 1000;
    gRelativeDateUpdateTimer = setTimeout(() => {
        updateRelativeDates();
        gRelativeDateUpdateTimer = setInterval(updateRelativeDates, 60 * 1000);
    }, timeout);

    // Give focus to the alarm richlist after onload completes. See bug 103197
    setTimeout(onFocusWindow, 0);
}

/**
 * Unload function for the alarm dialog. If applicable, snooze the remaining
 * alarms and clean up the relative date update timer.
 */
function finishWindow() {
    let alarmRichlist = document.getElementById("alarm-richlist");

    if (alarmRichlist.childNodes.length > 0) {
        // If there are still items, the window wasn't closed using dismiss
        // all/snooze all. This can happen when the closer is clicked or escape
        // is pressed. Snooze all remaining items using the default snooze
        // property.
        let snoozePref = Preferences.get("calendar.alarms.defaultsnoozelength", 0);
        if (snoozePref <= 0) {
            snoozePref = 5;
        }
        snoozeAllItems(snoozePref);
    }

    // Stop updating the relative time
    clearTimeout(gRelativeDateUpdateTimer);
}

/**
 * Set up the focused element. If no element is focused, then switch to the
 * richlist.
 */
function onFocusWindow() {
    if (!document.commandDispatcher.focusedElement) {
        document.getElementById("alarm-richlist").focus();
    }
}

/**
 * Timer callback to update all relative date labels
 */
function updateRelativeDates() {
    let alarmRichlist = document.getElementById("alarm-richlist");
    for (let node of alarmRichlist.childNodes) {
        if (node.item && node.alarm) {
            node.updateRelativeDateLabel();
        }
    }
}

/**
 * Function to snooze all alarms the given number of minutes.
 *
 * @param aDurationMinutes    The duration in minutes
 */
function snoozeAllItems(aDurationMinutes) {
    let duration = getDuration(aDurationMinutes);
    if (aboveSnoozeLimit(duration)) {
        // we prevent snoozing too far if the alarm wouldn't be displayed
        return;
    }

    let alarmRichlist = document.getElementById("alarm-richlist");
    let parentItems = {};

    // Make a copy of the child nodes as they get modified live
    for (let node of alarmRichlist.childNodes) {
        // Check if the node is a valid alarm and is still part of DOM
        if (node.parentNode && node.item && node.alarm &&
            !(node.item.parentItem.hashId in parentItems)) {
            // We only need to acknowledge one occurrence for repeating items
            parentItems[node.item.parentItem.hashId] = node.item.parentItem;
            getAlarmService().snoozeAlarm(node.item, node.alarm, duration);
        }
    }
}

/**
 * Receive a calIDuration object for a given number of minutes
 *
 * @param  {long}           aMinutes     The number of minutes
 * @return {calIDuration}
 */
function getDuration(aMinutes) {
    const MINUTESINWEEK = 7 * 24 * 60;

    // converting to weeks if any is required to avoid an integer overflow of duration.minutes as
    // this is of type short
    let weeks = Math.floor(aMinutes / MINUTESINWEEK);
    aMinutes -= weeks * MINUTESINWEEK;

    let duration = cal.createDuration();
    duration.minutes = aMinutes;
    duration.weeks = weeks;
    duration.normalize();
    return duration;
}

/**
 * Check whether the snooze period exceeds the current limitation of the AlarmService and prompt
 * the user with a message if so
 * @param   {calIDuration}   aDuration   The duration to snooze
 * @returns {Boolean}
 */
function aboveSnoozeLimit(aDuration) {
    const LIMIT = Components.interfaces.calIAlarmService.MAX_SNOOZE_MONTHS;

    let currentTime = cal.now().getInTimezone(cal.UTC());
    let limitTime = currentTime.clone();
    limitTime.month += LIMIT;

    let durationUntilLimit = limitTime.subtractDate(currentTime);
    if (aDuration.compare(durationUntilLimit) > 0) {
        let msg = PluralForm.get(LIMIT, cal.calGetString("calendar", "alarmSnoozeLimitExceeded"));
        showError(msg.replace("#1", LIMIT));
        return true;
    }
    return false;
}

/**
 * Sets up the window title, counting the number of alarms in the window.
 */
function setupTitle() {
    let alarmRichlist = document.getElementById("alarm-richlist");
    let reminders = alarmRichlist.childNodes.length;

    let title = PluralForm.get(reminders, calGetString("calendar", "alarmWindowTitle.label"));
    document.title = title.replace("#1", reminders);
}

/**
 * Comparison function for the start date of a calendar item and
 * the start date of a calendar-alarm-widget.
 *
 * @param aItem                 A calendar item for the comparison of the start date property
 * @param calAlarmWidget        The alarm widget item for the start date comparison with the given calendar item
 * @return                      1 - if the calendar item starts before the calendar-alarm-widget
 *                             -1 - if the calendar-alarm-widget starts before the calendar item
 *                              0 - otherwise
 */
function widgetAlarmComptor(aItem, aWidgetItem) {
    if (aItem == null || aWidgetItem == null) {
        return -1;
    }

    // Get the dates to compare
    let aDate = aItem[calGetStartDateProp(aItem)];
    let bDate = aWidgetItem[calGetStartDateProp(aWidgetItem)];

    return aDate.compare(bDate);
}

/**
 * Add an alarm widget for the passed alarm and item.
 *
 * @param aItem       The calendar item to add a widget for.
 * @param aAlarm      The alarm to add a widget for.
 */
function addWidgetFor(aItem, aAlarm) {
    let widget = document.createElement("calendar-alarm-widget");
    let alarmRichlist = document.getElementById("alarm-richlist");

    // Add widgets sorted by start date ascending
    cal.binaryInsertNode(alarmRichlist, widget, aItem, widgetAlarmComptor, false);

    widget.item = aItem;
    widget.alarm = aAlarm;
    widget.addEventListener("snooze", onSnoozeAlarm, false);
    widget.addEventListener("dismiss", onDismissAlarm, false);
    widget.addEventListener("itemdetails", onItemDetails, false);

    setupTitle();

    if (!alarmRichlist.userSelectedWidget) {
        // Always select first widget of the list.
        // Since the onselect event causes scrolling,
        // we don't want to process the event when adding widgets.
        alarmRichlist.suppressOnSelect = true;
        alarmRichlist.selectedIndex = 0;
        alarmRichlist.suppressOnSelect = false;
    }

    window.focus();
    window.getAttention();
}

/**
 * Remove the alarm widget for the passed alarm and item.
 *
 * @param aItem       The calendar item to remove the alarm widget for.
 * @param aAlarm      The alarm to remove the widget for.
 */
function removeWidgetFor(aItem, aAlarm) {
    let hashId = aItem.hashId;
    let alarmRichlist = document.getElementById("alarm-richlist");
    let nodes = alarmRichlist.childNodes;
    let notfound = true;
    for (let i = nodes.length - 1; notfound && i >= 0; --i) {
        let widget = nodes[i];
        if (widget.item && widget.item.hashId == hashId &&
            widget.alarm && widget.alarm.icalString == aAlarm.icalString) {
            if (widget.selected) {
                // Advance selection if needed
                widget.control.selectedItem = widget.previousSibling ||
                                              widget.nextSibling;
            }

            widget.removeEventListener("snooze", onSnoozeAlarm, false);
            widget.removeEventListener("dismiss", onDismissAlarm, false);
            widget.removeEventListener("itemdetails", onItemDetails, false);

            widget.remove();
            closeIfEmpty();
            notfound = false;
        }
    }

    // Update the title
    setupTitle();
}

/**
 * Close the alarm dialog if there are no further alarm widgets
 */
function closeIfEmpty() {
    let alarmRichlist = document.getElementById("alarm-richlist");

    // we don't want to close if the alarm service is still loading, as the
    // removed alarms may be immediately added again.
    if (!alarmRichlist.hasChildNodes() && !getAlarmService().isLoading) {
        window.close();
    }
}

/**
 * Handler function called when an alarm entry in the richlistbox is selected
 *
 * @param event         The DOM event from the click action
 */
function onSelectAlarm(event) {
    let richList = document.getElementById("alarm-richlist");
    if (richList == event.target) {
        richList.ensureElementIsVisible(richList.getSelectedItem(0));
        richList.userSelectedWidget = true;
    }
}

function ensureCalendarVisible(aCalendar) {
    // This function is called on the alarm dialog from calendar-item-editing.js.
    // Normally, it makes sure that the calendar being edited is made visible,
    // but the alarm dialog is too far away from the calendar views that it
    // makes sense to force visiblity for the calendar. Therefore, do nothing.
}
