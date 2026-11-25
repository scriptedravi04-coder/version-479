import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, Share2, Heart, Star, Send, Pencil, Sparkles, ExternalLink, Lock } from "lucide-react";
import PortfolioCoversMobile from "./PortfolioCoversMobile";
import { Shimmer } from "../common/ContentSkeletons"; // v453: skeleton rows, not a spinner
import useBackToClose from "../../lib/popupRules";

// v363 (Ravi's design 1f "Public profile — photo-led, live stats"): on phones the creator's face is the cover
// and fades into the page colour (sampled from the photo — see adaptiveTheme.js), then chips, name, one CTA and one
// glass panel with the four numbers. Numbers are never invented: "—" when we don't have them.

/** 10376 → "10.4K", 1250000 → "12.5L" style short counts (Indian). null → "—". Pure. */
export function shortCount(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, "")}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, "")}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}
const fullCount = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) || n <= 0 ? "—" : Math.round(n).toLocaleString("en-IN");
};

/** The four numbers of the stats panel + whether they're live from Instagram. Pure. */
export function profileNumbers(c = {}) {
  const st = c.instagram_stats && typeof c.instagram_stats === "object" ? c.instagram_stats : {};
  const pick = (...xs) => xs.find((x) => x !== null && x !== undefined && x !== "" && Number(x) > 0);
  const er = [st.engagement_rate, c.engagement_rate].find((x) => x !== null && x !== undefined && x !== "" && Number.isFinite(Number(x)) && Number(x) > 0);
  return {
    followers: pick(c.ig_followers, c.followers_instagram, c.follower_count, st.followers),
    views: pick(c.avg_views_30d, st.avg_views, st.reach_28d),
    likes: pick(c.avg_likes_30d, st.avg_likes),
    er: er === undefined ? null : Number(er),
    live: Boolean(c.instagram_synced_at) && !st.error,
  };
}

/** v430: the creator's Instagram page, from whatever field has the handle. "" when unknown. Pure. */
export function instagramUrlOf(c = {}) {
  const st = c.instagram_stats && typeof c.instagram_stats === "object" ? c.instagram_stats : {};
  const raw = String(c.instagram_handle || c.instagram || st.username || c.social_handle || "").trim();
  if (!raw) return "";
  const m = raw.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i);
  const h = (m ? m[1] : raw).replace(/^@+/, "").replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? `https://www.instagram.com/${h}/` : "";
}
function IgGlyph({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs><linearGradient id="ybIgG" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#FEDA75" /><stop offset=".35" stopColor="#FA7E1E" /><stop offset=".6" stopColor="#D62976" /><stop offset=".85" stopColor="#962FBF" /><stop offset="1" stopColor="#4F5BD5" /></linearGradient></defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ybIgG)" />
      <circle cx="12" cy="12" r="4.3" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="17.4" cy="6.6" r="1.3" fill="#fff" />
    </svg>
  );
}


// ═══ v432 (Ravi's redesign 2b "one page, tap-to-Instagram, rates coming soon") ═══════════════════════════════
// The phone creator profile is ONE scroll: the face fades into the page colour (adaptiveTheme.js), name + verified
// tick, the Instagram handle (shine, opens Instagram), the four numbers sit on the page (no box), one info line,
// jump chips (Work · Reviews · About · Rates) that stick to the top with the name once you scroll, and the
// "Send collab request" bar stays at the bottom. Every card uses the page colour — no white desktop cards.

export const PROFILE_SECTIONS = [["work", "Work"], ["reviews", "Reviews"], ["about", "About"], ["rates", "Rates"]];
export const LIGHT_PAGE = { mode: "light", bg: "#F2F2F7", text: "#0A0A0A", sub: "rgba(10,10,10,.6)", glass: "#FFFFFF", glassBorder: "#ECECF0", ctaBg: "#7C3AED", ctaText: "#FFFFFF", chipBg: "rgba(10,10,10,.06)" };
const SHINE_CSS = "@keyframes ybShine{0%{background-position:120% 0}45%,100%{background-position:-60% 0}}"
  + ".yb-handle-shine{text-decoration:underline;text-decoration-color:var(--yb-b);text-underline-offset:3px;text-decoration-thickness:1.5px;background-image:linear-gradient(100deg,var(--yb-b) 0%,var(--yb-b) 40%,var(--yb-g) 50%,var(--yb-b) 60%,var(--yb-b) 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:ybShine 3.6s ease-in-out infinite}"
  + "@media (prefers-reduced-motion:reduce){.yb-handle-shine{animation:none}}";

