// Session 58 (Ravi: chat violations "Warn" / "Restrict" should really do something). No new table: the admin's action
// is written to user_violations (Warning / CHAT_RESTRICTED / CHAT_UNRESTRICTED) and the chat send route checks the
// latest restrict / unrestrict row. A restriction lasts CHAT_BLOCK_DAYS days unless an admin lifts it earlier.
export const CHAT_BLOCK_DAYS = 7;
export const CHAT_BLOCK_TYPES = ["CHAT_RESTRICTED", "CHAT_UNRESTRICTED", "CHAT_AUTO_PAUSED"];

/** rows = this user's violations → the time the chat block ends, or null when they may chat. */
export function chatBlockedUntil(rows: any[], now = Date.now()): string | null {
  const last = (rows || [])
    .filter((r) => CHAT_BLOCK_TYPES.includes(String(r?.violation_type || "").toUpperCase()))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  const type = String(last?.violation_type || "").toUpperCase();
  if (!last || (type !== "CHAT_RESTRICTED" && type !== "CHAT_AUTO_PAUSED")) return null;
  // v483: an automatic pause carries its length in the reason ("[3h] …"); an admin restriction is CHAT_BLOCK_DAYS days
  const hours = type === "CHAT_AUTO_PAUSED" ? Number(String(last.reason || "").match(/^\[(\d+)h\]/)?.[1] || AUTO_PAUSE_HOURS[0]) : CHAT_BLOCK_DAYS * 24;
  const end = Date.parse(last.created_at || "") + hours * 36e5;
  return Number.isFinite(end) && end > now ? new Date(end).toISOString() : null;
}

const cache = new Map<string, { at: number; until: string | null }>();
export const forgetChatBlock = (userId: string) => cache.delete(String(userId));

/** Looks the user up (60 s cache). Fails open: a database hiccup never blocks a normal chat. */
export async function chatBlockFor(client: any, localRows: any[], userId: string): Promise<string | null> {
  const key = String(userId || "");
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60e3) return hit.until;
  let rows: any[] = (localRows || []).filter((r) => String(r?.user_id) === key);
  if (client) {
    try {
      const { data, error } = await client.from("user_violations").select("violation_type, created_at, reason").eq("user_id", key)
        .in("violation_type", CHAT_BLOCK_TYPES).order("created_at", { ascending: false }).limit(5);
      if (!error && Array.isArray(data)) rows = rows.concat(data);
    } catch { /* fail open */ }
  }
  const until = chatBlockedUntil(rows);
  const last = rows.filter((r) => CHAT_BLOCK_TYPES.includes(String(r?.violation_type || "").toUpperCase())).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  reasons.set(key, until && String(last?.violation_type).toUpperCase() === "CHAT_AUTO_PAUSED" ? String(last.reason || "").replace(/^\[\d+h\]\s*/, "") : null);
  cache.set(key, { at: Date.now(), until });
  return until;
}
const reasons = new Map<string, string | null>();
/** v483: why the chat is paused (automatic pauses only), for the message the sender sees. */
export const chatBlockReason = (userId: string) => reasons.get(String(userId || "")) || null;

// ───────── v483 strike system (Ravi, 25 Nov: "admin ke paas jaye, reason ke saath, pehli baar sirf 3 ghante") ─────────
// 3 blocked messages within 24 h → the chat pauses (1st time 3 h, after that 24 h), the person is told why, and the
// admin team gets it in Chat violations + a bell note. A threat counts as 3 at once. Admins can still Lift it any time.
export const STRIKE_LIMIT = 3;
export const STRIKE_WINDOW_MS = 24 * 36e5;
export const AUTO_PAUSE_HOURS = [3, 24];
const THREAT_CODES = ["THREAT"];

export function strikeReasonText(codes: string[]): string {
  const c = codes.map((x) => String(x || "").toUpperCase());
  if (c.some((x) => THREAT_CODES.includes(x))) return "a threatening message";
  if (c.some((x) => /HARASS|ABUSE|PROFAN/.test(x))) return "abusive messages";
  if (c.some((x) => /OFF_PLATFORM|PAY_OUTSIDE|UPI/.test(x))) return "trying to take the deal or payment outside Ybex";
  return "trying to share a phone number or contact details";
}

/** Pure: given this sender's blocked events in the window and how many auto pauses they already had → pause or not. */
export function strikeDecision(codesInWindow: string[], priorAutoPauses: number): { pause: boolean; hours: number; reason: string } {
  const weight = codesInWindow.reduce((n, c) => n + (THREAT_CODES.includes(String(c).toUpperCase()) ? STRIKE_LIMIT : 1), 0);
  const hours = AUTO_PAUSE_HOURS[Math.min(priorAutoPauses, AUTO_PAUSE_HOURS.length - 1)];
  return { pause: weight >= STRIKE_LIMIT, hours, reason: strikeReasonText(codesInWindow) };
}

