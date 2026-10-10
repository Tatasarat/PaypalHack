'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Info = {
  requester: string;
  amount: string;
  currency: string;
  note: string;
  status: string;
  simulated: boolean;
  clientId: string;
  sdkUrl: string;
};

type PaymentSession = {
  start: (options: { presentationMode: string }, order: Promise<{ orderId: string }>) => Promise<void>;
};

type SdkInstance = {
  createPayPalOneTimePaymentSession: (options: {
    onApprove: (data: { orderId: string }) => Promise<void> | void;
    onCancel?: () => void;
    onError?: (error: unknown) => void;
  }) => PaymentSession;
};

type PayPalNamespace = {
  createInstance: (options: {
    clientId: string;
    components: string[];
    pageType: string;
  }) => Promise<SdkInstance>;
};

const getPayPal = () => (window as unknown as { paypal?: PayPalNamespace }).paypal;

// Loads PayPal's browser SDK once, then waits until it is ready.
async function loadPayPal(sdkUrl: string): Promise<PayPalNamespace> {
  const existing = getPayPal();
  if (existing) return existing;

  if (!document.querySelector(`script[src="${sdkUrl}"]`)) {
    const script = document.createElement('script');
    script.src = sdkUrl;
    script.async = true;
    document.head.appendChild(script);
  }

  for (let i = 0; i < 100; i++) {
    const found = getPayPal();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Could not load PayPal. Check your connection and try again.');
}

export default function PayPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const buttonHost = useRef<HTMLDivElement>(null);

  // Load the request details.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pay/${token}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data) setLoadError(data?.error ?? 'Could not load this payment request.');
        else setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not reach the server.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Set up the PayPal button for real (non-demo) open requests.
  useEffect(() => {
    if (!info || info.status !== 'OPEN' || info.simulated) return;

    let cancelled = false;
    let button: HTMLElement | null = null;

    async function createOrder(): Promise<{ orderId: string }> {
      const res = await fetch(`/api/pay/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'order' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.orderId) throw new Error(data.error ?? 'Could not start the payment.');
      return { orderId: data.orderId as string };
    }

    async function setup(current: Info) {
      try {
        const paypal = await loadPayPal(current.sdkUrl);
        const sdk = await paypal.createInstance({
          clientId: current.clientId,
          components: ['paypal-payments'],
          pageType: 'checkout',
        });
        if (cancelled || !buttonHost.current) return;

        button = document.createElement('paypal-button');
        button.addEventListener('click', async () => {
          setMessage(null);
          const session = sdk.createPayPalOneTimePaymentSession({
            onApprove: async (data) => {
              setBusy(true);
              const res = await fetch(`/api/pay/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'capture', orderId: data.orderId }),
              });
              const result = await res.json().catch(() => ({}));
              setBusy(false);

              if (res.ok && result.status === 'COMPLETED') setPaid(true);
              else setMessage(result.error ?? `Payment status: ${result.status ?? 'unknown'}`);
            },
            onCancel: () => setMessage('Payment cancelled. You can try again.'),
            onError: () => setMessage('Something went wrong with PayPal. Please try again.'),
          });

          try {
            await session.start({ presentationMode: 'auto' }, createOrder());
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Could not start the payment.');
          }
        });

        buttonHost.current.appendChild(button);
      } catch (e) {
        if (!cancelled) setMessage(e instanceof Error ? e.message : 'Could not load PayPal.');
      }
    }

    void setup(info);

    return () => {
      cancelled = true;
      button?.remove();
    };
  }, [info, token]);

  async function simulate() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/pay/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'simulate' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === 'COMPLETED') setPaid(true);
      else setMessage(data.error ?? 'Could not complete the demo payment.');
    } catch {
      setMessage('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const isPaid = paid || info?.status === 'PAID';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-4 text-slate-900">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div className="bg-gradient-to-br from-[#003087] to-[#009cde] px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 text-lg font-bold">
              P
            </div>
            <div className="text-sm font-semibold">Smart Payments Agent</div>
          </div>
          <div className="mt-3 inline-block rounded-full bg-amber-300/90 px-3 py-0.5 text-xs font-semibold text-amber-950">
            Sandbox · test payment, no real money
          </div>
        </div>

        <div className="px-6 py-6">
          {loadError && <div className="text-center text-sm text-red-700">{loadError}</div>}

          {!info && !loadError && (
            <div className="text-center text-sm text-slate-500">Loading payment request…</div>
          )}

          {info && (
            <>
              <div className="text-sm text-slate-500">Payment request from</div>
              <div className="text-lg font-semibold">{info.requester}</div>

              <div className="mt-4 text-5xl font-bold text-[#003087]">${info.amount}</div>
              <div className="text-xs text-slate-500">{info.currency}</div>

              {info.note && (
                <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {info.note}
                </div>
              )}

              <div className="mt-6">
                {isPaid ? (
                  <div className="rounded-2xl bg-green-50 px-4 py-4 text-center text-green-800">
                    <div className="text-2xl">✅</div>
                    <div className="mt-1 font-semibold">Paid. Thank you!</div>
                    <div className="text-xs">You can close this page.</div>
                  </div>
                ) : info.status === 'EXPIRED' ? (
                  <div className="rounded-2xl bg-slate-100 px-4 py-4 text-center text-sm text-slate-600">
                    This payment link has expired. Ask {info.requester} for a new one.
                  </div>
                ) : info.status !== 'OPEN' ? (
                  <div className="rounded-2xl bg-slate-100 px-4 py-4 text-center text-sm text-slate-600">
                    This request is no longer open.
                  </div>
                ) : info.simulated ? (
                  <div>
                    <button
                      onClick={() => void simulate()}
                      disabled={busy}
                      className="h-12 w-full rounded-xl bg-[#003087] text-sm font-semibold text-white transition hover:bg-[#00257a] disabled:opacity-50"
                    >
                      {busy ? 'Working…' : 'Simulate payment (demo)'}
                    </button>
                    <div className="mt-2 text-center text-xs text-slate-500">
                      This is a demo request. No PayPal call is made.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div ref={buttonHost} className="min-h-12" />
                    {busy && (
                      <div className="mt-2 text-center text-sm text-slate-500">Finishing payment…</div>
                    )}
                    <div className="mt-3 text-center text-xs text-slate-500">
                      Pay with a PayPal <strong>sandbox buyer account</strong> from the PayPal
                      Developer Dashboard.
                    </div>
                  </div>
                )}

                {message && (
                  <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
                    {message}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}