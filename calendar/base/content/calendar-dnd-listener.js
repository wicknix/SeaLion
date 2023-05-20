/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calAlarmUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

var itemConversion = {

    /**
     * Converts an email message to a calendar item.
     *
     * @param aItem     The target calIItemBase.
     * @param aMessage  The nsIMsgHdr to convert from.
     */
    calendarItemFromMessage: function iC_calendarItemFromMessage(aItem, aMsgHdr) {
        let msgFolder = aMsgHdr.folder;
        let msgUri = msgFolder.getUriForMsg(aMsgHdr);

        aItem.calendar = getSelectedCalendar();
        aItem.title = aMsgHdr.mime2DecodedSubject;

        cal.setDefaultStartEndHour(aItem);
        cal.alarms.setDefaultValues(aItem);

        let messenger = Components.classes["@mozilla.org/messenger;1"]
                                  .createInstance(Components.interfaces.nsIMessenger);
        let streamListener = Components.classes["@mozilla.org/network/sync-stream-listener;1"]
                                       .createInstance(Components.interfaces.nsISyncStreamListener);
        messenger.messageServiceFromURI(msgUri).streamMessage(msgUri,
                                                              streamListener,
                                                              null,
                                                              null,
                                                              false,
                                                              "",
                                                              false);

        let plainTextMessage = "";
        plainTextMessage = msgFolder.getMsgTextFromStream(streamListener.inputStream,
                                                          aMsgHdr.Charset,
                                                          65536,
                                                          32768,
                                                          false,
                                                          true,
                                                          {});
        aItem.setProperty("DESCRIPTION", plainTextMessage);
    },

    /**
     * Copy base item properties from aItem to aTarget. This includes properties
     * like title, location, description, priority, transparency,
     * attendees, categories, calendar, recurrence and possibly more.
     *
     * @param aItem     The item to copy from.
     * @param aTarget   the item to copy to.
     */
    copyItemBase: function iC_copyItemBase(aItem, aTarget) {
        const copyProps = ["SUMMARY", "LOCATION", "DESCRIPTION",
                           "URL", "CLASS", "PRIORITY"];

        for (var prop of copyProps) {
            aTarget.setProperty(prop, aItem.getProperty(prop));
        }

        // Attendees
        var attendees = aItem.getAttendees({});
        for (var attendee of attendees) {
            aTarget.addAttendee(attendee.clone());
        }

        // Categories
        var categories = aItem.getCategories({});
        aTarget.setCategories(categories.length, categories);

        // Organizer
        aTarget.organizer = (aItem.organizer ? aItem.organizer.clone() : null);

        // Calendar
        aTarget.calendar = getSelectedCalendar();

        // Recurrence
        if (aItem.recurrenceInfo) {
            aTarget.recurrenceInfo = aItem.recurrenceInfo.clone();
            aTarget.recurrenceInfo.item = aTarget;
        }
    },

    /**
     * Creates a task from the passed event. This function copies the base item
     * and a few event specific properties (dates, alarms, ...).
     *
     * @param aEvent    The event to copy from.
     * @return          The resulting task.
     */
    taskFromEvent: function iC_taskFromEvent(aEvent) {
        let item = cal.createTodo();

        this.copyItemBase(aEvent, item);

        // Dates and alarms
        if (!aEvent.startDate.isDate && !aEvent.endDate.isDate) {
            // Dates
            item.entryDate = aEvent.startDate.clone();
            item.dueDate = aEvent.endDate.clone();

            // Alarms
            for (let alarm of aEvent.getAlarms({})) {
                item.addAlarm(alarm.clone());
            }
            item.alarmLastAck = (aEvent.alarmLastAck ?
                                 aEvent.alarmLastAck.clone() :
                                 null);
        }

        // Map Status values
        let statusMap = {
            "TENTATIVE": "NEEDS-ACTION",
            "CONFIRMED": "IN-PROCESS",
            "CANCELLED": "CANCELLED"
        };
        if (aEvent.getProperty("STATUS") in statusMap) {
            item.setProperty("STATUS", statusMap[aEvent.getProperty("STATUS")]);
        }
        return item;
    },

    /**
     * Creates an event from the passed task. This function copies the base item
     * and a few task specific properties (dates, alarms, ...). If the task has
     * no due date, the default event length is used.
     *
     * @param aTask     The task to copy from.
     * @return          The resulting event.
     */
    eventFromTask: function iC_eventFromTask(aTask) {
        let item = cal.createEvent();

        this.copyItemBase(aTask, item);

        // Dates and alarms
        item.startDate = aTask.entryDate;
        if (!item.startDate) {
            if (aTask.dueDate) {
                item.startDate = aTask.dueDate.clone();
                item.startDate.minute -= Preferences.get("calendar.event.defaultlength", 60);
            } else {
                item.startDate = cal.getDefaultStartDate();
            }
        }

        item.endDate = aTask.dueDate;
        if (!item.endDate) {
            // Make the event be the default event length if no due date was
            // specified.
            item.endDate = item.startDate.clone();
            item.endDate.minute += Preferences.get("calendar.event.defaultlength", 60);
        }

        // Alarms
        for (let alarm of aTask.getAlarms({})) {
            item.addAlarm(alarm.clone());
        }
        item.alarmLastAck = (aTask.alarmLastAck ?
                             aTask.alarmLastAck.clone() :
                             null);

        // Map Status values
        let statusMap = {
            "NEEDS-ACTION": "TENTATIVE",
            "COMPLETED": "CONFIRMED",
            "IN-PROCESS": "CONFIRMED",
            "CANCELLED": "CANCELLED"
        };
        if (aTask.getProperty("STATUS") in statusMap) {
            item.setProperty("STATUS", statusMap[aTask.getProperty("STATUS")]);
        }
        return item;
    }
};

