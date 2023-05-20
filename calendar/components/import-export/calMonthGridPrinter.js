/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calXMLUtils.jsm");
Components.utils.import("resource://calendar/modules/calPrintUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

/**
 * Prints a rough month-grid of events/tasks
 */
function calMonthPrinter() {
    this.wrappedJSObject = this;
}

var calMonthPrinterClassID = Components.ID("{f42d5132-92c4-487b-b5c8-38bf292d74c1}");
var calMonthPrinterInterfaces = [Components.interfaces.calIPrintFormatter];
calMonthPrinter.prototype = {
    classID: calMonthPrinterClassID,
    QueryInterface: XPCOMUtils.generateQI(calMonthPrinterInterfaces),

    classInfo: XPCOMUtils.generateCI({
        classID: calMonthPrinterClassID,
        contractID: "@mozilla.org/calendar/printformatter;1?type=monthgrid",
        classDescription: "Calendar Month Grid Print Formatter",
        interfaces: calMonthPrinterInterfaces
    }),

    get name() { return cal.calGetString("calendar", "monthPrinterName"); },

    formatToHtml: function(aStream, aStart, aEnd, aCount, aItems, aTitle) {
        let document = cal.xml.parseFile("chrome://calendar-common/skin/printing/calMonthGridPrinter.html");
        let defaultTimezone = cal.calendarDefaultTimezone();

        // Set page title
        document.getElementById("title").textContent = aTitle;

        // Table that maps YYYY-MM-DD to the DOM node container where items are to be added
        let dayTable = {};

        // Make sure to create tables from start to end, if passed
        if (aStart && aEnd) {
            let startDate = this.normalizeStartDate(aStart);
            let endDate = this.normalizeEndDate(aEnd);
            let weekInfoService = cal.getWeekInfoService();

            // Now set up all the months we need to
            for (let current = startDate.clone();
                 weekInfoService.getEndOfWeek(current.endOfMonth).compare(endDate) < 0;
                 current.month += 1) {
                this.setupMonth(document, current, dayTable);
            }
        }

        for (let item of aItems) {
            let itemStartDate = item[cal.calGetStartDateProp(item)] || item[cal.calGetEndDateProp(item)];
            let itemEndDate = item[cal.calGetEndDateProp(item)] || item[cal.calGetStartDateProp(item)];

            if (!itemStartDate && !itemEndDate) {
                cal.print.addItemToDayboxNodate(document, item);
                continue;
            }
            itemStartDate = itemStartDate.getInTimezone(defaultTimezone);
            itemEndDate = itemEndDate.getInTimezone(defaultTimezone);

            let boxDate = itemStartDate.clone();
            boxDate.isDate = true;
            for (boxDate; boxDate.compare(itemEndDate) < (itemEndDate.isDate ? 0 : 1); boxDate.day++) {
                // Ignore items outside of the range, i.e tasks without start date
                // where the end date is somewhere else.
                if (aStart && aEnd && boxDate &&
                    (boxDate.compare(aStart) < 0 || boxDate.compare(aEnd) >= 0)) {
                    continue;
                }

                let boxDateKey = cal.print.getDateKey(boxDate);

                if (!(boxDateKey in dayTable)) {
                    // Doesn't exist, we need to create a new table for it
                    let startOfMonth = boxDate.startOfMonth;
                    this.setupMonth(document, startOfMonth, dayTable);
                }

                let dayBoxes = dayTable[boxDateKey];
                let addSingleItem = cal.print.addItemToDaybox.bind(cal.print, document, item, boxDate);

                if (Array.isArray(dayBoxes)) {
                    dayBoxes.forEach(addSingleItem);
                } else {
                    addSingleItem(dayBoxes);
                }
            }
        }

        // Remove templates from HTML, no longer needed
        let templates = document.getElementById("templates");
        templates.remove();

        // Stream out the resulting HTML
        let html = cal.xml.serializeDOM(document);
        let convStream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
                                   .createInstance(Components.interfaces.nsIConverterOutputStream);
        convStream.init(aStream, "UTF-8", 0, 0x0000);
        convStream.writeString(html);
    },

    normalizeStartDate: function(aStart) {
        // Make sure the start date is really a date.
        let startDate = aStart.clone();
        startDate.isDate = true;

        // Find out if the start date is also shown in the first week of the
        // following month. This means we can spare a month printout.
        let firstDayOfNextMonth = startDate.clone();
        firstDayOfNextMonth.day = 1;
        firstDayOfNextMonth.month++;
        if (cal.getWeekInfoService().getStartOfWeek(firstDayOfNextMonth).compare(startDate) <= 0) {
            startDate = firstDayOfNextMonth;
        } else {
            startDate = startDate.startOfMonth;
        }
        return startDate;
    },

    normalizeEndDate: function(aEnd) {
        // Copy end date, which is exclusive. For our calculations, we will
        // only be handling dates and the formatToHtml() code is much cleaner with
        // the range being inclusive.
        let endDate = aEnd.clone();
        endDate.isDate = true;

        // Find out if the end date is also shown in the last week of the
        // previous month. This also means we can spare a month printout.
        lastDayOfPreviousMonth = endDate.clone();
        lastDayOfPreviousMonth.month--;
        lastDayOfPreviousMonth = lastDayOfPreviousMonth.endOfMonth;
        if (cal.getWeekInfoService().getEndOfWeek(lastDayOfPreviousMonth).compare(endDate) >= 0) {
            endDate = lastDayOfPreviousMonth;
        }

        return endDate;
    },

    setupMonth: function(document, startOfMonth, dayTable) {
        let monthTemplate = document.getElementById("month-template");
        let monthContainer = document.getElementById("month-container");

        // Clone the template month and make sure it doesn't have an id
        let currentMonth = monthTemplate.cloneNode(true);
        currentMonth.removeAttribute("id");
        currentMonth.item = startOfMonth.clone();

        // Set up the month title
        let monthName = cal.formatMonth(startOfMonth.month + 1, "calendar", "monthInYear");
        let monthTitle = cal.calGetString("calendar", "monthInYear", [monthName, startOfMonth.year]);
        currentMonth.querySelector(".month-name").textContent = monthTitle;

        // Set up the weekday titles
        let wkst = Preferences.get("calendar.week.start", 0);
        for (let i = 1; i <= 7; i++) {
            let dayNumber = ((i + wkst - 1) % 7) + 1;
            let dayTitle = currentMonth.querySelector(".day" + i + "-title");
            dayTitle.textContent = cal.calGetString("dateFormat", "day." + dayNumber + ".Mmm");
        }

        // Set up each week
        let weekInfoService = cal.getWeekInfoService();
        let endOfMonthView = weekInfoService.getEndOfWeek(startOfMonth.endOfMonth);
        let startOfMonthView = weekInfoService.getStartOfWeek(startOfMonth);
        let mainMonth = startOfMonth.month;
        let weekContainer = currentMonth.querySelector(".week-container");

        for (let weekStart = startOfMonthView; weekStart.compare(endOfMonthView) < 0; weekStart.day += 7) {
            this.setupWeek(document, weekContainer, weekStart, mainMonth, dayTable);
        }

        // Now insert the month into the page container, sorting by date (and therefore by month)
        function compareDates(a, b) {
            return !a || !b ? -1 : a.compare(b);
        }

        cal.binaryInsertNode(monthContainer, currentMonth, currentMonth.item, compareDates);
    },

    setupWeek: function(document, weekContainer, startOfWeek, mainMonth, dayTable) {
        const weekdayMap = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        let weekTemplate = document.getElementById("week-template");

        // Clone the template week and make sure it doesn't have an id
        let currentWeek = weekTemplate.cloneNode(true);
        currentWeek.removeAttribute("id");

        // Set up day numbers for all days in this week
        let currentDate = startOfWeek.clone();
        for (let i = 1; i <= 7; i++) {
            let dayNumber = currentWeek.querySelector(".day" + i + "-number");
            let dayContainer = currentWeek.querySelector(".day" + i + "-container");
            let dayBox = currentWeek.querySelector(".day" + i + "-box");
            let dateKey = cal.print.getDateKey(currentDate);
            dayNumber.textContent = currentDate.day;

            // We need to support adding multiple boxes, since the months have
            // overlapping days.
            if (dateKey in dayTable) {
                if (Array.isArray(dayTable[dateKey])) {
                    dayTable[dateKey].push(dayContainer);
                } else {
                    dayTable[dateKey] = [dayTable[dateKey], dayContainer];
                }
            } else {
                dayTable[dateKey] = dayContainer;
            }

            let weekDay = currentDate.weekday;
            let dayOffPrefName = "calendar.week.d" + weekDay + weekdayMap[weekDay] + "soff";
            if (Preferences.get(dayOffPrefName, false)) {
                dayBox.className += " day-off";
            }

            if (currentDate.month != mainMonth) {
                dayBox.className += " out-of-month";
            }
            currentDate.day++;
        }

        // No need for sorting, setupWeek will be called in sequence
        weekContainer.appendChild(currentWeek);
    }
};
