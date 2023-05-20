/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calXMLUtils.jsm");
Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");

//
// calICSCalendar.js
//
// This is a non-sync ics file. It reads the file pointer to by uri when set,
// then writes it on updates. External changes to the file will be
// ignored and overwritten.
//
// XXX Should do locks, so that external changes are not overwritten.

var Ci = Components.interfaces;
var calICalendar = Components.interfaces.calICalendar;
var calIErrors = Components.interfaces.calIErrors;

function icsNSResolver(prefix) {
    const ns = { D: "DAV:" }; // eslint-disable-line id-length
    return ns[prefix] || null;
}

function icsXPathFirst(aNode, aExpr, aType) {
    return cal.xml.evalXPathFirst(aNode, aExpr, icsNSResolver, aType);
}

function calICSCalendar() {
    this.initProviderBase();
    this.initICSCalendar();

    this.unmappedComponents = [];
    this.unmappedProperties = [];
    this.queue = [];
    this.mModificationActions = [];
}
var calICSCalendarClassID = Components.ID("{f8438bff-a3c9-4ed5-b23f-2663b5469abf}");
var calICSCalendarInterfaces = [
    Components.interfaces.calICalendarProvider,
    Components.interfaces.calICalendar,
    Components.interfaces.calISchedulingSupport,
    Components.interfaces.nsIStreamListener,
    Components.interfaces.nsIStreamLoaderObserver,
    Components.interfaces.nsIChannelEventSink,
    Components.interfaces.nsIInterfaceRequestor,
];
calICSCalendar.prototype = {
    __proto__: cal.ProviderBase.prototype,
    classID: calICSCalendarClassID,
    QueryInterface: XPCOMUtils.generateQI(calICSCalendarInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calICSCalendarClassID,
        contractID: "@mozilla.org/calendar/calendar;1?type=ics",
        classDescription: "Calendar ICS provider",
        interfaces: calICSCalendarInterfaces,
    }),

    mObserver: null,
    locked: false,

    initICSCalendar: function() {
        this.mMemoryCalendar = Components.classes["@mozilla.org/calendar/calendar;1?type=memory"]
                                         .createInstance(Components.interfaces.calICalendar);

        this.mMemoryCalendar.superCalendar = this;
        this.mObserver = new calICSObserver(this);
        this.mMemoryCalendar.addObserver(this.mObserver); // XXX Not removed
    },

    //
    // calICalendarProvider interface
    //
    get prefChromeOverlay() {
        return null;
    },

    get displayName() {
        return calGetString("calendar", "icsName");
    },

    createCalendar: function() {
        throw NS_ERROR_NOT_IMPLEMENTED;
    },

    deleteCalendar: function(cal, listener) {
        throw NS_ERROR_NOT_IMPLEMENTED;
    },

    //
    // calICalendar interface
    //
    get type() { return "ics"; },

    get canRefresh() {
        return true;
    },

    get uri() { return this.mUri; },
    set uri(aUri) {
        this.mUri = aUri;
        this.mMemoryCalendar.uri = this.mUri;

        // Use the ioservice, to create a channel, which makes finding the
        // right hooks to use easier.
        let channel = Services.io.newChannelFromURI2(this.mUri,
                                                     null,
                                                     Services.scriptSecurityManager.getSystemPrincipal(),
                                                     null,
                                                     Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                     Components.interfaces.nsIContentPolicy.TYPE_OTHER);
        let wHttpChannel = cal.wrapInstance(channel, Components.interfaces.nsIHttpChannel);
        let wFileChannel = cal.wrapInstance(channel, Components.interfaces.nsIFileChannel);

        if (wHttpChannel) {
            this.mHooks = new httpHooks(this);
        } else if (wFileChannel) {
            this.mHooks = new fileHooks(this);
        } else {
            this.mHooks = new dummyHooks(this);
        }
    },

    getProperty: function(aName) {
        switch (aName) {
            case "requiresNetwork":
                return !this.uri.schemeIs("file");
        }
        return this.__proto__.__proto__.getProperty.apply(this, arguments);
    },

    refresh: function() {
        this.queue.push({ action: "refresh", forceRefresh: false });
        this.processQueue();
    },

    forceRefresh: function() {
        this.queue.push({ action: "refresh", forceRefresh: true });
        this.processQueue();
    },

    prepareChannel: function(aChannel, aForceRefresh) {
        aChannel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
        aChannel.notificationCallbacks = this;

        // Allow the hook to do its work, like a performing a quick check to
        // see if the remote file really changed. Might save a lot of time
        this.mHooks.onBeforeGet(aChannel, aForceRefresh);
    },

    createMemoryCalendar: function() {
        // Create a new calendar, to get rid of all the old events
        // Don't forget to remove the observer
        if (this.mMemoryCalendar) {
            this.mMemoryCalendar.removeObserver(this.mObserver);
        }
        this.mMemoryCalendar = Components.classes["@mozilla.org/calendar/calendar;1?type=memory"]
                                         .createInstance(Components.interfaces.calICalendar);
        this.mMemoryCalendar.uri = this.mUri;
        this.mMemoryCalendar.superCalendar = this;
    },

    doRefresh: function(aForce) {
        let prbForce = Components.classes["@mozilla.org/supports-PRBool;1"]
                                 .createInstance(Components.interfaces.nsISupportsPRBool);
        prbForce.data = aForce;

        let channel = Services.io.newChannelFromURI2(this.mUri,
                                                     null,
                                                     Services.scriptSecurityManager.getSystemPrincipal(),
                                                     null,
                                                     Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                     Components.interfaces.nsIContentPolicy.TYPE_OTHER);
        this.prepareChannel(channel, aForce);

        let streamLoader = Components.classes["@mozilla.org/network/stream-loader;1"]
                                     .createInstance(Components.interfaces.nsIStreamLoader);

        // Lock other changes to the item list.
        this.lock();

        try {
            streamLoader.init(this);
            channel.asyncOpen(streamLoader, prbForce);
        } catch (e) {
            // File not found: a new calendar. No problem.
            cal.LOG("[calICSCalendar] Error occurred opening channel: " + e);
            this.unlock();
        }
    },

    // nsIChannelEventSink implementation
    asyncOnChannelRedirect: function(aOldChannel, aNewChannel, aFlags, aCallback) {
        this.prepareChannel(aNewChannel, true);
        aCallback.onRedirectVerifyCallback(Components.results.NS_OK);
    },

    // nsIStreamLoaderObserver impl
    // Listener for download. Parse the downloaded file

    onStreamComplete: function(loader, ctxt, status, resultLength, result) {
        let forceRefresh = ctxt.QueryInterface(Components.interfaces.nsISupportsPRBool).data;
        let cont = false;

        if (Components.isSuccessCode(status)) {
            // Allow the hook to get needed data (like an etag) of the channel
            cont = this.mHooks.onAfterGet(loader.request, forceRefresh);
            cal.LOG("[calICSCalendar] Loading ICS succeeded, needs further processing: " + cont);
        } else {
            // Failure may be due to temporary connection issue, keep old data to
            // prevent potential data loss if it becomes available again.
            cal.LOG("[calICSCalendar] Unable to load stream - status: " + status);
        }

        if (!cont) {
            // no need to process further, we can use the previous data
            // HACK Sorry, but offline support requires the items to be signaled
            // even if nothing has changed (especially at startup)
            this.mObserver.onLoad(this);
            this.unlock();
            return;
        }

        // Clear any existing events if there was no result
        if (!resultLength) {
            this.createMemoryCalendar();
            this.mMemoryCalendar.addObserver(this.mObserver);
            this.mObserver.onLoad(this);
            this.unlock();
            return;
        }

        // This conversion is needed, because the stream only knows about
        // byte arrays, not about strings or encodings. The array of bytes
        // need to be interpreted as utf8 and put into a javascript string.
        let unicodeConverter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                         .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
        // ics files are always utf8
        unicodeConverter.charset = "UTF-8";
        let str;
        try {
            str = unicodeConverter.convertFromByteArray(result, result.length);
        } catch (e) {
            this.mObserver.onError(this.superCalendar, calIErrors.CAL_UTF8_DECODING_FAILED, e.toString());
            this.mObserver.onError(this.superCalendar, calIErrors.READ_FAILED, "");
            this.unlock();
            return;
        }

        this.createMemoryCalendar();

        this.mObserver.onStartBatch();

        // Wrap parsing in a try block. Will ignore errors. That's a good thing
        // for non-existing or empty files, but not good for invalid files.
        // That's why we put them in readOnly mode
        let parser = Components.classes["@mozilla.org/calendar/ics-parser;1"]
                               .createInstance(Components.interfaces.calIIcsParser);
        let self = this;
        let listener = { // calIIcsParsingListener
            onParsingComplete: function(rc, parser_) {
                try {
                    for (let item of parser_.getItems({})) {
                        self.mMemoryCalendar.adoptItem(item, null);
                    }
                    self.unmappedComponents = parser_.getComponents({});
                    self.unmappedProperties = parser_.getProperties({});
                    cal.LOG("[calICSCalendar] Parsing ICS succeeded for " + self.uri.spec);
                } catch (exc) {
                    cal.LOG("[calICSCalendar] Parsing ICS failed for \nException: " + exc);
                    self.mObserver.onError(self.superCalendar, exc.result, exc.toString());
                    self.mObserver.onError(self.superCalendar, calIErrors.READ_FAILED, "");
                }
                self.mObserver.onEndBatch();
                self.mObserver.onLoad(self);

                // Now that all items have been stuffed into the memory calendar
                // we should add ourselves as observer. It is important that this
                // happens *after* the calls to adoptItem in the above loop to prevent
                // the views from being notified.
                self.mMemoryCalendar.addObserver(self.mObserver);
                self.unlock();
            }
        };
        parser.parseString(str, null, listener);
    },

    writeICS: function() {
        cal.LOG("[calICSCalendar] Commencing write of ICS Calendar " + this.name);
        this.lock();
        try {
            if (!this.mUri) {
                throw Components.results.NS_ERROR_FAILURE;
            }
            // makeBackup will call doWriteICS
            this.makeBackup(this.doWriteICS);
        } catch (exc) {
            this.unlock(calIErrors.MODIFICATION_FAILED);
            throw exc;
        }
    },

    doWriteICS: function() {
        cal.LOG("[calICSCalendar] Writing ICS File " + this.uri.spec);
        let self = this;
        let listener = {
            serializer: null,
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
            onOperationComplete: function(aCalendar, aStatus, aOperationType, aId, aDetail) {
                let inLastWindowClosingSurvivalArea = false;
                try {
                    // All events are returned. Now set up a channel and a
                    // streamloader to upload.  onStopRequest will be called
                    // once the write has finished
                    let channel = Services.io.newChannelFromURI2(self.mUri,
                                                                 null,
                                                                 Services.scriptSecurityManager.getSystemPrincipal(),
                                                                 null,
                                                                 Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                                 Components.interfaces.nsIContentPolicy.TYPE_OTHER);

                    // Allow the hook to add things to the channel, like a
                    // header that checks etags
                    let notChanged = self.mHooks.onBeforePut(channel);
                    if (notChanged) {
                        channel.notificationCallbacks = self;
                        let uploadChannel = channel.QueryInterface(
                            Components.interfaces.nsIUploadChannel);

                        // Serialize
                        let icsStream = this.serializer.serializeToInputStream();

                        // Upload
                        uploadChannel.setUploadStream(icsStream,
                                                    "text/calendar", -1);

                        Services.startup.enterLastWindowClosingSurvivalArea();
                        inLastWindowClosingSurvivalArea = true;
                        channel.asyncOpen(self, self);
                    } else {
                        if (inLastWindowClosingSurvivalArea) {
                            Services.startup.exitLastWindowClosingSurvivalArea();
                        }
                        self.mObserver.onError(self.superCalendar,
                                               calIErrors.MODIFICATION_FAILED,
                                               "The calendar has been changed remotely. Please reload and apply your changes again!");
                        self.unlock(calIErrors.MODIFICATION_FAILED);
                    }
                } catch (ex) {
                    if (inLastWindowClosingSurvivalArea) {
                        Services.startup.exitLastWindowClosingSurvivalArea();
                    }
                    self.mObserver.onError(self.superCalendar,
                                           ex.result, "The calendar could not be saved; there " +
                                           "was a failure: 0x" + ex.result.toString(16));
                    self.mObserver.onError(self.superCalendar, calIErrors.MODIFICATION_FAILED, "");
                    self.unlock(calIErrors.MODIFICATION_FAILED);
                    self.forceRefresh();
                }
            },
            onGetResult: function(aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                this.serializer.addItems(aItems, aCount);
            }
        };
        listener.serializer = Components.classes["@mozilla.org/calendar/ics-serializer;1"]
                                        .createInstance(Components.interfaces.calIIcsSerializer);
        for (let comp of this.unmappedComponents) {
            listener.serializer.addComponent(comp);
        }
        for (let prop of this.unmappedProperties) {
            switch (prop.propertyName) {
                // we always set the current name and timezone:
                case "X-WR-CALNAME":
                case "X-WR-TIMEZONE":
                    break;
                default:
                    listener.serializer.addProperty(prop);
                    break;
            }
        }
        let prop = cal.getIcsService().createIcalProperty("X-WR-CALNAME");
        prop.value = this.name;
        listener.serializer.addProperty(prop);
        prop = cal.getIcsService().createIcalProperty("X-WR-TIMEZONE");
        prop.value = cal.getTimezoneService().defaultTimezone.tzid;
        listener.serializer.addProperty(prop);

        // don't call this.getItems, because we are locked:
        this.mMemoryCalendar.getItems(calICalendar.ITEM_FILTER_TYPE_ALL | calICalendar.ITEM_FILTER_COMPLETED_ALL,
                                      0, null, null, listener);
    },

    // nsIStreamListener impl
    // For after publishing. Do error checks here
    onStartRequest: function(request, ctxt) {},
    onDataAvailable: function(request, ctxt, inStream, sourceOffset, count) {
        // All data must be consumed. For an upload channel, there is
        // no meaningfull data. So it gets read and then ignored
        let scriptableInputStream =
            Components.classes["@mozilla.org/scriptableinputstream;1"]
                      .createInstance(Components.interfaces.nsIScriptableInputStream);
        scriptableInputStream.init(inStream);
        scriptableInputStream.read(-1);
    },
    onStopRequest: function(request, ctxt, status, errorMsg) {
        ctxt = ctxt.wrappedJSObject;
        let httpChannel;
        let requestSucceeded = false;
        try {
            httpChannel = request.QueryInterface(Components.interfaces.nsIHttpChannel);
            requestSucceeded = httpChannel.requestSucceeded;
        } catch (e) {
            // This may fail if it was not a http channel, handled later on.
        }

        if (httpChannel) {
            cal.LOG("[calICSCalendar] channel.requestSucceeded: " + requestSucceeded);
        }

        if ((httpChannel && !requestSucceeded) ||
            (!httpChannel && !Components.isSuccessCode(request.status))) {
            ctxt.mObserver.onError(this.superCalendar,
                                   Components.isSuccessCode(request.status)
                                   ? calIErrors.DAV_PUT_ERROR
                                   : request.status,
                                   "Publishing the calendar file failed\n" +
                                       "Status code: " + request.status.toString(16) + "\n");
            ctxt.mObserver.onError(this.superCalendar, calIErrors.MODIFICATION_FAILED, "");

            // the PUT has failed, refresh, and signal error to all modifying operations:
            this.forceRefresh();
            ctxt.unlock(calIErrors.MODIFICATION_FAILED);
            Services.startup.exitLastWindowClosingSurvivalArea();
            return;
        }

        // Allow the hook to grab data of the channel, like the new etag

        ctxt.mHooks.onAfterPut(request, () => {
            ctxt.unlock();
            Services.startup.exitLastWindowClosingSurvivalArea();
        });
    },

    // Always use the queue, just to reduce the amount of places where
    // this.mMemoryCalendar.addItem() and friends are called. less
    // copied code.
    addItem: function(aItem, aListener) {
        this.adoptItem(aItem.clone(), aListener);
    },
    adoptItem: function(aItem, aListener) {
        if (this.readOnly) {
            throw calIErrors.CAL_IS_READONLY;
        }
        this.queue.push({ action: "add", item: aItem, listener: aListener });
        this.processQueue();
    },

    modifyItem: function(aNewItem, aOldItem, aListener) {
        if (this.readOnly) {
            throw calIErrors.CAL_IS_READONLY;
        }
        this.queue.push({
            action: "modify",
            oldItem: aOldItem,
            newItem: aNewItem,
            listener: aListener
        });
        this.processQueue();
    },

    deleteItem: function(aItem, aListener) {
        if (this.readOnly) {
            throw calIErrors.CAL_IS_READONLY;
        }
        this.queue.push({
            action: "delete",
            item: aItem,
            listener: aListener
        });
        this.processQueue();
    },

    getItem: function(aId, aListener) {
        this.queue.push({
            action: "get_item",
            id: aId,
            listener: aListener
        });
        this.processQueue();
    },

    getItems: function(aItemFilter, aCount, aRangeStart, aRangeEnd, aListener) {
        this.queue.push({
            action: "get_items",
            itemFilter: aItemFilter,
            count: aCount,
            rangeStart: aRangeStart,
            rangeEnd: aRangeEnd,
            listener: aListener
        });
        this.processQueue();
    },

    processQueue: function() {
        if (this.isLocked()) {
            return;
        }

        function modListener(action) {
            this.mAction = action;
        }
        modListener.prototype = {
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
            onGetResult: function() {},
            onOperationComplete: function() {
                this.mAction.opCompleteArgs = arguments;
            }
        };

        let a;
        let writeICS = false;
        let refreshAction = null;
        while ((a = this.queue.shift())) {
            switch (a.action) {
                case "add":
                    this.mMemoryCalendar.addItem(a.item, new modListener(a));
                    this.mModificationActions.push(a);
                    writeICS = true;
                    break;
                case "modify":
                    this.mMemoryCalendar.modifyItem(a.newItem, a.oldItem, new modListener(a));
                    this.mModificationActions.push(a);
                    writeICS = true;
                    break;
                case "delete":
                    this.mMemoryCalendar.deleteItem(a.item, new modListener(a));
                    this.mModificationActions.push(a);
                    writeICS = true;
                    break;
                case "get_item":
                    this.mMemoryCalendar.getItem(a.id, a.listener);
                    break;
                case "get_items":
                    this.mMemoryCalendar.getItems(a.itemFilter, a.count,
                                                  a.rangeStart, a.rangeEnd,
                                                  a.listener);
                    break;
                case "refresh":
                    refreshAction = a;
                    break;
            }
            if (refreshAction) {
                // break queue processing here and wait for refresh to finish
                // before processing further operations
                break;
            }
        }
        if (writeICS) {
            if (refreshAction) {
                // reschedule the refresh for next round, after the file has been written;
                // strictly we may not need to refresh once the file has been successfully
                // written, but we don't know if that write will succeed.
                this.queue.unshift(refreshAction);
            }
            this.writeICS();
        } else if (refreshAction) {
            cal.LOG("[calICSCalendar] Refreshing " + this.name +
                    (refreshAction.forceRefresh ? " (forced)" : ""));
            this.doRefresh(refreshAction.forceRefresh);
        }
    },

    lock: function() {
        this.locked = true;
    },

    unlock: function(errCode) {
        ASSERT(this.locked, "unexpected!");

        this.mModificationActions.forEach((action) => {
            let args = action.opCompleteArgs;
            ASSERT(args, "missing onOperationComplete call!");
            let listener = action.listener;
            if (listener) {
                if (Components.isSuccessCode(args[1]) &&
                    errCode && !Components.isSuccessCode(errCode)) {
                    listener.onOperationComplete(args[0], errCode, args[2], args[3], null);
                } else {
                    listener.onOperationComplete(...args);
                }
            }
        });
        this.mModificationActions = [];

        this.locked = false;
        this.processQueue();
    },

    isLocked: function() {
        return this.locked;
    },

    startBatch: function() {
        this.mObserver.onStartBatch();
    },
    endBatch: function() {
        this.mObserver.onEndBatch();
    },

    /**
     * @see nsIInterfaceRequestor
     * @see calProviderUtils.jsm
     */
    getInterface: cal.InterfaceRequestor_getInterface,

    /**
     * Make a backup of the (remote) calendar
     *
     * This will download the remote file into the profile dir.
     * It should be called before every upload, so every change can be
     * restored. By default, it will keep 3 backups. It also keeps one
     * file each day, for 3 days. That way, even if the user doesn't notice
     * the remote calendar has become corrupted, he will still loose max 1
     * day of work.
     * After the back up is finished, will call aCallback.
     *
     * @param aCallback
     *           Function that will be calles after the backup is finished.
     *           will be called in the original context in which makeBackup
     *           was called
     */
    makeBackup: function(aCallback) {
        // Uses |pseudoID|, an id of the calendar, defined below
        function makeName(type) {
            return "calBackupData_" + pseudoID + "_" + type + ".ics";
        }

        // This is a bit messy. createUnique creates an empty file,
        // but we don't use that file. All we want is a filename, to be used
        // in the call to copyTo later. So we create a file, get the filename,
        // and never use the file again, but write over it.
        // Using createUnique anyway, because I don't feel like
        // re-implementing it
        function makeDailyFileName() {
            let dailyBackupFile = backupDir.clone();
            dailyBackupFile.append(makeName("day"));
            dailyBackupFile.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE,
                                         parseInt("0600", 8));
            dailyBackupFileName = dailyBackupFile.leafName;

            // Remove the reference to the nsIFile, because we need to
            // write over the file later, and you never know what happens
            // if something still has a reference.
            // Also makes it explicit that we don't need the file itself,
            // just the name.
            dailyBackupFile = null;

            return dailyBackupFileName;
        }

        function purgeBackupsByType(files, type) {
            // filter out backups of the type we care about.
            let filteredFiles = files.filter(
                file => file.name.includes("calBackupData_" + pseudoID + "_" + type)
            );
            // Sort by lastmodifed
            filteredFiles.sort((a, b) => a.lastmodified - b.lastmodified);
            // And delete the oldest files, and keep the desired number of
            // old backups
            for (let i = 0; i < filteredFiles.length - numBackupFiles; ++i) {
                let file = backupDir.clone();
                file.append(filteredFiles[i].name);

                try {
                    file.remove(false);
                } catch (ex) {
                    // This can fail because of some crappy code in
                    // nsILocalFile.  That's not the end of the world.  We can
                    // try to remove the file the next time around.
                }
            }
            return;
        }

        function purgeOldBackups() {
            // Enumerate files in the backupdir for expiry of old backups
            let dirEnum = backupDir.directoryEntries;
            let files = [];
            while (dirEnum.hasMoreElements()) {
                let file = dirEnum.getNext().QueryInterface(Ci.nsIFile);
                if (file.isFile()) {
                    files.push({ name: file.leafName, lastmodified: file.lastModifiedTime });
                }
            }

            if (doDailyBackup) {
                purgeBackupsByType(files, "day");
            } else {
                purgeBackupsByType(files, "edit");
            }

            return;
        }

        function copyToOverwriting(oldFile, newParentDir, newName) {
            try {
                let newFile = newParentDir.clone();
                newFile.append(newName);

                if (newFile.exists()) {
                    newFile.remove(false);
                }
                oldFile.copyTo(newParentDir, newName);
            } catch (e) {
                cal.ERROR("[calICSCalendar] Backup failed, no copy: " + e);
                // Error in making a daily/initial backup.
                // not fatal, so just continue
            }
        }

        let backupDays = Preferences.get("calendar.backup.days", 1);
        let numBackupFiles = Preferences.get("calendar.backup.filenum", 3);

        let backupDir;
        try {
            backupDir = cal.getCalendarDirectory();
            backupDir.append("backup");
            if (!backupDir.exists()) {
                backupDir.create(Ci.nsIFile.DIRECTORY_TYPE, parseInt("0755", 8));
            }
        } catch (e) {
            // Backup dir wasn't found. Likely because we are running in
            // xpcshell. Don't die, but continue the upload.
            cal.ERROR("[calICSCalendar] Backup failed, no backupdir:" + e);
            aCallback.call(this);
            return;
        }

        let pseudoID;
        try {
            pseudoID = this.getProperty("uniquenum2");
            if (!pseudoID) {
                pseudoID = new Date().getTime();
                this.setProperty("uniquenum2", pseudoID);
            }
        } catch (e) {
            // calendarmgr not found. Likely because we are running in
            // xpcshell. Don't die, but continue the upload.
            cal.ERROR("[calICSCalendar] Backup failed, no calendarmanager:" + e);
            aCallback.call(this);
            return;
        }

        let doInitialBackup = false;
        let initialBackupFile = backupDir.clone();
        initialBackupFile.append(makeName("initial"));
        if (!initialBackupFile.exists()) {
            doInitialBackup = true;
        }

        let doDailyBackup = false;
        let backupTime = this.getProperty("backup-time2");
        if (!backupTime ||
            (new Date().getTime() > backupTime + backupDays * 24 * 60 * 60 * 1000)) {
            // It's time do to a daily backup
            doDailyBackup = true;
            this.setProperty("backup-time2", new Date().getTime());
        }

        let dailyBackupFileName;
        if (doDailyBackup) {
            dailyBackupFileName = makeDailyFileName(backupDir);
        }

        let backupFile = backupDir.clone();
        backupFile.append(makeName("edit"));
        backupFile.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, parseInt("0600", 8));

        purgeOldBackups();

        // Now go download the remote file, and store it somewhere local.
        let channel = Services.io.newChannelFromURI2(this.mUri,
                                                     null,
                                                     Services.scriptSecurityManager.getSystemPrincipal(),
                                                     null,
                                                     Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                     Components.interfaces.nsIContentPolicy.TYPE_OTHER);
        channel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
        channel.notificationCallbacks = this;

        let downloader = Components.classes["@mozilla.org/network/downloader;1"]
                                   .createInstance(Ci.nsIDownloader);

        let self = this;
        let listener = {
            onDownloadComplete: function(opdownloader, request, ctxt, status, result) {
                if (doInitialBackup) {
                    copyToOverwriting(result, backupDir, makeName("initial"));
                }
                if (doDailyBackup) {
                    copyToOverwriting(result, backupDir, dailyBackupFileName);
                }

                aCallback.call(self);
            }
        };

        downloader.init(listener, backupFile);
        try {
            channel.asyncOpen(downloader, null);
        } catch (e) {
            // For local files, asyncOpen throws on new (calendar) files
            // No problem, go and upload something
            cal.ERROR("[calICSCalendar] Backup failed in asyncOpen:" + e);
            aCallback.call(this);
            return;
        }

        return;
    }
};