/**
 * A base class for drag and drop observers
 * @class calDNDBaseObserver
 */
function calDNDBaseObserver() {
    ASSERT(false, "Inheriting objects call calDNDBaseObserver!");
}

calDNDBaseObserver.prototype = {
    // initialize this class's members
    initBase: function calDNDInitBase() {
    },

    getSupportedFlavours: function calDNDGetFlavors() {
        var flavourSet = new FlavourSet();
        flavourSet.appendFlavour("text/calendar");
        flavourSet.appendFlavour("text/x-moz-url");
        flavourSet.appendFlavour("text/x-moz-message");
        flavourSet.appendFlavour("text/unicode");
        flavourSet.appendFlavour("application/x-moz-file");
        return flavourSet;
    },

    /**
     * Action to take when dropping the event.
     */

    onDrop: function calDNDDrop(aEvent, aTransferData, aDragSession) {
        var transferable = Components.classes["@mozilla.org/widget/transferable;1"]
                           .createInstance(Components.interfaces.nsITransferable);
        transferable.init(null);
        transferable.addDataFlavor("text/calendar");
        transferable.addDataFlavor("text/x-moz-url");
        transferable.addDataFlavor("text/x-moz-message");
        transferable.addDataFlavor("text/unicode");
        transferable.addDataFlavor("application/x-moz-file");

        aDragSession.getData(transferable, 0);

        var data = new Object();
        var bestFlavor = new Object();
        var length = new Object();
        transferable.getAnyTransferData(bestFlavor, data, length);

        try {
            data = data.value.QueryInterface(Components.interfaces.nsISupportsString);
        } catch (exc) {
            // we currently only supports strings:
            return;
        }

        // Treat unicode data with VEVENT in it as text/calendar
        if (bestFlavor.value == "text/unicode" && data.toString().includes("VEVENT")) {
            bestFlavor.value = "text/calendar";
        }

        var destCal = getSelectedCalendar();
        switch (bestFlavor.value) {
            case "text/calendar":
#ifdef XP_MACOSX
                // Mac likes to convert all \r to \n, we need to reverse this.
                data = data.data.replace(/\n\n/g, "\r\n");
#endif
                var parser = Components.classes["@mozilla.org/calendar/ics-parser;1"]
                             .createInstance(Components.interfaces.calIIcsParser);
                parser.parseString(data);
                this.onDropItems(parser.getItems({}).concat(parser.getParentlessItems({})));
                break;
            case "text/unicode":
                var droppedUrl = this.retrieveURLFromData(data, bestFlavor.value);
                if (!droppedUrl)
                    return;

                var url = makeURL(droppedUrl);

                var localFileInstance = Components.classes["@mozilla.org/file/local;1"]
                                        .createInstance(Components.interfaces.nsILocalFile);
                localFileInstance.initWithPath(url.path);

                var inputStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                                  .createInstance(Components.interfaces.nsIFileInputStream);
                inputStream.init(localFileInstance,
                                 MODE_RDONLY,
                                 parseInt("0444", 8),
                                 {});

                try {
                    //XXX support csv
                    var importer = Components.classes["@mozilla.org/calendar/import;1?type=ics"]
                                   .getService(Components.interfaces.calIImporter);
                    var items = importer.importFromStream(inputStream, {});
                    this.onDropItems(items);
                }
                finally {
                    inputStream.close();
                }

                break;
            case "application/x-moz-file-promise":
            case "text/x-moz-url":
                var uri = Services.io.newURI(data.toString(), null, null);
                var loader = Components.classes["@mozilla.org/network/unichar-stream-loader;1"]
                             .createInstance(Components.interfaces.nsIUnicharStreamLoader);
                var channel = Services.io.newChannelFromURI2(uri,
                                                             null,
                                                             Services.scriptSecurityManager.getSystemPrincipal(),
                                                             null,
                                                             Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                             Components.interfaces.nsIContentPolicy.TYPE_OTHER);
                channel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;

                var self = this;

                var listener = {

                    // nsIUnicharStreamLoaderObserver:
                    onDetermineCharset: function(loader, context, firstSegment, length) {
                        var charset = null;
                        if (loader && loader.channel) {
                            charset = channel.contentCharset;
                        }
                        if (!charset || charset.length == 0) {
                            charset = "UTF-8";
                        }
                        return charset;
                    },

                    onStreamComplete: function(loader, context, status, unicharString) {
                        var parser = Components.classes["@mozilla.org/calendar/ics-parser;1"]
                                     .createInstance(Components.interfaces.calIIcsParser);
                        parser.parseString(unicharString);
                        self.onDropItems(parser.getItems({}).concat(parser.getParentlessItems({})));
                    }
                };

                try {
                    loader.init(listener, Components.interfaces.nsIUnicharStreamLoader.DEFAULT_SEGMENT_SIZE);
                    channel.asyncOpen(loader, null);
                } catch(e) {
                    Components.utils.reportError(e)
                }
                break;
            case "text/x-moz-message":
                this.onDropMessage(messenger.msgHdrFromURI(data));
                break;
            default:
                ASSERT(false, "unknown data flavour:" + bestFlavor.value+'\n');
                break;
        }
    },

    onDragStart: function calDNDStart(aEvent, aTransferData, aDragAction) {},
    onDragOver: function calDNDOver(aEvent, aFlavor, aDragSession) {},
    onDragExit: function calDNDExit(aEvent, aDragSession) {},

    onDropItems: function calDNDDropItems(aItems) {},
    onDropMessage: function calDNDDropMessage(aMessage) {},


    retrieveURLFromData: function calDNDRetrieveURL(aData, aFlavor) {
        var data;
        switch (aFlavor) {
            case "text/unicode":
                data = aData.toString();
                var separator = data.indexOf("\n");
                if (separator != -1)
                    data = data.substr(0, separator);
                return data;
            case "application/x-moz-file":
                return aData.URL;
            default:
                return null;
        }
    }
};

