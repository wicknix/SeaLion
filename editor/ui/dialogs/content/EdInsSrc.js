/* -*- Mode: Java; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Insert Source HTML dialog */

var gFullDataStrings = new Map();
var gShortDataStrings = new Map();
var gListenerAttached = false;

function Startup()
{
  let editor = GetCurrentEditor();
  if (!editor)
  {
    window.close();
    return;
  }

  document.documentElement.getButton("accept").removeAttribute("default");

  // Create dialog object to store controls for easy access
  gDialog.srcInput = document.getElementById("srcInput");

  // Attach a paste listener so we can detect pasted data URIs we need to shorten.
  gDialog.srcInput.addEventListener("paste", onPaste);

  let selection;
  try {
    selection = editor.outputToString("text/html", kOutputFormatted | kOutputSelectionOnly | kOutputWrap);
  } catch (e) {}
  if (selection)
  {
    selection = (selection.replace(/<body[^>]*>/,"")).replace(/<\/body>/,"");

    // Shorten data URIs for display.
    selection = replaceDataURIs(selection);

    if (selection)
      gDialog.srcInput.value = selection;
  }
  // Set initial focus
  gDialog.srcInput.focus();
  // Note: We can't set the caret location in a multiline textbox
  SetWindowLocation();
}

function replaceDataURIs(input)
{
  return input.replace(/(data:.+;base64,)([^"' >]+)/gi,
    function(match, nonDataPart, dataPart) {

      if (gShortDataStrings.has(dataPart)) {
          // We found the exact same data URI, just return the shortened URI.
          return nonDataPart + gShortDataStrings.get(dataPart);
      }

      let l = 5;
      // Normally we insert the ellipsis after five characters but if it's not unique
      // we include more data.
      do {
        key = dataPart.substr(0, l) + "…" + dataPart.substr(dataPart.length - 10);
        l++;
      } while (gFullDataStrings.has(key) && l < dataPart.length - 10);
      gFullDataStrings.set(key, dataPart);
      gShortDataStrings.set(dataPart, key);

      // Attach listeners. In case anyone copies/cuts from the HTML window,
      // we want to restore the data URI on the clipboard.
      if (!gListenerAttached) {
        gDialog.srcInput.addEventListener("copy", onCopyOrCut);
        gDialog.srcInput.addEventListener("cut", onCopyOrCut);
        gListenerAttached = true;
      }

      return nonDataPart + key;
    });
}

function onCopyOrCut(event)
{
  let startPos = gDialog.srcInput.selectionStart;
  if (startPos == undefined)
    return;
  let endPos = gDialog.srcInput.selectionEnd;
  let clipboard = gDialog.srcInput.value.substring(startPos, endPos);

  // Add back the original data URIs we stashed away earlier.
  clipboard = clipboard.replace(/(data:.+;base64,)([^"' >]+)/gi,
    function(match, nonDataPart, key) {
      if (!gFullDataStrings.has(key))
        return match; // user changed data URI
      return nonDataPart + gFullDataStrings.get(key);
    });
  event.clipboardData.setData("text/plain", clipboard);
  if (event.type == "cut") {
    // We have to cut the selection manually.
    gDialog.srcInput.value = gDialog.srcInput.value.substr(0, startPos) +
                             gDialog.srcInput.value.substr(endPos);
  }
  event.preventDefault();
}

function onPaste(event)
{
  let startPos = gDialog.srcInput.selectionStart;
  if (startPos == undefined)
    return;
  let endPos = gDialog.srcInput.selectionEnd;
  let clipboard = event.clipboardData.getData("text/plain");

  // We do out own paste by replacing the selection with the pre-processed
  // clipboard data.
  gDialog.srcInput.value = gDialog.srcInput.value.substr(0, startPos) +
                           replaceDataURIs(clipboard) +
                           gDialog.srcInput.value.substr(endPos);
  event.preventDefault();
}

function onAccept()
{
  let html = gDialog.srcInput.value;
  if (!html)
    return false;

  // Add back the original data URIs we stashed away earlier.
  html = html.replace(/(data:.+;base64,)([^"' >]+)/gi,
    function(match, nonDataPart, key) {
      if (!gFullDataStrings.has(key))
        return match; // user changed data URI
      return nonDataPart + gFullDataStrings.get(key);
    });

  try {
    GetCurrentEditor().insertHTML(html);
  } catch (e) {}
  SaveWindowLocation();

  return true;
}

