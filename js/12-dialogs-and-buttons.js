/* ========================================================================
   FILE: js/12-dialogs-and-buttons.js

   WHAT IT DOES:
     Opens the title page and the 'Add title' window, and connects many
     buttons to their actions (close, remove, add episode, hero buttons,
     Home/Movies/Shows/Discover tabs, search box).

   OPEN THIS FILE IF YOU WANT TO:
     change what a button does or how a window opens/closes.
   ======================================================================== */

function openTitleDialog(item) {
  stopTrailer();
  dialogItem = item;
  resetRemoveConfirm();
  closeDialogEpisodeForm();
  const episodeList = document.querySelector("#episode-list");
  const watchButton = document.querySelector("#dialog-watch");
  removeButton.hidden = !!item.externalRecommendation;

  const dialogArt = item.banner || posterUrl(item, "w780");
  dialog.querySelector(".dialog-art").style.backgroundImage = dialogArt ? `url("${dialogArt}")` : "none";
  document.querySelector("#dialog-title").textContent = item.title;
  renderDialogMeta(item);
  updateFavoriteButton(item);
  syncTasteButtons(item);
  document.querySelector("#dialog-description").textContent = item.description;
  document.querySelector("#dialog-watchlist").onclick = () => toggleTitleFlag(item, "watchlist");
  document.querySelector("#dialog-like").onclick = () => setReaction(item, item.reaction === "like" ? "" : "like");
  document.querySelector("#dialog-dislike").onclick = () => setReaction(item, item.reaction === "dislike" ? "" : "dislike");
  document.querySelector("#dialog-trailer").onclick = () => playTrailerInHero(item);
  document.querySelector("#dialog-watchlist").hidden = !!item.externalRecommendation;
  document.querySelector("#dialog-like").hidden = !!item.externalRecommendation;
  document.querySelector("#dialog-dislike").hidden = !!item.externalRecommendation;

  if (item.type === "show") {
    toggleAddEpisodeButton.hidden = false;
    episodeList.hidden = false;
    document.querySelector("#season-select").replaceChildren();
    refreshEpisodeList(item);
  } else {
    watchButton.hidden = !String(item.driveUrl || "").trim();
    setWatchLabel(watchButton, "Play");
    watchButton.onclick = () => {
      if (!String(item.driveUrl || "").trim()) return;
      openMediaLink(resolveWatchUrl(item.driveUrl), item.title, item);
    };
    toggleAddEpisodeButton.hidden = true;
    document.querySelector("#season-bar").hidden = true;
    episodeList.hidden = true;
    episodeList.replaceChildren();
  }
  renderCast(item);
  dialog.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  loadRelated(item);
  if (!item.externalRecommendation) { loadTmdbDetails(item); loadCast(item); }
  else { renderCast(item); loadCast(item); }
}

document.querySelector("#season-select").addEventListener("change", () => {
  if (dialogItem) refreshEpisodeList(dialogItem);
});

let addPrefill = null;
function openAddDialog(prefill) {
  addPrefill = prefill && prefill.title ? prefill : null;
  movieForm.reset();
  formError.textContent = "";
  clearBannerPreview();
  episodeFormList.replaceChildren();
  addEpisodeRow();
  if (addPrefill) {
    movieForm.querySelector(`input[name="titleType"][value="${addPrefill.type === "show" ? "show" : "movie"}"]`).checked = true;
    document.querySelector("#movie-name").value = addPrefill.title;
    const vora = [...new Set((addPrefill.genres || []).map((g) => TMDB_TO_VORA_GENRE[g]).filter(Boolean))];
    document.querySelector("#movie-genre").value = vora[0] || "";
    document.querySelector("#movie-genre-two").value = vora[1] && vora[1] !== vora[0] ? vora[1] : "";
    document.querySelector("#movie-description").value = addPrefill.description || "";
    if (addPrefill.banner) {
      bannerUrlInput.value = addPrefill.banner;
      updateBannerPreview(addPrefill.banner);
    }
  }
  updateTypeFields();
  addDialog.showModal();
  document.querySelector("#movie-name").focus();
}

document
  .querySelector("#open-add-movie")
  .addEventListener("click", () => openAddDialog());
document
  .querySelectorAll("[data-open-add]")
  .forEach((button) => button.addEventListener("click", () => openAddDialog()));
document
  .querySelector("#cancel-add-movie")
  .addEventListener("click", () => addDialog.close());
addDialog
  .querySelector(".dialog-close")
  .addEventListener("click", () => addDialog.close());
addDialog.addEventListener("click", (event) => {
  if (event.target === addDialog) addDialog.close();
});

dialog
  .querySelector(".dialog-close")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("close", () => {
  stopTrailer();
  dialogItem = null;
  resetRemoveConfirm();
  closeDialogEpisodeForm();
});

removeButton.addEventListener("click", () => {
  if (!dialogItem) return;
  removeConfirmText.textContent = `Remove “${dialogItem.title}” from your library? This can’t be undone.`;
  removeButton.hidden = true;
  removeConfirm.hidden = false;
  cancelRemoveButton.focus();
});

cancelRemoveButton.addEventListener("click", () => {
  resetRemoveConfirm();
  removeButton.focus();
});

