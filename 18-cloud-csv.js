/* ========================================================================
   FILE: js/18-cloud-csv.js

   WHAT IT DOES:
     The 'Cloud CSV' button: downloads a published Google Sheet as CSV and
     imports it.

   OPEN THIS FILE IF YOU WANT TO:
     change how the shared sheet is read.
   ======================================================================== */

// ---------------------------------------------------------------
// Cloud CSV — reads a public Google Sheet (published as CSV) and imports it
// just like a normal CSV import. Edit the sheet, then hit Cloud CSV again.
// ---------------------------------------------------------------
const cloudOpenButton = document.querySelector("#open-cloud-csv");

// The link is stored on the Vora server and can be changed (or reset to the default) in Advanced settings.
function cleanSheetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try { url = new URL(raw); } catch { return ""; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  // A normal sheet link (…/d/<id>/edit) → its CSV export. Published links are left alone.
  const normal = url.hostname === "docs.google.com" && url.pathname.match(/^\/spreadsheets\/d\/([^/]+)\/(?:edit|view|htmlview)?/);
  if (normal && normal[1] !== "e") {
    const gid = (url.hash.match(/gid=(\d+)/) || url.search.match(/gid=(\d+)/) || [])[1];
    return `https://docs.google.com/spreadsheets/d/${normal[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
  }
  return url.toString();
}

async function currentCloudCsvUrl() {
  const config = await refreshVoraConfig();
  const url = cleanSheetUrl(config.sheetUrl);
  if (!url) throw new Error("No Google Sheet link is set on the Vora server.");
  return url;
}

async function cloudDownloadCsv() {
  const response = await fetch(await currentCloudCsvUrl(), { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read the Google Sheet (HTTP ${response.status}).`);
  const text = await response.text();
  // A sheet that isn't published returns an HTML page instead of CSV.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error("The Google Sheet isn't published as CSV.");
  }
  return text;
}

cloudOpenButton.addEventListener("click", async () => {
  cloudOpenButton.disabled = true;
  showToast("Loading from Google Sheets…");
  try {
    const text = await cloudDownloadCsv();
    await importCsvText(text);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not load the cloud CSV.");
  } finally {
    cloudOpenButton.disabled = false;
  }
});
