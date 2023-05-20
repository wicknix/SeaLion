/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

var calICalendar = Components.interfaces.calICalendar;
var cICL = Components.interfaces.calIChangeLog;
var cIOL = Components.interfaces.calIOperationListener;

var gNoOpListener = {
    QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
    onGetResult: function(calendar, status, itemType, detail, count, items) {
    },

    onOperationComplete: function(calendar, status, opType, id, detail) {
    }
};

/**
 * Returns true if the exception passed is one that should cause the cache
 * layer to retry the operation. This is usually a network error or other
 * temporary error.
 *
 * @param result     The result code to check.
 * @return           True, if the result code means server unavailability.
 */
function isUnavailableCode(result) {
    // Stolen from nserror.h
    const NS_ERROR_MODULE_NETWORK = 6;
    function NS_ERROR_GET_MODULE(code) {
        return (((code >> 16) - 0x45) & 0x1fff);
    }

    if (NS_ERROR_GET_MODULE(result) == NS_ERROR_MODULE_NETWORK &&
        !Components.isSuccessCode(result)) {
        // This is a network error, which most likely means we should
        // retry it some time.
        return true;
    }

    // Other potential errors we want to retry with
    switch (result) {
        case Components.results.NS_ERROR_NOT_AVAILABLE:
            return true;
        default:
            return false;
    }
}

function calCachedCalendarObserverHelper(home, isCachedObserver) {
    this.home = home;
    this.isCachedObserver = isCachedObserver;
}
calCachedCalendarObserverHelper.prototype = {
    QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIObserver]),
    isCachedObserver: false,

    onStartBatch: function() {
        this.home.mObservers.notify("onStartBatch");
    },

    onEndBatch: function() {
        this.home.mObservers.notify("onEndBatch");
    },

    onLoad: function(calendar) {
        if (this.isCachedObserver) {
            this.home.mObservers.notify("onLoad", [this.home]);
        } else {
            // start sync action after uncached calendar has been loaded.
            // xxx todo, think about:
            // although onAddItem et al have been called, we need to fire
            // an additional onLoad completing the refresh call (->composite)
            let home = this.home;
            home.synchronize((status) => {
                home.mObservers.notify("onLoad", [home]);
            });
        }
    },

    onAddItem: function(aItem) {
        if (this.isCachedObserver) {
            this.home.mObservers.notify("onAddItem", arguments);
        }
    },

    onModifyItem: function(aNewItem, aOldItem) {
        if (this.isCachedObserver) {
            this.home.mObservers.notify("onModifyItem", arguments);
        }
    },

    onDeleteItem: function(aItem) {
        if (this.isCachedObserver) {
            this.home.mObservers.notify("onDeleteItem", arguments);
        }
    },

    onError: function(aCalendar, aErrNo, aMessage) {
        this.home.mObservers.notify("onError", arguments);
    },

    onPropertyChanged: function(aCalendar, aName, aValue, aOldValue) {
        if (!this.isCachedObserver) {
            this.home.mObservers.notify("onPropertyChanged", [this.home, aName, aValue, aOldValue]);
        }
    },

    onPropertyDeleting: function(aCalendar, aName) {
        if (!this.isCachedObserver) {
            this.home.mObservers.notify("onPropertyDeleting", [this.home, aName]);
        }
    }
};

