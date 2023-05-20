/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * This file provides the global context for the faceting environment.  In the
 *  Model View Controller (paradigm), we are the view and the XBL widgets are
 *  the the view and controller.
 *
 * Because much of the work related to faceting is not UI-specific, we try and
 *  push as much of it into mailnews/db/gloda/facet.js.  In some cases we may
 *  get it wrong and it may eventually want to migrate.
 */

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;

Cu.import("resource:///modules/gloda/log4moz.js");
Cu.import("resource:///modules/StringBundle.js");
Cu.import("resource://gre/modules/PluralForm.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource:///modules/errUtils.js");
Cu.import("resource:///modules/templateUtils.js");

Cu.import("resource:///modules/gloda/public.js");
Cu.import("resource:///modules/gloda/facet.js");

var glodaFacetStrings =
  new StringBundle("chrome://messenger/locale/glodaFacetView.properties");

/**
 * Represents the active constraints on a singular facet.  Singular facets can
 *  only have an inclusive set or an exclusive set, but not both.  Non-singular
 *  facets can have both.  Because they are different worlds, non-singular gets
 *  its own class, |ActiveNonSingularConstraint|.
 */
function ActiveSingularConstraint(aFaceter, aRanged) {
  this.faceter = aFaceter;
  this.attrDef = aFaceter.attrDef;
  this.facetDef = aFaceter.facetDef;
  this.ranged = Boolean(aRanged);
  this.clear();
}
ActiveSingularConstraint.prototype = {
  _makeQuery: function() {
    // have the faceter make the query and the invert decision for us if it
    //  implements the makeQuery method.
    if ("makeQuery" in this.faceter) {
      [this.query, this.invertQuery] = this.faceter.makeQuery(this.groupValues,
                                                              this.inclusive);
      return;
    }

    let query = this.query = Gloda.newQuery(Gloda.NOUN_MESSAGE);
    let constraintFunc;
    // If the facet definition references a queryHelper defined by the noun
    //  type, use that instead of the standard constraint function.
    if ("queryHelper" in this.facetDef)
      constraintFunc = query[this.attrDef.boundName +
                             this.facetDef.queryHelper];
    else
      constraintFunc = query[this.ranged ? (this.attrDef.boundName + "Range")
                                         : this.attrDef.boundName];
    constraintFunc.apply(query, this.groupValues);

    this.invertQuery = !this.inclusive;
  },
  /**
   * Adjust the constraint given the incoming faceting constraint desired.
   *  Mainly, if the inclusive flag is the same as what we already have, we
   *  just append the new values to the existing set of values.  If it is not
   *  the same, we replace them.
   *
   * @return true if the caller needs to revalidate their understanding of the
   *     constraint because we have flipped whether we are inclusive or
   *     exclusive and have thrown away some constraints as a result.
   */
  constrain: function(aInclusive, aGroupValues) {
    if (aInclusive == this.inclusive) {
      this.groupValues = this.groupValues.concat(aGroupValues);
      this._makeQuery();
      return false;
    }

    let needToRevalidate = (this.inclusive != null);
    this.inclusive = aInclusive;
    this.groupValues = aGroupValues;
    this._makeQuery();

    return needToRevalidate;
  },
  /**
   * Relax something we previously constrained.  Remove it, some might say.  It
   *  is possible after relaxing that we will no longer be an active constraint.
   *
   * @return true if we are no longer constrained at all.
   */
  relax: function(aInclusive, aGroupValues) {
    if (aInclusive != this.inclusive)
      throw new Error("You can't relax a constraint that isn't possible.");

    for (let groupValue of aGroupValues) {
      let index = this.groupValues.indexOf(groupValue);
      if (index == -1)
        throw new Error("Tried to relax a constraint that was not in force.");
      this.groupValues.splice(index, 1);
    }
    if (this.groupValues.length == 0) {
      this.clear();
      return true;
    }
    this._makeQuery();

    return false;
  },
  /**
   * Indicate whether this constraint is actually doing anything anymore.
   */
  get isConstrained() {
    return this.inclusive != null;
  },
  /**
   * Clear the constraint so that the next call to adjust initializes it.
   */
  clear: function() {
    this.inclusive = null;
    this.groupValues = null;
    this.query = null;
    this.invertQuery = null;
  },
  /**
   * Filter the items against our constraint.
   */
  sieve: function(aItems) {
    let query = this.query;
    let expectedResult = !this.invertQuery;
    return aItems.filter(item => query.test(item) == expectedResult);
  },
  isIncludedGroup: function(aGroupValue) {
    if (!this.inclusive)
      return false;
    return this.groupValues.includes(aGroupValue);
  },
  isExcludedGroup: function(aGroupValue) {
    if (this.inclusive)
      return false;
    return this.groupValues.includes(aGroupValue);
  }
};

