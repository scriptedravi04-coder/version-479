import React from "react";
import { ChevronRight } from "lucide-react";


// Session 49 (clean-up): moved out of BrandHomeMobile.jsx word for word (one section of the page).
// Everything it needs comes in as props; no logic, text or server call changed.
export default function ActiveBriefsCarousel(props) {
  const { activeBriefs, isNewBrand, navigate } = props;
  return <>{!isNewBrand && activeBriefs.length > 0 && (
          <div style={{ flexShrink: 0, padding: "18px 0 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                padding: "0 14px",
              }}
            >
              <span
                style={{
                  font: "700 16px 'DM Sans', sans-serif",
                  letterSpacing: "-0.4px",
                  color: "#0A0A0A",
                  whiteSpace: "nowrap",
                }}
              >
                Your Active Briefs
              </span>
              <button
                type="button"
                onClick={() => navigate("/brand/campaigns")}
                style={{
                  minHeight: "40px", // v332: tap target
                  padding: "0 4px",
                  font: "600 12px 'DM Sans', sans-serif",
                  color: "#7C3AED",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                View all
              </button>
            </div>

            <div
              style={{
                padding: "9px 14px 0 14px", // v330: last card was flush against the screen edge
                display: "flex",
                gap: "8px",
                overflowX: "auto",
              }}
              className="no-scrollbar scroll-smooth"
            >
              {activeBriefs.map((brief) => (
                <div
                  key={brief.id}
                  // v330: UGC briefs open the UGC screen (they are not in the campaigns list); card is keyboard/screen-reader reachable.
                  onClick={() => navigate(brief.isUgc ? "/brand/ugc/orders" : (brief.campaign_id || brief.id) ? `/brand/campaigns/${encodeURIComponent(brief.campaign_id || brief.id)}/applicants` : "/brand/campaigns")} /* v358: open THAT campaign, not the list */
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(brief.isUgc ? "/brand/ugc/orders" : (brief.campaign_id || brief.id) ? `/brand/campaigns/${encodeURIComponent(brief.campaign_id || brief.id)}/applicants` : "/brand/campaigns"); } }}
                  style={{
                    width: "256px",
                    flexShrink: 0,
                    background: "#fff",
                    border: "1px solid #E6E6EE",
                    borderRadius: "18px",
                    padding: "13px",
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        flexShrink: 0, // v330
                        height: "21px",
                        padding: "0 7px",
                        borderRadius: "7px",
                        background: brief.badgeBg,
                        display: "flex",
                        alignItems: "center",
                        font: "700 9.5px 'DM Sans', sans-serif",
                        letterSpacing: "0.4px",
                        color: brief.badgeColor,
                      }}
                    >
                      {brief.badgeText}
                    </div>
                    <span style={{ font: "500 10.5px 'DM Sans', sans-serif", color: "#5F6672" /* v415: contrast */ }}>
                      {brief.daysLeft}
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: "9px",
                      font: "700 14px/1.3 'DM Sans', sans-serif",
                      color: "#0A0A0A",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {brief.title}
                  </div>
                  <div
                    style={{
                      marginTop: "2px",
                      font: "400 11px 'DM Sans', sans-serif",
                      color: "#5F6672",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {brief.type}
                  </div>

                  {/* Desktop-identical Footer Stats (Views + Real Creator Avatars + Applied Count) */}
                  <div
                    style={{
                      marginTop: "12px",
                      paddingTop: "10px",
                      borderTop: "1px solid #F1F1F6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    {/* v451 (Ravi): no views here — the real applicants as photo chips (up to 4, then +N) */}
                    <div style={{ display: "flex", alignItems: "center", minWidth: 0 }} data-testid="brief-applicant-chips">
                      {(brief.avatars || []).length > 0 ? (
                        <>
                          {brief.avatars.map((a, idx) => {
                            const photo = typeof a === "string" ? a : a?.photo;
                            const name = typeof a === "string" ? "" : String(a?.name || "");
                            const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "•";
                            return (
                              <span key={idx} title={name || undefined}
                                style={{ width: 26, height: 26, borderRadius: "50%", border: "2px solid #fff", marginLeft: idx === 0 ? 0 : -8, background: "#EDE9FE", color: "#6D28D9", font: "700 9.5px 'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative", zIndex: 5 - idx, boxShadow: "0 1px 3px rgba(16,16,20,.12)" }}>
                                {ini}
                                {photo && <img src={photo} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                              </span>
                            );
                          })}
                          {Number(brief.appliedCount) > brief.avatars.length && (
                            <span style={{ marginLeft: -8, height: 26, minWidth: 26, padding: "0 7px", borderRadius: 13, border: "2px solid #fff", background: "#F3F0FF", color: "#5B21B6", font: "700 10px 'DM Sans', sans-serif", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
                              +{Number(brief.appliedCount) - brief.avatars.length}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ font: "500 11px 'DM Sans', sans-serif", color: "#9CA3AF" }}>{brief.isUgc ? "" : "Creators can apply now"}</span>
                      )}
                    </div>

                    {/* Right: Applied Count + Arrow */}
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <span
                        style={{
                          font: "700 11px 'DM Sans', sans-serif",
                          color: "#7C3AED",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {brief.isUgc ? "View orders" : `${Number(brief.appliedCount) || 0} applied`}{/* v332: never "undefined applied" · v358: "0 applied" meant nothing on a UGC brief */}
                      </span>
                      <ChevronRight size={13} color="#9CA3AF" strokeWidth={2.2} style={{ flexShrink: 0 }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}</>;
}
