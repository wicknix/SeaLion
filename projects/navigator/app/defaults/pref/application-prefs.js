/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* The prefs in this file are specific to the seamonkey (toolkit) browser.
 * Generic default prefs that would be useful to embedders belong in
 * modules/libpref/src/init/all.js
 */

#include appshell-prefs.inc.js

#include extensions-prefs.inc.js

#include general-prefs.inc.js

#include gre-prefs.inc.js

#include navigator-prefs.inc.js

#include network-prefs.inc.js

#include places-prefs.inc.js

#include secpriv-prefs.inc.js

#ifdef MOZ_SERVICES_SYNC
#include secpriv-prefs.inc.js
#endif