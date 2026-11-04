// Snapshot of the untouched page, used to build the "Export library" download.
const pristineHTML = "<!doctype html>\n" + document.documentElement.outerHTML;
const SNAPSHOT_KEY = "vora-imported-snapshots";
const DB_NAME = "vora-library";
const STORE_NAME = "titles";

let titleDB;
let customTitles = [];
let featuredTitle = null;
let toastTimer;
let previewObjectUrl = "";
let dialogItem = null;
let savedSignature = "";

const dialog = document.querySelector("#title-dialog");
const addDialog = document.querySelector("#add-movie-dialog");
const movieForm = document.querySelector("#movie-form");
const episodeFormList = document.querySelector("#episode-form-list");
const movieDriveInput = document.querySelector("#movie-drive-link");
const bannerFileInput = document.querySelector("#movie-banner-file");
const bannerUrlInput = document.querySelector("#movie-banner-url");
const bannerPreview = document.querySelector("#banner-preview");
const bannerPreviewImage = document.querySelector("#banner-preview-image");
const formError = document.querySelector("#form-error");
const searchInput = document.querySelector("#search-input");
const saveButton = document.querySelector("#save-library");
const importCsvButton = document.querySelector("#open-import-csv");
const importCsvInput = document.querySelector("#import-csv-input");
const tmdbSettingsButton = document.querySelector("#open-tmdb-settings");
const removeButton = document.querySelector("#dialog-remove");
const removeConfirm = document.querySelector("#remove-confirm");
const removeConfirmText = document.querySelector("#remove-confirm-text");
const removeError = document.querySelector("#remove-error");
const confirmRemoveButton = document.querySelector("#confirm-remove");
const cancelRemoveButton = document.querySelector("#cancel-remove");
const toggleAddEpisodeButton = document.querySelector("#toggle-add-episode");
const dialogEpisodeForm = document.querySelector("#dialog-episode-form");
const dialogEpisodeError = document.querySelector("#dialog-episode-error");

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createId() {
  return (
    window.crypto?.randomUUID?.() ||
    `vora-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

// Watch values are normal http(s) links; they are played exactly as saved.
function resolveWatchUrl(raw) {
  return String(raw || "").trim();
}

function mediaLinkUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error("Enter a watch link.");
  }
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid http:// or https:// link.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Use an http:// or https:// link.");
  }
  return url.href;
}

function openMediaLinkInNewTab(url) {
  // "noopener" is deliberately NOT passed as a window.open feature: with it,
  // browsers always return null even when the tab opened successfully.
  const opened = window.open(url, "_blank");
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      /* cross-origin or restricted; safe to ignore */
    }
    return;
  }
  // Popup genuinely blocked (e.g. some Android WebViews): navigate this view.
  window.location.href = url;
}

// ---- In-site player -------------------------------------------------------
// Watch links open inside Vora instead of a new tab.
//  1. Nextcloud / ownCloud share links (…/s/<token>) are played in a <video>
//     using the share's direct "/download" URL (works for mp4/webm/m4v).
//  2. If the video can't play (e.g. mkv/avi), the share page itself is shown
//     in an embedded frame. If the host forbids framing, use "Open in new tab".
//  3. Any other link is shown in an embedded frame.
const playerDialog = document.querySelector("#player-dialog");
const playerStage = document.querySelector("#player-stage");
const playerTitleEl = document.querySelector("#player-title");
let playerCurrentUrl = "";

function directVideoUrl(url) {
  try {
    const u = new URL(url);
    if (/\/s\/[A-Za-z0-9]+\/?$/.test(u.pathname)) {
      return u.origin + u.pathname.replace(/\/$/, "") + "/download";
    }
    if (/\.(mp4|m4v|webm|ogv|mov)$/i.test(u.pathname)) return u.href;
  } catch {
    /* not a URL */
  }
  return "";
}

function clearPlayerStage() {
  const video = playerStage.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  playerStage.replaceChildren();
}

function showPlayerFrame(url, note) {
  clearPlayerStage();
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "no-referrer";
  playerStage.append(frame);
  if (note) {
    const n = document.createElement("div");
    n.className = "player-note";
    n.textContent = note;
    playerStage.append(n);
    setTimeout(() => n.remove(), 9000);
  }
}

const RECENT_MS = 24 * 60 * 60 * 1000;
function isInProgress(item) {
  const position = Number(item?.progressSeconds || 0);
  const duration = Number(item?.durationSeconds || 0);
  return position > 0 && duration > 0 && duration - position > 300;
}
function isRecentlyWatched(item) {
  return !!item && Number(item.lastPlayedAt) > 0 && Date.now() - Number(item.lastPlayedAt) < RECENT_MS;
}
function markWatched(item) {
  if (!item) return;
  item.lastPlayedAt = Date.now();
  saveRecord(item).catch(() => {});
  renderShelves();
  if (dialogItem === item) renderDialogMeta(item);
}

function openMediaLink(url, title, item, episode) {
  if (!url) {
    showToast("This title does not have a watch link yet.");
    return;
  }
  if (!playerDialog || typeof playerDialog.showModal !== "function") {
    openMediaLinkInNewTab(url);
    return;
  }

  markWatched(item);
  // Progress belongs to the episode being played (or the movie itself), never the whole show.
  const progressTarget = episode || item;
  playerCurrentUrl = url;
  playerTitleEl.textContent =
    title || (dialogItem && dialogItem.title) || "Now playing";
  clearPlayerStage();

  const direct = directVideoUrl(url);
  if (direct) {
    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "auto";
    video.referrerPolicy = "no-referrer";
    video.addEventListener("error", () => {
      showPlayerFrame(
        url,
        "Couldn't play this file directly. If nothing shows, tap “Open in new tab”.",
      );
    });
    video.addEventListener("loadedmetadata", () => {
      const savedPosition = Number(progressTarget?.progressSeconds || 0);
      const duration = Number(video.duration || 0);
      if (savedPosition > 0 && duration > 0 && duration - savedPosition > 300) {
        try { video.currentTime = savedPosition; } catch { /* wait for seekable media */ }
      }
    });
    let lastProgressSave = 0;
    video.addEventListener("timeupdate", () => {
      if (!item || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const now = Date.now();
      if (now - lastProgressSave < 5000) return;
      lastProgressSave = now;
      progressTarget.progressSeconds = Math.floor(video.currentTime || 0);
      progressTarget.durationSeconds = Math.floor(video.duration || 0);
      progressTarget.lastPlayedAt = now;
      if (episode) {
        // Mirror onto the show only for its "Continue watching" badge/bar; never used for resuming.
        item.progressSeconds = progressTarget.progressSeconds;
        item.durationSeconds = progressTarget.durationSeconds;
      }
      item.lastPlayedAt = now;
      saveRecord(item).catch(() => {});
      renderRecentShelf();
    });
    video.addEventListener("ended", () => {
      if (!item) return;
      progressTarget.progressSeconds = 0;
      progressTarget.durationSeconds = Math.floor(video.duration || progressTarget.durationSeconds || 0);
      if (episode) item.progressSeconds = 0;
      saveRecord(item).catch(() => {});
      renderShelves();
    });
    video.src = direct;
    playerStage.append(video);
    initSubtitles(video, item, episode);
  } else {
    showPlayerFrame(url, "If nothing shows, tap “Open in new tab”.");
  }

  stopTrailer();
  if (!playerDialog.open) playerDialog.showModal();
}

function closePlayer() {
  if (playerDialog.open) playerDialog.close();
}
playerDialog.addEventListener("close", () => {
  resetSubtitles();
  clearPlayerStage();
  playerCurrentUrl = "";
});
document.querySelector("#player-close").addEventListener("click", closePlayer);
document.querySelector("#player-newtab").addEventListener("click", () => {
  if (playerCurrentUrl) openMediaLinkInNewTab(playerCurrentUrl);
});

function cardSearchText(item) {
  const episodeText = (item.episodes || [])
    .map((episode) => episode.title)
    .join(" ");
  return `${item.title} ${item.type} ${(item.genres || []).join(" ")} ${item.description} ${episodeText}`.toLowerCase();
}

const TMDB_IMG = "https://image.tmdb.org/t/p/";
function posterUrl(item, size = "w342") {
  return item && item.poster ? `${TMDB_IMG}${size}${item.poster}` : "";
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.6v14.8a1 1 0 0 0 1.52.85l12-7.4a1 1 0 0 0 0-1.7l-12-7.4A1 1 0 0 0 7 4.6z"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

function setWatchLabel(button, label) {
  button.innerHTML = ICON_PLAY + "<span></span>";
  button.lastElementChild.textContent = label;
}

function applyCardArt(card, item) {
  const image = card.querySelector(".card-image");
  const poster = posterUrl(item);
  const src = poster || item.banner || "";
  image.dataset.fallback = "";
  card.classList.toggle("no-art", !src);
  card.classList.toggle("banner-art", !poster && !!src);
  if (src) {
    if (image.getAttribute("src") !== src) image.src = src;
  } else {
    image.removeAttribute("src");
  }
}

// Swaps new artwork into cards already on screen, so rows don't jump while TMDB fills in posters.
function refreshCardArt(item) {
  document.querySelectorAll(".title-card").forEach((card) => {
    if (card.dataset.id === item.id) applyCardArt(card, item);
  });
  if (featuredTitle && featuredTitle.id === item.id) renderHero();
}

function cardMetaLine(item) {
  const parts = [];
  if (item.rating) parts.push(`★ ${item.rating}`);
  if (item.year) parts.push(item.year);
  if (item.type === "show") {
    parts.push(`${item.episodes.length} episode${item.episodes.length === 1 ? "" : "s"}`);
  } else if (!parts.length) {
    parts.push("Movie");
  }
  return parts.join("  ·  ");
}

function createCard(item) {
  const card = document.createElement("article");
  card.className = "title-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute(
    "aria-label",
    `${item.title}, ${item.genres.join(" and ")}. Open details.`,
  );
  card.dataset.search = cardSearchText(item);
  card.dataset.id = item.id;
  card.dataset.type = item.type;
  card.dataset.genres = item.genres.join("|").toLowerCase();

  const image = document.createElement("img");
  image.className = "card-image";
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.draggable = false;
  image.addEventListener("error", () => {
    if (image.dataset.fallback !== "1" && item.banner && image.getAttribute("src") !== item.banner) {
      image.dataset.fallback = "1";
      card.classList.add("banner-art");
      image.src = item.banner;
    } else {
      card.classList.add("no-art");
    }
  });
  card.append(image);
  applyCardArt(card, item);

  const badges = document.createElement("div");
  badges.className = "card-badges";
  if (isInProgress(item)) {
    const progress = document.createElement("span");
    progress.className = "watched-badge continue-badge";
    progress.textContent = "Continue watching";
    badges.append(progress);
  } else if (isRecentlyWatched(item)) {
    const watched = document.createElement("span");
    watched.className = "watched-badge";
    watched.textContent = "Recently Watched";
    badges.append(watched);
  }
  if (item.watchlist || item.reaction === "like") {
    const taste = document.createElement("span");
    taste.className = "watched-badge";
    taste.textContent = item.watchlist ? "Watchlist" : "Liked";
    badges.append(taste);
  }
  if (badges.children.length) card.append(badges);

  if (isInProgress(item)) {
    const bar = document.createElement("div");
    bar.className = "card-progress";
    const fill = document.createElement("span");
    const pct = Math.max(3, Math.min(100, Math.round((Number(item.progressSeconds) / Number(item.durationSeconds)) * 100)));
    fill.style.width = `${pct}%`;
    bar.append(fill);
    card.append(bar);
  }

  const copy = document.createElement("span");
  copy.className = "card-copy";
  for (const [className, text] of [
    ["card-title", item.title],
    ["card-year", cardMetaLine(item)],
    ["card-tag", item.genres.join(" · ")],
  ]) {
    const line = document.createElement("span");
    line.className = className;
    line.textContent = text;
    copy.append(line);
  }
  card.append(copy);

  card.addEventListener("click", () => openTitleDialog(item));
  card.addEventListener("keydown", (event) => {
    if (event.target === card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openTitleDialog(item);
    }
  });
  return card;
}

function renderGenreShelves() {
  const root = document.querySelector("#genre-shelves");
  const groups = new Map(); // no extra genre categories on the home screen

  root.replaceChildren(
    ...[...groups.entries()].map(([genre, items]) => {
      const shelf = document.createElement("section");
      shelf.className = "shelf user-genre-shelf";
      shelf.id = `genre-${slug(genre)}`;
      shelf.dataset.filter = slug(genre);

      const heading = document.createElement("div");
      heading.className = "shelf-heading";
      const headingText = document.createElement("div");
      const title = document.createElement("h2");
      title.textContent = genre;
      headingText.append(title);

      const controls = document.createElement("div");
      controls.className = "shelf-controls";
      const rowId = `${shelf.id}-row`;
      for (const [direction, symbol, side] of [
        [-1, "‹", "left"],
        [1, "›", "right"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "carousel-button";
        button.dataset.direction = String(direction);
        button.dataset.target = rowId;
        button.setAttribute("aria-label", `Scroll ${genre} titles ${side}`);
        button.textContent = symbol;
        controls.append(button);
      }
      heading.append(headingText, controls);

      const row = document.createElement("div");
      row.className = "card-row";
      row.id = rowId;
      row.append(...items.map(createCard));
      shelf.append(heading, row);
      return shelf;
    }),
  );
}

function renderHeroMeta(item) {
  const meta = document.querySelector("#hero-meta");
  const parts = [];
  if (item.rating) parts.push([`★ ${item.rating}`, "m-rating"]);
  if (item.year) parts.push([item.year]);
  if (item.cert) parts.push([item.cert, "m-cert"]);
  if (item.type === "show") parts.push([`${item.episodes.length} episode${item.episodes.length === 1 ? "" : "s"}`]);
  parts.push([item.genres.join(" · ")]);
  meta.replaceChildren(
    ...parts.map(([text, cls]) => {
      const span = document.createElement("span");
      span.textContent = text;
      if (cls) span.className = cls;
      return span;
    }),
  );
  meta.hidden = false;
}

function renderHeroDots() {
  const dots = document.querySelector("#hero-dots");
  const pool = heroPool();
  const visible = featuredTitle && !fixedHeroTitle() && pool.length > 1 && pool.length <= 10;
  dots.hidden = !visible;
  if (!visible) {
    dots.replaceChildren();
    return;
  }
  dots.replaceChildren(
    ...pool.map((entry) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "hero-dot" + (entry.id === heroTitleId ? " active" : "");
      dot.setAttribute("aria-label", `Show ${entry.title}`);
      dot.addEventListener("click", () => {
        heroTitleId = entry.id;
        heroSignature = "";
        renderHero();
      });
      return dot;
    }),
  );
}

function renderHero() {
  const hero = document.querySelector("#top");
  const title = document.querySelector("#hero-title");
  const eyebrow = document.querySelector("#hero-eyebrow");
  const description = document.querySelector("#hero-description");
  const meta = document.querySelector("#hero-meta");
  const actionLabel = document.querySelector("#hero-action-label");
  const actionIcon = document.querySelector("#hero-action-icon");
  const info = document.querySelector("#hero-info");
  const poster = document.querySelector("#hero-poster");
  featuredTitle = pickHeroTitle();
  heroTitleId = featuredTitle ? featuredTitle.id : "";
  syncHeroRotation();

  if (!featuredTitle) {
    hero.classList.add("hero-empty");
    title.classList.remove("featured-title");
    title.textContent = "Your library";
    eyebrow.textContent = "Vora";
    description.textContent =
      "Add a movie or show to start building your own Vora library.";
    meta.hidden = true;
    meta.replaceChildren();
    actionLabel.textContent = "Add your first title";
    actionIcon.innerHTML = ICON_PLUS;
    info.hidden = true;
    poster.hidden = true;
    hero.style.removeProperty("--hero-banner");
    hero.style.removeProperty("--hero-poster");
    renderHeroDots();
    return;
  }

  hero.classList.remove("hero-empty");
  title.classList.add("featured-title");
  title.textContent = featuredTitle.title;
  eyebrow.textContent = featuredTitle.type === "show" ? "Series" : "Movie";
  description.textContent = featuredTitle.description;
  description.title = featuredTitle.description;
  description.hidden = !featuredTitle.description;
  renderHeroMeta(featuredTitle);
  actionLabel.textContent = featuredTitle.type === "show" ? "Episodes" : "Play";
  actionIcon.innerHTML = featuredTitle.type === "show" ? ICON_LIST : ICON_PLAY;
  info.hidden = false;
  poster.hidden = false;
  poster.setAttribute("aria-label", `${featuredTitle.title} — open details`);
  const bannerArt = featuredTitle.banner || posterUrl(featuredTitle, "w780");
  const posterArt = posterUrl(featuredTitle, "w500") || featuredTitle.banner;
  hero.style.setProperty("--hero-banner", bannerArt ? `url("${bannerArt}")` : "none");
  hero.style.setProperty("--hero-poster", posterArt ? `url("${posterArt}")` : "none");
  renderHeroDots();
}

let activeFilter = "all";

function setFilter(next) {
  activeFilter = next;
  document.querySelectorAll(".nav-link[data-chip]").forEach((chip) => {
    const on = chip.dataset.chip === next;
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-pressed", String(on));
  });
  if (next === "discover") enterDiscover(); else if (document.body.classList.contains("discover-mode")) exitDiscover();
  applySearch();
}

function cardMatchesFilter(card) {
  if (activeFilter === "all") return true;
  if (activeFilter === "movie" || activeFilter === "show") return card.dataset.type === activeFilter;
  return (card.dataset.genres || "").split("|").includes(activeFilter);
}

function itemMatchesFilter(item) {
  if (activeFilter === "all") return true;
  if (activeFilter === "movie" || activeFilter === "show") return item.type === activeFilter;
  return (item.genres || []).some((g) => String(g).toLowerCase() === activeFilter);
}

// Relevance of a title for a search: every word must match the title, genre, type, year or an
// episode name. Titles rank first, then genres. Descriptions are deliberately not searched.
function searchScore(item, tokens) {
  const title = String(item.title || "").toLowerCase();
  const titleWords = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const genres = (item.genres || []).map((g) => String(g).toLowerCase());
  const kind = item.type === "show" ? ["show", "shows", "series", "tv"] : ["movie", "movies", "film", "films"];
  const year = String(item.year || "");
  const episodes = (item.episodes || []).map((e) => String(e.title || "").toLowerCase()).join(" ");
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    if (title.startsWith(token)) best = 10;
    else if (titleWords.some((w) => w.startsWith(token))) best = 8;
    else if (title.includes(token)) best = 6;
    else if (genres.some((g) => g.startsWith(token))) best = 4;
    else if (genres.some((g) => g.includes(token))) best = 3;
    else if (kind.includes(token) || (year && year.startsWith(token))) best = 2;
    else if (episodes.includes(token)) best = 1;
    if (!best) return 0;
    total += best;
  }
  return total;
}

function applySearch() {
  if (activeFilter === "discover") { applyDiscoverSearch(); return; }
  const query = searchInput.value.trim().toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const browsing = tokens.length > 0 || activeFilter !== "all";
  document.body.classList.toggle("grid-mode", browsing);
  const resultsSection = document.querySelector("#search-results");
  const resultsRow = document.querySelector("#search-results-row");
  let visibleShelves = 0;
  let resultCount = 0;

  if (tokens.length) {
    // One flat, ranked results grid instead of filtering every shelf.
    const results = customTitles
      .filter(itemMatchesFilter)
      .map((item) => [item, searchScore(item, tokens)])
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1] || String(a[0].title).localeCompare(String(b[0].title)))
      .map(([item]) => item);
    resultCount = results.length;
    resultsRow.replaceChildren(...results.map(createCard));
    resultsSection.hidden = results.length === 0;
    document.querySelector("#search-results-title").textContent =
      `${results.length} result${results.length === 1 ? "" : "s"} for “${searchInput.value.trim()}”`;
    document.querySelectorAll(".shelf").forEach((shelf) => { shelf.hidden = true; });
  } else {
    resultsSection.hidden = true;
    resultsRow.replaceChildren();
    document.querySelectorAll(".content-area .title-card").forEach((card) => {
      card.hidden = !cardMatchesFilter(card);
    });
    document.querySelectorAll(".shelf").forEach((shelf) => {
      const kind = shelf.dataset.filter || "";
      let allowed = true;
      if (activeFilter !== "all") allowed = kind === activeFilter;
      const visibleCard = [...shelf.querySelectorAll(".title-card")].some((card) => !card.hidden);
      shelf.hidden = !allowed || !visibleCard;
      if (!shelf.hidden) visibleShelves++;
    });
  }
  document.querySelector("#library-empty").hidden = customTitles.length > 0 || !!query;
  const none = document.querySelector("#no-search-results");
  none.hidden = !(browsing && customTitles.length > 0 && (tokens.length ? resultCount === 0 : visibleShelves === 0));
  none.textContent = tokens.length ? "No titles match your search." : "Nothing in this category yet.";
}

function updateMenuStats() {
  const movies = customTitles.filter((i) => i.type === "movie").length;
  const shows = customTitles.filter((i) => i.type === "show").length;
  document.querySelector("#stat-movies").textContent = movies;
  document.querySelector("#stat-shows").textContent = shows;
  document.querySelector("#empty-library").disabled = customTitles.length === 0;
}

function renderWatchlistShelf() {
  const items = customTitles.filter((item) => item.watchlist).sort((a,b) => (b.lastPlayedAt||0)-(a.lastPlayedAt||0));
  document.querySelector("#watchlist-row").replaceChildren(...items.map(createCard));
  document.querySelector("#watchlist-shelf").hidden = items.length === 0;
}

const BECAUSE_ROTATE_MS = 3 * 60 * 1000; // swap the "Because you liked" title every 3 minutes
let becauseRotation = 0;
setInterval(() => { becauseRotation += 1; renderBecauseShelf(); }, BECAUSE_ROTATE_MS);

function renderBecauseShelf() {
  const row = document.querySelector("#because-row");
  // Only titles you actually liked or favorited can seed this shelf (never rating or play history).
  const seeds = customTitles.filter((i) => (i.favorite || i.reaction === "like") && i.reaction !== "dislike")
    .sort((a,b) => ((b.reaction === "like")-(a.reaction === "like")) || ((b.lastPlayedAt||0)-(a.lastPlayedAt||0)));
  if (!seeds.length) {
    row.replaceChildren();
    delete row.dataset.seedId;
    document.querySelector("#because-title").textContent = "Because you liked…";
    document.querySelector("#because-shelf").hidden = true;
    return;
  }
  const tmdbOn = settings.discoverTmdb && getTmdbKey();
  const matchesFor = (seed) => customTitles.filter((i) => i.id !== seed.id && !i.reaction?.includes("dislike") && i.genres.some(g => seed.genres.includes(g)))
    .sort((a,b) => scoreRecommendation(b,seed)-scoreRecommendation(a,seed)).slice(0,10);
  // Walk the seed list starting at the rotation position; use the first seed that has something to show.
  let seed = null, inLibrary = [];
  for (let n = 0; n < seeds.length; n++) {
    const candidate = seeds[(becauseRotation + n) % seeds.length];
    const found = matchesFor(candidate);
    if (found.length || tmdbOn) { seed = candidate; inLibrary = found; break; }
  }
  const seen = new Set(inLibrary.map(i => `${i.type}|${i.title.toLowerCase()}`));
  row.replaceChildren(...inLibrary.map(createCard));
  delete row.dataset.seedId;
  document.querySelector("#because-title").textContent = seed ? `Because you liked ${seed.title}` : "Because you liked…";
  document.querySelector("#because-shelf").hidden = inLibrary.length === 0 && !(seed && tmdbOn);
  if (seed && tmdbOn) loadTmdbRecommendations(seed, seen, row, inLibrary.length);
}
function scoreRecommendation(item, seed) {
  let score = item.genres.filter(g => seed.genres.includes(g)).length * 4;
  if (item.favorite) score += 3;
  if (item.reaction === "like") score += 5;
  score += Math.min(2, Number(item.rating)||0) / 2;
  if (item.lastPlayedAt) score += 1;
  return score;
}
async function loadTmdbRecommendations(seed, seen, row, startIndex) {
  if (!row.isConnected || row.dataset.seedId === seed.id) return;
  const key = getTmdbKey(); if (!key) return;
  const kind = seed.type === "show" ? "tv" : "movie";
  try {
    let tmdbId = seed.tmdbId;
    if (!tmdbId) {
      const search = await fetch(`https://api.themoviedb.org/3/search/${kind}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(seed.title)}&include_adult=false`).then(r => r.json());
      tmdbId = search.results?.[0]?.id;
    }
    if (!tmdbId) return;
    row.dataset.seedId = seed.id;
    const response = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}/recommendations?api_key=${encodeURIComponent(key)}&language=en-US&page=1`);
    if (!response.ok) return;
    const data = await response.json();
    let recommendations = data.results || [];
    if (recommendations.length < 12) {
      const popularResponse = await fetch(`https://api.themoviedb.org/3/${kind}/${tmdbId}/similar?api_key=${encodeURIComponent(key)}&language=en-US&page=1`);
      if (popularResponse.ok) {
        const popular = await popularResponse.json();
        recommendations = [...recommendations, ...(popular.results || [])];
      }
    }
    let externalAdded = 0;
    for (const rec of recommendations) {
      if (externalAdded >= 5 && row.children.length >= startIndex + 5) break;
      const type = seed.type;
      const signature = `${type}|${String(rec.title || rec.name || "").toLowerCase()}`;
      if (!signature.split("|")[1] || seen.has(signature) || customTitles.some(i => i.type === type && i.title.toLowerCase() === signature.split("|")[1])) continue;
      seen.add(signature);
      const card = document.createElement("article"); card.className = "title-card recommendation-card"; card.tabIndex = 0; card.setAttribute("role","button");
      const img = document.createElement("img"); img.className="card-image"; img.loading="lazy"; img.alt="";
      if (rec.poster_path) img.src=`https://image.tmdb.org/t/p/w342${rec.poster_path}`; else card.classList.add("no-art"); card.append(img);
      const ribbon=document.createElement("span"); ribbon.className="unavailable-ribbon"; ribbon.textContent="Not Available"; card.append(ribbon);
      const copy=document.createElement("span"); copy.className="card-copy";
      for (const [cls,txt] of [["card-title",rec.title||rec.name||"Untitled"],["card-year",(rec.release_date||rec.first_air_date||"").slice(0,4)],["card-tag",(rec.genre_ids||[]).slice(0,2).map(id=>(TMDB_MOVIE_GENRES[id]||TMDB_TV_GENRES[id]||"")).filter(Boolean).join(" · ")]]) { const el=document.createElement("span");el.className=cls;el.textContent=txt;copy.append(el); }
      card.append(copy);
      card.addEventListener("click",()=>openExternalRecommendation(rec, type));
      card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openExternalRecommendation(rec,type);}});
      row.append(card);
      externalAdded++;
    }
    document.querySelector("#because-shelf").hidden = row.children.length === 0;
  } catch (error) { console.warn("TMDB recommendations unavailable", error); }
}
function openExternalRecommendation(rec, type) {
  const item = { id: `tmdb-${type}-${rec.id}`, type, title: rec.title || rec.name || "Untitled", genres: (rec.genre_ids || []).map((id) => (type === "show" ? TMDB_TV_GENRES : TMDB_MOVIE_GENRES)[id]).filter(Boolean).slice(0, 3), description: rec.overview || "", banner: rec.backdrop_path ? `https://image.tmdb.org/t/p/w1280${rec.backdrop_path}` : "", poster: rec.poster_path || "", year: (rec.release_date || rec.first_air_date || "").slice(0,4), rating: rec.vote_average ? Number(rec.vote_average).toFixed(1) : "", tmdbId: Number(rec.id)||0, driveUrl:"", episodes:[], favorite:false, watchlist:false, reaction:"", externalRecommendation:true };
  openTitleDialog(item);
}

