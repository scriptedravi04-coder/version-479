// Session 31: admin "Speed report" + the one-time "make old photos small" job.
import express from "express";
import { instanceInfo, slowestRoutes, cloudRegion, supabaseRoundTrip } from "./speedStats";
import { PHOTO_BUCKETS, shrinkPhoto } from "./imageResize";

const isAdmin = (u: any) => Boolean(u) && (u.role === "admin" || u.team_role === "sub_admin" || u.role === "sub_admin");

/** Every file path in a bucket (Supabase lists one folder at a time). */
export async function listAllFiles(client: any, bucket: string, prefix = "", depth = 0, out: any[] = []): Promise<any[]> {
  if (depth > 4) return out;
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (const f of rows) {
      const path = prefix ? `${prefix}/${f.name}` : f.name;
      if (!f.id) await listAllFiles(client, bucket, path, depth + 1, out); // a folder
      else out.push({ path, size: Number(f.metadata?.size || 0), type: String(f.metadata?.mimetype || "") });
    }
    if (rows.length < 100) break;
  }
  return out;
}

// v457: the 6 home-page "brands growing with Ybex" logos lived on iili.io (free host we don't control). Once per
// server start we copy any that are missing into our public brand-logos bucket (trusted/<file>); the app shows our
// copy and falls back to iili.io until it exists (src/lib/constants/trustedBrands.js). Safe to repeat; never overwrites.
export const TRUSTED_LOGO_FILES = ["CeJTOuI.png", "CeJRkZP.png", "CeJ5cla.webp", "CeJ7whB.png", "CeJRHhP.jpg", "CeJRBvR.jpg"];
const LOGO_TYPES: Record<string, string> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };
export async function mirrorTrustedLogos(client: any, fetcher: typeof fetch = fetch): Promise<{ copied: string[]; skipped: string[]; failed: string[] }> {
  const out = { copied: [] as string[], skipped: [] as string[], failed: [] as string[] };
  if (!client?.storage) return out;
  let have = new Set<string>();
  try {
    const { data } = await client.storage.from("brand-logos").list("trusted", { limit: 100 });
    have = new Set((data || []).map((r: any) => String(r.name)));
  } catch { /* list failed → try uploads anyway (upsert:false never overwrites) */ }
  for (const file of TRUSTED_LOGO_FILES) {
    if (have.has(file)) { out.skipped.push(file); continue; }
    try {
      const r = await fetcher(`https://iili.io/${file}`, { signal: AbortSignal.timeout(15000) } as any);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > 5 * 1024 * 1024) throw new Error("bad size");
      const ext = file.split(".").pop()!.toLowerCase();
      const { error } = await client.storage.from("brand-logos").upload(`trusted/${file}`, buf, {
        contentType: LOGO_TYPES[ext] || "application/octet-stream", upsert: false, cacheControl: "31536000",
      });
      if (error && !/exists|duplicate/i.test(String(error.message || ""))) throw new Error(error.message);
      out.copied.push(file);
    } catch (e: any) {
      out.failed.push(file);
      console.warn("[trusted-logos] copy failed:", file, e?.message || e);
    }
  }
  return out;
}

