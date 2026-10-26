/**
 * Showdown formats as presets: the kit's view of the dex-free format catalog (`@/lib/pkmn/format-catalog`) and the
 * one place that decides what picking a Showdown format pre-fills in a format definition. Pure and client-safe
 * (zero zod, no `@pkmn`; the client-boundary test allow-lists the catalog import).
 *
 * A Showdown format is the third kind of a stage's ruleset, `{ kind: 'showdown', format: 'gen9ou' }`. Picking one
 * only PRE-PICKS settings; nothing is locked and every field stays editable. The rule, stated here once:
 *
 *  - `ruleset`           = the Showdown format;
 *  - `doubles`           = the catalog's doubles flag of the format;
 *  - `players_per_match` = 2 (every catalog format is a two-player battle, doubles included: two players bring
 *                          two Pokémon each);
 *  - `series.best_of`    = 3 for VGC on every stage, the structure's own value for every other tier (series
 *                          exceptions are never touched).
 *
 * `applyShowdownFormat` applies the whole rule to a definition (the New format start); `withShowdownFormat`
 * applies the battle settings only to one stage (the stage inspector, where the series length is the editor's own
 * choice). Neither mutates its input, and an id the catalog does not know leaves the input as it is: callers
 * validate with `isShowdownFormatId` first.
 */
import { GENERATIONS, getTierInfo } from '@/lib/pkmn/format-catalog';
import { KEY_PATTERN, type Key } from './keys';
import type { FormatDefinition, LText, Locale, Stage } from './types';

export interface ShowdownFormat {
  /** The Showdown format id ('gen9ou'); a valid kit key. */
  id: Key;
  /** The catalog name ('Gen 9 OU'); Showdown names stay English in every language. */
  name: string;
  gen: number;
  /** 'Gen 9 (SV)'. */
  genLabel: string;
  /** The tier key ('ou', 'doublesou', 'vgc'). */
  tier: string;
  /** The tier label ('OU', 'Doubles OU'). */
  tierLabel: string;
  doubles: boolean;
}

export interface ShowdownGeneration {
  gen: number;
  label: string;
  formats: readonly ShowdownFormat[];
}

/** The best of a VGC series. */
export const SHOWDOWN_VGC_BEST_OF = 3;
/** Players in a Showdown battle. */
export const SHOWDOWN_PLAYERS_PER_MATCH = 2;

function buildGenerations(): ShowdownGeneration[] {
  const out: ShowdownGeneration[] = [];
  for (const generation of GENERATIONS) {
    const formats: ShowdownFormat[] = [];
    for (const tier of generation.tiers) {
      const info = getTierInfo(tier);
      const id = `gen${generation.num}${tier}`;
      if (info === undefined || !KEY_PATTERN.test(id)) continue;
      formats.push({
        id,
        name: `Gen ${generation.num} ${info.label}`,
        gen: generation.num,
        genLabel: generation.label,
        tier,
        tierLabel: info.label,
        doubles: info.is_doubles,
      });
    }
    out.push({ gen: generation.num, label: generation.label, formats });
  }
  // Newest generation first: that is the one a league picks most often.
  return out.sort((a, b) => b.gen - a.gen);
}

/** Every Showdown format the app knows, grouped by generation (newest first) and then by tier. */
export const SHOWDOWN_GENERATIONS: readonly ShowdownGeneration[] = buildGenerations();

const FORMATS: readonly ShowdownFormat[] = SHOWDOWN_GENERATIONS.flatMap((generation) => generation.formats);
const BY_ID: ReadonlyMap<string, ShowdownFormat> = new Map(FORMATS.map((format) => [format.id, format]));

/** The format a stage starts from when an editor switches it to the Showdown kind: the newest generation's first tier (OU). */
export const SHOWDOWN_DEFAULT_FORMAT: Key = FORMATS[0].id;

/** All Showdown formats in picker order. */
export function listShowdownFormats(): readonly ShowdownFormat[] {
  return FORMATS;
}

