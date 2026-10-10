import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { tool } from 'ai';
import type { generateText } from 'ai';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import {
  dollars,
  evaluateSendPayment,
  executeSendPayment,
  type Actor,
  type NormalizedPayment,
  type SendPaymentArgs,
} from '@/lib/payments';
import { createPaymentRequest, listPaymentRequests } from '@/lib/requests';

export type PendingAction = {
  id: string;
  toolName: string;
  args: unknown;
  createdAt: number;
};

export type AutoAction = {
  id: string;
  toolName: string;
  summary: string;
  ok: boolean;
  link?: string;
};

export type AgentCollector = {
  pending: PendingAction[];
  auto: AutoAction[];
};

type AgentTools = NonNullable<Parameters<typeof generateText>[0]['tools']>;

type AnyTool = {
  description?: string;
  parameters?: unknown;
  execute?: (args: unknown, options: unknown) => Promise<unknown> | unknown;
};

const PENDING_TTL_MS = 15 * 60 * 1000;

const paypalToolkit = new PayPalAgentToolkit({
  clientId: process.env.PAYPAL_CLIENT_ID!,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
  configuration: {
    actions: {
      invoices: { create: true, list: true },
      orders: { create: true, get: true },
    },
    context: { sandbox: true },
  },
});

const toolkitTools = paypalToolkit.getTools() as unknown as Record<string, AnyTool>;

// Our own tools. The model only describes what it wants; the real work and all
// safety checks happen in our server code, never in the model.
const customTools: Record<string, AnyTool> = {
  send_payment: tool({
    description:
      "Send money in US dollars FROM the user TO one of the user's saved contacts via PayPal. Use the contact name exactly as the user said it. Never ask for or invent an email address.",
    parameters: z.object({
      contactName: z.string().describe('Name of a saved contact'),
      amount: z.number().positive().describe('Amount in US dollars'),
      note: z.string().max(200).optional().describe('Short note for the recipient'),
    }),
    execute: async () => ({ error: 'send_payment must go through the approval layer.' }),
  }) as unknown as AnyTool,

  request_payment: tool({
    description:
      "Ask one of the user's saved contacts to pay the user a US dollar amount. This creates a shareable PayPal pay link; it asks for money and does not send any. Use the contact name exactly as the user said it.",
    parameters: z.object({
      contactName: z.string().describe('Name of a saved contact'),
      amount: z.number().positive().describe('Amount in US dollars'),
      note: z.string().max(200).optional().describe('What the payment is for'),
    }),
    execute: async () => ({ error: 'request_payment is handled by the server.' }),
  }) as unknown as AnyTool,

  list_payment_requests: tool({
    description:
      "List the user's recent payment requests and whether each one has been paid, is still open, or has expired.",
    parameters: z.object({}),
    execute: async () => ({ error: 'list_payment_requests is handled by the server.' }),
  }) as unknown as AnyTool,
};

const allTools: Record<string, AnyTool> = { ...toolkitTools, ...customTools };

console.log('[agent tools]', Object.keys(allTools));

// Default deny: only clearly read-only tools run without approval.
function isReadOnly(toolName: string): boolean {
  return /^(list|get|show)_/.test(toolName);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  const text = JSON.stringify(value);
  return text === undefined ? {} : (JSON.parse(text) as Prisma.InputJsonValue);
}

async function logEvent(actionId: string, type: string, detail?: unknown) {
  await prisma.auditEvent.create({
    data: {
      actionId,
      type,
      detail: detail === undefined ? undefined : toJson(detail),
    },
  });
}

// Demo accounts get sample data instead of reading the real sandbox account.
function demoReadResult(toolName: string) {
  if (toolName.includes('invoice')) {
    return {
      simulated: true,
      invoices: [
        { id: 'INV2-DEMO-0001', status: 'PAID', recipient: 'ravi@example.com', total: '120.00 USD', description: 'Website design' },
        { id: 'INV2-DEMO-0002', status: 'SENT', recipient: 'priya@example.com', total: '45.00 USD', description: 'Logo design' },
      ],
    };
  }
  return { simulated: true, note: 'Demo mode: sample data only.' };
}

