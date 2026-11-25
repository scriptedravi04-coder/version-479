// v450 (Ravi's BRD "Explore near you"): location screens (EL-02/03), list pieces (EL-01/04/06) and the branches hook.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, Search, LocateFixed, Map as MapIcon, Plus, Building2, ChevronLeft, MoreHorizontal, Loader2, ChevronDown, ChevronRight, Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../lib/api";
import ModalPortal from "../../common/ModalPortal";
import { Presence, PopupBackdrop, PopupPanel, appConfirm } from "../../common/Popup";
import useScrollLock from "../../../lib/useScrollLock";
import useBackToClose from "../../../lib/popupRules";
import SlippyMap, { TILE_STREETS } from "./SlippyMap";
import { distanceKm } from "../../../lib/indiaCities";
import { RADII, shortNum } from "./nearbyLogic";
import { initials as initialsOf } from "../../../utils/initials";

const P = "#7C3AED";
// v450: the brand's saved branches (server: /brand/branches) + map flags. One copy shared by Explore's screens.

export function useBranches(enabled = true) {
  const [branches, setBranches] = useState(null); // null = loading
  const [flags, setFlags] = useState({});
  const [max, setMax] = useState(5);

  const load = useCallback(async () => {
    if (!enabled) { setBranches([]); return; }
    try {
      const { data } = await api.get("brand/branches", { bypassCache: true });
      setBranches(Array.isArray(data?.branches) ? data.branches : []);
      setFlags(data?.flags || {});
      if (data?.max) setMax(data.max);
    } catch { setBranches([]); }
  }, [enabled]);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (b) => {
    const { data } = await api.post("brand/branches", b);
    setBranches(data.branches || []);
    return data.branch;
  }, []);
  const select = useCallback(async (id) => {
    setBranches((l) => (l || []).map((b) => ({ ...b, selected: b.id === id })));
    try { const { data } = await api.post(`brand/branches/${id}/select`, {}); setBranches(data.branches || []); } catch { toast.error("Couldn't switch branch"); load(); }
  }, [load]);
  const remove = useCallback(async (id) => {
    try { const { data } = await api.delete(`brand/branches/${id}`); setBranches(data.branches || []); } catch { toast.error("Couldn't delete"); }
  }, []);
  const markFlag = useCallback(async (name) => {
    setFlags((f) => ({ ...f, [name]: new Date().toISOString() }));
    try { await api.post("brand/map-flags", { [name]: true }); } catch { /* next time */ }
  }, []);

  const selected = (branches || []).find((b) => b.selected) || null;
  return { branches, selected, flags, max, save, select, remove, markFlag, reload: load };
}

/** Phone GPS → {lat,lng}. Asks permission only when called (BRD: never on app open). */
export const ANDROID_LOCATION_BUILD = 16;
/** Android app build number (versionCode), or 0 when unknown. */
export async function androidBuild() {
  try { const info = await window.Capacitor?.Plugins?.App?.getInfo?.(); return Number(info?.build) || 0; } catch { return 0; }
}

export function currentPosition() {
  // v475 (iOS QA #16): in the iPhone app ask through the app's own location permission (one popup, no
  // "capacitor://localhost wants your location" second popup)
  // v476 (Android QA A6): Play build 1.0.13 / 1.0.14 has no location permission at all — say "update the app" instead
  // of "allow it in settings" (which the user can't do there)
  if (typeof window !== "undefined" && window.Capacitor?.getPlatform?.() === "android") {
    return androidBuild().then((b) => {
      if (b && b < ANDROID_LOCATION_BUILD) { const e = new Error("old app"); e.code = "OLD_APP"; throw e; }
      return browserPosition();
    });
  }
  const G = typeof window !== "undefined" ? window.Capacitor?.Plugins?.Geolocation : null;
  if (G?.getCurrentPosition && window.Capacitor?.getPlatform?.() === "ios") {
    return G.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }).then((p) => ({ lat: p.coords.latitude, lng: p.coords.longitude }));
  }
  return browserPosition();
}

function browserPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { reject(new Error("unsupported")); return; }
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), (e) => reject(e), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

// v450 (Ravi's BRD EL-02 + EL-03): "Select location" sheet and the full-screen "Confirm on map + name branch".


export const BRANCH_CHIPS = ["Head Office", "Branch", "Store", "Warehouse", "Studio"];

function useDebounced(v, ms) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

