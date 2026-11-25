import React from "react";
import { isChunkLoadError, recoverFromStaleBuild } from "../lib/staleBuild";

// Wraps ONE page. The app already has a top-level ErrorBoundary in index.jsx, but that one
// sits above everything — so any render error on any single screen replaces the entire
// application with an error page. Navigation is gone, the inbox is gone, the header is
// gone, and the only way out is a full reload.
//
// This boundary keeps the blast radius to the page that actually broke. The shell, the nav
// and every other route keep working, and the user can simply click somewhere else.
//
// It does not prevent crashes — it contains them. The fix for an actual crash still belongs
// in the page. Check the console for the component stack this logs.

/** v463 (#42, ref 2i): the app's one "page didn't load" card. */
export function ErrorCard({ onRetry, onReport, title = "This page didn't load", text = "Try again. If it keeps happening, tell us and we'll fix it." }) {
  return (
    <div className="bg-white rounded-[22px] w-full max-w-[360px] p-6 text-center font-['DM_Sans',sans-serif]" role="alert" data-testid="error-card">
      <div className="w-12 h-12 rounded-[14px] bg-[#F2F2F7] text-[#0A0A0A] mx-auto flex items-center justify-center" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 21v-5h5" /></svg>
      </div>
      <h2 className="mt-4 text-[18px] font-bold text-[#0A0A0A]">{title}</h2>
      <p className="mt-1.5 text-[14px] leading-[1.45] text-[#5F6672]">{text}</p>
      <div className="mt-5 flex gap-2.5">
        <button type="button" onClick={onReport} className="flex-1 h-12 rounded-[14px] bg-white border border-[#E5E5EA] text-[#0A0A0A] text-[15px] font-semibold hover:bg-[#F7F7FA] transition-colors" data-testid="error-report">Report</button>
        <button type="button" onClick={onRetry} className="flex-1 h-12 rounded-[14px] bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-[15px] font-semibold transition-colors" data-testid="error-retry">Try again</button>
      </div>
    </div>
  );
}

/** v463: "Report" — opens Eva (help chat) when it's on screen, else an email to support with the error line. */
export function reportProblem(error) {
  try {
    if (typeof document !== "undefined" && document.querySelector("[data-testid='feedback-bot']")) {
      window.dispatchEvent(new Event("ybex:open-eva"));
      return;
    }
  } catch { /* fall back to email */ }
  const line = `${String(error?.name || "Error").slice(0, 30)}: ${String(error?.message || "").replace(/\s+/g, " ").slice(0, 200)}`;
  const page = typeof window !== "undefined" ? window.location.pathname : "";
  try { window.location.href = `mailto:support@ybexmedia.in?subject=${encodeURIComponent("Page didn't load")}&body=${encodeURIComponent(`Page: ${page}\n${line}`)}`; } catch { /* ignore */ }
}

class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[PageErrorBoundary] page crashed:", error, errorInfo?.componentStack);
    // v398: a screen file from an older version (after a deploy) → move to the new version by itself.
    if (isChunkLoadError(error) && recoverFromStaleBuild()) this.setState({ updating: true });
  }

  componentDidUpdate(prevProps) {
    // A new route should get a clean slate, otherwise the error screen sticks around
    // after the user navigates away from the broken page.
    if (prevProps.routeKey !== this.props.routeKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleRetry = () => {
    if (isChunkLoadError(this.state.error)) { this.setState({ updating: true }); recoverFromStaleBuild({ force: true }); return; }
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    if (isChunkLoadError(this.state.error)) { this.setState({ updating: true }); recoverFromStaleBuild({ force: true }); return; }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.error?.message || "Something went wrong on this page.";

    // v398: a new version of Ybex is live — calm "updating" screen instead of an error.
    if (this.state.updating || isChunkLoadError(this.state.error)) {
      return (
        <div className="flex flex-col items-center justify-center text-center px-6 py-20 gap-4" data-testid="page-updating">
          <div className="w-10 h-10 rounded-full border-[3px] border-[var(--violet)]/25 border-t-[var(--violet)] animate-spin" aria-hidden="true" />
          <div className="space-y-1.5 max-w-md">
            <h2 className="text-base font-bold text-[var(--text-primary)]">Getting the latest Ybex…</h2>
            <p className="text-sm text-[var(--text-secondary)]">We just shipped an update. This takes a second.</p>
          </div>
          <button type="button" onClick={this.handleReload} className="px-4 py-2.5 rounded-xl text-xs font-bold bg-[var(--violet)] text-white hover:opacity-90 transition-opacity">
            Load it now
          </button>
        </div>
      );
    }

    // v463 (#42, ref 2i): ONE error card for the whole app (same as the outer ErrorBoundary). "Report" opens Eva
    // (help chat) so the person can tell us; "Try again" re-draws the page.
    return (
      <div className="flex flex-col items-center justify-center px-5 py-16 gap-3">
        <ErrorCard onRetry={this.handleRetry} onReport={() => reportProblem(this.state.error)} />
        {/* v386 (Ravi 30 Oct: Earnings / Inbox / Settings showed this page with no clue why): one short grey line with the
            error name + message, so a screenshot is enough to find the cause. No stack, no data. */}
        {!import.meta.env?.DEV && (
          <p className="text-[10px] text-[var(--text-tertiary)] max-w-sm break-words" data-testid="page-error-code">
            code: {String(this.state.error?.name || "Error").slice(0, 30)} · {String(message).replace(/\s+/g, " ").slice(0, 140)}
          </p>
        )}
        {import.meta.env?.DEV && (
          <pre className="mt-3 max-w-lg overflow-x-auto text-left text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-xl p-3">
            {message}
          </pre>
        )}
      </div>
    );
  }
}

export default PageErrorBoundary;
