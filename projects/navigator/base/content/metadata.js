/* -*- Mode: Java; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const MathMLNS = "http://www.w3.org/1998/Math/MathML";
const XLinkNS = "http://www.w3.org/1999/xlink";
const XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const XMLNS = "http://www.w3.org/XML/1998/namespace";
const XHTMLNS = "http://www.w3.org/1999/xhtml";
var gMetadataBundle;
var gLangBundle;
var gRegionBundle;
var nodeView;
var htmlMode = false;

var onLink   = false;
var onImage  = false;
var onInsDel = false;
var onQuote  = false;
var onMisc   = false;
var onTable  = false;
var onTitle  = false;
var onLang   = false;

const OPEN_READONLY = Components.interfaces.nsICacheStorage.OPEN_READONLY;

function onLoad()
{
    gMetadataBundle = document.getElementById("bundle_metadata");
    gLangBundle = document.getElementById("bundle_languages");
    gRegionBundle = document.getElementById("bundle_regions");

    showMetadataFor(window.arguments[0]);

    nodeView = window.arguments[0].ownerDocument.defaultView;
}

function showMetadataFor(elem)
{
    // skip past non-element nodes
    while (elem && elem.nodeType != Node.ELEMENT_NODE)
        elem = elem.parentNode;

    if (!elem) {
        alert(gMetadataBundle.getString("unableToShowProps"));
        window.close();
    }

    if (elem.ownerDocument.getElementsByName && !elem.ownerDocument.namespaceURI)
        htmlMode = true;

    // htmllocalname is "" if it's not an html tag, or the name of the tag if it is.
    var htmllocalname = "";
    if (isHTMLElement(elem,"")) {
        htmllocalname = elem.localName.toLowerCase();
    }

    // We only look for images once
    checkForImage(elem, htmllocalname);

    // Walk up the tree, looking for elements of interest.
    // Each of them could be at a different level in the tree, so they each
    // need their own boolean to tell us to stop looking.
    while (elem && elem.nodeType == Node.ELEMENT_NODE) {
        htmllocalname = "";
        if (isHTMLElement(elem,"")) {
            htmllocalname = elem.localName.toLowerCase();
        }

        if (!onLink)   checkForLink(elem, htmllocalname);
        if (!onInsDel) checkForInsDel(elem, htmllocalname);
        if (!onQuote)  checkForQuote(elem, htmllocalname);
        if (!onTable)  checkForTable(elem, htmllocalname);
        if (!onTitle)  checkForTitle(elem, htmllocalname);
        if (!onLang)   checkForLang(elem, htmllocalname);

        elem = elem.parentNode;
    }

    // Decide which sections to show
    var onMisc = onTable || onTitle || onLang;
    if (!onMisc)   hideNode("misc-sec");
    if (!onLink)   hideNode("link-sec");
    if (!onImage)  hideNode("image-sec");
    if (!onInsDel) hideNode("insdel-sec");
    if (!onQuote)  hideNode("quote-sec");

    // Fix the Misc section visibilities
    if (onMisc) {
        if (!onTable) hideNode("misc-tblsummary");
        if (!onLang)  hideNode("misc-lang");
        if (!onTitle) hideNode("misc-title");
    }

    // Get rid of the "No properties" message. This is a backstop -
    // it should really never show, as long as nsContextMenu.js's
    // checking doesn't get broken.
    if (onLink || onImage || onInsDel || onQuote || onMisc)
        hideNode("no-properties")
}

var cacheListener = {
    onCacheEntryAvailable: function onCacheEntryAvailable(descriptor) {
        if (descriptor) {
            var kbSize = descriptor.dataSize / 1024;
            kbSize = Math.round(kbSize * 100) / 100;
            setInfo("image-filesize", gMetadataBundle.getFormattedString("imageSize",
                                                                         [formatNumber(kbSize),
                                                                          formatNumber(descriptor.dataSize)]));
        } else {
            setInfo("image-filesize", gMetadataBundle.getString("imageSizeUnknown"));
        }
    },
    onCacheEntryCheck: function onCacheEntryCheck() {
        return Components.interfaces.nsICacheEntryOpenCallback.ENTRY_WANTED;
    }
};

function checkForImage(elem, htmllocalname)
{
    var img;
    var imgType;   // "img" = <img>
                   // "object" = <object>
                   // "input" = <input type=image>
                   // "background" = css background (to be added later)
    var ismap = false;

    if (htmllocalname === "img") {
        img = elem;
        imgType = "img";

    } else if (htmllocalname === "object" &&
               elem.type.substring(0,6) == "image/" &&
               elem.data) {
        img = elem;
        imgType = "object";

    } else if (htmllocalname === "input" &&
               elem.type.toUpperCase() == "IMAGE") {
        img = elem;
        imgType = "input";

    } else if (htmllocalname === "area" || htmllocalname === "a") {

        // Clicked in image map?
        var map = elem;
        ismap = true;
        setAlt(map);

        while (map && map.nodeType == Node.ELEMENT_NODE && !isHTMLElement(map,"map") )
            map = map.parentNode;

        if (map && map.nodeType == Node.ELEMENT_NODE) {
            img = getImageForMap(map);
            var imgLocalName = img && img.localName.toLowerCase();
            if (imgLocalName == "img" || imgLocalName == "object") {
                imgType = imgLocalName;
            }
        }

    }

    if (img) {

        var imgURL = imgType == "object" ? img.data : img.src;
        setInfo("image-url", imgURL);

        const LoadContextInfo = Components.classes["@mozilla.org/load-context-info-factory;1"]
                                          .getService(Components.interfaces.nsILoadContextInfoFactory);
        var loadContextInfo = opener.gPrivate ? LoadContextInfo.private :
                                                LoadContextInfo.default;
        Components.utils.import("resource://gre/modules/NetUtil.jsm");
        Components.classes["@mozilla.org/netwerk/cache-storage-service;1"]
                  .getService(Components.interfaces.nsICacheStorageService)
                  .diskCacheStorage(loadContextInfo, false)
                  .asyncOpenURI(NetUtil.newURI(imgURL), null,
                                OPEN_READONLY, cacheListener);

        if ("width" in img && img.width != "") {
            setInfo("image-width", gMetadataBundle.getFormattedString("imageWidth", [formatNumber(img.width)]));
            setInfo("image-height", gMetadataBundle.getFormattedString("imageHeight", [formatNumber(img.height)]));
        }
        else {
            setInfo("image-width", "");
            setInfo("image-height", "");
        }

        if (imgType == "img") {
            setInfo("image-desc", img.longDesc);
        } else {
            setInfo("image-desc", "");
        }

        onImage = true;
    }

    if (!ismap) {
       if (imgType == "img" || imgType == "input") {
           setAlt(img);
       } else {
           hideNode("image-alt");
       }
    }
}

function checkForLink(elem, htmllocalname)
{
    if ((htmllocalname === "a" && elem.href != "") ||
        htmllocalname === "area") {

        setLink(elem.href, elem.getAttribute("type"),
                convertLanguageCode(elem.getAttribute("hreflang")),
                elem.getAttribute("rel"), elem.getAttribute("rev"));

        var target = elem.target;

        switch (target) {
        case "_top":
            setInfo("link-target", gMetadataBundle.getString("sameWindowText"));
            break;
        case "_parent":
            setInfo("link-target", gMetadataBundle.getString("parentFrameText"));
            break;
        case "_blank":
            setInfo("link-target", gMetadataBundle.getString("newWindowText"));
            break;
        case "":
        case "_self":
            if (elem.ownerDocument.defaultView) {
                if (elem.ownerDocument != elem.ownerDocument.defaultView.content.document)
                    setInfo("link-target", gMetadataBundle.getString("sameFrameText"));
                else
                    setInfo("link-target", gMetadataBundle.getString("sameWindowText"));
            } else {
                hideNode("link-target");
            }
            break;
        default:
            setInfo("link-target", "\"" + target + "\"");
        }

        onLink = true;
    }
    else if (elem.namespaceURI == MathMLNS && elem.hasAttribute("href")) {
        setLink(makeHrefAbsolute(elem.getAttribute("href"), elem));

        setInfo("link-target", "");

        onLink = true;
    }
    else if (elem.getAttributeNS(XLinkNS, "href")) {
        setLink(makeHrefAbsolute(elem.getAttributeNS(XLinkNS, "href"), elem));

        switch (elem.getAttributeNS(XLinkNS,"show")) {
        case "embed":
            setInfo("link-target", gMetadataBundle.getString("embeddedText"));
            break;
        case "new":
            setInfo("link-target", gMetadataBundle.getString("newWindowText"));
            break;
        case null:
        case "":
        case "replace":
            if (elem.ownerDocument != elem.ownerDocument.defaultView.content.document)
                setInfo("link-target", gMetadataBundle.getString("sameFrameText"));
            else
                setInfo("link-target", gMetadataBundle.getString("sameWindowText"));
            break;
        default:
            setInfo("link-target", "");
            break;
        }

        onLink = true;
    }
}

function checkForInsDel(elem, htmllocalname)
{
    if ((htmllocalname === "ins" || htmllocalname === "del") &&
        (elem.cite || elem.dateTime)) {
        setInfo("insdel-cite", elem.cite);
        setInfo("insdel-date", elem.dateTime);
        onInsDel = true;
    }
}


function checkForQuote(elem, htmllocalname)
{
    if ((htmllocalname === "q" || htmllocalname === "blockquote") && elem.cite) {
        setInfo("quote-cite", elem.cite);
        onQuote = true;
    }
}

function checkForTable(elem, htmllocalname)
{
    if (htmllocalname === "table" && elem.summary) {
        setInfo("misc-tblsummary", elem.summary);
        onTable = true;
    }
}

function checkForLang(elem, htmllocalname)
{
    if ((htmllocalname && elem.lang) || elem.getAttributeNS(XMLNS, "lang")) {
        var abbr;
        if (htmllocalname && elem.lang)
            abbr = elem.lang;
        else
            abbr = elem.getAttributeNS(XMLNS, "lang");

        setInfo("misc-lang", convertLanguageCode(abbr));
        onLang = true;
    }
}

function checkForTitle(elem, htmllocalname)
{
    if (htmllocalname && elem.title) {
        setInfo("misc-title", elem.title);
        onTitle = true;
    }
}

/*
 * Set five link properties at once.
 * All parameters are optional.
 */