function ActiveNonSingularConstraint(aFaceter, aRanged) {
  this.faceter = aFaceter;
  this.attrDef = aFaceter.attrDef;
  this.facetDef = aFaceter.facetDef;
  this.ranged = Boolean(aRanged);

  this.clear();
}
ActiveNonSingularConstraint.prototype = {
  _makeQuery: function(aInclusive, aGroupValues) {
    // have the faceter make the query and the invert decision for us if it
    //  implements the makeQuery method.
    if ("makeQuery" in this.faceter) {
      // returns [query, invertQuery] directly
      return this.faceter.makeQuery(aGroupValues, aInclusive);
    }

    let query = Gloda.newQuery(Gloda.NOUN_MESSAGE);
    let constraintFunc;
    // If the facet definition references a queryHelper defined by the noun
    //  type, use that instead of the standard constraint function.
    if ("queryHelper" in this.facetDef)
      constraintFunc = query[this.attrDef.boundName +
                             this.facetDef.queryHelper];
    else
      constraintFunc = query[this.ranged ? (this.attrDef.boundName + "Range")
                                         : this.attrDef.boundName];
    constraintFunc.apply(query, aGroupValues);

    return [query, false];
  },

  /**
   * Adjust the constraint given the incoming faceting constraint desired.
   *  Mainly, if the inclusive flag is the same as what we already have, we
   *  just append the new values to the existing set of values.  If it is not
   *  the same, we replace them.
   */
  constrain: function(aInclusive, aGroupValues) {
    let groupIdAttr = this.attrDef.objectNounDef.isPrimitive ? null
                        : this.facetDef.groupIdAttr;
    let idMap = aInclusive ? this.includedGroupIds
                           : this.excludedGroupIds;
    let valList = aInclusive ? this.includedGroupValues
                             : this.excludedGroupValues;
    for (let groupValue of aGroupValues) {
      let valId = (groupIdAttr !== null && groupValue != null) ?
                    groupValue[groupIdAttr] : groupValue;
      idMap[valId] = true;
      valList.push(groupValue);
    }

    let [query, invertQuery] = this._makeQuery(aInclusive, valList);
    if (aInclusive && !invertQuery)
      this.includeQuery = query;
    else
      this.excludeQuery = query;

    return false;
  },
  /**
   * Relax something we previously constrained.  Remove it, some might say.  It
   *  is possible after relaxing that we will no longer be an active constraint.
   *
   * @return true if we are no longer constrained at all.
   */
  relax: function(aInclusive, aGroupValues) {
    let groupIdAttr = this.attrDef.objectNounDef.isPrimitive ? null
                        : this.facetDef.groupIdAttr;
    let idMap = aInclusive ? this.includedGroupIds
                           : this.excludedGroupIds;
    let valList = aInclusive ? this.includedGroupValues
                             : this.excludedGroupValues;
    for (let groupValue of aGroupValues) {
      let valId = (groupIdAttr !== null && groupValue != null) ?
                    groupValue[groupIdAttr] : groupValue;
      if (!(valId in idMap))
        throw new Error("Tried to relax a constraint that was not in force.");
      delete idMap[valId];

      let index = valList.indexOf(groupValue);
      valList.splice(index, 1);
    }

    if (valList.length == 0) {
      if (aInclusive)
        this.includeQuery = null;
      else
        this.excludeQuery = null;
    }
    else {
      let [query, invertQuery] = this._makeQuery(aInclusive, valList);
      if (aInclusive && !invertQuery)
        this.includeQuery = query;
      else
        this.excludeQuery = query;
    }

    return this.includeQuery == null && this.excludeQuery == null;
  },
  /**
   * Indicate whether this constraint is actually doing anything anymore.
   */
  get isConstrained() {
    return this.includeQuery == null && this.excludeQuery == null;
  },
  /**
   * Clear the constraint so that the next call to adjust initializes it.
   */
  clear: function() {
    this.includeQuery = null;
    this.includedGroupIds = {};
    this.includedGroupValues = [];

    this.excludeQuery = null;
    this.excludedGroupIds = {};
    this.excludedGroupValues = [];
  },
  /**
   * Filter the items against our constraint.
   */
  sieve: function(aItems) {
    let includeQuery = this.includeQuery;
    let excludeQuery = this.excludeQuery;
    return aItems.filter(item => (!includeQuery || includeQuery.test(item)) &&
                                 (!excludeQuery || !excludeQuery.test(item)));
  },
  isIncludedGroup: function(aGroupValue) {
    let valId = aGroupValue[this.facetDef.groupIdAttr];
    return (valId in this.includedGroupIds);
  },
  isExcludedGroup: function(aGroupValue) {
    let valId = aGroupValue[this.facetDef.groupIdAttr];
    return (valId in this.excludedGroupIds);
  }
};

