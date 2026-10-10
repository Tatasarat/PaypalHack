import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { dollars } from '@/lib/payments';
import { capturePayPalOrder, createPayPalOrder } from '@/lib/paypal-sdk';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ token: string }> };

const SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core'; // sandbox only, by design

// Public endpoints need their own simple rate limit.
const g = globalThis as unknown as { __payHits?: Map<string, number[]> };
const hits = (g.__payHits ??= new Map<string, number[]>());

function tooMany(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > limit;
}

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function load(token: string) {
  const request = await prisma.paymentRequest.findUnique({
    where: { token },
    include: { user: { select: { displayName: true, isDemo: true } } },
  });
  if (!request) return null;

  const status =
    request.status === 'OPEN' && request.expiresAt.getTime() < Date.now()
      ? 'EXPIRED'
      : request.status;

  return { request, status };
}

export async function GET(_req: NextRequest, context: Context) {
  try {
    const { token } = await context.params;
    const found = await load(token);
    if (!found) return fail('This payment link is not valid.', 404);

    const { request, status } = found;
    return NextResponse.json({
      requester: request.user.isDemo ? 'Demo Studio' : request.user.displayName,
      amount: dollars(request.amountCents),
      currency: request.currency,
      note: request.note ?? '',
      status,
      simulated: request.user.isDemo,
      clientId: process.env.PAYPAL_CLIENT_ID ?? '',
      sdkUrl: SDK_URL,
    });
  } catch (error) {
    console.error('Pay GET error:', error);
    return fail('Something went wrong. Please try again.', 500);
  }
}

export async function POST(req: NextRequest, context: Context) {
  try {
    const { token } = await context.params;
    const body = await req.json().catch(() => ({}));

    if (tooMany(token, 30, 60 * 60 * 1000)) {
      return fail('Too many attempts. Please try again later.', 429);
    }

    const found = await load(token);
    if (!found) return fail('This payment link is not valid.', 404);

    const { request, status } = found;
    if (status === 'PAID') return fail('This request has already been paid.', 409);
    if (status !== 'OPEN') return fail('This payment link has expired.', 410);

    const isDemo = request.user.isDemo;

    // Step 1: create the PayPal order. The amount comes from our database.
    if (body.action === 'order') {
      if (isDemo) return NextResponse.json({ simulated: true });

      const requester = request.user.displayName;
      const description = `Payment request from ${requester}${request.note ? `: ${request.note}` : ''}`;
      const orderId = await createPayPalOrder(request.amountCents, description);

      await prisma.paymentRequest.update({
        where: { id: request.id },
        data: { paypalOrderId: orderId },
      });
      return NextResponse.json({ orderId });
    }

    // Step 2: capture it after the buyer approves. This is when money actually moves.
    if (body.action === 'capture') {
      if (isDemo) return fail('Demo requests are not paid through PayPal.');
      if (typeof body.orderId !== 'string' || body.orderId !== request.paypalOrderId) {
        return fail('This order does not match the request.');
      }

      const outcome = await capturePayPalOrder(body.orderId);
      if (outcome.status === 'COMPLETED') {
        await prisma.paymentRequest.updateMany({
          where: { id: request.id, status: 'OPEN' },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }
      return NextResponse.json({ status: outcome.status });
    }

    // Demo accounts only: mark the request as paid without calling PayPal.
    if (body.action === 'simulate') {
      if (!isDemo) return fail('Simulation is only available for demo accounts.', 403);

      await prisma.paymentRequest.updateMany({
        where: { id: request.id, status: 'OPEN' },
        data: { status: 'PAID', paidAt: new Date() },
      });
      return NextResponse.json({ status: 'COMPLETED' });
    }

    return fail('Unknown request.');
  } catch (error) {
    console.error('Pay POST error:', error);
    return fail(
      error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      500
    );
  }
}