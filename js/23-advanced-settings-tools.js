/* ========================================================================
   FILE: js/23-advanced-settings-tools.js

   WHAT IT DOES:
     More Advanced settings tools: resetting/deleting watched titles, re-
     matching a title with TMDB, banner and shelf options.

   OPEN THIS FILE IF YOU WANT TO:
     change the watched-title tools or the TMDB re-match tool.
   ======================================================================== */

// ---- Advanced settings: watched titles ---------------------------------------------
const advWatchedList = document.querySelector("#adv-watched-list");
const advWatchedCount = document.querySelector("#adv-watched-count");
const advWatchedReset = document.querySelector("#adv-watched-reset");
const advWatchedDelete = document.querySelector("#adv-watched-delete");
const advWatchedStatus = document.querySelector("#adv-watched-status");
let watchedDeleteTimer = 0;

function resetWatchedDeleteButton() {
  clearTimeout(watchedDeleteTimer);
  advWatchedDelete.dataset.armed = "";
  advWatchedDelete.textContent = "Remove all watched titles";
}

function renderWatchedAdvanced() {
  const watched = customTitles.filter(isStarted)
    .sort((a, b) => (b.lastPlayedAt || b.watchedAt || 0) - (a.lastPlayedAt || a.watchedAt || 0));
  advWatchedCount.textContent = watched.length ? `(${watched.length})` : "";
  advWatchedReset.disabled = watched.length === 0;
  advWatchedDelete.disabled = watched.length === 0;
  if (!watched.length) resetWatchedDeleteButton();
  advWatchedList.replaceChildren(
    ...(watched.length
      ? watched.map((item) => makeAdvancedRow(item, "Unmark", (entry) => setWatched(entry, false)))
      : [emptyNote("No watched titles yet.")]),
  );
}

advWatchedReset.addEventListener("click", async () => {
  const watched = customTitles.filter(isStarted);
  if (!watched.length) return;
  watched.forEach(resetWatchState);
  try { await Promise.all(watched.map(saveRecord)); } catch (error) { showToast(error.message || "Could not reset watched status."); }
  resetWatchedDeleteButton();
  renderShelves();
  advWatchedStatus.textContent = `${watched.length} title${watched.length === 1 ? "" : "s"} marked as unwatched.`;
});

advWatchedDelete.addEventListener("click", async () => {
  const watched = customTitles.filter(isStarted);
  if (!watched.length) return;
  if (advWatchedDelete.dataset.armed !== "1") {
    advWatchedDelete.dataset.armed = "1";
    advWatchedDelete.textContent = `Tap again to delete ${watched.length} title${watched.length === 1 ? "" : "s"}`;
    watchedDeleteTimer = setTimeout(resetWatchedDeleteButton, 6000);
    return;
  }
  resetWatchedDeleteButton();
  try {
    await Promise.all(watched.map((item) => deleteRecord(item.id)));
    const gone = new Set(watched.map((item) => item.id));
    customTitles = customTitles.filter((item) => !gone.has(item.id));
    renderShelves();
    advWatchedStatus.textContent = `Removed ${watched.length} watched title${watched.length === 1 ? "" : "s"} from your library.`;
  } catch (error) {
    advWatchedStatus.textContent = error.message || "Could not remove the watched titles.";
  }
});

const advTmdbTitle = document.querySelector("#adv-tmdb-title");
const advTmdbQuery = document.querySelector("#adv-tmdb-query");
const advTmdbSearch = document.querySelector("#adv-tmdb-search");
const advTmdbStatus = document.querySelector("#adv-tmdb-status");
const advTmdbResults = document.querySelector("#adv-tmdb-results");

function renderTmdbTitleSelect() {
  const previous = advTmdbTitle.value;
  const sorted = [...customTitles].sort((a, b) => a.title.localeCompare(b.title));
  advTmdbTitle.replaceChildren(
    new Option("Choose a library title…", ""),
    ...sorted.map((item) => new Option(`${item.title} · ${item.type === "show" ? "Series" : "Movie"}${item.tmdbId ? ` · TMDB ${item.tmdbId}` : ""}`, item.id)),
  );
  if (sorted.some((item) => item.id === previous)) advTmdbTitle.value = previous;
  const selected = customTitles.find((item) => item.id === advTmdbTitle.value);
  if (selected && !advTmdbQuery.value) advTmdbQuery.value = selected.title;
}

advTmdbTitle.addEventListener("change", () => {
  const item = customTitles.find((entry) => entry.id === advTmdbTitle.value);
  advTmdbQuery.value = item?.title || "";
  advTmdbStatus.textContent = item?.tmdbId ? `Currently linked to TMDB ID ${item.tmdbId}. Search to change it.` : "";
  advTmdbResults.replaceChildren();
});

