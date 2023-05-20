/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://calendar/modules/calUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

/*
 * Authentication helper code
 */

this.EXPORTED_SYMBOLS = ["cal"]; // even though it's defined in calUtils.jsm, import needs this
cal.auth = {
    /**
     * Auth prompt implementation - Uses password manager if at all possible.
     */
    Prompt: function() {
        this.mWindow = cal.getCalendarWindow();
        this.mReturnedLogins = {};
    },

    /**
     * Tries to get the username/password combination of a specific calendar name
     * from the password manager or asks the user.
     *
     * @param   in aTitle           The dialog title.
     * @param   in aCalendarName    The calendar name or url to look up. Can be null.
     * @param   inout aUsername     The username that belongs to the calendar.
     * @param   inout aPassword     The password that belongs to the calendar.
     * @param   inout aSavePassword Should the password be saved?
     * @param   in aFixedUsername   Whether the user name is fixed or editable
     * @return  Could a password be retrieved?
     */
    getCredentials: function(aTitle, aCalendarName, aUsername, aPassword,
                             aSavePassword, aFixedUsername) {
        if (typeof aUsername != "object" ||
            typeof aPassword != "object" ||
            typeof aSavePassword != "object") {
            throw new Components.Exception("", Components.results.NS_ERROR_XPC_NEED_OUT_OBJECT);
        }

        let prompter = Services.ww.getNewPrompter(null);

        // Only show the save password box if we are supposed to.
        let savepassword = null;
        if (Preferences.get("signon.rememberSignons", true)) {
            savepassword = cal.calGetString("passwordmgr", "rememberPassword", null, "passwordmgr");
        }

        let aText;
        if (aFixedUsername) {
            aText = cal.calGetString("commonDialogs", "EnterPasswordFor", [aUsername.value, aCalendarName], "global");
            return prompter.promptPassword(aTitle,
                                           aText,
                                           aPassword,
                                           savepassword,
                                           aSavePassword);
        } else {
            aText = cal.calGetString("commonDialogs", "EnterUserPasswordFor2", [aCalendarName], "global");
            return prompter.promptUsernameAndPassword(aTitle,
                                                      aText,
                                                      aUsername,
                                                      aPassword,
                                                      savepassword,
                                                      aSavePassword);
        }
    },

    /**
     * Make sure the passed origin is actually an uri string, because password
     * manager functions require it. This is a fallback for compatibility only
     * and should be removed a few versions after Lightning 5.5
     *
     * @param aOrigin       The hostname or origin to check
     * @return              The origin uri
     */
    _ensureOrigin: function(aOrigin) {
        try {
            return Services.io.newURI(aOrigin, null, null).spec;
        } catch (e) {
            return "https://" + aOrigin;
        }
    },

    /**
     * Helper to insert/update an entry to the password manager.
     *
     * @param aUserName     The username
     * @param aPassword     The corresponding password
     * @param aOrigin       The corresponding origin
     * @param aRealm        The password realm (unused on branch)
     */
    passwordManagerSave: function(aUsername, aPassword, aOrigin, aRealm) {
        cal.ASSERT(aUsername);
        cal.ASSERT(aPassword);

        let origin = this._ensureOrigin(aOrigin);

        try {
            let logins = Services.logins.findLogins({}, origin, null, aRealm);

            let newLoginInfo = Components.classes["@mozilla.org/login-manager/loginInfo;1"]
                                         .createInstance(Components.interfaces.nsILoginInfo);
            newLoginInfo.init(origin, null, aRealm, aUsername, aPassword, "", "");
            if (logins.length > 0) {
                Services.logins.modifyLogin(logins[0], newLoginInfo);
            } else {
                Services.logins.addLogin(newLoginInfo);
            }
        } catch (exc) {
            // Only show the message if its not an abort, which can happen if
            // the user canceled the master password dialog
            cal.ASSERT(exc.result == Components.results.NS_ERROR_ABORT, exc);
        }
    },

    /**
     * Helper to retrieve an entry from the password manager.
     *
     * @param in  aUsername     The username to search
     * @param out aPassword     The corresponding password
     * @param aOrigin           The corresponding origin
     * @param aRealm            The password realm (unused on branch)
     * @return                  Does an entry exist in the password manager
     */
    passwordManagerGet: function(aUsername, aPassword, aOrigin, aRealm) {
        cal.ASSERT(aUsername);

        if (typeof aPassword != "object") {
            throw new Components.Exception("", Components.results.NS_ERROR_XPC_NEED_OUT_OBJECT);
        }

        let origin = this._ensureOrigin(aOrigin);

        try {
            if (!Services.logins.getLoginSavingEnabled(origin)) {
                return false;
            }

            let logins = Services.logins.findLogins({}, origin, null, aRealm);
            for (let loginInfo of logins) {
                if (loginInfo.username == aUsername) {
                    aPassword.value = loginInfo.password;
                    return true;
                }
            }
        } catch (exc) {
            cal.ASSERT(false, exc);
        }
        return false;
    },

    /**
     * Helper to remove an entry from the password manager
     *
     * @param aUsername     The username to remove.
     * @param aOrigin       The corresponding origin
     * @param aRealm        The password realm (unused on branch)
     * @return              Could the user be removed?
     */
    passwordManagerRemove: function(aUsername, aOrigin, aRealm) {
        cal.ASSERT(aUsername);

        let origin = this._ensureOrigin(aOrigin);

        try {
            let logins = Services.logins.findLogins({}, origin, null, aRealm);
            for (let loginInfo of logins) {
                if (loginInfo.username == aUsername) {
                    Services.logins.removeLogin(loginInfo);
                    return true;
                }
            }
        } catch (exc) {
            // If no logins are found, fall through to the return statement below.
        }
        return false;
    }
};