// ───────────── v458 (Ravi: storage fills ~200 MB/week with UGC videos) ─────────────
// UGC video files are removed 20 days (v462: was 30, Ravi 19 Nov) after the order is finished (paid out, cancelled or expired).
// 7 days before, the brand and the creator get a notification to download it. Only files under
// content-submissions/ugc-videos/<orderId>/ are touched — campaign deals, chat files, KYC etc. are never deleted.
export const UGC_VIDEO_KEEP_DAYS = 20; // v462 (Ravi): 30 → 20 days; warning still 7 days before (day 13)
export const UGC_VIDEO_WARN_DAYS = 7;
const DAY = 86400e3;
const tms = (v: any) => { const t = v ? Date.parse(String(v)) : NaN; return Number.isFinite(t) ? t : 0; };
/** Pure: when an order finished (0 = not finished). Only a released payout, a cancel or an expiry counts. */
export function ugcOrderDoneAt(o: any): number {
  const st = String(o?.status || "").toUpperCase();
  const pay = String(o?.payout_status || "").toUpperCase();
  const released = tms(o?.escrow_released_at);
  const cancelled = tms(o?.cancelled_at) || (st === "CANCELLED" ? tms(o?.updated_at) : 0);
  const expired = tms(o?.expired_at) || (st === "EXPIRED" ? tms(o?.updated_at) : 0);
  const paidOut = ["PAID", "RELEASED", "PROCESSED", "SUCCESS"].includes(pay) || ["PAID", "RELEASED"].includes(st);
  const end = Math.max(released, cancelled, expired, paidOut ? tms(o?.updated_at) : 0);
  if (end) return end;
  // COMPLETED but the payout not released yet → still running (money / disputes may need the video)
  return 0;
}
/** Pure: what to do with one order today → "delete" | "warn" | null. */
export function ugcVideoAction(o: any, now = Date.now(), warned = false): "delete" | "warn" | null {
  const hasFile = [o?.video_url, o?.video_draft_url].some((u) => typeof u === "string" && u.startsWith("ugc-videos/"));
  if (!hasFile) return null;
  const done = ugcOrderDoneAt(o);
  if (!done) return null;
  const age = now - done;
  if (age >= UGC_VIDEO_KEEP_DAYS * DAY) return "delete";
  if (age >= (UGC_VIDEO_KEEP_DAYS - UGC_VIDEO_WARN_DAYS) * DAY && !warned) return "warn";
  return null;
}
export async function cleanupUgcVideos(client: any, deps: { get: (k: string) => Promise<any>; set: (k: string, v: any, ttl: number) => Promise<void> }, now = Date.now()) {
  const out = { deleted: [] as string[], warned: [] as string[] };
  if (!client?.from) return out;
  const { data: orders } = await client.from("ugc_orders")
    .select("id, brand_id, creator_id, status, payout_status, video_url, video_draft_url, escrow_released_at, cancelled_at, expired_at, updated_at")
    .or("video_url.like.ugc-videos/%,video_draft_url.like.ugc-videos/%").limit(500);
  for (const o of orders || []) {
    const id = String(o.id || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) continue;
    const warned = Boolean(await deps.get(`ugcvidwarn:${id}`).catch(() => null));
    const act = ugcVideoAction(o, now, warned);
    if (act === "warn") {
      const msg = `Your UGC video (order ${id.slice(-6)}) will be removed from Ybex in ${UGC_VIDEO_WARN_DAYS} days — download it now if you need it.`;
      for (const uid of [o.brand_id, o.creator_id].filter(Boolean)) {
        await client.from("notifications").insert({ notif_id: (globalThis as any).crypto?.randomUUID?.() || `uv_${id}_${uid}`, user_id: String(uid), type: "ugc_video_expiring", message: msg }).then(() => {}, () => {});
      }
      await deps.set(`ugcvidwarn:${id}`, { at: new Date(now).toISOString() }, 60 * DAY).catch(() => {});
      out.warned.push(id);
    } else if (act === "delete") {
      const folder = `ugc-videos/${id}`;
      const { data: files } = await client.storage.from("content-submissions").list(folder, { limit: 100 });
      const paths = (files || []).filter((f: any) => f?.id).map((f: any) => `${folder}/${f.name}`);
      for (const u of [o.video_url, o.video_draft_url]) if (typeof u === "string" && u.startsWith(`${folder}/`) && !paths.includes(u)) paths.push(u);
      if (paths.length) {
        const { error } = await client.storage.from("content-submissions").remove(paths);
        if (error) { console.warn("[ugc-video-cleanup]", id, error.message); continue; }
      }
      await deps.set(`ugcviddel:${id}`, { at: new Date(now).toISOString(), files: paths.length }, 400 * DAY).catch(() => {});
      out.deleted.push(id);
    }
  }
  return out;
}

