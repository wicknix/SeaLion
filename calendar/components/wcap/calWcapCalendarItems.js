/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://calendar/modules/calAlarmUtils.jsm");
Components.utils.import("resource://calendar/modules/calIteratorUtils.jsm");

calWcapCalendar.prototype.encodeAttendee = function(att) {
    if (LOG_LEVEL > 2) {
        log("attendee.icalProperty.icalString=" + att.icalProperty.icalString, this);
    }
    function encodeAttr(val, attr, params) {
        if (val && val.length > 0) {
            if (params.length > 0) {
                params += "^";
            }
            if (attr) {
                params += attr + "=";
            }
            params += encodeURIComponent(val);
        }
        return params;
    }
    let params = encodeAttr(att.rsvp, "RSVP", "");
    params = encodeAttr(att.participationStatus, "PARTSTAT", params);
    params = encodeAttr(att.role, "ROLE", params);
    let commonName = att.commonName;
    if (commonName) {
        params = encodeAttr(commonName.replace(/[;:]/g, " "), "CN", params); // remove ';' and ':' from CN
    }
    return encodeAttr(att.id, null, params);
};

calWcapCalendar.prototype.getRecurrenceParams = function(item, out_rrules, out_rdates, out_exrules, out_exdates) {
    // recurrences:
    out_rrules.value = [];
    out_rdates.value = [];
    out_exrules.value = [];
    out_exdates.value = [];
    if (item.recurrenceInfo) {
        let rItems = item.recurrenceInfo.getRecurrenceItems({});
        for (let rItem of rItems) {
            let isNeg = rItem.isNegative;
            let rRuleInstance = cal.wrapInstance(rItem, Components.interfaces.calIRecurrenceRule);
            let rDateInstance = cal.wrapInstance(rItem, Components.interfaces.calIRecurrenceDate);
            if (rRuleInstance) {
                let rule = "\"" + encodeURIComponent(rRuleInstance.icalProperty.valueAsIcalString) + "\"";
                if (isNeg) {
                    out_exrules.value.push(rule);
                } else {
                    out_rrules.value.push(rule);
                }
            } else if (rDateInstance) {
                // cs does not accept DATEs here:
                if (isNeg) {
                    out_exdates.value.push(getIcalUTC(ensureDateTime(rDateInstance.date)));
                } else {
                    out_rdates.value.push(getIcalUTC(ensureDateTime(rDateInstance.date)));
                }
            } else {
                this.notifyError(NS_ERROR_UNEXPECTED,
                                 "don't know how to handle this recurrence item: " + rItem.valueAsIcalString);
            }
        }
    }
};

function sameStringSet(list, list_) {
    return list.length == list_.length &&
           list.every(x => list_.some(y => x == y));
}

calWcapCalendar.prototype.encodeRecurrenceParams = function(item, oldItem, excludeExdates) {
    let rrules = {};
    let rdates = {};
    let exrules = {};
    let exdates = {};
    this.getRecurrenceParams(item, rrules, rdates, exrules, exdates);
    if (oldItem) {
        // actually only write changes if an old item has been changed, because
        // cs recreates the whole series if a rule has changed.
        // xxx todo: one problem is left when a master only holds EXDATEs,
        //           and effectively no item is present anymore.
        //           cs seems not to clean up automatically, but it does when
        //           when deleting an occurrence {id, rec-id}!
        //           So this still leaves the question open why deleteOccurrence
        //           does not directly call deleteItem rather than modifyItem,
        //           which leads to a much cleaner usage.
        //           I assume this mimic has been chosen for easier undo/redo
        //           support (Undo would then have to distinguish whether
        //           it has previously deleted an occurrence or ordinary item:
        //            - entering an exception again
        //            - or adding an item)
        //           Currently it can just modifyItem(newItem/oldItem) back.
        let rrules_ = {};
        let rdates_ = {};
        let exrules_ = {};
        let exdates_ = {};
        this.getRecurrenceParams(oldItem, rrules_, rdates_, exrules_, exdates_);

        if (sameStringSet(rrules.value, rrules_.value)) {
            rrules.value = null; // don't write
        }
        if (sameStringSet(rdates.value, rdates_.value)) {
            rdates.value = null; // don't write
        }
        if (sameStringSet(exrules.value, exrules.value)) {
            exrules.value = null; // don't write
        }
        if (excludeExdates || sameStringSet(exdates.value, exdates_.value)) {
            exdates.value = null; // don't write
        }
    }

    let ret = "";
    if (rrules.value) {
        ret += "&rrules=" + rrules.value.join(";");
    }
    if (rdates.value) {
        ret += "&rdates=" + rdates.value.join(";");
    }
    if (exrules.value) {
        ret += "&exrules=" + exrules.value.join(";");
    }
    if (!excludeExdates && exdates.value) {
        ret += "&exdates=" + exdates.value.join(";");
    }
    return ret;
    // xxx todo:
    // rchange=1: expand recurrences,
    // or whether to replace the rrule, ambiguous documentation!!!
    // check with store(with no uid) upon adoptItem() which behaves strange
    // if rchange=0 is set!
};

calWcapCalendar.prototype.getAlarmParams = function(item) {
    let params = null;
    // xxx TODO ALARMSUPPORT check if WCAP supports multiple alarms
    let alarms = item.getAlarms({}).filter(x => x.action == "EMAIL");
    let alarm = alarms.length > 0 && alarms[0];

    if (alarm) {
        let alarmStart = cal.alarms.calculateAlarmOffset(item, alarm);
        if (alarm.related == alarm.ALARM_RELATED_END) {
            // cs does not support explicit RELATED=END when
            // both start|entry and end|due are written
            let dur = item.duration;
            if (dur) { // both given
                alarmStart = alarmStart.clone();
                alarmStart.addDuration(dur);
            } // else only end|due is set, alarm makes little sense though
        }

        let emails = "";
        if (item.hasProperty("alarmEmailAddress")) {
            emails = encodeURIComponent(item.getProperty("alarmEmailAddress"));
        } else {
            emails = this.session.getDefaultAlarmEmails({}).map(encodeURIComponent).join(";");
        }
        if (emails.length > 0) {
            params = "&alarmStart=" + alarmStart.icalString;
            params += "&alarmEmails=" + emails;
        }
        // else popup
    }
    if (!params) { // clear popup, email alarm:
        params = "&alarmStart=&alarmPopup=&alarmEmails=";
    }
    return params;
};

// why ever, X-S1CS-EMAIL is unsupported though documented
// for get_calprops... WTF.
function getCalId(att) {
    return (att ? att.getProperty("X-S1CS-CALID") : null);
}

