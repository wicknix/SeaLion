/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var gIndex;
var gCommaIndex = "0";
var gSpaceIndex = "1";
var gOtherIndex = "2";

// dialog initialization code
function Startup()
{
  if (!GetCurrentEditor())
  {
    window.close();
    return;
  }

  gDialog.sepRadioGroup      = document.getElementById("SepRadioGroup");
  gDialog.sepCharacterInput  = document.getElementById("SepCharacterInput");
  gDialog.deleteSepCharacter = document.getElementById("DeleteSepCharacter");
  gDialog.collapseSpaces     = document.getElementById("CollapseSpaces");

  // We persist the user's separator character
  gDialog.sepCharacterInput.value = gDialog.sepRadioGroup.getAttribute("character");

  gIndex = gDialog.sepRadioGroup.getAttribute("index");

  switch (gIndex)
  {
    case gCommaIndex:
    default:
      gDialog.sepRadioGroup.selectedItem = document.getElementById("comma");
      break;
    case gSpaceIndex:
      gDialog.sepRadioGroup.selectedItem = document.getElementById("space");
      break;
    case gOtherIndex:
      gDialog.sepRadioGroup.selectedItem = document.getElementById("other");
      break;
  }

  // Set initial enable state on character input and "collapse" checkbox
  SelectCharacter(gIndex);

  SetWindowLocation();
}

function InputSepCharacter()
{
  var str = gDialog.sepCharacterInput.value;

  // Limit input to 1 character
  if (str.length > 1)
    str = str.slice(0,1);

  // We can never allow tag or entity delimiters for separator character
  if (str == "<" || str == ">" || str == "&" || str == ";" || str == " ")
    str = "";

  gDialog.sepCharacterInput.value = str;
}

function SelectCharacter(radioGroupIndex)
{
  gIndex = radioGroupIndex;
  SetElementEnabledById("SepCharacterInput", gIndex == gOtherIndex);
  SetElementEnabledById("CollapseSpaces", gIndex == gSpaceIndex);
}

