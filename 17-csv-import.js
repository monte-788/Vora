/* ========================================================================
   FILE: js/17-csv-import.js

   WHAT IT DOES:
     Import from a CSV file: reads the file, groups rows into movies and
     shows, and adds them to your library.

   OPEN THIS FILE IF YOU WANT TO:
     change which CSV columns are understood or how rows become
     titles.
   ======================================================================== */

// ---------------------------------------------------------------------
// CSV import
//
// Expected columns (any order, header row required, case-insensitive):
//   type, title, genre, genre2, description, banner, watch, season, episode
//
// Only type and title are required. watch may be empty; an empty watch value
// means the title/episode is imported without playback and no URL is guessed.
// genre/genre2/description/banner
// are optional — anything left blank is auto-filled after import by looking
// the title up on TMDB (see js/16-tmdb-key-and-autofill.js), as long as
// a free TMDB API key has been saved via the ⚙ TMDB key button. Rows still
// work with no key at all; they just keep whatever fields the CSV supplied.
//
// One row = one movie, OR one episode of a show.
// Movie rows: type=movie. genre/genre2/description/banner are optional,
//   watch is the movie's own watch link. season/episode are ignored.
// Show rows: type=show. All rows that share the same title (case-insensitive)
//   are grouped into a single show, each row becoming one episode using its
//   season/episode/watch. genre/genre2/description only need to be filled in
//   on one row for that show (first non-empty value wins). If any row for a
//   show has a banner, that image is used as the show's banner — this is how
//   "grab a banner from one of the show's episodes" is implemented, since
//   individual episodes don't get their own banner in Vora. When none of a
//   show's rows carry these fields, they come from TMDB instead, same as
//   for movies.
// ---------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  // Normalize line endings so \r\n and \r behave like \n inside the parser.
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const CSV_COLUMNS = [
  "type",
  "title",
  "genre",
  "genre2",
  "description",
  "banner",
  "watch",
  "ip",
  "season",
  "episode",
];

function csvRowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((cell) =>
    cell.trim().toLowerCase().replace(/[\s_-]+/g, ""),
  );
  const aliases = {
    genre1: "genre",
    secondgenre: "genre2",
    watchlink: "watch",
    ipaddress: "ip",
    baseip: "ip",
    synopsis: "description",
  };
  const columnIndex = {};
  header.forEach((name, index) => {
    const key = aliases[name] || name;
    if (CSV_COLUMNS.includes(key) && !(key in columnIndex)) {
      columnIndex[key] = index;
    }
  });
  const objects = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const object = { __row: i + 1 };
    for (const key of CSV_COLUMNS) {
      const index = columnIndex[key];
      object[key] = index === undefined ? "" : (cells[index] || "").trim();
    }
    objects.push(object);
  }
  return objects;
}

function buildIpWatchUrl(ip, type, title) {
  const base = String(ip || "").trim();
  const name = String(title || "").trim();
  if (!base || !name) return "";
  try {
    const root = new URL(base.endsWith("/") ? base : `${base}/`);
    if (!/^https?:$/.test(root.protocol)) return "";
    const folder = String(type || "movie").toLowerCase() === "show" ? "Shows" : "Movies";
    return new URL(`${folder}/${name.split("/").map(encodeURIComponent).join("/")}`, root).href;
  } catch { return ""; }
}

