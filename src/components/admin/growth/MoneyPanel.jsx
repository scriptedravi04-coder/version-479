import React, { useEffect, useState, useCallback } from "react";
import { api } from "../../../lib/api";
import { toast } from "sonner";
import { Card, Empty, Note, Figure, Trend, Chip, ScrollTable } from "./GrowthUi";
import { inr, inrShort, num, daysText } from "./growthFormat";
import { change } from "./growthMath";

// Session 46 — real money. Deal value (GMV) and platform fees count successful payments that
// were not refunded. "Held" is brand money paid in and not yet paid out or refunded.

// v332: "1 days" → "1 day"
const dd = (d) => `${d} day${Number(d) === 1 ? "" : "s"}`;

export default function MoneyPanel({ report, onNavigate }) {
  const m = report.money;
  const go = (t) => onNavigate && onNavigate(t);
  const pv = m.payouts.velocity;

  return (
    <div className="space-y-6">
      <Card title="Money" hint="Counted from real payments. Refunded payments are left out.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Figure label="Deal value (GMV)" value={inr(m.gmv)} sub={`${num(m.payments)} payment${m.payments === 1 ? "" : "s"} so far`} />
          <Figure label="Ybex net revenue" value={inr(m.netRevenue)} sub={m.gmv > 0 ? `${m.takeRatePct}% of deal value (platform fee)` : "Platform fee on payments"} tone="text-[#7C3AED]" />
          <Figure label="Money held now" value={inr(m.held.amount)} sub={`${num(m.held.count)} payment${m.held.count === 1 ? "" : "s"} paid in, not yet paid out`} tone="text-[#027A48]" />
          <Figure label="Payouts waiting" value={num(m.payouts.pendingCount)} sub={m.payouts.pendingCount ? `${inr(m.payouts.pendingAmount)} to send` : "Nothing waiting"} tone={m.payouts.pendingCount ? "text-rose-600" : "text-gray-900"} />
        </div>
      </Card>

      <Card title="This week and this month" hint="Deal value against the period before it.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: "Last 7 days", cur: m.week.gmv, prev: m.week.prevGmv, fee: m.week.fee, prevLabel: "the 7 days before" },
            { label: "Last 30 days", cur: m.month.gmv, prev: m.month.prevGmv, fee: m.month.fee, prevLabel: "the 30 days before" },
          ].map((r) => (
            <div key={r.label} className="rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-700">{r.label}</span>
                <Trend pct={change(r.cur, r.prev)} />
              </div>
              <div className="font-extrabold text-2xl text-gray-900 mt-1">{inr(r.cur)}</div>
              <p className="text-xs text-[#5F6672] font-medium mt-1">{inr(r.prev)} in {r.prevLabel} · platform fee {inr(r.fee)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Payout speed"
        hint="Creators come back when they are paid fast."
        right={m.payouts.pendingCount > 0 && (
          <button type="button" onClick={() => go("escrow&view=requests")} className="rounded-xl bg-[#7C3AED] text-white text-xs font-bold px-4 py-2.5 hover:bg-[#6D28D9] min-h-[40px]">
            Open payout requests
          </button>
        )}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Figure label="Waiting now" value={num(m.payouts.pendingCount)} sub={m.payouts.pendingCount ? inr(m.payouts.pendingAmount) : "All clear"} />
          <Figure label="Oldest waiting payment" value={m.payouts.oldestPaymentAgeDays === null ? "—" : daysText(m.payouts.oldestPaymentAgeDays)} sub="Age of the payment, not of the request" />
          <Figure label="Paid out so far" value={num(m.payouts.paidOutCount)} />
          <Figure label="Payment → payout" value={pv.avgDays === null ? "—" : dd(pv.avgDays)} sub={pv.avgDays === null ? "No payout with a time yet" : `Typical ${dd(pv.medianDays)} · ${pv.sample} payout${pv.sample === 1 ? "" : "s"}`} />
        </div>
        <div className="mt-4"><Note>The time a creator pressed "request payout" is not stored, so the speed is measured from the day the brand paid.</Note></div>
        {m.payments === 0 && <div className="mt-4"><Empty>No payment has come in yet, so there is nothing to compare.</Empty></div>}
      </Card>
    </div>
  );
}


// ───────── v481: Payment attempts — who opened checkout, who paid, who failed, who left ─────────
const STATUS_TONE = { paid: "green", failed: "rose", left: "amber" };
const STATUS_TEXT = { paid: "Paid", failed: "Failed", left: "Left checkout" };
const when = (iso) => iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

export function PaymentAttemptsPanel() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("unpaid");
  const load = useCallback(async () => {
    setErr("");
    try { const r = await api.get(`admin/payment-attempts?days=${days}`); setData(r.data || null); }
    catch (e) { setErr(e?.response?.data?.error || "Couldn't load payment attempts."); }
  }, [days]);
  useEffect(() => { load(); }, [load]);
  const remind = async (a) => {
    setBusy(a.orderId);
    try {
      const r = await api.post(`admin/payment-attempts/${encodeURIComponent(a.orderId)}/remind`, {});
      toast.success(r.data?.delivered ? `Reminder ${r.data.step} sent` : "Saved — this brand has no phone with notifications on");
      load();
    } catch (e) { toast.error(e?.response?.data?.error || "Couldn't send."); }
    finally { setBusy(""); }
  };
  const waLink = (a) => {
    const d = String(a.phone || "").replace(/\D/g, "").slice(-10);
    if (d.length !== 10) return null;
    const text = `Hi${a.brandName ? " " + a.brandName : ""}, this is Ybex. Your ${inr(a.amount)} payment didn't finish — need any help completing it?`;
    return `https://wa.me/91${d}?text=${encodeURIComponent(text)}`;
  };

  if (err) return <Card title="Payment attempts"><Note tone="amber">{err} <button type="button" className="underline font-bold" onClick={load}>Try again</button></Note></Card>;
  if (!data) return <Card title="Payment attempts"><div className="h-24 animate-pulse rounded-2xl bg-[var(--bg-elevated)]" /></Card>;
  if (!data.available) return <Card title="Payment attempts"><Note>{data.reason}</Note></Card>;
  const t = data.summary.totals;
  const list = (data.list || []).filter((a) => filter === "all" ? true : filter === "unpaid" ? a.status !== "paid" && !a.paidLater : a.status === filter);

  return (
    <div className="space-y-5" data-testid="payment-attempts">
      <Card
        title="Payment attempts"
        hint="Every time a brand opened the Razorpay checkout. Brands who didn't pay get a push at 2 min, 3 h and next day 7 pm (never 10 pm–9 am)."
        right={<div className="flex gap-1.5">{[7, 30, 90].map((d) => (
          <button key={d} type="button" onClick={() => { setData(null); setDays(d); }} aria-pressed={days === d}
            className={`h-8 px-3 rounded-full text-xs font-bold border ${days === d ? "bg-[#111827] text-white border-[#111827]" : "bg-white text-gray-600 border-gray-200"}`}>{d} days</button>))}</div>}
      >
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Figure label="Opened checkout" value={num(t.opened)} />
          <Figure label="Paid" value={num(t.paid)} sub={`${t.paidPct}% of opened`} tone="text-emerald-700" />
          <Figure label="Failed" value={num(t.failed)} tone={t.failed ? "text-rose-600" : "text-gray-900"} />
          <Figure label="Left checkout" value={num(t.left)} tone={t.left ? "text-amber-700" : "text-gray-900"} />
          <Figure label="Still unpaid" value={inrShort(t.pendingAmount)} sub={data.recovered ? `${data.recovered} paid on a later try` : undefined} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {[["By page", data.summary.byPage], ["By method", data.summary.byMethod], ["Why it failed", data.summary.byReason]].map(([title, rows]) => (
          <Card key={title} title={title}>
            {!rows.length ? <Empty>Nothing yet.</Empty> : (
              <ul className="space-y-2">{rows.slice(0, 6).map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-gray-800 truncate">{r.key}</span>
                  <span className="shrink-0 text-gray-600">{r.paid}/{r.opened} paid · <b className={r.paidPct < 50 ? "text-rose-600" : "text-emerald-700"}>{r.paidPct}%</b></span>
                </li>))}</ul>
            )}
          </Card>
        ))}
      </div>

      <Card
        title="Who didn't pay"
        right={<div className="flex gap-1.5">{[["unpaid", "Unpaid"], ["failed", "Failed"], ["left", "Left"], ["paid", "Paid"], ["all", "All"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={`h-8 px-3 rounded-full text-xs font-bold border ${filter === k ? "bg-[#7C3AED] text-white border-[#7C3AED]" : "bg-white text-gray-600 border-gray-200"}`}>{l}</button>))}</div>}
      >
        {!list.length ? <Empty>No one here. 🎉</Empty> : (
          <ScrollTable>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[#5F6672]">
                <th className="py-2 pr-3">Brand</th><th className="py-2 pr-3">Page</th><th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3">What happened</th><th className="py-2 pr-3">When</th><th className="py-2 pr-3">Reminders</th><th className="py-2" />
              </tr></thead>
              <tbody>{list.map((a) => {
                const wa = waLink(a);
                const done = a.status === "paid" || a.paidLater;
                return (
                  <tr key={a.orderId} className="border-t border-gray-100 align-top">
                    <td className="py-2.5 pr-3 font-semibold text-gray-900">{a.brandName || <span className="text-gray-400">Unknown</span>}</td>
                    <td className="py-2.5 pr-3">{({ campaign_escrow: "Campaign deal", ugc_order: "UGC order", ugc_brief: "UGC brief" })[a.page] || "Other"}</td>
                    <td className="py-2.5 pr-3 text-right font-bold">{inr(a.amount)}</td>
                    <td className="py-2.5 pr-3"><Chip tone={a.paidLater ? "green" : STATUS_TONE[a.status]}>{a.paidLater ? "Paid later" : STATUS_TEXT[a.status]}</Chip>
                      {a.reason && <div className="text-[11px] text-rose-600 mt-1 max-w-[220px] whitespace-normal">{a.reason}</div>}
                      {a.method && <div className="text-[11px] text-gray-500 mt-0.5">{a.method}</div>}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{when(a.createdAt)}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{done ? "—" : `${a.remindersSent}/3 sent`}{!done && a.nextReminderAt && <div className="text-[11px] text-gray-500">next {when(a.nextReminderAt)}</div>}</td>
                    <td className="py-2.5 whitespace-nowrap text-right">
                      {!done && a.brandId && <button type="button" disabled={busy === a.orderId} onClick={() => remind(a)} className="h-8 px-3 rounded-lg bg-[#7C3AED] text-white font-bold disabled:opacity-50">Send reminder</button>}
                      {!done && wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center h-8 px-3 rounded-lg border border-emerald-300 text-emerald-700 font-bold">WhatsApp</a>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </ScrollTable>
        )}
        <p className="mt-3 text-[11px] text-[#5F6672]">Brands who never reached the Razorpay screen don't show here yet.</p>
      </Card>
    </div>
  );
}

// ───────── v481: Investor view — honest marketplace numbers, printable as PDF ─────────
const monthName = (m) => { const [y, mo] = String(m).split("-").map(Number); return new Date(Date.UTC(y, (mo || 1) - 1, 1)).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }); };

export function InvestorPanel({ report }) {
  const iv = report.investor;
  if (!iv) return <Empty>Refresh to load investor numbers.</Empty>;
  const T = iv.totals, L = iv.liquidity;
  const maxG = Math.max(1, ...iv.monthly.map((m) => m.gmv));
  const pv = report.money?.payouts?.velocity;
  const a = report.people?.activity;
  return (
    <div className="space-y-5 yb-investor" data-testid="investor-view">
      <style>{`@media print { body * { visibility: hidden !important; } .yb-investor, .yb-investor * { visibility: visible !important; } .yb-investor { position: absolute; left: 0; top: 0; width: 100%; } .yb-noprint { display: none !important; } }`}</style>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-extrabold text-gray-900">Ybex — marketplace snapshot</h3>
          <p className="text-xs text-[#5F6672] font-medium">Real payments only. Test payments left out; Ybex-funded (in-house) deals shown apart. {new Date(report.generatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <button type="button" onClick={() => window.print()} className="yb-noprint h-10 px-4 rounded-xl bg-[#111827] text-white text-xs font-bold">Download PDF</button>
      </div>

      <Card title="Money">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Figure label="Paid by brands (GMV)" value={inr(T.brandPaid)} />
          <Figure label="Ybex revenue (fees)" value={inr(T.fees)} sub={`Take rate ${T.takeRatePct}%`} />
          <Figure label="In-house deals (Ybex-funded)" value={inr(T.inhouse)} />
          <Figure label="Payout speed" value={pv?.medianDays != null ? `${pv.medianDays} days` : "—"} sub={pv?.sample ? `median, ${pv.sample} payouts` : "no payouts yet"} />
        </div>
      </Card>

      <Card title="Month by month" hint="GMV bars include in-house; numbers in the table split it out.">
        <div className="flex items-end gap-3 h-36 mb-4" aria-label="Monthly GMV">
          {iv.monthly.map((m) => (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
              <div className="text-[10px] font-bold text-gray-700">{m.gmv ? inrShort(m.gmv) : ""}</div>
              <div className="w-full rounded-t-lg bg-[#A78BFA]" style={{ height: `${Math.max(2, (m.gmv / maxG) * 100)}px` }} />
              <div className="text-[10px] font-semibold text-gray-500">{monthName(m.month)}</div>
            </div>
          ))}
        </div>
        <ScrollTable>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[#5F6672]"><th className="py-1.5 pr-3">Month</th><th className="pr-3 text-right">Brand-paid</th><th className="pr-3 text-right">In-house</th><th className="pr-3 text-right">Fees</th><th className="pr-3 text-right">MoM</th><th className="pr-3 text-right">New creators</th><th className="pr-3 text-right">New brands</th><th className="text-right">Campaigns</th></tr></thead>
            <tbody>{iv.monthly.map((m) => (
              <tr key={m.month} className="border-t border-gray-100"><td className="py-1.5 pr-3 font-semibold">{monthName(m.month)}</td><td className="pr-3 text-right">{inr(m.brandPaid)}</td><td className="pr-3 text-right">{inr(m.inhouse)}</td><td className="pr-3 text-right">{inr(m.fees)}</td><td className="pr-3 text-right">{m.gmvMoM == null ? "—" : `${m.gmvMoM > 0 ? "+" : ""}${m.gmvMoM}%`}</td><td className="pr-3 text-right">{num(m.newCreators)}</td><td className="pr-3 text-right">{num(m.newBrands)}</td><td className="text-right">{num(m.campaigns)}</td></tr>
            ))}</tbody>
          </table>
        </ScrollTable>
        {T.imported > 0 && <p className="mt-2 text-[11px] text-[#5F6672]">{num(T.imported)} accounts were bulk-imported and are not counted as new signups.</p>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Supply & demand">
          <div className="grid grid-cols-2 gap-4">
            <Figure label="Creators" value={num(T.creators)} />
            <Figure label="Brands" value={num(T.brands)} />
            <Figure label="Campaigns posted" value={num(T.campaigns)} />
            <Figure label="Active this month" value={a?.available ? num(a.mau?.total) : "—"} sub={a?.available ? `${num(a.wau?.total)} this week · ${num(a.dau?.total)} today` : undefined} />
          </div>
        </Card>
        <Card title="Liquidity — does the marketplace work?">
          <div className="grid grid-cols-2 gap-4">
            <Figure label="Campaigns that hired" value={`${L.campaignsHiredPct}%`} sub={`${L.hiredCampaigns} of ${num(T.campaigns)}`} />
            <Figure label="Creators with a deal" value={`${L.creatorsWithDealPct}%`} sub={`${num(L.creatorsWithDeal)} creator${L.creatorsWithDeal === 1 ? "" : "s"}`} />
            <Figure label="Days to first deal" value={L.daysToFirstDeal != null ? `${L.daysToFirstDeal}` : "—"} sub={L.firstDealSample ? `median, ${L.firstDealSample} brands` : undefined} />
            <Figure label="Repeat brands" value={`${iv.repeat.pct}%`} sub={`${iv.repeat.repeat} of ${iv.repeat.paying} paying brands`} />
          </div>
        </Card>
      </div>

      <Card title="Brand cohorts" hint="Brands who signed up each month: how many posted a campaign, how many paid.">
        <ScrollTable>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[#5F6672]"><th className="py-1.5 pr-3">Signed up in</th><th className="pr-3 text-right">Brands</th><th className="pr-3 text-right">Posted a campaign</th><th className="text-right">Paid</th></tr></thead>
            <tbody>{iv.cohorts.map((c) => (
              <tr key={c.month} className="border-t border-gray-100"><td className="py-1.5 pr-3 font-semibold">{monthName(c.month)}</td><td className="pr-3 text-right">{num(c.signedUp)}</td><td className="pr-3 text-right">{c.posted} <span className="text-gray-400">({c.postedPct}%)</span></td><td className="text-right">{c.paid} <span className="text-gray-400">({c.paidPct}%)</span></td></tr>
            ))}</tbody>
          </table>
        </ScrollTable>
      </Card>

      <Card title="Before the app — Ybex Media (agency)" hint="Separate from the platform numbers above.">
        <p className="text-xs text-gray-700 leading-relaxed">Ybex started as Ybex Media, an influencer agency running creator campaigns for brands by hand. That client base and creator network is what the platform is built on. Agency revenue is not included in any number on this page.</p>
      </Card>
    </div>
  );
}
