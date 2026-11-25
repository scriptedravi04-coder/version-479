// v449 (Ravi: "Android Chrome walon ko Play Store pe laa"): /get-app — one link for push, mail, bio and ads.
// Android browser (incl. the Chrome-installed web app) → Play Store listing with the tags as the install referrer.
// Already in the app, iPhone or laptop → Home (nothing to install there).
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isNative } from "../lib/native";
import { isAndroidBrowser, playStoreUrl } from "../components/common/PlayStoreBanner";
import { trackFunnel } from "../lib/metaPixel";

/** Pure: where /get-app should send this visitor. */
export function getAppTarget({ ua = "", native = false, search = "" } = {}) {
  if (native || !isAndroidBrowser(ua)) return { kind: "home" };
  const q = new URLSearchParams(search || "");
  const src = {
    utm_source: q.get("utm_source") || "get_app",
    utm_medium: q.get("utm_medium") || "link",
    utm_campaign: q.get("utm_campaign") || "get_app",
  };
  return { kind: "play", url: playStoreUrl(src, "get_app", "creator") };
}

export default function GetApp() {
  const navigate = useNavigate();
  useEffect(() => {
    const t = getAppTarget({ ua: navigator.userAgent, native: isNative(), search: window.location.search });
    if (t.kind === "play") {
      try { trackFunnel("PlayStoreClick", { page: "get_app" }); } catch { /* still go */ }
      window.location.replace(t.url);
    } else navigate("/dashboard", { replace: true });
  }, [navigate]);
  return <div className="min-h-[100dvh] flex items-center justify-center text-sm text-[#5F6672]">Opening Google Play…</div>;
}
