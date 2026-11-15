/* ========================================================================
   FILE: js/13-add-title-form.js

   WHAT IT DOES:
     The 'Add title' form: switching between Movie and Show fields, adding
     episode rows, and the banner image picker/preview.

   OPEN THIS FILE IF YOU WANT TO:
     change the fields in the Add title form.
   ======================================================================== */

function updateTypeFields() {
  const type = movieForm.querySelector('input[name="titleType"]:checked').value;
  const isShow = type === "show";
  const watched = document.querySelector("#movie-watched").checked;
  document.querySelector("#movie-drive-field").hidden = isShow;
  movieDriveInput.required = !isShow && !watched;
  document.querySelector("#episodes-section").hidden = !isShow;
  episodeFormList.querySelectorAll("input").forEach((input) => {
    input.disabled = !isShow;
    input.required = !watched;
  });
  document.querySelector("#submit-movie").innerHTML =
    `${isShow ? "Add show" : "Add movie"} <span aria-hidden="true">↗</span>`;
}

movieForm.querySelectorAll('input[name="titleType"]').forEach((radio) => {
  radio.addEventListener("change", updateTypeFields);
});
document.querySelector("#movie-watched").addEventListener("change", updateTypeFields);

function createEpisodeField(labelText, className, type, value, placeholder) {
  const label = document.createElement("label");
  label.className = "episode-input-label";
  label.append(document.createTextNode(labelText));
  const input = document.createElement("input");
  input.className = `form-control ${className}`;
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  input.required = true;
  if (type === "number") {
    input.min = "1";
    input.max = "999";
  }
  label.append(input);
  return label;
}

function updateEpisodeRemoveButtons() {
  const rows = [...episodeFormList.querySelectorAll(".episode-form-card")];
  rows.forEach((row) => {
    row.querySelector(".remove-episode").disabled = rows.length === 1;
  });
}

function addEpisodeRow(episode = {}) {
  const row = document.createElement("div");
  row.className = "episode-form-card";
  const top = document.createElement("div");
  top.className = "episode-form-card-heading";
  const label = document.createElement("strong");
  label.textContent = `Episode ${episodeFormList.children.length + 1}`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-episode";
  remove.setAttribute("aria-label", "Remove episode");
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    row.remove();
    [...episodeFormList.children].forEach((element, index) => {
      element.querySelector(".episode-form-card-heading strong").textContent =
        `Episode ${index + 1}`;
    });
    updateEpisodeRemoveButtons();
  });
  top.append(label, remove);

  const numbers = document.createElement("div");
  numbers.className = "episode-number-fields";
  numbers.append(
    createEpisodeField(
      "Season",
      "episode-season",
      "number",
      episode.season || 1,
      "1",
    ),
    createEpisodeField(
      "Episode number",
      "episode-index",
      "number",
      episode.episode || episodeFormList.children.length + 1,
      "1",
    ),
  );
  row.append(
    top,
    numbers,
    createEpisodeField(
      "Episode title",
      "episode-title",
      "text",
      episode.title || "",
      "e.g. The first night",
    ),
    createEpisodeField(
      "Episode watch link",
      "episode-link",
      "text",
      episode.driveUrl || "",
      "https://example.com/video-or-page",
    ),
  );
  episodeFormList.append(row);
  updateEpisodeRemoveButtons();
}

document
  .querySelector("#add-episode")
  .addEventListener("click", () => { addEpisodeRow(); updateTypeFields(); });

function clearBannerPreview() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = "";
  bannerPreviewImage.removeAttribute("src");
  bannerPreview.hidden = true;
  document.querySelector("#upload-file-name").textContent =
    "JPG, PNG, or WebP · max 8 MB";
}

function updateBannerPreview(source, filename = "") {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = source.startsWith("blob:") ? source : "";
  bannerPreviewImage.src = source;
  bannerPreview.hidden = false;
  if (filename)
    document.querySelector("#upload-file-name").textContent = filename;
}

const validBannerTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
bannerFileInput.addEventListener("change", () => {
  const file = bannerFileInput.files[0];
  if (!file) return;
  if (!validBannerTypes.includes(file.type) || file.size > 8 * 1024 * 1024) {
    formError.textContent =
      "Choose a JPG, PNG, or WebP image smaller than 8 MB.";
    bannerFileInput.value = "";
    return;
  }
  formError.textContent = "";
  updateBannerPreview(URL.createObjectURL(file), file.name);
});

bannerUrlInput.addEventListener("input", () => {
  if (bannerFileInput.files.length) return;
  const value = bannerUrlInput.value.trim();
  if (!value) {
    clearBannerPreview();
    return;
  }
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol))
      updateBannerPreview(url.href);
  } catch {
    clearBannerPreview();
  }
});

document.querySelector("#remove-banner").addEventListener("click", () => {
  bannerFileInput.value = "";
  bannerUrlInput.value = "";
  clearBannerPreview();
});
