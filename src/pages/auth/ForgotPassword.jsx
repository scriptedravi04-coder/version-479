import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';

export default function ForgotPassword() {
  // Session 58: the login page's "Forgot password?" link passes ?email= — fill it in.
  const [email, setEmail] = useState(() => { try { return new URLSearchParams(window.location.search).get('email') || ''; } catch { return ''; } });
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [message, setMessage] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;

    setStatus('loading');
    setMessage('');

    try {
      const response = await api.post('auth/forgot-password', { email });
      const data = response.data;
      if (data.success) {
        setStatus('success');
        setMessage(data.message);
        // v425 (A1): no auto-jump after 2s — the person may still be reading. They tap "Enter code".
      } else {
        setStatus('error');
        setMessage(data.detail || 'Failed to send reset link.');
      }
    } catch (err) {
      setStatus('error');
      // v332: no raw tech text ("Network Error") on screen
      setMessage(err.response?.data?.detail || (err.response ? 'Something went wrong. Please try again.' : "Couldn't reach Ybex. Check your internet and try again."));
    }
  };

  // v463 (#26, ref 2i): one plain column in the app's own colours — ← back, heading, one field, one violet button.
  return (
    <div className="min-h-screen bg-[#F2F2F7] font-['DM_Sans',sans-serif]">
      <div className="w-full max-w-[420px] mx-auto px-5 pt-[calc(24px+var(--yb-flow-top,0px))] pb-10">
        <Link to="/login" aria-label="Back to log in" className="inline-flex items-center justify-center w-10 h-10 -ml-2 rounded-full text-[#0A0A0A] hover:bg-black/5 transition-colors" data-testid="forgot-back">
          <ArrowLeft className="w-5 h-5" />
        </Link>

        <h1 className="mt-4 text-[26px] font-bold text-[#0A0A0A] tracking-[-0.4px]">Reset password</h1>
        <p className="mt-1 text-[14px] text-[#5F6672]">We'll email you a 6-digit code to set a new one.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {status === 'error' && (
            <div className="yb-reveal p-3 bg-red-50 rounded-[12px] text-red-700 text-[13px] font-medium" role="alert">
              {message}
            </div>
          )}

          {status === 'success' && (
            <div className="yb-reveal p-3 bg-emerald-50 rounded-[12px] text-emerald-800 text-[13px] font-medium">
              <div>We sent a 6-digit code to <b>{email}</b>.</div>
              <button type="button" data-testid="forgot-enter-code" onClick={() => navigate('/reset-password?email=' + encodeURIComponent(email))}
                className="mt-3 w-full h-11 rounded-[12px] bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors">Enter code</button>
            </div>
          )}

          <div>
            <label htmlFor="forgot-email" className="text-[14px] font-semibold text-[#0A0A0A] mb-1.5 block">Email</label>
            <input
              id="forgot-email"
              type="email"
              autoComplete="email" /* v330: 16px input text on phones (was 14px) */
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@brand.com"
              className="w-full h-[52px] bg-white border border-[#E5E5EA] focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15 rounded-[14px] px-4 text-base text-[#0A0A0A] placeholder:text-[#9A9AA3] outline-none transition"
              required
              disabled={status === 'loading' || status === 'success'}
            />
          </div>

          <button
            type="submit"
            disabled={status === 'loading' || status === 'success' || !email}
            className="w-full h-[52px] bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white text-[15px] font-semibold rounded-[14px] transition-colors flex items-center justify-center"
          >
            {status === 'loading' ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending…</>
            ) : (
              'Send reset code'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
