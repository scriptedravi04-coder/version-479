import React, { createContext, useContext, useEffect, useState } from "react";
import { safeJsonParse } from "../utils/safeFormat";
import { api } from "../lib/api";
import { toast } from "sonner";
import { safeStorage, savedAccounts, rememberAccount, forgetAccount, accountFor } from "../utils/storage";
import { rememberMediaKey, forgetMediaKey } from "../lib/mediaKey";
import { clearSnapshots } from "../lib/apiSnapshot";
import { useLiveRefresh } from "../lib/liveRefresh";
import { sendSignupSource } from "../lib/signupSource";
import { releasePushOnLogout } from "../lib/push";
import { isOffline } from "../lib/offline";
import { isServerDown } from "../lib/serverStatus"; // v364
import { clearOutbox } from "../lib/outbox"; // v364
import { clearUserDrafts } from "../lib/userDraft"; // v423 (S9)

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kycStatus, setKycStatus] = useState(null);
  const [kycLoading, setKycLoading] = useState(false);

  const isKycApproved = Boolean(
    kycStatus?.status === "approved" ||
    kycStatus?.status === "APPROVED" ||
    user?.kyc_verified === true ||
    user?.kyc_status === "approved" ||
    user?.kyc_status === "APPROVED"
  );

  const fetchKycStatus = async (currentUser) => {
    const targetUser = currentUser || user;
    if (!targetUser || targetUser.role === 'admin' || targetUser.team_role === 'sub_admin') {
      setKycStatus(null);
      return null;
    }
    try {
      setKycLoading(true);
      const { data } = await api.get("verifications/me").catch(() => ({ data: null }));
      setKycStatus(data);
      return data;
    } catch {
      setKycStatus(null);
      return null;
    } finally {
      setKycLoading(false);
    }
  };

  // Session 58: tell the server where a brand-new account came from (Growth page). Once, never blocks anything.
  useEffect(() => {
    if (user?.user_id) sendSignupSource(api, user);
  }, [user?.user_id]);

  useEffect(() => {
    if (user?.user_id) {
      fetchKycStatus(user);
    } else {
      setKycStatus(null);
    }
  }, [user?.user_id]);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const token = safeStorage.getItem("ybex_token");
        if (!token) {
          setUser(null);
          setLoading(false);
          return;
        }

        // v334 (offline app): no internet → open at once with the saved login (no waiting for the check to fail).
        // The login is checked again when the app opens online; a logged-out answer still logs out.
        // v364: same while the Ybex server is updating (phone online, server not answering).
        if (isOffline() || isServerDown()) {
          const saved = safeJsonParse(safeStorage.getItem("ybex_user"), null);
          if (saved && (saved.user_id || saved.id)) {
            setUser(saved);
            fetchKycStatus(saved);
            return; // finally → setLoading(false)
          }
        }

        const meRes = await api.get("auth/me");
        const { data } = meRes;
        // v364: server updating (HTML page / no real answer) is NOT "logged out" — keep the saved login.
        if (meRes?.serverDown || Array.isArray(data) || (isServerDown() && !(data && (data.user || data.user_id)))) {
          const saved = safeJsonParse(safeStorage.getItem("ybex_user"), null);
          setUser(saved && (saved.user_id || saved.id) ? saved : null);
          if (saved && (saved.user_id || saved.id)) fetchKycStatus(saved);
          return;
        }
        rememberMediaKey(data);
        if (data && data.user) {
          // v344: keep the same object when nothing changed
          setUser(prev => (JSON.stringify(prev) === JSON.stringify(data.user) ? prev : data.user));
          safeStorage.setItem("ybex_user", JSON.stringify(data.user));
          fetchKycStatus(data.user);
        } else if (data && data.user_id) {
          setUser(prev => (JSON.stringify(prev) === JSON.stringify(data) ? prev : data));
          safeStorage.setItem("ybex_user", JSON.stringify(data));
          fetchKycStatus(data);
        } else {
          // Token is invalid/expired
          setUser(null);
          dropSavedLogin(token); // v477: a switch-account entry whose login has ended
          safeStorage.removeItem("ybex_token");
          forgetMediaKey(); clearSnapshots(); clearOutbox();
          safeStorage.removeItem("ybex_user");
        }
      } catch (err) {
        console.error("Error fetching session from backend:", err);
        if (err.response?.status === 403 || err.response?.status === 401) {
          setUser(null);
          dropSavedLogin(safeStorage.getItem("ybex_token")); // v477
          safeStorage.removeItem("ybex_token");
          forgetMediaKey(); clearSnapshots(); clearOutbox();
          safeStorage.removeItem("ybex_user");
          if (err.response?.data?.detail) {
             toast.error(err.response.data.detail, { duration: 8000 });
          }
          setLoading(false);
          return;
        }
        const savedUser = safeStorage.getItem("ybex_user");
        if (savedUser) {
          try {
            const parsed = JSON.parse(savedUser);
            setUser(parsed);
            fetchKycStatus(parsed);
          } catch (e) {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  const login = async (email, password, appRole = undefined) => {
    try {
      setLoading(true);
      const res = await api.post("auth/login", { email: (email || '').trim(), password, ...(appRole ? { app_role: appRole } : {}) });
      const data = res?.data;
      
      if (data && data.requiresVerification) {
         return data;
      }
      
      if (data && data.token) {
        safeStorage.setItem("ybex_token", data.token);
        safeStorage.setItem("ybex_user", JSON.stringify(data.user));
        setUser(data.user);
        // v344: store media_key right after login (login reply may not carry it → ask auth/me); never blocks login
        rememberMediaKey(data);
        Promise.resolve().then(() => refreshUser()).catch(() => {});
        return data.user;
      }
      if (data && (data.detail || data.error || data.message)) {
        const customErr = new Error(data.detail || data.error || data.message || "Login failed");
        customErr.response = res;
        throw customErr;
      }
      throw new Error("Invalid response from server");
    } catch (error) {
      console.error("Error signing in:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signup = async (name, email, password, role = "creator", phone = "", referralCode = "", consent = {}) => {
    try {
      setLoading(true);
      const res = await api.post("auth/signup", {
        name,
        email: (email || '').trim(),
        password,
        role,
        phone,
        referral_code: referralCode || null,
      });
      const data = res?.data;
      
      if (data && data.requiresVerification) {
         return data;
      }

      if (data && data.token) {
        safeStorage.setItem("ybex_token", data.token);
        safeStorage.setItem("ybex_user", JSON.stringify(data.user));
        setUser(data.user);
        return data.user;
      }
      if (data && (data.detail || data.error || data.message)) {
        const customErr = new Error(data.detail || data.error || data.message || "Signup failed");
        customErr.response = res;
        throw customErr;
      }
      throw new Error("Invalid response from server");
    } catch (error) {
      console.error("Error signing up:", error);
      const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message || "Signup failed";
      toast.error(errorMessage);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await releasePushOnLogout(); // Session 58: before the token is gone (the server needs to know whose phone it is)
      await api.post("auth/logout").catch(() => {});
    } finally {
      try { clearUserDrafts(); } catch { /* storage blocked */ } // v423 (S9): before ybex_user is gone (the keys carry its id)
      try { const u = safeJsonParse(safeStorage.getItem("ybex_user"), null); if (u?.user_id) forgetAccount(u.user_id); } catch { /* ignore */ } // v477: off the switch list
      safeStorage.removeItem("ybex_token");
          forgetMediaKey(); clearSnapshots(); clearOutbox();
      safeStorage.removeItem("ybex_user");
      // v419 (Eva review M6): the open Eva chat must not stay for the next person on this phone.
      try { Object.keys(sessionStorage).filter((k) => k.startsWith("yb_eva_sess_")).forEach((k) => sessionStorage.removeItem(k)); } catch { /* blocked */ }
      setUser(null);
    }
  };

  const refreshUser = async () => {
    try {
      const { data } = await api.get("auth/me");
        rememberMediaKey(data);
      if (data && (data.user || data.user_id)) {
        const u = data.user || data;
        // v344: keep the same object when nothing changed so [user] effects don't refetch every 60 s
        setUser(prev => (JSON.stringify(prev) === JSON.stringify(u) ? prev : u));
        safeStorage.setItem("ybex_user", JSON.stringify(u));
        fetchKycStatus(u).catch(() => {});
        return u;
      }
    } catch (err) {
      console.error("Error refreshing user:", err);
      if (err.response?.status === 403 || err.response?.status === 401) {
          setUser(null);
          safeStorage.removeItem("ybex_token");
          forgetMediaKey(); clearSnapshots(); clearOutbox();
          safeStorage.removeItem("ybex_user");
          if (err.response?.data?.detail) {
             toast.error(err.response.data.detail, { duration: 8000 });
          }
          return null;
      }
    }
    const local = safeStorage.getItem("ybex_user");
    // Corrupt localStorage here used to throw during auth bootstrap — above the router, so
    // no page boundary could catch it and the app simply would not start. A bad cached
    // user now reads as logged-out, which the app already knows how to handle.
    return safeJsonParse(local, null);
  };

  // Session 28: KYC approved/rejected while the site is open → the badge, the Launch button and
  // every KYC gate update without a page refresh. Until approved, also re-checked every minute.
  const isStaffUser = user?.role === 'admin' || user?.team_role === 'sub_admin';
  useLiveRefresh(() => refreshUser(), {
    types: ["kyc", "verification", "profile_approved"],
    intervalMs: isKycApproved ? 0 : 60000,
    focusMinGapMs: 60000,
    enabled: Boolean(user?.user_id) && !isStaffUser,
  });

  // v477: every account that signs in on this phone goes on the switch list (newest first)
  useEffect(() => {
    if (!user?.user_id) return;
    const t = safeStorage.getItem("ybex_token");
    if (t) rememberAccount(user, t);
    try { sessionStorage.removeItem(ADD_FROM_KEY); } catch { /* ignore */ }
    try { const n = sessionStorage.getItem("ybex_switched_to"); if (n) { sessionStorage.removeItem("ybex_switched_to"); toast(`Switched to ${n}`, { duration: 2000 }); } } catch { /* ignore */ }
  }, [user]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading, 
      signup, 
      login, 
      logout, 
      refreshUser, 
      setUser,
      kycStatus,
      setKycStatus,
      isKycApproved,
      kycLoading,
      refreshKycStatus: () => fetchKycStatus(user)
    }}>
      {children}
      {!loading && !user ? <SavedAccountBar /> : null}
    </AuthContext.Provider>
  );
};

// ---- v477 (Ravi: Instagram-style switch account) -------------------------------------------------------------
export const ADD_FROM_KEY = "ybex_add_account_from";
const AUTH_PAGES = /^\/(login|signup|app)(\/|$)/;
function dropSavedLogin(token) {
  if (!token) return;
  const a = savedAccounts().find((x) => x.token === token);
  if (a) forgetAccount(a.user_id);
}
/** Home page of an account. */
export function homeFor(role) {
  if (role === "brand") return "/brand/dashboard";
  if (role === "creator") return "/creator/dashboard";
  if (role === "admin" || role === "sub_admin") return "/admin";
  return "/";
}
function clearAccountScratch() {
  try { forgetMediaKey(); clearSnapshots(); } catch { /* ignore */ }
  try { Object.keys(sessionStorage).filter((k) => k.startsWith("yb_eva_sess_")).forEach((k) => sessionStorage.removeItem(k)); } catch { /* blocked */ }
}
/** Open another saved account (fresh app start, so nothing from the old one stays on screen). */
export function switchAccount(uid, { to, go = (u) => window.location.replace(u) } = {}) { // replace: Back never returns to the other account's screen
  const a = accountFor(uid);
  if (!a) return false;
  safeStorage.setItem("ybex_token", a.token);
  safeStorage.setItem("ybex_user", JSON.stringify(a.user || { user_id: a.user_id, name: a.name, role: a.role, email: a.email }));
  rememberAccount(a.user || a, a.token);
  clearAccountScratch();
  try { sessionStorage.setItem("ybex_switched_to", a.name || ""); } catch { /* ignore */ }
  go(to || homeFor(a.role));
  return true;
}
/** v477: ?yb_acct=<user> in the address (from a notification) → switch to that saved account, then drop the param. */
export function openNotifiedAccount(loc = typeof window !== "undefined" ? window.location : null, go) {
  if (!loc) return false;
  const q = new URLSearchParams(loc.search || "");
  const acct = q.get("yb_acct");
  if (!acct) return false;
  q.delete("yb_acct");
  const clean = `${loc.pathname}${q.toString() ? `?${q}` : ""}${loc.hash || ""}`;
  try { window.history.replaceState(window.history.state, "", clean); } catch { /* ignore */ }
  const cur = safeJsonParse(safeStorage.getItem("ybex_user"), null);
  if (cur?.user_id === acct || !accountFor(acct)) return false;
  return switchAccount(acct, { to: clean, ...(go ? { go } : {}) });
}

// Runs as the app starts — before the router can redirect and carry ?yb_acct along.
if (typeof window !== "undefined" && /[?&]yb_acct=/.test(window.location?.search || "")) { try { openNotifiedAccount(); } catch { /* ignore */ } }

/** "+ Add account": the current account stays saved; the login page opens for the new one. */
export function startAddAccount({ go = (u) => window.location.replace(u) } = {}) {
  const cur = safeJsonParse(safeStorage.getItem("ybex_user"), null);
  const t = safeStorage.getItem("ybex_token");
  if (cur?.user_id && t) { rememberAccount(cur, t); try { sessionStorage.setItem(ADD_FROM_KEY, cur.user_id); } catch { /* ignore */ } }
  safeStorage.removeItem("ybex_token");
  safeStorage.removeItem("ybex_user");
  clearAccountScratch();
  go("/login");
}
/** On the login page: back to the account you came from, or continue as a saved one. */
function SavedAccountBar() {
  const [path, setPath] = useState(() => (typeof window !== "undefined" ? window.location.pathname : ""));
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    const id = setInterval(on, 800);
    return () => { window.removeEventListener("popstate", on); clearInterval(id); };
  }, []);
  if (!AUTH_PAGES.test(path)) return null;
  let from = null;
  try { from = sessionStorage.getItem(ADD_FROM_KEY); } catch { /* ignore */ }
  const list = savedAccounts();
  const a = (from && list.find((x) => x.user_id === from)) || list[0];
  if (!a) return null;
  const back = Boolean(from && a.user_id === from);
  return (
    <button type="button" onClick={() => switchAccount(a.user_id)} data-testid={back ? "add-account-cancel" : "continue-as-saved"}
      style={{ position: "fixed", left: 12, top: "calc(env(safe-area-inset-top, 0px) + 10px)", zIndex: 2147483646 /* above messages too ("session expired" covered it) */, minHeight: 40, padding: "0 14px", borderRadius: 999, border: "1px solid #E5E5EA", background: "#FFFFFF", color: "#1C1C1E", font: "600 13px 'Quicksand', sans-serif", boxShadow: "0 4px 14px rgba(0,0,0,.08)" }}>
      {back ? `← Back to ${a.name}` : `Continue as ${a.name}`}
    </button>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    return {
      user: null,
      loading: true,
      signup: async () => {},
      login: async () => {},
      logout: async () => {},
      refreshUser: async () => null,
      setUser: () => {},
      kycStatus: null,
      setKycStatus: () => {},
      isKycApproved: false,
      kycLoading: false,
      refreshKycStatus: async () => null,
    };
  }
  return context;
};
