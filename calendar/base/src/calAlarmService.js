/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://calendar/modules/calAlarmUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");
Components.utils.import("resource://gre/modules/Promise.jsm");
Components.utils.import("resource://gre/modules/PromiseUtils.jsm");

var kHoursBetweenUpdates = 6;

function nowUTC() {
    return cal.jsDateToDateTime(new Date()).getInTimezone(cal.UTC());
}

function newTimerWithCallback(aCallback, aDelay, aRepeating) {
    let timer = Components.classes["@mozilla.org/timer;1"]
                          .createInstance(Components.interfaces.nsITimer);

    timer.initWithCallback(aCallback,
                           aDelay,
                           (aRepeating ? timer.TYPE_REPEATING_PRECISE : timer.TYPE_ONE_SHOT));
    return timer;
}

function calAlarmService() {
    this.wrappedJSObject = this;

    this.mLoadedCalendars = {};
    this.mTimerMap = {};
    this.mObservers = new calListenerBag(Components.interfaces.calIAlarmServiceObserver);

    this.calendarObserver = {
        alarmService: this,

        QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIObserver]),

        // calIObserver:
        onStartBatch: function() { },
        onEndBatch: function() { },
        onLoad: function(calendar) {
            // ignore any onLoad events until initial getItems() call of startup has finished:
            if (calendar && this.alarmService.mLoadedCalendars[calendar.id]) {
                // a refreshed calendar signals that it has been reloaded
                // (and cannot notify detailed changes), thus reget all alarms of it:
                this.alarmService.initAlarms([calendar]);
            }
        },

        onAddItem: function(aItem) {
            this.alarmService.addAlarmsForOccurrences(aItem);
        },
        onModifyItem: function(aNewItem, aOldItem) {
            if (!aNewItem.recurrenceId) {
                // deleting an occurrence currently calls modifyItem(newParent, *oldOccurrence*)
                aOldItem = aOldItem.parentItem;
            }

            this.onDeleteItem(aOldItem);
            this.onAddItem(aNewItem);
        },
        onDeleteItem: function(aDeletedItem) {
            this.alarmService.removeAlarmsForOccurrences(aDeletedItem);
        },
        onError: function(aCalendar, aErrNo, aMessage) {},
        onPropertyChanged: function(aCalendar, aName, aValue, aOldValue) {
            switch (aName) {
                case "suppressAlarms":
                case "disabled":
                    this.alarmService.initAlarms([aCalendar]);
                    break;
            }
        },
        onPropertyDeleting: function(aCalendar, aName) {
            this.onPropertyChanged(aCalendar, aName);
        }
    };

    this.calendarManagerObserver = {
        alarmService: this,

        QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calICalendarManagerObserver]),

        onCalendarRegistered: function(aCalendar) {
            this.alarmService.observeCalendar(aCalendar);
            // initial refresh of alarms for new calendar:
            this.alarmService.initAlarms([aCalendar]);
        },
        onCalendarUnregistering: function(aCalendar) {
            // XXX todo: we need to think about calendar unregistration;
            // there may still be dangling items (-> alarm dialog),
            // dismissing those alarms may write data...
            this.alarmService.unobserveCalendar(aCalendar);
        },
        onCalendarDeleting: function(aCalendar) {}
    };
}

