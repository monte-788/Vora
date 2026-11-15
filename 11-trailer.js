/* ========================================================================
   FILE: js/11-trailer.js

   WHAT IT DOES:
     Plays a YouTube trailer inside the banner, with a mute button and a
     fallback if the trailer can't be played.

   OPEN THIS FILE IF YOU WANT TO:
     change how trailers are found or played.
   ======================================================================== */

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
