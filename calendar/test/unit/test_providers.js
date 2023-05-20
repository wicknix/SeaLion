/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var icalStringArray = [
    // Comments refer to the range defined in testGetItems().
    // 1: one-hour event
    "BEGIN:VEVENT\n" +
    "DTSTART:20020402T114500Z\n" +
    "DTEND:20020402T124500Z\n" +
    "END:VEVENT\n",
    // 2: Test a zero-length event with DTSTART and DTEND
    "BEGIN:VEVENT\n" +
    "DTSTART:20020402T000000Z\n" +
    "DTEND:20020402T000000Z\n" +
    "END:VEVENT\n",
    // 3: Test a zero-length event with DTSTART and no DTEND
    "BEGIN:VEVENT\n" +
    "DTSTART:20020402T000000Z\n" +
    "END:VEVENT\n",
    // 4: Test a zero-length event with DTEND set and no  DTSTART. Invalid!
    "BEGIN:VEVENT\n" +
    "DTEND:20020402T000000Z\n" +
    "END:VEVENT\n",
    // 5: one-hour event that is outside the range
    "BEGIN:VEVENT\n" +
    "DTSTART:20020401T114500Z\n" +
    "DTEND:20020401T124500Z\n" +
    "END:VEVENT\n",
    // 6: one-hour event that starts outside the range and ends inside.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020401T114500Z\n" +
    "DTEND:20020402T124500Z\n" +
    "END:VEVENT\n",
    // 7:  one-hour event that starts inside the range and ends outside.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020402T114500Z\n" +
    "DTEND:20020403T124500Z\n" +
    "END:VEVENT\n",
    // 8: one-hour event that starts at the end of the range.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020403T000000Z\n" +
    "DTEND:20020403T124500Z\n" +
    "END:VEVENT\n",
    // 9: allday event that starts at start of range and ends at end of range.
    "BEGIN:VEVENT\n" +
    "DTSTART;VALUE=DATE:20020402\n" +
    "DTEND;VALUE=DATE:20020403\n" +
    "END:VEVENT\n",
    // 10: allday event that starts at end of range.
    "BEGIN:VEVENT\n" +
    "DTSTART;VALUE=DATE:20020403\n" +
    "DTEND;VALUE=DATE:20020404\n" +
    "END:VEVENT\n",
    // 11: allday event that ends at start of range. See bug 333363.
    "BEGIN:VEVENT\n" +
    "DTSTART;VALUE=DATE:20020401\n" +
    "DTEND;VALUE=DATE:20020402\n" +
    "END:VEVENT\n",
    // 12: daily recurring allday event. parent item in the range.
    "BEGIN:VEVENT\n" +
    "DTSTART;VALUE=DATE:20020402\n" +
    "DTEND;VALUE=DATE:20020403\n" +
    "RRULE:FREQ=DAILY;INTERVAL=1;COUNT=10\n" +
    "END:VEVENT\n",
    // 13: daily recurring allday event. First occurence in the range.
    "BEGIN:VEVENT\n" +
    "DTSTART;VALUE=DATE:20020401\n" +
    "DTEND;VALUE=DATE:20020402\n" +
    "RRULE:FREQ=DAILY;COUNT=10\n" +
    "END:VEVENT\n",
    // 14: two-daily recurring allday event. Not in the range.
    "BEGIN:VEVENT\n" +
    "DTSTART;VALUE=DATE:20020401\n" +
    "DTEND;VALUE=DATE:20020402\n" +
    "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=10\n" +
    "END:VEVENT\n",
    // 15: daily recurring one-hour event. Parent in the range.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020402T100000Z\n" +
    "DTEND:20020402T110000Z\n" +
    "RRULE:FREQ=DAILY;COUNT=10\n" +
    "END:VEVENT\n",
    // 16: daily recurring one-hour event. Occurrence in the range.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020401T100000Z\n" +
    "DTEND:20020401T110000Z\n" +
    "RRULE:FREQ=DAILY;COUNT=10\n" +
    "END:VEVENT\n",
    // 17: zero-length task with DTSTART and DUE set at start of range.
    "BEGIN:VTODO\n" +
    "DTSTART:20020402T000000Z\n" +
    "DUE:20020402T000000Z\n" +
    "END:VTODO\n",
    // 18: zero-length event with only DTSTART set at start of range.
    "BEGIN:VTODO\n" +
    "DTSTART:20020402T000000Z\n" +
    "END:VTODO\n",
    // 19: zero-length event with only DUE set at start of range.
    "BEGIN:VTODO\n" +
    "DUE:20020402T000000Z\n" +
    "END:VTODO\n",
    // 20: one-hour todo within the range.
    "BEGIN:VTODO\n" +
    "DTSTART:20020402T110000Z\n" +
    "DUE:20020402T120000Z\n" +
    "END:VTODO\n",
    // 21: zero-length todo that starts at end of range.
    "BEGIN:VTODO\n" +
    "DTSTART:20020403T000000Z\n" +
    "DUE:20020403T010000Z\n" +
    "END:VTODO\n",
    // 22: one-hour todo that ends at start of range.
    "BEGIN:VTODO\n" +
    "DTSTART:20020401T230000Z\n" +
    "DUE:20020402T000000Z\n" +
    "END:VTODO\n",
    // 23: daily recurring one-hour event. Parent in the range.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020402T000000\n" +
    "DTEND:20020402T010000\n" +
    "RRULE:FREQ=DAILY;COUNT=10\n" +
    "END:VEVENT\n",
    // 24: daily recurring 24-hour event. Parent in the range.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020402T000000\n" +
    "DTEND:20020403T000000\n" +
    "RRULE:FREQ=DAILY;COUNT=10\n" +
    "END:VEVENT\n",
    // 25: todo that has neither start nor due date set.
    // Should be returned on every getItems() call. See bug 405459.
    "BEGIN:VTODO\n" +
    "SUMMARY:Todo\n" +
    "END:VTODO\n",
    // 26: todo that has neither start nor due date but
    // a completion time set after range. See bug 405459.
    "BEGIN:VTODO\n" +
    "SUMMARY:Todo\n" +
    "COMPLETED:20030404T000001\n" +
    "END:VTODO\n",
    // 27: todo that has neither start nor due date but a
    // completion time set in the range. See bug 405459.
    "BEGIN:VTODO\n" +
    "SUMMARY:Todo\n" +
    "COMPLETED:20020402T120001\n" +
    "END:VTODO\n",
    // 28: todo that has neither start nor due date but a
    // completion time set before the range. See bug 405459.
    "BEGIN:VTODO\n" +
    "SUMMARY:Todo\n" +
    "COMPLETED:20020402T000000\n" +
    "END:VTODO\n",
    // 29: todo that has neither start nor due date set,
    // has the status "COMPLETED" but no completion time. See bug 405459.
    "BEGIN:VTODO\n" +
    "SUMMARY:Todo\n" +
    "STATUS:COMPLETED\n" +
    "END:VTODO\n",
    // 30: one-hour event with duration (in the range). See bug 390492.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020402T114500Z\n" +
    "DURATION:PT1H\n" +
    "END:VEVENT\n",
    // 31: one-hour event with duration (after the range). See bug 390492.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020403T000000Z\n" +
    "DURATION:PT1H\n" +
    "END:VEVENT\n",
    // 32: one-hour event with duration (before the range). See bug 390492.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020401T230000Z\n" +
    "DURATION:PT1H\n" +
    "END:VEVENT\n",
    // 33: one-day event with duration. Starts in the range, Ends outside. See bug 390492.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020402T120000Z\n" +
    "DURATION:P1D\n" +
    "END:VEVENT\n",
    // 34: one-day event with duration. Starts before the range. Ends inside. See bug 390492.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020401T120000Z\n" +
    "DURATION:P1D\n" +
    "END:VEVENT\n",
    // 35: one-day event with duration (before the range). See bug 390492.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020401T000000Z\n" +
    "DURATION:P1D\n" +
    "END:VEVENT\n",
    // 36: one-day event with duration (after the range). See bug 390492.
    "BEGIN:VEVENT\n" +
    "DTSTART:20020403T000000Z\n" +
    "DURATION:P1D\n" +
    "END:VEVENT\n"
];

