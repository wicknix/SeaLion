/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 Note: We encourage non-empty alt text for images inserted into a page.
 When there's no alt text, we always write 'alt=""' as the attribute, since "alt" is a required attribute.
 We allow users to not have alt text by checking a "Don't use alterate text" radio button,
 and we don't accept spaces as valid alt text. A space used to be required to avoid the error message
 if user didn't enter alt text, but is unnecessary now that we no longer annoy the user
 with the error dialog if alt="" is present on an img element.
 We trim all spaces at the beginning and end of user's alt text
*/

var gInsertNewImage = true;
var gDoAltTextError = false;
var gConstrainOn = false;
// Note used in current version, but these are set correctly
//  and could be used to reset width and height used for constrain ratio
var gConstrainWidth  = 0;
var gConstrainHeight = 0;
var imageElement;
var gImageMap = 0;
var gCanRemoveImageMap = false;
var gRemoveImageMap = false;
var gImageMapDisabled = false;
var gActualWidth = "";
var gActualHeight = "";
var gOriginalSrc = "";
var gHaveDocumentUrl = false;
var gTimerID;
var gValidateTab;

// These must correspond to values in EditorDialog.css for each theme
// (unfortunately, setting "style" attribute here doesn't work!)
var gPreviewImageWidth = 80;
var gPreviewImageHeight = 50;

// dialog initialization code

function ImageStartup()
{
  gDialog.tabBox            = document.getElementById( "TabBox" );
  gDialog.tabLocation       = document.getElementById( "imageLocationTab" );
  gDialog.tabDimensions     = document.getElementById( "imageDimensionsTab" );
  gDialog.tabBorder         = document.getElementById( "imageBorderTab" );
  gDialog.srcInput          = document.getElementById( "srcInput" );
  gDialog.titleInput        = document.getElementById( "titleInput" );
  gDialog.altTextInput      = document.getElementById( "altTextInput" );
  gDialog.altTextRadioGroup = document.getElementById( "altTextRadioGroup" );
  gDialog.altTextRadio      = document.getElementById( "altTextRadio" );
  gDialog.noAltTextRadio    = document.getElementById( "noAltTextRadio" );
  gDialog.actualSizeRadio   = document.getElementById( "actualSizeRadio" );
  gDialog.constrainCheckbox = document.getElementById( "constrainCheckbox" );
  gDialog.widthInput        = document.getElementById( "widthInput" );
  gDialog.heightInput       = document.getElementById( "heightInput" );
  gDialog.widthUnitsMenulist   = document.getElementById( "widthUnitsMenulist" );
  gDialog.heightUnitsMenulist  = document.getElementById( "heightUnitsMenulist" );
  gDialog.imagelrInput      = document.getElementById( "imageleftrightInput" );
  gDialog.imagetbInput      = document.getElementById( "imagetopbottomInput" );
  gDialog.border            = document.getElementById( "border" );
  gDialog.alignTypeSelect   = document.getElementById( "alignTypeSelect" );
  gDialog.ImageHolder       = document.getElementById( "preview-image-holder" );
  gDialog.PreviewWidth      = document.getElementById( "PreviewWidth" );
  gDialog.PreviewHeight     = document.getElementById( "PreviewHeight" );
  gDialog.PreviewSize       = document.getElementById( "PreviewSize" );
  gDialog.PreviewImage      = null;
  gDialog.OkButton          = document.documentElement.getButton("accept");
}

