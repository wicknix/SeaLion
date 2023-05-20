/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calIteratorUtils.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function calAttendee() {
    this.wrappedJSObject = this;
    this.mProperties = new calPropertyBag();
}

var calAttendeeClassID = Components.ID("{5c8dcaa3-170c-4a73-8142-d531156f664d}");
var calAttendeeInterfaces = [Components.interfaces.calIAttendee];
calAttendee.prototype = {
    classID: calAttendeeClassID,
    QueryInterface: XPCOMUtils.generateQI(calAttendeeInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calAttendeeClassID,
        contractID: "@mozilla.org/calendar/attendee;1",
        classDescription: "Calendar Attendee",
        interfaces: calAttendeeInterfaces
    }),

    mImmutable: false,
    get isMutable() { return !this.mImmutable; },

    modify: function() {
        if (this.mImmutable) {
            throw Components.results.NS_ERROR_OBJECT_IS_IMMUTABLE;
        }
    },

    makeImmutable: function() {
        this.mImmutable = true;
    },

    clone: function() {
        let a = new calAttendee();

        if (this.mIsOrganizer) {
            a.isOrganizer = true;
        }

        const allProps = ["id", "commonName", "rsvp", "role",
                          "participationStatus", "userType"];
        for (let prop of allProps) {
            a[prop] = this[prop];
        }

        for (let [key, value] of this.mProperties) {
            a.setProperty(key, value);
        }

        return a;
    },
    // XXX enforce legal values for our properties;

    icalAttendeePropMap: [
        { cal: "rsvp", ics: "RSVP" },
        { cal: "commonName", ics: "CN" },
        { cal: "participationStatus", ics: "PARTSTAT" },
        { cal: "userType", ics: "CUTYPE" },
        { cal: "role", ics: "ROLE" }
    ],

    mIsOrganizer: false,
    get isOrganizer() { return this.mIsOrganizer; },
    set isOrganizer(bool) { this.mIsOrganizer = bool; },

    // icalatt is a calIcalProperty of type attendee
    set icalProperty(icalatt) {
        this.modify();
        this.id = icalatt.valueAsIcalString;
        this.mIsOrganizer = (icalatt.propertyName == "ORGANIZER");

        let promotedProps = { };
        for (let prop of this.icalAttendeePropMap) {
            this[prop.cal] = icalatt.getParameter(prop.ics);
            // Don't copy these to the property bag.
            promotedProps[prop.ics] = true;
        }

        // Reset the property bag for the parameters, it will be re-initialized
        // from the ical property.
        this.mProperties = new calPropertyBag();

        for (let [name, value] of cal.ical.paramIterator(icalatt)) {
            if (!promotedProps[name]) {
                this.setProperty(name, value);
            }
        }
    },

    get icalProperty() {
        let icssvc = cal.getIcsService();
        let icalatt;
        if (this.mIsOrganizer) {
            icalatt = icssvc.createIcalProperty("ORGANIZER");
        } else {
            icalatt = icssvc.createIcalProperty("ATTENDEE");
        }

        if (!this.id) {
            throw Components.results.NS_ERROR_NOT_INITIALIZED;
        }
        icalatt.valueAsIcalString = this.id;
        for (let i = 0; i < this.icalAttendeePropMap.length; i++) {
            let prop = this.icalAttendeePropMap[i];
            if (this[prop.cal]) {
                try {
                    icalatt.setParameter(prop.ics, this[prop.cal]);
                } catch (e) {
                    if (e.result == Components.results.NS_ERROR_ILLEGAL_VALUE) {
                        // Illegal values should be ignored, but we could log them if
                        // the user has enabled logging.
                        cal.LOG("Warning: Invalid attendee parameter value " + prop.ics + "=" + this[prop.cal]);
                    } else {
                        throw e;
                    }
                }
            }
        }
        for (let [key, value] of this.mProperties) {
            try {
                icalatt.setParameter(key, value);
            } catch (e) {
                if (e.result == Components.results.NS_ERROR_ILLEGAL_VALUE) {
                    // Illegal values should be ignored, but we could log them if
                    // the user has enabled logging.
                    cal.LOG("Warning: Invalid attendee parameter value " + key + "=" + value);
                } else {
                    throw e;
                }
            }
        }
        return icalatt;
    },

    get icalString() {
        let comp = this.icalProperty;
        return (comp ? comp.icalString : "");
    },
    set icalString(val) {
        let prop = cal.getIcsService().createIcalPropertyFromString(val);
        if (prop.propertyName != "ORGANIZER" && prop.propertyName != "ATTENDEE") {
            throw Components.results.NS_ERROR_ILLEGAL_VALUE;
        }
        this.icalProperty = prop;
        return val;
    },

    get propertyEnumerator() { return this.mProperties.enumerator; },

    // The has/get/set/deleteProperty methods are case-insensitive.
    getProperty: function(aName) {
        return this.mProperties.getProperty(aName.toUpperCase());
    },
    setProperty: function(aName, aValue) {
        this.modify();
        if (aValue || !isNaN(parseInt(aValue, 10))) {
            this.mProperties.setProperty(aName.toUpperCase(), aValue);
        } else {
            this.mProperties.deleteProperty(aName.toUpperCase());
        }
    },
    deleteProperty: function(aName) {
        this.modify();
        this.mProperties.deleteProperty(aName.toUpperCase());
    },

    mId: null,
    get id() {
        return this.mId;
    },
    set id(aId) {
        this.modify();
        // RFC 1738 para 2.1 says we should be using lowercase mailto: urls
        // we enforce prepending the mailto prefix for email type ids as migration code bug 1199942
        return (this.mId = (aId ? cal.prependMailTo(aId) : null));
    },

    toString: function() {
        const emailRE = new RegExp("^mailto:", "i");
        let stringRep = (this.id || "").replace(emailRE, "");
        let commonName = this.commonName;

        if (commonName) {
            stringRep = commonName + " <" + stringRep + ">";
        }

        return stringRep;
    }
};

var makeMemberAttr;
if (makeMemberAttr) {
    makeMemberAttr(calAttendee, "mCommonName", null, "commonName");
    makeMemberAttr(calAttendee, "mRsvp", null, "rsvp");
    makeMemberAttr(calAttendee, "mRole", null, "role");
    makeMemberAttr(calAttendee, "mParticipationStatus", "NEEDS-ACTION",
                   "participationStatus");
    makeMemberAttr(calAttendee, "mUserType", "INDIVIDUAL", "userType");
}
