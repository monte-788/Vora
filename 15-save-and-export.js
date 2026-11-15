/* ========================================================================
   FILE: js/15-save-and-export.js

   WHAT IT DOES:
     Reading/merging the library embedded in the page and the 'Export
     library' file download.

   OPEN THIS FILE IF YOU WANT TO:
     change how the library is exported or imported from the page
     file.
   ======================================================================== */

function readEmbeddedLibrary() {
  try {
    const data = JSON.parse(document.querySelector("#vora-data").textContent);
    if (data && Array.isArray(data.titles)) {
      return { savedAt: String(data.savedAt || ""), titles: data.titles };
    }
  } catch {
    /* fall through to an empty library */
  }
  return { savedAt: "", titles: [] };
}

function importedSnapshots() {
  try {
    const list = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function rememberSnapshot(savedAt) {
  if (!savedAt) return;
  try {
    const list = importedSnapshots().filter((entry) => entry !== savedAt);
    list.push(savedAt);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* localStorage unavailable */
  }
}

// Adds titles from the file that this browser doesn't have yet.
// Each saved file is merged once, so titles you removed here stay removed.
function mergeEmbeddedTitles(records, embedded) {
  if (!embedded.titles.length) return 0;
  if (embedded.savedAt && importedSnapshots().includes(embedded.savedAt)) return 0;
  const ids = new Set(records.map((record) => record.id));
  const names = new Set(
    records.map((record) => String(record.title || "").toLowerCase()),
  );
  let added = 0;
  for (const record of embedded.titles) {
    if (!record || !record.id || ids.has(record.id)) continue;
    if (names.has(String(record.title || "").toLowerCase())) continue;
    records.push(record);
    ids.add(record.id);
    added++;
  }
  rememberSnapshot(embedded.savedAt);
  return added;
}

function librarySignature(list) {
  return list
    .map((item) => item.id)
    .sort()
    .join("|");
}

function updateSaveState() {
  if (!saveButton) return; // Export library button was removed from the topbar.
  const changed = librarySignature(customTitles) !== savedSignature;
  saveButton.classList.toggle("has-changes", changed);
  saveButton.setAttribute(
    "aria-label",
    changed ? "Export library (unsaved changes)" : "Export library",
  );
}

async function saveLibraryFile() {
  const payload = {
    app: "vora",
    version: 2,
    savedAt: new Date().toISOString(),
    titles: customTitles,
  };
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const dataBlock = new RegExp(
    '(<scr' + 'ipt\\b[^>]*id="vora-data"[^>]*>)[\\s\\S]*?(</scr' + 'ipt>)',
  );

  if (!dataBlock.test(pristineHTML)) {
    showToast("Could not build the file to save.");
    return;
  }

  const html = pristineHTML.replace(
    dataBlock,
    (match, open, close) => open + json + close,
  );
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const filename = "vora.html";

  const markSaved = () => {
    rememberSnapshot(payload.savedAt);
    savedSignature = librarySignature(customTitles);
    updateSaveState();
  };

  // Prefer the File System Access API so the user can choose the exact
  // destination and filename instead of relying on browser download rules.
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Vora HTML file",
            accept: { "text/html": [".html"] },
          },
        ],
        excludeAcceptAllOption: false,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      markSaved();
      showToast("Saved Vora library.");
      return;
    } catch (error) {
      // Canceling the save dialog should not trigger another export path.
      if (error?.name === "AbortError") return;
      // Unsupported/blocked picker: continue to the compatibility fallbacks.
    }
  }

  // Android/Chrome-based wrappers can expose Web Share even when they do not
  // support the native save picker. This keeps export usable in those shells.
  try {
    const file = new File([blob], filename, { type: "text/html" });
    if (
      navigator.share &&
      (!navigator.canShare || navigator.canShare({ files: [file] }))
    ) {
      await navigator.share({
        title: "Vora library",
        text: "Exported Vora library",
        files: [file],
      });
      markSaved();
      showToast("Vora library exported.");
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }

  // Final browser fallback for environments without the save picker/share.
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);

    markSaved();
    showToast("Saved vora.html.");
    return;
  } catch {
    // Some WebViews block both download and blob URLs.
  }

  // Last-resort WebView fallback: open the generated file so it can still
  // be saved/shared from the browser/WebView UI.
  try {
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank");
    if (!opened) window.location.href = url;
    markSaved();
    showToast("Export opened. Save/share the HTML from there.");
  } catch {
    showToast("This browser blocks file export.");
  }
}

// Note: the "Export library" button that used to trigger saveLibraryFile()
// has been removed from the topbar. saveLibraryFile() and the save-state
// tracking above are left in place (unused) rather than torn out, in case
// a way to trigger them is added back later.
