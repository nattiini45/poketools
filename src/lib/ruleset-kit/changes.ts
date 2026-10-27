/**
 * Counts and lists of what a document changes relative to its base: the numbers behind the editor's summary ("vs Gen 9
 * OU: +3 banned, -1 unbanned") and the change list with a revert button per entry. Pure and client-safe.
 */
import type { PresetList, PresetRules } from '@/lib/pkmn/preset-rules';
import { presetRulesOut } from './entry-state';
import { RULESET_CATEGORIES, type CategoryRules, type RulesetCategory, type RulesetDocument } from './types';

export interface CategoryCounts {
  /** The base's own list is a block list, an allowlist (a roster), or there is no base. */
  baseMode: 'block' | 'allow' | null;
  /** Entries on the base's list. */
  baseCount: number;
  /** Entries the document bans that the base does not already rule out. */
  youBanned: number;
  /** Entries the document makes legal although the base rules them out. */
  youUnbanned: number;
  /** Size of the document's allowlist; null in block mode. */
  allowed: number | null;
}

export function categoryCounts(rules: CategoryRules, base: PresetList | null): CategoryCounts {
  return {
    baseMode: base?.mode ?? null,
    baseCount: base?.ids.length ?? 0,
    youBanned: rules.allow === null ? rules.ban.filter((id) => !presetRulesOut(base, id)).length : 0,
    youUnbanned: rules.allow === null ? rules.unban.filter((id) => presetRulesOut(base, id)).length : 0,
    allowed: rules.allow === null ? null : rules.allow.length,
  };
}

export interface DocumentCounts {
  perCategory: Record<RulesetCategory, CategoryCounts>;
  youBanned: number;
  youUnbanned: number;
  /** Clauses added to and removed from the preset's. */
  clausesAdded: number;
  clausesRemoved: number;
  /** Total number of own changes (bans, unbans, allowlist entries, clause switches). */
  total: number;
}

/** The counts of a whole document against its resolved base preset (null for a blank base). */
export function documentCounts(doc: RulesetDocument, preset: PresetRules | null): DocumentCounts {
  const base = doc.base.kind === 'preset' ? preset : null;
  const perCategory = Object.fromEntries(
    RULESET_CATEGORIES.map((category) => [category, categoryCounts(doc[category], base?.[category] ?? null)]),
  ) as Record<RulesetCategory, CategoryCounts>;
  let youBanned = 0;
  let youUnbanned = 0;
  let allowed = 0;
  for (const category of RULESET_CATEGORIES) {
    youBanned += perCategory[category].youBanned;
    youUnbanned += perCategory[category].youUnbanned;
    allowed += perCategory[category].allowed ?? 0;
  }
  const clausesAdded = doc.clauses.add.length;
  const clausesRemoved = doc.clauses.remove.length;
  return { perCategory, youBanned, youUnbanned, clausesAdded, clausesRemoved, total: youBanned + youUnbanned + allowed + clausesAdded + clausesRemoved };
}

export interface DocumentChange {
  category: RulesetCategory;
  id: string;
  /** `ban` and `unban` are relative to the base; `allow` is an allowlist entry. */
  kind: 'ban' | 'unban' | 'allow';
}

/** Every entry the document lists, in category order: the change list of the summary. */
export function listChanges(doc: RulesetDocument): DocumentChange[] {
  const out: DocumentChange[] = [];
  for (const category of RULESET_CATEGORIES) {
    const rules = doc[category];
    for (const id of rules.ban) out.push({ category, id, kind: 'ban' });
    for (const id of rules.unban) out.push({ category, id, kind: 'unban' });
    for (const id of rules.allow ?? []) out.push({ category, id, kind: 'allow' });
  }
  return out;
}