function buildImportPlan(objects, existingTitles) {
  const takenTitles = new Set(existingTitles.map((t) => t.toLowerCase()));
  const showGroups = new Map();
  const showOrder = [];
  const newRecords = [];
  const errors = [];
  let skippedDuplicates = 0;

  for (const object of objects) {
    const title = object.title.trim();
    if (!title) {
      errors.push(`Row ${object.__row}: missing a title — skipped.`);
      continue;
    }
    const type = object.type.trim().toLowerCase() === "show" ? "show" : "movie";
    const key = `${type}:${title.toLowerCase()}`;

    if (type === "movie") {
      if (takenTitles.has(title.toLowerCase())) {
        skippedDuplicates++;
        continue;
      }
      takenTitles.add(title.toLowerCase());
      const genres = [object.genre, object.genre2].filter(Boolean).slice(0, 2);
      newRecords.push({
        id: createId(),
        type: "movie",
        title,
        genres,
        description: object.description,
        banner: object.banner,
        // Empty watch means intentionally unavailable: do not guess from ip.
        driveUrl: object.watch ? object.watch : "",
        episodes: [],
        createdAt: new Date().toISOString(),
      });
      continue;
    }

    // Show row: group by title so every episode row folds into one show.
    if (!showGroups.has(key)) {
      if (takenTitles.has(title.toLowerCase())) {
        skippedDuplicates++;
        showGroups.set(key, null); // mark as skipped so its episodes are ignored too
      } else {
        takenTitles.add(title.toLowerCase());
        showGroups.set(key, {
          title,
          genre: "",
          genre2: "",
          description: "",
          banner: "",
          episodes: [],
        });
        showOrder.push(key);
      }
    }
    const group = showGroups.get(key);
    if (!group) continue; // this show was a duplicate; skip its episode rows too

    if (object.genre && !group.genre) group.genre = object.genre;
    if (object.genre2 && !group.genre2) group.genre2 = object.genre2;
    if (object.description && !group.description) group.description = object.description;
    // "find a banner in the show's episodes and use it as the show's banner"
    if (object.banner && !group.banner) group.banner = object.banner;

    const season = Number.parseInt(object.season, 10) || 1;
    const episodeNumber =
      Number.parseInt(object.episode, 10) || group.episodes.length + 1;
    // Empty watch means skip playback for this episode; keep its metadata only.
    const generatedWatch = object.watch ? object.watch : "";
    group.episodes.push({
      season,
      episode: episodeNumber,
      title: `Season ${season}, Episode ${episodeNumber}`,
      driveUrl: generatedWatch,
    });
  }

  for (const key of showOrder) {
    const group = showGroups.get(key);
    if (!group || !group.episodes.length) continue;
    const genres = [group.genre, group.genre2].filter(Boolean).slice(0, 2);
    newRecords.push({
      id: createId(),
      type: "show",
      title: group.title,
      genres,
      description: group.description,
      banner: group.banner,
      driveUrl: "",
      episodes: group.episodes,
      createdAt: new Date().toISOString(),
    });
  }

  return { newRecords, errors, skippedDuplicates };
}

// Shared tail end of every bulk-import source (the CSV file):
// turns a list of row-shaped objects (type/title/genre/genre2/description/
// banner/watch/season/episode/__row) into saved library entries, same dedup
// and TMDB auto-fill rules every time. `extraMessage`, if given, is appended
// to the success toast.
// Rescans: episodes found for a show already in the library are added to
// that show (skipping ones it already has) instead of counting as duplicates.
async function mergeIntoExistingShows(objects) {
  const rest = [];
  const touched = new Set();
  let added = 0;
  let updated = 0;
  for (const o of objects) {
    const title = o.title.trim().toLowerCase();
    const isShow = o.type.trim().toLowerCase() === "show";
    const existing = customTitles.find((i) => i.title.toLowerCase() === title && i.type === (isShow ? "show" : "movie"));
    if (!existing) { rest.push(o); continue; }
    if (!o.watch) continue;
    let link = o.watch;
    try { link = mediaLinkUrl(o.watch); } catch { /* keep raw */ }
    if (!isShow) {
      // Existing movie: refresh its watch link, keep everything else.
      if (existing.driveUrl !== link) { existing.driveUrl = link; touched.add(existing); updated++; }
      continue;
    }
    const season = Number.parseInt(o.season, 10) || 1;
    const episode = Number.parseInt(o.episode, 10) || existing.episodes.length + 1;
    const match = existing.episodes.find((e) => e.season === season && e.episode === episode);
    if (match) {
      // Existing episode: refresh its watch link, keep progress etc.
      if (match.driveUrl !== link) { match.driveUrl = link; touched.add(existing); updated++; }
      continue;
    }
    if (existing.episodes.some((e) => e.driveUrl === link)) continue;
    existing.episodes.push({ season, episode, title: `Season ${season}, Episode ${episode}`, driveUrl: link, still: "" });
    touched.add(existing);
    added++;
  }
  for (const item of touched) {
    item.episodes = sortEpisodes(item.episodes);
    if (item.episodes.length) item.detailsAt = 0; // refetch names + stills for new episodes
    await saveRecord(item);
  }
  return { rest, added, updated, shows: touched.size };
}

