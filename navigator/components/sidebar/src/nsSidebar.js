/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * No magic constructor behaviour, as is de rigeur for XPCOM.
 * If you must perform some initialization, and it could possibly fail (even
 * due to an out-of-memory condition), you should use an Init method, which
 * can convey failure appropriately (thrown exception in JS,
 * NS_FAILED(nsresult) return in C++).
 *
 * In JS, you can actually cheat, because a thrown exception will cause the
 * CreateInstance call to fail in turn, but not all languages are so lucky.
 * (Though ANSI C++ provides exceptions, they are verboten in Mozilla code
 * for portability reasons -- and even when you're building completely
 * platform-specific code, you can't throw across an XPCOM method boundary.)
 */

const DEBUG = false; /* set to false to suppress debug messages */
const PANELS_RDF_FILE  = "UPnls"; /* directory services property to find panels.rdf */

const SIDEBAR_CONTRACTID   = "@mozilla.org/sidebar;1";
const SIDEBAR_CID      = Components.ID("{22117140-9c6e-11d3-aaf1-00805f8a4905}");
const CONTAINER_CONTRACTID = "@mozilla.org/rdf/container;1";
const NETSEARCH_CONTRACTID = "@mozilla.org/rdf/datasource;1?name=internetsearch"
const nsISupports      = Components.interfaces.nsISupports;
const nsISidebar       = Components.interfaces.nsISidebar;
const nsIRDFContainer  = Components.interfaces.nsIRDFContainer;
const nsIProperties    = Components.interfaces.nsIProperties;
const nsIFileURL       = Components.interfaces.nsIFileURL;
const nsIRDFRemoteDataSource = Components.interfaces.nsIRDFRemoteDataSource;
const nsIClassInfo     = Components.interfaces.nsIClassInfo;

// File extension for Sherlock search plugin description files
const SHERLOCK_FILE_EXT_REGEXP = /\.src$/i;

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function nsSidebar()
{
    const RDF_CONTRACTID = "@mozilla.org/rdf/rdf-service;1";
    const nsIRDFService = Components.interfaces.nsIRDFService;

    this.rdf = Components.classes[RDF_CONTRACTID].getService(nsIRDFService);
    this.datasource_uri = getSidebarDatasourceURI(PANELS_RDF_FILE);
    debug('datasource_uri is ' + this.datasource_uri);
    this.resource = 'urn:sidebar:current-panel-list';
    this.datasource = this.rdf.GetDataSource(this.datasource_uri);
}

nsSidebar.prototype.nc = "http://home.netscape.com/NC-rdf#";

nsSidebar.prototype.isPanel =
function (aContentURL)
{
    var container =
        Components.classes[CONTAINER_CONTRACTID].createInstance(nsIRDFContainer);

    container.Init(this.datasource, this.rdf.GetResource(this.resource));

    /* Create a resource for the new panel and add it to the list */
    var panel_resource =
        this.rdf.GetResource("urn:sidebar:3rdparty-panel:" + aContentURL);

    return (container.IndexOf(panel_resource) != -1);
}

function sidebarURLSecurityCheck(url)
{
    if (!/(^http:|^ftp:|^https:)/i.test(url))
        throw "Script attempted to add sidebar panel from illegal source";
}

/* decorate prototype to provide ``class'' methods and property accessors */
nsSidebar.prototype.addPanel =
function (aTitle, aContentURL, aCustomizeURL)
{
    debug("addPanel(" + aTitle + ", " + aContentURL + ", " +
          aCustomizeURL + ")");

    return this.addPanelInternal(aTitle, aContentURL, aCustomizeURL, false);
}

nsSidebar.prototype.addPersistentPanel =
function(aTitle, aContentURL, aCustomizeURL)
{
    debug("addPersistentPanel(" + aTitle + ", " + aContentURL + ", " +
           aCustomizeURL + ")\n");

    return this.addPanelInternal(aTitle, aContentURL, aCustomizeURL, true);
}

nsSidebar.prototype.addPanelInternal =
function (aTitle, aContentURL, aCustomizeURL, aPersist)
{
    sidebarURLSecurityCheck(aContentURL);

    // Create a "container" wrapper around the current panels to
    // manipulate the RDF:Seq more easily.
    var panel_list = this.datasource.GetTarget(this.rdf.GetResource(this.resource), this.rdf.GetResource(nsSidebar.prototype.nc+"panel-list"), true);
    if (panel_list) {
        panel_list.QueryInterface(Components.interfaces.nsIRDFResource);
    } else {
        // Datasource is busted. Start over.
        debug("Sidebar datasource is busted\n");
    }

    var container = Components.classes[CONTAINER_CONTRACTID].createInstance(nsIRDFContainer);
    container.Init(this.datasource, panel_list);

    /* Create a resource for the new panel and add it to the list */
    var panel_resource =
        this.rdf.GetResource("urn:sidebar:3rdparty-panel:" + aContentURL);
    var panel_index = container.IndexOf(panel_resource);
    var stringBundle, brandStringBundle, titleMessage, dialogMessage;
    if (panel_index != -1)
    {
        try {
            stringBundle = Services.strings.createBundle("chrome://communicator/locale/sidebar/sidebar.properties");
            brandStringBundle = Services.strings.createBundle("chrome://branding/locale/brand.properties");
            if (stringBundle) {
                sidebarName = brandStringBundle.GetStringFromName("sidebarName");
                titleMessage = stringBundle.GetStringFromName("dupePanelAlertTitle");
                dialogMessage = stringBundle.GetStringFromName("dupePanelAlertMessage");
                dialogMessage = dialogMessage.replace(/%url%/, aContentURL);
                dialogMessage = dialogMessage.replace(/%name%/, sidebarName);
            }
        }
        catch (e) {
            titleMessage = "Sidebar";
            dialogMessage = aContentURL + " already exists in Sidebar.  No string bundle";
        }

        Services.prompt.alert(null, titleMessage, dialogMessage);

        return;
    }

    try {
        stringBundle = Services.strings.createBundle("chrome://communicator/locale/sidebar/sidebar.properties");
        brandStringBundle = Services.strings.createBundle("chrome://branding/locale/brand.properties");
        if (stringBundle) {
            sidebarName = brandStringBundle.GetStringFromName("sidebarName");
            titleMessage = stringBundle.GetStringFromName("addPanelConfirmTitle");
            dialogMessage = stringBundle.GetStringFromName("addPanelConfirmMessage");
            if (aPersist)
            {
                var warning = stringBundle.GetStringFromName("persistentPanelWarning");
                dialogMessage += "\n" + warning;
            }
            dialogMessage = dialogMessage.replace(/%title%/, aTitle);
            dialogMessage = dialogMessage.replace(/%url%/, aContentURL);
            dialogMessage = dialogMessage.replace(/#/g, "\n");
            dialogMessage = dialogMessage.replace(/%name%/g, sidebarName);
        }
    }
    catch (e) {
        titleMessage = "Add Tab to Sidebar";
        dialogMessage = "No string bundle.  Add the Tab '" + aTitle + "' to Sidebar?\n\n" + "Source: " + aContentURL;
    }

    var rv = Services.prompt.confirm(null, titleMessage, dialogMessage);

    if (!rv)
        return;

    /* Now make some sidebar-ish assertions about it... */
    this.datasource.Assert(panel_resource,
                           this.rdf.GetResource(this.nc + "title"),
                           this.rdf.GetLiteral(aTitle),
                           true);
    this.datasource.Assert(panel_resource,
                           this.rdf.GetResource(this.nc + "content"),
                           this.rdf.GetLiteral(aContentURL),
                           true);
    if (aCustomizeURL)
        this.datasource.Assert(panel_resource,
                               this.rdf.GetResource(this.nc + "customize"),
                               this.rdf.GetLiteral(aCustomizeURL),
                               true);
    var persistValue = aPersist ? "true" : "false";
    this.datasource.Assert(panel_resource,
                           this.rdf.GetResource(this.nc + "persist"),
                           this.rdf.GetLiteral(persistValue),
                           true);

    container.AppendElement(panel_resource);

    // Use an assertion to pass a "refresh" event to all the sidebars.
    // They use observers to watch for this assertion (in sidebarOverlay.js).
    this.datasource.Assert(this.rdf.GetResource(this.resource),
                           this.rdf.GetResource(this.nc + "refresh"),
                           this.rdf.GetLiteral("true"),
                           true);
    this.datasource.Unassert(this.rdf.GetResource(this.resource),
                             this.rdf.GetResource(this.nc + "refresh"),
                             this.rdf.GetLiteral("true"));

    /* Write the modified panels out. */
    this.datasource.QueryInterface(nsIRDFRemoteDataSource).Flush();
}

nsSidebar.prototype.validateSearchEngine =
function (engineURL, iconURL)
{
  try
  {
    // Make sure the URLs are HTTP, HTTPS, or FTP.
    var isWeb = /^(https?|ftp):\/\//i;

    if (!isWeb.test(engineURL))
      throw "Unsupported search engine URL";

    if (iconURL && !isWeb.test(iconURL))
      throw "Unsupported search icon URL.";
  }
  catch(ex)
  {
    debug(ex);
    Components.utils.reportError("Invalid argument passed to window.sidebar.addSearchEngine: " + ex);

    var searchBundle = Services.strings.createBundle("chrome://global/locale/search/search.properties");
    var brandBundle = Services.strings.createBundle("chrome://branding/locale/brand.properties");
    var brandName = brandBundle.GetStringFromName("brandShortName");
    var title = searchBundle.GetStringFromName("error_invalid_engine_title");
    var msg = searchBundle.formatStringFromName("error_invalid_engine_msg",
                                                [brandName], 1);
    Services.ww.getNewPrompter(null).alert(title, msg);
    return false;
  }

  return true;
}

// The suggestedTitle and suggestedCategory parameters are ignored, but remain
// for backward compatibility.
nsSidebar.prototype.addSearchEngine =
function (engineURL, iconURL, suggestedTitle, suggestedCategory)
{
  debug("addSearchEngine(" + engineURL + ", " + iconURL + ", " +
        suggestedCategory + ", " + suggestedTitle + ")");

  if (!this.validateSearchEngine(engineURL, iconURL))
    return;

  // OpenSearch files will likely be far more common than Sherlock files, and
  // have less consistent suffixes, so we assume that ".src" is a Sherlock
  // (text) file, and anything else is OpenSearch (XML).
  var dataType;
  if (SHERLOCK_FILE_EXT_REGEXP.test(engineURL))
    dataType = Components.interfaces.nsISearchEngine.DATA_TEXT;
  else
    dataType = Components.interfaces.nsISearchEngine.DATA_XML;

  Services.search.addEngine(engineURL, dataType, iconURL, true);
}

// This function exists largely to implement window.external.AddSearchProvider(),
// to match other browsers' APIs.  The capitalization, although nonstandard here,
// is therefore important.
nsSidebar.prototype.AddSearchProvider =
function (aDescriptionURL)
{
  // Get the favicon URL for the current page, or our best guess at the current
  // page since we don't have easy access to the active document.  Most search
  // engines will override this with an icon specified in the OpenSearch
  // description anyway.
  var win = Services.wm.getMostRecentWindow("navigator:browser");
  var browser = win.getBrowser();
  var iconURL = "";
  // Use documentURIObject in the check for shouldLoadFavIcon so that we
  // do the right thing with about:-style error pages.  Bug 453442
  if (browser.shouldLoadFavIcon(browser.selectedBrowser
                                       .contentDocument
                                       .documentURIObject))
    iconURL = browser.getIcon();

  if (!this.validateSearchEngine(aDescriptionURL, iconURL))
    return;

  const typeXML = Components.interfaces.nsISearchEngine.DATA_XML;
  Services.search.addEngine(aDescriptionURL, typeXML, iconURL, true);
}

// This function exists to implement window.external.IsSearchProviderInstalled(),
// for compatibility with other browsers.  It will return an integer value
// indicating whether the given engine is installed for the current user.
// However, it is currently stubbed out due to security/privacy concerns
// stemming from difficulties in determining what domain issued the request.
// See bug 340604 and
// http://msdn.microsoft.com/en-us/library/aa342526%28VS.85%29.aspx .
// XXX Implement this!
nsSidebar.prototype.IsSearchProviderInstalled =
function (aSearchURL)
{
  return 0;
}

nsSidebar.prototype.classInfo = XPCOMUtils.generateCI({
    classID: SIDEBAR_CID,
    contractID: SIDEBAR_CONTRACTID,
    classDescription: "Sidebar",
    interfaces: [nsISidebar],
    flags: nsIClassInfo.DOM_OBJECT});

nsSidebar.prototype.QueryInterface =
    XPCOMUtils.generateQI([nsISidebar]);

nsSidebar.prototype.classID = SIDEBAR_CID;

var NSGetFactory = XPCOMUtils.generateNSGetFactory([nsSidebar]);

/* static functions */
if (DEBUG)
    debug = function (s) { dump("-*- sidebar component: " + s + "\n"); }
else
    debug = function (s) {}

function getSidebarDatasourceURI(panels_file_id)
{
    try
    {
        /* use the fileLocator to look in the profile directory
         * to find 'panels.rdf', which is the
         * database of the user's currently selected panels.
         * if <profile>/panels.rdf doesn't exist, get will copy
         *bin/defaults/profile/panels.rdf to <profile>/panels.rdf */
        var sidebar_file = Services.dirsvc.get(panels_file_id,
                                               Components.interfaces.nsIFile);

        if (!sidebar_file.exists())
        {
            /* this should not happen, as GetFileLocation() should copy
             * defaults/panels.rdf to the users profile directory */
            debug("sidebar file does not exist");
            return null;
        }

        var file_handler = Services.io.getProtocolHandler("file").QueryInterface(Components.interfaces.nsIFileProtocolHandler);
        var sidebar_uri = file_handler.getURLSpecFromFile(sidebar_file);
        debug("sidebar uri is " + sidebar_uri);
        return sidebar_uri;
    }
    catch (ex)
    {
        /* this should not happen */
        debug("caught " + ex + " getting sidebar datasource uri");
        return null;
    }
}
