// v446 (Ravi, 15 Nov 2026 — brand-side Meta signals): which new brands are real businesses Meta should find more of.
//   • business type is asked on brand sign-up ("What do you run?"); "I'm a creator" moves the account to creator sign-up.
//   • QualifiedBrand (Pixel + Conversions API + app SDK, one shared event id) fires once, when a new brand finishes sign-up,
//     is not a creator, and has 300+ Instagram followers OR a website.
//   • Instagram under 100 followers, or private / not found → the brand is marked "unverified" and NO event is sent.
//   • BriefPosted fires once, when the brand posts its first brief (UGC brief or campaign).
// Business type + the verdict are kept in ybex_ephemeral (key brandinfo:<user_id>) — no database column is added.
import { ephemeralGet, ephemeralSet } from "./ephemeralStore";
import { igLookupResult } from "./instagramConnect";
import { buildEventPayload, sendCapiEvent, type MetaServerEvent } from "./metaCapi";

export const BUSINESS_TYPES = ["shop", "d2c", "app", "cafe", "salon", "agency", "creator"] as const;
export const QUALIFIED_BRAND_EVENT = "QualifiedBrand";
export const BRIEF_POSTED_EVENT = "BriefPosted";
export const QUALIFIED_BRAND_MIN_FOLLOWERS = 300;
export const UNVERIFIED_BELOW_FOLLOWERS = 100;
const NEW_ACCOUNT_DAYS = 30;
const YEARS_5 = 5 * 365 * 86400e3;

export const qualifiedBrandEventId = (userId: string) => `qb_${userId}`;
export const briefPostedEventId = (userId: string) => `bp_${userId}`;

export function cleanBusinessType(v: any): string {
  const t = String(v || "").trim().toLowerCase();
  return (BUSINESS_TYPES as readonly string[]).includes(t) ? t : "";
}

export function hasWebsite(v: any): boolean {
  const s = String(v || "").trim();
  if (!s) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.toLowerCase();
    // an Instagram / link-in-bio / WhatsApp link is not a website of the business
    if (/(^|\.)(instagram\.com|facebook\.com|fb\.me|wa\.me|whatsapp\.com|linktr\.ee|bit\.ly|youtube\.com|youtu\.be|t\.me)$/.test(host)) return false;
    return /\.[a-z]{2,}$/.test(host);
  } catch { return false; }
}

export type BrandVerdict = { quality: "qualified" | "unverified" | "plain"; reason: string };

/** Pure. `ig` = what Instagram said (found + followers), or null when we don't know. */
export function judgeBrand(o: { businessType: string; igHandle: any; ig: { found: boolean; followers: number | null } | null; website: any }): BrandVerdict {
  const type = cleanBusinessType(o.businessType);
  if (type === "creator") return { quality: "plain", reason: "creator" };
  const handle = String(o.igHandle || "").replace(/^@+/, "").trim();
  if (handle && o.ig) {
    if (!o.ig.found) return { quality: "unverified", reason: "instagram_private_or_missing" };
    if (o.ig.followers !== null && o.ig.followers < UNVERIFIED_BELOW_FOLLOWERS) return { quality: "unverified", reason: "instagram_under_100" };
  }
  if (!type) return { quality: "plain", reason: "no_business_type" };
  if (o.ig?.found && (o.ig.followers || 0) >= QUALIFIED_BRAND_MIN_FOLLOWERS) return { quality: "qualified", reason: "instagram_300" };
  if (hasWebsite(o.website)) return { quality: "qualified", reason: "website" };
  return { quality: "plain", reason: "small" };
}

export async function readBrandInfo(userId: string): Promise<any> {
  try { return (await ephemeralGet(`brandinfo:${userId}`)) || null; } catch { return null; }
}

/** Brand finished sign-up: keep business type + verdict, send QualifiedBrand once (server half). Returns the event for the
 *  browser / app half, or null. Never throws. */
