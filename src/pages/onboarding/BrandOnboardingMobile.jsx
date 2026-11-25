import { ownDb } from "../../lib/ownDb";
import React, { useState, useEffect, useRef } from "react";
import { safeJsonParse, safeUpper } from "../../utils/safeFormat";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, Shield, Loader2, Camera } from "lucide-react";
import TrustAvatars from "../../components/onboarding/mobile/TrustAvatars";
import { api } from "../../lib/api";
import MobileOnboardingHeader, { MobilePrimaryButton, MobileChip, MobileFieldLabel, MobileTextInput } from "../../components/onboarding/mobile/MobileOnboardingShell";
import { ignored } from "../../utils/ignored";
import { loadProgress, saveProgress, resumeFor, brandPageFromMobile, userNeedsPhone, isValidIndianMobile } from "../../lib/onboardingProgress";
import { OnboardingSaveProvider } from "../../components/onboarding/FinishLater";
import TermsAgreeBox, { saveRoleConsent } from "../../components/legal/TermsAgreeBox";
import { AGENCY_TYPES } from "../../constants/agencyTypes";
import LogoCropper from "../../components/common/LogoCropper";
import IgHandleField, { fmtIgCount } from "../../components/instagram/IgHandleField"; // v363: brand handle → logo, name, followers
import { igUsername } from "../../components/instagram/InstagramFetchButton";
import { useFunnelSteps } from "../../lib/metaPixel"; // v362
import { initials as initialsOf } from "../../utils/initials";
import { brandIgOutcome, IgFindingCard, IgConfirmCard, IgSlowLine, TextLinkButton } from "../../components/onboarding/mobile/BrandIgSteps"; // v375
import { BUSINESS_TYPES, industryFor, switchToCreator, oneLineFromBio, igHandleProblem } from "../../lib/brandSignup"; // v446 / v451
import { TRUSTED_BY } from "../app/AppQuickDetails";
import { useAuth } from "../../contexts/AuthContext";

// v446 (Ravi): 7 screens → 3. Campaign types, budget, creator size and niches are asked when the brand posts its first
// brief (Brand Home "Match me with creators" card), not here. Channels: Instagram on screen 1 is enough to start.
const CAMPAIGN_TYPES = [
  { id: "paid", label: "Paid collaborations" },
  { id: "barter", label: "Barter / product" },
  { id: "onetime", label: "One-time content" },
  { id: "ambassador", label: "Long-term ambassador" },
];

function initials(name) {
  return initialsOf(name); // v346: emoji-safe ("Glow 🌿 Cosmetics" → "GC", was "G" + half an emoji)
}

