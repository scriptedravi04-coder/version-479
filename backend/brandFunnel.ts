// v446 (Ravi: "Admin Growth mein brand funnel dikha: sign-up page → account → har step → done → first brief").
// Pure builder + the anonymous sign-up page counter. Counts only — no names, emails or phones.
import { ephemeralGet, ephemeralSet } from "./ephemeralStore";

const DAY = 86400e3;
export const BRAND_FUNNEL_STEPS = [
  { page: "identity", label: "Instagram + logo" },
  { page: "business", label: "What do you run?" },
  { page: "contact", label: "Name + phone" },
] as const;
// pages the older 7-screen flow saved → the nearest new step (index into BRAND_FUNNEL_STEPS)
const PAGE_STEP: Record<string, number> = {
  identity: 0, business: 1, industry: 1, about: 1, contact: 2, manager: 2, presence: 2, channels: 2, campaign: 2, campaign_more: 2,
};

export const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const VISIT_PREFIX = "funnelvisit:brand_signup:";

/** One anonymous visit to the brand sign-up page (Signup with role=brand / the app's brand screen). */
export async function countBrandSignupVisit(now = Date.now()): Promise<number> {
  const key = VISIT_PREFIX + dayKey(now);
  let n = 0;
  try { n = Number((await ephemeralGet(key))?.n) || 0; } catch { n = 0; }
  n += 1;
  try { await ephemeralSet(key, { n }, 120 * DAY); } catch { /* best effort */ }
  return n;
}

export async function readBrandSignupVisits(days: number, now = Date.now()): Promise<number> {
  let total = 0;
  for (let i = 0; i < days; i++) {
    try { total += Number((await ephemeralGet(VISIT_PREFIX + dayKey(now - i * DAY)))?.n) || 0; } catch { /* skip day */ }
  }
  return total;
}

const brandId = (r: any) => String(r?.brand_user_id || r?.brand_id || r?.user_id || "");
const isBrand = (u: any) => String(u?.role || "").toLowerCase() === "brand";
const onboarded = (u: any, profiles: Set<string>) => Boolean(u?.onboarding_completed || u?.onboarded || u?.is_onboarded) || profiles.has(String(u?.user_id));

export type BrandFunnelInput = {
  visits: number;
  users: any[];
  brands: any[];          // brand_profiles
  progress: any[];        // onboarding_progress rows
  campaigns: any[];
  ugcOrders: any[];
  brandInfo: Array<{ user_id: string; quality?: string; business_type?: string; reason?: string; at?: number }>;
  days: number;
  now?: number;
};

export function buildBrandFunnel(i: BrandFunnelInput) {
  const now = i.now ?? Date.now();
  const since = now - i.days * DAY;
  const inWindow = (u: any) => { const t = Date.parse(String(u?.created_at || "")); return Number.isFinite(t) && t >= since; };
  const accounts = (i.users || []).filter((u) => isBrand(u) && inWindow(u));
  const ids = new Set(accounts.map((u) => String(u.user_id)));
  const profiles = new Set((i.brands || []).map((b) => String(b?.user_id || "")).filter((id) => ids.has(id)));
  const stepOf = new Map<string, number>();
  for (const p of i.progress || []) {
    const id = String(p?.user_id || "");
    if (!ids.has(id) || !String(p?.flow || "").startsWith("brand")) continue;
    const s = PAGE_STEP[String(p?.page || "")];
    if (s !== undefined) stepOf.set(id, Math.max(stepOf.get(id) ?? -1, s));
  }
  const done = accounts.filter((u) => onboarded(u, profiles));
  const doneIds = new Set(done.map((u) => String(u.user_id)));
  const briefBy = new Set<string>();
  for (const c of i.campaigns || []) { const id = brandId(c); if (ids.has(id)) briefBy.add(id); }
  for (const o of i.ugcOrders || []) { const id = brandId(o); if (ids.has(id)) briefBy.add(id); }
  const steps = BRAND_FUNNEL_STEPS.map((s, idx) => ({
    label: s.label,
    count: accounts.filter((u) => doneIds.has(String(u.user_id)) || (stepOf.get(String(u.user_id)) ?? -1) >= idx).length,
  }));
  const info = (i.brandInfo || []).filter((b) => ids.has(String(b.user_id)));
  const byType: Record<string, number> = {};
  for (const b of info) if (b.business_type) byType[b.business_type] = (byType[b.business_type] || 0) + 1;
  const rows = [
    { key: "visits", label: "Sign-up page", count: Math.max(0, Math.round(i.visits || 0)) },
    { key: "accounts", label: "Account made", count: accounts.length },
    ...steps.map((s, idx) => ({ key: `step${idx + 1}`, label: `Step ${idx + 1} · ${s.label}`, count: s.count })),
    { key: "done", label: "Profile done", count: done.length },
    { key: "first_brief", label: "First brief", count: accounts.filter((u) => briefBy.has(String(u.user_id))).length },
  ];
  return {
    days: i.days,
    rows: rows.map((r, idx) => ({ ...r, ofPrev: idx === 0 || !rows[idx - 1].count ? null : Math.round((r.count / rows[idx - 1].count) * 100) })),
    qualified: info.filter((b) => b.quality === "qualified").length,
    unverified: info.filter((b) => b.quality === "unverified").length,
    unverifiedIds: info.filter((b) => b.quality === "unverified").map((b) => String(b.user_id)),
    byType,
  };
}
