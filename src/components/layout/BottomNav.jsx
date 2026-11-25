import React, { useRef, useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Home, Search, MessageCircle, User, LayoutGrid, Megaphone, ShoppingBag, Users, ShieldAlert, Wallet, Video, X, Layers, Compass, Zap } from "lucide-react";
import { ignored } from "../../utils/ignored";
import { draftGet } from "../../lib/userDraft";
import { useAuth } from "../../contexts/AuthContext";
import { api } from "../../lib/api"; // v450
import { initials as initialsOfName } from "../../utils/initials"; // v450
import useBackToClose from "../../lib/popupRules"; // v456: phone Back closes this popup
import { savedAccounts } from "../../utils/storage"; // v477: switch account
import { switchAccount, startAddAccount } from "../../contexts/AuthContext";
import { fetchAs } from "../../lib/nativePush";
import { ybHaptic } from "../../lib/haptics";

/**
 * BottomNav Component — Mobile Only
 * Spec:
 * - Fixed bottom, full width, 58px of tabs + safe-area inset + 4px (v348: was 84px)
 * - Solid white (dark: #0f172a), 1px top border #E5E5E2 (v348: was 94% white + blur — page showed through)
 * - Equal flex tabs, icon 22px above a 10px label, 5px gap, min 44px hit target
 * - Role-based tabs: "creator" | "brand" | "admin"
 * - Active state dynamic from router
 * - Raised center for Creator Explore tab (46px, -18px offset)
 * - Re-tap on active tab scrolls page to top
 */