function calICSObserver(aCalendar) {
    this.mCalendar = aCalendar;
}

calICSObserver.prototype = {
    mCalendar: null,
    mInBatch: false,

    // calIObserver:
    onStartBatch: function() {
        this.mCalendar.observers.notify("onStartBatch");
        this.mInBatch = true;
    },
    onEndBatch: function() {
        this.mCalendar.observers.notify("onEndBatch");
        this.mInBatch = false;
    },
    onLoad: function(calendar) {
        this.mCalendar.observers.notify("onLoad", [calendar]);
    },
    onAddItem: function(aItem) {
        this.mCalendar.observers.notify("onAddItem", [aItem]);
    },
    onModifyItem: function(aNewItem, aOldItem) {
        this.mCalendar.observers.notify("onModifyItem", [aNewItem, aOldItem]);
    },
    onDeleteItem: function(aDeletedItem) {
        this.mCalendar.observers.notify("onDeleteItem", [aDeletedItem]);
    },
    onPropertyChanged: function(aCalendar, aName, aValue, aOldValue) {
        this.mCalendar.observers.notify("onPropertyChanged", [aCalendar, aName, aValue, aOldValue]);
    },
    onPropertyDeleting: function(aCalendar, aName) {
        this.mCalendar.observers.notify("onPropertyDeleting", [aCalendar, aName]);
    },

    onError: function(aCalendar, aErrNo, aMessage) {
        this.mCalendar.readOnly = true;
        this.mCalendar.notifyError(aErrNo, aMessage);
    }
};

