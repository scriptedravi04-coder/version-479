// v446 (Ravi): brand funnel — sign-up page → account → each sign-up step → done → first brief.
// Loads GET /admin/growth/brand-funnel on its own (the main growth report stays as it was).
import React, { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { Card, Empty, Note, Meter, Chip } from "./GrowthUi";
import { num } from "./growthFormat";
import { ListSkeleton } from "../../common/ContentSkeletons"; // v457: skeleton instead of "Loading…" text

const TYPE_LABEL = { shop: "Shop", d2c: "Online brand (D2C)", app: "App", cafe: "Café / Restaurant", salon: "Salon / Clinic", agency: "Agency", creator: "Creator (moved)" };

export default function BrandFunnelCard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setErr("");
    api.get(`admin/growth/brand-funnel?days=${days}`).then((r) => { if (live) setData(r?.data || null); })
      .catch(() => { if (live) setErr("Couldn't load the brand funnel."); });
    return () => { live = false; };
  }, [days]);
  const top = Math.max(1, ...((data?.rows || []).map((r) => r.count)));
  const right = (
    <div className="flex gap-1">
      {[7, 30, 90].map((d) => (
        <button key={d} onClick={() => setDays(d)} className={`px-2.5 py-1 rounded-lg text-xs font-bold ${days === d ? "bg-[#7C3AED] text-white" : "bg-gray-100 text-gray-700"}`}>{d}d</button>
      ))}
    </div>
  );
  return (
    <Card title="Brand sign-up funnel" hint="Sign-up page → account → each step → profile done → first brief. Counts brands who signed up in this window." right={right}>
      {err ? <Empty>{err}</Empty> : !data ? <ListSkeleton rows={3} label="Loading funnel" /> : (
        <>
          <ol className="space-y-4" data-testid="brand-funnel-rows">
            {data.rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-bold text-gray-800">{r.label}</span>
                  <span className="text-sm font-extrabold text-gray-900 tabular-nums">{num(r.count)}{r.ofPrev !== null && <span className="ml-2 text-xs font-semibold text-[#5F6672]">{r.ofPrev}% of previous</span>}</span>
                </div>
                <Meter value={r.count} max={top} color="#A855F7" label={`${r.label}: ${r.count}`} />
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <Chip tone="purple">{num(data.qualified)} QualifiedBrand</Chip>
            <Chip tone="amber">{num(data.unverified)} Unverified</Chip>
            {Object.entries(data.byType || {}).map(([k, n]) => <Chip key={k}>{TYPE_LABEL[k] || k}: {num(n)}</Chip>)}
          </div>
          {data.unverifiedBrands?.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-extrabold text-gray-700 mb-2">Unverified brands (Instagram private, missing or under 100 followers)</div>
              <ul className="divide-y divide-gray-100">
                {data.unverifiedBrands.map((b) => <li key={b.user_id} className="py-2 text-sm font-semibold text-gray-800">{b.name || b.user_id}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-4"><Note>Sign-up page counts opens of the brand sign-up (one per device per 10 minutes). Meta gets "QualifiedBrand" only for brands with 300+ Instagram followers or a website.</Note></div>
        </>
      )}
    </Card>
  );
}
