// Session 43 (v287, Ravi: "simple haptic nahi, kuch unique"): Ybex's own touch signature.
//
// "open" = the "Ybex heartbeat": a light tap, a tiny pause, a firmer tap — like the bot saying
//          "hm-HM?" when you poke it. Used when Ybex Assist opens.
// "send" = one crisp tick when a message leaves.
//
// • Native app (Capacitor Haptics plugin present — the iOS / Android store apps): real Taptic Engine
//   impacts (iOS UIImpactFeedbackGenerator under the hood) — Light, then Medium 70 ms later.
// • Android web / Play Store app: the vibration motor with the same rhythm [7, 55, 16] ms.
// • iPhone web app: Apple allows no haptics from a web page — nothing happens (no error).
// • Phone set to reduce motion / no vibration support → skipped.
// v477 (Ravi: "Eva khulte waqt long vibrate, chatting mein haptics — Gemini jaisa"): opening Eva is now a longer
// rising rumble (~0.3 s), and every Eva reply gives a soft ripple of light ticks, longer for longer replies.
// v478 (Ravi: "app ka experience ek dum mast" — the 5 Ybex haptics, one meaning each):
//   tick    = chose / changed (tab, chip, toggle, copy, shortlist, slider step)
//   tap     = picked up / opened (long press, a sheet opens, a deal card arrives)
//   success = done ✅ (applied, approved, signed, submitted, KYC approved, profile live)
//   error   = didn't work ❌ (wrong OTP, payment failed, any error message)
//   money   = money moved 💰 (payment received, payout released / requested, refund) — the special one
const PATTERNS = {
  open: { web: [30, 20, 45, 20, 130], native: [["LIGHT", 0], ["LIGHT", 45], ["MEDIUM", 90], ["MEDIUM", 135], ["HEAVY", 185], ["MEDIUM", 245], ["LIGHT", 305]] },
  send: { web: [9], native: [["LIGHT", 0]] },
  tick: { web: [8], native: [["LIGHT", 0]] },
  tap: { web: [18], native: [["MEDIUM", 0]] },
  success: { web: [12, 70, 22], native: [["NOTE", "SUCCESS"]] },
  error: { web: [20, 45, 20, 45, 30], native: [["NOTE", "ERROR"]] },
  money: { web: [25, 25, 40, 25, 60, 25, 160], native: [["LIGHT", 0], ["MEDIUM", 60], ["MEDIUM", 120], ["HEAVY", 185], ["HEAVY", 250], ["NOTE", "SUCCESS", 340]] },
};
// v478: never a buzz storm — at most one haptic per 120 ms, the same one again only after 600 ms; a stronger
// meaning (success / error / money) is never swallowed by a tick just before it.
const RANK = { tick: 1, send: 1, tap: 2, reply: 2, open: 3, success: 4, error: 4, money: 5 };
const locks = new WeakMap(); // one lock per window (the app has one)
const FREE = {};
export function hapticAllowed(kind, now = Date.now(), win = FREE) {
  const r = RANK[kind] || 1;
  const last = locks.get(win) || { at: -1e9, kind: "", rank: 0 };
  if (kind === last.kind && now - last.at < 600) return false;
  if (now - last.at < 120 && r <= last.rank) return false;
  locks.set(win, { at: now, kind, rank: r });
  return true;
}
export function resetHapticLock(win = FREE) { locks.delete(win); }