function calCachedCalendar(uncachedCalendar) {
    this.wrappedJSObject = this;
    this.mSyncQueue = [];
    this.mObservers = new cal.ObserverBag(Components.interfaces.calIObserver);
    uncachedCalendar.superCalendar = this;
    uncachedCalendar.addObserver(new calCachedCalendarObserverHelper(this, false));
    this.mUncachedCalendar = uncachedCalendar;
    this.setupCachedCalendar();
    if (this.supportsChangeLog) {
        uncachedCalendar.offlineStorage = this.mCachedCalendar;
    }
    this.offlineCachedItems = {};
    this.offlineCachedItemFlags = {};
}
calCachedCalendar.prototype = {
    QueryInterface: function(aIID) {
        if (aIID.equals(Components.interfaces.calISchedulingSupport) &&
            this.mUncachedCalendar.QueryInterface(aIID)) {
            // check whether uncached calendar supports it:
            return this;
        } else if (aIID.equals(Components.interfaces.calICalendar) ||
                   aIID.equals(Components.interfaces.nsISupports)) {
            return this;
        } else {
            throw Components.results.NS_ERROR_NO_INTERFACE;
        }
    },

    mCachedCalendar: null,
    mCachedObserver: null,
    mUncachedCalendar: null,
    mObservers: null,
    mSuperCalendar: null,
    offlineCachedItems: null,
    offlineCachedItemFlags: null,

    onCalendarUnregistering: function() {
        if (this.mCachedCalendar) {
            let self = this;
            this.mCachedCalendar.removeObserver(this.mCachedObserver);
            // TODO put changes into a different calendar and delete
            // afterwards.

            let listener = {
                onDeleteCalendar: function(aCalendar, aStatus, aDetail) {
                    self.mCachedCalendar = null;
                }
            };

            this.mCachedCalendar.QueryInterface(Components.interfaces.calICalendarProvider)
                                .deleteCalendar(this.mCachedCalendar, listener);
        }
    },

    setupCachedCalendar: function() {
        try {
            if (this.mCachedCalendar) { // this is actually a resetupCachedCalendar:
                // Although this doesn't really follow the spec, we know the
                // storage calendar's deleteCalendar method is synchronous.
                // TODO put changes into a different calendar and delete
                // afterwards.
                this.mCachedCalendar.QueryInterface(Components.interfaces.calICalendarProvider)
                                    .deleteCalendar(this.mCachedCalendar, null);
                if (this.supportsChangeLog) {
                    // start with full sync:
                    this.mUncachedCalendar.resetLog();
                }
            } else {
                let calType = Preferences.get("calendar.cache.type", "storage");
                // While technically, the above deleteCalendar should delete the
                // whole calendar, this is nothing more than deleting all events
                // todos and properties. Therefore the initialization can be
                // skipped.
                let cachedCalendar = Components.classes["@mozilla.org/calendar/calendar;1?type=" + calType]
                                               .createInstance(Components.interfaces.calICalendar);
                switch (calType) {
                    case "memory": {
                        if (this.supportsChangeLog) {
                            // start with full sync:
                            this.mUncachedCalendar.resetLog();
                        }
                        break;
                    }
                    case "storage": {
                        let file = getCalendarDirectory();
                        file.append("cache.sqlite");
                        cachedCalendar.uri = Services.io.newFileURI(file);
                        cachedCalendar.id = this.id;
                        break;
                    }
                    default: {
                        throw new Error("unsupported cache calendar type: " + calType);
                    }
                }
                cachedCalendar.transientProperties = true;
                cachedCalendar.setProperty("relaxedMode", true);
                cachedCalendar.superCalendar = this;
                if (!this.mCachedObserver) {
                    this.mCachedObserver = new calCachedCalendarObserverHelper(this, true);
                }
                cachedCalendar.addObserver(this.mCachedObserver);
                this.mCachedCalendar = cachedCalendar;
            }
        } catch (exc) {
            Components.utils.reportError(exc);
        }
    },

    getOfflineAddedItems: function(callbackFunc) {
        let self = this;
        self.offlineCachedItems = {};
        let getListener = {
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
            onGetResult: function(aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                for (let item of aItems) {
                    self.offlineCachedItems[item.hashId] = item;
                    self.offlineCachedItemFlags[item.hashId] = cICL.OFFLINE_FLAG_CREATED_RECORD;
                }
            },

            onOperationComplete: function(aCalendar, aStatus, aOpType, aId, aDetail) {
                self.getOfflineModifiedItems(callbackFunc);
            }
        };
        this.mCachedCalendar.getItems(calICalendar.ITEM_FILTER_ALL_ITEMS | calICalendar.ITEM_FILTER_OFFLINE_CREATED,
                                      0, null, null, getListener);
    },

    getOfflineModifiedItems: function(callbackFunc) {
        let self = this;
        let getListener = {
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
            onGetResult: function(aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                for (let item of aItems) {
                    self.offlineCachedItems[item.hashId] = item;
                    self.offlineCachedItemFlags[item.hashId] = cICL.OFFLINE_FLAG_MODIFIED_RECORD;
                }
            },

            onOperationComplete: function(aCalendar, aStatus, aOpType, aId, aDetail) {
                self.getOfflineDeletedItems(callbackFunc);
            }
        };
        this.mCachedCalendar.getItems(calICalendar.ITEM_FILTER_OFFLINE_MODIFIED | calICalendar.ITEM_FILTER_ALL_ITEMS,
                                      0, null, null, getListener);
    },

    getOfflineDeletedItems: function(callbackFunc) {
        let self = this;
        let getListener = {
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
            onGetResult: function(aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                for (let item of aItems) {
                    self.offlineCachedItems[item.hashId] = item;
                    self.offlineCachedItemFlags[item.hashId] = cICL.OFFLINE_FLAG_DELETED_RECORD;
                }
            },

            onOperationComplete: function(aCalendar, aStatus, aOpType, aId, aDetail) {
                if (callbackFunc) {
                    callbackFunc();
                }
            }
        };
        this.mCachedCalendar.getItems(calICalendar.ITEM_FILTER_OFFLINE_DELETED | calICalendar.ITEM_FILTER_ALL_ITEMS,
                                      0, null, null, getListener);
    },

    mPendingSync: null,
    mSyncQueue: null,
    synchronize: function(respFunc) {
        let self = this;
        if (this.getProperty("disabled")) {
            return emptyQueue(Components.results.NS_OK);
        }

        this.mSyncQueue.push(respFunc);
        if (this.mSyncQueue.length > 1) { // don't use mPendingSync here
            cal.LOG("[calCachedCalendar] sync in action/pending.");
            return this.mPendingSync;
        }

        function emptyQueue(status) {
            let queue = self.mSyncQueue;
            self.mSyncQueue = [];
            function execResponseFunc(func) {
                try {
                    func(status);
                } catch (exc) {
                    cal.ASSERT(false, exc);
                }
            }
            queue.forEach(execResponseFunc);
            cal.LOG("[calCachedCalendar] sync queue empty.");
            let operation = self.mPendingSync;
            self.mPendingSync = null;
            return operation;
        }

        if (this.offline) {
            return emptyQueue(Components.results.NS_OK);
        }

        if (this.supportsChangeLog) {
            cal.LOG("[calCachedCalendar] Doing changelog based sync for calendar " + this.uri.spec);
            let opListener = {
                onResult: function(operation, result) {
                    if (!operation || !operation.isPending) {
                        let status = (operation ? operation.status : Components.results.NS_OK);
                        if (!Components.isSuccessCode(status)) {
                            cal.ERROR("[calCachedCalendar] replay action failed: " +
                                      (operation ? operation.id : "<unknown>") + ", uri=" +
                                      self.uri.spec + ", result=" +
                                      result + ", operation=" + operation);
                        }
                        cal.LOG("[calCachedCalendar] replayChangesOn finished.");
                        emptyQueue(status);
                    }
                }
            };
            this.mPendingSync = this.mUncachedCalendar.replayChangesOn(opListener);
            return this.mPendingSync;
        }

        cal.LOG("[calCachedCalendar] Doing full sync for calendar " + this.uri.spec);
        let completeListener = {
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
            modifiedTimes: {},
            hasRenewedCalendar: false,
            getsCompleted: 0,
            getsReceived: 0,
            opCompleted: false,

            onGetResult: function(aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                if (Components.isSuccessCode(aStatus)) {
                    if (!this.hasRenewedCalendar) {
                        // TODO instead of deleting the calendar and creating a new
                        // one, maybe we want to do a "real" sync between the
                        // existing local calendar and the remote calendar.
                        self.setupCachedCalendar();
                        this.hasRenewedCalendar = true;
                    }

                    this.getsReceived++;
                    cal.forEach(aItems, (item) => {
                        // Adding items recd from the Memory Calendar
                        // These may be different than what the cache has
                        completeListener.modifiedTimes[item.id] = item.lastModifiedTime;
                        self.mCachedCalendar.addItem(item, null);
                    }, () => {
                        completeListener.getsCompleted++;
                        if (completeListener.opCompleted) {
                            // onOperationComplete was called, but we were not ready yet. call it now.
                            completeListener.onOperationComplete(...completeListener.opCompleted);
                            completeListener.opCompleted = false;
                        }
                    });
                }
            },

            onOperationComplete: function(aCalendar, aStatus, aOpType, aId, aDetail) {
                if (this.getsCompleted < this.getsReceived) {
                    // If not all of our gets have been processed, then save the
                    // arguments and finish processing later.
                    this.opCompleted = Array.slice(arguments);
                    return;
                }

                if (Components.isSuccessCode(aStatus)) {
                    cal.forEach(self.offlineCachedItems, (item) => {
                        switch (self.offlineCachedItemFlags[item.hashId]) {
                            case cICL.OFFLINE_FLAG_CREATED_RECORD:
                                // Created items are not present on the server, so its safe to adopt them
                                self.adoptOfflineItem(item.clone(), null);
                                break;
                            case cICL.OFFLINE_FLAG_MODIFIED_RECORD:
                                // Two Cases Here:
                                if (item.id in completeListener.modifiedTimes) {
                                    // The item is still on the server, we just retrieved it in the listener above.
                                    if (item.lastModifiedTime.compare(completeListener.modifiedTimes[item.id]) < 0) {
                                        // The item on the server has been modified, ask to overwrite
                                        cal.WARN("[calCachedCalendar] Item '" + item.title + "' at the server seems to be modified recently.");
                                        self.promptOverwrite("modify", item, null, null);
                                    } else {
                                        // Our item is newer, just modify the item
                                        self.modifyOfflineItem(item, null, null);
                                    }
                                } else {
                                    // The item has been deleted from the server, ask if it should be added again
                                    cal.WARN("[calCachedCalendar] Item '" + item.title + "' has been deleted from the server");
                                    if (cal.promptOverwrite("modify", item, null, null)) {
                                        self.adoptOfflineItem(item.clone(), null);
                                    }
                                }
                                break;
                            case cICL.OFFLINE_FLAG_DELETED_RECORD:
                                if (item.id in completeListener.modifiedTimes) {
                                    // The item seems to exist on the server...
                                    if (item.lastModifiedTime.compare(completeListener.modifiedTimes[item.id]) < 0) {
                                        // ...and has been modified on the server. Ask to overwrite
                                        cal.WARN("[calCachedCalendar] Item '" + item.title + "' at the server seems to be modified recently.");
                                        self.promptOverwrite("delete", item, null, null);
                                    } else {
                                        // ...and has not been modified. Delete it now.
                                        self.deleteOfflineItem(item, null);
                                    }
                                } else {
                                    // Item has already been deleted from the server, no need to change anything.
                                }
                                break;
                        }
                    }, () => {
                        self.offlineCachedItems = {};
                        self.offlineCachedItemFlags = {};
                        self.playbackOfflineItems(() => emptyQueue(aStatus));
                    });
                } else {
                    self.playbackOfflineItems(() => self.mCachedObserver.onLoad(self.mCachedCalendar));
                    emptyQueue(aStatus);
                }
            }
        };

        this.getOfflineAddedItems(() => {
            this.mPendingSync = this.mUncachedCalendar.getItems(Components.interfaces.calICalendar.ITEM_FILTER_ALL_ITEMS,
                                                                    0, null, null, completeListener);
        });
        return this.mPendingSync;
    },

    onOfflineStatusChanged: function(aNewState) {
        if (aNewState) {
            // Going offline: (XXX get items before going offline?) => we may ask the user to stay online a bit longer
        } else {
            // Going online (start replaying changes to the remote calendar)
            this.refresh();
        }
    },

    // aOldItem is already in the cache
    promptOverwrite: function(aMethod, aItem, aListener, aOldItem) {
        let overwrite = cal.promptOverwrite(aMethod, aItem, aListener, aOldItem);
        if (overwrite) {
            if (aMethod == "modify") {
                this.modifyOfflineItem(aItem, aOldItem, aListener);
            } else {
                this.deleteOfflineItem(aItem, aListener);
            }
        }
    },

    /*
     * Asynchronously performs playback operations of items added, modified, or deleted offline
     *
     * @param aCallback         (optional) The function to be callled when playback is complete.
     * @param aPlaybackType     (optional) The starting operation type. This function will be
     *                          called recursively through playback operations in the order of
     *                          add, modify, delete. By default playback will start with the add
     *                          operation. Valid values for this parameter are defined as
     *                          OFFLINE_FLAG_XXX constants in the calIChangeLog interface.
     */
    playbackOfflineItems: function(aCallback, aPlaybackType) {
        let self = this;
        let storage = this.mCachedCalendar.QueryInterface(Components.interfaces.calIOfflineStorage);

        let resetListener = gNoOpListener;
        let itemQueue = [];
        let debugOp;
        let nextCallback;
        let uncachedOp;
        let listenerOp;
        let filter;

        aPlaybackType = aPlaybackType || cICL.OFFLINE_FLAG_CREATED_RECORD;
        switch (aPlaybackType) {
            case cICL.OFFLINE_FLAG_CREATED_RECORD:
                debugOp = "add";
                nextCallback = this.playbackOfflineItems.bind(this, aCallback, cICL.OFFLINE_FLAG_MODIFIED_RECORD);
                uncachedOp = this.mUncachedCalendar.addItem.bind(this.mUncachedCalendar);
                listenerOp = cIOL.ADD;
                filter = calICalendar.ITEM_FILTER_OFFLINE_CREATED;
                break;
            case cICL.OFFLINE_FLAG_MODIFIED_RECORD:
                debugOp = "modify";
                nextCallback = this.playbackOfflineItems.bind(this, aCallback, cICL.OFFLINE_FLAG_DELETED_RECORD);
                uncachedOp = function(item, listener) { self.mUncachedCalendar.modifyItem(item, item, listener); };
                listenerOp = cIOL.MODIFY;
                filter = calICalendar.ITEM_FILTER_OFFLINE_MODIFIED;
                break;
            case cICL.OFFLINE_FLAG_DELETED_RECORD:
                debugOp = "delete";
                nextCallback = aCallback;
                uncachedOp = this.mUncachedCalendar.deleteItem.bind(this.mUncachedCalendar);
                listenerOp = cIOL.MODIFY;
                filter = calICalendar.ITEM_FILTER_OFFLINE_DELETED;
                break;
            default:
                cal.ERROR("[calCachedCalendar] Invalid playback type: " + aPlaybackType);
                return;
        }

        let opListener = {
            onGetResult: function(calendar, status, itemType, detail, count, items) {},
            onOperationComplete: function(calendar, status, opType, id, detail) {
                if (Components.isSuccessCode(status)) {
                    if (aPlaybackType == cICL.OFFLINE_FLAG_DELETED_RECORD) {
                        self.mCachedCalendar.deleteItem(detail, resetListener);
                    } else {
                        storage.resetItemOfflineFlag(detail, resetListener);
                    }
                } else {
                    // If the playback action could not be performed, then there
                    // is no need for further action. The item still has the
                    // offline flag, so it will be taken care of next time.
                    cal.WARN("[calCachedCalendar] Unable to perform playback action " + debugOp +
                             " to the server, will try again next time (" + id + "," + detail + ")");
                }

                // move on to the next item in the queue
                popItemQueue();
            }
        };

        function popItemQueue() {
            if (!itemQueue || itemQueue.length == 0) {
                // no items left in the queue, move on to the next operation
                if (nextCallback) {
                    nextCallback();
                }
            } else {
                // perform operation on the next offline item in the queue
                let item = itemQueue.pop();
                try {
                    uncachedOp(item, opListener);
                } catch (e) {
                    cal.ERROR("[calCachedCalendar] Could not perform playback operation " + debugOp +
                            " for item " + (item.title || " (none) ") + ": " + e);
                    opListener.onOperationComplete(self, e.result, listenerOp, item.id, e.message);
                }
            }
        }

        let getListener = {
            onGetResult: function(calendar, status, itemType, detail, count, items) {
                itemQueue = itemQueue.concat(items);
            },
            onOperationComplete: function(calendar, status, opType, id, detail) {
                if (self.offline) {
                    cal.LOG("[calCachedCalendar] back to offline mode, reconciliation aborted");
                    if (aCallback) {
                        aCallback();
                    }
                } else {
                    cal.LOG("[calCachedCalendar] Performing playback operation " + debugOp +
                            " on " + itemQueue.length + " items to " + self.name);

                    // start the first operation
                    popItemQueue();
                }
            }
        };

        this.mCachedCalendar.getItems(calICalendar.ITEM_FILTER_ALL_ITEMS | filter,
                                      0, null, null, getListener);
    },

    get superCalendar() {
        return (this.mSuperCalendar && this.mSuperCalendar.superCalendar) || this;
    },
    set superCalendar(val) {
        return (this.mSuperCalendar = val);
    },

    get offline() {
        return Services.io.offline;
    },
    get supportsChangeLog() {
        return (cal.wrapInstance(this.mUncachedCalendar, Components.interfaces.calIChangeLog) != null);
    },

    get canRefresh() { // enable triggering sync using the reload button
        return true;
    },

    getProperty: function(aName) {
        switch (aName) {
            case "cache.enabled":
                if (this.mUncachedCalendar.getProperty("cache.always")) {
                    return true;
                }
                break;
        }

        return this.mUncachedCalendar.getProperty(aName);
    },
    refresh: function() {
        if (this.offline) {
            this.downstreamRefresh();
        } else if (this.supportsChangeLog) {
            /* we first ensure that any remaining offline items are reconciled with the calendar server */
            this.playbackOfflineItems(this.downstreamRefresh.bind(this));
        } else {
            this.downstreamRefresh();
        }
    },
    downstreamRefresh: function() {
        if (this.mUncachedCalendar.canRefresh && !this.offline) {
            return this.mUncachedCalendar.refresh(); // will trigger synchronize once the calendar is loaded
        } else {
            return this.synchronize((status) => { // fire completing onLoad for this refresh call
                this.mCachedObserver.onLoad(this.mCachedCalendar);
            });
        }
    },

    addObserver: function(aObserver) {
        this.mObservers.add(aObserver);
    },
    removeObserver: function(aObserver) {
        this.mObservers.remove(aObserver);
    },

    addItem: function(item, listener) {
        return this.adoptItem(item.clone(), listener);
    },
    adoptItem: function(item, listener) {
        // Forwarding add/modify/delete to the cached calendar using the calIObserver
        // callbacks would be advantageous, because the uncached provider could implement
        // a true push mechanism firing without being triggered from within the program.
        // But this would mean the uncached provider fires on the passed
        // calIOperationListener, e.g. *before* it fires on calIObservers
        // (because that order is undefined). Firing onOperationComplete before onAddItem et al
        // would result in this facade firing onOperationComplete even though the modification
        // hasn't yet been performed on the cached calendar (which happens in onAddItem et al).
        // Result is that we currently stick to firing onOperationComplete if the cached calendar
        // has performed the modification, see below:
        let self = this;
        let cacheListener = {
            onGetResult: function(calendar, status, itemType, detail, count, items) {
                cal.ASSERT(false, "unexpected!");
            },
            onOperationComplete: function(calendar, status, opType, id, detail) {
                if (isUnavailableCode(status)) {
                    // The item couldn't be added to the (remote) location,
                    // this is like being offline. Add the item to the cached
                    // calendar instead.
                    cal.LOG("[calCachedCalendar] Calendar " + calendar.name + " is unavailable, adding item offline");
                    self.adoptOfflineItem(item, listener);
                } else if (Components.isSuccessCode(status)) {
                    // On success, add the item to the cache.
                    self.mCachedCalendar.addItem(detail, listener);
                } else if (listener) {
                    // Either an error occurred or this is a successful add
                    // to a cached calendar. Forward the call to the listener
                    listener.onOperationComplete(self, status, opType, id, detail);
                }
            }
        };

        if (this.offline) {
            // If we are offline, don't even try to add the item
            this.adoptOfflineItem(item, listener);
        } else {
            // Otherwise ask the provider to add the item now.
            this.mUncachedCalendar.adoptItem(item, cacheListener);
        }
    },
    adoptOfflineItem: function(item, listener) {
        let self = this;
        let opListener = {
            onGetResult: function(calendar, status, itemType, detail, count, items) {
                cal.ASSERT(false, "unexpected!");
            },
            onOperationComplete: function(calendar, status, opType, id, detail) {
                if (Components.isSuccessCode(status)) {
                    let storage = self.mCachedCalendar.QueryInterface(Components.interfaces.calIOfflineStorage);
                    storage.addOfflineItem(detail, listener);
                } else if (listener) {
                    listener.onOperationComplete(self, status, opType, id, detail);
                }
            }
        };
        this.mCachedCalendar.adoptItem(item, opListener);
    },

    modifyItem: function(newItem, oldItem, listener) {
        let self = this;

        // First of all, we should find out if the item to modify is
        // already an offline item or not.
        let flagListener = {
            onGetResult: function() {},
            onOperationComplete: function(calendar, status, opType, id, offline_flag) {
                if (offline_flag == cICL.OFFLINE_FLAG_CREATED_RECORD ||
                    offline_flag == cICL.OFFLINE_FLAG_MODIFIED_RECORD) {
                    // The item is already offline, just modify it in the cache
                    self.modifyOfflineItem(newItem, oldItem, listener);
                } else {
                    // Not an offline item, attempt to modify using provider
                    self.mUncachedCalendar.modifyItem(newItem, oldItem, cacheListener);
                }
            }
        };

        /* Forwarding add/modify/delete to the cached calendar using the calIObserver
         * callbacks would be advantageous, because the uncached provider could implement
         * a true push mechanism firing without being triggered from within the program.
         * But this would mean the uncached provider fires on the passed
         * calIOperationListener, e.g. *before* it fires on calIObservers
         * (because that order is undefined). Firing onOperationComplete before onAddItem et al
         * would result in this facade firing onOperationComplete even though the modification
         * hasn't yet been performed on the cached calendar (which happens in onAddItem et al).
         * Result is that we currently stick to firing onOperationComplete if the cached calendar
         * has performed the modification, see below: */
        let cacheListener = {
            onGetResult: function() {},
            onOperationComplete: function(calendar, status, opType, id, detail) {
                if (isUnavailableCode(status)) {
                    // The item couldn't be modified at the (remote) location,
                    // this is like being offline. Add the item to the cache
                    // instead.
                    cal.LOG("[calCachedCalendar] Calendar " + calendar.name + " is unavailable, modifying item offline");
                    self.modifyOfflineItem(newItem, oldItem, listener);
                } else if (Components.isSuccessCode(status)) {
                    // On success, modify the item in the cache
                    self.mCachedCalendar.modifyItem(detail, oldItem, listener);
                } else if (listener) {
                    // This happens on error, forward the error through the listener
                    listener.onOperationComplete(self, status, opType, id, detail);
                }
            }
        };

        if (this.offline) {
            // If we are offline, don't even try to modify the item
            this.modifyOfflineItem(newItem, oldItem, listener);
        } else {
            // Otherwise, get the item flags, the listener will further
            // process the item.
            this.mCachedCalendar.getItemOfflineFlag(oldItem, flagListener);
        }
    },

    modifyOfflineItem: function(newItem, oldItem, listener) {
        let self = this;
        let opListener = {
            onGetResult: function(calendar, status, itemType, detail, count, items) {
                cal.ASSERT(false, "unexpected!");
            },
            onOperationComplete: function(calendar, status, opType, id, detail) {
                if (Components.isSuccessCode(status)) {
                    // Modify the offline item in the storage, passing the
                    // listener will make sure its notified
                    let storage = self.mCachedCalendar.QueryInterface(Components.interfaces.calIOfflineStorage);
                    storage.modifyOfflineItem(detail, listener);
                } else if (listener) {
                    // If there was not a success, then we need to notify the
                    // listener ourselves
                    listener.onOperationComplete(self, status, opType, id, detail);
                }
            }
        };

        this.mCachedCalendar.modifyItem(newItem, oldItem, opListener);
    },

    deleteItem: function(item, listener) {
        let self = this;

        // First of all, we should find out if the item to delete is
        // already an offline item or not.
        let flagListener = {
            onGetResult: function() {},
            onOperationComplete: function(calendar, status, opType, id, offline_flag) {
                if (offline_flag == cICL.OFFLINE_FLAG_CREATED_RECORD ||
                    offline_flag == cICL.OFFLINE_FLAG_MODIFIED_RECORD) {
                    // The item is already offline, just mark it deleted it in
                    // the cache
                    self.deleteOfflineItem(item, listener);
                } else {
                    // Not an offline item, attempt to delete using provider
                    self.mUncachedCalendar.deleteItem(item, cacheListener);
                }
            }
        };
        // Forwarding add/modify/delete to the cached calendar using the calIObserver
        // callbacks would be advantageous, because the uncached provider could implement
        // a true push mechanism firing without being triggered from within the program.
        // But this would mean the uncached provider fires on the passed
        // calIOperationListener, e.g. *before* it fires on calIObservers
        // (because that order is undefined). Firing onOperationComplete before onAddItem et al
        // would result in this facade firing onOperationComplete even though the modification
        // hasn't yet been performed on the cached calendar (which happens in onAddItem et al).
        // Result is that we currently stick to firing onOperationComplete if the cached calendar
        // has performed the modification, see below:
        let cacheListener = {
            onGetResult: function() {},
            onOperationComplete: function(calendar, status, opType, id, detail) {
                if (isUnavailableCode(status)) {
                    // The item couldn't be deleted at the (remote) location,
                    // this is like being offline. Mark the item deleted in the
                    // cache instead.
                    cal.LOG("[calCachedCalendar] Calendar " + calendar.name + " is unavailable, deleting item offline");
                    self.deleteOfflineItem(item, listener);
                } else if (Components.isSuccessCode(status)) {
                    // On success, delete the item from the cache
                    self.mCachedCalendar.deleteItem(item, listener);

                    // Also, remove any meta data associated with the item
                    try {
                        let storage = self.mCachedCalendar.QueryInterface(Components.interfaces.calISyncWriteCalendar);
                        storage.deleteMetaData(item.id);
                    } catch (e) {
                        cal.LOG("[calCachedCalendar] Offline storage doesn't support metadata");
                    }
                } else if (listener) {
                    // This happens on error, forward the error through the listener
                    listener.onOperationComplete(self, status, opType, id, detail);
                }
            }
        };

        if (this.offline) {
            // If we are offline, don't even try to delete the item
            this.deleteOfflineItem(item, listener);
        } else {
            // Otherwise, get the item flags, the listener will further
            // process the item.
            this.mCachedCalendar.getItemOfflineFlag(item, flagListener);
        }
    },
    deleteOfflineItem: function(item, listener) {
        /* We do not delete the item from the cache, as we will need it when reconciling the cache content and the server content. */
        let storage = this.mCachedCalendar.QueryInterface(Components.interfaces.calIOfflineStorage);
        storage.deleteOfflineItem(item, listener);
    }
};
(function() {
    function defineForwards(proto, targetName, functions, getters, gettersAndSetters) {
        function defineForwardGetter(attr) {
            proto.__defineGetter__(attr, function() { return this[targetName][attr]; });
        }
        function defineForwardGetterAndSetter(attr) {
            defineForwardGetter(attr);
            proto.__defineSetter__(attr, function(value) { return (this[targetName][attr] = value); });
        }
        function defineForwardFunction(funcName) {
            proto[funcName] = function(...args) {
                let obj = this[targetName];
                return obj[funcName](...args);
            };
        }
        functions.forEach(defineForwardFunction);
        getters.forEach(defineForwardGetter);
        gettersAndSetters.forEach(defineForwardGetterAndSetter);
    }

    defineForwards(calCachedCalendar.prototype, "mUncachedCalendar",
                   ["setProperty", "deleteProperty",
                    "isInvitation", "getInvitedAttendee", "canNotify"],
                   ["type", "aclManager", "aclEntry"],
                   ["id", "name", "uri", "readOnly"]);
    defineForwards(calCachedCalendar.prototype, "mCachedCalendar",
                   ["getItem", "getItems", "startBatch", "endBatch"], [], []);
})();
