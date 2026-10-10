'use client';

import { useEffect, useState } from 'react';
import { speak } from '@/hooks/useVoice';

export type PendingAction = {
  id: string;
  toolName: string;
  args: unknown;
  createdAt: number;
};

export type ActionState = 'verifying' | 'working' | 'approved' | 'rejected' | 'failed';

export type AutoAction = {
  id: string;
  toolName: string;
  summary: string;
  ok: boolean;
  link?: string;
};

type Props = {
  action: PendingAction;
  state?: ActionState;
  demo?: boolean;
  onApprove: () => void;
  onReject: () => void;
};

type Summary = {
  to?: string;
  total?: string;
  items: { name: string; line: string }[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Finds the first value stored under `key` anywhere inside nested objects/arrays.
function deepFind(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = deepFind(entry, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const rec = asRecord(value);
  if (!rec) return undefined;
  if (key in rec) return rec[key];
  for (const entry of Object.values(rec)) {
    const found = deepFind(entry, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Best-effort friendly summary for invoices. If the shape is unexpected, we show less.
function summarize(args: unknown): Summary {
  const email = deepFind(args, 'email_address');
  const currency = deepFind(args, 'currency_code');
  const rawItems = deepFind(args, 'items');

  const items: Summary['items'] = [];
  let total = 0;
  let totalValid = false;

  if (Array.isArray(rawItems)) {
    totalValid = rawItems.length > 0;
    for (const entry of rawItems) {
      const rec = asRecord(entry) ?? {};
      const unit = asRecord(rec.unit_amount);
      const qty = Number(rec.quantity ?? 1) || 1;
      const value = Number(unit?.value);
      const unitCurrency = unit?.currency_code;
      const cur =
        typeof unitCurrency === 'string'
          ? unitCurrency
          : typeof currency === 'string'
            ? currency
            : '';
      const name = String(rec.name ?? 'Item');

      if (Number.isFinite(value)) {
        total += qty * value;
        items.push({ name, line: `${qty} × ${value.toFixed(2)} ${cur}`.trim() });
      } else {
        totalValid = false;
        items.push({ name, line: '' });
      }
    }
  }

  return {
    to: typeof email === 'string' ? email : undefined,
    total: totalValid
      ? `${total.toFixed(2)} ${typeof currency === 'string' ? currency : ''}`.trim()
      : undefined,
    items,
  };
}

// Types the text out character by character, like the agent is filling in the form.
function Typewriter({ text, speed = 40 }: { text: string; speed?: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (count >= text.length) return;
    const id = setTimeout(() => setCount((c) => c + 1), speed);
    return () => clearTimeout(id);
  }, [count, text, speed]);

  return (
    <>
      {text.slice(0, count)}
      {count < text.length && <span className="animate-pulse">▍</span>}
    </>
  );
}

function Buttons({
  state,
  demo,
  approveLabel,
  onApprove,
  onReject,
}: {
  state?: ActionState;
  demo?: boolean;
  approveLabel: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="mt-4">
      {!state && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onApprove}
            className="rounded-xl bg-[#003087] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00257a] active:scale-95"
          >
            {approveLabel}
          </button>
          <button
            onClick={onReject}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-95"
          >
            Reject
          </button>
        </div>
      )}
      {state === 'verifying' && (
        <div className="animate-pulse text-sm font-medium text-[#003087]">
          🔐 Waiting for your fingerprint, Face ID, or device PIN…{demo ? ' (simulated in demo)' : ''}
        </div>
      )}
      {state === 'working' && <div className="text-sm text-slate-600">Working…</div>}
      {state === 'approved' && <div className="text-sm font-semibold text-green-700">✅ Approved</div>}
      {state === 'rejected' && <div className="text-sm font-semibold text-slate-600">❌ Rejected</div>}
      {state === 'failed' && <div className="text-sm font-semibold text-red-700">⚠️ Failed, see the message below</div>}
    </div>
  );
}

export function AutoCard({ auto }: { auto: AutoAction }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!auto.link) return;
    try {
      await navigator.clipboard.writeText(auto.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the link is still visible and selectable.
    }
  }

  const tone = !auto.ok
    ? 'border-red-300 bg-red-50 text-red-900'
    : auto.link
      ? 'border-sky-300 bg-sky-50 text-sky-900'
      : 'border-green-300 bg-green-50 text-green-900';

  const title = !auto.ok ? '⚠️ Autopay failed' : auto.link ? '🔗 Payment request' : '⚡ Autopay';

  return (
    <div className={`mt-3 rounded-2xl border px-4 py-3 text-sm shadow-sm ${tone}`}>
      <span className="font-semibold">{title}</span>
      <div className="mt-1">{auto.summary}</div>

      {auto.link && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded bg-white/80 px-2 py-1 text-xs text-slate-700">
            {auto.link}
          </code>
          <button
            onClick={() => void copyLink()}
            className="rounded-lg bg-[#003087] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#00257a]"
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <a
            href={auto.link}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Open ↗
          </a>
        </div>
      )}
    </div>
  );
}

export default function ActionCard({ action, state, demo, onApprove, onReject }: Props) {
  const payment = action.toolName === 'send_payment' ? asRecord(action.args) : null;

  if (payment) {
    const name = String(payment.contactName ?? 'Unknown');
    const email = String(payment.email ?? '');
    const cents = typeof payment.amountCents === 'number' ? payment.amountCents : NaN;
    const amount = Number.isFinite(cents) ? (cents / 100).toFixed(2) : '?';
    const note = typeof payment.note === 'string' ? payment.note : '';

    return (
      <div className="mt-3 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 shadow-sm">
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-100/70 px-4 py-2 text-sm font-semibold text-amber-900">
          <span aria-hidden>🔒</span> Needs your fingerprint
        </div>
        <div className="px-4 py-3 text-slate-800">
          <div className="text-xs text-slate-500">The agent filled in this payment for you</div>
          <div className="mt-2 text-sm text-slate-600">Send payment to</div>
          <div className="text-base font-semibold">
            <Typewriter text={name} speed={45} />
          </div>
          <div className="text-xs text-slate-500">{email}</div>
          <div className="mt-3 text-4xl font-bold text-[#003087]">
            <Typewriter text={`$${amount}`} speed={110} />
          </div>
          <div className="text-xs text-slate-500">US dollars · PayPal sandbox</div>
          {note && <div className="mt-2 text-sm text-slate-700">Note: {note}</div>}
          <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs text-slate-600">
            Check the recipient and the amount carefully. Voice input can mishear numbers.
          </div>
          <button
            onClick={() => speak(`Send ${amount} dollars to ${name}`)}
            className="mt-3 text-xs font-medium text-[#003087] underline"
          >
            🔊 Read it back to me
          </button>
          <Buttons
            state={state}
            demo={demo}
            approveLabel={demo ? '🔐 Approve (simulated fingerprint)' : '🔐 Approve with fingerprint'}
            onApprove={onApprove}
            onReject={onReject}
          />
        </div>
      </div>
    );
  }

  const summary = summarize(action.args);
  const title = action.toolName
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 shadow-sm">
      <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-100/70 px-4 py-2 text-sm font-semibold text-amber-900">
        <span aria-hidden>🔒</span> Needs your approval
      </div>

      <div className="px-4 py-3 text-sm text-slate-800">
        <div className="text-base font-semibold">{title}</div>

        {summary.to && (
          <div className="mt-1 text-slate-600">
            To: <span className="font-medium text-slate-900">{summary.to}</span>
          </div>
        )}

        {summary.items.length > 0 && (
          <ul className="mt-2 space-y-1">
            {summary.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-4 rounded-lg bg-white/70 px-3 py-1.5">
                <span className="font-medium">{item.name}</span>
                <span className="text-slate-600">{item.line}</span>
              </li>
            ))}
          </ul>
        )}

        {summary.total && (
          <div className="mt-3 text-lg font-bold text-[#003087]">Total: {summary.total}</div>
        )}

        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer select-none font-medium">Technical details</summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-white p-3 text-[11px] text-slate-800">
            {JSON.stringify(action.args, null, 2)}
          </pre>
        </details>

        <Buttons
          state={state}
          demo={demo}
          approveLabel="Approve"
          onApprove={onApprove}
          onReject={onReject}
        />
      </div>
    </div>
  );
}