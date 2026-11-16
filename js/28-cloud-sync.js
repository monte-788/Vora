/* ========================================================================
   FILE: js/28-cloud-sync.js

   WHAT IT DOES:
     Shared cloud sync for title tags. Whenever a title gets (or loses) one
     of these tags it is saved to Supabase straight away, and every other
     open Vora receives it live:
       - Watched
       - Recently watched
       - Liked / Disliked
       - Favorited
       - Watchlist
       - Continue watching (progress, also per episode)
     It also shares the TMDB title matches chosen in Advanced settings.
     Everyone using Vora shares the same tags (like the community subtitles).

   OPEN THIS FILE IF YOU WANT TO:
     change what gets synced, how often playback progress is sent
     (PROGRESS_PUSH_MS), or the sync rules.

   SETUP:
     Run cloud-sync.sql once in the Supabase SQL Editor.
   ======================================================================== */

const TAGS_REST = VORA_API.replace(/\/functions\/v1\/.*$/, "/rest/v1/vora_tags");
const TAGS_WS = VORA_API.replace(/^http/, "ws").replace(/\/functions\/v1\/.*$/, "/realtime/v1/websocket");
const TAGS_FIRST_SYNC_KEY = "vora-cloud-first-sync-done";
const TAGS_DIRTY_KEY = "vora-cloud-dirty";
const PROGRESS_PUSH_MS = 15000; // while watching, progress is sent at most this often (tag changes are always instant)

let cloudSyncOn = false;       // true once the first pull has finished
let cloudSyncBroken = false;   // true if the table is missing (setup not done)
const applyingItems = new Set(); // titles being updated from the cloud right now (so the change isn't sent back)
const tagSynced = new Map();   // title_key -> what the cloud last had (for this browser)
const tagTimers = new Map();   // title_key -> pending throttled progress push
const remoteRows = new Map();  // title_key -> latest row seen from the cloud
let pollTick = 0;
let tagDirty = new Set();      // keys with changes the cloud hasn't confirmed yet (survives reloads)
let tagLastMs = 0;             // newest updated_at received, used by the polling fallback
let cloudSocket = null, cloudSocketReady = false, cloudBeat = 0, cloudRetry = 0, cloudRetryMs = 1000, cloudPoll = 0;

try { tagDirty = new Set(JSON.parse(localStorage.getItem(TAGS_DIRTY_KEY) || "[]")); } catch { /* ignore */ }
function saveDirty() { try { localStorage.setItem(TAGS_DIRTY_KEY, JSON.stringify([...tagDirty])); } catch { /* ignore */ } }

// ---- Turning a title into a cloud row (and back) ---------------------------------------
function tagKey(item) { return subtitleKey(item); } // same movie/show => same key for everyone
function episodeKey(episode) { return `s${Number(episode.season) || 1}e${Number(episode.episode) || 1}`; }

function tagPayload(item) {
  const episodes = {};
  for (const episode of item.episodes || []) {
    if (episode.progressSeconds || episode.lastPlayedAt) {
      episodes[episodeKey(episode)] = { p: Number(episode.progressSeconds) || 0, d: Number(episode.durationSeconds) || 0, t: Number(episode.lastPlayedAt) || 0 };
    }
  }
  return {
    title_key: tagKey(item),
    watched: !!item.watched,
    watched_at: Number(item.watchedAt) || 0,
    favorite: !!item.favorite,
    watchlist: !!item.watchlist,
    reaction: item.reaction === "like" || item.reaction === "dislike" ? item.reaction : "",
    last_played_at: Number(item.lastPlayedAt) || 0,
    progress_seconds: Math.floor(Number(item.progressSeconds) || 0),
    duration_seconds: Math.floor(Number(item.durationSeconds) || 0),
    episodes,
  };
}
function tagsEmpty(p) {
  return !p.watched && !p.favorite && !p.watchlist && !p.reaction && !p.last_played_at && !p.progress_seconds && !Object.keys(p.episodes).length;
}
// The tags themselves (not the ticking progress numbers): when one of these changes we push instantly.
function tagFlags(p) {
  const inProgress = p.progress_seconds > 0 && p.duration_seconds > 0 && p.duration_seconds - p.progress_seconds > 300;
  const recent = p.last_played_at > 0 && Date.now() - p.last_played_at < RECENT_MS;
  return JSON.stringify([p.watched, p.favorite, p.watchlist, p.reaction, recent, inProgress]);
}

