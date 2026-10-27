import 'server-only';
/**
 * Context, catalog and dex readers (plan 3.6.1): R tools with no resource beyond "an admin is asking".
 * `whoami`, `dex_lookup`, `format_catalog`, `ruleset_preset_get`, `engine_support`, `resolve_date`.
 */
import { z } from 'zod';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { getAbility, getAbilityNatDex, getItem, getItemNatDex, getMove, getMoveNatDex, getSpecies, getSpeciesNatDex, searchAbilities, searchItems, searchMoves, searchSpecies } from '@/lib/pkmn/dex';
import { PRESET_FAMILIES, getPreset } from '@/lib/pkmn/format-catalog';
import { CHAMPIONS_ROSTER_PIN, PRESET_DATA_PIN, PRESET_RULES_VERSION } from '@/lib/pkmn/preset-data/pin';
import { filterRulesetPresets, getRulesetPreset, isRulesetPresetId, listRulesetPresets } from '@/lib/pkmn/ruleset-preset-catalog';
import { resolvePresetRules, resolveTourOverlay } from '@/lib/pkmn/preset-rules.server';
import { defineRunnable } from '../registry/define';
import { capped, code, dexName, id, intArg, isoDateTime, label, textArg } from '../registry/atoms';
import { fenceLabel } from '../registry/fence';
import { ENGINE_SUPPORT_ROWS } from './engine-support';
import { resolveRelativeDate, WEEKDAYS } from './resolve-date';

// ─── whoami ──────────────────────────────────────────────────────────────────

const SCOPE_ID_CAP = 50;

export const whoami = defineRunnable('any', {
  name: 'whoami',
  class: 'R',
  description:
    'Report who is asking: the admin tier (site admin or league/tournament admin), which leagues and tournaments they may manage, the assistant phase, and which tools are offered in this conversation. Call it first whenever the admin asks what you can do or may manage, or the answer depends on what they are allowed to do, and base the answer on tier, max_phase and offered_tools.',
  args: z.strictObject({}),
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    tier: z.enum(['site_admin', 'resource_admin']),
    label: label(),
    toolset: z.enum(['site', 'scoped']),
    max_phase: z.number().int().min(0).max(5),
    league_scope: z.strictObject({ all: z.boolean(), count: z.number().int(), ids: z.array(id()), truncated: z.boolean() }),
    tournament_scope: z.strictObject({ all: z.boolean(), count: z.number().int(), ids: z.array(id()), truncated: z.boolean() }),
    offered_tools: z.array(code()),
  }),
  async execute(_args, guarded, ctx) {
    const scope = await getAdminScope(guarded.player);
    const view = (ids: string[] | null) =>
      ids === null
        ? { all: true, count: 0, ids: [], truncated: false }
        : { all: false, count: ids.length, ids: ids.slice(0, SCOPE_ID_CAP), truncated: ids.length > SCOPE_ID_CAP };
    return {
      tier: scope.isSiteAdmin ? ('site_admin' as const) : ('resource_admin' as const),
      label: fenceLabel(guarded.player.name),
      toolset: ctx.role,
      max_phase: ctx.maxPhase,
      league_scope: view(scope.seasonIds),
      tournament_scope: view(scope.tournamentIds),
      offered_tools: [...ctx.offeredTools],
    };
  },
});

// ─── dex_lookup ──────────────────────────────────────────────────────────────

const DEX_KINDS = ['species', 'move', 'item', 'ability'] as const;

const dexMatch = z.strictObject({ id: code(), name: dexName() });

