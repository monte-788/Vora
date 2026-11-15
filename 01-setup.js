/* ========================================================================
   FILE: js/01-setup.js

   WHAT IT DOES:
     The starting point of the app. Remembers a copy of the untouched page
     (used by the export feature), names the databases/storage keys, and
     finds the main buttons, dialogs and form fields on the page so the
     other files can use them.

   OPEN THIS FILE IF YOU WANT TO:
     rename a storage key, or add a new shortcut to a button or
     field on the page. Keep this file FIRST in the list in
     index.html.
   ======================================================================== */

// Snapshot of the untouched page, used to build the "Export library" download.
const pristineHTML = "<!doctype html>\n" + document.documentElement.outerHTML;
const SNAPSHOT_KEY = "vora-imported-snapshots";
const DB_NAME = "vora-library";
const STORE_NAME = "titles";

let titleDB;
let customTitles = [];
let featuredTitle = null;
let toastTimer;
let previewObjectUrl = "";
let dialogItem = null;
let savedSignature = "";

const dialog = document.querySelector("#title-dialog");
const addDialog = document.querySelector("#add-movie-dialog");
const movieForm = document.querySelector("#movie-form");
const episodeFormList = document.querySelector("#episode-form-list");
const movieDriveInput = document.querySelector("#movie-drive-link");
const bannerFileInput = document.querySelector("#movie-banner-file");
const bannerUrlInput = document.querySelector("#movie-banner-url");
const bannerPreview = document.querySelector("#banner-preview");
const bannerPreviewImage = document.querySelector("#banner-preview-image");
const formError = document.querySelector("#form-error");
const searchInput = document.querySelector("#search-input");
const saveButton = document.querySelector("#save-library");
const importCsvButton = document.querySelector("#open-import-csv");
const importCsvInput = document.querySelector("#import-csv-input");
const tmdbSettingsButton = document.querySelector("#open-tmdb-settings");
const removeButton = document.querySelector("#dialog-remove");
const removeConfirm = document.querySelector("#remove-confirm");
const removeConfirmText = document.querySelector("#remove-confirm-text");
const removeError = document.querySelector("#remove-error");
const confirmRemoveButton = document.querySelector("#confirm-remove");
const cancelRemoveButton = document.querySelector("#cancel-remove");
const toggleAddEpisodeButton = document.querySelector("#toggle-add-episode");
const dialogEpisodeForm = document.querySelector("#dialog-episode-form");
const dialogEpisodeError = document.querySelector("#dialog-episode-error");
