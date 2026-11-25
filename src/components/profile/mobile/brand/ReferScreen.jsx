import React, { useState } from "react";
import { referralCodeFor } from "../../../../utils/referral";
import { useAuth } from "../../../../contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Info, ChevronLeft } from "lucide-react";
import ReferralHub from "../../../referral/ReferralHub";

// Screen 1j — refer & earn (brand).
// Session 57 — Ravi's Money screens design (RF-01). The brand page now uses the same server data as the
// creator invite page (GET /referrals/me): the real invite link (/b/<code>), the brand reward the admin
// set, the brands who joined and whether they qualified, and the Ybex wallet. The old page read
// /referral/stats and a /signup?ref= link that the invite counter never matched.
export default function ReferScreen({ onBack }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  // The code comes from the server answer (GET /referrals/me) at the bottom of the page. referralCodeFor(user)
  // is the same format; kept for the accessibility label.
  const fallbackCode = referralCodeFor(user);
  const [steps, setSteps] = useState(false); // v451 (BRD §20): header "How it works" → the 3 steps
  return (
    <div className="min-h-screen bg-[#F4F4F8] flex flex-col" data-testid="brand-refer-screen">
      <header data-statusbar="#FFFFFF" className="sticky top-0 z-20 bg-white border-b border-[#ECEAF1] px-4 pt-2 pb-3 flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-full bg-[#F2F0F6] flex items-center justify-center shrink-0"><ChevronLeft size={20} className="text-[#0A0A0A]" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[20px] font-extrabold tracking-[-0.3px] text-[#0A0A0A] leading-tight">Refer &amp; earn</h1>
          <span className="sr-only">{`Your code ${fallbackCode}`}</span>
        </div>
        <button type="button" onClick={() => setSteps(true)} data-testid="refer-howto-btn" className="h-10 px-3.5 rounded-full border border-[#E6E3EE] bg-white text-[13px] font-semibold text-[#0A0A0A] flex items-center gap-1.5 shrink-0"><Info className="w-4 h-4" />How it works</button>
      </header>
      <div className="p-4"><ReferralHub compact mode="brand" stepsOpen={steps} onStepsClose={() => setSteps(false)} /></div>
    </div>
  );
}
