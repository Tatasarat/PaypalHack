import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser, unauthorized, type SessionUser } from '@/lib/auth';
import { MAX_PAYMENT_CENTS, MONTHLY_CAP_CENTS, monthToDateCents } from '@/lib/payments';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CONTACTS = 25;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function handle(fn: (user: SessionUser) => Promise<NextResponse>) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();
    return await fn(user);
  } catch (error) {
    console.error('Contacts route error:', error);
    return bad(error instanceof Error ? error.message : 'Something went wrong.', 500);
  }
}

export async function GET() {
  return handle(async (user) => {
    const contacts = await prisma.contact.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { rule: true },
    });
    const spent = await Promise.all(contacts.map((c) => monthToDateCents(user.id, c.id)));

    return NextResponse.json({
      contacts: contacts.map((c, i) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        monthSpentCents: spent[i],
        rule: c.rule
          ? {
              maxPerPaymentCents: c.rule.maxPerPaymentCents,
              monthlyCapCents: c.rule.monthlyCapCents,
              active: c.rule.active,
            }
          : null,
      })),
      limits: {
        maxPaymentCents: MAX_PAYMENT_CENTS,
        monthlyCapCents: MONTHLY_CAP_CENTS,
        monthSpentCents: await monthToDateCents(user.id),
      },
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async (user) => {
    const { name, email } = await req.json();
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim() : '';

    if (cleanName.length < 1 || cleanName.length > 60) return bad('Name must be 1 to 60 characters.');
    if (!EMAIL_RE.test(cleanEmail)) return bad('Please enter a valid email address.');

    const count = await prisma.contact.count({ where: { userId: user.id } });
    if (count >= MAX_CONTACTS) return bad(`You can save up to ${MAX_CONTACTS} contacts.`);

    const contact = await prisma.contact.create({
      data: { userId: user.id, name: cleanName, email: cleanEmail },
    });
    return NextResponse.json({ id: contact.id });
  });
}

// Create, update, or remove the autopay rule for a contact.
export async function PUT(req: NextRequest) {
  return handle(async (user) => {
    const { id, rule } = await req.json();
    if (typeof id !== 'string') return bad('Missing contact id.');

    const contact = await prisma.contact.findFirst({ where: { id, userId: user.id } });
    if (!contact) return bad('Contact not found.', 404);

    if (rule === null) {
      await prisma.autopayRule.deleteMany({ where: { contactId: id } });
      return NextResponse.json({ ok: true });
    }

    const maxPerPaymentCents = Number(rule?.maxPerPaymentCents);
    const monthlyCapCents = Number(rule?.monthlyCapCents);

    if (!Number.isInteger(maxPerPaymentCents) || maxPerPaymentCents <= 0) {
      return bad('Max per payment must be greater than zero.');
    }
    if (!Number.isInteger(monthlyCapCents) || monthlyCapCents <= 0) {
      return bad('Monthly cap must be greater than zero.');
    }
    if (maxPerPaymentCents > MAX_PAYMENT_CENTS) {
      return bad(`Max per payment cannot exceed the global limit of $${(MAX_PAYMENT_CENTS / 100).toFixed(2)}.`);
    }
    if (monthlyCapCents > MONTHLY_CAP_CENTS) {
      return bad(`Monthly cap cannot exceed the global limit of $${(MONTHLY_CAP_CENTS / 100).toFixed(2)}.`);
    }
    if (maxPerPaymentCents > monthlyCapCents) {
      return bad('Max per payment cannot be higher than the monthly cap.');
    }

    await prisma.autopayRule.upsert({
      where: { contactId: id },
      create: { contactId: id, maxPerPaymentCents, monthlyCapCents, active: true },
      update: { maxPerPaymentCents, monthlyCapCents, active: true },
    });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async (user) => {
    const { id } = await req.json();
    if (typeof id !== 'string') return bad('Missing contact id.');

    const contact = await prisma.contact.findFirst({ where: { id, userId: user.id } });
    if (!contact) return bad('Contact not found.', 404);

    try {
      await prisma.contact.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    } catch {
      return bad('This contact has payment history and cannot be deleted.', 409);
    }
  });
}