function run_test() {
    // First entry is test number, second item is expected result for testGetItems().
    let wantedArray = [[1, 1],
                       [2, 1],
                       [3, 1],
                       [5, 0],
                       [6, 1],
                       [7, 1],
                       [8, 0],
                       [9, 1],
                       [10, 0],
                       [11, 0],
                       [12, 1],
                       [13, 1],
                       [14, 0],
                       [15, 1],
                       [16, 1],
                       [17, 1],
                       [18, 1],
                       [19, 1],
                       [20, 1],
                       [21, 0],
                       [22, 0],
                       [23, 1],
                       [24, 1],
                       [25, 1],
                       [26, 1],
                       [27, 1],
                       [28, 0],
                       [29, 1],
                       [30, 1],
                       [31, 0],
                       [32, 0],
                       [33, 1],
                       [34, 1],
                       [35, 0],
                       [36, 0]];

    for (let i = 0; i < wantedArray.length; i++) {
        let itemArray = wantedArray[i];
        // Correct for 1 to stay in synch with test numbers.
        let calItem = icalStringArray[itemArray[0] - 1];

        let item;
        if (calItem.search(/VEVENT/) != -1) {
            item = createEventFromIcalString(calItem);
        } else if (calItem.search(/VTODO/) != -1) {
            item = createTodoFromIcalString(calItem);
        }

        print("Test " + wantedArray[i][0]);
        testGetItems(item, itemArray[1]);
        testGetItem(item);
    }

    /**
     * Adds aItem to a calendar and performs a getItems() call using the
     * following range:
     *   2002/04/02 0:00 - 2002/04/03 0:00
     * The amount of returned items is compared with expected amount (aResult).
     * Additionally, the properties of the returned item are compared with aItem.
     */
    function testGetItems(aItem, aResult) {
        for (let calendar of [getStorageCal(), getMemoryCal()]) {
            checkCalendar(calendar, aItem, aResult);
        }
    }

    function checkCalendar(calendar, aItem, aResult) {
        // construct range
        let rangeStart = createDate(2002, 3, 2); // 3 = April
        let rangeEnd = rangeStart.clone();
        rangeEnd.day += 1;

        // filter options
        let filter = Ci.calICalendar.ITEM_FILTER_TYPE_ALL |
                     Ci.calICalendar.ITEM_FILTER_CLASS_OCCURRENCES |
                     Ci.calICalendar.ITEM_FILTER_COMPLETED_ALL;

        // implement listener
        let count = 0;
        let listener = {
            onOperationComplete: function(aCalendar,
                                          aStatus,
                                          aOperationType,
                                          aId,
                                          aDetail) {
                equal(aStatus, 0);
                if (aOperationType == Ci.calIOperationListener.ADD) {
                    // perform getItems() on calendar
                    aCalendar.getItems(filter, 0, rangeStart, rangeEnd, listener);
                } else if (aOperationType == Ci.calIOperationListener.GET) {
                    equal(count, aResult);
                    do_test_finished();
                }
            },
            onGetResult: function(aCalendar,
                                  aStatus,
                                  aItemType,
                                  aDetail,
                                  aCount,
                                  aItems) {
                if (aCount) {
                    count += aCount;
                    for (let i = 0; i < aCount; i++) {
                        compareItemsSpecific(aItems[i].parentItem, aItem);
                    }
                }
            }
        };

        // add item to calendar
        do_test_pending();
        calendar.addItem(aItem, listener);
    }

    /**
     * (1) Add aItem to a calendar.
     * The properties of the added item are compared with the passed item.
     * (2) Perform a getItem() call.
     * The properties of the returned item are compared with the passed item.
     */
    function testGetItem(aItem) {
        // get calendars
        let calArray = [];
        calArray.push(getStorageCal());
        calArray.push(getMemoryCal());
        for (let calendar of calArray) {
            // implement listener
            let count = 0;
            let returnedItem = null;
            let listener = {
                onOperationComplete: function(aCalendar,
                                              aStatus,
                                              aOperationType,
                                              aId,
                                              aDetail) {
                    equal(aStatus, 0);
                    if (aOperationType == Ci.calIOperationListener.ADD) {
                        compareItemsSpecific(aDetail, aItem);
                        // perform getItem() on calendar
                        aCalendar.getItem(aId, listener);
                    } else if (aOperationType == Ci.calIOperationListener.GET) {
                        equal(count, 1);
                        compareItemsSpecific(returnedItem, aItem);
                    }
                },
                onGetResult: function(aCalendar,
                                      aStatus,
                                      aItemType,
                                      aDetail,
                                      aCount,
                                      aItems) {
                    if (aCount) {
                        count += aCount;
                        returnedItem = aItems[0];
                    }
                }
            };
            // add item to calendar
            calendar.addItem(aItem, listener);
        }
    }

    testMetaData();
}