function renderShelves() {
  const movies = customTitles.filter((item) => item.type === "movie");
  const shows = customTitles.filter((item) => item.type === "show");
  document
    .querySelector("#movies-row")
    .replaceChildren(...movies.map(createCard));
  document
    .querySelector("#shows-row")
    .replaceChildren(...shows.map(createCard));
  document.querySelector("#movies-shelf").hidden = movies.length === 0;
  document.querySelector("#shows-shelf").hidden = shows.length === 0;
  document.querySelector("#library-count").textContent =
    `· ${movies.length} movie${movies.length === 1 ? "" : "s"} · ${shows.length} show${shows.length === 1 ? "" : "s"}`;
  renderGenreShelves();
  renderRecentShelf();
  renderWatchlistShelf();
  renderBecauseShelf();
  renderHero();
  applySearch();
  updateSaveState();
  writeAutomaticBackup();
  updateMenuStats();
  renderAdvancedIfOpen();
  scheduleEnrich();
}

function sortEpisodes(episodes) {
  return [...episodes].sort(
    (a, b) => a.season - b.season || a.episode - b.episode,
  );
}

function makeEpisodeButton(episode, item) {
  const card = document.createElement("div");
  card.className = "episode-card";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "episode-card-watch";
  const thumb = document.createElement("span");
  thumb.className = "episode-thumb";
  const thumbImage = episode.still || item.banner;
  if (thumbImage) thumb.style.backgroundImage = `url("${thumbImage}")`;
  thumb.innerHTML = ICON_PLAY;
  const label = document.createElement("span");
  label.className = "episode-label";
  label.textContent = `${episode.episode}. ${episode.title}`;
  play.append(thumb, label);
  // An episode without a watch link stays in the library but is not playable.
  play.hidden = !String(episode.driveUrl || "").trim();
  if (play.hidden) play.setAttribute("aria-label", `${episode.title} — no watch link available`);
  play.addEventListener("click", () => {
    if (!String(episode.driveUrl || "").trim()) return;
    episode.lastPlayedAt = Date.now();
    saveRecord(item).catch(() => {});
    openMediaLink(resolveWatchUrl(episode.driveUrl), `${item.title} · S${episode.season} E${episode.episode}`, item, episode);
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "episode-remove";
  remove.setAttribute("aria-label", `Remove episode “${episode.title}”`);
  remove.textContent = "×";
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    removeEpisode(item, episode);
  });
  card.append(play, remove);
  return card;
}

function resetRemoveConfirm() {
  removeConfirm.hidden = true;
  removeButton.hidden = false;
  removeError.textContent = "";
  confirmRemoveButton.disabled = false;
  confirmRemoveButton.textContent = "Yes, remove";
}

function refreshEpisodeList(item) {
  const select = document.querySelector("#season-select");
  item.episodes = sortEpisodes(item.episodes);
  const seasons = [...new Set(item.episodes.map((e) => e.season))];
  const keep = Number(select.value);
  select.replaceChildren(...seasons.map((n) => new Option(`Season ${n}`, n)));
  select.value = seasons.includes(keep) ? keep : (seasons[0] ?? "");
  document.querySelector("#episode-count-note").textContent =
    `${item.episodes.length} episode${item.episodes.length === 1 ? "" : "s"}`;
  document.querySelector("#season-bar").hidden = !seasons.length;
  document.querySelector("#episode-list").replaceChildren(
    ...item.episodes
      .filter((e) => e.season === Number(select.value))
      .map((e) => makeEpisodeButton(e, item)),
  );
  const lastEpisode = item.episodes.filter((e) => Number(e.lastPlayedAt) > 0)
    .sort((a, b) => Number(b.lastPlayedAt) - Number(a.lastPlayedAt))[0];
  const currentEpisode = lastEpisode || item.episodes.find((e) => String(e.driveUrl || "").trim()) || item.episodes[0];
  const watchButton = document.querySelector("#dialog-watch");
  watchButton.hidden = !currentEpisode || !String(currentEpisode.driveUrl || "").trim();
  if (currentEpisode && String(currentEpisode.driveUrl || "").trim()) {
    setWatchLabel(watchButton, lastEpisode ? `Continue S${currentEpisode.season} · E${currentEpisode.episode}` : `Play S${currentEpisode.season} · E${currentEpisode.episode}`);
    watchButton.onclick = () => openMediaLink(resolveWatchUrl(currentEpisode.driveUrl), `${item.title} · S${currentEpisode.season} E${currentEpisode.episode}`, item, currentEpisode);
  }
}

async function removeEpisode(item, episode) {
  const confirmed = window.confirm(
    `Remove “${episode.title}” from ${item.title}? This can’t be undone.`,
  );
  if (!confirmed) return;
  const previousEpisodes = item.episodes;
  item.episodes = item.episodes.filter((entry) => entry !== episode);
  try {
    await saveRecord(item);
  } catch (error) {
    item.episodes = previousEpisodes;
    showToast(error.message || "Could not remove that episode.");
    return;
  }
  refreshEpisodeList(item);
  renderShelves();
  showToast(`Removed “${episode.title}”`);
}

function renderDialogMeta(item) {
  const parts = [];
  if (item.rating) parts.push(["★ " + item.rating, "star"]);
  if (item.year) parts.push([item.year]);
  parts.push([[item.type === "show" ? "Series" : "Movie", ...item.genres].join(" · ")]);
  if (item.cert) parts.push([item.cert, "age-badge"]);
  if (isRecentlyWatched(item)) parts.push(["Recently Watched", "watched-badge"]);
  document.querySelector("#dialog-meta").replaceChildren(
    ...parts.map(([text, cls]) => {
      const span = document.createElement("span");
      span.textContent = text;
      if (cls) span.className = cls;
      return span;
    }),
  );
}

// Fetches rating, year, age rating and (for shows) episode names + stills
// from TMDB the first time a title is opened, then saves them on the title.
async function loadTmdbDetails(item) {
  const key = getTmdbKey();
  if (!key || item.detailsAt) return;
  const api = (path, params = "") =>
    fetch(`https://api.themoviedb.org/3/${path}?api_key=${encodeURIComponent(key)}${params}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  try {
    const kind = item.type === "show" ? "tv" : "movie";
    const found = (await api(`search/${kind}`, `&query=${encodeURIComponent(item.title)}&include_adult=false`)).results?.[0];
    if (!found) return;
    const detail = await api(`${kind}/${found.id}`, `&append_to_response=${kind === "tv" ? "content_ratings" : "release_dates"}`);
    item.rating = detail.vote_average ? detail.vote_average.toFixed(1) : "";
    item.year = (detail.release_date || detail.first_air_date || "").slice(0, 4);
    if (detail.poster_path) item.poster = detail.poster_path;
    const list = (kind === "tv" ? detail.content_ratings : detail.release_dates)?.results || [];
    const us = list.find((r) => r.iso_3166_1 === "US");
    item.cert = kind === "tv"
      ? us?.rating || ""
      : us?.release_dates?.find((r) => r.certification)?.certification || "";
    if (kind === "tv") {
      const generic = /^(season \d+, episode \d+|episode)$/i;
      for (const n of new Set(item.episodes.map((e) => e.season))) {
        const season = await api(`tv/${found.id}/season/${n}`).catch(() => null);
        for (const tmdbEpisode of season?.episodes || []) {
          const mine = item.episodes.find((e) => e.season === n && e.episode === tmdbEpisode.episode_number);
          if (!mine) continue;
          if (tmdbEpisode.name && (!mine.title || generic.test(mine.title.trim()))) mine.title = tmdbEpisode.name;
          if (tmdbEpisode.still_path) mine.still = `https://image.tmdb.org/t/p/w500${tmdbEpisode.still_path}`;
        }
      }
    }
    item.detailsAt = Date.now();
    await saveRecord(item);
    refreshCardArt(item);
    if (dialogItem === item) {
      renderDialogMeta(item);
      if (item.type === "show") refreshEpisodeList(item);
    }
  } catch (error) {
    console.warn("TMDB details failed:", error);
  }
}

// ---- Cast (TMDB credits) ----------------------------------------------
const PERSON_SKIP_GENRES = new Set([10767, 10763]); // talk shows and news appearances
const PERSON_CREW_JOBS = new Set(["Director", "Creator", "Writer", "Screenplay", "Executive Producer"]);

function personDialog() {
  let page = document.querySelector("#person-filmography-dialog");
  if (page) return page;
  page = document.createElement("dialog");
  page.id = "person-filmography-dialog";
  page.className = "person-dialog";
  page.setAttribute("aria-label", "Cast member");
  page.innerHTML = `
    <button type="button" class="person-nav person-back" aria-label="Back">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
    </button>
    <button type="button" class="person-nav person-close" aria-label="Close">×</button>
    <header class="person-hero">
      <div class="person-hero-bg"></div>
      <div class="person-hero-inner">
        <div class="person-photo" aria-hidden="true"></div>
        <div class="person-info">
          <p class="person-kicker"></p>
          <h2 class="person-heading"></h2>
          <p class="person-meta"></p>
          <p class="person-bio"></p>
          <button type="button" class="person-bio-toggle" hidden>Read more</button>
        </div>
      </div>
    </header>
    <div class="person-body">
      <div class="person-filters" role="group" aria-label="Filter filmography"></div>
      <div class="person-content"></div>
    </div>`;
  document.body.append(page);
  page.querySelector(".person-back").addEventListener("click", () => page.close());
  page.querySelector(".person-close").addEventListener("click", () => page.close());
  page.querySelector(".person-bio-toggle").addEventListener("click", (e) => {
    const bio = page.querySelector(".person-bio");
    const open = bio.classList.toggle("expanded");
    e.currentTarget.textContent = open ? "Show less" : "Read more";
  });
  return page;
}

