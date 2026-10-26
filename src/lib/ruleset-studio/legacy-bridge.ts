import 'server-only';
/**
 * The bridge that keeps the old ruleset builder working on top of the ruleset library until the studio replaces it
 * (`POST /api/rulesets`, `PATCH` and `DELETE /api/rulesets/[id]`, site admins only, flat names-in-lists bodies).
 *
 *  - A create makes a `gallery` definition owned by the admin and publishes version 1 from the flat form.
 *  - An update edits the flat fields of the HEAD of the definition that the version id belongs to and publishes the result as
 *    a NEW version. The leagues and phases that pin an older version are not touched: moving them is the pin route. The
 *    answer is the new head (a new id).
 *  - A delete removes the definition when no league or phase pins any of its versions (`ruleset_in_use` otherwise).
 *
 * The flat form cannot express a preset base, an allowlist, an unban of anything but Pokémon, or removed clauses. A ruleset
 * that uses any of them is read-only here (`ruleset_legacy_editor_unsupported`) instead of being flattened and losing rules.
 */
import { ltext } from '@/lib/format-kit';
import { legacyFormToDocument } from '@/lib/ruleset-kit/legacy';
import type { RulesetDocument } from '@/lib/ruleset-kit/types';
import {
  getDefinitionOfVersion,
  getLatestPublishedRulesetVersion,
  getRulesetDefinitionMeta,
  publishRulesetVersion,
  saveRulesetDraft,
} from '@/lib/supabase/queries/ruleset-definitions';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import type { SessionPlayer } from '@/types/auth';
import type { Ruleset, RulesetFormData } from '@/types/ruleset';
import { compileDocument } from './compile.server';
import { RulesetStudioError } from './errors';
import { createPublished, removeDefinition, toActor } from './library';

/** The flat form of a published ruleset, as the old builder shows it. */
export function rulesetToFormData(ruleset: Ruleset): RulesetFormData {
  return {
    name: ruleset.name,
    base_format: ruleset.base_format,
    is_doubles: ruleset.is_doubles,
    clauses: ruleset.clauses,
    banned_pokemon: ruleset.bans.pokemon,
    banned_moves: ruleset.bans.moves,
    banned_items: ruleset.bans.items,
    banned_abilities: ruleset.bans.abilities,
    added_pokemon: ruleset.additions.pokemon,
    custom_rules_string: ruleset.custom_rules_string,
    min_shared_type_pct: ruleset.min_shared_type_pct,
    team_constraints: ruleset.team_constraints,
  };
}

/** True when the flat form can hold everything this document says. */
export function isFlatDocument(doc: RulesetDocument): boolean {
  return (
    doc.base.kind === 'blank' &&
    doc.base.universe === 'standard' &&
    doc.clauses.remove.length === 0 &&
    doc.pokemon.allow === null &&
    doc.moves.allow === null &&
    doc.items.allow === null &&
    doc.abilities.allow === null &&
    doc.moves.unban.length === 0 &&
    doc.items.unban.length === 0 &&
    doc.abilities.unban.length === 0
  );
}

function mustGet(ruleset: Ruleset | null): Ruleset {
  if (ruleset === null) throw new RulesetStudioError('ruleset_not_found');
  return ruleset;
}

/** Creates a `gallery` ruleset from the flat form and returns its first version. `ownerId` is the creating admin (null: the system). */
export async function createLegacyRuleset(ownerId: string | null, form: RulesetFormData): Promise<Ruleset> {
  const document = legacyFormToDocument(form) as unknown as Record<string, unknown>;
  const { versionId } = await createPublished({
    name: ltext('en', form.name.trim() === '' ? 'Ruleset' : form.name.trim()),
    slugBase: form.name,
    document,
    ownerId,
    kind: 'custom',
    visibility: 'gallery',
    seasonId: null,
    changelog: ltext('en', 'Created in the ruleset builder'),
  });
  return mustGet(await getRulesetById(versionId));
}

/**
 * Applies a flat patch to the head of the definition that `versionId` belongs to and publishes a new version. An edit that
 * changes nothing returns the current head. The caller (a site-admin route, or the point-buy ruleset ensure) has authorized
 * the edit; `actorId` is recorded as the publisher.
 */
export async function updateLegacyRuleset(actorId: string | null, versionId: string, patch: Partial<RulesetFormData>): Promise<Ruleset> {
  const found = await getDefinitionOfVersion(versionId);
  if (found === null) throw new RulesetStudioError('ruleset_not_found');
  const meta = await getRulesetDefinitionMeta(found.definition.id);
  if (meta === null) throw new RulesetStudioError('ruleset_not_found');
  const head = await getLatestPublishedRulesetVersion(meta.id);
  if (head === null) throw new RulesetStudioError('ruleset_not_published');
  if (!isFlatDocument(head.spec)) throw new RulesetStudioError('ruleset_legacy_editor_unsupported');

  const current = mustGet(await getRulesetById(head.id));
  const document = legacyFormToDocument({ ...rulesetToFormData(current), ...patch }) as unknown as Record<string, unknown>;
  const { result, catalogVersion } = compileDocument(document);
  if (!result.ok || result.document === null || result.resolved === null || result.content_hash === null || result.resolved_hash === null) {
    throw new RulesetStudioError('ruleset_document_invalid', { count: Math.max(result.diagnostics.filter((d) => d.severity === 'error').length, 1) });
  }
  if (result.content_hash === head.content_hash && result.resolved_hash === head.resolved_hash) return current;

  const saved = await saveRulesetDraft({ id: meta.id, expectedRev: meta.draft_rev, document: result.document, name: result.document.identity.name });
  if (saved === null) throw new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: meta.draft_rev });
  const { versionId: newVersionId } = await publishRulesetVersion({
    definitionId: meta.id,
    expectedRev: saved.draft_rev,
    spec: result.document,
    contentHash: result.content_hash,
    resolved: result.resolved,
    resolvedHash: result.resolved_hash,
    catalogVersion,
    changelog: ltext('en', 'Edited in the ruleset builder'),
    actorId,
  });
  return mustGet(await getRulesetById(newVersionId));
}

/** Deletes the definition behind a version id (409 `ruleset_in_use` while a league or phase pins one of its versions). */
export async function deleteLegacyRuleset(admin: SessionPlayer, versionId: string): Promise<void> {
  const found = await getDefinitionOfVersion(versionId);
  if (found === null) throw new RulesetStudioError('ruleset_not_found');
  await removeDefinition(toActor(admin), found.definition);
}
