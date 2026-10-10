import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db';
import { APP_ORIGIN } from '@/lib/auth';
import { MAX_PAYMENT_CENTS, dollars, type Actor } from '@/lib/payments';

const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OPEN_REQUESTS = 50;

export const payLink = (token: string) => `${APP_ORIGIN}/pay/${token}`;

export type CreatedRequest =
  | {
      ok: true;
      token: string;
      link: string;
      contactName: string;
      amountCents: number;
      note?: string;
    }
  | { ok: false; reason: string };

export async function createPaymentRequest(
  actor: Actor,
  args: { contactName: string; amount: number; note?: string }
): Promise<CreatedRequest> {
  const amountCents = Math.round(Number(args.amount) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, reason: 'The amount must be greater than zero.' };
  }
  if (amountCents > MAX_PAYMENT_CENTS) {
    return { ok: false, reason: `Requests are limited to $${dollars(MAX_PAYMENT_CENTS)} each.` };
  }

  const search = args.contactName.trim();
  if (!search) return { ok: false, reason: 'No contact name was given.' };

  const found = await prisma.contact.findMany({
    where: { userId: actor.id, name: { contains: search, mode: 'insensitive' } },
    take: 5,
  });
  const exact = found.filter((c) => c.name.toLowerCase() === search.toLowerCase());
  const matches = exact.length > 0 ? exact : found;

  if (matches.length === 0) {
    return {
      ok: false,
      reason: `There is no saved contact named "${search}". Add them on the Contacts page first.`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `More than one contact matches "${search}": ${matches.map((m) => m.name).join(', ')}. Ask for the full name.`,
    };
  }

  const open = await prisma.paymentRequest.count({
    where: { userId: actor.id, status: 'OPEN', expiresAt: { gt: new Date() } },
  });
  if (open >= MAX_OPEN_REQUESTS) {
    return { ok: false, reason: `There are already ${MAX_OPEN_REQUESTS} open requests.` };
  }

  const contact = matches[0];
  const note = args.note ? args.note.slice(0, 200) : undefined;
  const token = randomBytes(16).toString('base64url');

  await prisma.paymentRequest.create({
    data: {
      token,
      userId: actor.id,
      contactId: contact.id,
      amountCents,
      note,
      expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
    },
  });

  return { ok: true, token, link: payLink(token), contactName: contact.name, amountCents, note };
}

// Used by the agent to answer "who still owes me money?". Links are only included while open.
export async function listPaymentRequests(userId: string) {
  const rows = await prisma.paymentRequest.findMany({
    where: { userId },
    include: { contact: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const now = Date.now();
  return rows.map((r) => {
    const expired = r.status === 'OPEN' && r.expiresAt.getTime() < now;
    return {
      contact: r.contact.name,
      amount: `$${dollars(r.amountCents)}`,
      status: expired ? 'EXPIRED' : r.status,
      note: r.note ?? '',
      createdAt: r.createdAt.toISOString(),
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
    };
  });
}