import { createHmac, timingSafeEqual } from 'crypto';

export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * HMAC-signed, expiring intent token: `payload.expiresAtMs.signature`.
 * Used for the Discord account-linking cookie. Payload must not contain '.'
 * (player UUIDs don't).
 */
export function signLinkToken(payload: string, expiresAtMs: number, secret: string): string {
  const exp = String(expiresAtMs);
  const sig = createHmac('sha256', secret).update(`${payload}.${exp}`).digest('hex');
  return `${payload}.${exp}.${sig}`;
}

/** Returns the payload if the token is authentic and unexpired, else null. */
export function verifyLinkToken(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [payload, exp, sig] = parts;
  const expiresAtMs = Number(exp);
  if (!payload || !Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) return null;
  const expected = createHmac('sha256', secret).update(`${payload}.${exp}`).digest('hex');
  if (!timingSafeCompare(sig, expected)) return null;
  return payload;
}