/*
 * Transport Abstraction Hooks
 *
 * Those hooks provide a way to do checks before or after publishing an
 * ics file. The main use will be to check etags (or some other way to check
 * for remote changes) to protect remote changes from being overwritten.
 *
 * Different protocols need different checks (webdav can do etag, but
 * local files need last-modified stamps), hence different hooks for each
 * types
 */

// dummyHooks are for transport types that don't have hooks of their own.
// Also serves as poor-mans interface definition.
function dummyHooks(calendar) {
    this.mCalendar = calendar;
}

dummyHooks.prototype = {
    onBeforeGet: function(aChannel, aForceRefresh) {
        return true;
    },

    /**
     * @return
     *     a boolean, false if the previous data should be used (the datastore
     *     didn't change, there might be no data in this GET), true in all
     *     other cases
     */
    onAfterGet: function(aChannel, aForceRefresh) {
        return true;
    },

    onBeforePut: function(aChannel) {
        return true;
    },

    onAfterPut: function(aChannel, aRespFunc) {
        aRespFunc();
        return true;
    }
};

function httpHooks(calendar) {
    this.mCalendar = calendar;
}

httpHooks.prototype = {
    onBeforeGet: function(aChannel, aForceRefresh) {
        let httpchannel = aChannel.QueryInterface(Components.interfaces.nsIHttpChannel);
        httpchannel.setRequestHeader("Accept", "text/calendar,text/plain;q=0.8,*/*;q=0.5", false);

        if (this.mEtag && !aForceRefresh) {
            // Somehow the webdav header 'If' doesn't work on apache when
            // passing in a Not, so use the http version here.
            httpchannel.setRequestHeader("If-None-Match", this.mEtag, false);
        } else if (!aForceRefresh && this.mLastModified) {
            // Only send 'If-Modified-Since' if no ETag is available
            httpchannel.setRequestHeader("If-Modified-Since", this.mLastModified, false);
        }

        return true;
    },

    onAfterGet: function(aChannel, aForceRefresh) {
        let httpchannel = aChannel.QueryInterface(Components.interfaces.nsIHttpChannel);
        let responseStatus = 0;
        let responseStatusCategory = 0;

        try {
            responseStatus = httpchannel.responseStatus;
            responseStatusCategory = Math.floor(responseStatus / 100);
        } catch (e) {
            // Error might have been a temporary connection issue, keep old data to
            // prevent potential data loss if it becomes available again.
            cal.LOG("[calICSCalendar] Unable to get response status.");
            return false;
        }

        if (responseStatus == 304) {
            // 304: Not Modified
            // Can use the old data, so tell the caller that it can skip parsing.
            cal.LOG("[calICSCalendar] Response status 304: Not Modified. Using the existing data.");
            return false;
        } else if (responseStatus == 404) {
            // 404: Not Found
            // This is a new calendar. Shouldn't try to parse it. But it also
            // isn't a failure, so don't throw.
            cal.LOG("[calICSCalendar] Response status 404: Not Found. This is a new calendar.");
            return false;
        } else if (responseStatus == 410) {
            cal.LOG("[calICSCalendar] Response status 410, calendar is gone. Disabling the calendar.");
            this.mCalendar.setProperty("disabled", "true");
            return false;
        } else if (responseStatusCategory == 4 || responseStatusCategory == 5) {
            cal.LOG("[calICSCalendar] Response status " + responseStatus + ", temporarily disabling calendar for safety.");
            this.mCalendar.setProperty("disabled", "true");
            this.mCalendar.setProperty("auto-enabled", "true");
            return false;
        }

        try {
            this.mEtag = httpchannel.getResponseHeader("ETag");
        } catch (e) {
            // No etag header. Now what?
            this.mEtag = null;
        }

        try {
            this.mLastModified = httpchannel.getResponseHeader("Last-Modified");
        } catch (e) {
            this.mLastModified = null;
        }

        return true;
    },

    onBeforePut: function(aChannel) {
        if (this.mEtag) {
            let httpchannel = aChannel.QueryInterface(Components.interfaces.nsIHttpChannel);

            // Apache doesn't work correctly with if-match on a PUT method,
            // so use the webdav header
            httpchannel.setRequestHeader("If", "([" + this.mEtag + "])", false);
        }
        return true;
    },

    onAfterPut: function(aChannel, aRespFunc) {
        let httpchannel = aChannel.QueryInterface(Components.interfaces.nsIHttpChannel);
        try {
            this.mEtag = httpchannel.getResponseHeader("ETag");
            aRespFunc();
        } catch (e) {
            // There was no ETag header on the response. This means that
            // putting is not atomic. This is bad. Race conditions can happen,
            // because there is a time in which we don't know the right
            // etag.
            // Try to do the best we can, by immediatly getting the etag.

            let etagListener = {};
            let self = this; // need to reference in callback

            etagListener.onStreamComplete = function(aLoader, aContext, aStatus, aResultLength, aResult) {
                let resultConverter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                                .createInstance(Components
                                                .interfaces.nsIScriptableUnicodeConverter);
                resultConverter.charset = "UTF-8";

                let multistatus;
                try {
                    let str = resultConverter.convertFromByteArray(aResult, aResultLength);
                    multistatus = cal.xml.parseString(str);
                } catch (ex) {
                    cal.LOG("[calICSCalendar] Failed to fetch channel etag");
                }

                self.mEtag = icsXPathFirst(multistatus, "/D:propfind/D:response/D:propstat/D:prop/D:getetag");
                aRespFunc();
            };
            let queryXml =
                '<D:propfind xmlns:D="DAV:">' +
                  "<D:prop>" +
                    "<D:getetag/>" +
                  "</D:prop>" +
                "</D:propfind>";

            let etagChannel = cal.prepHttpChannel(aChannel.URI, queryXml,
                                                  "text/xml; charset=utf-8",
                                                  this);
            etagChannel.setRequestHeader("Depth", "0", false);
            etagChannel.requestMethod = "PROPFIND";
            let streamLoader = Components.classes["@mozilla.org/network/stream-loader;1"]
                                         .createInstance(Components.interfaces
                                         .nsIStreamLoader);

            cal.sendHttpRequest(streamLoader, etagChannel, etagListener);
        }
        return true;
    },

    // nsIProgressEventSink
    onProgress: function(aRequest, aContext, aProgress, aProgressMax) {},
    onStatus: function(aRequest, aContext, aStatus, aStatusArg) {},

    getInterface: function(aIid) {
        if (aIid.equals(Components.interfaces.nsIProgressEventSink)) {
            return this;
        } else {
            throw Components.results.NS_ERROR_NO_INTERFACE;
        }
    }
};

