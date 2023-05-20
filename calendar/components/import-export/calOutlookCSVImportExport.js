/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calAlarmUtils.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

var localeEn = {
    headTitle:       "Subject",
    headStartDate:   "Start Date",
    headStartTime:   "Start Time",
    headEndDate:     "End Date",
    headEndTime:     "End Time",
    headAllDayEvent: "All day event",
    headAlarm:       "Reminder on/off",
    headAlarmDate:   "Reminder Date",
    headAlarmTime:   "Reminder Time",
    headCategories:  "Categories",
    headDescription: "Description",
    headLocation:    "Location",
    headPrivate:     "Private",

    valueTrue:       "True",
    valueFalse:      "False",

    dateRe:          /^(\d+)\/(\d+)\/(\d+)$/,
    dateDayIndex:    2,
    dateMonthIndex:  1,
    dateYearIndex:   3,
    dateFormat:      "%m/%d/%y",

    timeRe:          /^(\d+):(\d+):(\d+) (\w+)$/,
    timeHourIndex:   1,
    timeMinuteIndex: 2,
    timeSecondIndex: 3,
    timeAmPmIndex:   4,
    timeAmString:    "AM",
    timePmString:    "PM",
    timeFormat:      "%I:%M:%S %p"
};

var localeNl = {
    headTitle:        "Onderwerp",
    headStartDate:    "Begindatum",
    headStartTime:    "Begintijd",
    headEndDate:      "Einddatum",
    headEndTime:      "Eindtijd",
    headAllDayEvent:  "Evenement, duurt hele dag",
    headAlarm:        "Herinneringen aan/uit",
    headAlarmDate:    "Herinneringsdatum",
    headAlarmTime:    "Herinneringstijd",
    headCategories:   "Categorie�n",
    headDescription:  "Beschrijving",
    headLocation:     "Locatie",
    headPrivate:      "Priv�",

    valueTrue:        "Waar",
    valueFalse:       "Onwaar",

    dateRe:           /^(\d+)-(\d+)-(\d+)$/,
    dateDayIndex:     1,
    dateMonthIndex:   2,
    dateYearIndex:    3,
    dateFormat:       "%d-%m-%y",

    timeRe:           /^(\d+):(\d+):(\d+)$/,
    timeHourIndex:    1,
    timeMinuteIndex:  2,
    timeSecondIndex:  3,
    timeFormat:       "%H:%M:%S"
};

var locales = [localeEn, localeNl];

// Windows line endings, CSV files with LF only can't be read by Outlook.
var exportLineEnding = "\r\n";

// Shared functions
function getOutlookCsvFileTypes(aCount) {
    aCount.value = 1;
    let wildmat = "*.csv";
    let label = cal.calGetString("calendar", "filterOutlookCsv", [wildmat]);
    return [{
        defaultExtension: "csv",
        extensionFilter: wildmat,
        description: label
    }];
}

