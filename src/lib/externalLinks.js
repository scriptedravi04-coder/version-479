// Session 55 (Ravi: "app ke andar login karte waqt Terms link par click karta hun toh app glitch karke
// app ke andar hi landing page khol deta hai. URL seedha Chrome par redirect hona chahiye").
//
// In the installed app (Play Store app / Home Screen app) a link like <a href="/info/terms"
// target="_blank"> is "inside" the app's own website, so the phone kept it inside the app and showed
// the website page (with the website header) over the login screen. Here we catch those taps while
// running as the installed app and open the page in the phone's browser instead:
//   Android → Chrome (falls back to the default browser if Chrome isn't there)
//   iPhone / others → a new browser window
// Normal browser tabs are not touched at all.
import { isStandalone } from "./standalone";
import { isNative } from "./native";

export function chromeIntentUrl(absUrl) {
  const u = new URL(absUrl);
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(absUrl)};end`;
}

// Only the public reading pages (policies, help, blog). App screens, files and downloads that open in a
// new tab keep working exactly as before.
export const OUTSIDE_PATHS = ["/info/", "/privacy-policy", "/terms", "/privacy", "/refunds", "/help", "/blog"];

/** Should this click leave the installed app? Only same-site policy/help links that ask for a new tab. */
export function shouldOpenOutside(anchor, origin) {
  if (!anchor || !anchor.getAttribute) return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || /^(mailto|tel|sms|intent|whatsapp):/i.test(href)) return false;
  const wantsNewTab = String(anchor.getAttribute("target") || "").toLowerCase() === "_blank" || anchor.hasAttribute("data-open-outside");
  if (!wantsNewTab) return false;
  try {
    const u = new URL(href, origin);
    return u.origin === origin && OUTSIDE_PATHS.some((p) => {
      const base = p.replace(/\/$/, "");
      return u.pathname === base || u.pathname.startsWith(base + "/");
    });
  } catch { return false; }
}

export function openOutside(absUrl) {
  const ua = (navigator.userAgent || "");
  if (/Android/i.test(ua)) {
    window.location.href = chromeIntentUrl(absUrl);
    return;
  }
  const w = window.open(absUrl, "_blank", "noopener,noreferrer");
  if (!w) window.location.href = absUrl; // popup blocked: at least show the page
}

let installed = false;
/**
 * v456 (Back review): a plain same-site a-href link (not <Link>) reloaded the WHOLE app — splash, refetch, open form lost —
 * which looked like "app closed and restarted". Same-site page links now move inside the app. Pure check.
 */
export function inAppHref(a, origin) {
  if (!a || !a.getAttribute) return "";
  const href = a.getAttribute("href") || "";
  if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith(origin)) return "";
  if (a.hasAttribute("download") || a.hasAttribute("data-reload") || a.hasAttribute("data-open-outside")) return "";
  const t = String(a.getAttribute("target") || "").toLowerCase();
  if (t && t !== "_self") return "";
  try {
    const u = new URL(href, origin);
    if (u.origin !== origin) return "";
    if (/^\/(api|uploads|auth\/callback)\b/.test(u.pathname) || /\.(xml|txt|pdf|png|jpe?g|webp|zip|csv|json)$/i.test(u.pathname)) return "";
    return u.pathname + u.search + u.hash;
  } catch { return ""; }
}

/** v456: move to one of our own pages without reloading the app (for toasts / code outside the router). */
export function goInApp(to, { replace = false } = {}) {
  try {
    const st = window.history.state;
    const idx = st && typeof st.idx === "number" ? (replace ? st.idx : st.idx + 1) : 0;
    const next = { usr: null, key: Math.random().toString(36).slice(2, 10), idx };
    if (replace) window.history.replaceState(next, "", to); else window.history.pushState(next, "", to);
    window.dispatchEvent(new PopStateEvent("popstate", { state: next }));
    window.scrollTo?.(0, 0);
  } catch { window.location.assign(to); }
}

export function installExternalLinks() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // v456: bubble phase on purpose — <Link> (React) handles its own click first and marks it handled (defaultPrevented)
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest ? e.target.closest("a") : null;
    const to = inAppHref(a, window.location.origin);
    if (!to) return;
    e.preventDefault();
    if (to === window.location.pathname + window.location.search + window.location.hash) return;
    goInApp(to);
  });
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    // v335 (iPhone app with the files inside): a new-tab link to one of our own pages opens inside the app (the
    // phone's browser can't open capacitor://localhost); an outside website opens in the phone's browser sheet.
    if (isNative()) {
      const na = e.target && e.target.closest ? e.target.closest("a") : null;
      const href = na && na.getAttribute ? na.getAttribute("href") : "";
      if (!href || href.startsWith("#") || /^(mailto|tel|sms|whatsapp|upi):/i.test(href)) return;
      if (String(na.getAttribute("target") || "").toLowerCase() !== "_blank") return;
      try {
        const u = new URL(href, window.location.origin);
        e.preventDefault();
        e.stopPropagation();
        if (u.origin === window.location.origin) {
          window.history.pushState({}, "", u.pathname + u.search + u.hash);
          window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
        } else {
          const B = window.Capacitor?.Plugins?.Browser;
          if (B?.open) B.open({ url: u.href }); else window.open(u.href, "_blank", "noopener,noreferrer");
        }
      } catch { /* leave it */ }
      return;
    }
    if (!isStandalone()) return;
    const a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (!shouldOpenOutside(a, window.location.origin)) return;
    e.preventDefault();
    e.stopPropagation();
    const abs = new URL(a.getAttribute("href"), window.location.origin);
    // v334 (offline app): with no internet the phone's browser can't load the page (on iPhone it doesn't share the
    // app's saved files) — Terms / Privacy / Help open inside the app instead, from the app's own saved copy.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      try {
        window.history.pushState({}, "", abs.pathname + abs.search + abs.hash);
        window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
      } catch { window.location.href = abs.href; }
      return;
    }
    openOutside(abs.href);
  }, true);
}
