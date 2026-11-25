// v450 (Ravi, 17 Nov 2026): "Total campaign value on Ybex" banner — creator Home (under "Meet our top creators") and
// brand Dashboard (where the Campaign Templates row was). Starts at ₹14,60,363 (Ybex's offline + app work since 2023,
// Ravi's figure). It changes only for real reasons:
//   • every app campaign / UGC brief created after the start date adds its value automatically, and
//   • Ravi adds or subtracts amounts himself in Admin (offline deals, cancellations) with a note.
// No random / automatic drift. Kept in ybex_ephemeral (no new table). Also: area demand (empty "near you" searches,
// BRD §L7) — logged here and summed for Admin › Overview.
import express from "express";
import { ephemeralGet, ephemeralSet, ephemeralList, ephemeralDelete } from "./ephemeralStore";
import { publicBrief, briefForOutsider, isBriefOwner } from "./ugcGuards";

export const CV_BASE = 1460363;
export const CV_START_ISO = "2026-11-17T18:30:00.000Z"; // app items created after this are added on top of the base
const ENTRIES_KEY = "campaignvalue:entries";
const LABEL_KEY = "campaignvalue:label";
const YEARS_10 = 10 * 365 * 86400e3;
const isAdmin = (u: any) => u && (u.role === "admin" || u.role === "sub_admin" || u.team_role === "sub_admin");
const isFullAdmin = (u: any) => u && u.role === "admin";

export type CvEntry = { id: string; amount: number; note: string; at: string; by: string };

/** Pure: the value of app items (campaigns: budget_max × creators; briefs: budget × creators) created after the start. */
export function appItemsValue(campaigns: any[], briefs: any[], startIso = CV_START_ISO): number {
  const after = (x: any) => String(x?.created_at || "") > startIso;
  const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const camp = (campaigns || []).filter(after).reduce((s, c) => s + n(c.budget_max || c.budget_min) * Math.max(1, n(c.max_creators) || 1), 0);
  const ugc = (briefs || []).filter(after).reduce((s, b) => s + n(b.budget) * Math.max(1, n(b.max_creators) || 1), 0);
  return Math.round(camp + ugc);
}

/** Pure: base + admin entries + app items. Never below 0. */
export function campaignValueTotal(entries: CvEntry[], appValue: number, base = CV_BASE): number {
  const adj = (entries || []).reduce((s, e) => s + (Number(e?.amount) || 0), 0);
  return Math.max(0, Math.round(base + adj + (Number(appValue) || 0)));
}

/** Pure: "110+ cities" from a real distinct-city count (rounded down to 10). */
export function citiesLabel(count: number): string {
  const c = Math.max(0, Math.floor(Number(count) || 0));
  if (c >= 10) return `${Math.floor(c / 10) * 10}+ cities`;
  return c ? `${c} cities` : "";
}

const CITY_FIX: Record<string, string> = { "delhi ncr": "Delhi", "new delhi": "Delhi", bangalore: "Bengaluru", gurgaon: "Gurugram" };
/** Pure: real ticker lines from creator cities ("Jaipur: 67 creators on Ybex"). Skips "pan india" etc. */
export function tickerLines(cityRows: Array<{ city: string }>, max = 6): { lines: string[]; cityCount: number } {
  const counts = new Map<string, number>();
  for (const r of cityRows || []) {
    let c = String(r?.city || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!c || /^(pan )?india$|^pan india$|^na$|^-$|^none$|^other/.test(c)) continue;
    c = CITY_FIX[c] ? CITY_FIX[c].toLowerCase() : c;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const title = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
  const lines = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, max)
    .map(([c, n]) => `${title(c)}: ${n} creator${n === 1 ? "" : "s"} on Ybex`);
  return { lines, cityCount: counts.size };
}

/** Pure: one area-demand row (BRD §L7) — cleaned, nothing personal beyond the brand id. */
export function demandRow(b: any, brandId: string) {
  const s = (v: any, n = 80) => String(v ?? "").trim().slice(0, n);
  const num = (v: any) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1e4) / 1e4 : null);
  return { brand_id: s(brandId, 80), branch_id: s(b?.branch_id, 60), city: s(b?.city), area: s(b?.area), lat: num(b?.lat), lng: num(b?.lng), radius_km: Math.max(0, Math.min(500, Number(b?.radius_km) || 0)), results: Math.max(0, Number(b?.results) || 0), at: new Date().toISOString() };
}

