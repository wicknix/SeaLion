/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var MODULE_NAME = "calendar-utils";
var MODULE_REQUIRES = ["window-helpers"];

var os = {};
Components.utils.import("resource://mozmill/stdlib/os.js", os);
var frame = {};
Components.utils.import("resource://mozmill/modules/frame.js", frame);

var modalDialog = require("test-window-helpers");

var sleep = 500;
var EVENT_BOX = 0; // Use when you need an event box
var CANVAS_BOX = 1; // Use when you need a calendar canvas box
var ALLDAY = 2; // Use when you need an allday canvas or event box

/**
 *  Accept to send notification email with event to attendees
 *  @param controller - Mozmill window controller
 */
function acceptSendingNotificationMail(controller) {
    modalDialog.plan_for_modal_dialog("commonDialog", (dialog) => {
        dialog.waitThenClick(new elementslib.Lookup(dialog.window.document, '/id("commonDialog")/' +
          'anon({"anonid":"buttons"})/{"dlgtype":"accept"}'));
    }
  );

    modalDialog.wait_for_modal_dialog("commonDialog");
}

/**
 *  Add an attachment with url
 *  @param controller - Mozmill window controller
 */
function handleAddingAttachment(controller, url) {
    modalDialog.plan_for_modal_dialog("commonDialog", (attachment) => {
        let input = new elementslib.ID(attachment.window.document, "loginTextbox");
        attachment.waitForElement(input);
        input.getNode().value = url;
        attachment.click(new elementslib.Lookup(attachment.window.document, '/id("commonDialog")/' +
          'anon({"anonid":"buttons"})/{"dlgtype":"accept"}'));
    });

    modalDialog.wait_for_modal_dialog("commonDialog");
}

/**
 *  Choose to delete just one occurrence of a repeating event
 *  @param controller - Mozmill window controller
 *  @param attendees - whether there are attendees that can be notified or not
 */
function handleOccurrenceDeletion(controller, attendees) {
    let dialog = new modalDialog.modalDialog(controller.window);
    dialog.start((dialogController) => {
        if (attendees) {
            acceptSendingNotificationMail();
        }
        dialogController.waitThenClick(new elementslib.ID(dialog.window.document, "accept-occurrence-button"));
    });
}

/**
 *  Choose to delete all occurrences of a repeating event
 *  @param controller - Mozmill window controller
 *  @param attendees - whether there are attendees that can be notified or not
 */
function handleParentDeletion(controller, attendees) {
    let dialog = new modalDialog.modalDialog(controller.window);
    dialog.start((dialogController) => {
        if (attendees) {
            acceptSendingNotificationMail();
        }
        dialogController.waitThenClick(new elementslib.ID(dialog.window.document, "accept-parent-button"));
    });
}

/**
 *  Choose to modify just one occurrence of a repeating event
 *  @param controller - Mozmill window controller
 *  @param attendees - whether there are attendees that can be notified or not
 */
function handleOccurrenceModification(controller, attendees) {
    handleOccurrenceDeletion(controller, attendees);
}

/**
 *  Choose to modify all occurrences of a repeating event
 *  @param controller - Mozmill window controller
 *  @param attendees - whether there are attendees that can be notified or not
 */
function handleParentModification(controller, attendees) {
    handleParentDeletion(controller, attendees);
}

/**
 *  Switch to a view
 *  @param controller - Mozmill window controller
 *  @param view - day, week, multiweek or month
 */