// Set dialog widgets with attribute data
// We get them from globalElement copy so this can be used
//   by AdvancedEdit(), which is shared by all property dialogs
function InitImage()
{
  // Set the controls to the image's attributes
  var src = globalElement.getAttribute("src");

  // For image insertion the 'src' attribute is null.
  if (src) {
    // Shorten data URIs for display.
    if (shortenImageData(src, gDialog.srcInput)) {
      gDialog.srcInput.removeAttribute("tooltiptext");
      gDialog.srcInput.setAttribute("tooltip", "shortenedDataURI");
    }
  }

  // Set "Relativize" checkbox according to current URL state
  SetRelativeCheckbox();

  // Force loading of image from its source and show preview image
  LoadPreviewImage();

  gDialog.titleInput.value = globalElement.getAttribute("title");

  var hasAltText = globalElement.hasAttribute("alt");
  var altText = globalElement.getAttribute("alt");
  gDialog.altTextInput.value = altText;
  if (altText || (!hasAltText && globalElement.hasAttribute("src")))
  {
    gDialog.altTextRadioGroup.selectedItem = gDialog.altTextRadio;
  }
  else if (hasAltText)
  {
    gDialog.altTextRadioGroup.selectedItem = gDialog.noAltTextRadio;
  }
  SetAltTextDisabled(gDialog.altTextRadioGroup.selectedItem == gDialog.noAltTextRadio);

  // setup the height and width widgets
  var width = InitPixelOrPercentMenulist(globalElement,
                    gInsertNewImage ? null : imageElement,
                    "width", "widthUnitsMenulist", gPixel);
  var height = InitPixelOrPercentMenulist(globalElement,
                    gInsertNewImage ? null : imageElement,
                    "height", "heightUnitsMenulist", gPixel);

  // Set actual radio button if both set values are the same as actual
  SetSizeWidgets(width, height);

  gDialog.widthInput.value  = gConstrainWidth = width ? width : (gActualWidth ? gActualWidth : "");
  gDialog.heightInput.value = gConstrainHeight = height ? height : (gActualHeight ? gActualHeight : "");

  // set spacing editfields
  gDialog.imagelrInput.value = globalElement.getAttribute("hspace");
  gDialog.imagetbInput.value = globalElement.getAttribute("vspace");

  // dialog.border.value       = globalElement.getAttribute("border");
  var bv = GetHTMLOrCSSStyleValue(globalElement, "border", "border-top-width");
  if (bv.includes("px"))
  {
    // Strip out the px
    bv = bv.substr(0, bv.indexOf("px"));
  }
  else if (bv == "thin")
  {
    bv = "1";
  }
  else if (bv == "medium")
  {
    bv = "3";
  }
  else if (bv == "thick")
  {
    bv = "5";
  }
  gDialog.border.value = bv;

  // Get alignment setting
  var align = globalElement.getAttribute("align");
  if (align)
    align = align.toLowerCase();

  var imgClass;
  var textID;

  switch ( align )
  {
    case "top":
    case "middle":
    case "right":
    case "left":
      gDialog.alignTypeSelect.value = align;
      break;
    default:  // Default or "bottom"
      gDialog.alignTypeSelect.value = "bottom";
  }

  // Get image map for image
  gImageMap = GetImageMap();

  doOverallEnabling();
  doDimensionEnabling();
}

function  SetSizeWidgets(width, height)
{
  if (!(width || height) || (gActualWidth && gActualHeight && width == gActualWidth && height == gActualHeight))
    gDialog.actualSizeRadio.radioGroup.selectedItem = gDialog.actualSizeRadio;

  if (!gDialog.actualSizeRadio.selected)
  {
    // Decide if user's sizes are in the same ratio as actual sizes
    if (gActualWidth && gActualHeight)
    {
      if (gActualWidth > gActualHeight)
        gDialog.constrainCheckbox.checked = (Math.round(gActualHeight * width / gActualWidth) == height);
      else
        gDialog.constrainCheckbox.checked = (Math.round(gActualWidth * height / gActualHeight) == width);
    }
  }
}

// Disable alt text input when "Don't use alt" radio is checked
function SetAltTextDisabled(disable)
{
  gDialog.altTextInput.disabled = disable;
}

function GetImageMap()
{
  var usemap = globalElement.getAttribute("usemap");
  if (usemap)
  {
    gCanRemoveImageMap = true;
    let mapname = usemap.substr(1);
    try {
      return GetCurrentEditor().document.querySelector('[name="' + mapname + '"]');
    } catch (e) {}
  }
  else
  {
    gCanRemoveImageMap = false;
  }

  return null;
}

