import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api";
import { Mail, Trash2 } from "lucide-react";
import { LEGAL, LEGAL_LINKS } from "../../lib/legal/legalContent";
import { BlockedPeopleList } from "../safety/BlockUserButton"; // v337: Blocked people (unblock)
import SocialLogo from "../common/SocialLogo"; // v364: real platform logos
import { Link } from "react-router-dom";
import useBackToClose from "../../lib/popupRules";

// v334 (App Store 1.5 / Play "contact details"): a real way to reach a person, inside the app, for creators and
// brands. Email + WhatsApp, plus the legal pages and how to delete the account. No server call (layout only).
export const SUPPORT_EMAIL = LEGAL.emails.support;
export const SUPPORT_WHATSAPP = "918764004299"; // same number as the website footer (App.jsx)

export default function SupportContactCard({ className = "", showLegal = true }) {
  const row = "flex items-center gap-3 py-3 min-h-[48px] text-left";
  const link = "text-[13px] font-semibold text-[#7C3AED] hover:underline";
  return (
    <>
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${className}`} data-testid="support-contact-card">
      <div className="text-[15px] font-bold text-slate-900">Help &amp; support</div>
      <p className="text-[12.5px] text-[#5F6672] mt-0.5">Write to us any time — a real person replies, usually within a few hours.</p>
      <div className="mt-2 divide-y divide-slate-100">
        <a href={`mailto:${SUPPORT_EMAIL}`} className={row}>
          <span className="w-9 h-9 rounded-xl bg-[#F5F0FF] text-[#7C3AED] flex items-center justify-center shrink-0"><Mail size={17} /></span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-slate-900">Email</span>
            <span className="block text-[12.5px] text-[#5F6672] truncate">{SUPPORT_EMAIL}</span>
          </span>
        </a>
        <button type="button" onClick={() => openWhatsAppHelp()} className={`${row} w-full`} data-testid="support-whatsapp">
          <SocialLogo platform="whatsapp" size={36} variant="tile" />
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-slate-900">WhatsApp</span>
            <span className="block text-[12.5px] text-[#5F6672]">+91 87640 04299</span>
          </span>
        </button>
      </div>
      {showLegal && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2">
          <a href={LEGAL_LINKS.privacy} target="_blank" rel="noopener noreferrer" className={link}>Privacy Policy</a>
          <a href={LEGAL_LINKS.terms} target="_blank" rel="noopener noreferrer" className={link}>Terms</a>
          <a href={LEGAL_LINKS.refunds} target="_blank" rel="noopener noreferrer" className={link}>Refund Policy</a>
          <Link to="/delete-account" className={`${link} inline-flex items-center gap-1`}><Trash2 size={13} /> Delete account</Link>
        </div>
      )}
    </div>
    <BlockedPeopleList className={`mt-3 ${className.includes("max-w") ? "max-w-xl mx-auto" : ""}`} />
    </>
  );
}

// ═══ v451 (BRD §16): every "WhatsApp" button first asks topic + issue, then opens WhatsApp with a ready message ═══
export const WA_TOPICS = {
  Payments: ["Refund not received", "Escrow amount wrong", "GST invoice", "Other"],
  Campaigns: ["No applicants yet", "Edit or close a campaign", "Creator not responding", "Other"],
  UGC: ["Order is late", "Need a revision", "Video quality issue", "Other"],
  KYC: ["KYC pending too long", "KYC rejected", "Change company details", "Other"],
  Safety: ["Report a creator", "Suspicious message", "Account access", "Other"],
  Other: ["Other"],
};
/** The WhatsApp message. Pure. */
export function waHelpMessage({ brandName, userId, role, topic, issue, details, campaignTitle, orderId }) {
  const who = role === "creator" ? "creator" : "brand";
  const lines = [`Hi Ybex, I'm ${brandName || "a " + who} (${who} · ID ${userId || "-"}).`, `Topic: ${topic} → ${issue}`];
  if (String(details || "").trim()) lines.push(`"${String(details).trim()}"`);
  if (campaignTitle) lines.push(`Campaign: ${campaignTitle}`);
  if (orderId) lines.push(`Order: ${orderId}`);
  return lines.join("\n");
}
/** Open the sheet from anywhere: openWhatsAppHelp({ topic: "UGC", orderId, campaignTitle }). */
export function openWhatsAppHelp(ctx = {}) {
  try { window.dispatchEvent(new CustomEvent("ybex:wa-help", { detail: ctx })); } catch { /* old browser */ }
}

/** Mounted once (App) — listens for openWhatsAppHelp(). */
export function WhatsAppHelpHost({ user, brandName }) {
  const [ctx, setCtx] = useState(null);
  useEffect(() => {
    const on = (e) => setCtx(e.detail || {});
    window.addEventListener("ybex:wa-help", on);
    return () => window.removeEventListener("ybex:wa-help", on);
  }, []);
  if (!ctx) return null;
  return <WhatsAppHelpSheet ctx={ctx} user={user} brandName={brandName} onClose={() => setCtx(null)} />;
}

function WhatsAppHelpSheet({ ctx, user, brandName, onClose }) {
  useBackToClose(true, () => onClose?.()); // v457: phone / browser Back closes this popup
  const [topic, setTopic] = useState(ctx.topic && WA_TOPICS[ctx.topic] ? ctx.topic : "");
  const [issue, setIssue] = useState("");
  const [details, setDetails] = useState("");
  const [preview, setPreview] = useState(false);
  const role = String(user?.role || "").toLowerCase();
  const name = brandName || user?.company_name || user?.name || "";
  const needText = issue === "Other";
  const ready = Boolean(topic && issue && (!needText || details.trim().length >= 10));
  const msg = waHelpMessage({ brandName: name, userId: user?.user_id || user?.id, role, topic, issue, details, campaignTitle: ctx.campaignTitle, orderId: ctx.orderId });
  const go = () => {
    if (!ready) return;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
    // also a support ticket, so it shows in My tickets (best effort)
    api.post("/support/tickets", { subject: `WhatsApp: ${topic} → ${issue}`, category: topic, message: msg, page_context: `whatsapp:${typeof window !== "undefined" ? window.location.pathname : ""}`, ...(ctx.orderId ? { order_id: ctx.orderId } : {}), ...(ctx.campaignTitle ? { campaign_title: ctx.campaignTitle } : {}) }).catch(() => {});
    onClose();
  };
  const chip = (on) => `h-9 px-3.5 rounded-full text-[13.5px] font-semibold border transition-colors ${on ? "bg-[#F1EBFE] border-[#C4B5FD] text-[#5B21B6]" : "bg-white border-[#E5E5EA] text-[#0A0A0A]"}`;
  return createPortal((
    <div className="fixed inset-0 z-[9000] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="WhatsApp help" data-testid="wa-help-sheet" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-white rounded-t-[24px] px-5 pt-3 max-h-[88vh] overflow-y-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)", animation: "ybWaUp .26s cubic-bezier(.32,.72,0,1)" }}>
        <style>{"@keyframes ybWaUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}"}</style>
        <div className="w-10 h-1 rounded-full bg-[#E5E5EA] mx-auto mb-3" />
        <div className="flex items-center gap-2.5">
          <SocialLogo platform="whatsapp" size={30} variant="tile" />
          <div className="flex-1 text-[17px] font-bold text-[#0A0A0A]">What do you need help with?</div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-[#F2F2F7] text-[#5F6672] text-[13px]">✕</button>
        </div>
        <div className="mt-4 text-[12px] font-bold text-[#5F6672] uppercase tracking-wider">Topic</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.keys(WA_TOPICS).map((t) => <button key={t} type="button" className={chip(topic === t)} onClick={() => { setTopic(t); setIssue(t === "Other" ? "Other" : ""); }}>{t}</button>)}
        </div>
        {topic && (
          <>
            <div className="mt-4 text-[12px] font-bold text-[#5F6672] uppercase tracking-wider">Issue</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {WA_TOPICS[topic].map((i) => <button key={i} type="button" className={chip(issue === i)} onClick={() => setIssue(i)}>{i}</button>)}
            </div>
            <textarea value={details} onChange={(e) => setDetails(e.target.value.slice(0, 400))} rows={1}
              onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 84) + "px"; }}
              placeholder={needText ? "Tell us in a line (at least 10 letters)" : "Add a line (optional)"} data-testid="wa-help-details"
              className="mt-3 w-full resize-none rounded-xl border border-[#E5E5EA] bg-[#F9F9FB] px-3.5 py-2.5 text-[15px] text-[#0A0A0A] outline-none focus:border-[#7C3AED]" />
          </>
        )}
        {topic && issue && (
          <button type="button" onClick={() => setPreview((v) => !v)} className="mt-3 w-full text-left rounded-xl bg-[#E8F8EE] border border-[#BFE9CF] px-3.5 py-2.5 text-[12.5px] text-[#166534]">
            {preview ? <span className="whitespace-pre-wrap">{msg}</span> : <span className="block truncate">Sends: {name || "You"} · {topic} → {issue}{details ? ` · ${details}` : ""}… <b>Preview</b></span>}
          </button>
        )}
        <button type="button" onClick={go} disabled={!ready} data-testid="wa-help-go"
          className="mt-4 w-full h-[52px] rounded-2xl text-white text-[15.5px] font-bold flex items-center justify-center gap-2 disabled:opacity-40" style={{ background: "#16A34A" }}>
          Now connect on WhatsApp
        </button>
      </div>
    </div>
  ), document.body);
}