function switchToView(controller, view) {
    switch (view) {
        case "week":
            controller.waitThenClick(new elementslib.ID(controller.window.document,
              "calendar-week-view-button"));
            controller.waitFor(() => {
                let button = new elementslib.ID(controller.window.document,
                "calendar-week-view-button");
                return button.getNode().selected == true;
            });
            break;
        case "multiweek":
            controller.waitThenClick(new elementslib.ID(controller.window.document,
              "calendar-multiweek-view-button"));
            controller.waitFor(() => {
                let button = new elementslib.ID(controller.window.document,
                "calendar-multiweek-view-button");
                return button.getNode().selected == true;
            });
            break;
        case "month":
            controller.waitThenClick(new elementslib.ID(controller.window.document,
              "calendar-month-view-button"));
            controller.waitFor(() => {
                let button = new elementslib.ID(controller.window.document,
                "calendar-month-view-button");
                return button.getNode().selected == true;
            });
            break;
        default:
            controller.waitThenClick(new elementslib.ID(controller.window.document,
              "calendar-day-view-button"));
            controller.waitFor(() => {
                let button = new elementslib.ID(controller.window.document,
                "calendar-day-view-button");
                return button.getNode().selected == true;
            });
    }
}

/**
 *  Go to a specific date using minimonth
 *  @param controller - main window controller
 *  @param year - four-digit year
 *  @param month - 1-based index of a month
 *  @param day - 1-based index of a day
 */
function goToDate(controller, year, month, day) {
    let miniMonth = '/id("messengerWindow")/id("tabmail-container")/id("tabmail")/' +
      'id("tabpanelcontainer")/id("calendarTabPanel")/id("calendarContent")/id("ltnSidebar")/' +
      'id("minimonth-pane")/{"align":"center"}/id("calMinimonthBox")/id("calMinimonth")/';
    let activeYear = (new elementslib.Lookup(controller.window.document, miniMonth +
      'anon({"anonid":"minimonth-header"})/anon({"anonid":"minmonth-popupset"})/' +
      'anon({"anonid":"years-popup"})/[0]/{"current":"true"}')).getNode().getAttribute("value");
    let activeMonth = (new elementslib.Lookup(controller.window.document, miniMonth +
      'anon({"anonid":"minimonth-header"})/anon({"anonid":"minmonth-popupset"})/' +
      'anon({"anonid":"months-popup"})/[0]/{"current":"true"}')).getNode().getAttribute("index");
    let yearDifference = activeYear - year;
    let monthDifference = activeMonth - (month - 1);

    if (yearDifference != 0) {
        let scrollArrow = yearDifference > 0
          ? (new elementslib.Lookup(controller.window.document, miniMonth +
              'anon({"anonid":"minimonth-header"})/anon({"anonid":"minmonth-popupset"})/' +
              'anon({"anonid":"years-popup"})/[0]/{"class":"autorepeatbutton-up"}')).getNode()
          : (new elementslib.Lookup(controller.window.document, miniMonth +
              'anon({"anonid":"minimonth-header"})/anon({"anonid":"minmonth-popupset"})/' +
              'anon({"anonid":"years-popup"})/[0]/{"class":"autorepeatbutton-down"}')).getNode();

        // pick year
        controller.click(new elementslib.Lookup(controller.window.document, miniMonth +
          'anon({"anonid":"minimonth-header"})/anon({"anonid":"yearcell"})'));
        controller.sleep(500);

        for (let i = 0; i < Math.abs(yearDifference); i++) {
            scrollArrow.doCommand();
            controller.sleep(100);
        }

        controller.click(new elementslib.Lookup(controller.window.document, miniMonth +
          'anon({"anonid":"minimonth-header"})/anon({"anonid":"minmonth-popupset"})/' +
          'anon({"anonid":"years-popup"})/[0]/{"value":"' + year + '"}'));
        controller.sleep(500);
    }

    if (monthDifference != 0) {
        // pick month
        controller.click(new elementslib.Lookup(controller.window.document, miniMonth +
          'anon({"anonid":"minimonth-header"})/anon({"anonid":"monthheader"})/[' + activeMonth +
          "]"));
        controller.waitThenClick(new elementslib.Lookup(controller.window.document, miniMonth +
          'anon({"anonid":"minimonth-header"})/anon({"anonid":"minmonth-popupset"})/' +
          'anon({"anonid":"months-popup"})/[0]/{"index":"' + (month - 1) + '"}'));
        controller.sleep(500);
    }

    let lastDayInFirstRow = (new elementslib.Lookup(controller.window.document,
      miniMonth + 'anon({"anonid":"minimonth-calendar"})/[1]/[6]')).getNode().getAttribute("value");
    let positionOfFirst = 7 - lastDayInFirstRow;
    let dateColumn = (positionOfFirst + day - 1) % 7;
    let dateRow = Math.floor((positionOfFirst + day - 1) / 7);

    // pick day
    controller.click(new elementslib.Lookup(controller.window.document, miniMonth +
      'anon({"anonid":"minimonth-calendar"})/[' + (dateRow + 1) + "]/[" + dateColumn + "]"));
    controller.sleep(500);
}

