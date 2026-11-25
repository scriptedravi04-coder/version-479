// Session 46 (Ravi): data for the Admin Overview "Growth Command Center".
//
//   GET  /api/admin/growth          → the whole report (numbers come from backend/adminGrowth.ts)
//   POST /api/admin/growth/nudge    → send a real reminder (bell + email) to a group the report found
//
// Read-only except the reminder. No new table or column: it only reads tables that already exist
// and falls back to fewer columns when a column is missing on an older database. Reads use the
// service-role client (the browser's own client cannot see other people's rows).
import express from "express";
import crypto from "crypto";
import { isSubAdmin } from "./adminPermissions";
import { safePromiseTimeout } from "./helpers";
import { fetchAllRows } from "./adminMoney";
import { buildGrowthReport, nudgeTargets, type GrowthRaw, type NudgeKind,
  classifyAttempt, paidLater, attemptSummary, reminderDueAt, reminderText, reminderLink, REMINDER_STEPS, type Attempt } from "./adminGrowth";
import { getRazorpay } from "./helpers";
import { pushToUsersNow } from "./push_routes";
import { checkComprehensiveDisallowedContent, splitNumberAcrossMessages } from "./contactSecurityFilter";
import { checkAbusiveContent } from "./abuseFilter";
import { strikeAfterBlock, recordChatBlock } from "./chatRestriction";
import { isRealVerificationRow, resolveKycStatus } from "./creatorKyc";
import { ephemeralGet, ephemeralSet, ephemeralList } from "./ephemeralStore";
import { buildBrandFunnel, countBrandSignupVisit, readBrandSignupVisits } from "./brandFunnel"; // v446

const CACHE_MS = 60 * 1000;
/** A person gets the same reminder at most once in this time. */
export const NUDGE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
/** Most reminders one click may send. */
export const NUDGE_MAX_PER_CLICK = 100;

const isStaff = (u: any) => !!u && (u.role === "admin" || u.role === "sub_admin" || u.team_role === "sub_admin");

