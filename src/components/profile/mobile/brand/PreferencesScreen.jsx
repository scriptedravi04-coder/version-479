import React, { useState, useMemo, useEffect, useRef } from "react";
import { Search, X, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";
import { MobileScreen } from "./brandMobileUi";
import {
  CAMPAIGN_TYPES, BUDGET_RANGES, CREATOR_SIZES, GENDER_FOCUS, ALL_NICHES, toList, aliasPref, CAMPAIGN_TYPE_LABELS,
} from "./useBrandProfileData";

// Screen 1d — campaign preferences. Same brand_profiles columns the desktop settings page writes (campaign_types,
// budget_range, preferred_creator_size, preferred_niches, gender_focus).
// v451 (Ravi's BRD §27, layout 1a): one page, 5 rows. Each row shows its answer in purple; tapping a row opens only
// that row. Changes save by themselves ("Saved"), no Save button. Selected = light purple + ✓ (not solid purple).
const CONTENT_TYPES = [...CAMPAIGN_TYPES, "barter"]; // barter merged into "Content type"
const SIZE_LABEL = { "Nano 1K–10K": "Nano (1K–10K)", "Micro 10K–100K": "Mid-size (10K–100K)", "Macro 100K–1M": "Big (100K–1M)", "Mega 1M+": "Star (1M+)" };
const GENDER_LABEL = { Female: "Mostly women", Male: "Mostly men", All: "Everyone" };
const typeLabel = (t) => CAMPAIGN_TYPE_LABELS[t] || t;

function Opt({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`h-10 px-3.5 rounded-xl border text-[13.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${on ? "bg-[#F1EBFE] border-[#C4B5FD] text-[#5B21B6]" : "bg-white border-[#E5E5EA] text-[#0A0A0A]"}`}>
      {on && <Check size={14} strokeWidth={2.6} />}{children}
    </button>
  );
}

function Row({ id, open, setOpen, label, answer, children }) {
  const isOpen = open === id;
  return (
    <div className="border-b border-[#F0F0F4] last:border-0" data-testid={`pref-row-${id}`}>
      <button type="button" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}
        className="w-full min-h-[60px] py-3 flex items-center gap-3 text-left active:bg-[#F5F0FF] transition-colors duration-[120ms]">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-[#0A0A0A]">{label}</div>
          <div className={`text-[13px] mt-0.5 truncate ${answer ? "text-[#7C3AED] font-medium" : "text-[#6E6E7A]"}`}>{answer || "Not set"}</div>
        </div>
        <ChevronDown size={18} className={`text-[#6E6E7A] shrink-0 transition-transform duration-[220ms] ${isOpen ? "rotate-180" : ""}`} />
      </button>
      <div className={`yb-collapse ${isOpen ? "is-open" : ""}`} {...(!isOpen ? { inert: "" } : {})}><div><div className="pb-4">{children}</div></div></div>{/* v463 (ref 2k): grows open */}
    </div>
  );
}

