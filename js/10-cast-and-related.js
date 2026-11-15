/* ========================================================================
   FILE: js/10-cast-and-related.js

   WHAT IT DOES:
     Cast members (their page and filmography), like/dislike buttons, and
     the 'Related titles' row.

   OPEN THIS FILE IF YOU WANT TO:
     change the cast page, the taste (like/dislike) buttons, or
     related titles.
   ======================================================================== */

// ---- Cast (TMDB credits) ----------------------------------------------
const PERSON_SKIP_GENRES = new Set([10767, 10763]); // talk shows and news appearances
const PERSON_CREW_JOBS = new Set(["Director", "Creator", "Writer", "Screenplay", "Executive Producer"]);

function personDialog() {
  let page = document.querySelector("#person-filmography-dialog");
  if (page) return page;
  page = document.createElement("dialog");
  page.id = "person-filmography-dialog";
  page.className = "person-dialog";
  page.setAttribute("aria-label", "Cast member");
  page.innerHTML = `
    <button type="button" class="person-nav person-back" aria-label="Back">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
    </button>
    <button type="button" class="person-nav person-close" aria-label="Close">×</button>
    <header class="person-hero">
      <div class="person-hero-bg"></div>
      <div class="person-hero-inner">
        <div class="person-photo" aria-hidden="true"></div>
        <div class="person-info">
          <p class="person-kicker"></p>
          <h2 class="person-heading"></h2>
          <p class="person-meta"></p>
          <p class="person-bio"></p>
          <button type="button" class="person-bio-toggle" hidden>Read more</button>
        </div>
      </div>
    </header>
    <div class="person-body">
      <div class="person-filters" role="group" aria-label="Filter filmography"></div>
      <div class="person-content"></div>
    </div>`;
  document.body.append(page);
  page.querySelector(".person-back").addEventListener("click", () => page.close());
  page.querySelector(".person-close").addEventListener("click", () => page.close());
  page.querySelector(".person-bio-toggle").addEventListener("click", (e) => {
    const bio = page.querySelector(".person-bio");
    const open = bio.classList.toggle("expanded");
    e.currentTarget.textContent = open ? "Show less" : "Read more";
  });
  return page;
}

