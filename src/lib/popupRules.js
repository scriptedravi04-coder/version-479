import { useEffect, useRef, useState } from "react";

// v426 (creator audit: "Back button sheet band nahi karta, page chhod deta hai"):
// while a sheet / overlay is open it adds one history entry. The phone's Back (or the browser's)
// then closes the sheet instead of leaving the page. Closing it any other way (X, backdrop, drag,
// Save) removes that entry again, unless the app already moved to a new page.
// Each open overlay is listed in history.state.ybexSheets, so stacked sheets close one at a time.
let seq = 0;
const KEY = "ybexSheets";
let selfBackAt = 0; // v455: when the app itself last stepped back to tidy a closed sheet
const live = new Set(); // v455: sheets open right now (so a re-pushed entry never carries a closed one)
try { if (typeof window !== "undefined") window.__ybLiveSheets = live; } catch { /* ignore */ } // v476: lib/native.js reads it (A8)
let exiting = false; // v456: set while exitFlowTo() steps back out of a flow

/** v476 (Android QA A8): sheet entries left in history by a popup that closed when the page changed (e.g. Quick action
 *  open → Inbox tab). They are no longer open, so Back on them did nothing. */
export function staleSheetCount(st = (typeof window !== "undefined" ? window.history.state : null), open = live) {
  const list = (st && Array.isArray(st[KEY]) && st[KEY]) || [];
  return list.length && list.every((id) => !open.has(id)) ? list.length : 0;
}

export function sheetsInHistory() {
  try { return (window.history.state && window.history.state[KEY]) || []; } catch { return []; }
}

export default function useBackToClose(open, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.history?.pushState) return undefined;
    const id = `s${++seq}`;
    let poppedByBack = false;
    try {
      const st = window.history.state || {};
      window.history.pushState({ ...st, [KEY]: [...(st[KEY] || []), id] }, "");
    } catch { return undefined; }
    const onPop = () => {
      if (exiting) return; // v456: exitFlowTo() is unwinding on purpose — don't fight it
      if (sheetsInHistory().includes(id)) return; // a sheet above this one closed
      // v455: this "back" was the app tidying up after ANOTHER sheet closed (cleanup below), not the user —
      // e.g. Explore's "Select location" sheet closing while "Confirm on map" opens. That stray back used to
      // close the new screen straight away. Put our entry back and stay open.
      if (Date.now() - selfBackAt < 900) {
        try { const st = window.history.state || {}; window.history.pushState({ ...st, [KEY]: [...(st[KEY] || []).filter((x) => live.has(x) && x !== id), id] }, ""); } catch { /* ignore */ }
        return;
      }
      poppedByBack = true;
      window.removeEventListener("popstate", onPop);
      closeRef.current?.();
    };
    window.addEventListener("popstate", onPop);
    live.add(id);
    return () => {
      live.delete(id);
      window.removeEventListener("popstate", onPop);
      if (poppedByBack) return;
      // Closed with X / Save etc. Only step back if we are still on our own entry (no navigation since).
      const list = sheetsInHistory();
      if (list[list.length - 1] === id) { selfBackAt = Date.now(); try { window.history.back(); } catch { /* ignore */ } }
    };
  }, [open]);
}

/**
 * v456 (Back-button review): multi-step screens (campaign create, UGC brief, brand KYC, onboarding, apply form).
 * While `active` (= past the first step) one history entry is kept; the phone's Back calls `onBack()` (go one step
 * back) and the entry is put back, so Back keeps walking the steps and only leaves the page from the first step.
 * Uses the same history list as sheets, so the Android Back (lib/native.js) treats it like an open sheet.
 */
export function useStepBack(active, onBack) {
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    if (!active || typeof window === "undefined" || !window.history?.pushState) return undefined;
    const id = `st${++seq}`;
    const push = () => { try { const st = window.history.state || {}; window.history.pushState({ ...st, [KEY]: [...(st[KEY] || []).filter((x) => live.has(x) && x !== id), id] }, ""); } catch { /* ignore */ } };
    push();
    let gone = false;
    const onPop = () => {
      if (exiting || gone) return;
      if (sheetsInHistory().includes(id)) return; // a sheet above the steps closed
      if (Date.now() - selfBackAt < 900) { push(); return; } // app tidying another sheet, not the user
      backRef.current?.();
      push(); // still in the flow → keep an entry for the next Back (removed again below if we reached step 1)
    };
    window.addEventListener("popstate", onPop);
    live.add(id);
    return () => {
      gone = true; live.delete(id);
      window.removeEventListener("popstate", onPop);
      const list = sheetsInHistory();
      if (list[list.length - 1] === id) { selfBackAt = Date.now(); try { window.history.back(); } catch { /* ignore */ } }
    };
  }, [active]);
}

// v456 (Back review: "campaign kholke Back aao to list reset"): search / filters / tab of a list survive opening an
// item and coming Back (30 min, this app session only) — same idea as mobile Explore's v451 memory.
const KEPT = new Map();
const KEEP_MS = 30 * 60000;
const keepOff = () => typeof process !== "undefined" && Boolean(process.env?.VITEST); // each test starts clean
export function useKeptState(key, initial) {
  const [v, setV] = useState(() => {
    const k = KEPT.get(key);
    if (!keepOff() && k && Date.now() - k.at < KEEP_MS) return k.v;
    return typeof initial === "function" ? initial() : initial;
  });
  useEffect(() => { KEPT.set(key, { v, at: Date.now() }); }, [key, v]);
  return [v, setV];
}

