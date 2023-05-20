/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* This file contains commonly used functions in a centralized place so that
 * various components (and other js scopes) don't need to replicate them. Note
 * that loading this file twice in the same scope will throw errors.
 */


/* exported createEvent, createTodo, createDateTime, createDuration, createAttendee,
 *          createAttachment, createAlarm, createRelation,
 *          createRecurrenceDate, createRecurrenceRule, createRecurrenceInfo,
 *          getCalendarManager, getIcsService, getCalendarSearchService,
 *          getFreeBusyService, getWeekInfoService, getDateFormatter, UTC,
 *          floating, saveRecentTimezone, getCalendarDirectory,
 *          isCalendarWritable, userCanAddItemsToCalendar,
 *          userCanDeleteItemsFromCalendar, attendeeMatchesAddresses,
 *          userCanRespondToInvitation, openCalendarWizard,
 *          openCalendarProperties, calPrint, makeURL, calRadioGroupSelectItem,
 *          isItemSupported, calInstanceOf, getPrefSafe, setPref,
 *          setLocalizedPref, getLocalizedPref, getPrefCategoriesArray,
 *          setPrefCategoriesFromArray, compareItems, calTryWrappedJSObject,
 *          compareArrays, doQueryInterface, setDefaultStartEndHour, LOG, WARN,
 *          ERROR, showError, getContrastingTextColor, calGetEndDateProp,
 *          checkIfInRange, getProgressAtom, sendMailTo, sameDay,
 *          calSetProdidVersion, applyAttributeToMenuChildren,
 *          isPropertyValueSame, getParentNodeOrThis,
 *          getParentNodeOrThisByAttribute, setItemProperty,
 *          calIterateEmailIdentities, compareItemContent, binaryInsert,
 *          getCompositeCalendar, findItemWindow
 */

Components.utils.import("resource:///modules/mailServices.js");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");
Components.utils.import("resource://gre/modules/AppConstants.jsm");

function _calIcalCreator(cid, iid) {
    return function(icalString) {
        let thing = Components.classes[cid].createInstance(iid);
        if (icalString) {
            thing.icalString = icalString;
        }
        return thing;
    };
}

var createEvent = _calIcalCreator("@mozilla.org/calendar/event;1",
                                  Components.interfaces.calIEvent);
var createTodo = _calIcalCreator("@mozilla.org/calendar/todo;1",
                                 Components.interfaces.calITodo);
var createDateTime = _calIcalCreator("@mozilla.org/calendar/datetime;1",
                                     Components.interfaces.calIDateTime);
var createDuration = _calIcalCreator("@mozilla.org/calendar/duration;1",
                                     Components.interfaces.calIDuration);
var createAttendee = _calIcalCreator("@mozilla.org/calendar/attendee;1",
                                     Components.interfaces.calIAttendee);
var createAttachment = _calIcalCreator("@mozilla.org/calendar/attachment;1",
                                       Components.interfaces.calIAttachment);
var createAlarm = _calIcalCreator("@mozilla.org/calendar/alarm;1",
                                  Components.interfaces.calIAlarm);
var createRelation = _calIcalCreator("@mozilla.org/calendar/relation;1",
                                     Components.interfaces.calIRelation);
var createRecurrenceDate = _calIcalCreator("@mozilla.org/calendar/recurrence-date;1",
                                           Components.interfaces.calIRecurrenceDate);
var createRecurrenceRule = _calIcalCreator("@mozilla.org/calendar/recurrence-rule;1",
                                           Components.interfaces.calIRecurrenceRule);

/* Returns a clean new calIRecurrenceInfo */
function createRecurrenceInfo(aItem) {
    let recInfo = Components.classes["@mozilla.org/calendar/recurrence-info;1"]
                            .createInstance(Components.interfaces.calIRecurrenceInfo);
    recInfo.item = aItem;
    return recInfo;
}

/* Shortcut to the calendar-manager service */
function getCalendarManager() {
    return Components.classes["@mozilla.org/calendar/manager;1"]
                     .getService(Components.interfaces.calICalendarManager);
}

/* Shortcut to the ICS service */
function getIcsService() {
    return Components.classes["@mozilla.org/calendar/ics-service;1"]
                     .getService(Components.interfaces.calIICSService);
}

/* Shortcut to the timezone service */
function getTimezoneService() {
    return Components.classes["@mozilla.org/calendar/timezone-service;1"]
                     .getService(Components.interfaces.calITimezoneService);
}

/* Shortcut to calendar search service */
function getCalendarSearchService() {
    return Components.classes["@mozilla.org/calendar/calendarsearch-service;1"]
                     .getService(Components.interfaces.calICalendarSearchProvider);
}

/* Shortcut to the freebusy service */
function getFreeBusyService() {
    return Components.classes["@mozilla.org/calendar/freebusy-service;1"]
                     .getService(Components.interfaces.calIFreeBusyService);
}

/* Shortcut to week info service */
function getWeekInfoService() {
    return Components.classes["@mozilla.org/calendar/weekinfo-service;1"]
                     .getService(Components.interfaces.calIWeekInfoService);
}

/* Shortcut to date formatter service */
function getDateFormatter() {
    return Components.classes["@mozilla.org/calendar/datetime-formatter;1"]
                     .getService(Components.interfaces.calIDateTimeFormatter);
}

// @return the UTC timezone.
function UTC() {
    if (UTC.mObject === undefined) {
        UTC.mObject = getTimezoneService().UTC;
    }
    return UTC.mObject;
}

// @return the floating timezone.
function floating() {
    if (floating.mObject === undefined) {
        floating.mObject = getTimezoneService().floating;
    }
    return floating.mObject;
}

/**
 * Function to get the best guess at a user's default timezone.
 *
 * @return user's default timezone.
 */
function calendarDefaultTimezone() {
    return getTimezoneService().defaultTimezone;
}

/**
 * Makes sure the given timezone id is part of the list of recent timezones.
 *
 * @param aTzid     The timezone id to add
 */
function saveRecentTimezone(aTzid) {
    let recentTimezones = getRecentTimezones();
    const MAX_RECENT_TIMEZONES = 5; // We don't need a pref for *everything*.

    if (aTzid != calendarDefaultTimezone().tzid &&
        !recentTimezones.includes(aTzid)) {
        // Add the timezone if its not already the default timezone
        recentTimezones.unshift(aTzid);
        recentTimezones.splice(MAX_RECENT_TIMEZONES);
        Preferences.set("calendar.timezone.recent", JSON.stringify(recentTimezones));
    }
}

/**
 * Gets the list of recent timezones. Optionally retuns the list as
 * calITimezones.
 *
 * @param aConvertZones     (optional) If true, return calITimezones instead
 * @return                  An array of timezone ids or calITimezones.
 */
function getRecentTimezones(aConvertZones) {
    let recentTimezones = JSON.parse(Preferences.get("calendar.timezone.recent", "[]") || "[]");
    if (!Array.isArray(recentTimezones)) {
        recentTimezones = [];
    }

    let tzService = cal.getTimezoneService();
    if (aConvertZones) {
        let oldZonesLength = recentTimezones.length;
        for (let i = 0; i < recentTimezones.length; i++) {
            let timezone = tzService.getTimezone(recentTimezones[i]);
            if (timezone) {
                // Replace id with found timezone
                recentTimezones[i] = timezone;
            } else {
                // Looks like the timezone doesn't longer exist, remove it
                recentTimezones.splice(i, 1);
                i--;
            }
        }

        if (oldZonesLength != recentTimezones.length) {
            // Looks like the one or other timezone dropped out. Go ahead and
            // modify the pref.
            Preferences.set("calendar.timezone.recent", JSON.stringify(recentTimezones));
        }
    }
    return recentTimezones;
}