function getAttendeeByCalId(atts, calId) {
    for (let att of atts) {
        if (getCalId(att) == calId) {
            return att;
        }
    }
    return null;
}

calWcapCalendar.prototype.isInvitation = function(item) {
    if (!this.session.isLoggedIn) {
        return false; // don't know
    }
    let calId = this.calId;
    let orgCalId = getCalId(item.organizer);
    if (!orgCalId || (orgCalId == calId)) {
        return false;
    }
    return (this.getInvitedAttendee(item) != null);
};

calWcapCalendar.prototype.getInvitedAttendee = function(item) {
    let att = getAttendeeByCalId(item.getAttendees({}), this.calId);
    if (!att) { // try to find mail address
        let prefMail = this.session.getUserPreferences("X-NSCP-WCAP-PREF-mail");
        if (prefMail.length > 0 && prefMail[0].length > 0) {
            att = item.getAttendeeById("mailto:" + prefMail[0]);
        }
    }
    return att;
};

calWcapCalendar.prototype.canNotify = function(method, item) {
    if (!this.session.isLoggedIn) {
        return false;
    }
    let calId = this.calId;
    switch (method) {
        case "REQUEST":
        case "CANCEL":
            // when creating new items, mind that organizer's id
            return !item.organizer || // might yet not be set
                   item.organizer.id == calId || // or is set to raw calId
                   getCalId(item.organizer) == calId;
        case "REPLY": // only if we we're invited from cs, and find matching X-S1CS-CALID:
            return (getAttendeeByCalId(item.getAttendees({}), calId) != null);
        default:
            return false;
    }
};

function equalDatetimes(one, two) {
    return (!one && !two) ||
            (one && two &&
             one.isDate == two.isDate &&
             one.compare(two) == 0);
}

function identicalDatetimes(one, two) {
    return (!one && !two) ||
            (equalDatetimes(one, two) &&
             compareObjects(one.timezone, two.timezone));
}

// @return null if nothing has changed else value to be written
function diffProperty(newItem, oldItem, propName) {
    let val = newItem.getProperty(propName);
    let oldVal = (oldItem ? oldItem.getProperty(propName) : null);
    if (val === null) {
        // force being set when - no old item, eg when adding new item
        //                      - property is to be deleted
        if (!oldItem || oldVal) {
            val = "";
        }
    } else {
        val = val.replace(/(\r\n)|\n/g, "\r\n");
        if (oldVal) {
            oldVal = oldVal.replace(/(\r\n)|\n/g, "\r\n");
        }
        if (val == oldVal) {
            val = null;
        }
    }
    return val;
}

/* eslint-disable no-unused-vars */
var METHOD_PUBLISH = 1;
var METHOD_REQUEST = 2;
var METHOD_REPLY = 4;
var METHOD_CANCEL = 8;
var METHOD_UPDATE = 256;
/* eslint-enable no-unused-vars */

