import React, { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@mui/material';
import { X as CloseIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Props {
  open: boolean;
  onClose: () => void;
  redirectTo?: string;
}

const SITE_URL = import.meta.env.VITE_SITE_URL || window.location.origin;

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}

const AuthModal: React.FC<Props> = ({ open, onClose, redirectTo = '/dashboard' }) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [method, setMethod] = useState<'magic' | 'password'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rootEl = useMemo(
    () => (typeof document !== 'undefined' ? document.getElementById('root') : null),
    [],
  );

  const resetFeedback = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);

  const authDisabledMessage =
    'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to web/.env (then restart npm run dev) to sign in locally. You can still use this screen to review the layout.';

  const handleMagicLink = async () => {
    if (!supabase) {
      resetFeedback();
      setError(authDisabledMessage);
      return;
    }
    setLoading(true);
    resetFeedback();
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${SITE_URL}${redirectTo}` },
    });
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setMessage('Check your email for the magic link. Following it will sign you in and unlock Free access.');
    }
  };

  const handlePasswordAuth = async () => {
    if (!supabase) {
      resetFeedback();
      setError(authDisabledMessage);
      return;
    }
    setLoading(true);
    resetFeedback();

    if (tab === 'register') {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${SITE_URL}${redirectTo}` },
      });
      setLoading(false);
      if (err) {
        setError(err.message);
      } else {
        setMessage('Check your email to confirm your account before Free access is enabled.');
      }
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setLoading(false);
      if (err) {
        setError(err.message);
      } else {
        onClose();
      }
    }
  };

  const handleForgotPassword = async () => {
    if (!supabase) {
      resetFeedback();
      setError(authDisabledMessage);
      return;
    }
    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setLoading(true);
    resetFeedback();
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${SITE_URL}/profile`,
    });
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setMessage('Check your email for a link to reset your access key.');
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    if (!supabase) {
      resetFeedback();
      setError(authDisabledMessage);
      return;
    }
    resetFeedback();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${SITE_URL}${redirectTo}` },
    });
    if (err) setError(err.message);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (method === 'magic') {
      handleMagicLink();
    } else {
      handlePasswordAuth();
    }
  };

  const submitDisabled =
    loading ||
    !email.trim() ||
    (method === 'password' && (!password.trim() || password.length < 8));

  const primaryLabel = loading
    ? 'Please wait…'
    : method === 'magic'
      ? 'Send magic link'
      : tab === 'register'
        ? 'Create account'
        : 'Sign in';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      container={rootEl ?? undefined}
      aria-labelledby="auth-modal-title"
      PaperProps={{
        elevation: 0,
        className:
          'm-0 w-full max-w-md overflow-visible rounded-none bg-transparent p-0 shadow-none font-body text-on-background antialiased selection:bg-primary/30',
      }}
      BackdropProps={{
        className: 'bg-surface-container-lowest/80 backdrop-blur-sm',
      }}
    >
      <div className="relative w-full overflow-hidden rounded-xl border border-primary-container/30 bg-[rgba(20,27,43,0.8)] shadow-2xl shadow-black/40 backdrop-blur-[24px] [-webkit-backdrop-filter:blur(24px)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary-container to-transparent opacity-60" />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high/60 hover:text-on-surface"
          aria-label="Close"
        >
          <CloseIcon size={18} strokeWidth={2} />
        </button>

        <div className="p-8 md:p-10">
          <h2 id="auth-modal-title" className="sr-only">
            {tab === 'login' ? 'Sign in to CoinStrat' : 'Create a CoinStrat account'}
          </h2>

          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-2 font-headline text-3xl font-black tracking-tighter text-white">
              CoinStrat
            </div>
          </div>

          {!supabase && (
            <div
              className="mb-6 rounded-lg border border-primary-container/25 bg-primary-container/10 px-3 py-2.5 text-left text-xs leading-relaxed text-on-surface-variant"
              role="status"
            >
              <span className="font-headline font-semibold text-primary">Local design preview</span>
              {' — '}
              Supabase env vars are not set
            </div>
          )}

          <div className="mb-8 flex border-b border-outline-variant/20">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                resetFeedback();
              }}
              className={clsx(
                'flex-1 py-3 font-headline text-sm font-semibold transition-colors',
                tab === 'login'
                  ? 'border-b-2 border-primary-container text-primary'
                  : 'border-b-2 border-transparent text-on-surface-variant hover:text-on-surface',
              )}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                resetFeedback();
              }}
              className={clsx(
                'flex-1 py-3 font-headline text-sm font-semibold transition-colors',
                tab === 'register'
                  ? 'border-b-2 border-primary-container text-primary'
                  : 'border-b-2 border-transparent text-on-surface-variant hover:text-on-surface',
              )}
            >
              Register
            </button>
          </div>

          <div className="mb-8 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleOAuth('google')}
              className="flex items-center justify-center gap-3 rounded-lg border border-outline-variant/10 bg-surface-container-low py-2.5 px-4 text-sm font-medium text-on-surface transition-all hover:bg-surface-container-high active:scale-[0.98]"
            >
              <img src="/auth/google-g.png" alt="" className="h-5 w-5" width={20} height={20} />
              <span>Google</span>
            </button>
            <button
              type="button"
              onClick={() => handleOAuth('github')}
              className="flex items-center justify-center gap-3 rounded-lg border border-outline-variant/10 bg-surface-container-low py-2.5 px-4 text-sm font-medium text-on-surface transition-all hover:bg-surface-container-high active:scale-[0.98]"
            >
              <GitHubMark className="h-5 w-5 text-white" />
              <span>GitHub</span>
            </button>
          </div>

          <div className="relative mb-8 flex items-center">
            <div className="flex-grow border-t border-outline-variant/10" />
            <span className="mx-4 flex-shrink font-label text-[10px] font-bold uppercase tracking-[0.2em] text-outline">
              or with email
            </span>
            <div className="flex-grow border-t border-outline-variant/10" />
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label
                className="block font-label text-xs font-bold uppercase tracking-widest text-outline"
                htmlFor="auth-email"
              >
                Email
              </label>
              <div className="group relative">
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@firm.com"
                  required
                  className="w-full rounded-lg border border-transparent bg-surface-container-lowest px-4 py-3 text-on-surface outline-none transition-all placeholder:text-outline/40 focus:border-primary-container/40 focus:ring-0"
                />
                <div className="pointer-events-none absolute inset-0 rounded-lg border border-outline-variant/5 transition-colors group-hover:border-outline-variant/20" />
              </div>
            </div>

            {method === 'password' && (
              <div className="space-y-2">
                <div className="flex items-end justify-between gap-2">
                  <label
                    className="block font-label text-xs font-bold uppercase tracking-widest text-outline"
                    htmlFor="auth-password"
                  >
                    Password
                  </label>
                  {tab === 'login' && (
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={loading}
                      className="text-[11px] font-bold uppercase tracking-wider text-primary transition-colors hover:text-on-primary-container disabled:opacity-50"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="group relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    className="w-full rounded-lg border border-transparent bg-surface-container-lowest py-3 pl-4 pr-12 text-on-surface outline-none transition-all placeholder:text-outline/40 focus:border-primary-container/40 focus:ring-0"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outline transition-colors hover:text-on-surface"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <span className="material-symbols-outlined text-xl">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                  <div className="pointer-events-none absolute inset-0 rounded-lg border border-outline-variant/5 transition-colors group-hover:border-outline-variant/20" />
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                {error}
              </p>
            )}
            {message && (
              <p className="rounded-lg border border-secondary/25 bg-secondary/10 px-3 py-2 text-sm text-on-surface">
                {message}
              </p>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitDisabled}
                className="w-full rounded-lg bg-gradient-to-r from-primary-container to-inverse-primary py-3.5 font-headline text-sm font-bold tracking-tight text-white shadow-lg shadow-primary-container/20 transition-all hover:shadow-primary-container/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {primaryLabel}
              </button>
            </div>

            <div className="text-center">
              {method === 'password' ? (
                <button
                  type="button"
                  onClick={() => {
                    setMethod('magic');
                    resetFeedback();
                  }}
                  className="text-xs font-medium text-on-surface-variant transition-colors hover:text-primary"
                >
                  Send a magic link instead
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMethod('password');
                    resetFeedback();
                  }}
                  className="text-xs font-medium text-on-surface-variant transition-colors hover:text-primary"
                >
                  Use password instead
                </button>
              )}
            </div>
          </form>

          <div className="mt-0 border-t border-outline-variant/10 pt-6 text-center">
            <p className="px-4 font-label text-[11px] leading-relaxed text-outline">
              By signing in, you agree to {' '}
              <a
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="text-on-surface-variant underline decoration-primary/30 underline-offset-4 transition-colors hover:text-white"
              >
                Terms of Service
              </a>{' '}
              and{' '}
              <a
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                className="text-on-surface-variant underline decoration-primary/30 underline-offset-4 transition-colors hover:text-white"
              >
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default AuthModal;