export function setupAdminSpeedRoutes(
  router: express.Router,
  { supabase, privilegedSupabase, parseAuthUser }: { supabase: any; privilegedSupabase: any; parseAuthUser: (req: any) => Promise<any> },
) {
  // v458: UGC video cleanup — once a day (first run 5 min after start)
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    const runCleanup = () => import("./ephemeralStore").then(({ ephemeralGet, ephemeralSet }) =>
      cleanupUgcVideos(privilegedSupabase || supabase, { get: ephemeralGet, set: ephemeralSet }))
      .then((r) => { if (r.deleted.length || r.warned.length) console.log("[ugc-video-cleanup] deleted", r.deleted.length, "warned", r.warned.length); })
      .catch((e) => console.warn("[ugc-video-cleanup] failed:", e?.message || e));
    setTimeout(runCleanup, 5 * 60e3).unref?.();
    setInterval(runCleanup, 24 * 3600e3).unref?.();
  }

  // v457: copy the home-page brand logos into our own bucket once the server has settled (no-op when already there)
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    setTimeout(() => { mirrorTrustedLogos(privilegedSupabase || supabase).then((r) => { if (r.copied.length) console.log("[trusted-logos] copied", r.copied.length); }).catch(() => {}); }, 120000).unref?.();
  }

  router.get("/admin/speed-report", async (req, res) => {
    const user = await parseAuthUser(req);
    if (!isAdmin(user)) return res.status(403).json({ error: "Admins only" });
    const [region, db] = await Promise.all([cloudRegion(), supabaseRoundTrip(privilegedSupabase || supabase)]);
    let supabaseHost: string | null = null;
    try { supabaseHost = new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").host || null; } catch { /* not set */ }
    return res.json({
      measured_at: new Date().toISOString(),
      server: { ...instanceInfo(), region },
      database: { host: supabaseHost, round_trip: db },
      slowest_apis: slowestRoutes(10),
    });
  });

  // One-time job: shrink photos already in Storage. Same file path (so every saved link keeps
  // working), new small WebP content. dry_run=true only counts. Run per bucket; safe to repeat
  // (already-small files are skipped).
  router.post("/admin/maintenance/shrink-photos", async (req, res) => {
    const user = await parseAuthUser(req);
    if (!isAdmin(user)) return res.status(403).json({ error: "Admins only" });
    const client = privilegedSupabase;
    if (!client) return res.status(503).json({ error: "The server is not using the Supabase service key." });
    const bucket = String(req.body?.bucket || "");
    if (!PHOTO_BUCKETS[bucket]) return res.status(400).json({ error: `Bucket must be one of: ${Object.keys(PHOTO_BUCKETS).join(", ")}` });
    const dryRun = req.body?.dry_run !== false;
    const minBytes = 80 * 1024; // files already under 80 KB are left alone
    try {
      const files = await listAllFiles(client, bucket);
      const big = files.filter((f) => f.size > minBytes && /^image\//.test(f.type) && !/gif|svg/.test(f.type));
      const result: any = {
        bucket, dry_run: dryRun, files: files.length, to_shrink: big.length,
        bytes_before: big.reduce((s, f) => s + f.size, 0), bytes_after: 0, done: 0, failed: [] as string[],
      };
      if (dryRun) return res.json(result);
      for (const f of big) {
        try {
          const { data: blob, error } = await client.storage.from(bucket).download(f.path);
          if (error || !blob) throw new Error(error?.message || "download failed");
          const buf = Buffer.from(await blob.arrayBuffer());
          const small = await shrinkPhoto(buf, f.type, bucket);
          if (!small.shrunk) { result.bytes_after += buf.length; continue; }
          const { error: upErr } = await client.storage.from(bucket).upload(f.path, small.buffer, {
            contentType: small.contentType, upsert: true, cacheControl: "604800",
          });
          if (upErr) throw new Error(upErr.message);
          result.bytes_after += small.buffer.length;
          result.done++;
        } catch (e: any) {
          result.failed.push(`${f.path}: ${e?.message || e}`);
          result.bytes_after += f.size;
        }
      }
      return res.json(result);
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });
}