calWcapCalendar.prototype.storeItem = function(bAddItem, item, oldItem, request) {
    function getOrgId(orgItem) {
        return (orgItem && orgItem.organizer && orgItem.organizer.id ? orgItem.organizer.id : null);
    }
    function encodeCategories(cats) {
        cats = cats.concat([]);
        cats.sort();
        return cats.join(";");
    }
    function getPrivacy(pitem) {
        return ((pitem.privacy && pitem.privacy != "") ? pitem.privacy : "PUBLIC");
    }

    let encodeAttendees = (atts) => {
        function attendeeSort(one, two) {
            one = one.id;
            two = two.id;
            if (one == two) {
                return 0;
            }
            return (one < two ? -1 : 1);
        }
        atts = atts.concat([]);
        atts.sort(attendeeSort);
        return atts.map(this.encodeAttendee, this).join(";");
    };

    let getAttachments = (attitem) => {
        let ret;
        let attachments = attitem.attachments;
        if (attachments) {
            let strings = [];
            for (let att of attachments) {
                let wrappedAtt = cal.wrapInstance(att, Components.interfaces.calIAttachment);
                if (typeof att == "string") {
                    strings.push(encodeURIComponent(att));
                } else if (wrappedAtt && wrappedAtt.uri) {
                    strings.push(encodeURIComponent(wrappedAtt.uri.spec));
                } else { // xxx todo
                    logError("only URLs supported as attachment, not: " + att, this);
                }
            }
            strings.sort();
            ret = strings.join(";");
        }
        return ret || "";
    };

    let bIsEvent = isEvent(item);
    let bIsParent = isParent(item);

    let method = METHOD_PUBLISH;
    let bNoSmtpNotify = false;
    let params = "";

    let calId = this.calId;
    if (!bAddItem && this.isInvitation(item)) { // REPLY
        method = METHOD_REPLY;
        let att = getAttendeeByCalId(item.getAttendees({}), calId);
        if (att) {
            log("attendee: " + att.icalProperty.icalString, this);
            let oldAtt = null;
            if (oldItem) {
                oldAtt = getAttendeeByCalId(oldItem.getAttendees({}), calId);
            }
            if (!oldAtt || (att.participationStatus != oldAtt.participationStatus)) {
                // REPLY first for just this calendar:
                params += "&attendees=PARTSTAT=" + att.participationStatus +
                           "^" + encodeURIComponent(att.id);
            }
        }
    } else { // PUBLISH, REQUEST
        // workarounds for server bugs concerning recurrences/exceptions:
        // - if first occurrence is an exception
        //   and an EXDATE for that occurrence ought to be written,
        //   then the master item's data is replaced with that EXDATEd exception. WTF.
        // - if start/end date is being written on master, the previously EXDATEd
        //   exception overwrites master, why ever.
        // So in these cases: write all data of master.

        let bIsAllDay = false;
        let dtstart, dtend;
        if (bIsEvent) {
            dtstart = item.startDate;
            dtend = item.endDate;
            bIsAllDay = dtstart.isDate && dtend.isDate;
            if (!oldItem || !identicalDatetimes(dtstart, oldItem.startDate) ||
                !identicalDatetimes(dtend, oldItem.endDate)) {
                params += "&dtstart=" + getIcalUTC(dtstart); // timezone will be set with tzid param
                params += "&dtend=" + getIcalUTC(dtend);
                params += bIsAllDay ? "&isAllDay=1" : "&isAllDay=0";

                if (bIsParent && item.recurrenceInfo) {
                    oldItem = null; // recurrence/exceptions hack: write whole master
                }
            }
        } else { // calITodo
            // xxx todo: dtstart is mandatory for cs, so if this is
            //           undefined, assume an allDay todo???
            dtstart = item.entryDate;
            dtend = item.dueDate;

            // cs bug: enforce DUE (set to DTSTART) if alarm is set
            if (!dtend && item.getAlarms({}).length) {
                dtend = dtstart;
            }

            bIsAllDay = dtstart && dtstart.isDate;
            if (!oldItem || !identicalDatetimes(dtstart, oldItem.entryDate) ||
                !identicalDatetimes(dtend, oldItem.dueDate)) {
                params += "&dtstart=" + getIcalUTC(dtstart); // timezone will be set with tzid param
                params += "&due=" + getIcalUTC(dtend); // timezone will be set with tzid param
                params += bIsAllDay ? "&isAllDay=1" : "&isAllDay=0";

                if (bIsParent && item.recurrenceInfo) {
                    oldItem = null; // recurrence/exceptions hack: write whole master
                }
            }
        }
        if (bIsParent) {
            let recParams = this.encodeRecurrenceParams(item, oldItem, !bAddItem /* exclude EXDATEs */);
            if (recParams.length > 0) {
                oldItem = null; // recurrence/exceptions hack: write whole master
                params += recParams;
            }
        }

        let orgCalId = getCalId(item.organizer);
        if (!orgCalId) { // new events yet don't have X-S1CS-CALID set on ORGANIZER or this is outbound iTIP
            let orgId = getOrgId(item);
            if (!orgId || (orgId.toLowerCase().replace(/^mailto:/, "") == this.ownerId.toLowerCase())) {
                orgCalId = calId; // own event
            } // else outbound
        }

        let attendees = item.getAttendees({});
        if (attendees.length > 0) {
            // xxx todo: why ever, X-S1CS-EMAIL is unsupported though documented for calprops... WTF.
            let attParam = encodeAttendees(attendees);
            if (!oldItem || attParam != encodeAttendees(oldItem.getAttendees({}))) {
                params += "&attendees=" + attParam;
            }

            if (orgCalId == calId) {
                method = METHOD_REQUEST;
            } else {
                method = METHOD_UPDATE;
                bNoSmtpNotify = true;
            }
        } else if (oldItem && oldItem.getAttendees({}).length > 0) {
            // else using just PUBLISH
            params += "&attendees="; // clear attendees
        }

        if (orgCalId) {
            if (!oldItem || (orgCalId != getCalId(oldItem.organizer))) {
                params += "&orgCalid=" + encodeURIComponent(orgCalId);
            }
        } else { // might be a copy of an iTIP invitation:
            let orgEmail = getOrgId(item);
            if (!oldItem || (getOrgId(oldItem) != orgEmail)) {
                params += "&orgEmail=" + encodeURIComponent(orgEmail);
            }
        }

        let val = item.title;
        if (!oldItem || val != oldItem.title) {
            params += "&summary=" + encodeURIComponent(val);
        }

        let categories = item.getCategories({});
        let catParam = encodeCategories(categories);
        if (!oldItem || catParam != encodeCategories(oldItem.getCategories({}))) {
            params += "&categories=" + catParam;
        }

        val = diffProperty(item, oldItem, "DESCRIPTION");
        if (val !== null) {
            params += "&desc=" + encodeURIComponent(val);
        }
        val = diffProperty(item, oldItem, "LOCATION");
        if (val !== null) {
            params += "&location=" + encodeURIComponent(val);
        }
        val = diffProperty(item, oldItem, "URL");
        if (val !== null) {
            params += "&icsUrl=" + encodeURIComponent(val);
        }
        // xxx todo: default prio is 0 (5 in sjs cs)
        val = item.priority;
        if (!oldItem || val != oldItem.priority) {
            params += "&priority=" + encodeURIComponent(val);
        }

        let icsClass = getPrivacy(item);
        if (!oldItem || icsClass != getPrivacy(oldItem)) {
            params += "&icsClass=" + icsClass;
        }

        if (!oldItem || item.status != oldItem.status) {
            switch (item.status) {
                case "CONFIRMED": params += "&status=0"; break;
                case "CANCELLED": params += "&status=1"; break;
                case "TENTATIVE": params += "&status=2"; break;
                case "NEEDS-ACTION": params += "&status=3"; break;
                case "COMPLETED": params += "&status=4"; break;
                case "IN-PROCESS": params += "&status=5"; break;
                case "DRAFT": params += "&status=6"; break;
                case "FINAL": params += "&status=7"; break;
                default: // reset to default
                    params += bIsEvent ? "&status=0" : "&status=3";
                    break;
            }
        }

        val = diffProperty(item, oldItem, "TRANSP");
        if (val !== null) {
            switch (val) {
                case "TRANSPARENT":
                    params += "&transparent=1";
                    break;
                case "OPAQUE":
                    params += "&transparent=0";
                    break;
                default:
                    params += "&transparent=" + (icsClass == "PRIVATE" || bIsAllDay ? "1" : "0");
                    break;
            }
        }

        if (!bIsEvent) {
            if (!oldItem || item.percentComplete != oldItem.percentComplete) {
                params += "&percent=" + item.percentComplete.toString(10);
            }
            if (!oldItem || !equalDatetimes(item.completedDate, oldItem.completedDate)) {
                params += "&completed=" + getIcalUTC(item.completedDate);
            }
        }

        // attachment urls:
        val = getAttachments(item);
        if (!oldItem || val != getAttachments(oldItem)) {
            params += "&attachments=" + val;
        }
    } // PUBLISH, REQUEST

    let alarmParams = this.getAlarmParams(item);
    if (!oldItem || (this.getAlarmParams(oldItem) != alarmParams)) {
        if ((method == METHOD_REQUEST) && params.length == 0) {
            // assure no email notifications about this change:
            bNoSmtpNotify = true;
        }
        params += alarmParams;
    }

    if (params.length == 0) {
        log("no change at all.", this);
        if (LOG_LEVEL > 2) {
            log("old item:\n" + oldItem.icalString + "\n\nnew item:\n" + item.icalString, this);
        }
        request.execRespFunc(null, item);
    } else {
        // cs does not support separate timezones for start and end, just pick one for tzid param:
        let someDate = item.startDate || item.entryDate || item.dueDate;
        if (someDate && !someDate.timezone.isUTC) {
            params += "&tzid=" + encodeURIComponent(this.getAlignedTzid(someDate.timezone));
        }

        if (item.id) {
            params += "&uid=" + encodeURIComponent(item.id);
        }

        // be picky about create/modify, if possible:
        // WCAP_STORE_TYPE_CREATE, WCAP_STORE_TYPE_MODIFY
        if (bAddItem) {
            params += "&storetype=1";
        } else if (oldItem) {
            params += "&storetype=2";
        } // else we don't know exactly, so don't check

        if (bIsParent) {
            params += "&mod=4"; // THIS AND ALL INSTANCES
        } else {
            params += "&mod=1&rid=" + getIcalUTC(ensureDateTime(item.recurrenceId)); // THIS INSTANCE
        }

        params += "&method=" + method;
        if (bNoSmtpNotify) {
            params += "&smtp=0&smtpNotify=0&notify=0";
        }
        params += "&replace=1"; // (update) don't append to any lists
        params += "&fetch=1&relativealarm=1&compressed=1&recurring=1";
        params += "&emailorcalid=1&fmt-out=text%2Fcalendar";

        let netRespFunc = (err, icalRootComp) => {
            if (err) {
                throw err;
            }
            let items = this.parseItems(icalRootComp, calICalendar.ITEM_FILTER_ALL_ITEMS,
                                        0, null, null, true /* bLeaveMutable */);
            if (items.length != 1) {
                this.notifyError(NS_ERROR_UNEXPECTED,
                                 "unexpected number of items: " + items.length);
            }
            let newItem = items[0];
            this.tunnelXProps(newItem, item);
            newItem.makeImmutable();
            // invalidate cached results:
            delete this.m_cachedResults;
            // xxx todo: may log request status
            request.execRespFunc(null, newItem);
        };
        this.issueNetworkRequest(request, netRespFunc, stringToIcal,
                                 bIsEvent ? "storeevents" : "storetodos", params,
                                 calIWcapCalendar.AC_COMP_READ |
                                 calIWcapCalendar.AC_COMP_WRITE);
    }
};

