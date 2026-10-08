import Link from 'next/link';
import { redirect } from 'next/navigation';
import LedgerGrid from '@/components/LedgerGrid';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const EVENT_STYLES: Record<string, { label: string; dot: string }> = {
  PROPOSED: { label: 'Proposed by the agent', dot: 'bg-amber-400' },
  VERIFIED: { label: 'Identity confirmed', dot: 'bg-teal-500' },
  APPROVED: { label: 'Approved by you', dot: 'bg-blue-500' },
  AUTO_APPROVED: { label: 'Approved automatically by your autopay rule', dot: 'bg-purple-500' },
  REJECTED: { label: 'Rejected by you', dot: 'bg-slate-400' },
  EXECUTED: { label: 'Executed on PayPal', dot: 'bg-green-500' },
  FAILED: { label: 'Failed', dot: 'bg-red-500' },
  EXPIRED: { label: 'Expired', dot: 'bg-slate-300' },
};

function humanize(toolName: string): string {
  return toolName.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function describe(toolName: string, args: unknown): string | null {
  if (toolName !== 'send_payment') return null;
  if (!args || typeof args !== 'object') return null;
  const a = args as { contactName?: unknown; amountCents?: unknown };
  if (typeof a.contactName !== 'string' || typeof a.amountCents !== 'number') return null;
  return `$${(a.amountCents / 100).toFixed(2)} to ${a.contactName}`;
}

export default async function ActivityPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [events, grouped, byRule] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { action: { userId: user.id } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { action: { select: { toolName: true, args: true } } },
    }),
    prisma.action.groupBy({
      by: ['status'],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    prisma.action.count({ where: { userId: user.id, decidedBy: 'rule' } }),
  ]);

  const counts: Record<string, number> = {};
  for (const row of grouped) counts[row.status] = row._count._all;

  const stats = [
    { label: 'Executed', value: counts.EXECUTED ?? 0, color: 'text-green-700' },
    { label: 'By autopay rule', value: byRule, color: 'text-purple-700' },
    { label: 'Rejected', value: counts.REJECTED ?? 0, color: 'text-slate-700' },
    { label: 'Pending', value: counts.PENDING ?? 0, color: 'text-amber-700' },
    { label: 'Failed', value: counts.FAILED ?? 0, color: 'text-red-700' },
  ];

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#003087] to-[#009cde] text-lg font-bold text-white">
            P
          </div>
          <div className="text-sm font-semibold">
            Activity &amp; ledger{user.isDemo ? ' · demo' : ''}
          </div>
        </div>
        <Link
          href="/"
          className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
        >
          ← Back to chat
        </Link>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>

        <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-600">Data explorer</h2>
        <LedgerGrid />

        <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-600">
          Audit trail: every action the agent proposed
        </h2>

        {events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Nothing yet. Ask the agent to create an invoice or send a payment and it will show up here.
          </div>
        ) : (
          <ul className="mx-auto max-w-3xl space-y-3">
            {events.map((event) => {
              const style = EVENT_STYLES[event.type] ?? { label: event.type, dot: 'bg-slate-300' };
              const detail = event.detail as { message?: string; reason?: string } | null;
              const summary = describe(event.action.toolName, event.action.args);
              return (
                <li key={event.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${style.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold">
                        {style.label}: {humanize(event.action.toolName)}
                        {summary && <span className="ml-1 font-normal text-slate-600">({summary})</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {event.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </div>
                    </div>
                    {detail?.message && <div className="mt-1 text-xs text-red-700">{detail.message}</div>}
                    {detail?.reason && <div className="mt-1 text-xs text-slate-500">{detail.reason}</div>}
                    <div className="mt-1 truncate text-[11px] text-slate-400">ID: {event.actionId}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}