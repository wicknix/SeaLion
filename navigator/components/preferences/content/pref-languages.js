/* -*- Mode: Java; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var gActiveLanguages;
var gLanguages;
var gLanguageNames = [];
var gLanguageTitles = {};

var gDictCount = 0;
var gLastSelectedDict;

function Startup()
{
  // Content Language
  gActiveLanguages = document.getElementById("activeLanguages");
  // gLanguages stores the ordered list of languages, due to the nature
  // of childNodes it is live and updates automatically.
  gLanguages = gActiveLanguages.childNodes;

  ReadAvailableLanguages();

  // Spell Checking
  if ("@mozilla.org/spellchecker;1" in Components.classes)
    InitDictionaryMenu();
  else
  {
    document.getElementById("generalSpelling").hidden = true;
    document.getElementById("mailSpelling").hidden = true;
    document.getElementById("noSpellCheckLabel").hidden = false;
  }
}

// Content Language
function AddLanguage()
{
  document.documentElement.openSubDialog("chrome://communicator/content/pref/pref-languages-add.xul", "addlangwindow", gLanguageNames);
}

function ReadAvailableLanguages()
{
  var i = 0;
  var languagesBundle = document.getElementById("languageNamesBundle");
  var prefLangBundle = document.getElementById("prefLangBundle");
  var regionsBundle = document.getElementById("regionNamesBundle");
  var langStrings = document.getElementById("acceptedBundle").strings;

  while (langStrings.hasMoreElements())
  {
    // Progress through the bundle.
    var curItem = langStrings.getNext();

    if (!(curItem instanceof Components.interfaces.nsIPropertyElement))
      break;

    var stringNameProperty = curItem.key.split('.');

    var str = stringNameProperty[0];
    if (str && stringNameProperty[1] == 'accept')
    {
      var stringLangRegion = str.split('-');

      if (stringLangRegion[0])
      {
        var language = "";
        var region = null;

        try
        {
          language = languagesBundle.getString(stringLangRegion[0]);
        }
        catch (ex) {}

        if (stringLangRegion.length > 1)
        {
          try
          {
            region = regionsBundle.getString(stringLangRegion[1]);
          }
          catch (ex) {}
        }

        var title;
        if (region)
          title = prefLangBundle.getFormattedString("languageRegionCodeFormat",
                                                    [language, region, str]);
        else
          title = prefLangBundle.getFormattedString("languageCodeFormat",
                                                    [language, str]);
        gLanguageTitles[str] = title;
        if (curItem.value == "true")
          gLanguageNames.push([title, str]);
      }
    }
  }

  // Sort on first element.
  gLanguageNames.sort(
    function compareFn(a, b)
    {
      return a[0].localeCompare(b[0]);
    }
  );
}

function ReadActiveLanguages()
{
  var arrayOfPrefs = document.getElementById("intl.accept_languages").value
                             .toLowerCase().split(/\s*,\s*/);

  // No need to rebuild listitems if languages in prefs and listitems match.
  if (InSync(arrayOfPrefs))
   return;

  while (gActiveLanguages.hasChildNodes())
    gActiveLanguages.lastChild.remove();

  arrayOfPrefs.forEach(
    function(aKey)
    {
      if (aKey)
      {
        let langTitle = gLanguageTitles.hasOwnProperty(aKey) ?
                        gLanguageTitles[aKey] : "[" + aKey + "]";
        gActiveLanguages.appendItem(langTitle, aKey);
      }
    }
  );

  SelectLanguage();

  return;
}

// Checks whether listitems and pref values matches, returns false if not.
function InSync(aPrefArray)
{
  // Can't match if they don't have the same length.
  if (aPrefArray.length != gLanguages.length)
    return false;

  return aPrefArray.every(
    function(aElement, aIndex)
    {
      return aElement == gLanguages[aIndex].value;
    }
  );
}

// Called on onsynctopreference.
function WriteActiveLanguages()
{
  return Array.map(gLanguages, function(e) { return e.value; }).join(",");
}

function MoveUp()
{
  var selected = gActiveLanguages.selectedItem;
  var before = selected.previousSibling;
  if (before)
  {
    before.parentNode.insertBefore(selected, before);
    gActiveLanguages.selectItem(selected);
    gActiveLanguages.ensureElementIsVisible(selected);
  }

  SelectLanguage();
  gActiveLanguages.doCommand();
}

