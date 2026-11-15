/* ========================================================================
   FILE: js/16-tmdb-key-and-autofill.js

   WHAT IT DOES:
     TMDB features: knowing whether TMDB is available, the Discover lock,
     and the automatic filling-in of missing banners, genres and
     descriptions (with a cache and request queue so TMDB isn't
     overloaded).

   OPEN THIS FILE IF YOU WANT TO:
     change what is auto-filled from TMDB or how often TMDB is
     asked.
   ======================================================================== */

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
// Rate limiting (40 requests per batch, 2 seconds between batches):
//   1. Every lookup result (including "no match found") is cached locally
//      by title+type for 30 days, so re-importing a title you've already
//      looked up — even in an earlier session — never costs a request.
//   2. Whatever's left after the cache is run through a queue that fires
//      at most 40 requests, then waits out the rest of that 10-second
//      window before sending the next 40 — so a 100-title import just
//      takes a few extra seconds instead of failing partway through.
// ---------------------------------------------------------------------

// The key itself stays on the server. getTmdbKey() only answers "is TMDB available?"
// (a placeholder string, never the real key) so the rest of the app can keep its checks.
// TMDB features (including Discover) are only available once settings have been unlocked.
function getTmdbKey() {
  return voraConfigured && voraConfig.tmdbAvailable && isUnlocked() ? "server" : "";
}

// Hides Discover until the password has been entered; syncLockedUi also refreshes TMDB-based rows.
function applyDiscoverLock() {
  const nav = document.querySelector('.nav-link[data-chip="discover"]');
  if (nav) nav.hidden = !isUnlocked();
  if (!isUnlocked() && activeFilter === "discover") setFilter("all");
}
function syncLockedUi() {
  applyDiscoverLock();
  if (typeof renderShelves === "function" && typeof customTitles !== "undefined") renderShelves();
}

// The menu's "TMDB key" item jumps to the key section in Advanced settings.
tmdbSettingsButton.addEventListener("click", async () => {
  await openAdvancedSettings();
  document.querySelector("#adv-tmdb-key-section")?.scrollIntoView({ block: "start" });
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

// Sends up to 40 TMDB requests at a time, then waits 2 seconds before the next batch.
const TMDB_BATCH_SIZE = 40;
const TMDB_BATCH_WAIT_MS = 2000;
const queueTmdbRequest = createRateLimitedQueue(TMDB_BATCH_SIZE, TMDB_BATCH_WAIT_MS);

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
// cache misses get queued, 40 at a time, 2 seconds apart.
// Manual TMDB matches (Advanced settings) are remembered by title in their own
// storage key. "Empty media library" never touches it, so a match you picked
// is re-applied when the same title is imported again.
const TMDB_MATCH_KEY = "vora-tmdb-matches";
function loadTmdbMatches() {
  try {
    const map = JSON.parse(localStorage.getItem(TMDB_MATCH_KEY) || "{}");
    return map && typeof map === "object" && !Array.isArray(map) ? map : {};
  } catch { return {}; }
}
function rememberTmdbMatch(item) {
  if (!item || !item.tmdbId) return;
  const map = loadTmdbMatches();
  map[personalIdentity(item)] = Number(item.tmdbId);
  try { localStorage.setItem(TMDB_MATCH_KEY, JSON.stringify(map)); } catch { /* storage full or unavailable */ }
}
function applyRememberedTmdbMatches(records) {
  const map = loadTmdbMatches();
  for (const record of records) {
    const id = Number(map[personalIdentity(record)]);
    if (id) record.tmdbId = id;
  }
}

async function enrichRecordsWithTmdb(newRecords, errors) {
  applyRememberedTmdbMatches(newRecords);
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
      `Looking up ${toFetch.length} titles on TMDB — this will take about ${Math.max(1, Math.ceil(toFetch.length / TMDB_BATCH_SIZE) - 1) * (TMDB_BATCH_WAIT_MS / 1000)} seconds…`,
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