async function openPersonPage(person) {
  const key = getTmdbKey();
  if (!key) { showToast("TMDB API key not found on this browser. Add it in the Vora menu."); return; }
  const personId = Number(person?.id);
  if (!Number.isInteger(personId) || personId <= 0) {
    showToast("This cast entry is missing its TMDB person ID. Refresh the title's cast data and try again.");
    console.warn("Cannot load cast filmography: invalid person ID", person);
    return;
  }
  const page = personDialog();
  const content = page.querySelector(".person-content");
  const filters = page.querySelector(".person-filters");
  const photo = page.querySelector(".person-photo");
  const bg = page.querySelector(".person-hero-bg");
  const bio = page.querySelector(".person-bio");
  const bioToggle = page.querySelector(".person-bio-toggle");
  page.querySelector(".person-heading").textContent = person.name || "Cast member";
  page.querySelector(".person-kicker").textContent = "";
  page.querySelector(".person-meta").textContent = "";
  bio.textContent = ""; bio.classList.remove("expanded"); bioToggle.hidden = true; bioToggle.textContent = "Read more";
  filters.replaceChildren();
  const initial = (person.name || "?").trim().charAt(0).toUpperCase();
  const setPhoto = (path) => {
    photo.style.backgroundImage = path ? `url("https://image.tmdb.org/t/p/w342${path}")` : "none";
    photo.textContent = path ? "" : initial;
    bg.style.backgroundImage = path ? `url("https://image.tmdb.org/t/p/w342${path}")` : "none";
  };
  setPhoto(person.photo || "");
  const loading = document.createElement("p");
  loading.className = "person-note"; loading.textContent = "Loading titles…";
  content.replaceChildren(loading);
  page.scrollTop = 0;
  if (!page.open) page.showModal();

  const k = encodeURIComponent(key);
  const getJson = async (path) => {
    const response = await fetch(`https://api.themoviedb.org/3/${path}${path.includes("?") ? "&" : "?"}api_key=${k}&language=en-US`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error("TMDB rejected the saved API key. Check that it is your TMDB v3 API key (not your account password or a v4 read-access token), then save it again in Vora.");
      if (response.status === 404) throw new Error("TMDB could not find this cast member. Refresh the title's cast data and try again.");
      if (response.status === 429) throw new Error("TMDB rate limit reached. Please wait a moment and try again.");
      throw new Error(`${data?.status_message || "Could not load filmography."} (HTTP ${response.status})`);
    }
    return data;
  };
  try {
    const [details, credits] = await Promise.all([
      getJson(`person/${personId}`).catch(() => ({})),
      getJson(`person/${personId}/combined_credits`),
    ]);
    if (!page.open) return;

    // Header details
    if (details.profile_path) setPhoto(details.profile_path);
    page.querySelector(".person-kicker").textContent = details.known_for_department || "";
    const bits = [];
    if (details.birthday) bits.push(`Born ${details.birthday.slice(0, 4)}${details.place_of_birth ? " · " + details.place_of_birth : ""}`);
    else if (details.place_of_birth) bits.push(details.place_of_birth);
    page.querySelector(".person-meta").textContent = bits.join("");
    if (details.biography) {
      bio.textContent = details.biography.trim();
      bioToggle.hidden = details.biography.length < 260;
    }

    // Filmography: acting credits plus a few key crew roles, one entry per title.
    const merged = new Map();
    const add = (c, role) => {
      if (!c || !(c.title || c.name) || (c.media_type !== "movie" && c.media_type !== "tv")) return;
      if ((c.genre_ids || []).some((g) => PERSON_SKIP_GENRES.has(g))) return;
      const idKey = `${c.media_type}|${c.id}`;
      const entry = merged.get(idKey) || { ...c, roles: [] };
      if (role && !entry.roles.includes(role)) entry.roles.push(role);
      merged.set(idKey, entry);
    };
    for (const c of (credits.cast || [])) add(c, c.character && !/^(self|himself|herself)\b/i.test(c.character) ? c.character : "");
    for (const c of (credits.crew || [])) if (PERSON_CREW_JOBS.has(c.job)) add(c, c.job);
    const all = [...merged.values()].map((c) => {
      const type = c.media_type === "tv" ? "show" : "movie";
      return { credit: c, type, local: findLibraryMatch(c, type), date: String(c.release_date || c.first_air_date || "") };
    });
    if (!all.length) { const none = document.createElement("p"); none.className = "person-note"; none.textContent = "No titles found."; content.replaceChildren(none); return; }

    let active = "all";
    const render = () => {
      const list = all.filter((x) => active === "all" || x.type === active);
      const mine = list.filter((x) => x.local).sort((a, b) => b.date.localeCompare(a.date));
      const rest = list.filter((x) => !x.local).sort((a, b) => (b.credit.popularity || 0) - (a.credit.popularity || 0)).slice(0, 60);
      const sections = [];
      const section = (title, count, cards) => {
        const wrap = document.createElement("section");
        wrap.className = "person-section";
        const h = document.createElement("h3");
        h.innerHTML = `<span></span><small></small>`;
        h.firstChild.textContent = title; h.lastChild.textContent = count;
        const grid = document.createElement("div");
        grid.className = "person-grid";
        grid.append(...cards);
        wrap.append(h, grid);
        return wrap;
      };
      if (mine.length) {
        sections.push(section("In your library", String(mine.length), mine.map((x) => {
          const card = createCard(x.local);
          // Close this page first so the title opens on top of the one underneath.
          card.addEventListener("click", () => page.close(), true);
          return card;
        })));
      }
      if (rest.length) {
        sections.push(section("Not available", String(rest.length), rest.map((x) => {
          const card = createExternalCard(x.credit, x.type, x.credit.roles?.join(", ") || "");
          card.addEventListener("click", () => page.close(), true);
          return card;
        })));
      }
      if (!sections.length) { const none = document.createElement("p"); none.className = "person-note"; none.textContent = "Nothing to show here."; sections.push(none); }
      content.replaceChildren(...sections);
    };
    const chip = (id, label, count) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "person-chip" + (id === active ? " active" : "");
      b.textContent = `${label} · ${count}`;
      b.addEventListener("click", () => {
        active = id;
        filters.querySelectorAll(".person-chip").forEach((c) => c.classList.toggle("active", c === b));
        render();
      });
      return b;
    };
    const movies = all.filter((x) => x.type === "movie").length;
    const shows = all.filter((x) => x.type === "show").length;
    filters.replaceChildren(chip("all", "All", all.length), ...(movies ? [chip("movie", "Movies", movies)] : []), ...(shows ? [chip("show", "Shows", shows)] : []));
    render();
  } catch (error) {
    const note = document.createElement("p");
    note.className = "person-note";
    note.textContent = error.message || "Could not load titles.";
    content.replaceChildren(note);
  }
}

