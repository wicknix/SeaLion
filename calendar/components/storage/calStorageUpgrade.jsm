/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Welcome to the storage database migration.
 *
 * If you would like to change anything in the database schema, you must follow
 * some steps to make sure that upgrading from old versions works fine.
 *
 * First of all you must increment the DB_SCHEMA_VERSION variable below. Then
 * you must write your upgrader. To do this, create a new function and add it to
 * the upgrade object, similar to the existing upgraders below. An example is
 * given below.
 *
 * An upgrader MUST update both the database (if it is passed) AND the table
 * data javascript object. An example for a such object is in the v1/v2
 * upgrader. The process of upgrading calls the latest upgrader with the
 * database object and the current database version. The whole chain of
 * upgraders is then called (down to v1). The first upgrader (v1/v2) provides
 * the basic table data object. Each further upgrader then updates this object
 * to correspond with the database tables and columns. No actual database calls
 * are made until the first upgrader with a higher version than the current
 * database version is called. When this version is arrived, both the table data
 * object and the database are updated. This process continues until the
 * database is at the latest version.
 *
 * Note that your upgrader is not neccessarily called with a database object,
 * for example if the user's database is already at a higher version. In this
 * case your upgrader is called to compile the table data object. To make
 * calling code easier, there are a bunch of helper functions below that can be
 * called with a null database object and only call the database object if it is
 * not null. If you need to call new functions on the database object, check out
 * the createDBDelegate function below.
 *
 * When adding new tables to the table data object, please note that there is a
 * special prefix for indexes. These are also kept in the table data object to
 * make sure that getAllSql also includes CREATE INDEX statements. New tables
 * MUST NOT be prefixed with "idx_". If you would like to add a new index,
 * please use the createIndex function.
 *
 * The basic structure for an upgrader is (NN is current version, XX = NN - 1)
 *
 * upgrader.vNN = function upgrade_vNN(db, version) {
 *     let tbl = upgrade.vXX(version < XX && db, version);
 *     LOGdb(db, "Storage: Upgrading to vNN");
 *
 *     beginTransaction(db);
 *     try {
 *         // Do stuff here
 *         setDbVersionAndCommit(db, NN);
 *     } catch (e) {
 *         throw reportErrorAndRollback(db, e);
 *     }
 *     return tbl;
 * }
 *
 * Regardless of how your upgrader looks, make sure you:
 * - use an sql transaction, if you have a database
 * - If everything succeeds, call setDbVersionAndCommit to update the database
 *     version (setDbVersionAndCommit also commits the transaction)
 * - If something fails, throw reportErrorAndRollback(db, e) to report the
 *     failure and roll back the transaction.
 *
 * If this documentation isn't sufficient to make upgrading understandable,
 * please file a bug.
 */

/* exported upgradeDB */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calStorageHelpers.jsm");

// The current database version. Be sure to increment this when you create a new
// updater.
var DB_SCHEMA_VERSION = 22;

var EXPORTED_SYMBOLS = ["DB_SCHEMA_VERSION", "getSql", "getAllSql", "getSqlTable", "upgradeDB", "backupDB"];

/**
 * Gets the SQL for the given table data and table name. This can be both a real
 * table or the name of an index. Indexes must contain the idx_ prefix.
 *
 * @param tblName       The name of the table or index to retrieve sql for
 * @param tblData       The table data object, as returned from the upgrade_v*
 *                        functions. If null, then the latest table data is
 *                        retrieved.
 * @param alternateName (optional) The table or index name to be used in the
 *                        resulting CREATE statement. If not set, tblName will
 *                        be used.
 * @return              The SQL Statement for the given table or index and
 *                        version as a string.
 */
function getSql(tblName, tblData, alternateName) {
    tblData = tblData || getSqlTable();
    let altName = alternateName || tblName;
    let sql;
    if (tblName.substr(0, 4) == "idx_") {
        // If this is an index, we need construct the SQL differently
        let idxTbl = tblData[tblName].shift();
        let idxOn = idxTbl + "(" + tblData[tblName].join(",") + ")";
        sql = "CREATE INDEX " + altName + " ON " + idxOn + ";";
    } else {
        sql = "CREATE TABLE " + altName + " (\n";
        for (let [key, type] of Object.entries(tblData[tblName])) {
            sql += "    " + key + " " + type + ",\n";
        }
    }

    return sql.replace(/,\s*$/, ");");
}

/**
 * Gets all SQL for the given table data
 *
 * @param version       The database schema version to retrieve. If null, the
 *                        latest schema version will be used.
 * @return              The SQL Statement for the given version as a string.
 */
function getAllSql(version) {
    let tblData = getSqlTable(version);
    let sql = "";
    for (let tblName in tblData) {
        sql += getSql(tblName, tblData) + "\n\n";
    }
    cal.LOG("Storage: Full SQL statement is " + sql);
    return sql;
}

/**
 * Get the JS object corresponding to the given schema version. This object will
 * contain both tables and indexes, where indexes are prefixed with "idx_".
 *
 * @param schemaVersion       The schema version to get. If null, the latest
 *                              schema version will be used.
 * @return                    The javascript object containing the table
 *                              definition.
 */
function getSqlTable(schemaVersion) {
    let version = "v" + (schemaVersion || DB_SCHEMA_VERSION);
    if (version in upgrade) {
        return upgrade[version]();
    } else {
        return {};
    }
}

/**
 * Gets the current version of the storage database
 */
function getVersion(db) {
    let selectSchemaVersion;
    let version = null;

    try {
        selectSchemaVersion = createStatement(db,
                              "SELECT version FROM " +
                              "cal_calendar_schema_version LIMIT 1");
        if (selectSchemaVersion.executeStep()) {
            version = selectSchemaVersion.row.version;
        }

        if (version !== null) {
            // This is the only place to leave this function gracefully.
            return version;
        }
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    } finally {
        if (selectSchemaVersion) {
            selectSchemaVersion.reset();
        }
    }

    throw "cal_calendar_schema_version SELECT returned no results";
}

/**
 * Backup the database and notify the user via error console of the process
 */
function backupDB(db, currentVersion) {
    cal.LOG("Storage: Backing up current database...");
    try {
        // Prepare filenames and path
        let backupFilename = "local.v" + currentVersion + ".sqlite";
        let backupPath = cal.getCalendarDirectory();
        backupPath.append("backup");
        if (!backupPath.exists()) {
            backupPath.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, parseInt("0755", 8));
        }

        // Create a backup file and notify the user via WARN, since LOG will not
        // be visible unless a pref is set.
        let file = Services.storage.backupDatabaseFile(db.databaseFile, backupFilename, backupPath);
        cal.WARN("Storage: Upgrading to v" + DB_SCHEMA_VERSION + ", a backup was written to: " + file.path);
    } catch (e) {
        cal.ERROR("Storage: Error creating backup file: " + e);
    }
}

/**
 * Upgrade the passed database.
 *
 * @param db        The database to bring up to date.
 */
