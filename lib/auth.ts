import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/db';

const SESSION_COOKIE = 'session';
const CHALLENGE_COOKIE = 'webauthn_challenge';

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const DEMO_SESSION_SECONDS = 2 * 60 * 60;
const CHALLENGE_SECONDS = 5 * 60;

// Passkeys are bound to this origin, so it must match the address in the browser.
export const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3000';
export const RP_ID = new URL(APP_ORIGIN).hostname;
export const RP_NAME = 'Smart Payments Agent';

export type SessionUser = {
  id: string;
  email: string | null;
  displayName: string;
  isDemo: boolean;
};

export type ChallengeData = {
  challenge: string;
  purpose: 'register' | 'login';
  email?: string;
  displayName?: string;
  userId?: string;
};

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short in .env.local. Generate one with: openssl rand -base64 32'
    );
  }
  return new TextEncoder().encode(secret);
}

async function sign(payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secretKey());
}

const cookieBase = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function createSession(user: { id: string; isDemo: boolean }) {
  const ttl = user.isDemo ? DEMO_SESSION_SECONDS : SESSION_SECONDS;
  const token = await sign({ sub: user.id }, ttl);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...cookieBase, maxAge: ttl });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const key = secretKey(); // fail loudly if the secret is missing
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let userId: string | null = null;
  try {
    const { payload } = await jwtVerify(token, key);
    userId = typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null; // expired or tampered token
  }
  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, isDemo: true },
  });
}

export function unauthorized() {
  return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
}

// The WebAuthn challenge lives in a short-lived signed cookie between the two steps.
export async function setChallenge(data: ChallengeData) {
  const token = await sign({ ...data }, CHALLENGE_SECONDS);
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, token, { ...cookieBase, maxAge: CHALLENGE_SECONDS });
}

// Reads and immediately deletes the challenge, so each one can be used only once.
export async function takeChallenge(): Promise<ChallengeData | null> {
  const key = secretKey();
  const store = await cookies();
  const token = store.get(CHALLENGE_COOKIE)?.value;
  store.delete(CHALLENGE_COOKIE);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key);
    return payload as unknown as ChallengeData;
  } catch {
    return null;
  }
}