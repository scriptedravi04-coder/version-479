// v364 (Ravi: "website band ki update ke liye toh app webapp ban gaya aur pura error show hone laga"): one place that
// knows "the phone has internet, but the Ybex server isn't answering" — e.g. while AI Studio redeploys (~1 hour).
//
//  • markServerDown() / markServerUp(): called by src/lib/api.js. Down = a gateway error (502/503/504/520–530), an HTML
//    page where JSON was expected (AI Studio's "app unavailable" page), or a network error while the phone is online
//    and a quick check of /api/system-status fails too. Up = any good JSON answer.
//  • While down, /api/system-status is checked every 20 s (only while the page is visible). Every change fires
//    window "ybex:server" with { down }.
//  • isServerDown() / useServerDown() for screens and the banner.
import { useEffect, useState } from "react";
import { apiUrl, canUseBackupOrigin, otherApiOrigin, setActiveApiOrigin, activeApiOrigin, API_ORIGIN } from "./native";

export const SERVER_DOWN_CODE = "SERVER_DOWN";
export const SERVER_DOWN_MESSAGE = "Ybex is updating right now — try again in a few minutes";
const PROBE_EVERY_MS = 20000;
const PROBE_TIMEOUT_MS = 6000;

let down = false;
let timer = null;
let probing = null;

export const isServerDown = () => down;

function emit(extra = {}) {
  try { window.dispatchEvent(new CustomEvent("ybex:server", { detail: { down, ...extra } })); } catch { /* old browser / tests */ }
}

/** Gateway / hosting answers that mean "the app server itself is not up". */
export function isGatewayStatus(status) {
  const s = Number(status);
  return s === 502 || s === 503 || s === 504 || (s >= 520 && s <= 530);
}

/** A text body that is an HTML page (not a JSON answer). */
export function looksLikeHtml(data) {
  return typeof data === "string" && /^\s*</.test(data);
}

/** An /api request URL (relative, or absolute inside the native app). */
export function isApiUrl(url) {
  return /(^|\/\/[^/]+)\/api(\/|\?|$)/.test(String(url || "")) || /^api\//.test(String(url || ""));
}

const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

function schedule() {
  if (timer || typeof window === "undefined") return;
  timer = setInterval(() => {
    if (!down) { clearInterval(timer); timer = null; return; }
    if (pageVisible()) probeServer();
  }, PROBE_EVERY_MS);
}

export function markServerDown() {
  if (down) return;
  down = true;
  emit();
  schedule();
  // v466: phone app → try the other address straight away (no 20 s wait)
  if (canUseBackupOrigin()) setTimeout(() => { if (down && pageVisible()) probeServer(); }, 0);
}

export function markServerUp(opts = {}) {
  if (!down) return;
  down = false;
  if (timer) { clearInterval(timer); timer = null; }
  emit(opts.switched ? { switched: true } : {});
}

/** v466: one GET of <origin>/api/system-status; true = JSON answer. */
async function originAnswers(origin) {
  if (typeof fetch !== "function") return false;
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = setTimeout(() => { try { ctl?.abort(); } catch { /* ignore */ } }, PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(origin + "/api/system-status", { cache: "no-store", credentials: "include", signal: ctl?.signal });
    return Boolean(r.ok && /json/i.test(String(r.headers?.get?.("content-type") || "")));
  } catch { return false; } finally { clearTimeout(t); }
}

let backTimer = null;
const BACK_TO_MAIN_EVERY_MS = 5 * 60 * 1000;

/** v466: while the phone app is on the backup address, check the main one every 5 min and move back once it answers. */
function scheduleBackToMain() {
  if (backTimer || typeof window === "undefined") return;
  backTimer = setInterval(async () => {
    if (activeApiOrigin() === API_ORIGIN) { clearInterval(backTimer); backTimer = null; return; }
    if (!pageVisible()) return;
    if (await originAnswers(API_ORIGIN)) {
      setActiveApiOrigin(API_ORIGIN);
      clearInterval(backTimer); backTimer = null;
    }
  }, BACK_TO_MAIN_EVERY_MS);
}

// v475: the app opened on the backup (remembered from a moment ago) → keep checking for the main address
try { if (typeof window !== "undefined" && canUseBackupOrigin() && activeApiOrigin() !== API_ORIGIN) setTimeout(scheduleBackToMain, 0); } catch { /* tests */ }

/** v466: the address in use did not answer → phone app checks the other one and switches if it answers. */
async function tryOtherOrigin() {
  if (!canUseBackupOrigin()) return false;
  const other = otherApiOrigin();
  if (!(await originAnswers(other))) return false;
  setActiveApiOrigin(other);
  if (other !== API_ORIGIN) scheduleBackToMain();
  markServerUp({ switched: true });
  return true;
}

/** Direct check of /api/system-status (no axios, no cache). true = server answered with JSON. */
export function probeServer() {
  if (probing) return probing;
  probing = (async () => {
    if (typeof fetch !== "function") return !down;
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = setTimeout(() => { try { ctl?.abort(); } catch { /* ignore */ } }, PROBE_TIMEOUT_MS);
    try {
      const r = await fetch(apiUrl("/api/system-status"), { cache: "no-store", credentials: "include", signal: ctl?.signal });
      const type = String(r.headers?.get?.("content-type") || "");
      const ok = r.ok && /json/i.test(type);
      if (ok) { markServerUp(); return true; }
      if (await tryOtherOrigin()) return true;
      markServerDown();
      return false;
    } catch {
      // The phone itself went offline meanwhile → that's "offline", not "server down".
      if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
      if (await tryOtherOrigin()) return true;
      markServerDown();
      return false;
    } finally {
      clearTimeout(t);
      probing = null;
    }
  })();
  return probing;
}

/** true while the server is down; re-renders on "ybex:server". */
export function useServerDown() {
  const [isDown, setDown] = useState(() => down);
  useEffect(() => {
    const on = (e) => setDown(Boolean(e?.detail?.down));
    window.addEventListener("ybex:server", on);
    setDown(down);
    return () => window.removeEventListener("ybex:server", on);
  }, []);
  return isDown;
}

export function makeServerDownError(config) {
  const err = new Error(SERVER_DOWN_MESSAGE);
  err.name = "ServerDownError";
  err.code = SERVER_DOWN_CODE;
  err.isServerDown = true;
  err.config = config || {};
  err.response = {
    status: 0,
    statusText: "Server updating",
    headers: {},
    config: config || {},
    data: { code: SERVER_DOWN_CODE, error: SERVER_DOWN_MESSAGE, detail: SERVER_DOWN_MESSAGE, message: SERVER_DOWN_MESSAGE },
  };
  return err;
}

export const isServerDownError = (err) => err?.code === SERVER_DOWN_CODE || err?.response?.data?.code === SERVER_DOWN_CODE;

/** tests */
export function __resetServerStatus() {
  down = false;
  if (timer) { clearInterval(timer); timer = null; }
  if (backTimer) { clearInterval(backTimer); backTimer = null; }
  probing = null;
}
