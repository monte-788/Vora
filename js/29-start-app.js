/* ========================================================================
   FILE: js/29-start-app.js

   WHAT IT DOES:
     THE LAST STEP. Starts the app once every other file has loaded. Keep
     this file LAST in the list in index.html.

   OPEN THIS FILE IF YOU WANT TO:
     almost never - only to change what runs at startup.
   ======================================================================== */

// Hide the Discover tab until settings are unlocked (this needs the password-gate file, so it runs here at the end).
applyDiscoverLock();

// Prepare the Add title form, then load the saved library and start the admin check.
addEpisodeRow();
updateTypeFields();
initialize().then(() => { startControl(); startCloudSync(); });
