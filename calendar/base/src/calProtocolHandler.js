/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

/** Constructor for webcal: protocol handler */
function calProtocolHandlerWebcal() {
    calProtocolHandler.call(this, "webcal");
}

/** Constructor for webcals: protocl handler */
function calProtocolHandlerWebcals() {
    calProtocolHandler.call(this, "webcals");
}

/**
 * Generic webcal constructor
 *
 * @param scheme        The scheme to init for (webcal, webcals)
 */
function calProtocolHandler(scheme) {
    this.scheme = scheme;
    this.mHttpProtocol = Services.io.getProtocolHandler(this.scheme == "webcal" ? "http" : "https");
    this.wrappedJSObject = this;
}

calProtocolHandler.prototype = {
    get defaultPort() { return this.mHttpProtocol.defaultPort; },
    get protocolFlags() { return this.mHttpProtocol.protocolFlags; },

    newURI: function(aSpec, anOriginalCharset, aBaseURI) {
        let uri = Components.classes["@mozilla.org/network/standard-url;1"]
                            .createInstance(Components.interfaces.nsIStandardURL);
        uri.init(Components.interfaces.nsIStandardURL.URLTYPE_STANDARD,
                 this.mHttpProtocol.defaultPort, aSpec, anOriginalCharset, aBaseURI);
        return uri;
    },

    newChannel: function(aUri) {
        return this.newChannel2(aUri, null);
    },

    newChannel2: function(aUri, aLoadInfo) {
        // make sure to clone the uri, because we are about to change
        // it, and we don't want to change the original uri.
        let uri = aUri.clone();
        uri.scheme = this.mHttpProtocol.scheme;

        let channel;
        if (aLoadInfo) {
            channel = Services.io.newChannelFromURIWithLoadInfo(uri, aLoadInfo);
        } else {
            channel = Services.io.newChannelFromURI2(uri,
                                                     null,
                                                     Services.scriptSecurityManager.getSystemPrincipal(),
                                                     null,
                                                     Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                                     Components.interfaces.nsIContentPolicy.TYPE_OTHER);
        }
        channel.originalURI = aUri;
        return channel;
    },

    // We are not overriding any special ports
    allowPort: function(aPort, aScheme) { return false; }
};

var calProtocolHandlerWebcalClassID = Components.ID("{1153c73a-39be-46aa-9ba9-656d188865ca}");
var calProtocolHandlerWebcalInterfaces = [Components.interfaces.nsIProtocolHandler];
calProtocolHandlerWebcal.prototype = {
    __proto__: calProtocolHandler.prototype,
    classID: calProtocolHandlerWebcalClassID,
    QueryInterface: XPCOMUtils.generateQI(calProtocolHandlerWebcalInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calProtocolHandlerWebcalClassID,
        contractID: "@mozilla.org/network/protocol;1?name=webcal",
        classDescription: "Calendar webcal protocal handler",
        interfaces: calProtocolHandlerWebcalInterfaces
    }),
};

var calProtocolHandlerWebcalsClassID = Components.ID("{bdf71224-365d-4493-856a-a7e74026f766}");
var calProtocolHandlerWebcalsInterfaces = [Components.interfaces.nsIProtocolHandler];
calProtocolHandlerWebcals.prototype = {
    __proto__: calProtocolHandler.prototype,
    classID: calProtocolHandlerWebcalsClassID,
    QueryInterface: XPCOMUtils.generateQI(calProtocolHandlerWebcalsInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calProtocolHandlerWebcalsClassID,
        contractID: "@mozilla.org/network/protocol;1?name=webcals",
        classDescription: "Calendar webcals protocal handler",
        interfaces: calProtocolHandlerWebcalsInterfaces
    }),
};
