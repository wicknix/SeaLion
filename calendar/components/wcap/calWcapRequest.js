/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
   A request object is used to track an async action.
   While the action is running, isPending is true.
   Functions issuing an async action usually take a response function along
   with their parameters, typically named respFunc.
   That function is called *after* the action has ended (i.e. isPending of the
   issued action/request is false when called, status remains stable).
   The response function gets the ended request as first parameter to check
   whether the request has been successful and get its data.
   The request function itself may return either
   - a further calIOperation request object, i.e. an async continuation
   - some data (incl null/undefined) which is the result of the async function,
     indicating that there is no further continuation
*/

/* exported issueNetworkRequest, getWcapRequestStatusString, stringToIcal, stringToXml */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function generateRequestId() {
    if (!generateRequestId.mRequestPrefix) {
        generateRequestId.mRequestPrefix = cal.getUUID() + "-";
        generateRequestId.mRequestId = 0;
    }
    ++generateRequestId.mRequestId;
    return generateRequestId.mRequestPrefix + generateRequestId.mRequestId;
}

function calWcapRequest(respFunc, logContext) {
    this.wrappedJSObject = this;
    this.m_logContext = logContext;
    this.m_id = generateRequestId();
    this.m_isPending = true;
    this.m_status = NS_OK;
    this.m_respFunc = respFunc;
    this.m_attachedRequests = [];
}
calWcapRequest.prototype = {
    m_logContext: null,
    m_parentRequest: null,
    m_id: 0,
    m_isPending: true,
    m_status: NS_OK,
    m_respFunc: null,
    m_attachedRequests: null,
    m_locked: false,

    get parentRequest() {
        return this.m_parentRequest;
    },
    set parentRequest(req) {
        if (this.parentRequest) {
            logError("already has parent!", this);
        }
        this.detachFromParent(); // detach without error
        return (this.m_parentRequest = req);
    },

    /** The following locking is necessary when scheduling multiple async
        requests; one cannot be sure that e.g. the first completes quickly
        and responds the whole parent request when detaching.
    */
    lockPending: function() {
        this.m_locked = true;
    },
    unlockPending: function() {
        if (this.m_locked) {
            this.m_locked = false;
            // assures that respFunc is executed:
            if (this.m_attachedRequests.length == 0) {
                this.execRespFunc();
            }
        }
    },

    toString: function() {
        let ret = "calWcapRequest id=" + this.id +
                  ", parent-id=" + (this.parentRequest ? this.parentRequest.id : "<none>") +
                  " (" + this.m_logContext + ")";
        if (LOG_LEVEL > 2 && this.m_attachedRequests.length > 0) {
            ret += "\nattached requests:";
            for (let req of this.m_attachedRequests) {
                ret += "\n#" + req.id + "\t" + req;
            }
        }
        ret += ", isPending=" + this.isPending;
        ret += ", status=" + errorToString(this.status);
        return ret;
    },

    attachSubRequest: function(req) {
        if (req) {
            if (this.m_attachedRequests.some(req_ => req.id == req_.id)) {
                logError("request already attached: " + req.id, this);
            } else if (req.isPending) {
                this.m_attachedRequests.push(req);
                req.parentRequest = this;
                log("attachSubRequest()", this);
            } else if (!this.m_locked && this.m_attachedRequests.length == 0) {
                this.execRespFunc(req.status);
            }
        }
    },

    detachSubRequest: function(req, err) {
        this.m_attachedRequests = this.m_attachedRequests.filter(req_ => req.id != req_.id);
        if (err) {
            // first failing sub request stops parent request:
            this.execRespFunc(err);
        } else if (!this.m_locked && this.m_attachedRequests.length == 0) {
            // assures that respFunc is executed after all sub requests have been completed:
            this.execRespFunc();
        }
    },

    cancelAllSubRequests: function(status) {
        let attachedRequests = this.m_attachedRequests;
        this.m_attachedRequests = [];
        attachedRequests.forEach(req => req.cancel(null));
    },

    detachFromParent: function(err) {
        let parentRequest = this.m_parentRequest;
        if (parentRequest) {
            this.m_parentRequest = null;
            parentRequest.detachSubRequest(this, err);
        }
    },

    execRespFunc: function(err, data) {
        if (this.isPending) {
            this.m_isPending = false;
            if (err) {
                this.m_status = err;
            }
            this.cancelAllSubRequests();
            let respFunc = this.m_respFunc;
            if (respFunc) {
                this.m_respFunc = null; // call once only
                if (LOG_LEVEL > 2) {
                    log("response exec: " + errorToString(err), this);
                }
                try {
                    respFunc(this, err, data);
                } catch (exc) {
                    this.m_status = exc;
                    // don't pump into error console, may be handled:
                    log("error: " + errorToString(exc), this);
                }
            }
            this.detachFromParent(this.m_status);
        }
    },

    execSubRespFunc: function(func, err, data) {
        try {
            func(err, data);
        } catch (exc) {
            this.execRespFunc(exc);
        }
    },

    // calIOperation:
    get id() {
        return this.m_id;
    },
    get isPending() {
        return this.m_isPending;
    },
    get status() {
        return (this.m_status === null ? NS_OK : this.m_status);
    },

    cancel: function(status) {
        if (!status) {
            status = calIErrors.OPERATION_CANCELLED;
        }
        this.execRespFunc(status);
    }
};

