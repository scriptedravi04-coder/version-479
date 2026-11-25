// v447 (Ravi: "ek saath itna bada popup → confuse hoke cross karke bhag jaayega. Har open pe ek random sawaal pooch").
// Design: "Brand Signup and Match Popup v2" (Claude Design, 15 Nov). Brand Home asks ONE question per app open, in a
// bottom sheet that slides up ~1 s after Home loads:
//   open 1 → nothing (let them explore) · from open 2 → next unanswered question
//   answered → the next question waits for the next open · Later / ✕ / tap outside → back after 2 more opens
//   the brand has a brief (campaign / UGC) → never asked (the brief already tells us)
// Answers save one field at a time through POST /brands/profile (partial update). Plays by the one-popup-per-open
// rule (src/lib/popupRules.js), so it never stacks on What's New / the tour / Terms.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Check } from "lucide-react";
import { api } from "../../lib/api";
import TrustAvatars from "../onboarding/mobile/TrustAvatars";
import useBackToClose, { claimAppOpenPopup, waitForHomeReady, waitForNoPopup } from "../../lib/popupRules";

export const MATCH_QUESTIONS = [
  { n: 1, field: "campaign_types", q: "How do you want to work with creators?", sub: "Just 1 tap. We'll show creators who do this.", multi: true,
    chips: [["paid", "Paid collab"], ["barter", "Barter / product"], ["onetime", "One-time content"], ["ambassador", "Long-term ambassador"]] },
  { n: 2, field: "budget_range", q: "What's your budget per campaign?", sub: "Only to match you. Creators never see it.",
    chips: [["Under ₹10K"], ["₹10K–₹50K"], ["₹50K–₹2L"], ["₹2L+"]] },
  { n: 3, field: "preferred_creator_size", q: "What size of creator suits you?", sub: "You can still invite anyone.",
    chips: [["Nano 1K–10K"], ["Micro 10K–100K"], ["Macro 100K–1M"], ["Any size"]] },
  { n: 4, field: "preferred_niches", q: "Which niches fit your brand?", sub: "Pick up to 3. Your feed gets better.", multi: true, max: 3,
    chips: [["Beauty"], ["Fashion"], ["Food"], ["Fitness"], ["Tech"], ["Lifestyle"], ["Parenting"], ["Travel"]] },
];

const filled = (v) => (Array.isArray(v) ? v.length > 0 : String(v || "").trim().length > 0);
const KEY = (uid) => `ybex_brand_match_${uid || "me"}`;
const SESSION_KEY = "ybex_brand_match_open_counted";

export function readMatchState(uid) {
  try { return { opens: 0, skipAt: -99, answeredAt: -99, done: [], ...JSON.parse(localStorage.getItem(KEY(uid)) || "{}") }; }
  catch { return { opens: 0, skipAt: -99, answeredAt: -99, done: [] }; }
}
function writeMatchState(uid, s) { try { localStorage.setItem(KEY(uid), JSON.stringify(s)); } catch { /* private mode */ } }

/** Counts this app open once per session (a reload of the same tab is the same open). */
export function countAppOpen(uid) {
  const s = readMatchState(uid);
  let counted = false;
  try { counted = sessionStorage.getItem(SESSION_KEY) === String(uid); } catch { counted = false; }
  if (!counted) {
    s.opens += 1;
    writeMatchState(uid, s);
    try { sessionStorage.setItem(SESSION_KEY, String(uid)); } catch { /* ignore */ }
  }
  return s;
}

/** Pure: the question to ask on this open, or null. */
export function questionForOpen(profile, s, hasBrief) {
  if (!profile || hasBrief) return null;
  if (s.opens < 2) return null;                       // first open: let them explore
  if (s.answeredAt === s.opens) return null;          // answered this open → next one waits
  if (s.opens - s.skipAt < 3) return null;            // "Later" → back after 2 more opens
  return MATCH_QUESTIONS.find((q) => !filled(profile[q.field]) && !(s.done || []).includes(q.field)) || null;
}

