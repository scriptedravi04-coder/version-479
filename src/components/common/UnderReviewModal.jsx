import React from "react";
import { AnimatePresence } from "framer-motion";
import { Clock, ShieldCheck, Megaphone, User, ArrowRight, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import useScrollLock from "../../lib/useScrollLock"; // v415

import { PopupBackdrop, PopupPanel } from "../common/Popup";
export default function UnderReviewModal({ isOpen, onClose, user }) {
  const navigate = useNavigate();
  const show = Boolean(isOpen && user && user.profile_status === "under_review");
  // v415: page behind stays still, Escape closes, and the popup fades out (the early return skipped the exit).
  useScrollLock(show);
  React.useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, onClose]);

  if (!user) return <AnimatePresence />;

  // Calculate remaining ETA hours based on created_at and stored review_eta_hours
  const etaHoursStored = user.review_eta_hours || 20;
  const createdAtMs = user.created_at ? new Date(user.created_at).getTime() : Date.now();
  const elapsedMs = Date.now() - createdAtMs;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const hoursLeft = Math.max(1, Math.ceil(etaHoursStored - elapsedHours));
  // v332: "1 hour" (not "1 hours"), and no frozen "within 1 hours" once the estimate has passed (same as the banner).
  const pastEta = elapsedHours >= etaHoursStored;
  const hoursWord = hoursLeft === 1 ? "hour" : "hours";

  const isBrand = user.role === "brand";

  const handleKycRedirect = () => {
    onClose();
    navigate(isBrand ? "/brand/kyc" : "/creator/kyc");
  };

  const handleCampaignsRedirect = () => {
    onClose();
    navigate(isBrand ? "/brand/campaigns" : "/campaigns");
  };

  const handleSettingsRedirect = () => {
    onClose();
    navigate(isBrand ? "/brand/settings" : "/creator/settings");
  };

  // v452 (UI audit 20): light popup in the app's own colours — was a dark slate card with glow blobs,
  // a mono "queue" pill and a same-colour "gradient" button.
  const actions = [
    { key: "kyc", icon: ShieldCheck, title: "Complete KYC", sub: "Add PAN and bank details so payouts are ready", onClick: handleKycRedirect },
    { key: "camp", icon: Megaphone, title: isBrand ? "View your campaigns" : "Browse campaigns", sub: isBrand ? "See your campaigns and get them ready" : "Look at live campaigns and save the ones you like", onClick: handleCampaignsRedirect },
    { key: "profile", icon: User, title: "Improve your profile", sub: "Add work samples, bio and rates", onClick: handleSettingsRedirect },
  ];

  return (
    <AnimatePresence>
      {/* v330: above the bottom nav (both were z-50) and scrolls on short phones so the buttons stay reachable */}
      {show && (
      <PopupBackdrop key="under-review" role="dialog" aria-modal="true" aria-label="Your profile is under review" onClick={onClose} /* v415 */ className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[3px]">
        <PopupPanel kind="modal" onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl text-[var(--text-primary)] relative overflow-x-hidden overflow-y-auto max-h-[calc(100vh-32px)] max-h-[calc(100dvh-32px)]"
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-black/5 rounded-full transition-colors cursor-pointer"
            title="Close"
            aria-label="Close"
          >
            <X size={18} />
          </button>

          <div className="flex items-center gap-3 mb-4 pr-10">{/* v330: clear of the close button */}
            <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <Clock size={22} />{/* v415: no endless pulse */}
            </div>
            <h2 className="text-[19px] font-bold tracking-tight">Your profile is under review</h2>
          </div>

          <div className="bg-[var(--bg-base)] rounded-2xl p-4 mb-5">
            <p className="text-[12px] font-semibold text-[var(--text-secondary)] mb-1">Expected time</p>
            <p className="text-[22px] font-bold text-[var(--text-primary)]">
              {pastEta ? "Finishing up" : `About ${hoursLeft} ${hoursWord}`}
            </p>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
              The Ybex team is checking your profile. {pastEta ? "It should be live very soon." : "We'll let you know as soon as it's live."}
            </p>
          </div>

          <p className="text-[13px] font-bold text-[var(--text-primary)] mb-2.5">Meanwhile you can</p>
          <div className="grid grid-cols-1 gap-2 mb-5">
            {actions.map(({ key, icon: Icon, title, sub, onClick }) => (
              <button
                key={key}
                onClick={onClick}
                className="w-full p-3 bg-white hover:bg-[var(--violet-soft)] border border-[var(--border-strong)] hover:border-[var(--violet-border)] rounded-xl flex items-center justify-between transition-colors text-left cursor-pointer active:scale-[0.99]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[var(--violet-soft)] text-[var(--violet)] flex items-center justify-center shrink-0">
                    <Icon size={18} />
                  </div>
                  <div>
                    <div className="text-[14px] font-bold text-[var(--text-primary)]">{title}</div>
                    <div className="text-[12px] text-[var(--text-secondary)]">{sub}</div>
                  </div>
                </div>
                <ArrowRight size={16} className="text-[var(--text-tertiary)] shrink-0" />
              </button>
            ))}
          </div>

          {/* v330: primary (KYC) on the right on wider screens */}
          <div className="flex flex-col sm:flex-row-reverse items-center gap-2.5">
            <button
              onClick={handleKycRedirect}
              className="w-full sm:flex-1 py-3 px-5 rounded-xl bg-[var(--violet)] hover:bg-[var(--violet-hover)] text-white font-bold text-[14px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <ShieldCheck size={16} /> Complete KYC
            </button>
            <button
              onClick={onClose}
              className="w-full sm:w-auto py-3 px-5 rounded-xl bg-white border border-[var(--border-strong)] hover:bg-[var(--bg-base)] text-[var(--text-primary)] font-bold text-[14px] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </PopupPanel>
      </PopupBackdrop>
      )}
    </AnimatePresence>
  );
}
