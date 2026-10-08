'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Splash from '@/components/Splash';
import { useRequireUser } from '@/hooks/useUser';

type Rule = { maxPerPaymentCents: number; monthlyCapCents: number; active: boolean };
type Contact = {
  id: string;
  name: string;
  email: string;
  rule: Rule | null;
  monthSpentCents: number;
};
type Limits = { maxPaymentCents: number; monthlyCapCents: number; monthSpentCents: number };

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function ContactCard({ contact, onChanged }: { contact: Contact; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [maxInput, setMaxInput] = useState(
    contact.rule ? (contact.rule.maxPerPaymentCents / 100).toString() : '20'
  );
  const [capInput, setCapInput] = useState(
    contact.rule ? (contact.rule.monthlyCapCents / 100).toString() : '100'
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/contacts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.');
        return false;
      }
      onChanged();
      return true;
    } catch {
      setError('Could not reach the server.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveRule() {
    const maxPerPaymentCents = Math.round(Number(maxInput) * 100);
    const monthlyCapCents = Math.round(Number(capInput) * 100);
    const ok = await call('PUT', {
      id: contact.id,
      rule: { maxPerPaymentCents, monthlyCapCents },
    });
    if (ok) setEditing(false);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">{contact.name}</div>
          <div className="text-xs text-slate-500">{contact.email}</div>
          <div className="mt-1 text-xs text-slate-500">
            Sent this month: <span className="font-medium text-slate-700">{usd(contact.monthSpentCents)}</span>
          </div>
        </div>
        <button
          onClick={() => {
            if (confirm(`Delete ${contact.name}?`)) void call('DELETE', { id: contact.id });
          }}
          disabled={busy}
          className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
        >
          Delete
        </button>
      </div>

      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
        {contact.rule && !editing ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-green-700">⚡ Autopay on</span>
              <span className="ml-2 text-slate-600">
                up to {usd(contact.rule.maxPerPaymentCents)} per payment, {usd(contact.rule.monthlyCapCents)} per month
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(true)}
                className="text-xs font-medium text-[#003087] underline"
              >
                Edit
              </button>
              <button
                onClick={() => void call('PUT', { id: contact.id, rule: null })}
                disabled={busy}
                className="text-xs font-medium text-red-700 underline"
              >
                Turn off
              </button>
            </div>
          </div>
        ) : editing || contact.rule ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">
                Max per payment ($)
                <input
                  value={maxInput}
                  onChange={(e) => setMaxInput(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900"
                />
              </label>
              <label className="text-xs text-slate-600">
                Monthly cap ($)
                <input
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void saveRule()}
                disabled={busy}
                className="rounded-lg bg-[#003087] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                Save autopay rule
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-600">Every payment to {contact.name} needs your approval.</span>
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-[#003087] underline"
            >
              Set up autopay
            </button>
          </div>
        )}
      </div>

      {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
    </div>
  );
}

export default function ContactsPage() {
  const router = useRouter();
  const { status } = useRequireUser();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/contacts');
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setLoadError(
          data?.error ?? 'Could not load contacts. Check that the database is running, then retry.'
        );
        return;
      }
      setLoadError(null);
      setContacts(data.contacts ?? []);
      setLimits(data.limits ?? null);
      setLoaded(true);
    } catch {
      setLoadError('Could not reach the server.');
    }
  }, [router]);

  useEffect(() => {
    if (status === 'ready') void load();
  }, [status, load]);

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? 'Could not add the contact.');
        return;
      }
      setName('');
      setEmail('');
      void load();
    } catch {
      setFormError('Could not reach the server.');
    }
  }

  if (status !== 'ready') return <Splash status={status} />;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#003087] to-[#009cde] text-lg font-bold text-white">
            P
          </div>
          <div className="text-sm font-semibold">Contacts &amp; autopay</div>
        </div>
        <Link
          href="/"
          className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
        >
          ← Back to chat
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        {loadError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <span>{loadError}</span>
            <button
              onClick={() => void load()}
              className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        )}

        {limits && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="font-semibold">Safety limits (set on the server)</div>
            <div className="mt-2 grid grid-cols-1 gap-2 text-slate-600 sm:grid-cols-3">
              <div>Per payment, hard limit: <span className="font-semibold text-slate-900">{usd(limits.maxPaymentCents)}</span></div>
              <div>Monthly cap: <span className="font-semibold text-slate-900">{usd(limits.monthlyCapCents)}</span></div>
              <div>Sent this month: <span className="font-semibold text-slate-900">{usd(limits.monthSpentCents)}</span></div>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              The agent can only pay contacts listed here, and never above these limits, even if you ask it to.
            </div>
          </div>
        )}

        <form onSubmit={addContact} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold">Add a contact</div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. Ravi)"
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="PayPal sandbox email"
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
            />
            <button
              type="submit"
              className="h-10 rounded-lg bg-[#003087] px-4 text-sm font-semibold text-white transition hover:bg-[#00257a]"
            >
              Add
            </button>
          </div>
          {formError && <div className="mt-2 text-xs text-red-700">{formError}</div>}
        </form>

        <div className="space-y-3">
          {loaded && contacts.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No contacts yet. Add a sandbox personal account email above to try payments.
            </div>
          )}
          {contacts.map((c) => (
            <ContactCard
              key={`${c.id}-${c.rule?.maxPerPaymentCents}-${c.rule?.monthlyCapCents}`}
              contact={c}
              onChanged={() => void load()}
            />
          ))}
        </div>
      </main>
    </div>
  );
}