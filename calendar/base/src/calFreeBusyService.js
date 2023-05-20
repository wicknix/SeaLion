/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function calFreeBusyListener(numOperations, finalListener) {
    this.mFinalListener = finalListener;
    this.mNumOperations = numOperations;

    this.opGroup = new calOperationGroup(() => {
        this.notifyResult(null);
    });
}
calFreeBusyListener.prototype = {
    mFinalListener: null,
    mNumOperations: 0,
    opGroup: null,

    QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIGenericOperationListener]),

    notifyResult: function(result) {
        let listener = this.mFinalListener;
        if (listener) {
            if (!this.opGroup.isPending) {
                this.mFinalListener = null;
            }
            listener.onResult(this.opGroup, result);
        }
    },

    // calIGenericOperationListener:
    onResult: function(aOperation, aResult) {
        if (this.mFinalListener) {
            if (!aOperation || !aOperation.isPending) {
                --this.mNumOperations;
                if (this.mNumOperations == 0) {
                    this.opGroup.notifyCompleted();
                }
            }
            let opStatus = aOperation ? aOperation.status : Components.results.NS_OK;
            if (Components.isSuccessCode(opStatus) &&
                aResult && Array.isArray(aResult)) {
                this.notifyResult(aResult);
            } else {
                this.notifyResult([]);
            }
        }
    }
};

function calFreeBusyService() {
    this.wrappedJSObject = this;
    this.mProviders = new calInterfaceBag(Components.interfaces.calIFreeBusyProvider);
}
var calFreeBusyServiceClassID = Components.ID("{29c56cd5-d36e-453a-acde-0083bd4fe6d3}");
var calFreeBusyServiceInterfaces = [
    Components.interfaces.calIFreeBusyProvider,
    Components.interfaces.calIFreeBusyService
];
calFreeBusyService.prototype = {
    mProviders: null,

    classID: calFreeBusyServiceClassID,
    QueryInterface: XPCOMUtils.generateQI(calFreeBusyServiceInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calFreeBusyServiceClassID,
        contractID: "@mozilla.org/calendar/freebusy-service;1",
        classDescription: "Calendar FreeBusy Service",
        interfaces: calFreeBusyServiceInterfaces,
        flags: Components.interfaces.nsIClassInfo.SINGLETON
    }),

    // calIFreeBusyProvider:
    getFreeBusyIntervals: function(aCalId, aRangeStart, aRangeEnd, aBusyTypes, aListener) {
        let groupListener = new calFreeBusyListener(this.mProviders.size, aListener);
        for (let provider of this.mProviders) {
            let operation = provider.getFreeBusyIntervals(aCalId, aRangeStart,
                                                          aRangeEnd,
                                                          aBusyTypes,
                                                          groupListener);
            groupListener.opGroup.add(operation);
        }
        return groupListener.opGroup;
    },

    // calIFreeBusyService:
    addProvider: function(aProvider) {
        this.mProviders.add(aProvider);
    },
    removeProvider: function(aProvider) {
        this.mProviders.remove(aProvider);
    }
};
