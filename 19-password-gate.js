/* ========================================================================
   FILE: js/19-password-gate.js

   WHAT IT DOES:
     The password window that protects the settings menu, and whether
     settings are currently unlocked.

   OPEN THIS FILE IF YOU WANT TO:
     change how the password prompt behaves.
   ======================================================================== */

// ===========================================================================
// Settings, home-banner rotation, favorites, home category, password gate
// ===========================================================================

// ---- Password gate for the settings menu -----------------------------------
// The password is checked by the Vora server (it only stores a salted hash). A
// successful login returns a signed session token that is remembered here, and
// the server requires it for every change to the TMDB key or sheet link.
let passwordResolve = null;
let forcedFails = 0;
const REAUTH_MAX_TRIES = 3; // wrong password this many times after a password change => library emptied
let passwordBusy = false;

const passwordDialog = document.querySelector("#password-dialog");
const passwordForm = document.querySelector("#password-form");
const passwordInput = document.querySelector("#password-input");
const passwordError = document.querySelector("#password-error");

function isUnlocked() {
  return !!readSession();
}

function requestUnlock() {
  if (isUnlocked()) return Promise.resolve(true);
  return new Promise((resolve) => {
    passwordResolve = resolve;
    passwordInput.value = "";
    passwordError.textContent = "";
    passwordDialog.showModal();
    passwordInput.focus();
  });
}

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (passwordBusy || !passwordInput.value) return;
  const attempt = passwordInput.value;
  const submit = passwordForm.querySelector('[type="submit"]');
  passwordBusy = true;
  submit.disabled = true;
  passwordError.textContent = "Checking…";
  try {
    const { token, expiresAt, passwordVersion } = await voraCall("login", { password: attempt });
    saveSession(token, expiresAt);
    saveAuthVersion(passwordVersion);
    passwordInput.value = "";
    passwordError.textContent = "";
    passwordDialog.close();
    refreshVoraConfig();
    syncLockedUi();
  } catch (error) {
    if (passwordDialog.dataset.forced && error.status === 401 && ++forcedFails >= REAUTH_MAX_TRIES) {
      passwordDialog.dataset.forced = "";
      passwordDialog.close();
      return;
    }
    passwordError.textContent = error.message || "Could not check the password.";
    passwordInput.value = "";
    passwordInput.focus();
  } finally {
    passwordBusy = false;
    submit.disabled = false;
  }
});
passwordDialog.querySelector(".dialog-close").addEventListener("click", () => passwordDialog.close());
passwordDialog.querySelector("#password-cancel").addEventListener("click", () => passwordDialog.close());
passwordDialog.addEventListener("click", (event) => {
  if (event.target === passwordDialog && !passwordDialog.dataset.forced) passwordDialog.close();
});
passwordDialog.addEventListener("close", () => {
  passwordInput.value = "";
  if (passwordResolve) {
    const resolve = passwordResolve;
    passwordResolve = null;
    resolve(isUnlocked());
  }
});