function upgradeDB(db) {
    cal.ASSERT(db, "Database has not been opened!", true);
    if (db.tableExists("cal_calendar_schema_version")) {
        let version = getVersion(db);
        if (version < DB_SCHEMA_VERSION) {
            // First, create a backup
            backupDB(db, version);

            // Then start the latest upgrader
            cal.LOG("Storage: Preparing to upgrade v" + version +
                    " to v" + DB_SCHEMA_VERSION);
            upgrade["v" + DB_SCHEMA_VERSION](db, version);
        } else if (version > DB_SCHEMA_VERSION) {
            throw Components.interfaces.calIErrors.STORAGE_UNKNOWN_SCHEMA_ERROR;
        }
    } else {
        cal.LOG("Storage: Creating tables from scratch");
        beginTransaction(db);
        try {
            executeSimpleSQL(db, getAllSql());
            setDbVersionAndCommit(db, DB_SCHEMA_VERSION);
        } catch (e) {
            reportErrorAndRollback(db, e);
        }
    }

    ensureUpdatedTimezones(db);
}

/**
 * Sets the db version and commits any open transaction.
 *
 * @param db        The mozIStorageConnection to commit on
 * @param version   The version to set
 */
function setDbVersionAndCommit(db, version) {
    executeSimpleSQL(db, "DELETE FROM cal_calendar_schema_version;" +
                         "INSERT INTO cal_calendar_schema_version " +
                         "(version) VALUES (" + version + ")");
    if (db && db.transactionInProgress) {
        commitTransaction(db);
    }
}

/**
 * Creates a function that calls the given function |funcName| on it's passed
 * database. In addition, if no database is passed, the call is ignored.
 *
 * @param funcName      The function name to delegate.
 * @return              The delegate function for the passed named function.
 */
function createDBDelegate(funcName) {
    return function(db, ...args) {
        if (db) {
            try {
                return db[funcName](...args);
            } catch (e) {
                cal.ERROR("Error calling '" + funcName + "' db error: '" +
                          lastErrorString(db) + "'.\nException: " + e);
                cal.WARN(cal.STACK(10));
            }
        }
        return null;
    };
}

/**
 * Creates a delegate function for a database getter. Returns a function that
 * can be called to get the specified attribute, if a database is passed. If no
 * database is passed, no error is thrown but null is returned.
 *
 * @param getterAttr        The getter to delegate.
 * @return                  The function that delegates the getter.
 */
function createDBDelegateGetter(getterAttr) {
    return function(db) {
        return (db ? db[getterAttr] : null);
    };
}

// These functions use the db delegate to allow easier calling of common
// database functions.
var beginTransaction = createDBDelegate("beginTransaction");
var commitTransaction = createDBDelegate("commitTransaction");
var rollbackTransaction = createDBDelegate("rollbackTransaction");
var createStatement = createDBDelegate("createStatement");
var executeSimpleSQL = createDBDelegate("executeSimpleSQL");
var removeFunction = createDBDelegate("removeFunction");
var createFunction = createDBDelegate("createFunction");

var lastErrorString = createDBDelegateGetter("lastErrorString");

/**
 * Helper function to create an index on the database if it doesn't already
 * exist.
 *
 * @param tblData       The table data object to save the index in.
 * @param tblName       The name of the table to index.
 * @param colNameArray  An array of columns to index over.
 * @param db            (optional) The database to create the index on.
 */
function createIndex(tblData, tblName, colNameArray, db) {
    let idxName = "idx_" + tblName + "_" + colNameArray.join("_");
    let idxOn = tblName + "(" + colNameArray.join(",") + ")";

    // Construct the table data for this index
    tblData[idxName] = colNameArray.concat([]);
    tblData[idxName].unshift(tblName);

    // Execute the sql, if there is a db
    return executeSimpleSQL(db, "CREATE INDEX IF NOT EXISTS " + idxName +
                                "                        ON " + idxOn);
}

/**
 * Often in an upgrader we want to log something only if there is a database. To
 * make code less cludgy, here a helper function.
 *
 * @param db        The database, or null if nothing should be logged.
 * @param msg       The message to log.
 */
function LOGdb(db, msg) {
    if (db) {
        cal.LOG(msg);
    }
}

/**
 * Report an error and roll back the last transaction.
 *
 * @param db        The database to roll back on.
 * @param e         The exception to report
 * @return          The passed exception, for chaining.
 */
function reportErrorAndRollback(db, e) {
    if (db && db.transactionInProgress) {
        rollbackTransaction(db);
    }
    cal.ERROR("++++++ Storage error!" +
              "++++++ DB Error: " + lastErrorString(db) + "\n" +
              "++++++ Exception: " + e);
    return e;
}

/**
 * Make sure the timezones of the events in the database are up to date.
 *
 * @param db        The database to bring up to date
 */
function ensureUpdatedTimezones(db) {
    // check if timezone version has changed:
    let selectTzVersion = createStatement(db, "SELECT version FROM cal_tz_version LIMIT 1");
    let tzServiceVersion = cal.getTimezoneService().version;
    let version;
    try {
        version = (selectTzVersion.executeStep() ? selectTzVersion.row.version : null);
    } finally {
        selectTzVersion.reset();
    }

    let versionComp = 1;
    if (version) {
        versionComp = Services.vc.compare(tzServiceVersion, version);
    }

    if (versionComp != 0) {
        cal.LOG("[calStorageCalendar] Timezones have been changed from " + version + " to " + tzServiceVersion + ", updating calendar data.");

        let zonesToUpdate = [];
        let getZones = createStatement(db,
            "SELECT DISTINCT(zone) FROM (" +
            "SELECT recurrence_id_tz AS zone FROM cal_attendees    WHERE recurrence_id_tz IS NOT NULL UNION " +
            "SELECT recurrence_id_tz AS zone FROM cal_events       WHERE recurrence_id_tz IS NOT NULL UNION " +
            "SELECT event_start_tz   AS zone FROM cal_events       WHERE event_start_tz   IS NOT NULL UNION " +
            "SELECT event_end_tz     AS zone FROM cal_events       WHERE event_end_tz     IS NOT NULL UNION " +
            "SELECT recurrence_id_tz AS zone FROM cal_properties   WHERE recurrence_id_tz IS NOT NULL UNION " +
            "SELECT recurrence_id_tz AS zone FROM cal_todos        WHERE recurrence_id_tz IS NOT NULL UNION " +
            "SELECT todo_entry_tz    AS zone FROM cal_todos        WHERE todo_entry_tz    IS NOT NULL UNION " +
            "SELECT todo_due_tz      AS zone FROM cal_todos        WHERE todo_due_tz      IS NOT NULL UNION " +
            "SELECT recurrence_id_tz AS zone FROM cal_alarms       WHERE recurrence_id_tz IS NOT NULL UNION " +
            "SELECT recurrence_id_tz AS zone FROM cal_relations    WHERE recurrence_id_tz IS NOT NULL UNION " +
            "SELECT recurrence_id_tz AS zone FROM cal_attachments  WHERE recurrence_id_tz IS NOT NULL" +
            ");");
        try {
            while (getZones.executeStep()) {
                let zone = getZones.row.zone;
                // Send the timezones off to the timezone service to attempt conversion:
                let timezone = getTimezone(zone);
                if (timezone) {
                    let refTz = cal.getTimezoneService().getTimezone(timezone.tzid);
                    if (refTz && refTz.tzid != zone) {
                        zonesToUpdate.push({ oldTzId: zone, newTzId: refTz.tzid });
                    }
                }
            }
        } catch (e) {
            cal.ERROR("Error updating timezones: " + e +
                      "\nDB Error " + lastErrorString(db));
        } finally {
            getZones.reset();
        }

        beginTransaction(db);
        try {
            for (let update of zonesToUpdate) {
                executeSimpleSQL(db,
                    "UPDATE cal_attendees    SET recurrence_id_tz = '" + update.newTzId + "' WHERE recurrence_id_tz = '" + update.oldTzId + "'; " +
                    "UPDATE cal_events       SET recurrence_id_tz = '" + update.newTzId + "' WHERE recurrence_id_tz = '" + update.oldTzId + "'; " +
                    "UPDATE cal_events       SET event_start_tz   = '" + update.newTzId + "' WHERE event_start_tz   = '" + update.oldTzId + "'; " +
                    "UPDATE cal_events       SET event_end_tz     = '" + update.newTzId + "' WHERE event_end_tz     = '" + update.oldTzId + "'; " +
                    "UPDATE cal_properties   SET recurrence_id_tz = '" + update.newTzId + "' WHERE recurrence_id_tz = '" + update.oldTzId + "'; " +
                    "UPDATE cal_todos        SET recurrence_id_tz = '" + update.newTzId + "' WHERE recurrence_id_tz = '" + update.oldTzId + "'; " +
                    "UPDATE cal_todos        SET todo_entry_tz    = '" + update.newTzId + "' WHERE todo_entry_tz    = '" + update.oldTzId + "'; " +
                    "UPDATE cal_todos        SET todo_due_tz      = '" + update.newTzId + "' WHERE todo_due_tz      = '" + update.oldTzId + "'; " +
                    "UPDATE cal_alarms       SET recurrence_id_tz = '" + update.newTzId + "' WHERE recurrence_id_tz = '" + update.oldTzId + "'; " +
                    "UPDATE cal_relations    SET recurrence_id_tz = '" + update.newTzId + "' WHERE recurrence_id_tz = '" + update.oldTzId + "'; " +
                    "UPDATE cal_attachments  SET recurrence_id_tz = '" + update.newTzId + "' WHERE recurrence_id_tz = '" + update.oldTzId + "';");
            }
            executeSimpleSQL(db, "DELETE FROM cal_tz_version; " +
                                 "INSERT INTO cal_tz_version VALUES ('" +
                                 cal.getTimezoneService().version + "');");
            commitTransaction(db);
        } catch (e) {
            cal.ASSERT(false, "Timezone update failed! DB Error: " + lastErrorString(db));
            rollbackTransaction(db);
            throw e;
        }
    }
}