calWcapCalendar.prototype.tunnelXProps = function(destItem, srcItem) {
    // xxx todo: temp workaround for bug in calItemBase.js
    if (!isParent(srcItem)) {
        return;
    }
    // tunnel alarm X-MOZ-SNOOZE only if alarm is still set:
    // TODO ALARMSUPPORT still needed when showing alarms as EMAIL for wcap?
    let hasAlarms = destItem.getAlarms({}).length;
    let enumerator = srcItem.propertyEnumerator;
    while (enumerator.hasMoreElements()) {
        try {
            let prop = enumerator.getNext().QueryInterface(Components.interfaces.nsIProperty);
            let name = prop.name;
            if (name.startsWith("X-MOZ-")) {
                switch (name) {
                    // keep snooze stamps for occurrences only and if alarm is still set:
                    case "X-MOZ-SNOOZE-TIME":
                        if (!hasAlarms) {
                            break; // alarm has been reset
                        }
                        // falls through
                    default:
                        if (LOG_LEVEL > 1) {
                            log("tunneling " + name + "=" + prop.value, this);
                        }
                        destItem.setProperty(name, prop.value);
                        break;
                }
            }
        } catch (exc) {
            logError(exc, this);
        }
    }
};

calWcapCalendar.prototype.adoptItem = function(item, listener) {
    let request = new calWcapRequest(
        (oprequest, err, newItem) => {
            this.notifyOperationComplete(listener,
                                         getResultCode(err),
                                         calIOperationListener.ADD,
                                         err ? item.id : newItem.id,
                                         err ? err : newItem);
            if (!err && this == this.superCalendar) {
                this.notifyObservers("onAddItem", [newItem]);
            }
        },
        log("adoptItem() call: " + item.title, this));

    try {
        this.storeItem(true /* bAddItem */, item, null, request);
    } catch (exc) {
        request.execRespFunc(exc);
    }
    return request;
};

calWcapCalendar.prototype.addItem = function(item, listener) {
    this.adoptItem(item.clone(), listener);
};

calWcapCalendar.prototype.modifyItem = function(newItem, oldItem, listener) {
    let request = new calWcapRequest(
        (oprequest, err, item) => {
            this.notifyOperationComplete(listener,
                                         getResultCode(err),
                                         calIOperationListener.MODIFY,
                                         newItem.id, err ? err : item);
            if (!err && this == this.superCalendar) {
                this.notifyObservers("onModifyItem", [item, oldItem]);
            }
        },
        log("modifyItem() call: " + newItem.id, this));

    try {
        if (!newItem.id) {
            throw new Components.Exception("new item has no id!");
        }
        let oldItem_ = oldItem;
        if (isParent(newItem)) {
            // Due to a cs bug, EXDATEs cannot be passed with store, thus make a two-step delete then store.
            // First check if EXDATEs are passed or have been modified:
            let exdates = {};
            this.getRecurrenceParams(newItem, {}, {}, {}, exdates);
            if (oldItem) {
                let exdates_ = {};
                this.getRecurrenceParams(oldItem_, {}, {}, {}, exdates_);
                // only use added elements
                exdates.value = exdates.value.filter(elem => !exdates_.value.some(elem_ => elem_ == elem));
            } // else in case no oldItem is passed, nevertheless try to delete the EXDATEs
            if (exdates.value.length > 0) {
                let params = "&uid=";
                // all deletes on the same item:
                for (let i = exdates.value.length; i--;) {
                    params += encodeURIComponent(newItem.id);
                    if (i > 0) {
                        params += ";";
                    }
                }
                params += "&mod=1&rid=" + exdates.value.join(";");

                let orgCalId = getCalId(newItem.organizer);
                if (!orgCalId || (orgCalId != this.calId)) {
                    // item does not belong to this user, so don't notify:
                    params += "&smtp=0&smtpNotify=0&notify=0";
                }
                params += "&fmt-out=text%2Fxml";

                request.lockPending();
                this.issueNetworkRequest(request,
                                         (err, xml) => {
                                             try {
                                                 // ignore any error and continue storing the item:
                                                 if (LOG_LEVEL > 0) {
                                                     log("modifyItem EXDATEs: " +
                                                         (xml ? getWcapRequestStatusString(xml) : "failed!"), this);
                                                 }
                                                 // invalidate cached results:
                                                 delete this.m_cachedResults;
                                                 this.storeItem(false /* bAddItem */, newItem, oldItem_, request);
                                             } finally {
                                                 request.unlockPending();
                                             }
                                         },
                                         stringToXml, isEvent(newItem) ? "deleteevents_by_id" : "deletetodos_by_id",
                                         params, calIWcapCalendar.AC_COMP_WRITE);
                return request;
            }
        } else if (oldItem && !oldItem.parentItem.recurrenceInfo.getExceptionFor(newItem.recurrenceId)) {
            // pass null for oldItem when creating new exceptions, write whole item:
            oldItem_ = null;
        }
        this.storeItem(false /* bAddItem */, newItem, oldItem_, request);
    } catch (exc) {
        request.execRespFunc(exc);
    }
    return request;
};

