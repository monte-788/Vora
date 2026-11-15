/* ========================================================================
   FILE: js/14-library-storage.js

   WHAT IT DOES:
     Saves your library inside the browser (IndexedDB), makes automatic
     backups, cleans up saved records, and handles pressing 'Add' on the
     Add title form.

   OPEN THIS FILE IF YOU WANT TO:
     change how titles are saved or what is stored for each title.
   ======================================================================== */

function openTitleDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support local title storage."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not open Vora storage."));
  });
}

function readAllRecords() {
  return new Promise((resolve, reject) => {
    const request = titleDB
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not read Vora titles."));
  });
}

const AUTO_BACKUP_KEY = "vora-automatic-library-backup";
function writeAutomaticBackup() {
  if (typeof settings !== "undefined" && settings.autoBackup === false) return;
  try {
    // Never replace a backup that has titles with an empty one (emptying the library,
    // or rendering before titles have loaded, would otherwise wipe the safety net).
    if (!customTitles.length) return;
    const titles = customTitles.map((item) => ({ ...item, episodes: Array.isArray(item.episodes) ? item.episodes.map((e) => ({...e})) : [] }));
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), titles }));
  } catch (error) { console.warn("Vora automatic backup could not be written:", error); }
}

function saveRecord(record) {
  return new Promise((resolve, reject) => {
    if (!titleDB) {
      writeAutomaticBackup();
      resolve();
      return;
    }
    const transaction = titleDB.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => { writeAutomaticBackup(); resolve(); };
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not save this title."));
    transaction.onabort = () =>
      reject(
        transaction.error || new Error("Vora storage is full or unavailable."),
      );
  });
}

function deleteRecord(id) {
  return new Promise((resolve, reject) => {
    if (!titleDB) {
      resolve();
      return;
    }
    const transaction = titleDB.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not remove this title."));
    transaction.onabort = () =>
      reject(
        transaction.error || new Error("Vora storage is unavailable."),
      );
  });
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(new Error("The banner image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function fileAsBannerDataUrl(file) {
  const original = await fileAsDataUrl(file);
  if (file.type === "image/gif") return original;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / bitmap.width);
    if (scale === 1 && file.size < 300 * 1024) return original;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#0d192b";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const resized = canvas.toDataURL("image/jpeg", 0.85);
    return resized.length < original.length ? resized : original;
  } catch {
    return original;
  }
}

function normalizeRecord(record) {
  const genres = Array.isArray(record.genres)
    ? record.genres
    : record.genre
      ? [record.genre]
      : ["Other"];
  const type = record.type === "show" ? "show" : "movie";
  let driveUrl = "";
  try {
    if (record.driveUrl) driveUrl = mediaLinkUrl(record.driveUrl);
  } catch {
    driveUrl = "";
  }
  const episodes =
    type === "show" && Array.isArray(record.episodes)
      ? sortEpisodes(
          record.episodes.map((episode) => {
            let episodeLink = "";
            try {
              episodeLink = mediaLinkUrl(episode.driveUrl || episode.url || "");
            } catch {
              episodeLink = "";
            }
            return {
              season: Number(episode.season) || 1,
              episode: Number(episode.episode) || 1,
              title: episode.title || "Episode",
              driveUrl: episodeLink,
              still: episode.still || "",
              progressSeconds: Number(episode.progressSeconds) || 0,
              durationSeconds: Number(episode.durationSeconds) || 0,
              lastPlayedAt: Number(episode.lastPlayedAt) || 0,
            };
          }),
        )
      : [];
  return {
    id: record.id || createId(),
    type,
    title: record.title || "Untitled",
    genres: [...new Set(genres.filter(Boolean))].slice(0, 2),
    description: record.description || "",
    banner: record.banner || "",
    poster: record.poster || "",
    posterAt: Number(record.posterAt) || 0,
    driveUrl,
    episodes,
    year: record.year || "",
    rating: record.rating || "",
    cert: record.cert || "",
    detailsAt: record.detailsAt || 0,
    lastPlayedAt: Number(record.lastPlayedAt) || 0,
    progressSeconds: Number(record.progressSeconds) || 0,
    durationSeconds: Number(record.durationSeconds) || 0,
    favorite: !!record.favorite,
    watched: !!record.watched,
    watchedAt: Number(record.watchedAt) || 0,
    runtime: Number(record.runtime) || 0,
    runtimeAt: Number(record.runtimeAt) || 0,
    watchlist: !!record.watchlist,
    reaction: record.reaction === "like" || record.reaction === "dislike" ? record.reaction : "",
    tmdbId: record.tmdbId || 0,
    cast: Array.isArray(record.cast) ? record.cast : null,
    castAt: record.castAt || 0,
    createdAt: record.createdAt || new Date().toISOString(),
  };
}

