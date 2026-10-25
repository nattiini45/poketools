/**
 * How the History panel of `/admin/matches/[id]` reads the `changes` of an
 * audit event. Pure and client-safe: it only picks out the fields the panel
 * knows how to word (status, winner, scheduled time, notes) and maps player
 * ids to names; the component translates and formats the result.
 */
import type { MatchHistoryEntry } from '@/lib/admin/match-detail';

/** One changed field of an event, ready to be worded. */
export interface HistoryChangeItem {
  kind: 'status' | 'winner' | 'scheduled' | 'notes';
  /** The raw status or note text, a player name, or an ISO instant; null when unset. */
  before: string | null;
  after: string | null;
}

export interface HistoryPlayer {
  id: string;
  name: string;
}

type Changes = NonNullable<MatchHistoryEntry['changes']>;

/** A string, or null for a cleared value; anything else is malformed. */
type Read = { ok: true; value: string | null } | { ok: false };

function readText(value: unknown): Read {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === 'string') return { ok: true, value: value === '' ? null : value };
  return { ok: false };
}

function readInstant(value: unknown): Read {
  const text = readText(value);
  if (!text.ok || text.value === null) return text;
  return Number.isNaN(Date.parse(text.value)) ? { ok: false } : text;
}

function item(kind: HistoryChangeItem['kind'], before: Read, after: Read): HistoryChangeItem | null {
  if (!before.ok || !after.ok || before.value === after.value) return null;
  return { kind, before: before.value, after: after.value };
}

/**
 * The fields of `changes` the panel words, in a fixed order. Winner ids become
 * the player's name; an entry is skipped when it is not a known field, has a
 * value of the wrong type, names a player of neither side, or did not change.
 */
export function describeHistoryChanges(
  changes: Changes | null | undefined,
  players: readonly HistoryPlayer[],
): HistoryChangeItem[] {
  if (!changes) return [];
  const nameOf = (value: unknown): Read => {
    const id = readText(value);
    if (!id.ok || id.value === null) return id;
    const player = players.find((p) => p.id === id.value);
    return player ? { ok: true, value: player.name } : { ok: false };
  };
  // A value that is not a { before, after } pair is malformed: the field is skipped.
  const pair = (key: string): { before: unknown; after: unknown } | null => {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) return null;
    const entry: unknown = changes[key];
    return typeof entry === 'object' && entry !== null && 'before' in entry && 'after' in entry
      ? (entry as { before: unknown; after: unknown })
      : null;
  };

  const status = pair('status');
  const winner = pair('winner_id');
  const scheduled = pair('scheduled_at');
  const notes = pair('notes');
  const items: (HistoryChangeItem | null)[] = [
    status && item('status', readText(status.before), readText(status.after)),
    winner && item('winner', nameOf(winner.before), nameOf(winner.after)),
    scheduled && item('scheduled', readInstant(scheduled.before), readInstant(scheduled.after)),
    notes && item('notes', readText(notes.before), readText(notes.after)),
  ];
  return items.filter((entry): entry is HistoryChangeItem => entry !== null);
}