export default function BottomNav({
  role = "creator",
  hasPendingWork = false,
  activeThreadsCount = 0,
  className = "",
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const { user: navUser } = useAuth() || {};
  const [navPhotoBroken, setNavPhotoBroken] = useState(false);
  // v477 (Ravi: Instagram-style switch account): press and hold the Profile tab → the accounts on this phone
  const [acctSheet, setAcctSheet] = useState(false);
  useBackToClose(acctSheet, () => setAcctSheet(false));
  const [otherNew, setOtherNew] = useState({}); // user_id → unread count, for accounts that aren't open
  const pressRef = useRef({ t: null, fired: false });
  useEffect(() => {
    let off = false;
    const check = async () => {
      const others = savedAccounts().filter((a) => a.user_id !== navUser?.user_id);
      if (!others.length) { setOtherNew({}); return; }
      const out = {};
      await Promise.all(others.map(async (a) => { const r = await fetchAs(a, "notifications/unread"); out[a.user_id] = Array.isArray(r) ? r.length : 0; }));
      if (!off) setOtherNew(out);
    };
    if (navUser?.user_id) check();
    const id = setInterval(() => { if (document.visibilityState === "visible" && navUser?.user_id) check(); }, 180000);
    return () => { off = true; clearInterval(id); };
  }, [navUser?.user_id, acctSheet]);
  const anyOtherNew = Object.values(otherNew).some((n) => n > 0);
  const pressStart = () => {
    pressRef.current.fired = false;
    clearTimeout(pressRef.current.t);
    pressRef.current.t = setTimeout(() => { pressRef.current.fired = true; ybHaptic("tap"); setAcctSheet(true); }, 450);
  };
  const pressEnd = () => clearTimeout(pressRef.current.t);
  const rawNavPhoto = navUser?.picture || navUser?.photo || navUser?.profile_image || navUser?.avatar || "";
  // v344: a new photo URL gets a fresh chance to load (the broken flag belonged to the old one)
  useEffect(() => { setNavPhotoBroken(false); }, [rawNavPhoto]);
  const navPhoto = !navPhotoBroken && rawNavPhoto && !String(rawNavPhoto).includes("dicebear") ? rawNavPhoto : "";

  // v450 (BRD §17/§23): the brand's own logo on the last tab (label "Profile"); no logo → initials tile, never the bag.
  const [brandLogo, setBrandLogo] = useState({ url: "", name: "", broken: false });
  useEffect(() => {
    if (!["brand", "agency", "talent_manager"].includes(role) || !navUser) return undefined;
    let alive = true;
    api.get("brands/me").then(({ data }) => { if (alive) setBrandLogo({ url: String(data?.logo || "").trim(), name: data?.company_name || navUser?.name || "", broken: false }); }).catch(() => { if (alive) setBrandLogo((b) => ({ ...b, name: navUser?.name || "" })); });
    return () => { alive = false; };
  }, [role, navUser?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // State for Brand action popup menu ("Create Campaign" / "Create UGC")
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  useBackToClose(createMenuOpen, () => setCreateMenuOpen(false)); // v456 (Back review): phone Back closes it instead of putting the app away
  // v437 (APP_TOUR_SPEC): the Home tour opens / closes the real Manage chooser on its step 3.
  useEffect(() => {
    const onTour = (e) => setCreateMenuOpen(Boolean(e?.detail?.open));
    window.addEventListener("ybex:tour-menu", onTour);
    return () => window.removeEventListener("ybex:tour-menu", onTour);
  }, []);
  const [hasUgcDraft, setHasUgcDraft] = useState(false);

  useEffect(() => {
    try {
      const draft = draftGet("nexus_brand_ugc_draft");
      setHasUgcDraft(Boolean(draft && draft.length > 20));
    } catch (e) {
      setHasUgcDraft(false);
    }
  }, [createMenuOpen]);

  // Close create action sheet whenever location pathname changes
  useEffect(() => {
    setCreateMenuOpen(false);
  }, [currentPath]);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setCreateMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Define tab sets for each role according to the design specification
  const getTabsForRole = () => {
    if (role === "brand" || role === "agency" || role === "talent_manager") { // Session 58: agency accounts are brands
      return [
        {
          id: "dashboard",
          label: "Dashboard",
          icon: LayoutGrid,
          path: "/brand",
          matches: (path) =>
            path === "/brand" ||
            path === "/brand/dashboard" ||
            (path === "/dashboard" && role === "brand"),
        },
        {
          id: "discover",
          label: "Explore",
          icon: Search,
          path: "/creators",
          matches: (path) =>
            path === "/brand/discover" ||
            path === "/creators" ||
            path === "/explore" ||
            path.startsWith("/creator/"),
        },
        {
          id: "manage",
          label: "Manage",
          icon: Layers,
          isRaised: true,
          isAction: true,
          matches: (path) =>
            path.startsWith("/brand/campaigns") ||
            path.startsWith("/brand/ugc"),
        },
        {
          id: "inbox",
          label: "Inbox",
          icon: MessageCircle,
          path: "/brand/inbox",
          matches: (path) =>
            path === "/brand/inbox" ||
            path.startsWith("/brand/inbox/") ||
            path.startsWith("/chat"),
          badgeCount: activeThreadsCount,
        },
        {
          id: "brand",
          label: "Profile", // v450 (BRD §23): fixed label; the icon is the brand's logo
          icon: ShoppingBag,
          path: "/brand/account",
          isAccountTab: true,
          hubPaths: ["/brand/account"],
          matches: (path) =>
            path === "/brand/account" ||
            path === "/brand/settings" ||
            path === "/brand/profile" ||
            path === "/brand/payments" ||
            path === "/brand/kyc" ||
            (path === "/settings" && role === "brand"),
        },
      ];
    }

    if (role === "admin" || role === "sub_admin") {
      return [
        {
          id: "overview",
          label: "Overview",
          icon: LayoutGrid,
          path: "/admin?tab=dashboard",
          matches: (path) => path.startsWith("/admin") && (!location.search || location.search.includes("tab=dashboard")),
        },
        {
          id: "users",
          label: "Users",
          icon: Users,
          path: "/admin?tab=users",
          matches: (path) => `${path}${typeof window !== "undefined" ? window.location.search : ""}`.includes("tab=users"), // Session 58: the query string is not in the path
        },
        {
          id: "kyc",
          label: "KYC",
          icon: ShieldAlert,
          path: "/admin?tab=verifications",
          matches: (path) => `${path}${typeof window !== "undefined" ? window.location.search : ""}`.includes("tab=verifications"), // Session 58: the query string is not in the path
        },
        {
          id: "escrow",
          label: "Payments", // v332: same name as the admin sidebar (no "escrow" word on screen)
          icon: Wallet,
          path: "/admin?tab=escrow",
          matches: (path) => `${path}${typeof window !== "undefined" ? window.location.search : ""}`.includes("tab=escrow"), // Session 58: the query string is not in the path
        },
        // Session 43 (Ravi): admin on a phone needs every section + Logout → "More".
        {
          id: "more",
          label: "More",
          icon: LayoutGrid,
          path: "/admin?tab=more",
          matches: (path) => `${path}${typeof window !== "undefined" ? window.location.search : ""}`.includes("tab=more"), // Session 58: the query string is not in the path
        },
      ];
    }

    // Default: Creator (5 Tabs matching Turn 24 spec)
    return [
       {
         id: "home",
         label: "Home",
         icon: Home,
         path: "/dashboard",
         matches: (path) => path === "/dashboard" || path === "/",
       },
       {
         id: "campaigns",
         label: "Campaigns",
         icon: Compass,
         path: "/campaigns",
         matches: (path) =>
           path === "/campaigns" ||
           path.startsWith("/campaigns/") ||
           path === "/explore" ||
           path === "/creators",
       },
       {
         id: "explore_ugc",
         label: "UGC", // v419 (QA): "Explore UGC" was cut to "Explore U…" on every phone
         icon: Zap,
         path: "/creator/ugc",
         matches: (path) =>
           path.startsWith("/creator/ugc") ||
           path === "/ugc" ||
           path === "/ugc-orders" ||
           path === "/creator-campaign-flow",
         isRaised: true, // Raised center for Creator only (46px, -18px offset)
       },
       {
         id: "inbox",
         label: "Inbox",
         icon: MessageCircle,
         path: "/creator/inbox",
         matches: (path) =>
           path === "/creator/inbox" ||
           path === "/inbox" ||
           path === "/chat" ||
           path.startsWith("/chat/"),
         badgeCount: activeThreadsCount,
       },
       {
         id: "profile",
         label: "Profile",
         icon: User,
         path: "/creator/profile",
         isAccountTab: true,
         hubPaths: ["/creator/profile", "/profile", "/creator/settings"],
         matches: (path) =>
           path === "/profile" ||
           path === "/creator/settings" ||
           path === "/creator/profile" ||
           path === "/profile/overview" ||
           path === "/settings" ||
           path === "/earnings" ||
           path === "/refer" ||
           path === "/creator/kyc" ||
           path === "/kyc" ||
           path === "/kyc/status" ||
           path.startsWith("/help"),
       },
     ];
  };

  const tabs = getTabsForRole();

  // The app scrolls an inner container, not the window — Layout gives it this id.
  const getScroller = () => document.getElementById("app-scroll-container");

  const scrollToTop = () => {
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { ignored("BottomNav:252", e); }
    try { getScroller()?.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { ignored("BottomNav:253", e); }
  };

  // Spec: "tapping a different tab restores that tab's last scroll position".
  // Kept in a ref rather than sessionStorage so it resets with the session and can
  // never resurrect a stale offset for a page whose content has since changed.
  const scrollMemory = useRef({});
  const activeTabId = tabs.find((t) => t.matches(currentPath))?.id;

  const rememberScroll = () => {
    if (!activeTabId) return;
    const el = getScroller();
    scrollMemory.current[activeTabId] = el ? el.scrollTop : window.scrollY || 0;
  };

  const restoreScroll = (tabId) => {
    const top = scrollMemory.current[tabId];
    if (!top) return;
    try { window.__ybScrollRestore = Date.now(); } catch (e) { ignored("BottomNav:restoreFlag", e); } // Session 48: Layout's top-reset leaves this alone
    // Wait for the destination route to paint before restoring.
    requestAnimationFrame(() => {
      setTimeout(() => {
        try { getScroller()?.scrollTo({ top, behavior: "auto" }); } catch (e) { ignored("BottomNav:274", e); }
      }, 160); // Session 43: after Layout's own "new page → top" check (80 ms)
    });
  };

  const handleTabClick = (tab, isActive) => {
    if (tab.isAction) {
      if (!createMenuOpen) ybHaptic("tap"); // v478: a sheet opens
      setCreateMenuOpen((prev) => !prev);
      return;
    }
    if (!isActive) ybHaptic("tick"); // v478: tab changed

    if (createMenuOpen) {
      setCreateMenuOpen(false);
    }

    // The account tab owns a hub with push-route sub-screens behind a ?section=
    // param (creator and brand both). Re-tapping it must come back to the hub,
    // not just scroll whatever sub-screen is open.
    if (tab.isAccountTab) {
      window.dispatchEvent(new CustomEvent("reset-mobile-profile-hub"));
      if (isActive) {
        // Already on the hub with no sub-screen open? Just scroll. Otherwise come
        // back to it — the account tab also matches /refer, /help, /earnings and
        // the like, and re-tapping should return home from those too.
        const onHub = (tab.hubPaths || [tab.path]).includes(location.pathname);
        if (location.search || !onHub) navigate(tab.path, { replace: true });
        scrollToTop();
      } else {
        // Session 48: the Profile / Account tab always opens fresh at the top (it goes back to the
        // hub anyway, so an old offset belongs to a different screen).
        rememberScroll();
        const homeTab = tabs.find((t) => !t.isAction);
        navigate(tab.path, { replace: Boolean(homeTab) && !homeTab.matches(location.pathname) }); // v456: tabs don't stack Back steps
      }
      return;
    }

    if (isActive) {
      scrollToTop();
    } else {
      rememberScroll();
      // v456 (Back review): switching tabs used to stack history (Home → Explore → Deals → Explore… = 4 Backs to leave).
      // Like Android apps: from Home the first tab is pushed; between the other tabs it is replaced, so Back → Home → out.
      const navTabs = tabs.filter((t) => !t.isAction);
      const onOtherTab = Boolean(navTabs[0]) && !navTabs[0].matches(location.pathname); // anywhere but Home (incl. redirected tab paths)
      navigate(tab.path, { replace: onOtherTab });
      restoreScroll(tab.id);
    }
  };

  return (
    <>
      {/* Brand Create Action Menu Backdrop */}
      <AnimatePresence>
        {createMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setCreateMenuOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[3px]"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Brand Create Action Menu Modal / Popup */}
      <AnimatePresence>
        {createMenuOpen && (
          <motion.div
            id="brand-hub-menu-modal"
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 440, damping: 28 }}
            className="fixed z-50 left-1/2 -translate-x-1/2 flex items-center justify-center gap-3 w-full max-w-[310px] px-3 pointer-events-auto"
            style={{
              bottom: "calc(92px + env(safe-area-inset-bottom, 0px))", // v348: bar is 26px shorter (was 118px)
            }}
          >
            {/* Option 1: CAMPAIGNS */}
            <button
              id="brand-action-campaigns"
              type="button"
              onClick={() => {
                setCreateMenuOpen(false);
                navigate("/brand/campaigns");
              }}
              className="flex-1 min-w-[130px] bg-white dark:bg-[#1E293B] text-[#0A0A0A] dark:text-white font-bold text-xs py-3 px-3.5 rounded-2xl shadow-[0_12px_30px_rgba(0,0,0,0.16)] border border-[#E5E5EA] dark:border-slate-700/80 flex items-center justify-center gap-2.5 active:scale-95 transition-all cursor-pointer hover:border-[#7C3AED]/50"
            >
              <div className="w-7 h-7 rounded-xl bg-[#F1E8FF] dark:bg-purple-950/60 text-[#7C3AED] dark:text-[#A78BFA] flex items-center justify-center shrink-0">
                <Megaphone size={15} strokeWidth={2.2} />
              </div>
              <span className="tracking-tight text-[13px]">Campaigns</span>
            </button>

            {/* Option 2: UGC */}
            <button
              id="brand-action-ugc"
              type="button"
              onClick={() => {
                setCreateMenuOpen(false);
                navigate("/brand/ugc/instant");
              }}
              className="flex-1 min-w-[130px] bg-white dark:bg-[#1E293B] text-[#0A0A0A] dark:text-white font-bold text-xs py-3 px-3.5 rounded-2xl shadow-[0_12px_30px_rgba(0,0,0,0.16)] border border-[#E5E5EA] dark:border-slate-700/80 flex items-center justify-center gap-2.5 active:scale-95 transition-all cursor-pointer hover:border-emerald-500/50"
            >
              <div className="w-7 h-7 rounded-xl bg-[#ECFDF5] dark:bg-emerald-950/60 text-[#059669] dark:text-[#34D399] flex items-center justify-center shrink-0">
                <Video size={15} strokeWidth={2.2} />
              </div>
              <span className="tracking-tight text-[13px]">UGC</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <nav
        id="mobile-bottom-navigation"
        aria-label="Mobile Bottom Navigation"
        /* v348 (Ravi's iPhone): solid bar — the 94% see-through white (blur is off on phones) showed page text behind it. */
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 w-full bg-white dark:bg-[#0f172a] border-t border-[#E5E5EA] dark:border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.3)] transition-colors duration-150 select-none ${className}`}
        style={{
          // v348 (Ravi: bar too tall, empty space under the labels): 58px of tabs + the home-bar inset + 4px (was 84px + inset).
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4px)",
          height: "calc(58px + env(safe-area-inset-bottom, 0px) + 4px)",
        }}
      >
        <div className="flex items-center justify-around h-[58px] px-1.5 w-full max-w-lg mx-auto relative">
          {tabs.map((tab) => {
            const isActive = tab.matches(currentPath);
            const Icon = tab.icon;
            const isMenuOpenForThisTab = tab.isAction && createMenuOpen;

            if (tab.isRaised) {
              // Raised Centre Tab (Explore for Creator, Pencil Create for Brand: squircle, -18px offset)
              return (
                <button
                  key={tab.id}
                  id={`bottom-nav-tab-${tab.id}`}
                  type="button"
                  onClick={() => handleTabClick(tab, isActive)}
                  className="flex-1 min-w-0 flex flex-col items-center justify-center relative touch-manipulation cursor-pointer group py-1"
                  aria-label={tab.label}
                  aria-current={isActive ? "page" : undefined}
                  aria-expanded={tab.isAction ? createMenuOpen : undefined} /* v332: screen readers hear the menu open/close */
                >
                  {/* Raised Floating Squircle */}
                  <div
                    className={`w-[46px] h-[46px] rounded-[16px] flex items-center justify-center -translate-y-[18px] transition-all duration-200 active:scale-95 shadow-[0_8px_20px_rgba(124,58,237,0.38)] ring-4 ring-white dark:ring-[#0f172a] ${
                      isMenuOpenForThisTab || isActive
                        ? "bg-[#7C3AED] text-white scale-105"
                        : "bg-[#7C3AED] text-white hover:bg-[#6D28D9]"
                    }`}
                  >
                    {isMenuOpenForThisTab ? (
                      <X size={22} strokeWidth={2.4} className="animate-in fade-in zoom-in-75 duration-150" />
                    ) : (
                      <Icon size={22} strokeWidth={2.2} />
                    )}
                  </div>

                  {/* Label aligned directly underneath */}
                  <span
                    className={`text-[11px] leading-tight tracking-tight -translate-y-[12px] truncate max-w-[64px] transition-colors ${
                      isMenuOpenForThisTab || isActive
                        ? "font-bold text-[#7C3AED] dark:text-[#A78BFA]"
                        : "font-semibold text-[#767680] dark:text-slate-400"
                    }`}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            }

            // Standard Flat Tab
            return (
              <button
                key={tab.id}
                id={`bottom-nav-tab-${tab.id}`}
                type="button"
                onClick={() => { if (pressRef.current.fired) { pressRef.current.fired = false; return; } handleTabClick(tab, isActive); }}
                {...(isAccountTab(tab.id, role) ? { onPointerDown: pressStart, onPointerUp: pressEnd, onPointerLeave: pressEnd, onPointerCancel: pressEnd, onContextMenu: (e) => e.preventDefault(), onTouchEnd: (e) => { if (pressRef.current.fired) e.preventDefault(); } /* lifting the finger must not tap the sheet behind it */, "data-account-tab": "1", style: { WebkitTouchCallout: "none" } } : {})}
                className="flex-1 min-w-0 min-h-[48px] flex flex-col items-center justify-center relative touch-manipulation cursor-pointer group py-1.5 transition-all"
                aria-label={tab.label}
                aria-current={isActive ? "page" : undefined}
              >
                {/* Icon Container with Badge */}
                <div className="relative flex items-center justify-center">
                  {tab.id === "brand" ? (
                    brandLogo.url && !brandLogo.broken
                      ? <img src={brandLogo.url} alt="" data-testid="nav-brand-logo" onError={() => setBrandLogo((b) => ({ ...b, broken: true }))} className="w-[26px] h-[26px] rounded-[8px] object-cover" style={{ boxShadow: isActive ? "0 0 0 2px #fff, 0 0 0 4px #7C3AED" : "0 0 0 1px #E5E5EA" }} />
                      : <span data-testid="nav-brand-initials" className="w-[26px] h-[26px] rounded-[8px] bg-[#EDE5FF] text-[#6D28D9] text-[11px] font-bold flex items-center justify-center" style={{ boxShadow: isActive ? "0 0 0 2px #fff, 0 0 0 4px #7C3AED" : "none" }}>{initialsOfName(brandLogo.name || "B")}</span>
                  ) : tab.id === "profile" && role === "creator" && navPhoto ? (
                    // Session 39 (M22, Ravi): the creator's own photo instead of the person icon.
                    <img
                      src={navPhoto}
                      alt=""
                      data-testid="nav-profile-photo"
                      onError={() => setNavPhotoBroken(true)}
                      className={`w-[24px] h-[24px] rounded-full object-cover ${isActive ? "ring-2 ring-[#7C3AED] ring-offset-1" : "ring-1 ring-[#E5E5EA]"}`}
                    />
                  ) : (
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.4 : 1.8}
                    fill={isActive ? "rgba(124,58,237,0.14)" : "none"}
                    className={`transition-colors duration-150 ${
                      isActive
                        ? "text-[#7C3AED] dark:text-[#A78BFA]"
                        : "text-[#767680] dark:text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200"
                    }`}
                  />
                  )}

                  {isAccountTab(tab.id, role) && anyOtherNew ? <span data-testid="nav-other-account-dot" aria-label="New on another account" className="absolute -top-0.5 -right-1 w-[9px] h-[9px] rounded-full bg-[#E11D48] ring-2 ring-white" /> : null}
                  {/* Badge Indicator */}
                  {tab.badgeCount !== undefined && tab.badgeCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 h-4 min-w-[16px] px-1 bg-[#7C3AED] text-white text-[11px] font-bold rounded-full flex items-center justify-center leading-none ring-2 ring-white dark:ring-[#0f172a] shadow-xs">
                      {tab.badgeCount > 9 ? "9+" : tab.badgeCount}
                    </span>
                  )}

                  {/* Dot badge if boolean */}
                  {tab.badge && !tab.badgeCount && (
                    <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[#7C3AED] ring-2 ring-white dark:ring-[#0f172a] animate-pulse" />
                  )}
                </div>

                {/* Label */}
                <span
                  className={`text-[11px] leading-tight tracking-tight mt-[5px] truncate max-w-[64px] text-center transition-colors ${
                    isActive
                      ? "font-bold text-[#7C3AED] dark:text-[#A78BFA]"
                      : "font-semibold text-[#767680] dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-300"
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
      {acctSheet ? <SwitchAccountSheet currentId={navUser?.user_id} otherNew={otherNew} onClose={() => setAcctSheet(false)} /> : null}
    </>
  );
}

/** v477: which tab is "my profile" (press and hold → switch account). */
export function isAccountTab(id, role) { return id === "profile" || (role === "brand" && id === "brand"); }

const ROLE_LABEL = { brand: "Brand", creator: "Creator", admin: "Admin", sub_admin: "Team" };

/** v477: Instagram-style account list — tap one to open it, or add another. */
export function SwitchAccountSheet({ currentId, otherNew = {}, onClose, onSwitch = switchAccount, onAdd = startAddAccount }) {
  const list = savedAccounts();
  const openedAt = useRef(Date.now());
  const close = () => { if (Date.now() - openedAt.current > 450) onClose?.(); }; // the finger that opened it is still lifting
  const cur = list.find((a) => a.user_id === currentId);
  const rows = cur ? [cur, ...list.filter((a) => a.user_id !== currentId)] : list;
  return (
    <div className="md:hidden fixed inset-0 z-[400]" data-yb-popup="1" role="dialog" aria-modal="true" aria-label="Switch account" data-testid="switch-account-sheet">
      <button type="button" aria-label="Close" onClick={close} className="absolute inset-0 bg-black/35" />
      <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-[22px] px-3 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)", animation: "ybSheetUp .22s ease-out" }}>
        <style>{"@keyframes ybSheetUp{from{transform:translateY(100%)}to{transform:none}}"}</style>
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#D1D1D6]" />
        <p className="mb-2 text-center text-[15px] font-bold text-[#1C1C1E]">Switch account</p>
        {rows.map((a) => {
          const on = a.user_id === currentId;
          return (
            <button key={a.user_id} type="button" data-testid="switch-account-row" disabled={on}
              onClick={() => onSwitch(a.user_id) /* no close first: closing steps history back, which cancelled the page change */}
              className="flex w-full min-h-[56px] items-center gap-3 rounded-2xl px-2 py-2 text-left active:bg-[#F2F2F7]">
              <span className="relative flex h-10 w-10 shrink-0">
                <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#EDE4FF] text-[14px] font-bold text-[#6D28D9]">{a.picture ? <img src={a.picture} alt="" className="h-full w-full object-cover" /> : initialsOfName(a.name || "Y")}</span>
                {!on && otherNew[a.user_id] > 0 ? <span className="absolute -right-0.5 -top-0.5 h-[11px] w-[11px] rounded-full border-2 border-white bg-[#E11D48]" aria-label="New activity" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-[#1C1C1E]">{a.name}</span>
                <span className="block text-[12px] text-[#6B6B70]">{ROLE_LABEL[a.role] || "Account"}</span>
              </span>
              {on ? (
                <svg width="22" height="22" viewBox="0 0 24 24" role="img" aria-label="Open now"><circle cx="12" cy="12" r="11" fill="#7C3AED" /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="#D1D1D6" strokeWidth="1.6" /></svg>
              )}
            </button>
          );
        })}
        {list.length < 5 ? (
          <button type="button" data-testid="switch-account-add" onClick={() => onAdd()}
            className="flex w-full min-h-[56px] items-center gap-3 rounded-2xl px-2 py-2 text-left active:bg-[#F2F2F7]">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F2F2F7]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C1C1E" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </span>
            <span className="text-[15px] font-semibold text-[#1C1C1E]">Add account</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