calWcapCalendar.prototype.deleteItem = function(item, listener) {
    let request = new calWcapRequest(
        (oprequest, err) => {
            // xxx todo: need to notify about each deleted item if multiple?
            this.notifyOperationComplete(listener,
                                         getResultCode(err),
                                         calIOperationListener.DELETE,
                                         item.id, err ? err : item);
            if (!err && this == this.superCalendar) {
                this.notifyObservers("onDeleteItem", [item]);
            }
        },
        log("deleteItem() call: " + item.id, this));

    try {
        if (!item.id) {
            throw new Components.Exception("no item id!");
        }
        let params = "&uid=" + encodeURIComponent(item.id);
        if (isParent(item)) { // delete THIS AND ALL:
            params += "&mod=4&rid=0";
        } else { // delete THIS INSTANCE:
            // cs does not accept DATE here:
            params += "&mod=1&rid=" + getIcalUTC(ensureDateTime(item.recurrenceId));
        }

        let orgCalId = getCalId(item.organizer);
        if (!orgCalId || (orgCalId != this.calId)) {
            // item does not belong to this user, so don't notify:
            params += "&smtp=0&smtpNotify=0&notify=0";
        }

        params += "&fmt-out=text%2Fxml";

        this.issueNetworkRequest(request,
                                 (err, xml) => {
                                     if (err) {
                                         throw err;
                                     }
                                     // invalidate cached results:
                                     delete this.m_cachedResults;
                                     if (LOG_LEVEL > 0) {
                                         log("deleteItem(): " + getWcapRequestStatusString(xml), this);
                                     }
                                 },
                                 stringToXml, isEvent(item) ? "deleteevents_by_id" : "deletetodos_by_id",
                                 params, calIWcapCalendar.AC_COMP_WRITE);
    } catch (exc) {
        request.execRespFunc(exc);
    }
    return request;
};

calWcapCalendar.prototype.patchTimezone = function(subComp, attr, xpropOrTz) {
    let date = subComp[attr];
    // if TZID parameter present (all-day items), it takes precedence:
    if (date && (date.timezone.isUTC || date.timezone.isFloating)) {
        if (LOG_LEVEL > 2) {
            log(attr + " is " + date, this);
        }
        let timezone;
        if (typeof xpropOrTz == "string") {
            let tzid = subComp.getFirstProperty(xpropOrTz);
            if (tzid) {
                timezone = this.session.getTimezone(tzid.value);
                ASSERT(timezone, "timezone not found: " + tzid);
            }
        } else {
            timezone = xpropOrTz;
        }
        if (timezone) {
            if (LOG_LEVEL > 2) {
                log("patching " + xpropOrTz + ": from " +
                    date + " to " + date.getInTimezone(timezone), this);
            }
            date = date.getInTimezone(timezone);
            subComp[attr] = date;
        }
    }
    return date;
};

