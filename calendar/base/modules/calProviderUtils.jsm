/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calAuthUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");
Components.utils.import("resource:///modules/iteratorUtils.jsm");

/*
 * Provider helper code
 */

this.EXPORTED_SYMBOLS = ["cal"]; // even though it's defined in calUtils.jsm, import needs this

/**
 * Prepare HTTP channel with standard request headers and upload
 * data/content-type if needed
 *
 * @param arUri                      Channel Uri, will only be used for a new
 *                                     channel.
 * @param aUploadData                Data to be uploaded, if any. This may be a
 *                                     nsIInputStream or string data. In the
 *                                     latter case the string will be converted
 *                                     to an input stream.
 * @param aContentType               Value for Content-Type header, if any
 * @param aNotificationCallbacks     Calendar using channel
 * @param aExisting                  An existing channel to modify (optional)
 */
cal.prepHttpChannel = function(aUri, aUploadData, aContentType, aNotificationCallbacks, aExisting) {
    let channel = aExisting || Services.io.newChannelFromURI2(aUri,
                                                              null,
                                                              Services.scriptSecurityManager.getSystemPrincipal(),
                                                              null,
                                                              Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                              Components.interfaces.nsIContentPolicy.TYPE_OTHER);
    let httpchannel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);

    httpchannel.setRequestHeader("Accept", "text/xml", false);
    httpchannel.setRequestHeader("Accept-Charset", "utf-8,*;q=0.1", false);
    httpchannel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
    httpchannel.notificationCallbacks = aNotificationCallbacks;

    if (aUploadData) {
        httpchannel = httpchannel.QueryInterface(Components.interfaces.nsIUploadChannel);
        let stream;
        if (aUploadData instanceof Components.interfaces.nsIInputStream) {
            // Make sure the stream is reset
            stream = aUploadData.QueryInterface(Components.interfaces.nsISeekableStream);
            stream.seek(Components.interfaces.nsISeekableStream.NS_SEEK_SET, 0);
        } else {
            // Otherwise its something that should be a string, convert it.
            let converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                      .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
            converter.charset = "UTF-8";
            stream = converter.convertToInputStream(aUploadData.toString());
        }

        httpchannel.setUploadStream(stream, aContentType, -1);
    }

    return httpchannel;
};

/**
 * calSendHttpRequest; send prepared HTTP request
 *
 * @param aStreamLoader     streamLoader for request
 * @param aChannel          channel for request
 * @param aListener         listener for method completion
 */
cal.sendHttpRequest = function(aStreamLoader, aChannel, aListener) {
    aStreamLoader.init(aListener);
    aChannel.asyncOpen(aStreamLoader, aChannel);
};

cal.createStreamLoader = function() {
    return Components.classes["@mozilla.org/network/stream-loader;1"]
                     .createInstance(Components.interfaces.nsIStreamLoader);
};

cal.convertByteArray = function(aResult, aResultLength, aCharset, aThrow) {
    try {
        let resultConverter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                                        .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
        resultConverter.charset = aCharset || "UTF-8";
        return resultConverter.convertFromByteArray(aResult, aResultLength);
    } catch (e) {
        if (aThrow) {
            throw e;
        }
    }
    return null;
};

/**
 * getInterface method for providers. This should be called in the context of
 * the respective provider, i.e
 *
 * return cal.InterfaceRequestor_getInterface.apply(this, arguments);
 *
 * or
 * ...
 * getInterface: cal.InterfaceRequestor_getInterface,
 * ...
 *
 * NOTE: If the server only provides one realm for all calendars, be sure that
 * the |this| object implements calICalendar. In this case the calendar name
 * will be appended to the realm. If you need that feature disabled, see the
 * capabilities section of calICalendar.idl
 *
 * @param aIID      The interface ID to return
 */
