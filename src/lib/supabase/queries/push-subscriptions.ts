/**
 * `push_subscriptions` (migration 20261028120000, docs/push.md): the Web Push endpoints of a player's devices.
 * Service-role reads and writes only (RLS on, no policies). Callers pass the player id from a live `require*`
 * guard, never from a body.
 *
 * Two audiences:
 * - the player's own routes (`/api/push/subscriptions`) use `upsertPushSubscription`, `listPushDevices`,
 *   `deletePushSubscriptionByEndpoint` / `ById`. They NEVER select `p256dh`/`auth`, and the device list does not
 *   return the endpoint either (a hash stands in, so a browser can tell which row is itself);
 * - the sender (`src/lib/push/send.ts`) uses `listPushTargets` (full rows, keys included, server-internal) and the
 *   bookkeeping writes `markPushSuccess` / `markPushFailure` / `deletePushSubscriptionsByIds`.
 */
import 'server-only';

import { createHash } from 'node:crypto';
import { supabase } from '../client';
import type { Locale } from '@/i18n/config';

/** Devices one player may keep; the oldest is dropped when a new one is added past the cap. */
export const MAX_PUSH_DEVICES_PER_PLAYER = 10;

export interface PushDevice {
  id: string;
  label: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  /** First 16 hex chars of sha256(endpoint): lets a browser recognise its own row without the endpoint leaving the server. */
  fingerprint: string;
}

/** A full row for the sender. Server-internal: carries the keys. */
export interface PushTarget {
  id: string;
  playerId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: Locale;
  failureCount: number;
}

export function endpointFingerprint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

export interface UpsertPushSubscriptionInput {
  playerId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: Locale;
  userAgentLabel: string | null;
}

/**
 * Stores or refreshes a device. `endpoint` is unique across players: a browser that now belongs to another player
 * re-binds the row to that player. A refreshed row starts a clean failure count. Afterwards the player's oldest
 * devices beyond {@link MAX_PUSH_DEVICES_PER_PLAYER} are removed (never the one just stored); the number removed is
 * returned.
 */
export async function upsertPushSubscription(input: UpsertPushSubscriptionInput): Promise<{ dropped: number }> {
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      player_id: input.playerId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      locale: input.locale,
      user_agent_label: input.userAgentLabel,
      failure_count: 0,
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;

  const { data, error: listError } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint')
    .eq('player_id', input.playerId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (listError) throw listError;

  const rows = data ?? [];
  const surplus = rows.length - MAX_PUSH_DEVICES_PER_PLAYER;
  if (surplus <= 0) return { dropped: 0 };
  const dropIds = rows
    .filter((row) => row.endpoint !== input.endpoint)
    .slice(0, surplus)
    .map((row) => row.id);
  if (dropIds.length === 0) return { dropped: 0 };
  const { error: deleteError } = await supabase.from('push_subscriptions').delete().in('id', dropIds);
  if (deleteError) throw deleteError;
  return { dropped: dropIds.length };
}

/** The player's devices, oldest first. Never selects the keys or hands out the endpoint. */
export async function listPushDevices(playerId: string): Promise<PushDevice[]> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, user_agent_label, created_at, last_success_at')
    .eq('player_id', playerId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.user_agent_label,
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
    fingerprint: endpointFingerprint(row.endpoint),
  }));
}

/** Removes one of the player's own devices by endpoint. Returns how many rows went (0 or 1). */
export async function deletePushSubscriptionByEndpoint(playerId: string, endpoint: string): Promise<number> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('player_id', playerId)
    .eq('endpoint', endpoint)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/** Removes one of the player's own devices by row id. Returns how many rows went (0 or 1). */
export async function deletePushSubscriptionById(playerId: string, id: string): Promise<number> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('player_id', playerId)
    .eq('id', id)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

// ── Sender side ──────────────────────────────────────────────────────

function toLocale(value: string): Locale {
  return value === 'de' ? 'de' : 'en';
}

/** Every device of these players (keys included). One read for the whole fan-out. */
export async function listPushTargets(playerIds: readonly string[]): Promise<PushTarget[]> {
  if (playerIds.length === 0) return [];
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id, player_id, endpoint, p256dh, auth, locale, failure_count')
    .in('player_id', [...playerIds])
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    playerId: row.player_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    locale: toLocale(row.locale),
    failureCount: row.failure_count,
  }));
}

/** The push service accepted a message: stamp the time and clear the failure streak. */
export async function markPushSuccess(ids: readonly string[], at: Date = new Date()): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('push_subscriptions')
    .update({ last_success_at: at.toISOString(), failure_count: 0 })
    .in('id', [...ids]);
  if (error) throw error;
}

/** A send failed for a reason that may pass: record the new streak length. */
export async function markPushFailure(id: string, failureCount: number): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').update({ failure_count: failureCount }).eq('id', id);
  if (error) throw error;
}

/** The push service says the endpoint is gone, or it kept failing: forget the devices. */
export async function deletePushSubscriptionsByIds(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('push_subscriptions').delete().in('id', [...ids]);
  if (error) throw error;
}