export function setupAdminGrowthRoutes(
  router: express.Router,
  { supabase, privilegedSupabase, getDb, parseAuthUser, logAdminAction, sendNotification, checkAdminPerm }: {
    supabase: any;
    privilegedSupabase: any;
    getDb: () => any;
    parseAuthUser: (req: express.Request) => Promise<any>;
    logAdminAction: (user: any, action: any, targetType: any, targetId: any, detail: any) => Promise<any>;
    sendNotification: (db: any, userId: string, type: string, message: string) => Promise<any>;
    checkAdminPerm: (user: any, perm: string) => Promise<boolean>;
  }
) {
  const sb = () => privilegedSupabase || supabase;
  let cache: { at: number; raw: GrowthRaw } | null = null;

  /** Read one table, trying the column lists in order. null = the table could not be read at all. */
  async function grab(table: string, columnSets: string[]): Promise<any[] | null> {
    for (const cols of columnSets) {
      const r: any = await safePromiseTimeout(
        fetchAllRows((f, t) => sb().from(table).select(cols).range(f, t)),
        30000,
        { data: [], error: { message: "timeout" } } as any
      ).catch(() => ({ data: [], error: { message: "failed" } }));
      if (!r?.error) return r?.data || [];
    }
    return null;
  }

  async function loadRaw(force: boolean): Promise<GrowthRaw> {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.raw;

    let raw: GrowthRaw;
    if (supabase) {
      const [users, creators, brands, campaigns, applications, deals, transactions, ugcOrders, sessions, referrals, creatorKyc, verifications] = await Promise.all([
        grab("users", ["user_id, role, created_at, name, email, phone, signup_source", "user_id, role, created_at, name, email, phone", "user_id, role, created_at, name, email", "user_id, role, created_at"]),
        grab("creator_profiles", ["user_id, name, city, state, niche, primary_niche, rate_card, created_at", "user_id, name, city, state, niche, rate_card, created_at", "user_id, name, city, state, niche, rate_card", "user_id, name, city, state, rate_card", "*"]),
        grab("brand_profiles", ["user_id, company_name, city, state, is_agency, created_at", "user_id, company_name, city, state, created_at", "*"]),
        grab("campaigns", ["campaign_id, brand_user_id, brand_name, title, status, categories, budget_max, created_at", "*"]),
        grab("campaign_applications", ["application_id, campaign_id, creator_id, status, created_at", "application_id, campaign_id, creator_id, status", "*"]),
        grab("deals", ["id, application_id, campaign_id, creator_id, brand_id, agreed_amount, status, created_at, updated_at", "id, application_id, campaign_id, creator_id, brand_id, agreed_amount, status", "*"]),
        grab("transactions", [
          "id, deal_id, ugc_order_id, creator_id, brand_id, zaakpay_order_id, razorpay_payment_id, gross_amount, platform_fee_amount, creator_net_amount, status, payout_status, payout_reference, refund_status, payout_requested, payout_completed_at, created_at",
          "id, deal_id, ugc_order_id, creator_id, gross_amount, platform_fee_amount, creator_net_amount, status, payout_status, payout_reference, refund_status, payout_requested, payout_completed_at, created_at",
          "id, deal_id, ugc_order_id, creator_id, gross_amount, platform_fee_amount, creator_net_amount, status, payout_status, payout_reference, refund_status, payout_completed_at, created_at",
          "id, deal_id, ugc_order_id, creator_id, gross_amount, platform_fee_amount, creator_net_amount, status, payout_status, payout_reference, refund_status, created_at",
          "*",
        ]),
        grab("ugc_orders", ["id, brand_id", "*"]),
        grab("user_sessions", ["user_id, created_at, last_active", "user_id, created_at", "*"]),
        grab("referrals", ["referrer_id, referred_id, status, created_at", "*"]),
        grab("creator_kyc", ["creator_id, status"]),
        grab("verifications", ["user_id, status, note, documents, created_at", "user_id, status, created_at"]),
      ]);

      // One KYC answer per creator, by the same rule the rest of the app uses (creatorKyc.ts).
      const ckBy = new Map<string, any>();
      for (const k of creatorKyc || []) if (k?.creator_id) ckBy.set(k.creator_id, k);
      const vBy = new Map<string, any[]>();
      for (const v of verifications || []) {
        if (!v?.user_id) continue;
        const l = vBy.get(v.user_id) || [];
        l.push(v);
        vBy.set(v.user_id, l);
      }
      const kyc: any[] = [];
      for (const c of creators || []) {
        const rows = (vBy.get(c.user_id) || []).filter(isRealVerificationRow).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        kyc.push({ creator_id: c.user_id, status: resolveKycStatus(ckBy.get(c.user_id), rows) });
      }

      raw = {
        users: users || [], creators: creators || [], brands: brands || [], campaigns: campaigns || [],
        applications: applications || [], deals: deals || [], transactions: transactions || [],
        ugcOrders: ugcOrders || [], sessions, referrals: referrals || [], kyc,
        // Session 58: the users.signup_source column exists (it came back in the first, widest read).
        sourceTracked: Array.isArray(users) && (users.length === 0 || Object.prototype.hasOwnProperty.call(users[0], "signup_source")),
      };
    } else {
      const db = getDb() || {};
      const ckBy = new Map<string, any>();
      for (const k of db.creator_kyc || []) ckBy.set(k.creator_id || k.user_id, k);
      raw = {
        users: db.users || [], creators: db.creator_profiles || [], brands: db.brand_profiles || [], campaigns: db.campaigns || [],
        applications: db.campaign_applications || db.applications || [], deals: db.deals || [], transactions: db.transactions || [],
        ugcOrders: db.ugc_orders || [], sessions: db.user_sessions || [], referrals: db.referrals || [],
        kyc: (db.creator_profiles || []).map((c: any) => ({
          creator_id: c.user_id,
          status: resolveKycStatus(ckBy.get(c.user_id), (db.verifications || []).filter((v: any) => v.user_id === c.user_id)),
        })),
      };
    }
    cache = { at: Date.now(), raw };
    return raw;
  }

  router.get("/admin/growth", async (req, res) => {
    const user = await parseAuthUser(req);
    if (!isStaff(user)) return res.status(403).json({ detail: "Admin only", _status: 403 });
    try {
      const raw = await loadRaw(String(req.query.refresh || "") === "1");
      const report: any = buildGrowthReport(raw, new Date());
      // Session 58: brands' email / phone only for full admins (any staff member, even blog-only, could read them).
      if (isSubAdmin(user) && Array.isArray(report?.unpaidBrands)) report.unpaidBrands = report.unpaidBrands.map((b: any) => ({ ...b, email: null, phone: null }));
      return res.json(report);
    } catch (e: any) {
      console.error("[admin/growth]", e?.message || e);
      return res.status(500).json({ error: "Could not build the growth report. Try again in a moment." });
    }
  });

  // v446: brand funnel — sign-up page → account → each step → done → first brief, plus Qualified / Unverified brands.
  router.get("/admin/growth/brand-funnel", async (req, res) => {
    const user = await parseAuthUser(req);
    if (!isStaff(user)) return res.status(403).json({ detail: "Admin only", _status: 403 });
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
      const raw = await loadRaw(String(req.query.refresh || "") === "1");
      let progress: any[] = [];
      if (supabase) progress = (await grab("onboarding_progress", ["user_id, flow, page, updated_at", "*"])) || [];
      else progress = (getDb() || {}).onboarding_progress || [];
      const info = (await ephemeralList("brandinfo:", 5000).catch(() => [])).map((r: any) => ({ user_id: String(r.key).slice("brandinfo:".length), ...(r.value || {}) }));
      const visits = await readBrandSignupVisits(days);
      const out = buildBrandFunnel({ visits, users: raw.users, brands: raw.brands, progress, campaigns: raw.campaigns, ugcOrders: raw.ugcOrders, brandInfo: info, days });
      const names = new Map((raw.brands || []).map((b: any) => [String(b.user_id), b.company_name || ""]));
      return res.json({ ...out, unverifiedBrands: out.unverifiedIds.slice(0, 50).map((id) => ({ user_id: id, name: names.get(id) || "" })) });
    } catch (e: any) {
      console.error("[admin/growth/brand-funnel]", e?.message || e);
      return res.status(500).json({ error: "Could not build the brand funnel. Try again in a moment." });
    }
  });

  // v446: anonymous count of brand sign-up page opens (no login, no personal data; 1 per IP per 10 min).
  const visitSeen = new Map<string, number>();
  router.post("/funnel/brand-visit", async (req, res) => {
    const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim() || "?";
    const t = visitSeen.get(ip) || 0;
    if (Date.now() - t < 600000) return res.json({ ok: true });
    visitSeen.set(ip, Date.now());
    if (visitSeen.size > 5000) visitSeen.clear();
    await countBrandSignupVisit();
    return res.json({ ok: true });
  });

  router.post("/admin/growth/nudge", async (req, res) => {
    const user = await parseAuthUser(req);
    if (!isStaff(user)) return res.status(403).json({ detail: "Admin only", _status: 403 });
    // Writing to people needs the same permission as managing users.
    if (!(await checkAdminPerm(user, "manage_users"))) {
      return res.status(403).json({ error: "You don't have permission for this. Ask the super admin to enable it for you.", code: "ADMIN_PERMISSION_MISSING", permission: "manage_users" });
    }
    const kind = String(req.body?.kind || "") as NudgeKind;
    if (kind !== "creator_profile" && kind !== "brand_payment") return res.status(400).json({ error: "Unknown reminder type." });

    try {
      // The list is rebuilt here from the database — the browser only says which group.
      const raw = await loadRaw(true);
      const targets = nudgeTargets(raw, kind, new Date());
      let sent = 0, skipped = 0;
      const sentIds: string[] = [];
      for (const t of targets) {
        if (sent >= NUDGE_MAX_PER_CLICK) { skipped++; continue; }
        const key = `growth_nudge:${kind}:${t.user_id}`;
        let recent: any = null;
        try { recent = await ephemeralGet(key); } catch { recent = null; }
        if (recent) { skipped++; continue; }
        try {
          await sendNotification(null, t.user_id, "reminder", t.message);
          try { await ephemeralSet(key, { at: Date.now() }, NUDGE_COOLDOWN_MS); } catch { /* cooldown is best effort */ }
          sent++;
          sentIds.push(t.user_id);
        } catch (e: any) {
          skipped++;
          console.warn("[growth nudge] failed for", t.user_id, e?.message || e);
        }
      }
      await logAdminAction(user, "GROWTH_REMINDER", "USER", "bulk", { kind, sent, skipped, total: targets.length, sample: sentIds.slice(0, 20) });
      return res.json({
        success: true, sent, skipped, total: targets.length,
        message: targets.length === 0
          ? "Nobody needs this reminder right now."
          : `Reminder sent to ${sent} ${sent === 1 ? "person" : "people"}${skipped ? `; ${skipped} skipped (reminded in the last 3 days or over the limit of ${NUDGE_MAX_PER_CLICK})` : ""}.`,
      });
    } catch (e: any) {
      console.error("[admin/growth/nudge]", e?.message || e);
      return res.status(500).json({ error: "Could not send reminders. Try again in a moment." });
    }
  });

  // ───────── v481: payment attempts (Razorpay) + auto push reminders ─────────
  const REM_KEY = (orderId: string) => `payrem:${orderId}`;
  const rzpReady = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

  async function rzpAll(kind: "orders" | "payments", fromSec: number): Promise<any[]> {
    const out: any[] = [];
    const api: any = (getRazorpay() as any)[kind];
    for (let skip = 0; skip < 1000; skip += 100) {
      const page: any = await api.all({ from: fromSec, to: Math.floor(Date.now() / 1000), count: 100, skip });
      const items = Array.isArray(page?.items) ? page.items : [];
      out.push(...items);
      if (items.length < 100) break;
    }
    return out;
  }

  /** Every checkout opened since `days` ago, with who it was and what happened. */
  async function loadAttempts(days: number) {
    const fromSec = Math.floor((Date.now() - days * 86400000) / 1000);
    const [orders, payments] = await Promise.all([rzpAll("orders", fromSec), rzpAll("payments", fromSec)]);
    const list: Attempt[] = orders.map((o) => classifyAttempt(o, payments));
    const dealIds = [...new Set(list.map((a) => a.dealId).filter(Boolean))] as string[];
    const ugcIds = [...new Set(list.map((a) => a.ugcOrderId).filter(Boolean))] as string[];
    const [deals, ugc] = await Promise.all([
      dealIds.length ? sb().from("deals").select("id, brand_id, creator_id").in("id", dealIds).then((r: any) => r.data || [], () => []) : [],
      ugcIds.length ? sb().from("ugc_orders").select("id, brand_id").in("id", ugcIds).then((r: any) => r.data || [], () => []) : [],
    ]);
    const dealBy = new Map((deals as any[]).map((d) => [String(d.id), d]));
    const ugcBy = new Map((ugc as any[]).map((u) => [String(u.id), u]));
    const rows = list.map((a) => {
      const d = a.dealId ? dealBy.get(a.dealId) : null;
      const brandId = a.brandId || d?.brand_id || (a.ugcOrderId ? ugcBy.get(a.ugcOrderId)?.brand_id : null) || null;
      return { ...a, brandId: brandId ? String(brandId) : null, creatorId: d?.creator_id ? String(d.creator_id) : null, paidLater: a.status !== "paid" && paidLater(a, list) };
    });
    const brandIds = [...new Set(rows.map((r) => r.brandId).filter(Boolean))] as string[];
    const [users, brands] = await Promise.all([
      brandIds.length ? sb().from("users").select("user_id, name, phone").in("user_id", brandIds).then((r: any) => r.data || [], () => []) : [],
      brandIds.length ? sb().from("brand_profiles").select("user_id, company_name").in("user_id", brandIds).then((r: any) => r.data || [], () => []) : [],
    ]);
    const uBy = new Map((users as any[]).map((u) => [String(u.user_id), u]));
    const bBy = new Map((brands as any[]).map((b) => [String(b.user_id), b]));
    return rows.map((r) => ({
      ...r,
      brandName: (r.brandId && (bBy.get(r.brandId)?.company_name || uBy.get(r.brandId)?.name)) || null,
      phone: (r.brandId && uBy.get(r.brandId)?.phone) || null,
    }));
  }

  async function sendReminder(a: any, step: number): Promise<boolean> {
    if (!a.brandId) return false;
    const t = reminderText(a, step);
    const r = await pushToUsersNow([a.brandId], { ...t, url: reminderLink(a, a.creatorId), tag: `payrem-${a.orderId}` });
    await ephemeralSet(REM_KEY(a.orderId), { sent: step, lastAt: Date.now() }, 4 * 86400000).catch(() => {});
    return r != null;
  }

  router.get("/admin/payment-attempts", async (req, res) => {
    const user = await parseAuthUser(req);
    if (!isStaff(user)) return res.status(403).json({ detail: "Admin only", _status: 403 });
    if (!rzpReady()) return res.json({ available: false, reason: "Razorpay keys are not set on the server." });
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    try {
      const rows = await loadAttempts(days);
      const marks = await Promise.all(rows.map((r) => r.status === "paid" ? null : ephemeralGet(REM_KEY(r.orderId)).catch(() => null)));
      const list = rows.map((r, i) => {
        const m: any = marks[i] || {};
        const sent = Number(m.sent) || 0;
        const next = r.status === "paid" || r.paidLater || !r.brandId || sent >= REMINDER_STEPS ? null : reminderDueAt(Date.parse(r.createdAt), sent + 1, Number(m.lastAt) || 0);
        return { ...r, phone: isSubAdmin(user) ? null : r.phone, remindersSent: sent, nextReminderAt: next ? new Date(next).toISOString() : null };
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return res.json({ available: true, days, summary: attemptSummary(rows.filter((r) => !r.paidLater)), recovered: rows.filter((r) => r.paidLater).length, list: list.slice(0, 300) });
    } catch (e: any) {
      console.error("[admin/payment-attempts]", e?.message || e);
      return res.status(502).json({ error: "Couldn't read payments from Razorpay. Try again in a minute." });
    }
  });

  router.post("/admin/payment-attempts/:orderId/remind", async (req, res) => {
    const user = await parseAuthUser(req);
    if (!isStaff(user)) return res.status(403).json({ detail: "Admin only", _status: 403 });
    if (!rzpReady()) return res.status(400).json({ error: "Razorpay keys are not set." });
    try {
      const rows = await loadAttempts(30);
      const a = rows.find((r) => r.orderId === req.params.orderId);
      if (!a) return res.status(404).json({ error: "This payment wasn't found." });
      if (a.status === "paid" || a.paidLater) return res.status(400).json({ error: "Already paid — no reminder needed." });
      if (!a.brandId) return res.status(400).json({ error: "Couldn't find which brand this was." });
      const m: any = (await ephemeralGet(REM_KEY(a.orderId)).catch(() => null)) || {};
      const step = Math.min(REMINDER_STEPS, (Number(m.sent) || 0) + 1);
      const ok = await sendReminder(a, step);
      await logAdminAction(user, "payment_reminder", "razorpay_order", a.orderId, { step }).catch(() => {});
      return res.json({ ok: true, delivered: ok, step });
    } catch (e: any) {
      console.error("[admin/payment-attempts/remind]", e?.message || e);
      return res.status(500).json({ error: "Couldn't send the reminder. Try again." });
    }
  });

  // Auto reminders: 2 min, 3 h, next day 7 pm (IST), quiet 22:00–09:00, max 3, stop once paid.
  // Off in tests and when PAYMENT_REMINDERS=off.
  let remBusy = false;
  async function reminderTick() {
    if (remBusy || !rzpReady()) return;
    remBusy = true;
    try {
      const rows = await loadAttempts(2);
      const now = Date.now();
      for (const a of rows) {
        if (a.status === "paid" || a.paidLater || !a.brandId || a.amount <= 0) continue;
        const m: any = (await ephemeralGet(REM_KEY(a.orderId)).catch(() => null)) || {};
        const sent = Number(m.sent) || 0;
        if (sent >= REMINDER_STEPS) continue;
        const due = reminderDueAt(Date.parse(a.createdAt), sent + 1, Number(m.lastAt) || 0);
        if (due == null || due > now) continue;
        // A step that is very late (server was down, or quiet hours rolled it) is skipped forward, never sent twice.
        await sendReminder(a, sent + 1);
      }
    } catch (e: any) {
      console.error("[payment-reminders]", e?.message || e);
    } finally { remBusy = false; }
  }
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST && process.env.PAYMENT_REMINDERS !== "off") {
    const timer: any = setInterval(() => { reminderTick(); }, 60000);
    timer.unref?.();
  }

  // v482 (admin UX pass): names for the UGC orders table. /admin/ugc/orders (a locked file) sends bare rows, so the admin
  // saw a blank brand, "Assigned Creator" and ₹0. Read-only labels keyed by order id.
  router.get("/admin/ugc/order-labels", async (req, res) => {
    const user = await parseAuthUser(req);
    if (!isStaff(user)) return res.status(403).json({ detail: "Admin only", _status: 403 });
    try {
      const { data: orders } = await sb().from("ugc_orders").select("id, brief_id, brand_id, creator_id, agreed_amount, creator_payout, escrow_amount").order("created_at", { ascending: false }).limit(1000);
      const list: any[] = orders || [];
      const ids = (k: string) => [...new Set(list.map((o) => o[k]).filter(Boolean).map(String))];
      const [briefs, brands, creators, users] = await Promise.all([
        ids("brief_id").length ? sb().from("ugc_briefs").select("id, title, product_name, brand_name, brand_id").in("id", ids("brief_id")).then((r: any) => r.data || [], () => []) : [],
        ids("brand_id").length ? sb().from("brand_profiles").select("user_id, company_name, logo").in("user_id", ids("brand_id")).then((r: any) => r.data || [], () => []) : [],
        ids("creator_id").length ? sb().from("creator_profiles").select("user_id, name").in("user_id", ids("creator_id")).then((r: any) => r.data || [], () => []) : [],
        [...ids("brand_id"), ...ids("creator_id")].length ? sb().from("users").select("user_id, name").in("user_id", [...ids("brand_id"), ...ids("creator_id")]).then((r: any) => r.data || [], () => []) : [],
      ]);
      const by = (rows: any[], k: string) => new Map((rows as any[]).map((r) => [String(r[k]), r]));
      const B = by(briefs as any[], "id"), BP = by(brands as any[], "user_id"), CP = by(creators as any[], "user_id"), U = by(users as any[], "user_id");
      const labels: Record<string, any> = {};
      for (const o of list) {
        const b: any = B.get(String(o.brief_id)) || {};
        const bp: any = BP.get(String(o.brand_id || b.brand_id)) || {};
        labels[o.id] = {
          brand_name: bp.company_name || b.brand_name || U.get(String(o.brand_id))?.name || null,
          brand_logo: bp.logo || null,
          product_name: b.product_name || null,
          title: b.title || null,
          creator_name: CP.get(String(o.creator_id))?.name || U.get(String(o.creator_id))?.name || null,
          budget: Number(o.agreed_amount) || Number(o.creator_payout) || Number(o.escrow_amount) || 0,
        };
      }
      return res.json({ labels });
    } catch (e: any) {
      console.error("[admin/ugc/order-labels]", e?.message || e);
      return res.json({ labels: {} });
    }
  });

  // v483: the app blocks most messages before they reach the server, so nothing was ever recorded
  // (chat_moderation_events had 0 rows) and strikes could not count. The app now reports each block here.
  // The text is checked again on the server; only a real block is recorded, and only against the sender.
  const blockHits = new Map<string, number[]>();
  router.post("/chat/blocked-attempt", async (req, res) => {
    const user = await parseAuthUser(req);
    if (!user?.user_id) return res.status(401).json({ detail: "Sign in" });
    const uid = String(user.user_id);
    const now = Date.now();
    const hits = (blockHits.get(uid) || []).filter((t) => now - t < 60000);
    if (hits.length >= 10) return res.status(429).json({ ok: false });
    hits.push(now); blockHits.set(uid, hits);
    const text = String(req.body?.text || "").slice(0, 2000);
    const kind = String(req.body?.kind || "");
    const threadId = req.body?.thread_id ? String(req.body.thread_id).slice(0, 120) : null;
    if (!text.trim()) return res.json({ ok: false });
    const abuse = checkAbusiveContent(text);
    const leak = abuse.blocked ? { blocked: false } as any : checkComprehensiveDisallowedContent(text);
    const prev = Array.isArray(req.body?.previous) ? req.body.previous.slice(-12).map((p: any) => String(p).slice(0, 500)) : [];
    const split = !abuse.blocked && !leak.blocked && kind === "split" && splitNumberAcrossMessages(text, prev);
    if (!abuse.blocked && !leak.blocked && !split) return res.json({ ok: false });
    const code = abuse.blocked ? (abuse.code || "ABUSE") : leak.blocked ? (leak.code || "CONTACT_INFO_BLOCKED") : "PHONE_SPLIT";
    try {
      await recordChatBlock(sb(), { threadId, senderId: uid, senderRole: user.role || null, code, reason: abuse.blocked ? (abuse.severity || "harassment") : "contact_leak", matched: abuse.matched || null, content: text });
      const pause = await strikeAfterBlock(sb(), uid, threadId);
      return res.json({ ok: true, paused: pause ? { until: pause.until, hours: pause.hours, reason: pause.reason } : null });
    } catch (e: any) {
      console.warn("[chat/blocked-attempt]", e?.message || e);
      return res.json({ ok: false });
    }
  });
}
