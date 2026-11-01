/**
 * The local Supabase stack the e2e suite runs against, and nothing else (AGENTS.md, "Automation never spends the
 * Supabase quota"). Loaded by `playwright.config.ts`, so a hosted URL is refused before the app server is started.
 *
 * `.claude/local-db.cjs` (the dev-server preload) derives the stack's URL and keys from `supabase/config.toml`
 * and writes them into `process.env`; that is also what the app server gets, so test and server agree.
 */
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertLoopbackUrl } from '../../src/test/local-stack';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3152);
export const BASE_URL = `http://localhost:${E2E_PORT}`;
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324';

export interface LocalStack {
  url: string;
  anonKey: string;
  serviceKey: string;
}

let stack: LocalStack | null = null;

/** Refuses a non-loopback Supabase URL from the environment, then loads the local stack's values. */
export function localStack(): LocalStack {
  if (stack) return stack;
  const incoming = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (incoming && incoming.trim() !== '') assertLoopbackUrl(incoming, 'NEXT_PUBLIC_SUPABASE_URL');
  assertLoopbackUrl(MAILPIT_URL, 'E2E_MAILPIT_URL');

  process.env.LOCAL_DB_DEV_PORT = String(E2E_PORT);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the CommonJS preload is the single source of the local values
  require(path.resolve(__dirname, '..', '..', '.claude', 'local-db.cjs'));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assertLoopbackUrl(url, 'NEXT_PUBLIC_SUPABASE_URL');
  if (!url || !anonKey || !serviceKey) throw new Error('[e2e] the local stack values could not be derived');
  stack = { url, anonKey, serviceKey };
  return stack;
}

/** A service-role client of the local stack: fixtures only, never an assertion about what a user can do. */
export function serviceClient(): SupabaseClient {
  const { url, serviceKey } = localStack();
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Whether the local Auth container signs new users up without a confirmation mail (`enable_confirmations = false`). */
export async function autoconfirmsSignups(): Promise<boolean> {
  const { url, anonKey } = localStack();
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
  if (!res.ok) throw new Error(`[e2e] GoTrue settings answered ${res.status}`);
  const settings = (await res.json()) as { mailer_autoconfirm?: boolean };
  return settings.mailer_autoconfirm === true;
}

/** The newest mail to `address`, polled for up to `timeoutMs` (Mailpit API). */
export async function waitForMail(address: string, timeoutMs = 30_000): Promise<{ html: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:${address}`);
  for (;;) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
    if (res.ok) {
      const found = (await res.json()) as { messages?: Array<{ ID: string }> };
      const id = found.messages?.[0]?.ID;
      if (id) {
        const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as { HTML?: string; Text?: string };
        return { html: message.HTML ?? '', text: message.Text ?? '' };
      }
    }
    if (Date.now() > deadline) throw new Error(`[e2e] no mail to ${address} within ${timeoutMs} ms (Mailpit ${MAILPIT_URL})`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** The path and query of the confirmation link in a sign-up mail, so it can be opened on the app under test. */
export function confirmationPath(mail: { html: string; text: string }): string {
  const match = /https?:\/\/[^\s"'<>]+\/(auth\/confirm\?[^\s"'<>]+)/.exec(`${mail.html}\n${mail.text}`);
  if (!match) throw new Error('[e2e] the sign-up mail holds no /auth/confirm link');
  return `/${match[1].replace(/&amp;/g, '&')}`;
}
