/* -*- Mode: Javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const FEEDWRITER_CID = Components.ID("{49bb6593-3aff-4eb3-a068-2712c28bd58e}");
const FEEDWRITER_CONTRACTID = "@mozilla.org/browser/feeds/result-writer;1";

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const TYPE_MAYBE_FEED = "application/vnd.mozilla.maybe.feed";
const TYPE_MAYBE_AUDIO_FEED = "application/vnd.mozilla.maybe.audio.feed";
const TYPE_MAYBE_VIDEO_FEED = "application/vnd.mozilla.maybe.video.feed";
const STRING_BUNDLE_URI = "chrome://communicator/locale/feeds/subscribe.properties";
const FEEDHANDLER_URI = "about:feeds";

const PREF_SELECTED_APP = "browser.feeds.handlers.application";
const PREF_SELECTED_WEB = "browser.feeds.handlers.webservice";
const PREF_SELECTED_ACTION = "browser.feeds.handler";
const PREF_SELECTED_READER = "browser.feeds.handler.default";

const PREF_VIDEO_SELECTED_APP = "browser.videoFeeds.handlers.application";
const PREF_VIDEO_SELECTED_WEB = "browser.videoFeeds.handlers.webservice";
const PREF_VIDEO_SELECTED_ACTION = "browser.videoFeeds.handler";
const PREF_VIDEO_SELECTED_READER = "browser.videoFeeds.handler.default";

const PREF_AUDIO_SELECTED_APP = "browser.audioFeeds.handlers.application";
const PREF_AUDIO_SELECTED_WEB = "browser.audioFeeds.handlers.webservice";
const PREF_AUDIO_SELECTED_ACTION = "browser.audioFeeds.handler";
const PREF_AUDIO_SELECTED_READER = "browser.audioFeeds.handler.default";

const PREF_SHOW_FIRST_RUN_UI = "browser.feeds.showFirstRunUI";

const TITLE_ID = "feedTitleText";
const SUBTITLE_ID = "feedSubtitleText";

function getPrefAppForType(t) {
  switch (t) {
    case Components.interfaces.nsIFeed.TYPE_VIDEO:
      return PREF_VIDEO_SELECTED_APP;

    case Components.interfaces.nsIFeed.TYPE_AUDIO:
      return PREF_AUDIO_SELECTED_APP;

    default:
      return PREF_SELECTED_APP;
  }
}

function getPrefWebForType(t) {
  switch (t) {
    case Components.interfaces.nsIFeed.TYPE_VIDEO:
      return PREF_VIDEO_SELECTED_WEB;

    case Components.interfaces.nsIFeed.TYPE_AUDIO:
      return PREF_AUDIO_SELECTED_WEB;

    default:
      return PREF_SELECTED_WEB;
  }
}

function getPrefActionForType(t) {
  switch (t) {
    case Components.interfaces.nsIFeed.TYPE_VIDEO:
      return PREF_VIDEO_SELECTED_ACTION;

    case Components.interfaces.nsIFeed.TYPE_AUDIO:
      return PREF_AUDIO_SELECTED_ACTION;

    default:
      return PREF_SELECTED_ACTION;
  }
}

function getPrefReaderForType(t) {
  switch (t) {
    case Components.interfaces.nsIFeed.TYPE_VIDEO:
      return PREF_VIDEO_SELECTED_READER;

    case Components.interfaces.nsIFeed.TYPE_AUDIO:
      return PREF_AUDIO_SELECTED_READER;

    default:
      return PREF_SELECTED_READER;
  }
}

function LOG(str) {
  try {
    if (Services.prefs.getBoolPref("feeds.log"))
      dump("*** Feeds: " + str + "\n");
  }
  catch (ex) {
  }
}

function safeGetCharPref(pref, defaultValue) {
  try {
    return Services.prefs.getCharPref(pref);
  }
  catch (e) {
  }
  return defaultValue;
}

/**
 * Wrapper function for nsIIOService::newURI.
 * @param aURLSpec
 *        The URL string from which to create an nsIURI.
 * @returns an nsIURI object, or null if the creation of the URI failed.
 */
function makeURI(aURLSpec, aCharset) {
  try {
    return Services.io.newURI(aURLSpec, aCharset, null);
  } catch (ex) {
  }

  return null;
}

/**
 * Converts a number of bytes to the appropriate unit that results in a
 * number that needs fewer than 4 digits
 *
 * @return a pair: [new value with 3 sig. figs., its unit]
  */
function convertByteUnits(aBytes) {
  var units = ["bytes", "kilobytes", "megabytes", "gigabytes"];
  var unitIndex = 0;

  // convert to next unit if it needs 4 digits (after rounding), but only if
  // we know the name of the next unit
  while ((aBytes >= 999.5) && (unitIndex < units.length - 1)) {
    aBytes /= 1024;
    unitIndex++;
  }

  // Get rid of insignificant bits by truncating to 1 or 0 decimal points
  // 0 -> 0; 1.2 -> 1.2; 12.3 -> 12.3; 123.4 -> 123; 234.5 -> 235
  aBytes = aBytes.toFixed((aBytes > 0) && (aBytes < 100) ? 1 : 0);

  return [aBytes, units[unitIndex]];
}

function FeedWriter() {
  this._mimeSvc = Components.classes["@mozilla.org/mime;1"]
                            .getService(Components.interfaces.nsIMIMEService);
}

