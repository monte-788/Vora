/* ========================================================================
   FILE: js/25-menu-and-empty-library.js

   WHAT IT DOES:
     The top-right menu and the 'Empty media library' feature (with its
     confirmation).

   OPEN THIS FILE IF YOU WANT TO:
     change the menu or what emptying the library removes.
   ======================================================================== */

// ---- Top-right menu -------------------------------------------------------
const menuToggle = document.querySelector("#menu-toggle");
const menuPanel = document.querySelector("#menu-panel");
const emptyLibraryButton = document.querySelector("#empty-library");
const emptyLibraryLabel = document.querySelector("#empty-library-label");
let emptyConfirmTimer = 0;

function resetEmptyConfirm() {
  clearTimeout(emptyConfirmTimer);
  emptyLibraryLabel.textContent = "Empty media library";
  emptyLibraryButton.dataset.armed = "";
}
function setMenuOpen(open) {
  if (open && !isUnlocked()) return;
  menuPanel.hidden = !open;
  menuToggle.setAttribute("aria-expanded", String(open));
  if (open) updateMenuStats();
  else resetEmptyConfirm();
}
menuToggle.addEventListener("click", async (e) => {
  e.stopPropagation();
  if (!menuPanel.hidden) {
    setMenuOpen(false);
    return;
  }
  // The settings menu is password-protected; once unlocked it stays unlocked.
  if (await requestUnlock()) setMenuOpen(true);
});
// Belt and braces: nothing inside the menu responds while it is locked.
menuPanel.addEventListener(
  "click",
  (e) => {
    if (!isUnlocked()) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true,
);
menuPanel.addEventListener("click", (e) => {
  // Close after choosing an action (but not when tapping stats or the empty-library confirm step).
  const item = e.target.closest(".menu-item");
  if (item && item !== emptyLibraryButton) setMenuOpen(false);
});
document.addEventListener("click", (e) => {
  if (!menuPanel.hidden && !e.target.closest(".menu-wrap")) setMenuOpen(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !menuPanel.hidden) setMenuOpen(false);
});

const emptyDialog = document.querySelector("#empty-library-dialog");
emptyLibraryButton.addEventListener("click", () => {
  if (!customTitles.length) return;
  setMenuOpen(false);
  emptyDialog.showModal();
});
emptyDialog.querySelector(".dialog-close").addEventListener("click", () => emptyDialog.close());
emptyDialog.addEventListener("click", (event) => { if (event.target === emptyDialog) emptyDialog.close(); });

// Titles only: removes the titles but keeps Favorites / Liked / Watchlist /
// Continue Watching info so it re-attaches when the same titles are imported again.
const PERSONAL_KEY = "vora-kept-personal-data";
function personalIdentity(item) { return `${item.type}|${String(item.title).trim().toLowerCase()}`; }
function stashPersonalData(items) {
  let kept = {};
  try { kept = JSON.parse(localStorage.getItem(PERSONAL_KEY) || "{}"); } catch { kept = {}; }
  for (const item of items) {
    const hasData = item.favorite || item.watched || item.watchlist || item.reaction || item.lastPlayedAt || item.progressSeconds ||
      (Array.isArray(item.episodes) && item.episodes.some((e) => e.progressSeconds || e.lastPlayedAt));
    if (!hasData) continue;
    kept[personalIdentity(item)] = {
      favorite: !!item.favorite, watched: !!item.watched, watchlist: !!item.watchlist, reaction: item.reaction || "",
      lastPlayedAt: item.lastPlayedAt || 0, progressSeconds: item.progressSeconds || 0, durationSeconds: item.durationSeconds || 0,
      tmdbId: item.tmdbId || 0,
      episodes: (item.episodes || []).filter((e) => e.progressSeconds || e.lastPlayedAt)
        .map((e) => ({ season: e.season, episode: e.episode, progressSeconds: e.progressSeconds || 0, durationSeconds: e.durationSeconds || 0, lastPlayedAt: e.lastPlayedAt || 0 })),
    };
  }
  try { localStorage.setItem(PERSONAL_KEY, JSON.stringify(kept)); } catch { /* ignore */ }
}
function applyStashedPersonalData(records) {
  let kept;
  try { kept = JSON.parse(localStorage.getItem(PERSONAL_KEY) || "null"); } catch { kept = null; }
  if (!kept) return;
  for (const record of records) {
    const saved = kept[personalIdentity(record)];
    if (!saved) continue;
    Object.assign(record, { favorite: saved.favorite, watched: !!saved.watched, watchlist: saved.watchlist, reaction: saved.reaction,
      lastPlayedAt: saved.lastPlayedAt, progressSeconds: saved.progressSeconds, durationSeconds: saved.durationSeconds });
    if (saved.tmdbId && !record.tmdbId) record.tmdbId = saved.tmdbId;
    for (const ep of record.episodes || []) {
      const m = (saved.episodes || []).find((x) => x.season === ep.season && x.episode === ep.episode);
      if (m) Object.assign(ep, { progressSeconds: m.progressSeconds, durationSeconds: m.durationSeconds, lastPlayedAt: m.lastPlayedAt });
    }
  }
}

async function emptyLibrary(mode) {
  emptyDialog.close();
  try {
    const all = [...customTitles];
    if (mode === "titles") stashPersonalData(all);
    else { try { localStorage.removeItem(PERSONAL_KEY); } catch { /* ignore */ } }
    await Promise.all(all.map((entry) => deleteRecord(entry.id)));
    customTitles = [];
    renderShelves();
    showToast(mode === "titles" ? "Titles deleted — favorites, watchlist and progress kept." : "Everything deleted.");
  } catch (error) {
    showToast(error.message || "Could not empty the library.");
  }
}
document.querySelector("#empty-titles-btn").addEventListener("click", () => emptyLibrary("titles"));
document.querySelector("#empty-everything-btn").addEventListener("click", () => emptyLibrary("everything"));