async function openPersonPage(person) {
  const key = getTmdbKey();
  if (!key) { showToast("TMDB API key not found on this browser. Add it in the Vora menu."); return; }
  const personId = Number(person?.id);
  if (!Number.isInteger(personId) || personId <= 0) {
    showToast("This cast entry is missing its TMDB person ID. Refresh the title's cast data and try again.");
    console.warn("Cannot load cast filmography: invalid person ID", person);
    return;
  }
  const page = personDialog();
  const content = page.querySelector(".person-content");
  const filters = page.querySelector(".person-filters");
  const photo = page.querySelector(".person-photo");
  const bg = page.querySelector(".person-hero-bg");
  const bio = page.querySelector(".person-bio");
  const bioToggle = page.querySelector(".person-bio-toggle");
  page.querySelector(".person-heading").textContent = person.name || "Cast member";
  page.querySelector(".person-kicker").textContent = "";
  page.querySelector(".person-meta").textContent = "";
  bio.textContent = ""; bio.classList.remove("expanded"); bioToggle.hidden = true; bioToggle.textContent = "Read more";
  filters.replaceChildren();
  const initial = (person.name || "?").trim().charAt(0).toUpperCase();
  const setPhoto = (path) => {
    photo.style.backgroundImage = path ? `url("https://image.tmdb.org/t/p/w342${path}")` : "none";
    photo.textContent = path ? "" : initial;
    bg.style.backgroundImage = path ? `url("https://image.tmdb.org/t/p/w342${path}")` : "none";
  };
  setPhoto(person.photo || "");
  const loading = document.createElement("p");
  loading.className = "person-note"; loading.textContent = "Loading titles…";
  content.replaceChildren(loading);
  page.scrollTop = 0;
  if (!page.open) page.showModal();

  const k = encodeURIComponent(key);
  const getJson = async (path) => {
    const response = await fetch(`https://api.themoviedb.org/3/${path}${path.includes("?") ? "&" : "?"}api_key=${k}&language=en-US`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error("TMDB rejected the saved API key. Check that it is your TMDB v3 API key (not your account password or a v4 read-access token), then save it again in Vora.");
      if (response.status === 404) throw new Error("TMDB could not find this cast member. Refresh the title's cast data and try again.");
      if (response.status === 429) throw new Error("TMDB rate limit reached. Please wait a moment and try again.");
      throw new Error(`${data?.status_message || "Could not load filmography."} (HTTP ${response.status})`);
    }
    return data;
  };
  try {
    const [details, credits] = await Promise.all([
      getJson(`person/${personId}`).catch(() => ({})),
      getJson(`person/${personId}/combined_credits`),
    ]);
    if (!page.open) return;

    // Header details
    if (details.profile_path) setPhoto(details.profile_path);
    page.querySelector(".person-kicker").textContent = details.known_for_department || "";
    const bits = [];
    if (details.birthday) bits.push(`Born ${details.birthday.slice(0, 4)}${details.place_of_birth ? " · " + details.place_of_birth : ""}`);
    else if (details.place_of_birth) bits.push(details.place_of_birth);
    page.querySelector(".person-meta").textContent = bits.join("");
    if (details.biography) {
      bio.textContent = details.biography.trim();
      bioToggle.hidden = details.biography.length < 260;
    }

    // Filmography: acting credits plus a few key crew roles, one entry per title.
    const merged = new Map();
    const add = (c, role) => {
      if (!c || !(c.title || c.name) || (c.media_type !== "movie" && c.media_type !== "tv")) return;
      if ((c.genre_ids || []).some((g) => PERSON_SKIP_GENRES.has(g))) return;
      const idKey = `${c.media_type}|${c.id}`;
      const entry = merged.get(idKey) || { ...c, roles: [] };
      if (role && !entry.roles.includes(role)) entry.roles.push(role);
      merged.set(idKey, entry);
    };
    for (const c of (credits.cast || [])) add(c, c.character && !/^(self|himself|herself)\b/i.test(c.character) ? c.character : "");
    for (const c of (credits.crew || [])) if (PERSON_CREW_JOBS.has(c.job)) add(c, c.job);
    const all = [...merged.values()].map((c) => {
      const type = c.media_type === "tv" ? "show" : "movie";
      return { credit: c, type, local: findLibraryMatch(c, type), date: String(c.release_date || c.first_air_date || "") };
    });
    if (!all.length) { const none = document.createElement("p"); none.className = "person-note"; none.textContent = "No titles found."; content.replaceChildren(none); return; }

    let active = "all";
    const render = () => {
      const list = all.filter((x) => active === "all" || x.type === active);
      const mine = list.filter((x) => x.local).sort((a, b) => b.date.localeCompare(a.date));
      const rest = list.filter((x) => !x.local).sort((a, b) => (b.credit.popularity || 0) - (a.credit.popularity || 0)).slice(0, 60);
      const sections = [];
      const section = (title, count, cards) => {
        const wrap = document.createElement("section");
        wrap.className = "person-section";
        const h = document.createElement("h3");
        h.innerHTML = `<span></span><small></small>`;
        h.firstChild.textContent = title; h.lastChild.textContent = count;
        const grid = document.createElement("div");
        grid.className = "person-grid";
        grid.append(...cards);
        wrap.append(h, grid);
        return wrap;
      };
      if (mine.length) {
        sections.push(section("In your library", String(mine.length), mine.map((x) => {
          const card = createCard(x.local);
          // Close this page first so the title opens on top of the one underneath.
          card.addEventListener("click", () => page.close(), true);
          return card;
        })));
      }
      if (rest.length) {
        sections.push(section("Not available", String(rest.length), rest.map((x) => {
          const card = createExternalCard(x.credit, x.type, x.credit.roles?.join(", ") || "");
          card.addEventListener("click", () => page.close(), true);
          return card;
        })));
      }
      if (!sections.length) { const none = document.createElement("p"); none.className = "person-note"; none.textContent = "Nothing to show here."; sections.push(none); }
      content.replaceChildren(...sections);
    };
    const chip = (id, label, count) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "person-chip" + (id === active ? " active" : "");
      b.textContent = `${label} · ${count}`;
      b.addEventListener("click", () => {
        active = id;
        filters.querySelectorAll(".person-chip").forEach((c) => c.classList.toggle("active", c === b));
        render();
      });
      return b;
    };
    const movies = all.filter((x) => x.type === "movie").length;
    const shows = all.filter((x) => x.type === "show").length;
    filters.replaceChildren(chip("all", "All", all.length), ...(movies ? [chip("movie", "Movies", movies)] : []), ...(shows ? [chip("show", "Shows", shows)] : []));
    render();
  } catch (error) {
    const note = document.createElement("p");
    note.className = "person-note";
    note.textContent = error.message || "Could not load titles.";
    content.replaceChildren(note);
  }
}

function renderCast(item) {
  const section = document.querySelector("#cast-section");
  const row = document.querySelector("#cast-row");
  row.replaceChildren();
  if (!getTmdbKey() && !(item.cast && item.cast.length)) {
    section.hidden = false;
    const note = document.createElement("p");
    note.className = "cast-note";
    note.textContent = "Add a TMDB API key in the menu to see the cast.";
    row.append(note);
    return;
  }
  if (!item.cast || !item.cast.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const person of item.cast) {
    const card = document.createElement("div");
    card.className = "cast-member";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `View titles featuring ${person.name}`);
    card.addEventListener("click", () => openPersonPage(person));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPersonPage(person); } });
    const photo = document.createElement("div");
    photo.className = "cast-photo";
    if (person.photo) photo.style.backgroundImage = `url("https://image.tmdb.org/t/p/w185${person.photo}")`;
    else photo.textContent = (person.name || "?").trim().charAt(0).toUpperCase();
    const name = document.createElement("div");
    name.className = "cast-name";
    name.textContent = person.name;
    card.append(photo, name);
    if (person.character) {
      const role = document.createElement("div");
      role.className = "cast-role";
      role.textContent = person.character;
      card.append(role);
    }
    row.append(card);
  }
}

async function loadCast(item) {
  const key = getTmdbKey();
  const castHasIds = Array.isArray(item.cast) && item.cast.length > 0 && item.cast.every(person => Number.isInteger(Number(person?.id)) && Number(person.id) > 0);
  if (!key || (castHasIds && Date.now() - item.castAt < TMDB_CACHE_TTL_MS)) return;
  const api = (path, params = "") =>
    fetch(`https://api.themoviedb.org/3/${path}?api_key=${encodeURIComponent(key)}${params}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  try {
    const kind = item.type === "show" ? "tv" : "movie";
    if (!item.tmdbId) {
      const found = (await api(`search/${kind}`, `&query=${encodeURIComponent(item.title)}&include_adult=false`)).results?.[0];
      if (!found) return;
      item.tmdbId = found.id;
    }
    const credits = await api(`${kind}/${item.tmdbId}/credits`);
    item.cast = (credits.cast || []).slice(0, 15).map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character || "",
      photo: c.profile_path || "",
    }));
    item.castAt = Date.now();
    if (!item.externalRecommendation) await saveRecord(item); // titles outside your library are never saved
    if (dialogItem === item) renderCast(item);
  } catch (error) {
    console.warn("TMDB cast failed:", error);
  }
}

const BTN_ICONS = {"plus": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 5v14M5 12h14\"/></svg>", "check": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m5 12.5 4.5 4.5L19 7\"/></svg>", "up": "<svg class=\"fillable\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3\"/></svg>", "down": "<svg class=\"fillable\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17\"/></svg>", "play": "<svg class=\"solid\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z\"/></svg>", "stop": "<svg class=\"solid\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"/></svg>", "ext": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3\"/></svg>"};
function setIconButton(button, icon, label) {
  button.innerHTML = BTN_ICONS[icon];
  button.setAttribute("aria-label", label);
  button.title = label;
}

function syncTasteButtons(item) {
  const watch = document.querySelector("#dialog-watchlist");
  const like = document.querySelector("#dialog-like");
  const dislike = document.querySelector("#dialog-dislike");
  setIconButton(watch, item.watchlist ? "check" : "plus", item.watchlist ? "Remove from watchlist" : "Add to watchlist");
  watch.setAttribute("aria-pressed", String(!!item.watchlist));
  setIconButton(like, "up", item.reaction === "like" ? "Liked (click to clear)" : "Like");
  like.setAttribute("aria-pressed", String(item.reaction === "like"));
  setIconButton(dislike, "down", item.reaction === "dislike" ? "Disliked (click to clear)" : "Dislike");
  dislike.setAttribute("aria-pressed", String(item.reaction === "dislike"));
}
async function toggleTitleFlag(item, flag) {
  const previous = !!item[flag]; item[flag] = !previous;
  try { await saveRecord(item); } catch(e) { item[flag] = previous; showToast(e.message || "Could not update title."); return; }
  syncTasteButtons(item); renderShelves(); showToast(item[flag] ? "Added to your watchlist" : "Removed from your watchlist");
}
async function setReaction(item, reaction) {
  const previous = item.reaction || ""; item.reaction = reaction;
  try { await saveRecord(item); } catch(e) { item.reaction = previous; showToast(e.message || "Could not save your feedback."); return; }
  syncTasteButtons(item); renderShelves(); showToast(reaction === "like" ? "Got it — recommendations will learn from this" : reaction === "dislike" ? "Got it — we’ll avoid this in recommendations" : "Feedback cleared");
}
// ---- Related titles (in your library and not) --------------------------------
const relatedCache = new Map();

async function fetchRelated(item) {
  const key = getTmdbKey();
  if (!key) return [];
  const kind = item.type === "show" ? "tv" : "movie";
  const k = encodeURIComponent(key);
  let id = item.tmdbId;
  if (!id) {
    const search = await fetch(`https://api.themoviedb.org/3/search/${kind}?api_key=${k}&query=${encodeURIComponent(item.title)}&include_adult=false`).then(r => r.json());
    id = search.results?.[0]?.id;
  }
  if (!id) return [];
  const cacheKey = `${kind}:${id}`;
  if (relatedCache.has(cacheKey)) return relatedCache.get(cacheKey);
  const get = (path) => fetch(`https://api.themoviedb.org/3/${kind}/${id}/${path}?api_key=${k}&language=en-US&page=1`)
    .then(r => (r.ok ? r.json() : { results: [] })).catch(() => ({ results: [] }));
  const [recs, similar] = await Promise.all([get("recommendations"), get("similar")]);
  const seen = new Set([Number(id)]);
  const out = [];
  for (const rec of [...(recs.results || []), ...(similar.results || [])]) {
    if (!rec || seen.has(rec.id) || !(rec.title || rec.name)) continue;
    seen.add(rec.id);
    out.push(rec);
  }
  relatedCache.set(cacheKey, out);
  return out;
}

function findLibraryMatch(rec, type) {
  const name = String(rec.title || rec.name || "").toLowerCase();
  return customTitles.find(t => t.type === type && (Number(t.tmdbId) === Number(rec.id) || String(t.title || "").toLowerCase() === name));
}

function createExternalCard(rec, type, tagText = "") {
  const title = rec.title || rec.name || "Untitled";
  const card = document.createElement("article");
  card.className = "title-card recommendation-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${title} (not available). Open details.`);
  const img = document.createElement("img");
  img.className = "card-image"; img.loading = "lazy"; img.alt = "";
  if (rec.poster_path) img.src = `https://image.tmdb.org/t/p/w342${rec.poster_path}`; else card.classList.add("no-art");
  card.append(img);
  const ribbon = document.createElement("span");
  ribbon.className = "unavailable-ribbon"; ribbon.textContent = "Not Available";
  card.append(ribbon);
  const copy = document.createElement("span");
  copy.className = "card-copy";
  const genres = (rec.genre_ids || []).slice(0, 2).map(id => (TMDB_MOVIE_GENRES[id] || TMDB_TV_GENRES[id] || "")).filter(Boolean).join(" · ");
  for (const [cls, txt] of [["card-title", title], ["card-year", (rec.release_date || rec.first_air_date || "").slice(0, 4)], ["card-tag", tagText || genres]]) {
    const el = document.createElement("span"); el.className = cls; el.textContent = txt; copy.append(el);
  }
  card.append(copy);
  const open = () => openExternalRecommendation(rec, type);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  return card;
}

async function loadRelated(item) {
  const section = document.querySelector("#related-section");
  const row = document.querySelector("#related-row");
  section.hidden = true;
  row.replaceChildren();
  if (!getTmdbKey()) return;
  let recs = [];
  try { recs = await fetchRelated(item); } catch (e) { console.warn("TMDB related failed:", e); }
  if (dialogItem !== item || !recs.length) return;
  const own = String(item.title || "").toLowerCase();
  const available = [];
  const missing = [];
  for (const rec of recs) {
    if (String(rec.title || rec.name || "").toLowerCase() === own) continue;
    const local = findLibraryMatch(rec, item.type);
    if (local) { if (!available.includes(local)) available.push(local); }
    else missing.push(rec);
  }
  const cards = [
    ...available.map(createCard),               // titles you have come first
    ...missing.map(rec => createExternalCard(rec, item.type)),
  ].slice(0, 24);
  if (!cards.length) return;
  row.replaceChildren(...cards);
  section.hidden = false;
}

// ---- Trailer in the hero banner ---------------------------------------------
const trailerCache = new Map();
const trailerStage = document.querySelector("#trailer-stage");
const trailerArt = document.querySelector("#dialog-art");
const trailerMute = document.querySelector("#trailer-mute");
const trailerButton = document.querySelector("#dialog-trailer");
let trailerFrame = null;
let trailerMuted = true;
let trailerToken = 0;
let trailerFallbackTimer = 0;
let trailerQueue = [];
let trailerQueueItem = null;

// Returns a ranked list of YouTube video keys (official trailers first), so that
// if one can't be embedded we can try the next.
async function findTrailerKeys(item) {
  const cacheKey = item.id || item.title;
  if (trailerCache.has(cacheKey)) return trailerCache.get(cacheKey);
  const key = getTmdbKey();
  if (!key) { showToast("Add your TMDB API key in the menu to find trailers."); return []; }
  const kind = item.type === "show" ? "tv" : "movie";
  const k = encodeURIComponent(key);
  let id = item.tmdbId;
  if (!id) {
    const search = await fetch(`https://api.themoviedb.org/3/${"search/" + kind}?api_key=${k}&query=${encodeURIComponent(item.title)}&include_adult=false`).then(r => r.json());
    id = search.results?.[0]?.id;
  }
  if (!id) { showToast("Could not find this title on TMDB."); return []; }
  const base = `https://api.themoviedb.org/3/${kind}/${id}/videos?api_key=${k}`;
  // English first, then any language (many non-English titles only have local trailers).
  let videos = (await fetch(`${base}&language=en-US`).then(r => r.json())).results || [];
  if (!videos.some(v => v.site === "YouTube")) {
    videos = (await fetch(`${base}&include_video_language=en,null,sv,no,da,fi,de,fr,es,it,pt,nl,ja,ko,hi,tr,pl,ru`).then(r => r.json())).results || [];
  }
  const rank = (v) => (v.type === "Trailer" ? 0 : v.type === "Teaser" ? 2 : 4) + (v.official ? 0 : 1);
  const keys = videos.filter(v => v.site === "YouTube" && v.key).sort((x, y) => rank(x) - rank(y)).map(v => v.key);
  if (keys.length) trailerCache.set(cacheKey, keys);
  return keys;
}

function setTrailerButton(state, key = "") {
  if (!trailerButton) return;
  if (state === "playing") setIconButton(trailerButton, "stop", "Stop trailer");
  else if (state === "loading") setIconButton(trailerButton, "play", "Loading trailer…");
  else if (state === "fallback") setIconButton(trailerButton, "ext", "Open trailer on YouTube");
  else setIconButton(trailerButton, "play", "Watch trailer");
  trailerButton.setAttribute("aria-pressed", String(state === "playing"));
  trailerButton.disabled = state === "loading";
  if (state === "fallback") trailerButton.dataset.fallback = key; else delete trailerButton.dataset.fallback;
}

function trailerCommand(func, args = []) {
  try { trailerFrame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*"); } catch (e) { /* ignore */ }
}

function syncTrailerMute() {
  trailerMute.setAttribute("aria-pressed", String(trailerMuted));
  trailerMute.setAttribute("aria-label", trailerMuted ? "Unmute trailer" : "Mute trailer");
}

function stopTrailer() {
  trailerToken++;
  clearTimeout(trailerFallbackTimer);
  if (trailerFrame) { trailerFrame.remove(); trailerFrame = null; }
  trailerStage?.classList.remove("playing");
  trailerArt?.classList.remove("is-trailer");
  dialog.classList.remove("trailer-playing");
  if (trailerMute) trailerMute.hidden = true;
  setTrailerButton("idle");
}

function openTrailerOnYouTube(videoKey) {
  window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(videoKey)}`, "_blank", "noopener,noreferrer");
}

function mountTrailerFrame(item, videoKey) {
  const params = new URLSearchParams({
    autoplay: "1", mute: "1", controls: "0", rel: "0", modestbranding: "1", playsinline: "1",
    iv_load_policy: "3", disablekb: "1", fs: "0", enablejsapi: "1", loop: "0",
  });
  if (location.protocol.startsWith("http")) params.set("origin", location.origin);
  const frame = document.createElement("iframe");
  frame.src = `https://www.youtube.com/embed/${encodeURIComponent(videoKey)}?${params}`;
  frame.allow = "autoplay; encrypted-media; picture-in-picture";
  frame.title = `${item.title} trailer`;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.addEventListener("load", () => {
    // Ask YouTube to report player events (playing / ended / error) back to us.
    try { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1 }), "*"); } catch (e) { /* ignore */ }
  });
  trailerStage.classList.remove("playing");
  trailerStage.replaceChildren(frame);
  trailerFrame = frame;
  trailerArt.classList.add("is-trailer");
  dialog.classList.add("trailer-playing");
  trailerMute.hidden = false;
  setTrailerButton("playing");
  clearTimeout(trailerFallbackTimer);
  // Fade the video in once it reports "playing"; fall back after a few seconds in case it doesn't.
  trailerFallbackTimer = setTimeout(() => { if (trailerFrame === frame) trailerStage.classList.add("playing"); }, 4000);
}

// Called when the current video can't be embedded: try the next one, else explain why.
function trailerFailed(code) {
  const item = trailerQueueItem;
  if (trailerFrame) { trailerFrame.remove(); trailerFrame = null; }
  trailerStage.classList.remove("playing");
  if (trailerQueue.length && item && dialogItem === item) {
    mountTrailerFrame(item, trailerQueue.shift());
    return;
  }
  const first = trailerCache.get(item?.id || item?.title)?.[0] || "";
  stopTrailer();
  const reason = code === 153 || code === "153"
    ? "YouTube blocked the embedded player (error 153) — this usually means the page isn’t served over http(s)."
    : "These trailers don’t allow embedding on other sites.";
  showToast(reason);
  if (first) setTrailerButton("fallback", first);
}

async function playTrailerInHero(item) {
  if (trailerButton.dataset.fallback) { openTrailerOnYouTube(trailerButton.dataset.fallback); return; }
  if (trailerFrame) { stopTrailer(); return; }
  const token = ++trailerToken;
  setTrailerButton("loading");
  let keys = [];
  try { keys = await findTrailerKeys(item); }
  catch (e) { showToast("Could not load the trailer from TMDB."); }
  if (token !== trailerToken || dialogItem !== item) return; // closed or switched while loading
  if (!keys.length) { setTrailerButton("idle"); if (getTmdbKey()) showToast("No trailer was found for this title."); return; }

  // YouTube can't verify a page opened straight from disk (file://) and shows "Error 153".
  if (location.protocol === "file:") {
    setTrailerButton("fallback", keys[0]);
    showToast("Trailers can’t play inside the banner when Vora is opened as a local file. Host it online or run it from localhost.");
    return;
  }

  trailerMuted = true; syncTrailerMute();
  trailerQueue = keys.slice(1, 4);
  trailerQueueItem = item;
  mountTrailerFrame(item, keys[0]);
  dialog.scrollTo({ top: 0, behavior: "smooth" });
}

window.addEventListener("message", (event) => {
  if (!trailerFrame || event.source !== trailerFrame.contentWindow) return;
  let data = event.data;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { return; } }
  if (!data || typeof data !== "object") return;
  if (data.event === "onStateChange" || (data.event === "infoDelivery" && data.info && typeof data.info.playerState === "number")) {
    const state = data.event === "onStateChange" ? data.info : data.info.playerState;
    if (state === 1) trailerStage.classList.add("playing");
    if (state === 0) stopTrailer(); // trailer finished: back to the banner
  }
  if (data.event === "onError") trailerFailed(Number(data.info));
});

trailerMute.addEventListener("click", () => {
  trailerMuted = !trailerMuted;
  trailerCommand(trailerMuted ? "mute" : "unMute");
  if (!trailerMuted) trailerCommand("setVolume", [100]);
  syncTrailerMute();
});