/** The format of an id, or `undefined` for an unknown id (and for the ruleset builder's `blank`). */
export function getShowdownFormat(id: unknown): ShowdownFormat | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

export function isShowdownFormatId(id: unknown): id is Key {
  return getShowdownFormat(id) !== undefined;
}

/**
 * The generations whose formats match `query`, for a picker's search box. The query is split into words and every
 * word must occur in the format's name, tier label or generation label (case-insensitive), so "gen 9 ou", "doubles"
 * and "sv" all work. A blank query keeps everything; a generation without a match is dropped.
 */
export function filterShowdownGenerations(query: string): readonly ShowdownGeneration[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return SHOWDOWN_GENERATIONS;
  const out: ShowdownGeneration[] = [];
  for (const generation of SHOWDOWN_GENERATIONS) {
    const formats = generation.formats.filter((format) => {
      const haystack = `${format.name} ${format.tierLabel} ${format.genLabel}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    if (formats.length > 0) out.push({ ...generation, formats });
  }
  return out;
}

/** The battle settings a Showdown format pre-picks for a stage (everything except the series length). */
function battleSettings(format: ShowdownFormat): Pick<Stage, 'ruleset' | 'doubles' | 'players_per_match'> {
  return {
    ruleset: { kind: 'showdown', format: format.id },
    doubles: format.doubles,
    players_per_match: SHOWDOWN_PLAYERS_PER_MATCH,
  };
}

/** One stage with the battle settings of the format (ruleset, doubles, players per match); the same object when it already has them. */
export function withShowdownFormat(stage: Stage, formatId: string): Stage {
  const format = getShowdownFormat(formatId);
  if (format === undefined) return stage;
  const settings = battleSettings(format);
  const unchanged =
    stage.ruleset?.kind === 'showdown' &&
    stage.ruleset.format === format.id &&
    stage.doubles === settings.doubles &&
    stage.players_per_match === settings.players_per_match;
  return unchanged ? stage : { ...stage, ...settings };
}

/** The best of a stage plays under a format: 3 for VGC, otherwise the value it already has. */
function bestOfFor(format: ShowdownFormat, current: number): number {
  return format.tier === 'vgc' ? SHOWDOWN_VGC_BEST_OF : current;
}

export interface ApplyShowdownOptions {
  /**
   * Append the format name to the identity name in every language it has ("Classic league (Gen 9 OU)"). For a
   * structure whose name the author did not choose; a name typed by the author is left alone.
   */
  retitle?: boolean;
}

function retitled(text: LText, suffix: string): LText {
  const out: LText = { ...text };
  for (const locale of ['en', 'de'] as const satisfies readonly Locale[]) {
    const value = out[locale];
    if (value !== undefined && value.v !== '') out[locale] = { ...value, v: `${value.v} (${suffix})` };
  }
  return out;
}

/** A copy of the definition with the Showdown format pre-picked on EVERY stage (see the rule in the file header). */
export function applyShowdownFormat(
  definition: FormatDefinition,
  formatId: string,
  options: ApplyShowdownOptions = {},
): FormatDefinition {
  const format = getShowdownFormat(formatId);
  if (format === undefined) return definition;
  return {
    ...definition,
    identity: options.retitle === true ? { ...definition.identity, name: retitled(definition.identity.name, format.name) } : definition.identity,
    stages: definition.stages.map((stage) => ({
      ...stage,
      ...battleSettings(format),
      series: { ...stage.series, best_of: bestOfFor(format, stage.series.best_of) },
    })),
  };
}

/** The distinct Showdown formats the stages name, in stage order. */
export function showdownFormatsOf(definition: Pick<FormatDefinition, 'stages'>): Key[] {
  const seen = new Set<string>();
  const out: Key[] = [];
  for (const stage of definition.stages) {
    const ruleset = stage.ruleset;
    if (ruleset?.kind === 'showdown' && !seen.has(ruleset.format)) {
      seen.add(ruleset.format);
      out.push(ruleset.format);
    }
  }
  return out;
}