/**
 * Adds a column to the given table.
 *
 * @param tblData       The table data object to apply the operation on.
 * @param tblName       The table name to add on
 * @param colName       The column name to add
 * @param colType       The type of the column to add
 * @param db            (optional) The database to apply the operation on
 */
function addColumn(tblData, tblName, colName, colType, db) {
    cal.ASSERT(tblName in tblData,
               "Table " + tblName + " is missing from table def",
               true);
    tblData[tblName][colName] = colType;

    executeSimpleSQL(db, "ALTER TABLE " + tblName +
                         "  ADD COLUMN " + colName + " " + colType);
}

/**
 * Deletes columns from the given table.
 *
 * @param tblData       The table data object to apply the operation on.
 * @param tblName       The table name to delete on
 * @param colNameArray  An array of colum names to delete
 * @param db            (optional) The database to apply the operation on
 */
function deleteColumns(tblData, tblName, colNameArray, db) {
    for (let colName of colNameArray) {
        delete tblData[tblName][colName];
    }

    let columns = Object.keys(tblData[tblName]);
    executeSimpleSQL(db, getSql(tblName, tblData, tblName + "_temp"));
    executeSimpleSQL(db, "INSERT INTO " + tblName + "_temp" +
                         "  (" + columns.join(",") + ") " +
                         "SELECT " + columns.join(",") +
                         "  FROM " + tblName + ";");
    executeSimpleSQL(db, "DROP TABLE " + tblName + "; " +
                         "ALTER TABLE " + tblName + "_temp" +
                         "  RENAME TO " + tblName + ";");
}

/**
 * Does a full copy of the given table
 *
 * @param tblData       The table data object to apply the operation on.
 * @param tblName       The table name to copy
 * @param newTblName    The target table name.
 * @param db            (optional) The database to apply the operation on
 * @param condition     (optional) The condition to respect when copying
 * @param selectOptions (optional) Extra options for the SELECT, i.e DISTINCT
 */
function copyTable(tblData, tblName, newTblName, db, condition, selectOptions) {
    function objcopy(obj) {
        return eval(obj.toSource());
    }

    tblData[newTblName] = objcopy(tblData[tblName]);

    let columns = Object.keys(tblData[newTblName]);
    executeSimpleSQL(db, getSql(newTblName, tblData));
    executeSimpleSQL(db, "INSERT INTO " + newTblName +
                         "  (" + columns.join(",") + ") " +
                         "SELECT " + selectOptions + " " + columns.join(",") +
                         "  FROM " + tblName + " " +
                              (condition ? condition : "") +
                         ";");
}

/**
 * Alter the type of a certain column
 *
 * @param tblData       The table data object to apply the operation on.
 * @param tblName       The table name to alter
 * @param colNameArray  An array of colum names to delete
 * @param newType       The new type of the column
 * @param db            (optional) The database to apply the operation on
 */
function alterTypes(tblData, tblName, colNameArray, newType, db) {
    for (let colName of colNameArray) {
        tblData[tblName][colName] = newType;
    }

    let columns = Object.keys(tblData[tblName]);
    executeSimpleSQL(db, getSql(tblName, tblData, tblName + "_temp"));
    executeSimpleSQL(db, "INSERT INTO " + tblName + "_temp" +
                         "  (" + columns.join(",") + ") " +
                         "SELECT " + columns.join(",") +
                         "  FROM " + tblName + ";");
    executeSimpleSQL(db, "DROP TABLE " + tblName + "; " +
                         "ALTER TABLE " + tblName + "_temp" +
                         "  RENAME TO " + tblName + ";");
}

/**
 * Renames the given table, giving it a new name.
 *
 * @param tblData       The table data object to apply the operation on.
 * @param tblName       The table name to rename.
 * @param newTblName    The new name of the table.
 * @param db            (optional) The database to apply the operation on.
 * @param overwrite     (optional) If true, the target table will be dropped
 *                        before the rename
 */
function renameTable(tblData, tblName, newTblName, db, overwrite) {
    if (overwrite) {
        dropTable(tblData, newTblName, db);
    }
    tblData[newTblName] = tblData[tblName];
    delete tblData[tblName];
    executeSimpleSQL(db, "ALTER TABLE " + tblName +
                         "  RENAME TO " + newTblName);
}

/**
 * Drops the given table.
 *
 * @param tblData       The table data object to apply the operation on.
 * @param tblName       The table name to drop.
 * @param db            (optional) The database to apply the operation on.
 */
function dropTable(tblData, tblName, db) {
    delete tblData[tblName];

    executeSimpleSQL(db, "DROP TABLE IF EXISTS " + tblName + ";");
}

/**
 * Creates the given table.
 *
 * @param tblData       The table data object to apply the operation on.
 * @param tblName       The table name to add.
 * @param def           The table definition object.
 * @param db            (optional) The database to apply the operation on.
 */