/** Pure: demand rows → areas sorted by searches (only searches that found nobody). */
export function demandSummary(rows: any[]) {
  const byArea = new Map<string, { area: string; city: string; searches: number; brands: Set<string>; last: string }>();
  for (const r of rows || []) {
    if (Number(r?.results) > 0) continue;
    const city = String(r?.city || "").trim() || "Unknown";
    const area = String(r?.area || "").trim();
    const key = `${city.toLowerCase()}|${area.toLowerCase()}`;
    const cur = byArea.get(key) || { area, city, searches: 0, brands: new Set<string>(), last: "" };
    cur.searches += 1; if (r?.brand_id) cur.brands.add(String(r.brand_id)); if (String(r?.at || "") > cur.last) cur.last = String(r.at);
    byArea.set(key, cur);
  }
  return Array.from(byArea.values()).map((x) => ({ area: x.area, city: x.city, searches: x.searches, brands: x.brands.size, last: x.last }))
    .sort((a, b) => b.brands - a.brands || b.searches - a.searches).slice(0, 50);
}

let cache: { at: number; body: any } | null = null;

/** v451: +1 on campaigns.views the first time this creator opens this LIVE campaign. */
export async function countCampaignView(db: any, campaignId: string, creatorId: string): Promise<boolean> {
  try {
    if (!db || !campaignId || !creatorId) return false;
    const k = `cview:${campaignId}:${creatorId}`;
    if (await ephemeralGet(k)) return false;
    const { data } = await db.from("campaigns").select("views, status").eq("campaign_id", campaignId).maybeSingle();
    if (!data || String(data.status || "").toLowerCase() !== "live") return false;
    await ephemeralSet(k, 1, 2 * 365 * 86400e3);
    await db.from("campaigns").update({ views: (Number(data.views) || 0) + 1 }).eq("campaign_id", campaignId);
    return true;
  } catch { return false; }
}

