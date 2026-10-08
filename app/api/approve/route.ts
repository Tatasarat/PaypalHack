import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, unauthorized } from '@/lib/auth';
import { resolvePendingAction } from '@/lib/paypal-tools';

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const { actionId, decision } = await req.json();

    if (
      typeof actionId !== 'string' ||
      (decision !== 'approve' && decision !== 'reject')
    ) {
      return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
    }

    const outcome = await resolvePendingAction(actionId, decision, {
      id: user.id,
      isDemo: user.isDemo,
    });
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 404 });
  } catch (error) {
    console.error('Approve route error:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
  }
}