/* ========================================================================
   FILE: js/07-home-rows-and-chips.js

   WHAT IT DOES:
     Home page rows ('Surprise me', 'Not watched yet', 'Recently added')
     and the filter chips under the top bar (Unwatched, Short, Recently
     added, Genre, Decade).

   OPEN THIS FILE IF YOU WANT TO:
     change the home rows or the filter chips.
   ======================================================================== */

// ---- Home rows: Surprise me / Not watched yet / Recently added ---------------------
let surpriseIds = [];

function surpriseItems() {
  const pool = customTitles.filter((i) => isUnwatched(i) && i.reaction !== "dislike");
  const byId = new Map(pool.map((i) => [i.id, i]));
  let ids = surpriseIds.filter((id) => byId.has(id));
  const want = Math.min(SURPRISE_COUNT, pool.length);
  if (ids.length < want) {
    const rest = shuffled(pool.filter((i) => !ids.includes(i.id)));
    ids = ids.concat(rest.slice(0, want - ids.length).map((i) => i.id));
  }
  surpriseIds = ids;
  return ids.map((id) => byId.get(id));
}

function renderSurpriseShelf() {
  const items = surpriseItems();
  document.querySelector("#surprise-row").replaceChildren(...items.map((item) => createCard(item)));
  document.querySelector("#surprise-shelf").hidden = items.length === 0;
}

function renderHomeRows() {
  renderSurpriseShelf();
  const unwatched = customTitles.filter(isUnwatched);
  const unwatchedRow = unwatched.slice(0, HOME_ROW_LIMIT).map((item) => createCard(item));
  if (unwatched.length) {
    unwatchedRow.push(createSeeAllCard("Not watched yet", unwatched.length, () => applyChipPreset({ unwatched: true })));
  }
  document.querySelector("#unwatched-row").replaceChildren(...unwatchedRow);
  document.querySelector("#unwatched-shelf").hidden = unwatched.length === 0;

  const added = unwatched.filter(isRecentlyAdded)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const addedRow = added.slice(0, HOME_ROW_LIMIT).map((item) => createCard(item));
  if (added.length) {
    addedRow.push(createSeeAllCard("Recently added", added.length, () => applyChipPreset({ unwatched: true, recent: true })));
  }
  document.querySelector("#added-row").replaceChildren(...addedRow);
  document.querySelector("#added-shelf").hidden = added.length === 0;
}

document.querySelector("#surprise-shuffle").addEventListener("click", () => {
  surpriseIds = [];
  renderSurpriseShelf();
  const row = document.querySelector("#surprise-row");
  row.scrollTo({ left: 0 });
});

// ---- Filter chips (Unwatched / Short / Recently added / Genre / Decade) ----------
const homeChips = { unwatched: false, short: false, recent: false, genre: "", decade: "" };
const chipBar = document.querySelector("#home-chips");
const chipGenre = document.querySelector("#chip-genre");
const chipDecade = document.querySelector("#chip-decade");
const chipClear = document.querySelector("#chip-clear");

function chipsActive() {
  return homeChips.unwatched || homeChips.short || homeChips.recent || !!homeChips.genre || !!homeChips.decade;
}

function itemMatchesChips(item) {
  if (homeChips.unwatched && !isUnwatched(item)) return false;
  if (homeChips.short && !isShort(item)) return false;
  if (homeChips.recent && !isRecentlyAdded(item)) return false;
  if (homeChips.genre && !item.genres.some((g) => String(g).toLowerCase() === homeChips.genre.toLowerCase())) return false;
  if (homeChips.decade && decadeOf(item) !== Number(homeChips.decade)) return false;
  return true;
}

function chipSummary() {
  const parts = [];
  if (homeChips.unwatched) parts.push("Unwatched");
  if (homeChips.short) parts.push("Short");
  if (homeChips.recent) parts.push("Recently added");
  if (homeChips.genre) parts.push(homeChips.genre);
  if (homeChips.decade) parts.push(`${homeChips.decade}s`);
  return parts.join(" · ");
}

function renderChipOptions() {
  chipBar.hidden = customTitles.length === 0;
  const genres = [...new Set(customTitles.flatMap((i) => i.genres))].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const decades = [...new Set(customTitles.map(decadeOf).filter(Boolean))].sort((a, b) => b - a);
  if (homeChips.genre && !genres.includes(homeChips.genre)) homeChips.genre = "";
  if (homeChips.decade && !decades.includes(Number(homeChips.decade))) homeChips.decade = "";
  chipGenre.replaceChildren(new Option("Genre", ""), ...genres.map((g) => new Option(g, g)));
  chipDecade.replaceChildren(new Option("Decade", ""), ...decades.map((d) => new Option(`${d}s`, String(d))));
  syncChips();
}

function syncChips() {
  chipBar.querySelectorAll("[data-filter-chip]").forEach((button) => {
    const on = !!homeChips[button.dataset.filterChip];
    button.setAttribute("aria-pressed", String(on));
  });
  chipGenre.value = homeChips.genre;
  chipDecade.value = homeChips.decade ? String(homeChips.decade) : "";
  document.querySelector("#chip-genre-wrap").classList.toggle("on", !!homeChips.genre);
  document.querySelector("#chip-decade-wrap").classList.toggle("on", !!homeChips.decade);
  chipClear.hidden = !chipsActive();
}

function chipsChanged() {
  syncChips();
  applySearch();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyChipPreset(preset) {
  Object.assign(homeChips, { unwatched: false, short: false, recent: false, genre: "", decade: "" }, preset);
  chipsChanged();
}

chipBar.querySelectorAll("[data-filter-chip]").forEach((button) => {
  button.addEventListener("click", () => {
    homeChips[button.dataset.filterChip] = !homeChips[button.dataset.filterChip];
    chipsChanged();
  });
});
chipGenre.addEventListener("change", () => { homeChips.genre = chipGenre.value; chipsChanged(); });
chipDecade.addEventListener("change", () => { homeChips.decade = chipDecade.value; chipsChanged(); });
chipClear.addEventListener("click", () => applyChipPreset({}));
