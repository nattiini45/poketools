/**
 * Browser side of Web Push (docs/push.md, "Client"). Client-safe: no server imports, nothing that touches
 * `window` at module load.
 *
 * - `pushPublicKey()` is the VAPID public key baked into the bundle (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`); empty means
 *   push is not configured and the UI hides every push control.
 * - `detectPushSupport()` tells apart: not possible in this browser (`unsupported`), possible once PokéTools is on
 *   the Home Screen (`install-required`, iOS/iPadOS Safari: Apple exposes Web Push to installed web apps only),
 *   blocked by the user (`denied`), and available.
 * - `swScriptUrl()` is the one URL every registration uses. With the PWA flag off the worker is registered in
 *   `?mode=push` form, which caches nothing (`public/sw.js`), so push never turns the offline shell on.
 * - `enablePush()` / `disablePush()` / `readPushState()` talk to the browser's PushManager and to
 *   `/api/push/subscriptions`. Permission is requested inside `enablePush()` only, which callers run from a click.
 */

import { LOCALES, type Locale } from '@/i18n/config';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';

export const PUSH_API_PATH = '/api/push/subscriptions';
const PWA_ENABLED = process.env.NEXT_PUBLIC_PWA_ENABLED === 'true';
const LOCALE_SYNC_KEY = 'push:locale:v1';

/** The VAPID public key (base64url), or '' when push is not configured for this build. */
export function pushPublicKey(): string {
  return (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim();
}

export function swScriptUrl(): string {
  return PWA_ENABLED ? '/sw.js' : '/sw.js?mode=push';
}

/** True when the service worker should be registered even though the PWA flag is off. */
export function pushRegistersServiceWorker(): boolean {
  return pushPublicKey() !== '';
}

export type PushSupport = 'unsupported' | 'install-required' | 'denied' | 'available';

interface SupportEnv {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission | null;
}

/** The browser facts `detectPushSupport` decides on (kept apart so the decision is testable). */
export function readSupportEnv(): SupportEnv | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { standalone?: boolean };
  let standalone = nav.standalone === true;
  try {
    standalone = standalone || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    // matchMedia unavailable: only navigator.standalone counts.
  }
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: typeof Notification !== 'undefined',
    permission: typeof Notification === 'undefined' ? null : Notification.permission,
  };
}

/** iPhone/iPod/iPad, including iPadOS 13+ which reports a Mac user agent with touch points. */
function isAppleMobile(env: SupportEnv): boolean {
  return /iPhone|iPad|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);
}

/** The iOS/iPadOS version from the UA (`OS 16_4`), or null when it is not stated (iPadOS reports a Mac UA). */
function appleMobileVersion(env: SupportEnv): [number, number] | null {
  const match = /OS (\d+)[_.](\d+)/.exec(env.userAgent);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function detectPushSupport(env: SupportEnv | null = readSupportEnv()): PushSupport {
  if (!env || pushPublicKey() === '') return 'unsupported';
  if (isAppleMobile(env) && !env.standalone) {
    // Web Push on iOS/iPadOS needs 16.4 and an installed (Home Screen) web app; a plain Safari tab has no PushManager.
    const version = appleMobileVersion(env);
    const tooOld = version !== null && (version[0] < 16 || (version[0] === 16 && version[1] < 4));
    return tooOld ? 'unsupported' : 'install-required';
  }
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  return 'available';
}

/** base64url → bytes for `applicationServerKey`. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

// ── Registration lookup ──────────────────────────────────────────────

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** Registers the worker (idempotent) and waits until it is active. */
async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(swScriptUrl());
  return navigator.serviceWorker.ready;
}

// ── Locale sync (the server stores the language a device gets its alerts in) ──

function storedLocale(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_SYNC_KEY);
  } catch {
    return null;
  }
}

function rememberLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_SYNC_KEY, locale);
  } catch {
    // Storage blocked: the next visit re-posts, which is harmless.
  }
}

function forgetLocale(): void {
  try {
    window.localStorage.removeItem(LOCALE_SYNC_KEY);
  } catch {
    // Nothing stored.
  }
}

// ── API ──────────────────────────────────────────────────────────────

export interface PushApiFailure {
  ok: false;
  status: number;
  /** The `{ error, code, params }` body, ready for `useApiErrorText`. */
  error: ApiErrorLike | null;
}

