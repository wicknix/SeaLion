/* This Source Code Form is subject to the terms of the Mozilla Public
   License, v. 2.0. If a copy of the MPL was not distributed with this
   file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function openHelp() {
  Components.utils.import("resource://gre/modules/Services.jsm");
  Services.prompt.alert(this.window, "Help", "Help information is not currently available.");
}