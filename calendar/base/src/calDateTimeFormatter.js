/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

var nsIScriptableDateFormat = Components.interfaces.nsIScriptableDateFormat;

function calDateTimeFormatter() {
    this.wrappedJSObject = this;
    this.mDateStringBundle = Services.strings.createBundle("chrome://calendar/locale/dateFormat.properties");

    this.mDateService =
        Components.classes["@mozilla.org/intl/scriptabledateformat;1"]
                  .getService(nsIScriptableDateFormat);

    // Do does the month or day come first in this locale?
    this.mMonthFirst = false;

    // If LONG FORMATTED DATE is same as short formatted date,
    // then OS has poor extended/long date config, so use workaround.
    this.mUseLongDateService = true;
    let probeDate =
        Components.classes["@mozilla.org/calendar/datetime;1"]
                  .createInstance(Components.interfaces.calIDateTime);
    probeDate.timezone = UTC();
    probeDate.year = 2002;
    probeDate.month = 3;
    probeDate.day = 5;
    try {
        // We're try/catching the calls to nsScriptableDateFormat since it's
        // outside this module. We're also reusing probeDate rather than
        // creating 3 discrete calDateTimes for performance.
        let probeStringA = this.formatDateShort(probeDate);
        let longProbeString = this.formatDateLong(probeDate);
        probeDate.month = 4;
        let probeStringB = this.formatDateShort(probeDate);
        probeDate.month = 3;
        probeDate.day = 6;
        let probeStringC = this.formatDateShort(probeDate);

        // Compare the index of the first differing character between
        // probeStringA to probeStringB and probeStringA to probeStringC.
        for (let i = 0; i < probeStringA.length; i++) {
            if (probeStringA[i] != probeStringB[i]) {
                this.mMonthFirst = true;
                break;
            } else if (probeStringA[i] != probeStringC[i]) {
                this.mMonthFirst = false;
                break;
            }
        }

        // On Unix extended/long date format may be created using %Ex instead
        // of %x. Some systems may not support it and return "Ex" or same as
        // short string. In that case, don't use long date service, use a
        // workaround hack instead.
        if (longProbeString == null ||
            longProbeString.length < 4 ||
            longProbeString == probeStringA) {
            this.mUseLongDateService = false;
        }
    } catch (e) {
        this.mUseLongDateService = false;
    }
}
var calDateTimeFormatterClassID = Components.ID("{4123da9a-f047-42da-a7d0-cc4175b9f36a}");
var calDateTimeFormatterInterfaces = [Components.interfaces.calIDateTimeFormatter];
calDateTimeFormatter.prototype = {
    classID: calDateTimeFormatterClassID,
    QueryInterface: XPCOMUtils.generateQI(calDateTimeFormatterInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calDateTimeFormatterClassID,
        contractID: "@mozilla.org/calendar/datetime-formatter;1",
        classDescription: "Formats Dates and Times",
        interfaces: calDateTimeFormatterInterfaces,
    }),

    formatDate: function(aDate) {
        // Format the date using user's format preference (long or short)
        let format = Preferences.get("calendar.date.format", 0);
        return (format == 0 ? this.formatDateLong(aDate) : this.formatDateShort(aDate));
    },

    formatDateShort: function(aDate) {
        return this.mDateService.FormatDate("",
                                            nsIScriptableDateFormat.dateFormatShort,
                                            aDate.year,
                                            aDate.month + 1,
                                            aDate.day);
    },

    formatDateLong: function(aDate) {
        let longDate;
        if (this.mUseLongDateService) {
            longDate = this.mDateService.FormatDate("",
                                                    nsIScriptableDateFormat.dateFormatLong,
                                                    aDate.year,
                                                    aDate.month + 1,
                                                    aDate.day);
            // check whether weekday name appears as in Lightning localization. if not, this is
            // probably a minority language without OS support, so we should fall back to compose
            // longDate on our own. May be not needed anymore once bug 441167 is fixed.
            if (!longDate.includes(this.dayName(aDate.weekday)) &&
                !longDate.includes(this.shortDayName(aDate.weekday))) {
                longDate = null;
                this.mUseLongDateService = false;
            }
        }
        if (longDate == null) {
            // HACK We are probably on Linux or have a minority localization and want a string in
            // long format. dateService.dateFormatLong on Linux may return a short string, so
            // build our own.
            longDate = cal.calGetString("calendar", "formatDateLong",
                                        [this.shortDayName(aDate.weekday),
                                         this.formatDayWithOrdinal(aDate.day),
                                         this.shortMonthName(aDate.month),
                                         aDate.year]);
        }
        return longDate;
    },

    formatDateWithoutYear: function(aDate) {
        // Doing this the hard way, because nsIScriptableDateFormat doesn't
        // have a way to not include the year.
        if (this.mMonthFirst) {
            return this.shortMonthName(aDate.month) + " " + this.formatDayWithOrdinal(aDate.day);
        } else {
            return this.formatDayWithOrdinal(aDate.day) + " " + this.shortMonthName(aDate.month);
        }
    },

    formatTime: function(aDate) {
        if (aDate.isDate) {
            return this.mDateStringBundle.GetStringFromName("AllDay");
        }

        return this.mDateService.FormatTime("",
                                            nsIScriptableDateFormat.timeFormatNoSeconds,
                                            aDate.hour,
                                            aDate.minute,
                                            0);
    },

    formatDateTime: function(aDate) {
        let formattedDate = this.formatDate(aDate);
        let formattedTime = this.formatTime(aDate);

        let timeBeforeDate = Preferences.get("calendar.date.formatTimeBeforeDate", false);
        if (timeBeforeDate) {
            return formattedTime + " " + formattedDate;
        } else {
            return formattedDate + " " + formattedTime;
        }
    },

    formatTimeInterval: function(aStartDate, aEndDate) {
        if (!aStartDate && aEndDate) {
            return this.formatTime(aEndDate);
        }
        if (!aEndDate && aStartDate) {
            return this.formatTime(aStartDate);
        }
        if (!aStartDate && !aEndDate) {
            return "";
        }

        // TODO do we need l10n for this?
        // TODO should we check for the same day? The caller should know what
        // he is doing...
        return this.formatTime(aStartDate) + "\u2013" + this.formatTime(aEndDate);
    },

    formatInterval: function(aStartDate, aEndDate) {
        // Check for tasks without start and/or due date
        if (aEndDate == null && aStartDate == null) {
            return calGetString("calendar", "datetimeIntervalTaskWithoutDate");
        } else if (aEndDate == null) {
            let startDateString = this.formatDate(aStartDate);
            let startTime = this.formatTime(aStartDate);
            return calGetString("calendar", "datetimeIntervalTaskWithoutDueDate", [startDateString, startTime]);
        } else if (aStartDate == null) {
            let endDateString = this.formatDate(aEndDate);
            let endTime = this.formatTime(aEndDate);
            return calGetString("calendar", "datetimeIntervalTaskWithoutStartDate", [endDateString, endTime]);
        }
        // Here there are only events or tasks with both start and due date.
        // make sure start and end use the same timezone when formatting intervals:
        let endDate = aEndDate.getInTimezone(aStartDate.timezone);
        let testdate = aStartDate.clone();
        testdate.isDate = true;
        let sameDay = (testdate.compare(endDate) == 0);
        if (aStartDate.isDate) {
            // All-day interval, so we should leave out the time part
            if (sameDay) {
                return this.formatDateLong(aStartDate);
            } else {
                let startDay = this.formatDayWithOrdinal(aStartDate.day);
                let startYear = aStartDate.year;
                let endDay = this.formatDayWithOrdinal(endDate.day);
                let endYear = endDate.year;
                if (aStartDate.year != endDate.year) {
                    let startMonthName = cal.formatMonth(aStartDate.month + 1, "calendar", "daysIntervalBetweenYears");
                    let endMonthName = cal.formatMonth(aEndDate.month + 1, "calendar", "daysIntervalBetweenYears");
                    return cal.calGetString("calendar", "daysIntervalBetweenYears", [startMonthName, startDay, startYear, endMonthName, endDay, endYear]);
                } else if (aStartDate.month == endDate.month) {
                    let startMonthName = cal.formatMonth(aStartDate.month + 1, "calendar", "daysIntervalInMonth");
                    return cal.calGetString("calendar", "daysIntervalInMonth", [startMonthName, startDay, endDay, endYear]);
                } else {
                    let startMonthName = cal.formatMonth(aStartDate.month + 1, "calendar", "daysIntervalBetweenMonths");
                    let endMonthName = cal.formatMonth(aEndDate.month + 1, "calendar", "daysIntervalBetweenMonths");
                    return cal.calGetString("calendar", "daysIntervalBetweenMonths", [startMonthName, startDay, endMonthName, endDay, endYear]);
                }
            }
        } else {
            let startDateString = this.formatDate(aStartDate);
            let startTime = this.formatTime(aStartDate);
            let endDateString = this.formatDate(endDate);
            let endTime = this.formatTime(endDate);
            // non-allday, so need to return date and time
            if (sameDay) {
                // End is on the same day as start, so we can leave out the end date
                if (startTime == endTime) {
                    // End time is on the same time as start, so we can leave out the end time
                    // "5 Jan 2006 13:00"
                    return calGetString("calendar", "datetimeIntervalOnSameDateTime", [startDateString, startTime]);
                } else {
                    // still include end time
                    // "5 Jan 2006 13:00 - 17:00"
                    return calGetString("calendar", "datetimeIntervalOnSameDay", [startDateString, startTime, endTime]);
                }
            } else {
                // Spanning multiple days, so need to include date and time
                // for start and end
                // "5 Jan 2006 13:00 - 7 Jan 2006 9:00"
                return calGetString("calendar", "datetimeIntervalOnSeveralDays", [startDateString, startTime, endDateString, endTime]);
            }
        }
    },

    formatDayWithOrdinal: function(aDay) {
        let ordinalSymbols = this.mDateStringBundle.GetStringFromName("dayOrdinalSymbol").split(",");
        let dayOrdinalSymbol = ordinalSymbols[aDay - 1] || ordinalSymbols[0];
        return aDay + dayOrdinalSymbol;
    },

    _getItemDates: function(aItem) {
        let start = aItem[calGetStartDateProp(aItem)];
        let end = aItem[calGetEndDateProp(aItem)];
        let kDefaultTimezone = calendarDefaultTimezone();
        // Check for tasks without start and/or due date
        if (start) {
            start = start.getInTimezone(kDefaultTimezone);
        }
        if (end) {
            end = end.getInTimezone(kDefaultTimezone);
        }
        // EndDate is exclusive. For all-day events, we ened to substract one day,
        // to get into a format that's understandable.
        if (start && start.isDate && end) {
            end.day -= 1;
        }

        return [start, end];
    },

    formatItemInterval: function(aItem) {
        return this.formatInterval(...this._getItemDates(aItem));
    },

    formatItemTimeInterval: function(aItem) {
        return this.formatTimeInterval(...this._getItemDates(aItem));
    },

    monthName: function(aMonthIndex) {
        let oneBasedMonthIndex = aMonthIndex + 1;
        return this.mDateStringBundle.GetStringFromName("month." + oneBasedMonthIndex + ".name");
    },

    shortMonthName: function(aMonthIndex) {
        let oneBasedMonthIndex = aMonthIndex + 1;
        return this.mDateStringBundle.GetStringFromName("month." + oneBasedMonthIndex + ".Mmm");
    },

    dayName: function(aDayIndex) {
        let oneBasedDayIndex = aDayIndex + 1;
        return this.mDateStringBundle.GetStringFromName("day." + oneBasedDayIndex + ".name");
    },

    shortDayName: function(aDayIndex) {
        let oneBasedDayIndex = aDayIndex + 1;
        return this.mDateStringBundle.GetStringFromName("day." + oneBasedDayIndex + ".Mmm");
    }
};