/**
 * calViewDNDObserver::calViewDNDObserver
 *
 * Drag'n'drop handler for the calendar views. This handler is
 * derived from the base handler and just implements specific actions.
 */
function calViewDNDObserver() {
    this.wrappedJSObject = this;
    this.initBase();
}

calViewDNDObserver.prototype = {
    __proto__: calDNDBaseObserver.prototype,

    /**
     * calViewDNDObserver::onDropItems
     *
     * Gets called in case we're dropping an array of items
     * on one of the calendar views. In this case we just
     * try to add these items to the currently selected calendar.
     */
    onDropItems: function(aItems) {
        var destCal = getSelectedCalendar();
        startBatchTransaction();
        try {
            for (var item of aItems) {
                doTransaction('add', item, destCal, null, null);
            }
        }
        finally {
            endBatchTransaction();
        }
    }
};

/**
 * calMailButtonDNDObserver::calMailButtonDNDObserver
 *
 * Drag'n'drop handler for the 'mail mode'-button. This handler is
 * derived from the base handler and just implements specific actions.
 */
function calMailButtonDNDObserver() {
    this.wrappedJSObject = this;
    this.initBase();
}

calMailButtonDNDObserver.prototype = {
    __proto__: calDNDBaseObserver.prototype,

    /**
     * calMailButtonDNDObserver::onDropItems
     *
     * Gets called in case we're dropping an array of items
     * on the 'mail mode'-button.
     *
     * @param aItems        An array of items to handle.
     */
    onDropItems: function(aItems) {
        if (aItems && aItems.length > 0) {
            let item = aItems[0];
            let recipients = cal.getRecipientList(item.getAttendees({}));
            let identity = item.calendar.getProperty("imip.identity");
            sendMailTo(recipients, item.title, item.getProperty("DESCRIPTION"), identity);
        }
    },

    /**
     * calMailButtonDNDObserver::onDropMessage
     *
     * Gets called in case we're dropping a message
     * on the 'mail mode'-button.
     *
     * @param aMessage     The message to handle.
     */
    onDropMessage: function(aMessage) {
    }
};

