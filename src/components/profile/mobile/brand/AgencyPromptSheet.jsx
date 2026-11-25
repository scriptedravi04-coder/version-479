// v450 (Ravi's BRD §5): "Are you an agency?" as a one-time bottom sheet on app open (it left the Company Profile hub;
// the card stays in Company details). Shown on the first open after this release; after "Not an agency" / close,
// once more on the first open 15+ days later; after that (or once they go to claim it) never again. Stored on the
// server per brand (/brand/map-flags) so a reinstall doesn't bring it back.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, X } from "lucide-react";
import { api } from "../../../../lib/api";
import ModalPortal from "../../../common/ModalPortal";
import { Presence, PopupBackdrop, PopupPanel } from "../../../common/Popup";

const DAY = 86400e3;
/** Pure (same rule as backend/brandLocations.ts shouldShowAgencyPrompt). */
export function agencyPromptDue(flags, isAgency, now = Date.now()) {
  if (isAgency || flags?.agency_prompt_done) return false;
  const n = Number(flags?.agency_prompt_count) || 0;
  if (n === 0) return true;
  if (n >= 2) return false;
  const last = Date.parse(String(flags?.agency_prompt_dismissed_at || ""));
  return Number.isFinite(last) && now - last >= 15 * DAY;
}

export default function AgencyPromptSheet({ isAgency, ready }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready || isAgency) return undefined;
    try { if (sessionStorage.getItem("yb_agency_prompt_checked")) return undefined; sessionStorage.setItem("yb_agency_prompt_checked", "1"); } catch { /* fine */ }
    let alive = true;
    const t = setTimeout(() => {
      api.get("brand/branches", { bypassCache: true }).then(({ data }) => { if (alive && agencyPromptDue(data?.flags || {}, isAgency)) setOpen(true); }).catch(() => {});
    }, 1800); // after Home has settled
    return () => { alive = false; clearTimeout(t); };
  }, [ready, isAgency]);

  const dismiss = () => { setOpen(false); api.post("brand/map-flags", { agency_prompt: "dismissed" }).catch(() => {}); };
  const claim = () => { setOpen(false); api.post("brand/map-flags", { agency_prompt: "claimed" }).catch(() => {}); navigate("/brand/profile?section=company"); };

  return (
    <Presence>{open && (
      <ModalPortal key="agency">
        <PopupBackdrop className="fixed inset-0 z-[80] bg-[rgba(10,10,14,.45)]" onClick={dismiss} />
        <PopupPanel kind="sheet" onClose={dismiss} className="fixed left-0 right-0 bottom-0 z-[81] bg-white rounded-t-[26px] px-5 pt-2.5" style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))", fontFamily: "'DM Sans',sans-serif" }} data-testid="agency-prompt">
          <div className="w-10 h-[5px] rounded-[3px] bg-[#E0E0E6] mx-auto" />
          <div className="mt-3 flex justify-end"><button type="button" onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full bg-[#F2F2F7] flex items-center justify-center"><X size={16} /></button></div>
          <div className="w-14 h-14 rounded-2xl bg-[#F3EDFF] flex items-center justify-center"><Package size={26} color="#7C3AED" /></div>
          <div className="mt-3.5 text-[21px] font-bold text-[#0A0A0A]">Are you an agency?</div>
          <div className="mt-1 text-[14px] leading-snug text-[#5F6672]">Get the agency badge and manage all your client brands from one login.</div>
          <button type="button" onClick={claim} className="mt-5 w-full h-[52px] rounded-2xl bg-[#7C3AED] text-white text-[15px] font-semibold">Yes, claim agency badge</button>
          <button type="button" onClick={dismiss} className="mt-2.5 w-full h-12 rounded-2xl bg-[#F2F2F7] text-[#0A0A0A] text-[14.5px] font-semibold">Not an agency</button>
        </PopupPanel>
      </ModalPortal>
    )}</Presence>
  );
}
