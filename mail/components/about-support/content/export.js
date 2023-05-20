/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

Components.utils.import("resource://gre/modules/AppConstants.jsm");

/**
 * Create warning text to add to any private data.
 * @returns A HTML paragraph node containing the warning.
 */
function createWarning() {
  let bundle = Services.strings.createBundle(
    "chrome://messenger/locale/aboutSupportMail.properties");
  return createParentElement("p", [
    createElement("strong", bundle.GetStringFromName("warningLabel")),
    // Add some whitespace between the label and the text
    document.createTextNode(" "),
    document.createTextNode(bundle.GetStringFromName("warningText")),
  ]);
}

function getLoadContext() {
  return window.QueryInterface(Ci.nsIInterfaceRequestor)
               .getInterface(Ci.nsIWebNavigation)
               .QueryInterface(Ci.nsILoadContext);
}

function getClipboardTransferable() {
  // Get the HTML and text representations for the important part of the page.
  let hidePrivateData = !document.getElementById("check-show-private-data").checked;
  let contentsDiv = createCleanedUpContents(hidePrivateData);
  let dataHtml = contentsDiv.innerHTML;
  let dataText = createTextForElement(contentsDiv, hidePrivateData);

  // We can't use plain strings, we have to use nsSupportsString.
  let supportsStringClass = Cc["@mozilla.org/supports-string;1"];
  let ssHtml = supportsStringClass.createInstance(Ci.nsISupportsString);
  let ssText = supportsStringClass.createInstance(Ci.nsISupportsString);

  let transferable = Cc["@mozilla.org/widget/transferable;1"]
                       .createInstance(Ci.nsITransferable);
  transferable.init(getLoadContext());

  // Add the HTML flavor.
  transferable.addDataFlavor("text/html");
  ssHtml.data = dataHtml;
  transferable.setTransferData("text/html", ssHtml, dataHtml.length * 2);

  // Add the plain text flavor.
  transferable.addDataFlavor("text/unicode");
  ssText.data = dataText;
  transferable.setTransferData("text/unicode", ssText, dataText.length * 2);

  return transferable;
}

function copyToClipboard() {
  let transferable = getClipboardTransferable();
  // Store the data into the clipboard.
  Services.clipboard.setData(transferable, null, Services.clipboard.kGlobalClipboard);
}

function sendViaEmail() {
  // Get the HTML representation for the important part of the page.
  let hidePrivateData = !document.getElementById("check-show-private-data").checked;
  let contentsDiv = createCleanedUpContents(hidePrivateData);
  let dataHtml = contentsDiv.innerHTML;
  // The editor considers whitespace to be significant, so replace all
  // whitespace with a single space.
  dataHtml = dataHtml.replace(/\s+/g, " ");

  // Set up parameters and fields to use for the compose window.
  let params = Cc["@mozilla.org/messengercompose/composeparams;1"]
                 .createInstance(Ci.nsIMsgComposeParams);
  params.type = Ci.nsIMsgCompType.New;
  params.format = Ci.nsIMsgCompFormat.HTML;

  let fields = Cc["@mozilla.org/messengercompose/composefields;1"]
                 .createInstance(Ci.nsIMsgCompFields);
  fields.forcePlainText = false;
  fields.body = dataHtml;
  // In general we can have non-ASCII characters, and compose's charset
  // detection doesn't seem to work when the HTML part is pure ASCII but the
  // text isn't. So take the easy way out and force UTF-8.
  fields.characterSet = "UTF-8";
  fields.bodyIsAsciiOnly = false;
  params.composeFields = fields;

  // Our params are set up. Now open a compose window.
  MailServices.compose.OpenComposeWindowWithParams(null, params);
}

function createCleanedUpContents(aHidePrivateData) {
  // Get the important part of the page.
  let contentsDiv = document.getElementById("contents");
  // Deep-clone the entire div.
  let clonedDiv = contentsDiv.cloneNode(true);
  // Go in and replace text with the text we actually want to copy.
  // (this mutates the cloned node)
  cleanUpText(clonedDiv, aHidePrivateData);
  // Insert a warning if we need to
  if (!aHidePrivateData)
    clonedDiv.insertBefore(createWarning(), clonedDiv.firstChild);
  return clonedDiv;
}