function setLink(url, lang, type, rel, rev)
{
    setInfo("link-url", url);
    setInfo("link-type", type);
    setInfo("link-lang", lang);
    setInfo("link-rel", rel);
    setInfo("link-rev", rev);
}

/*
 * Set text of node id to value
 * if value="" the node with specified id is hidden.
 * Node should be have one of these forms
 * <xul:label id="id-text" value=""/>
 * <xul:description id="id-text"/>
 */
function setInfo(id, value)
{
    if (!value) {
        hideNode(id);
        return;
    }

    var node = document.getElementById(id+"-text");

    if (node.namespaceURI == XULNS && node.localName == "label" ||
       (node.namespaceURI == XULNS && node.localName == "textbox")) {
        node.setAttribute("value",value);

    } else if (node.namespaceURI == XULNS && node.localName == "description") {
        node.textContent = value;
    }
}

// Hide node with specified id
function hideNode(id)
{
    var style = document.getElementById(id).getAttribute("style");
    document.getElementById(id).setAttribute("style", "display:none;" + style);
}

/*
 * Find <img> or <object> which uses an imagemap.
 * If more then one object is found we can't determine which one
 * was clicked.
 *
 * This code has to be changed once bug 1882 is fixed.
 * Once bug 72527 is fixed this code should use the .images collection.
 */
