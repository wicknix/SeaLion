/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["itemDiff"];

Components.utils.import("resource://calendar/modules/calHashedArray.jsm");

/**
 * Given two sets of items, find out which items were added, changed or
 * removed.
 *
 * The general flow is to first use load/load1 methods to load the engine with
 * the first set of items, then use difference/difference1 to load the set of
 * items to diff against. Afterwards, call the complete method to tell the
 * engine that no more items are coming.
 *
 * You can then access the mAddedItems/mModifiedItems/mDeletedItems attributes to
 * get the items that were changed during the process.
 */
function itemDiff() {
    this.reset();
}

itemDiff.prototype = {
    STATE_INITIAL: 1,
    STATE_LOADING: 2,
    STATE_DIFFERING: 4,
    STATE_COMPLETED: 8,

    state: 1,
    mInitialItems: null,

    mModifiedItems: null,
    mModifiedOldItems: null,
    mAddedItems: null,
    mDeletedItems: null,

    /**
     * Expect the difference engine to be in the given state.
     *
     * @param aState    The state to be in
     * @param aMethod   The method name expecting the state
     */
    _expectState: function(aState, aMethod) {
        if ((this.state & aState) == 0) {
            throw new Error("itemDiff method " + aMethod +
                            " called while in unexpected state " + this.state);
        }
    },

    /**
     * Load the difference engine with one item, see load.
     *
     * @param item      The item to load
     */
    load1: function(item) {
        this.load([item]);
    },

    /**
     * Loads an array of items. This step cannot be executed
     * after calling the difference methods.
     *
     * @param items     The array of items to load
     */
    load: function(items) {
        this._expectState(this.STATE_INITIAL | this.STATE_LOADING, "load");

        for (let item of items) {
            this.mInitialItems[item.hashId] = item;
        }

        this.state = this.STATE_LOADING;
    },

    /**
     * Calculates the difference for the passed item, see difference.
     *
     * @param item      The item to calculate difference with
     */
    difference1: function(item) {
        this.difference([item]);
    },

    /**
     * Calculate the difference for the array of items. This method should be
     * called after all load methods and before the complete method.
     *
     * @param items     The array of items to calculate difference with
     */
    difference: function(items) {
        this._expectState(this.STATE_INITIAL | this.STATE_LOADING | this.STATE_DIFFERING, "difference");

        this.mModifiedOldItems.startBatch();
        this.mModifiedItems.startBatch();
        this.mAddedItems.startBatch();

        for (let item of items) {
            if (item.hashId in this.mInitialItems) {
                let oldItem = this.mInitialItems[item.hashId];
                this.mModifiedOldItems.addItem(oldItem);
                this.mModifiedItems.addItem(item);
            } else {
                this.mAddedItems.addItem(item);
            }
            delete this.mInitialItems[item.hashId];
        }

        this.mModifiedOldItems.endBatch();
        this.mModifiedItems.endBatch();
        this.mAddedItems.endBatch();

        this.state = this.STATE_DIFFERING;
    },

    /**
     * Tell the engine that all load and difference calls have been made, this
     * makes sure that all item states are correctly returned.
     */
    complete: function() {
        this._expectState(this.STATE_INITIAL | this.STATE_LOADING | this.STATE_DIFFERING, "complete");

        this.mDeletedItems.startBatch();

        for (let hashId in this.mInitialItems) {
            let item = this.mInitialItems[hashId];
            this.mDeletedItems.addItem(item);
        }

        this.mDeletedItems.endBatch();
        this.mInitialItems = {};

        this.state = this.STATE_COMPLETED;
    },

    /** @return a HashedArray containing the new version of the modified items */
    get modifiedItems() {
        this._expectState(this.STATE_COMPLETED, "get modifiedItems");
        return this.mModifiedItems;
    },

    /** @return a HashedArray containing the old version of the modified items */
    get modifiedOldItems() {
        this._expectState(this.STATE_COMPLETED, "get modifiedOldItems");
        return this.mModifiedOldItems;
    },

    /** @return a HashedArray containing added items */
    get addedItems() {
        this._expectState(this.STATE_COMPLETED, "get addedItems");
        return this.mAddedItems;
    },

    /** @return a HashedArray containing deleted items */
    get deletedItems() {
        this._expectState(this.STATE_COMPLETED, "get deletedItems");
        return this.mDeletedItems;
    },

    /** @return the number of loaded items */
    get count() {
        return Object.keys(this.mInitialItems).length;
    },

    /**
     * Resets the difference engine to its initial state.
     */
    reset: function() {
        this.mInitialItems = {};
        this.mModifiedItems = new cal.HashedArray();
        this.mModifiedOldItems = new cal.HashedArray();
        this.mAddedItems = new cal.HashedArray();
        this.mDeletedItems = new cal.HashedArray();
        this.state = this.STATE_INITIAL;
    }
};
