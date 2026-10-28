/**
 * Draft-tool Discord notifications.
 * Server only.
 *
 * `draft_claim_notifications` claims every due event in SQL (claim markers on
 * the slot / pool, `FOR UPDATE SKIP LOCKED`), so each event goes out exactly
 * once whoever claims it: the cron (`/api/cron/draft-ticks`), the pick route's
 * `after()`, the redraft publish route's `after()` and
 * `scheduleDraftNotifications` (state / my-turn polls that resolved a timeout,
 * admin writes that move the clock). Turn pings go out for live AND slow
 * drafts; the 8h/4h/1h reminders are slow-only. This module turns the
 * claims into language-neutral payloads (§11.3: no locale, canonical English
 * Pokémon names) and fires each with `void emitDiscordEvent(...)`; the
 * language is chosen per webhook inside `emitAsync`. The same claims also go
 * out as Web Push (`src/lib/push/draft-alerts.ts`, docs/push.md): turn pings
 * and reminders to the slot's player, the redraft publication to every
 * participant, in each device's stored language.
 *
 * The narrow reads it needs live in the query modules: `listTickablePools`
 * (`drafts-queue`, re-exported for the cron route) and `getPublishedDrops`
 * (`drafts-redraft`).
 */
import 'server-only';

import { after } from 'next/server';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { pushDraftClaims } from '@/lib/push/draft-alerts';
import { listTickablePools } from '@/lib/supabase/queries/drafts-queue';
import { getPublishedDrops, type PublishedDrop } from '@/lib/supabase/queries/drafts-redraft';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import type { DiscordEventPayload, DraftRedraftPublishedData } from '@/types/discord';

// ── Claim shapes (B-RPC, `draft_claim_notifications`) ──────────────

export type ReminderThreshold = '8h' | '4h' | '1h';

export interface TurnStartedClaim {
  type: 'turn_started';
  pool_id: string;
  season_id: string;
  slot_id: string;
  player_id: string;
  deadline_at: string;
  timer_seconds: number;
  round: number;
  pick_number: number;
  kind: 'normal' | 'makeup';
  mode: 'live' | 'slow';
}

export interface TurnReminderClaim extends Omit<TurnStartedClaim, 'type'> {
  type: 'turn_reminder';
  threshold: ReminderThreshold;
}

export interface AdminAlertClaim {
  type: 'admin_alert';
  alert_kind: 'blocked' | 'inplace_timeout';
  pool_id: string;
  season_id: string;
  slot_id: string;
  player_id: string;
}

export interface RedraftPublishedClaim {
  type: 'redraft_published';
  pool_id: string;
  season_id: string;
}

export type NotificationClaim = TurnStartedClaim | TurnReminderClaim | AdminAlertClaim | RedraftPublishedClaim;

// ── Parsing (the RPC answers jsonb; never trust its shape blindly) ──

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const str = (r: Raw, k: string): string | null => (typeof r[k] === 'string' && r[k] !== '' ? (r[k] as string) : null);
const num = (r: Raw, k: string): number | null => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : null);

function parseTurn(r: Raw): Omit<TurnStartedClaim, 'type'> | null {
  const pool_id = str(r, 'pool_id');
  const season_id = str(r, 'season_id');
  const slot_id = str(r, 'slot_id');
  const player_id = str(r, 'player_id');
  const deadline_at = str(r, 'deadline_at');
  const timer_seconds = num(r, 'timer_seconds');
  const round = num(r, 'round');
  const pick_number = num(r, 'pick_number');
  if (!pool_id || !season_id || !slot_id || !player_id || !deadline_at) return null;
  if (timer_seconds === null || round === null || pick_number === null) return null;
  return {
    pool_id,
    season_id,
    slot_id,
    player_id,
    deadline_at,
    timer_seconds,
    round,
    pick_number,
    kind: r.kind === 'makeup' ? 'makeup' : 'normal',
    mode: r.mode === 'live' ? 'live' : 'slow',
  };
}

function parseClaim(r: Raw): NotificationClaim | null {
  switch (r.type) {
    case 'turn_started': {
      const turn = parseTurn(r);
      return turn ? { type: 'turn_started', ...turn } : null;
    }
    case 'turn_reminder': {
      const turn = parseTurn(r);
      const threshold = r.threshold;
      if (!turn || (threshold !== '8h' && threshold !== '4h' && threshold !== '1h')) return null;
      return { type: 'turn_reminder', ...turn, threshold };
    }
    case 'admin_alert': {
      const pool_id = str(r, 'pool_id');
      const season_id = str(r, 'season_id');
      const slot_id = str(r, 'slot_id');
      const player_id = str(r, 'player_id');
      const alert_kind = r.alert_kind;
      if (!pool_id || !season_id || !slot_id || !player_id) return null;
      if (alert_kind !== 'blocked' && alert_kind !== 'inplace_timeout') return null;
      return { type: 'admin_alert', alert_kind, pool_id, season_id, slot_id, player_id };
    }
    case 'redraft_published': {
      const pool_id = str(r, 'pool_id');
      const season_id = str(r, 'season_id');
      return pool_id && season_id ? { type: 'redraft_published', pool_id, season_id } : null;
    }
    default:
      return null;
  }
}

/** The RPC result → claims; malformed entries are logged and skipped (their markers are already set). */
export function parseNotificationClaims(raw: unknown): NotificationClaim[] {
  if (!Array.isArray(raw)) return [];
  const claims: NotificationClaim[] = [];
  for (const item of raw) {
    const claim = isRecord(item) ? parseClaim(item) : null;
    if (claim) claims.push(claim);
    else console.error('[draft/notify] skipping a malformed notification claim:', item);
  }
  return claims;
}

