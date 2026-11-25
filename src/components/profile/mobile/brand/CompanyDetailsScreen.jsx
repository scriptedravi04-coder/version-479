import React, { useState, useRef, useEffect } from "react";
import LogoCropper from "../../../common/LogoCropper";
import { safeLower } from "../../../../utils/safeFormat";
import { Building, ChevronDown, Camera, Check, MapPin, Plus, Search } from "lucide-react";
import { MobileScreen, PrimaryButton, Pill } from "./brandMobileUi"; // v470: own card layout
import { INDUSTRY_OPTIONS, TEAM_SIZES, aliasPref } from "./useBrandProfileData";
import { searchLocations } from "@/lib/locations";
import { AGENCY_TYPES } from "../../../../constants/agencyTypes";
import { checkHttpUrl } from "../../../../utils/httpUrl";
import { api } from "../../../../lib/api"; // v416
import { toast } from "sonner";
import { useLeaveGuard } from "../../../../lib/popupRules"; // v456
import { currentPosition } from "../../../explore/nearby/LocationScreens"; // v451


// Screen 1c — editable company fields. Writes through the same POST brands/profile
// payload BrandSettings.jsx uses, so desktop and mobile edit the same row.

export default function CompanyDetailsScreen({ onBack, profile, saving, onSave, uploadImage, loadFailed = false, onRetry, onChangeEmail = null }) {
  const [form, setForm] = useState(() => ({ ...profile, industry: aliasPref("industry", profile?.industry) })); // v358: "Food" from onboarding = the "D2C food" chip
  const [agencyOpen, setAgencyOpen] = useState(false);
  const [agencyType, setAgencyType] = useState(profile?.agency_type || "");
  const [uploading, setUploading] = useState(null);
  const logoInput = useRef(null);
  const coverInput = useRef(null);

  // Location search state
  const [locQuery, setLocQuery] = useState(profile?.location || "");
  const [locSuggestions, setLocSuggestions] = useState([]);
  const [locDropdownOpen, setLocDropdownOpen] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const locContainerRef = useRef(null);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // v346: a name of only spaces and a "javascript:" / non-web website were saved as they were.
  const [tried, setTried] = useState(false);
  const nameError = !String(form?.company_name || "").trim() ? "Enter your company name." : "";
  const websiteCheck = checkHttpUrl(form?.website, { label: "Website" });
  const saveChecked = () => {
    setTried(true);
    if (nameError || !websiteCheck.ok) {
      // v415: the error can sit above the fold — bring the first one into view instead of a silent no-op
      setTimeout(() => {
        const el = document.getElementById(nameError ? "brand-company-name" : "brand-company-website");
        try { el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.focus({ preventScroll: true }); } catch { /* old browser */ }
      }, 0);
      return;
    }
    onSave({ ...form, company_name: String(form.company_name || "").trim(), website: websiteCheck.url });
  };

  // Keep locQuery in sync if form.location changes externally
  useEffect(() => {
    if (form.location && form.location !== locQuery && !locDropdownOpen) {
      setLocQuery(form.location);
    }
  }, [form.location]);

  // City / Location search: searchLocations local + /api/locations/search debounced
  useEffect(() => {
    const q = (locQuery || "").trim();
    if (!q) {
      setLocSuggestions(searchLocations("", 8));
      return;
    }
    const localMatches = searchLocations(q, 10);
    setLocSuggestions(localMatches);

    let stale = false; // v416: a slow answer for "Ja" must not overwrite "Jaipur"; api helper works inside the app too
    const timer = setTimeout(async () => {
      try {
        setLocLoading(true);
        const { data } = await api.get(`locations/search?q=${encodeURIComponent(q)}&limit=12`);
        if (!stale) {
          if (Array.isArray(data) && data.length > 0) {
            const combined = [...localMatches];
            data.forEach((item) => {
              if (item && item.name && !combined.some((c) => safeLower(c.name) === safeLower(item.name))) {
                combined.push(item);
              }
            });
            setLocSuggestions(combined.slice(0, 15));
          }
        }
      } catch (e) {
        // Fallback gracefully to local matches
      } finally {
        setLocLoading(false);
      }
    }, 120);

    return () => { stale = true; clearTimeout(timer); }; // v416
  }, [locQuery]);

  // Click outside listener for location dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (locContainerRef.current && !locContainerRef.current.contains(e.target)) {
        setLocDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  const handleSelectLocation = (loc) => {
    const formatted = loc.display?.includes(",")
      ? loc.display
      : loc.state && loc.state !== loc.name
      ? `${loc.name}, ${loc.state}`
      : loc.name;
    set("location", formatted);
    setLocQuery(formatted);
    setLocDropdownOpen(false);
  };

  // v283: logo → adjust (LogoCropper) → upload.
  const [cropFile, setCropFile] = useState(null);
  const handleUpload = async (kind, file) => {
    if (uploading) return; // v415: one upload at a time (logo + cover at once raced the same save)
    setUploading(kind);
    let url = null;
    try { url = await uploadImage(file); } finally { setUploading(null); } // v415: never stuck on "Uploading…"
    if (url) {
      set(kind === "logo" ? "logo" : "cover", url);
      // v358: saved right away — "Uploaded." + Back used to lose the new logo / cover (only Save changes saved it)
      await onSave?.({ [kind === "logo" ? "logo" : "cover"]: url }, { silent: true });
    }
  };

  const handleClaimAgency = async () => {
    if (!agencyType) return;
    const ok = await onSave({ is_agency: true, agency_type: agencyType });
    if (ok) {
      set("is_agency", true);
      set("agency_type", agencyType);
      setAgencyOpen(false);
    }
  };

  // v415: compare with the same "Food → D2C food" reading the form starts from, so Save isn't lit on open
  const dirty = JSON.stringify(form) !== JSON.stringify({ ...profile, industry: aliasPref("industry", profile?.industry) });
  useLeaveGuard(Boolean(dirty && !loadFailed && !saving)); // v456 (Back review): phone Back asks before dropping the edits
  const [logoBroken, setLogoBroken] = useState(false); // v415: dead logo / cover links fall back cleanly
  const [coverBroken, setCoverBroken] = useState(false);

  const checks = [["Add your logo", form.logo], ["Add your brand name", String(form.company_name || "").trim()], ["Pick an industry", form.industry], ["Add your city", form.location], ["Add your website", String(form.website || "").trim()], ["Pick team size", form.teamSize], ["Write a line about you", String(form.description || "").trim()]];
  const missing = checks.filter(([, v]) => !v).map(([t]) => t);
  const donePct = Math.round(((checks.length - missing.length) / checks.length) * 100);
  const [geoBusy, setGeoBusy] = useState(false);
  const useMyLocation = async () => {
    if (geoBusy) return;
    setGeoBusy(true);
    try {
      const pos = await currentPosition();
      const { data } = await api.get(`geo/reverse?lat=${pos.lat}&lng=${pos.lng}`);
      const city = data?.place?.city || data?.place?.label || "";
      if (city) { setLocQuery(city); set("location", city); setLocDropdownOpen(false); }
      else toast.error("Couldn't find your city — type it instead.");
    } catch { toast.error("Location is off. Turn it on, or type your city."); }
    finally { setGeoBusy(false); }
  };
  const brandInitial = form.company_name?.trim()
    ? form.company_name.trim().charAt(0).toUpperCase()
    : "B";

  // v470 (Ravi 20 Nov: "setting mein edit company details ki UI di thi"; 17 Nov "Company Profile – Working" design):
  // grey page with white cards — live preview (cover + logo + name), Basics, Location, Team size, Online, About your
  // brand, then the agency card. "% done" sits in the header with a thin line under it; the button says "All saved"
  // until something changes. Same fields, same saves as before.
  const card = "bg-white rounded-[20px] border border-[#ECECF0] px-4 py-4";
  const label = "text-[11px] font-bold tracking-[.12em] uppercase text-[#5F6672]";
  const input = "w-full h-12 px-4 rounded-2xl bg-[#F7F7FA] border border-[#ECECF0] text-base text-[#0A0A0A] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15";
  return (
    <MobileScreen
      title="Company details"
      onBack={onBack}
      bg="bg-[#F2F2F7]"
      right={<span className="text-[12.5px] font-semibold text-[#16A34A]" data-testid="company-done">{donePct}% done</span>}
      progress={donePct}
      footer={
        <PrimaryButton disabled={saving || !dirty || loadFailed || Boolean(uploading)} busy={saving} onClick={saveChecked}>
          {saving ? "Saving…" : dirty ? "Save changes" : "All saved"}
        </PrimaryButton>
      }
    >
      {loadFailed && (
        <div role="alert" className="mx-4 mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800 flex items-center justify-between gap-3">
          <span>We couldn't load your company details, so editing is paused.</span>{/* v415: no empty form that looks real */}
          {onRetry && <button type="button" onClick={onRetry} className="h-10 px-3 rounded-xl bg-white border border-amber-200 text-amber-800 font-bold shrink-0">Try again</button>}
        </div>
      )}

      <div className="px-4 pt-4 pb-6 space-y-3">
        {/* live preview — updates as you type; tap cover / logo to change them */}
        <div className="bg-white rounded-[20px] overflow-hidden shadow-[0_12px_28px_-18px_rgba(76,29,149,.45)] border border-[#ECECF0]" data-testid="company-preview">
          <div className="relative h-[92px] bg-gradient-to-r from-[#2E1A68] via-[#3B1E7E] to-[#582A9C]">
            {form.cover && !coverBroken && <img src={form.cover} alt="" onError={() => setCoverBroken(true)} className="absolute inset-0 w-full h-full object-cover" />}
            <span className="absolute top-3 left-3 h-6 px-2.5 rounded-full bg-white/20 text-white text-[10.5px] font-bold tracking-[.08em] flex items-center backdrop-blur-sm">LIVE PREVIEW</span>
            <button type="button" onClick={() => coverInput.current?.click()} disabled={Boolean(uploading)} aria-label={form.cover ? "Change cover image" : "Add cover image"}
              className="absolute top-2.5 right-2.5 h-9 px-3.5 rounded-full bg-white text-[#0A0A0A] text-[12.5px] font-semibold shadow-md disabled:opacity-70">
              {uploading === "cover" ? "Uploading…" : "Change cover"}
            </button>
          </div>
          <div className="relative px-4 pb-3.5 flex items-end gap-3">
            <div className="relative -mt-8 shrink-0">
              <button type="button" onClick={() => logoInput.current?.click()} disabled={Boolean(uploading)} aria-label={form.logo ? "Change logo" : "Upload logo"}
                className="w-[68px] h-[68px] rounded-[18px] bg-white border-[3px] border-white shadow-lg overflow-hidden flex items-center justify-center text-2xl font-black text-[#0A0A0A]">
                {form.logo && !logoBroken ? <img src={form.logo} alt="" onError={() => setLogoBroken(true)} className="w-full h-full object-cover" />
                  : form.company_name?.trim() ? brandInitial : <Building size={24} className="text-slate-300" />}
                {uploading === "logo" && <span className="absolute inset-0 bg-white/85 flex items-center justify-center"><span className="w-5 h-5 rounded-full border-2 border-slate-300 border-t-[#7C3AED] animate-spin" /></span>}
              </button>
              <span aria-hidden="true" className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#7C3AED] text-white flex items-center justify-center border-2 border-white"><Camera size={11} strokeWidth={2.5} /></span>
            </div>
            <div className="min-w-0 pb-0.5">
              <div className="text-[16px] font-bold text-[#0A0A0A] truncate">{form.company_name || "Your brand name"}</div>
              <div className="text-[12.5px] text-[#5F6672] truncate">{[form.industry, String(form.location || "").split(",")[0]].filter(Boolean).join(" · ") || "Industry · City"}</div>
            </div>
          </div>
          <input ref={logoInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setCropFile(f); }} />
          <LogoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={(f) => { setCropFile(null); handleUpload("logo", f); }} />
          <input ref={coverInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleUpload("cover", f); }} />
        </div>

        {/* basics */}
        <div className={card}>
          <div className={label}>Basics</div>
          <label htmlFor="brand-company-name" className="block mt-3 mb-2 text-[14px] font-semibold text-[#0A0A0A]">Company name</label>
          <input id="brand-company-name" aria-invalid={Boolean(tried && nameError) || undefined} value={form.company_name || ""} onChange={(e) => set("company_name", e.target.value)} placeholder="Your registered brand name" className={input} />
          {tried && nameError && <p className="mt-1 text-[12px] font-semibold text-red-600" role="alert">{nameError}</p>}
          <div className="mt-4 mb-2 flex items-center justify-between"><span className="text-[14px] font-semibold text-[#0A0A0A]">Industry</span>{form.industry && <span className="text-[13px] font-semibold text-[#7C3AED] truncate max-w-[55%]">{form.industry}</span>}</div>
          <IndustryPicker value={form.industry} onChange={(v) => set("industry", v)} />
        </div>

        {/* location */}
        <div className={card}>
          <div className={label}>Location</div>
          <div ref={locContainerRef} className="relative mt-3">
            <div className="relative">
              <input type="text" value={locQuery}
                onChange={(e) => { setLocQuery(e.target.value); set("location", e.target.value); setLocDropdownOpen(true); }}
                onFocus={() => setLocDropdownOpen(true)}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setLocDropdownOpen(false); } }}
                aria-expanded={locDropdownOpen} autoComplete="off" placeholder="Search city, e.g. Jaipur" aria-label="Headquarters city"
                className={`${input} pl-11`} />
              <MapPin size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none" />
              {locLoading && <span className="absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-slate-300 border-t-[#7C3AED] rounded-full animate-spin" />}
            </div>
            <button type="button" onClick={useMyLocation} disabled={geoBusy} data-testid="company-use-location"
              className="mt-2.5 h-8 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#7C3AED] disabled:opacity-60">
              <MapPin size={13} /> {geoBusy ? "Finding you…" : "Use my current location"}
            </button>
            {locDropdownOpen && (
              <div className="yb-reveal absolute top-[52px] left-0 right-0 bg-white rounded-2xl border border-slate-200 shadow-[0_12px_32px_rgba(0,0,0,0.15)] max-h-60 overflow-y-auto z-50 p-1.5">
                {locSuggestions.map((loc, idx) => (
                  <button key={`${loc.name}-${idx}`} type="button" onClick={() => handleSelectLocation(loc)}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#F5F0FF] flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="w-7 h-7 rounded-lg bg-[#F5F0FF] text-[#7C3AED] flex items-center justify-center shrink-0"><MapPin size={13} strokeWidth={2.2} /></span>
                      <span className="min-w-0"><span className="block text-[13px] font-semibold text-slate-900 truncate">{loc.name}</span>{loc.state && loc.state !== loc.name && <span className="block text-[11px] text-[#5F6672] truncate">{loc.state}</span>}</span>
                    </span>
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-bold shrink-0">{loc.type || "City"}</span>
                  </button>
                ))}
                {locQuery.trim() && !locSuggestions.some((c) => safeLower(c.name) === locQuery.trim().toLowerCase()) && (
                  <button type="button" onClick={() => { set("location", locQuery.trim()); setLocDropdownOpen(false); }}
                    className="w-full text-left px-3 py-2.5 rounded-xl bg-[#F5F0FF]/50 text-[#7C3AED] flex items-center gap-2 border-t border-slate-100 mt-1 font-semibold text-xs">
                    <Plus size={14} /><span className="min-w-0 truncate">Use &ldquo;{locQuery.trim()}&rdquo; as headquarters</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* team size */}
        <div className={card}>
          <div className={label}>Team size</div>
          <div className="mt-3 grid grid-cols-4 bg-[#F2F2F7] p-[4px] rounded-2xl" role="radiogroup" aria-label="Team size">
            {TEAM_SIZES.map((opt) => (
              <button key={opt} type="button" role="radio" aria-checked={form.teamSize === opt} onClick={() => set("teamSize", opt)}
                className={`h-10 rounded-xl text-[13.5px] font-semibold transition-colors ${form.teamSize === opt ? "bg-white text-[#0A0A0A] shadow-[0_1px_3px_rgba(16,16,20,.12)]" : "text-[#5F6672]"}`}>
                {opt.replace(" Employees", "")}
              </button>
            ))}
          </div>
        </div>

        {/* online */}
        <div className={card}>
          <div className={label}>Online</div>
          <label htmlFor="brand-company-website" className="block mt-3 mb-2 text-[14px] font-semibold text-[#0A0A0A]">Website</label>
          <input id="brand-company-website"
            aria-invalid={Boolean((tried || /^[a-z][a-z0-9+.-]*:/i.test(String(form?.website || "").trim())) && !websiteCheck.ok) || undefined}
            value={form.website || ""} onChange={(e) => set("website", e.target.value)} placeholder="https://yourbrand.com" inputMode="url" autoCapitalize="none" className={input} />
          {(tried || /^[a-z][a-z0-9+.-]*:/i.test(String(form?.website || "").trim())) && !websiteCheck.ok && (
            <p className="mt-1 text-[12px] font-semibold text-red-600" role="alert">{websiteCheck.error}</p>
          )}
          {/* v423 (S1): the contact email can receive contract-signing codes — it is changed only on the Contact screen (code check) */}
          <div className="mt-3 rounded-2xl bg-[#F7F7FA] border border-[#ECECF0] px-4 py-2.5 flex items-center gap-3" data-testid="company-contact-email">
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] text-[#5F6672]">Contact email</div>
              <div className="text-[15px] text-[#0A0A0A] truncate">{form.pocEmail || "Not added"}</div>
            </div>
            {onChangeEmail && <button type="button" onClick={onChangeEmail} className="shrink-0 h-9 px-1 text-[13px] font-semibold text-[#7C3AED]">Change</button>}
          </div>
        </div>

        {/* about */}
        <div className={card}>
          <div className={label}>About your brand</div>
          <textarea rows={4} maxLength={500} value={form.description || ""} onChange={(e) => set("description", e.target.value.slice(0, 500))} aria-label="About your brand"
            placeholder="What you sell, who you sell to, and how you like to work with creators."
            className="mt-3 w-full px-4 py-3 rounded-2xl bg-[#F7F7FA] border border-[#ECECF0] text-base text-[#0A0A0A] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#7C3AED] resize-none" />
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-[#9CA3AF]"><span>Creators read this before accepting</span><span>{String(form.description || "").length}/500</span></div>
        </div>

        {/* agency (BRD §5: stays here) */}
        <div className="rounded-[20px] bg-[#F5F0FF] overflow-hidden">
          <button type="button" onClick={() => setAgencyOpen((v) => !v)} aria-expanded={agencyOpen} className="w-full px-4 py-3.5 flex items-center gap-2 text-left">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-semibold text-[#0A0A0A]">Are you an agency?</span>
                {form.is_agency ? <Pill tone="violet"><Check size={10} strokeWidth={3} /> Claimed</Pill> : <Pill tone="violet">New</Pill>}
              </div>
              <p className="text-[12.5px] text-[#6D28D9] mt-0.5">{form.is_agency ? `Showing as ${form.agency_type || "an agency"} on your briefs and chats.` : "Show a public Agency badge to creators."}</p>
            </div>
            <ChevronDown size={16} className={`text-[#7C3AED] shrink-0 transition-transform ${agencyOpen ? "rotate-180" : "-rotate-90"}`} />
          </button>
          {agencyOpen && !form.is_agency && (
            <div className="px-4 pb-4 space-y-2">
              {AGENCY_TYPES.map((t) => (
                <button key={t} type="button" aria-pressed={agencyType === t} onClick={() => setAgencyType(t)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold border transition ${agencyType === t ? "bg-[#7C3AED] text-white border-[#7C3AED]" : "bg-white text-gray-700 border-[#DDD6FE]"}`}>{t}</button>
              ))}
              <button type="button" onClick={handleClaimAgency} disabled={!agencyType || saving || loadFailed} aria-busy={saving || undefined}
                className="w-full h-11 mt-1 rounded-xl bg-[#7C3AED] text-white font-bold text-sm disabled:opacity-50">{saving ? "Claiming…" : "Claim agency status"}</button>
            </div>
          )}
        </div>
      </div>
    </MobileScreen>
  );
}

/** v451 (BRD §26): industry search — suggestions as you type, or "Add '<typed>'" when it isn't listed. */
const MORE_INDUSTRIES = ["Retail", "D2C", "Food & beverage", "Restaurant / Café", "Salon / Clinic", "Health & wellness", "Education", "Finance", "Real estate", "Automobile", "Electronics", "Home & decor", "Jewellery", "Kids & baby", "Pets", "Sports", "Entertainment", "Media", "Agency", "App / SaaS", "Hospitality", "Events"];
function IndustryPicker({ value, onChange }) {
  const [q, setQ] = useState("");
  const all = Array.from(new Set([...INDUSTRY_OPTIONS, ...MORE_INDUSTRIES]));
  const term = q.trim().toLowerCase();
  const list = term ? all.filter((x) => x.toLowerCase().includes(term)).slice(0, 8) : INDUSTRY_OPTIONS;
  const exact = all.some((x) => x.toLowerCase() === term);
  return (
    <div>
      {/* v470: the design — search field with an icon, then chips; the picked one is purple-outlined with a ✓ */}
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none" />
        <input value={q} onChange={(e) => setQ(e.target.value.slice(0, 40))} placeholder="Search any industry: skincare, edtech…" aria-label="Search industry" data-testid="industry-search"
          className="w-full h-12 pl-11 pr-4 rounded-2xl bg-[#F7F7FA] border border-[#ECECF0] text-base text-[#0A0A0A] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#7C3AED]" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {value && !list.includes(value) && (
          <button type="button" aria-pressed="true" onClick={() => onChange("")} className="h-9 px-3 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1 bg-[#F5F0FF] border-[#7C3AED] text-[#6D28D9]"><Check size={13} strokeWidth={2.6} />{value}</button>
        )}
        {list.map((opt) => (
          <button key={opt} type="button" aria-pressed={value === opt} onClick={() => { onChange(opt); setQ(""); }}
            className={`h-9 px-3 rounded-full border text-[13px] font-semibold inline-flex items-center gap-1 ${value === opt ? "bg-[#F5F0FF] border-[#7C3AED] text-[#6D28D9]" : "bg-white border-[#E5E5EA] text-[#0A0A0A]"}`}>{value === opt && <Check size={13} strokeWidth={2.6} />}{opt}</button>
        ))}
        {term && !exact && (
          <button type="button" onClick={() => { onChange(q.trim()); setQ(""); }} data-testid="industry-add"
            className="h-9 px-3 rounded-full border border-dashed border-[#C4B5FD] text-[13px] font-semibold text-[#7C3AED]">+ Add &ldquo;{q.trim()}&rdquo;</button>
        )}
      </div>
    </div>
  );
}
