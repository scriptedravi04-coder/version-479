import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { appConfirm, appPrompt } from "../common/Popup"; // v456
import { api } from "../../lib/api";
import { ListSkeleton } from "../common/ContentSkeletons"; // v457: skeleton instead of "Loading…" text

// Session 36: referral programme — settings, referrals, withdrawals.
// v448 (Ravi: "creator numbers yahan kyun? sirf referral se kaun aaya, kisne laaya dikhao; rewards ka form messy hai"):
// results show only referral numbers + who brought whom (names, not ids); rewards are plain sentences with the
// number boxes inside them, grouped by what triggers the reward. Old join-bonus settings sit under "More settings".
const ist = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—"; };
const rupee = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/** A number box that sits inside a sentence. */
function Num({ k, cfg, setCfg, w = "w-20", prefix = "" }) {
  return (
    <span className="inline-flex items-center align-middle mx-1">
      {prefix && <span className="mr-0.5 font-semibold">{prefix}</span>}
      <input type="number" inputMode="decimal" aria-label={k} data-testid={`ref-cfg-${k}`} value={cfg[k] ?? ""} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}
        className={`${w} h-9 px-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[16px] sm:text-sm font-bold text-center`} />
    </span>
  );
}

function RuleCard({ title, hint, children }) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] p-4">
      <div className="font-bold text-sm">{title}</div>
      {hint && <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{hint}</div>}
      <div className="mt-3 space-y-2 text-sm leading-9">{children}</div>
    </div>
  );
}