function getImageForMap(map)
{
    var mapuri = "#" + map.getAttribute("name");
    var multipleFound = false;
    var img;

    var list = getHTMLElements(map.ownerDocument, "img");
    for (var i=0; i < list.length; i++) {
        if (list.item(i).getAttribute("usemap") == mapuri) {
            if (img) {
                multipleFound = true;
                break;
            } else {
                img = list.item(i);
                imgType = "img";
            }
        }
    }

    list = getHTMLElements(map.ownerDocument, "object");
    for (i = 0; i < list.length; i++) {
        if (list.item(i).getAttribute("usemap") == mapuri) {
            if (img) {
              multipleFound = true;
              break;
            } else {
              img = list.item(i);
              imgType = "object";
            }
        }
    }

    if (multipleFound)
        img = null;

    return img;
}

function getHTMLElements(node, name)
{
    if (htmlMode)
        return node.getElementsByTagName(name);
    return node.getElementsByTagNameNS(XHTMLNS, name);
}

// name should be in lower case
function isHTMLElement(node, name)
{
    if (node.nodeType != Node.ELEMENT_NODE)
        return false;

    if (htmlMode)
        return !name || node.localName.toLowerCase() == name;

    return (!name || node.localName == name) && node.namespaceURI == XHTMLNS;
}

