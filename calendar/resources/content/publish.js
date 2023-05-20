/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported publishCalendarData, publishCalendarDataDialogResponse,
 *          publishEntireCalendar, publishEntireCalendarDialogResponse
 */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

/**
 * publishCalendarData
 * Show publish dialog, ask for URL and publish all selected items.
 */
function publishCalendarData() {
    let args = {};

    args.onOk = self.publishCalendarDataDialogResponse;

    openDialog("chrome://calendar/content/publishDialog.xul", "caPublishEvents",
               "chrome,titlebar,modal,resizable", args);
}

/**
 * publishCalendarDataDialogResponse
 * Callback method for publishCalendarData() that is called when the user
 * presses the OK button in the publish dialog.
 */
function publishCalendarDataDialogResponse(CalendarPublishObject, aProgressDialog) {
    publishItemArray(currentView().getSelectedItems({}),
                     CalendarPublishObject.remotePath, aProgressDialog);
}

/**
 * publishEntireCalendar
 * Show publish dialog, ask for URL and publish all items from the calendar.
 *
 * @param aCalendar   (optional) The calendar that will be published. If ommitted
 *                               the user will be prompted to select a calendar.
 */
function publishEntireCalendar(aCalendar) {
    if (!aCalendar) {
        let count = {};
        let calendars = getCalendarManager().getCalendars(count);

        if (count.value == 1) {
            // Do not ask user for calendar if only one calendar exists
            aCalendar = calendars[0];
        } else {
            // Ask user to select the calendar that should be published.
            // publishEntireCalendar() will be called again if OK is pressed
            // in the dialog and the selected calendar will be passed in.
            // Therefore return after openDialog().
            let args = {};
            args.onOk = publishEntireCalendar;
            args.promptText = calGetString("calendar", "publishPrompt");
            openDialog("chrome://calendar/content/chooseCalendarDialog.xul",
                       "_blank", "chrome,titlebar,modal,resizable", args);
            return;
        }
    }

    let args = {};
    let publishObject = {};

    args.onOk = self.publishEntireCalendarDialogResponse;

    publishObject.calendar = aCalendar;

    // restore the remote ics path preference from the calendar passed in
    let remotePath = aCalendar.getProperty("remote-ics-path");
    if (remotePath && remotePath.length && remotePath.length > 0) {
        publishObject.remotePath = remotePath;
    }

    args.publishObject = publishObject;
    openDialog("chrome://calendar/content/publishDialog.xul", "caPublishEvents",
               "chrome,titlebar,modal,resizable", args);

    return;
}

/**
 * publishEntireCalendarDialogResponse
 * Callback method for publishEntireCalendar() that is called when the user
 * presses the OK button in the publish dialog.
 */
function publishEntireCalendarDialogResponse(CalendarPublishObject, aProgressDialog) {
    // store the selected remote ics path as a calendar preference
    CalendarPublishObject.calendar.setProperty("remote-ics-path",
                                           CalendarPublishObject.remotePath);

    let itemArray = [];
    let getListener = {
        QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
        onOperationComplete: function(aCalendar, aStatus, aOperationType, aId, aDetail) {
            publishItemArray(itemArray, CalendarPublishObject.remotePath, aProgressDialog);
        },
        onGetResult: function(aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
            if (!Components.isSuccessCode(aStatus)) {
                aborted = true;
                return;
            }
            if (aCount) {
                for (let i = 0; i < aCount; ++i) {
                    // Store a (short living) reference to the item.
                    let itemCopy = aItems[i].clone();
                    itemArray.push(itemCopy);
                }
            }
        }
    };
    aProgressDialog.onStartUpload();
    let oldCalendar = CalendarPublishObject.calendar;
    oldCalendar.getItems(Components.interfaces.calICalendar.ITEM_FILTER_ALL_ITEMS,
                         0, null, null, getListener);
}

