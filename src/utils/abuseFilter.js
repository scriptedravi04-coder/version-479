// Frontend access to the abuse filter.
//
// A re-export, not a copy — the client and server must never be able to disagree about what
// counts as abusive. This exists purely so the user gets feedback without a round-trip; the
// enforcement point is backend/chat_routes.ts.
import * as core from "../../backend/abuseFilter";
import { api } from "../lib/api";
import { toast } from "sonner";

export * from "../../backend/abuseFilter";
export { default } from "../../backend/abuseFilter";

// v483: blocks made in the app are reported to the server (fire-and-forget) so Admin → Chat moderation sees
// them and the strike system can count them. The server re-checks the text; a report can only ever count
// against the person sending it.
let lastThreadId = null;
const recent = new Map();
export const noteChatThread = (id) => { if (id) lastThreadId = String(id); };
export function reportChatBlock({ text, threadId, kind, previous }) {
  try {
    if (threadId) lastThreadId = String(threadId);
    if (typeof window === "undefined" || import.meta.env?.MODE === "test") return;
    const key = `${kind}|${String(text).slice(0, 200)}`;
    const now = Date.now();
    if (now - (recent.get(key) || 0) < 15000) return; // same block twice in a row (re-render, double tap)
    recent.set(key, now);
    if (recent.size > 50) recent.clear();
    api.post("chat/blocked-attempt", { thread_id: threadId || lastThreadId, text: String(text).slice(0, 2000), kind, previous: Array.isArray(previous) ? previous.slice(-12).map((p) => String(p).slice(0, 500)) : undefined }).then((r) => {
      const p = r?.data?.paused;
      if (p) toast.error(`Your chat is paused for ${p.hours} hours for ${p.reason}.`, { duration: 8000 });
    }).catch(() => {});
  } catch { /* never break sending */ }
}

export function checkAbusiveContent(text, ...rest) {
  const r = core.checkAbusiveContent(text, ...rest);
  if (r?.blocked) reportChatBlock({ text, kind: "abuse" });
  return r;
}