function fileHooks(calendar) {
    this.mCalendar = calendar;
}

fileHooks.prototype = {
    onBeforeGet: function(aChannel, aForceRefresh) {
        return true;
    },

    /**
     * @return
     *     a boolean, false if the previous data should be used (the datastore
     *     didn't change, there might be no data in this GET), true in all
     *     other cases
     */
    onAfterGet: function(aChannel, aForceRefresh) {
        let filechannel = aChannel.QueryInterface(Components.interfaces.nsIFileChannel);
        if (this.mtime) {
            let newMtime = filechannel.file.lastModifiedTime;
            if (this.mtime == newMtime && !aForceRefresh) {
                return false;
            } else {
                this.mtime = newMtime;
                return true;
            }
        } else {
            this.mtime = filechannel.file.lastModifiedTime;
            return true;
        }
    },

    onBeforePut: function(aChannel) {
        let filechannel = aChannel.QueryInterface(Components.interfaces.nsIFileChannel);
        if (this.mtime && this.mtime != filechannel.file.lastModifiedTime) {
            return false;
        } else {
            return true;
        }
    },

    onAfterPut: function(aChannel, aRespFunc) {
        let filechannel = aChannel.QueryInterface(Components.interfaces.nsIFileChannel);
        this.mtime = filechannel.file.lastModifiedTime;
        aRespFunc();
        return true;
    }
};

/** Module Registration */
var scriptLoadOrder = [
    "calUtils.js",
];

this.NSGetFactory = cal.loadingNSGetFactory(scriptLoadOrder, [calICSCalendar], this);