function renderCast(item) {
  const section = document.querySelector("#cast-section");
  const row = document.querySelector("#cast-row");
  row.replaceChildren();
  if (!getTmdbKey() && !(item.cast && item.cast.length)) {
    section.hidden = false;
    const note = document.createElement("p");
    note.className = "cast-note";
    note.textContent = "Add a TMDB API key in the menu to see the cast.";
    row.append(note);
    return;
  }
  if (!item.cast || !item.cast.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  for (const person of item.cast) {
    const card = document.createElement("div");
    card.className = "cast-member";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `View titles featuring ${person.name}`);
    card.addEventListener("click", () => openPersonPage(person));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPersonPage(person); } });
    const photo = document.createElement("div");
    photo.className = "cast-photo";
    if (person.photo) photo.style.backgroundImage = `url("https://image.tmdb.org/t/p/w185${person.photo}")`;
    else photo.textContent = (person.name || "?").trim().charAt(0).toUpperCase();
    const name = document.createElement("div");
    name.className = "cast-name";
    name.textContent = person.name;
    card.append(photo, name);
    if (person.character) {
      const role = document.createElement("div");
      role.className = "cast-role";
      role.textContent = person.character;
      card.append(role);
    }
    row.append(card);
  }
}

async function loadCast(item) {
  const key = getTmdbKey();
  const castHasIds = Array.isArray(item.cast) && item.cast.length > 0 && item.cast.every(person => Number.isInteger(Number(person?.id)) && Number(person.id) > 0);
  if (!key || (castHasIds && Date.now() - item.castAt < TMDB_CACHE_TTL_MS)) return;
  const api = (path, params = "") =>
    fetch(`https://api.themoviedb.org/3/${path}?api_key=${encodeURIComponent(key)}${params}`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  try {
    const kind = item.type === "show" ? "tv" : "movie";
    if (!item.tmdbId) {
      const found = (await api(`search/${kind}`, `&query=${encodeURIComponent(item.title)}&include_adult=false`)).results?.[0];
      if (!found) return;
      item.tmdbId = found.id;
    }
    const credits = await api(`${kind}/${item.tmdbId}/credits`);
    item.cast = (credits.cast || []).slice(0, 15).map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character || "",
      photo: c.profile_path || "",
    }));
    item.castAt = Date.now();
    if (!item.externalRecommendation) await saveRecord(item); // titles outside your library are never saved
    if (dialogItem === item) renderCast(item);
  } catch (error) {
    console.warn("TMDB cast failed:", error);
  }
}

const BTN_ICONS = {"plus": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 5v14M5 12h14\"/></svg>", "check": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m5 12.5 4.5 4.5L19 7\"/></svg>", "up": "<svg class=\"fillable\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3\"/></svg>", "down": "<svg class=\"fillable\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17\"/></svg>", "play": "<svg class=\"solid\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z\"/></svg>", "stop": "<svg class=\"solid\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"/></svg>", "ext": "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3\"/></svg>"};
function setIconButton(button, icon, label) {
  button.innerHTML = BTN_ICONS[icon];
  button.setAttribute("aria-label", label);
  button.title = label;
}

function syncTasteButtons(item) {
  const watch = document.querySelector("#dialog-watchlist");
  const like = document.querySelector("#dialog-like");
  const dislike = document.querySelector("#dialog-dislike");
  setIconButton(watch, item.watchlist ? "check" : "plus", item.watchlist ? "Remove from watchlist" : "Add to watchlist");
  watch.setAttribute("aria-pressed", String(!!item.watchlist));
  setIconButton(like, "up", item.reaction === "like" ? "Liked (click to clear)" : "Like");
  like.setAttribute("aria-pressed", String(item.reaction === "like"));
  setIconButton(dislike, "down", item.reaction === "dislike" ? "Disliked (click to clear)" : "Dislike");
  dislike.setAttribute("aria-pressed", String(item.reaction === "dislike"));
}
async function toggleTitleFlag(item, flag) {
  const previous = !!item[flag]; item[flag] = !previous;
  try { await saveRecord(item); } catch(e) { item[flag] = previous; showToast(e.message || "Could not update title."); return; }
  syncTasteButtons(item); renderShelves(); showToast(item[flag] ? "Added to your watchlist" : "Removed from your watchlist");
}
async function setReaction(item, reaction) {
  const previous = item.reaction || ""; item.reaction = reaction;
  try { await saveRecord(item); } catch(e) { item.reaction = previous; showToast(e.message || "Could not save your feedback."); return; }
  syncTasteButtons(item); renderShelves(); showToast(reaction === "like" ? "Got it — recommendations will learn from this" : reaction === "dislike" ? "Got it — we’ll avoid this in recommendations" : "Feedback cleared");
}
// ---- Related titles (in your library and not) --------------------------------
const relatedCache = new Map();

