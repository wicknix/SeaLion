#filter substitution

// Base URL for web-based support pages.
pref("app.support.baseURL", "https://github.com/wicknix/SeaLion");

pref("xpinstall.whitelist.required", false);
// Allow installing XPI add-ons by direct URL requests (no referrer)
pref("xpinstall.whitelist.directRequest", true);
// Allow installing XPI add-ons from file referrers (chrome/file)
pref("xpinstall.whitelist.fileRequest", true);

pref("extensions.install.requireBuiltInCerts", false);
// Only allow installation of extensions from https, chrome or file schemes
pref("extensions.install.requireSecureOrigin", false);