/**
 *  @param controller - main window controller
 *  @param view - day, week, multiweek or month
 *  @param option - bg for creating event, fg for checking
 *  @param row - only used in multiweek and month view, 1-based index of a row
 *  @param column - 1-based index of a column
 *  @param hour - index of hour box
 *  @returns path string
 */
function getEventBoxPath(controller, view, option, row, column, hour) {
    let viewDeck = '/id("messengerWindow")/id("tabmail-container")/id("tabmail")/' +
      'id("tabpanelcontainer")/id("calendarTabPanel")/id("calendarContent")/' +
      'id("calendarDisplayDeck")/id("calendar-view-box")/id("view-deck")';
    let dayView = viewDeck + '/id("day-view")';
    let weekView = viewDeck + '/id("week-view")';
    let multiweekView = viewDeck + '/id("multiweek-view")';
    let monthView = viewDeck + '/id("month-view")';

    let path = "";
    switch (view) {
        case "week":
            path += weekView;
            break;
        case "multiweek":
            path += multiweekView;
            break;
        case "month":
            path += monthView;
            break;
        default: path += dayView;
    }

    if ((view == "day" || view == "week") && option == ALLDAY) {
        path += '/anon({"anonid":"mainbox"})/anon({"anonid":"headerbox"})/anon({"anonid":"headerdaybox"})';
        path += "/[" + (column - 1) + "]";

        return path;
    } else if (view == "day" || view == "week") {
        path += '/anon({"anonid":"mainbox"})/anon({"anonid":"scrollbox"})/anon({"anonid":"daybox"})';
        path += "/[" + (column - 1) + "]";
        path += '/anon({"anonid":"boxstack"})';

        if (option == CANVAS_BOX) {
            path += '/anon({"anonid":"bgbox"})/[' + hour + "]";
        } else {
            path += '/anon({"anonid":"topbox"})/{"flex":"1"}/{"flex":"1"}/{"flex":"1"}';
        }

        return path;
    } else {
        path += '/anon({"anonid":"mainbox"})/anon({"anonid":"monthgrid"})/' +
          'anon({"anonid":"monthgridrows"})/[' + (row - 1) + "]/[" + (column - 1) + "]";

        if (option == CANVAS_BOX) {
            path += '/anon({"anonid":"day-items"})';
        }

        return path;
    }
}

/**
 * @param controller - Mozmill window controller
 * @param n - how many times next button in view is clicked
 */
function forward(controller, n) {
    for (let i = 0; i < n; i++) {
        controller.click(new elementslib.ID(controller.window.document, "next-view-button"));
        controller.sleep(100);
    }
}

/**
 * @param controller - Mozmill window controller
 * @param n - how many times previous button in view is clicked
 */
function back(controller, n) {
    for (let i = 0; i < n; i++) {
        controller.click(new elementslib.ID(controller.window.document, "previous-view-button"));
        controller.sleep(100);
    }
}

/**
 * Deletes all calendars with given name
 * @param controller - Mozmill window controller
 * @param name - calendar name
 */