cal.InterfaceRequestor_getInterface = function(aIID) {
    try {
        // Try to query the this object for the requested interface but don't
        // throw if it fails since that borks the network code.
        return this.QueryInterface(aIID);
    } catch (e) {
        // Support Auth Prompt Interfaces
        if (aIID.equals(Components.interfaces.nsIAuthPrompt2)) {
            if (!this.calAuthPrompt) {
                this.calAuthPrompt = new cal.auth.Prompt();
            }
            return this.calAuthPrompt;
        } else if (aIID.equals(Components.interfaces.nsIAuthPromptProvider) ||
                   aIID.equals(Components.interfaces.nsIPrompt)) {
            return Services.ww.getNewPrompter(null);
        } else if (aIID.equals(Components.interfaces.nsIBadCertListener2)) {
            if (!this.badCertHandler) {
                this.badCertHandler = new cal.BadCertHandler(this);
            }
            return this.badCertHandler;
        } else {
            Components.returnCode = e;
        }
    }
    return null;
};

/**
 * Bad Certificate Handler for Network Requests. Shows the Network Exception
 * Dialog if a certificate Problem occurs.
 */
cal.BadCertHandler = function(thisProvider) {
    this.thisProvider = thisProvider;
};
cal.BadCertHandler.prototype = {
    QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIBadCertListener2]),

    notifyCertProblem: function(socketInfo, status, targetSite) {
        // Unfortunately we can't pass js objects using the window watcher, so
        // we'll just take the first available calendar window. We also need to
        // do this on a timer so that the modal window doesn't block the
        // network request.
        let calWindow = cal.getCalendarWindow();

        let timerCallback = {
            thisProvider: this.thisProvider,
            notify: function(timer) {
                let params = {
                    exceptionAdded: false,
                    sslStatus: status,
                    prefetchCert: true,
                    location: targetSite
                };
                calWindow.openDialog("chrome://pippki/content/exceptionDialog.xul",
                                     "",
                                     "chrome,centerscreen,modal",
                                     params);
                if (this.thisProvider.canRefresh &&
                    params.exceptionAdded) {
                    // Refresh the provider if the
                    // exception certificate was added
                    this.thisProvider.refresh();
                }
            }
        };
        let timer = Components.classes["@mozilla.org/timer;1"]
                    .createInstance(Components.interfaces.nsITimer);
        timer.initWithCallback(timerCallback,
                               0,
                               Components.interfaces.nsITimer.TYPE_ONE_SHOT);
        return true;
    }
};

/**
 * Freebusy interval implementation. All parameters are optional.
 *
 * @param aCalId         The calendar id to set up with.
 * @param aFreeBusyType  The type from calIFreeBusyInterval.
 * @param aStart         The start of the interval.
 * @param aEnd           The end of the interval.
 * @return               The fresh calIFreeBusyInterval.
 */
cal.FreeBusyInterval = function(aCalId, aFreeBusyType, aStart, aEnd) {
    this.calId = aCalId;
    this.interval = Components.classes["@mozilla.org/calendar/period;1"]
                              .createInstance(Components.interfaces.calIPeriod);
    this.interval.start = aStart;
    this.interval.end = aEnd;

    this.freeBusyType = aFreeBusyType || Components.interfaces.calIFreeBusyInterval.UNKNOWN;
};
cal.FreeBusyInterval.prototype = {
    QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIFreeBusyInterval]),
    calId: null,
    interval: null,
    freeBusyType: Components.interfaces.calIFreeBusyInterval.UNKNOWN
};

/**
 * Gets the iTIP/iMIP transport if the passed calendar has configured email.
 */
cal.getImipTransport = function(aCalendar) {
    // assure an identity is configured for the calendar
    return (aCalendar.getProperty("imip.identity")
            ? Components.classes["@mozilla.org/calendar/itip-transport;1?type=email"]
                        .getService(Components.interfaces.calIItipTransport)
            : null);
};

/**
 * Gets the configured identity and account of a particular calendar instance, or null.
 *
 * @param aCalendar     Calendar instance
 * @param outAccount    Optional out value for account
 * @return              The configured identity
 */