/**
 * Format the given string to work inside a CSS rule selector
 * (and as part of a non-unicode preference key).
 *
 * Replaces each space ' ' char with '_'.
 * Replaces each char other than ascii digits and letters, with '-uxHHH-'
 * where HHH is unicode in hexadecimal (variable length, terminated by the '-').
 *
 * Ensures: result only contains ascii digits, letters,'-', and '_'.
 * Ensures: result is invertible, so (f(a) = f(b)) implies (a = b).
 *   also means f is not idempotent, so (a != f(a)) implies (f(a) != f(f(a))).
 * Ensures: result must be lowercase.
 * Rationale: preference keys require 8bit chars, and ascii chars are legible
 *              in most fonts (in case user edits PROFILE/prefs.js).
 *            CSS class names in Gecko 1.8 seem to require lowercase,
 *              no punctuation, and of course no spaces.
 *   nmchar            [_a-zA-Z0-9-]|{nonascii}|{escape}
 *   name              {nmchar}+
 *   http://www.w3.org/TR/CSS21/grammar.html#scanner
 *
 * @param aString       The unicode string to format
 * @return              The formatted string using only chars [_a-zA-Z0-9-]
 */
function formatStringForCSSRule(aString) {
    function toReplacement(char) {
        // char code is natural number (positive integer)
        let nat = char.charCodeAt(0);
        switch (nat) {
            case 0x20: // space
                return "_";
            default:
                return "-ux" + nat.toString(16) + "-"; // lowercase
        }
    }
    // Result must be lowercase or style rule will not work.
    return aString.toLowerCase().replace(/[^a-zA-Z0-9]/g, toReplacement);
}

/**
 * Shared dialog functions
 * Gets the calendar directory, defaults to <profile-dir>/calendar
 */
function getCalendarDirectory() {
    if (getCalendarDirectory.mDir === undefined) {
        let dir = Services.dirsvc.get("ProfD", Components.interfaces.nsILocalFile);
        dir.append("calendar-data");
        if (!dir.exists()) {
            try {
                dir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE,
                           parseInt("0700", 8));
            } catch (exc) {
                ASSERT(false, exc);
                throw exc;
            }
        }
        getCalendarDirectory.mDir = dir;
    }
    return getCalendarDirectory.mDir.clone();
}

/**
 * Check if the specified calendar is writable. This is the case when it is not
 * marked readOnly, we are not offline, or we are offline and the calendar is
 * local.
 *
 * @param aCalendar     The calendar to check
 * @return              True if the calendar is writable
 */
function isCalendarWritable(aCalendar) {
    return !aCalendar.getProperty("disabled") &&
            !aCalendar.readOnly &&
            (!Services.io.offline ||
             aCalendar.getProperty("cache.enabled") ||
             aCalendar.getProperty("cache.always") ||
             aCalendar.getProperty("requiresNetwork") === false);
}

/**
 * Check if the specified calendar is writable from an ACL point of view.
 *
 * @param aCalendar     The calendar to check
 * @return              True if the calendar is writable
 */
function userCanAddItemsToCalendar(aCalendar) {
    let aclEntry = aCalendar.aclEntry;
    return !aclEntry || !aclEntry.hasAccessControl || aclEntry.userIsOwner || aclEntry.userCanAddItems;
}

/**
 * Check if the user can delete items from the specified calendar, from an ACL point of view.
 *
 * @param aCalendar     The calendar to check
 * @return              True if the calendar is writable
 */
function userCanDeleteItemsFromCalendar(aCalendar) {
    let aclEntry = aCalendar.aclEntry;
    return !aclEntry || !aclEntry.hasAccessControl || aclEntry.userIsOwner || aclEntry.userCanDeleteItems;
}

/**
 * Check if the user can fully modify the specified item, from an ACL point of view.
 * Note to be confused with the right to respond to an invitation, which is
 * handled instead by userCanRespondToInvitation.
 *
 * @param aItem         The calendar item to check
 * @return              True if the item is modifiable
 */
function userCanModifyItem(aItem) {
    let aclEntry = aItem.aclEntry;
    return !aclEntry || !aclEntry.calendarEntry.hasAccessControl || aclEntry.calendarEntry.userIsOwner || aclEntry.userCanModify;
}

/**
 * Check if the attendee object matches one of the addresses in the list. This
 * is useful to determine whether the current user acts as a delegate.
 *
 * @param aAttendee     The reference attendee object
 * @param addresses     The list of addresses
 * @return              True if there is a match
 */
function attendeeMatchesAddresses(anAttendee, addresses) {
    let attId = anAttendee.id;
    if (!attId.match(/^mailto:/i)) {
        // Looks like its not a normal attendee, possibly urn:uuid:...
        // Try getting the email through the EMAIL property.
        let emailProp = anAttendee.getProperty("EMAIL");
        if (emailProp) {
            attId = emailProp;
        }
    }

    attId = attId.toLowerCase().replace(/^mailto:/, "");
    for (let address of addresses) {
        if (attId == address.toLowerCase().replace(/^mailto:/, "")) {
            return true;
        }
    }

    return false;
}

/**
 * Check if the user can fully modify the specified item, from an ACL point of view.
 * Note to be confused with the right to respond to an invitation, which is
 * handled instead by userCanRespondToInvitation.
 *
 * @param aItem         The calendar item to check
 * @return              True if the item is modifiable
 */
function userCanRespondToInvitation(aItem) {
    let aclEntry = aItem.aclEntry;
    return userCanModifyItem(aItem) || aclEntry.userCanRespond;
}

/**
 * Opens the Create Calendar wizard
 *
 * @param aCallback  a function to be performed after calendar creation
 */
function openCalendarWizard(aCallback) {
    openDialog("chrome://calendar/content/calendarCreation.xul", "caEditServer",
               // Workaround for Bug 1151440 - the HTML color picker won't work
               // in linux when opened from modal dialog
               AppConstants.platform == "linux"
                   ? "chrome,titlebar,resizable"
                   : "modal,chrome,titlebar,resizable",
               aCallback);
}

/**
 * Opens the calendar properties window for aCalendar
 *
 * @param aCalendar  the calendar whose properties should be displayed
 */
function openCalendarProperties(aCalendar) {
    openDialog("chrome://calendar/content/calendar-properties-dialog.xul",
               "CalendarPropertiesDialog",
               // Workaround for Bug 1151440 - the HTML color picker won't work
               // in linux when opened from modal dialog
               AppConstants.platform == "linux"
                   ? "chrome,titlebar,resizable"
                   : "modal,chrome,titlebar,resizable",
               { calendar: aCalendar });
}

/**
 * Opens the print dialog
 */
function calPrint() {
    openDialog("chrome://calendar/content/calendar-print-dialog.xul", "Print",
               "centerscreen,chrome,resizable");
}

/**
 * Other functions
 */

/**
 * Takes a string and returns an nsIURI
 *
 * @param aUriString  the string of the address to for the spec of the nsIURI
 *
 * @returns  an nsIURI whose spec is aUriString
 */
function makeURL(aUriString) {
    return Services.io.newURI(aUriString, null, null);
}

/**
 * Returns a calIDateTime that corresponds to the current time in the user's
 * default timezone.
 */
function now() {
    let date = cal.jsDateToDateTime(new Date());
    return date.getInTimezone(calendarDefaultTimezone());
}

/**
 * Selects an item with id aItemId in the radio group with id aRadioGroupId
 *
 * @param aRadioGroupId  the id of the radio group which contains the item
 * @param aItemId        the item to be selected
 */
function calRadioGroupSelectItem(aRadioGroupId, aItemId) {
    let radioGroup = document.getElementById(aRadioGroupId);
    let items = radioGroup.getElementsByTagName("radio");
    let index;
    for (let i in items) {
        if (items[i].getAttribute("id") == aItemId) {
            index = i;
            break;
        }
    }
    ASSERT(index && index != 0, "Can't find radioGroup item to select.", true);
    radioGroup.selectedIndex = index;
}


