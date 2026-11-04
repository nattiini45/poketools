/**
 * Tunables of an attached format: the document's defaults overridden by the values an admin stored in
 * `season_formats.tunables`. A stored value that does not fit its definition (type, range, enum values, table size) is
 * ignored, the default stays, and the problem is reported so the admin view can show it. Pure and client-safe.
 */
import type { Json } from '@/types/database';
import type { FormatDefinition, TunableDef } from '@/lib/format-kit/types';
import { toMap } from '@/lib/studio-core/keys';
import type { TunableValue } from './types';

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
