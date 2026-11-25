import React from "react";
import { Clock, ArrowRight } from "lucide-react";

export default function UnderReviewBanner({ user, onOpenModal }) {
  if (!user || user.profile_status !== "under_review") return null;

  const etaHoursStored = user.review_eta_hours || 20;
  const createdAtMs = user.created_at ? new Date(user.created_at).getTime() : Date.now();
  const elapsedHours = (Date.now() - createdAtMs) / (1000 * 60 * 60);
  const hoursLeft = Math.max(1, Math.ceil(etaHoursStored - elapsedHours));

  // v452 (UI audit 20): light banner — was a dark amber/slate gradient on the light app.
  return (
    <div className="w-full bg-[var(--warning-bg)] border-b border-amber-200 text-[var(--text-primary)] px-4 py-2.5">
      <div className="max-w-none flex flex-wrap items-center justify-between gap-3 text-[13px]">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <Clock size={15} />{/* v415: no endless pulse */}
          </span>
          <span>
            {/* v330: "1 hr" (not "1 hrs"), and no frozen "~1 hrs" once the estimate has passed */}
            <strong>Profile under review</strong> · {elapsedHours >= etaHoursStored
              ? "finishing up"
              : <>about {hoursLeft} {hoursLeft === 1 ? "hr" : "hrs"} left</>}. <span className="text-[var(--text-secondary)]">{user.role === "brand"
                ? "You can complete KYC and explore creators while we review." /* v415: brand wording (applications are a creator thing) */
                : "You can submit KYC and explore, but campaign applications are paused until approval."}</span>
          </span>
        </div>

        <button
          onClick={onOpenModal}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-amber-50 border border-amber-300 text-amber-800 font-bold text-[12px] transition-colors cursor-pointer shrink-0"
        >
          View details <ArrowRight size={13} />{/* v415 */}
        </button>
      </div>
    </div>
  );
}
