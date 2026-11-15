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
      else if (!item.watched) { item.watched = true; item.watchedAt = Date.now(); }
      saveRecord(item).catch(() => {});
      renderShelves();
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
  clearPlayerStage();
  playerCurrentUrl = "";
  setWatching(null);
});
document.querySelector("#player-close").addEventListener("click", closePlayer);
document.querySelector("#player-newtab").addEventListener("click", () => {
  if (playerCurrentUrl) openMediaLinkInNewTab(playerCurrentUrl);
});
