/* ========================================================================
   FILE: js/09-title-details.js

   WHAT IT DOES:
     Inside the title page: the episode list, the season picker, removing
     an episode, and loading extra details from TMDB.

   OPEN THIS FILE IF YOU WANT TO:
     change what the title page shows about episodes and details.
   ======================================================================== */

function sortEpisodes(episodes) {
  return [...episodes].sort(
    (a, b) => a.season - b.season || a.episode - b.episode,
  );
}

function makeEpisodeButton(episode, item) {
  const card = document.createElement("div");
  card.className = "episode-card";
  const play = document.createElement("button");
  play.type = "button";
  play.className = "episode-card-watch";
  const thumb = document.createElement("span");
  thumb.className = "episode-thumb";
  const thumbImage = episode.still || item.banner;
  if (thumbImage) thumb.style.backgroundImage = `url("${thumbImage}")`;
  thumb.innerHTML = ICON_PLAY;
  const label = document.createElement("span");
  label.className = "episode-label";
  label.textContent = `${episode.episode}. ${episode.title}`;
  play.append(thumb, label);
  // An episode without a watch link stays in the library but is not playable.
  play.hidden = !String(episode.driveUrl || "").trim();
  if (play.hidden) play.setAttribute("aria-label", `${episode.title} — no watch link available`);
  play.addEventListener("click", () => {
    if (!String(episode.driveUrl || "").trim()) return;
    episode.lastPlayedAt = Date.now();
    saveRecord(item).catch(() => {});
    openMediaLink(resolveWatchUrl(episode.driveUrl), `${item.title} · S${episode.season} E${episode.episode}`, item, episode);
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "episode-remove";
  remove.setAttribute("aria-label", `Remove episode “${episode.title}”`);
  remove.textContent = "×";
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    removeEpisode(item, episode);
  });
  card.append(play, remove);
  return card;
}

function resetRemoveConfirm() {
  removeConfirm.hidden = true;
  removeButton.hidden = false;
  removeError.textContent = "";
  confirmRemoveButton.disabled = false;
  confirmRemoveButton.textContent = "Yes, remove";
}

function refreshEpisodeList(item) {
  const select = document.querySelector("#season-select");
  item.episodes = sortEpisodes(item.episodes);
  const seasons = [...new Set(item.episodes.map((e) => e.season))];
  const keep = Number(select.value);
  select.replaceChildren(...seasons.map((n) => new Option(`Season ${n}`, n)));
  select.value = seasons.includes(keep) ? keep : (seasons[0] ?? "");
  document.querySelector("#episode-count-note").textContent =
    `${item.episodes.length} episode${item.episodes.length === 1 ? "" : "s"}`;
  document.querySelector("#season-bar").hidden = !seasons.length;
  document.querySelector("#episode-list").replaceChildren(
    ...item.episodes
      .filter((e) => e.season === Number(select.value))
      .map((e) => makeEpisodeButton(e, item)),
  );
  const lastEpisode = item.episodes.filter((e) => Number(e.lastPlayedAt) > 0)
    .sort((a, b) => Number(b.lastPlayedAt) - Number(a.lastPlayedAt))[0];
  const currentEpisode = lastEpisode || item.episodes.find((e) => String(e.driveUrl || "").trim()) || item.episodes[0];
  const watchButton = document.querySelector("#dialog-watch");
  watchButton.hidden = !currentEpisode || !String(currentEpisode.driveUrl || "").trim();
  if (currentEpisode && String(currentEpisode.driveUrl || "").trim()) {
    setWatchLabel(watchButton, lastEpisode ? `Continue S${currentEpisode.season} · E${currentEpisode.episode}` : `Play S${currentEpisode.season} · E${currentEpisode.episode}`);
    watchButton.onclick = () => openMediaLink(resolveWatchUrl(currentEpisode.driveUrl), `${item.title} · S${currentEpisode.season} E${currentEpisode.episode}`, item, currentEpisode);
  }
}

