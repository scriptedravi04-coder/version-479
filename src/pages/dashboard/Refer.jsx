import React, { useState, useEffect } from "react";
import ReferralHub from "../../components/referral/ReferralHub";
import { referralCodeFor, referralRewardText } from "../../utils/referral";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../lib/api";
import { Gift, Copy, Check, Share2, Award, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { publicOrigin } from "../../lib/publicUrl";
import MobileBackButton from "../../components/common/MobileBackButton"; // v353
import SocialLogo from "../../components/common/SocialLogo"; // v364: real platform logos

export default function Refer() {
  // Session 36: creators get the referral programme hub (fee-free deals, Featured, share, wallet).
  const { user: referUser } = useAuth();
  if (String(referUser?.role || "").toLowerCase() === "creator") {
    // v353: on the phone /refer has no bottom nav and no header — creators were stuck (no way back in the iPhone app).
    return (
      <div className="w-full p-4 sm:p-6">
        <div className="md:hidden flex items-center gap-3 mb-3">
          <MobileBackButton className="!w-10 !h-10 !bg-[#F2F0F6]" />
          <h1 className="text-[20px] font-extrabold tracking-[-0.3px] text-[#0A0A0A]">Invite &amp; earn</h1>
        </div>
        <ReferralHub />
      </div>
    );
  }
  return <ReferLegacy />;
}

function ReferLegacy() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState({ total_referred: 0, rewards_earned: 0, reward_amount: 1000 });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    fetchStats();
  }, [user]);

  const fetchStats = async () => {
    if (!user) return;
    try {
      const { data } = await api.get("referral/stats");
      if (data) {
        setStats({
          total_referred: data.total_referred || 0,
          rewards_earned: data.rewards_earned || 0,
          reward_amount: data.reward_amount || null
        });
      }
    } catch (err) {
      console.warn("Failed to fetch referral stats:", err);
    } finally {
      setLoadingStats(false);
    }
  };

  const isBrand = ["brand", "agency", "talent_manager"].includes(String(user?.role || "")); // v332: agencies got creator wording
  // Only the server's configured amount; no assumed ₹500/₹1,000.
  const rewardFormatted = referralRewardText(stats) || "a reward";
  
  // Generate a clean referral code based on the user's name or id
  // The code format the server matches at signup (src/utils/referral.js).
  const referralCode = referralCodeFor(user);
  
  const referralLink = `${publicOrigin()}/signup?ref=${referralCode}`;

  // v332: "Copied!" showed even when the phone blocked copying.
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success("Referral link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Press and hold the link to copy it.");
    }
  };

  const shareText = isBrand
    ? `I'm hiring creators on Ybex. Sign up with my link and we both get ${rewardFormatted} platform credit: ${referralLink}`
    : `Join Ybex as a creator or brand. It's free to join. Sign up with my link: ${referralLink}`;

  const shareViaWhatsApp = () => {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`, "_blank");
  };

  const shareViaTwitter = () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, "_blank");
  };

  const shareViaEmail = () => {
    window.open(`mailto:?subject=${encodeURIComponent("Join me on Ybex")}&body=${encodeURIComponent(shareText)}`, "_blank");
  };

  return (
    <div className="w-full max-w-none px-4 md:px-8 py-10">
      {/* v452 (UI audit 23): plain dark band (app token #17122B) — no gradient, blur blobs or made-up "Real-Time Tracking" pill */}
      <div className="bg-[#17122B] text-white rounded-3xl p-8 sm:p-10 mb-8">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tight mb-3 leading-tight">
            Refer and get {rewardFormatted}
          </h1>
          <p className="text-white/75 text-[15px] sm:text-base leading-relaxed">
            {isBrand
              ? `Invite brands or creators to Ybex. When they finish their first campaign, you both get ${rewardFormatted} platform credit.`
              : `Invite brands or creators to Ybex. You get ${rewardFormatted} in your bank account once they finish their first deal.`}
          </p>
        </div>
      </div>

      {/* Referral Link & Sharing Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-6 sm:p-8 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#0A0A0A] mb-2 flex items-center gap-2">
              <Share2 size={18} className="text-[#7C3AED]" /> Your referral link
            </h2>
            <p className="text-[#5F6672] text-xs mb-6">
              Copy your unique link or share it directly via social media channels to start tracking your referral bonuses.
            </p>
            
            {/* Copyable Box */}
            <div className="flex items-center gap-2 bg-[#F9F9FB] border border-gray-200 rounded-xl p-2.5 mb-6 pl-4 select-all">
              <span className="text-xs font-mono font-medium text-gray-700 truncate flex-1">{referralLink}</span>
              <button
                onClick={copyToClipboard}
                className={`p-2.5 rounded-lg border flex items-center justify-center gap-1.5 transition-all text-xs font-bold cursor-pointer ${
                  copied
                    ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                    : "bg-white text-gray-700 border-gray-200 hover:border-[#DDD6FE] hover:text-[#7C3AED]"
                }`}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>

          <div>
            <span className="text-[10px] font-black text-[#5F6672] uppercase tracking-widest block mb-3">Quick share</span>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={shareViaWhatsApp}
                className="flex flex-col sm:flex-row items-center justify-center gap-2 py-3 px-4 rounded-xl border border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/20 text-[#0A0A0A] transition-all cursor-pointer font-semibold text-xs text-center"
              >
                <SocialLogo platform="whatsapp" size={16} />
                <span>WhatsApp</span>
              </button>
              <button
                onClick={shareViaTwitter}
                className="flex flex-col sm:flex-row items-center justify-center gap-2 py-3 px-4 rounded-xl border border-gray-200 hover:border-sky-200 hover:bg-sky-50/20 text-[#0A0A0A] transition-all cursor-pointer font-semibold text-xs text-center"
              >
                <SocialLogo platform="x" size={16} />
                <span>X / Twitter</span>
              </button>
              <button
                onClick={shareViaEmail}
                className="flex flex-col sm:flex-row items-center justify-center gap-2 py-3 px-4 rounded-xl border border-gray-200 hover:border-[#DDD6FE] hover:bg-[#F5F0FF]/20 text-[#0A0A0A] transition-all cursor-pointer font-semibold text-xs text-center"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.859 4.5h18.282A1.859 1.859 0 0 1 23 6.359v11.282A1.859 1.859 0 0 1 21.141 19.5H2.859A1.859 1.859 0 0 1 1 17.641V6.359A1.859 1.859 0 0 1 2.859 4.5" fill="#EA4335" />
                  <path d="M11.996 12.75 1.135 5.86a1.85 1.85 0 0 1 1.724-.36l9.137 5.795 9.141-5.794a1.85 1.85 0 0 1 1.723.359z" fill="#D93025" />
                </svg>
                <span>Email</span>
              </button>
            </div>
          </div>
        </div>

        {/* Stats and Mechanics */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 sm:p-8 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#0A0A0A] mb-4 flex items-center gap-2">
              <Award size={18} className="text-amber-700" /> Your referral stats
            </h2>
            
            <div className="space-y-4 mb-6">
              <div className="flex justify-between items-center p-3.5 bg-[#F9F9FB] rounded-xl border border-gray-100">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-[#5F6672]" />
                  <span className="text-xs font-semibold text-gray-600">Total referred</span>
                </div>
                <span className="text-sm font-bold text-[#0A0A0A]">
                  {loadingStats ? <Loader2 size={14} className="animate-spin text-[#5F6672]" /> : stats.total_referred}
                </span>
              </div>
              <div className="flex justify-between items-center p-3.5 bg-[#F9F9FB] rounded-xl border border-gray-100">
                <div className="flex items-center gap-2">
                  <Gift size={16} className="text-[#5F6672]" />
                  <span className="text-xs font-semibold text-gray-600">Rewards earned</span>
                </div>
                <span className="text-sm font-bold text-[#0A0A0A]">
                  {loadingStats ? <Loader2 size={14} className="animate-spin text-[#5F6672]" /> : `${Number(stats.rewards_earned || 0)} rewarded`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