/** checks if an item is supported by a Calendar
* @param aCalendar the calendar
* @param aItem the item either a task or an event
* @return true or false
*/
function isItemSupported(aItem, aCalendar) {
    if (isToDo(aItem)) {
        return (aCalendar.getProperty("capabilities.tasks.supported") !== false);
    } else if (isEvent(aItem)) {
        return (aCalendar.getProperty("capabilities.events.supported") !== false);
    }
    return false;
}

/**
 * @deprecated This function has been replaced by cal.wrapInstance()
 */
function calInstanceOf(aObject, aInterface) {
    if (!calInstanceOf.warningIssued) {
        cal.WARN("Use of calInstanceOf() is deprecated and will be removed " +
                 "with the next release. Use cal.wrapInstance() instead.\n" +
                 cal.STACK(10));
        calInstanceOf.warningIssued = true;
    }
    return (cal.wrapInstance(aObject, aInterface) != null);
}

/**
 * Determines whether or not the aObject is a calIEvent
 *
 * @param aObject  the object to test
 * @returns        true if the object is a calIEvent, false otherwise
 */
function isEvent(aObject) {
    return (cal.wrapInstance(aObject, Components.interfaces.calIEvent) != null);
}

/**
 * Determines whether or not the aObject is a calITodo
 *
 * @param aObject  the object to test
 * @returns        true if the object is a calITodo, false otherwise
 */
function isToDo(aObject) {
    return (cal.wrapInstance(aObject, Components.interfaces.calITodo) != null);
}

/**
 * Normal get*Pref calls will throw if the pref is undefined.  This function
 * will get a bool, int, or string pref.  If the pref is undefined, it will
 * return aDefault.
 *
 * @param aPrefName   the (full) name of preference to get
 * @param aDefault    (optional) the value to return if the pref is undefined
 */
function getPrefSafe(aPrefName, aDefault) {
    if (!getPrefSafe.warningIssued) {
        cal.WARN("Use of getPrefSafe() is deprecated and will be removed " +
                 "with the next release. Use Preferences.get() instead.\n" +
                 cal.STACK(10));
        getPrefSafe.warningIssued = true;
    }

    return Preferences.get(aPrefName, aDefault);
}

/**
 * Wrapper for setting prefs of various types.
 *
 * @param aPrefName   the (full) name of preference to set
 * @param aPrefValue  the value to set the pref to
 * @param aPrefType   (optional) the type of preference to set.
 *                    Valid values are: BOOL, INT, and CHAR
 */
function setPref(aPrefName, aPrefValue, aPrefType) {
    if (!setPref.warningIssued) {
        cal.WARN("Use of setPref() is deprecated and will be removed " +
                 "with the next release. Use Preferences.set() instead.\n" +
                 cal.STACK(10));
        setPref.warningIssued = true;
    }

    let prefValue = aPrefValue;

    if (aPrefType == "BOOL") {
        prefValue = Boolean(prefValue);
    } else if (aPrefType == "INT") {
        prefValue = Number(prefValue);
    } else if (aPrefType == "CHAR") {
        prefValue = String(prefValue);
    }

    return Preferences.set(aPrefName, prefValue);
}

/**
 * Helper function to set a localized (complex) pref from a given string
 *
 * @param aPrefName   the (full) name of preference to set
 * @param aString     the string to which the preference value should be set
 */
function setLocalizedPref(aPrefName, aString) {
    if (!setLocalizedPref.warningIssued) {
        cal.WARN("Use of setLocalizedPref() is deprecated and will be removed " +
                 "with the next release. Use Preferences.set() instead.\n" +
                 cal.STACK(10));
        setLocalizedPref.warningIssued = true;
    }

    return Preferences.set(aPrefName, aString);
}

/**
 * Like getPrefSafe, except for complex prefs (those used for localized data).
 *
 * @param aPrefName   the (full) name of preference to get
 * @param aDefault    (optional) the value to return if the pref is undefined
 */
function getLocalizedPref(aPrefName, aDefault) {
    if (!getLocalizedPref.warningIssued) {
        cal.WARN("Use of getLocalizedPref() is deprecated and will be removed " +
                 "with the next release. Use Preferences.get() instead.\n" +
                 cal.STACK(10));
        getLocalizedPref.warningIssued = true;
    }

    return Preferences.get(aPrefName, aDefault);
}

/**
 * Get array of category names from preferences or locale default,
 * unescaping any commas in each category name.
 * @return array of category names
 */
function getPrefCategoriesArray() {
    let categories = Preferences.get("calendar.categories.names", null);

    // If no categories are configured load a default set from properties file
    if (!categories) {
        categories = setupDefaultCategories();
    }
    return categoriesStringToArray(categories);
}

/**
 * Sets up the default categories from the localized string
 *
 * @return      The default set of categories as a comma separated string.
 */
function setupDefaultCategories() {
    // First, set up the category names
    let categories = calGetString("categories", "categories2");
    Preferences.set("calendar.categories.names", categories);

    // Now, initialize the category default colors
    let categoryArray = categoriesStringToArray(categories);
    for (let category of categoryArray) {
        let prefName = formatStringForCSSRule(category);
        Preferences.set("calendar.category.color." + prefName,
                        hashColor(category));
    }

    // Return the list of categories for further processing
    return categories;
}

/**
 * Hash the given string into a color from the color palette of the standard
 * color picker.
 *
 * @param str           The string to hash into a color.
 * @return              The hashed color.
 */
function hashColor(str) {
    // This is the palette of colors in the current colorpicker implementation.
    // Unfortunately, there is no easy way to extract these colors from the
    // binding directly.
    const colorPalette = ["#FFFFFF", "#FFCCCC", "#FFCC99", "#FFFF99", "#FFFFCC",
                          "#99FF99", "#99FFFF", "#CCFFFF", "#CCCCFF", "#FFCCFF",
                          "#CCCCCC", "#FF6666", "#FF9966", "#FFFF66", "#FFFF33",
                          "#66FF99", "#33FFFF", "#66FFFF", "#9999FF", "#FF99FF",
                          "#C0C0C0", "#FF0000", "#FF9900", "#FFCC66", "#FFFF00",
                          "#33FF33", "#66CCCC", "#33CCFF", "#6666CC", "#CC66CC",
                          "#999999", "#CC0000", "#FF6600", "#FFCC33", "#FFCC00",
                          "#33CC00", "#00CCCC", "#3366FF", "#6633FF", "#CC33CC",
                          "#666666", "#990000", "#CC6600", "#CC9933", "#999900",
                          "#009900", "#339999", "#3333FF", "#6600CC", "#993399",
                          "#333333", "#660000", "#993300", "#996633", "#666600",
                          "#006600", "#336666", "#000099", "#333399", "#663366",
                          "#000000", "#330000", "#663300", "#663333", "#333300",
                          "#003300", "#003333", "#000066", "#330099", "#330033"];

    let sum = Array.map(str || " ", e => e.charCodeAt(0)).reduce((a, b) => a + b);
    return colorPalette[sum % colorPalette.length];
}

/**
 * Convert categories string to list of category names.
 *
 * Stored categories may include escaped commas within a name.
 * Split categories string at commas, but not at escaped commas (\,).
 * Afterward, replace escaped commas (\,) with commas (,) in each name.
 * @param aCategoriesPrefValue string from "calendar.categories.names" pref,
 * which may contain escaped commas (\,) in names.
 * @return list of category names
 */
function categoriesStringToArray(aCategories) {
    if (!aCategories) {
        return [];
    }
    // \u001A is the unicode "SUBSTITUTE" character
    function revertCommas(name) { return name.replace(/\u001A/g, ","); }
    let categories = aCategories.replace(/\\,/g, "\u001A").split(",").map(revertCommas);
    if (categories.length == 1 && categories[0] == "") {
        // Split will return an array with an empty element when splitting an
        // empty string, correct this.
        categories.pop();
    }
    return categories;
}

