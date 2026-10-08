'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

type Mode = 'signin' | 'signup';
type Busy = 'signin' | 'signup' | 'demo' | null;
type Me = { displayName: string; isDemo: boolean } | null;

async function post(path: string, body?: unknown) {
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data;
}

function friendly(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    if (err.name === 'NotAllowedError' || code === 'ERROR_CEREMONY_ABORTED') {
      return 'The passkey prompt was cancelled or timed out. Please try again.';
    }
    if (err.name === 'InvalidStateError' || code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      return 'This device already has a passkey for this account. Try signing in instead.';
    }
    return err.message;
  }
  return 'Something went wrong.';
}

// An honest preview of what the product does today.
function AgentStory() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 5), 2300);
    return () => clearInterval(id);
  }, []);

  const show = (from: number, to = 4) => (step >= from && step < to ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3');

  return (
    <div className="w-full max-w-sm space-y-3 text-sm">
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-white px-4 py-2 text-[#003087] shadow-lg">
        Send 25 dollars to Ravi for the website work
      </div>

      <div className={`transition-all duration-500 ${show(1)}`}>
        <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-white/15 px-4 py-2 text-white backdrop-blur">
          I prepared this payment. It needs your approval.
        </div>
        <div className="mt-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-slate-800 shadow-lg">
          <div className="text-xs text-slate-500">Send payment to Ravi</div>
          <div className="text-3xl font-bold text-[#003087]">$25.00</div>
          <div
            className={`mt-3 inline-block rounded-xl px-4 py-1.5 text-xs font-semibold text-white transition-all ${
              step === 1 ? 'animate-pulse bg-[#003087]' : 'bg-[#003087]'
            }`}
          >
            Approve
          </div>
        </div>
      </div>

      <div className={`transition-all duration-500 ${show(2)}`}>
        <div className="w-fit rounded-2xl bg-green-500/90 px-4 py-2 font-medium text-white shadow-lg">
          ✅ Approved and sent
        </div>
      </div>

      <div className={`transition-all duration-500 ${show(3)}`}>
        <div className="w-fit rounded-2xl bg-white/15 px-4 py-2 text-white backdrop-blur">
          📋 Logged in your audit trail
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.user) setMe(data.user);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function ensureSupport(): boolean {
    if (!browserSupportsWebAuthn()) {
      setError('This browser does not support passkeys. Try Chrome, Edge, or Safari.');
      return false;
    }
    return true;
  }

  async function signIn() {
    setError(null);
    if (!ensureSupport()) return;
    setBusy('signin');
    try {
      const options = await post('login-options');
      const assertion = await startAuthentication({ optionsJSON: options });
      await post('login-verify', assertion);
      router.push('/');
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }

  async function signUp() {
    setError(null);
    if (!ensureSupport()) return;
    setBusy('signup');
    try {
      const options = await post('register-options', { email, displayName: name });
      const attestation = await startRegistration({ optionsJSON: options });
      await post('register-verify', attestation);
      router.push('/');
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }

  async function tryDemo() {
    setError(null);
    setBusy('demo');
    try {
      await post('demo');
      router.push('/');
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    await post('logout');
    setMe(null);
  }

  return (
    <div className="grid min-h-dvh bg-slate-50 text-slate-900 lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#003087] via-[#0a4ab5] to-[#009cde] p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-xl font-bold backdrop-blur">
            P
          </div>
          <div className="text-lg font-semibold">Smart Payments Agent</div>
        </div>

        <div className="flex flex-1 flex-col items-start justify-center gap-8">
          <div>
            <h1 className="max-w-md text-4xl font-bold leading-tight">
              Say what you want paid. Stay in control.
            </h1>
            <p className="mt-3 max-w-md text-white/80">
              An AI agent that prepares your PayPal payments and invoices. You approve, or your own
              rules do.
            </p>
          </div>
          <AgentStory />
        </div>

        <ul className="space-y-1 text-sm text-white/80">
          <li>🔐 Passkey sign-in: no password to steal</li>
          <li>🛡️ Spending limits enforced by the server, not the AI</li>
          <li>📋 Every action logged</li>
        </ul>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#003087] to-[#009cde] text-xl font-bold text-white">
              P
            </div>
            <div className="text-lg font-semibold">Smart Payments Agent</div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
            {me ? (
              <div>
                <h2 className="text-xl font-bold">Welcome back, {me.displayName}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {me.isDemo ? 'You are in demo mode.' : 'You are signed in.'}
                </p>
                <div className="mt-5 flex gap-2">
                  <button
                    onClick={() => router.push('/')}
                    className="h-11 flex-1 rounded-xl bg-[#003087] text-sm font-semibold text-white transition hover:bg-[#00257a]"
                  >
                    Continue to the app
                  </button>
                  <button
                    onClick={() => void signOut()}
                    className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
                  {(['signin', 'signup'] as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMode(m);
                        setError(null);
                      }}
                      className={`rounded-lg py-2 transition ${
                        mode === m ? 'bg-white text-[#003087] shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      {m === 'signin' ? 'Sign in' : 'Create account'}
                    </button>
                  ))}
                </div>

                {mode === 'signin' ? (
                  <div>
                    <h2 className="text-xl font-bold">Welcome back</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Use Touch ID, Face ID, or your device PIN. No password needed.
                    </p>
                    <button
                      onClick={() => void signIn()}
                      disabled={busy !== null}
                      className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#003087] text-sm font-semibold text-white transition hover:bg-[#00257a] active:scale-[0.99] disabled:opacity-50"
                    >
                      <span aria-hidden>🔐</span>
                      {busy === 'signin' ? 'Waiting for your passkey…' : 'Sign in with passkey'}
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void signUp();
                    }}
                  >
                    <h2 className="text-xl font-bold">Create your account</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Your device creates a passkey. There is no password to remember or leak.
                    </p>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="mt-4 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#009cde] focus:ring-2 focus:ring-[#009cde]/30"
                    />
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="Email"
                      className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#009cde] focus:ring-2 focus:ring-[#009cde]/30"
                    />
                    <button
                      type="submit"
                      disabled={busy !== null || !email.trim()}
                      className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#003087] text-sm font-semibold text-white transition hover:bg-[#00257a] active:scale-[0.99] disabled:opacity-50"
                    >
                      <span aria-hidden>🔐</span>
                      {busy === 'signup' ? 'Waiting for your passkey…' : 'Create account with passkey'}
                    </button>
                  </form>
                )}

                {error && (
                  <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
                )}

                <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" /> or <div className="h-px flex-1 bg-slate-200" />
                </div>

                <button
                  onClick={() => void tryDemo()}
                  disabled={busy !== null}
                  className="h-11 w-full rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 transition hover:border-[#009cde] hover:text-[#003087] disabled:opacity-50"
                >
                  {busy === 'demo' ? 'Starting demo…' : '✨ Try the demo, no sign-up'}
                </button>
              </>
            )}
          </div>

          <p className="mt-4 text-center text-xs text-slate-400">
            PayPal sandbox only. No real money moves.
          </p>
        </div>
      </section>
    </div>
  );
}