/* ========================================================================
   FILE: js/27-admin-control.js

   WHAT IT DOES:
     Admin features: reporting that the app is open, being removed by the
     admin, forced re-login after a password change, and the maintenance
     lock screen.

   OPEN THIS FILE IF YOU WANT TO:
     change how the app reacts to admin actions.
   ======================================================================== */

// ===========================================================================
// Admin control: presence, kick, forced re-login after a password change,
// and the maintenance lock. Managed from admin/index.html (vora-control function).
// ===========================================================================
const CLIENT_ID = (() => {
  let id = "";
  try { id = localStorage.getItem("vora-client-id") || ""; if (!id) localStorage.setItem("vora-client-id", (id = createId())); } catch { /* private mode */ }
  return id || createId();
})();
const AUTH_VERSION_KEY = "vora-auth-version";
let watching = null, beatTimer = 0, locked = false, reauthing = false;

// Opening the app from the dashboard (#admin=KEY) lets you in while it is locked.
const adminHash = location.hash.match(/admin=([\w-]+)/);
if (adminHash) {
  try { sessionStorage.setItem("vora-admin", adminHash[1]); } catch { /* ignore */ }
  history.replaceState(null, "", location.pathname + location.search);
}
function saveAuthVersion(v) { try { if (v) localStorage.setItem(AUTH_VERSION_KEY, String(v)); } catch { /* ignore */ } }

function setWatching(item, episode) {
  watching = item ? { title: item.title, detail: episode ? `S${episode.season} E${episode.episode}` : item.type === "show" ? "" : "Movie" } : null;
  if (voraConfigured) beat();
}

async function beat() {
  clearTimeout(beatTimer);
  try {
    const response = await nativeFetch(`${VORA_API}?action=heartbeat`, {
      method: "POST", headers: voraHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ clientId: CLIENT_ID, watching }),
    });
    if (response.ok) await handleControl(await response.json());
  } catch { /* offline: try again next time */ }
  beatTimer = setTimeout(beat, locked ? 10000 : 30000);
}

async function handleControl(d) {
  setLocked(!!d.maintenance);
  if (d.kick) { await forceWipe("You were removed by the admin. Enter the password to continue."); return; }
  if (!(d.passwordVersion >= 1)) return;
  const mine = Number(localStorage.getItem(AUTH_VERSION_KEY)) || 0;
  if (!mine) { if (isUnlocked() || customTitles.length) saveAuthVersion(d.passwordVersion); } // existing users are adopted
  else if (mine !== d.passwordVersion && !locked) startReauth();
}

function setLocked(on) {
  if (on === locked) return;
  locked = on;
  document.querySelector("#lock-screen").hidden = !on;
  if (on) { closePlayer(); document.querySelectorAll("dialog[open]").forEach((d) => d.close()); }
}

// Same as pressing "Empty media library" -> "Delete only the titles", plus: sign out and drop the local backup.
async function forceWipe(message) {
  clearSession();
  reauthing = false;
  passwordDialog.dataset.forced = "";
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  setMenuOpen(false);
  await emptyLibrary("titles");
  try { localStorage.removeItem(AUTO_BACKUP_KEY); localStorage.removeItem(AUTH_VERSION_KEY); } catch { /* ignore */ }
  showToast(message);
  if (!locked) { requestUnlock(); passwordError.textContent = message; }
}

// Password was changed: everyone must enter the new one or lose their library.
async function startReauth() {
  if (reauthing) return;
  reauthing = true;
  clearSession();
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  forcedFails = 0;
  const title = document.querySelector("#password-title"), label = passwordForm.querySelector(".field-label");
  title.textContent = "Password changed";
  label.textContent = "Enter the new password to keep your library";
  passwordDialog.dataset.forced = "1";
  const ok = await requestUnlock();
  title.textContent = "Enter password";
  label.textContent = "Password to open settings";
  passwordDialog.dataset.forced = "";
  if (!reauthing) return; // a kick got here first
  reauthing = false;
  if (!ok) await forceWipe("Wrong password, so your library was emptied.");
}
passwordDialog.addEventListener("cancel", (e) => { if (passwordDialog.dataset.forced) e.preventDefault(); });

function startControl() {
  if (!voraConfigured) return;
  beat();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(); });
}