cal.getEmailIdentityOfCalendar = function(aCalendar, outAccount) {
    cal.ASSERT(aCalendar, "no calendar!", Components.results.NS_ERROR_INVALID_ARG);
    let key = aCalendar.getProperty("imip.identity.key");
    if (key === null) { // take default account/identity:
        let findIdentity = function(account) {
            if (account && account.identities.length) {
                return account.defaultIdentity ||
                       account.identities.queryElementAt(0, Components.interfaces.nsIMsgIdentity);
            }
            return null;
        };

        let foundAccount = MailServices.accounts.defaultAccount;
        let foundIdentity = findIdentity(foundAccount);

        if (!foundAccount || !foundIdentity) {
            let accounts = MailServices.accounts.accounts;
            for (let account of fixIterator(accounts, Components.interfaces.nsIMsgAccount)) {
                let identity = findIdentity(account);

                if (account && identity) {
                    foundAccount = account;
                    foundIdentity = identity;
                    break;
                }
            }
        }

        if (outAccount) {
            outAccount.value = foundIdentity ? foundAccount : null;
        }
        return foundIdentity;
    } else {
        if (key.length == 0) { // i.e. "None"
            return null;
        }
        let identity = null;
        cal.calIterateEmailIdentities((identity_, account) => {
            if (identity_.key == key) {
                identity = identity_;
                if (outAccount) {
                    outAccount.value = account;
                }
            }
            return (identity_.key != key);
        });

        if (!identity) {
            // dangling identity:
            cal.WARN("Calendar " + (aCalendar.uri ? aCalendar.uri.spec : aCalendar.id) +
                     " has a dangling E-Mail identity configured.");
        }
        return identity;
    }
};


/**
 * fromRFC3339
 * Convert a RFC3339 compliant Date string to a calIDateTime.
 *
 * @param aStr          The RFC3339 compliant Date String
 * @param aTimezone     The timezone this date string is most likely in
 * @return              A calIDateTime object
 */
cal.fromRFC3339 = function(aStr, aTimezone) {
    // XXX I have not covered leapseconds (matches[8]), this might need to
    // be done. The only reference to leap seconds I found is bug 227329.
    //

    // Create a DateTime instance (calUtils.js)
    let dateTime = cal.createDateTime();

    // Killer regex to parse RFC3339 dates
    let re = new RegExp("^([0-9]{4})-([0-9]{2})-([0-9]{2})" +
        "([Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(\\.[0-9]+)?)?" +
        "(([Zz]|([+-])([0-9]{2}):([0-9]{2})))?");

    let matches = re.exec(aStr);

    if (!matches) {
        return null;
    }

    // Set usual date components
    dateTime.isDate = (matches[4] == null);

    dateTime.year = matches[1];
    dateTime.month = matches[2] - 1; // Jan is 0
    dateTime.day = matches[3];

    if (!dateTime.isDate) {
        dateTime.hour = matches[5];
        dateTime.minute = matches[6];
        dateTime.second = matches[7];
    }

    // Timezone handling
    if (matches[9] == "Z" || matches[9] == "z") {
        // If the dates timezone is "Z" or "z", then this is UTC, no matter
        // what timezone was passed
        dateTime.timezone = cal.UTC();
    } else if (matches[9] == null) {
        // We have no timezone info, only a date. We have no way to
        // know what timezone we are in, so lets assume we are in the
        // timezone of our local calendar, or whatever was passed.

        dateTime.timezone = aTimezone;
    } else {
        let offset_in_s = (matches[11] == "-" ? -1 : 1) *
            ((matches[12] * 3600) + (matches[13] * 60));

        // try local timezone first
        dateTime.timezone = aTimezone;

        // If offset does not match, go through timezones. This will
        // give you the first tz in the alphabet and kill daylight
        // savings time, but we have no other choice
        if (dateTime.timezoneOffset != offset_in_s) {
            // TODO A patch to Bug 363191 should make this more efficient.

            let tzService = cal.getTimezoneService();
            // Enumerate timezones, set them, check their offset
            let enumerator = tzService.timezoneIds;
            while (enumerator.hasMore()) {
                let id = enumerator.getNext();
                dateTime.timezone = tzService.getTimezone(id);
                if (dateTime.timezoneOffset == offset_in_s) {
                    // This is our last step, so go ahead and return
                    return dateTime;
                }
            }
            // We are still here: no timezone was found
            dateTime.timezone = cal.UTC();
            if (!dateTime.isDate) {
                dateTime.hour += (matches[11] == "-" ? -1 : 1) * matches[12];
                dateTime.minute += (matches[11] == "-" ? -1 : 1) * matches[13];
            }
        }
    }
    return dateTime;
};