/**
 * Set categories preference, escaping any commas in category names.
 * @param aCategoriesArray array of category names,
 * may contain unescaped commas which will be escaped in combined pref.
 */
function setPrefCategoriesFromArray(aCategoriesArray) {
    Preferences.set("calendar.categories.names",
                     categoriesArrayToString(aCategoriesList));
}

/**
 * Convert array of category names to string.
 *
 * Category names may contain commas (,).  Escape commas (\,) in each,
 * then join them in comma separated string for storage.
 * @param aSortedCategoriesArray sorted array of category names,
 * may contain unescaped commas, which will be escaped in combined string.
 */
function categoriesArrayToString(aSortedCategoriesArray) {
    function escapeComma(category) { return category.replace(/,/g, "\\,"); }
    return aSortedCategoriesArray.map(escapeComma).join(",");
}

/**
 * Gets the value of a string in a .properties file from the calendar bundle
 *
 * @param aBundleName  the name of the properties file.  It is assumed that the
 *                     file lives in chrome://calendar/locale/
 * @param aStringName  the name of the string within the properties file
 * @param aParams      optional array of parameters to format the string
 * @param aComponent   optional stringbundle component name
 */
function calGetString(aBundleName, aStringName, aParams, aComponent="calendar") {
    let propName = "chrome://" + aComponent + "/locale/" + aBundleName + ".properties";

    try {
        let props = Services.strings.createBundle(propName);

        if (aParams && aParams.length) {
            return props.formatStringFromName(aStringName, aParams, aParams.length);
        } else {
            return props.GetStringFromName(aStringName);
        }
    } catch (ex) {
        let msg = "Failed to read '" + aStringName + "' from " + propName + ".";
        Components.utils.reportError(msg + " Error: " + ex);
        return msg;
    }
}

/**
 * Make a UUID using the UUIDGenerator service available, we'll use that.
 */
function getUUID() {
    let uuidGen = Components.classes["@mozilla.org/uuid-generator;1"]
                  .getService(Components.interfaces.nsIUUIDGenerator);
    // generate uuids without braces to avoid problems with
    // CalDAV servers that don't support filenames with {}
    return uuidGen.generateUUID().toString().replace(/[{}]/g, "");
}

/**
 * Due to a bug in js-wrapping, normal == comparison can fail when we
 * have 2 objects.  Use these functions to force them both to get wrapped
 * the same way, allowing for normal comparison.
 */

/**
 * calIItemBase comparer
 */
function compareItems(aItem, aOtherItem) {
    let sip1 = Components.classes["@mozilla.org/supports-interface-pointer;1"]
                         .createInstance(Components.interfaces.nsISupportsInterfacePointer);
    sip1.data = aItem;
    sip1.dataIID = Components.interfaces.calIItemBase;

    let sip2 = Components.classes["@mozilla.org/supports-interface-pointer;1"]
                         .createInstance(Components.interfaces.nsISupportsInterfacePointer);
    sip2.data = aOtherItem;
    sip2.dataIID = Components.interfaces.calIItemBase;
    return sip1.data == sip2.data;
}

/**
 * Tries to get rid of wrappers. This is used to avoid cyclic references, and thus leaks.
 */
function calTryWrappedJSObject(obj) {
    if (obj && obj.wrappedJSObject) {
        obj = obj.wrappedJSObject;
    }
    return obj;
}

/**
 * Generic object comparer
 * Use to compare two objects which are not of type calIItemBase, in order
 * to avoid the js-wrapping issues mentioned above.
 *
 * @param aObject        first object to be compared
 * @param aOtherObject   second object to be compared
 * @param aIID           IID to use in comparison, undefined/null defaults to nsISupports
 */
function compareObjects(aObject, aOtherObject, aIID) {
    // xxx todo: seems to work fine e.g. for WCAP, but I still mistrust this trickery...
    //           Anybody knows an official API that could be used for this purpose?
    //           For what reason do clients need to pass aIID since
    //           every XPCOM object has to implement nsISupports?
    //           XPCOM (like COM, like UNO, ...) defines that QueryInterface *only* needs to return
    //           the very same pointer for nsISupports during its lifetime.
    if (!aIID) {
        aIID = Components.interfaces.nsISupports;
    }
    let sip1 = Components.classes["@mozilla.org/supports-interface-pointer;1"]
                         .createInstance(Components.interfaces.nsISupportsInterfacePointer);
    sip1.data = aObject;
    sip1.dataIID = aIID;

    let sip2 = Components.classes["@mozilla.org/supports-interface-pointer;1"]
                         .createInstance(Components.interfaces.nsISupportsInterfacePointer);
    sip2.data = aOtherObject;
    sip2.dataIID = aIID;
    return sip1.data == sip2.data;
}

/**
 * Compare two arrays using the passed function.
 */
function compareArrays(aOne, aTwo, compareFunc) {
    if (!aOne && !aTwo) {
        return true;
    }
    if (!aOne || !aTwo) {
        return false;
    }
    let len = aOne.length;
    if (len != aTwo.length) {
        return false;
    }
    for (let i = 0; i < len; ++i) {
        if (!compareFunc(aOne[i], aTwo[i])) {
            return false;
        }
    }
    return true;
}

/**
 * Takes care of all QueryInterface business, including calling the QI of any
 * existing parent prototypes.
 *
 * @deprecated
 * @param aSelf         The object the QueryInterface is being made to
 * @param aProto        Caller's prototype object
 * @param aIID          The IID to check for
 * @param aList         (Optional if aClassInfo is specified) An array of
 *                        interfaces from Components.interfaces
 * @param aClassInfo    (Optional) an Object containing the class info for this
 *                        prototype.
 */
function doQueryInterface(aSelf, aProto, aIID, aList, aClassInfo) {
    if (!doQueryInterface.warningIssued) {
        cal.WARN("Use of doQueryInterface() is deprecated and will be removed " +
                 "with the next release. Use XPCOMUtils.generateQI() instead.\n" +
                 cal.STACK(10));
        doQueryInterface.warningIssued = true;
    }

    if (aClassInfo) {
        if (aIID.equals(Components.interfaces.nsIClassInfo)) {
            return aClassInfo;
        }
        if (!aList) {
            aList = aClassInfo.getInterfaces({});
        }
    }

    if (aList) {
        for (let iid of aList) {
            if (aIID.equals(iid)) {
                return aSelf;
            }
        }
    }

    if (aIID.equals(Components.interfaces.nsISupports)) {
        return aSelf;
    }

    if (aProto) {
        let base = aProto.__proto__;
        if (base && base.QueryInterface) {
            // Try to QI the base prototype
            return base.QueryInterface.call(aSelf, aIID);
        }
    }

    throw Components.results.NS_ERROR_NO_INTERFACE;
}

/**
 * Many computations want to work only with date-times, not with dates.  This
 * method will return a proper datetime (set to midnight) for a date object.  If
 * the object is already a datetime, it will simply be returned.
 *
 * @param aDate  the date or datetime to check
 */
function ensureDateTime(aDate) {
    if (!aDate || !aDate.isDate) {
        return aDate;
    }
    let newDate = aDate.clone();
    newDate.isDate = false;
    return newDate;
}

/**
 * Get the default event start date. This is the next full hour, or 23:00 if it
 * is past 23:00.
 *
 * @param aReferenceDate    If passed, the time of this date will be modified,
 *                            keeping the date and timezone intact.
 */
function getDefaultStartDate(aReferenceDate) {
    let startDate = now();
    if (aReferenceDate) {
        let savedHour = startDate.hour;
        startDate = aReferenceDate;
        if (!startDate.isMutable) {
            startDate = startDate.clone();
        }
        startDate.isDate = false;
        startDate.hour = savedHour;
    }

    startDate.second = 0;
    startDate.minute = 0;
    if (startDate.hour < 23) {
        startDate.hour++;
    }
    return startDate;
}

