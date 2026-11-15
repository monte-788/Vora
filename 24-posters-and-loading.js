/* ========================================================================
   FILE: js/24-posters-and-loading.js

   WHAT IT DOES:
     Fetches posters from TMDB in the background and defines initialize(),
     which loads your saved library when the app starts.

   OPEN THIS FILE IF YOU WANT TO:
     change how posters are fetched or how the library is loaded at
     startup.
   ======================================================================== */

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
    (item) => !enrichSkipped.has(item.id) && (
      (!item.poster && Date.now() - (item.posterAt || 0) > POSTER_RETRY_MS) ||
      (!item.runtime && !item.runtimeAt) // runtimes power the "Short" filter
    ),
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
              item.runtimeAt = Date.now();
              await saveRecord(item);
              return;
            }
            const detail = await api(`${kind}/${id}`, `&append_to_response=${kind === "tv" ? "content_ratings" : "release_dates"}`);
            if (detail.poster_path) item.poster = detail.poster_path;
            const runtime = kind === "tv" ? (detail.episode_run_time || [])[0] || detail.last_episode_to_air?.runtime : detail.runtime;
            if (runtime) item.runtime = Number(runtime);
            item.runtimeAt = Date.now();
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
    if (homeChips.short) applySearch();
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