async function importScannedObjects(objects, { noneFoundMessage, extraMessage } = {}) {
  const merged = await mergeIntoExistingShows(objects);
  objects = merged.rest;
  const existingTitles = customTitles.map((item) => item.title);
  const { newRecords, errors, skippedDuplicates } = buildImportPlan(
    objects,
    existingTitles,
  );

  const mergeParts = [];
  if (merged.added) mergeParts.push(`${merged.added} new episode${merged.added === 1 ? "" : "s"} added`);
  if (merged.updated) mergeParts.push(`${merged.updated} watch link${merged.updated === 1 ? "" : "s"} updated`);
  const mergeNote = mergeParts.join(" · ");
  if (!newRecords.length) {
    if (merged.added || merged.updated) {
      renderShelves();
      showToast(mergeNote);
      return;
    }
    showToast(
      skippedDuplicates
        ? `Nothing new to import — ${skippedDuplicates} title${skippedDuplicates === 1 ? "" : "s"} already in your library.`
        : noneFoundMessage || "No valid rows found to import.",
    );
    return;
  }

  await enrichRecordsWithTmdb(newRecords, errors);

  applyStashedPersonalData(newRecords);
  const normalized = newRecords.map(normalizeRecord).map(toCardItem);
  await Promise.all(normalized.map(saveRecord));
  customTitles = [...normalized, ...customTitles];
  renderShelves();
  searchInput.value = "";
  applySearch();

  const showCount = normalized.filter((item) => item.type === "show").length;
  const movieCount = normalized.length - showCount;
  const parts = [];
  if (movieCount) parts.push(`${movieCount} movie${movieCount === 1 ? "" : "s"}`);
  if (showCount) parts.push(`${showCount} show${showCount === 1 ? "" : "s"}`);
  let message = `Imported ${parts.join(" and ")}`;
  if (skippedDuplicates) {
    message += ` · skipped ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"}`;
  }
  if (mergeNote) message += ` · ${mergeNote}`;
  if (extraMessage) message += ` · ${extraMessage}`;
  showToast(message);

  if (errors.length) {
    // Non-blocking: the import already happened, this just surfaces rows
    // that were missing a watch link so they can be filled in later.
    console.warn("Vora import notes:\n" + errors.join("\n"));
    window.alert(
      `Imported with ${errors.length} note${errors.length === 1 ? "" : "s"}:\n\n` +
        errors.slice(0, 20).join("\n") +
        (errors.length > 20 ? `\n…and ${errors.length - 20} more.` : ""),
    );
  }
}

async function importCsvFile(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    showToast("Could not read that file.");
    return;
  }

  await importCsvText(text);
}

async function importCsvText(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    showToast("That CSV has no rows to import.");
    return;
  }
  const objects = csvRowsToObjects(rows);

  await importScannedObjects(objects, {
    noneFoundMessage: "No valid rows found in that CSV.",
  });
}

importCsvButton.addEventListener("click", () => importCsvInput.click());
importCsvInput.addEventListener("change", async () => {
  const file = importCsvInput.files[0];
  importCsvInput.value = "";
  if (!file) return;
  importCsvButton.disabled = true;
  try {
    await importCsvFile(file);
  } catch (error) {
    console.error(error);
    showToast("That CSV could not be imported.");
  } finally {
    importCsvButton.disabled = false;
  }
});
