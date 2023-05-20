/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/FileUtils.jsm");

/**
 * Handles remembering deleted items.
 *
 * This is (currently) not a real trashcan. Only ids and time deleted is stored.
 * Note also that the code doesn't strictly check the calendar of the item,
 * except when a calendar id is passed to getDeletedDate.
 */
function calDeletedItems() {
    this.wrappedJSObject = this;

    this.completedNotifier = {
        handleResult: function() {},
        handleError: function() {},
        handleCompletion: function() {},
    };
}

var calDeletedItemsClassID = Components.ID("{8e6799af-e7e9-4e6c-9a82-a2413e86d8c3}");
var calDeletedItemsInterfaces = [
    Components.interfaces.calIDeletedItems,
    Components.interfaces.nsIObserver,
    Components.interfaces.calIObserver
];
calDeletedItems.prototype = {

    classID: calDeletedItemsClassID,
    QueryInterface: XPCOMUtils.generateQI(calDeletedItemsInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calDeletedItemsClassID,
        contractID: "@mozilla.org/calendar/deleted-items-manager;1",
        classDescription: "Database containing information about deleted items",
        interfaces: calDeletedItemsInterfaces,
        flags: Components.interfaces.nsIClassInfo.SINGLETON
    }),

    DB_SCHEMA_VERSION: 1,
    STALE_TIME: 30 * 24 * 60 * 60 / 1000, /* 30 days */

    // To make the tests more failsafe, we have an internal notifier function.
    // As the deleted items store is just meant to be a hint, this should not
    // be used in real code.
    completedNotifier: null,

    flush: function() {
        this.ensureStatements();
        this.stmtFlush.params.stale_time = cal.now().nativeTime - this.STALE_TIME;
        this.stmtFlush.executeAsync(this.completedNotifier);
    },

    getDeletedDate: function(aId, aCalId) {
        this.ensureStatements();
        let stmt;
        if (aCalId) {
            stmt = this.stmtGetWithCal;
            stmt.params.calId = aCalId;
        } else {
            stmt = this.stmtGet;
        }

        stmt.params.id = aId;
        try {
            if (stmt.executeStep()) {
                let date = cal.createDateTime();
                date.nativeTime = stmt.row.time_deleted;
                return date.getInTimezone(cal.calendarDefaultTimezone());
            }
        } catch (e) {
            cal.ERROR(e);
        } finally {
            stmt.reset();
        }
        return null;
    },

    markDeleted: function(aItem) {
        this.ensureStatements();
        this.stmtMarkDelete.params.calId = aItem.calendar.id;
        this.stmtMarkDelete.params.id = aItem.id;
        this.stmtMarkDelete.params.time = cal.now().nativeTime;
        this.stmtMarkDelete.params.rid = (aItem.recurrenceId && aItem.recurrenceId.nativeTime) || "";
        this.stmtMarkDelete.executeAsync(this.completedNotifier);
    },

    unmarkDeleted: function(aItem) {
        this.ensureStatements();
        this.stmtUnmarkDelete.params.id = aItem.id;
        this.stmtUnmarkDelete.executeAsync(this.completedNotifier);
    },

    initDB: function() {
        if (this.mDB) {
            // Looks like we've already initialized, exit early
            return;
        }

        let file = FileUtils.getFile("ProfD", ["calendar-data", "deleted.sqlite"]);
        this.mDB = Services.storage.openDatabase(file);

        // If this database needs changing, please start using a real schema
        // management, i.e using PRAGMA user_version and upgrading
        if (!this.mDB.tableExists("cal_deleted_items")) {
            const v1_schema = "cal_id TEXT, id TEXT, time_deleted INTEGER, recurrence_id INTEGER";
            const v1_index = "CREATE INDEX idx_deleteditems ON cal_deleted_items(id,cal_id,recurrence_id)";

            this.mDB.createTable("cal_deleted_items", v1_schema);
            this.mDB.executeSimpleSQL(v1_index);
            this.mDB.executeSimpleSQL("PRAGMA user_version = 1");
        }

        // We will not init the statements now, we can still do that the
        // first time this interface is used. What we should do though is
        // to clean up at shutdown
        cal.addShutdownObserver(this.shutdown.bind(this));
    },

    observe: function(aSubject, aTopic, aData) {
        if (aTopic == "profile-after-change") {
            // Make sure to observe calendar changes so we know when things are
            // deleted. We don't initialize the statements until first use.
            cal.getCalendarManager().addCalendarObserver(this);
        }
    },

    ensureStatements: function() {
        if (!this.mDB) {
            this.initDB();
        }

        if (!this.stmtMarkDelete) {
            let stmt = "INSERT OR REPLACE INTO cal_deleted_items (cal_id, id, time_deleted, recurrence_id) VALUES(:calId, :id, :time, :rid)";
            this.stmtMarkDelete = this.mDB.createStatement(stmt);
        }
        if (!this.stmtUnmarkDelete) {
            let stmt = "DELETE FROM cal_deleted_items WHERE id = :id";
            this.stmtUnmarkDelete = this.mDB.createStatement(stmt);
        }
        if (!this.stmtGetWithCal) {
            let stmt = "SELECT time_deleted FROM cal_deleted_items WHERE cal_id = :calId AND id = :id";
            this.stmtGetWithCal = this.mDB.createStatement(stmt);
        }
        if (!this.stmtGet) {
            let stmt = "SELECT time_deleted FROM cal_deleted_items WHERE id = :id";
            this.stmtGet = this.mDB.createStatement(stmt);
        }
        if (!this.stmtFlush) {
            let stmt = "DELETE FROM cal_deleted_items WHERE time_deleted < :stale_time";
            this.stmtFlush = this.mDB.createStatement(stmt);
        }
    },

    shutdown: function() {
        try {
            let stmts = [
                this.stmtMarkDelete, this.stmtUnmarkDelete, this.stmtGet,
                this.stmtGetWithCal, this.stmtFlush
            ];
            for (let stmt of stmts) {
                stmt.finalize();
            }

            if (this.mDB) {
                this.mDB.asyncClose();
                this.mDB = null;
            }
        } catch (e) {
            cal.ERROR("Error closing deleted items database: " + e);
        }

        cal.getCalendarManager().removeCalendarObserver(this);
    },

    // calIObserver
    onStartBatch: function() {},
    onEndBatch: function() {},
    onModifyItem: function() {},
    onError: function() {},
    onPropertyChanged: function() {},
    onPropertyDeleting: function() {},

    onAddItem: function(aItem) {
        this.unmarkDeleted(aItem);
    },

    onDeleteItem: function(aItem) {
        this.markDeleted(aItem);
    },

    onLoad: function() {
        this.flush();
    }
};