export default function AdminReferralProgram() {
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState({});
  const [list, setList] = useState([]);
  const [wd, setWd] = useState([]);
  const [summary, setSummary] = useState(null); // v448
  const [top, setTop] = useState([]); // v448
  const [moreOpen, setMoreOpen] = useState(false); // v448
  const [loadError, setLoadError] = useState(false); // v330: a failed load used to spin "Loading…" forever
  const [saving, setSaving] = useState(false); // v330: no double save
  const prettyStatus = (s) => (s ? String(s).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—"); // v330: no raw enum
  const load = async () => {
    setLoadError(false); // v330
    try {
      const [p, l, w] = await Promise.all([api.get("admin/referral-program"), api.get("admin/referral-list"), api.get("admin/referral-withdrawals")]);
      setData(p.data); setCfg(p.data?.config || {}); setList(l.data?.referrals || []); setSummary(l.data?.summary || null); setTop(l.data?.top_referrers || []); setWd(w.data?.withdrawals || []);
    } catch { toast.error("Could not load the referral programme."); setLoadError(true); /* v330 */ }
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (saving) return; // v330
    setSaving(true);
    try { await api.put("admin/referral-program", cfg); toast.success("Saved."); load(); }
    catch (e) { toast.error(e?.response?.data?.error || "Could not save."); }
    finally { setSaving(false); }
  };
  const [busyId, setBusyId] = useState(""); // Session 58: one action at a time per row (money)
  const act = async (id, action) => {
    if (busyId) return;
    const body = {};
    if (action === "paid") {
      // v456 (admin review): the UTR was taken as-is — "ok" or a typo marked real money as paid. Now it must look like a
      // bank reference (6–30 letters/digits), and the admin confirms once more with the value shown.
      const raw = await appPrompt("UTR / bank reference (from the bank transfer)", { ok: "Next", placeholder: "e.g. 432112345678",
        validate: (v) => (/^[A-Za-z0-9]{6,30}$/.test(v.replace(/\s+/g, "")) ? "" : "That doesn't look like a UTR — use the 12–22 character bank reference.") });
      if (raw == null) return;
      const utr = raw.replace(/\s+/g, ""); // v457: app text box (checks the UTR before going on)
      if (!utr) return;
      if (!(await appConfirm(`Mark as paid with UTR ${utr}?`, { ok: "Mark as paid" }))) return;
      body.utr = utr;
    }
    if (action === "reject" && !(await appConfirm("Reject this withdrawal request?", { ok: "Reject", danger: true }))) return; // v330: ask before rejecting
    setBusyId(id);
    // v332: say what happened; calm text instead of "Failed"
    try { await api.post(`admin/referral-withdrawals/${id}/${action}`, body); toast.success(action === "paid" ? "Marked as paid." : "Withdrawal rejected."); load(); } catch (e) { toast.error(e?.response?.data?.error || "Couldn't update this withdrawal. Please try again."); }
    finally { setBusyId(""); }
  };
  // v330: a failed "Don't count" used to be silent
  const reject = async (id) => { if (!(await appConfirm("Do not count this referral?", { ok: "Don't count", danger: true }))) return; const ok = await api.post(`admin/referrals/${id}/reject`).then(() => true).catch((e) => { toast.error(e?.response?.data?.error || "Could not update this referral."); return false; }); if (ok) toast.success("Referral will not be counted."); load(); }; // v332: success toast
  if (!data && loadError) return <div className="p-4 text-sm text-red-600">Could not load the referral programme. <button type="button" onClick={load} className="underline font-semibold">Try again</button></div>; // v330
  if (!data) return <div className="p-4"><ListSkeleton rows={4} label="Loading referrals" /></div>;
  const sm = summary; // v448
  return (
    <div className="space-y-6" data-testid="admin-referral-program">
      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl p-5" data-testid="ref-results">
        <h4 className="font-bold text-sm mb-3">Referral results</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Joined via a referral link", sm?.joins ?? data.numbers?.referral_joins ?? 0],
            ["Joined in last 30 days", sm?.joins_last_30_days ?? data.numbers?.referral_joins_last_30_days ?? 0],
            ["People who invited someone", sm?.people_inviting ?? top.length],
            ["Paid out / waiting", `${rupee(sm?.paid_out)} / ${rupee(sm?.waiting_payout)}`],
          ].map(([l, v]) => <div key={l} className="rounded-xl bg-[var(--bg-elevated)] p-3"><div className="text-xl font-bold">{v}</div><div className="text-[11px] text-[var(--text-secondary)]">{l}</div></div>)}
        </div>
        {(sm?.not_counted || 0) > 0 && <p className="text-[11px] text-[var(--text-secondary)] mt-2">{sm.not_counted} not counted (you marked them, or over the monthly limit).</p>}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl p-5" data-testid="ref-top">
        <h4 className="font-bold text-sm mb-1">Top inviters</h4>
        <p className="text-[11px] text-[var(--text-secondary)] mb-3">Who brought the most people.</p>
        {top.length === 0 ? <p className="text-xs text-[var(--text-secondary)]">Nobody has joined through a referral link yet.</p> : (
          <div className="overflow-x-auto max-h-72">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="text-left text-[var(--text-secondary)]"><tr><th className="p-2">Inviter</th><th className="p-2">Code</th><th className="p-2">Brought</th><th className="p-2">Last 30 days</th><th className="p-2">Last join</th></tr></thead>
              <tbody>{top.map((t) => (
                <tr key={t.user_id} className="border-t border-[var(--border-default)]">
                  <td className="p-2"><div className="font-semibold">{t.name || "—"}</div><div className="text-[10.5px] text-[var(--text-secondary)]">{[t.role, t.email].filter(Boolean).join(" · ")}</div></td>
                  <td className="p-2 font-mono">{t.code}</td><td className="p-2 font-bold">{t.joins}</td><td className="p-2">{t.last_30_days}</td><td className="p-2">{ist(t.last_at)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl p-5" data-testid="ref-rewards">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h4 className="font-bold text-sm">Rewards</h4>
          <label className="text-xs font-semibold flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={cfg.is_active !== false} onChange={(e) => setCfg({ ...cfg, is_active: e.target.checked })} /> Referral programme on</label>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] mb-4">Change a number in a sentence and tap Save. Put 0 to switch that reward off.</p>
        <div className="grid md:grid-cols-2 gap-3">
          <RuleCard title="1. A creator invites a creator" hint="Paid when the new creator's profile is 100% complete.">
            <div>Both get<Num k="friend_reward" cfg={cfg} setCfg={setCfg} prefix="₹" />each.</div>
            <div>One person can earn max<Num k="friend_reward_cap" cfg={cfg} setCfg={setCfg} w="w-24" prefix="₹" />from this.</div>
          </RuleCard>
          <RuleCard title="2. Someone invites a brand" hint="Paid when that brand funds its first deal.">
            <div>Inviter gets<Num k="brand_invite_reward" cfg={cfg} setCfg={setCfg} prefix="₹" />per brand,</div>
            <div>if the brand's first deal is at least<Num k="brand_invite_min_deal" cfg={cfg} setCfg={setCfg} w="w-24" prefix="₹" />.</div>
            <div>Paid for max<Num k="brand_invite_max_brands" cfg={cfg} setCfg={setCfg} w="w-16" />brands per person.</div>
            <div>To withdraw it, the inviter must finish<Num k="brand_invite_unlock_deals" cfg={cfg} setCfg={setCfg} w="w-16" />deals of their own.</div>
            <div>Inviter is also shown as Featured for<Num k="brand_invite_featured_days" cfg={cfg} setCfg={setCfg} w="w-16" />days.</div>
          </RuleCard>
          <RuleCard title="3. Limits (stop misuse)">
            <div>Count max<Num k="monthly_cap_per_user" cfg={cfg} setCfg={setCfg} w="w-16" />joins per person per month.</div>
            <div>Minimum withdrawal<Num k="min_withdraw" cfg={cfg} setCfg={setCfg} prefix="₹" />.</div>
          </RuleCard>
        </div>
        <button type="button" onClick={() => setMoreOpen((v) => !v)} className="mt-4 text-xs font-semibold text-[var(--violet)] underline cursor-pointer" data-testid="ref-more">{moreOpen ? "Hide older bonus rewards" : "More settings (older bonus rewards)"}</button>
        {moreOpen && (
          <div className="grid md:grid-cols-2 gap-3 mt-3">
            <RuleCard title="Bonus for many joins" hint={Number(cfg.free_deals_per_reward) > 0 || Number(cfg.featured_days) > 0 ? "On" : "Off right now (both rewards are 0)."}>
              <div>Every<Num k="signups_per_reward" cfg={cfg} setCfg={setCfg} w="w-16" />joins →<Num k="free_deals_per_reward" cfg={cfg} setCfg={setCfg} w="w-16" />deals at 0% fee,</div>
              <div>valid for<Num k="free_deals_valid_days" cfg={cfg} setCfg={setCfg} w="w-20" />days, plus Featured for<Num k="featured_days" cfg={cfg} setCfg={setCfg} w="w-16" />days.</div>
            </RuleCard>
            <RuleCard title="Share of friend's earnings" hint={Number(cfg.share_cap_per_creator) > 0 && Number(cfg.share_pct_of_earnings) > 0 ? "On" : "Off right now (max is ₹0)."}>
              <div>Inviter gets<Num k="share_pct_of_earnings" cfg={cfg} setCfg={setCfg} w="w-20" />% of what the friend earns (after fee),</div>
              <div>max<Num k="share_cap_per_creator" cfg={cfg} setCfg={setCfg} w="w-24" prefix="₹" />per friend.</div>
            </RuleCard>
          </div>
        )}
        <div className="mt-5"><button onClick={save} disabled={saving} data-testid="ref-save" className="disabled:opacity-50 px-5 py-2.5 rounded-xl bg-[#7C3AED] text-white text-sm font-bold cursor-pointer">{saving ? "Saving…" : "Save"}</button></div>
      </div>
      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl p-5">
        <h4 className="font-bold text-sm mb-3">Withdrawal requests</h4>
        {wd.length === 0 ? <p className="text-xs text-[var(--text-secondary)]">None yet.</p> : (
          <div className="overflow-x-auto">{/* v330: scrolls inside the card on phones */}
          <table className="w-full min-w-[560px] text-xs"><tbody>{wd.map((w) => (
            <tr key={w.id} className="border-t border-[var(--border-default)]">
              <td className="p-2"><div className="font-semibold">{w.name || w.user_id}</div><div className="text-[10.5px] text-[var(--text-secondary)]">{[w.role, w.email].filter(Boolean).join(" · ")}</div></td>{/* v332: no dangling "·" */}
              <td className="p-2 font-mono">{w.upi_id ? <button type="button" title="Copy UPI" onClick={() => { navigator.clipboard?.writeText(w.upi_id); toast.success("UPI copied"); }} className="underline decoration-dotted">{w.upi_id}</button> : <span className="text-red-600">no UPI</span>}</td>
              <td className="p-2">₹{Number(w.amount || 0).toLocaleString("en-IN")}</td><td className="p-2">{prettyStatus(w.status)}{w.utr ? ` · ${w.utr}` : ""}</td>
              <td className="p-2 text-right">{w.status === "requested" && <><button disabled={busyId === w.id} onClick={() => act(w.id, "paid")} className="px-2 py-1 rounded-lg border mr-1 disabled:opacity-50">{busyId === w.id ? "…" : "Mark paid"}</button><button disabled={busyId === w.id} onClick={() => act(w.id, "reject")} className="px-2 py-1 rounded-lg border border-red-200 bg-red-50 text-red-600 disabled:opacity-50">Reject</button></>}</td>
            </tr>))}</tbody></table>
          </div>
        )}
        <p className="text-[11px] text-[var(--text-secondary)] mt-2">Tap the UPI id to copy it, pay from your UPI app, then "Mark paid" with the UTR — the person sees "Paid · UTR …" in their wallet.</p>
      </div>
      <div className="bg-[var(--bg-card)] border border-[var(--border-default)] rounded-2xl p-5">
        <h4 className="font-bold text-sm mb-1">Who brought whom</h4>
        <p className="text-[11px] text-[var(--text-secondary)] mb-3">Every join through a referral link, newest first.</p>
        <div className="max-h-96 overflow-auto">{/* v330: sideways scroll too */}
          {list.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No referrals yet.</p>}{/* v332 */}
          <table className="w-full min-w-[620px] text-xs">
            {list.length > 0 && <thead className="text-left text-[var(--text-secondary)]"><tr><th className="p-2">Invited by</th><th className="p-2">Who joined</th><th className="p-2">Status</th><th className="p-2">Date</th><th className="p-2"></th></tr></thead>}
            <tbody>{list.map((r) => (
            <tr key={r.id} className="border-t border-[var(--border-default)]" data-testid="ref-row">
              <td className="p-2"><div className="font-semibold">{r.referrer_name || "—"}</div><div className="text-[10.5px] text-[var(--text-secondary)] font-mono">{r.referrer_code || r.referrer_id}</div></td>
              <td className="p-2"><div className="font-semibold">{r.referred_name || "—"}</div><div className="text-[10.5px] text-[var(--text-secondary)]">{[r.referred_role, r.referred_email].filter(Boolean).join(" · ")}</div></td>
              <td className="p-2">{prettyStatus(r.status)}</td>
              <td className="p-2">{ist(r.created_at)}</td>
              <td className="p-2 text-right">{r.status !== "rejected" && <button onClick={() => reject(r.id)} className="px-2 py-1 rounded-lg border">Don't count</button>}</td>
            </tr>))}</tbody></table>
        </div>
      </div>
    </div>
  );
}
