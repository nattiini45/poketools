/**
 * Reads of rulesets as the rest of the app uses them: the `Ruleset` read model (`src/types/ruleset.ts`) of a stored version.
 *
 * A league and a phase PIN a version: `seasons.ruleset_id` and `tournaments.ruleset_id` hold the id of an immutable
 * `ruleset_definition_versions` row, so `getRulesetById(tournament.ruleset_id)` returns the rules the phase was created with
 * however the ruleset was edited since, and the enforced ruleset of a phase is simply its own pin (the old resolver with its
 * "custom ruleset" heuristic and the name match is gone; the migration replayed it once into the stored pins).
 *
 * - `getRulesetById(versionId)`: one narrow read of a version by id, the single read behind validation, the teambuilder, the
 *   league hub and the AI context. No `spec` (the document) is selected.
 * - `getHeadRuleset(definitionId)`: the latest published version of a definition. For callers that have no pin: the free
 *   teambuilder, the importer without a tournament. Never use it to decide what a league enforces.
 * - `listRulesets(actor?)`: the head version of every definition the actor may use, as `Ruleset`s (the old admin list and the
 *   league forms). `listRulesetOptions(actor)` is the same list without the rules, for pickers.
 * - `listRulesetOptionsFor({ actor, seasonId, keep })`: the list of the league, phase and tournament forms. Rulesets that a
 *   format attach made for ANOTHER league are left out, and the versions the form already holds (`keep`: the pins of the
 *   league and its phases) are added when they are no longer a head, so a select never shows a pinned older version as
 *   something else.
 *
 * Writes live in `ruleset-definitions.ts` (the library) and `src/lib/ruleset-studio` (publish, pins).
 */
import { supabase } from '../client';
import { postgrestQuoted } from '../postgrest-filter';
import { readBoundedPages } from '../read-bounded-pages';
import type { RulesetActor } from '@/lib/ruleset-studio/access';
import type { RulesetOption } from '@/lib/ruleset-studio/library-types';
import { RULESET_VERSION_VIEW_COLUMNS, toRulesetView, type RulesetVersionViewRow } from '@/lib/ruleset-studio/view';
import { isValidUuid } from '@/lib/utils/uuid';
import type { Ruleset } from '@/types/ruleset';

/** A version by its id (the pin), or null. The id comes from a pin (`seasons.ruleset_id`) or a caller that validated it. */
export async function getRulesetById(id: string): Promise<Ruleset | null> {
  const { data, error } = await supabase
    .from('ruleset_definition_versions')
    .select(RULESET_VERSION_VIEW_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? toRulesetView(data as unknown as RulesetVersionViewRow) : null;
}

/** The latest published version of a definition, or null (unknown definition, or nothing published). */
export async function getHeadRuleset(definitionId: string): Promise<Ruleset | null> {
  if (typeof definitionId !== 'string' || !isValidUuid(definitionId)) return null;
  const { data, error } = await supabase
    .from('ruleset_definitions')
    .select(`head:ruleset_definition_versions!current_version_id ( ${RULESET_VERSION_VIEW_COLUMNS} )`)
    .eq('id', definitionId)
    .maybeSingle();
  if (error) throw error;
  const head = (data as unknown as { head: RulesetVersionViewRow | null } | null)?.head ?? null;
  return head ? toRulesetView(head) : null;
}

/** Narrows a definitions query to those the actor may use: all for a site admin, own and shared otherwise, shared for nobody. */
function visibleTo<Q extends { or(filter: string): Q; in(column: string, values: readonly string[]): Q }>(
  query: Q,
  actor: RulesetActor | undefined,
): Q {
  if (actor?.isAdmin) return query;
  if (actor === undefined) return query.in('visibility', ['league', 'gallery']);
  return query.or(`owner_id.eq.${postgrestQuoted(actor.playerId)},visibility.in.(league,gallery)`);
}

/**
 * The head version of every definition that has one and that `actor` may use, by name. Without an actor only the rulesets
 * shared with all admins (`league`, `gallery`) are listed. Complete under `max_rows`.
 */
export async function listRulesets(actor?: RulesetActor): Promise<Ruleset[]> {
  const { rows } = await readBoundedPages<{ head: RulesetVersionViewRow | null }>(
    (from, to) =>
      visibleTo(
        supabase
          .from('ruleset_definitions')
          .select(`head:ruleset_definition_versions!current_version_id ( ${RULESET_VERSION_VIEW_COLUMNS} )`)
          .not('current_version_id', 'is', null),
        actor,
      )
        .order('name_text')
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: Array<{ head: RulesetVersionViewRow | null }> | null; error: unknown }>,
    { label: 'listRulesets' },
  );
  return rows.flatMap((row) => (row.head ? [toRulesetView(row.head)] : []));
}