/**
 * Setup the default start and end hours of the given item. This can be a task
 * or an event.
 *
 * @param aItem             The item to set up the start and end date for.
 * @param aReferenceDate    If passed, the time of this date will be modified,
 *                            keeping the date and timezone intact.
 */
function setDefaultStartEndHour(aItem, aReferenceDate) {
    aItem[calGetStartDateProp(aItem)] = getDefaultStartDate(aReferenceDate);

    if (isEvent(aItem)) {
        aItem.endDate = aItem.startDate.clone();
        aItem.endDate.minute += Preferences.get("calendar.event.defaultlength", 60);
    }
}

/**
 * Helper used in the following log functions to actually log the message.
 * Should not be used outside of this file.
 */
function _log(message, flag) {
    let frame = Components.stack.caller.caller;
    let filename = frame.filename ? frame.filename.split(" -> ").pop() : null;
    let scriptError = Components.classes["@mozilla.org/scripterror;1"]
                                .createInstance(Components.interfaces.nsIScriptError);
    scriptError.init(message, filename, null, frame.lineNumber, frame.columnNumber,
                     flag, "component javascript");
    Services.console.logMessage(scriptError);
}

/**
 * Logs a string or an object to both stderr and the js-console only in the case
 * where the calendar.debug.log pref is set to true.
 *
 * @param aArg  either a string to log or an object whose entire set of
 *              properties should be logged.
 */
function LOG(aArg) {
    if (!Preferences.get("calendar.debug.log", false)) {
        return;
    }

    ASSERT(aArg, "Bad log argument.", false);
    let string = aArg;
    // We should just dump() both String objects, and string primitives.
    if (!(aArg instanceof String) && !(typeof aArg == "string")) {
        string = "Logging object...\n";
        for (let prop in aArg) {
            string += prop + ": " + aArg[prop] + "\n";
        }
        string += "End object\n";
    }

    dump(string + "\n");
    _log(string, Components.interfaces.nsIScriptError.infoFlag);
}

/**
 * Dumps a warning to both console and js console.
 *
 * @param aMessage warning message
 */
function WARN(aMessage) {
    dump("Warning: " + aMessage + "\n");
    _log(aMessage, Components.interfaces.nsIScriptError.warningFlag);
}

/**
 * Dumps an error to both console and js console.
 *
 * @param aMessage error message
 */
function ERROR(aMessage) {
    dump("Error: " + aMessage + "\n");
    _log(aMessage, Components.interfaces.nsIScriptError.errorFlag);
}

/**
 * Returns a string describing the current js-stack with filename and line
 * numbers.
 *
 * @param aDepth (optional) The number of frames to include. Defaults to 5.
 * @param aSkip  (optional) Number of frames to skip
 */
function STACK(aDepth, aSkip) {
    let depth = aDepth || 10;
    let skip = aSkip || 0;
    let stack = "";
    let frame = Components.stack.caller;
    for (let i = 1; i <= depth + skip && frame; i++) {
        if (i > skip) {
            stack += i + ": [" + frame.filename + ":" +
                     frame.lineNumber + "] " + frame.name + "\n";
        }
        frame = frame.caller;
    }
    return stack;
}

/**
 * Logs a message and the current js-stack, if aCondition fails
 *
 * @param aCondition  the condition to test for
 * @param aMessage    the message to report in the case the assert fails
 * @param aCritical   if true, throw an error to stop current code execution
 *                    if false, code flow will continue
 *                    may be a result code
 */
function ASSERT(aCondition, aMessage, aCritical) {
    if (aCondition) {
        return;
    }

    let string = "Assert failed: " + aMessage + "\n" + STACK(0, 1);
    if (aCritical) {
        throw new Components.Exception(string,
                                       aCritical === true ? Components.results.NS_ERROR_UNEXPECTED : aCritical);
    } else {
        Components.utils.reportError(string);
    }
}

/**
 * Uses the prompt service to display an error message.
 * This function cannot be migrated into a module file, because it relies on an outer window object.
 *
 * @param aMsg The message to be shown
 */
function showError(aMsg) {
    let wnd = window || null;
    if (wnd) {
        Services.prompt.alert(wnd, calGetString("calendar", "genericErrorTitle"), aMsg);
    }
}

/**
 * Pick whichever of "black" or "white" will look better when used as a text
 * color against a background of bgColor.
 *
 * @param bgColor   the background color as a "#RRGGBB" string
 */
