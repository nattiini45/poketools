/**
 * Draft audit trail reads (draft-backend §8.1 #15, §10.4; package B-ADM).
 *
 * `draft_action_log` is append-only and written by the draft RPCs inside the
 * same transaction as the change they record (BR-12), with the actor, the
 * previous and the new state. This module only reads it, for the pool admin's
 * audit viewer, including the non-public rows.
 *
 * Player names come from `players.name` (a public field); no other player
 * column is selected, so no private data can reach the response.
 */
import 'server-only';

import { supabase } from '@/lib/supabase/client';
import {
  DRAFT_AUDIT_ACTIONS,
  type ActorRole,
  type AuditEntryDTO,
  type DraftAuditAction,
} from '@/types/draft-queue';

export interface DraftAuditQuery {
  poolId: string;
  /** Only these actions (empty or absent = all). */
  actions?: readonly DraftAuditAction[];
  /** Rows about this player (`draft_action_log.player_id`). */
  playerId?: string;
  /** Exclusive upper bound on `draft_action_log.id` (the previous page's `next_cursor`). */
  cursor?: string;
  /** Page size, 1..200. */
  limit: number;
}

export interface DraftAuditPage {
  entries: AuditEntryDTO[];
  next_cursor: string | null;
}

/** Label of system rows; the client translates it. */
export const SYSTEM_ACTOR_NAME = 'System';

const ACTIONS: ReadonlySet<string> = new Set(DRAFT_AUDIT_ACTIONS);
const ROLES: ReadonlySet<string> = new Set<ActorRole>(['player', 'admin', 'system']);

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as JsonRecord) : null;
}

/**
 * `before`/`after` as an object. Most RPCs log objects; `seats_changed` logs the
 * seat arrays, which are wrapped as `{ value: [...] }` so the DTO stays an object.
 */
function asStateRecord(v: unknown): JsonRecord | null {
  if (v === null || v === undefined) return null;
  return asRecord(v) ?? { value: v };
}

function isAuditAction(v: string): v is DraftAuditAction {
  return ACTIONS.has(v);
}

function isActorRole(v: string): v is ActorRole {
  return ROLES.has(v);
}

interface LogRow {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_role: string;
  action: string;
  player_id: string | null;
  slot_id: string | null;
  pick_id: string | null;
  line_id: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  is_public: boolean;
}

const LOG_COLUMNS =
  'id, occurred_at, actor_id, actor_role, action, player_id, slot_id, pick_id, line_id, before, after, reason, is_public';

/**
 * One page of a pool's audit trail, newest first. At most four reads: the log
 * page, then (only when needed) player names, pick numbers and redraft slot
 * labels for the rows on the page.
 */
export async function listDraftAudit(q: DraftAuditQuery): Promise<DraftAuditPage> {
  let query = supabase
    .from('draft_action_log')
    .select(LOG_COLUMNS)
    .eq('draft_pool_id', q.poolId);
  if (q.actions && q.actions.length > 0) query = query.in('action', [...q.actions]);
  if (q.playerId) query = query.eq('player_id', q.playerId);
  if (q.cursor) query = query.lt('id', q.cursor);

  const { data, error } = await query.order('id', { ascending: false }).limit(q.limit + 1);
  if (error) throw error;

  const all = (data ?? []) as LogRow[];
  const rows = all.slice(0, q.limit);
  const nextCursor = all.length > q.limit && rows.length > 0 ? String(rows[rows.length - 1].id) : null;
  if (rows.length === 0) return { entries: [], next_cursor: null };

  // Related ids on this page only.
  const playerIds = new Set<string>();
  const pickIds = new Set<string>();
  const redraftSlotIds = new Set<string>();
  for (const r of rows) {
    if (r.actor_id) playerIds.add(r.actor_id);
    if (r.player_id) playerIds.add(r.player_id);
    if (r.pick_id) pickIds.add(r.pick_id);
    const after = asRecord(r.after);
    const slotRef = after?.redraft_slot_id;
    if (typeof slotRef === 'string') redraftSlotIds.add(slotRef);
  }

  const names = new Map<string, string>();
  const picks = new Map<string, { pick_number: number | null; redraft_slot_id: string | null }>();
  const labels = new Map<string, string>();

  const [playersRes, picksRes] = await Promise.all([
    playerIds.size > 0
      ? supabase.from('players').select('id, name').in('id', [...playerIds])
      : Promise.resolve({ data: [], error: null }),
    pickIds.size > 0
      ? supabase.from('draft_picks').select('id, pick_number, redraft_slot_id').in('id', [...pickIds])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (playersRes.error) throw playersRes.error;
  if (picksRes.error) throw picksRes.error;
  for (const p of (playersRes.data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name);
  for (const p of (picksRes.data ?? []) as { id: string; pick_number: number | null; redraft_slot_id: string | null }[]) {
    picks.set(p.id, { pick_number: p.pick_number, redraft_slot_id: p.redraft_slot_id });
    if (p.redraft_slot_id) redraftSlotIds.add(p.redraft_slot_id);
  }

  if (redraftSlotIds.size > 0) {
    const { data: slots, error: slotErr } = await supabase
      .from('redraft_slots')
      .select('id, label')
      .in('id', [...redraftSlotIds]);
    if (slotErr) throw slotErr;
    for (const s of (slots ?? []) as { id: string; label: string }[]) labels.set(s.id, s.label);
  }

  const entries: AuditEntryDTO[] = [];
  for (const r of rows) {
    if (!isAuditAction(r.action)) continue; // the CHECK list makes this unreachable
    const role: ActorRole = isActorRole(r.actor_role) ? r.actor_role : 'system';
    const pick = r.pick_id ? picks.get(r.pick_id) : undefined;
    const after = asRecord(r.after);
    const afterSlot = typeof after?.redraft_slot_id === 'string' ? after.redraft_slot_id : null;
    const redraftSlotId = pick?.redraft_slot_id ?? afterSlot;
    entries.push({
      id: String(r.id),
      occurred_at: r.occurred_at,
      actor: {
        player_id: r.actor_id,
        name: role === 'system' || !r.actor_id ? SYSTEM_ACTOR_NAME : (names.get(r.actor_id) ?? ''),
        role,
      },
      action: r.action,
      player_name: r.player_id ? (names.get(r.player_id) ?? null) : null,
      line_id: r.line_id,
      slot_label: redraftSlotId ? (labels.get(redraftSlotId) ?? null) : null,
      pick_number: pick?.pick_number ?? null,
      before: asStateRecord(r.before),
      after: asStateRecord(r.after),
      note: r.reason,
      is_public: r.is_public,
    });
  }

  return { entries, next_cursor: nextCursor };
}