export default function BrandOnboardingMobile({ user, onComplete }) {
  const navigate = useNavigate();
  const userId = user?.user_id || user?.id;
  const [screen, setScreen] = useState(1);
  useFunnelSteps(screen, 8, "brand_mobile"); // v362: Meta / GA funnel
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const { refreshUser } = useAuth() || {};
  const [switching, setSwitching] = useState(false);
  const fileInputRef = useRef(null);
  const exitSheetRef = useRef(null); // v363: Back on the first screen → "Leave setup? / Log out" (was navigate(-1) → stuck)

  const [formData, setFormData] = useState({
    companyName: "", isAgency: false, agencyType: "", logoUrl: "", industry: "", description: "", genderFocus: "All genders",
    representativeName: user?.name || "", representativeDesignation: "", representativeMobile: user?.phone ? user.phone.replace(/\D/g, "").slice(-10) : "", representativeMobileCountryCode: "+91",
    city: "", state: "", pinCode: "",
    campaignTypes: [], budgetRange: "", creatorSize: "", niches: "",
    instagramHandle: "", instagramConnected: false,
    youtubeChannelUrl: "", youtubeConnected: false,
    linkedinUrl: "", linkedinConnected: false,
    twitterHandle: "", twitterConnected: false,
    facebookUrl: "", facebookConnected: false,
    website: "", // v366: filled from the Instagram profile when it has one; editable
    businessType: "", // v446: "What do you run?" — required
  });

  const set = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));

  // v363 (Ravi's design "Brand 01 · Instagram handle, auto-filled"): the brand's Instagram username fills the logo
  // (our stored copy — never over a logo the brand uploaded), the company name (if empty) and the follower count, and
  // marks Instagram as linked. Everything stays editable below.
  const [igFetching, setIgFetching] = useState(false);
  const [igNums, setIgNums] = useState(null);
  const onBrandIgFetched = (n) => {
    setIgNums(n);
    setFormData((prev) => {
      const next = { ...prev, instagramHandle: n.username || igUsername(prev.instagramHandle), instagramConnected: true };
      const curLogo = String(prev.logoUrl || "");
      if (n.photo_url && (!curLogo || /\/avatars\/ig\//.test(curLogo))) next.logoUrl = n.photo_url;
      if (n.name && !String(prev.companyName || "").trim()) next.companyName = n.name;
      if (n.website && !String(prev.website || "").trim()) next.website = n.website; // v366: website from Instagram (editable)
      if (n.bio && !String(prev.description || "").trim()) next.description = oneLineFromBio(n.bio); // v446: one line from the bio (editable)
      return next;
    });
  };
  const onBrandIgState = (st) => {
    if (st === "err") { setIgNums(null); setFormData((prev) => (prev.instagramConnected ? { ...prev, instagramConnected: false } : prev)); }
  };

  // v375 (Ravi's design "Brand Onboarding IG Split", then Ravi: "do page ki jagah wahi neeche dikha do"): step 1 is
  //   handle page (1a)  — the Instagram box; the answer shows right under it:
  //       found  → "Is this your brand?" card + Yes, that's us / Not us, change username
  //       busy   → one small line ("we'll add your logo in a few minutes") + Continue; one automatic retry after 12 s
  //       private / missing → a calm line; v451 (Ravi): Instagram is required — the brand fixes the username
  //   details (1d)     — logo, name, agency; pre-filled when Instagram answered, typed by hand otherwise.
  // Ravi: if Instagram doesn't answer, nothing happens in the background — the username is saved
  // (brand_profiles.instagram_handle) and the brand adds logo + name by hand, as before. A logo the brand uploaded is
  // never replaced by the Instagram one.
  const [igStep, setIgStep] = useState("handle");
  const [igResult, setIgResult] = useState(null); // last fetch answer
  const [igSignal, setIgSignal] = useState(0);    // bump → IgHandleField fetches now
  const [igOn, setIgOn] = useState(true);         // false → Instagram fetch switched off on the server
  const [igSlowByTime, setIgSlowByTime] = useState(false); // a fetch running for 4 s+ counts as "busy"
  const [retryIn, setRetryIn] = useState(null);   // seconds to the ONE automatic retry
  const autoRetried = useRef(false);
  const handleNow = igUsername(formData.instagramHandle);
  // v451 (Ravi): an email / website / spaces typed as the handle is refused with a clear line (we saved "namegamil.com")
  const [rawHandle, setRawHandle] = useState(null);
  const [handleErr, setHandleErr] = useState("");
  useEffect(() => {
    if (!igFetching) { setIgSlowByTime(false); return undefined; }
    const t = setTimeout(() => setIgSlowByTime(true), 4000);
    return () => clearTimeout(t);
  }, [igFetching]);
  const resultHere = igResult && igUsername(igResult.username) === handleNow ? igResult : null;
  const igView = !handleNow ? "empty"
    : igFetching ? (igSlowByTime ? "slow" : "finding")
    : ({ found: "found", slow: "slow", not_found: "not_found", off: "off", none: "idle" })[brandIgOutcome(resultHere)];
  const igFound = igView === "found" ? resultHere.nums : null;
  const toDetails = (patch = {}) => { setRetryIn(null); setFormData((prev) => ({ ...prev, ...patch })); setIgStep("details"); };
  const onIgResult = (r) => setIgResult(r);
  const findMyBrand = () => {
    if (!handleNow) { toast.error("Enter your brand's Instagram username."); return; }
    if (!igOn) { toast("Instagram lookup isn't available right now — add your logo and name below.", { id: "brand-ig-off" }); toDetails(); return; } // v416: say why (it skipped silently)
    setIgSignal((n) => n + 1);
  };
  const retryNow = () => { autoRetried.current = true; setRetryIn(null); setIgSignal((n) => n + 1); };
  // one automatic retry when Instagram was busy (repeat retries eat Meta's hourly budget)
  useEffect(() => {
    if (igStep !== "handle" || igView !== "slow" || igFetching || autoRetried.current) { if (retryIn !== null && (igView !== "slow" || igFetching)) setRetryIn(null); return undefined; }
    if (retryIn === null) { setRetryIn(12); return undefined; }
    if (retryIn <= 0) { autoRetried.current = true; setRetryIn(null); setIgSignal((n) => n + 1); return undefined; }
    const t = setTimeout(() => setRetryIn((v) => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(t);
  }, [igStep, igView, igFetching, retryIn]);
  const notFound = igView === "not_found";

  // Session 34 (Ravi): answers + this screen are saved on the SERVER after every step (not on this
  // device), so the brand continues exactly here on any device. Basic details (company name,
  // designation, mobile) come first: screen order is now 1 → 4 → 2 → 3 → 5 → 6 → 7.
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [basicsDone, setBasicsDone] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    loadProgress().then((p) => {
      if (!alive) return;
      if (p) {
        if (p.answers && typeof p.answers === "object") {
          setFormData((prev) => ({ ...prev, ...p.answers }));
          // v375: came back after step 1a — continue on the details, not the empty handle box
          if (String(p.answers.companyName || "").trim() || p.answers.logoUrl || p.answers.instagramConnected) setIgStep("details");
        }
        const r = resumeFor("brand_mobile", p);
        if (r?.screen) setScreen(r.screen);
        if (p.basics_done) setBasicsDone(true);
      } else {
        // One-time move of answers an older build kept on this device.
        try {
          const old = safeJsonParse(localStorage.getItem(`ybex_brand_onboarding_${userId}`), null);
          if (old?.formData) setFormData((prev) => ({ ...prev, ...old.formData }));
        } catch (e) { ignored("BrandOnboardingMobile:legacy", e); }
      }
      setProgressLoaded(true);
    });
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    if (!progressLoaded || screen > 3) return;
    saveProgress({ flow: "brand_mobile", page: brandPageFromMobile(screen), pos: { step: screen, v: 2 }, answers: formData, basicsDone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, progressLoaded]);

  const needPhone = userNeedsPhone(user);
  // v446: screen 3 (name + phone) is the last one — the phone is saved with the progress, then the profile is published.
  const finish = async () => {
    if (!String(formData.representativeName || "").trim()) { toast.error("Please enter your name."); return; }
    if (!isValidIndianMobile(formData.representativeMobile)) { toast.error("Please enter a valid 10-digit mobile number (starting with 6, 7, 8, or 9)"); return; }
    if (!agreedTerms) { toast.error("Please tick the box to agree to the Terms."); return; }
    setSaving(true);
    try {
      const res = await saveProgress({
        flow: "brand_mobile", page: "contact", pos: { step: 3, v: 2 }, answers: formData, basicsDone: true,
        phone: needPhone ? `+91${formData.representativeMobile}` : undefined,
      });
      if (res?.success === false && ["BAD_PHONE", "PHONE_SAVE_FAILED"].includes(res.code)) { toast.error(res.error); setSaving(false); return; }
      setBasicsDone(true);
    } catch (e) { ignored("BrandOnboardingMobile:basics", e); }
    setSaving(false);
    await publish();
  };

  const chooseType = (id) => {
    setFormData((prev) => ({ ...prev, businessType: id, isAgency: id === "agency", agencyType: id === "agency" ? prev.agencyType : "" }));
  };
  const goCreator = async () => {
    setSwitching(true);
    try { await switchToCreator({ refreshUser, navigate }); }
    catch (e) {
      setSwitching(false);
      toast.error(e?.response?.data?.detail || "Couldn't switch to a creator account. Log out and sign up as a creator.");
    }
  };

  // v283: pick → adjust (LogoCropper) → upload the cropped square.
  const [cropFile, setCropFile] = useState(null);
  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (file) setCropFile(file);
  };
  const uploadLogoFile = async (file) => {
    if (!file) return;
    const prevLogo = formData.logoUrl && !String(formData.logoUrl).startsWith("blob:") ? formData.logoUrl : "";
    const previewUrl = URL.createObjectURL(file);
    set("logoUrl", previewUrl);
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("upload?bucket=profile-assets", fd, { headers: { "Content-Type": "multipart/form-data" } });
      if (res.data?.url) {
        set("logoUrl", res.data.url);
        toast.success("Logo uploaded!");
      }
    } catch (err) {
      // v332: calm copy, and the logo goes back to the last uploaded one — the temporary on-phone preview was
      // being saved as the brand logo and showed broken everywhere else.
      set("logoUrl", prevLogo);
      // v363 (reviewer: "logo upload nahi ho raha"): say why — expired login, too big, wrong type — not one generic line.
      const st = err?.response?.status;
      const why = err?.response?.data?.detail || err?.response?.data?.error;
      if (st === 401 || st === 403) toast.error("Your login has expired. Tap Exit → Log out, then sign in again.");
      else if (st === 413) toast.error("This image is too big. Please pick one under 10 MB.");
      else toast.error(why ? `Couldn't upload the logo: ${String(why).slice(0, 120)}` : "Couldn't upload the logo. Check your internet and try again — or skip it for now and add it later.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const goNext = (next) => setScreen(next);

  const [quality, setQuality] = useState("");
  const publish = async () => {
    const skipNiches = true; // v446: niches are asked with the first brief
    // Session 34: the Terms box on the last step is required (legal draft Part E).
    if (!agreedTerms) { toast.error("Please tick the box to agree to the Terms before you publish."); return; }
    if (uploadingLogo) { toast("Your logo is still uploading — one second…", { id: "brand-logo-wait" }); return; } // v451
    setSaving(true);
    try { await saveRoleConsent("brand"); } catch (e) { ignored("BrandOnboardingMobile:consent", e); } // v363: a throw here left Publish spinning
    try {
      const primaryPlatform = formData.instagramConnected ? "instagram" : formData.youtubeConnected ? "youtube" : "instagram";
      const primaryHandle = formData.instagramConnected ? formData.instagramHandle : formData.youtubeConnected ? formData.youtubeChannelUrl : "";

      const payload = {
        company_name: formData.companyName,
        is_agency: Boolean(formData.isAgency),
        industry: formData.industry || industryFor(formData.businessType), // v446: from "What do you run?"
        business_type: formData.businessType, // v446 → QualifiedBrand (server)
        instagram_followers: Number(igNums?.followers) || 0,
        instagram_tried: formData.igTried || "", // v446: a handle Instagram couldn't read (private / missing) → "Unverified"
        description: formData.description,
        gender_focus: formData.genderFocus,
        ...(String(formData.website || "").trim() ? { website: String(formData.website).trim().slice(0, 300) } : {}), // v366
        ...(igNums?.bio ? { instagram_bio: String(igNums.bio).slice(0, 600) } : {}), // v451 (Ravi): full IG bio for the admin review
        social_handle: primaryHandle,
        social_platform: primaryPlatform,
        instagram_handle: formData.instagramHandle,
        instagram_connected: formData.instagramConnected,
        youtube_channel_url: formData.youtubeChannelUrl,
        youtube_connected: formData.youtubeConnected,
        linkedin_url: formData.linkedinUrl,
        linkedin_connected: formData.linkedinConnected,
        twitter_handle: formData.twitterHandle,
        twitter_connected: formData.twitterConnected,
        facebook_url: formData.facebookUrl,
        facebook_connected: formData.facebookConnected,
        city: formData.city,
        state: formData.state,
        pin_code: formData.pinCode,
        campaign_types: formData.campaignTypes,
        budget_range: formData.budgetRange,
        creator_size: formData.creatorSize,
        preferred_niches: skipNiches ? "" : formData.niches,
        representative_name: formData.representativeName,
        representative_designation: formData.representativeDesignation,
        representative_mobile: (formData.representativeMobileCountryCode || "+91") + " " + formData.representativeMobile,
        // v363: the logo goes with the server save too (it used to come only from the second, browser-side write below)
        logo_url: formData.logoUrl && !String(formData.logoUrl).startsWith("blob:") ? formData.logoUrl : "",
        onboarded_at: new Date().toISOString(),
        onboarding_completed: true,
      };

      // Session 41: keep the onboarding page open for the final preview (see Onboarding.jsx).
      try { sessionStorage.setItem("ybex_onboarding_preview", "1"); } catch (e) { ignored("BrandOnboardingMobile:preview", e); }
      const done = await api.post("auth/onboard", { role: "brand", data: payload });
      setQuality(done?.data?.brand_quality || "");

      // v363: the server above already saved the whole profile; this extra copy must not turn a finished
      // publish into "Couldn't publish".
      try { await ownDb.from("brand_profiles").upsert({
        user_id: userId,
        company_name: formData.companyName,
        is_agency: Boolean(formData.isAgency),
        industry: formData.industry || industryFor(formData.businessType), // v446: from "What do you run?"
        description: formData.description,
        // v451 (Pradeep Kumar 24 bug): this browser copy wrote the on-phone "blob:" preview as the logo
        ...(formData.logoUrl && !String(formData.logoUrl).startsWith("blob:") ? { logo: formData.logoUrl } : {}),
        city: formData.city,
        state: formData.state,
        representative_name: formData.representativeName,
        representative_designation: formData.representativeDesignation,
        representative_mobile: (formData.representativeMobileCountryCode || "+91") + " " + formData.representativeMobile,
        updated_at: new Date().toISOString(),
      }); } catch (e) { ignored("BrandOnboardingMobile:ownDb", e); }

      // Through the server (session 22): the browser may no longer write `users` directly.
      try { await api.post("/users/me/agency", { is_agency: Boolean(formData.isAgency), agency_type: formData.agencyType || null }); } catch (e) { ignored("BrandOnboardingMobile:agency", e); }

      try {
        localStorage.removeItem(`ybex_brand_onboarding_${userId}`);
      } catch (e) { ignored("BrandOnboardingMobile:174", e); }

      setScreen(8);
    } catch (e) {
      try { sessionStorage.removeItem("ybex_onboarding_preview"); } catch (e2) { ignored("BrandOnboardingMobile:preview", e2); }
      console.error("BRAND ONBOARD ERROR (mobile):", e);
      const st = e?.response?.status;
      if (st === 401 || st === 403) toast.error("Your login has expired. Tap Exit → Log out, then sign in again — your answers are saved.");
      else if (!e?.response) toast.error("No internet right now — your answers are saved. Try Publish again in a moment.");
      else toast.error(e?.response?.data?.detail || e?.response?.data?.error || "Couldn't publish your profile. Please try again."); // v332: no raw tech text
    } finally {
      setSaving(false);
    }
  };

  const handleFinalCTA = async (dest) => {
    try { sessionStorage.removeItem("ybex_onboarding_preview"); } catch (e) { ignored("BrandOnboardingMobile:preview", e); }
    try {
      await onComplete();
    } catch (e) { ignored("BrandOnboardingMobile:188", e); }
    navigate(dest, { replace: true }); // v332: Back from KYC / Explore no longer reopens onboarding (same as creators)
  };

  const previewSubtitle = () => {
    const parts = [];
    const t = BUSINESS_TYPES.find((x) => x.id === formData.businessType && x.id !== "creator");
    if (t) parts.push(t.label);
    if (formData.instagramConnected) parts.push("Instagram linked");
    return parts.join(" \u00b7 ");
  };

  return (
    <OnboardingSaveProvider basicsDone={basicsDone} openRef={exitSheetRef}>
    <div key={screen} className="yb-step-in" style={{ minHeight: "var(--yb-vh, 100vh)" /* v330: visible height, not 100vh */, background: "#F2F2F7", fontFamily: "'DM Sans',sans-serif", display: "flex", flexDirection: "column" }}>
      {screen === 1 && (
        <>
          <MobileOnboardingHeader showStepLabel={false} showTimeline={false} previewLabel={"Creators\nsee this"} stepLabel={"Brand setup \u00b7 1 of 3"} filledSteps={1}
            onBack={() => { if (igStep === "handle") exitSheetRef.current?.(); else { setRetryIn(null); setIgStep("handle"); } }} />
          {/* v375 1a — the brand's Instagram; the answer shows right under the box */}
          {igStep === "handle" && (
          <div data-testid="brand-step-handle" style={{ flex: 1, padding: "8px 20px 0", display: "flex", flexDirection: "column" }}>
            <h2 style={{ margin: 0, font: "700 26px/1.18 'DM Sans',sans-serif", letterSpacing: "-.6px", color: "#0A0A0A" }}>What's your brand's Instagram?</h2>
            <p style={{ margin: "8px 0 0", font: "400 14.5px/1.5 'DM Sans',sans-serif", color: "#5F6672" }}>Start with your Instagram. We'll fill in the rest.</p>
            <div style={{ marginTop: 22 }}>
              <IgHandleField
                value={rawHandle ?? formData.instagramHandle}
                onChange={(v) => {
                  const problem = igHandleProblem(v);
                  if (problem) { setRawHandle(String(v || "")); setHandleErr(problem); if (formData.instagramHandle) { setIgNums(null); setFormData((prev) => ({ ...prev, instagramHandle: "", instagramConnected: false })); } return; }
                  setRawHandle(null); setHandleErr("");
                  const next = String(v || "").replace(/^.*instagram\.com\//i, "").replace(/^@+/, "").replace(/[/?#].*$/, "").toLowerCase().replace(/[^a-z0-9_.]/g, "");
                  if (next !== formData.instagramHandle && formData.instagramConnected) { setIgNums(null); setFormData((prev) => ({ ...prev, instagramConnected: false })); }
                  if (next !== formData.instagramHandle) { autoRetried.current = false; setRetryIn(null); }
                  set("instagramHandle", next);
                }}
                onBusyChange={setIgFetching}
                onStateChange={onBrandIgState}
                onResult={onIgResult}
                onConfig={setIgOn}
                fetchSignal={igSignal}
                quiet
                autoFocus={!formData.instagramHandle}
                placeholder="yourbrand"
                showCard={false}
                testId="brand-ig-field"
              />
            </div>
            {handleErr && <div role="alert" data-testid="brand-ig-handle-error" style={{ marginTop: 8, font: "500 13px/1.45 'DM Sans',sans-serif", color: "#DC2626" }}>{handleErr}</div>}
            {igView === "finding" && <IgFindingCard />}
            {igView === "found" && (
              <div data-testid="brand-ig-preview" style={{ marginTop: 18 }}>
                <div style={{ font: "700 17px 'DM Sans',sans-serif", color: "#0A0A0A" }}>Is this your page?</div>
                <IgConfirmCard nums={igFound} handle={igFound?.username || handleNow} />
              </div>
            )}
            {igView === "slow" && (
              <IgSlowLine handle={handleNow} retryIn={retryIn} retrying={igFetching} onRetry={retryNow} />
            )}
            {notFound && (
              <div role="alert" data-testid="brand-ig-notfound" style={{ marginTop: 10, font: "500 13px/1.45 'DM Sans',sans-serif", color: "#B45309" }}>
                We couldn't find @{handleNow} as a public account. Check the spelling, or switch it to a Business or Creator account in Instagram settings.
              </div>
            )}
            {(igView === "empty" || igView === "idle" || igView === "off") && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ flexShrink: 0 }}><TrustAvatars size={24} fromExplore max={4} /></div>
                <span style={{ font: "500 12px 'DM Sans',sans-serif", color: "#5F6672" }}><span style={{ color: "#0A0A0A", fontWeight: 600 }}>{TRUSTED_BY} creators</span> check your Instagram</span>
              </div>
            )}
            <div style={{ marginTop: "auto", position: "sticky", bottom: 0, zIndex: 5, background: "#F2F2F7", paddingBottom: "calc(18px + env(safe-area-inset-bottom, 0px))", paddingTop: 20 }}>
              {igView === "found" ? (
                <>
                  <MobilePrimaryButton onClick={() => { onBrandIgFetched(igFound); toDetails(); }}>Yes, that's us</MobilePrimaryButton>
                  <TextLinkButton testId="brand-ig-not-us" onClick={() => { setIgResult(null); setIgNums(null); setFormData((prev) => ({ ...prev, instagramHandle: "", instagramConnected: false })); }}>Not us, change username</TextLinkButton>
                </>
              ) : igView === "slow" ? (
                <>
                  <MobilePrimaryButton onClick={() => toDetails({ instagramConnected: false })}>Continue</MobilePrimaryButton>
                </>
              ) : (
                <>
                  {/* v451 (Ravi): Instagram is required for brands — no "continue without" / "set up manually" */}
                  <MobilePrimaryButton disabled={!handleNow || igView === "finding" || igView === "not_found"} onClick={findMyBrand}>
                    {igView === "finding" ? <><Loader2 size={17} className="animate-spin" /> Finding your brand…</> : igView === "not_found" ? "Fix the username to continue" : "Find my brand"}
                  </MobilePrimaryButton>
                  <div style={{ marginTop: 10, textAlign: "center", font: "500 12px/1.45 'DM Sans',sans-serif", color: "#8E8E93" }}>Ybex is for brands with an Instagram page — we check every brand before it goes live.</div>
                </>
              )}
            </div>
          </div>
          )}

          {/* v375 1d — the details (same screen as before, without the Instagram box) */}
          {igStep === "details" && (
          <div style={{ flex: 1, padding: "8px 20px 0", display: "flex", flexDirection: "column" }}>
            <h2 style={{ margin: 0, font: "600 23px/1.28 'DM Sans',sans-serif", letterSpacing: "-.7px", color: "#0A0A0A" }}>Your brand, as creators will see it.</h2>
            {/* v375 (Ravi: "ye mat dikhao"): no second Instagram card here — the brand already saw it on "Is this your brand?" */}
            {/* Session 41 (Ravi): logo box in the middle like the creator photo step, then a trust line. */}
            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: "none" }} />
              <LogoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={(f) => { setCropFile(null); uploadLogoFile(f); }} />
              <div
                onClick={() => fileInputRef.current?.click()}
                data-testid="brand-logo-upload-box"
                style={{
                  width: 120, height: 120, borderRadius: 32, cursor: "pointer", position: "relative", overflow: "hidden", marginTop: 10,
                  border: formData.logoUrl ? "2px solid #7C3AED" : "1.5px dashed #D6D6DC", background: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
                }}
              >
                {uploadingLogo ? (
                  <Loader2 size={24} className="animate-spin" color="#7C3AED" />
                ) : formData.logoUrl ? (
                  <>
                    <img src={formData.logoUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                    <span style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", padding: "4px 10px", borderRadius: 999, background: "rgba(10,10,10,.6)", color: "#fff", font: "600 11px 'DM Sans',sans-serif", whiteSpace: "nowrap" }}>Change</span>
                  </>
                ) : (
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 40, height: 40, borderRadius: 13, background: "#F5F0FF", display: "flex", alignItems: "center", justifyContent: "center" }}><Camera size={19} color="#7C3AED" /></span>
                    <span style={{ font: "600 12.5px 'DM Sans',sans-serif", color: "#0A0A0A" }}>Add logo</span>
                  </span>
                )}
              </div>
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
                <div style={{ flexShrink: 0 }}><TrustAvatars size={24} fromExplore max={4} /></div>
                <div style={{ font: "500 12px 'DM Sans',sans-serif", color: "#5F6672" }}>Clear logo = <span style={{ color: "#0A0A0A", fontWeight: 600 }}>more creators apply</span></div>
              </div>
            </div>
            <MobileFieldLabel>Brand / company name</MobileFieldLabel>
            <MobileTextInput value={formData.companyName} onChange={(v) => set("companyName", v)} placeholder="Your company name" />
            {(igNums || String(formData.website || "").trim()) && (
              <>
                {/* v366/v375: website from the Instagram profile — the brand can fix or clear it */}
                <MobileFieldLabel>Website</MobileFieldLabel>
                <input data-testid="brand-ig-website" value={formData.website || ""} onChange={(e) => set("website", e.target.value.slice(0, 300))} placeholder="https://yourbrand.com" inputMode="url" autoCapitalize="none" autoCorrect="off"
                  style={{ marginTop: 8, width: "100%", height: 48, borderRadius: 12, border: "1px solid #E5E5EA", background: "#fff", padding: "0 14px", font: "500 16px 'DM Sans',sans-serif", color: "#0A0A0A", boxSizing: "border-box", outline: "none" }} />
              </>
            )}
            <div style={{ marginTop: "auto", position: "sticky", bottom: 0, zIndex: 5, background: "#F2F2F7", paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))", paddingTop: 20 }}>
              <MobilePrimaryButton disabled={!formData.companyName.trim() || !String(formData.instagramHandle || "").trim()} onClick={() => goNext(2)}>{igNums ? "Looks right, next" : "Next"}</MobilePrimaryButton>
            </div>
          </div>
          )}
        </>
      )}

      {screen === 2 && (
        <>
          <MobileOnboardingHeader showStepLabel={false} showTimeline={false} previewLabel={"Creators\nsee this"} stepLabel={"Brand setup \u00b7 2 of 3"} filledSteps={2} onBack={() => setScreen(1)} preview={{ avatarNode: <BrandAvatar formData={formData} />, title: formData.companyName, subtitle: previewSubtitle() }} />
          <div data-testid="brand-step-business" style={{ flex: 1, padding: "8px 20px 0", display: "flex", flexDirection: "column" }}>
            <h2 style={{ margin: 0, font: "600 23px/1.28 'DM Sans',sans-serif", letterSpacing: "-.7px", color: "#0A0A0A" }}>What do you run?</h2>
            <p style={{ margin: "9px 0 0", font: "400 13.5px/1.6 'DM Sans',sans-serif", color: "#5F6672" }}>We match you with creators who fit your kind of business.</p>
            <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {BUSINESS_TYPES.map((t) => (
                <MobileChip key={t.id} label={t.label} selected={formData.businessType === t.id} onClick={() => chooseType(t.id)} />
              ))}
            </div>
            {formData.businessType === "creator" ? (
              <div data-testid="brand-creator-switch" style={{ marginTop: 18, padding: 15, borderRadius: 14, background: "#F5F0FF", border: "1px solid #E4D8FF" }}>
                <div style={{ font: "600 14px/1.45 'DM Sans',sans-serif", color: "#0A0A0A" }}>You want to work with brands?</div>
                <div style={{ marginTop: 4, font: "500 13px/1.5 'DM Sans',sans-serif", color: "#4B5563" }}>The creator sign-up gets you paid campaigns and UGC work. Your login stays the same.</div>
              </div>
            ) : (
              <>
                {formData.businessType === "agency" && (
                  <select value={formData.agencyType || ""} onChange={(e) => set("agencyType", e.target.value)} data-testid="brand-agency-type"
                    style={{ marginTop: 12, width: "100%", height: 52, borderRadius: 14, border: "1px solid #E5E5EA", background: "#fff", padding: "0 15px", font: "500 16px 'DM Sans',sans-serif", color: "#0A0A0A", outline: "none" }}>
                    <option value="" disabled>Type of agency (optional)</option>
                    {AGENCY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
                <MobileFieldLabel right="1 line">What should creators know?</MobileFieldLabel>
                <MobileTextInput value={formData.description} onChange={(v) => set("description", String(v || "").slice(0, 140))} placeholder="e.g. Handmade skincare for oily skin" />
                <div style={{ marginTop: 6, font: "500 12px 'DM Sans',sans-serif", color: "#8E8E93" }}>{igNums?.bio ? "Taken from your Instagram bio. Edit it if you like." : "Creators read this before they apply."}</div>
              </>
            )}
            <div style={{ marginTop: "auto", position: "sticky", bottom: 0, zIndex: 5, background: "#F2F2F7", paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))", paddingTop: 20 }}>
              {formData.businessType === "creator" ? (
                <MobilePrimaryButton disabled={switching} onClick={goCreator}>{switching ? <Loader2 size={16} className="animate-spin" /> : "Go to creator sign-up"}</MobilePrimaryButton>
              ) : (
                <MobilePrimaryButton disabled={!formData.businessType} onClick={() => goNext(3)}>Next</MobilePrimaryButton>
              )}
            </div>
          </div>
        </>
      )}

      {screen === 3 && (
        <>
          <MobileOnboardingHeader showStepLabel={false} showTimeline={false} previewLabel={"Creators\nsee this"} stepLabel="Last step" filledSteps={3} onBack={() => setScreen(2)} preview={{ avatarNode: <BrandAvatar formData={formData} size={44} />, title: formData.companyName, subtitle: previewSubtitle() }} />
          <div data-testid="brand-step-contact" style={{ flex: 1, padding: "8px 20px 0", display: "flex", flexDirection: "column" }}>
            <h2 style={{ margin: 0, font: "600 23px/1.28 'DM Sans',sans-serif", letterSpacing: "-.7px", color: "#0A0A0A" }}>Who should creators talk to?</h2>
            <p style={{ margin: "9px 0 0", font: "400 13.5px/1.6 'DM Sans',sans-serif", color: "#5F6672" }}>Your number stays private. We only use it for deal updates.</p>
            <MobileFieldLabel>Your name</MobileFieldLabel>
            <MobileTextInput value={formData.representativeName} onChange={(v) => set("representativeName", v)} placeholder="Full name" />
            <MobileFieldLabel>Mobile number</MobileFieldLabel>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", height: 52, borderRadius: 14, background: "#fff", border: "1px solid #E5E5EA", padding: "0 15px", gap: 10 }}>
              <span style={{ font: "600 16px 'DM Sans',sans-serif", color: "#0A0A0A" }}>+91</span>
              <input data-testid="brand-phone" value={formData.representativeMobile} inputMode="numeric" maxLength={10} placeholder="10-digit number"
                onChange={(e) => set("representativeMobile", e.target.value.replace(/\D/g, "").slice(0, 10))}
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", font: "500 16px 'DM Sans',sans-serif", color: "#0A0A0A" }} />
            </div>
            <div style={{ marginTop: 18, padding: 15, borderRadius: 14, background: "#ECFDF5", border: "1px solid #C7EFDD", display: "flex", gap: 12 }}>
              <Shield size={20} color="#059669" strokeWidth={1.9} />
              <div>
                <div style={{ font: "600 12.5px 'DM Sans',sans-serif", color: "#059669" }}>Payment protection on every deal</div>
                <div style={{ marginTop: 5, font: "500 12.5px/1.55 'DM Sans',sans-serif", color: "#047857" }}>Ybex holds your payment and releases it to the creator only after you approve the work.</div>
              </div>
            </div>
            <div style={{ marginTop: "auto", position: "sticky", bottom: 0, zIndex: 5, background: "#F2F2F7", paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))", paddingTop: 20 }}>
              <TermsAgreeBox role="brand" checked={agreedTerms} onChange={setAgreedTerms} compact />
              <MobilePrimaryButton disabled={saving || !String(formData.representativeName || "").trim() || String(formData.representativeMobile || "").length !== 10} onClick={finish} style={{ boxShadow: "0 14px 26px -20px rgba(124,58,237,.8)" }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : "Done, show my profile"}
              </MobilePrimaryButton>
            </div>
          </div>
        </>
      )}

      {screen === 8 && <BrandProfileLiveScreen formData={formData} quality={quality} onFinish={handleFinalCTA} />}

    </div>
    </OnboardingSaveProvider>
  );
}

function BrandAvatar({ formData, size = 38 }) {
  if (formData.logoUrl) {
    return <img src={formData.logoUrl} alt="" style={{ width: size, height: size, borderRadius: size * 0.32, objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.32, background: "linear-gradient(135deg,#7C3AED,#9F62FF)", display: "flex", alignItems: "center", justifyContent: "center", font: `700 ${Math.round(size * 0.32)}px 'DM Sans',sans-serif`, color: "#fff", flexShrink: 0 }}>
      {initials(formData.companyName)}
    </div>
  );
}

function BrandProfileLiveScreen({ formData, quality, onFinish }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, padding: "0 24px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: "100%", borderRadius: 22, overflow: "hidden", background: "#fff", border: "1px solid #ECECF0", boxShadow: "0 18px 40px -30px rgba(18,18,26,.3)" }}>
          <div style={{ height: 78, background: "linear-gradient(160deg,#16173A,#241F52)", display: "flex", alignItems: "center", justifyContent: "center", font: "600 15px 'DM Sans',sans-serif", letterSpacing: "2.4px", color: "rgba(255,255,255,.62)" }}>
            {safeUpper(formData.companyName)}
          </div>
          <div style={{ padding: "0 16px 18px" }}>
            <div style={{ marginTop: -31 }}>
              <div style={{ border: "4px solid #fff", borderRadius: 35, display: "inline-block" }}>
                <BrandAvatar formData={formData} size={62} />
              </div>
            </div>
            <div style={{ marginTop: 11, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ font: "700 18px/1.1 'DM Sans',sans-serif", letterSpacing: "-.5px", color: "#0A0A0A" }}>{formData.companyName}</div>
                <div style={{ marginTop: 4, font: "500 12.5px/1.1 'DM Sans',sans-serif", color: "#5F6672" }}>{/* v332: "\u00b7" was showing as raw text */}{[formData.industry || industryFor(formData.businessType), formData.city || "India"].filter(Boolean).join(" · ")}{/* v358: the real city when given */}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 7 }}>
              {formData.budgetRange && <div style={{ height: 28, padding: "0 11px", borderRadius: 8, background: "#F5F0FF", display: "flex", alignItems: "center", font: "600 11px 'DM Sans',sans-serif", color: "#7C3AED" }}>{formData.budgetRange}</div>}
              {formData.creatorSize && <div style={{ height: 28, padding: "0 11px", borderRadius: 8, background: "#F2F2F7", display: "flex", alignItems: "center", font: "500 11px 'DM Sans',sans-serif", color: "#5F6672" }}>{formData.creatorSize.split(" ")[0]} creators</div>}
              {formData.campaignTypes.length > 0 && <div style={{ height: 28, padding: "0 11px", borderRadius: 8, background: "#F2F2F7", display: "flex", alignItems: "center", font: "500 11px 'DM Sans',sans-serif", color: "#5F6672" }}>{/* v416 (M15): the brand's real choices (was always "Paid + UGC" / "Barter") */}{CAMPAIGN_TYPES.filter((t) => formData.campaignTypes.includes(t.id)).map((t) => t.label).join(" · ")}</div>}
            </div>
          </div>
        </div>
        <h2 style={{ margin: "30px 0 0", font: "600 24px/1.25 'DM Sans',sans-serif", letterSpacing: "-.8px", color: "#0A0A0A", textAlign: "center" }}>Your profile is live</h2>
        <p style={{ margin: "11px 0 0", maxWidth: 274, font: "400 14px/1.65 'DM Sans',sans-serif", color: "#5F6672", textAlign: "center" }}>
          {/* v416 (M15): matches "Posting is free" — verification is what publishing and paying need */}Verified creators can now discover you. Verify your brand (about 2 minutes) to publish campaigns and pay creators.
        </p>
        {quality === "unverified" && (
          <div data-testid="brand-unverified-note" style={{ marginTop: 14, maxWidth: 300, padding: "11px 13px", borderRadius: 12, background: "#FFF7ED", border: "1px solid #FED7AA", font: "500 12.5px/1.5 'DM Sans',sans-serif", color: "#9A3412", textAlign: "center" }}>
            Your Instagram is private or very new, so creators see "Unverified" for now. Verify your brand below and it goes away.
          </div>
        )}
      </div>
      <div style={{ padding: "0 20px calc(26px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
        <MobilePrimaryButton onClick={() => onFinish("/brand/kyc")}>
          <Shield size={16} color="#fff" /> Verify your brand
        </MobilePrimaryButton>
        <button onClick={() => onFinish("/explore")} style={{ height: 52, borderRadius: 14, background: "#fff", border: "1px solid #E5E5EA", boxSizing: "border-box", font: "600 15px 'DM Sans',sans-serif", color: "#0A0A0A", cursor: "pointer" }}>
          Explore creators
        </button>
      </div>
    </div>
  );
}
