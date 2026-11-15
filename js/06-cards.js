/* ========================================================================
   FILE: js/06-cards.js

   WHAT IT DOES:
     Builds the poster cards you see in rows (poster image, title line,
     play/list/info buttons) and the genre suggestion shelves.

   OPEN THIS FILE IF YOU WANT TO:
     change how a card looks or what it shows, or how genre shelves
     are built.
   ======================================================================== */

function cardSearchText(item) {
  const episodeText = (item.episodes || [])
    .map((episode) => episode.title)
    .join(" ");
  return `${item.title} ${item.type} ${(item.genres || []).join(" ")} ${item.description} ${episodeText}`.toLowerCase();
}

const TMDB_IMG = "https://image.tmdb.org/t/p/";
function posterUrl(item, size = "w342") {
  return item && item.poster ? `${TMDB_IMG}${size}${item.poster}` : "";
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.6v14.8a1 1 0 0 0 1.52.85l12-7.4a1 1 0 0 0 0-1.7l-12-7.4A1 1 0 0 0 7 4.6z"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

function setWatchLabel(button, label) {
  button.innerHTML = ICON_PLAY + "<span></span>";
  button.lastElementChild.textContent = label;
}

function applyCardArt(card, item) {
  const image = card.querySelector(".card-image");
  const poster = posterUrl(item);
  const src = poster || item.banner || "";
  image.dataset.fallback = "";
  card.classList.toggle("no-art", !src);
  card.classList.toggle("banner-art", !poster && !!src);
  if (src) {
    if (image.getAttribute("src") !== src) image.src = src;
  } else {
    image.removeAttribute("src");
  }
}

// Swaps new artwork into cards already on screen, so rows don't jump while TMDB fills in posters.
function refreshCardArt(item) {
  document.querySelectorAll(".title-card").forEach((card) => {
    if (card.dataset.id === item.id) applyCardArt(card, item);
  });
  if (featuredTitle && featuredTitle.id === item.id) renderHero();
}

function cardMetaLine(item) {
  const parts = [];
  if (item.rating) parts.push(`★ ${item.rating}`);
  if (item.year) parts.push(item.year);
  if (item.type === "show") {
    parts.push(`${item.episodes.length} episode${item.episodes.length === 1 ? "" : "s"}`);
  } else if (!parts.length) {
    parts.push("Movie");
  }
  return parts.join("  ·  ");
}

function createCard(item, options = {}) {
  const card = document.createElement("article");
  card.className = "title-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute(
    "aria-label",
    `${item.title}, ${item.genres.join(" and ")}. Open details.`,
  );
  card.dataset.search = cardSearchText(item);
  card.dataset.id = item.id;
  card.dataset.type = item.type;
  card.dataset.genres = item.genres.join("|").toLowerCase();

  const image = document.createElement("img");
  image.className = "card-image";
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.draggable = false;
  image.addEventListener("error", () => {
    if (image.dataset.fallback !== "1" && item.banner && image.getAttribute("src") !== item.banner) {
      image.dataset.fallback = "1";
      card.classList.add("banner-art");
      image.src = item.banner;
    } else {
      card.classList.add("no-art");
    }
  });
  card.append(image);
  applyCardArt(card, item);

  const badges = document.createElement("div");
  badges.className = "card-badges";
  if (isInProgress(item)) {
    const progress = document.createElement("span");
    progress.className = "watched-badge continue-badge";
    progress.textContent = "Continue watching";
    badges.append(progress);
  } else if (isRecentlyWatched(item)) {
    const watched = document.createElement("span");
    watched.className = "watched-badge";
    watched.textContent = "Recently Watched";
    badges.append(watched);
  }
  else if (item.watched) {
    const done = document.createElement("span");
    done.className = "watched-badge done-badge";
    done.textContent = "Watched";
    badges.append(done);
  }
  if (item.watchlist || item.reaction === "like") {
    const taste = document.createElement("span");
    taste.className = "watched-badge";
    taste.textContent = item.watchlist ? "Watchlist" : "Liked";
    badges.append(taste);
  }
  if (badges.children.length) card.append(badges);

  if (isInProgress(item)) {
    const bar = document.createElement("div");
    bar.className = "card-progress";
    const fill = document.createElement("span");
    const pct = Math.max(3, Math.min(100, Math.round((Number(item.progressSeconds) / Number(item.durationSeconds)) * 100)));
    fill.style.width = `${pct}%`;
    bar.append(fill);
    card.append(bar);
  }

  const copy = document.createElement("span");
  copy.className = "card-copy";
  for (const [className, text] of [
    ["card-title", item.title],
    ["card-year", cardMetaLine(item)],
    ["card-tag", item.genres.join(" · ")],
  ]) {
    const line = document.createElement("span");
    line.className = className;
    line.textContent = text;
    copy.append(line);
  }
  card.append(copy);

  if (options.removable && (isRecentlyWatched(item) || isInProgress(item))) {
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "card-dismiss";
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", `Remove ${item.title} from Recently watched`);
    dismiss.title = "Remove from Recently watched";
    dismiss.addEventListener("click", (event) => {
      event.stopPropagation();
      removeFromRecent([item]);
    });
    dismiss.addEventListener("keydown", (event) => event.stopPropagation());
    card.append(dismiss);
  }

  card.addEventListener("click", () => openTitleDialog(item));
  card.addEventListener("keydown", (event) => {
    if (event.target === card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openTitleDialog(item);
    }
  });
  return card;
}