function addTable(tblData, tblName, def, db) {
    tblData[tblName] = def;

    executeSimpleSQL(db, getSql(tblName, tblData));
}

/**
 * Migrates the given columns to a single icalString, using the (previously
 * created) user function for processing.
 *
 * @param tblData       The table data object to apply the operation on.
 * @param tblName       The table name to migrate.
 * @param userFuncName  The name of the user function to call for migration
 * @param oldColumns    An array of columns to migrate to the new icalString
 *                        column
 * @param db            (optional) The database to apply the operation on.
 */
function migrateToIcalString(tblData, tblName, userFuncName, oldColumns, db) {
    addColumn(tblData, tblName, ["icalString"], "TEXT", db);
    let updateSql =
        "UPDATE " + tblName + " " +
           "SET icalString = " + userFuncName + "(" + oldColumns.join(",") + ")";
    executeSimpleSQL(db, updateSql);
    deleteColumns(tblData, tblName, oldColumns, db);

    // If null was returned, its an invalid attendee. Make sure to remove them,
    // they might break things later on.
    let cleanupSql = "DELETE FROM " + tblName + " WHERE icalString IS NULL";
    executeSimpleSQL(db, cleanupSql);
}

/**
 * Maps a mozIStorageValueArray to a JS array, converting types correctly.
 *
 * @param storArgs      The storage value array to convert
 * @return              An array with the arguments as js values.
 */
function mapStorageArgs(storArgs) {
    const mISVA = Components.interfaces.mozIStorageValueArray;
    let mappedArgs = [];
    for (let i = 0; i < storArgs.numEntries; i++) {
        switch (storArgs.getTypeOfIndex(i)) {
            case mISVA.VALUE_TYPE_NULL: mappedArgs.push(null); break;
            case mISVA.VALUE_TYPE_INTEGER:
                mappedArgs.push(storArgs.getInt64(i));
                break;
            case mISVA.VALUE_TYPE_FLOAT:
                mappedArgs.push(storArgs.getDouble(i));
                break;
            case mISVA.VALUE_TYPE_TEXT:
            case mISVA.VALUE_TYPE_BLOB:
                mappedArgs.push(storArgs.getUTF8String(i));
                break;
        }
    }

    return mappedArgs;
}

/** Object holding upgraders */
var upgrade = {};

/**
 * Returns the initial storage database schema. Note this is not the current
 * schema, it will be modified by the upgrade.vNN() functions. This function
 * returns the initial v1 with modifications from v2 applied.
 *
 * No bug - new recurrence system. exceptions supported now, along with
 * everything else ical can throw at us. I hope.
 * p=vlad
 */
upgrade.v2 = upgrade.v1 = function(db, version) { // eslint-disable-line id-length
    LOGdb(db, "Storage: Upgrading to v1/v2");
    let tblData = {
        cal_calendar_schema_version: { version: "INTEGER" },

        /* While this table is in v1, actually keeping it in the sql object will
         * cause problems when migrating from storage.sdb to local.sqlite. There,
         * all tables from storage.sdb will be moved to local.sqlite and so starting
         * sunbird again afterwards causes a borked upgrade since its missing tables
         * it expects.
         *
         *  cal_calendars: {
         *   id:  "INTEGER PRIMARY KEY",
         *   name: "STRING"
         * },
         */

        cal_items: {
            cal_id: "INTEGER",
            item_type: "INTEGER",
            id: "STRING",
            time_created: "INTEGER",
            last_modified: "INTEGER",
            title: "STRING",
            priority: "INTEGER",
            privacy: "STRING",
            ical_status: "STRING",
            flags: "INTEGER",
            event_start: "INTEGER",
            event_end: "INTEGER",
            event_stamp: "INTEGER",
            todo_entry: "INTEGER",
            todo_due: "INTEGER",
            todo_completed: "INTEGER",
            todo_complete: "INTEGER",
            alarm_id: "INTEGER"
        },

        cal_attendees: {
            item_id: "STRING",
            attendee_id: "STRING",
            common_name: "STRING",
            rsvp: "INTEGER",
            role: "STRING",
            status: "STRING",
            type: "STRING"
        },

        cal_alarms: {
            id: "INTEGER PRIMARY KEY",
            alarm_data: "BLOB"
        },

        cal_recurrence: {
            item_id: "STRING",
            recur_type: "INTEGER",
            recur_index: "INTEGER",
            is_negative: "BOOLEAN",
            dates: "STRING",
            end_date: "INTEGER",
            count: "INTEGER",
            interval: "INTEGER",
            second: "STRING",
            minute: "STRING",
            hour: "STRING",
            day: "STRING",
            monthday: "STRING",
            yearday: "STRING",
            weekno: "STRING",
            month: "STRING",
            setpos: "STRING"
        },

        cal_properties: {
            item_id: "STRING",
            key: "STRING",
            value: "BLOB"
        }
    };

    for (let tbl in tblData) {
        executeSimpleSQL(db, "DROP TABLE IF EXISTS " + tbl);
    }
    return tblData;
};

/**
 * Upgrade to version 3.
 * Bug 293707, updates to storage provider; calendar manager database locked
 * fix, r=shaver, p=vlad
 * p=vlad
 */
upgrade.v3 = function(db, version) { // eslint-disable-line id-length
    function updateSql(tbl, field) {
        executeSimpleSQL(db, "UPDATE " + tbl + " SET " + field + "_tz='UTC'" +
                             " WHERE " + field + " IS NOT NULL");
    }

    let tbl = upgrade.v2(version < 2 && db, version);
    LOGdb(db, "Storage: Upgrading to v3");

    beginTransaction(db);
    try {
        copyTable(tbl, "cal_items", "cal_events", db, "item_type = 0");
        copyTable(tbl, "cal_items", "cal_todos", db, "item_type = 1");

        dropTable(tbl, "cal_items", db);

        let removeEventCols = ["item_type",
                               "item_type",
                               "todo_entry",
                               "todo_due",
                               "todo_completed",
                               "todo_complete",
                               "alarm_id"];
        deleteColumns(tbl, "cal_events", removeEventCols, db);

        addColumn(tbl, "cal_events", "event_start_tz", "VARCHAR", db);
        addColumn(tbl, "cal_events", "event_end_tz", "VARCHAR", db);
        addColumn(tbl, "cal_events", "alarm_time", "INTEGER", db);
        addColumn(tbl, "cal_events", "alarm_time_tz", "VARCHAR", db);

        let removeTodoCols = ["item_type",
                              "event_start",
                              "event_end",
                              "event_stamp",
                              "alarm_id"];
        deleteColumns(tbl, "cal_todos", removeTodoCols, db);

        addColumn(tbl, "cal_todos", "todo_entry_tz", "VARCHAR", db);
        addColumn(tbl, "cal_todos", "todo_due_tz", "VARCHAR", db);
        addColumn(tbl, "cal_todos", "todo_completed_tz", "VARCHAR", db);
        addColumn(tbl, "cal_todos", "alarm_time", "INTEGER", db);
        addColumn(tbl, "cal_todos", "alarm_time_tz", "VARCHAR", db);

        dropTable(tbl, "cal_alarms", db);

        // The change between 2 and 3 includes the splitting of cal_items into
        // cal_events and cal_todos, and the addition of columns for
        // event_start_tz, event_end_tz, todo_entry_tz, todo_due_tz.
        // These need to default to "UTC" if their corresponding time is
        // given, since that's what the default was for v2 calendars

        // Fix up the new timezone columns
        updateSql("cal_events", "event_start");
        updateSql("cal_events", "event_end");
        updateSql("cal_todos", "todo_entry");
        updateSql("cal_todos", "todo_due");
        updateSql("cal_todos", "todo_completed");

        setDbVersionAndCommit(db, 3);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }
    return tbl;
};

