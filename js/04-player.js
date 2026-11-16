/* ========================================================================
   FILE: js/04-player.js

   WHAT IT DOES:
     The built-in video player, plus the rules for what counts as
     'watched', 'in progress', 'short', 'recently added', and the decade of
     a title.

   OPEN THIS FILE IF YOU WANT TO:
     change the player behaviour or the rules that decide
     watched/short/recent (e.g. what 'Short' means).
   ======================================================================== */

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
let playerSubKey = ""; // identifies the movie/episode being played, for community subtitles

// ---- Player extras: playback speed, auto next episode, full screen, keyboard shortcuts ----
const playerSpeedSelect = document.querySelector("#player-speed");
const playerAutoNextButton = document.querySelector("#player-autonext");
const playerFullscreenButton = document.querySelector("#player-fullscreen");
const PLAYER_RATE_KEY = "vora-player-rate";
const PLAYER_AUTONEXT_KEY = "vora-auto-next";
const UP_NEXT_SECONDS = 5;
let upNextTimer = 0;

function savedPlayerRate() {
  let rate = 1;
  try { rate = Number(localStorage.getItem(PLAYER_RATE_KEY)) || 1; } catch { /* ignore */ }
  return Math.min(4, Math.max(0.25, rate));
}
function autoNextEnabled() {
  try { return localStorage.getItem(PLAYER_AUTONEXT_KEY) !== "0"; } catch { return true; } // on by default
}
function syncAutoNextButton() {
  const on = autoNextEnabled();
  playerAutoNextButton.textContent = `Auto-next: ${on ? "On" : "Off"}`;
  playerAutoNextButton.setAttribute("aria-pressed", String(on));
}
function syncSpeedSelect(rate) {
  const value = String(rate);
  if (![...playerSpeedSelect.options].some((o) => o.value === value)) {
    const option = document.createElement("option");
    option.value = value; option.textContent = `${rate}×`;
    playerSpeedSelect.append(option);
  }
  playerSpeedSelect.value = value;
}
function setPlayerRate(rate) {
  try { localStorage.setItem(PLAYER_RATE_KEY, String(rate)); } catch { /* ignore */ }
  const video = playerStage.querySelector("video");
  if (video) { video.defaultPlaybackRate = rate; video.playbackRate = rate; }
  syncSpeedSelect(rate);
}
playerSpeedSelect.addEventListener("change", () => { setPlayerRate(Number(playerSpeedSelect.value) || 1); playerSpeedSelect.blur(); });
playerAutoNextButton.addEventListener("click", () => {
  try { localStorage.setItem(PLAYER_AUTONEXT_KEY, autoNextEnabled() ? "0" : "1"); } catch { /* ignore */ }
  syncAutoNextButton();
  if (!autoNextEnabled()) cancelUpNext();
  showToast(autoNextEnabled() ? "Auto-next episode on" : "Auto-next episode off");
});
syncAutoNextButton();
syncSpeedSelect(savedPlayerRate());

// Full screen is applied to the whole player area (not just the <video>), so subtitles and
// the "Up next" card stay visible, and full screen carries on from one episode to the next.
function togglePlayerFullscreen() {
  const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  const request = playerStage.requestFullscreen || playerStage.webkitRequestFullscreen;
  if (request) { Promise.resolve(request.call(playerStage)).catch(() => showToast("Full screen isn't available here.")); return; }
  const video = playerStage.querySelector("video"); // iPhone Safari only supports full screen on the video itself
  if (video && video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  else showToast("Full screen isn't available here.");
}
playerFullscreenButton.addEventListener("click", togglePlayerFullscreen);

function nextEpisodeOf(item, episode) {
  if (!item || !episode || item.type !== "show") return null;
  const list = sortEpisodes(item.episodes || []).filter((e) => String(e.driveUrl || "").trim());
  const index = list.findIndex((e) => e.season === episode.season && e.episode === episode.episode);
  return index >= 0 ? list[index + 1] || null : null;
}
function cancelUpNext() {
  clearInterval(upNextTimer); upNextTimer = 0;
  const card = playerStage.querySelector(".player-upnext");
  if (card) card.remove();
}
function playEpisode(item, episode) {
  openMediaLink(resolveWatchUrl(episode.driveUrl), `${item.title} · S${episode.season} E${episode.episode}`, item, episode);
}
function showUpNext(item, next) {
  cancelUpNext();
  let left = UP_NEXT_SECONDS;
  const card = document.createElement("div");
  card.className = "player-upnext";
  const label = document.createElement("div");
  label.className = "player-upnext-text";
  const buttons = document.createElement("div");
  buttons.className = "player-upnext-buttons";
  const playNow = document.createElement("button");
  playNow.type = "button"; playNow.className = "player-upnext-play"; playNow.textContent = "Play now";
  const cancel = document.createElement("button");
  cancel.type = "button"; cancel.className = "player-upnext-cancel"; cancel.textContent = "Cancel";
  buttons.append(playNow, cancel);
  card.append(label, buttons);
  playerStage.append(card);
  const draw = () => { label.textContent = `Up next: S${next.season} E${next.episode} · ${next.title || "Episode"} — playing in ${left}s`; };
  draw();
  playNow.addEventListener("click", () => playEpisode(item, next));
  cancel.addEventListener("click", cancelUpNext);
  upNextTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) { playEpisode(item, next); return; } // openMediaLink clears this card and timer
    draw();
  }, 1000);
}