function chooseFile()
{
  if (gTimerID)
    clearTimeout(gTimerID);
  // Get a local file, converted into URL format
  var fileName = GetLocalFileURL("img");
  if (fileName)
  {
    // Always try to relativize local file URLs
    if (gHaveDocumentUrl)
      fileName = MakeRelativeUrl(fileName);

    gDialog.srcInput.value = fileName;

    SetRelativeCheckbox();
    doOverallEnabling();
  }
  LoadPreviewImage();

  // Put focus into the input field
  SetTextboxFocus(gDialog.srcInput);
}

function PreviewImageLoaded()
{
  if (gDialog.PreviewImage)
  {
    // Image loading has completed -- we can get actual width
    gActualWidth  = gDialog.PreviewImage.naturalWidth;
    gActualHeight = gDialog.PreviewImage.naturalHeight;

    if (gActualWidth && gActualHeight)
    {
      // Use actual size or scale to fit preview if either dimension is too large
      var width = gActualWidth;
      var height = gActualHeight;
      if (gActualWidth > gPreviewImageWidth)
      {
          width = gPreviewImageWidth;
          height = gActualHeight * (gPreviewImageWidth / gActualWidth);
      }
      if (height > gPreviewImageHeight)
      {
        height = gPreviewImageHeight;
        width = gActualWidth * (gPreviewImageHeight / gActualHeight);
      }
      gDialog.PreviewImage.width = width;
      gDialog.PreviewImage.height = height;

      gDialog.PreviewWidth.setAttribute("value", gActualWidth);
      gDialog.PreviewHeight.setAttribute("value", gActualHeight);

      gDialog.PreviewSize.collapsed = false;
      gDialog.ImageHolder.collapsed = false;

      SetSizeWidgets(gDialog.widthInput.value, gDialog.heightInput.value);
    }

    if (gDialog.actualSizeRadio.selected)
      SetActualSize();
  }
}

function LoadPreviewImage()
{
  gDialog.PreviewSize.collapsed = true;
  // XXXbz workaround for bug 265416 / bug 266284
  gDialog.ImageHolder.collapsed = true;

  var imageSrc = TrimString(gDialog.srcInput.value);
  if (!imageSrc)
    return;
  if (isImageDataShortened(imageSrc))
  {
    imageSrc = restoredImageData(gDialog.srcInput);
  }

  try {
    // Remove the image URL from image cache so it loads fresh
    //  (if we don't do this, loads after the first will always use image cache
    //   and we won't see image edit changes or be able to get actual width and height)

    // We must have an absolute URL to preview it or remove it from the cache
    imageSrc = MakeAbsoluteUrl(imageSrc);

    if (GetScheme(imageSrc))
    {
      let uri = Services.io.newURI(imageSrc, null, null);
      if (uri)
      {
        let imgCache = Components.classes["@mozilla.org/image/cache;1"]
                                 .getService(Components.interfaces.imgICache);

        // This returns error if image wasn't in the cache; ignore that
        imgCache.removeEntry(uri);
      }
    }
  } catch(e) {}

  if (gDialog.PreviewImage)
    removeEventListener("load", PreviewImageLoaded, true);

  if (gDialog.ImageHolder.hasChildNodes())
    gDialog.ImageHolder.firstChild.remove();

  gDialog.PreviewImage = document.createElementNS("http://www.w3.org/1999/xhtml", "html:img");
  if (gDialog.PreviewImage)
  {
    // set the src before appending to the document -- see bug 198435 for why
    // this is needed.
    // XXXbz that bug is long-since fixed.  Is this still needed?
    gDialog.PreviewImage.addEventListener("load", PreviewImageLoaded, true);
    gDialog.PreviewImage.src = imageSrc;
    gDialog.ImageHolder.appendChild(gDialog.PreviewImage);
  }
}

function SetActualSize()
{
  gDialog.widthInput.value = gActualWidth ? gActualWidth : "";
  gDialog.widthUnitsMenulist.selectedIndex = 0;
  gDialog.heightInput.value = gActualHeight ? gActualHeight : "";
  gDialog.heightUnitsMenulist.selectedIndex = 0;
  doDimensionEnabling();
}

function ChangeImageSrc()
{
  if (gTimerID)
    clearTimeout(gTimerID);

  gTimerID = setTimeout(LoadPreviewImage, 800);

  SetRelativeCheckbox();
  doOverallEnabling();
}

