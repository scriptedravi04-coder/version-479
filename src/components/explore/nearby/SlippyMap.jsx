// v450: a small map with no library — light-grey base tiles (Esri "World Light Gray", free, no Google bill), drag to
// pan (Confirm location screen), and an overlay that places anything at a lat/lng. Kept tiny on purpose (the app has a
// 1,000-file limit and no map dependency).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { project, unproject } from "./nearbyLogic";

export const TILE_LIGHT = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`;
export const TILE_STREETS = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
export const TILE_SAT = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

/**
 * props: center {lat,lng}, zoom (integer), tiles (fn), draggable, onMove(center) while dragging, onMoveEnd(center),
 *        children: (proj) => overlay nodes; proj(lat,lng) → {x,y} in the map box. style/className for the box.
 */
export default function SlippyMap({ center, zoom = 10, tiles = TILE_LIGHT, draggable = false, onMove, onMoveEnd, onZoomBy, children, className = "", style, testId }) {
  const box = useRef(null);
  const [size, setSize] = useState({ w: 360, h: 640 });
  const [c, setC] = useState(center);
  const drag = useRef(null);
  const endTimer = useRef(null);

  useEffect(() => { if (!drag.current) setC(center); }, [center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = box.current; if (!el) return undefined;
    const read = () => setSize({ w: el.clientWidth || 360, h: el.clientHeight || 640 });
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const z = Math.max(2, Math.min(18, Math.round(zoom)));
  const cp = project(c.lat, c.lng, z);
  const left = cp.x - size.w / 2, top = cp.y - size.h / 2;
  const proj = useCallback((lat, lng) => { const p = project(lat, lng, z); return { x: p.x - left, y: p.y - top }; }, [z, left, top]);

  // v472 (Ravi's screen recording: after a zoom the map went blank lavender for seconds, then filled in patches):
  // the last zoom level's tiles stay underneath, stretched, until the new ones arrive — no blank map between zooms.
  const prevZ = useRef(z); const [backZ, setBackZ] = useState(z);
  useEffect(() => { if (prevZ.current !== z) { setBackZ(prevZ.current); prevZ.current = z; } }, [z]);
  const tileLayer = (zz, keyPre) => {
    const out = []; const s = Math.pow(2, z - zz); // one zz tile = 256·s screen px
    const n = Math.pow(2, zz); const cz = project(c.lat, c.lng, zz);
    const lz = cz.x - size.w / (2 * s), tz = cz.y - size.h / (2 * s);
    for (let ty = Math.floor(tz / 256); ty <= Math.floor((tz + size.h / s) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(lz / 256); tx <= Math.floor((lz + size.w / s) / 256); tx++) {
        const wx = ((tx % n) + n) % n;
        out.push(<img key={`${keyPre}${zz}/${tx}/${ty}`} src={tiles(zz, wx, ty)} alt="" draggable={false} decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
          style={{ position: "absolute", left: (tx * 256 - lz) * s, top: (ty * 256 - tz) * s, width: 256 * s + 0.5, height: 256 * s + 0.5, userSelect: "none", pointerEvents: "none" }} />);
      }
    }
    return out;
  };
  const tilesOut = [
    ...(backZ !== z && Math.abs(backZ - z) <= 2 ? tileLayer(backZ, "b") : []),
    ...(z > 3 ? tileLayer(z - 1, "p").map((im) => React.cloneElement(im, { style: { ...im.props.style, zIndex: 0 } })) : []),
    ...tileLayer(z, "t").map((im) => React.cloneElement(im, { style: { ...im.props.style, zIndex: 1 } })),
  ];

  // v472 (Ravi: "zoom in ho raha hai, zoom out nahi"): two-finger pinch (and a mouse wheel) zooms the map like any
  // map app — live stretch while pinching, then it settles on the nearest zoom level.
  const ptrs = useRef(new Map()); const pinch = useRef(null); const [pinchScale, setPinchScale] = useState(1);
  const wheelAt = useRef(0);
  const onWheel = (e) => { if (!onZoomBy) return; const now = Date.now(); if (now - wheelAt.current < 250) return; wheelAt.current = now; onZoomBy(e.deltaY < 0 ? 1 : -1); };

  // v455: a drag only starts after the finger moves 6 px — so tapping a pin / button on the map still works
  // (the pointer used to be captured on touch-down, which swallowed taps once the main map became draggable).
  const onDown = (e) => {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2 && onZoomBy) {
      const [a, b] = [...ptrs.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: 1 };
      drag.current = null; return;
    }
    if (!draggable) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: cp.x, cy: cp.y, id: e.pointerId, el: e.currentTarget, live: false, last: null };
    clearTimeout(endTimer.current);
  };
  const onMovePtr = (e) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current) {
      const [a, b] = [...ptrs.current.values()];
      if (a && b) { const sc = Math.max(0.25, Math.min(4, Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d0)); pinch.current.scale = sc; setPinchScale(sc); }
      return;
    }
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.live) {
      if (Math.hypot(dx, dy) < 6) return;
      d.live = true; try { d.el.setPointerCapture?.(d.id); } catch { /* ignore */ }
    }
    const nc = unproject(d.cx - dx, d.cy - dy, z);
    d.last = nc; setC(nc); onMove?.(nc);
  };
  const onUp = (e) => {
    if (e?.pointerId != null) ptrs.current.delete(e.pointerId);
    if (pinch.current) {
      if (ptrs.current.size === 0) { const steps = Math.round(Math.log2(pinch.current.scale)); pinch.current = null; setPinchScale(1); if (steps) onZoomBy?.(steps); }
      return;
    }
    const d = drag.current; if (!d) return;
    drag.current = null;
    if (!d.live || !d.last) return; // a tap, not a drag
    clearTimeout(endTimer.current);
    const end = d.last;
    endTimer.current = setTimeout(() => onMoveEnd?.(end), 400); // BRD: address updates ~400 ms after the map stops
  };
  useEffect(() => () => clearTimeout(endTimer.current), []);

  return (
    <div ref={box} className={className} data-testid={testId}
      style={{ position: /\babsolute\b/.test(className) ? "absolute" : "relative", overflow: "hidden", background: "#E9E9EC", touchAction: draggable || onZoomBy ? "none" : "auto", cursor: draggable ? "grab" : "default", ...style }}
      onPointerDown={onDown} onPointerMove={onMovePtr} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
      <div style={{ position: "absolute", inset: 0, transform: pinchScale !== 1 ? `scale(${pinchScale})` : undefined, transformOrigin: "50% 50%" }}>
        {tilesOut}
        <div style={{ position: "absolute", inset: 0, zIndex: 2 }}>{typeof children === "function" ? children(proj, { zoom: z, size }) : children}</div>
      </div>
      <div style={{ position: "absolute", right: 4, bottom: 2, fontSize: 9, color: "rgba(0,0,0,.45)", pointerEvents: "none" }}>© Esri · OpenStreetMap</div>
    </div>
  );
}