async function removeEpisode(item, episode) {
  const confirmed = window.confirm(
    `Remove “${episode.title}” from ${item.title}? This can’t be undone.`,
  );
  if (!confirmed) return;
  const previousEpisodes = item.episodes;
  item.episodes = item.episodes.filter((entry) => entry !== episode);
  try {
    await saveRecord(item);
  } catch (error) {
    item.episodes = previousEpisodes;
    showToast(error.message || "Could not remove that episode.");
    return;
  }
  refreshEpisodeList(item);
  renderShelves();
  showToast(`Removed “${episode.title}”`);
}

function renderDialogMeta(item) {
  const parts = [];
  if (item.rating) parts.push(["★ " + item.rating, "star"]);
  if (item.year) parts.push([item.year]);
  parts.push([[item.type === "show" ? "Series" : "Movie", ...item.genres].join(" · ")]);
  if (item.cert) parts.push([item.cert, "age-badge"]);
  if (isRecentlyWatched(item)) parts.push(["Recently Watched", "watched-badge"]);
  else if (item.watched) parts.push(["Watched", "watched-badge done-badge"]);
  syncWatchedControls(item);
  document.querySelector("#dialog-meta").replaceChildren(
    ...parts.map(([text, cls]) => {
      const span = document.createElement("span");
      span.textContent = text;
      if (cls) span.className = cls;
      return span;
    }),
  );
}

// Fetches rating, year, age rating and (for shows) episode names + stills
// from TMDB the first time a title is opened, then saves them on the title.
async function loadTmdbDetails(item) {
  const key = getTmdbKey();
  if (!key || item.detailsAt) return;
  const api = (path, params = "") =>
    fetch(`https://api.themoviedb.org/3/${path}?api_key=${encodeURIComponent(key)}${params}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  try {
    const kind = item.type === "show" ? "tv" : "movie";
    const found = (await api(`search/${kind}`, `&query=${encodeURIComponent(item.title)}&include_adult=false`)).results?.[0];
    if (!found) return;
    const detail = await api(`${kind}/${found.id}`, `&append_to_response=${kind === "tv" ? "content_ratings" : "release_dates"}`);
    item.rating = detail.vote_average ? detail.vote_average.toFixed(1) : "";
    item.year = (detail.release_date || detail.first_air_date || "").slice(0, 4);
    if (detail.poster_path) item.poster = detail.poster_path;
    const runtime = kind === "tv" ? (detail.episode_run_time || [])[0] || detail.last_episode_to_air?.runtime : detail.runtime;
    if (runtime) { item.runtime = Number(runtime); item.runtimeAt = Date.now(); }
    const list = (kind === "tv" ? detail.content_ratings : detail.release_dates)?.results || [];
    const us = list.find((r) => r.iso_3166_1 === "US");
    item.cert = kind === "tv"
      ? us?.rating || ""
      : us?.release_dates?.find((r) => r.certification)?.certification || "";
    if (kind === "tv") {
      const generic = /^(season \d+, episode \d+|episode)$/i;
      for (const n of new Set(item.episodes.map((e) => e.season))) {
        const season = await api(`tv/${found.id}/season/${n}`).catch(() => null);
        for (const tmdbEpisode of season?.episodes || []) {
          const mine = item.episodes.find((e) => e.season === n && e.episode === tmdbEpisode.episode_number);
          if (!mine) continue;
          if (tmdbEpisode.name && (!mine.title || generic.test(mine.title.trim()))) mine.title = tmdbEpisode.name;
          if (tmdbEpisode.still_path) mine.still = `https://image.tmdb.org/t/p/w500${tmdbEpisode.still_path}`;
        }
      }
    }
    item.detailsAt = Date.now();
    await saveRecord(item);
    refreshCardArt(item);
    if (dialogItem === item) {
      renderDialogMeta(item);
      if (item.type === "show") refreshEpisodeList(item);
    }
  } catch (error) {
    console.warn("TMDB details failed:", error);
  }
}
