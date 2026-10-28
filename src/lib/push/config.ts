/**
 * Web Push configuration (docs/push.md, "Configuration"). Server only.
 *
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` must all be set and valid, otherwise
 * push is DISABLED: `readPushConfig()` answers null, the server sends nothing and the subscribe route answers
 * 503 `push_disabled`. A bad value never throws at request time and never stops the server at boot; it is
 * reported once per process with the variable NAMES and a static reason, never a value.
 *
 * Checks beyond "is set": the public key is an uncompressed P-256 point (65 bytes, base64url), the private key
 * 32 bytes, the private key really belongs to the public one (a pair mix-up makes every send fail with 403 from
 * the push service), and the subject is a `mailto:` address or an https URL.
 */
import 'server-only';

import { createECDH } from 'node:crypto';
import { pushEnvSchema } from '@/lib/env';

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function decodeBase64Url(value: string): Buffer | null {
  return BASE64URL.test(value) ? Buffer.from(value, 'base64url') : null;
}

function validSubject(subject: string): boolean {
  if (subject.startsWith('mailto:')) return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject);
  try {
    const url = new URL(subject);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

/** Why the configuration is unusable (static strings plus variable names), or null when it is fine. */
function problemsOf(env: Record<string, string | undefined>): { config: PushConfig | null; problems: string[] } {
  const parsed = pushEnvSchema.safeParse({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: env.VAPID_SUBJECT,
  });
  if (!parsed.success) return { config: null, problems: ['NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (unreadable)'] };
  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = parsed.data;

  const problems: string[] = [];
  if (!publicKey) problems.push('NEXT_PUBLIC_VAPID_PUBLIC_KEY (missing)');
  if (!privateKey) problems.push('VAPID_PRIVATE_KEY (missing)');
  if (!subject) problems.push('VAPID_SUBJECT (missing)');
  if (!publicKey || !privateKey || !subject) return { config: null, problems };

  const publicBytes = decodeBase64Url(publicKey);
  if (!publicBytes || publicBytes.length !== 65 || publicBytes[0] !== 0x04) {
    problems.push('NEXT_PUBLIC_VAPID_PUBLIC_KEY (not a base64url P-256 public key)');
  }
  const privateBytes = decodeBase64Url(privateKey);
  if (!privateBytes || privateBytes.length !== 32) problems.push('VAPID_PRIVATE_KEY (not a base64url P-256 private key)');
  if (!validSubject(subject)) problems.push('VAPID_SUBJECT (must be a mailto: address or an https URL)');
  if (problems.length > 0 || !publicBytes || !privateBytes) return { config: null, problems };

  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(privateBytes);
    if (!ecdh.getPublicKey().equals(publicBytes)) {
      return { config: null, problems: ['VAPID_PRIVATE_KEY (does not match NEXT_PUBLIC_VAPID_PUBLIC_KEY)'] };
    }
  } catch {
    return { config: null, problems: ['VAPID_PRIVATE_KEY (not a valid P-256 private key)'] };
  }
  return { config: { publicKey, privateKey, subject }, problems: [] };
}

let warned = false;

/** Forget the one-time warning (tests). */
export function resetPushConfigWarning(): void {
  warned = false;
}

/** The usable configuration, or null when push is disabled (one warning per process says why). */
export function readPushConfig(env: Record<string, string | undefined> = process.env): PushConfig | null {
  const { config, problems } = problemsOf(env);
  if (!config && !warned) {
    warned = true;
    console.warn(`[push] Web Push is disabled until these are fixed: ${problems.join('; ')}`);
  }
  return config;
}