var FacetContext = {
  facetDriver: new FacetDriver(Gloda.lookupNounDef("message"), window),

  /**
   * The root collection which our active set is a subset of.  We hold onto this
   *  for garbage collection reasons, although the tab that owns us should also
   *  be holding on.
   */
  _collection: null,
  set collection(aCollection) {
    this._collection = aCollection;
  },
  get collection() {
    return this._collection;
  },

  _sortBy: null,
  get sortBy() {
    return this._sortBy;
  },
  set sortBy(val) {
    try {
      if (val == this._sortBy)
        return;
      this._sortBy = val;
      this.build(this._sieveAll());
    } catch (e) {
      logException(e);
    }
  },
  /**
   * List of the current working set
   */
  _activeSet: null,
  get activeSet() {
    return this._activeSet;
  },

  /**
   * fullSet is a special attribute which is passed a set of items that we're
   * displaying, but the order of which is determined by the sortBy property.
   * On setting the fullSet, we compute both sorted lists, and then on getting,
   * we return the appropriate one.
   */
  get fullSet() {
    return (this._sortBy == '-dascore' ?
            this._relevantSortedItems :
            this._dateSortedItems);
  },

  set fullSet(items) {
    let scores;
    if (this.searcher && this.searcher.scores)
      scores = this.searcher.scores;
    else
      scores = Gloda.scoreNounItems(items);
    let scoredItems = items.map(function(item, index) { return [scores[index], item]; });
    scoredItems.sort((a, b) => b[0]-a[0]);
    this._relevantSortedItems = scoredItems.map(scoredItem => scoredItem[1]);

    this._dateSortedItems =
      this._relevantSortedItems.concat().sort((a, b) => b.date-a.date);
  },

  initialBuild: function() {
    let queryExplanation = document.getElementById("query-explanation");
    if (this.searcher)
      queryExplanation.setFulltext(this.searcher);
    else
      queryExplanation.setQuery(this.collection.query);
    // we like to sort them so should clone the list
    this.faceters = this.facetDriver.faceters.concat();

    this._timelineShown = !Services.prefs.getBoolPref("gloda.facetview.hidetimeline");

    this.everFaceted = false;
    this._activeConstraints = {};
    if (this.searcher)
      this._sortBy = '-dascore';
    else
      this._sortBy = '-date';
    this.fullSet = this._removeDupes(this._collection.items.concat());
    if ("IMCollection" in this)
      this.fullSet = this.fullSet.concat(this.IMCollection.items);
    this.build(this.fullSet);
  },

  /**
   * Remove duplicate messages from search results.
   *
   * @param aItems the initial set of messages to deduplicate
   * @return the subset of those, with duplicates removed.
   *
   * Some IMAP servers (here's looking at you, Gmail) will create message
   * duplicates unbeknownst to the user.  We'd like to deal with them earlier
   * in the pipeline, but that's a bit hard right now.  So as a workaround
   * we'd rather not show them in the Search Results UI.  The simplest way
   * of doing that is just to cull (from the display) messages with have the
   * Message-ID of a message already displayed.
   */
  _removeDupes: function(aItems) {
    let deduped = [];
    let msgIdsSeen = {};
    for (let item of aItems) {
      if (item.headerMessageID in msgIdsSeen)
        continue;
      deduped.push(item);
      msgIdsSeen[item.headerMessageID] = true;
    }
    return deduped;
  },

  /**
   * Kick-off a new faceting pass.
   *
   * @param aNewSet the set of items to facet.
   * @param aCallback the callback to invoke when faceting is completed.
   */
  build: function(aNewSet, aCallback) {
    this._activeSet = aNewSet;
    this._callbackOnFacetComplete = aCallback;
    this.facetDriver.go(this._activeSet, this.facetingCompleted, this);
  },

  /**
   * Attempt to figure out a reasonable number of rows to limit each facet to
   *  display.  While the number will ordinarily be dominated by the maximum
   *  number of rows we believe the user can easily scan, this may also be
   *  impacted by layout concerns (since we want to avoid scrolling).
   */
  planLayout: function() {
    // XXX arbitrary!
    this.maxDisplayRows = 8;
    this.maxMessagesToShow = 10;
  },

  /**
   * Clean up the UI in preparation for a new query to come in.
   */
  _resetUI: function() {
    for (let faceter of this.faceters) {
      if (faceter.xblNode && !faceter.xblNode.explicit)
        faceter.xblNode.remove();
      faceter.xblNode = null;
      faceter.constraint = null;
    }
  },

  _groupCountComparator: function(a, b) {
    return b.groupCount - a.groupCount;
  },
  /**
   * Tells the UI about all the facets when notified by the |facetDriver| when
   *  it is done faceting everything.
   */
  facetingCompleted: function() {
    this.planLayout();

    let uiFacets = document.getElementById("facets");

    if (!this.everFaceted) {
      this.everFaceted = true;
      this.faceters.sort(this._groupCountComparator);
      for (let faceter of this.faceters) {
        let attrName = faceter.attrDef.attributeName;
        let explicitBinding = document.getElementById("facet-" + attrName);

        if (explicitBinding) {
          explicitBinding.explicit = true;
          explicitBinding.faceter = faceter;
          explicitBinding.attrDef = faceter.attrDef;
          explicitBinding.facetDef = faceter.facetDef;
          explicitBinding.nounDef = faceter.attrDef.objectNounDef;
          explicitBinding.orderedGroups = faceter.orderedGroups;
          // explicit booleans should always be displayed for consistency
          if (faceter.groupCount >= 1 ||
              (explicitBinding.getAttribute("type").includes("boolean"))) {
            try {
              explicitBinding.build(true);
            } catch (e) {
              logObject(explicitBinding);
              logException(e);
            }
            explicitBinding.removeAttribute("uninitialized");
          }
          faceter.xblNode = explicitBinding;
          continue;
        }

        // ignore facets that do not vary!
        if (faceter.groupCount <= 1) {
          faceter.xblNode = null;
          continue;
        }

        faceter.xblNode = uiFacets.addFacet(faceter.type, faceter.attrDef, {
          faceter: faceter,
          facetDef: faceter.facetDef,
          orderedGroups: faceter.orderedGroups,
          maxDisplayRows: this.maxDisplayRows,
          explicit: false
        });
      }
    }
    else {
      for (let faceter of this.faceters) {
        // Do not bother with un-displayed facets, or that are locked by a
        //  constraint.  But do bother if the widget can be updated without
        //  losing important data.
        if (!faceter.xblNode ||
            (faceter.constraint && !faceter.xblNode.canUpdate))
          continue;

        // hide things that have 0/1 groups now and are not constrained and not
        //  explicit
        if (faceter.groupCount <= 1 && !faceter.constraint &&
            (!faceter.xblNode.explicit || faceter.type == "date"))
          faceter.xblNode.style.display = "none";
        // otherwise, update
        else {
          faceter.xblNode.orderedGroups = faceter.orderedGroups;
          faceter.xblNode.build(false);
          faceter.xblNode.style.display = "block";
        }
      }
    }

    if (! this._timelineShown)
      this._hideTimeline(true);

    this._showResults();

    if (this._callbackOnFacetComplete) {
      let callback = this._callbackOnFacetComplete;
      this._callbackOnFacetComplete = null;
      callback();
    }
  },

  _showResults: function()
  {
    let results = document.getElementById("results");
    let numMessageToShow = Math.min(this.maxMessagesToShow * this._numPages,
                                    this._activeSet.length);
    results.setMessages(this._activeSet.slice(0, numMessageToShow));

    let showLoading = document.getElementById("showLoading");
    showLoading.style.display = "none"; /* hide spinner, we're done thinking */

    let showEmpty = document.getElementById("showEmpty");
    let dateToggle = document.getElementById("date-toggle");
    /* check for no messages at all */
    if (this._activeSet.length == 0) {
      showEmpty.style.display = "block";
      dateToggle.style.display = "none";
    }
    else {
      showEmpty.style.display = "none";
      dateToggle.style.display = "block";
    }

    let showMore = document.getElementById("showMore");
    if (this._activeSet.length > numMessageToShow)
      showMore.style.display = "block";
    else
      showMore.style.display = "none";
  },

  showMore: function() {
    this._numPages += 1;
    this._showResults();
    let results = document.getElementById("results");
  },


  zoomOut: function() {
    let facetDate = document.getElementById('facet-date');
    this.removeFacetConstraint(facetDate.faceter, true, facetDate.vis.constraints)
    facetDate.setAttribute("zoomedout", "true");
  },

  toggleTimeline: function() {
    try {
      this._timelineShown = ! this._timelineShown;
      if (this._timelineShown)
        this._showTimeline();
      else
        this._hideTimeline(false);
    } catch (e) {
      logException(e);
    }
  },

  _showTimeline: function() {
    let facetDate = document.getElementById("facet-date");
    if (facetDate.style.display == "none") {
      facetDate.style.display = "inherit";
      // Force binding attachment so the transition to the
      // visible state actually happens.
      facetDate.getBoundingClientRect();
    }
    let listener = () => {
      // Need to set overflow to visible so that the zoom button
      // is not cut off at the top, and overflow=hidden causes
      // the transition to not work as intended.
      facetDate.removeAttribute("style");
    };
    facetDate.addEventListener("transitionend", listener, {once: true});
    facetDate.removeAttribute("hide");
    document.getElementById("date-toggle").removeAttribute("tucked");
    Services.prefs.setBoolPref("gloda.facetview.hidetimeline", false);
  },

  _hideTimeline: function(immediate) {
    let facetDate = document.getElementById("facet-date");
    if (immediate)
      facetDate.style.display = "none";
    facetDate.style.overflow = "hidden";
    facetDate.setAttribute("hide", "true");
    document.getElementById("date-toggle").setAttribute("tucked", "true");
    Services.prefs.setBoolPref("gloda.facetview.hidetimeline", true);
  },

  _timelineShown: true,

  /** For use in hovering specific results. */
  fakeResultFaceter: {},
  /** For use in hovering specific results. */
  fakeResultAttr: {},

  _numPages: 1,
  _HOVER_STABILITY_DURATION_MS: 100,
  _brushedFacet: null,
  _brushedGroup: null,
  _brushedItems: null,
  _brushTimeout: null,
  hoverFacet: function(aFaceter, aAttrDef, aGroupValue, aGroupItems) {
    // bail if we are already brushing this item
    if (this._brushedFacet == aFaceter && this._brushedGroup == aGroupValue)
      return;

    this._brushedFacet = aFaceter;
    this._brushedGroup = aGroupValue;
    this._brushedItems = aGroupItems;

    if (this._brushTimeout != null)
      clearTimeout(this._brushTimeout);
    this._brushTimeout = setTimeout(this._timeoutHoverWrapper,
                                    this._HOVER_STABILITY_DURATION_MS, this);

  },
  _timeoutHover: function() {
    this._brushTimeout = null;
    for (let faceter of this.faceters) {
      if (faceter == this._brushedFacet || !faceter.xblNode)
        continue;

      if (this._brushedItems != null)
        faceter.xblNode.brushItems(this._brushedItems);
      else
        faceter.xblNode.clearBrushedItems();
    }
  },
  _timeoutHoverWrapper: function(aThis) {
    aThis._timeoutHover();
  },
  unhoverFacet: function(aFaceter, aAttrDef, aGroupValue, aGroupItems) {
    // have we already brushed from some other source already?  ignore then.
    if (this._brushedFacet != aFaceter || this._brushedGroup != aGroupValue)
      return;

    // reuse hover facet to null everyone out
    this.hoverFacet(null, null, null, null);
  },

  /**
   * Maps attribute names to their corresponding |ActiveConstraint|, if they
   *  have one.
   */
  _activeConstraints: null,
  /**
   * Called by facet bindings when the user does some clicking and wants to
   *  impose a new constraint.
   *
   * @param aFaceter The faceter that is the source of this constraint.  We
   *     need to know this because once a facet has a constraint attached,
   *     the UI stops updating it.
   * @param {Boolean} aInclusive Is this an inclusive (true) or exclusive
   *     (false) constraint?  The constraint instance is the one that deals with
   *     the nuances resulting from this.
   * @param aGroupValues A list of the group values this constraint covers.  In
   *     general, we expect that only one group value will be present in the
   *     list since this method should get called each time the user clicks
   *     something.  Previously, we provided support for an "other" case which
   *     covered multiple groupValues so a single click needed to be able to
   *     pass in a list.  The "other" case is gone now, but semantically it's
   *     okay for us to support a list.
   * @param [aRanged] Is it a ranged constraint?  (Currently only for dates)
   * @param [aNukeExisting] Do we need to replace the existing constraint and
   *     re-sieve everything?  This currently only happens for dates, where
   *     our display allows a click to actually make our range more generic
   *     than it currently is.  (But this only matters if we already have
   *     a date constraint applied.)
   * @param [aCallback] The callback to call once (re-)faceting has completed.
   *
   * @return true if the caller needs to revalidate because the constraint has
   *     changed in a way other than explicitly requested.  This can occur if
   *     a singular constraint flips its inclusive state and throws away
   *     constraints.
   */
  addFacetConstraint: function(aFaceter, aInclusive, aGroupValues,
                               aRanged, aNukeExisting, aCallback) {
    let attrName = aFaceter.attrDef.attributeName;

    let constraint;
    let needToSieveAll = false;
    if (attrName in this._activeConstraints) {
      constraint = this._activeConstraints[attrName];

      needToSieveAll = true;
      if (aNukeExisting)
        constraint.clear();
    }
    else {
      let constraintClass = aFaceter.attrDef.singular ? ActiveSingularConstraint
                              : ActiveNonSingularConstraint;
      constraint = this._activeConstraints[attrName] =
        new constraintClass(aFaceter, aRanged);
      aFaceter.constraint = constraint;
    }
    let needToRevalidate = constraint.constrain(aInclusive, aGroupValues);

    // Given our current implementation, we can only be further constraining our
    //  active set, so we can just sieve the existing active set with the
    //  (potentially updated) constraint.  In some cases, it would be much
    //  cheaper to use the facet's knowledge about the items in the groups, but
    //  for now let's keep a single code-path for how we refine the active set.
    this.build(needToSieveAll ? this._sieveAll()
                              : constraint.sieve(this.activeSet),
               aCallback);

    return needToRevalidate;
  },

  /**
   * Remove a constraint previously imposed by addFacetConstraint.  The
   *  constraint must still be active, which means you need to pay attention
   *  when |addFacetConstraint| returns true indicating that you need to
   *  revalidate.
   *
   * @param aFaceter
   * @param aInclusive Whether the group values were previously included /
   *     excluded.  If you want to remove some values that were included and
   *     some that were excluded then you need to call us once for each case.
   * @param aGroupValues The list of group values to remove.
   * @param aCallback The callback to call once all facets have been updated.
   *
   * @return true if the constraint has been completely removed.  Under the
   *     current regime, this will likely cause the binding that is calling us
   *     to be rebuilt, so be aware if you are trying to do any cool animation
   *     that might no longer make sense.
   */
  removeFacetConstraint: function(aFaceter, aInclusive, aGroupValues,
                                  aCallback) {
    let attrName = aFaceter.attrDef.attributeName;
    let constraint = this._activeConstraints[attrName];

    let constraintGone = false;

    if (constraint.relax(aInclusive, aGroupValues)) {
      delete this._activeConstraints[attrName];
      aFaceter.constraint = null;
      constraintGone = true;
    }

    // we definitely need to re-sieve everybody in this case...
    this.build(this._sieveAll(), aCallback);

    return constraintGone;
  },

  /**
   * Sieve the items from the underlying collection against all constraints,
   *  returning the value.
   */
  _sieveAll: function() {
    let items = this.fullSet;

    for (let elem in this._activeConstraints) {
      items = this._activeConstraints[elem].sieve(items);
    }

    return items;
  },

  toggleFulltextCriteria: function() {
    this.tab.searcher.andTerms = !this.tab.searcher.andTerms;
    this._resetUI();
    this.collection = this.tab.searcher.getCollection(this);
  },

  /**
   * Show the active message set in a glodaList tab.
   */
  showActiveSetInTab: function() {
    let tabmail = this.rootWin.document.getElementById("tabmail");
    tabmail.openTab("glodaList", {
      collection: Gloda.explicitCollection(Gloda.NOUN_MESSAGE, this.activeSet),
      title: this.tab.title
    });
  },

  /**
   * Show the conversation in a new glodaList tab.
   *
   * @param {glodaFacetBindings.xml#result-message} aResultMessage The
   *     result the user wants to see in more details.
   * @param {Boolean} [aBackground] Whether it should be in the background.
   */
  showConversationInTab: function(aResultMessage, aBackground) {
    let tabmail = this.rootWin.document.getElementById("tabmail");
    let message = aResultMessage.message;
    if ("IMCollection" in this &&
        message instanceof Gloda.lookupNounDef("im-conversation").clazz) {
      tabmail.openTab("chat", {
        convType: "log",
        conv: message,
        searchTerm: aResultMessage.firstMatchText,
        background: aBackground
      });
      return;
    }
    tabmail.openTab("glodaList", {
      conversation: message.conversation,
      message: message,
      title: message.conversation.subject,
      background: aBackground
    });
  },

  /**
   * Show the message in a new tab.
   *
   * @param {GlodaMessage} aMessage The message to show.
   * @param {Boolean} [aBackground] Whether it should be in the background.
   */
  showMessageInTab: function(aMessage, aBackground) {
    let tabmail = this.rootWin.document.getElementById("tabmail");
    let msgHdr = aMessage.folderMessage;
    if (!msgHdr)
      throw new Error("Unable to translate gloda message to message header.");
    tabmail.openTab("message", {
      msgHdr: msgHdr,
      background: aBackground
    });
  },

  onItemsAdded: function(aItems, aCollection) {
  },
  onItemsModified: function(aItems, aCollection) {
  },
  onItemsRemoved: function(aItems, aCollection) {
  },
  onQueryCompleted: function(aCollection) {
    if (this.tab.query.completed &&
        (!("IMQuery" in this.tab) || this.tab.IMQuery.completed))
      this.initialBuild();
  }
};

