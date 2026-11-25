// v450 (Ravi's BRD "Explore near you"): pure helpers for the location system — no React here (tested).
// Creators are placed on their CITY centre (that's what sign-up asks for) — never a home address. A tiny, fixed
// per-creator offset keeps pins from sitting exactly on top of each other; distances use the city centre itself.
import { cityPoint, distanceKm } from "../../../lib/indiaCities";

export const RADII = [10, 25, 50, 100];
export const DEFAULT_RADIUS = 25;
export const ZOOM_FOR_RADIUS = { 10: 11, 25: 10, 50: 9, 100: 8 };

const hash = (s) => String(s || "").split("").reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** The creator's map point: their city centre (+ a small fixed offset for the pin only). null when the city is unknown. */
export function creatorPoint(c) {
  const h = hash(c?.user_id || c?.id || c?.name);
  // v472: the creator's own area (set by them, ≈1 km rounded) beats the city centre
  const a = c?.__area;
  if (a && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng))) {
    const ang = (h % 360) * (Math.PI / 180), r = 0.001 + ((h >> 9) % 100) / 100 * 0.003;
    return { lat: Number(a.lat), lng: Number(a.lng), pinLat: Number(a.lat) + r * Math.sin(ang), pinLng: Number(a.lng) + r * Math.cos(ang), exact: true };
  }
  const p = cityPoint(`${c?.city || ""} ${c?.state || ""}`) || cityPoint(c?.city);
  if (!p) return null;
  const ang = (h % 360) * (Math.PI / 180), r = 0.004 + ((h >> 9) % 100) / 100 * 0.012; // ≈0.4–1.8 km
  return { lat: p[0], lng: p[1], pinLat: p[0] + r * Math.sin(ang), pinLng: p[1] + r * Math.cos(ang) };
}

/** Distance (km, 1 decimal) from the branch to each creator's city centre; creators with no known city are left out. */
export function withDistance(creators, branch) {
  if (!branch) return [];
  const out = [];
  for (const c of creators || []) {
    const pt = creatorPoint(c);
    if (!pt) continue;
    const d = distanceKm([branch.lat, branch.lng], [pt.lat, pt.lng]);
    if (d == null) continue;
    out.push({ ...c, __km: Math.round(d * 10) / 10, __pt: pt });
  }
  return out.sort((a, b) => a.__km - b.__km);
}

export const withinRadius = (list, km) => (list || []).filter((c) => c.__km <= km);

/** "Also from Jaipur" when the creator is in the brand's own city, else "12 km away" (min 1 km). */
export function distanceLabel(c, branch) {
  if (c?.__pt?.exact && c?.__km != null) return c.__km < 1 ? "Under 1 km away" : `${Math.round(c.__km)} km away`; // v472
  const sameCity = branch?.city && String(c?.city || "").trim().toLowerCase() === String(branch.city).trim().toLowerCase();
  if (sameCity || (c?.__km != null && c.__km < 3)) return `Also from ${titleCase(c?.city || branch?.city || "your city")}`;
  return `${Math.max(1, Math.round(c?.__km || 0))} km away`;
}
export const titleCase = (s) => String(s || "").trim().replace(/\b\w/g, (m) => m.toUpperCase());

// ── Web Mercator (256px tiles) ──
export const worldSize = (z) => 256 * Math.pow(2, z);
export function project(lat, lng, z) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  const ws = worldSize(z);
  return { x: ((lng + 180) / 360) * ws, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * ws };
}
export function unproject(x, y, z) {
  const ws = worldSize(z);
  const lng = (x / ws) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / ws;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng };
}
/** Pixels for `km` at this latitude / zoom. */
export const kmToPx = (km, lat, z) => (km * 1000) / ((156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z));

/** Merge pins closer than `px` into clusters ("+N"). `pins` = [{ id, x, y, item }]. Nearest-first order kept. */
export function clusterPins(pins, px = 44) {
  const out = [];
  for (const p of pins || []) {
    const hit = out.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < px);
    if (hit) { hit.items.push(p.item); hit.n += 1; } else out.push({ id: p.id, x: p.x, y: p.y, items: [p.item], n: 1 });
  }
  return out;
}

/** Counts per radius option, for "25 km ▾" with counts. */
export const radiusCounts = (list) => Object.fromEntries(RADII.map((r) => [r, withinRadius(list, r).length]));

/** Short follower / reach numbers. */
export const shortNum = (n) => {
  n = Number(n) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "")}K`;
  return n ? String(n) : "";
};