interface OptionRow {
  id: string;
  version_no: number;
  name_text: string;
  gen: number;
  format_key: string;
  is_doubles: boolean;
}

const OPTION_COLUMNS = 'id, version_no, name_text, gen, format_key, is_doubles';

function toOption(version: OptionRow, definitionId: string): RulesetOption {
  return {
    id: version.id,
    definition_id: definitionId,
    name: version.name_text,
    is_doubles: version.is_doubles,
    gen: version.gen,
    base_format: version.format_key,
    version_no: version.version_no,
  };
}

/** Where the option list is for: whose rulesets may appear, which league's own rulesets, which versions to keep. */
export interface RulesetOptionScope {
  actor?: RulesetActor;
  /**
   * The league the form is for. A ruleset a format attach created belongs to one league (`season_id`); it is listed only
   * for that league. `null` (a new league, a standalone tournament) lists none of them; absent does not filter at all.
   */
  seasonId?: string | null;
  /** Version ids the form holds now (pins). Added to the list when they are not a head any more. */
  keep?: ReadonlyArray<string | null | undefined>;
}

/** The head of every usable definition, and the kept versions that are not a head. No rules, no document. */
export async function listRulesetOptionsFor(scope: RulesetOptionScope = {}): Promise<RulesetOption[]> {
  const { actor, seasonId } = scope;
  const { rows } = await readBoundedPages<{ id: string; head: OptionRow | null }>(
    (from, to) => {
      const query = visibleTo(
        supabase
          .from('ruleset_definitions')
          .select(`id, head:ruleset_definition_versions!current_version_id ( ${OPTION_COLUMNS} )`)
          .not('current_version_id', 'is', null),
        actor,
      );
      const scoped =
        seasonId === undefined
          ? query
          : seasonId === null
            ? query.is('season_id', null)
            : query.or(`season_id.is.null,season_id.eq.${postgrestQuoted(seasonId)}`);
      return scoped
        .order('name_text')
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: Array<{ id: string; head: OptionRow | null }> | null; error: unknown }>;
    },
    { label: 'listRulesetOptionsFor' },
  );
  const options = rows.flatMap((row) => (row.head ? [toOption(row.head, row.id)] : []));

  const listed = new Set(options.map((o) => o.id));
  const missing = [...new Set((scope.keep ?? []).filter((id): id is string => typeof id === 'string' && isValidUuid(id) && !listed.has(id)))];
  if (missing.length === 0) return options;
  const { data, error } = await supabase
    .from('ruleset_definition_versions')
    .select(`definition_id, ${OPTION_COLUMNS}`)
    .in('id', missing)
    .order('name_text')
    .order('version_no');
  if (error) throw error;
  const kept = ((data ?? []) as unknown as Array<OptionRow & { definition_id: string }>).map((row) => toOption(row, row.definition_id));
  return [...options, ...kept];
}

/** The picker options: id, name and game type of each head version. No rules, no document. */
export async function listRulesetOptions(actor: RulesetActor | undefined): Promise<RulesetOption[]> {
  return listRulesetOptionsFor({ actor });
}

/**
 * The head versions of the definitions with exactly this name (the list name of the head), oldest definition first. Names are
 * not unique. For the one shared ruleset that is found by name: the point-buy battle ruleset.
 */
export async function findHeadRulesetsByName(name: string): Promise<Ruleset[]> {
  const { data, error } = await supabase
    .from('ruleset_definitions')
    .select(`head:ruleset_definition_versions!current_version_id ( ${RULESET_VERSION_VIEW_COLUMNS} )`)
    .eq('name_text', name)
    .not('current_version_id', 'is', null)
    .order('created_at', { ascending: true })
    .order('id');
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ head: RulesetVersionViewRow | null }>).flatMap((row) => (row.head ? [toRulesetView(row.head)] : []));
}
