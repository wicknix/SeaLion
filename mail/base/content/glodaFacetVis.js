/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Facet visualizations that would be awkward in XBL.  Allegedly because the
 *  interaciton idiom of a protovis-based visualization is entirely different
 *  from XBL, but also a lot because of the lack of good syntax highlighting.
 */

/**
 * A date facet visualization abstraction.
 */
function DateFacetVis(aBinding, aCanvasNode) {
  this.binding = aBinding;
  this.canvasNode = aCanvasNode;

  this.faceter = aBinding.faceter;
  this.attrDef = this.faceter.attrDef;
}
DateFacetVis.prototype = {
  build: function() {
    let resultsBarRect = document.getElementById("results").getBoundingClientRect();
    this.allowedSpace = resultsBarRect.right - resultsBarRect.left;
    this.render();
  },
  rebuild: function() {
    this.render();
  },

  _MIN_BAR_SIZE_PX: 9,
  _BAR_SPACING_PX: 1,

  _MAX_BAR_SIZE_PX: 44,

  _AXIS_FONT: "10px sans-serif",
  _AXIS_HEIGHT_NO_LABEL_PX: 6,
  _AXIS_HEIGHT_WITH_LABEL_PX: 14,
  _AXIS_VERT_SPACING_PX: 1,
  _AXIS_HORIZ_MIN_SPACING_PX: 4,

  _MAX_DAY_COUNT_LABEL_DISPLAY: 10,

  /**
   * Figure out how to chunk things given the linear space in pixels.  In an
   *  ideal world we would not use pixels, avoiding tying ourselves to assumed
   *  pixel densities, but we do not live there.  Reality wants crisp graphics
   *  and does not have enough pixels that you can ignore the pixel coordinate
   *  space and have things still look sharp (and good).
   *
   * Because of our love of sharpness, we will potentially under-use the space
   *  allocated to us.
   *
   * @param aPixels The number of linear content pixels we have to work with.
   *     You are in charge of the borders and such, so you subtract that off
   *     before you pass it in.
   * @return An object with attributes:
   */
  makeIdealScaleGivenSpace: function(aPixels) {
    let facet = this.faceter;
    // build a scale and have it grow the edges based on the span
    let scale = pv.Scales.dateTime(facet.oldest, facet.newest);

    const Span = pv.Scales.DateTimeScale.Span;
    const MS_MIN = 60*1000, MS_HOUR = 60*MS_MIN, MS_DAY = 24*MS_HOUR,
          MS_WEEK = 7*MS_DAY, MS_MONTHISH = 31*MS_DAY, MS_YEARISH = 366*MS_DAY;
    const roughMap = {};
    roughMap[Span.DAYS] = MS_DAY;
    roughMap[Span.WEEKS] = MS_WEEK;
    // we overestimate since we want to slightly underestimate pixel usage
    //  in enoughPix's rough estimate
    roughMap[Span.MONTHS] = MS_MONTHISH;
    roughMap[Span.YEARS] = MS_YEARISH;

    const minBarPix = this._MIN_BAR_SIZE_PX + this._BAR_SPACING_PX;

    let delta = facet.newest.valueOf() - facet.oldest.valueOf();
    let span, rules, barPixBudget;
    // evil side-effect land
    function enoughPix(aSpan) {
      span = aSpan;
      // do a rough guestimate before doing something potentially expensive...
      barPixBudget = Math.floor(aPixels / (delta / roughMap[span]));
      if (barPixBudget < (minBarPix + 1))
        return false;

      rules = scale.ruleValues(span);
      // + 0 because we want to over-estimate slightly for niceness rounding
      //  reasons
      barPixBudget = Math.floor(aPixels / (rules.length + 0));
      delta = scale.max().valueOf() - scale.min().valueOf();
      return barPixBudget > minBarPix;
    }

    // day is our smallest unit
    const ALLOWED_SPANS = [Span.DAYS, Span.WEEKS, Span.MONTHS, Span.YEARS];
    for (let trySpan of ALLOWED_SPANS) {
      if (enoughPix(trySpan)) {
        // do the equivalent of nice() for our chosen span
        scale.min(scale.round(scale.min(), trySpan, false));
        scale.max(scale.round(scale.max(), trySpan, true));
        // try again for paranoia, but mainly for the side-effect...
        if (enoughPix(trySpan))
          break;
      }
    }

    // - Figure out our labeling strategy
    // normalize the symbols into an explicit ordering
    let spandex = ALLOWED_SPANS.indexOf(span);
    // from least-specific to most-specific
    let labelTiers = [];
    // add year spans in all cases, although whether we draw bars depends on if
    //  we are in year mode or not
    labelTiers.push({
      rules: (span == Span.YEARS) ? rules : scale.ruleValues(Span.YEARS, true),
      label: ["%Y", "%y", null], // we should not hit the null case...
      boost: (span == Span.YEARS),
      noFringe: (span == Span.YEARS)
    });
    // add month spans if we are days or weeks...
    if (spandex < 2) {
      labelTiers.push({
        rules: scale.ruleValues(Span.MONTHS, true),
        // try to use the full month, falling back to the short month
        label: ["%B", "%b", null],
        boost: false
      });
    }
    // add week spans if our granularity is days...
    if (span == Span.DAYS) {
      let numDays = delta / MS_DAY;

      // find out how many days we are talking about and add days if it's small
      //  enough, display both the date and the day of the week
      if (numDays <= this._MAX_DAY_COUNT_LABEL_DISPLAY) {
        labelTiers.push({
          rules: rules,
          label: ["%d", null],
          boost: true, noFringe: true
        });
        labelTiers.push({
          rules: rules,
          label: ["%a", null],
          boost: true, noFringe: true
        });
      }
      // show the weeks since we're at greater than a day time-scale
      else {
        labelTiers.push({
          rules: scale.ruleValues(Span.WEEKS, true),
          // labeling weeks is nonsensical; no one understands ISO weeks
          //  numbers.
          label: [null],
          boost: false
        });
      }
    }

    return {
      scale: scale, span: span, rules: rules, barPixBudget: barPixBudget,
      labelTiers: labelTiers
    };
  },

  render: function() {
    let {scale: scale, span: span, rules: rules, barPixBudget: barPixBudget,
         labelTiers: labelTiers} =
      this.makeIdealScaleGivenSpace(this.allowedSpace);

    barPixBudget = Math.floor(barPixBudget);

    let minBarPix = this._MIN_BAR_SIZE_PX + this._BAR_SPACING_PX;
    let maxBarPix = this._MAX_BAR_SIZE_PX + this._BAR_SPACING_PX;

    let barPix = Math.max(minBarPix, Math.min(maxBarPix, barPixBudget));
    let width = barPix * (rules.length - 1);

    let totalAxisLabelHeight = 0;
    let isRTL = window.getComputedStyle(this.binding, null).direction == "rtl";

    // we need to do some font-metric calculations, so create a canvas...
    let fontMetricCanvas = document.createElement("canvas");
    let ctx = fontMetricCanvas.getContext("2d");

    // do the labeling logic,
    for (let labelTier of labelTiers) {
      let labelRules = labelTier.rules;
      let perLabelBudget = width / (labelRules.length - 1);
      for (let labelFormat of labelTier.label) {
        let maxWidth = 0;
        let displayValues = [];
        for (let iRule = 0; iRule < labelRules.length - 1; iRule++) {
          // is this at the either edge of the display?  in that case, it might
          //  be partial...
          let fringe = (labelRules.length > 2) &&
                       ((iRule == 0) || (iRule == labelRules.length - 2));
          let labelStartDate = labelRules[iRule];
          let labelEndDate = labelRules[iRule + 1];
          let labelText = labelFormat ?
                            labelStartDate.toLocaleFormat(labelFormat) : null;
          let labelStartNorm = Math.max(0, scale.normalize(labelStartDate));
          let labelEndNorm = Math.min(1, scale.normalize(labelEndDate));
          let labelBudget = (labelEndNorm - labelStartNorm) * width;
          if (labelText) {
            let labelWidth = ctx.measureText(labelText).width;
            // discard labels at the fringe who don't fit in our budget
            if (fringe && !labelTier.noFringe && labelWidth > labelBudget)
              labelText = null;
            else
              maxWidth = Math.max(labelWidth, maxWidth);
          }

          displayValues.push([labelStartNorm, labelEndNorm, labelText,
                              labelStartDate, labelEndDate]);
        }
        // there needs to be space between the labels.  (we may be over-padding
        //  here if there is only one label with the maximum width...)
        maxWidth += this._AXIS_HORIZ_MIN_SPACING_PX;

        if (labelTier.boost && (maxWidth > perLabelBudget)) {
          // we only boost labels that are the same span as the bins, so rules
          //  === labelRules at this point.  (and barPix === perLabelBudget)
          barPix = perLabelBudget = maxWidth;
          width = barPix * (labelRules.length - 1);
        }
        if (maxWidth <= perLabelBudget) {
          labelTier.displayValues = displayValues;
          labelTier.displayLabel = labelFormat != null;
          labelTier.vertHeight = labelFormat ? this._AXIS_HEIGHT_WITH_LABEL_PX
                                             : this._AXIS_HEIGHT_NO_LABEL_PX;
          labelTier.vertOffset = totalAxisLabelHeight;
          totalAxisLabelHeight += labelTier.vertHeight +
                                  this._AXIS_VERT_SPACING_PX;

          break;
        }
      }
    }

    let barWidth = barPix - this._BAR_SPACING_PX;
    let barSpacing = this._BAR_SPACING_PX;

    width = barPix * (rules.length - 1);
    // we ideally want this to be the same size as the max rows translates to...
    let height = 100;
    let ch = height - totalAxisLabelHeight;

    let [bins, maxBinSize] = this.binBySpan(scale, span, rules);

    // build empty bins for our hot bins
    this.emptyBins = bins.map(bin => 0);

    let binScale = maxBinSize ? (ch / maxBinSize) : 1;

    let vis = this.vis = new pv.Panel().canvas(this.canvasNode)
      // dimensions
      .width(width).height(ch)
      // margins
      .bottom(totalAxisLabelHeight);

    let faceter = this.faceter;
    let dis = this;
    // bin bars...
    vis.add(pv.Bar)
      .data(bins)
      .bottom(0)
      .height(d => Math.floor(d.items.length * binScale))
      .width(() => barWidth)
      .left(function() { return isRTL ? null : (this.index * barPix); })
      .right(function() { return isRTL ? (this.index * barPix) : null; })
      .fillStyle("#add2fb")
      .event("mouseover", function(d) { return this.fillStyle("#3465a4"); })
      .event("mouseout", function(d) { return this.fillStyle("#add2fb"); })
      .event("click", function(d) {
          dis.constraints = [[d.startDate, d.endDate]];
          dis.binding.setAttribute("zoomedout", "false");
          FacetContext.addFacetConstraint(faceter, true, dis.constraints,
                                          true, true);
        }
      );

    this.hotBars = vis.add(pv.Bar)
      .data(this.emptyBins)
      .bottom(0)
      .height(d => Math.floor(d * binScale))
      .width(() => barWidth)
      .left(function() { return this.index * barPix; })
      .fillStyle("#3465a4");

    for (let labelTier of labelTiers) {
      let labelBar = vis.add(pv.Bar)
        .data(labelTier.displayValues)
        .bottom(-totalAxisLabelHeight + labelTier.vertOffset)
        .height(labelTier.vertHeight)
        .left(d => isRTL ? null : Math.floor(width * d[0]))
        .right(d => isRTL ? Math.floor(width * d[0]) : null)
        .width(d => Math.floor(width * d[1]) - Math.floor(width * d[0]) - 1)
        .fillStyle("#dddddd")
        .event("mouseover", function(d) { return this.fillStyle("#3465a4"); })
        .event("mouseout", function(d) { return this.fillStyle("#dddddd"); })
        .event("click", function(d) {
          dis.constraints = [[d[3], d[4]]];
          dis.binding.setAttribute("zoomedout", "false");
          FacetContext.addFacetConstraint(faceter, true, dis.constraints,
                                          true, true)
        });

      if (labelTier.displayLabel) {
        labelBar.anchor("top").add(pv.Label)
          .font(this._AXIS_FONT)
          .textAlign("center")
          .textBaseline("top")
          .textStyle("black")
          .text(d => d[2]);
      }
    }


    vis.render();
  },

  hoverItems: function(aItems) {
    let itemToBin = this.itemToBin;
    let bins = this.emptyBins.concat();
    for (let item of aItems) {
      if (item.id in itemToBin)
        bins[itemToBin[item.id]]++;
    }
    this.hotBars.data(bins);
    this.vis.render();
  },

  clearHover: function() {
    this.hotBars.data(this.emptyBins);
    this.vis.render();
  },

  /**
   * Bin items at the given span granularity with the set of rules generated
   *  for the given span.  This could equally as well be done as a pre-built
   *  array of buckets with a linear scan of items and a calculation of what
   *  bucket they should be placed in.
   */
  binBySpan: function(aScale, aSpan, aRules, aItems) {
    let bins = [];
    let maxBinSize = 0;
    let binCount = aRules.length - 1;
    let itemToBin = this.itemToBin = {};

    // We used to break this out by case, but that was a lot of code, and it was
    //  somewhat ridiculous.  So now we just do the simple, if somewhat more
    //  expensive thing.  Reviewer, feel free to thank me.
    // We do a pass through the rules, mapping each rounded rule to a bin.  We
    //  then do a pass through all of the items, rounding them down and using
    //  that to perform a lookup against the map.  We could special-case the
    //  rounding, but I doubt it's worth it.
    let binMap = {};
    for (let iRule = 0; iRule < binCount; iRule++) {
      let binStartDate = aRules[iRule], binEndDate = aRules[iRule+1];
      binMap[binStartDate.valueOf().toString()] = iRule;
      bins.push({items: [],
                 startDate: binStartDate,
                 endDate: binEndDate});
    }
    let attrKey = this.attrDef.boundName;
    for (let item of this.faceter.validItems) {
      let val = item[attrKey];
      // round it to the rule...
      val = aScale.round(val, aSpan, false);
      // which we can then map...
      let itemBin = binMap[val.valueOf().toString()];
      itemToBin[item.id] = itemBin;
      bins[itemBin].items.push(item);
    }
    for (let bin of bins) {
      maxBinSize = Math.max(bin.items.length, maxBinSize);
    }

    return [bins, maxBinSize];
  }

};
