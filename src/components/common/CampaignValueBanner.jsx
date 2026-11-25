// v450 (Ravi's Brand App mockup, 17 Nov 2026): "Total campaign value on Ybex, from N cities" — the mockup's exact card
// (soft purple gradient, two faint rings, big number, purple ticker). Creator Home: under "Meet our top creators".
// Brand Dashboard: where the Campaign Templates row was.
// The number comes from GET /public/campaign-value (₹14,60,363 base + real app campaigns/briefs + Ravi's Admin entries)
// — it never moves on its own. When it changed since this phone last saw it, the digits roll from the old number to the
// new one (so people who weren't on the app at that moment still see the change on their next open).
import React, { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { safeStorage } from "../../utils/storage";

const SEEN_KEY = "yb_cv_seen";
export const inrPlain = (n) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString("en-IN");

/** Pure: the numbers to show during a roll, from → to, `steps` frames (ease-out). */
export function rollFrames(from, to, steps = 24) {
  const a = Math.round(Number(from) || 0), b = Math.round(Number(to) || 0);
  if (!a || a === b) return [b];
  const out = [];
  for (let i = 1; i <= steps; i++) { const t = i / steps; const e = 1 - Math.pow(1 - t, 3); out.push(Math.round(a + (b - a) * e)); }
  return out;
}

function reduceMotion() {
  try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export default function CampaignValueBanner({ style }) {
  const [data, setData] = useState(null);
  const [shown, setShown] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get("public/campaign-value").then(({ data: d }) => {
      if (!alive || !d || !Number(d.total)) return;
      setData(d);
      let seen = 0; try { seen = Number(safeStorage.getItem(SEEN_KEY) || 0); } catch { /* first time */ }
      const frames = reduceMotion() ? [d.total] : rollFrames(seen, d.total);
      let i = 0;
      const tick = () => { setShown(frames[i]); i += 1; if (i < frames.length) timer.current = setTimeout(tick, 45); };
      tick();
      try { safeStorage.setItem(SEEN_KEY, String(d.total)); } catch { /* fine */ }
    }).catch(() => {});
    return () => { alive = false; clearTimeout(timer.current); };
  }, []);

  if (!data) return null;
  const lines = Array.isArray(data.ticker) ? data.ticker.filter(Boolean) : [];
  const loop = lines.length ? [...lines, ...lines] : [];
  return (
    <div data-testid="campaign-value-banner" style={{ margin: "22px 16px 0", position: "relative", borderRadius: 20, overflow: "hidden", border: "1px solid #ECE3FF", background: "linear-gradient(180deg,#F7F2FF 0%,#FFFFFF 100%)", fontFamily: "'DM Sans',sans-serif", ...style }}>
      <style>{"@keyframes ybTickerX{from{transform:translateX(0)}to{transform:translateX(-50%)}}@media (prefers-reduced-motion: reduce){.yb-cv-ticker{animation:none!important}}"}</style>
      <div style={{ position: "absolute", left: -90, top: -40, width: 180, height: 180, borderRadius: "50%", border: "18px solid rgba(139,44,245,.05)" }} />
      <div style={{ position: "absolute", right: -90, top: -40, width: 180, height: 180, borderRadius: "50%", border: "18px solid rgba(139,44,245,.05)" }} />
      <div style={{ position: "relative", padding: "20px 16px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "#6B6880" }}>Total campaign value on Ybex{data.cities_label ? <>, from <span style={{ color: "#7C3AED", fontWeight: 700 }}>{data.cities_label}</span></> : null}</div>
        <div data-testid="campaign-value-amount" style={{ marginTop: 6, fontSize: 34, fontWeight: 800, letterSpacing: "-.5px", color: "#14121F", fontVariantNumeric: "tabular-nums" }}>₹{inrPlain(shown ?? data.total)}</div>
      </div>
      {loop.length > 0 && (
        <div style={{ position: "relative", background: "#F3ECFF", padding: "9px 0", overflow: "hidden" }}>
          <div className="yb-cv-ticker" style={{ display: "flex", gap: 12, width: "max-content", fontSize: 12.5, fontWeight: 600, color: "#7C3AED", animation: `ybTickerX ${Math.max(18, lines.length * 5)}s linear infinite` }}>
            {loop.map((l, i) => (
              <React.Fragment key={i}><span style={{ whiteSpace: "nowrap" }}>{l}</span><span style={{ opacity: 0.5 }}>•</span></React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