function doDimensionEnabling()
{
  // Enabled unless "Actual Size" is selected
  var enable = !gDialog.actualSizeRadio.selected;

  // BUG 74145: After input field is disabled,
  //   setting it enabled causes blinking caret to appear
  //   even though focus isn't set to it.
  SetElementEnabledById( "heightInput", enable );
  SetElementEnabledById( "heightLabel", enable );
  SetElementEnabledById( "heightUnitsMenulist", enable );

  SetElementEnabledById( "widthInput", enable );
  SetElementEnabledById( "widthLabel", enable);
  SetElementEnabledById( "widthUnitsMenulist", enable );

  var constrainEnable = enable
         && ( gDialog.widthUnitsMenulist.selectedIndex == 0 )
         && ( gDialog.heightUnitsMenulist.selectedIndex == 0 );

  SetElementEnabledById( "constrainCheckbox", constrainEnable );
}

function doOverallEnabling()
{
  var enabled = TrimString(gDialog.srcInput.value) != "";

  SetElementEnabled(gDialog.OkButton, enabled);
  SetElementEnabledById("AdvancedEditButton1", enabled);
  SetElementEnabledById("imagemapLabel", enabled);
  SetElementEnabledById("removeImageMap", gCanRemoveImageMap);
}

function ToggleConstrain()
{
  // If just turned on, save the current width and height as basis for constrain ratio
  // Thus clicking on/off lets user say "Use these values as aspect ration"
  if (gDialog.constrainCheckbox.checked && !gDialog.constrainCheckbox.disabled
     && (gDialog.widthUnitsMenulist.selectedIndex == 0)
     && (gDialog.heightUnitsMenulist.selectedIndex == 0))
  {
    gConstrainWidth = Number(TrimString(gDialog.widthInput.value));
    gConstrainHeight = Number(TrimString(gDialog.heightInput.value));
  }
}

function constrainProportions( srcID, destID )
{
  var srcElement = document.getElementById(srcID);
  if (!srcElement)
    return;

  var destElement = document.getElementById(destID);
  if (!destElement)
    return;

  // always force an integer (whether we are constraining or not)
  forceInteger(srcID);

  if (!gActualWidth || !gActualHeight ||
      !(gDialog.constrainCheckbox.checked && !gDialog.constrainCheckbox.disabled))
    return;

  // double-check that neither width nor height is in percent mode; bail if so!
  if ( (gDialog.widthUnitsMenulist.selectedIndex != 0)
     || (gDialog.heightUnitsMenulist.selectedIndex != 0) )
    return;

  // This always uses the actual width and height ratios
  // which is kind of funky if you change one number without the constrain
  // and then turn constrain on and change a number
  // I prefer the old strategy (below) but I can see some merit to this solution
  if (srcID == "widthInput")
    destElement.value = Math.round( srcElement.value * gActualHeight / gActualWidth );
  else
    destElement.value = Math.round( srcElement.value * gActualWidth / gActualHeight );

/*
  // With this strategy, the width and height ratio
  //   can be reset to whatever the user entered.
  if (srcID == "widthInput")
    destElement.value = Math.round( srcElement.value * gConstrainHeight / gConstrainWidth );
  else
    destElement.value = Math.round( srcElement.value * gConstrainWidth / gConstrainHeight );
*/
}

function removeImageMap()
{
  gRemoveImageMap = true;
  gCanRemoveImageMap = false;
  SetElementEnabledById("removeImageMap", false);
}

function SwitchToValidatePanel()
{
  if (gDialog.tabBox && gValidateTab && gDialog.tabBox.selectedTab != gValidateTab)
    gDialog.tabBox.selectedTab = gValidateTab;
}

