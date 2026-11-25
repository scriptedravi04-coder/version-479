import { deliverablesLabel } from "../../../utils/safeFormat"; // v415
import React, { useEffect, useMemo, useRef, useState } from "react";
import { visibleCreators } from "../../../lib/visibleCreators";
import useFeaturedCreators, { featuredFirst } from "../../../lib/useFeaturedCreators";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, SlidersHorizontal, MapPin, Check, X, Plus, Send } from "lucide-react";
import { placeFromSearch, cityPoint, distanceKm } from "../../../lib/indiaCities";
import { searchLocations } from "../../../lib/locations"; // v451: Location filter searches every city
import { toast } from "sonner";
import { api, isBrandLike } from "../../../lib/api"; // v416 (CR4): agency / talent manager are brand accounts too
import { inviteFailReason } from "../../campaigns/InviteToCampaignModal"; // v416 (C6): per-creator reason
import { useAuth } from "../../../contexts/AuthContext";
import ModalPortal from "../../common/ModalPortal";
import ButtonSpinner from "../../common/ButtonSpinner";
import { Shimmer } from "../../common/ContentSkeletons";
import useScrollLock from "../../../lib/useScrollLock";
import useBusy from "../../../lib/useBusy";
import { OfflineAware } from "../../common/OfflineState"; // v334

import { Presence, PopupBackdrop, PopupPanel } from "../../common/Popup";
import { motion } from "framer-motion"; // v415: selection bar enter/exit
import { initials as initialsOf } from "../../../utils/initials";
// v450 (Ravi's BRD "Explore near you"): brand branches, near-you list, map, empty state
import { withDistance, withinRadius, radiusCounts, DEFAULT_RADIUS } from "../nearby/nearbyLogic";
import { useBranches, LocationLine, MapButton, MapTip, RadiusControl, NearbyCard, NoCreatorsNearby, SelectLocationSheet, ConfirmLocationScreen } from "../nearby/LocationScreens";
const NearbyMapView = React.lazy(() => import("../nearby/NearbyMapView"));
import { safeStorage } from "../../../utils/storage";
// Session 33 (Ravi: "mobile UI mein desktop ko compress karke mat dikhao"). Explore on mobile used
// to be the desktop page squeezed down. This is Ravi's design: EX-01 browse, EX-02 filters,
// EX-03 filtered results with multi-select, EX-05 invite sheet.
// Same data and calls as desktop Explore.jsx: GET /creators/explore, GET /campaigns?mine=true,
// POST /creators/:id/send-brief (message + fee, ₹3,000 minimum — the server checks both).
// Only real data: no invented rating, reach, "verified" or rate. A creator without a rate card
// shows no rate; "Verified" only when the profile row says verified.

export const wordIn = (text, k) => new RegExp(`(^|[^a-z])${String(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(String(text || "").toLowerCase());
export const CATEGORY_CHIPS = [
  { label: "Fashion", keys: ["fashion", "beauty", "makeup", "skincare", "jewellery", "style"] },
  { label: "Health", keys: ["health", "wellness", "yoga", "nutrition", "mental"] },
  { label: "Food", keys: ["food", "cooking", "recipe", "restaurant"] },
  { label: "Tech", keys: ["tech", "gadget", "gaming", "software", "ai"] },
  { label: "Fitness", keys: ["fitness", "gym", "sports"] },
  { label: "Travel", keys: ["travel"] },
  { label: "Lifestyle", keys: ["lifestyle", "vlog", "family", "parenting"] },
  { label: "Finance", keys: ["finance", "money", "business", "education"] },
];

export const FOLLOWER_RANGES = [
  { key: "nano", label: "1K–10K", min: 1000, max: 10000 },
  { key: "micro", label: "10K–100K", min: 10000, max: 100000 },
  { key: "macro", label: "100K–1M", min: 100000, max: 1000000 },
  { key: "mega", label: "1M+", min: 1000000, max: Infinity },
];

const RATE_STEPS = [5000, 10000, 15000, 25000, 50000, 100000, 0]; // 0 = any rate
import { MIN_CAMPAIGN_PAYOUT as MIN_INVITE } from "../../campaigns/mobile/HomeCampaignCard"; // v419: live floor (₹500 for Ybex in-house brands)
import { RATES_PUBLIC } from "../../../utils/rateCardQuote"; // v430

export const parseCount = (raw) => {
  if (raw === null || raw === undefined) return 0;
  const t = String(raw).trim().toLowerCase().replace(/,/g, "");
  if (!t) return 0;
  const n = parseFloat(t);
  if (/^[\d.]+\s*k\+?$/.test(t)) return Math.round(n * 1000);
  if (/^[\d.]+\s*l\+?$/.test(t)) return Math.round(n * 100000);
  if (/^[\d.]+\s*m\+?$/.test(t)) return Math.round(n * 1000000);
  return parseInt(t.replace(/[^0-9]/g, ""), 10) || 0;
};
export const creatorId = (c) => c?.user_id || c?.id;
export const followersOf = (c) => parseCount(c?.followers_count || c?.follower_count || c?.followers_instagram || c?.ig_followers || c?.followers_youtube || 0);
export const rateOf = (c) => Number(c?.rate_reel || c?.reel_rate || c?.rate_card?.reels || c?.rate_card?.reel || c?.base_rate || c?.rate || 0) || 0;
const nicheText = (c) => String(c?.content_niches || c?.category || "").toLowerCase();
const nameOf = (c) => String(c?.full_name || c?.name || "").trim();
export const isVerified = (c) => c?.verified === true || c?.is_verified === true || c?.kyc_verified === true;
const photoOf = (c) => c?.photo || c?.profile_photo_url || c?.picture || c?.avatar_url || "";
const short = (n) => {
  if (!n) return "";
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n);
};
const rupees = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
const rupeesShort = (n) => `₹${short(n)}`;
// Session 43 (Ravi): only the creator's PRIMARY niche (category); the niche list only if none.
const firstNiche = (c) => {
  const raw = String(c?.category || "").trim() || (Array.isArray(c?.content_niches) ? c.content_niches[0] : String(c?.content_niches || "").split(",")[0]);
  // v271 (Ravi): "category" itself is sometimes a list ("Entertainment, Lifestyle, Art") — first one only.
  return String(raw || "").split(/\s*[,|/;]\s*/)[0].trim();
};
const initials = (s) => initialsOf(s); // v346: emoji-safe
const GRADIENTS = ["#E4CBB6,#5B4030", "#D9C4E8,#3F2C58", "#C9E4D6,#2C5846", "#F2D2C2,#7A3B2A", "#C8D6F0,#2B3F66", "#EAD9B5,#5E4A22"];
const gradientFor = (id) => GRADIENTS[String(id || "").split("").reduce((a, ch) => a + ch.charCodeAt(0), 0) % GRADIENTS.length];

/** v429 (Ravi: "jitna screen pr hai bas utna load karo", like Amazon / Flipkart): Explore shows 20 creators first and
 *  adds 20 more when the user scrolls near the end — so only the photos on screen are downloaded (photos were the
 *  Supabase egress). Without IntersectionObserver (very old phones) everything shows, as before. */
export const EXPLORE_STEP = 20;
function MoreOnScroll({ onMore }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { onMore(true); return undefined; }
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) onMore(false); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore]);
  return <div ref={ref} aria-hidden="true" className="h-px col-span-2" data-testid="explore-more-sentinel" />;
}

/** The creators Explore may show — shared rule, see src/lib/visibleCreators.js (v286). */
export { visibleCreators };

/** Apply search + filters. `f` = { categories:[], followers:[], maxRate:number(0=any), city:string } */
export function applyFilters(list, search, f) {
  const term = String(search || "").trim().toLowerCase();
  // Session 43 (Ravi): "Jaipur creators" / "Faridabad" is a place search — that city first, then
  // creators nearby (50 km, else 100 km), each with "12 km from Faridabad".
  const place = term ? placeFromSearch(term) : null;
  if (place) {
    const rest = applyFilters(list, "", f);
    const withDist = rest.map((c) => {
      const d = distanceKm(place.point, cityPoint(`${c.city || ""} ${c.state || ""}`) || cityPoint(c.city));
      return d == null ? null : { ...c, __distanceKm: d, __nearCity: place.city };
    }).filter(Boolean);
    const within = (km) => withDist.filter((c) => c.__distanceKm <= km);
    const pick = within(50).length ? within(50) : within(100);
    return pick.sort((a, b) => a.__distanceKm - b.__distanceKm);
  }
  return sortCreators(list.filter((c) => {
    if (!extraMatch(c, f)) return false; // v451 (BRD §24): gender / language / platform / follower range / cities
    if (term) {
      const hay = `${nameOf(c)} ${c.instagram_handle || c.handle || ""} ${c.city || ""} ${c.state || ""} ${nicheText(c)}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    if (f.categories.length) {
      const nt = nicheText(c);
      // Session 58 (bug hunt): match whole words — "ai" was matching "chai" / "hair", "style" every "lifestyle".
      const ok = f.categories.some((lab) => (CATEGORY_CHIPS.find((x) => x.label === lab)?.keys || [lab.toLowerCase()]).some((k) => wordIn(nt, k)));
      if (!ok) return false;
    }
    if (f.followers.length) {
      const fc = followersOf(c);
      if (!f.followers.some((k) => { const r = FOLLOWER_RANGES.find((x) => x.key === k); return r && fc >= r.min && fc < r.max; })) return false;
    }
    if (f.maxRate && RATES_PUBLIC) { // v430: no rate filter while rates are private
      const r = rateOf(c);
      if (!r || r > f.maxRate) return false;
    }
    if (String(f.city || "").trim()) {
      const city = `${c.city || ""} ${c.state || ""}`.toLowerCase();
      if (!city.includes(f.city.trim().toLowerCase())) return false;
    }
    return true;
  }), f.sort);
}

