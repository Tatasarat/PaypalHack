import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, unauthorized } from '@/lib/auth';
import { monthToDateCents } from '@/lib/payments';

export const dynamic = 'force-dynamic';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function humanize(toolName: string): string {
  return toolName.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// A short human-readable line describing what an action was about.
function summarizeAction(toolName: string, args: unknown): string {
  const rec = asRecord(args);
  if (!rec) return '';

  if (toolName === 'send_payment') {
    const name = typeof rec.contactName === 'string' ? rec.contactName : '';
    const cents = typeof rec.amountCents === 'number' ? rec.amountCents : NaN;
    return name && Number.isFinite(cents) ? `$${(cents / 100).toFixed(2)} to ${name}` : '';
  }

  const items = Array.isArray(rec.items) ? rec.items : [];
  const first = asRecord(items[0]);
  if (!first) return '';

  const itemName = typeof first.name === 'string' ? first.name : '';
  const unit = asRecord(first.unit_amount);
  const value = unit && unit.value !== undefined ? String(unit.value) : '';
  const currency = unit && typeof unit.currency_code === 'string' ? unit.currency_code : '';
  const price = value ? `${value} ${currency}`.trim() : '';

  return [itemName, price].filter(Boolean).join(' · ');
}

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const view = req.nextUrl.searchParams.get('view') ?? 'payments';

    if (view === 'payments') {
      const payments = await prisma.payment.findMany({
        where: { userId: user.id },
        include: { contact: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      return NextResponse.json({
        rows: payments.map((p) => ({
          id: p.id,
          createdAt: p.createdAt.toISOString(),
          contactName: p.contact.name,
          email: p.contact.email,
          amount: p.amountCents / 100,
          currency: p.currency,
          status: p.status,
          note: p.note ?? '',
          batchId: p.paypalBatchId ?? '',
        })),
      });
    }

    if (view === 'actions') {
      const actions = await prisma.action.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      return NextResponse.json({
        rows: actions.map((a) => ({
          id: a.id,
          createdAt: a.createdAt.toISOString(),
          tool: humanize(a.toolName),
          summary: summarizeAction(a.toolName, a.args),
          status: a.status,
          decidedBy: a.decidedBy ?? '',
          error: a.error ?? '',
        })),
      });
    }

    if (view === 'contacts') {
      const contacts = await prisma.contact.findMany({
        where: { userId: user.id },
        include: { rule: true },
        orderBy: { createdAt: 'desc' },
      });
      const spent = await Promise.all(contacts.map((c) => monthToDateCents(user.id, c.id)));

      return NextResponse.json({
        rows: contacts.map((c, i) => ({
          id: c.id,
          createdAt: c.createdAt.toISOString(),
          name: c.name,
          email: c.email,
          autopay: c.rule
            ? `Up to $${(c.rule.maxPerPaymentCents / 100).toFixed(2)} per payment, $${(c.rule.monthlyCapCents / 100).toFixed(2)} per month`
            : 'Off',
          monthSpent: spent[i] / 100,
        })),
      });
    }

    return NextResponse.json({ error: 'Unknown view.' }, { status: 400 });
  } catch (error) {
    console.error('Ledger route error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Something went wrong.' },
      { status: 500 }
    );
  }
}