import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CreditCard, FileText, Shield, HelpCircle, ChevronRight, MessageSquare, Ticket } from "lucide-react";
import { supabase } from "../../../../lib/supabase";
import { api } from "../../../../lib/api";
import TicketForm from "../../../help/TicketForm";
import { SUPPORT_EMAIL, openWhatsAppHelp } from "../../../help/SupportContactCard"; // v451: WhatsApp asks first (§16)
import { MobileScreen, Section, Card } from "./brandMobileUi";

import { Presence } from "../../../common/Popup";
// Screen 1k — help centre. FAQs come from the same Supabase faq_articles table
// HelpCenter.jsx reads (filtered to brand + shared articles), and the ticket count
// comes from GET support/my-tickets. Categories route into the existing
// /help/category pages.

// v451 (Ravi's BRD §8c): ONE Help page — search, your open ticket, top questions, 4 topics (one name each) and
// "Still stuck?". Legal / Delete account / Blocked people live in Brand › Legal & account.
const CATEGORIES = [
  { id: "payments", name: "Payments", icon: CreditCard },
  { id: "campaigns", name: "Campaigns & UGC", icon: FileText },
  { id: "kyc", name: "Profile & verification", icon: HelpCircle }, // brand screens say "verification", not KYC (v415)
  { id: "trust_safety", name: "Trust & safety", icon: Shield },
];
const ago = (iso) => { const t = Date.parse(iso || ""); if (!Number.isFinite(t)) return ""; const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export default function HelpScreen({ onBack }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [faqs, setFaqs] = useState([]);
  const [faqsLoading, setFaqsLoading] = useState(Boolean(supabase));
  const [tickets, setTickets] = useState(null);
  const [ticketFormOpen, setTicketFormOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabase) return;
      try {
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000));
        const { data } = await Promise.race([timeout, supabase.from("faq_articles").select("*").eq("is_active", true).in("target_role", ["brand", "both"]).order("view_count", { ascending: false }).limit(5)]);
        if (!cancelled && Array.isArray(data)) setFaqs(data);
      } catch (e) { console.warn("Failed to load FAQs:", e); }
      finally { if (!cancelled) setFaqsLoading(false); }
    })();
    (async () => {
      try {
        const { data } = await api.get("support/my-tickets").catch(() => ({ data: null }));
        if (!cancelled && Array.isArray(data)) setTickets(data);
      } catch (e) { console.warn("Failed to load tickets:", e); }
    })();
    return () => { cancelled = true; };
  }, []);

  const runSearch = () => { if (query.trim()) navigate(`/help/category/search?q=${encodeURIComponent(query.trim())}`); };
  const open = (tickets || []).find((t) => !/closed|resolved/i.test(String(t.status || "")));
  const openStatus = open ? (/repl|answer|waiting_user|admin/i.test(String(open.status || "")) || open.last_reply_by === "admin" ? `Replied ${ago(open.updated_at)}` : `Sent ${ago(open.created_at)}`) : "";

  return (
    <MobileScreen title="Help" onBack={onBack}>
      <Section>
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#5F6672]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search help" aria-label="Search help" enterKeyHint="search"
            className="w-full h-11 rounded-xl border border-gray-200 bg-[var(--bg-elevated)] pl-10 pr-3.5 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#7C3AED] focus:bg-white" />
        </div>
        {open && (
          <button type="button" onClick={() => navigate("/help/tickets")} data-testid="help-open-ticket"
            className="mt-3 w-full rounded-2xl border border-[#D9C8FB] bg-[#F7F3FF] px-4 py-3 flex items-center gap-3 text-left active:bg-[#F1EBFE]">
            <Ticket size={17} className="text-[#7C3AED] shrink-0" />
            <span className="flex-1 min-w-0 text-[13.5px] text-[#0A0A0A] truncate"><b>Your ticket</b> · {open.category || open.subject || "Support"}{openStatus ? ` · ${openStatus}` : ""}</span>
            <ChevronRight size={15} className="text-[#7C3AED] shrink-0" />
          </button>
        )}
      </Section>

      {faqsLoading && faqs.length === 0 && (
        <Section title="Top questions" className="pt-0">
          <div aria-busy="true" aria-label="Loading articles" className="rounded-2xl bg-white border border-slate-100 overflow-hidden">
            {[0, 1, 2].map((i) => <div key={i} className={`px-4 py-3.5 ${i < 2 ? "border-b border-gray-100" : ""}`}><div className="h-3.5 w-3/4 rounded bg-gray-100 animate-pulse" /></div>)}
          </div>
        </Section>
      )}
      {faqs.length > 0 && (
        <Section title="Top questions" className="pt-0">
          <Card>
            {faqs.map((f, idx) => (
              <button type="button" key={f.id || idx} onClick={() => navigate(`/help/category/${f.category || "payments"}?article=${f.id}`)}
                className={`w-full px-4 py-3.5 flex items-center gap-2 text-left hover:bg-[var(--bg-elevated)] active:bg-[#F5F0FF] ${idx !== faqs.length - 1 ? "border-b border-gray-100" : ""}`}>
                <span className="flex-1 text-sm text-gray-900">{f.title || f.question}</span>
                <ChevronRight size={14} className="text-[#5F6672] flex-shrink-0" aria-hidden="true" />
              </button>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Browse by topic" className="pt-0">
        <Card>
          {CATEGORIES.map((c, idx) => (
            <button type="button" key={c.id} onClick={() => navigate(`/help/category/${c.id}`)} data-testid={`help-topic-${c.id}`}
              className={`w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-[var(--bg-elevated)] active:bg-[#F5F0FF] ${idx !== CATEGORIES.length - 1 ? "border-b border-gray-100" : ""}`}>
              <span className="w-8 h-8 rounded-xl bg-[#F5F0FF] text-[#7C3AED] flex items-center justify-center shrink-0"><c.icon size={16} /></span>
              <span className="flex-1 text-[14.5px] font-semibold text-gray-900">{c.name}</span>
              <ChevronRight size={14} className="text-[#5F6672]" aria-hidden="true" />
            </button>
          ))}
        </Card>
      </Section>

      <Section className="pt-0 pb-10">
        <div className="rounded-2xl bg-white border border-gray-200 p-4" data-testid="help-still-stuck">
          <div className="text-[16px] font-bold text-gray-900">Still stuck?</div>
          <div className="text-[12.5px] text-[#5F6672] mt-0.5">Usually replies in a few hours.</div>
          <button type="button" onClick={() => setTicketFormOpen(true)} className="mt-3 w-full h-12 rounded-xl bg-[#7C3AED] text-white font-bold text-sm flex items-center justify-center gap-2">
            <MessageSquare size={15} /> Chat with us
          </button>
          <div className="mt-3 flex items-center justify-center gap-5 text-[13px] font-semibold">
            <button type="button" onClick={() => openWhatsAppHelp()} className="text-[#16A34A]">WhatsApp</button>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#7C3AED]">Email</a>
            <button type="button" onClick={() => navigate("/help/tickets")} className="text-gray-600">My tickets{tickets && tickets.length ? ` (${tickets.length})` : ""}</button>
          </div>
        </div>
      </Section>

      <Presence>{ticketFormOpen && <TicketForm key="ticketform" onClose={() => setTicketFormOpen(false)} />}</Presence>
    </MobileScreen>
  );
}
