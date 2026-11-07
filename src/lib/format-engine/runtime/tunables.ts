/**
 * Tunables of an attached format: the document's defaults overridden by the values an admin stored in
 * `season_formats.tunables`. A stored value that does not fit its definition (type, range, enum values, table size) is
 * ignored, the default stays, and the problem is reported so the admin view can show it. Pure and client-safe.
 *
 * Who may still change a tunable: `editable_until` of its definition. `start` is open until the league starts, `lock`
 * until the first action of the format is locked (the picks that read the numbers are then final), `always` never closes.
 * `lockedTunableKeys` answers for a set of keys. NOT WIRED YET: no code writes `season_formats.tunables` today (the
 * column is read, never edited), so `editable_until` is enforced nowhere. The route or query that first writes tunables
 * must call `lockedTunableKeys` before storing and refuse the locked keys.
 */
import type { Json } from '@/types/database';
import type { FormatDefinition, TunableDef } from '@/lib/format-kit/types';
import { own } from './types';
import { toMap } from '@/lib/studio-core/keys';
import type { KitRuntimeState, TunableValue } from './types';

export type TunableIssueCode = 'unknown_key' | 'wrong_type' | 'out_of_range' | 'not_in_values' | 'bad_table';

export interface TunableIssue {
  key: string;
  code: TunableIssueCode;
}

export interface ResolvedTunables {
  values: Record<string, TunableValue>;
  issues: TunableIssue[];
}

const TABLE_MAX = 64;

/** The stored value when it fits `def`, else the reason it does not. */
export function checkTunableValue(def: TunableDef, value: unknown): { ok: true; value: TunableValue } | { ok: false; code: TunableIssueCode } {
  switch (def.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, code: 'wrong_type' };
      if ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) return { ok: false, code: 'out_of_range' };
      return { ok: true, value };
    }
    case 'bool':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false, code: 'wrong_type' };
    case 'enum': {
      if (typeof value !== 'string') return { ok: false, code: 'wrong_type' };
      return def.values?.includes(value) === true ? { ok: true, value } : { ok: false, code: 'not_in_values' };
    }
    case 'table': {
      if (!Array.isArray(value)) return { ok: false, code: 'wrong_type' };
      if (value.length < 1 || value.length > TABLE_MAX || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        return { ok: false, code: 'bad_table' };
      }
      return { ok: true, value: [...(value as number[])] };
    }
  }
}

/** Defaults overridden by valid stored values; `stored` is the jsonb object (anything else counts as empty). */
export function resolveTunables(def: Pick<FormatDefinition, 'tunables'>, stored: Json | undefined): ResolvedTunables {
  const defs = toMap(def.tunables ?? [], (t) => t.key);
  const values: Record<string, TunableValue> = {};
  const issues: TunableIssue[] = [];
  for (const [key, tunable] of defs) values[key] = Array.isArray(tunable.default) ? [...tunable.default] : tunable.default;

  if (stored === null || stored === undefined || typeof stored !== 'object' || Array.isArray(stored)) return { values, issues };
  for (const [key, raw] of Object.entries(stored)) {
    const tunable = defs.get(key);
    if (tunable === undefined) {
      issues.push({ key, code: 'unknown_key' });
      continue;
    }
    const checked = checkTunableValue(tunable, raw);
    if (checked.ok) values[key] = checked.value;
    else issues.push({ key, code: checked.code });
  }
  return { values, issues };
}

export interface TunableEditContext {
  /** The league has started (`format_season_started`). */
  started: boolean;
  /** Some action of the format is locked. */
  actionLocked: boolean;
}

/** The edit context of a league: `started` comes from the league, the lock from the runtime flags. */
export function tunableEditContext(started: boolean, state: Pick<KitRuntimeState, 'flags'>): TunableEditContext {
  const actionLocked = Object.keys(state.flags).some((key) => key.startsWith('action:') && own(state.flags, key) === 'locked');
  return { started, actionLocked };
}

export function isTunableEditable(def: Pick<TunableDef, 'editable_until'>, context: TunableEditContext): boolean {
  switch (def.editable_until) {
    case 'always':
      return true;
    case 'lock':
      return !context.actionLocked;
    case 'start':
      return !context.started;
  }
}

/**
 * The keys of `changes` whose tunable is closed for editing (`editable_until`) and whose value would differ from the stored
 * one. An unknown key is not judged here (`resolveTunables` reports it); a value equal to the stored (or default) one is not
 * a change.
 */
export function lockedTunableKeys(
  def: Pick<FormatDefinition, 'tunables'>,
  current: Readonly<Record<string, TunableValue>>,
  changes: Readonly<Record<string, unknown>>,
  context: TunableEditContext,
): string[] {
  const defs = toMap(def.tunables ?? [], (t) => t.key);
  const out: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const tunable = defs.get(key);
    if (tunable === undefined || isTunableEditable(tunable, context)) continue;
    if (JSON.stringify(own(current, key)) !== JSON.stringify(value)) out.push(key);
  }
  return out;
}