function openTitleDialog(item) {
  stopTrailer();
  dialogItem = item;
  resetRemoveConfirm();
  closeDialogEpisodeForm();
  const episodeList = document.querySelector("#episode-list");
  const watchButton = document.querySelector("#dialog-watch");
  removeButton.hidden = !!item.externalRecommendation;

  const dialogArt = item.banner || posterUrl(item, "w780");
  dialog.querySelector(".dialog-art").style.backgroundImage = dialogArt ? `url("${dialogArt}")` : "none";
  document.querySelector("#dialog-title").textContent = item.title;
  renderDialogMeta(item);
  updateFavoriteButton(item);
  syncTasteButtons(item);
  document.querySelector("#dialog-description").textContent = item.description;
  document.querySelector("#dialog-watchlist").onclick = () => toggleTitleFlag(item, "watchlist");
  document.querySelector("#dialog-like").onclick = () => setReaction(item, item.reaction === "like" ? "" : "like");
  document.querySelector("#dialog-dislike").onclick = () => setReaction(item, item.reaction === "dislike" ? "" : "dislike");
  document.querySelector("#dialog-trailer").onclick = () => playTrailerInHero(item);
  document.querySelector("#dialog-watchlist").hidden = !!item.externalRecommendation;
  document.querySelector("#dialog-like").hidden = !!item.externalRecommendation;
  document.querySelector("#dialog-dislike").hidden = !!item.externalRecommendation;

  if (item.type === "show") {
    toggleAddEpisodeButton.hidden = false;
    episodeList.hidden = false;
    document.querySelector("#season-select").replaceChildren();
    refreshEpisodeList(item);
  } else {
    watchButton.hidden = !String(item.driveUrl || "").trim();
    setWatchLabel(watchButton, "Play");
    watchButton.onclick = () => {
      if (!String(item.driveUrl || "").trim()) return;
      openMediaLink(resolveWatchUrl(item.driveUrl), item.title, item);
    };
    toggleAddEpisodeButton.hidden = true;
    document.querySelector("#season-bar").hidden = true;
    episodeList.hidden = true;
    episodeList.replaceChildren();
  }
  renderCast(item);
  dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  loadRelated(item);
  if (!item.externalRecommendation) { loadTmdbDetails(item); loadCast(item); }
  else { renderCast(item); loadCast(item); }
}

document.querySelector("#season-select").addEventListener("change", () => {
  if (dialogItem) refreshEpisodeList(dialogItem);
});

function openAddDialog() {
  movieForm.reset();
  formError.textContent = "";
  clearBannerPreview();
  episodeFormList.replaceChildren();
  addEpisodeRow();
  updateTypeFields();
  addDialog.showModal();
  document.querySelector("#movie-name").focus();
}

document
  .querySelector("#open-add-movie")
  .addEventListener("click", openAddDialog);
document
  .querySelectorAll("[data-open-add]")
  .forEach((button) => button.addEventListener("click", openAddDialog));
document
  .querySelector("#cancel-add-movie")
  .addEventListener("click", () => addDialog.close());
addDialog
  .querySelector(".dialog-close")
  .addEventListener("click", () => addDialog.close());
addDialog.addEventListener("click", (event) => {
  if (event.target === addDialog) addDialog.close();
});

dialog
  .querySelector(".dialog-close")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("close", () => {
  stopTrailer();
  dialogItem = null;
  resetRemoveConfirm();
  closeDialogEpisodeForm();
});

removeButton.addEventListener("click", () => {
  if (!dialogItem) return;
  removeConfirmText.textContent = `Remove “${dialogItem.title}” from your library? This can’t be undone.`;
  removeButton.hidden = true;
  removeConfirm.hidden = false;
  cancelRemoveButton.focus();
});

cancelRemoveButton.addEventListener("click", () => {
  resetRemoveConfirm();
  removeButton.focus();
});

confirmRemoveButton.addEventListener("click", async () => {
  if (!dialogItem) return;
  const item = dialogItem;
  removeError.textContent = "";
  confirmRemoveButton.disabled = true;
  confirmRemoveButton.textContent = "Removing…";
  try {
    await deleteRecord(item.id);
    customTitles = customTitles.filter((entry) => entry.id !== item.id);
    dialog.close();
    renderShelves();
    showToast(`Removed “${item.title}” from Vora`);
  } catch (error) {
    confirmRemoveButton.disabled = false;
    confirmRemoveButton.textContent = "Try again";
    removeError.textContent = error.message || "This title could not be removed.";
  }
});

function closeDialogEpisodeForm() {
  dialogEpisodeForm.hidden = true;
  dialogEpisodeForm.reset();
  dialogEpisodeError.textContent = "";
}

toggleAddEpisodeButton.addEventListener("click", () => {
  if (!dialogItem) return;
  dialogEpisodeError.textContent = "";
  const lastEpisode = dialogItem.episodes[dialogItem.episodes.length - 1];
  const nextSeason = lastEpisode ? lastEpisode.season : 1;
  const seasonEpisodes = dialogItem.episodes.filter(
    (entry) => entry.season === nextSeason,
  );
  const nextNumber = seasonEpisodes.length
    ? Math.max(...seasonEpisodes.map((entry) => entry.episode)) + 1
    : 1;
  document.querySelector("#dialog-episode-season").value = nextSeason;
  document.querySelector("#dialog-episode-index").value = nextNumber;
  document.querySelector("#dialog-episode-title").value = "";
  document.querySelector("#dialog-episode-link").value = "";
  dialogEpisodeForm.hidden = false;
  document.querySelector("#dialog-episode-title").focus();
});

document.querySelector("#cancel-dialog-episode").addEventListener("click", () => {
  closeDialogEpisodeForm();
});

dialogEpisodeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!dialogItem) return;
  dialogEpisodeError.textContent = "";
  if (!dialogEpisodeForm.reportValidity()) return;

  const submitButton = document.querySelector("#submit-dialog-episode");
  submitButton.disabled = true;
  submitButton.textContent = "Adding…";
  try {
    const season = Number(document.querySelector("#dialog-episode-season").value);
    const episodeNumber = Number(
      document.querySelector("#dialog-episode-index").value,
    );
    const title = document.querySelector("#dialog-episode-title").value.trim();
    if (!title) throw new Error("Give the episode a title.");
    const driveUrl = mediaLinkUrl(
      document.querySelector("#dialog-episode-link").value.trim(),
    );
    if (
      dialogItem.episodes.some(
        (entry) => entry.season === season && entry.episode === episodeNumber,
      )
    ) {
      throw new Error(`Season ${season}, Episode ${episodeNumber} already exists.`);
    }

    const newEpisode = { season, episode: episodeNumber, title, driveUrl };
    const previousEpisodes = dialogItem.episodes;
    dialogItem.episodes = sortEpisodes([...dialogItem.episodes, newEpisode]);
    try {
      await saveRecord(dialogItem);
    } catch (error) {
      dialogItem.episodes = previousEpisodes;
      throw error;
    }

    refreshEpisodeList(dialogItem);
    renderShelves();
    closeDialogEpisodeForm();
    showToast(`Added “${title}”`);
  } catch (error) {
    dialogEpisodeError.textContent =
      error.message || "Could not add that episode.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Add episode";
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-direction]");
  if (!button) return;
  const row = document.getElementById(button.dataset.target);
  if (row)
    row.scrollBy({
      left: row.clientWidth * Number(button.dataset.direction) * 0.82,
      behavior: "smooth",
    });
});

document.querySelector("#hero-action").addEventListener("click", () => {
  if (!featuredTitle) {
    openAddDialog();
  } else if (featuredTitle.type === "show") {
    openTitleDialog(featuredTitle);
  } else {
    openMediaLink(resolveWatchUrl(featuredTitle.driveUrl), featuredTitle.title, featuredTitle);
  }
});

document.querySelector("#hero-info").addEventListener("click", () => {
  if (featuredTitle) openTitleDialog(featuredTitle);
});
document.querySelector("#hero-poster").addEventListener("click", () => {
  if (featuredTitle) openTitleDialog(featuredTitle);
});

document.querySelectorAll(".nav-link[data-chip]").forEach((chip) => {
  chip.addEventListener("click", () => {
    setFilter(chip.dataset.chip);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

const topbar = document.querySelector("#topbar");
function syncTopbar() {
  topbar.classList.toggle("scrolled", window.scrollY > 24);
}
window.addEventListener("scroll", syncTopbar, { passive: true });
syncTopbar();

document.querySelector("#search-toggle").addEventListener("click", () => {
  const box = document.querySelector("#search-form");
  box.classList.toggle("open");
  if (box.classList.contains("open")) {
    searchInput.focus();
  } else {
    searchInput.value = "";
    applySearch();
  }
});
document
  .querySelector("#search-form")
  .addEventListener("submit", (event) => event.preventDefault());
let searchTimer = 0;
searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(applySearch, 120); });

function updateTypeFields() {
  const type = movieForm.querySelector('input[name="titleType"]:checked').value;
  const isShow = type === "show";
  document.querySelector("#movie-drive-field").hidden = isShow;
  movieDriveInput.required = !isShow;
  document.querySelector("#episodes-section").hidden = !isShow;
  episodeFormList.querySelectorAll("input").forEach((input) => {
    input.disabled = !isShow;
  });
  document.querySelector("#submit-movie").innerHTML =
    `${isShow ? "Add show" : "Add movie"} <span aria-hidden="true">↗</span>`;
}

movieForm.querySelectorAll('input[name="titleType"]').forEach((radio) => {
  radio.addEventListener("change", updateTypeFields);
});

function createEpisodeField(labelText, className, type, value, placeholder) {
  const label = document.createElement("label");
  label.className = "episode-input-label";
  label.append(document.createTextNode(labelText));
  const input = document.createElement("input");
  input.className = `form-control ${className}`;
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  input.required = true;
  if (type === "number") {
    input.min = "1";
    input.max = "999";
  }
  label.append(input);
  return label;
}

function updateEpisodeRemoveButtons() {
  const rows = [...episodeFormList.querySelectorAll(".episode-form-card")];
  rows.forEach((row) => {
    row.querySelector(".remove-episode").disabled = rows.length === 1;
  });
}

function addEpisodeRow(episode = {}) {
  const row = document.createElement("div");
  row.className = "episode-form-card";
  const top = document.createElement("div");
  top.className = "episode-form-card-heading";
  const label = document.createElement("strong");
  label.textContent = `Episode ${episodeFormList.children.length + 1}`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-episode";
  remove.setAttribute("aria-label", "Remove episode");
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    row.remove();
    [...episodeFormList.children].forEach((element, index) => {
      element.querySelector(".episode-form-card-heading strong").textContent =
        `Episode ${index + 1}`;
    });
    updateEpisodeRemoveButtons();
  });
  top.append(label, remove);

  const numbers = document.createElement("div");
  numbers.className = "episode-number-fields";
  numbers.append(
    createEpisodeField(
      "Season",
      "episode-season",
      "number",
      episode.season || 1,
      "1",
    ),
    createEpisodeField(
      "Episode number",
      "episode-index",
      "number",
      episode.episode || episodeFormList.children.length + 1,
      "1",
    ),
  );
  row.append(
    top,
    numbers,
    createEpisodeField(
      "Episode title",
      "episode-title",
      "text",
      episode.title || "",
      "e.g. The first night",
    ),
    createEpisodeField(
      "Episode watch link",
      "episode-link",
      "text",
      episode.driveUrl || "",
      "https://example.com/video-or-page",
    ),
  );
  episodeFormList.append(row);
  updateEpisodeRemoveButtons();
}

document
  .querySelector("#add-episode")
  .addEventListener("click", () => addEpisodeRow());

function clearBannerPreview() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = "";
  bannerPreviewImage.removeAttribute("src");
  bannerPreview.hidden = true;
  document.querySelector("#upload-file-name").textContent =
    "JPG, PNG, or WebP · max 8 MB";
}

function updateBannerPreview(source, filename = "") {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = source.startsWith("blob:") ? source : "";
  bannerPreviewImage.src = source;
  bannerPreview.hidden = false;
  if (filename)
    document.querySelector("#upload-file-name").textContent = filename;
}

const validBannerTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
bannerFileInput.addEventListener("change", () => {
  const file = bannerFileInput.files[0];
  if (!file) return;
  if (!validBannerTypes.includes(file.type) || file.size > 8 * 1024 * 1024) {
    formError.textContent =
      "Choose a JPG, PNG, or WebP image smaller than 8 MB.";
    bannerFileInput.value = "";
    return;
  }
  formError.textContent = "";
  updateBannerPreview(URL.createObjectURL(file), file.name);
});

bannerUrlInput.addEventListener("input", () => {
  if (bannerFileInput.files.length) return;
  const value = bannerUrlInput.value.trim();
  if (!value) {
    clearBannerPreview();
    return;
  }
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol))
      updateBannerPreview(url.href);
  } catch {
    clearBannerPreview();
  }
});

document.querySelector("#remove-banner").addEventListener("click", () => {
  bannerFileInput.value = "";
  bannerUrlInput.value = "";
  clearBannerPreview();
});

function openTitleDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support local title storage."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not open Vora storage."));
  });
}

function readAllRecords() {
  return new Promise((resolve, reject) => {
    const request = titleDB
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not read Vora titles."));
  });
}

const AUTO_BACKUP_KEY = "vora-automatic-library-backup";
function scheduleCloudBackup() { /* cloud state backup removed: only the CSV is ever uploaded */ }
function writeAutomaticBackup() {
  if (typeof settings !== "undefined" && settings.autoBackup === false) return;
  try {
    const titles = customTitles.map((item) => ({ ...item, episodes: Array.isArray(item.episodes) ? item.episodes.map((e) => ({...e})) : [] }));
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), titles }));
  } catch (error) { console.warn("Vora automatic backup could not be written:", error); }
  scheduleCloudBackup();
}

function saveRecord(record) {
  return new Promise((resolve, reject) => {
    if (!titleDB) {
      writeAutomaticBackup();
      resolve();
      return;
    }
    const transaction = titleDB.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => { writeAutomaticBackup(); resolve(); };
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not save this title."));
    transaction.onabort = () =>
      reject(
        transaction.error || new Error("Vora storage is full or unavailable."),
      );
  });
}

function deleteRecord(id) {
  return new Promise((resolve, reject) => {
    if (!titleDB) {
      resolve();
      return;
    }
    const transaction = titleDB.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not remove this title."));
    transaction.onabort = () =>
      reject(
        transaction.error || new Error("Vora storage is unavailable."),
      );
  });
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(new Error("The banner image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function fileAsBannerDataUrl(file) {
  const original = await fileAsDataUrl(file);
  if (file.type === "image/gif") return original;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / bitmap.width);
    if (scale === 1 && file.size < 300 * 1024) return original;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#0d192b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const resized = canvas.toDataURL("image/jpeg", 0.85);
    return resized.length < original.length ? resized : original;
  } catch {
    return original;
  }
}

function normalizeRecord(record) {
  const genres = Array.isArray(record.genres)
    ? record.genres
    : record.genre
      ? [record.genre]
      : ["Other"];
  const type = record.type === "show" ? "show" : "movie";
  let driveUrl = "";
  try {
    if (record.driveUrl) driveUrl = mediaLinkUrl(record.driveUrl);
  } catch {
    driveUrl = "";
  }
  const episodes =
    type === "show" && Array.isArray(record.episodes)
      ? sortEpisodes(
          record.episodes.map((episode) => {
            let episodeLink = "";
            try {
              episodeLink = mediaLinkUrl(episode.driveUrl || episode.url || "");
            } catch {
              episodeLink = "";
            }
            return {
              season: Number(episode.season) || 1,
              episode: Number(episode.episode) || 1,
              title: episode.title || "Episode",
              driveUrl: episodeLink,
              still: episode.still || "",
              progressSeconds: Number(episode.progressSeconds) || 0,
              durationSeconds: Number(episode.durationSeconds) || 0,
              lastPlayedAt: Number(episode.lastPlayedAt) || 0,
            };
          }),
        )
      : [];
  return {
    id: record.id || createId(),
    type,
    title: record.title || "Untitled",
    genres: [...new Set(genres.filter(Boolean))].slice(0, 2),
    description: record.description || "",
    banner: record.banner || "",
    poster: record.poster || "",
    posterAt: Number(record.posterAt) || 0,
    driveUrl,
    episodes,
    year: record.year || "",
    rating: record.rating || "",
    cert: record.cert || "",
    detailsAt: record.detailsAt || 0,
    lastPlayedAt: Number(record.lastPlayedAt) || 0,
    progressSeconds: Number(record.progressSeconds) || 0,
    durationSeconds: Number(record.durationSeconds) || 0,
    favorite: !!record.favorite,
    watchlist: !!record.watchlist,
    reaction: record.reaction === "like" || record.reaction === "dislike" ? record.reaction : "",
    tmdbId: record.tmdbId || 0,
    cast: Array.isArray(record.cast) ? record.cast : null,
    castAt: record.castAt || 0,
    createdAt: record.createdAt || new Date().toISOString(),
  };
}

function toCardItem(record) {
  return {
    ...record,
    genres: record.genres.length ? record.genres : ["Other"],
  };
}

movieForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";
  if (!movieForm.reportValidity()) return;

  const submitButton = document.querySelector("#submit-movie");
  submitButton.disabled = true;
  submitButton.textContent = "Saving…";
  try {
    const type = movieForm.querySelector(
      'input[name="titleType"]:checked',
    ).value;
    const title = document.querySelector("#movie-name").value.trim();
    const firstGenre = document.querySelector("#movie-genre").value;
    const secondGenre = document.querySelector("#movie-genre-two").value;
    const genres = [firstGenre, secondGenre].filter(Boolean);
    if (secondGenre && secondGenre === firstGenre) {
      throw new Error("Choose a different second genre, or leave it empty.");
    }
    if (
      customTitles.some(
        (item) => item.title.toLowerCase() === title.toLowerCase(),
      )
    ) {
      throw new Error("You already added a title with that name.");
    }

    const file = bannerFileInput.files[0];
    const bannerUrl = bannerUrlInput.value.trim();
    if (!file && !bannerUrl)
      throw new Error("Add a banner image URL or choose an image file.");
    let banner;
    if (file) {
      if (
        !validBannerTypes.includes(file.type) ||
        file.size > 8 * 1024 * 1024
      ) {
        throw new Error("Choose a JPG, PNG, or WebP image smaller than 8 MB.");
      }
      banner = await fileAsBannerDataUrl(file);
    } else {
      const parsedBannerUrl = new URL(bannerUrl);
      if (!["https:", "http:"].includes(parsedBannerUrl.protocol)) {
        throw new Error("Use an http or https banner URL.");
      }
      banner = parsedBannerUrl.href;
    }

    const episodes =
      type === "show"
        ? sortEpisodes(
            [...episodeFormList.querySelectorAll(".episode-form-card")].map(
              (row) => ({
                season: Number(row.querySelector(".episode-season").value),
                episode: Number(row.querySelector(".episode-index").value),
                title: row.querySelector(".episode-title").value.trim(),
                driveUrl: mediaLinkUrl(
                  row.querySelector(".episode-link").value.trim(),
                ),
              }),
            ),
          )
        : [];
    const movieLink =
      type === "movie" ? mediaLinkUrl(movieDriveInput.value.trim()) : "";
    const record = {
      id: createId(),
      type,
      title,
      genres,
      description: document.querySelector("#movie-description").value.trim(),
      banner,
      driveUrl: movieLink,
      episodes,
      createdAt: new Date().toISOString(),
    };

    await saveRecord(record);
    customTitles.unshift(toCardItem(record));
    renderShelves();
    searchInput.value = "";
    applySearch();
    movieForm.reset();
    clearBannerPreview();
    episodeFormList.replaceChildren();
    updateTypeFields();
    addDialog.close();
    showToast(`${type === "show" ? "Show" : "Movie"} added to Vora`);
    document
      .querySelector(`#genre-${slug(genres[0])}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    formError.textContent = error.message || "This title could not be saved.";
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = `${movieForm.querySelector('input[name="titleType"]:checked').value === "show" ? "Add show" : "Add movie"} <span aria-hidden="true">↗</span>`;
  }
});

function readEmbeddedLibrary() {
  try {
    const data = JSON.parse(document.querySelector("#vora-data").textContent);
    if (data && Array.isArray(data.titles)) {
      return { savedAt: String(data.savedAt || ""), titles: data.titles };
    }
  } catch {
    /* fall through to an empty library */
  }
  return { savedAt: "", titles: [] };
}

function importedSnapshots() {
  try {
    const list = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function rememberSnapshot(savedAt) {
  if (!savedAt) return;
  try {
    const list = importedSnapshots().filter((entry) => entry !== savedAt);
    list.push(savedAt);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* localStorage unavailable */
  }
}

// Adds titles from the file that this browser doesn't have yet.
// Each saved file is merged once, so titles you removed here stay removed.
function mergeEmbeddedTitles(records, embedded) {
  if (!embedded.titles.length) return 0;
  if (embedded.savedAt && importedSnapshots().includes(embedded.savedAt)) return 0;
  const ids = new Set(records.map((record) => record.id));
  const names = new Set(
    records.map((record) => String(record.title || "").toLowerCase()),
  );
  let added = 0;
  for (const record of embedded.titles) {
    if (!record || !record.id || ids.has(record.id)) continue;
    if (names.has(String(record.title || "").toLowerCase())) continue;
    records.push(record);
    ids.add(record.id);
    added++;
  }
  rememberSnapshot(embedded.savedAt);
  return added;
}

function librarySignature(list) {
  return list
    .map((item) => item.id)
    .sort()
    .join("|");
}

function updateSaveState() {
  if (!saveButton) return; // Export library button was removed from the topbar.
  const changed = librarySignature(customTitles) !== savedSignature;
  saveButton.classList.toggle("has-changes", changed);
  saveButton.setAttribute(
    "aria-label",
    changed ? "Export library (unsaved changes)" : "Export library",
  );
}

async function saveLibraryFile() {
  const payload = {
    app: "vora",
    version: 2,
    savedAt: new Date().toISOString(),
    titles: customTitles,
  };
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const dataBlock = new RegExp(
    '(<scr' + 'ipt\\b[^>]*id="vora-data"[^>]*>)[\\s\\S]*?(</scr' + 'ipt>)',
  );

  if (!dataBlock.test(pristineHTML)) {
    showToast("Could not build the file to save.");
    return;
  }

  const html = pristineHTML.replace(
    dataBlock,
    (match, open, close) => open + json + close,
  );
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const filename = "vora.html";

  const markSaved = () => {
    rememberSnapshot(payload.savedAt);
    savedSignature = librarySignature(customTitles);
    updateSaveState();
  };

  // Prefer the File System Access API so the user can choose the exact
  // destination and filename instead of relying on browser download rules.
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Vora HTML file",
            accept: { "text/html": [".html"] },
          },
        ],
        excludeAcceptAllOption: false,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      markSaved();
      showToast("Saved Vora library.");
      return;
    } catch (error) {
      // Canceling the save dialog should not trigger another export path.
      if (error?.name === "AbortError") return;
      // Unsupported/blocked picker: continue to the compatibility fallbacks.
    }
  }

  // Android/Chrome-based wrappers can expose Web Share even when they do not
  // support the native save picker. This keeps export usable in those shells.
  try {
    const file = new File([blob], filename, { type: "text/html" });
    if (
      navigator.share &&
      (!navigator.canShare || navigator.canShare({ files: [file] }))
    ) {
      await navigator.share({
        title: "Vora library",
        text: "Exported Vora library",
        files: [file],
      });
      markSaved();
      showToast("Vora library exported.");
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }

  // Final browser fallback for environments without the save picker/share.
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);

    markSaved();
    showToast("Saved vora.html.");
    return;
  } catch {
    // Some WebViews block both download and blob URLs.
  }

  // Last-resort WebView fallback: open the generated file so it can still
  // be saved/shared from the browser/WebView UI.
  try {
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank");
    if (!opened) window.location.href = url;
    markSaved();
    showToast("Export opened. Save/share the HTML from there.");
  } catch {
    showToast("This browser blocks file export.");
  }
}

// Note: the "Export library" button that used to trigger saveLibraryFile()
// has been removed from the topbar. saveLibraryFile() and the save-state
// tracking above are left in place (unused) rather than torn out, in case
// a way to trigger them is added back later.

// ---------------------------------------------------------------------
// CSV import
//
// Expected columns (any order, header row required, case-insensitive):
//   type, title, genre, genre2, description, banner, watch, season, episode
//
// Only type and title are required. watch may be empty; an empty watch value
// means the title/episode is imported without playback and no URL is guessed.
// genre/genre2/description/banner
// are optional — anything left blank is auto-filled after import by looking
// the title up on TMDB (see the "TMDB auto-fill" section below), as long as
// a free TMDB API key has been saved via the ⚙ TMDB key button. Rows still
// work with no key at all; they just keep whatever fields the CSV supplied.
//
// One row = one movie, OR one episode of a show.
// Movie rows: type=movie. genre/genre2/description/banner are optional,
//   watch is the movie's own watch link. season/episode are ignored.
// Show rows: type=show. All rows that share the same title (case-insensitive)
//   are grouped into a single show, each row becoming one episode using its
//   season/episode/watch. genre/genre2/description only need to be filled in
//   on one row for that show (first non-empty value wins). If any row for a
//   show has a banner, that image is used as the show's banner — this is how
//   "grab a banner from one of the show's episodes" is implemented, since
//   individual episodes don't get their own banner in Vora. When none of a
//   show's rows carry these fields, they come from TMDB instead, same as
//   for movies.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// TMDB auto-fill
//
// Uses TMDB's free v3 API (a personal API key from
// https://www.themoviedb.org/settings/api, saved locally via the ⚙ TMDB key
// button — it is never sent anywhere but api.themoviedb.org). For any
// imported title missing a banner, genre, or description, Vora searches
// TMDB for that title (as a movie or as a tv show, matching the CSV's
// type) and fills in whatever the CSV left blank from the best match.
// Fields the CSV already supplied are never overwritten.
//
// Two things keep large imports (dozens/hundreds of titles) from hitting
// TMDB's rate limit (40 requests per 10 seconds):
//   1. Every lookup result (including "no match found") is cached locally
//      by title+type for 30 days, so re-importing a title you've already
//      looked up — even in an earlier session — never costs a request.
//   2. Whatever's left after the cache is run through a queue that fires
//      at most 40 requests, then waits out the rest of that 10-second
//      window before sending the next 40 — so a 100-title import just
//      takes a few extra seconds instead of failing partway through.
// ---------------------------------------------------------------------

const TMDB_KEY_STORAGE = "vora-tmdb-key";

function getTmdbKey() {
  try {
    return (localStorage.getItem(TMDB_KEY_STORAGE) || "").trim();
  } catch {
    return "";
  }
}

function setTmdbKey(key) {
  try {
    if (key) localStorage.setItem(TMDB_KEY_STORAGE, key);
    else localStorage.removeItem(TMDB_KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
}

tmdbSettingsButton.addEventListener("click", () => {
  const entered = window.prompt(
    "Paste a free TMDB API key (v3 auth) so CSV import can auto-fill banner, genre, and description for titles that don't already have them.\n\nGet one at https://www.themoviedb.org/settings/api\n\nLeave blank and press OK to remove the saved key.",
    getTmdbKey(),
  );
  if (entered === null) return; // cancelled
  const trimmed = entered.trim();
  setTmdbKey(trimmed);
  showToast(trimmed ? "TMDB API key saved on this device." : "TMDB API key removed.");
});

// TMDB's stable numeric genre ids, mapped to their TMDB names.
const TMDB_MOVIE_GENRES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};
const TMDB_TV_GENRES = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids", 9648: "Mystery",
  10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
  10767: "Talk", 10768: "War & Politics", 37: "Western",
};
// TMDB's genre names, mapped onto Vora's own fixed genre list.
const TMDB_TO_VORA_GENRE = {
  Action: "Action", Adventure: "Adventure", Animation: "Animation", Comedy: "Comedy",
  Crime: "Crime", Documentary: "Documentary", Drama: "Drama", Family: "Family",
  Fantasy: "Fantasy", Horror: "Horror", Mystery: "Mystery", Romance: "Romance",
  "Science Fiction": "Sci-Fi", Thriller: "Thriller",
  "Action & Adventure": "Action", Kids: "Family", "Sci-Fi & Fantasy": "Sci-Fi", Soap: "Drama",
  History: "Other", Music: "Other", "TV Movie": "Other", War: "Other", Western: "Other",
  News: "Other", Reality: "Other", Talk: "Other", "War & Politics": "Other",
};

const TMDB_CACHE_STORAGE = "vora-tmdb-cache";
const TMDB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function loadTmdbCache() {
  try {
    return JSON.parse(localStorage.getItem(TMDB_CACHE_STORAGE) || "{}");
  } catch {
    return {};
  }
}

function saveTmdbCache(cache) {
  try {
    localStorage.setItem(TMDB_CACHE_STORAGE, JSON.stringify(cache));
  } catch {
    /* storage unavailable, or full — cache just won't persist this run */
  }
}

function tmdbCacheKey(title, type) {
  return `${type === "show" ? "tv" : "movie"}:${title.trim().toLowerCase()}`;
}

// Runs queued async tasks in batches of `limit`, waiting out the rest of
// each `windowMs` window before starting the next batch — so a long list
// of lookups never sends more than `limit` requests in any `windowMs`
// stretch, instead of firing them all at once and getting rate-limited.
function createRateLimitedQueue(limit, windowMs) {
  const queue = [];
  let draining = false;

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const batch = queue.splice(0, limit);
      const startedAt = Date.now();
      await Promise.all(
        batch.map(({ task, resolve, reject }) => task().then(resolve, reject)),
      );
      if (queue.length) {
        const elapsed = Date.now() - startedAt;
        const remaining = windowMs - elapsed;
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      }
    }
    draining = false;
  }

  return function enqueue(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      drain();
    });
  };
}

// TMDB's free tier allows 40 requests per 10 seconds.
const queueTmdbRequest = createRateLimitedQueue(40, 10000);

async function fetchTmdbMetadata(title, type, apiKey, selectedId = 0) {
  const endpoint = type === "show" ? "tv" : "movie";
  const url = selectedId
    ? `https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(selectedId)}?api_key=${encodeURIComponent(apiKey)}`
    : `https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(title)}&include_adult=false`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status === 401 ? "invalid API key" : `HTTP ${response.status}`);
  const data = await response.json();
  const match = selectedId ? data : (data.results || [])[0];
  if (!match) return null;
  const genreNames = type === "show" ? TMDB_TV_GENRES : TMDB_MOVIE_GENRES;
  const ids = match.genre_ids || (match.genres || []).map((g) => g.id);
  const genres = [...new Set(ids.map((id) => {
    const name = genreNames[id] || (match.genres || []).find((g) => g.id === id)?.name;
    return TMDB_TO_VORA_GENRE[name];
  }).filter(Boolean))].slice(0, 2);
  const image = match.backdrop_path || match.poster_path;
  return {
    tmdbId: Number(match.id) || 0,
    year: (match.release_date || match.first_air_date || "").slice(0, 4),
    rating: match.vote_average ? Number(match.vote_average).toFixed(1) : "",
    banner: image ? `https://image.tmdb.org/t/p/w1280${image}` : "",
    poster: match.poster_path || "",
    description: (match.overview || "").trim(),
    genres,
  };
}

function applyTmdbMeta(record, meta, errors) {
  if (!meta) {
    errors.push(`"${record.title}": no match found on TMDB — filled in manually instead.`);
    return;
  }
  const useExactMatch = !!record.tmdbId;
  if (meta.tmdbId) record.tmdbId = meta.tmdbId;
  if (meta.year && (useExactMatch || !record.year)) record.year = meta.year;
  if (meta.rating && (useExactMatch || !record.rating)) record.rating = meta.rating;
  if (meta.banner && (useExactMatch || !record.banner)) record.banner = meta.banner;
  if (meta.poster && (useExactMatch || !record.poster)) record.poster = meta.poster;
  if (meta.description && (useExactMatch || !record.description)) record.description = meta.description;
  if (meta.genres.length && (useExactMatch || !record.genres.length)) record.genres = meta.genres;
}

// Fills in whatever banner/description/genres each record is missing by
// looking its title up on TMDB. Mutates `newRecords` in place and pushes
// human-readable notes onto `errors` for anything it couldn't fill.
// Cache hits are applied immediately with no network call at all; only
// cache misses get queued, 40 at a time, 10 seconds apart.
async function enrichRecordsWithTmdb(newRecords, errors) {
  const apiKey = getTmdbKey();
  const incomplete = newRecords.filter((record) =>
    record.tmdbId ||
    !record.banner || !record.description || !record.genres.length,
  );
  if (!incomplete.length) return;
  if (!apiKey) {
    errors.push(
      `${incomplete.length} title${incomplete.length === 1 ? "" : "s"} left without a banner/genre/description — click the ⚙ TMDB key button to add a free key and auto-fill these on your next import.`,
    );
    return;
  }

  const cache = loadTmdbCache();
  let cacheChanged = false;
  const toFetch = [];

  for (const record of incomplete) {
    const cacheKey = record.tmdbId
      ? `${tmdbCacheKey(record.title, record.type)}:id:${record.tmdbId}`
      : tmdbCacheKey(record.title, record.type);
    const cached = cache[cacheKey];
    if (cached && Date.now() - cached.fetchedAt < TMDB_CACHE_TTL_MS) {
      applyTmdbMeta(record, cached.data, errors);
    } else {
      toFetch.push({ record, cacheKey });
    }
  }

  if (toFetch.length > 40) {
    showToast(
      `Looking up ${toFetch.length} titles on TMDB — this will take about ${Math.ceil(toFetch.length / 40) * 10} seconds…`,
    );
  }

  await Promise.all(
    toFetch.map(({ record, cacheKey }) =>
      queueTmdbRequest(async () => {
        let meta;
        try {
          meta = await fetchTmdbMetadata(record.title, record.type, apiKey, record.tmdbId);
        } catch (error) {
          errors.push(`"${record.title}": TMDB lookup failed (${error.message}).`);
          return;
        }
        cache[cacheKey] = { data: meta, fetchedAt: Date.now() };
        cacheChanged = true;
        applyTmdbMeta(record, meta, errors);
      }),
    ),
  );

  if (cacheChanged) saveTmdbCache(cache);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  // Normalize line endings so \r\n and \r behave like \n inside the parser.
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const CSV_COLUMNS = [
  "type",
  "title",
  "genre",
  "genre2",
  "description",
  "banner",
  "watch",
  "ip",
  "season",
  "episode",
];

function csvRowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((cell) =>
    cell.trim().toLowerCase().replace(/[\s_-]+/g, ""),
  );
  const aliases = {
    genre1: "genre",
    secondgenre: "genre2",
    watchlink: "watch",
    ipaddress: "ip",
    baseip: "ip",
    synopsis: "description",
  };
  const columnIndex = {};
  header.forEach((name, index) => {
    const key = aliases[name] || name;
    if (CSV_COLUMNS.includes(key) && !(key in columnIndex)) {
      columnIndex[key] = index;
    }
  });
  const objects = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const object = { __row: i + 1 };
    for (const key of CSV_COLUMNS) {
      const index = columnIndex[key];
      object[key] = index === undefined ? "" : (cells[index] || "").trim();
    }
    objects.push(object);
  }
  return objects;
}

function buildIpWatchUrl(ip, type, title) {
  const base = String(ip || "").trim();
  const name = String(title || "").trim();
  if (!base || !name) return "";
  try {
    const root = new URL(base.endsWith("/") ? base : `${base}/`);
    if (!/^https?:$/.test(root.protocol)) return "";
    const folder = String(type || "movie").toLowerCase() === "show" ? "Shows" : "Movies";
    return new URL(`${folder}/${name.split("/").map(encodeURIComponent).join("/")}`, root).href;
  } catch { return ""; }
}

function buildImportPlan(objects, existingTitles) {
  const takenTitles = new Set(existingTitles.map((t) => t.toLowerCase()));
  const showGroups = new Map();
  const showOrder = [];
  const newRecords = [];
  const errors = [];
  let skippedDuplicates = 0;

  for (const object of objects) {
    const title = object.title.trim();
    if (!title) {
      errors.push(`Row ${object.__row}: missing a title — skipped.`);
      continue;
    }
    const type = object.type.trim().toLowerCase() === "show" ? "show" : "movie";
    const key = `${type}:${title.toLowerCase()}`;

    if (type === "movie") {
      if (takenTitles.has(title.toLowerCase())) {
        skippedDuplicates++;
        continue;
      }
      takenTitles.add(title.toLowerCase());
      const genres = [object.genre, object.genre2].filter(Boolean).slice(0, 2);
      newRecords.push({
        id: createId(),
        type: "movie",
        title,
        genres,
        description: object.description,
        banner: object.banner,
        // Empty watch means intentionally unavailable: do not guess from ip.
        driveUrl: object.watch ? object.watch : "",
        episodes: [],
        createdAt: new Date().toISOString(),
      });
      continue;
    }

    // Show row: group by title so every episode row folds into one show.
    if (!showGroups.has(key)) {
      if (takenTitles.has(title.toLowerCase())) {
        skippedDuplicates++;
        showGroups.set(key, null); // mark as skipped so its episodes are ignored too
      } else {
        takenTitles.add(title.toLowerCase());
        showGroups.set(key, {
          title,
          genre: "",
          genre2: "",
          description: "",
          banner: "",
          episodes: [],
        });
        showOrder.push(key);
      }
    }
    const group = showGroups.get(key);
    if (!group) continue; // this show was a duplicate; skip its episode rows too

    if (object.genre && !group.genre) group.genre = object.genre;
    if (object.genre2 && !group.genre2) group.genre2 = object.genre2;
    if (object.description && !group.description) group.description = object.description;
    // "find a banner in the show's episodes and use it as the show's banner"
    if (object.banner && !group.banner) group.banner = object.banner;

    const season = Number.parseInt(object.season, 10) || 1;
    const episodeNumber =
      Number.parseInt(object.episode, 10) || group.episodes.length + 1;
    // Empty watch means skip playback for this episode; keep its metadata only.
    const generatedWatch = object.watch ? object.watch : "";
    group.episodes.push({
      season,
      episode: episodeNumber,
      title: `Season ${season}, Episode ${episodeNumber}`,
      driveUrl: generatedWatch,
    });
  }

  for (const key of showOrder) {
    const group = showGroups.get(key);
    if (!group || !group.episodes.length) continue;
    const genres = [group.genre, group.genre2].filter(Boolean).slice(0, 2);
    newRecords.push({
      id: createId(),
      type: "show",
      title: group.title,
      genres,
      description: group.description,
      banner: group.banner,
      driveUrl: "",
      episodes: group.episodes,
      createdAt: new Date().toISOString(),
    });
  }

  return { newRecords, errors, skippedDuplicates };
}

// Shared tail end of every bulk-import source (the CSV file):
// turns a list of row-shaped objects (type/title/genre/genre2/description/
// banner/watch/season/episode/__row) into saved library entries, same dedup
// and TMDB auto-fill rules every time. `extraMessage`, if given, is appended
// to the success toast.
// Rescans: episodes found for a show already in the library are added to
// that show (skipping ones it already has) instead of counting as duplicates.
async function mergeIntoExistingShows(objects) {
  const rest = [];
  const touched = new Set();
  let added = 0;
  let updated = 0;
  for (const o of objects) {
    const title = o.title.trim().toLowerCase();
    const isShow = o.type.trim().toLowerCase() === "show";
    const existing = customTitles.find((i) => i.title.toLowerCase() === title && i.type === (isShow ? "show" : "movie"));
    if (!existing) { rest.push(o); continue; }
    if (!o.watch) continue;
    let link = o.watch;
    try { link = mediaLinkUrl(o.watch); } catch { /* keep raw */ }
    if (!isShow) {
      // Existing movie: refresh its watch link, keep everything else.
      if (existing.driveUrl !== link) { existing.driveUrl = link; touched.add(existing); updated++; }
      continue;
    }
    const season = Number.parseInt(o.season, 10) || 1;
    const episode = Number.parseInt(o.episode, 10) || existing.episodes.length + 1;
    const match = existing.episodes.find((e) => e.season === season && e.episode === episode);
    if (match) {
      // Existing episode: refresh its watch link, keep progress etc.
      if (match.driveUrl !== link) { match.driveUrl = link; touched.add(existing); updated++; }
      continue;
    }
    if (existing.episodes.some((e) => e.driveUrl === link)) continue;
    existing.episodes.push({ season, episode, title: `Season ${season}, Episode ${episode}`, driveUrl: link, still: "" });
    touched.add(existing);
    added++;
  }
  for (const item of touched) {
    item.episodes = sortEpisodes(item.episodes);
    if (item.episodes.length) item.detailsAt = 0; // refetch names + stills for new episodes
    await saveRecord(item);
  }
  return { rest, added, updated, shows: touched.size };
}

