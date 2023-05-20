/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");
Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calIteratorUtils.jsm");

//
// calMemoryCalendar.js
//

var cICL = Components.interfaces.calIChangeLog;

function calMemoryCalendar() {
    this.initProviderBase();
    this.initMemoryCalendar();
}
var calMemoryCalendarClassID = Components.ID("{bda0dd7f-0a2f-4fcf-ba08-5517e6fbf133}");
var calMemoryCalendarInterfaces = [
    Components.interfaces.calICalendar,
    Components.interfaces.calISchedulingSupport,
    Components.interfaces.calIOfflineStorage,
    Components.interfaces.calISyncWriteCalendar,
    Components.interfaces.calICalendarProvider
];
calMemoryCalendar.prototype = {
    __proto__: cal.ProviderBase.prototype,
    classID: calMemoryCalendarClassID,
    QueryInterface: XPCOMUtils.generateQI(calMemoryCalendarInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calMemoryCalendarClassID,
        contractID: "@mozilla.org/calendar/calendar;1?type=memory",
        classDescription: "Calendar Memory Provider",
        interfaces: calMemoryCalendarInterfaces
    }),

    mItems: null,
    mOfflineFlags: null,
    mObservers: null,
    mMetaData: null,

    initMemoryCalendar: function() {
        this.mObservers = new cal.ObserverBag(Components.interfaces.calIObserver);
        this.mItems = {};
        this.mOfflineFlags = {};
        this.mMetaData = new cal.calPropertyBag();
    },

    //
    // calICalendarProvider interface
    //
    get prefChromeOverlay() {
        return null;
    },

    get displayName() {
        return cal.calGetString("calendar", "memoryName");
    },

    createCalendar: function() {
        throw NS_ERROR_NOT_IMPLEMENTED;
    },

    deleteCalendar: function(calendar, listener) {
        calendar = calendar.wrappedJSObject;
        calendar.mItems = {};
        calendar.mMetaData = new cal.calPropertyBag();

        try {
            listener.onDeleteCalendar(calendar, Components.results.NS_OK, null);
        } catch (ex) {
            // Don't bail out if the listener fails
        }
    },

    mRelaxedMode: undefined,
    get relaxedMode() {
        if (this.mRelaxedMode === undefined) {
            this.mRelaxedMode = this.getProperty("relaxedMode");
        }
        return this.mRelaxedMode;
    },

    //
    // calICalendar interface
    //

    getProperty: function(aName) {
        switch (aName) {
            case "cache.supported":
            case "requiresNetwork":
                return false;
            case "removemodes":
                return ["delete"];
        }
        return this.__proto__.__proto__.getProperty.apply(this, arguments);
    },

    // readonly attribute AUTF8String type;
    get type() { return "memory"; },

    // void addItem( in calIItemBase aItem, in calIOperationListener aListener );
    addItem: function(aItem, aListener) {
        let newItem = aItem.clone();
        return this.adoptItem(newItem, aListener);
    },

    // void adoptItem( in calIItemBase aItem, in calIOperationListener aListener );
    adoptItem: function(aItem, aListener) {
        if (this.readOnly) {
            throw Components.interfaces.calIErrors.CAL_IS_READONLY;
        }
        if (aItem.id == null && aItem.isMutable) {
            aItem.id = cal.getUUID();
        }

        if (aItem.id == null) {
            this.notifyOperationComplete(aListener,
                                         Components.results.NS_ERROR_FAILURE,
                                         Components.interfaces.calIOperationListener.ADD,
                                         aItem.id,
                                         "Can't set ID on non-mutable item to addItem");
            return;
        }

        // Lines below are commented because of the offline bug 380060, the
        // memory calendar cannot assume that a new item should not have an ID.
        // calCachedCalendar could send over an item with an id.

        /*
        if (this.mItems[aItem.id] != null) {
            if (this.relaxedMode) {
                // we possibly want to interact with the user before deleting
                delete this.mItems[aItem.id];
            } else {
                this.notifyOperationComplete(aListener,
                                             Components.interfaces.calIErrors.DUPLICATE_ID,
                                             Components.interfaces.calIOperationListener.ADD,
                                             aItem.id,
                                             "ID already exists for addItem");
                return;
            }
        }
        */

        let parentItem = aItem.parentItem;
        if (parentItem != aItem) {
            parentItem = parentItem.clone();
            parentItem.recurrenceInfo.modifyException(aItem, true);
        }
        parentItem.calendar = this.superCalendar;

        parentItem.makeImmutable();
        this.mItems[aItem.id] = parentItem;

        // notify the listener
        this.notifyOperationComplete(aListener,
                                     Components.results.NS_OK,
                                     Components.interfaces.calIOperationListener.ADD,
                                     aItem.id,
                                     aItem);
        // notify observers
        this.mObservers.notify("onAddItem", [aItem]);
    },

    // void modifyItem( in calIItemBase aNewItem, in calIItemBase aOldItem, in calIOperationListener aListener );
    modifyItem: function(aNewItem, aOldItem, aListener) {
        if (this.readOnly) {
            throw Components.interfaces.calIErrors.CAL_IS_READONLY;
        }
        if (!aNewItem) {
            throw Components.results.NS_ERROR_INVALID_ARG;
        }

        let self = this;
        function reportError(errStr, errId) {
            self.notifyOperationComplete(aListener,
                                         errId ? errId : Components.results.NS_ERROR_FAILURE,
                                         Components.interfaces.calIOperationListener.MODIFY,
                                         aNewItem.id,
                                         errStr);
            return null;
        }

        if (!aNewItem.id) {
            // this is definitely an error
            return reportError(null, "ID for modifyItem item is null");
        }

        let modifiedItem = aNewItem.parentItem.clone();
        if (aNewItem.parentItem != aNewItem) {
            modifiedItem.recurrenceInfo.modifyException(aNewItem, false);
        }

        // If no old item was passed, then we should overwrite in any case.
        // Pick up the old item from our items array and use this as an old item
        // later on.
        if (!aOldItem) {
            aOldItem = this.mItems[aNewItem.id];
        }

        if (this.relaxedMode) {
            // We've already filled in the old item above, if this doesn't exist
            // then just take the current item as its old version
            if (!aOldItem) {
                aOldItem = modifiedItem;
            }
            aOldItem = aOldItem.parentItem;
        } else if (!this.relaxedMode) {
            if (!aOldItem || !this.mItems[aNewItem.id]) {
                // no old item found?  should be using addItem, then.
                return reportError("ID for modifyItem doesn't exist, is null, or is from different calendar");
            }

            // do the old and new items match?
            if (aOldItem.id != modifiedItem.id) {
                return reportError("item ID mismatch between old and new items");
            }

            aOldItem = aOldItem.parentItem;
            let storedOldItem = this.mItems[aOldItem.id];

            // compareItems is not suitable here. See bug 418805.
            // Cannot compare here due to bug 380060
            if (!cal.compareItemContent(storedOldItem, aOldItem)) {
                return reportError("old item mismatch in modifyItem. storedId:" + storedOldItem.icalComponent + " old item:" + aOldItem.icalComponent);
            }
            // offline bug

            if (aOldItem.generation != storedOldItem.generation) {
                return reportError("generation mismatch in modifyItem");
            }

            if (aOldItem.generation == modifiedItem.generation) { // has been cloned and modified
                // Only take care of incrementing the generation if relaxed mode is
                // off. Users of relaxed mode need to take care of this themselves.
                modifiedItem.generation += 1;
            }
        }

        modifiedItem.makeImmutable();
        this.mItems[modifiedItem.id] = modifiedItem;

        this.notifyOperationComplete(aListener,
                                     Components.results.NS_OK,
                                     Components.interfaces.calIOperationListener.MODIFY,
                                     modifiedItem.id,
                                     modifiedItem);

        // notify observers
        this.mObservers.notify("onModifyItem", [modifiedItem, aOldItem]);
        return null;
    },

    // void deleteItem( in calIItemBase aItem, in calIOperationListener aListener );
    deleteItem: function(aItem, aListener) {
        if (this.readOnly) {
            this.notifyOperationComplete(aListener,
                                         Components.interfaces.calIErrors.CAL_IS_READONLY,
                                         Components.interfaces.calIOperationListener.DELETE,
                                         aItem.id,
                                         "Calendar is readonly");
            return;
        }
        if (aItem.id == null) {
            this.notifyOperationComplete(aListener,
                                         Components.results.NS_ERROR_FAILURE,
                                         Components.interfaces.calIOperationListener.DELETE,
                                         aItem.id,
                                         "ID is null in deleteItem");
            return;
        }

        let oldItem;
        if (this.relaxedMode) {
            oldItem = aItem;
        } else {
            oldItem = this.mItems[aItem.id];
            if (oldItem.generation != aItem.generation) {
                this.notifyOperationComplete(aListener,
                                             Components.results.NS_ERROR_FAILURE,
                                             Components.interfaces.calIOperationListener.DELETE,
                                             aItem.id,
                                             "generation mismatch in deleteItem");
                return;
            }
        }


        delete this.mItems[aItem.id];
        this.mMetaData.deleteProperty(aItem.id);

        this.notifyOperationComplete(aListener,
                                     Components.results.NS_OK,
                                     Components.interfaces.calIOperationListener.DELETE,
                                     aItem.id,
                                     aItem);
        // notify observers
        this.mObservers.notify("onDeleteItem", [oldItem]);
    },

    // void getItem( in string id, in calIOperationListener aListener );
    getItem: function(aId, aListener) {
        if (!aListener) {
            return;
        }

        if (aId == null || this.mItems[aId] == null) {
            // querying by id is a valid use case, even if no item is returned:
            this.notifyOperationComplete(aListener,
                                         Components.results.NS_OK,
                                         Components.interfaces.calIOperationListener.GET,
                                         aId,
                                         null);
            return;
        }

        let item = this.mItems[aId];
        let iid = null;

        if (cal.isEvent(item)) {
            iid = Components.interfaces.calIEvent;
        } else if (cal.isToDo(item)) {
            iid = Components.interfaces.calITodo;
        } else {
            this.notifyOperationComplete(aListener,
                                         Components.results.NS_ERROR_FAILURE,
                                         Components.interfaces.calIOperationListener.GET,
                                         aId,
                                         "Can't deduce item type based on QI");
            return;
        }

        aListener.onGetResult(this.superCalendar,
                              Components.results.NS_OK,
                              iid,
                              null, 1, [item]);

        this.notifyOperationComplete(aListener,
                                     Components.results.NS_OK,
                                     Components.interfaces.calIOperationListener.GET,
                                     aId,
                                     null);
    },

    // void getItems( in unsigned long aItemFilter, in unsigned long aCount,
    //                in calIDateTime aRangeStart, in calIDateTime aRangeEnd,
    //                in calIOperationListener aListener );
    getItems: function(aItemFilter, aCount,
                        aRangeStart, aRangeEnd, aListener) {
        cal.postPone(() => {
            this.getItems_(aItemFilter, aCount, aRangeStart, aRangeEnd, aListener);
        });
    },
    getItems_: function(aItemFilter, aCount,
                         aRangeStart, aRangeEnd, aListener) {
        if (!aListener) {
            return;
        }

        const calICalendar = Components.interfaces.calICalendar;

        let itemsFound = [];

        //
        // filters
        //

        let wantUnrespondedInvitations = ((aItemFilter & calICalendar.ITEM_FILTER_REQUEST_NEEDS_ACTION) != 0);
        let superCal;
        try {
            superCal = this.superCalendar.QueryInterface(Components.interfaces.calISchedulingSupport);
        } catch (exc) {
            wantUnrespondedInvitations = false;
        }
        function checkUnrespondedInvitation(item) {
            let att = superCal.getInvitedAttendee(item);
            return att && att.participationStatus == "NEEDS-ACTION";
        }

        // item base type
        let wantEvents = ((aItemFilter & calICalendar.ITEM_FILTER_TYPE_EVENT) != 0);
        let wantTodos = ((aItemFilter & calICalendar.ITEM_FILTER_TYPE_TODO) != 0);
        if (!wantEvents && !wantTodos) {
            // bail.
            this.notifyOperationComplete(aListener,
                                         Components.results.NS_ERROR_FAILURE,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         "Bad aItemFilter passed to getItems");
            return;
        }

        // completed?
        let itemCompletedFilter = ((aItemFilter & calICalendar.ITEM_FILTER_COMPLETED_YES) != 0);
        let itemNotCompletedFilter = ((aItemFilter & calICalendar.ITEM_FILTER_COMPLETED_NO) != 0);
        function checkCompleted(item) {
            return (item.isCompleted ? itemCompletedFilter : itemNotCompletedFilter);
        }

        // return occurrences?
        let itemReturnOccurrences = ((aItemFilter & calICalendar.ITEM_FILTER_CLASS_OCCURRENCES) != 0);

        // figure out the return interface type
        let typeIID = null;
        if (itemReturnOccurrences) {
            typeIID = Components.interfaces.calIItemBase;
        } else if (wantEvents && wantTodos) {
            typeIID = Components.interfaces.calIItemBase;
        } else if (wantEvents) {
            typeIID = Components.interfaces.calIEvent;
        } else if (wantTodos) {
            typeIID = Components.interfaces.calITodo;
        }

        aRangeStart = cal.ensureDateTime(aRangeStart);
        aRangeEnd = cal.ensureDateTime(aRangeEnd);


        let offline_filter = aItemFilter &
            (calICalendar.ITEM_FILTER_OFFLINE_DELETED |
             calICalendar.ITEM_FILTER_OFFLINE_CREATED |
             calICalendar.ITEM_FILTER_OFFLINE_MODIFIED);

        cal.forEach(this.mItems, ([id, item]) => {
            let isEvent_ = cal.isEvent(item);
            if (isEvent_) {
                if (!wantEvents) {
                    return cal.forEach.CONTINUE;
                }
            } else if (!wantTodos) {
                return cal.forEach.CONTINUE;
            }

            let hasItemFlag = (item.id in this.mOfflineFlags);
            let offlineFlag = (hasItemFlag ? this.mOfflineFlags[item.id] : null);

            // If the offline flag doesn't match, skip the item
            if ((hasItemFlag ||
                    (offline_filter != 0 && offlineFlag == cICL.OFFLINE_FLAG_DELETED_RECORD)) &&
                (offlineFlag != offline_filter)) {
                return cal.forEach.CONTINUE;
            }

            if (itemReturnOccurrences && item.recurrenceInfo) {
                let startDate = aRangeStart;
                if (!aRangeStart && cal.isToDo(item)) {
                    startDate = item.entryDate;
                }
                let occurrences = item.recurrenceInfo.getOccurrences(
                    startDate, aRangeEnd, aCount ? aCount - itemsFound.length : 0, {});
                if (wantUnrespondedInvitations) {
                    occurrences = occurrences.filter(checkUnrespondedInvitation);
                }
                if (!isEvent_) {
                    occurrences = occurrences.filter(checkCompleted);
                }
                itemsFound = itemsFound.concat(occurrences);
            } else if ((!wantUnrespondedInvitations || checkUnrespondedInvitation(item)) &&
                       (isEvent_ || checkCompleted(item)) &&
                       cal.checkIfInRange(item, aRangeStart, aRangeEnd)) {
                // This needs fixing for recurring items, e.g. DTSTART of parent may occur before aRangeStart.
                // This will be changed with bug 416975.
                itemsFound.push(item);
            }
            if (aCount && itemsFound.length >= aCount) {
                return cal.forEach.BREAK;
            }
            return cal.forEach.CONTINUE;
        }, () => {
            aListener.onGetResult(this.superCalendar,
                                  Components.results.NS_OK,
                                  typeIID,
                                  null,
                                  itemsFound.length,
                                  itemsFound);
            this.notifyOperationComplete(aListener,
                                         Components.results.NS_OK,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         null);
        });
    },

    //
    // calIOfflineStorage interface
    //
    addOfflineItem: function(aItem, aListener) {
        this.mOfflineFlags[aItem.id] = cICL.OFFLINE_FLAG_CREATED_RECORD;
        this.notifyOperationComplete(aListener,
                                     Components.results.NS_OK,
                                     Components.interfaces.calIOperationListener.ADD,
                                     aItem.id,
                                     aItem);
    },

    modifyOfflineItem: function(aItem, aListener) {
        let oldFlag = this.mOfflineFlags[aItem.id];
        if (oldFlag != cICL.OFFLINE_FLAG_CREATED_RECORD &&
            oldFlag != cICL.OFFLINE_FLAG_DELETED_RECORD) {
            this.mOfflineFlags[aItem.id] = cICL.OFFLINE_FLAG_MODIFIED_RECORD;
        }

        this.notifyOperationComplete(aListener,
                                     Components.results.NS_OK,
                                     Components.interfaces.calIOperationListener.MODIFY,
                                     aItem.id,
                                     aItem);
    },

    deleteOfflineItem: function(aItem, aListener) {
        let oldFlag = this.mOfflineFlags[aItem.id];
        if (oldFlag == cICL.OFFLINE_FLAG_CREATED_RECORD) {
            delete this.mItems[aItem.id];
            delete this.mOfflineFlags[aItem.id];
        } else {
            this.mOfflineFlags[aItem.id] = cICL.OFFLINE_FLAG_DELETED_RECORD;
        }

        this.notifyOperationComplete(aListener,
                                     Components.results.NS_OK,
                                     Components.interfaces.calIOperationListener.DELETE,
                                     aItem.id,
                                     aItem);
        // notify observers
        this.observers.notify("onDeleteItem", [aItem]);
    },

    getItemOfflineFlag: function(aItem, aListener) {
        let flag = (aItem && aItem.id in this.mOfflineFlags ? this.mOfflineFlags[aItem.id] : null);
        this.notifyOperationComplete(aListener, Components.results.NS_OK,
                                     Components.interfaces.calIOperationListener.GET,
                                     null, flag);
    },

    resetItemOfflineFlag: function(aItem, aListener) {
        delete this.mOfflineFlags[aItem.id];
        this.notifyOperationComplete(aListener, Components.results.NS_OK,
                                     Components.interfaces.calIOperationListener.MODIFY,
                                     aItem.id, aItem);
    },

    //
    // calISyncWriteCalendar interface
    //
    setMetaData: function(id, value) {
        this.mMetaData.setProperty(id, value);
    },
    deleteMetaData: function(id) {
        this.mMetaData.deleteProperty(id);
    },
    getMetaData: function(id) {
        return this.mMetaData.getProperty(id);
    },
    getAllMetaData: function(out_count, out_ids, out_values) {
        this.mMetaData.getAllProperties(out_ids, out_values);
        out_count.value = out_ids.value.length;
    }
};

/** Module Registration */
this.NSGetFactory = XPCOMUtils.generateNSGetFactory([calMemoryCalendar]);