function calWcapNetworkRequest(url, respFunc, bLogging) {
    this.wrappedJSObject = this;
    this.m_id = generateRequestId();
    this.m_url = url;
    this.m_respFunc = respFunc;
    this.m_bLogging = (bLogging === undefined ? true : bLogging);
}
var calWcapNetworkRequestClassID = Components.ID("{e3c62b37-83cf-41ec-9872-0af9f952430a}");
var calWcapNetworkRequestInterfaces = [
    Components.interfaces.nsIUnicharStreamLoaderObserver,
    Components.interfaces.nsIInterfaceRequestor,
    Components.interfaces.nsIChannelEventSink,
    Components.interfaces.calIOperation,
];
calWcapNetworkRequest.prototype = {
    m_id: 0,
    m_url: null,
    m_loader: null,
    m_respFunc: null,
    m_bLogging: false,

    classID: calWcapNetworkRequestClassID,
    QueryInterface: XPCOMUtils.generateQI(calWcapNetworkRequestInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calWcapNetworkRequestClassID,
        contractID: "@mozilla.org/calendar/wcap/network-request;1",
        classDescription: "Sun Java System Calendar Server WCAP Network Request",
        interfaces: calWcapNetworkRequestInterfaces
    }),

    /**
     * @see nsIInterfaceRequestor
     * @see calProviderUtils.jsm
     */
    getInterface: cal.InterfaceRequestor_getInterface,

    /**
     * prepareChannel
     * Prepares the passed channel to match this objects properties
     *
     * @param aChannel    The Channel to be prepared
     */
    prepareChannel: function(aChannel) {
        // No caching
        aChannel.loadFlags |= Components.interfaces.nsIRequest.LOAD_BYPASS_CACHE;
        aChannel = aChannel.QueryInterface(Components.interfaces.nsIHttpChannel);
        aChannel.requestMethod = "GET";
    },

    /**
     * @see nsIChannelEventSink
     */
    asyncOnChannelRedirect: function(aOldChannel, aNewChannel, aFlags, aCallback) {
        // all we need to do to the new channel is the basic preparation
        this.prepareChannel(aNewChannel);
        aCallback.onRedirectVerifyCallback(Components.results.NS_OK);
    },

    /**
     * @see nsIUnicharStreamLoaderObserver
     */
    onDetermineCharset: function(loader, context, firstSegment, length) {
        let channel = null;
        if (loader) {
            channel = loader.channel;
        }
        let charset = null;
        if (channel) {
            charset = channel.contentCharset;
        }
        if (!charset || charset.length == 0) {
            charset = "UTF-8";
        }
        return charset;
    },

    /**
     * @see nsIUnicharStreamLoaderObserver
     */
    onStreamComplete: function(aLoader, aContext, aStatus, unicharData) {
        this.m_loader = null;

        if (LOG_LEVEL > 0 && this.m_bLogging) {
            log("status: " + errorToString(aStatus), this);
        }
        if (aStatus != Components.results.NS_OK) {
            this.execRespFunc(aStatus);
            return;
        }

        if (LOG_LEVEL > 2 && this.m_bLogging) {
            log("contentCharset = " + aLoader.charset + "\nrequest result:\n" + unicharData, this);
        }

        let httpChannel = aLoader.channel.QueryInterface(Components.interfaces.nsIHttpChannel);
        switch (httpChannel.responseStatus / 100) {
            case 2: /* 2xx codes */
                // Everything worked out, we are done
                this.execRespFunc(aStatus, unicharData);
                break;
            default: {
                // Something else went wrong
                let error = "A request Error Occurred. Status Code: " +
                            httpChannel.responseStatus + " " +
                            httpChannel.responseStatusText + " Body: " +
                            unicharData;
                this.execRespFunc(Components.Exception(error, NS_BINDING_FAILED));
                break;
            }
        }
    },

    toString: function() {
        let ret = "calWcapNetworkRequest id=" + this.id +
                   ", parent-id=" + (this.parentRequest ? this.parentRequest.id : "<none>");
        if (this.m_bLogging) {
            ret += " (" + this.m_url + ")";
        }
        ret += ", isPending=" + this.isPending;
        ret += ", status=" + errorToString(this.status);
        return ret;
    },

    m_parentRequest: null,
    get parentRequest() {
        return this.m_parentRequest;
    },
    set parentRequest(req) {
        if (this.parentRequest) {
            logError("already has parent!", this);
        }
        this.detachFromParent(); // detach without error
        return (this.m_parentRequest = req);
    },

    // calIOperation:
    get id() {
        return this.m_id;
    },

    m_isPending: true,
    get isPending() {
        return this.m_isPending;
    },

    get status() {
        return (this.request ? this.request.status : NS_OK);
    },

    detachFromParent: function(err) {
        let parentRequest = this.m_parentRequest;
        if (parentRequest) {
            this.m_parentRequest = null;
            parentRequest.detachSubRequest(this, err);
        }
    },

    get request() {
        return (this.m_loader ? this.m_loader.channel : null);
    },

    cancel: function(status) {
        if (!status) {
            status = calIErrors.OPERATION_CANCELLED;
        }
        this.execRespFunc(status);
        // xxx todo: check whether this works on redirected channels!
        let request = this.request;
        if (request && request.isPending()) {
            log("canceling netwerk request...", this);
            request.cancel(NS_BINDING_FAILED);
            this.m_loader = null;
        }
    },

    execRespFunc: function(err, str) {
        if (this.isPending) {
            this.m_isPending = false;
            let respFunc = this.m_respFunc;
            if (respFunc) {
                this.m_respFunc = null; // call once only
                if (LOG_LEVEL > 2 && this.m_bLogging) {
                    log("response exec: " + errorToString(err), this);
                }
                try {
                    respFunc(err, str);
                    err = null; // may have been handled
                } catch (exc) {
                    // don't pump into error console, may be handled:
                    log("error: " + errorToString(exc), this);
                    err = exc;
                }
            }
            this.detachFromParent(err);
        }
    },

    execSubRespFunc: function(func, err, data) {
        try {
            func(err, data);
        } catch (exc) {
            this.execRespFunc(exc);
        }
    }
};