function publishItemArray(aItemArray, aPath, aProgressDialog) {
    let outputStream;
    let inputStream;
    let storageStream;

    let icsURL = makeURL(aPath);

    let channel = Services.io.newChannelFromURI2(icsURL,
                                                 null,
                                                 Services.scriptSecurityManager.getSystemPrincipal(),
                                                 null,
                                                 Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                 Components.interfaces.nsIContentPolicy.TYPE_OTHER);
    if (icsURL.schemeIs("webcal")) {
        icsURL.scheme = "http";
    }
    if (icsURL.schemeIs("webcals")) {
        icsURL.scheme = "https";
    }

    switch (icsURL.scheme) {
        case "http":
        case "https":
            channel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
            break;
        case "ftp":
            channel = channel.QueryInterface(Components.interfaces.nsIFTPChannel);
            break;
        case "file":
            channel = channel.QueryInterface(Components.interfaces.nsIFileChannel);
            break;
        default:
            dump("No such scheme\n");
            return;
    }

    let uploadChannel = channel.QueryInterface(Components.interfaces.nsIUploadChannel);
    uploadChannel.notificationCallbacks = notificationCallbacks;

    storageStream = Components.classes["@mozilla.org/storagestream;1"]
                                  .createInstance(Components.interfaces.nsIStorageStream);
    storageStream.init(32768, 0xffffffff, null);
    outputStream = storageStream.getOutputStream(0);

    let serializer = Components.classes["@mozilla.org/calendar/ics-serializer;1"]
                               .createInstance(Components.interfaces.calIIcsSerializer);
    serializer.addItems(aItemArray, aItemArray.length);
    // Outlook requires METHOD:PUBLISH property:
    let methodProp = getIcsService().createIcalProperty("METHOD");
    methodProp.value = "PUBLISH";
    serializer.addProperty(methodProp);
    serializer.serializeToStream(outputStream);
    outputStream.close();

    inputStream = storageStream.newInputStream(0);

    uploadChannel.setUploadStream(inputStream,
                                  "text/calendar", -1);
    try {
        channel.asyncOpen(publishingListener, aProgressDialog);
    } catch (e) {
        let props = Services.strings.createBundle("chrome://calendar/locale/calendar.properties");
        Services.prompt.alert(null, calGetString("calendar", "genericErrorTitle"),
                              props.formatStringFromName("otherPutError", [e.message], 1));
    }
}


var notificationCallbacks = {
    // nsIInterfaceRequestor interface
    getInterface: function(iid, instance) {
        if (iid.equals(Components.interfaces.nsIAuthPrompt)) {
            // use the window watcher service to get a nsIAuthPrompt impl
            return Services.ww.getNewAuthPrompter(null);
        }

        throw Components.results.NS_ERROR_NO_INTERFACE;
    }
};


var publishingListener = {
    QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIStreamListener]),

    onStartRequest: function(request, ctxt) {
    },

    onStopRequest: function(request, ctxt, status, errorMsg) {
        ctxt.wrappedJSObject.onStopUpload();

        let channel;
        let props = Services.strings.createBundle("chrome://calendar/locale/calendar.properties");
        let requestSucceeded;
        try {
            channel = request.QueryInterface(Components.interfaces.nsIHttpChannel);
            requestSucceeded = channel.requestSucceeded;
        } catch (e) {
            // Don't fail if it is not a http channel, will be handled below
        }

        if (channel && !requestSucceeded) {
            Services.prompt.alert(null, calGetString("calendar", "genericErrorTitle"),
                                  props.formatStringFromName("httpPutError", [channel.responseStatus, channel.responseStatusText], 2));
        } else if (!channel && !Components.isSuccessCode(request.status)) {
            // XXX this should be made human-readable.
            Services.prompt.alert(null, calGetString("calendar", "genericErrorTitle"),
                                  props.formatStringFromName("otherPutError", [request.status.toString(16)], 1));
        }
    },

    onDataAvailable: function(request, ctxt, inStream, sourceOffset, count) {
    }
};