/** "barter_friendly" → "Open to barter". "" when unknown. Pure. */
export function barterLabel(v) {
  return ({ barter_ok: "Open to barter", barter_friendly: "Open to barter", barter_only: "Barter only", no_barter: "Paid only", cash_only: "Paid only", partial_barter: "Paid + product" })[String(v || "")] || "";
}
/** About rows that have a value — empty fields are left out (no "Not specified"). Pure. */
export function aboutRows(c = {}) {
  const langs = (Array.isArray(c.languages) ? c.languages : String(c.languages || "").split(",")).map((x) => String(x).trim()).filter(Boolean);
  return [
    ["Niche", [c.category || c.primary_niche, ...(Array.isArray(c.sub_categories) ? c.sub_categories : [])].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ")],
    ["Based in", c.city || ""],
    ["Languages", langs.join(", ")],
    ["Collab type", barterLabel(c.barter || c.barter_mode)],
  ].filter(([, v]) => v);
}
/** Which section is under the sticky bar right now. Pure: tops = {id: px from viewport top}. */
export function activeSectionAt(tops = {}, offset = 140) {
  let cur = PROFILE_SECTIONS[0][0];
  for (const [id] of PROFILE_SECTIONS) if (tops[id] != null && tops[id] - offset <= 0) cur = id;
  return cur;
}


function Chip({ active, t, onClick, children }) {
  const on = t.mode === "dark" ? { background: "#FFFFFF", color: "#0A0A0A" } : { background: "#0A0A0A", color: "#FFFFFF" };
  const off = { background: t.chipBg, color: t.text, border: `1px solid ${t.glassBorder}` };
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="h-9 px-4 rounded-full text-[13px] font-bold whitespace-nowrap transition-colors" style={active ? on : off}>{children}</button>
  );
}
function Card({ t, className = "", children, ...rest }) {
  return <div className={`rounded-[20px] p-4 ${className}`} style={{ background: t.glass, border: `1px solid ${t.glassBorder}` }} {...rest}>{children}</div>;
}
function SectionHead({ t, title, badge, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-[17px] font-black tracking-[-0.01em] flex items-center gap-2">{title}{badge}</h2>
      {right}
    </div>
  );
}
function Stars({ n = 0, size = 12 }) {
  return <span className="inline-flex gap-0.5">{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={size} className={i <= Math.round(n) ? "fill-amber-700 text-amber-700" : "text-amber-700/30"} />)}</span>;
}
function BrandDot({ t, name, src }) {
  const [bad, setBad] = useState(false);
  return src && !bad
    ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} className="w-8 h-8 rounded-full object-cover shrink-0" />
    : <span className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-black shrink-0" style={{ background: t.mode === "dark" ? "#fff" : "#0A0A0A", color: t.mode === "dark" ? "#0A0A0A" : "#fff" }}>{String(name || "B").charAt(0).toUpperCase()}</span>;
}

/**
 * The whole phone profile. Data and actions come from CreatorPublicView (same API calls as before).
 * viewer: { isOwner, isBrand, loggedIn } · cta: { label, icon, onClick } | null · saved: { active, onClick } | null
 * reviewForm: { can, open, setOpen, rating, setRating, comment, setComment, onSubmit, submitting }
 */