// Importer
function calOutlookCSVImporter() {
    this.wrappedJSObject = this;
}
var calOutlookCSVImporterClassID = Components.ID("{64a5d17a-0497-48c5-b54f-72b15c9e9a14}");
var calOutlookCSVImporterInterfaces = [Components.interfaces.calIImporter];
calOutlookCSVImporter.prototype = {
    classID: calOutlookCSVImporterClassID,
    QueryInterface: XPCOMUtils.generateQI(calOutlookCSVImporterInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calOutlookCSVImporterClassID,
        contractID: "@mozilla.org/calendar/import;1?type=csv",
        classDescription: "Calendar Outlook CSV Importer",
        interfaces: calOutlookCSVImporterInterfaces
    }),

    getFileTypes: getOutlookCsvFileTypes,

    /**
     * Takes a text block of Outlook-exported Comma Separated Values and tries to
     * parse that into individual events.
     *
     * First line is field names, all quoted with double quotes.  Field names are
     * locale dependendent.  In English the recognized field names are:
     *   "Title","Start Date","Start Time","End Date","End Time","All day event",
     *   "Reminder on/off","Reminder Date","Reminder Time","Categories",
     *   "Description","Location","Private"
     *  The fields "Title" and "Start Date" are mandatory. If "Start Time" misses
     *  the event is set as all day event. If "End Date" or "End Time" miss the
     *  default durations are set.
     *
     * The rest of the lines are events, one event per line, with fields in the
     * order descibed by the first line.   All non-empty values must be quoted.
     *
     * Returns: an array of parsed calendarEvents.
     *   If the parse is cancelled, a zero length array is returned.
     */
    importFromStream: function(aStream, aCount) {
        let scriptableInputStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
                                              .createInstance(Components.interfaces.nsIScriptableInputStream);
        scriptableInputStream.init(aStream);
        let str = scriptableInputStream.read(-1);

        // parse header line of quoted comma separated column names.
        let trimEndQuotesRegExp = /^"(.*)"$/m;
        let trimResults = trimEndQuotesRegExp.exec(str);
        let header = trimResults && trimResults[1].split(/","/);
        if (header == null) {
            aCount.value = 0;
            return [];
        }

        // strip header from string
        str = str.slice(trimResults[0].length);

        let args = {};
        // args.fieldList contains the field names from the first row of CSV
        args.fieldList = header;

        let knownIndxs;
        let locale = localeEn;
        for (let loc of locales) {
            knownIndxs = 0;
            args.titleIndex = 0;
            args.startDateIndex = 0;
            for (let i = 1; i <= header.length; ++i) {
                switch (header[i - 1]) {
                    /* eslint-disable max-statements-per-line */
                    case loc.headTitle: args.titleIndex = i; knownIndxs++; break;
                    case loc.headStartDate: args.startDateIndex = i; knownIndxs++; break;
                    case loc.headStartTime: args.startTimeIndex = i; knownIndxs++; break;
                    case loc.headEndDate: args.endDateIndex = i; knownIndxs++; break;
                    case loc.headEndTime: args.endTimeIndex = i; knownIndxs++; break;
                    case loc.headAllDayEvent: args.allDayIndex = i; knownIndxs++; break;
                    case loc.headAlarm: args.alarmIndex = i; knownIndxs++; break;
                    case loc.headAlarmDate: args.alarmDateIndex = i; knownIndxs++; break;
                    case loc.headAlarmTime: args.alarmTimeIndex = i; knownIndxs++; break;
                    case loc.headCategories: args.categoriesIndex = i; knownIndxs++; break;
                    case loc.headDescription: args.descriptionIndex = i; knownIndxs++; break;
                    case loc.headLocation: args.locationIndex = i; knownIndxs++; break;
                    case loc.headPrivate: args.privateIndex = i; knownIndxs++; break;
                    /* eslint-enable max-statements-per-line */
                }
            }
            // Were both mandatory fields recognized?
            if (args.titleIndex != 0 && args.startDateIndex != 0) {
                locale = loc;
                break;
            }
        }

        if (knownIndxs == 0 && header.length == 22) {
            // set default indexes for a default Outlook2000 CSV file
            args.titleIndex = 1;
            args.startDateIndex = 2;
            args.startTimeIndex = 3;
            args.endDateIndex = 4;
            args.endTimeIndex = 5;
            args.allDayIndex = 6;
            args.alarmIndex = 7;
            args.alarmDateIndex = 8;
            args.alarmTimeIndex = 9;
            args.categoriesIndex = 15;
            args.descriptionIndex = 16;
            args.locationIndex = 17;
            args.privateIndex = 20;
        }

        if (args.titleIndex == 0 || args.startDateIndex == 0) {
            dump("Can't import. Life sucks\n");
            aCount.value = 0;
            return [];
        }

        // Construct event regexp according to field indexes. The regexp can
        // be made stricter, if it seems this matches too loosely.
        let regExpStr = "^";
        for (let i = 1; i <= header.length; i++) {
            if (i > 1) {
                regExpStr += ",";
            }
            regExpStr += "(?:\"((?:[^\"]|\"\")*)\")?";
        }
        regExpStr += "$";

        // eventRegExp: regexp for reading events (this one'll be constructed on fly)
        const eventRegExp = new RegExp(regExpStr, "gm");

        // match first line
        let eventFields = eventRegExp.exec(str);

        if (eventFields == null) {
            aCount.value = 0;
            return [];
        }

        args.boolStr = localeEn.valueTrue;
        args.boolIsTrue = true;

        let eventArray = [];
        do {
            // At this point eventFields contains following fields. Position
            // of fields is in args.[fieldname]Index.
            //    subject, start date, start time, end date, end time,
            //    all day, alarm on, alarm date, alarm time,
            //    Description, Categories, Location, Private
            // Unused fields (could maybe be copied to Description):
            //    Meeting Organizer, Required Attendees, Optional Attendees,
            //    Meeting Resources, Billing Information, Mileage, Priority,
            //    Sensitivity, Show time as

            let title = ("titleIndex" in args
                         ? this.parseTextField(eventFields[args.titleIndex]) : "");
            let sDate = this.parseDateTime(eventFields[args.startDateIndex],
                                           eventFields[args.startTimeIndex],
                                           locale);
            let eDate = this.parseDateTime(eventFields[args.endDateIndex],
                                           eventFields[args.endTimeIndex],
                                           locale);
            // Create an event only if we have a startDate. No more checks
            // on sDate needed in the following process.
            if (sDate) {
                let event = cal.createEvent();

                // Use column head in brackets if event title misses in data.
                if (title) {
                    event.title = title;
                } else {
                    event.title = "[" + locale.headTitle + "]";
                }

                // Check data for all day event. Additionally sDate.isDate
                // may have been set in parseDateTime() if no time was found
                if (eventFields[args.allDayIndex] == locale.valueTrue) {
                    sDate.isDate = true;
                }
                if (locale.valueTrue == eventFields[args.privateIndex]) {
                    event.privacy = "PRIVATE";
                }

                if (!eDate) {
                    // No endDate was found. All day events last one day and
                    // timed events last the default length.
                    eDate = sDate.clone();
                    if (sDate.isDate) {
                        // end date is exclusive, so set to next day after start.
                        eDate.day += 1;
                    } else {
                        eDate.minute += Preferences.get("calendar.event.defaultlength", 60);
                    }
                } else if (sDate.isDate) {
                    // A time part for the startDate is missing or was
                    // not recognized. We have to throw away the endDates
                    // time part too for obtaining a valid event.
                    eDate.isDate = true;
                    // Correct the eDate if duration is less than one day.
                    if (eDate.subtractDate(sDate).days < 1) {
                        eDate = sDate.clone();
                        eDate.day += 1;
                    }
                } else {
                    // We now have a timed startDate and an endDate. If the
                    // end time is invalid set it to 23:59:00
                    if (eDate.isDate) {
                        eDate.isDate = false;
                        eDate.hour = 23;
                        eDate.minute = 59;
                    }
                    // Correct the duration to 0 seconds if it is negative.
                    if (eDate.subtractDate(sDate).isNegative) {
                        eDate = sDate.clone();
                    }
                }
                event.startDate = sDate;
                event.endDate = eDate;

                // Exists an alarm true/false column?
                if ("alarmIndex" in args) {
                    // Is an alarm wanted for this event?
                    if (locale.valueTrue == eventFields[args.alarmIndex]) {
                        let alarmDate =
                                this.parseDateTime(eventFields[args.alarmDateIndex],
                                                   eventFields[args.alarmTimeIndex],
                                                   locale);
                        // Only set the alarm if a date was parsed
                        if (alarmDate) {
                            let alarm = cal.createAlarm();
                            alarm.related = alarm.ALARM_RELATED_ABSOLUTE;
                            alarm.alarmDate = alarmDate;
                            event.addAlarm(alarm);
                        } else {
                            // XXX Is this really wanted here?
                            cal.alarms.setDefaultValues(event);
                        }
                    }
                }

                // Using the "Private" field only for getting privacy status.
                // "Sensitivity" is neglected for now.
                if ("privateIndex" in args) {
                    if (locale.valueTrue == eventFields[args.privateIndex]) {
                        event.privacy = "PRIVATE";
                    }
                }

                // Avoid setting empty properties
                let txt = "";
                if ("descriptionIndex" in args) {
                    txt = this.parseTextField(eventFields[args.descriptionIndex]);
                    if (txt) {
                        event.setProperty("DESCRIPTION", txt);
                    }
                }
                if ("categoriesIndex" in args) {
                    txt = this.parseTextField(eventFields[args.categoriesIndex]);
                    if (txt) {
                        let categories = cal.categoriesStringToArray(txt);
                        event.setCategories(categories.length, categories);
                    }
                }
                if ("locationIndex" in args) {
                    txt = this.parseTextField(eventFields[args.locationIndex]);
                    if (txt) {
                        event.setProperty("LOCATION", txt);
                    }
                }

                // save the event into return array
                eventArray.push(event);
            }

            // get next events fields
            eventFields = eventRegExp.exec(str);
        } while (eventRegExp.lastIndex != 0);

        // return results
        aCount.value = eventArray.length;
        return eventArray;
    },

    parseDateTime: function(aDate, aTime, aLocale) {
        let date = cal.createDateTime();

        // XXX Can we do better?
        date.timezone = cal.floating();

        let datepart = aLocale.dateRe.exec(aDate);
        let timepart = aLocale.timeRe.exec(aTime);

        if (!datepart) {
            return null;
        }

        date.year = datepart[aLocale.dateYearIndex];
        date.month = datepart[aLocale.dateMonthIndex] - 1;
        date.day = datepart[aLocale.dateDayIndex];
        if (timepart) {
            date.hour = Number(timepart[aLocale.timeHourIndex]);
            date.minute = timepart[aLocale.timeMinuteIndex];
            date.second = timepart[aLocale.timeSecondIndex];
        } else {
            date.isDate = true;
        }

        if (timepart && aLocale.timeAmPmIndex &&
            timepart[aLocale.timeAmPmIndex] != aLocale.timePmString) {
            // AM
            if (date.hour == 12) {
                date.hour = 0;
            }
        } else if (date.hour < 12) {
            // PM
            date.hour += 12;
        }
        return date;
    },

    parseTextField: function(aTextField) {
        return aTextField ? aTextField.replace(/""/g, "\"") : "";
    }
};

