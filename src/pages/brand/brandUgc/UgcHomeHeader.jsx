import { HiwSectionHelp } from "../../../components/whatsNew/WhatsNewPopup"; // v437: How it works button / popup / reminder
import React from "react";


// Session 49 (clean-up): moved out of BrandUGCMobile.jsx word for word (one section of the page).
// Everything it needs comes in as props; no logic, text or server call changed.
export default function UgcHomeHeader(props) {
  const { activeTab, briefSearch, briefs, fetchData, orderSearch, orders, refreshing, searchOpen, setActiveTab, setBriefSearch, setOrderSearch, setSearchOpen } = props;
  // v416 (U29): no "0" next to a tab whose list failed to load or is still loading
  const showBriefCount = !props.loading && !(props.briefsError && briefs.length === 0);
  const showOrderCount = !props.loading && !(props.ordersError && orders.length === 0);
  // v451 (BRD §22): pull down at the top of the page = refresh (the Refresh button is gone)
  const [pull, setPull] = React.useState(0);
  React.useEffect(() => {
    let y0 = null;
    const start = (e) => { y0 = window.scrollY <= 0 ? e.touches[0].clientY : null; };
    const move = (e) => { if (y0 === null) return; const d = e.touches[0].clientY - y0; setPull(d > 0 ? Math.min(d, 110) : 0); };
    const end = () => { setPull((p) => { if (p >= 72 && !refreshing) fetchData(true); return 0; }); y0 = null; };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    return () => { window.removeEventListener("touchstart", start); window.removeEventListener("touchmove", move); window.removeEventListener("touchend", end); };
  }, [fetchData, refreshing]);
  const seg = (on) => `flex-1 py-1.5 min-h-[36px] rounded-[10px] text-[13px] font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${on ? "bg-white text-[#0A0A0A] shadow-[0_1px_3px_rgba(16,16,20,.12)]" : "text-[#5F6672]"}`;
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-[#ECECF0] px-4 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }} data-testid="ugc-home-header">
      {(pull > 0 || refreshing) && (
        <div className="flex items-center justify-center text-[11.5px] font-semibold text-[#7C3AED]" style={{ height: refreshing ? 22 : Math.round(pull / 3) }} aria-live="polite">
          {refreshing ? "Refreshing…" : pull >= 72 ? "Release to refresh" : ""}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h1 className="text-[20px] font-bold text-[#0A0A0A] tracking-tight">Instant UGC</h1>
          <span className="bg-[#F1E8FF] text-[#6D28D9] font-bold text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full">BETA</span>
        </div>
        <HiwSectionHelp section="ugc" role="brand" />
      </div>
      <p className="text-[12.5px] text-[#5F6672] font-medium mt-0.5">Verified creators · 24–72h delivery</p>
      {/* segmented control (white pill on grey) */}
      <div className="mt-3 bg-[#EEEEF2] p-[3px] rounded-xl flex items-center" role="tablist">
        <button type="button" role="tab" aria-selected={activeTab === "briefs"} onClick={() => setActiveTab("briefs")} className={seg(activeTab === "briefs")}>
          <span>My briefs</span>{showBriefCount && <span className="text-[#8E8E93] font-medium">{briefs.length}</span>}
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "orders"} onClick={() => setActiveTab("orders")} className={seg(activeTab === "orders")}>
          <span>Orders</span>{showOrderCount && <span className="text-[#8E8E93] font-medium">{orders.length}</span>}
        </button>
      </div>
    </header>
  );
}
