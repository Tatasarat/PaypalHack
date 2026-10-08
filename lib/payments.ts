import { prisma } from '@/lib/db';

// Sandbox only, by design.
const SANDBOX_API = 'https://api-m.sandbox.paypal.com';

function envCents(name: string, fallbackUsd: number): number {
  const parsed = Number(process.env[name]);
  const usd = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackUsd;
  return Math.round(usd * 100);
}

export const MAX_PAYMENT_CENTS = envCents('MAX_PAYMENT_USD', 100);
export const MONTHLY_CAP_CENTS = envCents('MONTHLY_CAP_USD', 500);

export const dollars = (cents: number) => (cents / 100).toFixed(2);

export type Actor = { id: string; isDemo: boolean };

export type SendPaymentArgs = {
  contactName: string;
  amount: number;
  note?: string;
};

export type NormalizedPayment = {
  contactId: string;
  contactName: string;
  email: string;
  amountCents: number;
  currency: 'USD';
  note?: string;
};

export type PaymentDecision =
  | { decision: 'block'; reason: string }
  | { decision: 'ask'; payment: NormalizedPayment; reason: string }
  | { decision: 'auto'; payment: NormalizedPayment; reason: string };

function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function monthToDateCents(userId: string, contactId?: string): Promise<number> {
  const result = await prisma.payment.aggregate({
    _sum: { amountCents: true },
    where: {
      userId,
      createdAt: { gte: startOfMonthUtc() },
      status: { not: 'FAILED' },
      ...(contactId ? { contactId } : {}),
    },
  });
  return result._sum.amountCents ?? 0;
}

// All safety decisions happen here, on the server. The AI model cannot bypass them.
export async function evaluateSendPayment(
  userId: string,
  args: SendPaymentArgs
): Promise<PaymentDecision> {
  const amountCents = Math.round(Number(args.amount) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { decision: 'block', reason: 'The amount must be greater than zero.' };
  }
  if (amountCents > MAX_PAYMENT_CENTS) {
    return {
      decision: 'block',
      reason: `That is above the hard limit of $${dollars(MAX_PAYMENT_CENTS)} per payment.`,
    };
  }

  const search = args.contactName.trim();
  if (!search) {
    return { decision: 'block', reason: 'No contact name was given.' };
  }

  const found = await prisma.contact.findMany({
    where: { userId, name: { contains: search, mode: 'insensitive' } },
    include: { rule: true },
    take: 5,
  });
  const exact = found.filter((c) => c.name.toLowerCase() === search.toLowerCase());
  const matches = exact.length > 0 ? exact : found;

  if (matches.length === 0) {
    return {
      decision: 'block',
      reason: `There is no saved contact named "${search}". Add them on the Contacts page first.`,
    };
  }
  if (matches.length > 1) {
    return {
      decision: 'block',
      reason: `More than one contact matches "${search}": ${matches.map((m) => m.name).join(', ')}. Ask for the full name.`,
    };
  }

  const contact = matches[0];

  const monthSpent = await monthToDateCents(userId);
  if (monthSpent + amountCents > MONTHLY_CAP_CENTS) {
    return {
      decision: 'block',
      reason: `This would pass the monthly cap of $${dollars(MONTHLY_CAP_CENTS)} ($${dollars(monthSpent)} already sent this month).`,
    };
  }

  const payment: NormalizedPayment = {
    contactId: contact.id,
    contactName: contact.name,
    email: contact.email,
    amountCents,
    currency: 'USD',
    note: args.note ? args.note.slice(0, 200) : undefined,
  };

  const rule = contact.rule;
  if (rule && rule.active && amountCents <= rule.maxPerPaymentCents) {
    const contactSpent = await monthToDateCents(userId, contact.id);
    if (contactSpent + amountCents <= rule.monthlyCapCents) {
      return {
        decision: 'auto',
        payment,
        reason: `Matched the autopay rule for ${contact.name} (up to $${dollars(rule.maxPerPaymentCents)} per payment).`,
      };
    }
    return {
      decision: 'ask',
      payment,
      reason: `This would pass the monthly autopay cap for ${contact.name}, so your approval is needed.`,
    };
  }

  return {
    decision: 'ask',
    payment,
    reason: rule?.active
      ? 'This is above the autopay limit for this contact, so your approval is needed.'
      : 'There is no autopay rule for this contact, so your approval is needed.',
  };
}

type PayPalResponse = {
  access_token?: string;
  error_description?: string;
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string }[];
  batch_header?: { payout_batch_id?: string; batch_status?: string };
};

async function getAccessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal credentials are missing in .env.local.');

  const res = await fetch(`${SANDBOX_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = (await res.json().catch(() => ({}))) as PayPalResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`PayPal authentication failed: ${data.error_description ?? res.status}`);
  }
  return data.access_token;
}

export async function executeSendPayment(
  actor: Actor,
  actionId: string,
  payment: NormalizedPayment
) {
  const value = dollars(payment.amountCents);

  // Demo accounts never call PayPal. The payment is only recorded, so caps still work.
  if (actor.isDemo) {
    await prisma.payment.create({
      data: {
        userId: actor.id,
        actionId,
        contactId: payment.contactId,
        amountCents: payment.amountCents,
        currency: payment.currency,
        note: payment.note,
        status: 'SIMULATED',
      },
    });
    return {
      simulated: true,
      note: 'Demo mode: no real PayPal call was made.',
      to: payment.contactName,
      email: payment.email,
      amount: value,
      currency: payment.currency,
    };
  }

  const token = await getAccessToken();

  const res = await fetch(`${SANDBOX_API}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': actionId, // makes retries safe: the same action can never pay twice
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: actionId,
        email_subject: 'You have a payment',
        email_message: payment.note ?? 'You received a payment.',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          receiver: payment.email,
          amount: { value, currency: payment.currency },
          note: payment.note ?? 'Payment',
          sender_item_id: actionId,
        },
      ],
    }),
  });

  const data = (await res.json().catch(() => ({}))) as PayPalResponse;
  if (!res.ok) {
    const issue = data.details?.[0]?.issue ?? data.message ?? res.statusText;
    throw new Error(
      `PayPal Payouts error (${res.status}): ${issue}${data.debug_id ? ` [debug_id ${data.debug_id}]` : ''}`
    );
  }

  const batchId = data.batch_header?.payout_batch_id;
  const batchStatus = data.batch_header?.batch_status;

  try {
    await prisma.payment.create({
      data: {
        userId: actor.id,
        actionId,
        contactId: payment.contactId,
        amountCents: payment.amountCents,
        currency: payment.currency,
        note: payment.note,
        status: 'SENT',
        paypalBatchId: batchId,
      },
    });
  } catch (error) {
    // The money already moved, so never report failure just because bookkeeping failed.
    console.error('Payment sent but could not be recorded:', error);
  }

  return {
    payoutBatchId: batchId,
    batchStatus,
    to: payment.contactName,
    email: payment.email,
    amount: value,
    currency: payment.currency,
  };
}