export function setupCampaignValueRoutes(router: express.Router, { supabase, privilegedSupabase, parseAuthUser, enrichBriefsWithBrandProfiles }: any) {
  const db = () => privilegedSupabase || supabase;

  async function compute() {
    const entries: CvEntry[] = (await ephemeralGet(ENTRIES_KEY).catch(() => null)) || [];
    const label = (await ephemeralGet(LABEL_KEY).catch(() => null)) || null;
    let campaigns: any[] = [], briefs: any[] = [], cityRows: any[] = [];
    try { campaigns = (await db().from("campaigns").select("budget_min, budget_max, max_creators, created_at").gt("created_at", CV_START_ISO)).data || []; } catch { /* base only */ }
    try { briefs = (await db().from("ugc_briefs").select("budget, max_creators, created_at").gt("created_at", CV_START_ISO)).data || []; } catch { /* base only */ }
    try { cityRows = (await db().from("creator_profiles").select("city").neq("city", "").limit(5000)).data || []; } catch { /* no ticker */ }
    const appValue = appItemsValue(campaigns, briefs);
    const { lines, cityCount } = tickerLines(cityRows);
    return { total: campaignValueTotal(entries, appValue), cities_label: String(label?.cities || "").trim() || citiesLabel(cityCount), ticker: lines, app_value: appValue, entries };
  }

  router.get("/public/campaign-value", async (_req: any, res: any) => {
    try {
      if (!cache || Date.now() - cache.at > 5 * 60e3) {
        const c = await compute();
        cache = { at: Date.now(), body: { total: c.total, cities_label: c.cities_label, ticker: c.ticker } };
      }
      res.set("Cache-Control", "public, max-age=120");
      res.json(cache.body);
    } catch {
      res.json({ total: CV_BASE, cities_label: "", ticker: [] });
    }
  });

  router.get("/admin/campaign-value", async (req: any, res: any) => {
    const user = await parseAuthUser(req);
    if (!isAdmin(user)) return res.status(403).json({ error: "Admin only" });
    const c = await compute();
    res.json({ base: CV_BASE, start: CV_START_ISO, total: c.total, app_value: c.app_value, cities_label: c.cities_label, entries: (c.entries || []).slice().reverse().slice(0, 200) });
  });

  router.post("/admin/campaign-value", async (req: any, res: any) => {
    const user = await parseAuthUser(req);
    if (!isFullAdmin(user)) return res.status(403).json({ error: "Only the main admin can change this." });
    const amount = Math.round(Number(String(req.body?.amount ?? "").replace(/[^0-9.-]/g, "")));
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10000000) return res.status(400).json({ error: "Enter an amount, e.g. 2000 or -2000." });
    const note = String(req.body?.note || "").trim().slice(0, 120);
    if (!note) return res.status(400).json({ error: "Add a short note (e.g. 'Jaipur offline deal')." });
    const entries: CvEntry[] = (await ephemeralGet(ENTRIES_KEY).catch(() => null)) || [];
    entries.push({ id: `cv_${Date.now().toString(36)}`, amount, note, at: new Date().toISOString(), by: String(user?.name || user?.email || "admin") });
    await ephemeralSet(ENTRIES_KEY, entries.slice(-2000), YEARS_10);
    cache = null;
    const c = await compute();
    res.json({ ok: true, total: c.total });
  });

  router.post("/admin/campaign-value/label", async (req: any, res: any) => {
    const user = await parseAuthUser(req);
    if (!isFullAdmin(user)) return res.status(403).json({ error: "Only the main admin can change this." });
    const cities = String(req.body?.cities || "").trim().slice(0, 40);
    await ephemeralSet(LABEL_KEY, { cities }, YEARS_10);
    cache = null;
    res.json({ ok: true });
  });

  // ── Area demand (BRD §L7): every "near you" search that found nobody ──
  // v451 (BRD §1): a creator opening a live brief = one real view, once per creator per campaign (2-year marker).
  router.post("/campaign-seen/:id", async (req: any, res: any) => {
    const user = await parseAuthUser(req);
    if (!user?.user_id || user.role !== "creator") return res.json({ ok: true, counted: false });
    res.json({ ok: true, counted: await countCampaignView(db(), String(req.params.id || ""), String(user.user_id)) });
  });

  router.post("/brand/area-demand", async (req: any, res: any) => {
    const user = await parseAuthUser(req);
    if (!user?.user_id) return res.status(401).json({ error: "Login required" });
    const row = demandRow(req.body || {}, String(user.user_id));
    if (!row.city && row.lat == null) return res.json({ ok: true, skipped: true });
    const day = row.at.slice(0, 10);
    const key = `areademand:${day}`;
    const list = (await ephemeralGet(key).catch(() => null)) || [];
    list.push(row);
    await ephemeralSet(key, list.slice(-5000), 400 * 86400e3);
    res.json({ ok: true });
  });

  router.get("/admin/area-demand", async (req: any, res: any) => {
    const user = await parseAuthUser(req);
    if (!isAdmin(user)) return res.status(403).json({ error: "Admin only" });
    const days = await ephemeralList("areademand:", 120).catch(() => []);
    const rows = (days || []).flatMap((d: any) => (Array.isArray(d?.value) ? d.value : []));
    const notify = await ephemeralList("areanotify:", 1000).catch(() => []);
    res.json({ areas: demandSummary(rows), total_searches: rows.length, empty_searches: rows.filter((r: any) => !(Number(r?.results) > 0)).length, notify_count: (notify || []).length });
  });

  // "Notify me when creators join" (EL-06) — one row per brand+city.
  // v455: GET so the button remembers "We'll notify you" after a reload; keyed on the brand owner (team members share).
  router.get("/brand/area-notify", async (req: any, res: any) => {
    const user = await parseAuthUser(req);
    if (!user?.user_id) return res.status(401).json({ error: "Login required" });
    const brand = String(user.parent_brand_id || user.user_id);
    const city = String(req.query?.city || "").trim().slice(0, 80).toLowerCase();
    const row = await ephemeralGet(`areanotify:${brand}:${city || "any"}`).catch(() => null);
    res.json({ on: Boolean(row) });
  });
  router.post("/brand/area-notify", async (req: any, res: any) => {
    const user = await parseAuthUser(req);
    if (!user?.user_id) return res.status(401).json({ error: "Login required" });
    const brand = String(user.parent_brand_id || user.user_id);
    const city = String(req.body?.city || "").trim().slice(0, 80).toLowerCase();
    const key = `areanotify:${brand}:${city || "any"}`;
    if (req.body?.undo) { await ephemeralDelete(key).catch(() => {}); return res.json({ ok: true, on: false }); }
    await ephemeralSet(key, { brand_id: brand, email: user.email || "", city, at: new Date().toISOString() }, 365 * 86400e3);
    res.json({ ok: true, on: true });
  });

  // v460 (Ravi: in-house briefs stay visible but nobody can claim them): briefs a brand / admin set to CLOSED are
  // listed for creators with "Applications closed" (no claim button). Claiming is blocked by ugc_routes already
  // (only OPEN / CLAIMED can be claimed) and a closed brief never re-opens when a slot is freed (ugcSlots).
  router.get("/ugc/closed-briefs", async (req: any, res: any) => {
    try {
      const { data } = await db().from("ugc_briefs").select("*")
        .eq("status", "CLOSED").order("created_at", { ascending: false }).limit(30);
      let rows = (data || []).filter(isShowcaseBrief);
      // same brand name / logo / verified tick as the open list (shared helper from server.ts)
      if (typeof enrichBriefsWithBrandProfiles === "function") rows = await enrichBriefsWithBrandProfiles(rows).catch(() => rows);
      // same privacy as /ugc/briefs/available: logged-out → listing only; others → no private brief fields
      const viewer = await parseAuthUser(req).catch(() => null);
      const shaped = rows.map((b: any) => (!viewer ? publicBrief(b) : isBriefOwner(viewer, b) ? b : briefForOutsider(b)));
      res.set("Cache-Control", "private, max-age=60");
      res.json(shaped.map(closedBriefRow));
    } catch { res.json([]); }
  });

  // v455: actually send "creators joined near you" — before, "Notify me" was saved and nobody was ever told.
  // Every 6 h: for each waiting brand+city, count approved creators in that city who joined after the brand asked;
  // if any → one in-app notification (push goes out through the normal notifications → push loop), then the row is cleared.
  async function deliverAreaNotifies() {
    try {
      const rows = await ephemeralList("areanotify:", 1000).catch(() => []);
      for (const r of rows || []) {
        const v = r?.value || {};
        const city = String(v.city || "").trim();
        if (!city || !v.brand_id) continue;
        const { data } = await db().from("creator_profiles").select("user_id, created_at, profile_status")
          .ilike("city", city).gt("created_at", String(v.at || new Date(0).toISOString())).limit(200);
        const n = areaNotifyCount(data || []);
        if (!n) continue;
        await db().from("notifications").insert({
          notif_id: (globalThis as any).crypto?.randomUUID?.() || `an_${Date.now()}`,
          user_id: String(v.brand_id), type: "creators_nearby",
          message: areaNotifyMessage(n, city),
        });
        await ephemeralDelete(r.key).catch(() => {});
      }
    } catch { /* next round */ }
  }
  setTimeout(deliverAreaNotifies, 60_000).unref?.();
  setInterval(deliverAreaNotifies, 6 * 3600e3).unref?.();
}