function deleteCalendars(controller, name) {
    let defaultView = (new elementslib.ID(controller.window.document, "messengerWindow"))
                      .getNode().ownerDocument.defaultView;
    let manager = defaultView.getCalendarManager();
    let cals = manager.getCalendars({});

    for (let i = 0; i < cals.length; i++) {
        if (cals[i].name == name) {
            manager.removeCalendar(cals[i]);
        }
    }
}

/**
 * Creates local calendar with given name and select it in calendars list
 * @param controller - Mozmill window controller
 * @param name - calendar name
 */
function createCalendar(controller, name) {
    let defaultView = (new elementslib.ID(controller.window.document, "messengerWindow"))
                      .getNode().ownerDocument.defaultView;
    let manager = defaultView.getCalendarManager();

    let url = defaultView.makeURL("moz-storage-calendar://");
    let calendar = manager.createCalendar("storage", url);
    calendar.name = name;
    manager.registerCalendar(calendar);

    let id = calendar.id;
    let calendarTree = (new elementslib.Lookup(controller.window.document,
      '/id("messengerWindow")/id("tabmail-container")/id("tabmail")/id("tabpanelcontainer")/' +
      'id("calendarTabPanel")/id("calendarContent")/id("ltnSidebar")/id("calendar-panel")/' +
      'id("calendar-list-pane")/id("calendar-listtree-pane")/id("calendar-list-tree-widget")'))
      .getNode();
    for (i = 0; i < calendarTree.mCalendarList.length; i++) {
        if (calendarTree.mCalendarList[i].id == id) {
            calendarTree.tree.view.selection.select(i);
        }
    }
}

/**
 * Retrieves array of all calendar-event-box elements in node
 * @param node - node to be searched
 * @param eventNodes - array where to put resultíng nodes
 */
function findEventsInNode(node, eventNodes) {
    if (node.tagName == "calendar-event-box") {
        eventNodes.push(node);
        return;
    } else if (node.children.length > 0) {
        for (let i = 0; i < node.children.length; i++) {
            findEventsInNode(node.children[i], eventNodes);
        }
    }
}

/**
 *  Helper function to enter event/task dialog data
 *  @param controller - event/task controller
 *  @param data - dataset object
 *                  title - event/task title
 *                  location - event/task location
 *                  description - event/task description
 *                  category - category label
 *                  allday - boolean value
 *                  startdate - Date object
 *                  starttime - Date object
 *                  enddate - Date object
 *                  endtime - Date object
 *                  timezone - false for local, true for set timezone
 *                  repeat - reccurrence value, one of none/daily/weekly/every.weekday/bi.weekly/
 *                           monthly/yearly/custom
 *                  reminder - reminder option index
 *                  priority - none/low/normal/high
 *                  privacy - public/confidential/private
 *                  status - none/tentative/confirmed/canceled for events
 *                           none/needs-action/in-process/completed/cancelled for tasks
 *                  completed - Date object for tasks
 *                  percent - percent complete for tasks
 *                  freebusy - free/busy
 *                  attachment.add - url to add
 *                  attachment.remove - label of url to remove (without http://)
 */
