/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function Startup()
{
  updateMSE();
}

/**
 * Utility function to enable/disable the checkboxes for MSE options depending
 * on the value of media.mediasource.enabled.
 */
function updateMSE()
{
  var checkboxMSEMP4 = document.getElementById('enableMediaSourceMP4');
  var checkboxMSEWebM = document.getElementById('enableMediaSourceWebM');
  var preference = document.getElementById('media.mediasource.enabled');
  checkboxMSEMP4.disabled = preference.value != true;
  checkboxMSEWebM.disabled = preference.value != true;
}