// This function coded according to the spec at:
// http://www.bath.ac.uk/~py8ieh/internet/discussion/metadata.txt
function convertLanguageCode(abbr)
{
    if (!abbr) return "";
    var result;
    var region = "";
    var tokens = abbr.split("-");
    var language = tokens.shift();

    if (language == "x" || language == "i")
    {
        // x and i prefixes mean unofficial ones. So we proper-case the next
        // word and leave the rest.
        if (tokens.length > 0)
        {
            // Upper-case first letter
            language = tokens[0].substr(0, 1).toUpperCase() + tokens[0].substr(1);
            tokens.shift();

            // Add on the rest as space-separated strings inside the brackets
            region = tokens.join(" ");
        }
    }
    else
    {
        // Otherwise we treat the first as a lang, the second as a region
        // and the rest as strings.
        try
        {
            language = gLangBundle.getString(language.toLowerCase());
        }
        catch (e)
        {
        }

        if (tokens.length > 0)
        {
            try
            {
                tokens[0] = gRegionBundle.getString(tokens[0].toLowerCase());
            }
            catch (e)
            {
            }
            region = tokens.join(" ");
        }
    }

    if (region) {
        result = gMetadataBundle.getFormattedString("languageRegionFormat",
                                                    [language, region]);
    } else {
        result = language;
    }
    return result;
}

function setAlt(elem) {
    var altText = document.getElementById("image-alt-text");
    if (elem.hasAttribute("alt")) {
        if (elem.alt != "") {
            altText.value = elem.alt;
            altText.setAttribute("style","font-style:inherit");
        } else {
            altText.value = gMetadataBundle.getString("altTextBlank");
            altText.setAttribute("style","font-style:italic");
        }
    } else {
        altText.value = gMetadataBundle.getString("altTextMissing");
        altText.setAttribute("style","font-style:italic");
    }

}

function formatNumber(number)
{
  return (+number).toLocaleString();  // coerce number to a numeric value before calling toLocaleString()
}

function makeHrefAbsolute(href, elem)
{
  Components.utils.import("resource://gre/modules/NetUtil.jsm");
  try {
    var baseURI = NetUtil.newURI(elem.baseURI, elem.ownerDocument.characterSet);
    href = NetUtil.newURI(href, elem.ownerDocument.characterSet, baseURI).spec;
  } catch (e) {
  }
  return href;
}
