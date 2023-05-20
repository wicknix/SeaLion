/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

function peekAlarmWindow() {
    return Services.wm.getMostRecentWindow("Calendar:AlarmWindow");
}

/**
 * The alarm monitor takes care of playing the alarm sound and opening one copy
 * of the calendar-alarm-dialog. Both depend on their respective prefs to be
 * set. This monitor is only used for DISPLAY type alarms.
 */
function calAlarmMonitor() {
    this.wrappedJSObject = this;
    this.mAlarms = [];

    this.mSound = Components.classes["@mozilla.org/sound;1"]
                            .createInstance(Components.interfaces.nsISound);
}

var calAlarmMonitorClassID = Components.ID("{4b7ae030-ed79-11d9-8cd6-0800200c9a66}");
var calAlarmMonitorInterfaces = [
    Components.interfaces.nsIObserver,
    Components.interfaces.calIAlarmServiceObserver
];
calAlarmMonitor.prototype = {
    mAlarms: null,

    // This is a work-around for the fact that there is a delay between when
    // we call openWindow and when it appears via getMostRecentWindow.  If an
    // alarm is fired in that time-frame, it will actually end up in another window.
    mWindowOpening: null,

    // nsISound instance used for playing all sounds
    mSound: null,

    classID: calAlarmMonitorClassID,
    QueryInterface: XPCOMUtils.generateQI(calAlarmMonitorInterfaces),
    classInfo: XPCOMUtils.generateCI({
        contractID: "@mozilla.org/calendar/alarm-monitor;1",
        classDescription: "Calendar Alarm Monitor",
        classID: calAlarmMonitorClassID,
        interfaces: calAlarmMonitorInterfaces,
        flags: Components.interfaces.nsIClassInfo.SINGLETON
    }),

    /**
     * nsIObserver
     */
    observe: function(aSubject, aTopic, aData) {
        let alarmService = Components.classes["@mozilla.org/calendar/alarm-service;1"]
                                     .getService(Components.interfaces.calIAlarmService);
        switch (aTopic) {
            case "alarm-service-startup":
                alarmService.addObserver(this);
                break;
            case "alarm-service-shutdown":
                alarmService.removeObserver(this);
                break;
        }
    },

    /**
     * calIAlarmServiceObserver
     */
    onAlarm: function(aItem, aAlarm) {
        if (aAlarm.action != "DISPLAY") {
            // This monitor only looks for DISPLAY alarms.
            return;
        }

        this.mAlarms.push([aItem, aAlarm]);

        if (Preferences.get("calendar.alarms.playsound", true)) {
            // We want to make sure the user isn't flooded with alarms so we
            // limit this using a preference. For example, if the user has 20
            // events that fire an alarm in the same minute, then the alarm
            // sound will only play 5 times. All alarms will be shown in the
            // dialog nevertheless.
            let maxAlarmSoundCount = Preferences.get("calendar.alarms.maxsoundsperminute", 5);
            let now = new Date();

            if (!this.mLastAlarmSoundDate ||
                (now - this.mLastAlarmSoundDate >= 60000)) {
                // Last alarm was long enough ago, reset counters. Note
                // subtracting JSDate results in microseconds.
                this.mAlarmSoundCount = 0;
                this.mLastAlarmSoundDate = now;
            } else {
                // Otherwise increase the counter
                this.mAlarmSoundCount++;
            }

            if (maxAlarmSoundCount > this.mAlarmSoundCount) {
                // Only ring the alarm sound if we haven't hit the max count.
                try {
                    let soundURL = Preferences.get("calendar.alarms.soundURL", null);
                    if (soundURL && soundURL.length > 0) {
                        soundURL = makeURL(soundURL);
                        this.mSound.play(soundURL);
                    } else {
                        this.mSound.beep();
                    }
                } catch (exc) {
                    cal.ERROR("Error playing alarm sound: " + exc);
                }
            }
        }

        if (!Preferences.get("calendar.alarms.show", true)) {
            return;
        }

        let calAlarmWindow = peekAlarmWindow();
        if (!calAlarmWindow && (!this.mWindowOpening ||
                                 this.mWindowOpening.closed)) {
            this.mWindowOpening = Services.ww.openWindow(
                null,
                "chrome://calendar/content/calendar-alarm-dialog.xul",
                "_blank",
                "chrome,dialog=yes,all,resizable",
                this);
        }
        if (!this.mWindowOpening) {
            calAlarmWindow.addWidgetFor(aItem, aAlarm);
        }
    },

    window_onLoad: function() {
        let calAlarmWindow = this.mWindowOpening;
        this.mWindowOpening = null;
        if (this.mAlarms.length > 0) {
            for (let [item, alarm] of this.mAlarms) {
                calAlarmWindow.addWidgetFor(item, alarm);
            }
        } else {
            // Uh oh, it seems the alarms were removed even before the window
            // finished loading. Looks like we can close it again
            calAlarmWindow.closeIfEmpty();
        }
    },

    onRemoveAlarmsByItem: function(aItem) {
        let calAlarmWindow = peekAlarmWindow();
        this.mAlarms = this.mAlarms.filter(([thisItem, alarm]) => {
            let ret = (aItem.hashId != thisItem.hashId);
            if (!ret && calAlarmWindow) { // window is open
                calAlarmWindow.removeWidgetFor(thisItem, alarm);
            }
            return ret;
        });
    },

    onRemoveAlarmsByCalendar: function(calendar) {
        let calAlarmWindow = peekAlarmWindow();
        this.mAlarms = this.mAlarms.filter(([thisItem, alarm]) => {
            let ret = (calendar.id != thisItem.calendar.id);

            if (!ret && calAlarmWindow) { // window is open
                calAlarmWindow.removeWidgetFor(thisItem, alarm);
            }
            return ret;
        });
    },

    onAlarmsLoaded: function(aCalendar) {
        // the alarm dialog won't close while alarms are loading, check again now
        let calAlarmWindow = peekAlarmWindow();
        if (calAlarmWindow && this.mAlarms.length == 0) {
            calAlarmWindow.closeIfEmpty();
        }
    }
};