async function importScannedObjects(objects, { noneFoundMessage, extraMessage } = {}) {
  const merged = await mergeIntoExistingShows(objects);
  objects = merged.rest;
  const existingTitles = customTitles.map((item) => item.title);
  const { newRecords, errors, skippedDuplicates } = buildImportPlan(
    objects,
    existingTitles,
  );

  const mergeParts = [];
  if (merged.added) mergeParts.push(`${merged.added} new episode${merged.added === 1 ? "" : "s"} added`);
  if (merged.updated) mergeParts.push(`${merged.updated} watch link${merged.updated === 1 ? "" : "s"} updated`);
  const mergeNote = mergeParts.join(" · ");
  if (!newRecords.length) {
    if (merged.added || merged.updated) {
      renderShelves();
      showToast(mergeNote);
      return;
    }
    showToast(
      skippedDuplicates
        ? `Nothing new to import — ${skippedDuplicates} title${skippedDuplicates === 1 ? "" : "s"} already in your library.`
        : noneFoundMessage || "No valid rows found to import.",
    );
    return;
  }

  await enrichRecordsWithTmdb(newRecords, errors);

  applyStashedPersonalData(newRecords);
  const normalized = newRecords.map(normalizeRecord).map(toCardItem);
  await Promise.all(normalized.map(saveRecord));
  customTitles = [...normalized, ...customTitles];
  renderShelves();
  searchInput.value = "";
  applySearch();

  const showCount = normalized.filter((item) => item.type === "show").length;
  const movieCount = normalized.length - showCount;
  const parts = [];
  if (movieCount) parts.push(`${movieCount} movie${movieCount === 1 ? "" : "s"}`);
  if (showCount) parts.push(`${showCount} show${showCount === 1 ? "" : "s"}`);
  let message = `Imported ${parts.join(" and ")}`;
  if (skippedDuplicates) {
    message += ` · skipped ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"}`;
  }
  if (mergeNote) message += ` · ${mergeNote}`;
  if (extraMessage) message += ` · ${extraMessage}`;
  showToast(message);

  if (errors.length) {
    // Non-blocking: the import already happened, this just surfaces rows
    // that were missing a watch link so they can be filled in later.
    console.warn("Vora import notes:\n" + errors.join("\n"));
    window.alert(
      `Imported with ${errors.length} note${errors.length === 1 ? "" : "s"}:\n\n` +
        errors.slice(0, 20).join("\n") +
        (errors.length > 20 ? `\n…and ${errors.length - 20} more.` : ""),
    );
  }
}

async function importCsvFile(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    showToast("Could not read that file.");
    return;
  }

  await importCsvText(text);
}

async function importCsvText(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    showToast("That CSV has no rows to import.");
    return;
  }
  const objects = csvRowsToObjects(rows);

  await importScannedObjects(objects, {
    noneFoundMessage: "No valid rows found in that CSV.",
  });
  // Re-link any English subtitles already saved in the cloud to the imported titles.
  refreshSubtitleIndex(true).catch(() => {});
}

importCsvButton.addEventListener("click", () => importCsvInput.click());
importCsvInput.addEventListener("change", async () => {
  const file = importCsvInput.files[0];
  importCsvInput.value = "";
  if (!file) return;
  importCsvButton.disabled = true;
  try {
    await importCsvFile(file);
  } catch (error) {
    console.error(error);
    showToast("That CSV could not be imported.");
  } finally {
    importCsvButton.disabled = false;
  }
});

// ---------------------------------------------------------------
// Cloud CSV — one CSV kept in the Supabase Storage bucket "csv".
// Uploading saves the new file, then deletes every older CSV in the bucket.
// Loading downloads the newest one and runs it through the normal CSV import.
// Uses Supabase's REST API directly (no library needed).
// ---------------------------------------------------------------
const SUPABASE_URL = "https://zomnjlmnzzelbtrbbtaf.supabase.co";
const SUPABASE_KEY = "sb_publishable_05Expy-HinzSih8YjkKdBA_Sp-raj4j";
const CLOUD_BUCKET = "CSV";

const cloudDialog = document.querySelector("#cloud-csv-dialog");
const cloudOpenButton = document.querySelector("#open-cloud-csv");
const cloudFileInput = document.querySelector("#cloud-csv-input");
const cloudUploadButton = document.querySelector("#cloud-upload-btn");
const cloudLoadButton = document.querySelector("#cloud-load-btn");
const cloudStatus = document.querySelector("#cloud-csv-status");

function cloudConfigured() {
  return SUPABASE_URL && !SUPABASE_URL.includes("YOUR-PROJECT-REF");
}

function setCloudStatus(message, isError = false) {
  cloudStatus.textContent = message;
  cloudStatus.classList.toggle("error", isError);
}

function setCloudBusy(busy) {
  cloudUploadButton.disabled = busy;
  cloudLoadButton.disabled = busy || cloudLoadButton.dataset.empty === "1";
}

async function cloudFail(response, fallback) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body.message || body.error || "";
  } catch { /* no JSON body */ }
  const hint = /bucket not found/i.test(detail)
    ? ` — no bucket named "${CLOUD_BUCKET}" is visible to this key (check the exact name, and that the bucket policies exist)`
    : response.status === 400 || response.status === 401 || response.status === 403
      ? " — check the bucket's access policies" : "";
  return new Error(`${fallback}${detail ? `: ${detail}` : ` (HTTP ${response.status})`}${hint}`);
}

// Every CSV currently in the bucket, newest first.
async function cloudListCsvs() {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${CLOUD_BUCKET}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 1000, offset: 0 }),
  });
  if (!response.ok) throw await cloudFail(response, "Could not read the cloud bucket");
  const files = await response.json();
  return files
    .filter((f) => f.id && /\.csv$/i.test(f.name))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

async function cloudUploadCsv(file) {
  const older = await cloudListCsvs();
  const name = `library-${Date.now()}.csv`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${CLOUD_BUCKET}/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "text/csv", "x-upsert": "false" },
    body: file,
  });
  if (!upload.ok) throw await cloudFail(upload, "Upload failed");

  // Only delete the old files once the new one is safely stored.
  let deleteWarning = "";
  if (older.length) {
    try {
      const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${CLOUD_BUCKET}`, {
        method: "DELETE",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: older.map((f) => f.name) }),
      });
      if (!del.ok) throw await cloudFail(del, "Could not delete the old CSV");
      const removed = await del.json();
      if (Array.isArray(removed) && removed.length < older.length) {
        deleteWarning = "the old CSV could not be deleted (missing delete permission on the bucket)";
      }
    } catch (error) {
      deleteWarning = error.message;
    }
  }
  return { name, deleteWarning };
}

async function cloudDownloadLatestCsv() {
  const files = await cloudListCsvs();
  if (!files.length) throw new Error("There is no CSV in the cloud yet — upload one first.");
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${CLOUD_BUCKET}/${encodeURIComponent(files[0].name)}`,
    { headers: { apikey: SUPABASE_KEY } },
  );
  if (!response.ok) throw await cloudFail(response, "Could not download the cloud CSV");
  return response.text();
}

async function refreshCloudStatus() {
  cloudLoadButton.dataset.empty = "1";
  setCloudBusy(true);
  if (!cloudConfigured()) {
    setCloudStatus("Cloud storage isn't set up yet — add your Supabase project URL in the page's script (SUPABASE_URL).", true);
    return;
  }
  setCloudStatus("Checking the cloud…");
  try {
    const files = await cloudListCsvs();
    if (files.length) {
      cloudLoadButton.dataset.empty = "0";
      const when = files[0].created_at ? new Date(files[0].created_at).toLocaleString() : "";
      setCloudStatus(`Saved in the cloud${when ? ` · uploaded ${when}` : ""}`);
    } else {
      setCloudStatus("No CSV saved in the cloud yet.");
    }
    setCloudBusy(false);
  } catch (error) {
    console.error(error);
    setCloudStatus(error.message, true);
    cloudUploadButton.disabled = false;
  }
}

cloudOpenButton.addEventListener("click", () => {
  cloudDialog.showModal();
  refreshCloudStatus();
});
cloudDialog.querySelector(".dialog-close").addEventListener("click", () => cloudDialog.close());
cloudDialog.addEventListener("click", (event) => {
  if (event.target === cloudDialog) cloudDialog.close();
});

cloudUploadButton.addEventListener("click", () => {
  if (!cloudConfigured()) return refreshCloudStatus();
  cloudFileInput.click();
});
cloudFileInput.addEventListener("change", async () => {
  const file = cloudFileInput.files[0];
  cloudFileInput.value = "";
  if (!file) return;
  setCloudBusy(true);
  try {
    // Sanity-check first so a bad file never replaces a good one.
    const rows = parseCsv(await file.text());
    if (rows.length < 2) throw new Error("That CSV has no rows — nothing was uploaded.");
    setCloudStatus("Uploading…");
    const { deleteWarning } = await cloudUploadCsv(file);
    showToast(deleteWarning ? `Uploaded, but ${deleteWarning}.` : "CSV saved to the cloud.");
    await refreshCloudStatus();
    if (deleteWarning) setCloudStatus(`Uploaded, but ${deleteWarning}.`, true);
  } catch (error) {
    console.error(error);
    setCloudStatus(error.message || "Upload failed.", true);
    cloudLoadButton.disabled = cloudLoadButton.dataset.empty === "1";
    cloudUploadButton.disabled = false;
  }
});

cloudLoadButton.addEventListener("click", async () => {
  setCloudBusy(true);
  setCloudStatus("Loading from the cloud…");
  try {
    const text = await cloudDownloadLatestCsv();
    cloudDialog.close();
    await importCsvText(text);
  } catch (error) {
    console.error(error);
    setCloudStatus(error.message || "Could not load the cloud CSV.", true);
    setCloudBusy(false);
  }
});


// ===========================================================================
// English subtitles (OpenSubtitles -> Supabase -> player)
// ===========================================================================
// Flow when a direct video plays:
//   1. Look for a saved English .vtt in the Supabase bucket "subtitles".
//      If there is one, it is attached to the video at once (CC button = on/off).
//   2. If not, the CC button reads "Get subtitles". Pressing it asks for
//      confirmation, then searches OpenSubtitles and downloads the best match
//      (this uses 1 of the free daily downloads), converts it to WebVTT,
//      saves it permanently to Supabase, and attaches it.
// Subtitles are saved under a key built from the TMDB id (or title + year)
// plus season/episode, so a CSV import or cloud CSV load re-finds them with no
// extra downloads. Needs a Supabase Storage bucket named "subtitles" (see the
// SQL note in the README / chat) with select + insert policies for the anon key.
const OPENSUBS_URL = "https://api.opensubtitles.com/api/v1";
const OPENSUBS_KEY = "R8GNgoyr1RxKpkEnfnMeB6jWet1LcWNI";
const SUB_BUCKET = "subtitles";
const SUB_DAILY_LIMIT = 5;
const SUB_LOG_KEY = "vora-opensubs-downloads";
// Optional: URL of your Cloudflare Worker (see chat). Only used when a direct
// browser request is blocked (CORS). Leave empty to disable.
const VORA_PROXY = "";

const ccButton = document.querySelector("#player-cc");
const subDelayWrap = document.querySelector("#player-sub-delay");
const subEarlier = document.querySelector("#player-sub-earlier");
const subLater = document.querySelector("#player-sub-later");

let subIndex = new Set(); // keys of subtitles saved in the cloud
const subSync = document.querySelector("#player-sync");
const subState = { video: null, item: null, episode: null, key: "", trackEl: null, blobUrl: "", shift: 0, anchors: [], scale: 1, fps: 0, fpsStarted: false, busy: false, panel: null, saveTimer: 0 };

function subSlug(text) {
  return String(text || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "untitled";
}
function subKeyFor(item, episode) {
  const base = Number(item?.tmdbId) > 0 ? `tmdb-${item.tmdbId}` : `t-${subSlug(item?.title)}-${item?.year || "x"}`;
  if (!episode) return `${base}-${item?.type === "show" ? "show" : "movie"}`;
  const pad = (n) => String(Number(n) || 0).padStart(2, "0");
  return `${base}-s${pad(episode.season)}e${pad(episode.episode)}`;
}
function subObjectUrl(key) {
  return `${SUPABASE_URL}/storage/v1/object/${SUB_BUCKET}/en/${encodeURIComponent(key)}.vtt`;
}

// ---- daily download counter (local note; OpenSubtitles' own count wins) ----
function subLogRead() {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return (JSON.parse(localStorage.getItem(SUB_LOG_KEY) || "[]") || []).filter((t) => t > cutoff);
  } catch { return []; }
}
function subLogAdd() {
  const log = subLogRead();
  log.push(Date.now());
  try { localStorage.setItem(SUB_LOG_KEY, JSON.stringify(log)); } catch { /* storage unavailable */ }
}

// ---- Supabase ---------------------------------------------------------------
async function refreshSubtitleIndex(notify = false) {
  if (!cloudConfigured()) return;
  const found = new Set();
  for (let offset = 0; offset < 20000; offset += 1000) {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${SUB_BUCKET}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "en", limit: 1000, offset }),
    });
    if (!response.ok) { if (offset === 0) return; break; }
    const rows = await response.json();
    for (const row of rows) {
      if (row.id && /\.vtt$/i.test(row.name)) found.add(decodeURIComponent(row.name.replace(/\.vtt$/i, "")));
    }
    if (rows.length < 1000) break;
  }
  subIndex = found;
  if (notify && found.size) {
    const matched = customTitles.filter((t) => [...found].some((k) => k.startsWith(subKeyFor(t, null).replace(/-(movie|show)$/, "")))).length;
    showToast(`${found.size} saved subtitle${found.size === 1 ? "" : "s"} in the cloud · ${matched} title${matched === 1 ? "" : "s"} linked`);
  }
}
async function subCloudGet(key) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${SUB_BUCKET}/en/${encodeURIComponent(key)}.vtt`, { headers: { apikey: SUPABASE_KEY } });
  if (!response.ok) return "";
  return response.text();
}
async function subCloudPut(key, vtt) {
  const response = await fetch(subObjectUrl(key), {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "text/vtt", "x-upsert": "true" },
    body: new Blob([vtt], { type: "text/vtt" }),
  });
  if (!response.ok) throw await cloudFail(response, "Could not save the subtitle to the cloud");
  subIndex.add(key);
}

// ---- Conversion ---------------------------------------------------------------
function decodeSubtitleBytes(buffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return new TextDecoder("windows-1252").decode(buffer); }
}
function toVtt(text) {
  let t = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (/^WEBVTT/.test(t)) return t + "\n";
  t = t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, "$1.$2");
  return "WEBVTT\n\n" + t + "\n";
}

// ---- OpenSubtitles --------------------------------------------------------------
async function opensubsFetch(path, init = {}) {
  const response = await fetchWithFallback(`${OPENSUBS_URL}${path}`, {
    ...init,
    headers: { "Api-Key": OPENSUBS_KEY, "Content-Type": "application/json", Accept: "application/json", "X-User-Agent": "Vora v1.0", ...(init.headers || {}) },
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).message || ""; } catch { /* no body */ }
    throw new Error(`OpenSubtitles said ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}
// Direct request first; if the browser blocks it (CORS) and a proxy is set, retry through it.
async function fetchWithFallback(url, init = {}) {
  try { return await fetch(url, init); }
  catch (error) {
    if (!VORA_PROXY) throw error;
    return fetch(`${VORA_PROXY}${VORA_PROXY.includes("?") ? "&" : "?"}url=${encodeURIComponent(url)}`, init);
  }
}

// OpenSubtitles "moviehash": file size + the first and last 64 KB read as 64-bit
// little-endian words. Only 128 KB is fetched. If a subtitle was uploaded for
// this exact file, the match is perfectly in sync.
async function movieHashOf(url) {
  try {
    const part = async (range) => {
      const r = await fetchWithFallback(url, { headers: { Range: `bytes=${range}` } });
      if (r.status !== 206) { r.body?.cancel?.(); return null; }
      const total = Number((r.headers.get("Content-Range") || "").split("/")[1]);
      return { total, buf: await r.arrayBuffer() };
    };
    const head = await part("0-65535");
    if (!head || !head.total || head.total < 131072) return "";
    const tail = await part(`${head.total - 65536}-${head.total - 1}`);
    if (!tail) return "";
    const mask = (1n << 64n) - 1n;
    let h = BigInt(head.total);
    for (const { buf } of [head, tail]) {
      const dv = new DataView(buf);
      for (let i = 0; i + 8 <= dv.byteLength; i += 8) h = (h + dv.getBigUint64(i, true)) & mask;
    }
    return h.toString(16).padStart(16, "0");
  } catch { return ""; }
}

// Frame rate of the playing video (so a 25 fps subtitle can be corrected for a 23.976 fps video).
function snapFps(f) {
  const known = [23.976, 25, 29.97, 50, 59.94];
  const best = known.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a));
  return Math.abs(best - f) / best < 0.04 ? best : 0;
}
function estimateVideoFps(video) {
  return new Promise((resolve) => {
    if (!video.requestVideoFrameCallback) { resolve(0); return; }
    let first = null;
    const timer = setTimeout(() => resolve(0), 8000);
    const tick = (_now, meta) => {
      if (!first) first = { t: meta.mediaTime, f: meta.presentedFrames };
      else if (meta.mediaTime - first.t >= 3) { clearTimeout(timer); resolve(snapFps((meta.presentedFrames - first.f) / (meta.mediaTime - first.t))); return; }
      video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
  });
}
function lastCueEnd(vtt) {
  let max = 0;
  for (const m of vtt.matchAll(/-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})\.(\d{1,3})/g)) {
    max = Math.max(max, (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000);
  }
  return max;
}
const fmtClock = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

// Search is free (only /download uses the daily quota). Candidates are ranked:
// exact file match first, then same frame rate, then most downloaded.
async function opensubsFindCandidates(item, episode, hash, videoFps) {
  const params = { languages: "en", ai_translated: "exclude", machine_translated: "exclude", order_by: "download_count", order_direction: "desc" };
  if (hash) params.moviehash = hash;
  if (episode) {
    params.type = "episode";
    params.season_number = episode.season;
    params.episode_number = episode.episode;
    if (Number(item.tmdbId) > 0) params.parent_tmdb_id = item.tmdbId; else params.query = item.title;
  } else {
    params.type = "movie";
    if (Number(item.tmdbId) > 0) params.tmdb_id = item.tmdbId;
    else { params.query = item.title; if (item.year) params.year = item.year; }
  }
  // OpenSubtitles wants lower-case, alphabetically sorted parameters.
  const query = Object.keys(params).sort().map((k) => `${k}=${encodeURIComponent(params[k])}`).join("&");
  const data = await opensubsFetch(`/subtitles?${query}`);
  const rows = (data.data || []).map((row, index) => {
    const at = row?.attributes || {};
    const id = at.files?.[0]?.file_id;
    const fps = Number(at.fps) || 0;
    let score = -index * 0.01; // keep API order as the tie-breaker
    const exact = at.moviehash_match === true;
    if (exact) score += 1000;
    if (videoFps && fps) score += Math.abs(fps / videoFps - 1) < 0.005 ? 50 : -20;
    if (at.hearing_impaired) score -= 5;
    score += Math.log10(1 + (Number(at.download_count) || 0));
    return { id, fps, exact, score };
  }).filter((c) => c.id);
  return rows.sort((x, y) => y.score - x.score);
}

