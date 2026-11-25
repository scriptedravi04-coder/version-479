import React from 'react';
// v463: icons now live in ErrorCard (PageErrorBoundary.jsx)
import { isChunkLoadError, recoverFromStaleBuild } from '../lib/staleBuild';
import { ErrorCard, reportProblem } from "./PageErrorBoundary"; // v463

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    try { window.__ybCrashed = true; } catch { /* ignore */ } // v476: a crashed live update is not reported "ready" (lib/native.js)
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });

    // Check if error is a dynamic import, chunk loading, or module version mismatch error
    const errorMsg = (error?.message || String(error || "")).toLowerCase();
    const isChunkError =
      errorMsg.includes("failed to fetch dynamically imported module") ||
      errorMsg.includes("importing a module script failed") ||
      errorMsg.includes("error loading dynamically imported module") ||
      errorMsg.includes("chunkloaderror") ||
      errorMsg.includes("invalid hook call") ||
      errorMsg.includes("reading 'usecontext'") ||
      errorMsg.includes("reading 'usestate'") ||
      errorMsg.includes("reading 'useeffect'") ||
      errorMsg.includes("cannot read properties of null (reading 'usecontext')") ||
      error?.name === "ChunkLoadError";

    // v398: shared recovery — also gets past the service worker's old saved page.
    if (isChunkError || isChunkLoadError(error)) recoverFromStaleBuild();
  }

  handleReset = () => {
    sessionStorage.removeItem("chunk-error-reloaded");
    sessionStorage.removeItem("vite-chunk-reload");
    sessionStorage.removeItem("last_chunk_reload_ts");
    window.location.href = "/";
  };

  handleReload = () => {
    sessionStorage.removeItem("chunk-error-reloaded");
    sessionStorage.removeItem("vite-chunk-reload");
    sessionStorage.removeItem("last_chunk_reload_ts");
    if (isChunkLoadError(this.state.error)) { recoverFromStaleBuild({ force: true }); return; }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const errorMsg = (this.state.error?.message || String(this.state.error || "")).toLowerCase();
      const isDynamicChunkError =
        errorMsg.includes("failed to fetch dynamically imported module") ||
        errorMsg.includes("importing a module script failed") ||
        errorMsg.includes("error loading dynamically imported module") ||
        errorMsg.includes("chunkloaderror") ||
        errorMsg.includes("invalid hook call") ||
        errorMsg.includes("reading 'usecontext'") ||
        errorMsg.includes("reading 'usestate'") ||
        errorMsg.includes("reading 'useeffect'") ||
        errorMsg.includes("cannot read properties of null (reading 'usecontext')") ||
        this.state.error?.name === "ChunkLoadError";

      // v452 (UI audit 42) / v463 (#42, ref 2i): the same card as a single page — app colours, no stack trace.
      return (
        <div className="min-h-screen bg-[#F2F2F7] flex items-center justify-center p-5">
          {isDynamicChunkError ? (
            <ErrorCard title="Getting the latest Ybex…" text="We just shipped an update. Try again to continue." onRetry={this.handleReload} onReport={() => reportProblem(this.state.error)} />
          ) : (
            <ErrorCard onRetry={this.handleReload} onReport={() => reportProblem(this.state.error)} />
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
