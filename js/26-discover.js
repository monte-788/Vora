/* ========================================================================
   FILE: js/26-discover.js

   WHAT IT DOES:
     The Discover tab: browsing movies and shows from TMDB that are not in
     your library yet (Top 10, genre shelves, search, Discover banner).

   OPEN THIS FILE IF YOU WANT TO:
     change the Discover tab.
   ======================================================================== */

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