function applyTagRow(item, row) {
  item.watched = !!row.watched;
  item.watchedAt = Number(row.watched_at) || 0;
  item.favorite = !!row.favorite;
  item.watchlist = !!row.watchlist;
  item.reaction = row.reaction === "like" || row.reaction === "dislike" ? row.reaction : "";
  item.lastPlayedAt = Number(row.last_played_at) || 0;
  item.progressSeconds = Number(row.progress_seconds) || 0;
  item.durationSeconds = Number(row.duration_seconds) || 0;
  const map = row.episodes && typeof row.episodes === "object" ? row.episodes : {};
  for (const episode of item.episodes || []) {
    const m = map[episodeKey(episode)];
    episode.progressSeconds = m ? Number(m.p) || 0 : 0;
    episode.lastPlayedAt = m ? Number(m.t) || 0 : 0;
    if (m && Number(m.d)) episode.durationSeconds = Number(m.d);
  }
}
function rowAsPayload(row) {
  return { title_key: row.title_key, watched: !!row.watched, watched_at: Number(row.watched_at) || 0, favorite: !!row.favorite, watchlist: !!row.watchlist, reaction: row.reaction || "",
    last_played_at: Number(row.last_played_at) || 0, progress_seconds: Number(row.progress_seconds) || 0, duration_seconds: Number(row.duration_seconds) || 0,
    episodes: row.episodes && typeof row.episodes === "object" ? row.episodes : {} };
}
// Same text for the same data whatever the key order (the database reorders JSON keys).
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function rememberSynced(p) { tagSynced.set(p.title_key, { full: stable(p), flags: tagFlags(p) }); }

// ---- Sending changes to the cloud --------------------------------------------------
function cloudHeaders(extra = {}) { return subsHeaders({ "Content-Type": "application/json", ...extra }); }

async function pushTags(item, { keepalive = false } = {}) {
  const key = tagKey(item);
  clearTimeout(tagTimers.get(key)); tagTimers.delete(key);
  const payload = tagPayload(item);
  tagDirty.add(key); saveDirty();
  try {
    const send = (body) => nativeFetch(`${TAGS_REST}?on_conflict=title_key`, {
      method: "POST", keepalive,
      headers: cloudHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ ...body, updated_by: CLIENT_ID }),
    });
    let response = await send(payload);
    if (response.status === 400) { // the "watchlist" column isn't in the database yet (cloud-sync.sql not re-run): sync the rest meanwhile
      const { watchlist, ...withoutWatchlist } = payload;
      response = await send(withoutWatchlist);
    }
    if (response.status === 404) { cloudSyncMissing(); return false; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    rememberSynced(payload);
    tagDirty.delete(key); saveDirty();
    return true;
  } catch (error) {
    console.warn("Vora cloud sync: will retry", error); // stays in tagDirty, retried by the poll / when back online
    return false;
  }
}

// Called by saveRecord() every time a title is saved.
function cloudSyncAfterSave(record) {
  if (!cloudSyncOn || applyingItems.has(record) || !record || record.externalRecommendation) return;
  const key = tagKey(record);
  const payload = tagPayload(record);
  const last = tagSynced.get(key);

  // A title added after startup inherits the tags other people already gave it.
  if (!last && tagsEmpty(payload) && remoteRows.has(key)) { adoptRemote(record, remoteRows.get(key)); return; }
  if (!last && tagsEmpty(payload)) { rememberSynced(payload); return; }

  const full = stable(payload);
  if (last && last.full === full) return;
  if (!last || last.flags !== tagFlags(payload)) { pushTags(record); return; } // a tag changed: send right now
  if (tagTimers.has(key)) return;                                              // only progress moved: send every PROGRESS_PUSH_MS
  tagTimers.set(key, setTimeout(() => {
    const item = customTitles.find((t) => tagKey(t) === key) || record;
    pushTags(item);
  }, PROGRESS_PUSH_MS));
}