function testMetaData() {
    function testMetaData_(aCalendar) {
        dump("testMetaData_() calendar type: " + aCalendar.type + "\n");
        let event1 = createEventFromIcalString("BEGIN:VEVENT\n" +
                                               "DTSTART;VALUE=DATE:20020402\n" +
                                               "END:VEVENT\n");

        event1.id = "item1";
        aCalendar.addItem(event1, null);
        aCalendar.setMetaData("item1", "meta1");
        equal(aCalendar.getMetaData("item1"), "meta1");
        equal(aCalendar.getMetaData("unknown"), null);

        let event2 = event1.clone();
        event2.id = "item2";
        aCalendar.addItem(event2, null);
        aCalendar.setMetaData("item2", "meta2-");
        equal(aCalendar.getMetaData("item2"), "meta2-");

        aCalendar.setMetaData("item2", "meta2");
        equal(aCalendar.getMetaData("item2"), "meta2");

        let count = {};
        let ids = {};
        let values = {};
        aCalendar.getAllMetaData(count, ids, values);
        equal(count.value, 2);
        ok(ids.value[0] == "item1" || ids.value[1] == "item1");
        ok(ids.value[0] == "item2" || ids.value[1] == "item2");
        ok(values.value[0] == "meta1" || values.value[1] == "meta1");
        ok(values.value[0] == "meta2" || values.value[1] == "meta2");

        aCalendar.deleteItem(event1, null);
        equal(aCalendar.getMetaData("item1"), null);
        aCalendar.getAllMetaData(count, ids, values);
        equal(count.value, 1);
        ok(ids.value[0] == "item2");
        ok(values.value[0] == "meta2");

        aCalendar.deleteMetaData("item2");
        equal(aCalendar.getMetaData("item2"), null);
        aCalendar.getAllMetaData(count, ids, values);
        equal(count.value, 0);

        aCalendar.setMetaData("item2", "meta2");
        equal(aCalendar.getMetaData("item2"), "meta2");
        aCalendar.QueryInterface(Ci.calICalendarProvider).deleteCalendar(aCalendar, null);
        equal(aCalendar.getMetaData("item2"), null);
        aCalendar.getAllMetaData(count, ids, values);
        equal(count.value, 0);

        aCalendar.deleteMetaData("unknown"); // check graceful return
    }

    testMetaData_(getMemoryCal());
    testMetaData_(getStorageCal());
}
