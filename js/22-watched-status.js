/* ========================================================================
   FILE: js/22-watched-status.js

   WHAT IT DOES:
     Marking titles watched/unwatched, adding a TMDB title to the library,
     and the buttons for that on the title page.

   OPEN THIS FILE IF YOU WANT TO:
     change what happens when you mark something watched.
   ======================================================================== */

// ---- Watched status ---------------------------------------------------------------
function resetWatchState(item) {
  item.watched = false;
  item.watchedAt = 0;
  item.lastPlayedAt = 0;
  item.progressSeconds = 0;
  item.durationSeconds = 0;
  for (const episode of item.episodes || []) {
    episode.lastPlayedAt = 0;
    episode.progressSeconds = 0;
  }
}

async function setWatched(item, value) {
  const snapshot = JSON.stringify([item.watched, item.watchedAt, item.lastPlayedAt, item.progressSeconds, item.durationSeconds, (item.episodes || []).map((e) => [e.lastPlayedAt, e.progressSeconds])]);
  if (value) {
    item.watched = true;
    item.watchedAt = Date.now();
    item.progressSeconds = 0; // finished, so no "Continue watching"
  } else {
    resetWatchState(item);
  }
  try {
    await saveRecord(item);
  } catch (error) {
    const [w, wa, lp, ps, ds, eps] = JSON.parse(snapshot);
    Object.assign(item, { watched: w, watchedAt: wa, lastPlayedAt: lp, progressSeconds: ps, durationSeconds: ds });
    (item.episodes || []).forEach((e, i) => { e.lastPlayedAt = eps[i][0]; e.progressSeconds = eps[i][1]; });
    showToast(error.message || "Could not update the title.");
    return false;
  }
  renderShelves();
  if (dialogItem === item) renderDialogMeta(item);
  showToast(value ? `Marked “${item.title}” as watched` : `Marked “${item.title}” as unwatched`);
  return true;
}

// ---- Adding a TMDB title to the library -------------------------------------------
function recordFromExternal(item, watched) {
  const genres = [...new Set((item.genres || []).map((name) => TMDB_TO_VORA_GENRE[name]).filter(Boolean))].slice(0, 2);
  return {
    id: createId(),
    type: item.type,
    title: item.title,
    genres: genres.length ? genres : ["Other"],
    description: item.description || "",
    banner: item.banner || "",
    poster: item.poster || "",
    year: item.year || "",
    rating: item.rating || "",
    tmdbId: item.tmdbId || 0,
    driveUrl: "",
    episodes: [],
    watched: !!watched,
    watchedAt: watched ? Date.now() : 0,
    createdAt: new Date().toISOString(),
  };
}

async function addExternalAsWatched(item) {
  const existing = findLibraryMatch({ id: item.tmdbId, title: item.title }, item.type);
  if (existing) {
    dialog.close();
    showToast("That title is already in your library");
    openTitleDialog(existing);
    return;
  }
  try {
    const record = normalizeRecord(recordFromExternal(item, true));
    await saveRecord(record);
    customTitles.unshift(toCardItem(record));
    dialog.close();
    renderShelves();
    showToast(`Added “${record.title}” as watched`);
  } catch (error) {
    showToast(error.message || "Could not add this title.");
  }
}

function addExternalToLibrary(item) {
  const existing = findLibraryMatch({ id: item.tmdbId, title: item.title }, item.type);
  if (existing) {
    dialog.close();
    showToast("That title is already in your library");
    openTitleDialog(existing);
    return;
  }
  dialog.close();
  openAddDialog(item);
}

const dialogWatchedButton = document.querySelector("#dialog-watched");
const dialogUnrecentButton = document.querySelector("#dialog-unrecent");
const dialogAddLibraryButton = document.querySelector("#dialog-add-library");
const dialogAddWatchedButton = document.querySelector("#dialog-add-watched");

function syncWatchedControls(item) {
  const external = !!item.externalRecommendation;
  dialogWatchedButton.hidden = external;
  dialogUnrecentButton.hidden = external || !(isRecentlyWatched(item) || isInProgress(item));
  dialogAddLibraryButton.hidden = !external;
  dialogAddWatchedButton.hidden = !external;
  if (!external) {
    const on = !!item.watched;
    dialogWatchedButton.textContent = on ? "✓ Watched" : "Mark as watched";
    dialogWatchedButton.setAttribute("aria-pressed", String(on));
    dialogWatchedButton.title = on ? "Tap to mark as unwatched" : "Mark this title as watched";
  }
}
dialogWatchedButton.addEventListener("click", () => { if (dialogItem) setWatched(dialogItem, !dialogItem.watched); });
dialogUnrecentButton.addEventListener("click", () => { if (dialogItem) removeFromRecent([dialogItem]); });
dialogAddLibraryButton.addEventListener("click", () => { if (dialogItem) addExternalToLibrary(dialogItem); });
dialogAddWatchedButton.addEventListener("click", () => { if (dialogItem) addExternalAsWatched(dialogItem); });
