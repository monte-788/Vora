/* ========================================================================
   FILE: js/08-hero-search-and-shelves.js

   WHAT IT DOES:
     The big banner at the top (the 'hero'), the Movies/Shows filter,
     search, the Watchlist and 'Because you liked...' shelves, and the
     function that redraws all shelves.

   OPEN THIS FILE IF YOU WANT TO:
     change the top banner, how search ranks results, or which
     shelves appear.
   ======================================================================== */

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
  const chips = chipsActive();
  const browsing = tokens.length > 0 || activeFilter !== "all" || chips;
  document.body.classList.toggle("grid-mode", browsing);
  const resultsSection = document.querySelector("#search-results");
  const resultsRow = document.querySelector("#search-results-row");
  let visibleShelves = 0;
  let resultCount = 0;

  if (tokens.length || chips) {
    // One flat grid instead of filtering every shelf: ranked for searches, library order for chips.
    const pool = customTitles.filter(itemMatchesFilter).filter(itemMatchesChips);
    const results = tokens.length
      ? pool
        .map((item) => [item, searchScore(item, tokens)])
        .filter(([, score]) => score > 0)
        .sort((a, b) => b[1] - a[1] || String(a[0].title).localeCompare(String(b[0].title)))
        .map(([item]) => item)
      : pool;
    resultCount = results.length;
    resultsRow.replaceChildren(...results.map((item) => createCard(item)));
    resultsSection.hidden = results.length === 0;
    const base = `${results.length} ${tokens.length ? `result${results.length === 1 ? "" : "s"} for “${searchInput.value.trim()}”` : `title${results.length === 1 ? "" : "s"}`}`;
    document.querySelector("#search-results-title").textContent =
      chips ? `${base} · ${chipSummary()}` : base;
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
      else if (kind === "movie" || kind === "show") allowed = false; // Home uses the short rows instead
      const visibleCard = [...shelf.querySelectorAll(".title-card")].some((card) => !card.hidden);
      shelf.hidden = !allowed || !visibleCard;
      if (!shelf.hidden) visibleShelves++;
    });
  }
  document.querySelector("#library-empty").hidden = customTitles.length > 0 || !!query;
  const none = document.querySelector("#no-search-results");
  none.hidden = !(browsing && customTitles.length > 0 && (tokens.length || chips ? resultCount === 0 : visibleShelves === 0));
  none.textContent = tokens.length
    ? "No titles match your search."
    : chips
      ? (homeChips.short && !getTmdbKey() ? "Short uses runtimes from TMDB — add a TMDB key to use it." : "No titles match these filters.")
      : "Nothing in this category yet.";
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
  score += Math.min(10, Number(item.rating)||0) / 2;
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
  renderHomeRows();
  renderChipOptions();
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
