/* ========================================================================
   FILE: js/02-server-connection.js

   WHAT IT DOES:
     Talks to the Vora server (Supabase). Holds the server address, the
     login session, and the code that sends requests to the server. It also
     makes every TMDB request go through the server so the TMDB key stays
     hidden.

   OPEN THIS FILE IF YOU WANT TO:
     change the server address or public key (see the two lines
     near the top), or change how the app logs in.
   ======================================================================== */

// ===========================================================================
// Vora server (Supabase Edge Function "vora-api")
// The settings password, TMDB API key and Google Sheet link live on the server.
// The browser never receives the TMDB key: every TMDB request below is sent to
// the server, which adds the key and forwards it. See SETUP.md.
// ===========================================================================
const VORA_API = "https://zomnjlmnzzelbtrbbtaf.supabase.co/functions/v1/vora-control";
const VORA_ANON_KEY = "sb_publishable_05Expy-HinzSih8YjkKdBA_Sp-raj4j"; // the public (publishable) key is safe to put here
const VORA_SESSION_KEY = "vora-session";
const TMDB_API_BASE = "https://api.themoviedb.org/3/";
const voraConfigured = !/YOUR-/.test(VORA_API + VORA_ANON_KEY);
let voraConfig = { sheetUrl: "", sheetCustom: false, tmdbCustom: false, tmdbAvailable: voraConfigured };

const nativeFetch = window.fetch.bind(window);
// (Lives here, not in the admin file, because the code above needs it the moment this file loads.)
function adminKey() { try { return sessionStorage.getItem("vora-admin") || ""; } catch { return ""; } }
function voraHeaders(extra = {}) {
  const headers = { apikey: VORA_ANON_KEY, ...extra };
  // Older-style (JWT) anon keys are also sent as a Bearer token; new publishable keys are not JWTs.
  if (VORA_ANON_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${VORA_ANON_KEY}`;
  const session = readSession();
  if (session) headers["x-vora-session"] = session.token;
  const admin = adminKey();
  if (admin) headers["x-admin-key"] = admin;
  return headers;
}

// Any request to api.themoviedb.org is sent through the server instead (it adds the key).
window.fetch = function (input, init) {
  const raw = typeof input === "string" ? input : (input && input.url) || "";
  if (!raw.startsWith(TMDB_API_BASE)) return nativeFetch(input, init);
  if (!voraConfigured) return Promise.reject(new Error("Vora server isn't set up yet (see SETUP.md)."));
  if (!readSession()) {
    return Promise.resolve(new Response(JSON.stringify({ error: "Unlock settings to use TMDB." }), { status: 401, headers: { "Content-Type": "application/json" } }));
  }
  const target = new URL(raw);
  target.searchParams.delete("api_key");
  const query = new URLSearchParams({
    action: "tmdb",
    path: target.pathname.replace(/^\/3\//, ""),
    qs: target.searchParams.toString(),
  });
  return nativeFetch(`${VORA_API}?${query}`, { ...init, headers: voraHeaders() }).then((response) => {
    if (response.status === 401) { clearSession(); syncLockedUi(); }
    return response;
  });
};

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(VORA_SESSION_KEY) || "null");
    if (session && session.token && Number(session.expiresAt) > Date.now()) return session;
    localStorage.removeItem(VORA_SESSION_KEY);
  } catch { /* storage unavailable */ }
  return null;
}
function saveSession(token, expiresAt) {
  try { localStorage.setItem(VORA_SESSION_KEY, JSON.stringify({ token, expiresAt })); } catch { /* ignore */ }
}
function clearSession() {
  try { localStorage.removeItem(VORA_SESSION_KEY); } catch { /* ignore */ }
  if (typeof syncLockedUi === "function") syncLockedUi();
}

async function voraCall(action, body, { auth = false } = {}) {
  if (!voraConfigured) throw new Error("Vora server isn't set up yet. Add your Supabase URL and anon key at the top of js/02-server-connection.js (see SETUP.md).");
  const headers = voraHeaders({ "Content-Type": "application/json" });
  if (auth) {
    const session = readSession();
    if (!session) { const none = new Error("Unlock settings first."); none.status = 401; throw none; }
    headers["x-vora-session"] = session.token;
  }
  let response;
  try {
    response = await nativeFetch(`${VORA_API}?action=${encodeURIComponent(action)}`, { method: "POST", headers, body: JSON.stringify(action === "login" ? { ...body, clientId: CLIENT_ID } : (body || {})) });
  } catch {
    throw new Error("Could not reach the Vora server. Check your connection.");
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && auth) clearSession();
  if (!response.ok) {
    const error = new Error(data.error || `Server error (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// Like voraCall, but if the session expired it asks for the password again and retries once.
async function voraAuthedCall(action, body) {
  try {
    return await voraCall(action, body, { auth: true });
  } catch (error) {
    if (error.status === 401 && (await requestUnlock())) return voraCall(action, body, { auth: true });
    throw error;
  }
}

async function refreshVoraConfig() {
  if (!voraConfigured) return voraConfig;
  try {
    const response = await nativeFetch(`${VORA_API}?action=config`, { headers: voraHeaders(), cache: "no-store" });
    if (response.ok) voraConfig = { ...voraConfig, ...(await response.json()) };
  } catch { /* keep the last known config */ }
  return voraConfig;
}
refreshVoraConfig();
try { localStorage.removeItem("vora-tmdb-key"); } catch { /* old browser-stored key is no longer used */ }
