// v449 (Ravi: "Android Chrome walon ko kuch bhi karke Play Store pe laa, real app download karwa"):
// Creator Home card for creators using Ybex in an Android browser or the Chrome-installed web app — never inside the
// Play Store app, never on iPhone / laptop. "Later" hides it for 3 days. Shown only once the Play listing is live.
import React, { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { isNative } from "../../lib/native";
import { isAndroidBrowser, playStoreUrl } from "./PlayStoreBanner";
import { trackFunnel } from "../../lib/metaPixel";
import { safeStorage } from "../../utils/storage";

const KEY = "yb_get_app_card_until";
export const GET_APP_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/** Pure: should the card show? */
export function showGetAppCard({ ua = "", native = false, snoozedUntil = 0, now = Date.now() } = {}) {
  return !native && isAndroidBrowser(ua) && !(Number(snoozedUntil) > now);
}

export default function GetAppCard() {
  const [live, setLive] = useState(false);
  const [hide, setHide] = useState(() => {
    let until = 0; try { until = Number(safeStorage.getItem(KEY) || 0); } catch { /* show */ }
    return !showGetAppCard({ ua: typeof navigator !== "undefined" ? navigator.userAgent : "", native: isNative(), snoozedUntil: until });
  });
  useEffect(() => {
    if (hide) return undefined;
    let alive = true;
    api.get("public/app-links", { bypassCache: true }).then(({ data }) => { if (alive) setLive(Boolean(data?.play_live)); }).catch(() => {});
    return () => { alive = false; };
  }, [hide]);
  if (hide || !live) return null;
  const href = playStoreUrl({ utm_source: "web_app", utm_medium: "home_card", utm_campaign: "get_app_card" }, "home", "creator");
  const later = () => { setHide(true); try { safeStorage.setItem(KEY, String(Date.now() + GET_APP_SNOOZE_MS)); } catch { /* this visit */ } };
  return (
    <div data-testid="get-app-card" className="mx-4 mt-3 rounded-2xl p-4 text-white" style={{ background: "#17122B" }}>
      <div className="text-[12px] font-bold text-[#C4B5FD]">Ybex app ab Play Store pe</div>
      <div className="mt-1 text-[17px] font-extrabold leading-snug">App download karo, pehli deal pe ₹500 extra 💸</div>
      <div className="mt-1 text-[12.5px] text-white/80">Naye campaigns aur brand messages ka alert seedha phone pe. Same account, same login.</div>
      <div className="mt-3 flex items-center gap-2">
        <a href={href} rel="noopener" data-testid="get-app-play" onClick={() => { try { trackFunnel("PlayStoreClick", { page: "home_card" }); } catch { /* go */ } }}
          className="flex-1 h-11 rounded-xl bg-white text-[#0A0A0A] font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98]">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1A0033" d="M4 2.5v19l10.2-9.5L4 2.5zm11.6 8.2L6.5 2.2l11.3 6.4-2.2 2.1zm0 2.6l2.2 2.1-11.3 6.4 9.1-8.5zm3.6-3.3L22 11.6c.7.4.7 1.4 0 1.8l-2.8 1.6-2.4-2.3 2.4-2.3z" /></svg>
          Get it on Google Play
        </a>
        <button type="button" onClick={later} data-testid="get-app-later" className="h-11 px-3 text-[13px] font-semibold text-white/80">Later</button>
      </div>
      <div className="mt-2 text-[10.5px] text-white/60">*₹500: app se apply ki pehli deal complete aur approve hone pe. T&C apply.</div>
    </div>
  );
}
