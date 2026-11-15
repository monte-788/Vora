/* ========================================================================
   FILE: js/21-advanced-settings.js

   WHAT IT DOES:
     The Advanced settings window: its controls, the Google Sheet link and
     TMDB key boxes, backups, and the lists it shows.

   OPEN THIS FILE IF YOU WANT TO:
     add or change an option in Advanced settings.
   ======================================================================== */

// ---- Advanced settings dialog -----------------------------------------------------
const advancedDialog = document.querySelector("#advanced-dialog");
const advBannerTitle = document.querySelector("#adv-banner-title");
const advBannerSeconds = document.querySelector("#adv-banner-seconds");
const advBannerHint = document.querySelector("#adv-banner-hint");
const advShelfEnabled = document.querySelector("#adv-shelf-enabled");
const advShelfSource = document.querySelector("#adv-shelf-source");
const advShelfName = document.querySelector("#adv-shelf-name");
const advFavList = document.querySelector("#adv-fav-list");
const advFavCount = document.querySelector("#adv-fav-count");
const advRecentList = document.querySelector("#adv-recent-list");
const advAutoBackup = document.querySelector("#adv-auto-backup");
const advDiscoverTmdb = document.querySelector("#adv-discover-tmdb");
const advBackupStatus = document.querySelector("#adv-backup-status");
advAutoBackup.checked = settings.autoBackup;
advDiscoverTmdb.checked = settings.discoverTmdb;
advAutoBackup.addEventListener("change", () => { settings.autoBackup = advAutoBackup.checked; saveSettings(); if (settings.autoBackup) writeAutomaticBackup(); advBackupStatus.textContent = settings.autoBackup ? "Automatic backups are on (this browser only)." : "Automatic backups are off. Existing backup is kept."; });

const advSheetUrl = document.querySelector("#adv-sheet-url");
const advSheetHint = document.querySelector("#adv-sheet-hint");
const advSheetReset = document.querySelector("#adv-sheet-reset");
const ADV_SHEET_HINT = advSheetHint.textContent;
const advTmdbKeyInput = document.querySelector("#adv-tmdb-key");
const advTmdbKeySave = document.querySelector("#adv-tmdb-key-save");
const advTmdbKeyReset = document.querySelector("#adv-tmdb-key-reset");
const advTmdbKeyStatus = document.querySelector("#adv-tmdb-key-status");

// Shows what the server is currently using (the default, or something you saved).
function syncServerControls() {
  advSheetUrl.value = voraConfig.sheetCustom ? voraConfig.sheetUrl : "";
  advSheetUrl.placeholder = voraConfig.sheetCustom ? "" : "Using the default sheet — paste a link to replace it";
  advSheetReset.disabled = !voraConfig.sheetCustom;
  advSheetHint.textContent = voraConfig.sheetCustom ? "Using your saved link (stored on the Vora server)." : ADV_SHEET_HINT;
  advTmdbKeyInput.value = "";
  advTmdbKeyReset.disabled = !voraConfig.tmdbCustom;
  advTmdbKeyStatus.textContent = !voraConfigured
    ? "Vora server isn't set up yet (see SETUP.md)."
    : voraConfig.tmdbCustom ? "Using your own TMDB key (stored on the Vora server)." : "Using the default TMDB key from the Vora server.";
}

advSheetUrl.addEventListener("change", async () => {
  const value = advSheetUrl.value.trim();
  if (!value) { syncServerControls(); return; } // blank = no change; use "Reset to default"
  if (!cleanSheetUrl(value)) {
    advSheetHint.textContent = "That doesn't look like a valid link — the previous one is still in use.";
    advSheetUrl.value = voraConfig.sheetCustom ? voraConfig.sheetUrl : "";
    return;
  }
  advSheetHint.textContent = "Saving…";
  try {
    voraConfig = { ...voraConfig, ...(await voraAuthedCall("set-config", { sheetUrl: value })) };
    syncServerControls();
    advSheetHint.textContent = "Saved to the Vora server. Cloud CSV will now load from this link.";
  } catch (error) {
    syncServerControls();
    advSheetHint.textContent = error.message || "Could not save the link.";
  }
});
advSheetReset.addEventListener("click", async () => {
  advSheetHint.textContent = "Resetting…";
  try {
    voraConfig = { ...voraConfig, ...(await voraAuthedCall("reset-config", { which: "sheet" })) };
    syncServerControls();
    advSheetHint.textContent = "Back to the default sheet.";
  } catch (error) {
    syncServerControls();
    advSheetHint.textContent = error.message || "Could not reset the link.";
  }
});