async function failureOf(res: Response): Promise<PushApiFailure> {
  const body: unknown = await res.json().catch(() => null);
  const error = toApiErrorLike(body);
  return { ok: false, status: res.status, error: error.error !== undefined || error.code !== undefined ? error : null };
}

async function postSubscription(sub: PushSubscription, locale: Locale, replaces?: string): Promise<{ ok: true } | PushApiFailure> {
  const json = sub.toJSON();
  const keys = json.keys;
  if (!json.endpoint || !keys?.p256dh || !keys.auth) return { ok: false, status: 0, error: null };
  const res = await fetch(PUSH_API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      locale,
      ...(replaces ? { replaces } : {}),
    }),
  });
  if (!res.ok) return failureOf(res);
  rememberLocale(locale);
  return { ok: true };
}

async function deleteSubscription(endpoint: string): Promise<{ ok: true } | PushApiFailure> {
  const res = await fetch(PUSH_API_PATH, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  // 404: the server no longer knew the device (a 410 cleanup got there first). The goal state is reached.
  if (res.ok || res.status === 404) return { ok: true };
  return failureOf(res);
}

// ── Public operations ────────────────────────────────────────────────

export interface PushState {
  support: PushSupport;
  /** This browser holds a live subscription (and permission is still granted). */
  subscribed: boolean;
  /** The notification permission asks again on enable (never asked, or reset). */
  askable: boolean;
}

export async function readPushState(locale: Locale): Promise<PushState> {
  const env = readSupportEnv();
  const support = detectPushSupport(env);
  if (support !== 'available') return { support, subscribed: false, askable: false };
  const askable = env?.permission === 'default';
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  const subscribed = sub !== null && env?.permission === 'granted';
  // The language of the alerts follows the UI language: tell the server when it changed since the last sync.
  if (sub && subscribed && storedLocale() !== locale) {
    void postSubscription(sub, locale).catch((err: unknown) => console.error('[push] syncing the language failed:', err));
  }
  return { support, subscribed, askable };
}

export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'dismissed' | 'unsupported' }
  | { ok: false; reason: 'failed'; failure: PushApiFailure | null };

/** Asks for permission (must run from a click), subscribes this browser and registers it with the server. */
export async function enablePush(locale: Locale): Promise<EnablePushResult> {
  if (detectPushSupport() === 'unsupported' || detectPushSupport() === 'install-required') return { ok: false, reason: 'unsupported' };
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { ok: false, reason: 'denied' };
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' };

  let sub: PushSubscription | null = null;
  try {
    const reg = await ensureRegistration();
    sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(pushPublicKey()),
    }));
    const posted = await postSubscription(sub, locale);
    if (!posted.ok) {
      // The server did not take it (push disabled, rejected host, rate limit): do not keep a subscription it cannot use.
      await sub.unsubscribe().catch(() => false);
      return { ok: false, reason: 'failed', failure: posted };
    }
    return { ok: true };
  } catch (err) {
    console.error('[push] subscribing failed:', err);
    if (sub) await sub.unsubscribe().catch(() => false);
    return { ok: false, reason: 'failed', failure: null };
  }
}

export type DisablePushResult = { ok: true } | { ok: false; failure: PushApiFailure | null };

/** Removes this browser's subscription from the server and from the PushManager. */
export async function disablePush(): Promise<DisablePushResult> {
  try {
    const reg = await registration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return { ok: true };
    const removed = await deleteSubscription(sub.endpoint);
    if (!removed.ok) return { ok: false, failure: removed };
    await sub.unsubscribe().catch(() => false);
    forgetLocale();
    return { ok: true };
  } catch (err) {
    console.error('[push] unsubscribing failed:', err);
    return { ok: false, failure: null };
  }
}

/** First 16 hex chars of sha256(this browser's endpoint): matches `PushDevice.fingerprint`. Null without a subscription. */
export async function thisDeviceFingerprint(): Promise<string | null> {
  try {
    const reg = await registration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
    return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** Narrows an unknown value to a supported locale (the I18n provider hands over a `Locale`; kept for safety). */
export function asLocale(value: string): Locale {
  return (LOCALES as readonly string[]).includes(value) ? (value as Locale) : 'en';
}