/** Kept for older imports (v446): true while any question is still open. */
export function needsMatchAnswers(profile) {
  if (!profile || typeof profile !== "object") return false;
  return MATCH_QUESTIONS.some((q) => !filled(profile[q.field]));
}

function MatchSheet({ q, onClose, onSave }) {
  const [sel, setSel] = useState([]);
  const [saving, setSaving] = useState(false);
  useBackToClose(true, onClose);
  const tap = (value) => {
    if (saving) return;
    if (!q.multi) { setSel([value]); save([value]); return; }
    setSel((cur) => (cur.includes(value) ? cur.filter((x) => x !== value) : q.max && cur.length >= q.max ? cur : [...cur, value]));
  };
  const save = async (vals) => {
    setSaving(true);
    const ok = await onSave(vals);
    if (!ok) setSaving(false);
  };
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 2150, fontFamily: "'DM Sans',sans-serif" }}>
      <style>{"@keyframes ybMatchUp{from{transform:translateY(100%)}to{transform:none}}@keyframes ybMatchFade{from{opacity:0}to{opacity:1}}"}</style>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,.42)", animation: "ybMatchFade .25s ease" }} />
      <div role="dialog" aria-modal="true" aria-label={q.q} data-testid="brand-match-sheet" data-sheet="1"
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxWidth: 520, margin: "0 auto", background: "#fff", borderRadius: "28px 28px 0 0", padding: "10px 20px calc(26px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", boxShadow: "0 -20px 50px -20px rgba(18,18,26,.5)", animation: "ybMatchUp .35s cubic-bezier(.2,.8,.2,1)", boxSizing: "border-box" }}>
        <div style={{ alignSelf: "center", width: 38, height: 4, borderRadius: 2, background: "#E5E5EA" }} />
        <div style={{ marginTop: 8, height: 34, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ font: "600 10.5px 'DM Sans',sans-serif", letterSpacing: ".9px", textTransform: "uppercase", color: "#5F6672", whiteSpace: "nowrap" }}>Help us match you · {q.n} of 4</div>
          <button type="button" aria-label="Close" data-testid="brand-match-close" onClick={onClose}
            style={{ width: 34, height: 34, borderRadius: 11, background: "#fff", border: "1px solid #E5E5EA", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={15} color="#0A0A0A" strokeWidth={2.2} />
          </button>
        </div>
        <h2 style={{ margin: "12px 0 0", font: "600 23px/1.28 'DM Sans',sans-serif", letterSpacing: "-.7px", color: "#0A0A0A", textWrap: "balance" }}>{q.q}</h2>
        <div style={{ marginTop: 6, font: "400 13px/1.5 'DM Sans',sans-serif", color: "#5F6672" }}>{q.sub}</div>
        <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {q.chips.map(([value, label]) => {
            const on = sel.includes(value);
            return (
              <button key={value} type="button" data-testid="brand-match-chip" onClick={() => tap(value)}
                style={{ cursor: "pointer", whiteSpace: "nowrap", height: 42, padding: "0 14px", borderRadius: 12, display: "flex", alignItems: "center", gap: 6, font: "600 13.5px 'DM Sans',sans-serif",
                  border: on ? "1.5px solid #7C3AED" : "1px solid #E5E5EA", background: on ? "#F5F0FF" : "#fff", color: on ? "#7C3AED" : "#0A0A0A" }}>
                {on && <Check size={13} color="#7C3AED" strokeWidth={2.6} />}
                <span>{label || value}</span>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid #F1F1F6", display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ flexShrink: 0 }}><TrustAvatars size={24} fromExplore max={4} /></div>
          <div style={{ font: "500 11.5px/1.4 'DM Sans',sans-serif", color: "#5F6672" }}><span style={{ color: "#0A0A0A", fontWeight: 600 }}>3,000+ creators on Ybex.</span> We only use this to match you.</div>
        </div>
        {q.multi && (
          <button type="button" data-testid="brand-match-done" disabled={!sel.length || saving} onClick={() => save(sel)}
            style={{ marginTop: 16, height: 52, borderRadius: 14, border: "none", background: sel.length ? "#7C3AED" : "#C4B5FD", color: "#fff", font: "600 15px 'DM Sans',sans-serif", cursor: sel.length ? "pointer" : "default" }}>
            Done
          </button>
        )}
        <button type="button" data-testid="brand-match-later" onClick={onClose}
          style={{ marginTop: 14, background: "none", border: "none", font: "500 12.5px 'DM Sans',sans-serif", color: "#5F6672", cursor: "pointer" }}>
          Later
        </button>
      </div>
    </div>,
    document.body,
  );
}

function SavedToast() {
  return createPortal(
    <div data-testid="brand-match-saved" style={{ position: "fixed", left: 16, right: 16, top: "calc(52px + var(--yb-sat, env(safe-area-inset-top, 0px)))", zIndex: 2160, maxWidth: 488, margin: "0 auto", background: "#fff", border: "1px solid #ECE7F7", borderRadius: 18, padding: "10px 12px 10px 10px", display: "flex", alignItems: "center", gap: 11, boxShadow: "0 18px 40px -16px rgba(76,29,149,.45)", fontFamily: "'DM Sans',sans-serif", animation: "ybMatchFade .25s ease" }}>
      <div style={{ width: 38, height: 38, borderRadius: 12, background: "#E9F7F0", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 20, height: 20, borderRadius: 10, background: "#16A34A", display: "flex", alignItems: "center", justifyContent: "center" }}><Check size={12} color="#fff" strokeWidth={3} /></div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "700 13.5px 'DM Sans',sans-serif", letterSpacing: "-.2px", color: "#0A0A0A" }}>Saved</div>
        <div style={{ marginTop: 2, font: "500 11.5px 'DM Sans',sans-serif", color: "#5F6672", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Creators who fit will see you first</div>
      </div>
      <div style={{ flexShrink: 0 }}><TrustAvatars size={24} fromExplore max={3} /></div>
    </div>,
    document.body,
  );
}

/** Mounted on Brand Home. `hasBrief`: null while Home is still loading. */
export default function BrandMatchCard({ profile, hasBrief = null, onSaved }) {
  const uid = profile?.user_id || "";
  const [q, setQ] = useState(null);
  const [saved, setSaved] = useState(false);
  const asked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Decided once per Home visit. A profile refresh must not cancel the wait (it used to → the popup never came).
  useEffect(() => {
    if (asked.current || !profile || hasBrief === null) return;
    asked.current = true;
    const s = countAppOpen(uid);
    const next = questionForOpen(profile, s, hasBrief);
    if (!next) return;
    (async () => {
      await waitForHomeReady(6000);
      const free = await waitForNoPopup(15000);
      if (!mounted.current || !free || !claimAppOpenPopup("brandmatch")) return;
      setTimeout(() => { if (mounted.current) setQ(next); }, 1000);
    })();
  }, [profile, hasBrief, uid]);

  const close = () => {
    const s = readMatchState(uid);
    writeMatchState(uid, { ...s, skipAt: s.opens });
    setQ(null);
  };
  const save = async (vals) => {
    const value = q.field === "budget_range" || q.field === "preferred_creator_size" ? vals[0] : q.field === "preferred_niches" ? vals.join(", ") : vals;
    try {
      await api.post("brands/profile", { [q.field]: value });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save. Please try again.");
      return false;
    }
    const s = readMatchState(uid);
    writeMatchState(uid, { ...s, answeredAt: s.opens, done: Array.from(new Set([...(s.done || []), q.field])) });
    onSaved?.({ [q.field]: value });
    setQ(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2600);
    return true;
  };

  return (
    <>
      {q && <MatchSheet q={q} onClose={close} onSave={save} />}
      {saved && <SavedToast />}
    </>
  );
}
