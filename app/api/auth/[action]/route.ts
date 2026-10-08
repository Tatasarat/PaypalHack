import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { prisma } from '@/lib/db';
import {
  APP_ORIGIN,
  RP_ID,
  RP_NAME,
  createSession,
  destroySession,
  getSessionUser,
  setChallenge,
  takeChallenge,
} from '@/lib/auth';
import { createDemoUser } from '@/lib/demo';

type RegistrationBody = Parameters<typeof verifyRegistrationResponse>[0]['response'];
type AuthenticationBody = Parameters<typeof verifyAuthenticationResponse>[0]['response'];
type Context = { params: Promise<{ action: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_req: NextRequest, context: Context) {
  const { action } = await context.params;
  if (action !== 'me') return fail('Not found', 404);

  try {
    const user = await getSessionUser();
    return NextResponse.json({ user });
  } catch (error) {
    console.error('Auth error (me):', error);
    return fail(error instanceof Error ? error.message : 'Something went wrong.', 500);
  }
}

export async function POST(req: NextRequest, context: Context) {
  const { action } = await context.params;

  try {
    switch (action) {
      case 'register-options':
        return await registerOptions(req);
      case 'register-verify':
        return await registerVerify(req);
      case 'login-options':
        return await loginOptions();
      case 'login-verify':
        return await loginVerify(req);
      case 'demo':
        return await demo();
      case 'logout':
        await destroySession();
        return NextResponse.json({ ok: true });
      default:
        return fail('Not found', 404);
    }
  } catch (error) {
    console.error(`Auth error (${action}):`, error);
    return fail(error instanceof Error ? error.message : 'Something went wrong.', 500);
  }
}

async function registerOptions(req: NextRequest) {
  const body = await req.json();
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const displayName =
    (typeof body.displayName === 'string' ? body.displayName.trim() : '') || email.split('@')[0];

  if (!EMAIL_RE.test(email)) return fail('Please enter a valid email address.');
  if (displayName.length > 60) return fail('That name is too long.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return fail('An account with this email already exists. Use "Sign in with passkey" instead.', 409);
  }

  const userId = randomUUID();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: email,
    userDisplayName: displayName,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });

  await setChallenge({ challenge: options.challenge, purpose: 'register', email, displayName, userId });
  return NextResponse.json(options);
}

async function registerVerify(req: NextRequest) {
  const body = (await req.json()) as RegistrationBody;
  const saved = await takeChallenge();

  if (!saved || saved.purpose !== 'register' || !saved.email || !saved.userId || !saved.displayName) {
    return fail('Your sign-up session expired. Please try again.');
  }

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: saved.challenge,
    expectedOrigin: APP_ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return fail('Could not verify the passkey.');
  }

  const { credential } = verification.registrationInfo;

  const user = await prisma.user.create({
    data: {
      id: saved.userId,
      email: saved.email,
      displayName: saved.displayName,
      credentials: {
        create: {
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter,
          transports: credential.transports?.join(','),
        },
      },
    },
  });

  await createSession(user);
  return NextResponse.json({ ok: true });
}

async function loginOptions() {
  // No allowCredentials: the browser offers any passkey saved for this site.
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
  });

  await setChallenge({ challenge: options.challenge, purpose: 'login' });
  return NextResponse.json(options);
}

async function loginVerify(req: NextRequest) {
  const body = (await req.json()) as AuthenticationBody;
  const saved = await takeChallenge();

  if (!saved || saved.purpose !== 'login') {
    return fail('Your sign-in session expired. Please try again.');
  }

  const stored = await prisma.passkeyCredential.findUnique({
    where: { credentialId: body.id },
    include: { user: true },
  });
  if (!stored) {
    return fail('That passkey is not registered here. Create an account first.', 401);
  }

  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: saved.challenge,
    expectedOrigin: APP_ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: stored.credentialId,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
      counter: stored.counter,
    },
  });

  if (!verification.verified) {
    return fail('Could not verify the passkey.', 401);
  }

  await prisma.passkeyCredential.update({
    where: { id: stored.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });

  await createSession(stored.user);
  return NextResponse.json({ ok: true });
}

async function demo() {
  const user = await createDemoUser();
  await createSession(user);
  return NextResponse.json({ ok: true });
}