export function ybHaptic(kind = "open", win = typeof window !== "undefined" ? window : null) {
  const p = PATTERNS[kind] || PATTERNS.open;
  if (!win) return false;
  try {
    if (win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    if (!hapticAllowed(kind, Date.now(), win)) return false;
    const H = win.Capacitor?.Plugins?.Haptics;
    if (H && typeof H.impact === "function") {
      p.native.forEach(([style, a, b]) => {
        const at = style === "NOTE" ? (b || 0) : a;
        setTimeout(() => {
          try {
            if (style === "NOTE" && typeof H.notification === "function") H.notification({ type: a });
            else H.impact({ style: style === "NOTE" ? "MEDIUM" : style });
          } catch { /* ignore */ }
        }, at);
      });
      return true;
    }
    if (win.navigator && typeof win.navigator.vibrate === "function") return win.navigator.vibrate(p.web) !== false;
  } catch { /* no haptics on this phone */ }
  return false;
}
/** v477: the ripple for one Eva reply — 3..9 light ticks, 55 ms apart (Gemini-style "text arriving" feel). */
export function replyPattern(text) {
  const n = Math.max(3, Math.min(9, Math.round(String(text || "").length / 35)));
  return { web: Array.from({ length: n * 2 - 1 }, (_, i) => (i % 2 ? 49 : 6)), native: Array.from({ length: n }, (_, i) => ["LIGHT", i * 55]) };
}
PATTERNS.reply = replyPattern("");
export function ybHapticReply(text, win) {
  PATTERNS.reply = replyPattern(text);
  return ybHaptic("reply", win);
}
/** v478: which haptic a toast message means (success toasts carry the app's "it's done" moments). */
export function toastHaptic(kind, text) {
  if (kind === "error") return "error";
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  if (/payment received|disburs|payout (requested|released|sent)|refund of|money (is )?on (the )?way|paid out|₹[\d,]+ (added|released|sent)/.test(t)) return "money";
  if (/copied|pasted/.test(t)) return "tick";
  if (/approved|applied|signed|shortlisted|submitted|is live|published|welcome|verification successful|verified|hired|claimed|you're in|invite sent|scheduled|accepted|on the map|posted|counter offer|offer (sent|accepted)/.test(t)) return "success";
  if (/saved|added|uploaded|updated|removed|deleted|selected|sent|unblocked|blocked|declined|closed|cancelled|restored/.test(t)) return "tick";
  return "tick";
}
let toastPatched = false;
/** Once at start-up: success / error toasts feel like what they say. */
export function installToastHaptics(toast, win = typeof window !== "undefined" ? window : null) {
  if (toastPatched || !toast || !win) return false;
  toastPatched = true;
  ["success", "error"].forEach((k) => {
    const orig = toast[k];
    if (typeof orig !== "function") return;
    toast[k] = (msg, ...rest) => {
      try { if (!String(win.location?.pathname || "").startsWith("/admin")) { const h = toastHaptic(k, typeof msg === "string" ? msg : ""); if (h) ybHaptic(h, win); } } catch { /* never block a toast */ }
      return orig.call(toast, msg, ...rest);
    };
  });
  return true;
}
let tapsInstalled = false;
/** Once at start-up: switches, tabs, pressed chips, checkboxes and range sliders tick; a sheet opening taps. */
export function installTapHaptics(doc = typeof document !== "undefined" ? document : null, win = typeof window !== "undefined" ? window : null) {
  if (tapsInstalled || !doc || !win) return false;
  tapsInstalled = true;
  doc.addEventListener("click", (e) => {
    try {
      const el = e.target?.closest?.('[data-haptic], [role="switch"], [role="tab"], [aria-pressed], input[type="checkbox"], input[type="radio"]');
      if (!el || el.closest("[data-no-haptic]") || el.disabled) return;
      ybHaptic(el.getAttribute("data-haptic") || "tick", win);
    } catch { /* ignore */ }
  }, true);
  let step = null;
  doc.addEventListener("input", (e) => {
    try {
      const el = e.target;
      if (el?.type !== "range") return;
      const min = Number(el.min || 0), max = Number(el.max || 100), v = Number(el.value);
      const size = Math.max((max - min) / 20, Number(el.step) || 1);
      const s = Math.round((v - min) / size);
      if (s !== step) { step = s; ybHaptic(v <= min || v >= max ? "tap" : "tick", win); }
    } catch { /* ignore */ }
  }, true);
  return true;
}
export { PATTERNS as HAPTIC_PATTERNS };