const gpsError = (e) => (e?.code === "OLD_APP" ? "Update Ybex from the Play Store to use your location — or pick on the map." : e?.code === 1 ? "Location permission is off. Allow it in settings, or pick on the map." : "Couldn't get your location. Pick on the map instead.");

/** EL-02 */
function SelectLocationBody({ branches, max, onClose, onPick, onAddAt, onSelect, onRename, onDelete }) {
  useScrollLock(true);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 450);
  const [places, setPlaces] = useState(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [phone, setPhone] = useState(null);
  const [menu, setMenu] = useState(null);
  const press = useRef(null);

  useEffect(() => {
    if (dq.length < 3) { setPlaces(null); return undefined; }
    let alive = true;
    api.get("geo/search", { params: { q: dq } }).then(({ data }) => { if (alive) setPlaces(data?.places || []); }).catch(() => { if (alive) setPlaces([]); });
    return () => { alive = false; };
  }, [dq]);
  // distance from the phone, only if location permission is already granted (never ask here)
  useEffect(() => {
    try {
      navigator.permissions?.query({ name: "geolocation" }).then((s) => { if (s.state === "granted") currentPosition().then(setPhone).catch(() => {}); }).catch(() => {});
    } catch { /* no permissions api */ }
  }, []);

  const useGps = async () => {
    setGpsBusy(true);
    try { const p = await currentPosition(); onAddAt(p); } catch (e) { toast.error(gpsError(e)); } finally { setGpsBusy(false); }
  };
  const list = branches || [];
  const full = list.length >= max;
  // v455: a long-press opens the menu ONLY — the tap that ends it used to select that branch too
  const longPressed = useRef(false);
  const startPress = (b) => { longPressed.current = false; press.current = setTimeout(() => { longPressed.current = true; setMenu(b); }, 550); };
  const endPress = () => clearTimeout(press.current);
  const tapBranch = (id) => { if (longPressed.current) { longPressed.current = false; return; } onSelect(id); };

  return (
    <ModalPortal>
      <PopupBackdrop className="fixed inset-0 z-[80] bg-[rgba(10,10,14,.45)]" onClick={onClose} />
      <PopupPanel kind="sheet" onClose={onClose} className="fixed left-0 right-0 bottom-0 z-[81] bg-white rounded-t-[26px] px-[18px] pt-2.5 max-h-[88dvh] overflow-y-auto" style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))", fontFamily: "'DM Sans',sans-serif" }} data-testid="select-location-sheet">
        <div className="w-10 h-[5px] rounded-[3px] bg-[#E0E0E6] mx-auto" />
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[18px] font-bold text-[#0A0A0A]">Select location</div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full bg-[#F2F2F7] flex items-center justify-center"><X size={16} /></button>
        </div>
        <div className="mt-3.5 h-[46px] rounded-[14px] bg-[#F7F7FA] border border-[#E5E5EA] flex items-center gap-2.5 px-3.5">
          <Search size={16} color="#9CA3AF" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address, area or pincode" aria-label="Search address" className="flex-1 min-w-0 bg-transparent outline-none text-base text-[#0A0A0A] placeholder:text-[#ABABAB]" />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear" className="w-8 h-8 -mr-2 flex items-center justify-center"><X size={14} color="#9CA3AF" /></button>}
        </div>
        {q.trim().length >= 3 ? (
          <div className="mt-2 flex flex-col" data-testid="location-suggestions">
            {places === null ? <div className="py-4 text-center text-[13px] text-[#6E6E7A]">Searching…</div> : places.length === 0 ? <div className="py-4 text-center text-[13px] text-[#6E6E7A]">No place found. Try an area or pincode.</div> :
              places.map((p, i) => (
                <button key={i} type="button" onClick={() => onPick(p)} className="flex items-start gap-3 py-3 border-b border-[#F0F0F4] text-left">
                  <MapIcon size={16} color="#9CA3AF" className="mt-0.5 shrink-0" />
                  <span className="min-w-0"><span className="block text-[14.5px] font-semibold text-[#0A0A0A] truncate">{p.label}</span><span className="block text-[12px] text-[#5F6672] line-clamp-2">{p.address}</span></span>
                </button>
              ))}
          </div>
        ) : (
          <>
            <div className="mt-3 rounded-2xl border border-[#ECECF0] overflow-hidden">
              <button type="button" onClick={useGps} disabled={gpsBusy} data-testid="use-current-location" className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
                <span className="w-9 h-9 rounded-xl bg-[#F3EDFF] flex items-center justify-center shrink-0">{gpsBusy ? <Loader2 size={17} color={P} className="animate-spin" /> : <LocateFixed size={17} color={P} />}</span>
                <span className="flex-1 min-w-0"><span className="block text-[14.5px] font-semibold" style={{ color: P }}>Use my current location</span><span className="block text-[12px] text-[#5F6672]">Fills in your office address from GPS</span></span>
              </button>
              <button type="button" onClick={() => onAddAt(null)} data-testid="select-on-map" className="w-full flex items-center gap-3 px-3.5 py-3 text-left border-t border-[#F0F0F4]">
                <span className="w-9 h-9 rounded-xl bg-[#F2F2F7] flex items-center justify-center shrink-0"><MapIcon size={17} color="#374151" /></span>
                <span className="flex-1 min-w-0"><span className="block text-[14.5px] font-semibold text-[#0A0A0A]">Select on map</span><span className="block text-[12px] text-[#5F6672]">Move the pin to the exact spot</span></span>
              </button>
            </div>
            {!full && list.length > 0 && (
              <button type="button" onClick={() => onAddAt(null)} data-testid="add-branch" className="mt-3 w-full h-11 rounded-2xl border border-dashed border-[#D4C4FB] text-[14px] font-semibold flex items-center justify-center gap-1.5" style={{ color: P }}><Plus size={15} /> Add branch</button>
            )}
            {list.length > 0 && (
              <>
                <div className="mt-4 flex items-baseline justify-between"><span className="text-[11px] font-semibold tracking-[.7px] uppercase text-[#5F6672]">Saved locations</span><span className="text-[12px] text-[#6E6E7A]">{list.length} of {max}</span></div>
                <div className="mt-2 flex flex-col gap-2">
                  {list.map((b) => {
                    const km = phone ? distanceKm([phone.lat, phone.lng], [b.lat, b.lng]) : null;
                    return (
                      <div key={b.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl border ${b.selected ? "border-[#7C3AED] bg-[#FBF9FF]" : "border-[#ECECF0] bg-white"}`}>
                        <button type="button" onClick={() => tapBranch(b.id)} onContextMenu={(e) => e.preventDefault()} onPointerDown={() => startPress(b)} onPointerUp={endPress} onPointerLeave={endPress} data-testid={`branch-${b.id}`} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                          <span className="w-9 h-9 rounded-xl bg-[#F2F2F7] flex items-center justify-center shrink-0"><Building2 size={16} color="#5F6672" /></span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-1.5"><span className="text-[14.5px] font-semibold text-[#0A0A0A] truncate">{b.name}</span>{b.selected && <span className="shrink-0 px-1.5 h-[18px] rounded-md text-[9.5px] font-bold tracking-[.4px] text-white flex items-center" style={{ background: P }}>SELECTED</span>}</span>
                            <span className="block text-[12px] text-[#5F6672] truncate">{[b.area, b.city].filter(Boolean).join(", ") || b.address}</span>
                          </span>
                          {km != null && <span className="text-[12px] text-[#5F6672] shrink-0">{km < 1 ? `${(km).toFixed(1)} km` : `${Math.round(km)} km`}</span>}
                        </button>
                        <button type="button" onClick={() => setMenu(b)} aria-label={`More for ${b.name}`} className="w-8 h-8 -mr-1 flex items-center justify-center shrink-0"><MoreHorizontal size={16} color="#9CA3AF" /></button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
        {menu && (
          <div className="yb-fade fixed inset-0 z-[90] flex items-end" onClick={() => setMenu(null)}>
            <div className="yb-sheet-up w-full bg-white rounded-t-[22px] p-3 shadow-2xl" style={{ paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))" }} onClick={(e) => e.stopPropagation()}>
              <div className="px-2 py-1.5 text-[13px] font-semibold text-[#5F6672]">{menu.name}</div>
              <button type="button" onClick={() => { const b = menu; setMenu(null); onRename(b); }} className="w-full h-12 rounded-xl text-left px-3 text-[15px] font-medium hover:bg-[#F5F0FF]">Rename</button>
              <button type="button" onClick={async () => { const b = menu; setMenu(null); if (await appConfirm(`Delete "${b.name}"?`, { ok: "Delete", danger: true })) onDelete(b.id); }} className="w-full h-12 rounded-xl text-left px-3 text-[15px] font-medium text-[#DC2626] hover:bg-[#FEF2F2]">Delete</button>
            </div>
          </div>
        )}
      </PopupPanel>
    </ModalPortal>
  );
}
export function SelectLocationSheet({ open, ...p }) {
  return <Presence>{open && <SelectLocationBody key="sel" {...p} />}</Presence>;
}

/** EL-03 — pin fixed in the centre, the map moves under it. `start` = {lat,lng,label?,address?,city?,area?} or null. */
export function ConfirmLocationScreen({ start, editing, existingNames = [], isFirst, onBack, onSave }) {
  useScrollLock(true);
  useBackToClose(true, onBack); // v455: phone Back closes this screen (it used to leave Explore)
  const fallback = { lat: 28.6139, lng: 77.209 };
  const [center, setCenter] = useState(start?.lat ? { lat: start.lat, lng: start.lng } : fallback);
  const [place, setPlace] = useState(start?.address ? start : null);
  const [looking, setLooking] = useState(false);
  const [name, setName] = useState(editing?.name || (isFirst ? "Head Office" : ""));
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 450);
  const [places, setPlaces] = useState(null);
  const [mapKey, setMapKey] = useState(0);

  const reverse = async (c) => {
    setLooking(true);
    try { const { data } = await api.get("geo/reverse", { params: { lat: c.lat, lng: c.lng } }); setPlace(data?.place ? { ...data.place, lat: c.lat, lng: c.lng } : { label: "Pinned location", address: `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`, lat: c.lat, lng: c.lng }); }
    catch { setPlace({ label: "Pinned location", address: "", lat: c.lat, lng: c.lng }); } finally { setLooking(false); }
  };
  useEffect(() => {
    if (start?.lat && !start?.address) reverse(start);
    if (!start) currentPosition().then((p) => { setCenter(p); setMapKey((k) => k + 1); reverse(p); }).catch(() => reverse(fallback));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dq.length < 3) { setPlaces(null); return undefined; }
    let alive = true;
    api.get("geo/search", { params: { q: dq } }).then(({ data }) => { if (alive) setPlaces(data?.places || []); }).catch(() => { if (alive) setPlaces([]); });
    return () => { alive = false; };
  }, [dq]);

  const nameTaken = existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase() && n.toLowerCase() !== String(editing?.name || "").toLowerCase());
  const save = async () => {
    if (!name.trim()) { toast.error("Give this branch a name"); return; }
    if (nameTaken) { toast.error("You already have a branch with this name"); return; }
    setSaving(true);
    try { await onSave({ id: editing?.id, name: name.trim(), lat: center.lat, lng: center.lng, address: place?.address || "", city: place?.city || "", area: place?.area || place?.label || "" }); }
    catch (e) { toast.error(e?.response?.data?.error || "Couldn't save. Try again."); setSaving(false); }
  };
  const locate = () => currentPosition().then((p) => { setCenter(p); setMapKey((k) => k + 1); reverse(p); }).catch((e) => toast.error(gpsError(e)));

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-label="Confirm location" className="yb-fade fixed inset-0 z-[85] bg-white flex flex-col" style={{ fontFamily: "'DM Sans',sans-serif" }} data-testid="confirm-location-screen">
        <div className="relative flex-1 min-h-0">
          <SlippyMap key={mapKey} center={center} zoom={16} tiles={TILE_STREETS} draggable onMove={(c) => setCenter(c)} onMoveEnd={(c) => { setCenter(c); reverse(c); }} className="absolute inset-0" testId="confirm-map" />
          <div className="absolute left-1/2 top-1/2 pointer-events-none" style={{ transform: "translate(-50%,-100%)" }}>
            <div className="px-2.5 py-1.5 rounded-lg bg-[#0A0A0A] text-white text-center whitespace-nowrap" style={{ transform: "translateX(-50%)", position: "absolute", bottom: 52, left: "50%" }}><div className="text-[12px] font-semibold">Your office is here</div><div className="text-[10.5px] text-white/70">Move the map to adjust</div></div>
            <svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 0C7.6 0 0 7.4 0 16.6 0 29 17 44 17 44s17-15 17-27.4C34 7.4 26.4 0 17 0z" fill={P} /><circle cx="17" cy="16.5" r="6.5" fill="#fff" /></svg>
          </div>
          <div className="absolute left-0 right-0 top-0 px-3 flex gap-2" style={{ paddingTop: "calc(10px + var(--yb-sat, env(safe-area-inset-top, 0px)))" }}>
            <button type="button" onClick={onBack} aria-label="Back" className="w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center shrink-0"><ChevronLeft size={20} /></button>
            <div className="flex-1 min-w-0 relative">
              <div className="h-11 rounded-full bg-white shadow-md flex items-center gap-2 px-3.5"><Search size={15} color="#9CA3AF" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search area or pincode" aria-label="Search area or pincode" className="flex-1 min-w-0 outline-none text-base bg-transparent" /></div>
              {places && q.trim().length >= 3 && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-xl max-h-[50vh] overflow-y-auto">
                  {places.length === 0 ? <div className="p-3 text-[13px] text-[#6E6E7A]">No place found</div> : places.map((p, i) => (
                    <button key={i} type="button" onClick={() => { setQ(""); setPlaces(null); setCenter({ lat: p.lat, lng: p.lng }); setMapKey((k) => k + 1); setPlace(p); }} className="w-full text-left px-3.5 py-2.5 border-b border-[#F2F2F5]">
                      <div className="text-[14px] font-semibold truncate">{p.label}</div><div className="text-[12px] text-[#5F6672] truncate">{p.address}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button type="button" onClick={locate} aria-label="Go to my location" className="absolute right-3 bottom-4 w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center"><LocateFixed size={18} color={P} /></button>
        </div>
        <div className="bg-white rounded-t-[24px] -mt-4 relative px-[18px] pt-3 shadow-[0_-10px_30px_-18px_rgba(0,0,0,.35)]" style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}>
          <div className="w-10 h-[5px] rounded-[3px] bg-[#E0E0E6] mx-auto" />
          <div className="mt-3 flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-[#F3EDFF] flex items-center justify-center shrink-0"><svg width="14" height="18" viewBox="0 0 34 44"><path d="M17 0C7.6 0 0 7.4 0 16.6 0 29 17 44 17 44s17-15 17-27.4C34 7.4 26.4 0 17 0z" fill={P} /><circle cx="17" cy="16.5" r="6.5" fill="#fff" /></svg></span>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-bold text-[#0A0A0A] truncate">{looking ? "Finding address…" : place?.label || "Move the map"}</div>
              <div className="text-[12.5px] text-[#5F6672] line-clamp-2">{looking ? " " : place?.address || ""}</div>
            </div>
          </div>
          <div className="mt-4 text-[11px] font-semibold tracking-[.7px] uppercase text-[#5F6672]">Branch name</div>
          <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
            {BRANCH_CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => setName(c)} className={`h-[34px] px-3 rounded-[10px] text-[12.5px] border shrink-0 ${name === c ? "bg-[#F5F0FF] border-[#D9C8FB] text-[#6D28D9] font-semibold" : "bg-white border-[#E5E5EA] text-[#4B5563] font-medium"}`}>{c}</button>
            ))}
          </div>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="e.g. Noida Store" aria-label="Branch name" className={`mt-2.5 w-full h-12 rounded-[14px] border px-3.5 text-base outline-none ${nameTaken ? "border-[#FCA5A5]" : "border-[#E0E0E8]"}`} />
          {nameTaken && <div className="mt-1 text-[12px] text-[#DC2626]">You already have a branch with this name</div>}
          <button type="button" onClick={save} disabled={saving || looking} data-testid="save-location" className="mt-3.5 w-full h-[52px] rounded-2xl text-white text-[15.5px] font-semibold disabled:opacity-60 flex items-center justify-center gap-2" style={{ background: P }}>
            {saving && <Loader2 size={16} className="animate-spin" />}{editing ? "Save changes" : "Save location"}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
}

// v450 (Ravi's BRD EL-01 / EL-04 / EL-06): pieces of Explore's "near you" mode.


const photoOf = (c) => c?.photo || c?.profile_photo_url || c?.picture || c?.avatar_url || "";
const nameOf = (c) => String(c?.full_name || c?.name || "").trim();
const idOf = (c) => c?.user_id || c?.id;
const num = (v) => { const t = String(v ?? "").trim().toLowerCase().replace(/,/g, ""); const n = parseFloat(t); if (/k\+?$/.test(t)) return Math.round(n * 1e3); if (/l\+?$/.test(t)) return Math.round(n * 1e5); if (/m\+?$/.test(t)) return Math.round(n * 1e6); return parseInt(t.replace(/[^0-9]/g, ""), 10) || 0; };
const nicheOf = (c) => String(c?.category || (Array.isArray(c?.content_niches) ? c.content_niches[0] : String(c?.content_niches || "").split(",")[0]) || "").split(/\s*[,|/;]\s*/)[0].split(" & ")[0].trim();

/** EL-01 / EL-04: the line under "Explore creators". */
export function LocationLine({ branch, onClick }) {
  if (!branch) {
    return (
      <button type="button" onClick={onClick} data-testid="explore-set-location" className="mt-1.5 -ml-1.5 h-7 px-1.5 rounded-lg flex items-center gap-1 text-[13.5px] font-semibold" style={{ color: P, background: "rgba(124,58,237,.07)" }}>
        <Pin /> Set location <ChevronDown size={14} />
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} data-testid="explore-location-line" className="mt-1.5 -ml-0.5 h-7 max-w-full flex items-center gap-1 text-[13.5px] font-semibold text-[#0A0A0A] min-w-0">
      <Pin /><span className="truncate">{[branch.area, branch.city].filter(Boolean).join(", ") || branch.name}</span><ChevronDown size={14} className="shrink-0" />
    </button>
  );
}
export const Pin = ({ size = 13 }) => (<svg width={size * 0.8} height={size} viewBox="0 0 34 44" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M17 0C7.6 0 0 7.4 0 16.6 0 29 17 44 17 44s17-15 17-27.4C34 7.4 26.4 0 17 0z" fill={P} /><circle cx="17" cy="16.5" r="6.5" fill="#fff" /></svg>);

/** The "Map" button with the red NEW badge (slide-shine) + colour map icon. */
export function MapButton({ onClick, label = "Map" }) {
  return (
    <button type="button" onClick={onClick} data-testid="explore-map-button" className="relative h-10 pl-2.5 pr-3.5 rounded-[12px] bg-white border border-[#E5E5EA] flex items-center gap-1.5 text-[14px] font-semibold text-[#0A0A0A] shadow-[0_4px_12px_-8px_rgba(0,0,0,.35)]">
      <style>{"@keyframes ybShine{0%{left:-60%}55%,100%{left:130%}}"}</style>
      {label === "Map" ? <MapColorIcon /> : null}{label}
      {label === "Map" && (
        <span className="absolute -top-2 -right-2 h-[17px] px-1.5 rounded-full text-[9.5px] font-extrabold tracking-[.3px] text-white flex items-center overflow-hidden" style={{ background: "#EF4444" }}>
          NEW<span style={{ position: "absolute", top: 0, bottom: 0, width: "45%", background: "linear-gradient(100deg,transparent,rgba(255,255,255,.75),transparent)", animation: "ybShine 2.4s ease-in-out infinite" }} />
        </span>
      )}
    </button>
  );
}
export const MapColorIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 6.5 8.5 4l7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20z" fill="#34A853" />
    <path d="M8.5 4v13.5L3 20V6.5z" fill="#4285F4" /><path d="M15.5 6.5V20L21 17.5V4z" fill="#FBBC04" />
    <path d="M12 7.2c-1.9 0-3.4 1.5-3.4 3.4 0 2.5 3.4 6 3.4 6s3.4-3.5 3.4-6c0-1.9-1.5-3.4-3.4-3.4z" fill="#EA4335" /><circle cx="12" cy="10.6" r="1.3" fill="#fff" />
  </svg>
);

/** The first-visit tooltip under the Map button. */
export function MapTip({ onGotIt }) {
  return (
    <div className="absolute right-0 top-[calc(100%+10px)] w-[248px] z-40 rounded-2xl bg-[#17122B] text-white p-3.5 shadow-2xl" data-testid="explore-map-tip">
      <span className="absolute -top-1.5 right-6 w-3 h-3 rotate-45 bg-[#17122B]" />
      <div className="flex items-center gap-1.5 text-[14.5px] font-bold">Running a local brand? <span className="h-[17px] px-1.5 rounded-md bg-[#7C3AED] text-[9.5px] font-bold tracking-[.4px] flex items-center">BETA</span></div>
      <div className="mt-1 text-[12.5px] leading-snug text-white/75">See creators near you on the map and shoot with them in person.</div>
      <div className="mt-2.5 flex justify-end"><button type="button" onClick={onGotIt} className="h-9 px-4 rounded-xl text-[13px] font-semibold" style={{ background: P }}>Got it</button></div>
    </div>
  );
}

/** Radius segmented control (10 / 25 / 50 / 100 km). */
export function RadiusControl({ value, onChange }) {
  return (
    <div className="flex p-1 rounded-[13px] bg-[#EBEBF0]" role="tablist" aria-label="Distance" data-testid="explore-radius">
      {RADII.map((r) => (
        <button key={r} type="button" role="tab" aria-selected={r === value} onClick={() => onChange(r)} className={`flex-1 h-9 rounded-[10px] text-[13.5px] ${r === value ? "bg-white font-semibold text-[#0A0A0A] shadow-sm" : "font-medium text-[#5F6672]"}`}>{r} km</button>
      ))}
    </div>
  );
}

/** EL-04 list card (final): 70×70 photo · name · "48K followers · 38K avg reach" · category chip · chevron. No km. */
export function NearbyCard({ c, onOpen }) {
  const [bad, setBad] = useState(false);
  const src = bad ? "" : photoOf(c);
  const f = num(c.followers_count || c.follower_count || c.followers_instagram), reach = num(c.avg_reach_per_reel || c.avg_reach || c.avg_views_30d);
  const niche = nicheOf(c);
  return (
    <button type="button" onClick={onOpen} data-testid={`nearby-card-${idOf(c)}`} className="w-full bg-white rounded-[18px] border border-[#ECECF0] p-3 flex items-center gap-3 text-left active:bg-[#FAFAFC]">
      {src ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} className="w-[70px] h-[70px] rounded-[14px] object-cover shrink-0" />
        : <span className="w-[70px] h-[70px] rounded-[14px] shrink-0 flex items-center justify-center text-[20px] font-bold text-[#3F2C58]" style={{ background: "linear-gradient(160deg,#E9DDFB,#C9B6F2)" }}>{initialsOf(nameOf(c))}</span>}
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-[#0A0A0A] truncate">{nameOf(c)}</span>
        <span className="block mt-0.5 text-[12px] text-[#5F6672] truncate">{[f ? `${shortNum(f)} followers` : "", reach ? `${shortNum(reach)} avg reach` : ""].filter(Boolean).join(" · ")}</span>
        {niche && <span className="mt-1.5 inline-flex h-[20px] px-2 rounded-md bg-[#F2F2F7] items-center text-[10.5px] font-semibold text-[#4B5563]">{niche}</span>}
      </span>
      <ChevronRight size={18} color="#C4C4CC" className="shrink-0" />
    </button>
  );
}

/** EL-06: nobody within 100 km. */
export function NoCreatorsNearby({ branch, creatorsAvatars = [], notifyOn, onNotify, onOnline, onChange }) {
  return (
    <div className="mt-6 px-2 text-center" data-testid="explore-no-nearby">
      <div className="mx-auto w-[92px] h-[92px] rounded-[28px] bg-white border border-[#ECECF0] flex items-center justify-center"><span style={{ transform: "scale(2.4)", display: "flex" }}><MapColorIcon /></span></div>
      <div className="mt-4 text-[18px] font-bold text-[#0A0A0A]">We're bringing creators to your area</div>
      <div className="mt-1.5 text-[13.5px] leading-snug text-[#5F6672]">No creators within 100 km of {branch?.area || branch?.city || "your location"} yet.{branch?.city ? ` We've already started onboarding creators in ${branch.city}.` : ""}</div>
      <button type="button" onClick={onOnline} data-testid="explore-online-ugc" className="mt-5 w-full h-[52px] rounded-2xl text-white text-[15px] font-semibold flex items-center justify-center gap-2.5" style={{ background: P }}>
        {creatorsAvatars.length > 0 && <span className="flex">{creatorsAvatars.slice(0, 3).map((c, i) => <span key={idOf(c)} className="w-6 h-6 rounded-full border-2 border-[#7C3AED] overflow-hidden bg-white" style={{ marginLeft: i ? -8 : 0 }}>{photoOf(c) ? <img src={photoOf(c)} alt="" className="w-full h-full object-cover" /> : null}</span>)}</span>}
        Get UGC videos made online
      </button>
      {notifyOn ? (
        <div className="mt-2.5 h-12 rounded-2xl bg-[#ECFDF5] text-[#047857] text-[14px] font-semibold flex items-center justify-center gap-2"><Check size={16} /> We'll notify you · <button type="button" onClick={() => onNotify(false)} className="underline">Undo</button></div>
      ) : (
        <button type="button" onClick={() => onNotify(true)} data-testid="explore-notify-me" className="mt-2.5 w-full h-12 rounded-2xl bg-white border border-[#E0E0E8] text-[14.5px] font-semibold text-[#0A0A0A] flex items-center justify-center gap-2"><Bell size={16} /> Notify me when creators join</button>
      )}
      <button type="button" onClick={onChange} className="mt-3 h-10 text-[13.5px] font-semibold" style={{ color: P }}>Change location or branch</button>
    </div>
  );
}

// v472 (Ravi's map recording: everyone from a city sat on one spot as "+39"): a creator puts their AREA on the map —
// search an area or use their location. Saved rounded to ~1 km (never the exact home), so brands nearby find them.
export function CreatorAreaCard() {
  const [area, setArea] = useState(undefined); // undefined = loading
  const [q, setQ] = useState(""); const [places, setPlaces] = useState([]); const [busy, setBusy] = useState(false); const [open, setOpen] = useState(false);
  useEffect(() => { api.get("creators/me/area").then(({ data }) => setArea(data?.area || null)).catch(() => setArea(null)); }, []);
  useEffect(() => {
    const dq = q.trim(); if (dq.length < 3) { setPlaces([]); return undefined; }
    let alive = true; const t = setTimeout(() => api.get("geo/search", { params: { q: dq } }).then(({ data }) => { if (alive) setPlaces(data?.places || []); }).catch(() => { if (alive) setPlaces([]); }), 350);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  const save = async (pl) => {
    setBusy(true);
    try { const { data } = await api.post("creators/me/area", { lat: pl.lat, lng: pl.lng, area: pl.area || pl.label, city: pl.city }); setArea(data?.area || null); setOpen(false); setQ(""); setPlaces([]); toast.success("Your area is on the map"); }
    catch (e) { toast.error(e?.response?.data?.error || "Couldn't save your area. Try again."); }
    finally { setBusy(false); }
  };
  const useMine = async () => {
    setBusy(true);
    try {
      const c = await currentPosition();
      let pl = { ...c, label: "My area" };
      try { const { data } = await api.get("geo/reverse", { params: { lat: c.lat, lng: c.lng } }); if (data?.place) pl = { ...data.place, lat: c.lat, lng: c.lng }; } catch { /* keep */ }
      await save(pl);
    } catch { setBusy(false); toast.error("Allow location, or search your area instead."); }
  };
  const clear = async () => { setBusy(true); try { await api.post("creators/me/area", { clear: true }); setArea(null); } catch { /* ignore */ } finally { setBusy(false); } };
  if (area === undefined) return null;
  return (
    <div className="rounded-2xl border border-[#E5E5EA] bg-[#F9F9FB] p-3.5" data-testid="creator-area-card">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-[#F5F0FF] text-[#7C3AED] flex items-center justify-center shrink-0"><MapIcon size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-[#0A0A0A]">Your area on the map</div>
          <div className="text-[12.5px] text-[#5F6672] leading-snug mt-0.5">{area ? <>Brands near <b className="text-[#0A0A0A]">{[area.area, area.city].filter(Boolean).join(", ") || "your area"}</b> can find you. Shown to about 1 km, never your address.</> : "Add your area so brands near you find you on the map. Shown to about 1 km, never your address."}</div>
        </div>
      </div>
      {!open ? (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={useMine} disabled={busy} className="flex-1 h-11 rounded-xl bg-[#7C3AED] text-white text-[13px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-60">{busy ? <Loader2 size={15} className="animate-spin" /> : <LocateFixed size={15} />} Use my location</button>
          <button type="button" onClick={() => setOpen(true)} disabled={busy} className="flex-1 h-11 rounded-xl bg-white border border-[#E5E5EA] text-[13px] font-bold text-[#0A0A0A] flex items-center justify-center gap-1.5"><Search size={15} /> {area ? "Change area" : "Search area"}</button>
        </div>
      ) : (
        <div className="mt-3">
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value.slice(0, 60))} placeholder="Search your area, e.g. Malviya Nagar" aria-label="Search your area" className="w-full h-12 pl-10 pr-3 rounded-xl bg-white border border-[#E5E5EA] text-base focus:outline-none focus:border-[#7C3AED]" />
          </div>
          {places.map((pl, i) => (
            <button key={`${pl.label}-${i}`} type="button" disabled={busy} onClick={() => save(pl)} className="w-full text-left px-2 py-2.5 border-b border-[#EFEFF3] last:border-0">
              <span className="block text-[13.5px] font-semibold text-[#0A0A0A] truncate">{pl.label}</span>
              <span className="block text-[11.5px] text-[#5F6672] truncate">{pl.address}</span>
            </button>
          ))}
          <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="mt-2 h-9 text-[13px] font-semibold text-[#5F6672]">Cancel</button>
        </div>
      )}
      {area && !open && <button type="button" onClick={clear} disabled={busy} className="mt-2 h-8 text-[12px] font-semibold text-[#5F6672]">Remove from map</button>}
    </div>
  );
}