function getContrastingTextColor(bgColor) {
    let calcColor = bgColor.replace(/#/g, "");
    let red = parseInt(calcColor.substring(0, 2), 16);
    let green = parseInt(calcColor.substring(2, 4), 16);
    let blue = parseInt(calcColor.substring(4, 6), 16);

    // Calculate the brightness (Y) value using the YUV color system.
    let brightness = (0.299 * red) + (0.587 * green) + (0.114 * blue);

    // Consider all colors with less than 56% brightness as dark colors and
    // use white as the foreground color, otherwise use black.
    if (brightness < 144) {
        return "white";
    }

    return "black";
}

/**
 * Returns the property name used for the start date of an item, ie either an
 * event's start date or a task's entry date.
 */
function calGetStartDateProp(aItem) {
    if (isEvent(aItem)) {
        return "startDate";
    } else if (isToDo(aItem)) {
        return "entryDate";
    }
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
}

/**
 * Returns the property name used for the end date of an item, ie either an
 * event's end date or a task's due date.
 */
function calGetEndDateProp(aItem) {
    if (isEvent(aItem)) {
        return "endDate";
    } else if (isToDo(aItem)) {
        return "dueDate";
    }
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
}

/**
 * Checks whether the passed item fits into the demanded range.
 *
 * @param item               the item
 * @param rangeStart         (inclusive) range start or null (open range)
 * @param rangeStart         (exclusive) range end or null (open range)
 * @param returnDtstartOrDue returns item's start (or due) date in case
 *                           the item is in the specified Range; null otherwise.
 */
function checkIfInRange(item, rangeStart, rangeEnd, returnDtstartOrDue) {
    let startDate;
    let endDate;
    let queryStart = ensureDateTime(rangeStart);
    if (isEvent(item)) {
        startDate = item.startDate;
        if (!startDate) { // DTSTART mandatory
            // xxx todo: should we assert this case?
            return null;
        }
        endDate = item.endDate || startDate;
    } else {
        let dueDate = item.dueDate;
        startDate = item.entryDate || dueDate;
        if (!item.entryDate) {
            if (returnDtstartOrDue) { // DTSTART or DUE mandatory
                return null;
            }
            // 3.6.2. To-do Component
            // A "VTODO" calendar component without the "DTSTART" and "DUE" (or
            // "DURATION") properties specifies a to-do that will be associated
            // with each successive calendar date, until it is completed.
            let completedDate = ensureDateTime(item.completedDate);
            dueDate = ensureDateTime(dueDate);
            return !completedDate || !queryStart ||
                   completedDate.compare(queryStart) > 0 ||
                   (dueDate && dueDate.compare(queryStart) >= 0);
        }
        endDate = dueDate || startDate;
    }

    let start = ensureDateTime(startDate);
    let end = ensureDateTime(endDate);
    let queryEnd = ensureDateTime(rangeEnd);

    if (start.compare(end) == 0) {
        if ((!queryStart || start.compare(queryStart) >= 0) &&
            (!queryEnd || start.compare(queryEnd) < 0)) {
            return startDate;
        }
    } else if ((!queryEnd || start.compare(queryEnd) < 0) &&
               (!queryStart || end.compare(queryStart) > 0)) {
        return startDate;
    }
    return null;
}

/**
 * This function return the progress state of a task:
 * completed, overdue, duetoday, inprogress, future
 *
 * @param aTask     The task to check.
 * @return          The progress atom.
 */
function getProgressAtom(aTask) {
    let nowdate = new Date();

    if (aTask.recurrenceInfo) {
        return "repeating";
    }

    if (aTask.isCompleted) {
        return "completed";
    }

    if (aTask.dueDate && aTask.dueDate.isValid) {
        if (cal.dateTimeToJsDate(aTask.dueDate).getTime() < nowdate.getTime()) {
            return "overdue";
        } else if (aTask.dueDate.year == nowdate.getFullYear() &&
                   aTask.dueDate.month == nowdate.getMonth() &&
                   aTask.dueDate.day == nowdate.getDate()) {
            return "duetoday";
        }
    }

    if (aTask.entryDate && aTask.entryDate.isValid &&
        cal.dateTimeToJsDate(aTask.entryDate).getTime() < nowdate.getTime()) {
        return "inprogress";
    }

    return "future";
}

function calInterfaceBag(iid) {
    this.init(iid);
}
calInterfaceBag.prototype = {
    mIid: null,
    mInterfaces: null,

    // Iterating the inteface bag iterates the interfaces it contains
    [Symbol.iterator]: function() { return this.mInterfaces[Symbol.iterator](); },

    // internal:
    init: function(iid) {
        this.mIid = iid;
        this.mInterfaces = [];
    },

    // external:
    get size() {
        return this.mInterfaces.length;
    },

    get interfaceArray() {
        return this.mInterfaces;
    },

    add: function(iface) {
        if (iface) {
            let existing = this.mInterfaces.some(obj => {
                return compareObjects(obj, iface, this.mIid);
            });
            if (!existing) {
                this.mInterfaces.push(iface);
            }
            return !existing;
        }
        return false;
    },

    remove: function(iface) {
        if (iface) {
            this.mInterfaces = this.mInterfaces.filter((obj) => {
                return !compareObjects(obj, iface, this.mIid);
            });
        }
    },

    forEach: function(func) {
        this.mInterfaces.forEach(func);
    }
};

function calListenerBag(iid) {
    this.init(iid);
}
calListenerBag.prototype = {
    __proto__: calInterfaceBag.prototype,

    notify: function(func, args=[]) {
        function notifyFunc(iface) {
            try {
                iface[func](...args);
            } catch (exc) {
                let stack = exc.stack || (exc.location ? exc.location.formattedStack : null);
                Components.utils.reportError(exc + "\nSTACK: " + stack);
            }
        }
        this.mInterfaces.forEach(notifyFunc);
    }
};

function sendMailTo(aRecipient, aSubject, aBody, aIdentity) {
    let msgParams = Components.classes["@mozilla.org/messengercompose/composeparams;1"]
                              .createInstance(Components.interfaces.nsIMsgComposeParams);
    let composeFields = Components.classes["@mozilla.org/messengercompose/composefields;1"]
                                  .createInstance(Components.interfaces.nsIMsgCompFields);

    composeFields.to = aRecipient;
    composeFields.subject = aSubject;
    composeFields.body = aBody;

    msgParams.type = Components.interfaces.nsIMsgCompType.New;
    msgParams.format = Components.interfaces.nsIMsgCompFormat.Default;
    msgParams.composeFields = composeFields;
    msgParams.identity = aIdentity;

    MailServices.compose.OpenComposeWindowWithParams(null, msgParams);
}

/**
 * This object implements calIOperation and could group multiple sub
 * operations into one. You can pass a cancel function which is called once
 * the operation group is cancelled.
 * Users must call notifyCompleted() once all sub operations have been
 * successful, else the operation group will stay pending.
 * The reason for the latter is that providers currently should (but need
 * not) implement (and return) calIOperation handles, thus there may be pending
 * calendar operations (without handle).
 */
function calOperationGroup(cancelFunc) {
    this.wrappedJSObject = this;
    if (calOperationGroup.mOpGroupId === undefined) {
        calOperationGroup.mOpGroupId = 0;
    }
    if (calOperationGroup.mOpGroupPrefix === undefined) {
        calOperationGroup.mOpGroupPrefix = getUUID() + "-";
    }
    this.mCancelFunc = cancelFunc;
    this.mId = calOperationGroup.mOpGroupPrefix + calOperationGroup.mOpGroupId++;
    this.mSubOperations = [];
}
calOperationGroup.prototype = {
    mCancelFunc: null,
    mId: null,
    mIsPending: true,
    mStatus: Components.results.NS_OK,
    mSubOperations: null,

    add: function(aOperation) {
        if (aOperation && aOperation.isPending) {
            this.mSubOperations.push(aOperation);
        }
    },

    remove: function(aOperation) {
        if (aOperation) {
            this.mSubOperations = this.mSubOperations.filter(operation => aOperation.id != operation.id);
        }
    },

    get isEmpty() {
        return (this.mSubOperations.length == 0);
    },

    notifyCompleted: function(status) {
        ASSERT(this.isPending, "[calOperationGroup_notifyCompleted] this.isPending");
        if (this.isPending) {
            this.mIsPending = false;
            if (status) {
                this.mStatus = status;
            }
        }
    },

    toString: function() {
        return "[calOperationGroup] id=" + this.id;
    },

    // calIOperation:
    get id() {
        return this.mId;
    },

    get isPending() {
        return this.mIsPending;
    },

    get status() {
        return this.mStatus;
    },

    cancel: function(status) {
        if (this.isPending) {
            if (!status) {
                status = Components.interfaces.calIErrors.OPERATION_CANCELLED;
            }
            this.notifyCompleted(status);
            let cancelFunc = this.mCancelFunc;
            if (cancelFunc) {
                this.mCancelFunc = null;
                cancelFunc();
            }
            let subOperations = this.mSubOperations;
            this.mSubOperations = [];
            for (let operation of subOperations) {
                operation.cancel(Components.interfaces.calIErrors.OPERATION_CANCELLED);
            }
        }
    }
};

function sameDay(date1, date2) {
    if (date1 && date2) {
        if ((date1.day == date2.day) &&
            (date1.month == date2.month) &&
            (date1.year == date2.year)) {
            return true;
        }
    }
    return false;
}

/**
 * Centralized funtions for accessing prodid and version
 */
function calGetProductId() {
    return "-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN";
}
function calGetProductVersion() {
    return "2.0";
}

/**
 * This is a centralized function for setting the prodid and version on an
 * ical component.  This should be used whenever you need to set the prodid
 * and version on a calIcalComponent object.
 *
 * @param
 *      aIcalComponent  The ical component to set the prodid and version on.
 */
function calSetProdidVersion(aIcalComponent) {
    // Throw for an invalid parameter
    aIcalComponent = cal.wrapInstance(aIcalComponent, Components.interfaces.calIIcalComponent);
    if (!aIcalComponent) {
        throw Components.results.NS_ERROR_INVALID_ARG;
    }
    // Set the prodid and version
    aIcalComponent.prodid = calGetProductId();
    aIcalComponent.version = calGetProductVersion();
}


/**
 * TODO: The following UI-related functions need to move somewhere different,
 * i.e calendar-ui-utils.js
 */

/**
 * applies a value to all children of a Menu. If the respective childnodes define
 * a command the value is applied to the attribute of thecommand of the childnode
 *
 * @param aElement The parentnode of the elements
 * @param aAttributeName The name of the attribute
 * @param aValue The value of the attribute
 */
function applyAttributeToMenuChildren(aElement, aAttributeName, aValue) {
    let sibling = aElement.firstChild;
    do {
        if (sibling) {
            let domObject = sibling;
            let commandName = null;
            if (sibling.hasAttribute("command")) {
                commandName = sibling.getAttribute("command");
            }
            if (commandName) {
                let command = document.getElementById(commandName);
                if (command) {
                    domObject = command;
                }
            }
            domObject.setAttribute(aAttributeName, aValue);
            sibling = sibling.nextSibling;
        }
    } while (sibling);
}


/**
 * compares the value of a property of an array of objects and returns
 * true or false if it is same or not among all array members
 *
 * @param aObjects An Array of Objects to inspect
 * @param aProperty Name the name of the Property of which the value is compared
 */
function isPropertyValueSame(aObjects, aPropertyName) {
    let value = null;
    for (let i = 0; i < aObjects.length; i++) {
        if (!value) {
            value = aObjects[0][aPropertyName];
        }
        let compValue = aObjects[i][aPropertyName];
        if (compValue != value) {
            return false;
        }
    }
    return true;
}

/**
 * returns a parentnode - or the overgiven node - with the given localName,
 * by "walking up" the DOM-hierarchy.
 *
 * @param aChildNode  The childnode.
 * @param aLocalName  The localName of the to-be-returned parent
 *                      that is looked for.
 * @return            The parent with the given localName or the
 *                      given childNode 'aChildNode'. If no appropriate
 *                      parent node with aLocalName could be
 *                      retrieved it is returned 'null'.
 */
function getParentNodeOrThis(aChildNode, aLocalName) {
    let node = aChildNode;
    while (node && (node.localName != aLocalName)) {
        node = node.parentNode;
        if (node.tagName == undefined) {
            return null;
        }
    }
    return node;
}

/**
 * Returns a parentnode  - or the overgiven node -  with the given attributevalue
 * for the given attributename by "walking up" the DOM-hierarchy.
 *
 * @param aChildNode      The childnode.
 * @param aAttibuteName   The name of the attribute that is to be compared with
 * @param aAttibuteValue  The value of the attribute that is to be compared with
 * @return                The parent with the given attributeName set that has
 *                          the same value as the given given attributevalue
 *                          'aAttributeValue'. If no appropriate
 *                          parent node can be retrieved it is returned 'null'.
 */
function getParentNodeOrThisByAttribute(aChildNode, aAttributeName, aAttributeValue) {
    let node = aChildNode;
    while (node && (node.getAttribute(aAttributeName) != aAttributeValue)) {
        node = node.parentNode;
        if (node.tagName == undefined) {
            return null;
        }
    }
    return node;
}

function setItemProperty(item, propertyName, aValue, aCapability) {
    let isSupported = (item.calendar.getProperty("capabilities." + aCapability + ".supported") !== false);
    let value = (aCapability && !isSupported ? null : aValue);

    switch (propertyName) {
        case "startDate":
            if ((value.isDate && !item.startDate.isDate) ||
                (!value.isDate && item.startDate.isDate) ||
                !compareObjects(value.timezone, item.startDate.timezone) ||
                value.compare(item.startDate) != 0) {
                item.startDate = value;
            }
            break;
        case "endDate":
            if ((value.isDate && !item.endDate.isDate) ||
                (!value.isDate && item.endDate.isDate) ||
                !compareObjects(value.timezone, item.endDate.timezone) ||
                value.compare(item.endDate) != 0) {
                item.endDate = value;
            }
            break;
        case "entryDate":
            if (value == item.entryDate) {
                break;
            }
            if ((value && !item.entryDate) ||
                (!value && item.entryDate) ||
                value.isDate != item.entryDate.isDate ||
                !compareObjects(value.timezone, item.entryDate.timezone) ||
                value.compare(item.entryDate) != 0) {
                item.entryDate = value;
            }
            break;
        case "dueDate":
            if (value == item.dueDate) {
                break;
            }
            if ((value && !item.dueDate) ||
                (!value && item.dueDate) ||
                value.isDate != item.dueDate.isDate ||
                !compareObjects(value.timezone, item.dueDate.timezone) ||
                value.compare(item.dueDate) != 0) {
                item.dueDate = value;
            }
            break;
        case "isCompleted":
            if (value != item.isCompleted) {
                item.isCompleted = value;
            }
            break;
        case "PERCENT-COMPLETE": {
            let perc = parseInt(item.getProperty(propertyName), 10);
            if (isNaN(perc)) {
                perc = 0;
            }
            if (perc != value) {
                item.setProperty(propertyName, value);
            }
            break;
        }
        case "title":
            if (value != item.title) {
                item.title = value;
            }
            break;
        default:
            if (!value || value == "") {
                item.deleteProperty(propertyName);
            } else if (item.getProperty(propertyName) != value) {
                item.setProperty(propertyName, value);
            }
            break;
    }
}
/**
 * END TODO: The above UI-related functions need to move somewhere different,
 * i.e calendar-ui-utils.js
 */

/**
 * Implements a property bag.
 */
function calPropertyBag() {
    this.mData = {};
}
calPropertyBag.prototype = {
    mData: null,

    setProperty: function(aName, aValue) {
        return (this.mData[aName] = aValue);
    },
    getProperty_: function(aName) {
        // avoid strict undefined property warning
        return (aName in this.mData ? this.mData[aName] : undefined);
    },
    getProperty: function(aName) {
        // avoid strict undefined property warning
        return (aName in this.mData ? this.mData[aName] : null);
    },
    getAllProperties: function(aOutKeys, aOutValues) {
        let keys = [];
        let values = [];
        for (let key in this.mData) {
            keys.push(key);
            values.push(this.mData[key]);
        }
        aOutKeys.value = keys;
        aOutValues.value = values;
    },
    deleteProperty: function(aName) {
        delete this.mData[aName];
    },
    get enumerator() {
        return new calPropertyBagEnumerator(this);
    },
    [Symbol.iterator]: function* () {
        for (let name of Object.keys(this.mData)) {
            yield [name, this.mData[name]];
        }
    }
};
// implementation part of calPropertyBag
function calPropertyBagEnumerator(bag) {
    this.mIndex = 0;
    this.mBag = bag;
    this.mKeys = Object.keys(bag.mData);
}
calPropertyBagEnumerator.prototype = {
    mIndex: 0,
    mBag: null,
    mKeys: null,

    // nsISimpleEnumerator:
    getNext: function() {
        if (!this.hasMoreElements()) { // hasMoreElements is called by intention to skip yet deleted properties
            ASSERT(false, Components.results.NS_ERROR_UNEXPECTED);
            throw Components.results.NS_ERROR_UNEXPECTED;
        }
        let name = this.mKeys[this.mIndex++];
        return { // nsIProperty:
            QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIProperty]),
            name: name,
            value: this.mCurrentValue
        };
    },
    hasMoreElements: function() {
        while (this.mIndex < this.mKeys.length) {
            this.mCurrentValue = this.mBag.mData[this.mKeys[this.mIndex]];
            if (this.mCurrentValue !== undefined) {
                return true;
            }
            ++this.mIndex;
        }
        return false;
    }
};