function toCardItem(record) {
  return {
    ...record,
    genres: record.genres.length ? record.genres : ["Other"],
  };
}

movieForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";
  if (!movieForm.reportValidity()) return;

  const submitButton = document.querySelector("#submit-movie");
  submitButton.disabled = true;
  submitButton.textContent = "Saving…";
  try {
    const type = movieForm.querySelector(
      'input[name="titleType"]:checked',
    ).value;
    const title = document.querySelector("#movie-name").value.trim();
    const firstGenre = document.querySelector("#movie-genre").value;
    const secondGenre = document.querySelector("#movie-genre-two").value;
    const genres = [firstGenre, secondGenre].filter(Boolean);
    if (secondGenre && secondGenre === firstGenre) {
      throw new Error("Choose a different second genre, or leave it empty.");
    }
    if (
      customTitles.some(
        (item) => item.title.toLowerCase() === title.toLowerCase(),
      )
    ) {
      throw new Error("You already added a title with that name.");
    }

    const file = bannerFileInput.files[0];
    const bannerUrl = bannerUrlInput.value.trim();
    if (!file && !bannerUrl)
      throw new Error("Add a banner image URL or choose an image file.");
    let banner;
    if (file) {
      if (
        !validBannerTypes.includes(file.type) ||
        file.size > 8 * 1024 * 1024
      ) {
        throw new Error("Choose a JPG, PNG, or WebP image smaller than 8 MB.");
      }
      banner = await fileAsBannerDataUrl(file);
    } else {
      const parsedBannerUrl = new URL(bannerUrl);
      if (!["https:", "http:"].includes(parsedBannerUrl.protocol)) {
        throw new Error("Use an http or https banner URL.");
      }
      banner = parsedBannerUrl.href;
    }

    const watched = document.querySelector("#movie-watched").checked;
    const episodes =
      type === "show"
        ? sortEpisodes(
            [...episodeFormList.querySelectorAll(".episode-form-card")]
              .filter((row) => !watched || row.querySelector(".episode-title").value.trim() || row.querySelector(".episode-link").value.trim())
              .map(
              (row) => ({
                season: Number(row.querySelector(".episode-season").value),
                episode: Number(row.querySelector(".episode-index").value),
                title: row.querySelector(".episode-title").value.trim(),
                driveUrl: mediaLinkUrl(
                  row.querySelector(".episode-link").value.trim(),
                ),
              }),
            ),
          )
        : [];
    const movieLink =
      type === "movie" && !(watched && !movieDriveInput.value.trim())
        ? mediaLinkUrl(movieDriveInput.value.trim())
        : "";
    const fromTmdb = addPrefill && addPrefill.title.toLowerCase() === title.toLowerCase() ? addPrefill : null;
    const record = {
      id: createId(),
      type,
      title,
      genres,
      description: document.querySelector("#movie-description").value.trim(),
      banner,
      driveUrl: movieLink,
      episodes,
      watched,
      watchedAt: watched ? Date.now() : 0,
      ...(fromTmdb ? { tmdbId: fromTmdb.tmdbId || 0, poster: fromTmdb.poster || "", year: fromTmdb.year || "", rating: fromTmdb.rating || "" } : {}),
      createdAt: new Date().toISOString(),
    };

    await saveRecord(record);
    addPrefill = null;
    customTitles.unshift(toCardItem(record));
    renderShelves();
    searchInput.value = "";
    applySearch();
    movieForm.reset();
    clearBannerPreview();
    episodeFormList.replaceChildren();
    updateTypeFields();
    addDialog.close();
    showToast(`${type === "show" ? "Show" : "Movie"} ${watched ? "added as watched" : "added to Vora"}`);
  } catch (error) {
    formError.textContent = error.message || "This title could not be saved.";
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = `${movieForm.querySelector('input[name="titleType"]:checked').value === "show" ? "Add show" : "Add movie"} <span aria-hidden="true">↗</span>`;
  }
});
