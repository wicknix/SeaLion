/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calXMLUtils.jsm");

/**
 * HTML Export Plugin
 */
function calHtmlExporter() {
    this.wrappedJSObject = this;
}

var calHtmlExporterClassID = Components.ID("{72d9ab35-9b1b-442a-8cd0-ae49f00b159b}");
var calHtmlExporterInterfaces = [Components.interfaces.calIExporter];
calHtmlExporter.prototype = {
    classID: calHtmlExporterClassID,
    QueryInterface: XPCOMUtils.generateQI(calHtmlExporterInterfaces),

    classInfo: XPCOMUtils.generateCI({
        classID: calHtmlExporterClassID,
        contractID: "@mozilla.org/calendar/export;1?type=html",
        classDescription: "Calendar HTML Exporter",
        interfaces: calHtmlExporterInterfaces
    }),

    getFileTypes: function(aCount) {
        aCount.value = 1;
        let wildmat = "*.html; *.htm";
        let label = cal.calGetString("calendar", "filterHtml", [wildmat]);
        return [{
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIFileType]),
            defaultExtension: "html",
            extensionFilter: wildmat,
            description: label
        }];
    },

    exportToStream: function(aStream, aCount, aItems, aTitle) {
        let document = cal.xml.parseFile("chrome://calendar-common/skin/printing/calHtmlExport.html");
        let itemContainer = document.getElementById("item-container");
        document.getElementById("title").textContent = aTitle || cal.calGetString("calendar", "HTMLTitle");

        // Sort aItems
        aItems.sort((a, b) => {
            let start_a = a[cal.calGetStartDateProp(a)];
            if (!start_a) {
                return -1;
            }
            let start_b = b[cal.calGetStartDateProp(b)];
            if (!start_b) {
                return 1;
            }
            return start_a.compare(start_b);
        });

        for (let item of aItems) {
            let itemNode = document.getElementById("item-template").cloneNode(true);
            itemNode.removeAttribute("id");

            let setupTextRow = function(classKey, propValue, prefixKey) {
                if (propValue) {
                    let prefix = cal.calGetString("calendar", prefixKey);
                    itemNode.querySelector("." + classKey + "key").textContent = prefix;
                    itemNode.querySelector("." + classKey).textContent = propValue;
                } else {
                    let row = itemNode.querySelector("." + classKey + "row");
                    if (row.nextSibling instanceof Components.interfaces.nsIDOMText) {
                        row.nextSibling.remove();
                    }
                    row.remove();
                }
            };

            let startDate = item[cal.calGetStartDateProp(item)];
            let endDate = item[cal.calGetEndDateProp(item)];
            if (startDate || endDate) {
                // This is a task with a start or due date, format accordingly
                let prefixWhen = cal.calGetString("calendar", "htmlPrefixWhen");
                itemNode.querySelector(".intervalkey").textContent = prefixWhen;

                let startNode = itemNode.querySelector(".dtstart");
                let dateString = cal.getDateFormatter().formatItemInterval(item);
                startNode.setAttribute("title", startDate ? startDate.icalString : "none");
                startNode.textContent = dateString;
            } else {
                let row = itemNode.querySelector(".intervalrow");
                row.remove();
                if (row.nextSibling instanceof Components.interfaces.nsIDOMText) {
                    row.nextSibling.remove();
                }
            }

            let itemTitle = (item.isCompleted ? cal.calGetString("calendar", "htmlTaskCompleted", [item.title]) : item.title);
            setupTextRow("summary", itemTitle, "htmlPrefixTitle");

            setupTextRow("location", item.getProperty("LOCATION"), "htmlPrefixLocation");
            setupTextRow("description", item.getProperty("DESCRIPTION"), "htmlPrefixDescription");

            itemContainer.appendChild(itemNode);
        }

        let templates = document.getElementById("templates");
        templates.remove();

        // Convert the javascript string to an array of bytes, using the utf8 encoder
        let convStream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
                                   .createInstance(Components.interfaces.nsIConverterOutputStream);
        convStream.init(aStream, "UTF-8", 0, 0x0000);
        convStream.writeString(cal.xml.serializeDOM(document));
    }
};
