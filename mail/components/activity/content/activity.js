/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

////////////////////////////////////////////////////////////////////////////////
//// Globals

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/PluralForm.jsm");
Components.utils.import("resource:///modules/gloda/log4moz.js");

var nsActProcess = Components.Constructor("@mozilla.org/activity-process;1",
                                            "nsIActivityProcess", "init");
var nsActEvent = Components.Constructor("@mozilla.org/activity-event;1",
                                          "nsIActivityEvent", "init");
var nsActWarning = Components.Constructor("@mozilla.org/activity-warning;1",
                                            "nsIActivityWarning", "init");
var ACTIVITY_LIMIT = 250;

var activityObject =
{

  _activityMgrListener: null,
  _activitiesView: null,
  _activityLogger: Log4Moz.getConfiguredLogger("activitymgr"),
  _ignoreNotifications: false,
  _groupCache: new Map(),

  selectAll: function() {
    this._activitiesView.selectAll();
  },

  //////////////////////////////////////////////////////////////////////////////
  //// An object to monitor nsActivityManager operations. This class acts as
  //// binding layer between nsActivityManager and nsActivityManagerUI objects.

  /**
   * Note: The prototype for this function is set at the bottom of this file.
   */
  ActivityMgrListener: function() {},

  //////////////////////////////////////////////////////////////////////////////
  //// Utility Functions for Activity binding management

  /**
   * Creates the proper binding for the given activity
   */
  createActivityBinding: function(aActivity) {
    let bindingName = aActivity.bindingName;
    let binding = document.createElement(bindingName);

    if (binding)
      binding.setAttribute('actID', aActivity.id);

    return binding;
  },

  /**
   * Returns the activity group binding that matches the context_type
   * and context of the given activity, if any.
   */
  getActivityGroupBindingByContext: function(aContextType, aContextObj) {
    return this._groupCache.get(aContextType + ":" + aContextObj);
  },

  /**
   * Inserts the given binding into the correct position on the
   * activity manager window.
   */
  placeActivityBinding: function(aBinding) {
    if (aBinding.isGroup || aBinding.isProcess)
      this._activitiesView.insertBefore(aBinding,
                                        this._activitiesView.firstChild);
    else {
      let next = this._activitiesView.firstChild;
      while (next && (next.isWarning || next.isProcess || next.isGroup))
        next = next.nextSibling;
      if (next)
        this._activitiesView.insertBefore(aBinding, next);
      else
        this._activitiesView.appendChild(aBinding);
    }
    if (aBinding.isGroup)
      this._groupCache.set(aBinding.contextType + ":" + aBinding.contextObj,
                           aBinding);
    while (this._activitiesView.childNodes.length > ACTIVITY_LIMIT)
      this.removeActivityBinding(this._activitiesView.lastChild.getAttribute('actID'));
  },

  /**
   * Adds a new binding to activity manager window for the
   * given activity. It is called by ActivityMgrListener when
   * a new activity is added into the activity manager's internal
   * list.
   */
  addActivityBinding: function(aID, aActivity) {
    try {
      this._activityLogger.info("Adding ActivityBinding: " + aID + ", " +
                                aActivity)
      // get |groupingStyle| of the activity. Grouping style determines
      // whether we show the activity standalone or grouped by context in
      // the activity manager window.
      let isGroupByContext = (aActivity.groupingStyle ==
                              Components.interfaces.nsIActivity
                                        .GROUPING_STYLE_BYCONTEXT);

      // find out if an activity group has already been created for this context
      let group = null;
      if (isGroupByContext) {
        group = this.getActivityGroupBindingByContext(aActivity.contextType,
                                                 aActivity.contextObj);
        // create a group if it's not already created.
        if (!group) {
          group = document.createElement("activity-group");
          this._activityLogger.info("created group element")
          // Set the context type and object of the newly created group
          group.contextType = aActivity.contextType;
          group.contextObj = aActivity.contextObj;
          group.contextDisplayText = aActivity.contextDisplayText;

          // add group into the list
          this.placeActivityBinding(group);
        }
      }

      // create the appropriate binding for the activity
      let actBinding = this.createActivityBinding(aActivity);
      this._activityLogger.info("created activity binding")

      if (group) {
        // get the inner list element of the group
        let groupView = document.getAnonymousElementByAttribute(group, "anonid",
                                                           "activityGroupView");
        groupView.appendChild(actBinding);
      }
      else {
        this.placeActivityBinding(actBinding);
      }
    } catch (e) {
      this._activityLogger.error("addActivityBinding: " + e);
      throw(e);
    }
  },

  /**
   * Removes the activity binding from the activity manager window.
   * It is called by ActivityMgrListener when the activity in question
   * is removed from the activity manager's internal list.
   */
  removeActivityBinding: function(aID) {
    // Note: document.getAnonymousNodes(_activitiesView); didn't work
    this._activityLogger.info("removing Activity ID: " + aID);
    let activities = this._activitiesView.childNodes;
    for (let i = 0; i < activities.length; i++) {
      let item = activities[i];
      if (!item) {
        this._activityLogger.debug("returning as empty")
        return;
      }

      if (!item.isGroup) {
        this._activityLogger.debug("is not a group, ")
        if (item.getAttribute('actID') == aID) {
          // since XBL dtors are not working properly when we remove the
          // element, we have to explicitly remove the binding from
          // activities' listeners list. See bug 230086 for details.
          item.detachFromActivity();
          item.remove();
          break;
        }
      }
      else {
        let actbinding = document.getAnonymousElementByAttribute(item, 'actID',
                                                                 aID);
        if (actbinding) {
          let groupView = document.getAnonymousElementByAttribute(item,
                                                 "anonid", "activityGroupView");
          // since XBL dtors are not working properly when we remove the
          // element, we have to explicitly remove the binding from
          // activities' listeners list. See bug 230086 for details.
          actbinding.detachFromActivity();
          actbinding.remove();

          // if the group becomes empty after the removal,
          // get rid of the group as well
          if (groupView.getRowCount() == 0) {
            this._groupCache.delete(item.contextType + ":" + item.contextObj);
            item.remove();
          }

          break;
        }
      }
    }
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Startup, Shutdown

  startup: function() {
    try {
      this._activitiesView = document.getElementById("activityView");

      let activityManager = Components
                         .classes["@mozilla.org/activity-manager;1"]
                         .getService(Components.interfaces.nsIActivityManager);
      let activities = activityManager.getActivities({});
      for (let iActivity = Math.max(0, activities.length - ACTIVITY_LIMIT);
           iActivity < activities.length; iActivity++) {
        let activity = activities[iActivity];
        this.addActivityBinding(activity.id, activity);
      }

      // start listening changes in the activity manager's
      // internal list
      this._activityMgrListener = new this.ActivityMgrListener();
      activityManager.addListener(this._activityMgrListener);

    } catch (e) {
      this._activityLogger.error("Exception: " + e )
    }
  },

  rebuild: function() {
    let activityManager = Components.classes["@mozilla.org/activity-manager;1"]
      .getService(Components.interfaces.nsIActivityManager);
    let activities = activityManager.getActivities({});
    for (let activity of activities)
      this.addActivityBinding(activity.id, activity);
  },

  shutdown: function() {
    let activityManager = Components.classes["@mozilla.org/activity-manager;1"]
      .getService(Components.interfaces.nsIActivityManager);
    activityManager.removeListener(this._activityMgrListener);
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Utility Functions

  /**
   * Remove all activities not in-progress from the activity list.
   */
  clearActivityList: function() {
    this._activityLogger.debug("clearActivityList");

    this._ignoreNotifications = true;
    // If/when we implement search, we'll want to remove just the items
    // that are on the search display, however for now, we'll just clear up
    // everything.
    Components.classes["@mozilla.org/activity-manager;1"]
              .getService(Components.interfaces.nsIActivityManager)
              .cleanUp();

    // since XBL dtors are not working properly when we remove the element,
    // we have to explicitly remove the binding from activities' listeners
    // list. See bug 230086 for details.
    let activities = this._activitiesView.childNodes;
    for (let i = activities.length - 1; i >= 0; i--) {
      let item = activities[i];
      if (!item.isGroup)
        item.detachFromActivity();
      else {
        let actbinding = document.getAnonymousElementByAttribute(item,
                                                                 'actID', '*');
        while (actbinding) {
          actbinding.detachFromActivity();
          actbinding.remove();
          actbinding = document.getAnonymousElementByAttribute(item,
                                                               'actID', '*');
        }
      }
    }

    let empty = this._activitiesView.cloneNode(false);
    this._activitiesView.parentNode.replaceChild(empty, this._activitiesView);
    this._activitiesView = empty;

    this._groupCache.clear();
    this.rebuild();
    this._ignoreNotifications = false;
    this._activitiesView.focus();
  },

  processKeyEvent: function(event) {
    switch (event.keyCode) {
      case event.DOM_VK_RIGHT:
        if (event.target.tagName == 'richlistbox') {
          let richlistbox = event.target.selectedItem.processes;
          if (richlistbox.tagName == 'xul:richlistbox') {
            richlistbox.focus();
            richlistbox.selectItem(richlistbox.getItemAtIndex(0));
          }
        }
        break;
      case event.DOM_VK_LEFT:
        if (event.target.tagName == 'activity-group') {
          var parent = event.target.parentNode;
          if (parent.tagName == 'richlistbox') {
            event.target.processes.clearSelection();
            parent.selectItem(event.target);
            parent.focus();
          }
        }
        break;
    }
  },
};

activityObject.ActivityMgrListener.prototype = {

  onAddedActivity: function(aID, aActivity) {
    activityObject._activityLogger.info("added activity: " + aID + " " +
                                        aActivity)
    if (!activityObject._ignoreNotifications)
      activityObject.addActivityBinding(aID, aActivity);
  },

  onRemovedActivity: function(aID) {
    if (!activityObject._ignoreNotifications)
      activityObject.removeActivityBinding(aID);
  }
};