function flushCloudSync() {
  for (const [key, timer] of [...tagTimers]) {
    clearTimeout(timer); tagTimers.delete(key);
    const item = customTitles.find((t) => tagKey(t) === key);
    if (item) pushTags(item, { keepalive: true });
  }
}
function retryDirty() {
  if (cloudSyncOn && !matchesBroken) retryMatches();
  if (!cloudSyncOn || cloudSyncBroken) return;
  for (const key of [...tagDirty]) {
    const item = customTitles.find((t) => tagKey(t) === key);
    if (item) pushTags(item); else { tagDirty.delete(key); saveDirty(); }
  }
}

// ---- Receiving changes from the cloud ----------------------------------------------
function currentlyPlayingKey() { return String(playerSubKey || "").replace(/:s\d+e\d+$/, ""); }

async function adoptRemote(item, row) {
  applyingItems.add(item);
  try {
    applyTagRow(item, row);
    rememberSynced(rowAsPayload(row));
    await saveRecord(item);
  } catch (error) { console.warn("Vora cloud sync: could not save a synced change", error); }
  finally { applyingItems.delete(item); }
}
async function saveApplied(item) {
  applyingItems.add(item);
  try { await saveRecord(item); } catch { /* the in-memory copy is still updated */ } finally { applyingItems.delete(item); }
}

function refreshAfterRemote(changed) {
  renderShelves();
  if (dialogItem && changed.includes(dialogItem) && dialog.open) {
    renderDialogMeta(dialogItem);
    updateFavoriteButton(dialogItem);
    syncTasteButtons(dialogItem);
  }
}

function noteSeen(row) { const t = Date.parse(row && row.updated_at); if (t > tagLastMs) tagLastMs = t; }

async function handleRemoteRow(row) {
  if (!row || !row.title_key) return;
  noteSeen(row);
  remoteRows.set(row.title_key, row);
  if (row.updated_by === CLIENT_ID) return;                 // our own change coming back
  const item = customTitles.find((t) => tagKey(t) === row.title_key);
  if (!item) return;                                        // not in this library (kept for when it's added)
  if (currentlyPlayingKey() === row.title_key) return;      // don't fight the title being played right now
  const last = tagSynced.get(row.title_key);
  const incoming = stable(rowAsPayload(row));
  if (last && last.full === incoming) return;
  await adoptRemote(item, row);
  refreshAfterRemote([item]);
}

// First sync on this browser merges (nothing is lost); after that the cloud is the truth.
function mergeFirstSync(item, row) {
  const local = tagPayload(item);
  const mine = Number(local.last_played_at) || 0, theirs = Number(row.last_played_at) || 0;
  const newer = mine > theirs ? local : rowAsPayload(row);
  return {
    ...newer,
    title_key: local.title_key,
    watched: local.watched || !!row.watched,
    watched_at: Math.max(local.watched_at, Number(row.watched_at) || 0),
    favorite: local.favorite || !!row.favorite,
    watchlist: local.watchlist || !!row.watchlist,
    reaction: row.reaction || local.reaction,
    last_played_at: Math.max(mine, theirs),
  };
}