function setData(controller, data) {
    let eventDialog = '/id("calendar-event-dialog")/id("event-grid")/id("event-grid-rows")/';
    let taskDialog = '/id("calendar-task-dialog")/id("event-grid")/id("event-grid-rows")/';
    let dialog;
    let isEvent = true;

    // see if it's an event dialog
    try {
        (new elementslib.Lookup(controller.window.document, eventDialog)).getNode();
        dialog = eventDialog;
    } catch (error) {
        dialog = taskDialog;
        isEvent = false;
    }

    let dateInput = 'anon({"class":"datepicker-box-class"})/{"class":"datepicker-text-class"}/' +
      'anon({"class":"menulist-editable-box textbox-input-box"})/anon({"anonid":"input"})';
    let timeInput = 'anon({"anonid":"hbox"})/anon({"anonid":"time-picker"})/' +
      'anon({"class":"timepicker-box-class"})/anon({"class":"timepicker-text-class"})/' +
      'anon({"flex":"1"})/anon({"anonid":"input"})';
    let startDateInput = new elementslib.Lookup(controller.window.document, dialog +
      'id("event-grid-startdate-row")/id("event-grid-startdate-picker-box")/' +
      (isEvent ? 'id("event-starttime")/' : 'id("todo-entrydate")/') +
      'anon({"anonid":"hbox"})/anon({"anonid":"date-picker"})/' + dateInput);
    let endDateInput = new elementslib.Lookup(controller.window.document, dialog +
      'id("event-grid-enddate-row")/[1]/id("event-grid-enddate-picker-box")/' +
      (isEvent ? 'id("event-endtime")/' : 'id("todo-duedate")/') +
      'anon({"anonid":"hbox"})/anon({"anonid":"date-picker"})/' + dateInput);
    let startTimeInput = new elementslib.Lookup(controller.window.document, dialog +
      'id("event-grid-startdate-row")/id("event-grid-startdate-picker-box")/' +
      (isEvent ? 'id("event-starttime")/' : 'id("todo-entrydate")/') +
      timeInput);
    let endTimeInput = new elementslib.Lookup(controller.window.document, dialog +
      'id("event-grid-enddate-row")/[1]/id("event-grid-enddate-picker-box")/' +
      (isEvent ? 'id("event-endtime")/' : 'id("todo-duedate")/') +
      timeInput);
    let completedDateInput = new elementslib.Lookup(controller.window.document,
      dialog + 'id("event-grid-todo-status-row")/id("event-grid-todo-status-picker-box")/' +
      'id("completed-date-picker")/' + dateInput);
    let percentCompleteInput = new elementslib.Lookup(controller.window.document, dialog +
      'id("event-grid-todo-status-row")/id("event-grid-todo-status-picker-box")/' +
      'id("percent-complete-textbox")/anon({"class":"textbox-input-box numberbox-input-box"})/' +
      'anon({"anonid":"input"})');
    let dateService = Components.classes["@mozilla.org/intl/scriptabledateformat;1"]
                                .getService(Components.interfaces.nsIScriptableDateFormat);
    let mac = utils.appInfo.os.toLowerCase().includes("darwin");
    // wait for input elements' values to be populated
    controller.sleep(sleep);

    // title
    if (data.title != undefined) {
        if (mac) {
            let titleField = new elementslib.ID(controller.window.document, "item-title");
            titleField.getNode().value = data.title;
        } else {
            controller.keypress(new elementslib.Lookup(controller.window.document, dialog +
              'id("event-grid-title-row")/id("item-title")/anon({"class":"textbox-input-box"})/' +
              'anon({"anonid":"input"})'),
              "a", { ctrlKey: true });
            controller.type(new elementslib.Lookup(controller.window.document, dialog +
              'id("event-grid-title-row")/id("item-title")/anon({"class":"textbox-input-box"})/' +
              'anon({"anonid":"input"})'),
              data.title);
        }
    }

    // location
    if (data.location != undefined) {
        if (mac) {
            let locationField = new elementslib.ID(controller.window.document, "item-location");
            locationField.getNode().value = data.location;
        } else {
            controller.keypress(new elementslib.Lookup(controller.window.document, dialog +
              'id("event-grid-location-row")/id("item-location")/anon({"class":"textbox-input-box"})/' +
              'anon({"anonid":"input"})'),
              "a", { ctrlKey: true });
            controller.type(new elementslib.Lookup(controller.window.document, dialog +
              'id("event-grid-location-row")/id("item-location")/anon({"class":"textbox-input-box"})/' +
              'anon({"anonid":"input"})'),
              data.location);
        }
    }

    // category
    if (data.category != undefined) {
        controller.select(new elementslib.ID(controller.window.document, "item-categories"), undefined,
          data.category);
        controller.sleep(sleep);
    }

    // all-day
    if (data.allday != undefined && isEvent) {
        controller.check(new elementslib.ID(controller.window.document, "event-all-day"), data.allday);
    }

    // timezone
    if (data.timezone != undefined) {
        let menuitem = new elementslib.ID(controller.window.document, "options-timezones-menuitem");
        menuitem.getNode().setAttribute("checked", data.timezone);
        controller.click(menuitem);
    }

    // startdate
    if (data.startdate != undefined && data.startdate.constructor.name == "Date") {
        let startdate = dateService.FormatDate("", dateService.dateFormatShort,
          data.startdate.getFullYear(), data.startdate.getMonth() + 1, data.startdate.getDate());
        if (!isEvent) {
            controller.check(new elementslib.ID(controller.window.document, "todo-has-entrydate"), true);
        }
        if (mac) {
            startDateInput.getNode().value = startdate;
        } else {
            controller.keypress(startDateInput, "a", { ctrlKey: true });
            controller.type(startDateInput, startdate);
        }
    }

    // starttime
    if (data.starttime != undefined && data.starttime.constructor.name == "Date") {
        let starttime = dateService.FormatTime("", dateService.timeFormatNoSeconds,
          data.starttime.getHours(), data.starttime.getMinutes(), 0);
        if (mac) {
            startTimeInput.getNode().value = starttime;
            controller.sleep(sleep);
        } else {
            controller.keypress(startTimeInput, "a", { ctrlKey: true });
            controller.type(startTimeInput, starttime);
        }
    }

    // enddate
    if (data.enddate != undefined && data.enddate.constructor.name == "Date") {
        let enddate = dateService.FormatDate("", dateService.dateFormatShort,
          data.enddate.getFullYear(), data.enddate.getMonth() + 1, data.enddate.getDate());
        if (!isEvent) {
            controller.check(new elementslib.ID(controller.window.document, "todo-has-duedate"), true);
        }
        if (mac) {
            endDateInput.getNode().value = enddate;
        } else {
            controller.keypress(endDateInput, "a", { ctrlKey: true });
            controller.type(endDateInput, enddate);
        }
    }

    // endttime
    if (data.endtime != undefined && data.endtime.constructor.name == "Date") {
        let endtime = dateService.FormatTime("", dateService.timeFormatNoSeconds,
          data.endtime.getHours(), data.endtime.getMinutes(), 0);
        if (mac) {
            endTimeInput.getNode().value = endtime;
            controller.sleep(sleep);
        } else {
            controller.keypress(endTimeInput, "a", { ctrlKey: true });
            controller.type(endTimeInput, endtime);
        }
    }

    // recurrence
    if (data.repeat != undefined) {
        controller.select(new elementslib.ID(controller.window.document, "item-repeat"), undefined,
          undefined, data.repeat);
    }

    // reminder
    if (data.reminder != undefined) {
        controller.select(new elementslib.ID(controller.window.document, "item-alarm"), data.reminder);
    }

    // description
    if (data.description != undefined) {
        if (mac) {
            let descField = new elementslib.Lookup(controller.window.document, dialog +
              'id("event-grid-description-row")/id("item-description")/' +
              'anon({"class":"textbox-input-box"})/anon({"anonid":"input"})');
            descField.getNode().value = data.description;
        } else {
            controller.keypress(new elementslib.Lookup(controller.window.document, dialog +
              'id("event-grid-description-row")/id("item-description")/' +
              'anon({"class":"textbox-input-box"})/anon({"anonid":"input"})'),
              "a", { ctrlKey: true });
            controller.type(new elementslib.Lookup(controller.window.document, dialog +
              'id("event-grid-description-row")/id("item-description")/' +
              'anon({"class":"textbox-input-box"})/anon({"anonid":"input"})'),
              data.description);
        }
    }

    // priority
    if (data.priority != undefined) {
        controller.mainMenu.click("#options-priority-" + data.priority + "-label");
    }

    // privacy
    if (data.privacy != undefined) {
        controller.mainMenu.click("#options-privacy-" + data.privacy + "-menuitem");
    }

    // status
    if (data.status != undefined) {
        if (isEvent) {
            controller.mainMenu.click("#options-status-" + data.status + "-menuitem");
        } else {
            controller.select(new elementslib.ID(controller.window.document, "todo-status"), undefined,
              undefined, data.status.toUpperCase());
            controller.sleep(sleep);
        }
    }

    let currentStatus = (new elementslib.ID(controller.window.document, "todo-status")).getNode().value;

    // completed on
    if (data.completed != undefined && data.completed.constructor.name == "Date" && !isEvent) {
        let completeddate = dateService.FormatDate("", dateService.dateFormatShort,
          data.completed.getFullYear(), data.completed.getMonth() + 1,
          data.completed.getDate());

        if (currentStatus == "COMPLETED") {
            if (mac) {
                completedDateInput.getNode().value = completeddate;
            } else {
                controller.keypress(completedDateInput, "a", { ctrlKey: true });
                controller.type(completedDateInput, completeddate);
            }
        }
    }

    // percent complete
    if (data.percent != undefined &&
         (currentStatus == "NEEDS-ACTION" || currentStatus == "IN-PROCESS" ||
          currentStatus == "COMPLETED")) {
        percentCompleteInput.getNode().value = data.percent;
    }

    // free/busy
    if (data.freebusy != undefined) {
        controller.mainMenu.click("#options-freebusy-" + data.freebusy + "-menuitem");
    }

    // attachment
    if (data.attachment != undefined) {
        if (data.attachment.add != undefined) {
            handleAddingAttachment(controller, data.attachment.add);
            controller.click(new elementslib.ID(controller.window.document, "button-url"));
        }
        if (data.attachment.delete != undefined) {
            controller.click(new elementslib.Lookup(controller.window.document, dialog +
              'id("event-grid-attachment-row")/id("attachment-link")/{"label":"' +
              data.attachment.delete + '"}'));
            controller.keypress(new elementslib.ID(controller.window.document, "attachment-link"),
              "VK_DELETE", {});
        }
    }

    controller.sleep(sleep);
}