// ── Reads ───────────────────────────────────────────────────────────

// The cron route imports `listTickablePools` from here; the read lives in the queue query module.
export { listTickablePools };

// ── Dispatch ────────────────────────────────────────────────────────

const EVENT_TYPE = {
  turn_started: 'draft_turn_started',
  turn_reminder: 'draft_turn_reminder',
  admin_alert: 'draft_slot_blocked',
  redraft_published: 'draft_redraft_published',
} as const satisfies Record<NotificationClaim['type'], DiscordEventPayload['event_type']>;

/**
 * Send the claimed events (§7.9). Accepts the raw RPC result
 * (`callDraftRpc('draft_claim_notifications', …)`) or parsed claims. Every
 * Discord call is fire-and-forget; this never throws (a failed read is logged
 * and its events are lost, like any failed webhook post). Returns the number
 * of events handed to `emitDiscordEvent`.
 */
export async function dispatchDraftNotifications(rawClaims: unknown): Promise<number> {
  try {
    const claims = parseNotificationClaims(rawClaims);
    if (claims.length === 0) return 0;

    const redraftClaims = claims.filter((c): c is RedraftPublishedClaim => c.type === 'redraft_published');
    const dropsByPool = new Map<string, PublishedDrop[]>();
    await Promise.all(
      redraftClaims.map(async (c) => {
        dropsByPool.set(c.pool_id, await getPublishedDrops(c.pool_id));
      }),
    );

    const playerIds = new Set<string>();
    for (const c of claims) if (c.type !== 'redraft_published') playerIds.add(c.player_id);
    for (const drops of dropsByPool.values()) for (const d of drops) playerIds.add(d.player_id);
    const seasonIds = [...new Set(claims.map((c) => c.season_id))];

    const [players, seasons] = await Promise.all([
      getPlayersByIds([...playerIds]),
      Promise.all(seasonIds.map(async (id) => [id, await getSeasonById(id)] as const)),
    ]);
    const seasonName = new Map(seasons.map(([id, s]) => [id, s?.name ?? ''] as const));
    const nameOf = (id: string) => players.get(id)?.name ?? '';
    // Email-only players have no Discord ID: the embed then skips the @mention.
    const discordOf = (id: string) => players.get(id)?.discord_id ?? undefined;

    let sent = 0;
    for (const c of claims) {
      const base = { event_type: EVENT_TYPE[c.type], tournament_id: '', season_id: c.season_id };
      const season_name = seasonName.get(c.season_id) ?? '';
      let payload: DiscordEventPayload;
      switch (c.type) {
        case 'turn_started':
        case 'turn_reminder': {
          const turn = {
            season_name,
            player_name: nameOf(c.player_id),
            player_discord_id: discordOf(c.player_id),
            deadline_at: c.deadline_at,
            timer_seconds: c.timer_seconds,
            mode: c.mode,
            round: c.round,
            pick_number: c.pick_number,
            is_makeup: c.kind === 'makeup',
          };
          payload =
            c.type === 'turn_started'
              ? { ...base, data: { kind: 'draft_turn', ...turn } }
              : { ...base, data: { kind: 'draft_turn_reminder', ...turn, threshold: c.threshold } };
          break;
        }
        case 'admin_alert':
          payload = {
            ...base,
            data: { kind: 'draft_admin_alert', season_name, player_name: nameOf(c.player_id), alert_kind: c.alert_kind },
          };
          break;
        case 'redraft_published': {
          const drops: DraftRedraftPublishedData['drops'] = (dropsByPool.get(c.pool_id) ?? [])
            .map((d) => ({ ...d, player_name: nameOf(d.player_id) }))
            .sort((a, b) => a.player_name.localeCompare(b.player_name) || a.label.localeCompare(b.label))
            .map((d) => ({
              player_name: d.player_name,
              base: d.base,
              stage3: d.stage3,
              transferred_real_kills: d.transferred_real_kills,
            }));
          payload = { ...base, data: { kind: 'draft_redraft_published', season_name, drops } };
          break;
        }
      }
      void emitDiscordEvent(payload);
      sent += 1;
    }
    // Web Push (docs/push.md): the same claims, the same exactly-once guarantee, the slot's player (or the pool).
    // Awaited so the sends finish before the function is frozen (this runs in `after()` or the cron); it never
    // throws, and a deployment without a VAPID configuration returns before any read.
    try {
      await pushDraftClaims(claims, (seasonId) => seasonName.get(seasonId) ?? '');
    } catch (err) {
      console.error('[draft/notify] dispatching push alerts failed:', err);
    }
    return sent;
  } catch (err) {
    console.error('[draft/notify] dispatching draft notifications failed:', err);
    return 0;
  }
}

/**
 * Claim and send one pool's due notifications after the response
 * (`next/server` `after()`): the next slot's turn ping goes out now instead of
 * at the next cron run. Call it only when the request may have activated a slot
 * (a resolved timeout, a publish, an admin write that moves the clock), never on
 * every poll (Supabase quota). Fire-and-forget: never throws, never delays the
 * response; a failed claim is logged and the cron picks the events up later.
 */
export function scheduleDraftNotifications(poolId: string): void {
  try {
    after(async () => {
      // Awaited inside after() so the reads finish before the function is frozen; the posts stay fire-and-forget.
      try {
        await dispatchDraftNotifications(await callDraftRpc('draft_claim_notifications', { p_pool_id: poolId }));
      } catch (err) {
        console.error('[draft/notify] claiming draft notifications failed:', err);
      }
    });
  } catch (err) {
    console.error('[draft/notify] scheduling draft notifications failed:', err);
  }
}