/**
 * Calendar Auth prompt implementation. This instance of the auth prompt should
 * be used by providers and other components that handle authentication using
 * nsIAuthPrompt2 and friends.
 *
 * This implementation guarantees there are no request loops when an invalid
 * password is stored in the login-manager.
 *
 * There is one instance of that object per calendar provider.
 */
cal.auth.Prompt.prototype = {
    mProvider: null,

    getPasswordInfo: function(aPasswordRealm) {
        let username;
        let password;
        let found = false;

        let logins = Services.logins.findLogins({}, aPasswordRealm.prePath, null, aPasswordRealm.realm);
        if (logins.length) {
            username = logins[0].username;
            password = logins[0].password;
            found = true;
        }
        if (found) {
            let keyStr = aPasswordRealm.prePath + ":" + aPasswordRealm.realm;
            let now = new Date();
            // Remove the saved password if it was already returned less
            // than 60 seconds ago. The reason for the timestamp check is that
            // nsIHttpChannel can call the nsIAuthPrompt2 interface
            // again in some situation. ie: When using Digest auth token
            // expires.
            if (this.mReturnedLogins[keyStr] &&
                now.getTime() - this.mReturnedLogins[keyStr].getTime() < 60000) {
                cal.LOG("Credentials removed for: user=" + username + ", host=" + aPasswordRealm.prePath + ", realm=" + aPasswordRealm.realm)
;
                delete this.mReturnedLogins[keyStr];
                cal.auth.passwordManagerRemove(username,
                                               aPasswordRealm.prePath,
                                               aPasswordRealm.realm);
                return { found: false, username: username };
            } else {
                this.mReturnedLogins[keyStr] = now;
            }
        }
        return { found: found, username: username, password: password };
    },

    /**
     * Requests a username and a password. Implementations will commonly show a
     * dialog with a username and password field, depending on flags also a
     * domain field.
     *
     * @param aChannel
     *        The channel that requires authentication.
     * @param level
     *        One of the level constants NONE, PW_ENCRYPTED, SECURE.
     * @param authInfo
     *        Authentication information object. The implementation should fill in
     *        this object with the information entered by the user before
     *        returning.
     *
     * @retval true
     *         Authentication can proceed using the values in the authInfo
     *         object.
     * @retval false
     *         Authentication should be cancelled, usually because the user did
     *         not provide username/password.
     *
     * @note   Exceptions thrown from this function will be treated like a
     *         return value of false.
     */
    promptAuth: function(aChannel, aLevel, aAuthInfo) {
        let hostRealm = {};
        hostRealm.prePath = aChannel.URI.prePath;
        hostRealm.realm = aAuthInfo.realm;
        let port = aChannel.URI.port;
        if (port == -1) {
            let handler = Services.io.getProtocolHandler(aChannel.URI.scheme)
                                     .QueryInterface(Components.interfaces.nsIProtocolHandler);
            port = handler.defaultPort;
        }
        hostRealm.passwordRealm = aChannel.URI.host + ":" + port + " (" + aAuthInfo.realm + ")";

        let pwInfo = this.getPasswordInfo(hostRealm);
        aAuthInfo.username = pwInfo.username;
        if (pwInfo && pwInfo.found) {
            aAuthInfo.password = pwInfo.password;
            return true;
        } else {
            let prompter2 = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                                      .getService(Components.interfaces.nsIPromptFactory)
                                      .getPrompt(this.mWindow, Components.interfaces.nsIAuthPrompt2);
            return prompter2.promptAuth(aChannel, aLevel, aAuthInfo);
        }
    },

    /**
     * Asynchronously prompt the user for a username and password.
     * This has largely the same semantics as promptAuth(),
     * but must return immediately after calling and return the entered
     * data in a callback.
     *
     * If the user closes the dialog using a cancel button or similar,
     * the callback's nsIAuthPromptCallback::onAuthCancelled method must be
     * called.
     * Calling nsICancelable::cancel on the returned object SHOULD close the
     * dialog and MUST call nsIAuthPromptCallback::onAuthCancelled on the provided
     * callback.
     *
     * @throw NS_ERROR_NOT_IMPLEMENTED
     *        Asynchronous authentication prompts are not supported;
     *        the caller should fall back to promptUsernameAndPassword().
     */
    asyncPromptAuth: function(aChannel,     // nsIChannel
                              aCallback,    // nsIAuthPromptCallback
                              aContext,     // nsISupports
                              aLevel,       // PRUint32
                              aAuthInfo) {  // nsIAuthInformation
        let self = this;
        let promptlistener = {
            onPromptStart: function() {
                res = self.promptAuth(aChannel, aLevel, aAuthInfo);

                if (res) {
                    gAuthCache.setAuthInfo(hostKey, aAuthInfo);
                    this.onPromptAuthAvailable();
                    return true;
                }

                this.onPromptCanceled();
                return false;
            },

            onPromptAuthAvailable: function() {
                let authInfo = gAuthCache.retrieveAuthInfo(hostKey);
                if (authInfo) {
                    aAuthInfo.username = authInfo.username;
                    aAuthInfo.password = authInfo.password;
                }
                aCallback.onAuthAvailable(aContext, aAuthInfo);
            },

            onPromptCanceled: function() {
                gAuthCache.retrieveAuthInfo(hostKey);
                aCallback.onAuthCancelled(aContext, true);
            }
        };

        let hostKey = aChannel.URI.prePath + ":" + aAuthInfo.realm;
        gAuthCache.planForAuthInfo(hostKey);

        function queuePrompt() {
            let asyncprompter = Components.classes["@mozilla.org/messenger/msgAsyncPrompter;1"]
                                          .getService(Components.interfaces.nsIMsgAsyncPrompter);
            asyncprompter.queueAsyncAuthPrompt(hostKey, false, promptlistener);
        }

        self.mWindow = cal.getCalendarWindow();

        // the prompt will fail if we are too early
        if (self.mWindow.document.readyState == "complete") {
            queuePrompt();
        } else {
            self.mWindow.addEventListener("load", queuePrompt, true);
        }
    }
};

// Cache for authentication information since onAuthInformation in the prompt
// listener is called without further information. If the password is not
// saved, there is no way to retrieve it. We use ref counting to avoid keeping
// the password in memory longer than needed.
var gAuthCache = {
    _authInfoCache: new Map(),
    planForAuthInfo: function(hostKey) {
        let authInfo = this._authInfoCache.get(hostKey);
        if (authInfo) {
            authInfo.refCnt++;
        } else {
            this._authInfoCache.set(hostKey, { refCnt: 1 });
        }
    },

    setAuthInfo: function(hostKey, aAuthInfo) {
        let authInfo = this._authInfoCache.get(hostKey);
        if (authInfo) {
            authInfo.username = aAuthInfo.username;
            authInfo.password = aAuthInfo.password;
        }
    },

    retrieveAuthInfo: function(hostKey) {
        let authInfo = this._authInfoCache.get(hostKey);
        if (authInfo) {
            authInfo.refCnt--;

            if (authInfo.refCnt == 0) {
                this._authInfoCache.delete(hostKey);
            }
        }
        return authInfo;
    }
};