export const dexLookup = defineRunnable('any', {
  name: 'dex_lookup',
  class: 'R',
  description:
    'Look up a Pokémon species, move, item or ability by name and get its canonical name and id. Mandatory before writing any ban or allowlist entry: ids, not display names, go into rulesets. Species results list their formes, because banning a base species does not ban its other formes. Set national to true for earlier-generation content that generation 9 no longer has (the National Dex universe); otherwise the lookup is limited to the given generation (default 9). A miss that exists in an earlier generation says so. A miss returns close suggestions.',
  args: z.strictObject({
    kind: z.enum(DEX_KINDS).describe('What to look up'),
    query: textArg('The name to look up', 60),
    gen: intArg('Generation', 1, 9).optional(),
    national: z.boolean().optional().describe('Use the National Dex universe (all generations)'),
  }),
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    kind: z.enum(DEX_KINDS),
    found: z.boolean(),
    match: dexMatch.nullable(),
    formes: z.array(dexMatch),
    earliest_gen: z.number().int().nullable(),
    note: z.enum(['none', 'not_in_generation', 'past_species_use_national']),
    suggestions: z.array(dexMatch),
  }),
  async execute(args) {
    const gen = args.gen ?? 9;
    const national = args.national === true;
    const query = args.query;
    let name: string | null = null;
    let entityId: string | null = null;
    let earliest: number | null = null;
    let formes: Array<{ id: string; name: string }> = [];

    if (args.kind === 'species') {
      const found = national ? getSpeciesNatDex(query) : null;
      const species = found ? found.entity : national ? null : getSpecies(query, gen);
      if (species && species.exists) {
        name = species.name;
        entityId = species.id;
        earliest = found ? found.earliestGen : null;
        const names = Array.isArray(species.formes) && species.formes.length > 0 ? species.formes : [species.name];
        formes = names
          .map((formeName) => (national ? getSpeciesNatDex(formeName)?.entity : getSpecies(formeName, gen)))
          .filter((forme): forme is NonNullable<typeof forme> => !!forme && forme.exists)
          .slice(0, 40)
          .map((forme) => ({ id: forme.id, name: forme.name }));
      }
    } else if (args.kind === 'move') {
      const found = national ? getMoveNatDex(query) : null;
      const move = found ? found.entity : national ? null : getMove(query, gen);
      if (move && move.exists) {
        name = move.name;
        entityId = move.id;
        earliest = found ? found.earliestGen : null;
      }
    } else if (args.kind === 'item') {
      const found = national ? getItemNatDex(query) : null;
      const item = found ? found.entity : national ? null : getItem(query, gen);
      if (item && item.exists) {
        name = item.name;
        entityId = item.id;
        earliest = found ? found.earliestGen : null;
      }
    } else {
      const found = national ? getAbilityNatDex(query) : null;
      const ability = found ? found.entity : national ? null : getAbility(query, gen);
      if (ability && ability.exists) {
        name = ability.name;
        entityId = ability.id;
        earliest = found ? found.earliestGen : null;
      }
    }

    const match = name !== null && entityId !== null ? { id: entityId, name } : null;
    const hit = match !== null;
    let suggestions: Array<{ id: string; name: string }> = [];
    let note: 'none' | 'not_in_generation' | 'past_species_use_national' = 'none';
    if (!hit) {
      const near = {
        species: searchSpecies,
        move: searchMoves,
        item: searchItems,
        ability: searchAbilities,
      }[args.kind](query, gen, 5);
      suggestions = near.map((entry) => ({ id: entry.id, name: entry.name }));
      if (!national) {
        // A Pokémon or move that exists only in an earlier generation: say how to find it instead of "unknown".
        const elsewhere = { species: getSpeciesNatDex, move: getMoveNatDex, item: getItemNatDex, ability: getAbilityNatDex }[args.kind](query);
        if (elsewhere) note = args.kind === 'species' ? 'past_species_use_national' : 'not_in_generation';
      }
    }
    return {
      kind: args.kind,
      found: hit,
      match,
      formes,
      earliest_gen: earliest,
      note,
      suggestions,
    };
  },
});

// ─── format_catalog ──────────────────────────────────────────────────────────

const CATALOG_CAP = 60;
const FAMILY_KEYS = PRESET_FAMILIES.map((family) => family.key) as [string, ...string[]];

const formatCatalogArgs = z.strictObject({
  query: z.string().trim().max(60).optional().describe('Words to match, each against the start of a name or tier word (up to 60 characters)'),
  gen: intArg('Generation', 1, 9).optional(),
  source: z.enum(['showdown', 'smogon-draft']).optional(),
  family: z.enum(FAMILY_KEYS).optional(),
});
export type FormatCatalogArgs = z.output<typeof formatCatalogArgs>;

/** What `format_catalog` answers. Pure and port-free, so the plan-stage eval world runs the very same code. */
export function formatCatalogView(args: FormatCatalogArgs) {
  let entries = args.query !== undefined && args.query !== '' ? filterRulesetPresets(args.query) : listRulesetPresets();
  if (args.gen !== undefined) entries = entries.filter((entry) => entry.gen === args.gen);
  if (args.source !== undefined) entries = entries.filter((entry) => entry.source === args.source);
  if (args.family !== undefined) entries = entries.filter((entry) => entry.family === args.family);
  const items = entries.slice(0, CATALOG_CAP).map((entry) => ({
    id: entry.id,
    name: entry.name,
    gen: entry.gen,
    source: entry.source,
    family: entry.family,
    tier: entry.tier,
    doubles: entry.doubles,
    tour_overlay: entry.tourOverlay,
  }));
  return {
    presets: { items, total: entries.length, truncated: entries.length > CATALOG_CAP, cap: CATALOG_CAP },
    provenance: {
      preset_data_repo: PRESET_DATA_PIN.repo,
      preset_data_sha: PRESET_DATA_PIN.sha,
      champions_roster_sha: CHAMPIONS_ROSTER_PIN.sha,
      preset_rules_version: PRESET_RULES_VERSION,
    },
  };
}