FeedWriter.prototype = {
  _getPropertyAsBag: function getPropertyAsBag(container, property) {
    return container.fields.getProperty(property)
                    .QueryInterface(Components.interfaces.nsIPropertyBag2);
  },

  _getPropertyAsString: function getPropertyAsString(container, property) {
    try {
      return container.fields.getPropertyAsAString(property);
    }
    catch (e) {
    }
    return "";
  },

  /**
   * @param   element
   *          The element to add the text content to.
   * @param   text
   *          An nsIFeedTextConstruct
   */
  _setContentText: function setContentText(element, text) {
    if (typeof element == "string")
      element = this._document.getElementById(element);

    // Takes the content of the nsIFeedTextConstruct and creates a
    // sanitized documentFragment.
    var docFragment = text.createDocumentFragment(element);
    element.innerHTML = "";
    element.appendChild(docFragment);
    if (text.base)
      element.setAttributeNS(XML_NS, "base", text.base.spec);
  },

  /**
   * Safely sets the href attribute on an anchor tag, providing the URI
   * specified can be loaded according to rules.
   * @param   element
   *          The element to set a URI attribute on
   * @param   attribute
   *          The attribute of the element to set the URI to, e.g. href or src
   * @param   uri
   *          The URI spec to set as the href
   */
  _safeSetURIAttribute: function safeSetURIAttribute(element, attribute, uri) {
    const flags = Components.interfaces.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL;
    try {
      Services.scriptSecurityManager.checkLoadURIStrWithPrincipal(this._feedPrincipal, uri, flags);
      // checkLoadURIStrWithPrincipal will throw if the link URI should not be
      // loaded, either because our feedURI isn't allowed to load it or per
      // the rules specified in |flags|, so we'll never "linkify" the link...
      element.setAttribute(attribute, uri);
    }
    catch (e) {
      // Not allowed to load this link because checkLoadURIStrWithPrincipal threw
    }
  },

  __faviconService: null,
  get _faviconService() {
    if (!this.__faviconService)
      this.__faviconService = Components.classes["@mozilla.org/browser/favicon-service;1"]
                                        .getService(Components.interfaces.mozIAsyncFavicons);

    return this.__faviconService;
  },

  __bundle: null,
  get _bundle() {
    if (!this.__bundle) {
      this.__bundle = Services.strings.createBundle(STRING_BUNDLE_URI);
    }

    return this.__bundle;
  },

  _getFormattedString: function getFormattedString(key, params) {
    return this._bundle.formatStringFromName(key, params, params.length);
  },

  _getString: function getString(key) {
    try {
      return this._bundle.GetStringFromName(key);
    } catch(e) {
      LOG("Couldn't retrieve key from bundle");
    }

    return null;
  },

  /* Magic helper methods to be used instead of xbl properties */
  _getSelectedItemFromMenulist: function getSelectedItemFromList(aList) {
    return aList.getElementsByAttribute("selected", "true").item(0);
  },

  _setCheckboxCheckedState: function setCheckboxCheckedState(aCheckbox, aValue) {
    // see checkbox.xml, xbl bindings are not visible through xrays!
    var change = (aValue != (aCheckbox.getAttribute('checked') == 'true'));
    if (aValue)
      aCheckbox.setAttribute("checked", "true");
    else
      aCheckbox.removeAttribute("checked");

    if (change) {
      aCheckbox.dispatchEvent(new this._document.defaultView.Event(
          "CheckboxStateChange", { bubbles: true, cancelable: true }));
    }
  },

   /**
   * Returns a date suitable for displaying in the feed preview.
   * If the date cannot be parsed, the return value is "null".
   * @param   dateString
   *          A date as extracted from a feed entry. (entry.updated)
   */
  _parseDate: function parseDate(dateString) {
    // Make sure the date we're given is valid.
    if (isNaN(Date.parse(dateString)))
      return null;

    // Convert the date into the user's local time zone.
    var dateObj = new Date(dateString);
    var dateService = Components.classes["@mozilla.org/intl/scriptabledateformat;1"]
                                .getService(Components.interfaces.nsIScriptableDateFormat);
    return dateService.FormatDateTime("", dateService.dateFormatLong, dateService.timeFormatNoSeconds,
                                      dateObj.getFullYear(), dateObj.getMonth()+1, dateObj.getDate(),
                                      dateObj.getHours(), dateObj.getMinutes(), dateObj.getSeconds());
  },

  /**
   * Returns the feed type.
   */
  __feedType: null,
  _getFeedType: function getFeedType() {
    if (this.__feedType != null)
      return this.__feedType;

    try {
      // grab the feed because it's got the feed.type in it.
      var container = this._getContainer();
      var feed = container.QueryInterface(Components.interfaces.nsIFeed);
      this.__feedType = feed.type;
      return feed.type;
    } catch (ex) {
    }

    return Components.interfaces.nsIFeed.TYPE_FEED;
  },

  /**
   * Maps a feed type to a maybe-feed mimetype.
   */
  _getMimeTypeForFeedType: function getMimeTypeForFeedType() {
    switch (this._getFeedType()) {
      case Components.interfaces.nsIFeed.TYPE_VIDEO:
        return TYPE_MAYBE_VIDEO_FEED;

      case Components.interfaces.nsIFeed.TYPE_AUDIO:
        return TYPE_MAYBE_AUDIO_FEED;

      default:
        return TYPE_MAYBE_FEED;
    }
  },

  /**
   * Writes the feed title into the preview document.
   * @param   container
   *          The feed container, an nsIFeedContainer
   */
  _setTitleText: function setTitleText(container) {
    if (container.title) {
      this._setContentText(TITLE_ID, container.title);
      this._document.title = container.title.plainText();
    }

    var feed = container.QueryInterface(Components.interfaces.nsIFeed);
    if (feed && feed.subtitle)
      this._setContentText(SUBTITLE_ID, feed.subtitle);
  },

  /**
   * Writes the title image into the preview document if one is present.
   * @param   container
   *          The feed container
   */
  _setTitleImage: function setTitleImage(container) {
    try {
      var parts = container.image;

      // Set up the title image (supplied by the feed)
      var feedTitleImage = this._document.getElementById("feedTitleImage");
      this._safeSetURIAttribute(feedTitleImage, "src",
                                parts.getPropertyAsAString("url"));

      // Set up the title image link
      var feedTitleLink = this._document.getElementById("feedTitleLink");

      var titleText = this._getFormattedString("linkTitleTextFormat",
                                               [parts.getPropertyAsAString("title")]);
      feedTitleLink.setAttribute("title", titleText);
      var titleImageWidth = parseInt(parts.getPropertyAsAString("width")) + 15;
      feedTitleLink.style.MozMarginEnd = titleImageWidth + "px";

      this._safeSetURIAttribute(feedTitleLink, "href",
                                parts.getPropertyAsAString("link"));
    }
    catch (e) {
      LOG("Failed to set Title Image (this is benign): " + e);
    }
  },

  /**
   * Writes all entries contained in the feed.
   * @param   container
   *          The container of entries in the feed
   */
  _writeFeedContent: function writeFeedContent(container) {
    // Build the actual feed content
    var feed = container.QueryInterface(Components.interfaces.nsIFeed);
    if (feed.items.length == 0)
      return;

    var feedContent = this._document.getElementById("feedContent");

    for (let i = 0; i < feed.items.length; ++i) {
      let entry = feed.items.queryElementAt(i, Components.interfaces.nsIFeedEntry);
      entry.QueryInterface(Components.interfaces.nsIFeedContainer);

      let entryContainer = this._document.createElementNS(HTML_NS, "div");
      entryContainer.className = "entry";

      // If the entry has a title, make it a link
      if (entry.title) {
        let a = this._document.createElementNS(HTML_NS, "a");
        let span = this._document.createElementNS(HTML_NS, "span");
        a.appendChild(span);
        this._setContentText(span, entry.title);

        // Entries are not required to have links, so entry.link can be null.
        if (entry.link)
          this._safeSetURIAttribute(a, "href", entry.link.spec);

        let title = this._document.createElementNS(HTML_NS, "h3");
        title.appendChild(a);

        let lastUpdated = this._parseDate(entry.updated);
        if (lastUpdated) {
          let dateDiv = this._document.createElementNS(HTML_NS, "div");
          dateDiv.className = "lastUpdated";
          dateDiv.textContent = lastUpdated;
          title.appendChild(dateDiv);
        }

        entryContainer.appendChild(title);
      }

      var body = this._document.createElementNS(HTML_NS, "div");
      var summary = entry.summary || entry.content;
      var docFragment = null;
      if (summary) {
        if (summary.base)
          body.setAttributeNS(XML_NS, "base", summary.base.spec);
        else
          LOG("no base?");
        docFragment = summary.createDocumentFragment(body);
        if (docFragment)
          body.appendChild(docFragment);

        // If the entry doesn't have a title, append a # permalink
        // See http://scripting.com/rss.xml for an example
        if (!entry.title && entry.link) {
          var a = this._document.createElementNS(HTML_NS, "a");
          a.appendChild(this._document.createTextNode("#"));
          this._safeSetURIAttribute(a, "href", entry.link.spec);
          body.appendChild(this._document.createTextNode(" "));
          body.appendChild(a);
        }

      }
      body.className = "feedEntryContent";
      entryContainer.appendChild(body);

      if (entry.enclosures && entry.enclosures.length > 0) {
        var enclosuresDiv = this._buildEnclosureDiv(entry);
        entryContainer.appendChild(enclosuresDiv);
      }

      feedContent.appendChild(entryContainer);

      var clearDiv = this._document.createElementNS(HTML_NS, "div");
      clearDiv.style.clear = "both";
      feedContent.appendChild(clearDiv);
    }
  },

  /**
   * Takes a url to a media item and returns the best name it can come up with.
   * Frequently this is the filename portion (e.g. passing in
   * http://example.com/foo.mpeg would return "foo.mpeg"), but in more complex
   * cases, this will return the entire url (e.g. passing in
   * http://example.com/somedirectory/ would return
   * http://example.com/somedirectory/).
   * @param aURL
   *        The URL string from which to create a display name
   * @returns a string
   */
  _getURLDisplayName: function getURLDisplayName(aURL) {
    var url = makeURI(aURL);

    if ((url instanceof Components.interfaces.nsIURL) && url.fileName)
      return decodeURIComponent(url.fileName);
    return aURL;
  },

  /**
   * Takes a FeedEntry with enclosures, generates the HTML code to represent
   * them, and returns that.
   * @param   entry
   *          FeedEntry with enclosures
   * @returns element
   */
  _buildEnclosureDiv: function buildEnclosureDiv(entry) {
    var enclosuresDiv = this._document.createElementNS(HTML_NS, "div");
    enclosuresDiv.className = "enclosures";

    enclosuresDiv.appendChild(this._document.createTextNode(this._getString("mediaLabel")));

    for (let i_enc = 0; i_enc < entry.enclosures.length; ++i_enc) {
      let enc = entry.enclosures.queryElementAt(i_enc, Components.interfaces.nsIWritablePropertyBag2);

      if (!(enc.hasKey("url")))
        continue;

      let enclosureDiv = this._document.createElementNS(HTML_NS, "div");
      enclosureDiv.setAttribute("class", "enclosure");

      let mozicon = "moz-icon://.txt?size=16";
      let type_text = null;
      let size_text = null;

      if (enc.hasKey("type")) {
        type_text = enc.get("type");
        try {
          let handlerInfoWrapper = this._mimeSvc.getFromTypeAndExtension(enc.get("type"), null);

          if (handlerInfoWrapper)
            type_text = handlerInfoWrapper.description;

          if  (type_text && type_text.length > 0)
            mozicon = "moz-icon://goat?size=16&contentType=" + enc.get("type");

        } catch (ex) {
        }

      }

      if (enc.hasKey("length") && /^[0-9]+$/.test(enc.get("length"))) {
        let enc_size = convertByteUnits(parseInt(enc.get("length")));

        let size_text = this._getFormattedString("enclosureSizeText",
                             [enc_size[0], this._getString(enc_size[1])]);
      }

      let iconimg = this._document.createElementNS(HTML_NS, "img");
      iconimg.setAttribute("src", mozicon);
      iconimg.setAttribute("class", "type-icon");
      enclosureDiv.appendChild(iconimg);

      enclosureDiv.appendChild(this._document.createTextNode( " " ));

      let enc_href = this._document.createElementNS(HTML_NS, "a");
      enc_href.appendChild(this._document.createTextNode(this._getURLDisplayName(enc.get("url"))));
      this._safeSetURIAttribute(enc_href, "href", enc.get("url"));
      enclosureDiv.appendChild(enc_href);

      if (type_text && size_text)
        enclosureDiv.appendChild(this._document.createTextNode( " (" + type_text + ", " + size_text + ")"));

      else if (type_text)
        enclosureDiv.appendChild(this._document.createTextNode( " (" + type_text + ")"))

      else if (size_text)
        enclosureDiv.appendChild(this._document.createTextNode( " (" + size_text + ")"))

      enclosuresDiv.appendChild(enclosureDiv);
    }

    return enclosuresDiv;
  },

  /**
   * Gets a valid nsIFeedContainer object from the parsed nsIFeedResult.
   * Displays error information if there was one.
   * @param   result
   *          The parsed feed result
   * @returns A valid nsIFeedContainer object containing the contents of
   *          the feed.
   */
  _getContainer: function getContainer(result) {
    var feedService = Components.classes["@mozilla.org/browser/feeds/result-service;1"]
                                .getService(Components.interfaces.nsIFeedResultService);

    try {
      var result = feedService.getFeedResult(this._getOriginalURI(this._window));

      if (result.bozo) {
        LOG("Subscribe Preview: feed result is bozo?!");
      }
    }
    catch (e) {
      LOG("Subscribe Preview: feed not available?!");
    }

    try {
      var container = result.doc;
    }
    catch (e) {
      LOG("Subscribe Preview: no result.doc? Why didn't the original reload?");
      return null;
    }
    return container;
  },

  /**
   * Get the human-readable display name of a file. This could be the
   * application name.
   * @param   file
   *          A nsIFile to look up the name of
   * @returns The display name of the application represented by the file.
   */
  _getFileDisplayName: function getFileDisplayName(file) {
    if ("nsILocalFileWin" in Components.interfaces &&
        file instanceof Components.interfaces.nsILocalFileWin) {
      try {
        return file.getVersionInfoField("FileDescription");
      } catch (e) {}
    }
    else if ("nsILocalFileMac" in Components.interfaces &&
             file instanceof Components.interfaces.nsILocalFileMac) {
      try {
        return file.bundleDisplayName;
      } catch (e) {}
    }
    return file.leafName;
  },

  /**
   * Get moz-icon url for a file
   * @param   file
   *          A nsIFile object for which the moz-icon:// is returned
   * @returns moz-icon url of the given file as a string
   */
  _getFileIconURL: function getFileIconURL(file) {
    var fph = Services.io.getProtocolHandler("file")
                      .QueryInterface(Components.interfaces.nsIFileProtocolHandler);
    var urlSpec = fph.getURLSpecFromFile(file);
    return "moz-icon://" + urlSpec + "?size=16";
  },

  /**
   * Helper method to set the selected application and system default
   * reader menuitems details from a file object
   *   @param aMenuItem
   *          The menuitem on which the attributes should be set
   *   @param aFile
   *          The menuitem's associated file
   */
  _initMenuItemWithFile: function(aMenuItem, aFile) {
    aMenuItem.setAttribute("label", this._getFileDisplayName(aFile));
    aMenuItem.setAttribute("image", this._getFileIconURL(aFile));
  },

  /**
   * Helper method to get an element in the XBL binding where the handler
   * selection UI lives
   */
  _getUIElement: function getUIElement(id) {
    return this._document.getAnonymousElementByAttribute(
      this._document.getElementById("feedSubscribeLine"), "anonid", id);
  },

  /**
   * Displays a prompt from which the user may choose a (client) feed reader.
   * @return - true if a feed reader was selected, false otherwise.
   */
  _chooseClientApp: function chooseClientApp() {
    try {
      var fp = Components.classes["@mozilla.org/filepicker;1"]
                         .createInstance(Components.interfaces.nsIFilePicker);
      fp.init(this._window,
              this._getString("chooseApplicationDialogTitle"),
              Components.interfaces.nsIFilePicker.modeOpen);
      fp.appendFilters(Components.interfaces.nsIFilePicker.filterApps);

      if (fp.show() == Components.interfaces.nsIFilePicker.returnOK) {
        this._selectedApp = fp.file;
        if (this._selectedApp) {
          var file = Services.dirsvc.get("XREExeF", Components.interfaces.nsILocalFile);
          if (fp.file.leafName != file.leafName) {
            this._initMenuItemWithFile(this._selectedAppMenuItem,
                                       this._selectedApp);

            // Show and select the selected application menuitem
            this._selectedAppMenuItem.hidden = false;
            this._selectedAppMenuItem.doCommand();
            return true;
          }
        }
      }
    }
    catch(ex) {
    }

    return false;
  },

  _setAlwaysUseCheckedState: function setAlwaysUseCheckedState(feedType) {
    var checkbox = this._getUIElement("alwaysUse");
    if (checkbox) {
      var alwaysUse = (safeGetCharPref(getPrefActionForType(feedType), "ask") != "ask");
      this._setCheckboxCheckedState(checkbox, alwaysUse);
    }
  },

  _setSubscribeUsingLabel: function setSubscribeUsingLabel() {
    var stringLabel = "subscribeFeedUsing";
    switch (this._getFeedType()) {
      case Components.interfaces.nsIFeed.TYPE_VIDEO:
        stringLabel = "subscribeVideoPodcastUsing";
        break;

      case Components.interfaces.nsIFeed.TYPE_AUDIO:
        stringLabel = "subscribeAudioPodcastUsing";
        break;
    }

    var subscribeUsing = this._getUIElement("subscribeUsingDescription");
    subscribeUsing.setAttribute("value", this._getString(stringLabel));
  },

  _setAlwaysUseLabel: function setAlwaysUseLabel() {
    var checkbox = this._getUIElement("alwaysUse");
    if (checkbox) {
      if (this._handlersMenuList) {
        var handlerName = this._getSelectedItemFromMenulist(this._handlersMenuList)
                              .getAttribute("label");
        var stringLabel = "alwaysUseForFeeds";
        switch (this._getFeedType()) {
          case Components.interfaces.nsIFeed.TYPE_VIDEO:
            stringLabel = "alwaysUseForVideoPodcasts";
            break;

          case Components.interfaces.nsIFeed.TYPE_AUDIO:
            stringLabel = "alwaysUseForAudioPodcasts";
            break;
        }

        checkbox.setAttribute("label", this._getFormattedString(stringLabel, [handlerName]));
      }
    }
  },

  // nsIDOMEventListener
  handleEvent: function(event) {
    if (event.target != this._document &&
        event.target.ownerDocument != this._document) {
      LOG("FeedWriter.handleEvent: Someone passed the feed writer as a listener to the events of another document!");
      return;
    }

    if (event.type == "load")
      this._writeContent();
    else if (event.type == "unload")
      this._close();
    else if (event.type == "command") {
      switch (event.target.getAttribute("anonid")) {
        case "subscribeButton":
          this._subscribe();
          break;
        case "chooseApplicationMenuItem":
          /* Bug 351263: Make sure to not steal focus if the "Choose
           * Application" item is being selected with the keyboard. We do this
           * by ignoring command events while the dropdown is closed (user
           * arrowing through the combobox), but handling them while the
           * combobox dropdown is open (user pressed enter when an item was
           * selected). If we don't show the filepicker here, it will be shown
           * when clicking "Subscribe Now".
           */
          var popupbox = this._handlersMenuList.firstChild.boxObject;
          if (popupbox.popupState == "hiding" && !this._chooseClientApp()) {
            // Select the (per-prefs) selected handler if no application was
            // selected
            this._setSelectedHandler(this._getFeedType());
          }
          break;
        default:
          this._setAlwaysUseLabel();
      }
    }
  },

  _setSelectedHandler: function setSelectedHandler(feedType) {
    var handler = safeGetCharPref(getPrefReaderForType(feedType), "messenger");

    switch (handler) {
      case "web":
        if (this._handlersMenuList) {
          var url = Services.prefs.getComplexValue(getPrefWebForType(feedType),
                                                   Components.interfaces.nsISupportsString).data;
          var handlers = this._handlersMenuList.getElementsByAttribute("webhandlerurl", url);
          if (handlers.length == 0) {
            LOG("FeedWriter._setSelectedHandler: selected web handler isn't in the menulist");
            return;
          }

          handlers[0].doCommand();
        }
        break;
       case "bookmarks":
         var liveBookmarksMenuItem = this._getUIElement("liveBookmarksMenuItem");
         if (liveBookmarksMenuItem)
           liveBookmarksMenuItem.doCommand();
         break;
      // fall through if this._selectedApp is null
      default:
         var liveBookmarksMenuItem = this._getUIElement("liveBookmarksMenuItem");
         if (liveBookmarksMenuItem)
           liveBookmarksMenuItem.doCommand();
         break;
    }
  },

  _initSubscriptionUI: function initSubscriptionUI() {
    var handlersMenuPopup = this._getUIElement("handlersMenuPopup");
    if (!handlersMenuPopup)
      return;

    var feedType = this._getFeedType();

    // change the background
    var header = this._document.getElementById("feedHeader");
    switch (feedType) {
      case Components.interfaces.nsIFeed.TYPE_VIDEO:
        header.className = "videoPodcastBackground";
        break;

      case Components.interfaces.nsIFeed.TYPE_AUDIO:
        header.className = "audioPodcastBackground";
        break;

      default:
        header.className = "feedBackground";
    }

    var liveBookmarksMenuItem = this._getUIElement("liveBookmarksMenuItem");

    // Last-selected application
    var menuItem = liveBookmarksMenuItem.cloneNode(false);
    menuItem.removeAttribute("selected");
    menuItem.setAttribute("anonid", "selectedAppMenuItem");
    menuItem.className = "menuitem-iconic selectedAppMenuItem";
    menuItem.setAttribute("handlerType", "client");
    try {
      this._selectedApp = Services.prefs.getComplexValue(getPrefAppForType(feedType),
                                                         Components.interfaces.nsILocalFile);

      if (this._selectedApp.exists())
        this._initMenuItemWithFile(menuItem, this._selectedApp);
      else {
        // Hide the menuitem if the last selected application doesn't exist
        menuItem.hidden = true;
      }
    }
    catch(ex) {
      // Hide the menuitem until an application is selected
      menuItem.hidden = true;
    }
    this._selectedAppMenuItem = menuItem;
    handlersMenuPopup.appendChild(menuItem);

    // List the default feed reader
    try {
      this._defaultSystemReader = Components.classes["@binaryoutcast.com/navigator/shell-service;1"]
                                            .getService(Components.interfaces.nsIShellService)
                                            .defaultFeedReader;
      menuItem = liveBookmarksMenuItem.cloneNode(false);
      menuItem.removeAttribute("selected");
      menuItem.setAttribute("anonid", "defaultHandlerMenuItem");
      menuItem.className = "menuitem-iconic defaultHandlerMenuItem";
      menuItem.setAttribute("handlerType", "client");

      this._initMenuItemWithFile(menuItem, this._defaultSystemReader);

      // Hide the default reader item if it points to the same application
      // as the last-selected application
      if (this._selectedApp &&
          this._selectedApp.path == this._defaultSystemReader.path)
        menuItem.hidden = true;
    }
    catch(ex) {
    }

    if (menuItem) {
      this._defaultHandlerMenuItem = menuItem;
      handlersMenuPopup.appendChild(menuItem);
    }

    // "Choose Application..." menuitem
    menuItem = liveBookmarksMenuItem.cloneNode(false);
    menuItem.removeAttribute("selected");
    menuItem.setAttribute("anonid", "chooseApplicationMenuItem");
    menuItem.className = "menuitem-iconic chooseApplicationMenuItem";
    menuItem.setAttribute("label", this._getString("chooseApplicationMenuItem"));
    handlersMenuPopup.appendChild(menuItem);

    // separator
    menuItem = liveBookmarksMenuItem.nextSibling.cloneNode(false);
    handlersMenuPopup.appendChild(menuItem);

    // List of web handlers
    var wccr = Components.classes["@mozilla.org/embeddor.implemented/web-content-handler-registrar;1"]
                         .getService(Components.interfaces.nsIWebContentConverterService);
    var handlers = wccr.getContentHandlers(this._getMimeTypeForFeedType(feedType));
    if (handlers.length != 0) {
      for (let i = 0; i < handlers.length; ++i) {
        menuItem = liveBookmarksMenuItem.cloneNode(false);
        menuItem.removeAttribute("selected");
        menuItem.className = "menuitem-iconic";
        menuItem.setAttribute("label", handlers[i].name);
        menuItem.setAttribute("handlerType", "web");
        menuItem.setAttribute("webhandlerurl", handlers[i].uri);
        handlersMenuPopup.appendChild(menuItem);

        this._setFaviconForWebReader(handlers[i].uri, menuItem);
      }
    }

    this._setSelectedHandler(feedType);

    // "Subscribe using..."
    this._setSubscribeUsingLabel();

    // "Always use..." checkbox initial state
    this._setAlwaysUseCheckedState(feedType);
    this._setAlwaysUseLabel();

    // We update the "Always use.." checkbox label whenever the selected item
    // in the list is changed
    handlersMenuPopup.addEventListener("command", this, false);

    // Set up the "Subscribe Now" button
    this._getUIElement("subscribeButton")
        .addEventListener("command", this, false);

    // first-run ui
    var showFirstRunUI = true;
    try {
      showFirstRunUI = Services.prefs.getBoolPref(PREF_SHOW_FIRST_RUN_UI);
    }
    catch (ex) {
    }
    if (showFirstRunUI) {
      var textfeedinfo1, textfeedinfo2;
      switch (feedType) {
        case Components.interfaces.nsIFeed.TYPE_VIDEO:
          textfeedinfo1 = "feedSubscriptionVideoPodcast1";
          textfeedinfo2 = "feedSubscriptionVideoPodcast2";
          break;
        case Components.interfaces.nsIFeed.TYPE_AUDIO:
          textfeedinfo1 = "feedSubscriptionAudioPodcast1";
          textfeedinfo2 = "feedSubscriptionAudioPodcast2";
          break;
        default:
          textfeedinfo1 = "feedSubscriptionFeed1";
          textfeedinfo2 = "feedSubscriptionFeed2";
      }

      this._document.getElementById("feedSubscriptionInfo1").textContent =
          this._getString(textfeedinfo1);
      this._document.getElementById("feedSubscriptionInfo2").textContent =
          this._getString(textfeedinfo2);
      header.setAttribute("firstrun", "true");
      Services.prefs.setBoolPref(PREF_SHOW_FIRST_RUN_UI, false);
    }
  },

  /**
   * Returns the original URI object of the feed and ensures that this
   * component is only ever invoked from the preview document.
   * @param aWindow
   *        The window of the document invoking the BrowserFeedWriter
   */
  _getOriginalURI: function getOriginalURI(aWindow) {
    var chan = aWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                      .getInterface(Components.interfaces.nsIWebNavigation)
                      .QueryInterface(Components.interfaces.nsIDocShell)
                      .currentDocumentChannel;
    var ios = Services.io;
    var channel = ios.newChannel2(FEEDHANDLER_URI, null, null, null,
                                  this._feedprincipal,
                                  null,
                                  Components.interfaces.nsILoadInfo.SEC_NORMAL,
                                  Components.interfaces.nsIContentPolicy.TYPE_OTHER);
    var resolvedURI = channel.URI;

    if (resolvedURI.equals(chan.URI))
      return chan.originalURI;

    return null;
  },

  _window: null,
  _document: null,
  _feedURI: null,
  _feedPrincipal: null,
  _handlersMenuList: null,
  _selectedAppMenuItem: null,
  _defaultHandlerMenuItem: null,

  // nsIDOMGlobalPropertyInitializer
  init: function init(aWindow) {
    this._feedURI = this._getOriginalURI(aWindow);
    if (!this._feedURI)
      return;

    this._window = aWindow;
    this._document = aWindow.document;
    this._handlersMenuList = this._getUIElement("handlersMenuList");

    this._feedPrincipal = Services.scriptSecurityManager
                                  .createCodebasePrincipal(this._feedURI, {});

    LOG("Subscribe Preview: feed uri = " + this._window.location.href);

    // Set up the subscription UI
    this._initSubscriptionUI();
    Services.prefs.addObserver(PREF_SELECTED_ACTION, this, false);
    Services.prefs.addObserver(PREF_SELECTED_READER, this, false);
    Services.prefs.addObserver(PREF_SELECTED_WEB, this, false);
    Services.prefs.addObserver(PREF_SELECTED_APP, this, false);
    Services.prefs.addObserver(PREF_VIDEO_SELECTED_ACTION, this, false);
    Services.prefs.addObserver(PREF_VIDEO_SELECTED_READER, this, false);
    Services.prefs.addObserver(PREF_VIDEO_SELECTED_WEB, this, false);
    Services.prefs.addObserver(PREF_VIDEO_SELECTED_APP, this, false);

    Services.prefs.addObserver(PREF_AUDIO_SELECTED_ACTION, this, false);
    Services.prefs.addObserver(PREF_AUDIO_SELECTED_READER, this, false);
    Services.prefs.addObserver(PREF_AUDIO_SELECTED_WEB, this, false);
    Services.prefs.addObserver(PREF_AUDIO_SELECTED_APP, this, false);

    this._window.addEventListener("load", this, false);
    this._window.addEventListener("unload", this, false);
  },

  _writeContent: function writeContent() {
    if (!this._window)
      return;

    try {
      // Set up the feed content
      var container = this._getContainer();
      if (!container)
        return;

      this._setTitleText(container);
      this._setTitleImage(container);
      this._writeFeedContent(container);
    }
    finally {
      this._removeFeedFromCache();
    }
  },

  _close: function close() {
    this._window.removeEventListener("load", this, false);
    this._window.removeEventListener("unload", this, false);
    this._getUIElement("handlersMenuPopup")
        .removeEventListener("command", this, false);
    this._getUIElement("subscribeButton")
        .removeEventListener("command", this, false);
    this._document = null;
    this._window = null;
    Services.prefs.removeObserver(PREF_SELECTED_ACTION, this);
    Services.prefs.removeObserver(PREF_SELECTED_READER, this);
    Services.prefs.removeObserver(PREF_SELECTED_WEB, this);
    Services.prefs.removeObserver(PREF_SELECTED_APP, this);
    Services.prefs.removeObserver(PREF_VIDEO_SELECTED_ACTION, this);
    Services.prefs.removeObserver(PREF_VIDEO_SELECTED_READER, this);
    Services.prefs.removeObserver(PREF_VIDEO_SELECTED_WEB, this);
    Services.prefs.removeObserver(PREF_VIDEO_SELECTED_APP, this);

    Services.prefs.removeObserver(PREF_AUDIO_SELECTED_ACTION, this);
    Services.prefs.removeObserver(PREF_AUDIO_SELECTED_READER, this);
    Services.prefs.removeObserver(PREF_AUDIO_SELECTED_WEB, this);
    Services.prefs.removeObserver(PREF_AUDIO_SELECTED_APP, this);

    this._removeFeedFromCache();
    this.__faviconService = null;
    this.__bundle = null;
    this._feedURI = null;
    this._selectedAppMenuItem = null;
    this._defaultHandlerMenuItem = null;
  },

  _removeFeedFromCache: function removeFeedFromCache() {
    if (this._feedURI) {
      var feedService = Components.classes["@mozilla.org/browser/feeds/result-service;1"]
                                  .getService(Components.interfaces.nsIFeedResultService);
      feedService.removeFeedResult(this._feedURI);
      this._feedURI = null;
    }
  },

  _subscribe: function subscribe() {
    var feedType = this._getFeedType();

    // Subscribe to the feed using the selected handler and save prefs
    var defaultHandler = "reader";
    var useAsDefault = this._getUIElement("alwaysUse").getAttribute("checked");

    var selectedItem = this._getSelectedItemFromMenulist(this._handlersMenuList);

    // Show the file picker before subscribing if the
    // choose application menuitem was chosen using the keyboard
    if (selectedItem.getAttribute("anonid") == "chooseApplicationMenuItem") {
      if (!this._chooseClientApp())
        return;

      selectedItem = this._getSelectedItemFromMenulist(this._handlersMenuList);
    }

    if (selectedItem.hasAttribute("webhandlerurl")) {
      var webURI = selectedItem.getAttribute("webhandlerurl");
      Services.prefs.setCharPref(getPrefReaderForType(feedType), "web");

      var supportsString = Components.classes["@mozilla.org/supports-string;1"]
                                     .createInstance(Components.interfaces.nsISupportsString);
      supportsString.data = webURI;
      Services.prefs.setComplexValue(getPrefWebForType(feedType), Components.interfaces.nsISupportsString,
                                     supportsString);

      var wccr = Components.classes["@mozilla.org/embeddor.implemented/web-content-handler-registrar;1"]
                           .getService(Components.interfaces.nsIWebContentConverterService);
      var handler = wccr.getWebContentHandlerByURI(this._getMimeTypeForFeedType(feedType), webURI);
      if (handler) {
        if (useAsDefault)
          wccr.setAutoHandler(this._getMimeTypeForFeedType(feedType), handler);

        this._window.location.href = handler.getHandlerURI(this._window.location.href);
      }
    }
    else {
      switch (selectedItem.getAttribute("anonid")) {
        case "selectedAppMenuItem":
          Services.prefs.setComplexValue(getPrefAppForType(feedType), Components.interfaces.nsILocalFile,
                                         this._selectedApp);
          Services.prefs.setCharPref(getPrefReaderForType(feedType), "client");
          break;
        case "defaultHandlerMenuItem":
          Services.prefs.setComplexValue(getPrefAppForType(feedType), Components.interfaces.nsILocalFile,
                                         this._defaultSystemReader);
          Services.prefs.setCharPref(getPrefReaderForType(feedType), "client");
          break;
        case "liveBookmarksMenuItem":
          defaultHandler = "bookmarks";
          Services.prefs.setCharPref(getPrefReaderForType(feedType), "bookmarks");
          break;
        case "messengerFeedsMenuItem":
          defaultHandler = "messenger";
          Services.prefs.setCharPref(getPrefReaderForType(feedType), "messenger");
          break;
      }
      var feedService = Components.classes["@mozilla.org/browser/feeds/result-service;1"]
                                  .getService(Components.interfaces.nsIFeedResultService);

      // Pull the title and subtitle out of the document
      var feedTitle = this._document.getElementById(TITLE_ID).textContent;
      var feedSubtitle = this._document.getElementById(SUBTITLE_ID).textContent;
      feedService.addToClientReader(this._window.location.href, feedTitle, feedSubtitle, feedType);
    }

    // If "Always use..." is checked, we should set PREF_*SELECTED_ACTION
    // to either "reader" (If a web reader or if an application is selected),
    // or to "messenger" (if the messenger feeds option is selected).
    // Otherwise, we should set it to "ask"
    if (useAsDefault)
      Services.prefs.setCharPref(getPrefActionForType(feedType), defaultHandler);
    else
      Services.prefs.setCharPref(getPrefActionForType(feedType), "ask");
  },

  // nsIObserver
  observe: function observe(subject, topic, data) {
    if (!this._window) {
      // this._window is null unless this.init was called with a trusted
      // window object.
      return;
    }

    var feedType = this._getFeedType();

    if (topic == "nsPref:changed") {
      switch (data) {
        case PREF_SELECTED_READER:
        case PREF_SELECTED_WEB:
        case PREF_SELECTED_APP:
        case PREF_VIDEO_SELECTED_READER:
        case PREF_VIDEO_SELECTED_WEB:
        case PREF_VIDEO_SELECTED_APP:
        case PREF_AUDIO_SELECTED_READER:
        case PREF_AUDIO_SELECTED_WEB:
        case PREF_AUDIO_SELECTED_APP:
          this._setSelectedHandler(feedType);
          break;
        case PREF_SELECTED_ACTION:
        case PREF_VIDEO_SELECTED_ACTION:
        case PREF_AUDIO_SELECTED_ACTION:
          this._setAlwaysUseCheckedState(feedType);
      }
    }
  },

  /**
   * Sets the icon for the given web-reader item in the readers menu.
   * The icon is fetched and stored through the favicon service.
   *
   * @param aReaderUrl
   *        the reader url.
   * @param aMenuItem
   *        the reader item in the readers menulist.
   *
   * @note For privacy reasons we cannot set the image attribute directly
   *       to the icon url.  See Bug 358878 for details.
   */
  _setFaviconForWebReader: function setFaviconForWebReader(aReaderUrl, aMenuItem) {
    let readerURI = makeURI(aReaderUrl);
    if (!/^https?/.test(readerURI.scheme)) {
      // Don't try to get a favicon for non http(s) URIs.
      return;
    }
    let faviconURI = makeURI(readerURI.resolve("/favicon.ico"));
    var isPB = this._window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                   .getInterface(Components.interfaces.nsIWebNavigation)
                   .QueryInterface(Components.interfaces.nsIDocShell)
                   .QueryInterface(Components.interfaces.nsILoadContext)
                   .usePrivateBrowsing;
    var flags = isPB ? this._faviconService.FAVICON_LOAD_PRIVATE :
                       this._faviconService.FAVICON_LOAD_NON_PRIVATE;
    var nullPrincipal = Components.classes["@mozilla.org/nullprincipal;1"]
                                  .createInstance(Components.interfaces.nsIPrincipal);
    this._faviconService.setAndFetchFaviconForPage(
      readerURI, faviconURI, false, flags,
      function(aURI, aDataLen, aData, aMimeType) {
        if (aDataLen > 0) {
          let dataURL = "data:" + aMimeType + ";base64," +
                        btoa(String.fromCharCode.apply(null, aData));
          aMenuItem.setAttribute("image", dataURL);
        }
      },
      nullPrincipal);
  },

  classID: FEEDWRITER_CID,
  QueryInterface: XPCOMUtils.generateQI([ Components.interfaces.nsIDOMGlobalPropertyInitializer,
                                          Components.interfaces.nsIDOMEventListener,
                                          Components.interfaces.nsINavHistoryObserver,
                                          Components.interfaces.nsIObserver])

};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([FeedWriter]);