// ---- Sync: shift + stretch -------------------------------------------------------
// Each "sync point" says: the subtitle line that originally sat at time s is
// really spoken at video time v. One point = a constant shift. Two or more =
// the lines between points are stretched/squeezed linearly (fixes frame-rate
// drift and different cuts). Before the first / after the last point the
// nearest point's shift is kept. `shift` is the extra ±0.5s fine-tune on top.
function syncMap(s) {
  const a = subState.anchors;
  const k = subState.scale || 1; // frame-rate correction, used where no two points bracket the line
  let t;
  if (!a.length) t = s * k;
  else if (a.length === 1 || s <= a[0].s) t = a[0].v + (s - a[0].s) * k;
  else if (s >= a[a.length - 1].s) { const l = a[a.length - 1]; t = l.v + (s - l.s) * k; }
  else {
    let i = 0;
    while (i < a.length - 2 && s >= a[i + 1].s) i++;
    const r = (s - a[i].s) / (a[i + 1].s - a[i].s);
    t = a[i].v + r * (a[i + 1].v - a[i].v);
  }
  return Math.max(0, t + subState.shift);
}
function subCues() { const c = subState.trackEl?.track?.cues; return c && c.length ? c : null; }
function applySync() {
  const cues = subCues();
  if (!cues) return false;
  for (const cue of cues) {
    if (cue._s === undefined) { cue._s = cue.startTime; cue._e = cue.endTime; }
    const ns = syncMap(cue._s);
    cue.endTime = Math.max(ns + 0.05, syncMap(cue._e));
    cue.startTime = ns;
  }
  return true;
}
function syncPath(key) { return `${SUPABASE_URL}/storage/v1/object/${SUB_BUCKET}/en/${encodeURIComponent(key)}.sync.json`; }
function scheduleSyncSave() {
  clearTimeout(subState.saveTimer);
  const { key } = subState;
  const body = JSON.stringify({ anchors: subState.anchors, shift: subState.shift, scale: subState.scale });
  subState.saveTimer = setTimeout(() => {
    fetch(syncPath(key), { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", "x-upsert": "true" }, body })
      .catch(() => {});
  }, 1200);
}
async function loadSavedSync(key) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${SUB_BUCKET}/en/${encodeURIComponent(key)}.sync.json`, { headers: { apikey: SUPABASE_KEY } });
    if (!r.ok) return;
    const j = await r.json();
    subState.anchors = Array.isArray(j.anchors) ? j.anchors.filter((p) => Number.isFinite(p.s) && Number.isFinite(p.v)).sort((x, y) => x.s - y.s) : [];
    subState.shift = Number(j.shift) || 0;
    subState.scale = Number(j.scale) > 0.5 && Number(j.scale) < 2 ? Number(j.scale) : 1;
  } catch { /* no saved sync */ }
}
function addSyncPoint(s, v) {
  // Drop points that sit on top of the new one, then keep the order consistent.
  let a = subState.anchors.filter((p) => Math.abs(p.s - s) > 2 && Math.abs(p.v - v) > 2);
  a.push({ s, v });
  a.sort((x, y) => x.s - y.s);
  for (let i = 1; i < a.length; i++) {
    if (a[i].v <= a[i - 1].v) { showToast("That point doesn't fit with your earlier ones. Reset sync and try again."); return false; }
  }
  subState.anchors = a;
  subState.shift = 0;
  applySync();
  scheduleSyncSave();
  return true;
}

// ---- Player UI ------------------------------------------------------------------
function subPlayerAlive(video) { return subState.video === video && playerStage.contains(video); }

function updateCcButton() {
  const track = subState.trackEl?.track;
  if (!subState.video) { ccButton.hidden = true; subDelayWrap.hidden = true; return; }
  ccButton.hidden = false;
  ccButton.disabled = subState.busy;
  if (track) {
    const on = track.mode === "showing";
    ccButton.textContent = on ? "CC on" : "CC off";
    ccButton.classList.toggle("on", on);
    subDelayWrap.hidden = !on;
  } else {
    ccButton.textContent = subState.busy ? "Working…" : "Get subtitles";
    ccButton.classList.remove("on");
    subDelayWrap.hidden = true;
  }
}

function attachSubtitleTrack(vtt, show) {
  if (!subState.video) return;
  if (subState.blobUrl) URL.revokeObjectURL(subState.blobUrl);
  subState.trackEl?.remove();
  subState.blobUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
  const trackEl = document.createElement("track");
  trackEl.kind = "captions";
  trackEl.label = "English";
  trackEl.srclang = "en";
  trackEl.src = subState.blobUrl;
  trackEl.addEventListener("load", applySync);
  subState.video.append(trackEl);
  subState.trackEl = trackEl;
  trackEl.track.mode = show ? "showing" : "hidden"; // off until the viewer turns it on
  subState.video.textTracks.onchange = updateCcButton;
  updateCcButton();
}

function closeSyncPanel() { subState.panel?.remove(); subState.panel = null; }

function resetSubtitles() {
  clearTimeout(subState.saveTimer);
  closeSyncPanel();
  if (subState.blobUrl) URL.revokeObjectURL(subState.blobUrl);
  Object.assign(subState, { video: null, item: null, episode: null, key: "", trackEl: null, blobUrl: "", shift: 0, anchors: [], scale: 1, fps: 0, fpsStarted: false, busy: false, panel: null, saveTimer: 0 });
  ccButton.hidden = true;
  subDelayWrap.hidden = true;
}

async function initSubtitles(video, item, episode) {
  resetSubtitles();
  if (!item || !cloudConfigured()) return;
  Object.assign(subState, { video, item, episode: episode || null, key: subKeyFor(item, episode) });
  const measureFps = () => {
    if (subState.fpsStarted || subState.video !== video) return;
    subState.fpsStarted = true;
    estimateVideoFps(video).then((f) => { if (subState.video === video) subState.fps = f; });
  };
  video.addEventListener("playing", measureFps, { once: true });
  if (!video.paused) measureFps();
  updateCcButton();
  try {
    const key = subState.key;
    const vtt = await subCloudGet(key);
    if (!vtt || !subPlayerAlive(video)) return;
    await loadSavedSync(key);
    if (subPlayerAlive(video)) attachSubtitleTrack(vtt, false);
  } catch { /* offline: the "Get subtitles" button stays available */ }
}

function subTriedKey(key) { return `vora-sub-tried-${key}`; }
function subTriedRead(key) { try { return JSON.parse(localStorage.getItem(subTriedKey(key)) || "[]"); } catch { return []; } }
function subTriedAdd(key, id) { try { localStorage.setItem(subTriedKey(key), JSON.stringify([...new Set([...subTriedRead(key), id])])); } catch { /* storage unavailable */ } }

async function fetchSubtitlesFromOpenSubtitles(another = false, offered = false) {
  const { video, item, episode, key } = subState;
  const used = subLogRead().length;
  const what = episode ? `${item.title} S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}` : item.title;
  if (used >= SUB_DAILY_LIMIT) {
    const reset = new Date(Math.min(...subLogRead()) + 24 * 60 * 60 * 1000);
    showToast(`Daily limit reached (${SUB_DAILY_LIMIT}). Try again after ${reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
    return;
  }
  const ok = window.confirm(
    `${another ? "Download a different English subtitle version" : "Download English subtitles"} for “${what}”?\n\nThis uses 1 of your ${SUB_DAILY_LIMIT} free OpenSubtitles downloads per 24 hours (${used} used so far). It will be saved to the cloud so it never needs downloading again.${another ? "\n\nYour current sync points will be cleared." : ""}`,
  );
  if (!ok) return;

  subState.busy = true;
  updateCcButton();
  try {
    // Free steps first: fingerprint the file and rank the candidates.
    const hash = await movieHashOf(video.currentSrc || video.src);
    const candidates = await opensubsFindCandidates(item, episode, hash, subState.fps);
    const tried = subTriedRead(key);
    const pick = candidates.find((c) => !tried.includes(c.id));
    if (!pick) { showToast(candidates.length ? "No other English versions to try." : "No English subtitles found for this one."); return; }

    const info = await opensubsFetch("/download", { method: "POST", body: JSON.stringify({ file_id: pick.id }) });
    subLogAdd();
    subTriedAdd(key, pick.id);
    if (!info.link) throw new Error("OpenSubtitles didn't return a download link.");
    const fileResponse = await fetchWithFallback(info.link);
    if (!fileResponse.ok) throw new Error(`Subtitle file download failed (${fileResponse.status}).`);
    const vtt = toVtt(decodeSubtitleBytes(await fileResponse.arrayBuffer()));

    // Frame-rate correction (e.g. a 25 fps subtitle on a 23.976 fps video).
    subState.anchors = []; subState.shift = 0; subState.scale = 1;
    if (!pick.exact && pick.fps && subState.fps && Math.abs(pick.fps / subState.fps - 1) >= 0.005) subState.scale = pick.fps / subState.fps;

    if (!subPlayerAlive(video)) { await subCloudPut(key, vtt).catch(() => {}); return; }
    attachSubtitleTrack(vtt, true);
    let saved = true;
    try { await subCloudPut(key, vtt); scheduleSyncSave(); } catch (error) { saved = false; console.error(error); showToast(error.message); }

    // Length check: does the subtitle fit this video?
    const end = lastCueEnd(vtt) * subState.scale;
    const length = video.duration;
    const bad = !pick.exact && Number.isFinite(length) && length > 600 && (end > length * 1.03 || end < length * 0.6);
    if (bad && !offered && subLogRead().length < SUB_DAILY_LIMIT && candidates.some((c) => !subTriedRead(key).includes(c.id))) {
      showToast("This subtitle's length doesn't match the video.");
      const again = window.confirm(`This subtitle ends at ${fmtClock(end)} but the video is ${fmtClock(length)} long, so it's probably a different cut.\n\nTry another version? (uses 1 more download)`);
      if (again) { subState.busy = false; await fetchSubtitlesFromOpenSubtitles(true, true); return; }
    } else if (saved) {
      const left = typeof info.remaining === "number" ? ` · ${info.remaining} download${info.remaining === 1 ? "" : "s"} left today` : "";
      showToast(pick.exact ? `Exact match for this file ✓${left}` : `Subtitles saved${subState.scale !== 1 ? " (frame rate corrected)" : ""}${left}`);
    }
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not get subtitles.");
  } finally {
    subState.busy = false;
    updateCcButton();
  }
}

// ---- Sync panel -----------------------------------------------------------------
function openSyncPanel() {
  const video = subState.video;
  if (!subCues()) { showToast("Subtitles are still loading — try again in a second."); return; }
  applySync(); // makes sure every cue remembers its original time
  closeSyncPanel();
  video.pause();
  const cues = [...subState.trackEl.track.cues].sort((x, y) => x._s - y._s);
  const t = video.currentTime;
  let nearest = 0;
  cues.forEach((c, i) => { if (Math.abs(c.startTime - t) < Math.abs(cues[nearest].startTime - t)) nearest = i; });
  let first = Math.max(0, nearest - 3);
  const PAGE = 7;

  const panel = document.createElement("div");
  panel.className = "player-sync-panel";
  const help = document.createElement("p");
  help.className = "player-sync-help";
  help.textContent = "Pause the moment a line starts being spoken, then tap that line below. Do it once near the start and once near the end for the best fit.";
  const list = document.createElement("div");
  const nav = document.createElement("div");
  nav.className = "player-sync-nav";
  const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "player-cc"; b.textContent = label; b.addEventListener("click", fn); return b; };

  function render() {
    list.replaceChildren();
    for (const cue of cues.slice(first, first + PAGE)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "player-sync-row";
      row.textContent = String(cue.text || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || "…";
      row.addEventListener("click", () => {
        if (addSyncPoint(cue._s, video.currentTime)) {
          closeSyncPanel();
          showToast(`Synced · ${subState.anchors.length} point${subState.anchors.length === 1 ? "" : "s"}`);
        }
      });
      list.append(row);
    }
  }
  nav.append(
    mk("▲ Earlier lines", () => { first = Math.max(0, first - PAGE); render(); }),
    mk("▼ Later lines", () => { first = Math.min(Math.max(0, cues.length - PAGE), first + PAGE); render(); }),
    mk("Reset sync", () => { subState.anchors = []; subState.shift = 0; applySync(); scheduleSyncSave(); closeSyncPanel(); showToast("Sync reset."); }),
    mk("Try another version", () => { closeSyncPanel(); fetchSubtitlesFromOpenSubtitles(true); }),
    mk("Close", closeSyncPanel),
  );
  panel.append(help, list, nav);
  playerStage.append(panel);
  subState.panel = panel;
  render();
}

ccButton.addEventListener("click", () => {
  if (subState.busy || !subState.video) return;
  const track = subState.trackEl?.track;
  if (track) {
    track.mode = track.mode === "showing" ? "hidden" : "showing";
    if (track.mode !== "showing") closeSyncPanel();
    updateCcButton();
  } else {
    fetchSubtitlesFromOpenSubtitles(false);
  }
});

function nudgeSubtitles(delta) {
  if (!subCues()) { showToast("Subtitles are still loading — try again in a second."); return; }
  subState.shift = Math.round((subState.shift + delta) * 10) / 10;
  applySync();
  scheduleSyncSave();
  showToast(`Fine-tune ${subState.shift > 0 ? "+" : ""}${subState.shift.toFixed(1)}s`);
}
subEarlier.addEventListener("click", () => nudgeSubtitles(-0.5));
subLater.addEventListener("click", () => nudgeSubtitles(0.5));
subSync.addEventListener("click", openSyncPanel);

// Know which subtitles are already saved as soon as the library loads.
refreshSubtitleIndex().catch(() => {});

// ===========================================================================
// Settings, home-banner rotation, favorites, home category, password gate
// ===========================================================================

// ---- Small SHA-256 (works everywhere, including plain file:// pages) -------
const SHA256_K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);

function sha256(data) {
  const length = data.length;
  const total = ((length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(total);
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(total - 8, Math.floor((length * 8) / 4294967296));
  view.setUint32(total - 4, (length * 8) >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, i) => outView.setUint32(i * 4, value >>> 0));
  return out;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---- Password gate for the settings menu -----------------------------------
// Only a salted, 20,000-round SHA-256 hash of the password lives in this file,
// never the password itself. Once entered correctly, a token derived from that
// hash is remembered in this browser so it isn't asked again.
const PW_SALT = "vora.v1.7f3a9c";
const PW_HASH = "e4fdaf66da7473d280cb4abaa96e3a4c6cad7ea6fd3db1ea758f6684b0f664f4";
const PW_ROUNDS = 20000;
const UNLOCK_KEY = "vora-settings-unlocked";
const LOCK_KEY = "vora-settings-lock";
let memoryUnlocked = false;
let passwordResolve = null;

const passwordDialog = document.querySelector("#password-dialog");
const passwordForm = document.querySelector("#password-form");
const passwordInput = document.querySelector("#password-input");
const passwordError = document.querySelector("#password-error");

function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = encoder.encode(PW_SALT);
  let hash = sha256(encoder.encode(`${PW_SALT}:${password}`));
  const buffer = new Uint8Array(32 + salt.length);
  buffer.set(salt, 32);
  for (let i = 0; i < PW_ROUNDS; i++) {
    buffer.set(hash, 0);
    hash = sha256(buffer);
  }
  return bytesToHex(hash);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unlockToken() {
  return bytesToHex(sha256(new TextEncoder().encode(`${PW_HASH}:remembered`)));
}

function isUnlocked() {
  if (memoryUnlocked) return true;
  try {
    if (safeEqual(localStorage.getItem(UNLOCK_KEY) || "", unlockToken())) {
      memoryUnlocked = true;
      return true;
    }
  } catch { /* storage unavailable */ }
  return false;
}

function readLockState() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "{}") || {}; } catch { return {}; }
}
function writeLockState(state) {
  try { localStorage.setItem(LOCK_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
function lockSecondsLeft() {
  return Math.max(0, Math.ceil(((readLockState().until || 0) - Date.now()) / 1000));
}

function requestUnlock() {
  if (isUnlocked()) return Promise.resolve(true);
  return new Promise((resolve) => {
    passwordResolve = resolve;
    passwordInput.value = "";
    const wait = lockSecondsLeft();
    passwordError.textContent = wait ? `Too many attempts. Try again in ${wait}s.` : "";
    passwordDialog.showModal();
    passwordInput.focus();
  });
}

passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const wait = lockSecondsLeft();
  if (wait) {
    passwordError.textContent = `Too many attempts. Try again in ${wait}s.`;
    return;
  }
  const attempt = passwordInput.value;
  passwordInput.value = "";
  if (safeEqual(hashPassword(attempt), PW_HASH)) {
    memoryUnlocked = true;
    try { localStorage.setItem(UNLOCK_KEY, unlockToken()); } catch { /* ignore */ }
    writeLockState({});
    passwordDialog.close();
    return;
  }
  const fails = (readLockState().fails || 0) + 1;
  const lockFor = fails >= 5 ? Math.min(600, 30 * (fails - 4)) : 0;
  writeLockState({ fails, until: lockFor ? Date.now() + lockFor * 1000 : 0 });
  passwordError.textContent = lockFor
    ? `Wrong password. Locked for ${lockFor} seconds.`
    : `Wrong password. ${5 - fails} ${5 - fails === 1 ? "try" : "tries"} left before a short lock.`;
  passwordInput.focus();
});
passwordDialog.querySelector(".dialog-close").addEventListener("click", () => passwordDialog.close());
passwordDialog.querySelector("#password-cancel").addEventListener("click", () => passwordDialog.close());
passwordDialog.addEventListener("click", (event) => {
  if (event.target === passwordDialog) passwordDialog.close();
});
passwordDialog.addEventListener("close", () => {
  passwordInput.value = "";
  if (passwordResolve) {
    const resolve = passwordResolve;
    passwordResolve = null;
    resolve(isUnlocked());
  }
});

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
  document.querySelector("#recent-row").replaceChildren(...items.map(createCard));
  document.querySelector("#recent-shelf").hidden = items.length === 0;
}

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

async function clearWatchedTags(items) {
  try {
    await Promise.all(
      items.map((item) => {
        item.lastPlayedAt = 0;
        return saveRecord(item);
      }),
    );
  } catch (error) {
    showToast(error.message || "Could not remove the tag.");
  }
  renderShelves();
  if (dialogItem) renderDialogMeta(dialogItem);
  showToast(items.length === 1 ? "Removed the Recently Watched tag" : `Removed ${items.length} Recently Watched tags`);
}

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

// ---- Posters from TMDB ----------------------------------------------------------
// Fills in the vertical poster (plus rating, year and age rating when missing) for
// titles that don't have one yet. Cards are updated in place, so scrolling rows never jump.
const POSTER_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
let enrichRunning = false;
let enrichTimer = 0;
const enrichSkipped = new Set();

function scheduleEnrich() {
  clearTimeout(enrichTimer);
  enrichTimer = setTimeout(enrichFromTmdb, 900);
}

