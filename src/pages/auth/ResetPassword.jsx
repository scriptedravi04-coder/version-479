import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, Eye, EyeOff } from 'lucide-react';
import { api } from '../../lib/api';

export default function ResetPassword() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  
  const navigate = useNavigate();
  const location = useLocation();
  // v425 (A2): resend the code, with a 30s wait between tries.
  const [cooldown, setCooldown] = useState(30);
  const [resendNote, setResendNote] = useState('');
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const resend = async () => {
    if (!email || cooldown > 0) return;
    setCooldown(30);
    setResendNote('');
    try {
      await api.post('auth/forgot-password', { email });
      setResendNote('New code sent.');
    } catch (err) {
      setResendNote(err.response?.data?.detail || "Couldn't send a new code. Try again.");
    }
  };
  const longEnough = newPassword.length >= 8;
  const matches = confirmPassword.length > 0 && newPassword === confirmPassword;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('email')) {
      setEmail(params.get('email'));
    }
  }, [location]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !otp || !newPassword || !confirmPassword) return;

    if (newPassword.length < 8) {
      setStatus('error');
      setMessage('Password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus('error');
      setMessage('Passwords do not match.');
      return;
    }

    setStatus('loading');
    setMessage('');

    try {
      const response = await api.post('auth/reset-password', { email, otp, newPassword });
      const data = response.data;
      
      if (data.success) {
        setStatus('success');
        setMessage(data.message);
        setTimeout(() => navigate('/login'), 2000);
      } else {
        setStatus('error');
        setMessage(data.detail || 'Failed to reset password.');
      }
    } catch (err) {
      setStatus('error');
      // v332: no raw tech text ("Network Error") on screen
      setMessage(err.response?.data?.detail || (err.response ? 'Something went wrong. Please try again.' : "Couldn't reach Ybex. Check your internet and try again."));
    }
  };

  // v463 (#26, ref 2i): same plain column as Forgot password — app colours, ← back, labelled fields, one violet button.
  return (
    <div className="min-h-screen bg-[#F2F2F7] font-['DM_Sans',sans-serif]">
        <div className="w-full max-w-[420px] mx-auto px-5 pt-[calc(24px+var(--yb-flow-top,0px))] pb-10">
          <Link to="/login" aria-label="Back to log in" className="inline-flex items-center justify-center w-10 h-10 -ml-2 mb-4 rounded-full text-[#0A0A0A] hover:bg-black/5 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <h1 className="text-[26px] font-bold text-[#0A0A0A] tracking-[-0.4px]">Set new password</h1>
          {/* v332: was developer text ("Check your console/email") */}
          <p className="mt-1 mb-6 text-[14px] text-[#5F6672]">Enter the 6-digit code we emailed you, then choose a new password.</p>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            {status === 'error' && (
              <div className="yb-reveal p-3 bg-red-50 rounded-[12px] text-red-700 text-[13px] font-medium" role="alert">
                {message}
              </div>
            )}
            
            {status === 'success' && (
              <div className="yb-reveal p-3 bg-emerald-50 rounded-[12px] text-emerald-800 text-[13px] font-medium">
                {message} Redirecting...
              </div>
            )}

            <div>
              <label className="text-[14px] font-semibold text-[#0A0A0A] mb-1.5 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-[52px] bg-white border border-[#E5E5EA] focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15 rounded-[14px] px-4 text-base text-[#0A0A0A] outline-none transition-all"
                required
                disabled={status === 'loading' || status === 'success'}
              />
            </div>

            <div>
              <label className="text-[14px] font-semibold text-[#0A0A0A] mb-1.5 block">6-digit code</label>
              <input
                type="text"
                inputMode="numeric" /* v330: number pad + SMS/email code autofill on phones */
                autoComplete="one-time-code" autoFocus /* v479 (iOS QA #30): code box ready the moment it shows */
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                className="w-full h-[52px] bg-white border border-[#E5E5EA] focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15 rounded-[14px] px-4 text-base text-[#0A0A0A] outline-none transition-all tracking-widest"
                required
                disabled={status === 'loading' || status === 'success'}
              />
              <div className="mt-1.5 flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)]">{resendNote}</span>
                <button type="button" onClick={resend} disabled={cooldown > 0 || !email || status === 'success'} data-testid="reset-resend"
                  className="min-h-[44px] px-1 font-semibold text-[#7C3AED] disabled:text-[#9A9AA3]">
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[14px] font-semibold text-[#0A0A0A] mb-1.5 block">New password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-[52px] bg-white border border-[#E5E5EA] focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15 rounded-[14px] px-4 pr-12 text-base text-[#0A0A0A] placeholder:text-[#9A9AA3] outline-none transition-all"
                  required
                  disabled={status === 'loading' || status === 'success'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"} /* v330 */
                  className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4 sm:w-5 sm:h-5" /> : <Eye className="w-4 h-4 sm:w-5 sm:h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[14px] font-semibold text-[#0A0A0A] mb-1.5 block">Confirm password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password" /* v332 */
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-[52px] bg-white border border-[#E5E5EA] focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/15 rounded-[14px] px-4 pr-12 text-base text-[#0A0A0A] placeholder:text-[#9A9AA3] outline-none transition-all"
                  required
                  disabled={status === 'loading' || status === 'success'}
                />
              </div>
              {(newPassword || confirmPassword) && ( /* v425 (A3): live checks */
                <ul className="mt-2 space-y-1 text-xs font-semibold" data-testid="reset-checks">
                  <li className={longEnough ? 'text-emerald-600' : 'text-[var(--text-tertiary)]'}>{longEnough ? '✓' : '○'} 8+ characters</li>
                  <li className={matches ? 'text-emerald-600' : 'text-[var(--text-tertiary)]'}>{matches ? '✓' : '○'} Both match</li>
                </ul>
              )}
            </div>

            <button
              type="submit"
              disabled={status === 'loading' || status === 'success' || !email || !otp || !newPassword || !confirmPassword}
              className="w-full h-[52px] bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60 text-white text-[15px] font-semibold rounded-[14px] transition-colors flex items-center justify-center"
            >
              {status === 'loading' ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Saving…</>
              ) : (
                'Save new password'
              )}
            </button>
          </form>
        </div>
    </div>
  );
}