export default function PreferencesScreen({ onBack, profile, onSave, loadFailed = false }) {
  const [types, setTypes] = useState(() => toList(profile.campaignTypes).map((t) => aliasPref("type", t)));
  const [budget, setBudget] = useState(aliasPref("budget", profile.budgetRange));
  const [size, setSize] = useState(aliasPref("size", profile.creatorSize));
  const [nicheList, setNicheList] = useState(() => toList(profile.niches));
  const [gender, setGender] = useState(aliasPref("gender", profile.genderFocus));
  const [nicheQuery, setNicheQuery] = useState("");
  const [open, setOpen] = useState(null);

  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const nicheMatches = useMemo(() => {
    const q = nicheQuery.trim().toLowerCase();
    const pool = ALL_NICHES.filter((n) => !nicheList.includes(n));
    return (q ? pool.filter((n) => n.toLowerCase().includes(q)) : pool).slice(0, q ? 8 : 10);
  }, [nicheQuery, nicheList]);

  // auto-save 700 ms after the last change
  const snapshot = JSON.stringify({ types, budget, size, niches: nicheList.join(", "), gender });
  const savedRef = useRef(snapshot);
  useEffect(() => {
    if (loadFailed || snapshot === savedRef.current) return undefined;
    const t = setTimeout(async () => {
      const ok = await onSave({ campaignTypes: types.join(", "), budgetRange: budget, creatorSize: size, niches: nicheList.join(", "), genderFocus: gender }, { silent: true });
      if (ok) { savedRef.current = snapshot; toast.success("Saved", { id: "pref-saved", duration: 1200 }); }
    }, 700);
    return () => clearTimeout(t);
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MobileScreen title="Campaign preferences" onBack={onBack}>
      <div className="bg-white rounded-[20px] border border-[#ECECF0] px-4" data-testid="pref-rows">
        <Row id="type" open={open} setOpen={setOpen} label="Content type" answer={types.map(typeLabel).join(", ")}>
          <div className="flex flex-wrap gap-2">
            {[...CONTENT_TYPES, ...types.filter((t) => !CONTENT_TYPES.includes(t))].map((t) => (
              <Opt key={t} on={types.includes(t)} onClick={() => toggle(types, setTypes, t)}>{typeLabel(t)}</Opt>
            ))}
          </div>
        </Row>
        <Row id="budget" open={open} setOpen={setOpen} label="Budget per campaign" answer={budget}>
          <div className="flex flex-wrap gap-2">
            {[...BUDGET_RANGES, ...(budget && !BUDGET_RANGES.includes(budget) ? [budget] : [])].map((b) => (
              <Opt key={b} on={budget === b} onClick={() => setBudget(budget === b ? "" : b)}>{b}</Opt>
            ))}
          </div>
        </Row>
        <Row id="size" open={open} setOpen={setOpen} label="Creator size" answer={SIZE_LABEL[size] || size}>
          <div className="flex flex-wrap gap-2">
            {[...CREATOR_SIZES, ...(size && !CREATOR_SIZES.includes(size) ? [size] : [])].map((s) => (
              <Opt key={s} on={size === s} onClick={() => setSize(size === s ? "" : s)}>{SIZE_LABEL[s] || s}</Opt>
            ))}
          </div>
        </Row>
        <Row id="niches" open={open} setOpen={setOpen} label="Niches" answer={nicheList.join(", ")}>
          {nicheList.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {nicheList.map((n) => (
                <span key={n} className="inline-flex items-center gap-1.5 h-10 pl-3.5 pr-1.5 rounded-xl bg-[#F1EBFE] border border-[#C4B5FD] text-[#5B21B6] text-[13.5px] font-semibold max-w-full">
                  <Check size={14} strokeWidth={2.6} /><span className="truncate">{n}</span>
                  <button type="button" onClick={() => setNicheList((l) => l.filter((x) => x !== n))} aria-label={`Remove ${n}`} className="p-2"><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5F6672]" />
            <input value={nicheQuery} onChange={(e) => setNicheQuery(e.target.value)} placeholder="Search niches" aria-label="Search niches"
              className="w-full h-11 rounded-xl border border-[#E5E5EA] bg-[#F9F9FB] pl-9 pr-3.5 text-base text-[#0A0A0A] placeholder-gray-400 focus:outline-none focus:border-[#7C3AED] focus:bg-white" />
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {nicheMatches.map((n) => <Opt key={n} on={false} onClick={() => { setNicheList((l) => (l.includes(n) ? l : [...l, n])); setNicheQuery(""); }}>{n}</Opt>)}
          </div>
        </Row>
        <Row id="audience" open={open} setOpen={setOpen} label="Audience" answer={GENDER_LABEL[gender] || gender}>
          <div className="flex flex-wrap gap-2">
            {[...GENDER_FOCUS, ...(gender && !GENDER_FOCUS.includes(gender) ? [gender] : [])].map((g) => (
              <Opt key={g} on={gender === g} onClick={() => setGender(gender === g ? "" : g)}>{GENDER_LABEL[g] || g}</Opt>
            ))}
          </div>
        </Row>
      </div>
      <p className="mt-3 text-center text-[12px] text-[#6E6E7A]">Changes save automatically.</p>
    </MobileScreen>
  );
}