export type ResolveOutcome =
  | { ok: true; status: 'rejected'; toolName: string }
  | { ok: true; status: 'executed'; toolName: string; result: unknown }
  | { ok: false; error: string };

// Runs an approved action (by the user or by a rule) and records the outcome.
async function runAction(
  actionId: string,
  toolName: string,
  args: unknown,
  actor: Actor
): Promise<ResolveOutcome> {
  try {
    let result: unknown;

    if (toolName === 'send_payment') {
      result = await executeSendPayment(actor, actionId, args as NormalizedPayment);
    } else if (actor.isDemo) {
      result = { simulated: true, note: 'Demo mode: no real PayPal call was made.', request: args };
    } else {
      const original = allTools[toolName];
      if (!original?.execute) throw new Error(`Tool ${toolName} cannot be executed.`);
      result = await original.execute(args, { toolCallId: actionId, messages: [] });
    }

    await prisma.action.update({
      where: { id: actionId },
      data: { status: 'EXECUTED', executedAt: new Date(), result: toJson(result) },
    });
    await logEvent(actionId, 'EXECUTED');

    return { ok: true, status: 'executed', toolName, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await prisma.action.update({
      where: { id: actionId },
      data: { status: 'FAILED', error: message },
    });
    await logEvent(actionId, 'FAILED', { message });
    return { ok: false, error: message };
  }
}

async function proposeGeneric(
  name: string,
  args: unknown,
  collector: AgentCollector,
  actor: Actor
) {
  const row = await prisma.action.create({
    data: { userId: actor.id, toolName: name, args: toJson(args) },
  });
  await logEvent(row.id, 'PROPOSED');

  collector.pending.push({
    id: row.id,
    toolName: name,
    args,
    createdAt: row.createdAt.getTime(),
  });

  return {
    status: 'pending_approval',
    actionId: row.id,
    note: 'NOT executed. The user must approve it in the UI first. Tell the user it is waiting for their approval. Do not say it was completed.',
  };
}

async function proposeSendPayment(rawArgs: unknown, collector: AgentCollector, actor: Actor) {
  const args = rawArgs as Partial<SendPaymentArgs>;
  const decision = await evaluateSendPayment(actor.id, {
    contactName: String(args.contactName ?? ''),
    amount: Number(args.amount),
    note: args.note ? String(args.note) : undefined,
  });

  if (decision.decision === 'block') {
    return {
      status: 'blocked',
      reason: decision.reason,
      note: 'Nothing was sent. Explain the reason to the user.',
    };
  }

  const payment = decision.payment;
  const amountText = dollars(payment.amountCents);

  if (decision.decision === 'ask') {
    const row = await prisma.action.create({
      data: { userId: actor.id, toolName: 'send_payment', args: toJson(payment) },
    });
    await logEvent(row.id, 'PROPOSED', { reason: decision.reason });

    collector.pending.push({
      id: row.id,
      toolName: 'send_payment',
      args: payment,
      createdAt: row.createdAt.getTime(),
    });

    return {
      status: 'pending_approval',
      actionId: row.id,
      summary: `Send $${amountText} to ${payment.contactName}`,
      reason: decision.reason,
      note: 'NOT sent yet. The user must approve it in the UI first. Do not say it was sent.',
    };
  }

  // Auto-approved by the user's own autopay rule.
  const row = await prisma.action.create({
    data: {
      userId: actor.id,
      toolName: 'send_payment',
      args: toJson(payment),
      status: 'APPROVED',
      decidedBy: 'rule',
      decidedAt: new Date(),
    },
  });
  await logEvent(row.id, 'PROPOSED');
  await logEvent(row.id, 'AUTO_APPROVED', { reason: decision.reason });

  const outcome = await runAction(row.id, 'send_payment', payment, actor);

  if (outcome.ok) {
    collector.auto.push({
      id: row.id,
      toolName: 'send_payment',
      summary: `Sent $${amountText} to ${payment.contactName} automatically (autopay rule)${actor.isDemo ? ' · simulated' : ''}`,
      ok: true,
    });
    return {
      status: 'sent_automatically',
      summary: `Sent $${amountText} to ${payment.contactName} under the user's autopay rule.`,
    };
  }

  collector.auto.push({
    id: row.id,
    toolName: 'send_payment',
    summary: `Autopay to ${payment.contactName} failed: ${outcome.error}`,
    ok: false,
  });
  return { status: 'failed', error: outcome.error, note: 'Nothing was sent. Explain the error.' };
}

// Asking for money cannot move money out, so it needs no approval. It is still logged.
async function runRequestPayment(rawArgs: unknown, collector: AgentCollector, actor: Actor) {
  const args = rawArgs as { contactName?: unknown; amount?: unknown; note?: unknown };

  const created = await createPaymentRequest(actor, {
    contactName: String(args.contactName ?? ''),
    amount: Number(args.amount),
    note: args.note ? String(args.note) : undefined,
  });

  if (!created.ok) {
    return {
      status: 'blocked',
      reason: created.reason,
      note: 'No request was created. Explain the reason to the user.',
    };
  }

  const row = await prisma.action.create({
    data: {
      userId: actor.id,
      toolName: 'request_payment',
      args: toJson({
        contactName: created.contactName,
        amountCents: created.amountCents,
        note: created.note,
      }),
      status: 'EXECUTED',
      decidedBy: 'auto',
      decidedAt: new Date(),
      executedAt: new Date(),
      result: toJson({ link: created.link }),
    },
  });
  await logEvent(row.id, 'PROPOSED');
  await logEvent(row.id, 'EXECUTED', {
    reason: 'Requesting money cannot move money out, so no approval was needed.',
  });

  const summary = `Payment request created: $${dollars(created.amountCents)} from ${created.contactName}`;
  collector.auto.push({
    id: row.id,
    toolName: 'request_payment',
    summary,
    ok: true,
    link: created.link,
  });

  return {
    status: 'request_created',
    summary,
    note: 'Tell the user the request is ready and that they can copy the link from the card below to share it. Do not say the contact has paid.',
  };
}

export function buildAgentTools(collector: AgentCollector, actor: Actor): AgentTools {
  const wrapped: Record<string, AnyTool> = {};

  for (const [name, original] of Object.entries(allTools)) {
    if (name === 'list_payment_requests') {
      wrapped[name] = {
        ...original,
        execute: async () => ({ requests: await listPaymentRequests(actor.id) }),
      };
      continue;
    }

    if (isReadOnly(name)) {
      wrapped[name] = actor.isDemo
        ? { ...original, execute: async () => demoReadResult(name) }
        : original;
      continue;
    }

    wrapped[name] = {
      ...original,
      execute: async (args: unknown) => {
        if (name === 'send_payment') return proposeSendPayment(args, collector, actor);
        if (name === 'request_payment') return runRequestPayment(args, collector, actor);
        return proposeGeneric(name, args, collector, actor);
      },
    };
  }

  return wrapped as unknown as AgentTools;
}

export async function resolvePendingAction(
  id: string,
  decision: 'approve' | 'reject',
  actor: Actor
): Promise<ResolveOutcome> {
  // Scoped to the signed-in user, so nobody can decide on someone else's action.
  const action = await prisma.action.findFirst({ where: { id, userId: actor.id } });
  if (!action || action.status !== 'PENDING') {
    return { ok: false, error: 'Action not found or already handled.' };
  }

  if (Date.now() - action.createdAt.getTime() > PENDING_TTL_MS) {
    await prisma.action.update({
      where: { id },
      data: { status: 'EXPIRED', decidedAt: new Date() },
    });
    await logEvent(id, 'EXPIRED');
    return { ok: false, error: 'This action expired. Please ask the agent again.' };
  }

  // Claim the action atomically so a double click can never run it twice.
  const claimed = await prisma.action.updateMany({
    where: { id, userId: actor.id, status: 'PENDING' },
    data: {
      status: decision === 'approve' ? 'APPROVED' : 'REJECTED',
      decidedAt: new Date(),
      decidedBy: 'user',
    },
  });
  if (claimed.count === 0) {
    return { ok: false, error: 'Action was already handled.' };
  }

  if (decision === 'reject') {
    await logEvent(id, 'REJECTED');
    return { ok: true, status: 'rejected', toolName: action.toolName };
  }

  await logEvent(id, 'APPROVED');
  return runAction(id, action.toolName, action.args, actor);
}