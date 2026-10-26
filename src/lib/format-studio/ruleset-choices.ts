import 'server-only';

/**
 * The stored rulesets a format document may name, by the id the document uses. The ONE place that decides which
 * ruleset a stage's `ruleset.id` is: the editor, the read-only page and the attach preview all take their list from here.
 *
 * The editor writes DEFINITION ids. A format stored before the Ruleset Studio names a legacy ruleset, and a legacy
 * ruleset id is now the id of version 1 of its definition; a published format version and an attached copy are immutable
 * and hashed, so they keep that id. `resolveNamedRulesets` maps either kind of id to its definition (the same mapping the
 * attach uses to pin), and the list below carries one extra entry per such legacy id, labelled like its definition.
 */
import { namedRulesetsOf } from '@/lib/format-kit/ruleset-presets';
import type { RulesetChoice } from '@/lib/format-studio/editor/catalog';
import { resolveNamedRulesets } from '@/lib/supabase/queries/ruleset-definitions';
import { listRulesetOptions } from '@/lib/supabase/queries/rulesets';

interface Actor {
  playerId: string;
  isAdmin: boolean;
}

/** The ids the stages of a stored document name, or none when it is not a document at all (a draft may be anything). */
function namedBy(document: unknown): string[] {
  return typeof document === 'object' && document !== null ? namedRulesetsOf(document as Parameters<typeof namedRulesetsOf>[0]) : [];
}

/**
 * Every ruleset the actor may name (by definition id), plus an alias for each legacy id that `documents` name and that
 * resolves to one of them. An id that resolves to nothing the actor may use (a draft, another admin's private ruleset, a
 * deleted one) gets no entry: the editor shows it as unknown.
 */
export async function loadRulesetChoices(actor: Actor, documents: readonly unknown[]): Promise<RulesetChoice[]> {
  const options = await listRulesetOptions(actor);
  const choices: RulesetChoice[] = options.map((o) => ({ id: o.definition_id, name: o.name, version_no: o.version_no }));
  const byDefinition = new Map(choices.map((choice) => [choice.id, choice]));

  const strays = [...new Set(documents.flatMap(namedBy))].filter((id) => !byDefinition.has(id));
  if (strays.length === 0) return choices;

  const resolved = await resolveNamedRulesets(strays);
  for (const id of strays) {
    const target = byDefinition.get(resolved.get(id)?.definition_id ?? '');
    if (target !== undefined) choices.push({ ...target, id, definition_id: target.id });
  }
  return choices;
}