/**
 * calCalendarButtonDNDObserver::calCalendarButtonDNDObserver
 *
 * Drag'n'drop handler for the 'calendar mode'-button. This handler is
 * derived from the base handler and just implements specific actions.
 */
function calCalendarButtonDNDObserver() {
    this.wrappedJSObject = this;
    this.initBase();
}

calCalendarButtonDNDObserver.prototype = {
    __proto__: calDNDBaseObserver.prototype,

    /**
     * calCalendarButtonDNDObserver::onDropItems
     *
     * Gets called in case we're dropping an array of items
     * on the 'calendar mode'-button.
     *
     * @param aItems        An array of items to handle.
     */
    onDropItems: function(aItems) {
        for (var item of aItems) {
            var newItem = item;
            if (isToDo(item)) {
                newItem = itemConversion.eventFromTask(item);
            }
            createEventWithDialog(null, null, null, null, newItem);
        }
    },

    /**
     * calCalendarButtonDNDObserver::onDropMessage
     *
     * Gets called in case we're dropping a message on the
     * 'calendar mode'-button. In this case we create a new
     * event from the mail. We open the default event dialog
     * and just use the subject of the message as the event title.
     *
     * @param aMessage     The message to handle.
     */
    onDropMessage: function(aMessage) {
        var newItem = createEvent();
        itemConversion.calendarItemFromMessage(newItem, aMessage);
        createEventWithDialog(null, null, null, null, newItem);
    }
};

/**
 * calTaskButtonDNDObserver::calTaskButtonDNDObserver
 *
 * Drag'n'drop handler for the 'task mode'-button. This handler is
 * derived from the base handler and just implements specific actions.
 */
function calTaskButtonDNDObserver() {
    this.wrappedJSObject = this;
    this.initBase();
}