confirmRemoveButton.addEventListener("click", async () => {
  if (!dialogItem) return;
  const item = dialogItem;
  removeError.textContent = "";
  confirmRemoveButton.disabled = true;
  confirmRemoveButton.textContent = "Removing…";
  try {
    await deleteRecord(item.id);
    customTitles = customTitles.filter((entry) => entry.id !== item.id);
    dialog.close();
    renderShelves();
    showToast(`Removed “${item.title}” from Vora`);
  } catch (error) {
    confirmRemoveButton.disabled = false;
    confirmRemoveButton.textContent = "Try again";
    removeError.textContent = error.message || "This title could not be removed.";
  }
});

function closeDialogEpisodeForm() {
  dialogEpisodeForm.hidden = true;
  dialogEpisodeForm.reset();
  dialogEpisodeError.textContent = "";
}

toggleAddEpisodeButton.addEventListener("click", () => {
  if (!dialogItem) return;
  dialogEpisodeError.textContent = "";
  const lastEpisode = dialogItem.episodes[dialogItem.episodes.length - 1];
  const nextSeason = lastEpisode ? lastEpisode.season : 1;
  const seasonEpisodes = dialogItem.episodes.filter(
    (entry) => entry.season === nextSeason,
  );
  const nextNumber = seasonEpisodes.length
    ? Math.max(...seasonEpisodes.map((entry) => entry.episode)) + 1
    : 1;
  document.querySelector("#dialog-episode-season").value = nextSeason;
  document.querySelector("#dialog-episode-index").value = nextNumber;
  document.querySelector("#dialog-episode-title").value = "";
  document.querySelector("#dialog-episode-link").value = "";
  dialogEpisodeForm.hidden = false;
  document.querySelector("#dialog-episode-title").focus();
});

document.querySelector("#cancel-dialog-episode").addEventListener("click", () => {
  closeDialogEpisodeForm();
});

dialogEpisodeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!dialogItem) return;
  dialogEpisodeError.textContent = "";
  if (!dialogEpisodeForm.reportValidity()) return;

  const submitButton = document.querySelector("#submit-dialog-episode");
  submitButton.disabled = true;
  submitButton.textContent = "Adding…";
  try {
    const season = Number(document.querySelector("#dialog-episode-season").value);
    const episodeNumber = Number(
      document.querySelector("#dialog-episode-index").value,
    );
    const title = document.querySelector("#dialog-episode-title").value.trim();
    if (!title) throw new Error("Give the episode a title.");
    const driveUrl = mediaLinkUrl(
      document.querySelector("#dialog-episode-link").value.trim(),
    );
    if (
      dialogItem.episodes.some(
        (entry) => entry.season === season && entry.episode === episodeNumber,
      )
    ) {
      throw new Error(`Season ${season}, Episode ${episodeNumber} already exists.`);
    }

    const newEpisode = { season, episode: episodeNumber, title, driveUrl };
    const previousEpisodes = dialogItem.episodes;
    dialogItem.episodes = sortEpisodes([...dialogItem.episodes, newEpisode]);
    try {
      await saveRecord(dialogItem);
    } catch (error) {
      dialogItem.episodes = previousEpisodes;
      throw error;
    }

    refreshEpisodeList(dialogItem);
    renderShelves();
    closeDialogEpisodeForm();
    showToast(`Added “${title}”`);
  } catch (error) {
    dialogEpisodeError.textContent =
      error.message || "Could not add that episode.";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Add episode";
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-direction]");
  if (!button) return;
  const row = document.getElementById(button.dataset.target);
  if (row)
    row.scrollBy({
      left: row.clientWidth * Number(button.dataset.direction) * 0.82,
      behavior: "smooth",
    });
});

document.querySelector("#hero-action").addEventListener("click", () => {
  if (!featuredTitle) {
    openAddDialog();
  } else if (featuredTitle.type === "show") {
    openTitleDialog(featuredTitle);
  } else {
    openMediaLink(resolveWatchUrl(featuredTitle.driveUrl), featuredTitle.title, featuredTitle);
  }
});

document.querySelector("#hero-info").addEventListener("click", () => {
  if (featuredTitle) openTitleDialog(featuredTitle);
});
document.querySelector("#hero-poster").addEventListener("click", () => {
  if (featuredTitle) openTitleDialog(featuredTitle);
});

document.querySelectorAll(".nav-link[data-chip]").forEach((chip) => {
  chip.addEventListener("click", () => {
    if (chip.dataset.chip === "all") {
      // Visiting Home: fresh surprise picks and no leftover filters.
      surpriseIds = [];
      Object.assign(homeChips, { unwatched: false, short: false, recent: false, genre: "", decade: "" });
      syncChips();
      renderSurpriseShelf();
    }
    setFilter(chip.dataset.chip);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

const topbar = document.querySelector("#topbar");
function syncTopbar() {
  topbar.classList.toggle("scrolled", window.scrollY > 24);
}
window.addEventListener("scroll", syncTopbar, { passive: true });
syncTopbar();

document.querySelector("#search-toggle").addEventListener("click", () => {
  const box = document.querySelector("#search-form");
  box.classList.toggle("open");
  if (box.classList.contains("open")) {
    searchInput.focus();
  } else {
    searchInput.value = "";
    applySearch();
  }
});
document
  .querySelector("#search-form")
  .addEventListener("submit", (event) => event.preventDefault());
let searchTimer = 0;
searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(applySearch, 120); });