calWcapCalendar.prototype.parseItems = function(
    icalRootComp, itemFilter, maxResults, rangeStart, rangeEnd, bLeaveMutable) {
    let items = [];
    let unexpandedItems = [];
    let uid2parent = {};
    let excItems = [];
    let fakedParents = {};

    let componentType = "ANY";
    switch (itemFilter & calICalendar.ITEM_FILTER_TYPE_ALL) {
        case calICalendar.ITEM_FILTER_TYPE_TODO:
            componentType = "VTODO";
            break;
        case calICalendar.ITEM_FILTER_TYPE_EVENT:
            componentType = "VEVENT";
            break;
    }

    let recurrenceBound = this.session.recurrenceBound;

    for (let subComp of cal.ical.calendarComponentIterator(icalRootComp, componentType)) {
        let organizer = subComp.getFirstProperty("ORGANIZER");
        if (organizer && organizer.getParameter("SENT-BY")) { // has SENT-BY
            // &emailorcalid=1 sets wrong email, workaround setting calid...
            let id = organizer.getParameter("X-S1CS-CALID");
            if (id) {
                organizer.value = id;
            }
        }

        let dtstart = this.patchTimezone(subComp, "startTime", "X-NSCP-DTSTART-TZID");

        let item = null;
        switch (subComp.componentType) {
            case "VEVENT": {
                this.patchTimezone(subComp, "endTime", dtstart ? dtstart.timezone : "X-NSCP-DTEND-TZID");
                item = createEvent();
                item.icalComponent = subComp;
                break;
            }
            case "VTODO": {
                this.patchTimezone(subComp, "dueTime", dtstart ? dtstart.timezone : "X-NSCP-DUE-TZID");
                item = createTodo();
                item.icalComponent = subComp;
                switch (itemFilter & calICalendar.ITEM_FILTER_COMPLETED_ALL) {
                    case calICalendar.ITEM_FILTER_COMPLETED_YES:
                        if (!item.isCompleted) {
                            item = null;
                        }
                        break;
                    case calICalendar.ITEM_FILTER_COMPLETED_NO:
                        if (item.isCompleted) {
                            item = null;
                        }
                        break;
                }
                break;
            }
        }
        if (item) {
            if (!item.title) {
                // assumed to look at a subscribed calendar,
                // so patch title for private items:
                switch (item.privacy) {
                    case "PRIVATE":
                        item.title = g_privateItemTitle;
                        break;
                    case "CONFIDENTIAL":
                        item.title = g_confidentialItemTitle;
                        break;
                }
            }

            item.calendar = this.superCalendar;
            let rid = item.recurrenceId;
            if (rid) {
                rid = rid.getInTimezone(dtstart.timezone);
                item.recurrenceId = rid;
                if (LOG_LEVEL > 1) {
                    log("exception item: " + item.title +
                        "\nrid=" + getIcalUTC(rid) +
                        "\nitem.id=" + item.id, this);
                }
                excItems.push(item);
            } else if (item.recurrenceInfo) {
                unexpandedItems.push(item);
                uid2parent[item.id] = item;
            } else if ((maxResults == 0 || items.length < maxResults) &&
                       checkIfInRange(item, rangeStart, rangeEnd)) {
                if (LOG_LEVEL > 2) {
                    log("item: " + item.title + "\n" + item.icalString, this);
                }
                if (!bLeaveMutable) {
                    item.makeImmutable();
                }
                items.push(item);
            }
        }
    }

    // tag "exceptions", i.e. items with rid:
    for (let item of excItems) {
        let parent = uid2parent[item.id];

        if (!parent) { // a parentless one, fake a master and override it's occurrence
            parent = isEvent(item) ? createEvent() : createTodo();
            parent.id = item.id;
            parent.calendar = this.superCalendar;
            parent.setProperty("DTSTART", item.recurrenceId);
            parent.setProperty("X-MOZ-FAKED-MASTER", "1"); // this tag might be useful in the future
            parent.recurrenceInfo = createRecurrenceInfo(parent);
            fakedParents[item.id] = true;
            uid2parent[item.id] = parent;
            items.push(parent);
        }
        if (item.id in fakedParents) {
            let rdate = Components.classes["@mozilla.org/calendar/recurrence-date;1"]
                                  .createInstance(Components.interfaces.calIRecurrenceDate);
            rdate.date = item.recurrenceId;
            parent.recurrenceInfo.appendRecurrenceItem(rdate);
        }

        let recStartDate = parent.recurrenceStartDate;
        if (recStartDate && recStartDate.isDate && !item.recurrenceId.isDate) {
            // cs ought to return proper all-day RECURRENCE-ID!
            // get into startDate's timezone before cutting:
            let rid = item.recurrenceId.getInTimezone(recStartDate.timezone);
            rid.isDate = true;
            item.recurrenceId = rid;
        }

        parent.recurrenceInfo.modifyException(item, true);
    }

    if (itemFilter & calICalendar.ITEM_FILTER_CLASS_OCCURRENCES) {
        for (let item of unexpandedItems) {
            if (maxResults != 0 && items.length >= maxResults) {
                break;
            }

            let recStartDate = item.recurrenceStartDate;
            if (recStartDate && !recStartDate.isDate) {
                recStartDate = null;
            }
            let recItems = item.recurrenceInfo.getRecurrenceItems({});
            for (let recItem of recItems) {
                // cs bug: workaround missing COUNT
                let rRuleInstance = cal.wrapInstance(recItem, Components.interfaces.calIRecurrenceRule);
                let rDateInstance = cal.wrapInstance(recItem, Components.interfaces.calIRecurrenceDate);
                if (rRuleInstance) {
                    recItem = rRuleInstance;
                    if (!recItem.isFinite && !recItem.isNegative) {
                        recItem.count = recurrenceBound;
                    }
                } else if (recStartDate &&
                           rDateInstance) {
                    // cs bug: always uses DATE-TIME even though the master item is all-day DATE:
                    //         get into startDate's timezone before cutting:
                    recItem = rDateInstance;
                    let date = recItem.date.getInTimezone(recStartDate.timezone);
                    date.isDate = true;
                    recItem.date = date;
                }
            }

            if (!bLeaveMutable) {
                item.makeImmutable();
            }
            let occurrences = item.recurrenceInfo.getOccurrences(rangeStart, rangeEnd,
                                                                 maxResults == 0 ? 0 : maxResults - items.length,
                                                                 {});
            if (LOG_LEVEL > 1) {
                log("item: " + item.title + " has " + occurrences.length.toString() + " occurrences.", this);
                if (LOG_LEVEL > 2) {
                    log("master item: " + item.title + "\n" + item.icalString, this);
                    for (let occ of occurrences) {
                        log("item: " + occ.title + "\n" + occ.icalString, this);
                    }
                }
            }
            // only proxies returned:
            items = items.concat(occurrences);
        }
    } else {
        if (maxResults != 0 &&
            (items.length + unexpandedItems.length) > maxResults) {
            unexpandedItems.length = maxResults - items.length;
        }
        if (!bLeaveMutable) {
            for (let item of unexpandedItems) {
                item.makeImmutable();
            }
        }
        if (LOG_LEVEL > 2) {
            for (let item of unexpandedItems) {
                log("item: " + item.title + "\n" + item.icalString, this);
            }
        }
        items = items.concat(unexpandedItems);
    }

    if (LOG_LEVEL > 1) {
        log("parseItems(): returning " + items.length + " items", this);
    }
    return items;
};

calWcapCalendar.prototype.getItem = function(id, listener) {
    let request = new calWcapRequest(
        (oprequest, err, item) => {
            if (checkErrorCode(err, calIWcapErrors.WCAP_FETCH_EVENTS_BY_ID_FAILED) ||
                checkErrorCode(err, calIWcapErrors.WCAP_COMPONENT_NOT_FOUND)) {
                // querying by id is a valid use case, even if no item is returned:
                err = NS_OK;
            }
            this.notifyOperationComplete(listener,
                                         getResultCode(err),
                                         calIOperationListener.GET,
                                         item ? item.id : null,
                                         err || item);
        },
        log("getItem() call: id=" + id, this));

    try {
        if (!id) {
            throw new Components.Exception("no item id!");
        }
        let params = "&relativealarm=1&compressed=1&recurring=1";
        params += "&emailorcalid=1&fmt-out=text%2Fcalendar&uid=";
        params += encodeURIComponent(id);

        // most common: try events first
        this.issueNetworkRequest(
            request,
            (err, eventRootComp) => {
                let notifyResult = (rootComp) => {
                    let items = this.parseItems(rootComp, calICalendar.ITEM_FILTER_ALL_ITEMS, 0, null, null);
                    if (items.length < 1) {
                        throw new Components.Exception("no such item!");
                    }
                    if (items.length > 1) {
                        this.notifyError(NS_ERROR_UNEXPECTED,
                                         "unexpected number of items: " + items.length);
                    }
                    if (listener) {
                        listener.onGetResult(this.superCalendar, NS_OK,
                                             calIItemBase, log("getItem(): success. id=" + id, this),
                                             items.length, items);
                    }
                    request.execRespFunc(null, items[0]);
                };
                if (err) {
                    if (!checkErrorCode(err, calIWcapErrors.WCAP_FETCH_EVENTS_BY_ID_FAILED) &&
                        !checkErrorCode(err, calIWcapErrors.WCAP_COMPONENT_NOT_FOUND)) {
                        throw err;
                    }
                    // try todos:
                    this.issueNetworkRequest(
                        request,
                        (fetcherr, todoRootComp) => {
                            if (fetcherr) {
                                throw fetcherr;
                            }
                            notifyResult(todoRootComp);
                        },
                        stringToIcal, "fetchtodos_by_id", params, calIWcapCalendar.AC_COMP_READ);
                } else {
                    notifyResult(eventRootComp);
                }
            },
            stringToIcal, "fetchevents_by_id", params, calIWcapCalendar.AC_COMP_READ);
    } catch (exc) {
        request.execRespFunc(exc);
    }
    return request;
};

