// v450 (Ravi): Admin › Overview — (1) "Total campaign value" banner control: add / subtract an amount with a note
// (offline deals, cancellations); every change is listed. (2) Area demand: places where brands searched "near me"
// and found no creators — where to run creator ads next.
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { ListSkeleton } from "../common/ContentSkeletons"; // v457: skeleton instead of "Loading…" text

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const card = { background: "#fff", border: "1px solid #ECECF0", borderRadius: 20, padding: 16, display: "flex", flexDirection: "column", gap: 12, fontFamily: "'DM Sans',sans-serif" };
const label = { fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "#7C3AED" };

export function CampaignValueAdminCard() {
  const [d, setD] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [cities, setCities] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.get("admin/campaign-value", { bypassCache: true }).then(({ data }) => { setD(data); setCities(data?.cities_label || ""); }).catch(() => setD({ error: true }));
  useEffect(() => { load(); }, []);
  const save = async (sign) => {
    const n = Math.round(Number(String(amount).replace(/[^0-9.]/g, "")));
    if (!n) { toast.error("Amount daalo, e.g. 2000"); return; }
    if (!note.trim()) { toast.error("Chhota note daalo, e.g. 'Jaipur offline deal'"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("admin/campaign-value", { amount: sign * n, note: note.trim() });
      toast.success(`Saved. New total ${inr(data?.total)}`);
      setAmount(""); setNote(""); load();
    } catch (e) { toast.error(e?.response?.data?.error || "Couldn't save"); } finally { setBusy(false); }
  };
  const saveCities = async () => {
    try { await api.post("admin/campaign-value/label", { cities: cities.trim() }); toast.success("Saved"); load(); } catch (e) { toast.error(e?.response?.data?.error || "Couldn't save"); }
  };
  if (!d) return <div style={card}><ListSkeleton rows={2} label="Loading campaign value" /></div>;
  if (d.error) return <div style={card}>Couldn't load campaign value.</div>;
  return (
    <div style={card} data-testid="admin-campaign-value">
      <div>
        <div style={label}>Total campaign value (banner)</div>
        <div style={{ fontSize: 28, fontWeight: 700, marginTop: 2 }}>{inr(d.total)}</div>
        <div style={{ fontSize: 12, color: "#5F6672" }}>Start {inr(d.base)} + app campaigns/briefs {inr(d.app_value)} + your entries</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="Amount, e.g. 2000" aria-label="Amount" style={{ flex: 1, minWidth: 0, height: 44, borderRadius: 12, border: "1px solid #E0E0E8", padding: "0 12px", fontSize: 16 }} />
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. Jaipur offline deal" aria-label="Note" maxLength={120} style={{ height: 44, borderRadius: 12, border: "1px solid #E0E0E8", padding: "0 12px", fontSize: 16 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => save(1)} data-testid="cv-add" style={{ flex: 1, height: 44, borderRadius: 12, border: "none", background: "#7C3AED", color: "#fff", fontWeight: 700, fontSize: 14 }}>+ Add</button>
        <button type="button" disabled={busy} onClick={() => save(-1)} data-testid="cv-subtract" style={{ flex: 1, height: 44, borderRadius: 12, border: "1px solid #FECACA", background: "#FEF2F2", color: "#B91C1C", fontWeight: 700, fontSize: 14 }}>− Subtract</button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={cities} onChange={(e) => setCities(e.target.value)} placeholder="Cities line, e.g. 110+ cities" aria-label="Cities line" style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 12, border: "1px solid #E0E0E8", padding: "0 12px", fontSize: 14 }} />
        <button type="button" onClick={saveCities} style={{ height: 40, padding: "0 12px", borderRadius: 12, border: "1px solid #E0E0E8", background: "#fff", fontWeight: 600, fontSize: 13 }}>Save</button>
      </div>
      <div style={{ fontSize: 11.5, color: "#9CA3AF" }}>Cities line khaali chhodo toh creators ki asli city count dikhegi.</div>
      {(d.entries || []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", background: "#F7F7FA", borderRadius: 14, overflow: "hidden" }}>
          {d.entries.slice(0, 20).map((e, i) => (
            <div key={e.id} style={{ display: "flex", gap: 10, padding: "9px 12px", borderTop: i ? "1px solid #ECECF0" : "none", fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.note}<span style={{ color: "#9CA3AF" }}> · {new Date(e.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span></span>
              <span style={{ fontWeight: 700, color: e.amount < 0 ? "#B91C1C" : "#047857" }}>{e.amount < 0 ? "−" : "+"}{inr(Math.abs(e.amount))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AreaDemandAdminCard() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("admin/area-demand", { bypassCache: true }).then(({ data }) => setD(data)).catch(() => setD({ error: true })); }, []);
  if (!d) return null;
  if (d.error) return null;
  return (
    <div style={card} data-testid="admin-area-demand">
      <div>
        <div style={label}>Area demand · creators needed</div>
        <div style={{ fontSize: 12.5, color: "#5F6672", marginTop: 2 }}>Brands searched "near me" here and found no creators. Run creator ads in these places.</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {[["Empty searches", d.empty_searches || 0], ["Areas", (d.areas || []).length], ["Want alerts", d.notify_count || 0]].map(([t, v]) => (
          <div key={t} style={{ flex: 1, background: "#F7F7FA", borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div><div style={{ fontSize: 11, color: "#5F6672" }}>{t}</div>
          </div>
        ))}
      </div>
      {(d.areas || []).length === 0 ? <div style={{ fontSize: 13, color: "#5F6672" }}>No empty searches yet.</div> : (
        <div style={{ display: "flex", flexDirection: "column", background: "#F7F7FA", borderRadius: 14, overflow: "hidden" }}>
          {d.areas.slice(0, 15).map((a, i) => (
            <div key={`${a.city}|${a.area}`} style={{ display: "flex", gap: 10, padding: "9px 12px", borderTop: i ? "1px solid #ECECF0" : "none", fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0 }}><b>{a.city}</b>{a.area ? ` · ${a.area}` : ""}</span>
              <span style={{ color: "#5F6672" }}>{a.brands} brand{a.brands === 1 ? "" : "s"} · {a.searches} search{a.searches === 1 ? "" : "es"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OverviewGrowthCards() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <AreaDemandAdminCard />
      {/* v475 (Ravi): the campaign value banner control now lives in Developer → Campaign value banner */}
    </div>
  );
}