/**
 * toRFC3339
 * Convert a calIDateTime to a RFC3339 compliant Date string
 *
 * @param aDateTime     The calIDateTime object
 * @return              The RFC3339 compliant date string
 */
cal.toRFC3339 = function(aDateTime) {
    if (!aDateTime) {
        return "";
    }

    let full_tzoffset = aDateTime.timezoneOffset;
    let tzoffset_hr = Math.floor(Math.abs(full_tzoffset) / 3600);

    let tzoffset_mn = ((Math.abs(full_tzoffset) / 3600).toFixed(2) -
                       tzoffset_hr) * 60;

    let str = aDateTime.year + "-" +
        ("00" + (aDateTime.month + 1)).substr(-2) + "-" +
        ("00" + aDateTime.day).substr(-2);

    // Time and Timezone extension
    if (!aDateTime.isDate) {
        str += "T" +
               ("00" + aDateTime.hour).substr(-2) + ":" +
               ("00" + aDateTime.minute).substr(-2) + ":" +
               ("00" + aDateTime.second).substr(-2);
        if (aDateTime.timezoneOffset != 0) {
            str += (full_tzoffset < 0 ? "-" : "+") +
                   ("00" + tzoffset_hr).substr(-2) + ":" +
                   ("00" + tzoffset_mn).substr(-2);
        } else if (aDateTime.timezone.isFloating) {
            // RFC3339 Section 4.3 Unknown Local Offset Convention
            str += "-00:00";
        } else {
            // ZULU Time, according to ISO8601's timezone-offset
            str += "Z";
        }
    }
    return str;
};

cal.promptOverwrite = function(aMode, aItem) {
    let window = cal.getCalendarWindow();
    let args = {
        item: aItem,
        mode: aMode,
        overwrite: false
    };

    window.openDialog("chrome://calendar/content/calendar-conflicts-dialog.xul",
                      "calendarConflictsDialog",
                      "chrome,titlebar,modal",
                      args);

    return args.overwrite;
};

/**
 * Observer bag implementation taking care to replay open batch notifications.
 */
cal.ObserverBag = function(iid) {
    this.init(iid);
};
cal.ObserverBag.prototype = {
    __proto__: cal.calListenerBag.prototype,

    mBatchCount: 0,
    notify: function(func, args) {
        switch (func) {
            case "onStartBatch":
                ++this.mBatchCount;
                break;
            case "onEndBatch":
                --this.mBatchCount;
                break;
        }
        return this.__proto__.__proto__.notify.apply(this, arguments);
    },

    add: function(iface) {
        if (this.__proto__.__proto__.add.apply(this, arguments) && (this.mBatchCount > 0)) {
            // Replay batch notifications, because the onEndBatch notifications are yet to come.
            // We may think about doing the reverse on remove, though I currently see no need:
            for (let i = this.mBatchCount; i--;) {
                iface.onStartBatch();
            }
        }
    }
};

/**
 * Base prototype to be used implementing a provider.
 *
 * @see e.g. providers/gdata
 */