function getItemFilterParams(itemFilter) {
    let params = "";
    switch (itemFilter & calICalendar.ITEM_FILTER_TYPE_ALL) {
        case calICalendar.ITEM_FILTER_TYPE_TODO:
            params += "&component-type=todo";
            break;
        case calICalendar.ITEM_FILTER_TYPE_EVENT:
            params += "&component-type=event";
            break;
    }

    let compstate = "";
    //     if (itemFilter & calIWcapCalendar.ITEM_FILTER_REPLY_DECLINED)
    //         compstate += ";REPLY-DECLINED";
    //     if (itemFilter & calIWcapCalendar.ITEM_FILTER_REPLY_ACCEPTED)
    //         compstate += ";REPLY-ACCEPTED";
    //     if (itemFilter & calIWcapCalendar.ITEM_FILTER_REQUEST_COMPLETED)
    //         compstate += ";REQUEST-COMPLETED";
    if (itemFilter & calICalendar.ITEM_FILTER_REQUEST_NEEDS_ACTION) {
        compstate += ";REQUEST-NEEDS-ACTION";
    }
    //     if (itemFilter & calIWcapCalendar.ITEM_FILTER_REQUEST_NEEDSNOACTION) {
    //         compstate += ";REQUEST-NEEDSNOACTION";
    //     }
    //     if (itemFilter & calIWcapCalendar.ITEM_FILTER_REQUEST_PENDING)
    //         compstate += ";REQUEST-PENDING";
    //     if (itemFilter & calIWcapCalendar.ITEM_FILTER_REQUEST_WAITFORREPLY)
    //         compstate += ";REQUEST-WAITFORREPLY";
    if (compstate.length > 0) {
        params += "&compstate=" + compstate.substr(1);
    }
    return params;
}

calWcapCalendar.prototype.getItems = function(itemFilter, maxResults, rangeStart, rangeEnd, listener) {
    rangeStart = ensureDateTime(rangeStart);
    rangeEnd = ensureDateTime(rangeEnd);
    let zRangeStart = getIcalUTC(rangeStart);
    let zRangeEnd = getIcalUTC(rangeEnd);

    let request = new calWcapRequest(
        (oprequest, err, data) => {
            log("getItems() complete: " + errorToString(err), this);
            this.notifyOperationComplete(listener,
                                         getResultCode(err),
                                         calIOperationListener.GET,
                                         null,
                                         err);
        },
        log("getItems():\n\titemFilter=0x" + itemFilter.toString(0x10) +
            ",\n\tmaxResults=" + maxResults +
            ",\n\trangeStart=" + zRangeStart +
            ",\n\trangeEnd=" + zRangeEnd, this));

    if (this.aboutToBeUnregistered) {
        // limiting the amount of network traffic while unregistering
        log("being unregistered, no results.", this);
        request.execRespFunc(null, []);
        return request;
    }

    // m_cachedResults holds the last data revtrieval. This is expecially useful when
    // switching on multiple subcriptions: the composite calendar multiplexes getItems()
    // calls to all composited calendars over and over again, most often on the same
    // date range (as the user usually looks at the same view).
    // This will most likely vanish when a better caching is implemented in the views,
    // or WCAP local storage caching has sufficient performance.
    // The cached results will be invalidated after 2 minutes to reflect incoming invitations.
    if (CACHE_LAST_RESULTS > 0 && this.m_cachedResults) {
        for (let entry of this.m_cachedResults) {
            if ((itemFilter == entry.itemFilter) &&
                equalDatetimes(rangeStart, entry.rangeStart) &&
                equalDatetimes(rangeEnd, entry.rangeEnd)) {
                log("reusing last getItems() cached data.", this);
                if (listener) {
                    listener.onGetResult(
                        this.superCalendar, NS_OK, calIItemBase,
                        "getItems()", entry.results.length, entry.results);
                }
                request.execRespFunc(null, entry.results);
                return request;
            }
        }
    }

    try {
        let params = "&relativealarm=1&compressed=1&recurring=1&emailorcalid=1&fmt-out=text%2Fcalendar";
        // setting component-type, compstate filters:
        params += getItemFilterParams(itemFilter);
        if (maxResults > 0) {
            params += "&maxResults=" + maxResults;
        }
        params += "&dtstart=" + zRangeStart;
        params += "&dtend=" + zRangeEnd;

        this.issueNetworkRequest(
            request,
            (err, icalRootComp) => {
                if (err) {
                    if (checkErrorCode(err, calIWcapErrors.WCAP_ACCESS_DENIED_TO_CALENDAR)) {
                        // try free-busy times:
                        if (listener &&
                            (itemFilter & calICalendar.ITEM_FILTER_TYPE_EVENT) &&
                            rangeStart && rangeEnd) {
                            let freeBusyListener = { // calIGenericOperationListener:
                                onResult: function(oprequest, result) {
                                    if (!Components.isSuccessCode(oprequest.status)) {
                                        throw oprequest.status;
                                    }
                                    let items = [];
                                    for (let entry of result) {
                                        let item = createEvent();
                                        item.id = g_busyPhantomItemUuidPrefix + getIcalUTC(entry.interval.start);
                                        item.calendar = this.superCalendar;
                                        item.title = g_busyItemTitle;
                                        item.startDate = entry.interval.start;
                                        item.endDate = entry.interval.end;
                                        item.makeImmutable();
                                        items.push(item);
                                    }
                                    listener.onGetResult(this.superCalendar, NS_OK, calIItemBase,
                                                         "getItems()/free-busy", items.length, items);
                                }.bind(this)
                            };
                            request.attachSubRequest(
                                this.session.getFreeBusyIntervals(
                                    this.calId, rangeStart, rangeEnd, calIFreeBusyInterval.BUSY_ALL,
                                    freeBusyListener));
                        }
                    } else {
                        throw err;
                    }
                } else if (listener) {
                    let items = this.parseItems(
                        icalRootComp, itemFilter, maxResults,
                        rangeStart, rangeEnd);

                    if (CACHE_LAST_RESULTS > 0) {
                        // auto invalidate after X minutes:
                        if (!this.m_cachedResultsTimer) {
                            let callback = {
                                notify: function(timer) {
                                    if (!this.m_cachedResults) {
                                        return;
                                    }
                                    let now = (new Date()).getTime();
                                    // sort out old entries:
                                    let entries = [];
                                    for (let i = 0; i < this.m_cachedResults.length; ++i) {
                                        let entry = this.m_cachedResults[i];
                                        if ((now - entry.stamp) < (CACHE_LAST_RESULTS_INVALIDATE * 1000)) {
                                            entries.push(entry);
                                        } else {
                                            log("invalidating cached entry:\n\trangeStart=" +
                                                getIcalUTC(entry.rangeStart) + "\n\trangeEnd=" +
                                                getIcalUTC(entry.rangeEnd), this);
                                        }
                                    }
                                    this.m_cachedResults = entries;
                                }.bind(this)
                            };
                            // sort out freq:
                            let freq = Math.min(20, // default: 20secs
                                                Math.max(1, CACHE_LAST_RESULTS_INVALIDATE));
                            log("cached results sort out timer freq: " + freq, this);
                            this.m_cachedResultsTimer = Components.classes["@mozilla.org/timer;1"]
                                                                  .createInstance(Components.interfaces.nsITimer);
                            this.m_cachedResultsTimer.initWithCallback(callback, freq * 1000,
                                                                       Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);
                        }
                        if (!this.m_cachedResults) {
                            this.m_cachedResults = [];
                        }
                        let cacheEntry = {
                            stamp: (new Date()).getTime(),
                            itemFilter: itemFilter,
                            rangeStart: (rangeStart ? rangeStart.clone() : null),
                            rangeEnd: (rangeEnd ? rangeEnd.clone() : null),
                            results: items
                        };
                        this.m_cachedResults.unshift(cacheEntry);
                        if (this.m_cachedResults.length > CACHE_LAST_RESULTS) {
                            this.m_cachedResults.length = CACHE_LAST_RESULTS;
                        }
                    }

                    listener.onGetResult(this.superCalendar, NS_OK, calIItemBase, "getItems()", items.length, items);
                }
            },
            stringToIcal, "fetchcomponents_by_range", params, calIWcapCalendar.AC_COMP_READ);
    } catch (exc) {
        request.execRespFunc(exc);
    }
    return request;
};