// v451 (Ravi's BRD §24): the new filters. Every field is optional, so old saved filters keep working. Pure.
export const SORTS = [["", "Recommended"], ["followers", "Most followers"], ["reach", "Highest avg reach"], ["engagement", "Best engagement"]];
export const LANGUAGES = ["Hindi", "English", "Hinglish", "Bengali", "Gujarati", "Marathi", "Punjabi", "Tamil", "Telugu", "Kannada", "Malayalam", "Odia"];
export const PLATFORMS = ["Instagram", "YouTube"];
const reachOf = (c) => parseCount(c?.avg_reach_per_reel || c?.avg_reach || c?.avg_views_30d || 0);
export function extraMatch(c, f) {
  if (f.gender && String(c?.gender || "").toLowerCase() !== f.gender) return false;
  if (f.languages?.length) {
    const langs = (Array.isArray(c?.languages) ? c.languages : String(c?.languages || "").split(",")).map((x) => String(x).trim().toLowerCase());
    if (!f.languages.some((l) => langs.includes(l.toLowerCase()))) return false;
  }
  if (f.platforms?.length) {
    const has = { Instagram: Boolean(c?.instagram_handle || c?.instagram || followersOf(c)), YouTube: Boolean(c?.youtube || Number(c?.followers_youtube) > 0) };
    if (!f.platforms.some((p) => has[p])) return false;
  }
  if (f.fmin || f.fmax) {
    const n = followersOf(c);
    if (f.fmin && n < f.fmin) return false;
    if (f.fmax && n > f.fmax) return false;
  }
  if (f.cities?.length) {
    const city = `${c?.city || ""} ${c?.state || ""}`.toLowerCase();
    if (!f.cities.some((x) => city.includes(String(x).toLowerCase()))) return false;
  }
  return true;
}
export function sortCreators(list, sort) {
  if (!sort) return list;
  const key = sort === "followers" ? followersOf : sort === "reach" ? reachOf : (c) => Number(c?.engagement_rate) || 0;
  return [...list].sort((a, b) => key(b) - key(a));
}

const EMPTY = { categories: [], followers: [], maxRate: 0, city: "", cities: [], gender: "", languages: [], platforms: [], fmin: 0, fmax: 0, sort: "" };
const EXPLORE_KEEP = { at: 0, all: null, search: "", filters: null, shown: 0, y: 0 }; // v451: survives Back (same tab)

// v415: Escape closes an open sheet (keyboard / desktop-width tablets)
function useEscape(active, onClose) {
  const ref = React.useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active || typeof document === "undefined") return undefined;
    const onKey = (e) => { if (e.key === "Escape") ref.current?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}
export const filterCount = (f) => ({ sort: f.sort ? 1 : 0, category: f.categories.length, location: (f.cities?.length || 0) + (String(f.city || "").trim() ? 1 : 0), followers: f.followers.length + (f.fmin || f.fmax ? 1 : 0), gender: f.gender ? 1 : 0, language: f.languages?.length || 0, platform: f.platforms?.length || 0 });
const isFiltered = (f) => f.categories.length > 1 || f.followers.length > 0 || f.maxRate > 0 || String(f.city || "").trim() !== "" || Boolean(f.cities?.length || f.gender || f.languages?.length || f.platforms?.length || f.fmin || f.fmax || f.sort);

function Avatar({ c, size = 48, radius = 14 }) {
  const src = photoOf(c);
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="object-cover shrink-0" style={{ width: size, height: size, borderRadius: radius }} />;
  }
  return (
    <div className="shrink-0 flex items-center justify-center text-white font-bold" style={{ width: size, height: size, borderRadius: radius, background: `linear-gradient(160deg,${gradientFor(creatorId(c))})`, fontSize: size / 3.2 }}>
      {initials(nameOf(c))}
    </div>
  );
}

function Pill({ active, onClick, children, testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className={`h-[34px] px-[13px] rounded-[10px] flex items-center text-[12.5px] shrink-0 whitespace-nowrap ${active ? "bg-[#0A0A0A] text-white font-semibold" : "bg-[#F2F2F7] text-[#4B5563] font-medium"}`}>
      {children}
    </button>
  );
}

function SheetChip({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`h-[34px] px-3 rounded-[10px] flex items-center text-[12.5px] border ${active ? "bg-[#F5F0FF] border-[#DDD6FE] text-[#7C3AED] font-semibold" : "bg-[#F9F9FB] border-[#E5E5EA] text-[#5F6672] font-medium"}`}>
      {children}
    </button>
  );
}

// Place search header: exact city found, or "none in X yet — nearby".
function NearbyNote({ results }) {
  const city = results[0].__nearCity;
  const exact = results.filter((c) => c.__distanceKm < 3).length;
  return (
    <div className="rounded-2xl bg-[#F3EDFF] text-[#5B21B6] px-3.5 py-2.5 text-[12.5px] leading-snug" data-testid="explore-nearby-note">
      {exact ? `${exact} creator${exact === 1 ? "" : "s"} in ${city}${results.length > exact ? ", then nearby" : ""}` : `No creators in ${city} yet — showing creators near ${city}`}
    </div>
  );
}

// "12 km from Faridabad" in a place search; the city otherwise.
const whereText = (c) => (c.__distanceKm != null && c.__distanceKm >= 3 ? `${Math.round(c.__distanceKm)} km from ${c.__nearCity}` : c.city || "");

