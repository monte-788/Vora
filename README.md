# Vora — project guide (for non-coders)

Open `index.html` in a browser to run the app. Nothing needs to be installed.

## What is where

| Folder / file | What it is |
|---|---|
| `index.html` | The page itself: all the buttons, windows and text you see. It also lists, in order, which style and code files to load. |
| `css/` | **How things look** (colours, sizes, spacing). 12 small files, one per area of the screen. |
| `js/` | **How things work** (what happens when you click). 29 small files, one per feature. |

## The code files (`js/`), in the order they load

| File | What it does |
|---|---|
| `01-setup.js` | Starting point: names, storage keys, and finding the page's buttons/windows |
| `02-server-connection.js` | Talking to the Vora server (login, TMDB requests) |
| `03-helpers.js` | Pop-up messages and small tools used everywhere |
| `04-player.js` | Built-in video player + "watched / short / recent" rules |
| `05-subtitles.js` | Uploading and loading subtitles |
| `06-cards.js` | The poster cards and genre shelves |
| `07-home-rows-and-chips.js` | "Surprise me", "Not watched yet", filter chips |
| `08-hero-search-and-shelves.js` | Top banner, search, Watchlist, "Because you liked…" |
| `09-title-details.js` | Episode list and details on a title page |
| `10-cast-and-related.js` | Cast pages, like/dislike, related titles |
| `11-trailer.js` | Trailer in the banner |
| `12-dialogs-and-buttons.js` | Opening windows, and what most buttons do |
| `13-add-title-form.js` | The "Add title" form |
| `14-library-storage.js` | Saving your library in the browser, adding titles |
| `15-save-and-export.js` | Export / reading the embedded library |
| `16-tmdb-key-and-autofill.js` | TMDB availability + auto-filling missing info |
| `17-csv-import.js` | Importing from a CSV file |
| `18-cloud-csv.js` | Importing from the shared Google Sheet |
| `19-password-gate.js` | The settings password window |
| `20-settings-banner-favorites.js` | Saved settings, rotating banner, favorites |
| `21-advanced-settings.js` | Advanced settings window |
| `22-watched-status.js` | Marking titles watched / adding to library |
| `23-advanced-settings-tools.js` | More Advanced settings tools |
| `24-posters-and-loading.js` | Fetching posters + loading your library at startup |
| `25-menu-and-empty-library.js` | Top-right menu + "Empty media library" |
| `26-discover.js` | The Discover tab |
| `27-admin-control.js` | Admin features (kick, maintenance lock, forced re-login) |
| `28-cloud-sync.js` | Shared cloud sync of Watched / Recently watched / Liked / Favorited / Continue watching, and TMDB title matches |
| `29-start-app.js` | Last step: starts the app |

Every file begins with a box explaining what it does and when you would open it.

## Important rules

1. **Order matters.** The files must stay in the same order in `index.html` (01 first, 29 last). Files later in the list use things defined by earlier ones. If you add a new file, add it to the list in `index.html` *before* `29-start-app.js`.
2. **Keep the folder together.** `index.html`, `css/` and `js/` must stay side by side. The "Export library" download is a copy of `index.html`, so keep it next to `css/` and `js/` too (just as it needed `script.js` and `style.css` before).
3. **Server address and key** live near the top of `js/02-server-connection.js`.
4. **Colours** live at the top of `css/01-base.css` (the lines starting with `--`).

## What changed compared with the original

Nothing about how the app works. (Original refactor note) The code was only cut into files and given explanatory headers, plus three tiny moves needed because the code now lives in several files:

- `adminKey()` moved from the admin file into `02-server-connection.js` (the server code uses it the instant it loads).
- The `applyDiscoverLock();` line moved to `28-start-app.js` (it needs the password-gate file, so it runs after everything has loaded).
- The three startup lines (`addEpisodeRow()`, `updateTypeFields()`, `initialize()...`) moved to `28-start-app.js`.

Two comments/messages were updated to point at the new file names.

## Player features

| Key | What it does |
|---|---|
| **F** | Full screen on / off (also the "Full screen" button) |
| **C** | Subtitles on / off. If none are loaded it loads the **English** ones |
| **+** (or **=**) / **−** | Subtitles bigger / smaller (remembered) |

The player bar also has **Playback speed** (0.5×–2×, remembered) and **Auto-next** (on by default: when an episode ends, a 5-second "Up next" card plays the next episode; Cancel or turn it off any time).

## Cloud sync (one-time setup)

1. In Supabase open **SQL Editor**, paste the contents of `cloud-sync.sql` and press **Run**.
2. That's it. Tags are saved to the shared `vora_tags` table the moment they change and appear on everyone's open Vora live (with a polling safety net if the live connection drops).

Also synced: the **TMDB title matches** you pick in Advanced settings (stored in `vora_tmdb_matches`). When someone picks a match, everyone's copy of that title switches to it (id, year, poster, banner, description, genres).

Synced tags: Watchlist, Watched, Recently watched, Liked/Disliked, Favorited, Continue watching (also per episode). Titles are matched between people by TMDB id (or title + year if there is no TMDB id). Everyone shares the same tags. Playback position is sent immediately when you start/stop and about every 15 seconds while watching.
