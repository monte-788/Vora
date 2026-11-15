/* ========================================================================
   FILE: js/20-settings-banner-favorites.js

   WHAT IT DOES:
     Saved screen settings, the rotating home banner, favorites, and the
     'Recent & Favorites' shelf.

   OPEN THIS FILE IF YOU WANT TO:
     change how the home banner rotates or how favorites work.
   ======================================================================== */

// ---- Saved UI settings -------------------------------------------------------
const SETTINGS_KEY = "vora-ui-settings";
const DEFAULT_BANNER = { mode: "rotate", titleId: "", seconds: 10 };
const DEFAULT_SHELF = { enabled: true, source: "both", name: "" };
const SHELF_DEFAULT_NAMES = {
  both: "Recent & Favorites",
  recent: "Recently Watched",
  favorites: "Favorites",
};

function sanitizeSettings(raw) {
  const banner = (raw && raw.banner) || {};
  const shelf = (raw && raw.shelf) || {};
  const seconds = Math.round(Number(banner.seconds));
  return {
    banner: {
      mode: banner.mode === "fixed" ? "fixed" : "rotate",
      titleId: typeof banner.titleId === "string" ? banner.titleId : "",
      seconds: Number.isFinite(seconds) ? Math.min(300, Math.max(3, seconds)) : DEFAULT_BANNER.seconds,
    },
    shelf: {
      enabled: shelf.enabled !== false,
      source: ["both", "recent", "favorites"].includes(shelf.source) ? shelf.source : DEFAULT_SHELF.source,
      name: typeof shelf.name === "string" ? shelf.name.slice(0, 40) : "",
    },
    autoBackup: raw?.autoBackup !== false,
    discoverTmdb: raw?.discoverTmdb !== false,
    sheetUrl: typeof raw?.sheetUrl === "string" ? raw.sheetUrl.trim().slice(0, 2000) : "",
  };
}

function loadSettings() {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch {
    return sanitizeSettings({});
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

let settings = loadSettings();

// ---- Home banner rotation --------------------------------------------------------
let heroTitleId = "";
let heroTimer = 0;
let heroSignature = "";
let heroBusy = false;

function heroPool() {
  const withArt = customTitles.filter((item) => item.banner);
  return withArt.length ? withArt : customTitles;
}

function fixedHeroTitle() {
  if (settings.banner.mode !== "fixed") return null;
  return customTitles.find((item) => item.id === settings.banner.titleId) || null;
}

function pickHeroTitle() {
  if (!customTitles.length) return null;
  const fixed = fixedHeroTitle();
  if (fixed) return fixed;
  const pool = heroPool();
  return pool.find((item) => item.id === heroTitleId) || pool[0];
}

function syncHeroRotation() {
  const pool = heroPool();
  const rotating = !fixedHeroTitle() && pool.length > 1;
  const signature = `${rotating}|${settings.banner.seconds}|${pool.length}`;
  if (signature === heroSignature) return;
  heroSignature = signature;
  clearInterval(heroTimer);
  heroTimer = 0;
  if (rotating) heroTimer = setInterval(rotateHero, settings.banner.seconds * 1000);
}

function preloadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve();
    const image = new Image();
    image.onload = image.onerror = () => resolve();
    image.src = src;
    setTimeout(resolve, 2000);
  });
}

async function rotateHero() {
  if (heroBusy || document.hidden || document.querySelector("dialog[open]")) return;
  const pool = heroPool();
  if (fixedHeroTitle() || pool.length < 2) return;
  const index = pool.findIndex((item) => item.id === heroTitleId);
  const next = pool[(index + 1) % pool.length];
  heroBusy = true;
  try {
    await preloadImage(next.banner);
    const hero = document.querySelector("#top");
    hero.classList.add("hero-fade");
    await new Promise((resolve) => setTimeout(resolve, 350));
    heroTitleId = next.id;
    renderHero();
    hero.classList.remove("hero-fade");
  } finally {
    heroBusy = false;
  }
}

// ---- Favorites ----------------------------------------------------------------------
const favoriteButton = document.querySelector("#dialog-favorite");

function updateFavoriteButton(item) {
  const on = !!(item && item.favorite);
  favoriteButton.classList.toggle("is-favorite", on);
  favoriteButton.setAttribute("aria-pressed", String(on));
  const label = on ? "Remove from favorites" : "Add to favorites";
  favoriteButton.setAttribute("aria-label", label);
  favoriteButton.title = label;
}

async function setFavorite(item, value) {
  const previous = !!item.favorite;
  item.favorite = value;
  try {
    await saveRecord(item);
  } catch (error) {
    item.favorite = previous;
    showToast(error.message || "Could not update favorites.");
    return false;
  }
  if (dialogItem === item) updateFavoriteButton(item);
  renderShelves();
  showToast(value ? `Added “${item.title}” to favorites` : `Removed “${item.title}” from favorites`);
  return true;
}

favoriteButton.addEventListener("click", () => {
  if (dialogItem) setFavorite(dialogItem, !dialogItem.favorite);
});

// ---- Home category (recently watched / favorites) ---------------------------------
function shelfDisplayName() {
  return settings.shelf.name.trim() || SHELF_DEFAULT_NAMES[settings.shelf.source];
}

function recentShelfItems() {
  const { enabled, source } = settings.shelf;
  if (!enabled) return [];
  const wantRecent = source !== "favorites";
  const wantFavorites = source !== "recent";
  return customTitles
    .filter((item) => isInProgress(item) || (wantRecent && isRecentlyWatched(item)) || (wantFavorites && item.favorite))
    .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
}

function renderRecentShelf() {
  const items = recentShelfItems();
  document.querySelector("#recent-shelf-title").textContent = shelfDisplayName();
  document.querySelector("#recent-row").replaceChildren(...items.map((item) => createCard(item, { removable: true })));
  document.querySelector("#recent-shelf").hidden = items.length === 0;
}
