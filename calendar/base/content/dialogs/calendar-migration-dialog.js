/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var SUNBIRD_UID = "{718e30fb-e89b-41dd-9da7-e25a45638b28}";
var FIREFOX_UID = "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}";

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

//
// The front-end wizard bits.
//
var gMigrateWizard = {
    /**
     * Called from onload of the migrator window.  Takes all of the migrators
     * that were passed in via window.arguments and adds them to checklist. The
     * user can then check these off to migrate the data from those sources.
     */
    loadMigrators: function gmw_load() {
        var listbox = document.getElementById("datasource-list");

        //XXX Once we have branding for lightning, this hack can go away
        var props = Services.strings.createBundle("chrome://calendar/locale/migration.properties");

        var wizard = document.getElementById("migration-wizard");
        var desc = document.getElementById("wizard-desc");
        // Since we don't translate "Lightning"...
        wizard.title = props.formatStringFromName("migrationTitle",
                                                  ["Lightning"],
                                                  1);
        desc.textContent = props.formatStringFromName("migrationDescription",
                                                      ["Lightning"],
                                                      1);

        migLOG("migrators: " + window.arguments.length);
        for (var migrator of window.arguments[0]) {
            var listItem = document.createElement("listitem");
            listItem.setAttribute("type", "checkbox");
            listItem.setAttribute("checked", true);
            listItem.setAttribute("label", migrator.title);
            listItem.migrator = migrator;
            listbox.appendChild(listItem);
        }
    },

    /**
     * Called from the second page of the wizard.  Finds all of the migrators
     * that were checked and begins migrating their data.  Also controls the
     * progress dialog so the user can see what is happening. (somewhat)
     */
    migrateChecked: function gmw_migrate() {
        var migrators = [];

        // Get all the checked migrators into an array
        var listbox = document.getElementById("datasource-list");
        for (var i = listbox.childNodes.length-1; i >= 0; i--) {
            if (listbox.childNodes[i].getAttribute("checked")) {
                migrators.push(listbox.childNodes[i].migrator);
            }
        }

        // If no migrators were checked, then we're done
        if (migrators.length == 0) {
            window.close();
        }

        // Don't let the user get away while we're migrating
        //XXX may want to wire this into the 'cancel' function once that's
        //    written
        var wizard = document.getElementById("migration-wizard");
        wizard.canAdvance = false;
        wizard.canRewind = false;

        // We're going to need this for the progress meter's description
        var props = Services.strings.createBundle("chrome://calendar/locale/migration.properties");
        var label = document.getElementById("progress-label");
        var meter = document.getElementById("migrate-progressmeter");

        var i = 0;
        // Because some of our migrators involve async code, we need this
        // call-back function so we know when to start the next migrator.
        function getNextMigrator() {
            if (migrators[i]) {
                var mig = migrators[i];

                // Increment i to point to the next migrator
                i++;
                migLOG("starting migrator: " + mig.title);
                label.value = props.formatStringFromName("migratingApp",
                                                         [mig.title],
                                                         1);
                meter.value = (i-1)/migrators.length*100;
                mig.args.push(getNextMigrator);

                try {
                    mig.migrate.apply(mig, mig.args);
                } catch (e) {
                    migLOG("Failed to migrate: " + mig.title);
                    migLOG(e);
                    getNextMigrator();
                }
            } else {
                migLOG("migration done");
                wizard.canAdvance = true;
                label.value = props.GetStringFromName("finished");
                meter.value = 100;
                gMigrateWizard.setCanRewindFalse();
            }
         }

        // And get the first migrator
        getNextMigrator();
   },

    /**
     * Makes sure the wizard "back" button can not be pressed.
     */
    setCanRewindFalse: function gmw_finish() {
        document.getElementById('migration-wizard').canRewind = false;
    }
};

//
// The more back-end data detection bits
//


/**
 * A data migrator prototype, holding the information for migration
 *
 * @class
 * @param aTitle    The title of the migrator
 * @param aMigrateFunction    The function to call when migrating
 * @param aArguments          The arguments to pass in.
 */
function dataMigrator(aTitle, aMigrateFunction, aArguments) {
    this.title = aTitle;
    this.migrate = aMigrateFunction;
    this.args = aArguments || [];
}