function createSeeAllCard(label, count, onClick) {
  const card = document.createElement("article");
  card.className = "title-card see-all-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `See all: ${label}`);
  const arrow = document.createElement("span");
  arrow.className = "see-all-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "›";
  const strong = document.createElement("strong");
  strong.textContent = "See all";
  const small = document.createElement("small");
  small.textContent = `${count} title${count === 1 ? "" : "s"}`;
  card.append(arrow, strong, small);
  card.addEventListener("click", onClick);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); }
  });
  return card;
}

// A TMDB title that isn't in the library yet: opens the details sheet, which offers to add it.
function createSuggestionCard(entry) {
  const { rec, type } = entry;
  const card = document.createElement("article");
  card.className = "title-card discover-card suggest-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${entry.title} (not in your library). Open details.`);
  const img = document.createElement("img");
  img.className = "card-image"; img.loading = "lazy"; img.alt = ""; img.draggable = false;
  if (rec.poster_path) img.src = `${TMDB_IMG}w342${rec.poster_path}`; else card.classList.add("no-art");
  card.append(img);
  const badge = document.createElement("span");
  badge.className = "suggest-badge"; badge.textContent = "Not in library";
  card.append(badge);
  const copy = document.createElement("span");
  copy.className = "card-copy";
  const meta = [rec.vote_average ? `★ ${Number(rec.vote_average).toFixed(1)}` : "", entry.year].filter(Boolean).join("  ·  ");
  for (const [cls, txt] of [["card-title", entry.title], ["card-year", meta], ["card-tag", entry.genres.slice(0, 2).join(" · ")]]) {
    const el = document.createElement("span"); el.className = cls; el.textContent = txt; copy.append(el);
  }
  card.append(copy);
  const open = () => openExternalRecommendation(rec, type);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } });
  return card;
}

// Home genre rows: your titles first (unwatched ahead of watched), then a few TMDB suggestions.
const genreSuggestCache = new Map(); // discover genre name -> Promise<entries[]>

function discoverGenreFor(voraGenre) {
  const alias = { "Sci-Fi": "Science Fiction" };
  const name = alias[voraGenre] || voraGenre;
  return (typeof DISCOVER_GENRES !== "undefined" ? DISCOVER_GENRES : []).find((g) => g.name === name) || null;
}

function genreSuggestions(genre) {
  if (!genreSuggestCache.has(genre.name)) {
    genreSuggestCache.set(genre.name, fetchGenreShelf(genre).catch((error) => {
      console.warn("Genre suggestions unavailable:", genre.name, error);
      return [];
    }));
  }
  return genreSuggestCache.get(genre.name);
}

async function fillGenreSuggestions(voraGenre, row) {
  if (!settings.discoverTmdb || !getTmdbKey()) return;
  const genre = discoverGenreFor(voraGenre);
  if (!genre) return;
  const entries = await genreSuggestions(genre);
  if (!row.isConnected) return;
  const fresh = entries.filter((entry) => !discoverInLibrary(entry)).slice(0, GENRE_SUGGESTIONS);
  row.querySelectorAll(".suggest-card").forEach((card) => card.remove());
  row.append(...fresh.map(createSuggestionCard));
}

function renderGenreShelves() {
  const root = document.querySelector("#genre-shelves");
  const groups = new Map();
  for (const item of customTitles) {
    for (const genre of item.genres) {
      if (!genre || genre === "Other") continue;
      if (!groups.has(genre)) groups.set(genre, []);
      groups.get(genre).push(item);
    }
  }
  const ordered = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, GENRE_ROW_LIMIT);

  root.replaceChildren(
    ...ordered.map(([genre, all]) => {
      const items = [...all.filter(isUnwatched), ...all.filter((i) => !isUnwatched(i))].slice(0, 16);
      const shelf = document.createElement("section");
      shelf.className = "shelf user-genre-shelf";
      shelf.id = `genre-${slug(genre)}`;
      shelf.dataset.filter = slug(genre);

      const heading = document.createElement("div");
      heading.className = "shelf-heading";
      const title = document.createElement("h2");
      title.textContent = genre;

      const controls = document.createElement("div");
      controls.className = "shelf-controls";
      const rowId = `${shelf.id}-row`;
      for (const [direction, symbol, side] of [
        [-1, "‹", "left"],
        [1, "›", "right"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "carousel-button";
        button.dataset.direction = String(direction);
        button.dataset.target = rowId;
        button.setAttribute("aria-label", `Scroll ${genre} titles ${side}`);
        button.textContent = symbol;
        controls.append(button);
      }
      heading.append(title, controls);

      const row = document.createElement("div");
      row.className = "card-row";
      row.id = rowId;
      row.append(...items.map((item) => createCard(item)));
      shelf.append(heading, row);
      fillGenreSuggestions(genre, row);
      return shelf;
    }),
  );
}