function MoveDown()
{
  var selected = gActiveLanguages.selectedItem;
  if (selected.nextSibling)
  {
    var before = selected.nextSibling.nextSibling;
    gActiveLanguages.insertBefore(selected, before);
    gActiveLanguages.selectItem(selected);
  }

  SelectLanguage();
  gActiveLanguages.doCommand();
}

function RemoveActiveLanguage(aEvent)
{
  if (aEvent && aEvent.keyCode != aEvent.DOM_VK_DELETE &&
      aEvent.keyCode != aEvent.DOM_VK_BACK_SPACE)
    return;

  var nextNode = null;

  while (gActiveLanguages.selectedItem)
  {
    var selectedNode = gActiveLanguages.selectedItem;
    nextNode = selectedNode.nextSibling || selectedNode.previousSibling;
    selectedNode.remove();
  }

  if (nextNode)
    gActiveLanguages.selectItem(nextNode);

  SelectLanguage();
  gActiveLanguages.doCommand();
}

function SelectLanguage()
{
  var len = gActiveLanguages.selectedItems.length;
  EnableElementById("langRemove", len, false);
  var selected = gActiveLanguages.selectedItem;
  EnableElementById("langDown", (len == 1) && selected.nextSibling, false);
  EnableElementById("langUp", (len == 1) && selected.previousSibling, false);
}

// Spell Checking
function InitDictionaryMenu() {
  var spellChecker = Components.classes["@mozilla.org/spellchecker/engine;1"]
                               .getService(Components.interfaces.mozISpellCheckingEngine);

  var o1 = {};
  var o2 = {};

  // Get the list of dictionaries from the spellchecker.
  spellChecker.getDictionaryList(o1, o2);

  var dictList = o1.value;
  var count    = o2.value;

  // If dictionary count hasn't changed then no need to update the menu.
  if (gDictCount == count)
    return;

  // Store current dictionary count.
  gDictCount = count;

  // Load the string bundles that will help us map
  // RFC 1766 strings to UI strings.

  // Load the language string bundle.
  var languageBundle = document.getElementById("languageNamesBundle");
  var regionBundle = null;
  // If we have a language string bundle, load the region string bundle.
  if (languageBundle)
    regionBundle = document.getElementById("regionNamesBundle");

  var menuStr2;
  var isoStrArray;
  var langId;
  var langLabel;

  for (let i = 0; i < count; i++) {
    try {
      langId = dictList[i];
      isoStrArray = dictList[i].split(/[-_]/);

      if (languageBundle && isoStrArray[0])
        langLabel = languageBundle.getString(isoStrArray[0].toLowerCase());

      if (regionBundle && langLabel && isoStrArray.length > 1 && isoStrArray[1]) {
        menuStr2 = regionBundle.getString(isoStrArray[1].toLowerCase());
        if (menuStr2)
          langLabel += "/" + menuStr2;
      }

      if (langLabel && isoStrArray.length > 2 && isoStrArray[2])
        langLabel += " (" + isoStrArray[2] + ")";

      if (!langLabel)
        langLabel = langId;
    } catch (ex) {
      // getString throws an exception when a key is not found in the
      // bundle. In that case, just use the original dictList string.
      langLabel = langId;
    }
    dictList[i] = [langLabel, langId];
  }

  // sort by locale-aware collation
  dictList.sort(
    function compareFn(a, b) {
      return a[0].localeCompare(b[0]);
    }
  );

  var languageMenuList = document.getElementById("languageMenuList");
  // Remove any languages from the list.
  var languageMenuPopup = languageMenuList.firstChild;
  while (languageMenuPopup.firstChild.localName != "menuseparator")
    languageMenuPopup.firstChild.remove();

  var curLang  = languageMenuList.value;
  var defaultItem = null;

  for (let i = 0; i < count; i++) {
    let item = languageMenuList.insertItemAt(i, dictList[i][0], dictList[i][1]);
    if (curLang && dictList[i][1] == curLang)
      defaultItem = item;
  }

  // Now make sure the correct item in the menu list is selected.
  if (defaultItem) {
    languageMenuList.selectedItem = defaultItem;
    gLastSelectedDict = defaultItem;
  }
}

function SelectDictionary(aTarget) {
  gLastSelectedDict = aTarget;
}
