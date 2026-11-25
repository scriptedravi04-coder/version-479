import React, { useEffect } from "react";
import PlayStoreBanner from "../../components/common/PlayStoreBanner"; // v418
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { postLoginPath } from "../auth/Login";
import { captureRefFromUrl } from "../../lib/referralCapture";
import AppLoginScreen from "../../components/app/AppLoginScreen";
import useDemoLogin from "../../lib/useDemoLogin";
import { appAuthTarget } from "../../lib/standalone";
import { readEntryRole } from "../../lib/signupSource";

/** v446 (Ravi: "role=brand wale link se seedha brand sign-up khule"): a link / Play install that asked for a role skips
 *  the role cards. Pure: returns the path to open, or "" to show the cards. */
export function welcomeSkipTarget(search, storedRole = "") {
  const q = new URLSearchParams(search || "");
  if (q.get("demo")) return "";
  const asked = String(q.get("role") || q.get("type") || "").toLowerCase();
  if (asked) { const t = appAuthTarget(search); return t && t !== "/app" && !t.startsWith("/app?") ? t : ""; }
  if (storedRole === "brand" || storedRole === "creator") {
    const rest = q.toString();
    return `/app/continue/${storedRole}${rest ? `?${rest}` : ""}`;
  }
  return "";
}

// Session 42 (Ravi): what the installed app shows when nobody is logged in. Logged in → straight to
// the dashboard. The website landing page is never shown inside the app.
// Session 43 (v282): the screen is Ravi's Claude Design "Ybex Login" (AppLoginScreen). The email
// screen ships in the main bundle (App.jsx), so tapping a card no longer flashes a blank page.
export default function AppWelcome() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const demoOn = useDemoLogin();

  useEffect(() => { try { captureRefFromUrl(); } catch { /* no referral in the link */ } }, []);
  const skipTo = typeof window !== "undefined" ? welcomeSkipTarget(window.location.search, readEntryRole()) : "";
  useEffect(() => {
    if (loading || user || !skipTo) return;
    navigate(skipTo, { replace: true });
  }, [loading, user, skipTo, navigate]);

  useEffect(() => {
    if (!loading && user) navigate(postLoginPath(user), { replace: true });
  }, [user, loading, navigate]);

  if (loading || user || skipTo) return <div className="min-h-[100dvh] bg-[#F2F1F7]" aria-busy="true" />;

  return (
    <div data-testid="app-welcome" style={{ background: "#F2F1F7", minHeight: "100dvh" }}>
      <PlayStoreBanner page="signup" />{/* v418: Android browsers get the Play Store app first */}
      <AppLoginScreen
        footer={demoOn ? (
          <div className="text-center">
            <Link to="/login?demo=1" className="text-[12.5px] font-semibold text-[#7C3AED] underline underline-offset-2" data-testid="app-demo-link">
              Demo access (test server)
            </Link>
          </div>
        ) : null}
      />
    </div>
  );
}