async function fetchRelated(item) {
  const key = getTmdbKey();
  if (!key) return [];
  const kind = item.type === "show" ? "tv" : "movie";
  const k = encodeURIComponent(key);
  let id = item.tmdbId;
  if (!id) {
    const search = await fetch(`https://api.themoviedb.org/3/search/${kind}?api_key=${k}&query=${encodeURIComponent(item.title)}&include_adult=false`).then(r => r.json());
    id = search.results?.[0]?.id;
  }
  if (!id) return [];
  const cacheKey = `${kind}:${id}`;
  if (relatedCache.has(cacheKey)) return relatedCache.get(cacheKey);
  const get = (path) => fetch(`https://api.themoviedb.org/3/${kind}/${id}/${path}?api_key=${k}&language=en-US&page=1`)
    .then(r => (r.ok ? r.json() : { results: [] })).catch(() => ({ results: [] }));
  const [recs, similar] = await Promise.all([get("recommendations"), get("similar")]);
  const seen = new Set([Number(id)]);
  const out = [];
  for (const rec of [...(recs.results || []), ...(similar.results || [])]) {
    if (!rec || seen.has(rec.id) || !(rec.title || rec.name)) continue;
    seen.add(rec.id);
    out.push(rec);
  }
  relatedCache.set(cacheKey, out);
  return out;
}

function findLibraryMatch(rec, type) {
  const name = String(rec.title || rec.name || "").toLowerCase();
  return customTitles.find(t => t.type === type && (Number(t.tmdbId) === Number(rec.id) || String(t.title || "").toLowerCase() === name));
}

function createExternalCard(rec, type, tagText = "") {
  const title = rec.title || rec.name || "Untitled";
  const card = document.createElement("article");
  card.className = "title-card recommendation-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${title} (not available). Open details.`);
  const img = document.createElement("img");
  img.className = "card-image"; img.loading = "lazy"; img.alt = "";
  if (rec.poster_path) img.src = `https://image.tmdb.org/t/p/w342${rec.poster_path}`; else card.classList.add("no-art");
  card.append(img);
  const ribbon = document.createElement("span");
  ribbon.className = "unavailable-ribbon"; ribbon.textContent = "Not Available";
  card.append(ribbon);
  const copy = document.createElement("span");
  copy.className = "card-copy";
  const genres = (rec.genre_ids || []).slice(0, 2).map(id => (TMDB_MOVIE_GENRES[id] || TMDB_TV_GENRES[id] || "")).filter(Boolean).join(" · ");
  for (const [cls, txt] of [["card-title", title], ["card-year", (rec.release_date || rec.first_air_date || "").slice(0, 4)], ["card-tag", tagText || genres]]) {
    const el = document.createElement("span"); el.className = cls; el.textContent = txt; copy.append(el);
  }
  card.append(copy);
  const open = () => openExternalRecommendation(rec, type);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  return card;
}

async function loadRelated(item) {
  const section = document.querySelector("#related-section");
  const row = document.querySelector("#related-row");
  section.hidden = true;
  row.replaceChildren();
  if (!getTmdbKey()) return;
  let recs = [];
  try { recs = await fetchRelated(item); } catch (e) { console.warn("TMDB related failed:", e); }
  if (dialogItem !== item || !recs.length) return;
  const own = String(item.title || "").toLowerCase();
  const available = [];
  const missing = [];
  for (const rec of recs) {
    if (String(rec.title || rec.name || "").toLowerCase() === own) continue;
    const local = findLibraryMatch(rec, item.type);
    if (local) { if (!available.includes(local)) available.push(local); }
    else missing.push(rec);
  }
  const cards = [
    ...available.map(createCard),               // titles you have come first
    ...missing.map(rec => createExternalCard(rec, item.type)),
  ].slice(0, 24);
  if (!cards.length) return;
  row.replaceChildren(...cards);
  section.hidden = false;
}
