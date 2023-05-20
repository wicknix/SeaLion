/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");

this.EXPORTED_SYMBOLS = ["cal"];
cal.view = {
    /**
      - * Item comparator for inserting items into dayboxes.
      - *
      - * @param a     The first item
      - * @param b     The second item
      - * @return      The usual -1, 0, 1
      - */
    compareItems: function(a, b) {
        if (!a) {
            return -1;
        }
        if (!b) {
            return 1;
        }

        let aIsEvent = cal.isEvent(a);
        let aIsTodo = cal.isToDo(a);

        let bIsEvent = cal.isEvent(b);
        let bIsTodo = cal.isToDo(b);

        // sort todos before events
        if (aIsTodo && bIsEvent) {
            return -1;
        }
        if (aIsEvent && bIsTodo) {
            return 1;
        }

        // sort items of the same type according to date-time
        let aStartDate = a.startDate || a.entryDate || a.dueDate;
        let bStartDate = b.startDate || b.entryDate || b.dueDate;
        let aEndDate = a.endDate || a.dueDate || a.entryDate;
        let bEndDate = b.endDate || b.dueDate || b.entryDate;
        if (!aStartDate || !bStartDate) {
            return 0;
        }

        // sort all day events before events with a duration
        if (aStartDate.isDate && !bStartDate.isDate) {
            return -1;
        }
        if (!aStartDate.isDate && bStartDate.isDate) {
            return 1;
        }

        let cmp = aStartDate.compare(bStartDate);
        if (cmp != 0) {
            return cmp;
        }

        if (!aEndDate || !bEndDate) {
            return 0;
        }
        cmp = aEndDate.compare(bEndDate);
        if (cmp != 0) {
            return cmp;
        }

        cmp = (a.title > b.title) - (a.title < b.title);
        return cmp;
    }
};