advTmdbKeySave.addEventListener("click", async () => {
  const value = advTmdbKeyInput.value.trim();
  if (!value) { advTmdbKeyStatus.textContent = "Paste a TMDB API key (v3) first."; return; }
  advTmdbKeySave.disabled = true;
  advTmdbKeyStatus.textContent = "Checking the key with TMDB…";
  try {
    voraConfig = { ...voraConfig, ...(await voraAuthedCall("set-config", { tmdbKey: value })) };
    syncServerControls();
    advTmdbKeyStatus.textContent = "Saved to the Vora server. This key is now used everywhere.";
    showToast("TMDB API key saved to the server.");
  } catch (error) {
    advTmdbKeyStatus.textContent = error.message || "Could not save the key.";
  } finally {
    advTmdbKeySave.disabled = false;
  }
});
advTmdbKeyReset.addEventListener("click", async () => {
  advTmdbKeyStatus.textContent = "Resetting…";
  try {
    voraConfig = { ...voraConfig, ...(await voraAuthedCall("reset-config", { which: "tmdb" })) };
    syncServerControls();
    advTmdbKeyStatus.textContent = "Back to the default TMDB key.";
    showToast("TMDB key reset to default.");
  } catch (error) {
    syncServerControls();
    advTmdbKeyStatus.textContent = error.message || "Could not reset the key.";
  }
});
advDiscoverTmdb.addEventListener("change", () => { settings.discoverTmdb = advDiscoverTmdb.checked; saveSettings(); renderBecauseShelf(); });
document.querySelector("#adv-backup-now").addEventListener("click", () => { try { localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({version:1,savedAt:new Date().toISOString(),titles:customTitles})); advBackupStatus.textContent = `Local backup saved at ${new Date().toLocaleString()}`; } catch(e) { advBackupStatus.textContent = "Backup failed: browser storage may be full."; } });
document.querySelector("#adv-restore-backup").addEventListener("click", async () => { try { const raw=localStorage.getItem(AUTO_BACKUP_KEY); if(!raw) { advBackupStatus.textContent="No local backup found yet."; return; } const data=JSON.parse(raw); if(!Array.isArray(data.titles)) throw new Error("Backup file is not valid."); if(!confirm(`Restore ${data.titles.length} titles from the backup saved ${new Date(data.savedAt).toLocaleString()}? This replaces the current library.`)) return; for(const item of customTitles) await deleteRecord(item.id); customTitles=data.titles.map(normalizeRecord).map(toCardItem); await Promise.all(customTitles.map(saveRecord)); renderShelves(); advBackupStatus.textContent=`Restored ${customTitles.length} titles from local backup.`; } catch(e) { advBackupStatus.textContent=e.message || "Could not restore backup."; } });

function renderBannerSelect() {
  const sorted = [...customTitles].sort((a, b) => a.title.localeCompare(b.title));
  advBannerTitle.replaceChildren(
    new Option("Rotate through all titles", ""),
    ...sorted.map((item) => new Option(`${item.title} · ${item.type === "show" ? "Series" : "Movie"}`, item.id)),
  );
  const fixed = fixedHeroTitle();
  advBannerTitle.value = fixed ? fixed.id : "";
  advBannerSeconds.disabled = !!fixed;
  const poolSize = heroPool().length;
  advBannerHint.textContent = fixed
    ? "This title stays on the home banner."
    : poolSize < 2
      ? "Add at least two titles to make the banner rotate."
      : `Rotating through ${poolSize} titles every ${settings.banner.seconds} seconds.`;
}

function syncAdvancedControls() {
  advBannerSeconds.value = settings.banner.seconds;
  advShelfEnabled.checked = settings.shelf.enabled;
  advShelfSource.value = settings.shelf.source;
  advShelfSource.disabled = !settings.shelf.enabled;
  advShelfName.disabled = !settings.shelf.enabled;
  advShelfName.value = settings.shelf.name;
  advShelfName.placeholder = SHELF_DEFAULT_NAMES[settings.shelf.source];
}

function makeAdvancedRow(item, actionLabel, onAction) {
  const row = document.createElement("div");
  row.className = "adv-item";
  const thumb = document.createElement("span");
  thumb.className = "adv-item-thumb";
  if (item.banner) thumb.style.backgroundImage = `url("${item.banner}")`;
  const open = document.createElement("button");
  open.type = "button";
  open.className = "adv-item-text";
  const name = document.createElement("strong");
  name.textContent = item.title;
  const sub = document.createElement("small");
  sub.textContent = [item.type === "show" ? "Series" : "Movie", ...item.genres].join(" · ");
  open.append(name, sub);
  open.addEventListener("click", () => {
    advancedDialog.close();
    openTitleDialog(item);
  });
  const action = document.createElement("button");
  action.type = "button";
  action.className = "cancel-button adv-item-action";
  action.textContent = actionLabel;
  action.addEventListener("click", () => onAction(item));
  row.append(thumb, open, action);
  return row;
}

function emptyNote(text) {
  const note = document.createElement("p");
  note.className = "adv-empty";
  note.textContent = text;
  return note;
}

function renderAdvancedLists() {
  renderWatchedAdvanced();
  const favorites = customTitles.filter((item) => item.favorite);
  advFavCount.textContent = favorites.length ? `(${favorites.length})` : "";
  advFavList.replaceChildren(
    ...(favorites.length
      ? favorites.map((item) => makeAdvancedRow(item, "Remove", (entry) => setFavorite(entry, false)))
      : [emptyNote("No favorites yet — tap the heart on a movie or show to add one.")]),
  );
  const recents = customTitles
    .filter(isRecentlyWatched)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  document.querySelector("#adv-recent-clear").disabled = recents.length === 0;
  advRecentList.replaceChildren(
    ...(recents.length
      ? recents.map((item) => makeAdvancedRow(item, "Remove tag", (entry) => clearWatchedTags([entry])))
      : [emptyNote("Nothing is tagged “Recently Watched” right now.")]),
  );
}

function renderAdvancedIfOpen() {
  if (!advancedDialog.open) return;
  renderBannerSelect();
  renderAdvancedLists();
}

// Takes titles off the Recently watched / Continue watching shelf. They stay marked as watched.
async function removeFromRecent(items) {
  try {
    await Promise.all(
      items.map((item) => {
        if (isStarted(item)) { item.watched = true; item.watchedAt = item.watchedAt || Date.now(); }
        item.lastPlayedAt = 0;
        item.progressSeconds = 0;
        item.durationSeconds = 0;
        return saveRecord(item);
      }),
    );
  } catch (error) {
    showToast(error.message || "Could not remove the title.");
  }
  renderShelves();
  if (dialogItem) renderDialogMeta(dialogItem);
  showToast(items.length === 1 ? `Removed “${items[0].title}” from Recently watched` : `Removed ${items.length} titles from Recently watched`);
}
const clearWatchedTags = removeFromRecent;
