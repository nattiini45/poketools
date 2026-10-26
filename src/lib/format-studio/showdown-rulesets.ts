/**
 * The ruleset rows behind a format's Showdown stages. Server only.
 *
 * A stage whose ruleset is a Showdown format (`{ kind: 'showdown', format: 'gen9ou' }`) only pre-picks settings in
 * the document. When the format is attached to a league, each distinct Showdown format becomes one normal ruleset
 * row that the admin can then tweak in the ruleset builder. The row is built exactly like the builder's base-format
 * pre-fill: `applyDefaults` (the form's own function) on an empty form with the format's `getFormatDefaults`, and
 * saved with `createRuleset`. There is no second copy of the clause and ban logic here.
 *
 * `ensureShowdownRulesets` creates one row per format and reuses the one a previous attach of the same league
 * recorded (`season_formats.showdown_rulesets`) while it still exists, so a re-attach keeps what the admin edited.
 * It returns the ids it created: when the attach that follows fails, the caller discards them
 * (`discardRulesets`), so a failed attach leaves no orphan row. What a re-attach or a detach leaves unused is
 * deleted by the database functions, in the same transaction as the stages.
 */
import 'server-only';

import { applyDefaults, EMPTY_RULESET_FORM } from '@/components/ruleset/ruleset-form';
import { getShowdownFormat } from '@/lib/format-kit/client';
import { getFormatDefaults } from '@/lib/pkmn/formats';
import { createRuleset, deleteRuleset } from '@/lib/supabase/queries/rulesets';
import { getExistingRulesetIds } from '@/lib/supabase/queries/season-formats';
import { FIELD_LIMITS } from '@/lib/validation/schemas';
import type { RulesetFormData } from '@/types/ruleset';

export interface EnsureShowdownRulesetsInput {
  /** The distinct Showdown format ids the attached stages name. */
  formats: readonly string[];
  /** The league's name: the rulesets are named after it, so the admin finds them in the ruleset list. */
  leagueName: string;
  /** The admin who attaches; recorded as the creator of the new rows. */
  actorId: string;
  /** The map the league's previous attach recorded ({ format id: ruleset id }). */
  recorded: Readonly<Record<string, string>>;
}

export interface EnsuredShowdownRulesets {
  /** { format id: ruleset id } for every requested format. */
  rulesetIds: Map<string, string>;
  /** The ids created by this call (not the reused ones). */
  created: string[];
}

/** The name of a league's ruleset for a Showdown format ("Spring League · Gen 9 OU"), cut to the name limit. */
export function showdownRulesetName(leagueName: string, formatName: string): string {
  return `${leagueName.trim()} · ${formatName}`.slice(0, FIELD_LIMITS.NAME).trim();
}

/** The form a new ruleset for the format starts from: the builder's empty form with the format's defaults applied. */
export function showdownRulesetForm(formatId: string, name: string): RulesetFormData {
  return applyDefaults({ ...EMPTY_RULESET_FORM, name }, formatId, getFormatDefaults(formatId));
}

/** Deletes rulesets a failed attach created. Best effort: a failure is logged and never hides the original error. */
export async function discardRulesets(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    try {
      await deleteRuleset(id);
    } catch (err) {
      console.error(`[format-attach] could not discard ruleset ${id}`, err);
    }
  }
}

/**
 * One ruleset row per Showdown format: the recorded one when it still exists, else a new one. If creating one
 * fails, the rows this call already created are discarded before the error is thrown.
 */
export async function ensureShowdownRulesets(input: EnsureShowdownRulesetsInput): Promise<EnsuredShowdownRulesets> {
  const { formats, leagueName, actorId, recorded } = input;
  const rulesetIds = new Map<string, string>();
  const created: string[] = [];
  if (formats.length === 0) return { rulesetIds, created };

  const existing = await getExistingRulesetIds(formats.flatMap((format) => (recorded[format] === undefined ? [] : [recorded[format]])));
  try {
    for (const format of formats) {
      const known = getShowdownFormat(format);
      if (known === undefined) throw new Error(`ensureShowdownRulesets: unknown Showdown format "${format}"`);
      const reuse = recorded[format];
      if (reuse !== undefined && existing.has(reuse)) {
        rulesetIds.set(format, reuse);
        continue;
      }
      const ruleset = await createRuleset(showdownRulesetForm(format, showdownRulesetName(leagueName, known.name)), actorId);
      created.push(ruleset.id);
      rulesetIds.set(format, ruleset.id);
    }
  } catch (err) {
    await discardRulesets(created);
    throw err;
  }
  return { rulesetIds, created };
}