// Get data from widgets, validate, and set for the global element
//   accessible to AdvancedEdit() [in EdDialogCommon.js]
function ValidateImage()
{
  var editor = GetCurrentEditor();
  if (!editor)
    return false;

  gValidateTab = gDialog.tabLocation;
  if (!gDialog.srcInput.value)
  {
    Services.prompt.alert(window, GetString("Alert"), GetString("MissingImageError"));
    SwitchToValidatePanel();
    gDialog.srcInput.focus();
    return false;
  }

  // We must convert to "file:///" or "http://" format else image doesn't load!
  let src = gDialog.srcInput.value.trim();

  if (isImageDataShortened(src))
  {
    src = restoredImageData(gDialog.srcInput);
  }
  else
  {
    var checkbox = document.getElementById("MakeRelativeCheckbox");
    try
    {
      if (checkbox && !checkbox.checked)
      {
        src = Services.uriFixup.createFixupURI(src, Components.interfaces.nsIURIFixup.FIXUP_FLAG_NONE).spec;
      }
    } catch (e) { }

    globalElement.setAttribute("src", src);
  }

  let title = gDialog.titleInput.value.trim();
  if (title)
    globalElement.setAttribute("title", title);
  else
    globalElement.removeAttribute("title");

  // Force user to enter Alt text only if "Alternate text" radio is checked
  // Don't allow just spaces in alt text
  var alt = "";
  var useAlt = gDialog.altTextRadioGroup.selectedItem == gDialog.altTextRadio;
  if (useAlt)
    alt = TrimString(gDialog.altTextInput.value);

  if (alt || !useAlt)
  {
    globalElement.setAttribute("alt", alt);
  }
  else if (!gDoAltTextError)
  {
    globalElement.removeAttribute("alt");
  }
  else
  {
    Services.prompt.alert(window, GetString("Alert"), GetString("NoAltText"));
    SwitchToValidatePanel();
    gDialog.altTextInput.focus();
    return false;
  }

  var width = "";
  var height = "";

  gValidateTab = gDialog.tabDimensions;
  if (!gDialog.actualSizeRadio.selected)
  {
    // Get user values for width and height
    width = ValidateNumber(gDialog.widthInput, gDialog.widthUnitsMenulist, 1, gMaxPixels,
                           globalElement, "width", false, true);
    if (gValidationError)
      return false;

    height = ValidateNumber(gDialog.heightInput, gDialog.heightUnitsMenulist, 1, gMaxPixels,
                            globalElement, "height", false, true);
    if (gValidationError)
      return false;
  }

  // We always set the width and height attributes, even if same as actual.
  //  This speeds up layout of pages since sizes are known before image is loaded
  if (!width)
    width = gActualWidth;
  if (!height)
    height = gActualHeight;

  // Remove existing width and height only if source changed
  //  and we couldn't obtain actual dimensions
  var srcChanged = (src != gOriginalSrc);
  if (width)
    editor.setAttributeOrEquivalent(globalElement, "width", width, true);
  else if (srcChanged)
    editor.removeAttributeOrEquivalent(globalElement, "width", true);

  if (height)
    editor.setAttributeOrEquivalent(globalElement, "height", height, true);
  else if (srcChanged)
    editor.removeAttributeOrEquivalent(globalElement, "height", true);

  // spacing attributes
  gValidateTab = gDialog.tabBorder;
  ValidateNumber(gDialog.imagelrInput, null, 0, gMaxPixels,
                 globalElement, "hspace", false, true, true);
  if (gValidationError)
    return false;

  ValidateNumber(gDialog.imagetbInput, null, 0, gMaxPixels,
                 globalElement, "vspace", false, true);
  if (gValidationError)
    return false;

  // note this is deprecated and should be converted to stylesheets
  ValidateNumber(gDialog.border, null, 0, gMaxPixels,
                 globalElement, "border", false, true);
  if (gValidationError)
    return false;

  // Default or setting "bottom" means don't set the attribute
  // Note that the attributes "left" and "right" are opposite
  //  of what we use in the UI, which describes where the TEXT wraps,
  //  not the image location (which is what the HTML describes)
  switch ( gDialog.alignTypeSelect.value )
  {
    case "top":
    case "middle":
    case "right":
    case "left":
      editor.setAttributeOrEquivalent( globalElement, "align",
                                       gDialog.alignTypeSelect.value , true);
      break;
    default:
      try {
        editor.removeAttributeOrEquivalent(globalElement, "align", true);
      } catch (e) {}
  }

  return true;
}