calTaskButtonDNDObserver.prototype = {
    __proto__: calDNDBaseObserver.prototype,

    /**
     * calTaskButtonDNDObserver::onDropItems
     *
     * Gets called in case we're dropping an array of items
     * on the 'task mode'-button.
     *
     * @param aItems        An array of items to handle.
     */
    onDropItems: function(aItems) {
        for (var item of aItems) {
            var newItem = item;
            if (isEvent(item)) {
                newItem = itemConversion.taskFromEvent(item);
            }
            createTodoWithDialog(null, null, null, newItem);
        }
    },

    /**
     * calTaskButtonDNDObserver::onDropMessage
     *
     * Gets called in case we're dropping a message
     * on the 'task mode'-button.
     *
     * @param aMessage     The message to handle.
     */
    onDropMessage: function(aMessage) {
        var todo = createTodo();
        itemConversion.calendarItemFromMessage(todo, aMessage);
        createTodoWithDialog(null, null, null, todo);
    }
};

/**
 * Invoke a drag session for the passed item. The passed box will be used as a
 * source.
 *
 * @param aItem     The item to drag.
 * @param aXULBox   The XUL box to invoke the drag session from.
 */
function invokeEventDragSession(aItem, aXULBox) {
    let transfer = Components.classes["@mozilla.org/widget/transferable;1"]
                   .createInstance(Components.interfaces.nsITransferable);
    transfer.init(null);
    transfer.addDataFlavor("text/calendar");

    let flavourProvider = {
        QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIFlavorDataProvider]),

        item: aItem,
        getFlavorData: function(aInTransferable, aInFlavor, aOutData, aOutDataLen) {
            if ((aInFlavor == "application/vnd.x-moz-cal-event") ||
                (aInFlavor == "application/vnd.x-moz-cal-task")) {
                aOutData.value = aItem;
                aOutDataLen.value = 1;
            } else {
                ASSERT(false, "error:" + aInFlavor);
            }
        }
    };

    if (isEvent(aItem)) {
      transfer.addDataFlavor("application/vnd.x-moz-cal-event");
      transfer.setTransferData("application/vnd.x-moz-cal-event", flavourProvider, 0);
    } else if (isToDo(aItem)) {
      transfer.addDataFlavor("application/vnd.x-moz-cal-task");
      transfer.setTransferData("application/vnd.x-moz-cal-task", flavourProvider, 0);
    }

    // Also set some normal data-types, in case we drag into another app
    let serializer = Components.classes["@mozilla.org/calendar/ics-serializer;1"]
                               .createInstance(Components.interfaces.calIIcsSerializer);
    serializer.addItems([aItem], 1);

    let supportsString = Components.classes["@mozilla.org/supports-string;1"]
                         .createInstance(Components.interfaces.nsISupportsString);
    supportsString.data = serializer.serializeToString();
    transfer.setTransferData("text/calendar", supportsString, supportsString.data.length * 2);
    transfer.setTransferData("text/unicode", supportsString, supportsString.data.length * 2);

    let action = Components.interfaces.nsIDragService.DRAGDROP_ACTION_MOVE;
    let supArray = Components.classes["@mozilla.org/supports-array;1"]
                   .createInstance(Components.interfaces.nsISupportsArray);
    supArray.AppendElement(transfer);
    aXULBox.sourceObject = aItem;
    try {
        cal.getDragService().invokeDragSession(aXULBox, supArray, null, action);
    } catch (error) {
        // Nothing done here because we only have to catch an exception that occurs when dragging
        // is cancelled with ESC. This is an odd behaviour of the nativeDragService which we have
        // have to cover.
        // Therefore the DND API for calendar should be changed to the new DOM driven DND-API
        // sometime.
    }
}

var calendarViewDNDObserver = new calViewDNDObserver();
var calendarMailButtonDNDObserver = new calMailButtonDNDObserver();
var calendarCalendarButtonDNDObserver = new calCalendarButtonDNDObserver();
var calendarTaskButtonDNDObserver = new calTaskButtonDNDObserver();
