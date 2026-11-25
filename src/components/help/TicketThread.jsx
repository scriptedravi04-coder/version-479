import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import useBusy from "../../lib/useBusy";
import ButtonSpinner from "../common/ButtonSpinner";
import { EvaFace, EVA_KEYFRAMES, moodFor } from "../feedback/evaUi"; // v486: Eva's face on her replies

// Session 33: this was a stub (title only) and desktop passed `ticket`/`onBack` while it read
// `ticketId`/`onClose` — the panel showed nothing and its Close did nothing. It now reads the
// ticket's messages from GET /support/tickets/:id/messages (owner or staff only).
// Session 34 (Ravi): the owner can reply here (POST /support/tickets/:id/messages). A reply on a
// resolved ticket opens it again; a closed ticket takes no replies.
export default function TicketThread({ ticket, ticketId, onBack, onClose }) {
  const id = ticketId || ticket?.ticket_id || ticket?.id;
  const close = onBack || onClose;
  const [messages, setMessages] = useState(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState(ticket?.status || "");
  const { isBusy, anyBusy, run } = useBusy();
  const closed = String(status).toUpperCase() === "CLOSED";
  const resolved = String(status).toUpperCase() === "RESOLVED";
  const endRef = useRef(null);
  const lastCount = useRef(0);
  // v425 (T2): bring the newest message into view when it arrives.
  useEffect(() => {
    const n = messages?.length || 0;
    if (n > lastCount.current) endRef.current?.scrollIntoView?.({ block: "end", behavior: lastCount.current ? "smooth" : "auto" });
    lastCount.current = n;
  }, [messages]);
  useEffect(() => { lastCount.current = 0; }, [id]);
  const desktop = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches;
  useEffect(() => { setStatus(ticket?.status || ""); setDraft(""); }, [id, ticket?.status]);

  const sendReply = () => run("reply", async () => {
    const text = draft.trim();
    if (!text || !id) return;
    try {
      const { data } = await api.post(`/support/tickets/${id}/messages`, { message: text });
      if (data?.data) setMessages((m) => [...(m || []), data.data]);
      if (data?.status) setStatus(data.status);
      setDraft("");
    } catch (e) {
      const err = e?.response?.data;
      if (err?.code === "TICKET_CLOSED") setStatus("CLOSED");
      toast.error(err?.error || "Could not send your reply. Please try again.");
    }
  });

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () => api.get(`/support/tickets/${id}/messages`, { bypassCache: true })
      .then(({ data }) => { if (alive) { setMessages(Array.isArray(data) ? data : []); setFailed(false); } })
      .catch(() => { if (alive) { setMessages((m) => m || []); setFailed(true); } });
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [id]);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-col min-h-[320px]" data-testid="ticket-thread">
      <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
        {close && <button type="button" onClick={close} aria-label="Back" className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0"><ChevronLeft size={18} /></button>}
        <div className="min-w-0">
          <div className="font-bold text-gray-900 text-sm truncate">{ticket?.subject || "Support ticket"}</div>
          <div className="text-xs text-[#5F6672]">{status ? `${String(status).replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())} · ` : ""}#{String(id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() /* v415: short code */}</div>
        </div>
      </div>
      <div className="flex-1 py-3 flex flex-col gap-2.5">
        <style>{EVA_KEYFRAMES}</style>
        {messages === null && <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Loading messages"><div className="h-12 w-2/3 rounded-2xl bg-gray-100" /><div className="h-12 w-1/2 rounded-2xl bg-gray-100 ml-auto" /></div>}{/* v415: skeleton instead of a word */}
        {failed && !(messages && messages.length) && <div className="text-sm text-red-600" role="alert">Couldn't load the messages. We'll try again shortly.</div>}
        {failed && messages && messages.length > 0 && <div className="text-xs text-[#5F6672]" role="status" data-testid="ticket-offline">Offline. Retrying…</div>}{/* v425 (T3): keep the thread, just say we're retrying */}
        {messages && messages.length === 0 && !failed && <div className="text-sm text-[#5F6672]">No messages yet.</div>}
        {(messages || []).map((m) => {
          const staff = m.sender_type === "admin" || m.sender_type === "ai"; // v483: Eva's first reply is from Ybex, not the user
          const bubble = (
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${staff ? "bg-gray-100 text-gray-900" : "self-end bg-[#7C3AED] text-white"}`}>
              {staff && <div className="text-[11px] font-semibold text-[#7C3AED] mb-0.5">{m.sender_type === "ai" ? "Eva · Ybex Support" : "Ybex Support"}</div>}
              {m.message}
              {m.created_at && <div className={`mt-1 text-[10.5px] ${staff ? "text-[#5F6672]" : "text-white/70"}`}>{new Date(m.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).replace(/\b(am|pm)\b/g, (s) => s.toUpperCase()) /* v330: IST, readable */}</div>}
            </div>
          );
          if (!staff) return <React.Fragment key={m.message_id || m.id || m.created_at}>{bubble}</React.Fragment>;
          // v486 (Ravi): the sender's face before the message — Eva's own face on her replies, a Ybex mark on the team's
          return (
            <div key={m.message_id || m.id || m.created_at} className="self-start flex items-end gap-2 max-w-full" data-testid={m.sender_type === "ai" ? "eva-ticket-reply" : "staff-ticket-reply"}>
              {m.sender_type === "ai"
                ? <span className="shrink-0 mb-0.5"><EvaFace size={28} mood={moodFor(m.message)} glow={false} /></span>
                : <span className="shrink-0 mb-0.5 w-7 h-7 rounded-full bg-[#7C3AED] text-white text-[11px] font-extrabold flex items-center justify-center" aria-hidden="true">Y</span>}
              {bubble}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {closed ? (
        <div className="pt-3 border-t border-gray-100 text-xs text-[#5F6672]">This ticket is closed. To ask something new, send a new ticket.</div>
      ) : (
        <div className="pt-3 border-t border-gray-100">
        {resolved && <div className="pb-2 text-xs text-[#5F6672]" data-testid="ticket-reopen-note">Replying will reopen this ticket.</div>}{/* v425 (T4) */}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent?.isComposing && (desktop || e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }} /* v425 (T6): Enter sends on desktop, Shift+Enter = new line */
            placeholder="Write a reply…"
            rows={2}
            aria-label="Reply"
            data-testid="ticket-reply-input"
            className="flex-1 min-w-0 resize-none rounded-xl border border-gray-200 px-3 py-2 text-base sm:text-sm outline-none focus:border-[#7C3AED]" /* v332: 16px on phones (no iPhone zoom) */
          />
          <button
            type="button"
            onClick={sendReply}
            disabled={anyBusy || !draft.trim()}
            data-testid="ticket-reply-send"
            className="h-10 px-4 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            {isBusy("reply") ? <ButtonSpinner label="Sending..." /> : <><Send size={15} /> Send</>}
          </button>
        </div>
        </div>
      )}
    </div>
  );
}