export default function PhotoLedHeaderMobile({
  c, theme, photoUrl, onBack, onShare,
  verified = false, match = null, portfolioItems = [], reviews = [], loadingReviews = false,
  scores = { overall: "New", quality: "—", time: "—", comm: "—" },
  viewer = { isOwner: false, isBrand: false, loggedIn: false },
  cta = null, saved = null, onAskQuote = null, onNotifyRates = null, reviewForm = null, footer = null,
}) {
  const [photoBroken, setPhotoBroken] = useState(false);
  const [tabIdx, setTabIdx] = useState(0);
  const [indicator, setIndicator] = useState(0); // 0…3, follows the swipe live
  const [allReviews, setAllReviews] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const pagerRef = useRef(null);
  const refs = { work: useRef(null), reviews: useRef(null), about: useRef(null), rates: useRef(null) };
  const hasPhoto = Boolean(photoUrl) && !photoBroken;
  // v451 (Ravi's BRD §12): one light theme, like the rest of the app (no dark adaptive page)
  const t = LIGHT_PAGE;
  const nums = profileNumbers(c);
  const igUrl = instagramUrlOf(c || {});
  const handle = igUrl ? igUrl.replace(/^https:\/\/www\.instagram\.com\//, "").replace(/\/$/, "") : "";
  const place = [c.category || c.primary_niche || "", c.city || ""].filter(Boolean).join(" · ");
  const first = String(c.name || "").trim().split(/\s+/)[0] || "this creator"; // v451: no "the hasn't added a bio"
  const nReviews = reviews.length;
  const reviewsLabel = nReviews ? `★ ${scores.overall} (${nReviews} review${nReviews === 1 ? "" : "s"})` : "New on Ybex";
  const otherWork = (portfolioItems || []).filter((it) => it && !it.cover && (it.content_url || it.url || it.link || it.title));
  const hasCovers = (portfolioItems || []).some((it) => it?.cover);
  const pastBrands = (Array.isArray(c.past_brands) ? c.past_brands : []).filter(Boolean);
  const about = aboutRows(c);
  const rates = { reel: Number(c.rate_reel || c.reel_rate || c.rate_card?.reels || c.rate_card?.reel) || 0, story: Number(c.rate_story || c.story_rate || c.rate_card?.stories || c.rate_card?.story) || 0, yt: Number(c.rate_yt_video || c.youtube_video_rate || c.rate_card?.yt_video || c.rate_card?.youtube_integration) || 0 };
  const accent = "#7C3AED";
  const topInset = viewer.loggedIn ? 0 : 84; // logged-out visitors have the site header (Ybex · Sign in) fixed on top

  // v451 (BRD §12): tabs are an iOS-style pager — swipe left/right between Work / Reviews / About / Rates; each page
  // scrolls on its own; the white pill in the tab bar follows the finger.
  const onPagerScroll = (e) => {
    const el = e.currentTarget; const w = el.clientWidth || 1;
    const f = el.scrollLeft / w;
    setIndicator(f);
    const i = Math.round(f);
    if (i !== tabIdx) setTabIdx(i);
  };
  const goTab = (i) => { const el = pagerRef.current; if (!el) return; setTabIdx(i); el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }); };
  useEffect(() => {
    if (!lightbox) return undefined;
    const k = (e) => { if (e.key === "Escape") setLightbox(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [lightbox]);

  const tabBar = (
    <div className="relative grid grid-cols-4 bg-[#E9E9EE] rounded-xl p-[3px]" role="tablist" aria-label="Profile sections" data-testid="profile-tabbar">
      <span aria-hidden="true" className="absolute top-[3px] bottom-[3px] rounded-[10px] bg-white shadow-[0_1px_3px_rgba(16,16,20,.14)]"
        style={{ width: "calc(25% - 1.5px)", left: `calc(${indicator * 25}% + 1.5px)` }} />
      {PROFILE_SECTIONS.map(([id, label], i) => (
        <button key={id} type="button" role="tab" aria-selected={tabIdx === i} onClick={() => goTab(i)} data-testid={`profile-tab-${id}`}
          className={`relative h-9 text-[13.5px] font-semibold ${tabIdx === i ? "text-[#0A0A0A]" : "text-[#5F6672]"}`}>{label}</button>
      ))}
    </div>
  );
  const pageCls = "w-full shrink-0 overflow-y-auto overscroll-contain px-5 pt-4 pb-6";
  const pageStyle = { scrollSnapAlign: "start", scrollSnapStop: "always" };

  return (
    <div data-testid="public-profile-photo-led" data-theme="light" style={{ background: t.bg, color: t.text, minHeight: "100vh", paddingBottom: cta ? "calc(env(safe-area-inset-bottom, 0px) + 118px)" : 32 }}>
      <style>{SHINE_CSS}</style>

      {/* v470 (Ravi 20 Nov: "public profile ki UI di thi jo nahi bani"; 17 Nov design "Creator profile"): a compact white
          header — back / share, then a 64px photo (tap = full screen) beside @handle + green tick and "name · niche · city",
          the four numbers in a plain row and the live line. No big cover photo any more. */}
      <div className="bg-white px-4" data-testid="public-profile-header" style={{ paddingTop: `calc(${topInset ? `${topInset}px` : "env(safe-area-inset-top, 0px)"} + 10px)` }}>
        <div className="flex items-center justify-between">
          <button type="button" onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-full bg-[#F2F2F7] text-[#0A0A0A] flex items-center justify-center"><ChevronLeft size={20} /></button>
          <button type="button" onClick={onShare} aria-label="Share profile" className="w-10 h-10 rounded-full bg-[#F2F2F7] text-[#0A0A0A] flex items-center justify-center"><Share2 size={16} /></button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => { if (hasPhoto) setLightbox(true); }} aria-label={hasPhoto ? "Open photo" : undefined} data-testid="profile-photo-open"
            className="shrink-0 w-16 h-16 rounded-2xl overflow-hidden p-0 border-0" style={{ boxShadow: "0 0 0 1px #ECECF0, 0 6px 16px -8px rgba(16,16,20,.35)" }}>
            {hasPhoto
              ? <img src={photoUrl} alt={c.name || "Creator"} referrerPolicy="no-referrer" onError={() => setPhotoBroken(true)} className="w-full h-full object-cover" style={{ objectPosition: "center 25%" }} />
              : <span className="w-full h-full flex items-center justify-center text-white text-2xl font-black" style={{ background: "linear-gradient(160deg,#8B5CF6 0%,#7C3AED 55%,#6D28D9 100%)" }}>{String(c.name || "C").trim().charAt(0).toUpperCase()}</span>}
          </button>
          <div className="min-w-0 flex-1">
            {/* v470b (Ravi: "name rakh, fir uske niche chota sa creator username"): name on top, small @handle under it */}
            <h1 className="text-[20px] leading-[1.2] font-bold tracking-[-0.01em] flex items-center gap-1.5 min-w-0">
              <span className="truncate">{c.name || (handle ? `@${handle}` : "Creator")}</span>
              {verified && <span className="shrink-0"><GreenTick size={18} /></span>}
            </h1>
            <div className="mt-0.5 flex items-center gap-1 min-w-0 text-[13px]" style={{ color: t.sub }}>
              {handle && (
                <a href={igUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open @${handle} on Instagram`} data-testid="public-profile-ig-link"
                  className="shrink-0 inline-flex items-center gap-1 font-semibold" style={{ color: "#0A0A0A", textDecoration: "none" }}>
                  <IgGlyph size={12} /><span>@<span className="yb-handle-shine" style={{ "--yb-b": "#0A0A0A", "--yb-g": "#A78BFA" }}>{handle}</span></span>
                </a>
              )}
              <span className="truncate">{[c.category || c.primary_niche || "", c.city || ""].filter(Boolean).map((x) => ` · ${x}`).join("").replace(handle ? /^/ : /^ · /, "")}</span>
            </div>
          </div>
        </div>
        {/* v451 (BRD §14): stats as a plain row with thin dividers — no box. Engagement in purple. */}
        <a href={igUrl || undefined} target={igUrl ? "_blank" : undefined} rel="noopener noreferrer" onClick={(e) => { if (!igUrl) e.preventDefault(); }}
          className="mt-4 grid grid-cols-4 text-center" style={{ color: "inherit", textDecoration: "none" }} aria-label={igUrl ? "Open Instagram profile" : undefined} data-testid="public-profile-stats">
          {[["Followers", shortCount(nums.followers)], ["Avg views", shortCount(nums.views)], ["Avg likes", fullCount(nums.likes)], ["Engagement", nums.er != null ? `${Number(nums.er).toFixed(1).replace(/\.0$/, "")}%` : "—"]].map(([label, value], i) => (
            <div key={label} className={i ? "border-l border-[#E2E2E8]" : ""}>
              <div className="text-[17px] font-bold tracking-[-0.01em]" style={label === "Engagement" && value !== "—" ? { color: accent } : undefined}>{value}</div>
              <div className="text-[11.5px] mt-0.5" style={{ color: t.sub }}>{label}</div>
            </div>
          ))}
        </a>
        <div className="mt-3 pb-1 flex flex-wrap items-center justify-center gap-x-1.5 text-[12px]" style={{ color: t.sub }} data-testid="public-profile-ig-line">
          {nums.live ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live from Instagram</> : <>Numbers by the creator</>}
          <span>· {reviewsLabel}</span>
          {match && <span>· <b style={{ color: accent }}>{match.score}% match</b></span>}
        </div>
      </div>

      {/* sticky tab bar (with a small back + name), then the pager */}
      <div className="sticky z-30 px-4 pt-2 pb-3" style={{ top: topInset, background: "#FFFFFF", borderBottom: `1px solid ${t.glassBorder}`, paddingTop: topInset ? 8 : "calc(env(safe-area-inset-top, 0px) + 8px)" }} data-testid="public-profile-sticky">
        {tabBar}
      </div>
      <div ref={pagerRef} onScroll={onPagerScroll} className="flex overflow-x-auto no-scrollbar" data-testid="profile-pager"
        style={{ scrollSnapType: "x mandatory", height: `calc(100dvh - ${topInset + 64}px)` }}>

        {/* ── Work ── */}
        <section ref={refs.work} id="work" className={pageCls} style={pageStyle} data-testid="profile-section-work">
          {pastBrands.length > 0 && (
            <div className="mb-4">
              <div className="text-[11.5px] font-bold mb-2" style={{ color: t.sub }}>Worked with</div>
              <div className="flex flex-wrap gap-1.5">{pastBrands.map((b, i) => <span key={`${b}-${i}`} className="h-7 px-3 rounded-full text-[12px] font-bold inline-flex items-center bg-white border border-[#ECECF0]">{b}</span>)}</div>
            </div>
          )}
          <PortfolioCoversMobile items={portfolioItems} theme={t} />
          {otherWork.length > 0 && (
            <div className={`${hasCovers ? "mt-5" : ""} space-y-2`}>
              {hasCovers && <div className="text-[11.5px] font-bold" style={{ color: t.sub }}>More work</div>}
              {otherWork.map((it, i) => {
                const url = it.content_url || it.url || it.link || "";
                return (
                  <a key={`${it.id || url}-${i}`} href={url || undefined} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!url) e.preventDefault(); }}
                    className="flex items-center gap-3 rounded-2xl px-3.5 py-3 bg-white border border-[#ECECF0]" style={{ color: "inherit", textDecoration: "none" }}>
                    <BrandDot t={t} name={it.brand_name || it.brand || it.title} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-bold truncate">{it.title || it.brand_name || it.brand || "Sample work"}</span>
                      {(it.brand_name || it.brand) && it.title && <span className="block text-[11.5px] truncate" style={{ color: t.sub }}>{it.brand_name || it.brand}</span>}
                    </span>
                    {url && <ExternalLink size={15} style={{ color: t.sub }} />}
                  </a>
                );
              })}
            </div>
          )}
          {!hasCovers && !otherWork.length && (
            <Card t={t} className="text-center py-7"><p className="text-[13.5px] font-bold">No work added yet</p><p className="text-[12px] mt-1" style={{ color: t.sub }}>{viewer.isOwner ? "Add your best reels so brands can see your style." : `You can still send ${first} a collab request.`}</p></Card>
          )}
          {footer && <div className="pt-8 flex justify-center">{footer}</div>}
        </section>

        {/* ── Reviews ── */}
        <section ref={refs.reviews} id="reviews" className={pageCls} style={pageStyle} data-testid="profile-section-reviews">
          <SectionHead t={t} title="Reviews" right={nReviews > 2 && <button type="button" onClick={() => setAllReviews((v) => !v)} className="text-[12.5px] font-bold" style={{ color: accent }}>{allReviews ? "Show less" : `See all ${nReviews}`}</button>} />
          {loadingReviews ? <Card t={t}><div className="space-y-2" role="status" aria-busy="true" aria-label="Loading reviews"><Shimmer className="h-4 w-1/2" /><Shimmer className="h-4" /><Shimmer className="h-4 w-3/4" /></div></Card> : nReviews > 0 ? (
            <div className="space-y-2.5">
              <Card t={t} className="flex items-center gap-4">
                <div className="shrink-0 text-center w-16"><div className="text-[34px] leading-none font-black">{scores.overall}</div><div className="text-[11px] mt-1.5" style={{ color: t.sub }}>{nReviews} brand{nReviews === 1 ? "" : "s"}</div></div>
                <div className="flex-1 space-y-1.5">
                  {[["Quality", scores.quality], ["On time", scores.time], ["Communication", scores.comm]].map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-[11.5px] font-semibold">
                      <span className="w-[92px] shrink-0" style={{ color: t.sub }}>{k}</span>
                      <span className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: t.chipBg }}><span className="block h-full rounded-full bg-amber-400" style={{ width: `${(Number(v) || 0) * 20}%` }} /></span>
                      <span className="w-6 text-right font-bold">{v}</span>
                    </div>
                  ))}
                </div>
              </Card>
              {(allReviews ? reviews : reviews.slice(0, 2)).map((r, i) => (
                <Card t={t} key={`${r.review_id || r.id || "rev"}-${i}`}>
                  <div className="flex items-center gap-2.5">
                    <BrandDot t={t} name={r.brand_name} src={r.brand_picture || r.brand_logo || r.logo || r.company_logo} />
                    <span className="flex-1 min-w-0 text-[13.5px] font-bold truncate">{r.brand_name || "Brand"}</span>
                    <Stars n={Number(r.rating || r.overall_rating) || 0} />
                  </div>
                  {(r.comment || r.review_text) && <p className="mt-2 text-[13px] leading-relaxed break-words" style={{ color: t.sub }}>{r.comment || r.review_text}</p>}
                </Card>
              ))}
            </div>
          ) : (
            <Card t={t} className="text-center py-6"><p className="text-[13.5px] font-bold">No reviews yet</p><p className="text-[12px] mt-1" style={{ color: t.sub }}>Brands review {first} after a finished collab.</p></Card>
          )}
          {reviewForm?.can && !reviewForm.open && (
            <button type="button" onClick={() => reviewForm.setOpen(true)} className="mt-2.5 w-full h-11 rounded-full text-[13px] font-bold bg-white border border-[#ECECF0]">Write a review</button>
          )}
          {reviewForm?.can && reviewForm.open && (
            <form onSubmit={reviewForm.onSubmit} className="mt-2.5"><Card t={t} className="space-y-3">
              <div className="text-[13.5px] font-bold">Your review</div>
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${n} star${n > 1 ? "s" : ""}`} aria-pressed={n <= reviewForm.rating} onClick={() => reviewForm.setRating(n)} className="p-1"><Star size={24} className={n <= reviewForm.rating ? "fill-amber-700 text-amber-700" : "text-amber-700/30"} /></button>)}</div>
              <textarea value={reviewForm.comment} onChange={(e) => reviewForm.setComment(e.target.value)} rows={3} required placeholder={`How was working with ${first}?`}
                className="w-full rounded-2xl p-3 text-base outline-none" style={{ background: t.chipBg, border: `1px solid ${t.glassBorder}`, color: t.text }} />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => reviewForm.setOpen(false)} className="h-10 px-4 rounded-full text-[13px] font-bold" style={{ color: t.sub }}>Cancel</button>
                <button type="submit" disabled={reviewForm.submitting} className="h-10 px-5 rounded-full text-[13px] font-bold disabled:opacity-60" style={{ background: t.ctaBg, color: t.ctaText }}>{reviewForm.submitting ? "Sending…" : "Post review"}</button>
              </div>
            </Card></form>
          )}
        </section>

        {/* ── About ── */}
        <section ref={refs.about} id="about" className={pageCls} style={pageStyle} data-testid="profile-section-about">
          <SectionHead t={t} title="About" />
          <Card t={t} className="space-y-3">
            {c.bio ? <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">{c.bio}</p> : <p className="text-[13px]" style={{ color: t.sub }}>{viewer.isOwner ? "Add a short bio — brands read this first." : `${first.charAt(0).toUpperCase()}${first.slice(1)} hasn't added a bio yet.`}</p>}
            {about.length > 0 && (
              <div className="pt-1 space-y-2">
                {about.map(([k, v]) => <div key={k} className="flex gap-3 text-[12.5px]"><span className="w-[88px] shrink-0 font-semibold" style={{ color: t.sub }}>{k}</span><span className="font-bold break-words">{v}</span></div>)}
              </div>
            )}
          </Card>
          {match?.reason && (
            <Card t={t} className="mt-2.5 flex items-start gap-3" data-testid="profile-match">
              <span className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-[12px] font-black" style={{ background: "#F1EBFE", color: accent }}>{match.score}%</span>
              <span className="text-[12.5px] leading-snug"><b>Match with your brand.</b> <span style={{ color: t.sub }}>{match.reason}</span></span>
            </Card>
          )}
        </section>

        {/* ── Rates ── brands see "coming soon" (the one dark card, as a highlight); the creator sees her own */}
        <section ref={refs.rates} id="rates" className={pageCls} style={pageStyle} data-testid="profile-section-rates">
          {viewer.isOwner ? (
            <>
              <SectionHead t={t} title="Rates" badge={<span className="inline-flex items-center gap-1 h-5 px-2 rounded-md text-[10px] font-black uppercase" style={{ background: t.chipBg, color: t.sub }}><Lock size={10} /> Only you</span>} />
              <Card t={t} className="space-y-2.5" data-testid="rates-owner-note">
                {[["Instagram Reel", rates.reel], ["Instagram Story", rates.story], ["YouTube video", rates.yt]].filter(([, v], i) => v || i < 2).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-[13.5px]"><span className="font-semibold">{k}</span><span className="font-black">{v ? `₹${v.toLocaleString("en-IN")}` : <span style={{ color: t.sub }}>Not set</span>}</span></div>
                ))}
                <p className="text-[11.5px] pt-1" style={{ color: t.sub }}>Brands see your rates later with Ybex Pro. For now they ask you for a quote.</p>
              </Card>
            </>
          ) : (
            <>
              <SectionHead t={t} title="Rates" badge={<span className="h-5 px-2 rounded-md text-[10px] font-black uppercase inline-flex items-center bg-amber-400 text-[#1A1206]">Coming soon</span>} />
              <div className="relative overflow-hidden rounded-[20px] p-4 text-white" style={{ background: "#17122B", border: "1px solid rgba(196,181,253,.28)" }} data-testid="rates-coming-soon-mobile">
                <div className="absolute right-3 top-4 space-y-2 opacity-60 blur-[2px] pointer-events-none" aria-hidden="true">
                  {["Reel ₹ • • • •", "Story ₹ • • •"].map((x) => <div key={x} className="text-[12px] font-bold">{x}</div>)}
                </div>
                <div className="relative flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(196,181,253,.2)", color: "#C4B5FD" }}><Sparkles size={16} /></span>
                  <span className="text-[15px] font-extrabold">Creator rates · with Ybex Pro</span>
                </div>
                <p className="relative mt-3 text-[12.5px] leading-relaxed text-white/75">We're checking every creator's rates so the prices you see are real. Until then, ask {first} for a quote in the collab request.</p>
                <div className="relative mt-3.5 flex gap-2">
                  {onNotifyRates && <button type="button" onClick={onNotifyRates} className="h-9 px-4 rounded-full text-[12.5px] font-bold bg-white text-[#0A0A0A]">Notify me</button>}
                  {onAskQuote && <button type="button" onClick={onAskQuote} className="h-9 px-4 rounded-full text-[12.5px] font-bold bg-white/10 border border-white/20">Ask for a quote</button>}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* the action stays at the bottom */}
      {cta && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pt-3" style={{ background: "#FFFFFF", borderTop: `1px solid ${t.glassBorder}`, paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)" }} data-testid="public-profile-cta-bar">
          <div className="flex items-center gap-2.5">
            {saved && (
              <button type="button" onClick={saved.onClick} aria-label={saved.active ? "Remove from saved" : "Save profile"} aria-pressed={Boolean(saved.active)}
                className="w-[52px] h-[52px] rounded-full flex items-center justify-center shrink-0"
                style={{ background: saved.active ? "#F43F5E" : "#FFFFFF", border: `1px solid ${saved.active ? "#F43F5E" : t.glassBorder}`, color: saved.active ? "#fff" : t.text }}>
                <Heart size={20} className={saved.active ? "fill-white" : ""} />
              </button>
            )}
            <button type="button" onClick={cta.onClick} data-testid="public-profile-cta"
              className="flex-1 h-[52px] rounded-full text-[15px] font-bold inline-flex items-center justify-center gap-2 active:scale-[.99] transition"
              style={{ background: t.ctaBg, color: t.ctaText }}>
              {cta.icon === "edit" ? <Pencil size={15} /> : <Send size={15} />} {cta.label}
            </button>
          </div>
          {viewer.isBrand && <p className="mt-1.5 text-center text-[11px] font-medium" style={{ color: t.sub }}>You pay into escrow · released only when you approve</p>}
        </div>
      )}

      {/* v451 (BRD §14): the real photo full screen — pinch to zoom, swipe down / tap to close */}
      {lightbox && hasPhoto && <PhotoLightbox src={photoUrl} name={c.name} onClose={() => setLightbox(false)} />}
    </div>
  );
}

