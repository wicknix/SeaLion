/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported taskDetailsView, sendMailToOrganizer, taskViewCopyLink */

Components.utils.import("resource://calendar/modules/calRecurrenceUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/AppConstants.jsm");

var taskDetailsView = {

    /**
     * Task Details Events
     *
     * XXXberend Please document this function, possibly also consolidate since
     * its the only function in taskDetailsView.
     */
    onSelect: function(event) {
        function displayElement(id, flag) {
            setBooleanAttribute(id, "hidden", !flag);
            return flag;
        }

        let dateFormatter =
            Components.classes["@mozilla.org/calendar/datetime-formatter;1"]
            .getService(Components.interfaces.calIDateTimeFormatter);

        let item = document.getElementById("calendar-task-tree").currentTask;
        if (displayElement("calendar-task-details-container", item != null) &&
            displayElement("calendar-task-view-splitter", item != null)) {
            displayElement("calendar-task-details-title-row", true);
            document.getElementById("calendar-task-details-title").textContent =
                (item.title ? item.title.replace(/\n/g, " ") : "");

            let organizer = item.organizer;
            if (displayElement("calendar-task-details-organizer-row", organizer != null)) {
                let name = organizer.commonName;
                if (!name || name.length <= 0) {
                    if (organizer.id && organizer.id.length) {
                        name = organizer.id;
                        let re = new RegExp("^mailto:(.*)", "i");
                        let matches = re.exec(name);
                        if (matches) {
                            name = matches[1];
                        }
                    }
                }
                if (displayElement("calendar-task-details-organizer-row", name && name.length)) {
                    document.getElementById("calendar-task-details-organizer").value = name;
                }
            }

            let priority = 0;
            if (item.calendar.getProperty("capabilities.priority.supported") != false) {
                priority = parseInt(item.priority, 10);
            }
            displayElement("calendar-task-details-priority-label", priority > 0);
            displayElement("calendar-task-details-priority-low", priority >= 6 && priority <= 9);
            displayElement("calendar-task-details-priority-normal", priority == 5);
            displayElement("calendar-task-details-priority-high", priority >= 1 && priority <= 4);

            let status = item.getProperty("STATUS");
            if (displayElement("calendar-task-details-status-row", status && status.length > 0)) {
                let statusDetails = document.getElementById("calendar-task-details-status");
                switch (status) {
                    case "NEEDS-ACTION": {
                        statusDetails.value = calGetString(
                            "calendar",
                            "taskDetailsStatusNeedsAction");
                        break;
                    }
                    case "IN-PROCESS": {
                        let percent = 0;
                        let property = item.getProperty("PERCENT-COMPLETE");
                        if (property != null) {
                            percent = parseInt(property, 10);
                        }
                        statusDetails.value = calGetString(
                            "calendar",
                            "taskDetailsStatusInProgress", [percent]);
                        break;
                    }
                    case "COMPLETED": {
                        if (item.completedDate) {
                            let completedDate = item.completedDate.getInTimezone(
                                                    calendarDefaultTimezone());
                            statusDetails.value = calGetString(
                                "calendar",
                                "taskDetailsStatusCompletedOn",
                                [dateFormatter.formatDateTime(completedDate)]);
                        }
                        break;
                    }
                    case "CANCELLED": {
                        statusDetails.value = calGetString(
                            "calendar",
                            "taskDetailsStatusCancelled");
                        break;
                    }
                    default: {
                        displayElement("calendar-task-details-status-row", false);
                        break;
                    }
                }
            }
            let categories = item.getCategories({});
            if (displayElement("calendar-task-details-category-row", categories.length > 0)) {
                document.getElementById("calendar-task-details-category").value = categories.join(", ");
            }
            document.getElementById("task-start-row").Item = item;
            document.getElementById("task-due-row").Item = item;
            let parentItem = item;
            if (parentItem.parentItem != parentItem) {
                // XXXdbo Didn't we want to get rid of these checks?
                parentItem = parentItem.parentItem;
            }
            let recurrenceInfo = parentItem.recurrenceInfo;
            let recurStart = parentItem.recurrenceStartDate;
            if (displayElement("calendar-task-details-repeat-row", recurrenceInfo && recurStart)) {
                let kDefaultTimezone = calendarDefaultTimezone();
                let startDate = recurStart.getInTimezone(kDefaultTimezone);
                let endDate = item.dueDate ? item.dueDate.getInTimezone(kDefaultTimezone) : null;
                let detailsString = recurrenceRule2String(recurrenceInfo, startDate, endDate, startDate.isDate);
                if (detailsString) {
                    let rpv = document.getElementById("calendar-task-details-repeat");
                    rpv.value = detailsString.split("\n").join(" ");
                }
            }
            let textbox = document.getElementById("calendar-task-details-description");
            let description = item.hasProperty("DESCRIPTION") ? item.getProperty("DESCRIPTION") : null;
            textbox.value = description;
            textbox.inputField.readOnly = true;
            let attachmentRows = document.getElementById("calendar-task-details-attachment-rows");
            removeChildren(attachmentRows);
            let attachments = item.getAttachments({});
            if (displayElement("calendar-task-details-attachment-row", attachments.length > 0)) {
                displayElement("calendar-task-details-attachment-rows", true);
                for (let attachment of attachments) {
                    let url = attachment.calIAttachment.uri.spec;
                    let urlLabel = createXULElement("label");
                    urlLabel.setAttribute("value", url);
                    urlLabel.setAttribute("tooltiptext", url);
                    urlLabel.setAttribute("class", "text-link");
                    urlLabel.setAttribute("crop", "end");
                    urlLabel.setAttribute("onclick",
                                          "if (event.button != 2) launchBrowser(this.value);");
                    urlLabel.setAttribute("context", "taskview-link-context-menu");
                    attachmentRows.appendChild(urlLabel);
                }
            }
        }
    },

    loadCategories: function(event) {
        let panel = event.target;
        let item = document.getElementById("calendar-task-tree").currentTask;
        panel.loadItem(item);
    },

    saveCategories: function(event) {
        let panel = event.target;
        let item = document.getElementById("calendar-task-tree").currentTask;
        let categoriesMap = {};

        for (let cat of item.getCategories({})) {
            categoriesMap[cat] = true;
        }

        for (let cat of panel.categories) {
            if (cat in categoriesMap) {
                delete categoriesMap[cat];
            } else {
                categoriesMap[cat] = false;
            }
        }

        if (categoriesMap.toSource() != "({})") {
            let newItem = item.clone();
            newItem.setCategories(panel.categories.length, panel.categories);

            doTransaction("modify", newItem, newItem.calendar, item, null);
        }
    }
};


