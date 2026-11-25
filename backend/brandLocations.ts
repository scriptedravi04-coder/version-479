// v450 (Ravi's BRD "Explore near you", 17 Nov 2026): a brand's office / branch locations (max 5, one selected) and the
// free address lookup behind "Search address" / "Use my current location" (OpenStreetMap Nominatim, India only,
// cached — no Google bill). Kept in ybex_ephemeral (no new table). Also stores the brand's map "seen" flags
// (first-open globe intro, the map tooltip) so they don't come back after a reinstall.
import express from "express";
import { ephemeralGet, ephemeralSet, ephemeralList, ephemeralDelete } from "./ephemeralStore";

const YEARS_10 = 10 * 365 * 86400e3;
export const MAX_BRANCHES = 5;
const key = (uid: string) => `brandbranches:${uid}`;
const flagsKey = (uid: string) => `brandmapflags:${uid}`;

export type Branch = { id: string; name: string; address: string; city: string; area: string; lat: number; lng: number; selected?: boolean; at?: string };

const clip = (v: any, n = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const inIndia = (lat: number, lng: number) => lat > 5 && lat < 38 && lng > 67 && lng < 98;

/** Pure: validate + clean one branch from the app. Returns { branch } or { error }. */
export function cleanBranch(b: any, existing: Branch[], editingId = ""): { branch?: Branch; error?: string } {
  const lat = Number(b?.lat), lng = Number(b?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inIndia(lat, lng)) return { error: "Pick a place in India on the map." };
  const name = clip(b?.name, 40);
  if (!name) return { error: "Give this branch a name." };
  if (existing.some((x) => x.id !== editingId && x.name.toLowerCase() === name.toLowerCase())) return { error: "You already have a branch with this name." };
  if (!editingId && existing.length >= MAX_BRANCHES) return { error: `You can save up to ${MAX_BRANCHES} branches.` };
  return { branch: { id: editingId || `br_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, address: clip(b?.address, 200), city: clip(b?.city, 60), area: clip(b?.area, 80), lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, at: new Date().toISOString() } };
}

/** Pure: exactly one selected (the given id, else the first). */
export function selectOne(list: Branch[], id?: string): Branch[] {
  const pick = list.some((b) => b.id === id) ? id : list[0]?.id;
  return list.map((b) => ({ ...b, selected: b.id === pick }));
}

/** Pure: a Nominatim result → { label, address, city, area, lat, lng }. */
export function placeFromNominatim(r: any) {
  const a = r?.address || {};
  const area = a.suburb || a.neighbourhood || a.quarter || a.residential || a.city_district || a.village || a.hamlet || "";
  const city = a.city || a.town || a.county || a.state_district || a.municipality || "";
  const road = [a.house_number, a.building, a.road].filter(Boolean).join(" ");
  const label = area || road || city || String(r?.name || "").trim() || String(r?.display_name || "").split(",")[0];
  const address = [road, area, city, a.state, a.postcode].filter((x, i, arr) => x && arr.indexOf(x) === i).join(", ");
  return { label: clip(label, 80), address: clip(address || r?.display_name, 200), city: clip(city, 60), area: clip(area, 80), lat: Number(r?.lat), lng: Number(r?.lon) };
}

const geoCache = new Map<string, { at: number; body: any }>();
// v455: one request at a time, ≥1.1 s apart (Nominatim policy). Before, two searches at the same moment both saw
// "no wait" and went out together; and a slow Nominatim could hang the request (now 8 s timeout).
let geoChain: Promise<any> = Promise.resolve();
let lastCall = 0;
async function nominatim(path: string): Promise<any> {
  const hit = geoCache.get(path);
  if (hit && Date.now() - hit.at < 7 * 86400e3) return hit.body;
  const run = async () => {
    const again = geoCache.get(path); if (again) return again.body;
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const r = await fetch(`https://nominatim.openstreetmap.org/${path}`, { headers: { "User-Agent": "Ybex/1.0 (support@ybexmedia.in)", "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`geo ${r.status}`);
    const body = await r.json();
    geoCache.set(path, { at: Date.now(), body });
    if (geoCache.size > 3000) geoCache.delete(geoCache.keys().next().value as string);
    return body;
  };
  const p = geoChain.then(run, run);
  geoChain = p.catch(() => null);
  return p;
}

/** v455: whose branches these are — a brand team member shares the brand owner's branches. Creators: none. */
const areaKey = (uid: string) => `creatorarea:${uid}`;
/** v472 — pure: a creator's area, rounded to 2 decimals (≈1 km) so it never points at a home. */
export function cleanCreatorArea(b: any): { area?: { lat: number; lng: number; area: string; city: string; at: string }; error?: string } {
  const lat = Number(b?.lat), lng = Number(b?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inIndia(lat, lng)) return { error: "Pick a place in India." };
  return { area: { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, area: clip(b?.area || b?.label, 80), city: clip(b?.city, 60), at: new Date().toISOString() } };
}

export function branchOwnerId(u: any): string {
  if (!u?.user_id) return "";
  const role = String(u.role || "").toLowerCase();
  if (role !== "brand" && role !== "admin") return "";
  return String(u.parent_brand_id || u.user_id);
}

export function setupBrandLocationRoutes(router: express.Router, { parseAuthUser }: any) {
  // v455: brands only (creators got their own empty branch list before), keyed on the brand owner so team members
  // see the same branches. Returns { user_id } = the owner id the rest of the routes use.
  const brandOnly = async (req: any, res: any) => {
    const u = await parseAuthUser(req);
    if (!u?.user_id) { res.status(401).json({ error: "Login required" }); return null; }
    const owner = branchOwnerId(u);
    if (!owner) { res.status(403).json({ error: "Only brands can save locations" }); return null; }
    return { ...u, user_id: owner };
  };
  const loggedIn = async (req: any, res: any) => {
    const u = await parseAuthUser(req);
    if (!u?.user_id) { res.status(401).json({ error: "Login required" }); return null; }
    return u;
  };
  const read = async (uid: string): Promise<Branch[]> => (await ephemeralGet(key(uid)).catch(() => null)) || [];

  // v472 (Ravi's map recording: "+39" pile — creators only had a city): a creator can put their AREA on the map
  // (search or "use my location"). Saved rounded to ~1 km (never an exact home) in ybex_ephemeral — no new table.
  const creatorOnly = async (req: any, res: any) => {
    const u = await parseAuthUser(req);
    if (!u?.user_id) { res.status(401).json({ error: "Login required" }); return null; }
    if (String(u.role || "").toLowerCase() !== "creator") { res.status(403).json({ error: "Only creators can set this" }); return null; }
    return u;
  };
  router.get("/creators/me/area", async (req: any, res: any) => {
    const u = await creatorOnly(req, res); if (!u) return;
    res.json({ area: (await ephemeralGet(areaKey(u.user_id)).catch(() => null)) || null });
  });
  router.post("/creators/me/area", async (req: any, res: any) => {
    const u = await creatorOnly(req, res); if (!u) return;
    if (req.body?.clear) { await ephemeralDelete(areaKey(u.user_id)).catch(() => {}); return res.json({ area: null }); }
    const r = cleanCreatorArea(req.body);
    if (r.error) return res.status(400).json({ error: r.error });
    await ephemeralSet(areaKey(u.user_id), r.area, YEARS_10);
    res.json({ area: r.area });
  });
  router.get("/geo/creator-areas", async (req: any, res: any) => {
    const u = await loggedIn(req, res); if (!u) return;
    const rows = await ephemeralList("creatorarea:", 5000).catch(() => []);
    const out: Record<string, any> = {};
    for (const r of rows as any[]) if (r?.value && Number.isFinite(r.value.lat)) out[String(r.key).slice("creatorarea:".length)] = { lat: r.value.lat, lng: r.value.lng, area: r.value.area, city: r.value.city };
    res.json({ areas: out });
  });

  router.get("/brand/branches", async (req: any, res: any) => {
    const u = await brandOnly(req, res); if (!u) return;
    const flags = (await ephemeralGet(flagsKey(u.user_id)).catch(() => null)) || {};
    res.json({ branches: await read(u.user_id), max: MAX_BRANCHES, flags });
  });

  router.post("/brand/branches", async (req: any, res: any) => {
    const u = await brandOnly(req, res); if (!u) return;
    const list = await read(u.user_id);
    const id = clip(req.body?.id, 40);
    const { branch, error } = cleanBranch(req.body, list, list.some((b) => b.id === id) ? id : "");
    if (error || !branch) return res.status(400).json({ error });
    const next = list.some((b) => b.id === branch.id) ? list.map((b) => (b.id === branch.id ? branch : b)) : [...list, branch];
    // v455: a NEW branch becomes the selected one; editing (rename / move) keeps whatever was selected —
    // renaming "Warehouse" from the menu used to silently switch Explore to the Warehouse.
    const isEdit = list.some((b) => b.id === branch.id);
    const keepSel = list.find((b) => b.selected)?.id;
    const saved = selectOne(next, req.body?.select === true ? branch.id : req.body?.select === false || isEdit ? keepSel : branch.id);
    await ephemeralSet(key(u.user_id), saved, YEARS_10);
    res.json({ branches: saved, branch: saved.find((b) => b.id === branch.id) });
  });

  router.post("/brand/branches/:id/select", async (req: any, res: any) => {
    const u = await brandOnly(req, res); if (!u) return;
    const saved = selectOne(await read(u.user_id), String(req.params.id));
    await ephemeralSet(key(u.user_id), saved, YEARS_10);
    res.json({ branches: saved });
  });

  router.delete("/brand/branches/:id", async (req: any, res: any) => {
    const u = await brandOnly(req, res); if (!u) return;
    const list = (await read(u.user_id)).filter((b) => b.id !== String(req.params.id));
    const saved = selectOne(list, list.find((b) => b.selected)?.id);
    await ephemeralSet(key(u.user_id), saved, YEARS_10);
    res.json({ branches: saved });
  });

  router.post("/brand/map-flags", async (req: any, res: any) => {
    const u = await brandOnly(req, res); if (!u) return;
    const cur = (await ephemeralGet(flagsKey(u.user_id)).catch(() => null)) || {};
    const next = { ...cur };
    for (const k of ["map_intro_seen", "map_tip_seen"]) if (req.body?.[k]) next[k] = new Date().toISOString();
    // v450 (BRD §5): "Are you an agency?" one-time popup — shown, dismissed (twice max) or claimed
    if (req.body?.agency_prompt === "dismissed") { next.agency_prompt_count = (Number(cur.agency_prompt_count) || 0) + 1; next.agency_prompt_dismissed_at = new Date().toISOString(); }
    if (req.body?.agency_prompt === "claimed") next.agency_prompt_done = true;
    await ephemeralSet(flagsKey(u.user_id), next, YEARS_10);
    res.json({ flags: next });
  });

  // v455: login needed — this was an open proxy to Nominatim (anyone could use up our 1-a-second budget).
  router.get("/geo/search", async (req: any, res: any) => {
    if (!(await loggedIn(req, res))) return;
    const q = clip(req.query?.q, 100);
    if (q.length < 3) return res.json({ places: [] });
    try {
      const body = await nominatim(`search?format=jsonv2&addressdetails=1&countrycodes=in&limit=6&q=${encodeURIComponent(q)}`);
      res.set("Cache-Control", "public, max-age=86400");
      res.json({ places: (Array.isArray(body) ? body : []).map(placeFromNominatim).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)) });
    } catch { res.json({ places: [], error: "Search is busy. Try again in a moment." }); }
  });

  router.get("/geo/reverse", async (req: any, res: any) => {
    if (!(await loggedIn(req, res))) return;
    const lat = Math.round(Number(req.query?.lat) * 1e4) / 1e4, lng = Math.round(Number(req.query?.lng) * 1e4) / 1e4;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inIndia(lat, lng)) return res.json({ place: null });
    try {
      const body = await nominatim(`reverse?format=jsonv2&addressdetails=1&zoom=17&lat=${lat}&lon=${lng}`);
      res.set("Cache-Control", "public, max-age=86400");
      res.json({ place: body && !body.error ? { ...placeFromNominatim(body), lat, lng } : null });
    } catch { res.json({ place: null }); }
  });
}

/** v450 (BRD §5): show on the first app open after the release, once more 15+ days after the first "no", then never. */
export function shouldShowAgencyPrompt(flags: any, isAgency: boolean, now = Date.now()): boolean {
  if (isAgency || flags?.agency_prompt_done) return false;
  const n = Number(flags?.agency_prompt_count) || 0;
  if (n === 0) return true;
  if (n >= 2) return false;
  const last = Date.parse(String(flags?.agency_prompt_dismissed_at || ""));
  return Number.isFinite(last) && now - last >= 15 * 86400e3;
}