function cleanUpText(aElem, aHidePrivateData) {
  let node = aElem.firstChild;
  let copyData = aElem.dataset.copyData;
  delete aElem.dataset.copyData;
  while (node) {
    let classList = "classList" in node && node.classList;
    // Delete uionly nodes.
    if (classList && classList.contains(CLASS_DATA_UIONLY)) {
      // Advance to the next node before removing the current node, since
      // node.nextSibling is null after remove()
      let nextNode = node.nextSibling;
      node.remove();
      node = nextNode;
      continue;
    }
    // Replace private data with a blank string
    else if (aHidePrivateData && classList && classList.contains(CLASS_DATA_PRIVATE)) {
      node.textContent = "";
    }
    // Replace public data with a blank string
    else if (!aHidePrivateData && classList && classList.contains(CLASS_DATA_PUBLIC)) {
      node.textContent = "";
    }
    else {
      // Replace localized text with non-localized text
      if (copyData != null) {
        node.textContent = copyData;
        copyData = null;
      }
    }

    if (node.nodeType == Node.ELEMENT_NODE)
      cleanUpText(node, aHidePrivateData);

    // Advance!
    node = node.nextSibling;
  }
}

// Return the plain text representation of an element.  Do a little bit
// of pretty-printing to make it human-readable.
function createTextForElement(elem, aHidePrivateData) {
  // Generate the initial text.
  let textFragmentAccumulator = [];
  generateTextForElement(elem, aHidePrivateData, "", textFragmentAccumulator);
  let text = textFragmentAccumulator.join("");

  // Trim extraneous whitespace before newlines, then squash extraneous
  // blank lines.
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  // Actual CR/LF pairs are needed for some Windows text editors.
  if ("@mozilla.org/windows-registry-key;1" in Cc)
    text = text.replace(/\n/g, "\r\n");

  return text;
}

/**
 * Elements to replace entirely with custom text. Keys are element ids, values
 * are functions that return the text. The functions themselves are defined in
 * the files for their respective sections.
 */
var gElementsToReplace = {
  "accounts-table": getAccountsText,
  "extensions-table": getExtensionsText,
};

function generateTextForElement(elem, aHidePrivateData, indent,
                                textFragmentAccumulator) {
  // Add a little extra spacing around most elements.
  if (!["td", "th", "span", "a"].includes(elem.tagName))
    textFragmentAccumulator.push("\n");

  // If this element is one of our elements to replace with text, do it.
  if (elem.id in gElementsToReplace) {
    let replaceFn = gElementsToReplace[elem.id];
    textFragmentAccumulator.push(replaceFn(aHidePrivateData, indent + "  "));
    return;
  };

  if (AppConstants.MOZ_CRASHREPORTER) {
    if (elem.id == "crashes-table")
    {
      textFragmentAccumulator.push(getCrashesText(indent));
      return;
    }
  }

  let childCount = elem.childElementCount;

  // We're not going to spread a two-column <tr> across multiple lines, so
  // handle that separately.
  if (elem.tagName == "tr" && childCount == 2) {
    textFragmentAccumulator.push(indent);
    textFragmentAccumulator.push(elem.children[0].textContent.trim() + ": " +
                                 elem.children[1].textContent.trim());
    return;
  }

  // Generate the text representation for each child node.
  let node = elem.firstChild;
  while (node) {
    if (node.nodeType == Node.TEXT_NODE) {
      // Text belonging to this element uses its indentation level.
      generateTextForTextNode(node, indent, textFragmentAccumulator);
    }
    else if (node.nodeType == Node.ELEMENT_NODE) {
      // Recurse on the child element with an extra level of indentation (but
      // only if there's more than one child).
      generateTextForElement(node, aHidePrivateData,
                             indent + (childCount > 1 ? "  " : ""),
                             textFragmentAccumulator);
    }
    // Advance!
    node = node.nextSibling;
  }
}

function generateTextForTextNode(node, indent, textFragmentAccumulator) {
  // If the text node is the first of a run of text nodes, then start
  // a new line and add the initial indentation.
  let prevNode = node.previousSibling;
  if (!prevNode || prevNode.nodeType == Node.TEXT_NODE)
    textFragmentAccumulator.push("\n" + indent);

  // Trim the text node's text content and add proper indentation after
  // any internal line breaks.
  let text = node.textContent.trim().replace(/\n/g, "\n" + indent);
  textFragmentAccumulator.push(text);
}
