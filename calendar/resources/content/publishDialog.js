/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported loadCalendarPublishDialog, onOKCommand, closeDialog */

var gOnOkFunction;   // function to be called when user clicks OK
var gPublishObject;

/**
*   Called when the dialog is loaded.
*/
function loadCalendarPublishDialog() {
    // Get arguments, see description at top of file

    let args = window.arguments[0];

    gOnOkFunction = args.onOk;

    if (args.publishObject) {
        gPublishObject = args.publishObject;
        if (args.publishObject.remotePath) {
            document.getElementById("publish-remotePath-textbox").value = args.publishObject.remotePath;
        }
    } else {
        gPublishObject = {};
    }
    document.getElementById("calendar-publishwindow").getButton("accept").setAttribute("label", publishButtonLabel);

    checkURLField();

    let firstFocus = document.getElementById("publish-remotePath-textbox");
    firstFocus.focus();
}

/**
*   Called when the OK button is clicked.
*/
function onOKCommand() {
    gPublishObject.remotePath = document.getElementById("publish-remotePath-textbox").value;

    // call caller's on OK function
    gOnOkFunction(gPublishObject, progressDialog);
    document.getElementById("calendar-publishwindow").getButton("accept").setAttribute("label", closeButtonLabel);
    document.getElementById("calendar-publishwindow").setAttribute("ondialogaccept", "closeDialog()");
    return false;
}

function checkURLField() {
    if (document.getElementById("publish-remotePath-textbox").value.length == 0) {
        document.getElementById("calendar-publishwindow").getButton("accept").setAttribute("disabled", "true");
    } else {
        document.getElementById("calendar-publishwindow").getButton("accept").removeAttribute("disabled");
    }
}

function closeDialog() {
    self.close();
}

var progressDialog = {
    onStartUpload: function() {
        document.getElementById("publish-progressmeter").setAttribute("mode", "undetermined");
    },

    onStopUpload: function() {
        document.getElementById("publish-progressmeter").setAttribute("mode", "determined");
    }
};
progressDialog.wrappedJSObject = progressDialog;
