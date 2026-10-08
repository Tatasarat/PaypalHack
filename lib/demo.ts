import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

export async function createDemoUser() {
  // Simple abuse guard: limit how many demo sessions can be created per hour.
  const recent = await prisma.user.count({
    where: { isDemo: true, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent >= 100) {
    throw new Error('Too many demo sessions right now. Please try again in a few minutes.');
  }

  const user = await prisma.user.create({
    data: { displayName: 'Demo visitor', isDemo: true },
  });

  const ravi = await prisma.contact.create({
    data: {
      userId: user.id,
      name: 'Ravi',
      email: 'ravi@example.com',
      rule: { create: { maxPerPaymentCents: 1000, monthlyCapCents: 5000 } },
    },
  });
  const priya = await prisma.contact.create({
    data: { userId: user.id, name: 'Priya', email: 'priya@example.com' },
  });

  // 1) A small payment that Ravi's autopay rule approved on its own.
  const paymentToRavi = {
    contactId: ravi.id,
    contactName: ravi.name,
    email: ravi.email,
    amountCents: 800,
    currency: 'USD',
    note: 'Hosting refund',
  };
  const action1 = await prisma.action.create({
    data: {
      userId: user.id,
      toolName: 'send_payment',
      args: paymentToRavi as Prisma.InputJsonValue,
      status: 'EXECUTED',
      decidedBy: 'rule',
      result: { simulated: true, to: 'Ravi', amount: '8.00', currency: 'USD' },
      createdAt: minutesAgo(180),
      decidedAt: minutesAgo(179),
      executedAt: minutesAgo(178),
      events: {
        create: [
          { type: 'PROPOSED', createdAt: minutesAgo(180) },
          {
            type: 'AUTO_APPROVED',
            detail: { reason: 'Matched the autopay rule for Ravi (up to $10.00 per payment).' },
            createdAt: minutesAgo(179),
          },
          { type: 'EXECUTED', createdAt: minutesAgo(178) },
        ],
      },
    },
  });
  await prisma.payment.create({
    data: {
      userId: user.id,
      actionId: action1.id,
      contactId: ravi.id,
      amountCents: 800,
      note: 'Hosting refund',
      status: 'SIMULATED',
      createdAt: minutesAgo(178),
    },
  });

  // 2) A larger payment that needed a manual approval.
  const paymentToPriya = {
    contactId: priya.id,
    contactName: priya.name,
    email: priya.email,
    amountCents: 3000,
    currency: 'USD',
    note: 'Logo design deposit',
  };
  const action2 = await prisma.action.create({
    data: {
      userId: user.id,
      toolName: 'send_payment',
      args: paymentToPriya as Prisma.InputJsonValue,
      status: 'EXECUTED',
      decidedBy: 'user',
      result: { simulated: true, to: 'Priya', amount: '30.00', currency: 'USD' },
      createdAt: minutesAgo(120),
      decidedAt: minutesAgo(118),
      executedAt: minutesAgo(117),
      events: {
        create: [
          {
            type: 'PROPOSED',
            detail: { reason: 'There is no autopay rule for this contact, so your approval is needed.' },
            createdAt: minutesAgo(120),
          },
          { type: 'APPROVED', createdAt: minutesAgo(118) },
          { type: 'EXECUTED', createdAt: minutesAgo(117) },
        ],
      },
    },
  });
  await prisma.payment.create({
    data: {
      userId: user.id,
      actionId: action2.id,
      contactId: priya.id,
      amountCents: 3000,
      note: 'Logo design deposit',
      status: 'SIMULATED',
      createdAt: minutesAgo(117),
    },
  });

  // 3) An invoice the user approved.
  const invoiceArgs = {
    detail: { currency_code: 'USD' },
    primary_recipients: [{ billing_info: { email_address: 'priya@example.com' } }],
    items: [
      {
        name: 'Logo design',
        quantity: '1',
        unit_amount: { currency_code: 'USD', value: '45.00' },
      },
    ],
  };
  await prisma.action.create({
    data: {
      userId: user.id,
      toolName: 'create_invoice',
      args: invoiceArgs as Prisma.InputJsonValue,
      status: 'EXECUTED',
      decidedBy: 'user',
      result: { simulated: true, invoice_id: 'INV2-DEMO-0002' },
      createdAt: minutesAgo(60),
      decidedAt: minutesAgo(58),
      executedAt: minutesAgo(57),
      events: {
        create: [
          { type: 'PROPOSED', createdAt: minutesAgo(60) },
          { type: 'APPROVED', createdAt: minutesAgo(58) },
          { type: 'EXECUTED', createdAt: minutesAgo(57) },
        ],
      },
    },
  });

  return user;
}