/**
 * Upgrade to version 4.
 * Bug 293183 - implement exception support for recurrence.
 * r=shaver,p=vlad
 */
upgrade.v4 = function(db, version) { // eslint-disable-line id-length
    let tbl = upgrade.v3(version < 3 && db, version);
    LOGdb(db, "Storage: Upgrading to v4");

    beginTransaction(db);
    try {
        for (let tblid of ["events", "todos", "attendees", "properties"]) {
            addColumn(tbl, "cal_" + tblid, "recurrence_id", "INTEGER", db);
            addColumn(tbl, "cal_" + tblid, "recurrence_id_tz", "VARCHAR", db);
        }
        setDbVersionAndCommit(db, 4);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }

    return tbl;
};

/**
 * Bug 315051 - Switch to storing alarms based on offsets from start/end time
 * rather than as absolute times. Ensure that missed alarms are fired.
 * r=dmose, p=jminta
 */
upgrade.v5 = function(db, version) { // eslint-disable-line id-length
    let tbl = upgrade.v4(version < 4 && db, version);
    LOGdb(db, "Storage: Upgrading to v5");

    beginTransaction(db);
    try {
        for (let tblid of ["events", "todos"]) {
            addColumn(tbl, "cal_" + tblid, "alarm_offset", "INTEGER", db);
            addColumn(tbl, "cal_" + tblid, "alarm_related", "INTEGER", db);
            addColumn(tbl, "cal_" + tblid, "alarm_last_ack", "INTEGER", db);
        }
        setDbVersionAndCommit(db, 5);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }

    return tbl;
};

/**
 * Bug 333688 - Converts STRING and VARCHAR columns to TEXT to avoid SQLite's
 * auto-conversion of strings to numbers (10e4 to 10000)
 * r=ctalbert,jminta p=lilmatt
 */
upgrade.v6 = function(db, version) { // eslint-disable-line id-length
    let tbl = upgrade.v5(version < 5 && db, version);
    LOGdb(db, "Storage: Upgrading to v6");

    beginTransaction(db);
    try {
        let eventCols = ["id", "title", "privacy", "ical_status",
                         "recurrence_id_tz", "event_start_tz",
                         "event_end_tz", "alarm_time_tz"];
        alterTypes(tbl, "cal_events", eventCols, "TEXT", db);

        let todoCols = ["id", "title", "privacy", "ical_status",
                         "recurrence_id_tz", "todo_entry_tz",
                         "todo_due_tz", "todo_completed_tz",
                         "alarm_time_tz"];
        alterTypes(tbl, "cal_todos", todoCols, "TEXT", db);

        let attendeeCols = ["item_id", "recurrence_id_tz", "attendee_id",
                            "common_name", "role", "status", "type"];
        alterTypes(tbl, "cal_attendees", attendeeCols, "TEXT", db);

        let recurrenceCols = ["item_id", "recur_type", "dates", "second",
                              "minute", "hour", "day", "monthday", "yearday",
                              "weekno", "month", "setpos"];
        alterTypes(tbl, "cal_recurrence", recurrenceCols, "TEXT", db);

        let propertyCols = ["item_id", "recurrence_id_tz", "key"];
        alterTypes(tbl, "cal_properties", propertyCols, "TEXT", db);
        setDbVersionAndCommit(db, 6);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }

    return tbl;
};

/**
 * Bug 369010: Migrate all old tzids in storage to new one.
 * r=ctalbert,dmose p=lilmatt
 */
upgrade.v7 = function(db, version) { // eslint-disable-line id-length
    // No schema changes in v7
    let tbl = upgrade.v6(db, version);
    LOGdb(db, "Storage: Upgrading to v7");
    return tbl;
};

/**
 * Bug 410931 - Update internal timezone definitions
 * r=ctalbert, p=dbo,nth10sd,hb
 */
upgrade.v8 = function(db, version) { // eslint-disable-line id-length
    // No schema changes in v8
    let tbl = upgrade.v7(db, version);
    LOGdb(db, "Storage: Upgrading to v8");
    return tbl;
};

/**
 * Bug 363191 - Handle Timezones more efficiently (Timezone Database)
 * r=philipp,ctalbert, p=dbo
 */
upgrade.v9 = function(db, version) { // eslint-disable-line id-length
    // No schema changes in v9
    let tbl = upgrade.v8(db, version);
    LOGdb(db, "Storage: Upgrading to v9");
    return tbl;
};

/**
 * Bug 413908 – Events using internal timezones are no longer updated to
 * recent timezone version;
 * r=philipp, p=dbo
 */
upgrade.v10 = function(db, version) {
    let tbl = upgrade.v9(version < 9 && db, version);
    LOGdb(db, "Storage: Upgrading to v10");

    beginTransaction(db);
    try {
        addTable(tbl, "cal_tz_version", { version: "TEXT" }, db);
        setDbVersionAndCommit(db, 10);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }
    return tbl;
};

/**
 * Fix bug 319909 - Failure to properly serialize/unserialize ics ATTACH
 * properties.
 * r=philipp,p=fred.jen@web.de
 */
upgrade.v11 = function(db, version) {
    let tbl = upgrade.v10(version < 10 && db, version);
    LOGdb(db, "Storage: Upgrading to v11");

    beginTransaction(db);
    try {
        addTable(tbl, "cal_attachments", {
            item_id: "TEXT",
            data: "BLOB",
            format_type: "TEXT",
            encoding: "TEXT"
        }, db);
        setDbVersionAndCommit(db, 11);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }
    return tbl;
};

/**
 * Bug 449031 - Add meta data API to memory/storage
 * r=philipp, p=dbo
 */
upgrade.v12 = function(db, version) {
    let tbl = upgrade.v11(version < 11 && db, version);
    LOGdb(db, "Storage: Upgrading to v12");

    beginTransaction(db);
    try {
        addColumn(tbl, "cal_attendees", "is_organizer", "BOOLEAN", db);
        addColumn(tbl, "cal_attendees", "properties", "BLOB", db);

        addTable(tbl, "cal_metadata", {
            cal_id: "INTEGER",
            item_id: "TEXT UNIQUE",
            value: "BLOB"
        }, db);
        setDbVersionAndCommit(db, 12);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }

    return tbl;
};

/**
 * Bug 449401 - storage provider doesn't cleanly separate items of the same id
 * across different calendars
 * r=dbo,philipp, p=wsourdeau@inverse.ca
 */