// EX-01 grid card — v450 (Ravi's BRD §9): clean photo on top (no chip on it), soft gradient only on the lower part,
// then CATEGORY → name → followers → city (left) + avg reach (right). No rate, no invented badge.
function GridCard({ c, onOpen }) {
  const fc = followersOf(c), niche = firstNiche(c);
  const [photoBroken, setPhotoBroken] = useState(false);
  const photo = photoBroken ? "" : photoOf(c);
  const reach = parseCount(c.avg_reach_per_reel || c.avg_reach || c.avg_views_30d || 0);
  const where = whereText(c);
  return (
    <button type="button" onClick={onOpen} data-testid={`explore-card-${creatorId(c)}`}
      className="w-full aspect-[3/4] rounded-2xl overflow-hidden relative text-left" style={{ background: `linear-gradient(160deg,${gradientFor(creatorId(c))})` }}>
      {photo && <img src={photo} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" onError={() => setPhotoBroken(true)} />}
      {!photo && <div className="absolute inset-x-0 top-[22%] flex justify-center" data-testid="explore-card-monogram"><span className="w-14 h-14 rounded-full bg-white/90 text-[#334155] text-[18px] font-bold flex items-center justify-center shadow-[0_6px_18px_-8px_rgba(15,23,42,.45)]">{initials(nameOf(c))}</span></div>}
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,rgba(10,10,14,0) 42%,rgba(10,10,14,.45) 64%,rgba(10,10,14,.78) 100%)" }} />
      <div className="absolute left-[11px] right-[11px] bottom-[10px]">
        {niche && <div className="text-[8.5px] font-bold uppercase tracking-[.8px] text-[#C4B5FD] truncate">{String(niche).split(" & ")[0]}</div>}
        <div className="mt-0.5 text-[16px] leading-[1.15] font-semibold text-white truncate">{nameOf(c)}</div>
        {fc > 0 && <div className="mt-0.5 text-[12px] text-white/75 truncate">{short(fc)} followers</div>}
        {(where || reach > 0) && (
          <div className="mt-1 flex items-end justify-between gap-2">
            <div className="min-w-0 flex items-center gap-1 text-[11px] text-white/85">{where && <><MapPin size={10} className="shrink-0" /><span className="truncate">{where}</span></>}</div>
            {reach > 0 && <div className="text-right shrink-0"><div className="text-[15px] font-bold text-white leading-none">{short(reach)}</div><div className="text-[9.5px] text-white/75 mt-0.5 whitespace-nowrap">Avg reach</div></div>}
          </div>
        )}
      </div>
    </button>
  );
}