/**
 * addEventListener betrayals compel us to establish our link with the
 *  outside world from inside.  NeilAway suggests the problem might have
 *  been the registration of the listener prior to initiating the load.  Which
 *  is odd considering it works for the XUL case, but I could see how that might
 *  differ.  Anywho, this works for now and is a delightful reference to boot.
 */
function reachOutAndTouchFrame() {
  let us = window.QueryInterface(Ci.nsIInterfaceRequestor)
                 .getInterface(Ci.nsIWebNavigation)
                 .QueryInterface(Ci.nsIDocShellTreeItem);

  FacetContext.rootWin = us.rootTreeItem
                    .QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIDOMWindow);

  let parentWin = us.parent
                    .QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIDOMWindow);
  let aTab = FacetContext.tab = parentWin.tab;
  parentWin.tab = null;
  window.addEventListener("resize", function() {
    document.getElementById("facet-date").build(true);
  });
  // we need to hook the context up as a listener in all cases since
  //  removal notifications are required.
  if ("searcher" in aTab) {
    FacetContext.searcher = aTab.searcher;
    aTab.searcher.listener = FacetContext;
    if ("IMSearcher" in aTab) {
      FacetContext.IMSearcher = aTab.IMSearcher;
      aTab.IMSearcher.listener = FacetContext;
    }
  }
  else {
    FacetContext.searcher = null;
    aTab.collection.listener = FacetContext;
  }
  FacetContext.collection = aTab.collection;
  if ("IMCollection" in aTab)
    FacetContext.IMCollection = aTab.IMCollection;

  // if it has already completed, we need to prod things
  if (aTab.query.completed && (!("IMQuery" in aTab) || aTab.IMQuery.completed))
    FacetContext.initialBuild();
}

function clickOnBody(event) {
  if (event.bubbles) {
    document.getElementById('popup-menu').hide();
  }
  return 0;
}