/** Pure (v455): how many of these new creator rows count (approved / live profiles only). */
export function areaNotifyCount(rows: any[]): number {
  return (rows || []).filter((c) => ["approved", "live", "active"].includes(String(c?.profile_status || "").toLowerCase())).length;
}
/** Pure (v455): the notification text. */
export function areaNotifyMessage(n: number, city: string): string {
  const c = String(city || "").trim().replace(/\b\w/g, (m) => m.toUpperCase()) || "your area";
  return `${n} new creator${n === 1 ? "" : "s"} joined near ${c} — open Explore to see them on the map.`;
}

/** Pure (v460): a CLOSED brief that may be shown to creators (not a demo / test brief). */
export function isShowcaseBrief(b: any): boolean {
  if (!b || !b.id) return false;
  if (String(b.status || "").toUpperCase() !== "CLOSED") return false;
  const demo = new Set(["Test Ravi", "Nexus Brands", "Nexus Brands Inc.", "Urban Kicks Studio", "FitGlow Nutrition"]);
  return !(demo.has(b.brand_name) || String(b.id).startsWith("brief_test_ravi") || String(b.id).startsWith("brief_nexus_demo"));
}
/** Pure (v460): the row the creator list gets — marked closed, never claimable. */
export function closedBriefRow(b: any) {
  return { ...b, status: "CLOSED", applications_closed: true };
}
