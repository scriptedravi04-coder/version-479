// v457: the 6 "brands growing with Ybex" logos used to load from iili.io (a free image host we don't control).
// The server now copies them once into our own public bucket (brand-logos/trusted/, backend/admin_speed_routes.ts
// mirrorTrustedLogos). The app loads our copy; if that isn't there yet, it falls back to the old link (onError).
export const TRUSTED_LOGO_FILES = ["CeJTOuI.png", "CeJRkZP.png", "CeJ5cla.webp", "CeJ7whB.png", "CeJRHhP.jpg", "CeJRBvR.jpg"];

const base = (() => {
  try {
    let u = (typeof import.meta !== "undefined" && import.meta.env?.VITE_SUPABASE_URL) || "";
    u = String(u).trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//.test(u)) u = "https://" + u;
    return u;
  } catch { return ""; }
})();

export const trustedBrands = TRUSTED_LOGO_FILES.map((f) => {
  const fallbackUrl = `https://iili.io/${f}`;
  return { logoUrl: base ? `${base}/storage/v1/object/public/brand-logos/trusted/${f}` : fallbackUrl, fallbackUrl };
});

/** onError for a trusted-brand <img>: try the old link once, then hide. */
export function trustedLogoError(e, brand, hide) {
  const img = e?.target;
  if (!img) return;
  if (brand?.fallbackUrl && img.dataset.fb !== "1" && img.src !== brand.fallbackUrl) { img.dataset.fb = "1"; img.src = brand.fallbackUrl; return; }
  hide?.(img);
}