var calAlarmServiceClassID = Components.ID("{7a9200dd-6a64-4fff-a798-c5802186e2cc}");
var calAlarmServiceInterfaces = [
    Components.interfaces.calIAlarmService,
    Components.interfaces.nsIObserver
];
calAlarmService.prototype = {
    mRangeStart: null,
    mRangeEnd: null,
    mUpdateTimer: null,
    mStarted: false,
    mTimerMap: null,
    mObservers: null,
    mTimezone: null,

    classID: calAlarmServiceClassID,
    QueryInterface: XPCOMUtils.generateQI(calAlarmServiceInterfaces),
    classInfo: XPCOMUtils.generateCI({
        classID: calAlarmServiceClassID,
        contractID: "@mozilla.org/calendar/alarm-service;1",
        classDescription: "Calendar Alarm Service",
        interfaces: calAlarmServiceInterfaces,
        flags: Components.interfaces.nsIClassInfo.SINGLETON
    }),

    /**
     * nsIObserver
     */
    observe: function(aSubject, aTopic, aData) {
        // This will also be called on app-startup, but nothing is done yet, to
        // prevent unwanted dialogs etc. See bug 325476 and 413296
        if (aTopic == "profile-after-change" || aTopic == "wake_notification") {
            this.shutdown();
            this.startup();
        }
        if (aTopic == "xpcom-shutdown") {
            this.shutdown();
        }
    },

    /**
     * calIAlarmService APIs
     */
    get timezone() {
        // TODO Do we really need this? Do we ever set the timezone to something
        // different than the default timezone?
        return this.mTimezone || calendarDefaultTimezone();
    },

    set timezone(aTimezone) {
        return (this.mTimezone = aTimezone);
    },

    snoozeAlarm: function(aItem, aAlarm, aDuration) {
        // Right now we only support snoozing all alarms for the given item for
        // aDuration.

        // Make sure we're working with the parent, otherwise we'll accidentally
        // create an exception
        let newEvent = aItem.parentItem.clone();
        let alarmTime = nowUTC();

        // Set the last acknowledged time to now.
        newEvent.alarmLastAck = alarmTime;

        alarmTime = alarmTime.clone();
        alarmTime.addDuration(aDuration);

        if (aItem.parentItem == aItem) {
            newEvent.setProperty("X-MOZ-SNOOZE-TIME", alarmTime.icalString);
        } else {
            // This is the *really* hard case where we've snoozed a single
            // instance of a recurring event.  We need to not only know that
            // there was a snooze, but also which occurrence was snoozed.  Part
            // of me just wants to create a local db of snoozes here...
            newEvent.setProperty("X-MOZ-SNOOZE-TIME-" + aItem.recurrenceId.nativeTime,
                                 alarmTime.icalString);
        }
        // calling modifyItem will cause us to get the right callback
        // and update the alarm properly
        return newEvent.calendar.modifyItem(newEvent, aItem.parentItem, null);
    },

    dismissAlarm: function(aItem, aAlarm) {
        let now = nowUTC();
        // We want the parent item, otherwise we're going to accidentally create an
        // exception.  We've relnoted (for 0.1) the slightly odd behavior this can
        // cause if you move an event after dismissing an alarm
        let oldParent = aItem.parentItem;
        let newParent = oldParent.clone();
        newParent.alarmLastAck = now;
        // Make sure to clear out any snoozes that were here.
        if (aItem.recurrenceId) {
            newParent.deleteProperty("X-MOZ-SNOOZE-TIME-" + aItem.recurrenceId.nativeTime);
        } else {
            newParent.deleteProperty("X-MOZ-SNOOZE-TIME");
        }
        return newParent.calendar.modifyItem(newParent, oldParent, null);
    },

    addObserver: function(aObserver) {
        this.mObservers.add(aObserver);
    },

    removeObserver: function(aObserver) {
        this.mObservers.remove(aObserver);
    },

    startup: function() {
        if (this.mStarted) {
            return;
        }

        Services.obs.addObserver(this, "profile-after-change", false);
        Services.obs.addObserver(this, "xpcom-shutdown", false);
        Services.obs.addObserver(this, "wake_notification", false);

        /* Tell people that we're alive so they can start monitoring alarms.
         */
        let notifier = Components.classes["@mozilla.org/embedcomp/appstartup-notifier;1"]
                                 .getService(Components.interfaces.nsIObserver);
        notifier.observe(null, "alarm-service-startup", null);

        getCalendarManager().addObserver(this.calendarManagerObserver);

        for (let calendar of getCalendarManager().getCalendars({})) {
            this.observeCalendar(calendar);
        }

        /* set up a timer to update alarms every N hours */
        let timerCallback = {
            alarmService: this,
            notify: function() {
                let now = nowUTC();
                let start;
                if (this.alarmService.mRangeEnd) {
                    // This is a subsequent search, so we got all the past alarms before
                    start = this.alarmService.mRangeEnd.clone();
                } else {
                    // This is our first search for alarms.  We're going to look for
                    // alarms +/- 1 month from now.  If someone sets an alarm more than
                    // a month ahead of an event, or doesn't start Lightning
                    // for a month, they'll miss some, but that's a slim chance
                    start = now.clone();
                    start.month -= Components.interfaces.calIAlarmService.MAX_SNOOZE_MONTHS;
                    this.alarmService.mRangeStart = start.clone();
                }
                let until = now.clone();
                until.month += Components.interfaces.calIAlarmService.MAX_SNOOZE_MONTHS;

                // We don't set timers for every future alarm, only those within 6 hours
                let end = now.clone();
                end.hour += kHoursBetweenUpdates;
                this.alarmService.mRangeEnd = end.getInTimezone(UTC());

                this.alarmService.findAlarms(getCalendarManager().getCalendars({}),
                                             start, until);
            }
        };
        timerCallback.notify();

        this.mUpdateTimer = newTimerWithCallback(timerCallback, kHoursBetweenUpdates * 3600000, true);

        this.mStarted = true;
    },

    shutdown: function() {
        if (!this.mStarted) {
            return;
        }

        /* tell people that we're no longer running */
        let notifier = Components.classes["@mozilla.org/embedcomp/appstartup-notifier;1"]
                                 .getService(Components.interfaces.nsIObserver);
        notifier.observe(null, "alarm-service-shutdown", null);

        if (this.mUpdateTimer) {
            this.mUpdateTimer.cancel();
            this.mUpdateTimer = null;
        }

        let calmgr = cal.getCalendarManager();
        calmgr.removeObserver(this.calendarManagerObserver);

        // Stop observing all calendars. This will also clear the timers.
        for (let calendar of calmgr.getCalendars({})) {
            this.unobserveCalendar(calendar);
        }

        this.mRangeEnd = null;

        Services.obs.removeObserver(this, "profile-after-change");
        Services.obs.removeObserver(this, "xpcom-shutdown");
        Services.obs.removeObserver(this, "wake_notification");

        this.mStarted = false;
    },

    observeCalendar: function(calendar) {
        calendar.addObserver(this.calendarObserver);
    },

    unobserveCalendar: function(calendar) {
        calendar.removeObserver(this.calendarObserver);
        this.disposeCalendarTimers([calendar]);
        this.mObservers.notify("onRemoveAlarmsByCalendar", [calendar]);
    },

    addAlarmsForItem: function(aItem) {
        if (cal.isToDo(aItem) && aItem.isCompleted) {
            // If this is a task and it is completed, don't add the alarm.
            return;
        }

        let showMissed = Preferences.get("calendar.alarms.showmissed", true);

        let alarms = aItem.getAlarms({});
        for (let alarm of alarms) {
            let alarmDate = cal.alarms.calculateAlarmDate(aItem, alarm);

            if (!alarmDate || alarm.action != "DISPLAY") {
                // Only take care of DISPLAY alarms with an alarm date.
                continue;
            }

            // Handle all day events.  This is kinda weird, because they don't have
            // a well defined startTime.  We just consider the start/end to be
            // midnight in the user's timezone.
            if (alarmDate.isDate) {
                alarmDate = alarmDate.getInTimezone(this.timezone);
                alarmDate.isDate = false;
            }
            alarmDate = alarmDate.getInTimezone(UTC());

            // Check for snooze
            let snoozeDate;
            if (aItem.parentItem == aItem) {
                snoozeDate = aItem.getProperty("X-MOZ-SNOOZE-TIME");
            } else {
                snoozeDate = aItem.parentItem.getProperty("X-MOZ-SNOOZE-TIME-" + aItem.recurrenceId.nativeTime);
            }

            if (snoozeDate && !(snoozeDate instanceof Components.interfaces.calIDateTime)) {
                snoozeDate = cal.createDateTime(snoozeDate);
            }

            // an alarm can only be snoozed to a later time, if earlier it's from another alarm.
            if (snoozeDate && snoozeDate.compare(alarmDate) > 0) {
                // If the alarm was snoozed, the snooze time is more important.
                alarmDate = snoozeDate;
            }

            let now = nowUTC();
            if (alarmDate.timezone.isFloating) {
                now = cal.now();
                now.timezone = floating();
            }

            if (alarmDate.compare(now) >= 0) {
                // We assume that future alarms haven't been acknowledged
                // Delay is in msec, so don't forget to multiply
                let timeout = alarmDate.subtractDate(now).inSeconds * 1000;

                // No sense in keeping an extra timeout for an alarm thats past
                // our range.
                let timeUntilRefresh = this.mRangeEnd.subtractDate(now).inSeconds * 1000;
                if (timeUntilRefresh < timeout) {
                    continue;
                }

                this.addTimer(aItem, alarm, timeout);
            } else if (showMissed) {
                // This alarm is in the past.  See if it has been previously ack'd.
                let lastAck = aItem.parentItem.alarmLastAck;
                if (lastAck && lastAck.compare(alarmDate) >= 0) {
                    // The alarm was previously dismissed or snoozed, no further
                    // action required.
                    continue;
                } else {
                    // The alarm was not snoozed or dismissed, fire it now.
                    this.alarmFired(aItem, alarm);
                }
            }
        }
    },

    removeAlarmsForItem: function(aItem) {
        // make sure already fired alarms are purged out of the alarm window:
        this.mObservers.notify("onRemoveAlarmsByItem", [aItem]);
        // Purge alarms specifically for this item (i.e exception)
        for (let alarm of aItem.getAlarms({})) {
            this.removeTimer(aItem, alarm);
        }
    },

    getOccurrencesInRange: function(aItem) {
        // We search 1 month in each direction for alarms.  Therefore,
        // we need occurrences between initial start date and 1 month from now
        let until = nowUTC();
        until.month += 1;

        if (aItem && aItem.recurrenceInfo) {
            return aItem.recurrenceInfo.getOccurrences(this.mRangeStart, until, 0, {});
        } else {
            return cal.checkIfInRange(aItem, this.mRangeStart, until) ? [aItem] : [];
        }
    },

    addAlarmsForOccurrences: function(aParentItem) {
        let occs = this.getOccurrencesInRange(aParentItem);

        // Add an alarm for each occurrence
        occs.forEach(this.addAlarmsForItem, this);
    },

    removeAlarmsForOccurrences: function(aParentItem) {
        let occs = this.getOccurrencesInRange(aParentItem);

        // Remove alarm for each occurrence
        occs.forEach(this.removeAlarmsForItem, this);
    },

    addTimer: function(aItem, aAlarm, aTimeout) {
        this.mTimerMap[aItem.calendar.id] =
            this.mTimerMap[aItem.calendar.id] || {};
        this.mTimerMap[aItem.calendar.id][aItem.hashId] =
            this.mTimerMap[aItem.calendar.id][aItem.hashId] || {};

        let self = this;
        let alarmTimerCallback = {
            notify: function() {
                self.alarmFired(aItem, aAlarm);
            }
        };

        let timer = newTimerWithCallback(alarmTimerCallback, aTimeout, false);
        this.mTimerMap[aItem.calendar.id][aItem.hashId][aAlarm.icalString] = timer;
    },

    removeTimer: function(aItem, aAlarm) {
        /* Is the calendar in the timer map */
        if (aItem.calendar.id in this.mTimerMap &&
            /* ...and is the item in the calendar map */
            aItem.hashId in this.mTimerMap[aItem.calendar.id] &&
            /* ...and is the alarm in the item map ? */
            aAlarm.icalString in this.mTimerMap[aItem.calendar.id][aItem.hashId]) {
            // First cancel the existing timer
            let timer = this.mTimerMap[aItem.calendar.id][aItem.hashId][aAlarm.icalString];
            timer.cancel();

            // Remove the alarm from the item map
            delete this.mTimerMap[aItem.calendar.id][aItem.hashId][aAlarm.icalString];

            // If the item map is empty, remove it from the calendar map
            if (this.mTimerMap[aItem.calendar.id][aItem.hashId].toSource() == "({})") {
                delete this.mTimerMap[aItem.calendar.id][aItem.hashId];
            }

            // If the calendar map is empty, remove it from the timer map
            if (this.mTimerMap[aItem.calendar.id].toSource() == "({})") {
                delete this.mTimerMap[aItem.calendar.id];
            }
        }
    },

    disposeCalendarTimers: function(aCalendars) {
        for (let calendar of aCalendars) {
            if (calendar.id in this.mTimerMap) {
                for (let hashId in this.mTimerMap[calendar.id]) {
                    let itemTimerMap = this.mTimerMap[calendar.id][hashId];
                    for (let icalString in itemTimerMap) {
                        let timer = itemTimerMap[icalString];
                        timer.cancel();
                    }
                }
                delete this.mTimerMap[calendar.id];
            }
        }
    },

    findAlarms: function(aCalendars, aStart, aUntil) {
        let getListener = {
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.calIOperationListener]),
            alarmService: this,
            addRemovePromise: PromiseUtils.defer(),
            batchCount: 0,
            results: false,
            onOperationComplete: function(aCalendar, aStatus, aOperationType, aId, aDetail) {
                this.addRemovePromise.promise.then((aValue) => {
                    // calendar has been loaded, so until now, onLoad events can be ignored:
                    this.alarmService.mLoadedCalendars[aCalendar.id] = true;

                    // notify observers that the alarms for the calendar have been loaded
                    this.alarmService.mObservers.notify("onAlarmsLoaded", [aCalendar]);
                }, (aReason) => {
                    Components.utils.reportError("Promise was rejected: " + aReason);
                    this.alarmService.mLoadedCalendars[aCalendar.id] = true;
                    this.alarmService.mObservers.notify("onAlarmsLoaded", [aCalendar]);
                });

                // if no results were returned we still need to resolve the promise
                if (!this.results) {
                    this.addRemovePromise.resolve();
                }
            },
            onGetResult: function(aCalendar, aStatus, aItemType, aDetail, aCount, aItems) {
                let promise = this.addRemovePromise;
                this.batchCount++;
                this.results = true;

                cal.forEach(aItems, (item) => {
                    try {
                        this.alarmService.removeAlarmsForItem(item);
                        this.alarmService.addAlarmsForItem(item);
                    } catch (ex) {
                        promise.reject(ex);
                    }
                }, () => {
                    if (--this.batchCount <= 0) {
                        promise.resolve();
                    }
                });
            }
        };

        const calICalendar = Components.interfaces.calICalendar;
        let filter = calICalendar.ITEM_FILTER_COMPLETED_ALL |
                     calICalendar.ITEM_FILTER_CLASS_OCCURRENCES |
                     calICalendar.ITEM_FILTER_TYPE_ALL;

        for (let calendar of aCalendars) {
            // assuming that suppressAlarms does not change anymore until refresh:
            if (!calendar.getProperty("suppressAlarms") &&
                !calendar.getProperty("disabled")) {
                this.mLoadedCalendars[calendar.id] = false;
                calendar.getItems(filter, 0, aStart, aUntil, getListener);
            } else {
                this.mLoadedCalendars[calendar.id] = true;
                this.mObservers.notify("onAlarmsLoaded", [calendar]);
            }
        }
    },

    initAlarms: function(aCalendars) {
        // Purge out all alarm timers belonging to the refreshed/loaded calendars
        this.disposeCalendarTimers(aCalendars);

        // Purge out all alarms from dialog belonging to the refreshed/loaded calendars
        for (let calendar of aCalendars) {
            this.mLoadedCalendars[calendar.id] = false;
            this.mObservers.notify("onRemoveAlarmsByCalendar", [calendar]);
        }

        // Total refresh similar to startup.  We're going to look for
        // alarms +/- 1 month from now.  If someone sets an alarm more than
        // a month ahead of an event, or doesn't start Lightning
        // for a month, they'll miss some, but that's a slim chance
        let start = nowUTC();
        let until = start.clone();
        start.month -= Components.interfaces.calIAlarmService.MAX_SNOOZE_MONTHS;
        until.month += Components.interfaces.calIAlarmService.MAX_SNOOZE_MONTHS;
        this.findAlarms(aCalendars, start, until);
    },

    alarmFired: function(aItem, aAlarm) {
        if (!aItem.calendar.getProperty("suppressAlarms") &&
            !aItem.calendar.getProperty("disabled") &&
            aItem.getProperty("STATUS") != "CANCELLED") {
            this.mObservers.notify("onAlarm", [aItem, aAlarm]);
        }
    },

    get isLoading() {
        for (let calId in this.mLoadedCalendars) {
            if (!this.mLoadedCalendars[calId]) {
                return true;
            }
        }
        return false;
    }
};