/**
 * Iterates all email identities and calls the passed function with identity and account.
 * If the called function returns false, iteration is stopped.
 */
function calIterateEmailIdentities(func) {
    let accounts = MailServices.accounts.accounts;
    for (let i = 0; i < accounts.length; ++i) {
        let account = accounts.queryElementAt(i, Components.interfaces.nsIMsgAccount);
        let identities = account.identities;
        for (let j = 0; j < identities.length; ++j) {
            let identity = identities.queryElementAt(j, Components.interfaces.nsIMsgIdentity);
            if (!func(identity, account)) {
                break;
            }
        }
    }
}

/**
 * Compare two items by *content*, leaving out any revision information such as
 * X-MOZ-GENERATION, SEQUENCE, DTSTAMP, LAST-MODIFIED.

 * The format for the parameters to ignore object is:
 * { "PROPERTY-NAME": ["PARAM-NAME", ...] }
 *
 * If aIgnoreProps is not passed, these properties are ignored:
 *  X-MOZ-GENERATION, SEQUENCE, DTSTAMP, LAST-MODIFIED, X-MOZ-SEND-INVITATIONS
 *
 * If aIgnoreParams is not passed, these parameters are ignored:
 *  ATTENDEE: CN
 *  ORGANIZER: CN
 *
 * @param aFirstItem        The item to compare.
 * @param aSecondItem       The item to compare to.
 * @param aIgnoreProps      (optional) An array of parameters to ignore.
 * @param aIgnoreParams     (optional) An object describing which parameters to
 *                                     ignore.
 * @return                  True, if items match.
 */