/** Call after a blocked message was recorded. Returns the pause it applied, or null. Never throws. */
export async function strikeAfterBlock(client: any, userId: string, threadId: string | null): Promise<{ until: string; hours: number; reason: string } | null> {
  const uid = String(userId || "");
  if (!client || !uid) return null;
  try {
    const since = new Date(Date.now() - STRIKE_WINDOW_MS).toISOString();
    const { data: past } = await client.from("user_violations").select("violation_type, created_at").eq("user_id", uid).eq("violation_type", "CHAT_AUTO_PAUSED").order("created_at", { ascending: false }).limit(20);
    const pauses: any[] = Array.isArray(past) ? past : [];
    const lastPause = pauses[0]?.created_at && pauses[0].created_at > since ? pauses[0].created_at : since; // strikes after the last pause only
    const { data: ev } = await client.from("chat_moderation_events").select("code, created_at").eq("sender_id", uid).eq("blocked", true).gt("created_at", lastPause).limit(50);
    const codes = (Array.isArray(ev) ? ev : []).map((e: any) => String(e.code || "")).filter((c) => !/AUTO_PAUSED|PROFANITY_FLAGGED/.test(c));
    const d = strikeDecision(codes, pauses.length);
    if (!d.pause) return null;
    const now = new Date().toISOString();
    // user_violations.id is a uuid with a default — a "viol_…" id made every insert fail
    const row = { user_id: uid, violation_type: "CHAT_AUTO_PAUSED", reason: `[${d.hours}h] ${d.reason}`, thread_id: threadId, created_at: now };
    const { error } = await client.from("user_violations").insert(row);
    if (error) return null;
    forgetChatBlock(uid);
    const until = new Date(Date.parse(now) + d.hours * 36e5).toISOString();
    const time = new Date(until).toLocaleString("en-IN", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    // the person: bell note with the reason
    const nid = `notif_${Math.random().toString(36).slice(2, 11)}`;
    await client.from("notifications").insert({ notif_id: nid, id: nid, user_id: uid, type: "WARNING", title: `Chat paused for ${d.hours} hours`,
      message: `Your chat is paused till ${time} for ${d.reason}. Please keep all talk and payments on Ybex.`, read: false, created_at: now }).then(() => null, () => null);
    // the admin team: a line in Chat violations + a bell note for every admin
    await client.from("chat_moderation_events").insert({ id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, thread_id: threadId, sender_id: uid, code: "AUTO_PAUSED",
      content: `Chat auto-paused for ${d.hours} hours`, reason: `Auto-paused ${d.hours}h after ${codes.length} blocked message${codes.length === 1 ? "" : "s"}: ${d.reason}`, matched: null, blocked: true, status: "OPEN", created_at: now }).then(() => null, () => null);
    const { data: admins } = await client.from("users").select("user_id").eq("role", "admin").limit(20);
    for (const a of Array.isArray(admins) ? admins : []) {
      const aid = `notif_${Math.random().toString(36).slice(2, 11)}`;
      await client.from("notifications").insert({ notif_id: aid, id: aid, user_id: a.user_id, type: "ADMIN_ALERT", title: "Chat auto-paused",
        message: `A user's chat was paused for ${d.hours}h for ${d.reason}. Check Support → Chat moderation.`, link: "/admin?tab=support&view=chat", read: false, created_at: now }).then(() => null, () => null);
    }
    return { until, hours: d.hours, reason: d.reason };
  } catch {
    return null;
  }
}

/** The note the user gets for each admin action. */
export function chatActionNotice(action: string, note: string, until: string | null) {
  const extra = note ? ` Note from the team: "${note}".` : "";
  if (action === "issue_warning") return { title: "Warning from Ybex", message: `Please follow the chat rules — be respectful and keep payments and contact details on Ybex.${extra}` };
  if (action === "restrict_user") {
    const d = until ? new Date(until).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : `${CHAT_BLOCK_DAYS} days`;
    return { title: "Your chat is paused", message: `You can't send chat messages until ${d} because of a chat-rule violation.${extra}` };
  }
  return { title: "Your chat is back on", message: "A Ybex admin lifted your chat pause — you can send messages again." };
}


/** v483: save one blocked message to chat_moderation_events (the app-side blocks reported by the client). */
export async function recordChatBlock(client: any, ev: { threadId: string | null; senderId: string; senderRole: string | null; code: string; reason: string; matched: string | null; content: string }) {
  if (!client) return;
  const id = (globalThis as any).crypto?.randomUUID ? (globalThis as any).crypto.randomUUID() : `mod_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const { error } = await client.from("chat_moderation_events").insert({ id, thread_id: ev.threadId, sender_id: ev.senderId, sender_role: ev.senderRole, code: String(ev.code).slice(0, 60),
    reason: String(ev.reason || "").slice(0, 120), matched: ev.matched ? String(ev.matched).slice(0, 200) : null, content: String(ev.content || "").slice(0, 500), blocked: true, status: "OPEN", created_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