async function enrichFromTmdb() {
  const key = getTmdbKey();
  if (!key || enrichRunning) return;
  const todo = customTitles.filter(
    (item) => !item.poster && !enrichSkipped.has(item.id) && Date.now() - (item.posterAt || 0) > POSTER_RETRY_MS,
  );
  if (!todo.length) return;
  enrichRunning = true;
  const api = (path, params = "") =>
    fetch(`https://api.themoviedb.org/3/${path}?api_key=${encodeURIComponent(key)}${params}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  try {
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async (item) => {
          try {
            const kind = item.type === "show" ? "tv" : "movie";
            let id = item.tmdbId;
            if (!id) {
              const found = (await api(`search/${kind}`, `&query=${encodeURIComponent(item.title)}&include_adult=false`)).results?.[0];
              id = found ? found.id : 0;
              if (id) item.tmdbId = id;
            }
            if (!id) {
              item.posterAt = Date.now();
              await saveRecord(item);
              return;
            }
            const detail = await api(`${kind}/${id}`, `&append_to_response=${kind === "tv" ? "content_ratings" : "release_dates"}`);
            if (detail.poster_path) item.poster = detail.poster_path;
            if (!item.rating && detail.vote_average) item.rating = detail.vote_average.toFixed(1);
            if (!item.year) item.year = (detail.release_date || detail.first_air_date || "").slice(0, 4);
            if (!item.cert) {
              const list = (kind === "tv" ? detail.content_ratings : detail.release_dates)?.results || [];
              const us = list.find((r) => r.iso_3166_1 === "US");
              item.cert = kind === "tv" ? us?.rating || "" : us?.release_dates?.find((r) => r.certification)?.certification || "";
            }
            if (!item.banner && detail.backdrop_path) item.banner = `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}`;
            if (!item.description && detail.overview) item.description = detail.overview.trim();
            item.posterAt = Date.now();
            await saveRecord(item);
            refreshCardArt(item);
          } catch (error) {
            enrichSkipped.add(item.id);
            console.warn("TMDB poster lookup failed:", error);
          }
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    enrichRunning = false;
  }
}

async function initialize() {

  const embedded = readEmbeddedLibrary();
  const embeddedTitles = embedded.titles.map(normalizeRecord);
  savedSignature = librarySignature(embeddedTitles);
  let importedCount = 0;
  try {
    titleDB = await openTitleDatabase();
    const records = await readAllRecords();
    importedCount = mergeEmbeddedTitles(records, embedded);
    customTitles = records
      .map(normalizeRecord)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(toCardItem);
    await Promise.all(customTitles.map(saveRecord));
  } catch (error) {
    console.error("Vora browser storage is unavailable:", error);
    titleDB = undefined;
    customTitles = embeddedTitles
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(toCardItem);
    showToast("Browser storage is unavailable — changes made this session won't be kept.");
  }
  renderShelves();
  if (settings.autoBackup) writeAutomaticBackup();
  if (importedCount) {
    showToast(
      `Loaded ${importedCount} title${importedCount === 1 ? "" : "s"} from this file`,
    );
  }
}

// Older versions stored WebDAV credentials in this browser; WebDAV is gone, so clear them.
try { localStorage.removeItem("vora-webdav-config"); } catch { /* storage unavailable */ }

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
    const hasData = item.favorite || item.watchlist || item.reaction || item.lastPlayedAt || item.progressSeconds ||
      (Array.isArray(item.episodes) && item.episodes.some((e) => e.progressSeconds || e.lastPlayedAt));
    if (!hasData) continue;
    kept[personalIdentity(item)] = {
      favorite: !!item.favorite, watchlist: !!item.watchlist, reaction: item.reaction || "",
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
    Object.assign(record, { favorite: saved.favorite, watchlist: saved.watchlist, reaction: saved.reaction,
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

// ===========================================================================
// Discover — outside-your-library browsing powered by TMDB
// ===========================================================================
// Vora genre -> TMDB genre id for movies / TV (null = TMDB has no TV equivalent)
const DISCOVER_GENRES = [
  { name: "Action", movie: 28, tv: 10759 }, { name: "Adventure", movie: 12, tv: 10759 },
  { name: "Animation", movie: 16, tv: 16 }, { name: "Comedy", movie: 35, tv: 35 },
  { name: "Crime", movie: 80, tv: 80 }, { name: "Documentary", movie: 99, tv: 99 },
  { name: "Drama", movie: 18, tv: 18 }, { name: "Family", movie: 10751, tv: 10751 },
  { name: "Fantasy", movie: 14, tv: 10765 }, { name: "History", movie: 36, tv: null },
  { name: "Horror", movie: 27, tv: null }, { name: "Music", movie: 10402, tv: null },
  { name: "Mystery", movie: 9648, tv: 9648 }, { name: "Romance", movie: 10749, tv: null },
  { name: "Science Fiction", movie: 878, tv: 10765 }, { name: "Thriller", movie: 53, tv: null },
  { name: "War", movie: 10752, tv: 10768 }, { name: "Western", movie: 37, tv: 37 },
  { name: "Reality", movie: null, tv: 10764 }, { name: "Kids", movie: null, tv: 10762 },
];

const discover = { token: 0, shelves: [], observer: null, heroIndex: 0, heroTimer: 0, heroBusy: false };
const discoverEls = {
  hero: document.querySelector("#discover-hero"),
  shelves: document.querySelector("#discover-shelves"),
  results: document.querySelector("#discover-results"),
  resultsRow: document.querySelector("#discover-results-row"),
  resultsTitle: document.querySelector("#discover-results-title"),
  none: document.querySelector("#discover-no-results"),
  note: document.querySelector("#discover-note"),
};
const DISCOVER_SEARCH_PLACEHOLDER = "Search Discover";
const defaultSearchPlaceholder = searchInput.placeholder;
const defaultSearchLabel = searchInput.getAttribute("aria-label");

async function discoverList(type, params) {
  const key = getTmdbKey();
  const query = new URLSearchParams({ api_key: key, language: "en-US", include_adult: "false", sort_by: "popularity.desc", page: "1", ...params });
  const response = await fetch(`https://api.themoviedb.org/3/discover/${type === "show" ? "tv" : "movie"}?${query}`);
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  const data = await response.json();
  return (data.results || []).map((rec) => ({ type, rec }));
}

function discoverEntry(entry) {
  const names = entry.type === "show" ? TMDB_TV_GENRES : TMDB_MOVIE_GENRES;
  const genres = (entry.rec.genre_ids || []).map((id) => names[id]).filter(Boolean);
  entry.key = `${entry.type}:${entry.rec.id}`;
  entry.title = entry.rec.title || entry.rec.name || "Untitled";
  entry.genres = genres;
  entry.year = (entry.rec.release_date || entry.rec.first_air_date || "").slice(0, 4);
  entry.searchItem = { title: entry.title, type: entry.type, genres, year: entry.year, episodes: [] };
  return entry;
}

// Merge movie + show lists by TMDB popularity, drop duplicates.
function mergeDiscover(lists, limit) {
  const seen = new Set();
  return lists.flat()
    .sort((a, b) => (b.rec.popularity || 0) - (a.rec.popularity || 0))
    .map(discoverEntry)
    .filter((e) => (seen.has(e.key) ? false : seen.add(e.key)))
    .slice(0, limit);
}

async function fetchTopTen() {
  // TMDB's worldwide "trending this week" list, kept in TMDB's own order.
  const response = await fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${encodeURIComponent(getTmdbKey())}&language=en-US`);
  if (!response.ok) throw new Error(`TMDB ${response.status}`);
  const data = await response.json();
  const seen = new Set();
  return (data.results || [])
    .filter((rec) => rec.media_type === "movie" || rec.media_type === "tv")
    .map((rec) => discoverEntry({ type: rec.media_type === "tv" ? "show" : "movie", rec }))
    .filter((e) => (seen.has(e.key) ? false : seen.add(e.key)))
    .slice(0, 10);
}

async function fetchGenreShelf(genre) {
  const params = { "vote_count.gte": "50" };
  const jobs = [];
  if (genre.movie) jobs.push(discoverList("movie", { ...params, with_genres: String(genre.movie) }));
  if (genre.tv) jobs.push(discoverList("show", { ...params, with_genres: String(genre.tv) }));
  return mergeDiscover(await Promise.all(jobs), 20);
}

function discoverInLibrary(entry) { return findLibraryMatch(entry.rec, entry.type); }

function createDiscoverCard(entry, rank = 0) {
  const { rec, type } = entry;
  const lib = discoverInLibrary(entry);
  const card = document.createElement("article");
  card.className = "title-card discover-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${rank ? `Number ${rank} worldwide: ` : ""}${entry.title}${lib ? " (in your library)" : ""}. Open details.`);
  const img = document.createElement("img");
  img.className = "card-image"; img.loading = "lazy"; img.alt = ""; img.draggable = false;
  if (rec.poster_path) img.src = `${TMDB_IMG}w342${rec.poster_path}`; else card.classList.add("no-art");
  card.append(img);
  if (rank) {
    const badge = document.createElement("span");
    badge.className = "rank-badge"; badge.textContent = String(rank);
    card.append(badge);
  }
  if (lib) {
    const tag = document.createElement("span");
    tag.className = "watched-badge lib-badge"; tag.textContent = "In your library";
    card.append(tag);
  }
  const copy = document.createElement("span");
  copy.className = "card-copy";
  const meta = [rec.vote_average ? `★ ${Number(rec.vote_average).toFixed(1)}` : "", entry.year].filter(Boolean).join("  ·  ");
  for (const [cls, txt] of [["card-title", entry.title], ["card-year", meta], ["card-tag", entry.genres.slice(0, 2).join(" · ")]]) {
    const el = document.createElement("span"); el.className = cls; el.textContent = txt; copy.append(el);
  }
  card.append(copy);
  const open = () => { const match = discoverInLibrary(entry); if (match) openTitleDialog(match); else openExternalRecommendation(rec, type); };
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } });
  return card;
}

function createDiscoverShelf(id, titleNode) {
  const section = document.createElement("section");
  section.className = "shelf discover-shelf";
  section.id = `discover-${id}`;
  const heading = document.createElement("div");
  heading.className = "shelf-heading";
  const textWrap = document.createElement("div");
  textWrap.append(titleNode);
  const controls = document.createElement("div");
  controls.className = "shelf-controls";
  for (const [direction, symbol] of [[-1, "‹"], [1, "›"]]) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "carousel-button";
    button.dataset.direction = String(direction); button.dataset.target = `discover-${id}-row`;
    button.setAttribute("aria-label", `Scroll ${direction < 0 ? "left" : "right"}`);
    button.textContent = symbol;
    controls.append(button);
  }
  heading.append(textWrap, controls);
  const row = document.createElement("div");
  row.className = "card-row"; row.id = `discover-${id}-row`;
  for (let n = 0; n < 8; n++) { const sk = document.createElement("div"); sk.className = "title-card skeleton-card"; row.append(sk); }
  section.append(heading, row);
  return { section, row };
}

function fillDiscoverShelf(shelf) {
  if (!shelf.entries) return;
  shelf.row.replaceChildren(...shelf.entries.map((entry, i) => createDiscoverCard(entry, shelf.ranked ? i + 1 : 0)));
  shelf.section.dataset.empty = shelf.entries.length ? "" : "1";
}

async function loadDiscoverShelf(shelf) {
  if (shelf.entries || shelf.loading) return;
  shelf.loading = true;
  const token = discover.token;
  try {
    const entries = await shelf.fetch();
    if (token !== discover.token) return;
    shelf.entries = entries;
    fillDiscoverShelf(shelf);
    if (shelf.id === "top") { discover.heroIndex = 0; renderDiscoverHero(); }
    if (discoverQuery().length) applyDiscoverSearch();
  } catch (error) {
    if (token !== discover.token) return;
    console.warn("Discover shelf failed:", shelf.id, error);
    shelf.entries = [];
    fillDiscoverShelf(shelf);
    if (shelf.id === "top") renderDiscoverHero();
  } finally { shelf.loading = false; }
}

function buildDiscover() {
  discover.token++;
  discover.observer?.disconnect();
  discover.shelves = [];
  discoverEls.shelves.replaceChildren();

  const h2 = document.createElement("h2");
  h2.textContent = "Top 10 in the World This Week";
  const top = createDiscoverShelf("top", h2);
  discover.shelves.push({ id: "top", ranked: true, fetch: fetchTopTen, entries: null, loading: false, ...top });
  discoverEls.shelves.append(top.section);

  for (const genre of DISCOVER_GENRES) {
    const title = document.createElement("h2"); title.textContent = genre.name;
    const built = createDiscoverShelf(genre.name.toLowerCase().replace(/\W+/g, "-"), title);
    discover.shelves.push({ id: genre.name, ranked: false, fetch: () => fetchGenreShelf(genre), entries: null, loading: false, ...built });
    discoverEls.shelves.append(built.section);
  }

  discover.observer = new IntersectionObserver((records) => {
    for (const record of records) {
      if (!record.isIntersecting) continue;
      const shelf = discover.shelves.find((s) => s.section === record.target);
      if (shelf) { discover.observer.unobserve(record.target); loadDiscoverShelf(shelf); }
    }
  }, { rootMargin: "700px 0px" });
  discover.shelves.forEach((shelf) => discover.observer.observe(shelf.section));
  renderDiscoverHero();
}

function discoverQuery() { return searchInput.value.trim().toLowerCase(); }

function applyDiscoverSearch() {
  const tokens = discoverQuery().split(/\s+/).filter(Boolean);
  document.body.classList.toggle("grid-mode", tokens.length > 0);
  const hasKey = !!getTmdbKey();
  if (!hasKey) { discoverEls.results.hidden = true; discoverEls.none.hidden = true; return; }
  if (!tokens.length) {
    discoverEls.results.hidden = true; discoverEls.none.hidden = true;
    discoverEls.shelves.hidden = false;
    return;
  }
  discoverEls.shelves.hidden = true;
  // Make sure every shelf is loaded so the whole Discover page is searchable.
  discover.shelves.forEach((shelf) => { if (!shelf.entries) loadDiscoverShelf(shelf); });
  const seen = new Set();
  const results = [];
  for (const shelf of discover.shelves) {
    for (const entry of shelf.entries || []) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      const score = searchScore(entry.searchItem, tokens);
      if (score > 0) results.push([entry, score]);
    }
  }
  results.sort((a, b) => b[1] - a[1] || a[0].title.localeCompare(b[0].title));
  const stillLoading = discover.shelves.some((s) => !s.entries);
  discoverEls.resultsRow.replaceChildren(...results.map(([entry]) => createDiscoverCard(entry)));
  discoverEls.results.hidden = results.length === 0;
  discoverEls.resultsTitle.textContent = `${results.length} result${results.length === 1 ? "" : "s"} for “${searchInput.value.trim()}”${stillLoading ? " · still loading…" : ""}`;
  discoverEls.none.hidden = results.length > 0 || stillLoading;
}

// ---- Discover hero (from the Top 10) ----------------------------------------
function discoverHeroPool() {
  const top = discover.shelves.find((s) => s.id === "top");
  return (top?.entries || []).filter((e) => e.rec.backdrop_path || e.rec.poster_path);
}

function renderDiscoverHero() {
  const hero = discoverEls.hero;
  const $ = (sel) => hero.querySelector(sel);
  const noKey = !getTmdbKey();
  const pool = discoverHeroPool();
  const dots = $("#dh-dots");
  if (noKey || !pool.length) {
    hero.classList.add("hero-empty");
    $("#dh-eyebrow").textContent = "Discover";
    $("#dh-title").textContent = noKey ? "Unlock Discover" : "Discover";
    $("#dh-title").classList.remove("featured-title");
    $("#dh-description").textContent = noKey
      ? "Discover uses TMDB to show what’s popular worldwide and in every genre. Add your free TMDB API key to start."
      : (discover.shelves.find((s) => s.id === "top")?.entries ? "Couldn’t load the Top 10 right now. Check your TMDB key and connection." : "Loading what’s popular…");
    $("#dh-meta").hidden = true;
    $("#dh-info").hidden = true;
    $("#dh-poster").hidden = true;
    $("#dh-action").hidden = !noKey;
    $("#dh-action-label").textContent = "Add TMDB key";
    $("#dh-action-icon").innerHTML = ICON_PLUS;
    hero.style.removeProperty("--hero-banner"); hero.style.removeProperty("--hero-poster");
    dots.hidden = true; dots.replaceChildren();
    syncDiscoverHeroTimer();
    return;
  }
  const entry = pool[discover.heroIndex % pool.length];
  const rank = discover.shelves.find((s) => s.id === "top").entries.indexOf(entry) + 1;
  const lib = discoverInLibrary(entry);
  hero.classList.remove("hero-empty");
  $("#dh-eyebrow").textContent = `#${rank} in the world this week`;
  $("#dh-title").textContent = entry.title;
  $("#dh-title").classList.add("featured-title");
  $("#dh-description").textContent = entry.rec.overview || "";
  $("#dh-description").hidden = !entry.rec.overview;
  const metaParts = [[entry.rec.vote_average ? `★ ${Number(entry.rec.vote_average).toFixed(1)}` : "", "m-rating"], [entry.year], [entry.type === "show" ? "Series" : "Movie"], [entry.genres.slice(0, 3).join(" · ")]].filter(([t]) => t);
  $("#dh-meta").replaceChildren(...metaParts.map(([text, cls]) => { const s = document.createElement("span"); s.textContent = text; if (cls) s.className = cls; return s; }));
  $("#dh-meta").hidden = false;
  const banner = entry.rec.backdrop_path ? `${TMDB_IMG}w1280${entry.rec.backdrop_path}` : `${TMDB_IMG}w780${entry.rec.poster_path}`;
  const poster = entry.rec.poster_path ? `${TMDB_IMG}w500${entry.rec.poster_path}` : banner;
  hero.style.setProperty("--hero-banner", `url("${banner}")`);
  hero.style.setProperty("--hero-poster", `url("${poster}")`);
  $("#dh-poster").hidden = false;
  $("#dh-poster").setAttribute("aria-label", `${entry.title} — open details`);

  const playable = lib && (lib.type === "show" || String(lib.driveUrl || "").trim());
  $("#dh-action").hidden = false;
  if (playable) {
    $("#dh-action-label").textContent = lib.type === "show" ? "Episodes" : "Play";
    $("#dh-action-icon").innerHTML = lib.type === "show" ? ICON_LIST : ICON_PLAY;
    $("#dh-info").hidden = false;
  } else {
    $("#dh-action-label").textContent = "More info";
    $("#dh-action-icon").innerHTML = ICON_INFO;
    $("#dh-info").hidden = true;
  }
  hero._entry = entry;
  dots.hidden = pool.length < 2;
  dots.replaceChildren(...pool.map((e, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hero-dot" + (e === entry ? " active" : "");
    dot.setAttribute("aria-label", `Show ${e.title}`);
    dot.addEventListener("click", () => { discover.heroIndex = i; renderDiscoverHero(); });
    return dot;
  }));
  syncDiscoverHeroTimer();
}

function syncDiscoverHeroTimer() {
  clearInterval(discover.heroTimer);
  discover.heroTimer = 0;
  if (document.body.classList.contains("discover-mode") && discoverHeroPool().length > 1) {
    discover.heroTimer = setInterval(rotateDiscoverHero, settings.banner.seconds * 1000);
  }
}

async function rotateDiscoverHero() {
  if (discover.heroBusy || document.hidden || document.querySelector("dialog[open]") || discoverQuery()) return;
  const pool = discoverHeroPool();
  if (pool.length < 2) return;
  const nextIndex = (discover.heroIndex + 1) % pool.length;
  const next = pool[nextIndex];
  discover.heroBusy = true;
  try {
    await preloadImage(next.rec.backdrop_path ? `${TMDB_IMG}w1280${next.rec.backdrop_path}` : "");
    discoverEls.hero.classList.add("hero-fade");
    await new Promise((resolve) => setTimeout(resolve, 350));
    discover.heroIndex = nextIndex;
    renderDiscoverHero();
    discoverEls.hero.classList.remove("hero-fade");
  } finally { discover.heroBusy = false; }
}

function openDiscoverHeroEntry() {
  const entry = discoverEls.hero._entry;
  if (!entry) return;
  const lib = discoverInLibrary(entry);
  if (lib) openTitleDialog(lib); else openExternalRecommendation(entry.rec, entry.type);
}
discoverEls.hero.querySelector("#dh-action").addEventListener("click", () => {
  if (!getTmdbKey()) { tmdbSettingsButton.click(); return; }
  const entry = discoverEls.hero._entry;
  const lib = entry && discoverInLibrary(entry);
  if (lib && lib.type === "movie" && String(lib.driveUrl || "").trim()) openMediaLink(resolveWatchUrl(lib.driveUrl), lib.title, lib);
  else openDiscoverHeroEntry();
});
discoverEls.hero.querySelector("#dh-info").addEventListener("click", openDiscoverHeroEntry);
discoverEls.hero.querySelector("#dh-poster").addEventListener("click", openDiscoverHeroEntry);

function enterDiscover() {
  document.body.classList.add("discover-mode");
  searchInput.placeholder = DISCOVER_SEARCH_PLACEHOLDER;
  searchInput.setAttribute("aria-label", "Search Discover");
  const hasKey = !!getTmdbKey();
  discoverEls.note.hidden = hasKey;
  discoverEls.shelves.hidden = !hasKey;
  if (!hasKey) { renderDiscoverHero(); return; }
  if (!discover.shelves.length) buildDiscover();
  else { discover.shelves.forEach(fillDiscoverShelf); renderDiscoverHero(); }
}
function exitDiscover() {
  document.body.classList.remove("discover-mode");
  searchInput.placeholder = defaultSearchPlaceholder;
  searchInput.setAttribute("aria-label", defaultSearchLabel);
  clearInterval(discover.heroTimer);
  discover.heroTimer = 0;
}
document.querySelector("#discover-add-key")?.addEventListener("click", () => tmdbSettingsButton.click());

addEpisodeRow();
updateTypeFields();
initialize();