var gDataMigrator = {
    mIsInFirefox: false,
    mPlatform: null,
    mDirService: null,
    mIoService: null,

    /**
     * Cached getter for the directory service.
     */
    get dirService() {
        if (!this.mDirService) {
            this.mDirService = Services.dirsvc;
        }
        return this.mDirService;
    },

    /**
     * Call to do a general data migration (for a clean profile)  Will run
     * through all of the known migrator-checkers.  These checkers will return
     * an array of valid dataMigrator objects, for each kind of data they find.
     * If there is at least one valid migrator, we'll pop open the migration
     * wizard, otherwise, we'll return silently.
     */
    checkAndMigrate: function gdm_migrate() {
        if (Services.appinfo.ID == FIREFOX_UID) {
            this.mIsInFirefox = true;
            // We can't handle Firefox Lightning yet
            migLOG("Holy cow, you're Firefox-Lightning! sorry, can't help.");
            return;
        }

        this.mPlatform = Services.appinfo.OS.toLowerCase();

        migLOG("mPlatform is: " + this.mPlatform);

        var DMs = [];
        var migrators = [this.checkOldCal,
                         this.checkEvolution,
                         this.checkWindowsMail,
                         this.checkIcal];
        // XXX also define a category and an interface here for pluggability
        for (var migrator of migrators) {
            var migs = migrator.call(this);
            for (var dm of migs) {
                DMs.push(dm);
            }
        }

        if (DMs.length == 0) {
            // No migration available
            return;
        }
        migLOG("DMs: " + DMs.length);

        var url = "chrome://calendar/content/calendar-migration-dialog.xul";
#ifdef XP_MACOSX
        var win = Services.wm.getMostRecentWindow("Calendar:MigrationWizard");
        if (win) {
            win.focus();
        } else {
            openDialog(url, "migration", "centerscreen,chrome,resizable=no,width=500,height=400", DMs);
        }
#else
        openDialog(url, "migration", "modal,centerscreen,chrome,resizable=no,width=500,height=400", DMs);
#endif
    },

    /**
     * Checks to see if we can find any traces of an older moz-cal program.
     * This could be either the old calendar-extension, or Sunbird 0.2.  If so,
     * it offers to move that data into our new storage format.
     */
    checkOldCal: function gdm_calold() {
        migLOG("Checking for the old calendar extension/app");

        // This is the function that the migration wizard will call to actually
        // migrate the data.  It's defined here because we may use it multiple
        // times (with different aProfileDirs), for instance if there is both
        // a Thunderbird and Firefox cal-extension
        function extMigrator(aProfileDir, aCallback) {
            // Get the old datasource
            var dataSource = aProfileDir.clone();
            dataSource.append("CalendarManager.rdf");
            if (!dataSource.exists()) {
                return;
            }

            // Let this be a lesson to anyone designing APIs. The RDF API is so
            // impossibly confusing that it's actually simpler/cleaner/shorter
            // to simply parse as XML and use the better DOM APIs.
            var req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
                      .createInstance(Components.interfaces.nsIXMLHttpRequest);
            req.open('GET', "file://" + dataSource.path, true);
            req.onreadystatechange = function calext_onreadychange() {
                if (req.readyState == 4) {
                    migLOG(req.responseText);
                    parseAndMigrate(req.responseXML, aCallback)
                }
            };
            req.send(null);
        }

        // Callback from the XHR above.  Parses CalendarManager.rdf and imports
        // the data describe therein.
        function parseAndMigrate(aDoc, aCallback) {
            // For duplicate detection
            var calManager = getCalendarManager();
            var uris = [];
            for (var oldCal of calManager.getCalendars({})) {
                uris.push(oldCal.uri);
            }

            function getRDFAttr(aNode, aAttr) {
                return aNode.getAttributeNS("http://home.netscape.com/NC-rdf#",
                                            aAttr);
            }

            const RDFNS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
            var nodes = aDoc.getElementsByTagNameNS(RDFNS, "Description");
            migLOG("nodes: " + nodes.length);
            for (var i = 0; i < nodes.length; i++) {
                migLOG("Beginning calendar node");
                var calendar;
                var node = nodes[i];
                if (getRDFAttr(node, "remote") == "false") {
                    migLOG("not remote");
                    var localFile = Components.classes["@mozilla.org/file/local;1"]
                                    .createInstance(Components.interfaces.nsILocalFile);
                    localFile.initWithPath(getRDFAttr(node, "path"));
                    calendar = gDataMigrator.importICSToStorage(localFile);
                } else {
                    // Remote subscription
                    // XXX check for duplicates
                    var url = makeURL(getRDFAttr(node, "remotePath"));
                    calendar = calManager.createCalendar("ics", url);
                }
                calendar.name = getRDFAttr(node, "name");
                calendar.setProperty("color", getRDFAttr(node, "color"));
                calManager.registerCalendar(calendar);
                getCompositeCalendar().addCalendar(calendar);
            }
            aCallback();
        }

        var migrators = [];

        // Look in our current profile directory, in case we're upgrading in
        // place
        var profileDir = this.dirService.get("ProfD", Components.interfaces.nsILocalFile);
        profileDir.append("Calendar");
        if (profileDir.exists()) {
            migLOG("Found old extension directory in current app");
            let title = "Mozilla Calendar Extension";
            migrators.push(new dataMigrator(title, extMigrator, [profileDir]));
        }

        // Check the profiles of the various other moz-apps for calendar data
        var profiles = [];

        // Do they use Firefox?
        var ffProf, sbProf, tbProf;
        if ((ffProf = this.getFirefoxProfile())) {
            profiles.push(ffProf);
        }

        // We're lightning, check Sunbird
        if ((sbProf = this.getSunbirdProfile())) {
            profiles.push(sbProf);
        }

        // Now check all of the profiles in each of these folders for data
        for (var prof of profiles) {
            var dirEnum = prof.directoryEntries;
            while (dirEnum.hasMoreElements()) {
                var profile = dirEnum.getNext().QueryInterface(Components.interfaces.nsIFile);
                if (profile.isFile()) {
                    continue;
                } else {
                    profile.append("Calendar");
                    if (profile.exists()) {
                        migLOG("Found old extension directory at" + profile.path);
                        var title = "Mozilla Calendar";
                        migrators.push(new dataMigrator(title, extMigrator, [profile]));
                    }
                }
            }
        }

        return migrators;
    },

    /**
     * Checks to see if Apple's iCal is installed and offers to migrate any data
     * the user has created in it.
     */
    checkIcal: function gdm_ical() {
        migLOG("Checking for ical data");

        function icalMigrate(aDataDir, aCallback) {
            aDataDir.append("Sources");
            var dirs = aDataDir.directoryEntries;
            var calManager = getCalendarManager();

            var i = 1;
            while(dirs.hasMoreElements()) {
                var dataDir = dirs.getNext().QueryInterface(Components.interfaces.nsIFile);
                var dataStore = dataDir.clone();
                dataStore.append("corestorage.ics");
                if (!dataStore.exists()) {
                    continue;
                }

                var chars = [];
                var fileStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                                 .createInstance(Components.interfaces.nsIFileInputStream);

                fileStream.init(dataStore, 0x01, parseInt("0444", 8), {});
                var convStream = Components.classes["@mozilla.org/intl/converter-input-stream;1"]
                                 .getService(Components.interfaces.nsIConverterInputStream);
                                 convStream.init(fileStream, 'UTF-8', 0, 0x0000);
                var tmpStr = {};
                var str = "";
                while (convStream.readString(-1, tmpStr)) {
                    str += tmpStr.value;
                }

                // Strip out the timezone definitions, since it makes the file
                // invalid otherwise
                var index = str.indexOf(";TZID=");
                while (index != -1) {
                    var endIndex = str.indexOf(':', index);
                    var otherEnd = str.indexOf(';', index+2);
                    if (otherEnd < endIndex) {
                        endIndex = otherEnd;
                    }
                    var sub = str.substring(index, endIndex);
                    str = str.split(sub).join("");
                    index = str.indexOf(";TZID=");
                }
                var tempFile = gDataMigrator.dirService.get("TmpD", Components.interfaces.nsIFile);
                tempFile.append("icalTemp.ics");
                tempFile.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE,
                                      parseInt("0600", 8));
                var tempUri = Services.io.newFileURI(tempFile);

                var stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                             .createInstance(Components.interfaces.nsIFileOutputStream);
                stream.init(tempFile, 0x2A, parseInt("0600", 8), 0);
                var convStream = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
                                .createInstance(Components.interfaces.nsIConverterOutputStream);
                convStream.init(stream, 'UTF-8', 0, 0x0000);
                convStream.writeString(str);

                var calendar = gDataMigrator.importICSToStorage(tempFile);
                calendar.name = "iCalendar"+i;
                i++;
                calManager.registerCalendar(calendar);
                getCompositeCalendar().addCalendar(calendar);
            }
            migLOG("icalMig making callback");
            aCallback();
        }
        var profileDir = this.dirService.get("ProfD", Components.interfaces.nsILocalFile);
        var icalSpec = profileDir.path;
        var diverge = icalSpec.indexOf("Thunderbird");
        if (diverge == -1) {
            return [];
        }
        icalSpec = icalSpec.substr(0, diverge);
        var icalFile = Components.classes["@mozilla.org/file/local;1"]
                   .createInstance(Components.interfaces.nsILocalFile);
        icalFile.initWithPath(icalSpec);
        icalFile.append("Application Support");

        icalFile.append("iCal");
        if (icalFile.exists()) {
            return [new dataMigrator("Apple iCal", icalMigrate, [icalFile])];
        }

        return [];
    },

    /**
     * Checks to see if Evolution is installed and offers to migrate any data
     * stored there.
     */
    checkEvolution: function gdm_evolution() {
        function evoMigrate(aDataDir, aCallback) {
            var i = 1;
            function evoDataMigrate(dataStore) {
                migLOG("Migrating evolution data file in " + dataStore.path);
                if (dataStore.exists()) {
                    var calendar = gDataMigrator.importICSToStorage(dataStore);
                    calendar.name = "Evolution " + (i++);
                    calManager.registerCalendar(calendar);
                    getCompositeCalendar().addCalendar(calendar);
                }
                return dataStore.exists();
            }

            var calManager = getCalendarManager();
            var dirs = aDataDir.directoryEntries;
            while (dirs.hasMoreElements()) {
                var dataDir = dirs.getNext().QueryInterface(Components.interfaces.nsIFile);
                var dataStore = dataDir.clone();
                dataStore.append("calendar.ics");
                evoDataMigrate(dataStore);
            }

            aCallback();
        }

        var evoDir = this.dirService.get("Home", Components.interfaces.nsILocalFile);
        evoDir.append(".evolution");
        evoDir.append("calendar");
        evoDir.append("local");
        return (evoDir.exists() ? [new dataMigrator("Evolution", evoMigrate, [evoDir])] : []);
    },

    checkWindowsMail: function gdm_windowsMail() {
        function doMigrate(aCalendarNodes, aMailDir, aCallback) {
            let calManager = cal.getCalendarManager();

            for (let node of aCalendarNodes) {
                let name = node.getElementsByTagName("Name")[0].textContent;
                let color = node.getElementsByTagName("Color")[0].textContent;
                let enabled = node.getElementsByTagName("Enabled")[0].textContent == "True";

                // The name is quoted, and the color also contains an alpha
                // value. Lets just ignore the alpha value and take the
                // color part.
                name = name.replace(/(^'|'$)/g, "");
                color = color.replace(/0x[0-9a-fA-F]{2}([0-9a-fA-F]{4})/, "#$1");

                let calfile = aMailDir.clone();
                calfile.append(name + ".ics");

                if (calfile.exists()) {
                    let storage = gDataMigrator.importICSToStorage(calfile)
                    storage.name = name;

                    if (color) {
                        storage.setProperty("color", color);
                    }
                    calManager.registerCalendar(storage);

                    if (enabled) {
                        getCompositeCalendar().addCalendar(storage);
                    }
                }
            }
            aCallback();
        }

        if (!this.dirService.has("LocalAppData")) {
            // We are probably not on windows
            return [];
        }

        let maildir = this.dirService.get("LocalAppData",
                                          Components.interfaces.nsILocalFile);

        maildir.append("Microsoft");
        maildir.append("Windows Calendar");
        maildir.append("Calendars");

        let settingsxml = maildir.clone();
        settingsxml.append("Settings.xml");

        let migrators = [];
        if (settingsxml.exists()) {
            let settingsXmlUri = Services.io.newFileURI(settingsxml);

            let req = new XMLHttpRequest();
            req.open("GET", settingsXmlUri.spec, false);
            req.send(null);
            if (req.status == 0) {
                // The file was found, it seems we are on windows vista.
                let doc = req.responseXML;
                let root = doc.documentElement;

                // Get all calendar property tags and return the migrator.
                let calendars = doc.getElementsByTagName("VCalendar");
                if (calendars.length > 0) {
                    migrators = [new dataMigrator("Windows Calendar", doMigrate.bind(null, calendars, maildir))];
                }
            }
        }
        return migrators;
    },

    /**
     * Creates and registers a storage calendar and imports the given ics file into it.
     *
     * @param icsFile     The nsI(Local)File to import.
     */
    importICSToStorage: function migrateIcsStorage(icsFile) {
        const uri = 'moz-storage-calendar://';
        let calendar = cal.getCalendarManager().createCalendar("storage", makeURL(uri));
        let icsImporter = Components.classes["@mozilla.org/calendar/import;1?type=ics"]
                                    .getService(Components.interfaces.calIImporter);

        let inputStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                                    .createInstance(Components.interfaces.nsIFileInputStream);
        let items = [];

        calendar.id = cal.getUUID();

        try {
            inputStream.init(icsFile, MODE_RDONLY, parseInt("0444", 8), {});
            items = icsImporter.importFromStream(inputStream, {});
        } catch(ex) {
            switch (ex.result) {
                case Components.interfaces.calIErrors.INVALID_TIMEZONE:
                    showError(calGetString("calendar", "timezoneError", [icsFile.path]));
                    break;
                default:
                    showError(calGetString("calendar", "unableToRead") + icsFile.path + "\n"+ ex);
            }
        } finally {
           inputStream.close();
        }

        // Defined in import-export.js
        putItemsIntoCal(calendar, items, icsFile.leafName);

        return calendar;
    },

    /**
     * Helper functions for getting the profile directory of various MozApps
     * (Getting the profile dir is way harder than it should be.)
     *
     * Sunbird:
     *     Unix:     ~jdoe/.mozilla/sunbird/
     *     Windows:  %APPDATA%\Mozilla\Sunbird\Profiles
     *     Mac OS X: ~jdoe/Library/Application Support/Sunbird/Profiles
     *
     * Firefox:
     *     Unix:     ~jdoe/.mozilla/firefox/
     *     Windows:  %APPDATA%\Mozilla\Firefox\Profiles
     *     Mac OS X: ~jdoe/Library/Application Support/Firefox/Profiles
     *
     * Thunderbird:
     *     Unix:     ~jdoe/.thunderbird/
     *     Windows:  %APPDATA%\Thunderbird\Profiles
     *     Mac OS X: ~jdoe/Library/Thunderbird/Profiles
     *
     * Notice that Firefox and Sunbird follow essentially the same pattern, so
     * we group them with getNormalProfile
     */
    getFirefoxProfile: function gdm_getFF() {
        return this.getNormalProfile("Firefox");
    },

    /**
     * @see getFirefoxProfile
     */
    getThunderbirdProfile: function gdm_getTB() {
        let profileRoot = this.dirService.get("DefProfRt", Components.interfaces.nsILocalFile);
        migLOG("searching for Thunderbird in " + profileRoot.path);
        return profileRoot.exists() ? profileRoot : null;
    },

    /**
     * @see getFirefoxProfile
     */
    getSunbirdProfile: function gdm_getSB() {
        return this.getNormalProfile("Sunbird");
    },

    /**
     * Common function to retrieve the profile directory for a given app.
     * @see getFirefoxProfile
     */
    getNormalProfile: function gdm_getNorm(aAppName) {
        var localFile;
        var profileRoot = this.dirService.get("DefProfRt", Components.interfaces.nsILocalFile);
        migLOG("profileRoot = " + profileRoot.path);

        switch (this.mPlatform) {
            case "darwin": // Mac OS X
                localFile = profileRoot.parent.parent;
                localFile.append("Application Support");
                localFile.append(aAppName);
                localFile.append("Profiles");
                break;
            case "winnt":
                localFile = profileRoot.parent.parent;
                localFile.append("Mozilla");
                localFile.append(aAppName);
                localFile.append("Profiles");
                break;
            default: // Unix
                localFile = profileRoot.parent;
                localFile.append(".mozilla");
                localFile.append(aAppName.toLowerCase());
                break;
        }
        migLOG("searching for " + aAppName + " in " + localFile.path);
        return localFile.exists() ? localFile : null;
    }
};

/**
 * logs to system and error console, depending on the calendar.migration.log
 * preference.
 *
 * XXX Use log4moz instead.
 *
 * @param aString   The string to log
 */
function migLOG(aString) {
    if (!Preferences.get("calendar.migration.log", false)) {
        return;
    }
    Services.console.logStringMessage(aString);
    dump(aString+"\n");
}
