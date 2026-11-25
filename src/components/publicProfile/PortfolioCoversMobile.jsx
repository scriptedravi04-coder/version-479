import React, { useState } from "react";
import { Play, Heart } from "lucide-react";
import { shortCount } from "./PhotoLedHeaderMobile";
import { EntryRibbon } from "../challenge/ChallengeUi"; // v367
import { ENTRIES_CLOSE_AT } from "../../lib/diwaliChallenge";

// v415: the Diwali "Entry" ribbon only while the challenge is open — after that a brand viewing the profile
// shouldn't see festive badges on old work. Pure.
export function showChallengeRibbon(now = Date.now()) {
  return now <= ENTRIES_CLOSE_AT;
}

// v363 (Ravi: "portfolio ke pages mein preview nahi dikh raha"): on the phone public profile, portfolio items that
// carry a saved cover (portfolio item JSON {cover, brand_name, views, likes, source}) show as a cover grid, grouped
// under a brand pill. Items without a cover are left to the old link cards (the caller renders them).

/** Items with a cover, grouped by brand (no brand → "Other work"), biggest group first. Pure. */
export function groupCoversByBrand(items = []) {
  const groups = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== "object" || !it.cover) continue;
    const brand = String(it.brand_name || it.brand || "").replace(/^@/, "").trim();
    const key = brand.toLowerCase() || "__other";
    if (!groups.has(key)) groups.set(key, { brand: brand || "Other work", items: [] });
    groups.get(key).items.push(it);
  }
  return [...groups.values()].sort((a, b) => (a.brand === "Other work") - (b.brand === "Other work") || b.items.length - a.items.length);
}

// v451 (Ravi's BRD §14): one grid for all brands — "12 videos · 10 brands" + "Most viewed", one row of brand filter
// chips, then a 3-column grid of 3:4 tiles (brand initial top-left, ▶ views at the bottom), most viewed first.
function Cover({ it }) {
  const [broken, setBroken] = useState(false);
  const url = it.content_url || it.url || it.link || "";
  const brand = String(it.brand_name || it.brand || "").replace(/^@/, "").trim();
  const Tag = url ? "a" : "div";
  return (
    <Tag {...(url ? { href: url, target: "_blank", rel: "noopener noreferrer" } : {})} className="relative block aspect-[3/4] rounded-xl overflow-hidden bg-[#EDE9FE]" data-testid="work-tile">
      {!broken && <img src={it.cover} alt={it.title || brand || "Portfolio"} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="absolute inset-0 w-full h-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/55" />
      <span className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-white text-[#0A0A0A] text-[10.5px] font-black flex items-center justify-center shadow" title={brand || undefined}>{(brand || "•").charAt(0).toUpperCase()}</span>
      {showChallengeRibbon() && <EntryRibbon item={it} className="absolute top-1.5 right-1.5" />}
      <span className="absolute bottom-1.5 left-2 inline-flex items-center gap-1 text-[11px] font-bold text-white">
        <Play size={10} fill="white" /> {Number(it.views) > 0 ? `${shortCount(it.views)}${it.source === "upload" ? "*" : ""}` : (Number(it.likes) > 0 ? <><Heart size={10} /> {shortCount(it.likes)}</> : "")}
      </span>
    </Tag>
  );
}

export default function PortfolioCoversMobile({ items }) {
  const [brand, setBrand] = useState("");
  const all = (Array.isArray(items) ? items : []).filter((it) => it && typeof it === "object" && it.cover);
  if (!all.length) return null;
  const nameOf = (it) => String(it.brand_name || it.brand || "").replace(/^@/, "").trim() || "Other";
  const counts = new Map();
  for (const it of all) counts.set(nameOf(it), (counts.get(nameOf(it)) || 0) + 1);
  const brands = [...counts.entries()].sort((a, b) => (a[0] === "Other") - (b[0] === "Other") || b[1] - a[1]);
  const realBrands = brands.filter(([b]) => b !== "Other").length;
  const shown = all.filter((it) => !brand || nameOf(it) === brand).sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0));
  const selfReported = all.some((it) => it?.source === "upload" && Number(it?.views) > 0);
  const chip = (on) => `h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap border ${on ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-white text-[#0A0A0A] border-[#ECECF0]"}`;
  return (
    <div data-testid="public-portfolio-covers">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="font-bold text-[#0A0A0A]">{all.length} video{all.length === 1 ? "" : "s"}{realBrands ? ` · ${realBrands} brand${realBrands === 1 ? "" : "s"}` : ""}</span>
        <span className="font-semibold text-[#5F6672]">Most viewed</span>
      </div>
      {brands.length > 1 && (
        <div className="mt-2.5 -mx-5 px-5 flex gap-2 overflow-x-auto no-scrollbar" data-testid="work-brand-chips">
          <button type="button" className={chip(!brand)} onClick={() => setBrand("")}>All {all.length}</button>
          {brands.map(([b, n]) => <button key={b} type="button" className={chip(brand === b)} onClick={() => setBrand(b)}>{b} {n}</button>)}
        </div>
      )}
      <div className="mt-3 grid grid-cols-3" style={{ gap: 6 }}>
        {shown.map((it, i) => <Cover key={`${it.id || it.content_url || i}-${i}`} it={it} />)}
      </div>
      {selfReported && <p className="mt-2 text-[10.5px] font-medium text-[#5F6672]">* views on uploaded videos are self-reported</p>}
    </div>
  );
}