// Exporter
function calOutlookCSVExporter() {
}
var calOutlookCSVExporterClassID = Components.ID("{48e6d3a6-b41b-4052-9ed2-40b27800bd4b}");
var calOutlookCSVExporterInterfaces = [Components.interfaces.calIExporter];
calOutlookCSVExporter.prototype = {
    classID: calOutlookCSVExporterClassID,
    QueryInterface: XPCOMUtils.generateQI(calOutlookCSVExporterInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calOutlookCSVExporterClassID,
        contractID: "@mozilla.org/calendar/export;1?type=csv",
        classDescription: "Calendar Outlook CSV Exporter",
        interfaces: calOutlookCSVExporterInterfaces
    }),

    getFileTypes: getOutlookCsvFileTypes,

    exportToStream: function(aStream, aCount, aItems) {
        // Helper functions
        function dateString(aDateTime) { return cal.dateTimeToJsDate(aDateTime).toLocaleFormat(localeEn.dateFormat); }
        function timeString(aDateTime) { return cal.dateTimeToJsDate(aDateTime).toLocaleFormat(localeEn.timeFormat); }
        function txtString(aString) { return aString || ""; }

        let str = "";
        let headers = [];
        // Not using a loop here, since we need to be sure the order here matches
        // with the orders the field data is added later on
        headers.push(localeEn.headTitle);
        headers.push(localeEn.headStartDate);
        headers.push(localeEn.headStartTime);
        headers.push(localeEn.headEndDate);
        headers.push(localeEn.headEndTime);
        headers.push(localeEn.headAllDayEvent);
        headers.push(localeEn.headAlarm);
        headers.push(localeEn.headAlarmDate);
        headers.push(localeEn.headAlarmTime);
        headers.push(localeEn.headCategories);
        headers.push(localeEn.headDescription);
        headers.push(localeEn.headLocation);
        headers.push(localeEn.headPrivate);
        headers = headers.map(hdr => '"' + hdr + '"');
        str = headers.join(",");
        str += exportLineEnding;
        aStream.write(str, str.length);

        for (let item of aItems) {
            if (!cal.isEvent(item)) {
                // XXX TODO: warn the user (once) that tasks are not supported
                // (bug 336175)
                continue;
            }
            let line = [];
            line.push(item.title);
            line.push(dateString(item.startDate));
            line.push(timeString(item.startDate));
            line.push(dateString(item.endDate));
            line.push(timeString(item.endDate));
            line.push(item.startDate.isDate ? localeEn.valueTrue : localeEn.valueFalse);
            let alarmDate;
            let alarms = item.getAlarms({});
            if (alarms.length) {
                alarmDate = cal.alarms.calculateAlarmDate(item, alarms[0]);
            }
            line.push(alarmDate ? localeEn.valueTrue : localeEn.valueFalse);
            line.push(alarmDate ? dateString(alarmDate) : "");
            line.push(alarmDate ? timeString(alarmDate) : "");
            line.push(txtString(cal.categoriesArrayToString(item.getCategories({})))); // xxx todo: what's the correct way to encode ',' in csv?, how are multi-values expressed?
            line.push(txtString(item.getProperty("DESCRIPTION")));
            line.push(txtString(item.getProperty("LOCATION")));
            line.push(item.privacy == "PRIVATE" ? localeEn.valueTrue : localeEn.valueFalse);

            line = line.map(value => `"${String(value).replace(/"/g, '""')}"`);
            str = line.join(",") + exportLineEnding;

            let converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                      .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
            converter.charset = "UTF-8";
            str = converter.ConvertFromUnicode(str);

            aStream.write(str, str.length);
        }
    }
};
