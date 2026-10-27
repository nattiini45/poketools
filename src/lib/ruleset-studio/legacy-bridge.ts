import 'server-only';
/**
 * The bridge that keeps the old ruleset builder working on top of the ruleset library until the studio replaces it
 * (`POST /api/rulesets`, `PATCH` and `DELETE /api/rulesets/[id]`, site admins only, flat names-in-lists bodies).
 *
 *  - A create makes a `gallery` definition owned by the admin and publishes version 1 from the flat form.
 *  - An update edits the flat fields of the HEAD of the definition that the version id belongs to and publishes the result as
 *    a NEW version. The leagues and phases that pin an older version are not touched: moving them is the pin route. The
 *    answer is the new head (a new id). What the flat form cannot say stays as the head has it (the summary, the other
 *    languages of the name, `based_on`), and the studio draft is only replaced when it is the head, never when the owner has
 *    unpublished work in it.
 *  - A delete removes the definition when no league or phase pins any of its versions (`ruleset_in_use` otherwise).
 *
 * The flat form cannot express a preset base, an allowlist, an unban of anything but Pokémon, or removed clauses. A ruleset
 * that uses any of them is read-only here (`ruleset_legacy_editor_unsupported`) instead of being flattened and losing rules.
 */
import { isDeepStrictEqual } from 'node:util';
import { ltext } from '@/lib/studio-core/ltext';
import { legacyFormToDocument } from '@/lib/ruleset-kit/legacy';
import type { RulesetDocument } from '@/lib/ruleset-kit/types';
import { validateRulesetDocument } from '@/lib/ruleset-kit/validate';
import {
  getDefinitionOfVersion,
  getLatestPublishedRulesetVersion,
  getRulesetDefinitionDraft,
  getRulesetDefinitionMeta,
  saveRulesetDraft,
} from '@/lib/supabase/queries/ruleset-definitions';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import type { SessionPlayer } from '@/types/auth';
import type { Ruleset, RulesetFormData } from '@/types/ruleset';
import { compileForPublish } from './compile.server';
import { RulesetStudioError } from './errors';
import { createPublished, publishCompiled, removeDefinition, toActor } from './library';

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

/**
 * The document of the edited form with the identity of the head. The flat form only knows a name and a base format, so the
 * summary, the other languages of the name and a `based_on` the form did not touch come from the head; a name or base format
 * the patch really changes comes from the form.
 */
function withHeadIdentity(built: RulesetDocument, head: RulesetDocument['identity'], patch: Partial<RulesetFormData>, current: Ruleset): RulesetDocument {
  const { based_on: builtBasedOn, name: builtName } = built.identity;
  const { based_on: _headBasedOn, ...kept } = head;
  const basedOn = patch.base_format !== undefined && patch.base_format !== current.base_format ? builtBasedOn : head.based_on;
  const name = patch.name !== undefined && patch.name !== current.name ? builtName : head.name;
  return { ...built, identity: { ...kept, name, ...(basedOn === undefined ? {} : { based_on: basedOn }) } };
}

/** Whether the studio draft is the published head (nothing unpublished in it), so a builder edit may move it along. */
async function draftIsHead(definitionId: string, draftRev: number, head: RulesetDocument): Promise<boolean> {
  const draft = await getRulesetDefinitionDraft(definitionId);
  if (draft === null || draft.draft_rev !== draftRev) return false;
  const parsed = validateRulesetDocument(draft.document);
  return parsed.ok && isDeepStrictEqual(parsed.document, head);
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
  const built = legacyFormToDocument({ ...rulesetToFormData(current), ...patch });
  const compiled = compileForPublish(withHeadIdentity(built, head.spec.identity, patch, current));
  if (compiled.contentHash === head.content_hash && compiled.resolvedHash === head.resolved_hash) return current;

  // The publish compares the draft revision but never reads the draft, so unpublished studio work stays as it is. A draft that
  // IS the old head moves to the new document, or the next studio publish would silently bring the old rules back.
  let expectedRev = meta.draft_rev;
  if (await draftIsHead(meta.id, meta.draft_rev, head.spec)) {
    const saved = await saveRulesetDraft({ id: meta.id, expectedRev, document: compiled.document, name: compiled.document.identity.name });
    if (saved === null) throw new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: meta.draft_rev });
    expectedRev = saved.draft_rev;
  }
  const { versionId: newVersionId } = await publishCompiled(meta.id, expectedRev, compiled, ltext('en', 'Edited in the ruleset builder'), actorId);
  return mustGet(await getRulesetById(newVersionId));
}

/** Deletes the definition behind a version id (409 `ruleset_in_use` while a league or phase pins one of its versions). */
export async function deleteLegacyRuleset(admin: SessionPlayer, versionId: string): Promise<void> {
  const found = await getDefinitionOfVersion(versionId);
  if (found === null) throw new RulesetStudioError('ruleset_not_found');
  await removeDefinition(toActor(admin), found.definition);
}