function issueNetworkRequest(parentRequest, respFunc, url, bLogging) {
    let netRequest = new calWcapNetworkRequest(url, respFunc, bLogging);
    if (parentRequest) {
        parentRequest.attachSubRequest(netRequest);
    }
    try {
        let uri = Services.io.newURI(url, null, null);
        let channel = Services.io.newChannelFromURI2(uri,
                                                     null,
                                                     Services.scriptSecurityManager.getSystemPrincipal(),
                                                     null,
                                                     Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                     Components.interfaces.nsIContentPolicy.TYPE_OTHER);
        netRequest.prepareChannel(channel);
        channel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
        channel.redirectionLimit = 3;
        channel.notificationCallbacks = netRequest;
        let loader = Components.classes["@mozilla.org/network/unichar-stream-loader;1"]
                               .createInstance(Components.interfaces.nsIUnicharStreamLoader);
        netRequest.m_loader = loader;

        log("opening channel.", netRequest);
        loader.init(netRequest,
                    Components.interfaces.nsIUnicharStreamLoader.DEFAULT_SEGMENT_SIZE);
        channel.asyncOpen(loader, null);
    } catch (exc) {
        netRequest.execRespFunc(exc);
    }
}

function getWcapRequestStatusString(xml) {
    let str = "request status: ";
    let items = xml.getElementsByTagName("RSTATUS");
    if (items != null && items.length > 0) {
        str += items.item(0).textContent;
    } else {
        str += "none";
    }
    return str;
}

function stringToIcal(session, data, expectedErrno) {
    if (!data || data.length == 0) { // assuming time-out; WTF.
        throw new Components.Exception(errorToString(calIWcapErrors.WCAP_LOGIN_FAILED),
                                       calIWcapErrors.WCAP_LOGIN_FAILED);
    }
    let icalRootComp;
    try {
        icalRootComp = getIcsService().parseICS(data, session /* implements calITimezoneProvider */);
    } catch (exc) { // map into more useful error string:
        throw new Components.Exception("error parsing ical data!", calIErrors.ICS_PARSE);
    }
    checkWcapIcalErrno(icalRootComp, expectedErrno);
    return icalRootComp;
}

function stringToXml(session, data, expectedErrno) {
    if (!data || data.length == 0) { // assuming time-out
        throw new Components.Exception(errorToString(calIWcapErrors.WCAP_LOGIN_FAILED),
                                       calIWcapErrors.WCAP_LOGIN_FAILED);
    }
    let xml = getDomParser().parseFromString(data, "text/xml");
    checkWcapXmlErrno(xml, expectedErrno);
    return xml;
}
