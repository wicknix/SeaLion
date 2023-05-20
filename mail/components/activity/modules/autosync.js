/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ['autosyncModule'];

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;

var nsActProcess = Components.Constructor("@mozilla.org/activity-process;1",
                                            "nsIActivityProcess", "init");
var nsActEvent = Components.Constructor("@mozilla.org/activity-event;1",
                                          "nsIActivityEvent", "init");
var nsActWarning = Components.Constructor("@mozilla.org/activity-warning;1",
                                            "nsIActivityWarning", "init");

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/PluralForm.jsm");
Components.utils.import("resource:///modules/gloda/log4moz.js");

var nsIAutoSyncMgrListener = Components.interfaces.nsIAutoSyncMgrListener;

/**
 * This code aims to mediate between the auto-sync code and the activity mgr.
 *
 * Not every auto-sync activity is directly  mapped to a process or event.
 * To prevent a possible event overflow, Auto-Sync monitor generates one
 * sync'd event per account when after all its _pending_ folders are sync'd,
 * rather than generating one event per folder sync.
 */

var autosyncModule =
{

  _inQFolderList : [],
  _running : false,
  _syncInfoPerFolder: new Map(),
  _syncInfoPerServer: new Map(),
  _lastMessage: new Map(),

  get log() {
    delete this.log;
    return this.log = Log4Moz.getConfiguredLogger("autosyncActivities");
  },

  get activityMgr() {
    delete this.activityMgr;
    return this.activityMgr = Cc["@mozilla.org/activity-manager;1"]
                                .getService(Ci.nsIActivityManager);
  },

  get autoSyncManager() {
    delete this.autoSyncManager;
    return this.autoSyncManager = Cc["@mozilla.org/imap/autosyncmgr;1"]
                                    .getService(Ci.nsIAutoSyncManager);
  },

  get bundle() {
    delete this.bundle;
    return this.bundle = Services.strings
      .createBundle("chrome://messenger/locale/activity.properties");
  },

  getString: function(stringName) {
    try {
      return this.bundle.GetStringFromName(stringName)
    } catch (e) {
      this.log.error("error trying to get a string called: " + stringName);
      throw(e);
    }
  },

  createSyncMailProcess : function(folder) {
    try {
      // create an activity process for this folder
      let msg = this.bundle.formatStringFromName("autosyncProcessDisplayText",
                                                 [folder.prettiestName], 1)
      let process = new nsActProcess(msg, this.autoSyncManager);
      // we want to use default auto-sync icon
      process.iconClass = "syncMail";
      process.addSubject(folder);
      // group processes under folder's imap account
      process.contextType = "account";
      process.contextDisplayText = this.bundle.formatStringFromName("autosyncContextDisplayText",
                                        [folder.server.prettyName], 1)


      process.contextObj = folder.server;

      return process;
    } catch (e) {
      this.log.error("createSyncMailProcess: " + e);
      throw(e);
    }
  },

  createSyncMailEvent : function(syncItem) {
    try {
      // extract the relevant parts
      let process = syncItem.activity;
      let folder = syncItem.syncFolder;

      // create an activity event

      let msg = this.bundle.formatStringFromName("autosyncEventDisplayText",
                                                 [folder.server.prettyName], 1);

      let statusMsg;
      let numOfMessages = this._syncInfoPerServer.get(folder.server).totalDownloads;
      if (numOfMessages)
        statusMsg = this.bundle.formatStringFromName("autosyncEventStatusText",
                                                     [numOfMessages], 1);
      else
        statusMsg = this.getString("autosyncEventStatusTextNoMsgs");

      let event = new nsActEvent(msg, this.autoSyncManager, statusMsg,
                                 this._syncInfoPerServer.get(folder.server).startTime,
                                 Date.now());               // completion time

      // since auto-sync events do not have undo option by nature,
      // setting these values are informational only.
      event.contextType = process.contextType;
      event.contextDisplayText = this.bundle.formatStringFromName("autosyncContextDisplayText",
                                        [folder.server.prettyName], 1)
      event.contextObj = process.contextObj;
      event.iconClass = "syncMail";

      // transfer all subjects.
      // same as above, not mandatory
      let subjects = process.getSubjects({});
      for (let subject of subjects)
        event.addSubject(subject);

      return event;
    } catch (e) {
      this.log.error("createSyncMailEvent: " + e);
      throw(e);
    }
  },

  onStateChanged : function(running) {
    try {
      this._running = running;
      this.log.info("OnStatusChanged: " + (running ? "running" : "sleeping") + "\n");
    } catch (e) {
      this.log.error("onStateChanged: " + e);
      throw(e);
    }
  },

  onFolderAddedIntoQ : function(queue, folder) {
    try {
      if (folder instanceof Components.interfaces.nsIMsgFolder &&
          queue == nsIAutoSyncMgrListener.PriorityQueue) {
        this._inQFolderList.push(folder);
        this.log.info("Auto_Sync OnFolderAddedIntoQ [" + this._inQFolderList.length + "] " +
                        folder.prettiestName + " of " + folder.server.prettyName);
        // create an activity process for this folder
        let process = this.createSyncMailProcess(folder);

        // create a sync object to keep track of the process of this folder
        let imapFolder = folder.QueryInterface(Components.interfaces.nsIMsgImapMailFolder);
        let syncItem = { syncFolder: folder,
                         activity: process,
                         percentComplete: 0,
                         totalDownloaded: 0,
                         pendingMsgCount: imapFolder.autoSyncStateObj.pendingMessageCount
                       };

        // if this is the first folder of this server in the queue, then set the sync start time
        // for activity event
        if (!this._syncInfoPerServer.has(folder.server)) {
          this._syncInfoPerServer.set(folder.server, { startTime: Date.now(),
                                                       totalDownloads: 0
                                                     });
        }

        // associate the sync object with the folder in question
        // use folder.URI as key
        this._syncInfoPerFolder.set(folder.URI, syncItem);
      }
    } catch (e) {
      this.log.error("onFolderAddedIntoQ: " + e);
      throw(e);
    }
  },
  onFolderRemovedFromQ : function(queue, folder) {
    try {
      if (folder instanceof Components.interfaces.nsIMsgFolder &&
          queue == nsIAutoSyncMgrListener.PriorityQueue) {
        let i = this._inQFolderList.indexOf(folder);
        if (i > -1)
          this._inQFolderList.splice(i, 1);

        this.log.info("OnFolderRemovedFromQ [" + this._inQFolderList.length + "] " +
                        folder.prettiestName + " of " + folder.server.prettyName + "\n");

        let syncItem = this._syncInfoPerFolder.get(folder.URI);
        let process = syncItem.activity;
        let canceled = false;
        if (process instanceof Components.interfaces.nsIActivityProcess)
        {
          canceled = (process.state == Components.interfaces.nsIActivityProcess.STATE_CANCELED);
          process.state = Components.interfaces.nsIActivityProcess.STATE_COMPLETED;

          try {
            this.activityMgr.removeActivity(process.id);
          }
          catch(e) {
            // It is OK to end up here; If the folder is queued and the
            // message get manually downloaded by the user, we might get
            // a folder removed notification even before a donwload
            // started for this folder. This behavior stems from the fact
            // that we add activities into the activity manager in
            // onDownloadStarted notification rather than onFolderAddedIntoQ.
            // This is an expected side effect.
          }

          // remove the folder/syncItem association from the table
          this._syncInfoPerFolder.delete(folder.URI);
        }

        // if this is the last folder of this server in the queue
        // create a sync event and clean the sync start time
        let found = false;
        for (let value of this._syncInfoPerFolder.values())
        {
          if (value.syncFolder.server == folder.server)
          {
            found = true;
            break;
          }
        }
        this.log.info("Auto_Sync OnFolderRemovedFromQ Last folder of the server: " + !found);
        if (!found) {
          // create an sync event for the completed process if it's not canceled
          if (!canceled) {
            let key = folder.server.prettyName;
            if (this._lastMessage.has(key) &&
                this.activityMgr.containsActivity(this._lastMessage.get(key)))
              this.activityMgr.removeActivity(this._lastMessage.get(key));
            this._lastMessage.set(key, this.activityMgr
              .addActivity(this.createSyncMailEvent(syncItem)));
          }
          this._syncInfoPerServer.delete(folder.server);
        }
      }
    } catch (e) {
      this.log.error("onFolderRemovedFromQ: " + e);
      throw(e);
    }
  },
  onDownloadStarted : function(folder, numOfMessages, totalPending) {
    try {
      if (folder instanceof Components.interfaces.nsIMsgFolder) {
        this.log.info("OnDownloadStarted (" + numOfMessages + "/" + totalPending + "): " +
                                folder.prettiestName + " of " + folder.server.prettyName + "\n");

        let syncItem = this._syncInfoPerFolder.get(folder.URI);
        let process = syncItem.activity;

        // Update the totalPending number. if new messages have been discovered in the folder
        // after we added the folder into the q, totalPending might be greater than what we have
        // initially set
        if (totalPending > syncItem.pendingMsgCount)
          syncItem.pendingMsgCount = totalPending;

        if (process instanceof Components.interfaces.nsIActivityProcess) {
          // if the process has not beed added to activity manager already, add now
          if (!this.activityMgr.containsActivity(process.id)) {
            this.log.info("Auto_Sync OnDownloadStarted: No process, adding a new process");
            this.activityMgr.addActivity(process);
          }

          syncItem.totalDownloaded += numOfMessages;

          process.state = Components.interfaces.nsIActivityProcess.STATE_INPROGRESS;
          let percent = (syncItem.totalDownloaded/syncItem.pendingMsgCount)*100;
          if (percent > syncItem.percentComplete)
            syncItem.percentComplete = percent;

          let msg = this.bundle.formatStringFromName("autosyncProcessProgress",
                                                 [syncItem.totalDownloaded,
                                                  syncItem.pendingMsgCount,
                                                  folder.prettiestName], 3);

          process.setProgress(msg, numOfMessages, totalPending);

          let serverInfo = this._syncInfoPerServer.get(syncItem.syncFolder.server);
          serverInfo.totalDownloads += numOfMessages;
          this._syncInfoPerServer.set(syncItem.syncFolder.server, serverInfo);
        }
      }
    } catch (e) {
      this.log.error("onDownloadStarted: " + e);
      throw(e);
    }
  },

  onDownloadCompleted : function(folder) {
    try {
      if (folder instanceof Components.interfaces.nsIMsgFolder) {
        this.log.info("OnDownloadCompleted: " + folder.prettiestName + " of " +
                      folder.server.prettyName);

        let process = this._syncInfoPerFolder.get(folder.URI).activity;
        if (process instanceof Components.interfaces.nsIActivityProcess &&
           !this._running) {
          this.log.info("OnDownloadCompleted: Auto-Sync Manager is paused, pausing the process");
          process.state = Components.interfaces.nsIActivityProcess.STATE_PAUSED;
        }
      }
    } catch (e) {
      this.log.error("onDownloadCompleted: " + e);
      throw(e);
    }
  },

  onDownloadError : function(folder) {
    if (folder instanceof Components.interfaces.nsIMsgFolder) {
      this.log.error("OnDownloadError: " + folder.prettiestName + " of " +
                     folder.server.prettyName + "\n");
    }
  },

  onDiscoveryQProcessed : function (folder, numOfHdrsProcessed, leftToProcess) {
    this.log.info("onDiscoveryQProcessed: Processed " + numOfHdrsProcessed + "/" +
                  (leftToProcess+numOfHdrsProcessed) + " of " + folder.prettiestName + "\n");
  },

  onAutoSyncInitiated : function (folder) {
      this.log.info("onAutoSyncInitiated: " + folder.prettiestName + " of " +
                    folder.server.prettyName + " has been updated.\n");
  },

  init: function() {
    // XXX when do we need to remove ourselves?
    this.log.info('initing');
    Components.classes["@mozilla.org/imap/autosyncmgr;1"]
      .getService(Components.interfaces.nsIAutoSyncManager).addListener(this);
  },
}