function open_lightning_prefs(aCallback, aParentController, collector, windowTimeout) {
    function paneLoadedChecker() {
        let pane = prefsController.window.document.getElementById("paneLightning");
        return pane.loaded;
    }

    let timeout = windowTimeout || 30000;
    aParentController.window.openOptionsDialog("paneLightning");
    aParentController.waitFor(() => mozmill.utils.getWindows("Mail:Preferences").length == 1,
                              "Error opening preferences window", timeout);
    let prefsController = new mozmill.controller.MozMillController(mozmill.utils.getWindows("Mail:Preferences")[0]);
    prefsController.waitFor(paneLoadedChecker, "Timed out waiting for lightning prefpane to load.");

    aCallback(prefsController);

    prefsController.window.close();
    aParentController.waitFor(() => mozmill.utils.getWindows("Mail:Preferences").length == 0,
                              "Error closing preferences window", timeout);
}

// Export of constants
exports.ALLDAY = ALLDAY;
exports.CANVAS_BOX = CANVAS_BOX;
exports.EVENT_BOX = EVENT_BOX;

// Export of functions
exports.acceptSendingNotificationMail = acceptSendingNotificationMail;
exports.back = back;
exports.createCalendar = createCalendar;
exports.deleteCalendars = deleteCalendars;
exports.findEventsInNode = findEventsInNode;
exports.forward = forward;
exports.getEventBoxPath = getEventBoxPath;
exports.goToDate = goToDate;
exports.handleAddingAttachment = handleAddingAttachment;
exports.handleOccurrenceDeletion = handleOccurrenceDeletion;
exports.handleOccurrenceModification = handleOccurrenceModification;
exports.handleParentDeletion = handleParentDeletion;
exports.handleParentModification = handleParentModification;
exports.setData = setData;
exports.switchToView = switchToView;
exports.open_lightning_prefs = open_lightning_prefs;