/** Instagram-shaped (scalloped) verified badge, in green, with a white check. Only for really verified creators. */
export function GreenTick({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className="shrink-0" role="img" aria-label="Verified" data-testid="green-tick">
      <path fill="#16A34A" d="M19.998 3.094 14.638 0l-2.972 5.15H5.432v6.354L0 14.64 3.094 20 0 25.359l5.432 3.137v5.905h5.975L14.638 40l5.36-3.094L25.358 40l3.232-5.6h6.162v-6.01L40 25.359 36.905 20 40 14.641l-5.248-3.03v-6.46h-6.419L25.358 0l-5.36 3.094Z" />
      <path fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" d="m12.5 20.4 5 5 10-10.6" />
    </svg>
  );
}

function PhotoLightbox({ src, name, onClose }) {
  useBackToClose(true, () => onClose?.()); // v457: phone / browser Back closes this popup
  const [dy, setDy] = useState(0);
  const start = useRef(null);
  return (
    <div className="fixed inset-0 z-[3000] bg-black flex items-center justify-center" role="dialog" aria-modal="true" aria-label={`${name || "Creator"} photo`} data-testid="profile-photo-lightbox"
      style={{ background: `rgba(0,0,0,${Math.max(0.35, 1 - Math.abs(dy) / 400)})`, animation: "ybLbIn .22s ease-out" }}
      onTouchStart={(e) => { if (e.touches.length === 1) start.current = e.touches[0].clientY; }}
      onTouchMove={(e) => { if (start.current != null && e.touches.length === 1) setDy(e.touches[0].clientY - start.current); }}
      onTouchEnd={() => { if (Math.abs(dy) > 110) onClose(); else setDy(0); start.current = null; }}
      onClick={onClose}>
      <style>{"@keyframes ybLbIn{from{opacity:0}to{opacity:1}}"}</style>
      <img src={src} alt={name || ""} referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain" style={{ transform: `translateY(${dy}px)`, transition: start.current == null ? "transform .2s ease" : "none", touchAction: "pinch-zoom" }} />
      <button type="button" onClick={onClose} aria-label="Close photo" className="absolute right-4 w-10 h-10 rounded-full bg-white/15 text-white text-lg" style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>✕</button>
    </div>
  );
}