upgrade.v13 = function(db, version) {
    let tbl = upgrade.v12(version < 12 && db, version);
    LOGdb(db, "Storage: Upgrading to v13");

    beginTransaction(db);
    try {
        alterTypes(tbl, "cal_metadata", ["item_id"], "TEXT", db);

        let calIds = {};
        if (db) {
            for (let itemTable of ["events", "todos"]) {
                let stmt = createStatement(db,
                                           "SELECT id, cal_id FROM cal_" + itemTable);
                try {
                    while (stmt.executeStep()) {
                        calIds[stmt.row.id] = stmt.row.cal_id;
                    }
                } finally {
                    stmt.reset();
                }
            }
        }

        for (let tblid of ["attendees", "recurrence", "properties",
                           "attachments"]) {
            addColumn(tbl, "cal_" + tblid, "cal_id", "INTEGER", db);

            for (let itemId in calIds) {
                executeSimpleSQL(db, "UPDATE cal_" + tblid +
                                     "   SET cal_id = " + calIds[itemId] +
                                     " WHERE item_id = '" + itemId + "'");
            }
        }

        executeSimpleSQL(db, "DROP INDEX IF EXISTS" +
                             " idx_cal_properies_item_id");
        executeSimpleSQL(db, "CREATE INDEX IF NOT EXISTS" +
                             " idx_cal_properies_item_id" +
                             " ON cal_properties(cal_id, item_id);");
        setDbVersionAndCommit(db, 13);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }
    return tbl;
};

/**
 * Bug 446303 - use the "RELATED-TO" property.
 * r=philipp,dbo, p=fred.jen@web.de
 */
upgrade.v14 = function(db, version) {
    let tbl = upgrade.v13(version < 13 && db, version);
    LOGdb(db, "Storage: Upgrading to v14");

    beginTransaction(db);
    try {
        addTable(tbl, "cal_relations", {
            cal_id: "INTEGER",
            item_id: "TEXT",
            rel_type: "TEXT",
            rel_id: "TEXT"
        }, db);
        setDbVersionAndCommit(db, 14);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }
    return tbl;
};

/**
 * Bug 463282 - Tasks cannot be created or imported (regression).
 * r=philipp,berend, p=dbo
 */
upgrade.v15 = function(db, version) {
    let tbl = upgrade.v14(version < 14 && db, version);
    LOGdb(db, "Storage: Upgrading to v15");

    beginTransaction(db);
    try {
        addColumn(tbl, "cal_todos", "todo_stamp", "INTEGER", db);
        setDbVersionAndCommit(db, 15);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }
    return tbl;
};

/**
 * Bug 353492 - support multiple alarms per events/task, support
 * absolute alarms with fixed date/time - Storage Provider support for multiple
 * alarms.
 * r=dbo,ssitter, p=philipp
 *
 * This upgrader is a bit special. To fix bug 494140, we decided to change the
 * upgrading code afterwards to make sure no data is lost for people upgrading
 * from 0.9 -> 1.0b1 and later. The v17 upgrader will merely take care of the
 * upgrade if a user is upgrading from 1.0pre -> 1.0b1 or later.
 */
upgrade.v16 = function(db, version) {
    let tbl = upgrade.v15(version < 15 && db, version);
    LOGdb(db, "Storage: Upgrading to v16");
    beginTransaction(db);
    try {
        createFunction(db, "translateAlarm", 4, {
            onFunctionCall: function(storArgs) {
                try {
                    let [aOffset, aRelated, aAlarmTime, aTzId] =
                        mapStorageArgs(storArgs);

                    let alarm = cal.createAlarm();
                    if (aOffset) {
                        alarm.related = parseInt(aRelated, 10) + 1;
                        alarm.offset = cal.createDuration();
                        alarm.offset.inSeconds = aOffset;
                    } else if (aAlarmTime) {
                        alarm.related = Components.interfaces.calIAlarm.ALARM_RELATED_ABSOLUTE;
                        let alarmDate = cal.createDateTime();
                        alarmDate.nativeTime = aAlarmTime;
                        if (aTzId == "floating") {
                            // The current calDateTime code assumes that if a
                            // date is floating then we can just assign the new
                            // timezone. I have the feeling this is wrong so I
                            // filed bug 520463. Since we want to release 1.0b1
                            // soon, I will just fix this on the "client side"
                            // and do the conversion here.
                            alarmDate.timezone = cal.getTimezoneService().defaultTimezone;
                            alarmDate = alarmDate.getInTimezone(cal.UTC());
                        } else {
                            alarmDate.timezone = cal.getTimezoneService().getTimezone(aTzId);
                        }
                        alarm.alarmDate = alarmDate;
                    }
                    return alarm.icalString;
                } catch (e) {
                    // Errors in this function are not really logged. Do this
                    // separately.
                    cal.ERROR("Error converting alarms: " + e);
                    throw e;
                }
            }
        });

        addTable(tbl, "cal_alarms", {
            cal_id: "INTEGER",
            item_id: "TEXT",
            // Note the following two columns were not originally part of the
            // v16 upgrade, see note above function.
            recurrence_id: "INTEGER",
            recurrence_id_tz: "TEXT",
            icalString: "TEXT"
        }, db);

        let copyDataOver = function(tblName) {
            const transAlarm = "translateAlarm(alarm_offset, " +
                                              "alarm_related, " +
                                              "alarm_time, " +
                                              "alarm_time_tz)";
            executeSimpleSQL(db, "INSERT INTO cal_alarms (cal_id, item_id," +
                                 "                        recurrence_id, " +
                                 "                        recurrence_id_tz, " +
                                 "                        icalString)" +
                                 " SELECT cal_id, id, recurrence_id," +
                                 "        recurrence_id_tz, " + transAlarm +
                                 "   FROM " + tblName +
                                 "  WHERE alarm_offset IS NOT NULL" +
                                 "     OR alarm_time IS NOT NULL;");
        };
        copyDataOver("cal_events");
        copyDataOver("cal_todos");
        removeFunction(db, "translateAlarm");

        // Make sure the alarm flag is set on the item
        executeSimpleSQL(db, "UPDATE cal_events " +
                             "   SET flags = flags | " + CAL_ITEM_FLAG.HAS_ALARMS +
                             " WHERE id IN" +
                             "  (SELECT item_id " +
                             "     FROM cal_alarms " +
                             "    WHERE cal_alarms.cal_id = cal_events.cal_id)");
        executeSimpleSQL(db, "UPDATE cal_todos " +
                             "   SET flags = flags | " + CAL_ITEM_FLAG.HAS_ALARMS +
                             " WHERE id IN" +
                             "  (SELECT item_id " +
                             "     FROM cal_alarms " +
                             "     WHERE cal_alarms.cal_id = cal_todos.cal_id)");

        // Remote obsolete columns
        let cols = ["alarm_time",
                    "alarm_time_tz",
                    "alarm_offset",
                    "alarm_related"];
        for (let tblid of ["events", "todos"]) {
            deleteColumns(tbl, "cal_" + tblid, cols, db);
        }

        setDbVersionAndCommit(db, 16);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }

    return tbl;
};

/**
 * Bug 494140 - Multiple reminders,relations,attachments created by modifying
 * repeating event.
 * r=dbo,ssitter, p=philipp
 *
 * This upgrader is special. In bug 494140 we decided it would be better to fix
 * the v16 upgrader so 0.9 users can update to 1.0b1 and later without dataloss.
 * Therefore all this upgrader does is handle users of 1.0pre before the
 * mentioned bug.
 */
