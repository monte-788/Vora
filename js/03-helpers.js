/* ========================================================================
   FILE: js/03-helpers.js

   WHAT IT DOES:
     Small tools used all over the app: pop-up messages (toasts), making
     ids and URL-friendly names, and working out the link that a Watch
     button should open.

   OPEN THIS FILE IF YOU WANT TO:
     change how messages look/behave or how watch links are built.
   ======================================================================== */

function showToast(message) {
  const toast = document.querySelector("#toast");
  // The player (and full screen) sit above the rest of the page, so show the message inside them.
  const player = document.querySelector("#player-dialog");
  const host = document.fullscreenElement || document.webkitFullscreenElement || (player && player.open ? player : document.body);
  if (toast.parentElement !== host) host.append(toast);
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