advTmdbSearch.addEventListener("click", async () => {
  const item = customTitles.find((entry) => entry.id === advTmdbTitle.value);
  const query = advTmdbQuery.value.trim() || item?.title || "";
  const apiKey = getTmdbKey();
  if (!item) { advTmdbStatus.textContent = "Choose a title from your library first."; return; }
  if (!apiKey) { advTmdbStatus.textContent = "Add your TMDB API key from the menu first."; return; }
  if (!query) { advTmdbStatus.textContent = "Enter a title to search for."; return; }
  advTmdbSearch.disabled = true;
  advTmdbStatus.textContent = "Searching TMDB…";
  advTmdbResults.replaceChildren();
  try {
    const endpoint = item.type === "show" ? "tv" : "movie";
    const response = await fetch(`https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&include_adult=false`);
    if (!response.ok) throw new Error(response.status === 401 ? "Invalid TMDB API key." : `TMDB returned HTTP ${response.status}.`);
    const data = await response.json();
    const results = data.results || [];
    if (!results.length) { advTmdbStatus.textContent = "No matches found. Try another search."; return; }
    advTmdbStatus.textContent = `${results.length} match${results.length === 1 ? "" : "es"} found. Choose the correct one:`;
    for (const result of results.slice(0, 10)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "adv-row tmdb-result";
      button.style.cssText = "width:100%;text-align:left;justify-content:space-between;gap:12px;padding:12px;border:1px solid rgba(152,168,193,.22);border-radius:8px;background:rgba(255,255,255,.03);cursor:pointer;";
      const title = result.title || result.name || "Untitled";
      const date = result.release_date || result.first_air_date || "";
      const overview = result.overview || "No description available.";
      const label = document.createElement("span");
      label.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;";
      const heading = document.createElement("strong");
      heading.textContent = `${title}${date ? ` (${date.slice(0,4)})` : ""}`;
      const detail = document.createElement("small");
      detail.textContent = `TMDB ID ${result.id} · Rating ${result.vote_average ? Number(result.vote_average).toFixed(1) : "N/A"} · ${overview.slice(0,180)}`;
      label.append(heading, detail);
      const choose = document.createElement("span");
      choose.textContent = "Use this";
      choose.style.cssText = "white-space:nowrap;color:var(--accent);font-weight:700;";
      button.append(label, choose);
      button.addEventListener("click", async () => {
        button.disabled = true;
        advTmdbStatus.textContent = `Applying "${title}"…`;
        try {
          const meta = await fetchTmdbMetadata(item.title, item.type, apiKey, result.id);
          if (!meta) throw new Error("Could not load that TMDB title.");
          item.tmdbId = meta.tmdbId;
          item.year = meta.year || item.year;
          item.rating = meta.rating || item.rating;
          item.banner = meta.banner || item.banner;
          item.poster = meta.poster || item.poster;
          item.description = meta.description || item.description;
          if (meta.genres.length) item.genres = meta.genres;
          item.detailsAt = Date.now();
          await saveRecord(item);
          rememberTmdbMatch(item);
          customTitles = customTitles.map((entry) => entry.id === item.id ? toCardItem(normalizeRecord(item)) : entry);
          renderShelves();
          renderTmdbTitleSelect();
          advTmdbTitle.value = item.id;
          advTmdbQuery.value = title;
          advTmdbStatus.textContent = `Linked to "${title}" (TMDB ID ${meta.tmdbId}). Details updated and saved.`;
          showToast(`TMDB match saved for ${item.title}.`);
        } catch (error) {
          advTmdbStatus.textContent = error.message || "Could not apply this TMDB match.";
        } finally {
          button.disabled = false;
        }
      });
      advTmdbResults.append(button);
    }
  } catch (error) {
    advTmdbStatus.textContent = error.message || "TMDB search failed.";
  } finally {
    advTmdbSearch.disabled = false;
  }
});

async function openAdvancedSettings() {
  if (!(await requestUnlock())) return;
  await refreshVoraConfig();
  syncServerControls();
  syncAdvancedControls();
  renderBannerSelect();
  renderTmdbTitleSelect();
  renderAdvancedLists();
  if (!advancedDialog.open) advancedDialog.showModal();
}

function applyBannerSettings() {
  saveSettings();
  renderHero();
  syncHeroRotation();
  renderBannerSelect();
}

function applyShelfSettings() {
  saveSettings();
  syncAdvancedControls();
  renderRecentShelf();
  applySearch();
}

document.querySelector("#open-advanced-settings").addEventListener("click", openAdvancedSettings);
advancedDialog.querySelector(".dialog-close").addEventListener("click", () => advancedDialog.close());
advancedDialog.addEventListener("click", (event) => {
  if (event.target === advancedDialog) advancedDialog.close();
});

advBannerTitle.addEventListener("change", () => {
  if (advBannerTitle.value) {
    settings.banner.mode = "fixed";
    settings.banner.titleId = advBannerTitle.value;
  } else {
    settings.banner.mode = "rotate";
    settings.banner.titleId = "";
  }
  applyBannerSettings();
});

advBannerSeconds.addEventListener("change", () => {
  const value = Math.round(Number(advBannerSeconds.value));
  settings.banner.seconds = Number.isFinite(value) ? Math.min(300, Math.max(3, value)) : DEFAULT_BANNER.seconds;
  advBannerSeconds.value = settings.banner.seconds;
  heroSignature = "";
  applyBannerSettings();
});

document.querySelector("#adv-banner-reset").addEventListener("click", () => {
  settings.banner = { ...DEFAULT_BANNER };
  advBannerSeconds.value = DEFAULT_BANNER.seconds;
  heroSignature = "";
  applyBannerSettings();
  showToast("Home banner reset to default.");
});

advShelfEnabled.addEventListener("change", () => {
  settings.shelf.enabled = advShelfEnabled.checked;
  applyShelfSettings();
});
advShelfSource.addEventListener("change", () => {
  settings.shelf.source = advShelfSource.value;
  applyShelfSettings();
});
advShelfName.addEventListener("input", () => {
  settings.shelf.name = advShelfName.value.slice(0, 40);
  saveSettings();
  renderRecentShelf();
  applySearch();
});

document.querySelector("#adv-shelf-reset").addEventListener("click", () => {
  settings.shelf = { ...DEFAULT_SHELF };
  applyShelfSettings();
  showToast("Home category reset to default.");
});

document.querySelector("#adv-recent-clear").addEventListener("click", () => {
  const tagged = customTitles.filter(isRecentlyWatched);
  if (tagged.length) clearWatchedTags(tagged);
});