function onAccept()
{
  var sepCharacter = "";
  switch (gIndex)
  {
    case gCommaIndex:
      sepCharacter = ",";
      break;
    case gSpaceIndex:
      sepCharacter = " ";
      break;
    case gOtherIndex:
      sepCharacter = gDialog.sepCharacterInput.value.slice(0,1);
      break;
  }

  var editor = GetCurrentEditor();
  var str;
  try {
    str = editor.outputToString("text/html", kOutputLFLineBreak | kOutputSelectionOnly);
  } catch (e) {}
  if (!str)
  {
    SaveWindowLocation();
    return true;
  }

  // Replace nbsp with spaces:
  str = str.replace(/\u00a0/g, " ");

  // Strip out </p> completely
  str = str.replace(/\s*<\/p>\s*/g, "");

  // Trim whitespace adjacent to <p> and <br> tags
  //  and replace <p> with <br> 
  //  (which will be replaced with </tr> below)
  str = str.replace(/\s*<p>\s*|\s*<br>\s*/g, "<br>");

  // Trim leading <br>s
  str = str.replace(/^(<br>)+/, "");

  // Trim trailing <br>s
  str = str.replace(/(<br>)+$/, "");

  // Reduce multiple internal <br> to just 1
  // TODO: Maybe add a checkbox to let user decide
  //str = str.replace(/(<br>)+/g, "<br>");

  // Trim leading and trailing spaces
  str = str.trim();

  // Remove all tag contents so we don't replace
  //   separator character within tags
  // Also converts lists to something usefull
  var stack = [];
  var start;
  var end;
  var searchStart = 0;
  var listSeparator = "";
  var listItemSeparator = "";
  var endList = false;

  do {
    start = str.indexOf("<", searchStart);

    if (start >= 0)
    {
      end = str.indexOf(">", start+1);
      if (end > start)
      {
        let tagContent = str.slice(start + 1, end).trim();

        if (/^ol|^ul|^dl/.test(tagContent))
        {
          //  Replace list tag with <BR> to start new row 
          //   at begining of second or greater list tag
          str = str.slice(0, start) + listSeparator + str.slice(end+1);
          if (listSeparator == "")
            listSeparator = "<br>";
          
          // Reset for list item separation into cells
          listItemSeparator = "";
        }
        else if (/^li|^dt|^dd/.test(tagContent))
        {
          // Start a new row if this is first item after the ending the last list
          if (endList)
            listItemSeparator = "<br>";

          // Start new cell at begining of second or greater list items
          str = str.slice(0, start) + listItemSeparator + str.slice(end+1);

          if (endList || listItemSeparator == "")
            listItemSeparator = sepCharacter;

          endList = false;
        }
        else 
        {
          // Find end tags
          endList = /^\/ol|^\/ul|^\/dl/.test(tagContent);
          if (endList || /^\/li|^\/dt|^\/dd/.test(tagContent))
          {
            // Strip out tag
            str = str.slice(0, start) + str.slice(end+1);
          }
          else
          {
            // Not a list-related tag: Store tag contents in an array
            stack.push(tagContent);
           
            // Keep the "<" and ">" while removing from source string
            start++;
            str = str.slice(0, start) + str.slice(end);
          }
        }
      }
      searchStart = start + 1;
    }
  } while (start >= 0);

  // Replace separator characters with table cells
  var replaceString;
  if (gDialog.deleteSepCharacter.checked)
  {
    replaceString = "";
  }  
  else
  {
    // Don't delete separator character,
    //  so include it at start of string to replace
    replaceString = sepCharacter;
  }

  replaceString += "<td>"; 

  if (sepCharacter.length > 0)
  {
    var tempStr = sepCharacter;
    var regExpChars = ".!@#$%^&*-+[]{}()\|\\\/";
    if (regExpChars.includes(sepCharacter))
      tempStr = "\\" + sepCharacter;

    if (gIndex == gSpaceIndex)
    {
      // If checkbox is checked, 
      //   one or more adjacent spaces are one separator
      if (gDialog.collapseSpaces.checked)
          tempStr = "\\s+"
        else
          tempStr = "\\s";
    }
    var pattern = new RegExp(tempStr, "g");
    str = str.replace(pattern, replaceString);
  }

  // Put back tag contents that we removed above
  searchStart = 0;
  var stackIndex = 0;
  do {
    start = str.indexOf("<", searchStart);
    end = start + 1;
    if (start >= 0 && str.charAt(end) == ">")
    {
      // We really need a FIFO stack!
      str = str.slice(0, end) + stack[stackIndex++] + str.slice(end);
    }
    searchStart = end;

  } while (start >= 0);

  // End table row and start another for each br or p
  str = str.replace(/\s*<br>\s*/g, "</tr>\n<tr><td>");

  // Add the table tags and the opening and closing tr/td tags
  // Default table attributes should be same as those used in nsHTMLEditor::CreateElementWithDefaults()
  // (Default width="100%" is used in EdInsertTable.js)
  str = "<table border=\"1\" width=\"100%\" cellpadding=\"2\" cellspacing=\"2\">\n<tr><td>" + str + "</tr>\n</table>\n";

  editor.beginTransaction();
  
  // Delete the selection -- makes it easier to find where table will insert
  var nodeBeforeTable = null;
  var nodeAfterTable = null;
  try {
    editor.deleteSelection(editor.eNone, editor.eStrip);

    var anchorNodeBeforeInsert = editor.selection.anchorNode;
    var offset = editor.selection.anchorOffset;
    if (anchorNodeBeforeInsert.nodeType == Node.TEXT_NODE)
    {
      // Text was split. Table should be right after the first or before 
      nodeBeforeTable = anchorNodeBeforeInsert.previousSibling;
      nodeAfterTable = anchorNodeBeforeInsert;
    }
    else
    {
      // Table should be inserted right after node pointed to by selection
      if (offset > 0)
        nodeBeforeTable = anchorNodeBeforeInsert.childNodes.item(offset - 1);

      nodeAfterTable = anchorNodeBeforeInsert.childNodes.item(offset);
    }
  
    editor.insertHTML(str);
  } catch (e) {}

  var table = null;
  if (nodeAfterTable)
  {
    var previous = nodeAfterTable.previousSibling;
    if (previous && previous.nodeName.toLowerCase() == "table")
      table = previous;
  }
  if (!table && nodeBeforeTable)
  {
    var next = nodeBeforeTable.nextSibling;
    if (next && next.nodeName.toLowerCase() == "table")
      table = next;
  }

  if (table)
  {
    // Fixup table only if pref is set
    var firstRow;
    try {
      if (Services.prefs.getBoolPref("editor.table.maintain_structure"))
        editor.normalizeTable(table);

      firstRow = editor.getFirstRow(table);
    } catch(e) {}

    // Put caret in first cell
    if (firstRow)
    {
      var node2 = firstRow.firstChild;
      do {
        if (node2.nodeName.toLowerCase() == "td" ||
            node2.nodeName.toLowerCase() == "th")
        {
          try { 
            editor.selection.collapse(node2, 0);
          } catch(e) {}
          break;
        }
        node2 = node.nextSibling;
      } while (node2);
    }
  }

  editor.endTransaction();

  // Save persisted attributes
  gDialog.sepRadioGroup.setAttribute("index", gIndex);
  if (gIndex == gOtherIndex)
    gDialog.sepRadioGroup.setAttribute("character", sepCharacter);

  SaveWindowLocation();
  return true;
}
