// A safe, fallback-enabled localStorage utility to prevent crashes in sandboxed iframes.
const memoryStore = {};

const isStorageAvailable = () => {
  try {
    const key = "__storage_test__";
    window.localStorage.setItem(key, key);
    window.localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
};

const storageAvailable = isStorageAvailable();

export const safeStorage = {
  getItem: (key) => {
    if (storageAvailable) {
      try {
        return window.localStorage.getItem(key);
      } catch (e) {
        console.warn("localStorage.getItem failed, using memory fallback", e);
      }
    }
    return key in memoryStore ? memoryStore[key] : null;
  },
  setItem: (key, value) => {
    if (storageAvailable) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch (e) {
        console.warn("localStorage.setItem failed, using memory fallback", e);
      }
    }
    memoryStore[key] = String(value);
  },
  removeItem: (key) => {
    if (storageAvailable) {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch (e) {
        console.warn("localStorage.removeItem failed, using memory fallback", e);
      }
    }
    delete memoryStore[key];
  },
  clear: () => {
    if (storageAvailable) {
      try {
        window.localStorage.clear();
        return;
      } catch (e) {
        console.warn("localStorage.clear failed, using memory fallback", e);
      }
    }
    for (const key in memoryStore) {
      delete memoryStore[key];
    }
  }
};

// v477 (Ravi: "Instagram jaisa switch account"): every account logged in on this phone (max 5), so the Profile tab's
// long-press sheet can switch without logging in again. Each keeps its own login token; the active one is also in
// "ybex_token" / "ybex_user" exactly as before.
export const ACCOUNTS_KEY = "ybex_accounts";
export const MAX_ACCOUNTS = 5;
export function savedAccounts() {
  try {
    const list = JSON.parse(safeStorage.getItem(ACCOUNTS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((a) => a && a.user_id && a.token) : [];
  } catch { return []; }
}
function writeAccounts(list) { try { safeStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list)); } catch { /* full */ } }
/** Save / refresh the signed-in account (newest first). Oldest other account drops off past 5. */
export function rememberAccount(user, token, now = Date.now()) {
  const uid = user?.user_id || user?.id;
  if (!uid || !token) return savedAccounts();
  const row = { user_id: uid, token, name: user.name || user.company_name || user.email || "Ybex", role: user.role || "", picture: user.picture || user.avatar || "", email: user.email || "", user, at: now };
  const list = [row, ...savedAccounts().filter((a) => a.user_id !== uid)].slice(0, MAX_ACCOUNTS);
  writeAccounts(list);
  return list;
}
export function forgetAccount(uid) { const list = savedAccounts().filter((a) => a.user_id !== uid); writeAccounts(list); return list; }
export function accountFor(uid) { return savedAccounts().find((a) => a.user_id === uid) || null; }

export default safeStorage;