/**
 * Updates the currently applied filter for the task view and refreshes the task
 * tree.
 *
 * @param aFilter        The filter name to set.
 */
function taskViewUpdate(aFilter) {
    let tree = document.getElementById("calendar-task-tree");
    let broadcaster = document.getElementById("filterBroadcaster");
    let oldFilter = broadcaster.getAttribute("value");
    let filter = oldFilter;

    if (aFilter && !(aFilter instanceof Event)) {
        filter = aFilter;
    }

    if (filter && (filter != oldFilter)) {
        broadcaster.setAttribute("value", filter);
    }

    // update the filter
    tree.updateFilter(filter || "all");
}

/**
 * Prepares a dialog to send an email to the organizer of the currently selected
 * task in the task view.
 *
 * XXX We already have a function with this name in the event dialog. Either
 * consolidate or make name more clear.
 */
function sendMailToOrganizer() {
    let item = document.getElementById("calendar-task-tree").currentTask;
    if (item != null) {
        let organizer = item.organizer;
        let email = cal.getAttendeeEmail(organizer, true);
        let emailSubject = cal.calGetString("calendar-event-dialog", "emailSubjectReply", [item.title]);
        let identity = item.calendar.getProperty("imip.identity");
        sendMailTo(email, emailSubject, null, identity);
    }
}

/**
 * Handler function to observe changing of the calendar display deck. Updates
 * the task tree if the task view was selected.
 *
 * TODO Consolidate this function and anything connected, its still from times
 * before we had view tabs.
 */
function taskViewObserveDisplayDeckChange(event) {
    let deck = event.target;

    // Bug 309505: The 'select' event also fires when we change the selected
    // panel of calendar-view-box.  Workaround with this check.
    if (deck.id != "calendarDisplayDeck") {
        return;
    }

    // In case we find that the task view has been made visible, we refresh the view.
    if (deck.selectedPanel && deck.selectedPanel.id == "calendar-task-box") {
        let taskFilterGroup = document.getElementById("task-tree-filtergroup");
        taskViewUpdate(taskFilterGroup.value || "all");
    }
}

// Install event listeners for the display deck change and connect task tree to filter field
function taskViewOnLoad() {
    let deck = document.getElementById("calendarDisplayDeck");
    let tree = document.getElementById("calendar-task-tree");

    if (deck && tree) {
        deck.addEventListener("select", taskViewObserveDisplayDeckChange, true);
        tree.textFilterField = "task-text-filter-field";

        // setup the platform-dependent placeholder for the text filter field
        let textFilter = document.getElementById("task-text-filter-field");
        if (textFilter) {
            let base = textFilter.getAttribute("emptytextbase");
            let keyLabel = textFilter.getAttribute(AppConstants.platform == "macosx" ?
                                                   "keyLabelMac" : "keyLabelNonMac");

            textFilter.setAttribute("placeholder", base.replace("#1", keyLabel));
            textFilter.value = "";
        }
    }

    // Setup customizeDone handler for the task action toolbox.
    let toolbox = document.getElementById("task-actions-toolbox");
    toolbox.customizeDone = function(aEvent) {
        MailToolboxCustomizeDone(aEvent, "CustomizeTaskActionsToolbar");
    };

    let toolbarset = document.getElementById("customToolbars");
    toolbox.toolbarset = toolbarset;

    Services.obs.notifyObservers(window, "calendar-taskview-startup-done", false);
}

/**
 * Copy the value of the given link node to the clipboard
 *
 * @param linkNode      The node containing the value to copy to the clipboard
 */
function taskViewCopyLink(linkNode) {
    if (linkNode) {
        let linkAddress = linkNode.value;
        let clipboard = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                                  .getService(Components.interfaces.nsIClipboardHelper);
        clipboard.copyString(linkAddress);
    }
}

window.addEventListener("load", taskViewOnLoad, false);
