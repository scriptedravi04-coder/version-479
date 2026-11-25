// v336 (Ravi: phone notifications in the iPhone App Store app). Inside the App Store app there is no web push —
// Apple delivers through APNs. The Capacitor plugin @capacitor/push-notifications (added in ios-app/) gives this phone
// an Apple token; we save it on the server (POST /push/native-register) and the server sends through APNs
// (backend/apns.ts). On the website / Android / Home Screen app nothing here runs (isNative() is false).
import { api } from "./api";
import { isNative, nativePlatform, apiUrl } from "./native";
import { savedAccounts } from "../utils/storage"; // v477

// v364 (Android app, android-app/): the same plugin gives an FCM token on Android. Tokens are saved under a key that
// isn't iPhone-only; the old key is still read so iPhones that saved a token before keep logging out cleanly.
const TOKEN_KEY = "ybex_native_push_token";
const OLD_TOKEN_KEY = "ybex_apns_token";
const pushPlatform = () => (nativePlatform() === "android" ? "android" : "ios");
/** Server endpoint for this phone's token: "fcm:<token>" (Android, case kept) or "apns:<token>" (iPhone). Pure. */
export const nativeEndpoint = (platform, token) => (platform === "android" ? `fcm:${token}` : `apns:${String(token).toLowerCase()}`);
// v367 fix (Ravi: "Ybex closed because this app has a bug"): on Android the plugin's register() crashes the WHOLE app
// while Firebase isn't set up (no google-services.json → "Default FirebaseApp is not initialized").
// v419 (Ravi: google-services.json added, Firebase project ybex-87436): Android push turns on only when the native build
// itself says Firebase is there (MetaEvents.hasFirebase, 1.0.12+). Older builds still get new web code via live update,
// have no such method → push stays off there, no crash.
let androidFcm = null; // null = not checked yet, then true / false
let androidFcmCheck = null;
export function checkAndroidFcm() {
  if (androidFcm !== null) return Promise.resolve(androidFcm);
  if (androidFcmCheck) return androidFcmCheck;
  androidFcmCheck = (async () => {
    try {
      const C = window.Capacitor;
      const M = C?.Plugins?.MetaEvents || (typeof C?.registerPlugin === "function" ? C.registerPlugin("MetaEvents") : null);
      if (!M || typeof M.hasFirebase !== "function") return (androidFcm = false);
      const r = await Promise.race([M.hasFirebase(), new Promise((res) => setTimeout(() => res(null), 3000))]);
      return (androidFcm = r?.ready === true);
    } catch { return (androidFcm = false); }
  })();
  return androidFcmCheck;
}
const plugin = () => {
  try {
    if (nativePlatform() === "android" && androidFcm !== true) return null;
    return window.Capacitor?.Plugins?.PushNotifications || null;
  } catch { return null; }
};

export const nativePushAvailable = () => isNative() && Boolean(plugin());

/** "granted" | "denied" | "prompt" | "unsupported" */
export async function nativePushState() {
  if (isNative() && nativePlatform() === "android") await checkAndroidFcm();
  const P = plugin();
  if (!isNative() || !P) return "unsupported";
  try {
    const r = await P.checkPermissions();
    const v = String(r?.receive || "prompt");
    return v === "granted" ? "granted" : v === "denied" ? "denied" : "prompt";
  } catch { return "unsupported"; }
}

/** From a button tap: Apple's popup, then (if allowed) get a token — the listener below saves it. */
export async function askNativePush() {
  if (isNative() && nativePlatform() === "android") await checkAndroidFcm();
  const P = plugin();
  if (!isNative() || !P) return "unsupported";
  try {
    const r = await P.requestPermissions();
    if (r?.receive === "granted") { await P.register(); return "granted"; }
    return r?.receive === "denied" ? "denied" : "default";
  } catch { return "default"; }
}

/** Already allowed → ask Apple for the token again so it's saved under whoever is signed in now. */
export async function refreshNativePush() {
  const P = plugin();
  if (!P || (await nativePushState()) !== "granted") return;
  try { await P.register(); } catch { /* next open */ }
}

/** Logout: this phone goes back to "guest" (announcements only), like web push. Never throws. */
export async function releaseNativePushOnLogout() {
  try {
    if (!isNative()) return;
    const t = window.localStorage.getItem(TOKEN_KEY) || window.localStorage.getItem(OLD_TOKEN_KEY);
    if (t) await api.post("push/unsubscribe", { endpoint: nativeEndpoint(pushPlatform(), t), to_guest: true }, { timeout: 4000 });
  } catch { /* logout must never wait on this */ }
}

/** v477: one call made as another saved account (its own login), not the one open now. Never throws → null. */
export async function fetchAs(account, path, { method = "GET", body } = {}) {
  try {
    const r = await fetch(apiUrl(`/api/${String(path).replace(/^\/+/, "")}`), {
      method, credentials: "omit",
      headers: { Authorization: `Bearer ${account.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) return null;
    return await r.json().catch(() => ({}));
  } catch { return null; }
}
/** v477 (Ravi: "notifications sabki jaye"): this phone is also registered for every other saved account, and the
 *  open account's own extra row is removed (it already has the main one). */
export async function syncAccountPush(platform, token, list = savedAccounts(), current = currentUserId()) {
  const base = nativeEndpoint(platform, token);
  const others = list.filter((a) => a.user_id !== current);
  await Promise.all(others.map((a) => fetchAs(a, "push/native-register", { method: "POST", body: { token, platform, extra: true } })));
  if (current) { try { await api.post("push/unsubscribe", { endpoint: `${base}#acct:${current}` }, { timeout: 5000 }); } catch { /* none */ } }
  return others.length;
}
function currentUserId() { try { return JSON.parse(window.localStorage.getItem("ybex_user") || "null")?.user_id || null; } catch { return null; } }

let installed = false;
/** Once at start-up (src/index.jsx). Saves tokens and opens the right screen when a notification is tapped. */
export function installNativePush() {
  if (isNative() && nativePlatform() === "android" && androidFcm === null) { checkAndroidFcm().then((ok) => { if (ok) installNativePush(); }); return; }
  const P = plugin();
  if (installed || !isNative() || !P) return;
  installed = true;
  try {
    P.addListener("registration", async (tok) => {
      const platform = pushPlatform();
      const raw = String(tok?.value || "");
      const token = platform === "android" ? raw : raw.toLowerCase(); // FCM tokens are case-sensitive
      if (!token) return;
      try { window.localStorage.setItem(TOKEN_KEY, token); } catch { /* private */ }
      try { await api.post("push/native-register", { token, platform }, { timeout: 8000 }); } catch { /* retried next open */ }
      syncAccountPush(platform, token); // v477: the other accounts on this phone get their notifications too
    });
    P.addListener("registrationError", (e) => { console.warn("[push] phone registration failed:", e?.error || e); });
    P.addListener("pushNotificationActionPerformed", (ev) => {
      const url = ev?.notification?.data?.url;
      const target = typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\") ? url : "/notifications"; // v476 (A19): "//site" would leave the app
      // v477: a notification for another saved account → full open so that account is switched to first
      const acct = (target.match(/[?&]yb_acct=([^&#]+)/) || [])[1];
      if (acct && decodeURIComponent(acct) !== currentUserId()) { window.location.assign(target); return; }
      try {
        window.history.pushState(null, "", target);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch { window.location.href = target; }
    });
  } catch { /* plugin missing in this build */ }
  refreshNativePush();
}