upgrade.v17 = function(db, version) {
    let tbl = upgrade.v16(version < 16 && db, version);
    LOGdb(db, "Storage: Upgrading to v17");
    beginTransaction(db);
    try {
        for (let tblName of ["alarms", "relations", "attachments"]) {
            let hasColumns = true;
            let stmt;
            try {
                // Stepping this statement will fail if the columns don't exist.
                // We don't use the delegate here since it would show an error to
                // the user, even through we expect the error. If the db is null,
                // then swallowing the error is ok too since the cols will
                // already be added in v16.
                stmt = db.createStatement("SELECT recurrence_id_tz," +
                                              "       recurrence_id" +
                                              "  FROM cal_" + tblName +
                                              " LIMIT 1");
                stmt.executeStep();
            } catch (e) {
                // An error happened, which means the cols don't exist
                hasColumns = false;
            } finally {
                if (stmt) {
                    stmt.finalize();
                }
            }

            // Only add the columns if they are not there yet (i.e added in v16)
            // Since relations were broken all along, also make sure and add the
            // columns to the javascript object if there is no database.
            if (!hasColumns || !db) {
                addColumn(tbl, "cal_" + tblName, "recurrence_id", "INTEGER", db);
                addColumn(tbl, "cal_" + tblName, "recurrence_id_tz", "TEXT", db);
            }

            // Clear out entries that are exactly the same. This corrects alarms
            // created in 1.0pre and relations and attachments created in 0.9.
            copyTable(tbl,
                      "cal_" + tblName,
                      "cal_" + tblName + "_v17",
                      db,
                      null,
                      "DISTINCT");
            renameTable(tbl,
                        "cal_" + tblName + "_v17",
                        "cal_" + tblName,
                        db,
                        true);
        }
        setDbVersionAndCommit(db, 17);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }

    return tbl;
};

/**
 * Bug 529326 -  Create indexes for the local calendar
 * r=mschroeder, p=philipp
 *
 * This bug adds some indexes to improve performance. If you would like to add
 * additional indexes, please read http://www.sqlite.org/optoverview.html first.
 */
upgrade.v18 = function(db, version) {
    let tbl = upgrade.v17(version < 17 && db, version);
    LOGdb(db, "Storage: Upgrading to v18");
    beginTransaction(db);
    try {
        // These fields are often indexed over
        let simpleIds = ["cal_id", "item_id"];
        let allIds = simpleIds.concat(["recurrence_id", "recurrence_id_tz"]);

        // Alarms, Attachments, Attendees, Relations
        for (let tblName of ["alarms", "attachments", "attendees", "relations"]) {
            createIndex(tbl, "cal_" + tblName, allIds, db);
        }

        // Events and Tasks
        for (let tblName of ["events", "todos"]) {
            createIndex(tbl, "cal_" + tblName, ["flags", "cal_id", "recurrence_id"], db);
            createIndex(tbl, "cal_" + tblName, ["id", "cal_id", "recurrence_id"], db);
        }

        // Metadata
        createIndex(tbl, "cal_metadata", simpleIds, db);

        // Properties. Remove the index we used to create first, since our index
        // is much more complete.
        executeSimpleSQL(db, "DROP INDEX IF EXISTS idx_cal_properies_item_id");
        createIndex(tbl, "cal_properties", allIds, db);

        // Recurrence
        createIndex(tbl, "cal_recurrence", simpleIds, db);

        setDbVersionAndCommit(db, 18);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }

    return tbl;
};

/**
 * Bug 479867 - Cached calendars don't set id correctly, causing duplicate
 * events to be shown for multiple cached calendars
 * r=simon.at.orcl, p=philipp,dbo
 */
upgrade.v19 = function(db, version) {
    let tbl = upgrade.v18(version < 18 && db, version);
    LOGdb(db, "Storage: Upgrading to v19");
    beginTransaction(db);
    try {
        // Change types of column to TEXT.
        for (let tblName of ["cal_alarms", "cal_attachments",
                             "cal_attendees", "cal_events",
                             "cal_metadata", "cal_properties",
                             "cal_recurrence", "cal_relations",
                             "cal_todos"]) {
            alterTypes(tbl, tblName, ["cal_id"], "TEXT", db);
        }
        setDbVersionAndCommit(db, 19);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }

    return tbl;
};

/**
 * Bug 380060 - Offline Sync feature for calendar
 * Setting a offline_journal column in cal_events tables
 * r=philipp, p=redDragon
 */
upgrade.v20 = function(db, version) {
    let tbl = upgrade.v19(version < 19 && db, version);
    LOGdb(db, "Storage: Upgrading to v20");
    beginTransaction(db);
    try {
        // Adding a offline_journal column
        for (let tblName of ["cal_events", "cal_todos"]) {
            addColumn(tbl, tblName, ["offline_journal"], "INTEGER", db);
        }
        setDbVersionAndCommit(db, 20);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }
    return tbl;
};

/**
 * Bug 785659 - Get rid of calIRecurrenceDateSet
 * Migrate x-dateset to x-date in the storage database
 * r=mmecca, p=philipp
 */
upgrade.v21 = function(db, version) {
    let tbl = upgrade.v20(version < 20 && db, version);
    LOGdb(db, "Storage: Upgrading to v21");
    beginTransaction(db);

    try {
        // The following operation is only important on a live DB, since we are
        // changing only the values on the DB, not the schema itself.
        if (db) {
            // Oh boy, here we go :-)
            // Insert a new row with the following columns...
            let insertSQL = "INSERT INTO cal_recurrence " +
                            "            (item_id, cal_id, recur_type, recur_index," +
                            "             is_negative, dates, end_date, count," +
                            "             interval, second, minute, hour, day," +
                            "             monthday, yearday, weekno,  month, setpos)" +
                            // ... by selecting some columns from the existing table ...
                            '     SELECT item_id, cal_id, "x-date" AS recur_type, ' +
                            // ... like a new recur_index, we need it to be maximum for this item ...
                            "            (SELECT MAX(recur_index)+1" +
                            "               FROM cal_recurrence AS rinner " +
                            "              WHERE rinner.item_id = router.item_id" +
                            "                AND rinner.cal_id = router.cal_id) AS recur_index," +
                            "            is_negative," +
                            // ... the string until the first comma in the current dates field
                            '            SUBSTR(dates, 0, LENGTH(dates) - LENGTH(LTRIM(dates, REPLACE(dates, ",", ""))) + 1) AS dates,' +
                            "            end_date, count, interval, second, minute," +
                            "            hour, day, monthday, yearday, weekno, month," +
                            "            setpos" +
                            // ... from the recurrence table ...
                            "       FROM cal_recurrence AS router " +
                            // ... but only on fields that are x-datesets ...
                            '      WHERE recur_type = "x-dateset" ' +
                            // ... and are not already empty.
                            '        AND dates != ""';
            dump(insertSQL + "\n");

            // Now we need to remove the first segment from the dates field
            let updateSQL = "UPDATE cal_recurrence" +
                            '   SET dates = SUBSTR(dates, LENGTH(dates) - LENGTH(LTRIM(dates, REPLACE(dates, ",", ""))) + 2)' +
                            ' WHERE recur_type = "x-dateset"' +
                            '   AND dates != ""';

            // Create the statements
            let insertStmt = createStatement(db, insertSQL);
            let updateStmt = createStatement(db, updateSQL);

            // Repeat these two statements until the update affects 0 rows
            // (because the dates field on all x-datesets is empty)
            do {
                insertStmt.execute();
                updateStmt.execute();
            } while (db.affectedRows > 0);

            // Finally we can delete the x-dateset rows. Note this will leave
            // gaps in recur_index, but thats ok since its only used for
            // ordering anyway and will be overwritten on the next item write.
            executeSimpleSQL(db, 'DELETE FROM cal_recurrence WHERE recur_type = "x-dateset"');
        }

        setDbVersionAndCommit(db, 21);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }
    return tbl;
};