/**
 * v456 (Back review: "phone ka Back bina poochhe likha hua data mita deta hai"): while `dirty`, the phone / browser
 * Back first asks "Leave without saving?" (the ← button already did). Yes → leaves; No → stays with the work.
 * Closing the tab / reloading also asks (beforeunload).
 */
export function useLeaveGuard(dirty, message = "Leave without saving? Your changes will be lost.") {
  const msgRef = useRef(message);
  msgRef.current = message;
  useEffect(() => {
    if (!dirty || typeof window === "undefined" || !window.history?.pushState) return undefined;
    const id = `lg${++seq}`;
    const push = () => { try { const st = window.history.state || {}; window.history.pushState({ ...st, [KEY]: [...(st[KEY] || []).filter((x) => live.has(x) && x !== id), id] }, ""); } catch { /* ignore */ } };
    push();
    let gone = false;
    const onPop = () => {
      if (exiting || gone) return;
      if (sheetsInHistory().includes(id)) return;
      if (Date.now() - selfBackAt < 900) { push(); return; }
      let ok = false;
      try { ok = window.confirm(msgRef.current); } catch { ok = true; }
      if (!ok) { push(); return; }
      gone = true; live.delete(id);
      window.removeEventListener("popstate", onPop);
      try { window.history.back(); } catch { /* ignore */ } // the page's own entry → really leave
    };
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ""; return ""; };
    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onUnload);
    live.add(id);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (gone) return;
      gone = true; live.delete(id);
      window.removeEventListener("popstate", onPop);
      const list = sheetsInHistory();
      if (list[list.length - 1] === id) { selfBackAt = Date.now(); try { window.history.back(); } catch { /* ignore */ } }
    };
  }, [dirty]);
}

/**
 * v456: leave a flow for another page after Publish / Discard so Back from that page doesn't reopen the flow.
 * Steps back over the flow's own entry (if any), then REPLACES the flow page with `to`.
 */
export function exitFlowTo(navigate, to, opts = {}) {
  const go = () => { exiting = false; navigate(to, { ...opts, replace: true }); };
  try {
    const list = sheetsInHistory();
    if (typeof window !== "undefined" && list.length) {
      exiting = true;
      const onPop = () => { window.removeEventListener("popstate", onPop); setTimeout(go, 0); };
      window.addEventListener("popstate", onPop);
      setTimeout(() => { if (exiting) { window.removeEventListener("popstate", onPop); go(); } }, 600); // safety
      window.history.back();
      return;
    }
  } catch { /* fall through */ }
  go();
}

/** v456: "←" that works even when the page was opened straight from a link / notification (no history to go back to). */
export function backOr(navigate, fallback) {
  try {
    const idx = window.history.state?.idx;
    if (typeof idx === "number" ? idx > 0 : window.history.length > 1) { navigate(-1); return; }
  } catch { /* ignore */ }
  navigate(fallback, { replace: true });
}

// v426 (creator audit: popups lag because they open exactly while the app is busiest, and several queue up
// one after another on every open). Shared rules for the "app open" popups — Diwali poster, quick actions,
// promo, What's New, push ask:
//   1. none opens until Home has its data (or 4 s have passed on another page);
//   2. ONE of them per app open — the first to claim it; the rest wait for the next open;
//   3. tab pre-loading (TabWarmup) waits while any of them is on screen.

const w = () => (typeof window !== "undefined" ? window : {});

export function markHomeReady() {
  const win = w();
  if (win.__ybHomeReady) return;
  win.__ybHomeReady = true;
  try { win.dispatchEvent(new Event("ybex:home-ready")); } catch { /* ignore */ }
}

/** Resolves once Home has loaded, or after `maxMs` (another landing page, slow network). */
export function waitForHomeReady(maxMs = 4000) {
  const win = w();
  if (win.__ybHomeReady || !win.addEventListener) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; win.removeEventListener("ybex:home-ready", finish); clearTimeout(t); setTimeout(resolve, 350); };
    const t = setTimeout(finish, maxMs);
    win.addEventListener("ybex:home-ready", finish);
  });
}

/** True if `name` may show as this open's popup (first caller wins; the same caller may ask again). */
export function claimAppOpenPopup(name) {
  const win = w();
  if (win.__ybOpenPopupUsed && win.__ybOpenPopupUsed !== name) return false;
  win.__ybOpenPopupUsed = name;
  return true;
}

export function appOpenPopupTakenBy() {
  return w().__ybOpenPopupUsed || null;
}

/** Any popup / sheet on screen right now? (TabWarmup waits for this to be false.) */
export function anyPopupOnScreen(doc = typeof document !== "undefined" ? document : null) {
  const win = w();
  if (win.__ybFullScreenAsk || win.__ybPromoShown) return true;
  if (!doc) return false;
  return Boolean(doc.getElementById("yb-splash") || doc.querySelector('[aria-modal="true"],[data-testid="quick-actions"]'));
}

/** Resolves when no other popup (Terms, KYC ask, splash…) is on screen — checked every 0.5 s, at most `maxMs`.
 *  Resolves false if one is still up at the end, so the caller can skip this open. */
export function waitForNoPopup(maxMs = 20000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (!anyPopupOnScreen()) return resolve(true);
      if (Date.now() - started > maxMs) return resolve(false);
      setTimeout(tick, 500);
    };
    tick();
  });
}
