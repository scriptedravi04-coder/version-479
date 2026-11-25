// v446 (Ravi, 15 Nov 2026): brand sign-up asks "What do you run?" (required). The answer goes to the server
// (business_type) — it decides Meta's "QualifiedBrand" event (backend/brandQuality.ts). "I'm a creator" moves the
// account to the creator sign-up (only possible before onboarding is finished — backend/roleGuards.ts).
import { api } from "./api";
import { apiUrl } from "./native";

export const BUSINESS_TYPES = [
  { id: "shop", label: "Shop", industry: "Retail" },
  { id: "d2c", label: "Online brand (D2C)", industry: "D2C" },
  { id: "app", label: "App", industry: "Tech" },
  { id: "cafe", label: "Café / Restaurant", industry: "Food" },
  { id: "salon", label: "Salon / Clinic", industry: "Beauty" },
  { id: "agency", label: "Agency", industry: "Marketing" },
  { id: "creator", label: "I'm a creator", industry: "" },
];

/** The industry creators filter by, from the business type (only when the brand hasn't picked one). */
export function industryFor(type) {
  return BUSINESS_TYPES.find((t) => t.id === type)?.industry || "";
}

export const businessTypeLabel = (type) => BUSINESS_TYPES.find((t) => t.id === type)?.label || "";

/** "I'm a creator" → this account becomes a creator account and the creator sign-up opens. */
export async function switchToCreator({ refreshUser, navigate }) {
  await api.post("auth/role", { role: "creator" });
  try { await refreshUser?.(); } catch { /* the page reloads below anyway */ }
  if (navigate) navigate("/onboarding", { replace: true });
  try { window.location.reload(); } catch { /* tests */ }
}

/** One short line for creators, from the Instagram bio (first sentence, emojis and hashtags dropped). */
export function oneLineFromBio(bio) {
  const t = String(bio || "")
    .replace(/#[\w]+/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const first = (t.split(/(?<=[.!?|•])\s+|\s[|•]\s/)[0] || t).replace(/[|•]\s*$/, "").trim();
  return first.slice(0, 120);
}

/** Anonymous "brand sign-up page opened" ping for Admin → Growth → brand funnel. Plain fetch (no login, no body),
 *  so it never touches the app's API queue. Never throws. */
export function pingBrandSignupVisit() {
  try {
    if (typeof fetch !== "function" || (typeof process !== "undefined" && process.env?.VITEST)) return;
    fetch(apiUrl("/api/funnel/brand-visit"), { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  } catch { /* best effort */ }
}

/** v451 (Ravi): what's wrong with what the brand typed as its Instagram username ("" = fine). A leading @ is just
 *  dropped; an email, a website, a space or other characters are refused (we were saving "namegamil.com"). Pure. */
export function igHandleProblem(raw) {
  const v = String(raw || "").trim();
  if (!v || /instagram\.com\//i.test(v)) return "";
  const body = v.replace(/^@+/, "");
  if (body.includes("@")) return "That's an email. Type only your Instagram username — like yourbrand.";
  if (/\s/.test(body)) return "No spaces — Instagram usernames don't have them.";
  if (/\.(com|in|co|net|org|io|shop|store|xyz|app|me|biz|info)(\.|$)/i.test(body) || /^(https?:|www\.)/i.test(body)) return "That's a website. Type your Instagram username here — you can add the website later.";
  if (/[^a-zA-Z0-9._]/.test(body)) return "Only letters, numbers, . and _ — like your_brand.";
  if (body.length > 30) return "Instagram usernames are 30 characters or less.";
  return "";
}

/** v451: Indian GSTIN (15 characters), cleaned to upper case — "" when it isn't one. Pure. */
export function cleanGstin(v) {
  const g = String(v || "").toUpperCase().replace(/\s+/g, "");
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) ? g : "";
}

/** v451: a website that looks real (a domain, not Instagram / link-in-bio). Pure. */
export function looksLikeWebsite(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  try {
    const host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
    if (/(^|\.)(instagram\.com|facebook\.com|wa\.me|linktr\.ee|bit\.ly|youtube\.com|youtu\.be)$/.test(host)) return false;
    return /\.[a-z]{2,}$/.test(host);
  } catch { return false; }
}