calWcapCalendar.prototype.offlineStorage = null;

calWcapCalendar.prototype.resetLog = function() {
    this.deleteProperty("replay.last_stamp");
};

calWcapCalendar.prototype.replayChangesOn = function(listener) {
    let itemFilter = calICalendar.ITEM_FILTER_ALL_ITEMS;
    let dtFrom = getDatetimeFromIcalString(this.getProperty("replay.last_stamp"));
    let now = getTime(); // new stamp for this sync

    let request_ = new calWcapRequest(
        (request, err) => {
            if (err) {
                logError("error replaying changes: " + errorToString(err));
                this.notifyError(err);
            } else {
                log("replay succeeded.", this);
                this.setProperty("replay.last_stamp", getIcalUTC(now));
                log("new replay stamp: " + getIcalUTC(now), this);
            }
            if (listener) {
                listener.onResult(request, null);
            }
        },
        log("replayChangesOn():\n\titemFilter=0x" + itemFilter.toString(0x10) +
            "\n\tdtFrom=" + getIcalUTC(dtFrom), this));

    try {
        let writeListener = {
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
            onGetResult: function() {},
            onOperationComplete: function(aCalendar, status, opType, id, detail) {
                if (!Components.isSuccessCode(status)) {
                    request.execRespFunc(status); // any error on writing breaks whole operation
                }
            }
        };
        let request = new calWcapRequest(
            (err, data) => {
                let modifiedIds = {};
                for (let item of request.m_modifiedItems) {
                    let dtCreated = item.getProperty("CREATED");
                    let bAdd = !dtCreated || !dtFrom || dtCreated.compare(dtFrom) >= 0;
                    modifiedIds[item.id] = true;
                    if (bAdd) {
                        log("replayChangesOn(): new item " + item.id, this);
                        if (this.offlineStorage) {
                            this.offlineStorage.addItem(item, writeListener);
                        }
                    } else {
                        log("replayChangesOn(): modified item " + item.id, this);
                        if (this.offlineStorage) {
                            this.modifyItem(item, null, writeListener);
                        }
                    }
                }
                for (let item of request.m_deletedItems) {
                    // don't delete anything that has been touched by lastmods:
                    if (modifiedIds[item.id]) {
                        log("replayChangesOn(): skipping deletion of " + item.id, this);
                    } else if (isParent(item)) {
                        log("replayChangesOn(): deleted item " + item.id, this);
                        if (this.offlineStorage) {
                            this.offlineStorage.deleteItem(item, writeListener);
                        }
                    } else {
                        // modify parent instead of
                        // straight-forward deleteItem(). WTF.
                        let parent = item.parentItem.clone();
                        parent.recurrenceInfo.removeOccurrenceAt(item.recurrenceId);
                        log("replayChangesOn(): modified parent " + parent.id, this);
                        if (this.offlineStorage) {
                            this.offlineStorage.modifyItem(parent, item, writeListener);
                        }
                    }
                }
            }, "replayChangesOn() netFinishedRespFunc");
        request_.attachSubRequest(request);

        // assure being logged in to calc server times:
        this.session.getSessionId(
            request,
            (err, sessionId) => {
                try {
                    if (err) {
                        throw err;
                    }
                    let params = "&relativealarm=1&compressed=1&recurring=1" +
                                 "&emailorcalid=1&fmt-out=text%2Fcalendar";
                    if (dtFrom) {
                        dtFrom = this.session.getServerTime(dtFrom);
                    }
                    params += "&dtstart=" + getIcalUTC(dtFrom);
                    params += "&dtend=" + getIcalUTC(this.session.getServerTime(now));

                    log("replayChangesOn(): getting last modifications...", this);
                    this.issueNetworkRequest(
                        request,
                        (fetcherr, icalRootComp) => {
                            if (fetcherr) {
                                throw fetcherr;
                            }
                            request.m_modifiedItems = this.parseItems(icalRootComp,
                                                                      calICalendar.ITEM_FILTER_ALL_ITEMS,
                                                                      0, null, null);
                        },
                        stringToIcal, "fetchcomponents_by_lastmod",
                        params + getItemFilterParams(itemFilter),
                        calIWcapCalendar.AC_COMP_READ);

                    log("replayChangesOn(): getting deleted items...", this);
                    this.issueNetworkRequest(
                        request,
                        (fetcherr, icalRootComp) => {
                            if (fetcherr) {
                                throw fetcherr;
                            }
                            request.m_deletedItems = this.parseItems(icalRootComp,
                                                                     calICalendar.ITEM_FILTER_ALL_ITEMS,
                                                                     0, null, null);
                        },
                        stringToIcal, "fetch_deletedcomponents",
                        params + getItemFilterParams(itemFilter & // only component types
                                                     calICalendar.ITEM_FILTER_TYPE_ALL),
                        calIWcapCalendar.AC_COMP_READ);
                } catch (exc) {
                    request.execRespFunc(exc);
                }
            });
    } catch (exc) {
        request_.execRespFunc(exc);
    }
    return request_;
};