export const formatCatalog = defineRunnable('any', {
  name: 'format_catalog',
  class: 'R',
  description:
    'Search the catalog of rule presets: every Showdown ladder format for generations 1 to 9 and the Smogon draft formats. Presets are discovered here, never recalled from memory; use the returned id when creating a ruleset or forking a preset. Filter by words (for example "gen 9 ou", "doubles", "draft"), generation, source or family. Returns at most 60 presets and says when the list was cut. The provenance block names the data pins the catalog was built from.',
  args: formatCatalogArgs,
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    presets: capped(
      z.strictObject({
        id: code(),
        name: dexName(),
        gen: z.number().int(),
        source: z.enum(['showdown', 'smogon-draft']),
        family: code(),
        tier: code(),
        doubles: z.boolean(),
        tour_overlay: z.boolean(),
      }),
    ),
    provenance: z.strictObject({
      preset_data_repo: code(),
      preset_data_sha: z.string().regex(/^[0-9a-f]{7,40}$/),
      champions_roster_sha: z.string().regex(/^[0-9a-f]{7,40}$/),
      preset_rules_version: code(),
    }),
  }),
  async execute(args) {
    return formatCatalogView(args);
  },
});

// ─── ruleset_preset_get ──────────────────────────────────────────────────────

const LIST_CAP = 150;

const presetListOut = z.strictObject({
  mode: z.enum(['block', 'allow']),
  count: z.number().int(),
  ids: z.array(code()),
  truncated: z.boolean(),
});

const toListOut = (list: { mode: 'block' | 'allow'; ids: readonly string[] }) => ({
  mode: list.mode,
  count: list.ids.length,
  ids: list.ids.slice(0, LIST_CAP),
  truncated: list.ids.length > LIST_CAP,
});

const rulesetPresetArgs = z.strictObject({
  preset: textArg('Catalog preset id such as gen9ou', 60),
  tour_overlay: z.boolean().optional().describe('Include the Smogon tour extras of the preset when it has any'),
});
export type RulesetPresetArgs = z.output<typeof rulesetPresetArgs>;

/** What `ruleset_preset_get` answers. Pure and port-free, so the plan-stage eval world runs the very same code. */
export function rulesetPresetView(args: RulesetPresetArgs) {
  if (!isRulesetPresetId(args.preset) || getPreset(args.preset) === undefined) {
    return { found: false, preset: null, tour_overlay: null };
  }
  const rules = resolvePresetRules(args.preset);
  if (rules === null) return { found: false, preset: null, tour_overlay: null };
  const entry = getRulesetPreset(args.preset);
  const facts = rules.facts;
  const overlay = args.tour_overlay === true ? resolveTourOverlay(args.preset) : null;
  const asList = (ids: readonly string[]) => toListOut({ mode: 'block', ids });
  return {
    found: true,
    preset: {
      id: rules.id,
      name: entry?.name ?? rules.name,
      gen: rules.gen,
      source: rules.source,
      universe: rules.universe,
      doubles: rules.doubles,
      clauses: rules.clauses,
      pokemon: toListOut(rules.pokemon),
      moves: toListOut(rules.moves),
      items: toListOut(rules.items),
      abilities: toListOut(rules.abilities),
      facts: {
        team_preview: facts.teamPreview,
        level: facts.level,
        max_level: facts.maxLevel,
        picked_team_size: facts.pickedTeamSize,
        min_team_size: facts.minTeamSize,
        item_clause_limit: facts.itemClauseLimit,
        min_source_gen: facts.minSourceGen,
        little_cup: facts.littleCup,
        unmodelled: [...facts.unmodelled],
      },
      combination_bans: rules.combination_bans,
      catalog_version: rules.catalog_version,
    },
    tour_overlay:
      args.tour_overlay !== true
        ? null
        : overlay === null
          ? { available: false, clauses_add: [], clauses_remove: [], moves: asList([]), items: asList([]), abilities: asList([]) }
          : {
              available: true,
              clauses_add: overlay.clausesAdd,
              clauses_remove: overlay.clausesRemove,
              moves: asList(overlay.moves),
              items: asList(overlay.items),
              abilities: asList(overlay.abilities),
            },
  };
}