export async function assessNewBrand(o: { user: any; data: any; req?: any }): Promise<{ verdict: BrandVerdict; event: MetaServerEvent | null }> {
  const plain = { verdict: { quality: "plain" as const, reason: "error" }, event: null };
  try {
    const u = o.user || {};
    const d = o.data || {};
    if (!u.user_id) return plain;
    const typed = Number(d.instagram_followers);
    // a handle Instagram couldn't read, which the brand then skipped ("Continue without Instagram") still counts
    const handle = d.instagram_handle || d.instagram_tried;
    const known = igLookupResult(handle);
    // Instagram's own answer first; the number the form sent only when this server never looked the handle up.
    const ig = known || (d.instagram_handle && Number.isFinite(typed) && typed > 0 ? { found: true, followers: Math.round(typed) } : null);
    const verdict = judgeBrand({ businessType: d.business_type, igHandle: handle, ig, website: d.website || d.website_url });
    await ephemeralSet(`brandinfo:${u.user_id}`, {
      business_type: cleanBusinessType(d.business_type), quality: verdict.quality, reason: verdict.reason,
      followers: ig?.followers ?? null, website: hasWebsite(d.website || d.website_url), at: Date.now(),
    }, YEARS_5);
    if (verdict.quality !== "qualified") return { verdict, event: null };
    const created = Date.parse(String(u.created_at || ""));
    if (Number.isFinite(created) && Date.now() - created > NEW_ACCOUNT_DAYS * 86400e3) return { verdict, event: null };
    const key = `metaqb:${u.user_id}`;
    if (await ephemeralGet(key)) return { verdict, event: null };
    await ephemeralSet(key, { at: Date.now() }, 400 * 86400e3);
    const eventId = qualifiedBrandEventId(String(u.user_id));
    const followers = Math.max(0, Math.round(Number(ig?.followers) || 0));
    void sendCapiEvent(buildEventPayload({ eventName: QUALIFIED_BRAND_EVENT, user: u, eventId, req: o.req, testCode: String(process.env.META_TEST_EVENT_CODE || "").trim(),
      customData: { value: 1, currency: "INR", content_name: "brand", business_type: cleanBusinessType(d.business_type), followers_count: followers } }));
    return { verdict, event: { name: QUALIFIED_BRAND_EVENT, event_id: eventId, followers } };
  } catch (e: any) { console.warn("[brand-quality] skipped:", e?.message || e); return plain; }
}

/** First brief by this brand (UGC brief or campaign): BriefPosted once (server half). Unverified brands are not sent. */
export async function briefPostedOnce(o: { user: any; req?: any; kind: string }): Promise<MetaServerEvent | null> {
  try {
    const u = o.user || {};
    if (!u.user_id || String(u.role || "").toLowerCase() !== "brand") return null;
    const key = `metabp:${u.user_id}`;
    if (await ephemeralGet(key)) return null;
    await ephemeralSet(key, { at: Date.now(), kind: o.kind }, YEARS_5);
    const info = await readBrandInfo(String(u.user_id));
    if (info?.quality === "unverified") return null;
    const eventId = briefPostedEventId(String(u.user_id));
    void sendCapiEvent(buildEventPayload({ eventName: BRIEF_POSTED_EVENT, user: u, eventId, req: o.req, testCode: String(process.env.META_TEST_EVENT_CODE || "").trim(),
      customData: { value: 1, currency: "INR", content_name: o.kind } }));
    return { name: BRIEF_POSTED_EVENT, event_id: eventId, followers: 0 };
  } catch (e: any) { console.warn("[brief-posted] skipped:", e?.message || e); return null; }
}

/** Express middleware: when POST /ugc/briefs or POST /campaigns succeeds, a brand's FIRST brief adds `meta_event`
 *  (BriefPosted) to the answer, so the browser / app fires the same event id (src/lib/api.js). The brief routes themselves
 *  (locked files) are not touched. Never changes a failed answer. */
export const BRIEF_PATHS = new Set(["/ugc/briefs", "/campaigns"]);
export function briefPostedMiddleware(parseAuthUser: (req: any) => Promise<any>) {
  return (req: any, res: any, next: any) => {
    if (req.method !== "POST" || !BRIEF_PATHS.has(String(req.path || ""))) return next();
    const orig = res.json.bind(res);
    res.json = (body: any) => {
      const ok = (res.statusCode || 200) < 300 && body && typeof body === "object" && !Array.isArray(body) && !body.error && !body.meta_event;
      if (!ok) return orig(body);
      (async () => {
        let ev: MetaServerEvent | null = null;
        try {
          const user = await parseAuthUser(req);
          ev = await briefPostedOnce({ user, req, kind: req.path === "/campaigns" ? "campaign" : "ugc_brief" });
        } catch { ev = null; }
        orig(ev ? { ...body, meta_event: ev } : body);
      })();
      return res;
    };
    next();
  };
}


/** v451 (Ravi): a new brand is checked by the team first (Admin › Waitlist). Until approved it may save drafts but
 *  not post a campaign or a UGC brief. Returns the 403 body to send, or null when the brand may post. */
export const BRAND_UNDER_REVIEW_MSG = "Your brand is under review. Our team checks every new brand before it can post — usually within a day. We'll notify you once you're approved.";
export async function brandReviewBlock(db: any, brandUserId: string): Promise<null | { error: string; detail: string; code: string }> {
  try {
    if (!db || !brandUserId) return null;
    const { data } = await db.from("brand_profiles").select("profile_status").eq("user_id", brandUserId).maybeSingle();
    if (String(data?.profile_status || "").toLowerCase() !== "under_review") return null;
    return { error: BRAND_UNDER_REVIEW_MSG, detail: BRAND_UNDER_REVIEW_MSG, code: "BRAND_UNDER_REVIEW" };
  } catch { return null; } // never block a brand because the check itself failed
}