/**
 * Bug 785733 - Move some properties to use icalString in database.
 * Use the full icalString in attendees, attachments, relations and recurrence
 * tables.
 * r=mmecca, p=philipp
 */
upgrade.v22 = function(db, version) {
    let tbl = upgrade.v21(version < 21 && db, version);
    LOGdb(db, "Storage: Upgrading to v22");
    beginTransaction(db);
    try {
        // Update attachments to using icalString directly
        createFunction(db, "translateAttachment", 3, {
            onFunctionCall: function(storArgs) {
                try {
                    let [aData, aFmtType, aEncoding] = mapStorageArgs(storArgs);

                    let attach = cal.createAttachment();
                    attach.uri = cal.makeURL(aData);
                    attach.formatType = aFmtType;
                    attach.encoding = aEncoding;
                    return attach.icalString;
                } catch (e) {
                    cal.ERROR("Error converting attachment: " + e);
                    throw e;
                }
            }
        });
        migrateToIcalString(tbl, "cal_attachments", "translateAttachment",
                           ["data", "format_type", "encoding"], db);

        // Update relations to using icalString directly
        createFunction(db, "translateRelation", 2, {
            onFunctionCall: function(storArgs) {
                try {
                    let [aRelType, aRelId] = mapStorageArgs(storArgs);
                    let relation = cal.createRelation();
                    relation.relType = aRelType;
                    relation.relId = aRelId;
                    return relation.icalString;
                } catch (e) {
                    cal.ERROR("Error converting relation: " + e);
                    throw e;
                }
            }
        });
        migrateToIcalString(tbl, "cal_relations", "translateRelation",
                           ["rel_type", "rel_id"], db);

        // Update attendees table to using icalString directly
        createFunction(db, "translateAttendee", 8, {
            onFunctionCall: function(storArgs) {
                try {
                    let [aAttendeeId, aCommonName, aRsvp, aRole,
                         aStatus, aType, aIsOrganizer, aProperties] =
                         mapStorageArgs(storArgs);

                    let attendee = cal.createAttendee();

                    attendee.id = aAttendeeId;
                    attendee.commonName = aCommonName;

                    switch (aRsvp) {
                        case 0: attendee.rsvp = "FALSE"; break;
                        case 1: attendee.rsvp = "TRUE"; break;
                        // default: keep undefined
                    }

                    attendee.role = aRole;
                    attendee.participationStatus = aStatus;
                    attendee.userType = aType;
                    attendee.isOrganizer = !!aIsOrganizer;
                    if (aProperties) {
                        for (let pair of aProperties.split(",")) {
                            let [key, value] = pair.split(":");
                            attendee.setProperty(decodeURIComponent(key),
                                                 decodeURIComponent(value));
                        }
                    }

                    return attendee.icalString;
                } catch (e) {
                    // There are some attendees with a null ID. We are taking
                    // the opportunity to remove them here.
                    cal.ERROR("Error converting attendee, removing: " + e);
                    return null;
                }
            }
        });
        migrateToIcalString(tbl, "cal_attendees", "translateAttendee",
                            ["attendee_id", "common_name", "rsvp", "role",
                             "status", "type", "is_organizer", "properties"], db);

        // Update recurrence table to using icalString directly
        createFunction(db, "translateRecurrence", 17, {
            onFunctionCall: function(storArgs) {
                function parseInt10(x) { return parseInt(x, 10); }
                try {
                    // eslint-disable-next-line no-unused-vars
                    let [aIndex, aType, aIsNegative, aDates, aCount,
                         aEndDate, aInterval, aSecond, aMinute, aHour,
                         aDay, aMonthday, aYearday, aWeekno, aMonth,
                         aSetPos, aTmpFlags] = mapStorageArgs(storArgs);

                    let ritem;
                    if (aType == "x-date") {
                        ritem = Components.classes["@mozilla.org/calendar/recurrence-date;1"]
                                          .createInstance(Components.interfaces.calIRecurrenceDate);
                        ritem.date = textToDate(aDates);
                        ritem.isNegative = !!aIsNegative;
                    } else {
                        ritem = cal.createRecurrenceRule();
                        ritem.type = aType;
                        ritem.isNegative = !!aIsNegative;
                        if (aCount) {
                            try {
                                ritem.count = aCount;
                            } catch (exc) {
                                // Don't fail if setting an invalid count
                            }
                        } else if (aEndDate) {
                            let allday = (aTmpFlags & CAL_ITEM_FLAG.EVENT_ALLDAY) != 0;
                            let untilDate = newDateTime(aEndDate, allday ? "" : "UTC");
                            if (allday) {
                                untilDate.isDate = true;
                            }
                            ritem.untilDate = untilDate;
                        } else {
                            ritem.untilDate = null;
                        }

                        try {
                            ritem.interval = aInterval;
                        } catch (exc) {
                            // Don't fail if setting an invalid interval
                        }

                        let rtypes = {
                            SECOND: aSecond,
                            MINUTE: aMinute,
                            HOUR: aHour,
                            DAY: aDay,
                            MONTHDAY: aMonthday,
                            YEARDAY: aYearday,
                            WEEKNO: aWeekno,
                            MONTH: aMonth,
                            SETPOS: aSetPos
                        };

                        for (let rtype in rtypes) {
                            if (rtypes[rtype]) {
                                let comp = "BY" + rtype;
                                let rstr = rtypes[rtype].toString();
                                let rarray = rstr.split(",").map(parseInt10);
                                ritem.setComponent(comp, rarray.length, rarray);
                            }
                        }
                    }

                    return ritem.icalString;
                } catch (e) {
                    cal.ERROR("Error converting recurrence: " + e);
                    throw e;
                }
            }
        });

        // The old code relies on the item allday state, we need to temporarily
        // copy this into the rec table so the above function can update easier.
        // This column will be deleted during the migrateToIcalString call.
        addColumn(tbl, "cal_recurrence", ["tmp_date_tz"], "", db);
        executeSimpleSQL(db, "UPDATE cal_recurrence SET tmp_date_tz = " +
                               "(SELECT e.flags " +
                                  "FROM cal_events AS e " +
                                 "WHERE e.id = cal_recurrence.item_id " +
                                   "AND e.cal_id = cal_recurrence.cal_id " +
                                 "UNION " +
                                "SELECT t.flags " +
                                  "FROM cal_todos AS t " +
                                 "WHERE t.id = cal_recurrence.item_id " +
                                   "AND t.cal_id = cal_recurrence.cal_id)");

        migrateToIcalString(tbl, "cal_recurrence", "translateRecurrence",
                            ["recur_index", "recur_type", "is_negative",
                             "dates", "count", "end_date", "interval", "second",
                             "minute", "hour", "day", "monthday", "yearday",
                             "weekno", "month", "setpos", "tmp_date_tz"], db);

        setDbVersionAndCommit(db, 22);
    } catch (e) {
        throw reportErrorAndRollback(db, e);
    }
    return tbl;
};