export const rulesetPresetGet = defineRunnable('any', {
  name: 'ruleset_preset_get',
  class: 'R',
  description:
    'Get what one rule preset implies: clauses, the ban or allow list per category (as dex ids, cut at 150 per list with a count), rule facts such as level and team size, and what the app does not model. Use the preset id from format_catalog. Set tour_overlay to also get the documented Smogon tournament extras that "add tour bans" would apply. An unknown id is reported, never replaced by a blank preset.',
  args: rulesetPresetArgs,
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    found: z.boolean(),
    preset: z
      .strictObject({
        id: code(),
        name: dexName(),
        gen: z.number().int(),
        source: z.enum(['showdown', 'smogon-draft']),
        universe: z.enum(['standard', 'national']),
        doubles: z.boolean(),
        clauses: z.array(code()),
        pokemon: presetListOut,
        moves: presetListOut,
        items: presetListOut,
        abilities: presetListOut,
        facts: z.strictObject({
          team_preview: z.boolean(),
          level: z.number().int().nullable(),
          max_level: z.number().int().nullable(),
          picked_team_size: z.number().int().nullable(),
          min_team_size: z.number().int().nullable(),
          item_clause_limit: z.number().int().nullable(),
          min_source_gen: z.number().int().nullable(),
          little_cup: z.boolean(),
          unmodelled: z.array(code()),
        }),
        combination_bans: z.array(z.string().regex(/^[\p{L}\p{N} .'’:+\-/@!&()]{1,120}$/u)),
        catalog_version: code(),
      })
      .nullable(),
    tour_overlay: z
      .strictObject({
        available: z.boolean(),
        clauses_add: z.array(code()),
        clauses_remove: z.array(code()),
        moves: presetListOut,
        items: presetListOut,
        abilities: presetListOut,
      })
      .nullable(),
  }),
  async execute(args) {
    return rulesetPresetView(args);
  },
});

// ─── engine_support ──────────────────────────────────────────────────────────

export const engineSupport = defineRunnable('any', {
  name: 'engine_support',
  class: 'R',
  description:
    'State plainly what the tournament engine can and cannot run today: a round robin is one circle (no double round robin), wildcard and threshold advancement are not run, Format Studio groups, legs, third place and bottom-N are recorded but not run, the legacy draft roster is fixed at 11, Swiss round count cannot be set, and standalone tournaments have no registration or check-in. Call it before promising anything the admin asked for that touches these limits.',
  args: z.strictObject({}),
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    rows: z.array(
      z.strictObject({
        key: code(),
        supported: z.boolean(),
        limit: z.number().int().nullable(),
        statement: z.string().regex(/^[\p{L}\p{N} .,;:'’()/+_\-]{1,400}$/u),
        offer: z.string().regex(/^[\p{L}\p{N} .,;:'’()/+_\-]{0,200}$/u),
      }),
    ),
  }),
  async execute() {
    return { rows: ENGINE_SUPPORT_ROWS.map((row) => ({ ...row, limit: row.limit })) };
  },
});

// ─── resolve_date ────────────────────────────────────────────────────────────

export const resolveDate = defineRunnable('any', {
  name: 'resolve_date',
  class: 'R',
  description:
    'Turn a relative date into a calendar date in the admin\'s time zone. Never work out weekdays yourself. anchor "today" or "tomorrow" need nothing else; "in_days" needs days; "weekday" needs weekday and relation: "upcoming" is the first such weekday after today, "this" is the one in the current Monday-to-Sunday week (it may be in the past), "next" is the first one after today but, when today is that weekday, returns both candidates and ambiguous true so you can ask which is meant.',
  args: z
    .strictObject({
      anchor: z.enum(['today', 'tomorrow', 'in_days', 'weekday']),
      days: intArg('Days from today', 0, 730).optional(),
      weekday: z.enum(WEEKDAYS).optional(),
      relation: z.enum(['upcoming', 'this', 'next']).optional(),
    })
    .refine((a) => (a.anchor === 'in_days' ? a.days !== undefined : true), { message: 'in_days needs days', path: ['days'] })
    .refine((a) => (a.anchor === 'weekday' ? a.weekday !== undefined && a.relation !== undefined : true), {
      message: 'weekday needs weekday and relation',
      path: ['weekday'],
    }),
  phase: 0,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    time_zone: z.string().regex(/^[A-Za-z_]+(\/[A-Za-z_+\-0-9]+){0,2}$/),
    today: isoDateTime(),
    today_weekday: z.enum(WEEKDAYS),
    date: isoDateTime().nullable(),
    weekday: z.enum(WEEKDAYS).nullable(),
    candidates: z.array(isoDateTime()),
    ambiguous: z.boolean(),
    in_past: z.boolean(),
  }),
  async execute(args, _guarded, ctx) {
    return resolveRelativeDate(args, ctx.now(), ctx.timeZone);
  },
});

export const CONTEXT_READERS = [whoami, dexLookup, formatCatalog, rulesetPresetGet, engineSupport, resolveDate] as const;