cal.ProviderBase = function() {
    cal.ASSERT("This prototype should only be inherited!");
};
cal.ProviderBase.mTransientProperties = {
    "cache.uncachedCalendar": true,
    "currentStatus": true,
    "itip.transport": true,
    "imip.identity": true,
    "imip.account": true,
    "imip.identity.disabled": true,
    "organizerId": true,
    "organizerCN": true
};
cal.ProviderBase.prototype = {
    QueryInterface: XPCOMUtils.generateQI([
        Components.interfaces.calICalendar,
        Components.interfaces.calISchedulingSupport
    ]),

    mID: null,
    mUri: null,
    mACLEntry: null,
    mObservers: null,
    mProperties: null,

    initProviderBase: function() {
        this.wrappedJSObject = this;
        this.mObservers = new cal.ObserverBag(Components.interfaces.calIObserver);
        this.mProperties = {};
        this.mProperties.currentStatus = Components.results.NS_OK;
    },

    get observers() {
        return this.mObservers;
    },

    // attribute AUTF8String id;
    get id() {
        return this.mID;
    },
    set id(aValue) {
        if (this.mID) {
            throw Components.results.NS_ERROR_ALREADY_INITIALIZED;
        }
        this.mID = aValue;

        let calMgr = cal.getCalendarManager();

        // make all properties persistent that have been set so far:
        for (let aName in this.mProperties) {
            if (!cal.ProviderBase.mTransientProperties[aName]) {
                let value = this.mProperties[aName];
                if (value !== null) {
                    calMgr.setCalendarPref_(this, aName, value);
                }
            }
        }

        let takeOverIfNotPresent = (oldPref, newPref, dontDeleteOldPref) => {
            let val = calMgr.getCalendarPref_(this, oldPref);
            if (val !== null) {
                if (!dontDeleteOldPref) {
                    calMgr.deleteCalendarPref_(this, oldPref);
                }
                if (calMgr.getCalendarPref_(this, newPref) === null) {
                    calMgr.setCalendarPref_(this, newPref, val);
                }
            }
        };

        // takeover lightning calendar visibility from 0.5:
        takeOverIfNotPresent("lightning-main-in-composite", "calendar-main-in-composite");
        takeOverIfNotPresent("lightning-main-default", "calendar-main-default");

        return aValue;
    },

    // attribute AUTF8String name;
    get name() {
        return this.getProperty("name");
    },
    set name(aValue) {
        return this.setProperty("name", aValue);
    },

    // readonly attribute calICalendarACLManager aclManager;
    get aclManager() {
        const defaultACLProviderClass = "@mozilla.org/calendar/acl-manager;1?type=default";
        let providerClass = this.getProperty("aclManagerClass");
        if (!providerClass || !Components.classes[providerClass]) {
            providerClass = defaultACLProviderClass;
        }
        return Components.classes[providerClass].getService(Components.interfaces.calICalendarACLManager);
    },

    // readonly attribute calICalendarACLEntry aclEntry;
    get aclEntry() {
        return this.mACLEntry;
    },

    // attribute calICalendar superCalendar;
    get superCalendar() {
        // If we have a superCalendar, check this calendar for a superCalendar.
        // This will make sure the topmost calendar is returned
        return (this.mSuperCalendar ? this.mSuperCalendar.superCalendar : this);
    },
    set superCalendar(val) {
        return (this.mSuperCalendar = val);
    },

    // attribute nsIURI uri;
    get uri() {
        return this.mUri;
    },
    set uri(aValue) {
        return (this.mUri = aValue);
    },

    // attribute boolean readOnly;
    get readOnly() {
        return this.getProperty("readOnly");
    },
    set readOnly(aValue) {
        return this.setProperty("readOnly", aValue);
    },

    // readonly attribute boolean canRefresh;
    get canRefresh() {
        return false;
    },

    // void startBatch();
    mBatchCount: 0,
    startBatch: function() {
        if (this.mBatchCount++ == 0) {
            this.mObservers.notify("onStartBatch");
        }
    },

    endBatch: function() {
        if (this.mBatchCount > 0) {
            if (--this.mBatchCount == 0) {
                this.mObservers.notify("onEndBatch");
            }
        } else {
            cal.ASSERT(this.mBatchCount > 0, "unexepcted endBatch!");
        }
    },

    notifyPureOperationComplete: function(aListener, aStatus, aOperationType, aId, aDetail) {
        if (aListener) {
            try {
                aListener.onOperationComplete(this.superCalendar, aStatus, aOperationType, aId, aDetail);
            } catch (exc) {
                cal.ERROR(exc);
            }
        }
    },

    notifyOperationComplete: function(aListener, aStatus, aOperationType, aId, aDetail, aExtraMessage) {
        this.notifyPureOperationComplete(aListener, aStatus, aOperationType, aId, aDetail);

        if (aStatus == Components.interfaces.calIErrors.OPERATION_CANCELLED) {
            return; // cancellation doesn't change current status, no notification
        }
        if (Components.isSuccessCode(aStatus)) {
            this.setProperty("currentStatus", aStatus);
        } else {
            if (aDetail instanceof Components.interfaces.nsIException) {
                this.notifyError(aDetail); // will set currentStatus
            } else {
                this.notifyError(aStatus, aDetail); // will set currentStatus
            }
            this.notifyError(aOperationType == Components.interfaces.calIOperationListener.GET
                             ? Components.interfaces.calIErrors.READ_FAILED
                             : Components.interfaces.calIErrors.MODIFICATION_FAILED,
                             aExtraMessage || "");
        }
    },

    // for convenience also callable with just an exception
    notifyError: function(aErrNo, aMessage) {
        if (aErrNo == Components.interfaces.calIErrors.OPERATION_CANCELLED) {
            return; // cancellation doesn't change current status, no notification
        }
        if (aErrNo instanceof Components.interfaces.nsIException) {
            if (!aMessage) {
                aMessage = aErrNo.message;
            }
            aErrNo = aErrNo.result;
        }
        this.setProperty("currentStatus", aErrNo);
        this.observers.notify("onError", [this.superCalendar, aErrNo, aMessage]);
    },

    mTransientPropertiesMode: false,
    get transientProperties() {
        return this.mTransientPropertiesMode;
    },
    set transientProperties(value) {
        return (this.mTransientPropertiesMode = value);
    },

    // nsIVariant getProperty(in AUTF8String aName);
    getProperty: function(aName) {
        switch (aName) {
            case "itip.transport": // iTIP/iMIP default:
                return cal.getImipTransport(this);
            case "itip.notify-replies": // iTIP/iMIP default:
                return Preferences.get("calendar.itip.notify-replies", false);
            // temporary hack to get the uncached calendar instance:
            case "cache.uncachedCalendar":
                return this;
        }

        let ret = this.mProperties[aName];
        if (ret === undefined) {
            ret = null;
            switch (aName) {
                case "imip.identity": // we want to cache the identity object a little, because
                                      // it is heavily used by the invitation checks
                    ret = cal.getEmailIdentityOfCalendar(this);
                    break;
                case "imip.account": {
                    let outAccount = {};
                    if (cal.getEmailIdentityOfCalendar(this, outAccount)) {
                        ret = outAccount.value;
                    }
                    break;
                }
                case "organizerId": { // itip/imip default: derived out of imip.identity
                    let identity = this.getProperty("imip.identity");
                    ret = (identity
                           ? ("mailto:" + identity.QueryInterface(Components.interfaces.nsIMsgIdentity).email)
                           : null);
                    break;
                }
                case "organizerCN": { // itip/imip default: derived out of imip.identity
                    let identity = this.getProperty("imip.identity");
                    ret = (identity
                           ? identity.QueryInterface(Components.interfaces.nsIMsgIdentity).fullName
                           : null);
                    break;
                }
            }
            if ((ret === null) &&
                !cal.ProviderBase.mTransientProperties[aName] &&
                !this.transientProperties) {
                if (this.id) {
                    ret = cal.getCalendarManager().getCalendarPref_(this, aName);
                }
                switch (aName) {
                    case "suppressAlarms":
                        if (this.getProperty("capabilities.alarms.popup.supported") === false) {
                            // If popup alarms are not supported,
                            // automatically suppress alarms
                            ret = true;
                        }
                        break;
                }
            }
            this.mProperties[aName] = ret;
        }
//         cal.LOG("getProperty(\"" + aName + "\"): " + ret);
        return ret;
    },

    // void setProperty(in AUTF8String aName, in nsIVariant aValue);
    setProperty: function(aName, aValue) {
        let oldValue = this.getProperty(aName);
        if (oldValue != aValue) {
            this.mProperties[aName] = aValue;
            switch (aName) {
                case "imip.identity.key": // invalidate identity and account object if key is set:
                    delete this.mProperties["imip.identity"];
                    delete this.mProperties["imip.account"];
                    delete this.mProperties.organizerId;
                    delete this.mProperties.organizerCN;
                    break;
            }
            if (!this.transientProperties &&
                !cal.ProviderBase.mTransientProperties[aName] &&
                this.id) {
                cal.getCalendarManager().setCalendarPref_(this, aName, aValue);
            }
            this.mObservers.notify("onPropertyChanged",
                                   [this.superCalendar, aName, aValue, oldValue]);
        }
        return aValue;
    },

    // void deleteProperty(in AUTF8String aName);
    deleteProperty: function(aName) {
        this.mObservers.notify("onPropertyDeleting", [this.superCalendar, aName]);
        delete this.mProperties[aName];
        cal.getCalendarManager().deleteCalendarPref_(this, aName);
    },

    // calIOperation refresh
    refresh: function() {
        return null;
    },

    // void addObserver( in calIObserver observer );
    addObserver: function(aObserver) {
        this.mObservers.add(aObserver);
    },

    // void removeObserver( in calIObserver observer );
    removeObserver: function(aObserver) {
        this.mObservers.remove(aObserver);
    },

    // calISchedulingSupport: Implementation corresponding to our iTIP/iMIP support
    isInvitation: function(aItem) {
        if (!this.mACLEntry || !this.mACLEntry.hasAccessControl) {
            // No ACL support - fallback to the old method
            let id = this.getProperty("organizerId");
            if (id) {
                let org = aItem.organizer;
                if (!org || !org.id || (org.id.toLowerCase() == id.toLowerCase())) {
                    return false;
                }
                return (aItem.getAttendeeById(id) != null);
            }
            return false;
        }

        let org = aItem.organizer;
        if (!org || !org.id) {
            // HACK
            // if we don't have an organizer, this is perhaps because it's an exception
            // to a recurring event. We check the parent item.
            if (aItem.parentItem) {
                org = aItem.parentItem.organizer;
                if (!org || !org.id) {
                    return false;
                }
            } else {
                return false;
            }
        }

        // We check if :
        // - the organizer of the event is NOT within the owner's identities of this calendar
        // - if the one of the owner's identities of this calendar is in the attendees
        let ownerIdentities = this.mACLEntry.getOwnerIdentities({});
        for (let i = 0; i < ownerIdentities.length; i++) {
            let identity = "mailto:" + ownerIdentities[i].email.toLowerCase();
            if (org.id.toLowerCase() == identity) {
                return false;
            }

            if (aItem.getAttendeeById(identity) != null) {
                return true;
            }
        }

        return false;
    },

    getInvitedAttendee: function(aItem) {
        let id = this.getProperty("organizerId");
        let attendee = (id ? aItem.getAttendeeById(id) : null);

        if (!attendee && this.mACLEntry && this.mACLEntry.hasAccessControl) {
            let ownerIdentities = this.mACLEntry.getOwnerIdentities({});
            if (ownerIdentities.length > 0) {
                let identity;
                for (let i = 0; !attendee && i < ownerIdentities.length; i++) {
                    identity = "mailto:" + ownerIdentities[i].email.toLowerCase();
                    attendee = aItem.getAttendeeById(identity);
                }
            }
        }

        return attendee;
    },

    canNotify: function(aMethod, aItem) {
        return false; // use outbound iTIP for all
    }
};
