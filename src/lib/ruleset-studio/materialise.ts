import 'server-only';
/**
 * The rulesets behind a format's rule-preset stages. Server only.
 *
 * A stage whose ruleset is a rule preset (`{ kind: 'preset', preset: 'gen9ou' }`) only pre-picks settings in the format
 * document. When the format is attached to a league, each distinct preset becomes one ruleset DEFINITION owned by that
 * league: private to its owner, `season_id` set (so the admins of the league manage it too), with the preset as its base
 * and no changes, published as version 1 (the effective rules, including a roster or Little Cup allowlist, are computed by
 * the ruleset compile at that publish). The phase pins that version. The admin can then change the ruleset in the studio:
 * a new version for the league to move to.
 *
 * `ensurePresetRulesets` creates one definition per preset and reuses the one a previous attach of the same league recorded
 * (`season_formats.preset_rulesets`, a map of preset id to DEFINITION id) while it still has a published version, pinning its
 * CURRENT head, so a re-attach keeps what the admin edited. It returns the definitions it created: when the attach that
 * follows fails, the caller discards them (`discardMaterialised`), so a failed attach leaves no orphan row. What a
 * re-attach or a detach leaves unused is deleted by the database functions, in the same transaction as the stages.
 */
import { ltext } from '@/lib/format-kit';
import { getRulesetPreset } from '@/lib/format-kit/client';
import { deleteRulesetDefinition } from '@/lib/supabase/queries/ruleset-definitions';
import { getPublishedRulesetHeads } from '@/lib/supabase/queries/season-formats';
import { FIELD_LIMITS } from '@/lib/validation/schemas';
import { newRulesetDocument } from './document';
import { createPublished } from './library';

export interface EnsurePresetRulesetsInput {
  /** The distinct rule preset ids the attached stages name. */
  presets: readonly string[];
  /** The league's name: the rulesets are named after it, so the admin finds them in the ruleset list. */
  leagueName: string;
  /** The league the rulesets belong to (`ruleset_definitions.season_id`). */
  seasonId: string;
  /** The admin who attaches; recorded as the owner of the new rulesets. */
  actorId: string;
  /** The map the league's previous attach recorded ({ preset id: ruleset definition id }). */
  recorded: Readonly<Record<string, string>>;
}

export interface EnsuredPresetRulesets {
  /** { preset id: definition id } for every requested preset: what `season_formats.preset_rulesets` records. */
  definitionIds: Map<string, string>;
  /** { preset id: version id } for every requested preset: what the preset's stages pin. */
  versionIds: Map<string, string>;
  /** The definition ids created by this call (not the reused ones). */
  created: string[];
}

/** The name of a league's ruleset for a rule preset ("Spring League · Gen 9 OU"), cut to the name limit. */
export function presetRulesetName(leagueName: string, presetName: string): string {
  return `${leagueName.trim()} · ${presetName}`.slice(0, FIELD_LIMITS.NAME).trim();
}

/** Deletes definitions a failed attach created. Best effort: a failure is logged and never hides the original error. */
export async function discardMaterialised(definitionIds: readonly string[]): Promise<void> {
  for (const id of definitionIds) {
    try {
      await deleteRulesetDefinition(id);
    } catch (err) {
      console.error(`[format-attach] could not discard ruleset ${id}`, err);
    }
  }
}

/**
 * One ruleset per rule preset: the recorded one when it still has a published version (its head is pinned), else a new
 * one. If creating one fails, the definitions this call already created are discarded before the error is thrown.
 */
export async function ensurePresetRulesets(input: EnsurePresetRulesetsInput): Promise<EnsuredPresetRulesets> {
  const { presets, leagueName, seasonId, actorId, recorded } = input;
  const definitionIds = new Map<string, string>();
  const versionIds = new Map<string, string>();
  const created: string[] = [];
  if (presets.length === 0) return { definitionIds, versionIds, created };

  const heads = await getPublishedRulesetHeads(presets.flatMap((preset) => (recorded[preset] === undefined ? [] : [recorded[preset]])));
  try {
    for (const preset of presets) {
      const known = getRulesetPreset(preset);
      if (known === undefined) throw new Error(`ensurePresetRulesets: unknown rule preset "${preset}"`);
      const reuse = recorded[preset];
      const head = reuse === undefined ? undefined : heads.get(reuse);
      if (reuse !== undefined && head !== undefined) {
        definitionIds.set(preset, reuse);
        versionIds.set(preset, head);
        continue;
      }
      const name = presetRulesetName(leagueName, known.name);
      const { definitionId, versionId } = await createPublished({
        name: ltext('en', name),
        slugBase: `${leagueName} ${preset}`,
        document: newRulesetDocument(name, 'en', preset) as unknown as Record<string, unknown>,
        ownerId: actorId,
        kind: 'custom',
        visibility: 'private',
        seasonId,
        changelog: ltext('en', `Created for the format of ${leagueName.trim()}`.slice(0, 200)),
      });
      created.push(definitionId);
      definitionIds.set(preset, definitionId);
      versionIds.set(preset, versionId);
    }
  } catch (err) {
    await discardMaterialised(created);
    throw err;
  }
  return { definitionIds, versionIds, created };
}
