/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

//
// constructor
//
function calTodo() {
    this.initItemBase();

    this.todoPromotedProps = {
        DTSTART: true,
        DTEND: true,
        DUE: true,
        COMPLETED: true,
        __proto__: this.itemBasePromotedProps
    };
}

var calTodoClassID = Components.ID("{7af51168-6abe-4a31-984d-6f8a3989212d}");
var calTodoInterfaces = [
    Components.interfaces.calIItemBase,
    Components.interfaces.calITodo,
    Components.interfaces.calIInternalShallowCopy
];
calTodo.prototype = {
    __proto__: calItemBase.prototype,

    classID: calTodoClassID,
    QueryInterface: XPCOMUtils.generateQI(calTodoInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calTodoClassID,
        contractID: "@mozilla.org/calendar/todo;1",
        classDescription: "Calendar Todo",
        interfaces: calTodoInterfaces,
    }),

    cloneShallow: function(aNewParent) {
        let cloned = new calTodo();
        this.cloneItemBaseInto(cloned, aNewParent);
        return cloned;
    },

    createProxy: function(aRecurrenceId) {
        cal.ASSERT(!this.mIsProxy, "Tried to create a proxy for an existing proxy!", true);

        let proxy = new calTodo();

        // override proxy's DTSTART/DUE/RECURRENCE-ID
        // before master is set (and item might get immutable):
        let duration = this.duration;
        if (duration) {
            let dueDate = aRecurrenceId.clone();
            dueDate.addDuration(duration);
            proxy.dueDate = dueDate;
        }
        proxy.entryDate = aRecurrenceId;

        proxy.initializeProxy(this, aRecurrenceId);
        proxy.mDirty = false;

        return proxy;
    },

    makeImmutable: function() {
        this.makeItemBaseImmutable();
    },

    get isCompleted() {
        return this.completedDate != null ||
               this.percentComplete == 100 ||
               this.status == "COMPLETED";
    },

    set isCompleted(completed) {
        if (completed) {
            if (!this.completedDate) {
                this.completedDate = cal.jsDateToDateTime(new Date());
            }
            this.status = "COMPLETED";
            this.percentComplete = 100;
        } else {
            this.deleteProperty("COMPLETED");
            this.deleteProperty("STATUS");
            this.deleteProperty("PERCENT-COMPLETE");
        }
    },

    get duration() {
        let dur = this.getProperty("DURATION");
        // pick up duration if available, otherwise calculate difference
        // between start and enddate
        if (dur) {
            return cal.createDuration(dur);
        } else {
            if (!this.entryDate || !this.dueDate) {
                return null;
            }
            return this.dueDate.subtractDate(this.entryDate);
        }
    },

    set duration(value) {
        this.setProperty("DURATION", value);
    },

    get recurrenceStartDate() {
        // DTSTART is optional for VTODOs, so it's unclear if RRULE is allowed then,
        // so fallback to DUE if no DTSTART is present:
        return this.entryDate || this.dueDate;
    },

    icsEventPropMap: [
    { cal: "DTSTART", ics: "startTime" },
    { cal: "DUE", ics: "dueTime" },
    { cal: "COMPLETED", ics: "completedTime" }],

    set icalString(value) {
        this.icalComponent = getIcsService().parseICS(value, null);
    },

    get icalString() {
        let calcomp = getIcsService().createIcalComponent("VCALENDAR");
        calSetProdidVersion(calcomp);
        calcomp.addSubcomponent(this.icalComponent);
        return calcomp.serializeToICS();
    },

    get icalComponent() {
        let icssvc = getIcsService();
        let icalcomp = icssvc.createIcalComponent("VTODO");
        this.fillIcalComponentFromBase(icalcomp);
        this.mapPropsToICS(icalcomp, this.icsEventPropMap);

        let bagenum = this.propertyEnumerator;
        while (bagenum.hasMoreElements()) {
            let iprop = bagenum.getNext()
                               .QueryInterface(Components.interfaces.nsIProperty);
            try {
                if (!this.todoPromotedProps[iprop.name]) {
                    let icalprop = icssvc.createIcalProperty(iprop.name);
                    icalprop.value = iprop.value;
                    let propBucket = this.mPropertyParams[iprop.name];
                    if (propBucket) {
                        for (let paramName in propBucket) {
                            try {
                                icalprop.setParameter(paramName, propBucket[paramName]);
                            } catch (e) {
                                if (e.result == Components.results.NS_ERROR_ILLEGAL_VALUE) {
                                    // Illegal values should be ignored, but we could log them if
                                    // the user has enabled logging.
                                    cal.LOG("Warning: Invalid todo parameter value " + paramName + "=" + propBucket[paramName]);
                                } else {
                                    throw e;
                                }
                            }
                        }
                    }
                    icalcomp.addProperty(icalprop);
                }
            } catch (e) {
                cal.ERROR("failed to set " + iprop.name + " to " + iprop.value + ": " + e + "\n");
            }
        }
        return icalcomp;
    },

    todoPromotedProps: null,

    set icalComponent(todo) {
        this.modify();
        if (todo.componentType != "VTODO") {
            todo = todo.getFirstSubcomponent("VTODO");
            if (!todo) {
                throw Components.results.NS_ERROR_INVALID_ARG;
            }
        }

        this.mDueDate = undefined;
        this.setItemBaseFromICS(todo);
        this.mapPropsFromICS(todo, this.icsEventPropMap);

        this.importUnpromotedProperties(todo, this.todoPromotedProps);
        // Importing didn't really change anything
        this.mDirty = false;
    },

    isPropertyPromoted: function(name) {
        // avoid strict undefined property warning
        return this.todoPromotedProps[name] || false;
    },

    set entryDate(value) {
        this.modify();

        // We're about to change the start date of an item which probably
        // could break the associated calIRecurrenceInfo. We're calling
        // the appropriate method here to adjust the internal structure in
        // order to free clients from worrying about such details.
        if (this.parentItem == this) {
            let rec = this.recurrenceInfo;
            if (rec) {
                rec.onStartDateChange(value, this.entryDate);
            }
        }

        return this.setProperty("DTSTART", value);
    },

    get entryDate() {
        return this.getProperty("DTSTART");
    },

    mDueDate: undefined,
    get dueDate() {
        let dueDate = this.mDueDate;
        if (dueDate === undefined) {
            dueDate = this.getProperty("DUE");
            if (!dueDate) {
                let entryDate = this.entryDate;
                let dur = this.getProperty("DURATION");
                if (entryDate && dur) {
                    // If there is a duration set on the todo, calculate the right end time.
                    dueDate = entryDate.clone();
                    dueDate.addDuration(cal.createDuration(dur));
                }
            }
            this.mDueDate = dueDate;
        }
        return dueDate;
    },

    set dueDate(value) {
        this.deleteProperty("DURATION"); // setting dueDate once removes DURATION
        this.setProperty("DUE", value);
        return (this.mDueDate = value);
    }
};

// var decl to prevent spurious error messages when loaded as component

var makeMemberAttr;
if (makeMemberAttr) {
    makeMemberAttr(calTodo, "COMPLETED", null, "completedDate", true);
    makeMemberAttr(calTodo, "PERCENT-COMPLETE", 0, "percentComplete", true);
}
