/* ========================================================================
   FILE: js/05-subtitles.js

   WHAT IT DOES:
     Community subtitles: uploading .srt/.vtt files, converting them to
     WebVTT, saving them on the server, and loading them into the player.

   OPEN THIS FILE IF YOU WANT TO:
     change how subtitles are uploaded, stored or shown.
   ======================================================================== */

// ---- Community subtitles ----------------------------------------------------
// Anyone can upload an .srt/.vtt for a title or episode; everyone can load it.
// Stored in the Supabase table "subtitles" (see subtitles.sql) and read/written
// through Supabase's REST API with the public key. Files are converted to WebVTT
// in the browser, so the player only ever deals with one format.
const SUBS_REST = VORA_API.replace(/\/functions\/v1\/.*$/, "/rest/v1/subtitles");
const subsPanel = document.querySelector("#subs-panel");
const subsList = document.querySelector("#subs-list");
const subsFile = document.querySelector("#subs-file");
const subsLabel = document.querySelector("#subs-label");
const subsLang = document.querySelector("#subs-lang");
const subsMsg = document.querySelector("#subs-msg");
let activeSubtitleUrl = "";
let activeSubtitleId = "";

function subsHeaders(extra = {}) {
  const headers = { apikey: VORA_ANON_KEY, ...extra };
  if (VORA_ANON_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${VORA_ANON_KEY}`;
  return headers;
}

// Same movie/episode => same key, whoever is watching.
function subtitleKey(item, episode) {
  if (!item) return "";
  const base = item.tmdbId
    ? `tmdb:${item.type}:${item.tmdbId}`
    : `title:${String(item.title || "").trim().toLowerCase()}:${item.year || ""}`;
  return episode ? `${base}:s${Number(episode.season) || 1}e${Number(episode.episode) || 1}` : base;
}

function decodeSubtitleBytes(buffer) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { return new TextDecoder("windows-1252").decode(buffer); } // older French/Spanish .srt files
}

function toVtt(text) {
  let t = String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!t.includes("-->")) throw new Error("That doesn't look like a subtitle file (.srt or .vtt).");
  if (/^WEBVTT/.test(t)) return t + "\n";
  t = t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, "$1.$2").replace(/\{\\an?\d\}/g, "");
  return "WEBVTT\n\n" + t + "\n";
}

async function subsFetchList(key) {
  const query = new URLSearchParams({ media_key: `eq.${key}`, select: "id,label,lang,created_at", order: "created_at.desc", limit: "50" });
  const response = await nativeFetch(`${SUBS_REST}?${query}`, { headers: subsHeaders() });
  if (!response.ok) throw new Error("Couldn't load subtitles.");
  return response.json();
}

async function subsFetchContent(id) {
  const query = new URLSearchParams({ id: `eq.${id}`, select: "content" });
  const response = await nativeFetch(`${SUBS_REST}?${query}`, { headers: subsHeaders() });
  if (!response.ok) throw new Error("Couldn't load that subtitle.");
  const rows = await response.json();
  return (rows[0] && rows[0].content) || "";
}

async function subsInsert(row) {
  const response = await nativeFetch(`${SUBS_REST}?select=id,label,lang`, {
    method: "POST",
    headers: subsHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error("Upload failed. The file may be too large (max ~600 KB).");
  const rows = await response.json();
  return rows[0];
}

function removeSubtitleTrack() {
  const video = playerStage.querySelector("video");
  if (video) video.querySelectorAll("track").forEach((track) => track.remove());
  if (activeSubtitleUrl) URL.revokeObjectURL(activeSubtitleUrl);
  activeSubtitleUrl = "";
  activeSubtitleId = "";
}

function applySubtitle(vtt, sub) {
  const video = playerStage.querySelector("video");
  if (!video) return;
  removeSubtitleTrack();
  activeSubtitleUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
  activeSubtitleId = sub.id;
  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = sub.label;
  track.srclang = sub.lang || "und";
  track.src = activeSubtitleUrl;
  track.default = true;
  video.append(track);
  track.track.mode = "showing";
  try { localStorage.setItem("vora-sub:" + playerSubKey, JSON.stringify({ id: sub.id, label: sub.label, lang: sub.lang })); } catch { /* ignore */ }
}

function resetSubtitlesUi() {
  removeSubtitleTrack();
  playerSubKey = "";
  if (subsPanel) subsPanel.hidden = true;
  if (subsMsg) subsMsg.textContent = "";
}

async function loadSubtitle(sub) {
  const key = playerSubKey;
  subsMsg.textContent = "Loading…";
  try {
    const content = await subsFetchContent(sub.id);
    if (key !== playerSubKey) return; // player was closed or changed meanwhile
    if (!content) throw new Error("That subtitle is empty.");
    applySubtitle(content, sub);
    subsMsg.textContent = "";
    renderSubsList(await subsFetchList(key).catch(() => []));
  } catch (error) {
    subsMsg.textContent = error.message;
  }
}

async function autoLoadSavedSubtitle() {
  const key = playerSubKey;
  if (!key) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("vora-sub:" + key) || "null"); } catch { /* ignore */ }
  if (!saved || !saved.id) return;
  try {
    const content = await subsFetchContent(saved.id);
    if (content && key === playerSubKey) applySubtitle(content, saved);
  } catch { /* subtitles are optional */ }
}

function renderSubsList(rows) {
  subsList.replaceChildren();
  const off = document.createElement("button");
  off.type = "button";
  off.className = "subs-item" + (activeSubtitleId ? "" : " active");
  off.textContent = "Off";
  off.addEventListener("click", () => {
    removeSubtitleTrack();
    try { localStorage.removeItem("vora-sub:" + playerSubKey); } catch { /* ignore */ }
    renderSubsList(rows);
  });
  subsList.append(off);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "subs-empty";
    empty.textContent = "No subtitles yet for this title. Be the first to upload one.";
    subsList.append(empty);
    return;
  }
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "subs-item" + (row.id === activeSubtitleId ? " active" : "");
    button.textContent = row.label; // textContent: uploaded names are never treated as HTML
    button.addEventListener("click", () => loadSubtitle(row));
    subsList.append(button);
  }
}

async function openSubsPanel() {
  if (!playerSubKey || !playerStage.querySelector("video")) {
    showToast("Subtitles work when the video plays directly in Vora.");
    return;
  }
  subsPanel.hidden = false;
  subsMsg.textContent = "";
  subsList.textContent = "Loading…";
  try {
    renderSubsList(await subsFetchList(playerSubKey));
  } catch (error) {
    subsList.textContent = "";
    subsMsg.textContent = error.message;
  }
}

document.querySelector("#player-subs").addEventListener("click", () => {
  if (subsPanel.hidden) openSubsPanel(); else subsPanel.hidden = true;
});
document.querySelector("#subs-close").addEventListener("click", () => { subsPanel.hidden = true; });
document.querySelector("#subs-upload-btn").addEventListener("click", () => subsFile.click());

subsFile.addEventListener("change", async () => {
  const file = subsFile.files && subsFile.files[0];
  subsFile.value = "";
  if (!file) return;
  const key = playerSubKey;
  try {
    if (file.size > 600000) throw new Error("That file is too big for a subtitle file.");
    const vtt = toVtt(decodeSubtitleBytes(await file.arrayBuffer()));
    const langName = subsLang.options[subsLang.selectedIndex].text;
    const label = (subsLabel.value.trim() || langName).slice(0, 60);
    subsMsg.textContent = "Uploading…";
    const saved = await subsInsert({ media_key: key, lang: subsLang.value, label, content: vtt });
    if (key !== playerSubKey) return;
    subsLabel.value = "";
    applySubtitle(vtt, saved);
    renderSubsList(await subsFetchList(key).catch(() => [saved]));
    subsMsg.textContent = "Uploaded. Everyone can load it now.";
  } catch (error) {
    subsMsg.textContent = error.message;
  }
});