document.addEventListener("keydown", (event) => {
  if (!playerDialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target && (target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable ||
    (target.tagName === "INPUT" && target.type !== "range" && target.type !== "checkbox"))) return; // don't steal typing
  const key = event.key;
  if (key === "f" || key === "F") { event.preventDefault(); togglePlayerFullscreen(); }
  else if (key === "c" || key === "C") { event.preventDefault(); toggleSubtitlesShortcut(); }
  else if (key === "+" || key === "=" || event.code === "NumpadAdd") { event.preventDefault(); changeSubtitleSize(1); }
  else if (key === "-" || key === "_" || event.code === "NumpadSubtract") { event.preventDefault(); changeSubtitleSize(-1); }
});

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
  const toast = document.querySelector("#toast"); // keep the message box alive when the stage is emptied
  if (toast && playerStage.contains(toast)) document.body.append(toast);
  cancelUpNext();
  resetSubtitlesUi();
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
// ---- Watched state & Home filters ------------------------------------------------
const HOME_ROW_LIMIT = 12;
const SURPRISE_COUNT = 8;
const GENRE_ROW_LIMIT = 8;
const GENRE_SUGGESTIONS = 6;
const RECENT_ADDED_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_MOVIE_MIN = 100;
const SHORT_SHOW_MIN = 30;

// "Started" = marked watched, played at all, or has episode progress.
function isStarted(item) {
  if (!item) return false;
  return !!item.watched || Number(item.lastPlayedAt) > 0 || Number(item.progressSeconds) > 0 ||
    (item.episodes || []).some((e) => Number(e.lastPlayedAt) > 0 || Number(e.progressSeconds) > 0);
}
function isUnwatched(item) { return !isStarted(item); }
function runtimeMinutes(item) {
  const r = Number(item.runtime) || 0;
  if (r) return r;
  const d = Number(item.durationSeconds) || 0;
  return item.type === "movie" && d ? Math.round(d / 60) : 0;
}
function isShort(item) {
  const m = runtimeMinutes(item);
  if (!m) return false;
  return item.type === "show" ? m <= SHORT_SHOW_MIN : m <= SHORT_MOVIE_MIN;
}
function isRecentlyAdded(item) {
  const t = Date.parse(item.createdAt);
  return Number.isFinite(t) && Date.now() - t < RECENT_ADDED_MS;
}
function decadeOf(item) {
  const y = parseInt(item.year, 10);
  return y >= 1900 ? Math.floor(y / 10) * 10 : 0;
}
function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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
  playerSubKey = subtitleKey(item, episode);
  setWatching(item, episode);

  const direct = directVideoUrl(url);
  playerSpeedSelect.hidden = !direct;
  playerAutoNextButton.hidden = !(direct && item && item.type === "show");
  if (direct) {
    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = "auto";
    video.referrerPolicy = "no-referrer";
    video.setAttribute("controlsList", "nofullscreen"); // Chrome/Edge: use F / the Full screen button so subtitles & "Up next" stay on screen
    const rate = savedPlayerRate();
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
    video.addEventListener("loadedmetadata", () => { video.playbackRate = savedPlayerRate(); });
    video.addEventListener("ratechange", () => syncSpeedSelect(video.playbackRate)); // also follows the browser's own speed menu
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
      else if (!item.watched) { item.watched = true; item.watchedAt = Date.now(); }
      saveRecord(item).catch(() => {});
      renderShelves();
      const next = autoNextEnabled() ? nextEpisodeOf(item, episode) : null;
      if (next) showUpNext(item, next);
    });
    video.src = direct;
    playerStage.append(video);
    autoLoadSavedSubtitle();
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
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  clearPlayerStage();
  if (typeof flushCloudSync === "function") flushCloudSync(); // send the latest "continue watching" position right away
  playerCurrentUrl = "";
  setWatching(null);
});
document.querySelector("#player-close").addEventListener("click", closePlayer);
document.querySelector("#player-newtab").addEventListener("click", () => {
  if (playerCurrentUrl) openMediaLinkInNewTab(playerCurrentUrl);
});