async function pullAllTags() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const query = new URLSearchParams({ select: "*", order: "updated_at.asc" });
    const response = await nativeFetch(`${TAGS_REST}?${query}`, { headers: cloudHeaders({ Range: `${from}-${from + 999}`, "Range-Unit": "items" }) });
    if (response.status === 404) { cloudSyncMissing(); return null; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function startCloudSync() {
  if (!voraConfigured || cloudSyncOn) return;
  await syncMatchesAtStart(); // first: tags are filed under a title's TMDB id, so matches must be applied before them
  let rows;
  try { rows = await pullAllTags(); }
  catch (error) { console.warn("Vora cloud sync: could not reach the cloud, retrying", error); setTimeout(startCloudSync, 10000); return; }
  if (!rows) return;

  const firstTime = !localStorage.getItem(TAGS_FIRST_SYNC_KEY);
  for (const row of rows) { remoteRows.set(row.title_key, row); noteSeen(row); }

  const toPush = [];
  const changed = [];
  try {
    for (const item of customTitles) {
      const key = tagKey(item);
      const row = remoteRows.get(key);
      const local = tagPayload(item);
      if (!row) {                                    // nobody has tagged it yet: share what this browser has
        if (tagsEmpty(local)) rememberSynced(local); else toPush.push(item);
        continue;
      }
      if (tagDirty.has(key)) { toPush.push(item); continue; }   // offline changes made here win
      if (firstTime) {
        const merged = mergeFirstSync(item, row);
        const before = stable(local);
        applyTagRow(item, merged);
        if (stable(tagPayload(item)) !== stable(rowAsPayload(row))) toPush.push(item);
        else rememberSynced(rowAsPayload(row));
        if (stable(tagPayload(item)) !== before) { changed.push(item); await saveApplied(item); }
        continue;
      }
      if (stable(local) !== stable(rowAsPayload(row))) { applyTagRow(item, row); changed.push(item); await saveApplied(item); }
      rememberSynced(rowAsPayload(row));
    }
  } catch (error) { console.warn("Vora cloud sync: first sync problem", error); }

  cloudSyncOn = true;
  try { localStorage.setItem(TAGS_FIRST_SYNC_KEY, "1"); } catch { /* ignore */ }
  if (changed.length) refreshAfterRemote(changed);
  for (const item of toPush) pushTags(item);
  retryDirty();
  connectCloudSocket();
  clearInterval(cloudPoll);
  cloudPoll = setInterval(pollTags, 10000);
}

function cloudSyncMissing() {
  if (cloudSyncBroken) return;
  cloudSyncBroken = true; cloudSyncOn = false;
  console.warn("Vora cloud sync: the vora_tags table doesn't exist yet. Run cloud-sync.sql in the Supabase SQL Editor.");
  showToast("Cloud sync isn't set up yet — run cloud-sync.sql in Supabase.");
}

// Safety net: also asks for new changes now and then, so sync still works if the live connection drops.
async function pollTags() {
  if (!cloudSyncOn || document.hidden) return;
  retryDirty();
  if (cloudSocketReady && ++pollTick % 6 !== 0) return; // live connection healthy: only double-check about once a minute
  try {
    const query = new URLSearchParams({ select: "*", order: "updated_at.asc", limit: "500" });
    if (tagLastMs) query.set("updated_at", `gt.${new Date(tagLastMs).toISOString()}`);
    const response = await nativeFetch(`${TAGS_REST}?${query}`, { headers: cloudHeaders() });
    if (!response.ok) return;
    for (const row of await response.json()) await handleRemoteRow(row);
  } catch { /* offline: try again next time */ }
  if (matchesBroken) return;
  try {
    for (const row of (await pullMatchRows(matchLastMs)) || []) await handleRemoteMatch(row);
  } catch { /* offline: try again next time */ }
}

// ---- TMDB title matches (Advanced settings) -----------------------------------------
// A match picked by anyone is saved to "vora_tmdb_matches" and applied to everyone's copy of that title.
const MATCH_REST = VORA_API.replace(/\/functions\/v1\/.*$/, "/rest/v1/vora_tmdb_matches");
const MATCH_DIRTY_KEY = "vora-cloud-dirty-matches";
let matchesBroken = false, applyingMatch = false, matchLastMs = 0;
let matchDirty = new Set();
try { matchDirty = new Set(JSON.parse(localStorage.getItem(MATCH_DIRTY_KEY) || "[]")); } catch { /* ignore */ }
function saveMatchDirty() { try { localStorage.setItem(MATCH_DIRTY_KEY, JSON.stringify([...matchDirty])); } catch { /* ignore */ } }

function matchPayload(item) {
  const web = (value) => (/^https?:\/\//.test(String(value || "")) ? value : ""); // never upload big embedded images
  return {
    identity: personalIdentity(item),
    tmdb_id: Number(item.tmdbId) || 0,
    meta: { year: item.year || "", rating: item.rating || "", banner: web(item.banner), poster: item.poster || "", description: item.description || "", genres: (item.genres || []).slice(0, 2) },
  };
}

async function pushMatch(item) {
  if (matchesBroken || !item || !item.tmdbId) return false;
  const payload = matchPayload(item);
  matchDirty.add(payload.identity); saveMatchDirty();
  try {
    const response = await nativeFetch(`${MATCH_REST}?on_conflict=identity`, {
      method: "POST", headers: cloudHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ ...payload, updated_by: CLIENT_ID }),
    });
    if (response.status === 404) { matchesMissing(); return false; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    matchDirty.delete(payload.identity); saveMatchDirty();
    return true;
  } catch (error) { console.warn("Vora cloud sync: match will retry", error); return false; }
}

// Called by rememberTmdbMatch() when a match is chosen in Advanced settings.
function cloudSyncTmdbMatch(item) {
  if (applyingMatch || !item || !item.tmdbId) return;
  pushMatch(item);
}
function retryMatches() {
  for (const identity of [...matchDirty]) {
    const item = customTitles.find((t) => personalIdentity(t) === identity);
    if (item) pushMatch(item); else { matchDirty.delete(identity); saveMatchDirty(); }
  }
}
function matchesMissing() {
  if (matchesBroken) return;
  matchesBroken = true;
  console.warn("Vora cloud sync: the vora_tmdb_matches table doesn't exist yet. Run the newest cloud-sync.sql in Supabase.");
  showToast("TMDB match sync isn't set up yet — run cloud-sync.sql again in Supabase.");
}
function noteMatchSeen(row) { const t = Date.parse(row && row.updated_at); if (t > matchLastMs) matchLastMs = t; }

async function pullMatchRows(sinceMs = 0) {
  const query = new URLSearchParams({ select: "*", order: "updated_at.asc", limit: "1000" });
  if (sinceMs) query.set("updated_at", `gt.${new Date(sinceMs).toISOString()}`);
  const response = await nativeFetch(`${MATCH_REST}?${query}`, { headers: cloudHeaders() });
  if (response.status === 404) { matchesMissing(); return null; }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchTagRow(key) {
  try {
    const query = new URLSearchParams({ select: "*", title_key: `eq.${key}`, limit: "1" });
    const response = await nativeFetch(`${TAGS_REST}?${query}`, { headers: cloudHeaders() });
    if (!response.ok) return null;
    const row = (await response.json())[0] || null;
    if (row) remoteRows.set(key, row);
    return row;
  } catch { return null; }
}

// Applies one shared match to every title of that name in this library. Returns the titles that changed.
async function applyMatchRow(row) {
  if (!row || !row.identity || !Number(row.tmdb_id)) return [];
  noteMatchSeen(row);
  const id = Number(row.tmdb_id);
  const map = loadTmdbMatches();                      // also remembered for future imports on this browser
  if (Number(map[row.identity]) !== id) { map[row.identity] = id; try { localStorage.setItem(TMDB_MATCH_KEY, JSON.stringify(map)); } catch { /* ignore */ } }
  const changed = [];
  for (const item of customTitles) {
    if (personalIdentity(item) !== row.identity || Number(item.tmdbId) === id) continue;
    const m = row.meta && typeof row.meta === "object" ? row.meta : {};
    item.tmdbId = id;
    if (m.year) item.year = m.year;
    if (m.rating) item.rating = m.rating;
    if (m.banner) item.banner = m.banner;
    if (m.poster) { item.poster = m.poster; item.posterAt = Date.now(); } else { item.poster = ""; item.posterAt = 0; } // posters are re-fetched when missing
    if (m.description) item.description = m.description;
    if (Array.isArray(m.genres) && m.genres.length) item.genres = m.genres.slice(0, 2);
    item.cast = null; item.castAt = 0; item.runtime = 0; item.runtimeAt = 0; item.detailsAt = Date.now(); // belonged to the old match
    // Tags are filed under the title's TMDB id, so they now live under the new key.
    let tagRow = remoteRows.get(tagKey(item));
    if (!tagRow && cloudSyncOn) tagRow = await fetchTagRow(tagKey(item)); // the tags may not have reached us yet
    if (tagRow) { applyTagRow(item, tagRow); rememberSynced(rowAsPayload(tagRow)); }
    applyingMatch = true;
    try { await saveApplied(item); } finally { applyingMatch = false; }
    if (!tagRow && cloudSyncOn && !tagsEmpty(tagPayload(item))) pushTags(item);
    changed.push(item);
  }
  return changed;
}

function refreshAfterMatch(changed) {
  if (!changed.length) return;
  renderShelves();
  for (const item of changed) { if (typeof refreshCardArt === "function") refreshCardArt(item); }
  if (dialogItem && changed.includes(dialogItem) && dialog.open) { renderDialogMeta(dialogItem); updateFavoriteButton(dialogItem); syncTasteButtons(dialogItem); }
  if (typeof advancedDialog !== "undefined" && advancedDialog.open) {
    if (typeof renderTmdbTitleSelect === "function") renderTmdbTitleSelect();
    if (typeof renderAdvancedIfOpen === "function") renderAdvancedIfOpen();
  }
  if (typeof scheduleEnrich === "function") scheduleEnrich();
}

async function handleRemoteMatch(row) {
  if (row && row.updated_by === CLIENT_ID) { noteMatchSeen(row); return; }
  refreshAfterMatch(await applyMatchRow(row));
}

// First sync: take everyone's matches, and share the ones only this browser has.
async function syncMatchesAtStart() {
  let rows;
  try { rows = await pullMatchRows(); } catch (error) { console.warn("Vora cloud sync: couldn't load TMDB matches", error); return; }
  if (!rows) return;
  const changed = [];
  const known = new Set();
  for (const row of rows) { known.add(row.identity); changed.push(...(await applyMatchRow(row))); }
  const local = loadTmdbMatches();
  for (const item of customTitles) {
    const identity = personalIdentity(item);
    if ((!known.has(identity) && item.tmdbId && Number(local[identity]) === Number(item.tmdbId)) || matchDirty.has(identity)) pushMatch(item);
  }
  refreshAfterMatch(changed);
}

// ---- Live connection (Supabase Realtime) -------------------------------------------
function connectCloudSocket() {
  if (cloudSocket || cloudSyncBroken || !window.WebSocket) return;
  let socket;
  try { socket = new WebSocket(`${TAGS_WS}?apikey=${encodeURIComponent(VORA_ANON_KEY)}&vsn=1.0.0`); } catch { return; }
  cloudSocket = socket;
  let ref = 0;
  const send = (topic, event, payload) => { if (socket.readyState === 1) socket.send(JSON.stringify({ topic, event, payload, ref: String(++ref), join_ref: "1" })); };

  socket.addEventListener("open", () => {
    const config = { broadcast: { ack: false, self: false }, presence: { key: "" }, postgres_changes: [{ event: "*", schema: "public", table: "vora_tags" }, { event: "*", schema: "public", table: "vora_tmdb_matches" }], private: false };
    const join = { config };
    if (VORA_ANON_KEY.startsWith("eyJ")) join.access_token = VORA_ANON_KEY;
    send("realtime:vora-tags", "phx_join", join);
    clearInterval(cloudBeat);
    cloudBeat = setInterval(() => send("phoenix", "heartbeat", {}), 25000);
  });
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.event === "phx_reply" && message.topic === "realtime:vora-tags") {
      cloudSocketReady = message.payload && message.payload.status === "ok";
      if (cloudSocketReady) { cloudRetryMs = 1000; pollTags(); } // catch up on anything missed while connecting
    } else if (message.event === "postgres_changes") {
      const data = message.payload && message.payload.data;
      if (data && (data.type === "INSERT" || data.type === "UPDATE") && data.record) {
        if (data.table === "vora_tmdb_matches") handleRemoteMatch(data.record); else handleRemoteRow(data.record);
      }
    }
  });
  const dropped = () => {
    if (cloudSocket !== socket) return;
    cloudSocket = null; cloudSocketReady = false; clearInterval(cloudBeat);
    clearTimeout(cloudRetry);
    cloudRetry = setTimeout(connectCloudSocket, cloudRetryMs);
    cloudRetryMs = Math.min(cloudRetryMs * 2, 30000);
  };
  socket.addEventListener("close", dropped);
  socket.addEventListener("error", () => { try { socket.close(); } catch { /* ignore */ } });
}

window.addEventListener("online", () => { retryDirty(); pollTags(); if (!cloudSocket) connectCloudSocket(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) flushCloudSync(); else { pollTags(); if (!cloudSocket) connectCloudSocket(); } });
window.addEventListener("pagehide", flushCloudSync);