function compareItemContent(aFirstItem, aSecondItem, aIgnoreProps, aIgnoreParams) {
    let ignoreProps = arr2hash(aIgnoreProps ||
        ["SEQUENCE", "DTSTAMP", "LAST-MODIFIED", "X-MOZ-GENERATION", "X-MICROSOFT-DISALLOW-COUNTER",
         "X-MOZ-SEND-INVITATIONS", "X-MOZ-SEND-INVITATIONS-UNDISCLOSED"]);

    let ignoreParams = aIgnoreParams ||
        { ATTENDEE: ["CN"], ORGANIZER: ["CN"] };
    for (let x in ignoreParams) {
        ignoreParams[x] = arr2hash(ignoreParams[x]);
    }

    function arr2hash(arr) {
        let hash = {};
        for (let x of arr) {
            hash[x] = true;
        }
        return hash;
    }

    // This doesn't have to be super correct rfc5545, it just needs to be
    // in the same order
    function normalizeComponent(comp) {
        let props = [];
        for (let prop of cal.ical.propertyIterator(comp)) {
            if (!(prop.propertyName in ignoreProps)) {
                props.push(normalizeProperty(prop));
            }
        }
        props = props.sort();

        let comps = [];
        for (let subcomp of cal.ical.subcomponentIterator(comp)) {
            comps.push(normalizeComponent(subcomp));
        }
        comps = comps.sort();

        return comp.componentType + props.join("\r\n") + comps.join("\r\n");
    }

    function normalizeProperty(prop) {
        let params = [...cal.ical.paramIterator(prop)]
            .filter(([k, v]) => !(prop.propertyName in ignoreParams) ||
                   !(k in ignoreParams[prop.propertyName]))
            .map(([k, v]) => k + "=" + v)
            .sort();

        return prop.propertyName + ";" +
               params.join(";") + ":" +
               prop.valueAsIcalString;
    }

    return normalizeComponent(aFirstItem.icalComponent) ==
           normalizeComponent(aSecondItem.icalComponent);
}

/**
 * Use the binary search algorithm to search for an item in an array.
 * function.
 *
 * The comptor function may look as follows for calIDateTime objects.
 *     function comptor(a, b) {
 *         return a.compare(b);
 *     }
 * If no comptor is specified, the default greater-than comptor will be used.
 *
 * @param itemArray             The array to search.
 * @param newItem               The item to search in the array.
 * @param comptor               A comparation function that can compare two items.
 * @return                      The index of the new item.
 */
function binarySearch(itemArray, newItem, comptor) {
    function binarySearchInternal(low, high) {
        // Are we done yet?
        if (low == high) {
            return low + (comptor(newItem, itemArray[low]) < 0 ? 0 : 1);
        }

        let mid = Math.floor(low + ((high - low) / 2));
        let cmp = comptor(newItem, itemArray[mid]);
        if (cmp > 0) {
            return binarySearchInternal(mid + 1, high);
        } else if (cmp < 0) {
            return binarySearchInternal(low, mid);
        } else {
            return mid;
        }
    }

    if (itemArray.length < 1) {
        return -1;
    }
    if (!comptor) {
        comptor = function(a, b) {
            return (a > b) - (a < b);
        };
    }
    return binarySearchInternal(0, itemArray.length - 1);
}

/**
 * Insert a new node underneath the given parentNode, using binary search. See binarySearch
 * for a note on how the comptor works.
 *
 * @param parentNode           The parent node underneath the new node should be inserted.
 * @param inserNode            The node to insert
 * @param aItem                The calendar item to add a widget for.
 * @param comptor              A comparison function that can compare two items (not DOM Nodes!)
 * @param discardDuplicates    Use the comptor function to check if the item in
 *                               question is already in the array. If so, the
 *                               new item is not inserted.
 * @param itemAccessor         [optional] A function that receives a DOM node and returns the associated item
 *                               If null, this function will be used: function(n) n.item
 */
function binaryInsertNode(parentNode, insertNode, aItem, comptor, discardDuplicates, itemAccessor) {
    let accessor = itemAccessor || binaryInsertNode.defaultAccessor;

    // Get the index of the node before which the inserNode will be inserted
    let newIndex = binarySearch(Array.map(parentNode.childNodes, accessor), aItem, comptor);

    if (newIndex < 0) {
        parentNode.appendChild(insertNode);
        newIndex = 0;
    } else if (!discardDuplicates ||
        comptor(accessor(parentNode.childNodes[Math.min(newIndex, parentNode.childNodes.length - 1)]), aItem) >= 0) {
        // Only add the node if duplicates should not be discarded, or if
        // they should and the childNode[newIndex] == node.
        let node = parentNode.childNodes[newIndex];
        parentNode.insertBefore(insertNode, node);
    }
    return newIndex;
}
binaryInsertNode.defaultAccessor = n => n.item;

/**
 * Insert an item into the given array, using binary search. See binarySearch
 * for a note on how the comptor works.
 *
 * @param itemArray             The array to insert into.
 * @param item                  The item to insert into the array.
 * @param comptor               A comparation function that can compare two items.
 * @param discardDuplicates     Use the comptor function to check if the item in
 *                                question is already in the array. If so, the
 *                                new item is not inserted.
 * @return                      The index of the new item.
 */
function binaryInsert(itemArray, item, comptor, discardDuplicates) {
    let newIndex = binarySearch(itemArray, item, comptor);

    if (newIndex < 0) {
        itemArray.push(item);
        newIndex = 0;
    } else if (!discardDuplicates ||
                comptor(itemArray[Math.min(newIndex, itemArray.length - 1)], item) != 0) {
        // Only add the item if duplicates should not be discarded, or if
        // they should and itemArray[newIndex] != item.
        itemArray.splice(newIndex, 0, item);
    }
    return newIndex;
}

/**
 * Gets the cached instance of the composite calendar.
 *
 * WARNING: Great care should be taken how this function is called. If it is
 * called as "cal.getCompositeCalendar()" then it is called through calUtils.jsm
 * which means there will be one instance per app. If called as
 * "getCompositeCalendar()" from chrome code, then it will get a window-specific
 * composite calendar, which is often what is wanted
 */
function getCompositeCalendar() {
    if (getCompositeCalendar.mObject === undefined) {
        getCompositeCalendar.mObject = Components.classes["@mozilla.org/calendar/calendar;1?type=composite"]
                                                 .createInstance(Components.interfaces.calICompositeCalendar);
        getCompositeCalendar.mObject.prefPrefix = "calendar-main";

        try {
            if (gCalendarStatusFeedback) {
                // If we are in a window that has calendar status feedback, set up
                // our status observer.
                let chromeWindow = window.QueryInterface(Components.interfaces.nsIDOMChromeWindow);
                getCompositeCalendar.mObject.setStatusObserver(gCalendarStatusFeedback, chromeWindow);
            }
        } catch (exc) { // catch errors in case we run in contexts without status feedback
        }
    }
    return getCompositeCalendar.mObject;
}

/**
 * Search for already open item dialog or tab.
 *
 * @param aItem     The item of the dialog or tab to search for.
 */
function findItemWindow(aItem) {
    // check for existing dialog windows
    let list = Services.wm.getEnumerator("Calendar:EventDialog");
    while (list.hasMoreElements()) {
        let dlg = list.getNext();
        if (dlg.arguments[0] &&
            dlg.arguments[0].mode == "modify" &&
            dlg.arguments[0].calendarEvent &&
            dlg.arguments[0].calendarEvent.hashId == aItem.hashId) {
            return dlg;
        }
    }
    // check for existing summary windows
    list = Services.wm.getEnumerator("Calendar:EventSummaryDialog");
    while (list.hasMoreElements()) {
        let dlg = list.getNext();
        if (dlg.calendarItem &&
            dlg.calendarItem.hashId == aItem.hashId) {
            return dlg;
        }
    }
    return null;
}