// EX-03 row with select circle
function ResultRow({ c, selected, selectable, onToggle, onOpen }) {
  const fc = followersOf(c), rate = rateOf(c), niche = firstNiche(c);
  const reach = parseCount(c.avg_reach_per_reel || c.avg_reach || c.avg_views_30d || 0);
  return (
    <div className={`bg-white rounded-[18px] border p-3 flex items-center gap-3 ${selected ? "border-[#7C3AED]" : "border-[#E6E6EE]"}`}>
      {selectable && (
        // v332: 40px tap area around the 24px circle (it was easy to miss and open the profile instead)
        <button type="button" onClick={onToggle} aria-label={selected ? `Unselect ${nameOf(c)}` : `Select ${nameOf(c)}`} aria-pressed={selected} data-testid={`explore-select-${creatorId(c)}`}
          className="w-10 h-10 -m-2 shrink-0 flex items-center justify-center">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${selected ? "bg-[#7C3AED] border-[#7C3AED]" : "border-[#C8C8D2]"}`}>
            {selected && <Check size={14} color="#fff" strokeWidth={3} />}
          </span>
        </button>
      )}
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 flex items-center gap-3 text-left">
        <Avatar c={c} size={48} radius={14} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5"><span className="text-[14.5px] font-semibold text-[#0A0A0A] truncate">{nameOf(c)}</span>{c.is_featured && <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-semibold" data-testid="featured-badge">Featured</span>}</div>
          <div className="mt-0.5 text-xs text-[#5F6672] truncate">{[fc ? short(fc) : "", reach ? `${short(reach)} avg reach` : "", whereText(c)].filter(Boolean).join(" · ")}</div>
          {niche && <div className="mt-1.5 inline-flex h-5 px-2 rounded-md bg-[#F3EDFF] items-center text-[10px] font-bold uppercase tracking-[.5px] text-[#7C3AED]">{niche}</div>}
        </div>
        <div className="text-right shrink-0">
          {!RATES_PUBLIC ? null : rate > 0 ? (<><div className="text-[14.5px] font-bold text-[#0A0A0A]">{rupees(rate)}</div><div className="text-[11px] text-[#5F6672]">/reel</div></>) : <div className="text-[11px] text-[#5F6672]">No rate card</div>}{/* v430: rates hidden from brands for now */}
        </div>
      </button>
    </div>
  );
}

// EX-02 — v451 (Ravi's BRD §24): two-pane "All filters" like Paytm. Left: tabs (a purple count when set). Right: the
// options of that tab. Footer: Clear all + "Show N creators" (live count).
const TABS = [["sort", "Sort by"], ["category", "Category"], ["location", "Location"], ["followers", "Followers"], ["gender", "Gender"], ["language", "Language"], ["platform", "Platform"]];
const FMAX = 2000000;
const PRESETS = [["Under 10K", 0, 10000], ["10K–100K", 10000, 100000], ["100K–1M", 100000, 1000000], ["1M+", 1000000, 0]];
function Radio({ on, label, onClick }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className="w-full min-h-[46px] flex items-center gap-3 text-left text-[14.5px] text-[#0A0A0A]">
      <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${on ? "border-[#7C3AED]" : "border-[#C7C7CC]"}`}>{on && <span className="w-2.5 h-2.5 rounded-full bg-[#7C3AED]" />}</span>{label}
    </button>
  );
}
function Tick({ on, label, onClick }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick} className="w-full min-h-[46px] flex items-center gap-3 text-left text-[14.5px] text-[#0A0A0A]">
      <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${on ? "bg-[#7C3AED] border-[#7C3AED]" : "border-[#C7C7CC]"}`}>{on && <Check size={13} color="#fff" strokeWidth={3} />}</span>{label}
    </button>
  );
}
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="h-10 rounded-xl bg-[#F2F2F7] flex items-center gap-2 px-3 mb-2">
      <Search size={15} color="#8E8E93" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="flex-1 min-w-0 bg-transparent outline-none text-base text-[#0A0A0A] placeholder:text-[#ABABAB]" />
    </div>
  );
}
function RangeSlider({ min, max, onChange }) {
  // log scale so 1K–100K gets most of the track
  const toPos = (v) => (v <= 0 ? 0 : Math.round((Math.log10(Math.max(1000, v)) - 3) / (Math.log10(FMAX) - 3) * 100));
  const toVal = (p) => (p <= 0 ? 0 : Math.round(Math.pow(10, 3 + (p / 100) * (Math.log10(FMAX) - 3)) / 1000) * 1000);
  const lo = toPos(min), hi = max ? toPos(max) : 100;
  return (
    <div className="relative h-8 mt-3" data-testid="followers-range">
      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-[#E5E5EA]" />
      <div className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-[#7C3AED]" style={{ left: `${lo}%`, right: `${100 - hi}%` }} />
      <input type="range" min={0} max={100} value={lo} aria-label="Minimum followers" onChange={(e) => onChange(toVal(Math.min(Number(e.target.value), hi - 4)), max)} className="yb-dual absolute inset-0 w-full" />
      <input type="range" min={0} max={100} value={hi} aria-label="Maximum followers" onChange={(e) => { const p = Math.max(Number(e.target.value), lo + 4); onChange(min, p >= 100 ? 0 : toVal(p)); }} className="yb-dual absolute inset-0 w-full" />
      <style>{".yb-dual{-webkit-appearance:none;appearance:none;background:transparent;pointer-events:none;height:32px}.yb-dual::-webkit-slider-thumb{-webkit-appearance:none;pointer-events:auto;width:24px;height:24px;border-radius:50%;background:#fff;border:2px solid #7C3AED;box-shadow:0 2px 6px rgba(0,0,0,.15)}.yb-dual::-moz-range-thumb{pointer-events:auto;width:22px;height:22px;border-radius:50%;background:#fff;border:2px solid #7C3AED}"}</style>
    </div>
  );
}
function FilterSheetBody({ open, initial, base, search = "", onCancel, onApply }) {
  const [draft, setDraft] = useState({ ...EMPTY, ...initial });
  const [tab, setTab] = useState("sort");
  const [q, setQ] = useState("");
  useEffect(() => { if (open) setDraft({ ...EMPTY, ...initial }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setQ(""), [tab]);
  useEscape(open, onCancel);
  const count = useMemo(() => applyFilters(base, search, draft).length, [base, search, draft]);
  const cityHits = useMemo(() => { const t = q.trim(); return t.length >= 2 ? searchLocations(t, 12).map((x) => x.name) : []; }, [q]);
  if (!open) return null;
  const counts = filterCount(draft);
  const toggle = (field, v) => setDraft((d) => ({ ...d, [field]: (d[field] || []).includes(v) ? d[field].filter((x) => x !== v) : [...(d[field] || []), v] }));
  const term = q.trim().toLowerCase();
  const fmt = (n) => (n ? short(n) : "");
  return (
    <ModalPortal>
      <PopupBackdrop className="fixed inset-0 z-[80] bg-[rgba(10,10,14,.45)] backdrop-blur-[3px]" onClick={onCancel} />
      <PopupPanel kind="sheet" onClose={onCancel} className="fixed left-0 right-0 bottom-0 z-[81] bg-white rounded-t-[26px] flex flex-col overflow-hidden" style={{ height: "86dvh", maxHeight: "86vh" }} data-testid="explore-filter-sheet">
        <div className="pt-2.5 px-[18px] shrink-0">
          <div className="w-10 h-[5px] rounded-[3px] bg-[#E0E0E6] mx-auto" />
          <div className="mt-3 mb-3 text-lg font-bold text-[#0A0A0A]">All filters</div>
        </div>
        <div className="flex-1 min-h-0 flex border-t border-[#ECECF0]">
          <div className="w-[128px] shrink-0 bg-[#F2F2F7] overflow-y-auto" role="tablist" aria-orientation="vertical">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`filter-tab-${id}`}
                className={`relative w-full min-h-[52px] px-3 text-left text-[13.5px] flex items-center justify-between gap-1 ${tab === id ? "bg-white font-semibold text-[#0A0A0A]" : "text-[#3D3D45]"}`}>
                {tab === id && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-[#7C3AED]" />}
                <span>{label}</span>{counts[id] > 0 && <span className="text-[11px] font-bold text-[#7C3AED]">{counts[id]}</span>}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 overflow-y-auto px-4 py-3" role="tabpanel">
            {tab === "sort" && <div role="radiogroup">{SORTS.map(([k, l]) => <Radio key={k} on={(draft.sort || "") === k} label={l} onClick={() => setDraft((d) => ({ ...d, sort: k }))} />)}</div>}
            {tab === "category" && (<>
              <SearchBox value={q} onChange={setQ} placeholder="Search category" />
              {CATEGORY_CHIPS.filter((x) => !term || x.label.toLowerCase().includes(term) || x.keys.some((k) => k.includes(term))).map((x) => <Tick key={x.label} on={draft.categories.includes(x.label)} label={x.label} onClick={() => toggle("categories", x.label)} />)}
            </>)}
            {tab === "location" && (<>
              <SearchBox value={q} onChange={setQ} placeholder="Type a city or area" />
              {(draft.cities || []).map((c) => <Tick key={`s-${c}`} on label={c} onClick={() => toggle("cities", c)} />)}
              {cityHits.filter((c) => !(draft.cities || []).includes(c)).map((c) => <Tick key={c} on={false} label={c} onClick={() => { toggle("cities", c); setQ(""); }} />)}
              {!term && !(draft.cities || []).length && <div className="text-[13px] text-[#8E8E93] mt-2">Search any city in India.</div>}
            </>)}
            {tab === "followers" && (<>
              <div className="grid grid-cols-2 gap-2">
                {[["Min", draft.fmin, (v) => setDraft((d) => ({ ...d, fmin: v, followers: [] }))], ["Max", draft.fmax, (v) => setDraft((d) => ({ ...d, fmax: v, followers: [] }))]].map(([l, v, set]) => (
                  <label key={l} className="block"><span className="text-[11px] font-semibold text-[#8E8E93]">{l}</span>
                    <input inputMode="numeric" value={v ? String(v) : ""} placeholder={l === "Min" ? "0" : "Any"} onChange={(e) => set(Number(e.target.value.replace(/\D/g, "")) || 0)}
                      className="mt-1 w-full h-10 rounded-xl border border-[#E5E5EA] px-3 text-base text-[#0A0A0A] outline-none focus:border-[#7C3AED]" />
                  </label>
                ))}
              </div>
              <RangeSlider min={draft.fmin || 0} max={draft.fmax || 0} onChange={(a, b) => setDraft((d) => ({ ...d, fmin: a, fmax: b, followers: [] }))} />
              <div className="text-[12px] text-[#5F6672] text-center">{fmt(draft.fmin) || "0"} – {fmt(draft.fmax) || "any"} followers</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map(([l, a, b]) => <SheetChip key={l} active={draft.fmin === a && draft.fmax === b} onClick={() => setDraft((d) => ({ ...d, fmin: a, fmax: b, followers: [] }))}>{l}</SheetChip>)}
              </div>
            </>)}
            {tab === "gender" && <div role="radiogroup">{[["", "Any"], ["female", "Female"], ["male", "Male"]].map(([k, l]) => <Radio key={k} on={(draft.gender || "") === k} label={l} onClick={() => setDraft((d) => ({ ...d, gender: k }))} />)}</div>}
            {tab === "language" && (<>
              <SearchBox value={q} onChange={setQ} placeholder="Search language" />
              {LANGUAGES.filter((l) => !term || l.toLowerCase().includes(term)).map((l) => <Tick key={l} on={(draft.languages || []).includes(l)} label={l} onClick={() => toggle("languages", l)} />)}
            </>)}
            {tab === "platform" && PLATFORMS.map((p) => <Tick key={p} on={(draft.platforms || []).includes(p)} label={p} onClick={() => toggle("platforms", p)} />)}
          </div>
        </div>
        <div className="shrink-0 border-t border-[#ECECF0] px-4 pt-3 flex gap-[9px]" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))" }}>
          <button type="button" onClick={() => setDraft(EMPTY)} className="h-[50px] px-5 rounded-[14px] bg-[#F2F2F7] text-[14.5px] font-semibold text-[#0A0A0A]">Clear all</button>
          <button type="button" onClick={() => onApply(draft)} data-testid="explore-show-results" className="flex-1 h-[50px] rounded-[14px] bg-[#7C3AED] text-white text-[14.5px] font-semibold">
            Show {count.toLocaleString("en-IN")} creator{count === 1 ? "" : "s"}
          </button>
        </div>
      </PopupPanel>
    </ModalPortal>
  );
}

// Session 37: stays mounted for its closing animation.
function FilterSheet(props) {
  return <Presence>{props.open && <FilterSheetBody key="filtersheet" {...props} />}</Presence>;
}


// EX-05 (one or many creators)
// Session 58 (Eva handoff §7.1): from Eva, `hideRate` hides the creator's rate (rates are private for brands)
// and `budget` prefills "Your offer" with the brand's budget per creator.
function InviteSheetBody({ open, creators, onClose, onSent, hideRate = false, budget = 0 }) {
  const navigate = useNavigate();
  const { isBusy, anyBusy, run } = useBusy();
  const [campaigns, setCampaigns] = useState(null);
  const [campaignsError, setCampaignsError] = useState(false); // v344: failed load ≠ "no live campaign"
  const [campaignsTick, setCampaignsTick] = useState(0);
  const [picked, setPicked] = useState("");
  const [fee, setFee] = useState("");
  const [message, setMessage] = useState("");
  useScrollLock(open);
  useEscape(open, () => { if (!anyBusy) onClose(); }); // v415: Escape closes (not while sending)
  const single = creators.length === 1 ? creators[0] : null;
  const cardRate = single && !hideRate && RATES_PUBLIC ? rateOf(single) : 0; // v430

  useEffect(() => {
    if (!open) return;
    setPicked(""); setMessage(""); setFee(budget ? String(budget) : cardRate ? String(cardRate) : "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setCampaigns(null); setCampaignsError(false); // v344
    // The brand's OWN campaigns (desktop Explore used to list every brand's live campaign).
    api.get("campaigns?mine=true").then(({ data }) => {
      if (!alive) return;
      const list = (Array.isArray(data) ? data : []).filter((c) => {
        const st = String(c.status || "").toLowerCase();
        return (st === "live" || st === "approved") && !c.closed_at;
      });
      setCampaigns(list);
    }).catch(() => { if (alive) { setCampaigns([]); setCampaignsError(true); } }); // v344
    return () => { alive = false; };
  }, [open, campaignsTick]);

  if (!open) return null;
  const pick = (c) => {
    const id = c.campaign_id || c.id;
    setPicked(id);
    if (!message.trim()) setMessage(String(c.description || "").slice(0, 1500));
    if (!fee && c.budget_min) setFee(String(c.budget_min));
  };
  const pickedCampaign = (campaigns || []).find((c) => (c.campaign_id || c.id) === picked);
  const feeNum = Number(String(fee).replace(/[^0-9.]/g, ""));

  const send = () => run("send", async () => {
    if (!message.trim()) { toast.error("Please write a short message for the creator.", { id: "explore-invite" }); return; } // v416: one toast, no stack
    if (!feeNum || feeNum < MIN_INVITE) { toast.error(`Please enter the fee you are offering (${rupees(MIN_INVITE)} or more).`, { id: "explore-invite" }); return; }
    let ok = 0;
    const failed = []; // v416 (C6/CR9): { id, why }
    for (const c of creators) {
      try {
        await api.post(`/creators/${creatorId(c)}/send-brief`, {
          campaign_title: pickedCampaign?.title || undefined,
          campaign_description: message.trim(),
          budget_range: String(feeNum),
          deliverables: pickedCampaign?.deliverables ? (Array.isArray(pickedCampaign.deliverables) ? deliverablesLabel(pickedCampaign.deliverables) /* v415 */ : String(pickedCampaign.deliverables)) : undefined,
          message: message.trim(),
          pitch: message.trim(),
          campaign_id: picked || undefined, // v416 (C7): the invite is linked to the picked campaign (same as desktop)
        });
        ok++;
      } catch (err) {
        failed.push({ id: creatorId(c), why: `${nameOf(c) || "Creator"}: ${inviteFailReason(err)}` });
      }
    }
    const reasons = failed.slice(0, 3).map((f) => f.why).join(" · ") + (failed.length > 3 ? ` · +${failed.length - 3} more` : "");
    if (ok === creators.length) {
      toast.success(ok === 1 ? "Invite sent" : `Invites sent to ${ok} creators`, { position: "top-center", id: "explore-invite" });
      onSent?.();
    } else if (ok > 0) {
      // v416 (C6/CR9): say who and why; the ones that failed stay selected (it cleared the whole selection)
      toast.warning(`Sent to ${ok} of ${creators.length} creators. The rest are still selected.`, { position: "top-center", id: "explore-invite", description: reasons, duration: 8000 });
      onSent?.(failed.map((f) => f.id));
    } else {
      toast.error(creators.length === 1 ? "Couldn't send the invite." : "Couldn't send the invites.", { position: "top-center", id: "explore-invite", description: reasons, duration: 8000 }); // v416: real reason
    }
  });

  const title = single ? `Invite ${nameOf(single).split(" ")[0] || "creator"} to a campaign` : `Invite ${creators.length} creators to a campaign`;
  return (
    <ModalPortal>
      <PopupBackdrop className="fixed inset-0 z-[80] bg-[rgba(10,10,14,.45)]" onClick={() => !anyBusy && onClose()} />
      <PopupPanel kind="sheet" onClose={() => !anyBusy && onClose()} className="fixed left-0 right-0 bottom-0 z-[81] bg-white rounded-t-[26px] px-[18px] pt-2.5 flex flex-col gap-3.5 max-h-[90vh] max-h-[90dvh] overflow-y-auto" /* v332: dvh */ style={{ paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))" }} data-testid="explore-invite-sheet">
        <div className="w-10 h-[5px] rounded-[3px] bg-[#E0E0E6] self-center" />
        <div className="flex items-start justify-between gap-3">
          <div className="text-lg leading-[1.3] font-bold text-[#0A0A0A]">{title}</div>
          <button type="button" onClick={onClose} disabled={anyBusy} aria-label="Close" className="w-10 h-10 -mr-1 rounded-full bg-[#F2F2F7] flex items-center justify-center shrink-0"><X size={16} /></button>{/* v332: 40px */}
        </div>
        <div className="flex flex-col gap-2">
          {campaigns === null && <Shimmer className="h-[58px] rounded-2xl" />}
          {campaignsError && ( /* v344 */
            <div className="flex items-center gap-2 text-[13px] text-[#B91C1C]" role="alert">
              <span className="flex-1">Couldn't load your campaigns</span>
              <button type="button" onClick={() => setCampaignsTick((t) => t + 1)} className="min-h-[36px] px-3 rounded-xl bg-[#F3EDFF] text-[#7C3AED] font-semibold">Retry</button>
            </div>
          )}
          {campaigns && campaigns.length === 0 && !campaignsError && <div className="text-[13px] text-[#5F6672]">You have no live campaign. You can still send an invite with your own message.</div>}
          {(campaigns || []).map((c) => {
            const id = c.campaign_id || c.id; const on = id === picked;
            const min = Number(c.budget_min || 0), max = Number(c.budget_max || 0);
            const budget = min && max && max !== min ? `${rupeesShort(min)}–${short(max)}` : (min || max) ? rupeesShort(min || max) : "";
            return (
              <button type="button" key={id} onClick={() => pick(c)} className={`flex items-center gap-3 px-3.5 py-3 rounded-2xl text-left ${on ? "border-[1.5px] border-[#7C3AED] bg-[#FBF9FF]" : "border border-[#E0E0E8] bg-white"}`}>
                <span className={`w-5 h-5 rounded-full shrink-0 box-border ${on ? "border-[6px] border-[#7C3AED]" : "border-2 border-[#C8C8D2]"}`} />
                <span className="flex-1 min-w-0"><span className="block text-sm font-semibold text-[#0A0A0A] truncate">{c.title || "Untitled campaign"}</span>{budget && <span className="block text-xs text-[#5F6672]">{budget}</span>}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => { onClose(); navigate("/brand/campaigns/create"); }} className="self-start text-[13px] font-semibold text-[#7C3AED] px-0.5 pt-0.5 flex items-center gap-1"><Plus size={14} /> Create a new campaign</button>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-[#374151]">{single ? "Offer for 1 Reel" : "Offer per creator"}</span>
          <div className="min-h-[50px] rounded-[14px] border border-[#E0E0E8] px-3.5 flex items-center gap-1">
            <span className="text-[15px] font-medium text-[#5F6672]">₹</span>
            <input inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))} placeholder={String(MIN_INVITE)} className="flex-1 min-w-0 outline-none text-base font-medium text-[#0A0A0A]" aria-label="Offer amount" />{/* v332: 16px stops iOS zoom */}
          </div>
          <div className="text-xs leading-[1.4] text-[#5F6672]">{budget ? `Everyone here fits up to ${rupees(budget)} per creator` : cardRate ? `Their rate card says ${rupees(cardRate)} per reel` : `Minimum ${rupees(MIN_INVITE)}`}</div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-[#374151]">Message</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="What you'd like them to create, and when." aria-label="Message" className="rounded-[14px] border border-[#E0E0E8] px-3.5 py-3 outline-none text-base text-[#0A0A0A] resize-none" />{/* v332: 16px stops iOS zoom */}
        </div>
        <button type="button" onClick={send} disabled={anyBusy} data-testid="explore-send-invite" className="h-[50px] rounded-2xl bg-[#7C3AED] text-white flex items-center justify-center gap-2 text-[15px] font-semibold disabled:opacity-60" style={{ boxShadow: "0 12px 22px -14px rgba(124,58,237,.9)" }}>
          {isBusy("send") ? <ButtonSpinner /> : <Send size={16} />} Send invite
        </button>
        <div className="-mt-1.5 text-center text-xs text-[#5F6672]">No money moves until you hire {single ? "them" : "a creator"}. Chat opens when they accept.</div>
      </PopupPanel>
    </ModalPortal>
  );
}

// Session 37: stays mounted for its closing animation.
export function InviteSheet(props) {
  return <Presence>{props.open && <InviteSheetBody key="invitesheet" {...props} />}</Presence>;
}


export default function ExploreMobile() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const isBrand = isBrandLike(user); // v416 (CR4)
  const [selectMode, setSelectMode] = useState(false); // v416 (C24): pick creators without setting a filter first
  // v451 (Ravi: Back from a creator profile "shuffled" the grid on Android): the list, search, how many cards were
  // shown and the scroll position are kept for this visit, so Back lands on the same cards in the same place.
  const inTest = typeof process !== "undefined" && Boolean(process.env?.VITEST); // each test starts clean
  const keep = !inTest && EXPLORE_KEEP.at && Date.now() - EXPLORE_KEEP.at < 30 * 60000 ? EXPLORE_KEEP : null;
  const [all, setAll] = useState(keep?.all || null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState(keep?.search || "");
  const [filters, setFilters] = useState(() => {
    if (keep?.filters && !params.get("niche") && !params.get("category") && !params.get("city")) return keep.filters; // v451
    const niche = params.get("niche") || params.get("category");
    const cat = niche ? CATEGORY_CHIPS.find((x) => x.label.toLowerCase() === niche.toLowerCase() || x.keys.some((k) => wordIn(niche, k))) : null;
    return { ...EMPTY, categories: cat ? [cat.label] : [], city: params.get("city") || "" };
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [inviteFor, setInviteFor] = useState(null);
  // v450: near-you mode (brands only)
  const loc = useBranches(isBrand);
  const [radius, setRadiusRaw] = useState(() => { const v = Number(safeStorage.getItem("yb_near_radius")); return [10, 25, 50, 100].includes(v) ? v : DEFAULT_RADIUS; });
  const [locSheet, setLocSheet] = useState(false);
  const [confirmAt, setConfirmAt] = useState(null); // { start, editing } while the map screen is open
  const [mapOpen, setMapOpen] = useState(false);
  const [nearbyOff, setNearbyOff] = useState(false); // "Get UGC videos made online" → Explore without location
  const [notifyOn, setNotifyOn] = useState(false);
  const [tipHidden, setTipHidden] = useState(false);

  const load = async () => {
    setError(false);
    try {
      const { data } = await api.get("creators/explore", { timeout: 30000 });
      const next = visibleCreators(Array.isArray(data) ? data : []);
      // same creators as on screen → keep the list object (no re-render, no photo flash)
      setAll((cur) => (cur && cur.length === next.length && cur.every((c, i) => creatorId(c) === creatorId(next[i])) ? cur : next));
    } catch {
      setAll((cur) => { if (cur && cur.length) return cur; setError(true); return []; });
    }
  };
  useEffect(() => { if (!keep || Date.now() - keep.at > 2 * 60000) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const base = all || [];
  const featuredSet = useFeaturedCreators();
  const results = useMemo(() => { const r = applyFilters(base, search, filters); return r[0]?.__nearCity ? r : featuredFirst(r, featuredSet); }, [base, search, filters, featuredSet]); // session 36 · 43: place search keeps distance order
  const [shown, setShown] = useState(keep?.shown || EXPLORE_STEP);
  const firstFilterRun = React.useRef(true);
  useEffect(() => { if (firstFilterRun.current) { firstFilterRun.current = false; return; } setShown(EXPLORE_STEP); }, [search, filters]); // new search / filter → start from the top 20
  // v451: remember where we were; come back to the same scroll position
  useEffect(() => { EXPLORE_KEEP.all = all; EXPLORE_KEEP.search = search; EXPLORE_KEEP.filters = filters; EXPLORE_KEEP.shown = shown; if (all) EXPLORE_KEEP.at = EXPLORE_KEEP.at && keep ? EXPLORE_KEEP.at : Date.now(); }, [all, search, filters, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // the app scrolls inside #app-scroll-container (Layout); older pages / desktop scroll the window
    const box = typeof document !== "undefined" ? document.getElementById("app-scroll-container") : null;
    const read = () => (box && box.scrollHeight > box.clientHeight ? box.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0));
    const save = () => { EXPLORE_KEEP.y = read(); };
    const target = box || window;
    target.addEventListener("scroll", save, { passive: true });
    let t1 = 0, t2 = 0;
    if (keep?.y) {
      const y = keep.y;
      const go = () => { if (box && box.scrollHeight > box.clientHeight) box.scrollTop = y; else window.scrollTo(0, y); };
      requestAnimationFrame(() => requestAnimationFrame(go));
      t1 = setTimeout(go, 80); t2 = setTimeout(go, 300); // after the page transition / Layout's scroll reset
    }
    return () => { clearTimeout(t1); clearTimeout(t2); target.removeEventListener("scroll", save); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const more = React.useCallback((all) => setShown((n) => (all ? 100000 : n + EXPLORE_STEP)), []);
  const onScreen = results.slice(0, shown);
  const verifiedCount = useMemo(() => base.filter((c) => isVerified(c)).length, [base]);
  const resultsMode = isFiltered(filters);
  const selectedCreators = base.filter((c) => selected.includes(creatorId(c)));
  const selectedTotal = selectedCreators.reduce((s, c) => s + rateOf(c), 0);
  const toggleSel = (c) => setSelected((s) => (s.includes(creatorId(c)) ? s.filter((x) => x !== creatorId(c)) : [...s, creatorId(c)]));
  const setCategory = (lab) => setFilters((f) => ({ ...f, categories: lab ? [lab] : [] }));
  const open = (c) => navigate(`/creator/${creatorId(c)}`, { state: { preview: { photo: photoOf(c), name: c?.name || "" } } }); // v429: skeleton shows the photo + name at once

  // v450: near-you list — search + category chips still apply; a typed place search keeps the old behaviour.
  const branch = loc.selected;
  const placeSearch = Boolean(search.trim() && placeFromSearch(search.trim()));
  const nearMode = isBrand && Boolean(branch) && !nearbyOff && !placeSearch && !(isBrand && selectMode);
  // v472: creators who put their area on the map are placed there (not on the city centre)
  const [areas, setAreas] = useState(null);
  useEffect(() => { if (!nearMode || areas) return; api.get("geo/creator-areas", { timeout: 15000 }).then(({ data }) => setAreas(data?.areas || {})).catch(() => setAreas({})); }, [nearMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const nearAll = useMemo(() => (nearMode ? withDistance(applyFilters(base, search, filters).map((c) => (areas && areas[creatorId(c)] ? { ...c, __area: areas[creatorId(c)] } : c)), branch) : []), [nearMode, base, search, filters, branch, areas]);
  const nearList = useMemo(() => withinRadius(nearAll, radius), [nearAll, radius]);
  const counts = useMemo(() => radiusCounts(nearAll), [nearAll]);
  const nobodyNear = nearMode && all !== null && counts[100] === 0;
  const setRadius = (r) => {
    setRadiusRaw(r); try { safeStorage.setItem("yb_near_radius", String(r)); } catch { /* fine */ }
    if (!mapOpen) toast(`${counts[r] ?? 0} creator${counts[r] === 1 ? "" : "s"} within ${r} km`, { id: "near-radius", duration: 1800, position: "top-center" });
  };
  const loggedDemand = React.useRef("");
  useEffect(() => { // BRD §L7: every empty search is logged for Admin › Area demand
    if (!nobodyNear || !branch) return undefined;
    const k = `${branch.id}|${search.trim().toLowerCase()}|${filters.categories.join(",")}`;
    if (loggedDemand.current === k) return undefined;
    // v455: wait until typing stops — every letter of "fashion" used to log its own empty search (7 rows)
    const t = setTimeout(() => {
      loggedDemand.current = k;
      api.post("brand/area-demand", { branch_id: branch.id, city: branch.city, area: branch.area, lat: branch.lat, lng: branch.lng, radius_km: 100, results: 0 }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [nobodyNear, branch, search, filters]);
  // v455: "Notify me" remembers its state for this city (it reset to the button after every reload)
  useEffect(() => {
    if (!isBrand || !branch?.city) { setNotifyOn(false); return undefined; }
    let alive = true;
    api.get("brand/area-notify", { params: { city: branch.city }, bypassCache: true }).then(({ data }) => { if (alive) setNotifyOn(Boolean(data?.on)); }).catch(() => {});
    return () => { alive = false; };
  }, [isBrand, branch?.city]); // eslint-disable-line react-hooks/exhaustive-deps
  const showTip = isBrand && !tipHidden && loc.branches !== null && !loc.flags?.map_tip_seen;
  const openMap = () => {
    if (showTip) { setTipHidden(true); loc.markFlag("map_tip_seen"); } // v455: also when there's no branch yet (the tip stayed over the sheet)
    if (!branch) { setLocSheet(true); return; }
    setNearbyOff(false); setMapOpen(true);
  };
  const notify = async (on) => {
    setNotifyOn(on);
    try { await api.post("brand/area-notify", { city: branch?.city || "", undo: !on }); } catch { setNotifyOn(!on); toast.error("Couldn't save. Try again."); }
  };
  const saveBranch = async (b) => {
    await loc.save(b);
    setConfirmAt(null); setLocSheet(false); setNearbyOff(false);
    toast.success(b.id ? "Branch updated" : "Location saved", { position: "top-center" });
  };

  const summary = [
    filters.categories.join(", "),
    filters.followers.map((k) => FOLLOWER_RANGES.find((r) => r.key === k)?.label).filter(Boolean).join(", "),
    filters.maxRate ? `up to ${rupeesShort(filters.maxRate)}` : "",
    String(filters.city || "").trim(), (filters.cities || []).join(", "),
    filters.fmin || filters.fmax ? `${filters.fmin ? short(filters.fmin) : "0"}–${filters.fmax ? short(filters.fmax) : "any"} followers` : "",
    filters.gender ? (filters.gender === "female" ? "Female" : "Male") : "", (filters.languages || []).join(", "), (filters.platforms || []).join(", "),
    filters.sort ? (SORTS.find(([k]) => k === filters.sort)?.[1] || "") : "",
  ].filter(Boolean).join(" · ");
  const activeCount = Object.values(filterCount(filters)).reduce((a, b) => a + b, 0) + (filters.maxRate ? 1 : 0);

  return (
    <div className="bg-[#F2F2F7] flex flex-col" data-testid="explore-mobile">{/* v360: no min-h-screen — a short list left an empty screen before the footer */}
      <div className="bg-white border-b border-[#E5E5EA] sticky top-0 z-30" style={{ paddingTop: 0 /* Session 43: #root starts below the clock */ }}>
        <div className="pt-3 px-4 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[22px] leading-[1.1] font-semibold tracking-[-.7px] text-[#0A0A0A]">{resultsMode ? `${results.length.toLocaleString("en-IN")} creator${results.length === 1 ? "" : "s"}` : "Explore creators"}</div>{/* v332: "1 creator" */}
            {/* v450 (BRD §2): the "613 creators · 1 verified" line is gone; brands see their location line here */}
            {resultsMode ? (
              <div className="mt-1.5 text-xs text-[#5F6672] truncate">{summary}</div>
            ) : isBrand ? (
              <LocationLine branch={branch} onClick={() => setLocSheet(true)} />
            ) : null}
          </div>
          {isBrand && !resultsMode && (
            <div className="relative shrink-0 ml-3">
              <MapButton onClick={openMap} />
              {showTip && <MapTip onGotIt={() => { setTipHidden(true); loc.markFlag("map_tip_seen"); }} />}
            </div>
          )}
          {/* Session 43 (Ravi): no profile circle here — the account is in the bottom bar. */}
          {!user && (
            <button type="button" onClick={() => navigate("/signup")} className="h-9 px-3.5 rounded-xl bg-[#7C3AED] text-white text-[13px] font-semibold shrink-0">Sign up free</button>
          )}
        </div>
        <div className="pt-3.5 px-4 flex gap-[9px]">
          <div className="flex-1 min-w-0 h-11 rounded-[14px] bg-[#F2F2F7] flex items-center gap-2.5 px-3.5">
            <Search size={16} color="#9CA3AF" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, handle or city" aria-label="Search creators" enterKeyHint="search" /* v332: 16px — iPhone zoomed the page at 14px */ className="flex-1 min-w-0 bg-transparent outline-none text-base text-[#0A0A0A] placeholder:text-[#ABABAB]" />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="w-10 h-10 -mr-3 flex items-center justify-center shrink-0">{/* v330: 32px tap area (was the 15px icon) · v332: 40px */}<X size={15} color="#9CA3AF" /></button>}
          </div>
          {isBrand && (
            <button type="button" onClick={() => { setSelectMode((v) => !v); if (selectMode) setSelected([]); }} aria-pressed={selectMode} data-testid="explore-select-toggle"
              className={`h-11 px-3.5 rounded-[14px] text-[13px] font-semibold shrink-0 border ${selectMode ? "bg-[#7C3AED] border-[#7C3AED] text-white" : "bg-white border-[#E0E0E8] text-[#0A0A0A]"}`}>
              {selectMode ? "Done" : "Select"}{/* v416 (C24) */}
            </button>
          )}
          <button type="button" onClick={() => setFilterOpen(true)} aria-label="Filters" data-testid="explore-filters-button" className="w-11 h-11 rounded-[14px] bg-[#0A0A0A] flex items-center justify-center shrink-0 relative">
            <SlidersHorizontal size={18} color="#fff" />
            {activeCount > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#7C3AED] text-white text-[10px] font-bold flex items-center justify-center">{activeCount}</span>}
          </button>
        </div>
        <div className="py-3 px-4 flex gap-2 overflow-x-auto no-scrollbar">
          {resultsMode ? (
            <>
              <Pill active onClick={() => setFilterOpen(true)}>{activeCount} filter{activeCount === 1 ? "" : "s"}</Pill>
              <button type="button" onClick={() => { setFilters(EMPTY); setSelected([]); }} className="h-[34px] px-[13px] rounded-[10px] bg-[#F2F2F7] text-[#4B5563] text-[12.5px] font-medium shrink-0 flex items-center gap-1"><X size={13} /> Clear</button>
            </>
          ) : (
            <>
              <Pill active={filters.categories.length === 0} onClick={() => setCategory(null)}>All</Pill>
              {CATEGORY_CHIPS.map((x) => <Pill key={x.label} active={filters.categories[0] === x.label} onClick={() => setCategory(x.label)} testId={`explore-chip-${x.label}`}>{x.label}</Pill>)}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 px-4 pt-3.5" style={{ paddingBottom: selected.length ? 96 : 8 /* v360: Layout already clears the bottom bar — 110px here left a big empty gap above the footer */ }}>
        {all === null ? (
          <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Shimmer key={i} className="aspect-[3/4] rounded-2xl" />)}</div>
        ) : nobodyNear ? (
          <NoCreatorsNearby branch={branch} creatorsAvatars={base.filter((c) => photoOf(c)).slice(0, 3)} notifyOn={notifyOn} onNotify={notify} onOnline={() => setNearbyOff(true)} onChange={() => setLocSheet(true)} />
        ) : nearMode && !error ? (
          <div className="flex flex-col gap-2.5" data-testid="explore-nearby-list">
            <div className="flex items-baseline justify-between px-0.5"><span className="text-[15px] font-semibold text-[#0A0A0A]">{nearList.length} creator{nearList.length === 1 ? "" : "s"} near you</span><span className="text-[12.5px] text-[#5F6672]">Nearest first</span></div>
            <RadiusControl value={radius} onChange={setRadius} />
            {nearList.length === 0 ? (
              <div className="mt-6 text-center text-[13.5px] text-[#5F6672]">No creators within {radius} km. {radius < 100 && <button type="button" onClick={() => setRadius(radius === 10 ? 25 : radius === 25 ? 50 : 100)} className="font-semibold" style={{ color: "#7C3AED" }}>Try {radius === 10 ? 25 : radius === 25 ? 50 : 100} km</button>}</div>
            ) : nearList.slice(0, shown).map((c) => <NearbyCard key={creatorId(c)} c={c} onOpen={() => open(c)} />)}
            {shown < nearList.length && <MoreOnScroll key={`n${shown}`} onMore={more} />}
          </div>
        ) : error ? (
          <OfflineAware className="mt-6" onRetry={load}>{/* v334: offline → OfflineState */}
          <div className="mt-10 text-center">
            <div className="text-[15px] font-semibold text-[#0A0A0A]">Couldn't load creators</div>
            <button type="button" onClick={load} className="mt-3 h-10 px-4 rounded-xl bg-[#7C3AED] text-white text-sm font-semibold">Try again</button>
          </div>
          </OfflineAware>
        ) : results.length === 0 ? (
          <div className="mt-10 text-center px-6">
            <div className="text-[15px] font-semibold text-[#0A0A0A]">No creators match</div>
            <div className="mt-1 text-[13px] text-[#5F6672]">Try fewer filters or a different search.</div>
            <button type="button" onClick={() => { setFilters(EMPTY); setSearch(""); }} className="mt-3 h-10 px-4 rounded-xl bg-[#F3EDFF] text-[#7C3AED] text-sm font-semibold">Clear filters</button>
          </div>
        ) : (resultsMode || (isBrand && selectMode)) ? ( /* v416 (C24): Select shows the selectable list */
          <div className="flex flex-col gap-2.5">
            {results[0]?.__nearCity && <NearbyNote results={results} />}
            {onScreen.map((c) => <ResultRow key={creatorId(c)} c={c} selectable={isBrand} selected={selected.includes(creatorId(c))} onToggle={() => toggleSel(c)} onOpen={() => open(c)} />)}
            {shown < results.length && <MoreOnScroll key={shown} onMore={more} />}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {/* v378 (Ravi: "square nahi, side space bekar"): 2 cards per row filling the width, each a 3:4 portrait */}
            {results[0]?.__nearCity && <div className="col-span-2"><NearbyNote results={results} /></div>}
            {onScreen.map((c) => <GridCard key={creatorId(c)} c={c} onOpen={() => open(c)} />)}
            {shown < results.length && <MoreOnScroll key={shown} onMore={more} />}
          </div>
        )}
      </div>

      {/* v415: the selection bar slides in / out (it used to pop in and vanish) */}
      <Presence>{isBrand && selected.length > 0 && (
        <motion.div key="selbar" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.18 }}
          className="fixed left-3 right-3 z-40 bg-[#0A0A0A] rounded-[20px] px-4 py-3 flex items-center gap-3" style={{ bottom: "calc(62px + env(safe-area-inset-bottom, 0px))" /* v348: sits on the shorter bottom bar (was 84px) */ }} data-testid="explore-selection-bar">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">{selected.length} selected</div>
            {RATES_PUBLIC && selectedTotal > 0 && <div className="text-xs text-white/70">{rupees(selectedTotal)} total at rate card</div>}
          </div>
          <button type="button" onClick={() => setInviteFor(selectedCreators)} className="h-11 px-4 rounded-[14px] bg-[#7C3AED] text-white text-sm font-semibold">Invite to campaign</button>
        </motion.div>
      )}</Presence>

      {isBrand && (
        <>
          <SelectLocationSheet open={locSheet && !confirmAt} branches={loc.branches} max={loc.max} onClose={() => setLocSheet(false)}
            onPick={(p) => setConfirmAt({ start: p })} onAddAt={(p) => setConfirmAt({ start: p })}
            onSelect={(id) => { loc.select(id); setLocSheet(false); setNearbyOff(false); }}
            onRename={(b) => setConfirmAt({ start: b, editing: b })} onDelete={(id) => loc.remove(id)} />
          {confirmAt && (
            <ConfirmLocationScreen start={confirmAt.start} editing={confirmAt.editing} existingNames={(loc.branches || []).map((b) => b.name)} isFirst={!(loc.branches || []).length}
              onBack={() => setConfirmAt(null)} onSave={saveBranch} />
          )}
          {mapOpen && branch && (
            <React.Suspense fallback={null}>
              <NearbyMapView branch={branch} creators={nearList} radius={radius} setRadius={setRadius} counts={counts}
                firstOpen={!loc.flags?.map_intro_seen} onIntroSeen={() => loc.markFlag("map_intro_seen")}
                onList={() => setMapOpen(false)} onOpenCreator={(c) => { setMapOpen(false); open(c); }} onChangeLocation={() => { setMapOpen(false); setLocSheet(true); }} />
            </React.Suspense>
          )}
        </>
      )}
      <FilterSheet open={filterOpen} initial={filters} base={base} search={search} onCancel={() => setFilterOpen(false)} onApply={(f) => { setFilters(f); setFilterOpen(false); setSelected([]); }} />
      <InviteSheet open={Boolean(inviteFor)} creators={inviteFor || []} onClose={() => setInviteFor(null)} onSent={(failedIds) => { setInviteFor(null); setSelected(Array.isArray(failedIds) && failedIds.length ? failedIds : []); /* v416 (CR9): failed ones stay selected */ }} />
    </div>
  );
}
