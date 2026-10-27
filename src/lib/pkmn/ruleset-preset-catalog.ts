/**
 * The view of the dex-free preset catalog (`./format-catalog`, `PRESETS`: Showdown's ladder formats and the Smogon draft
 * formats) that the pickers of both studios share: the entries in picker order, lookup by id, search and grouping. The
 * format kit builds on it for what picking a preset pre-fills in a format definition (`format-kit/ruleset-presets.ts`);
 * the Ruleset Studio reads it for its preset browser. Pure and client-safe (zero zod, no `@pkmn`; the catalog boundary
 * test in `__tests__/format-catalog-boundary.test.ts` proves it).
 */
import { GENERATIONS, PRESETS, PRESET_FAMILIES, type PresetFamily, type PresetSource } from './format-catalog';
import { KEY_PATTERN, type Key } from '@/lib/studio-core/keys';

export interface RulesetPresetEntry {
  /** The format id ('gen9ou', 'gen9natdexdraft'); a valid kit key. */
  id: Key;
  /** The catalog name ('Gen 9 OU'); Showdown names stay English in every language. */
  name: string;
  gen: number;
  /** 'Gen 9 (SV)'. */
  genLabel: string;
  source: PresetSource;
  family: PresetFamily;
  /** The tier key ('ou', 'doublesou', 'natdexdraft'). */
  tier: string;
  /** The tier label ('OU', 'Doubles OU'). */
  tierLabel: string;
  doubles: boolean;
  /** The preset has documented Smogon tour extras ("add Smogon tour bans" in the ruleset studio). */
  tourOverlay: boolean;
}

/** The presets of one source, generation and family: the unit a picker lists under one heading. */
export interface RulesetPresetGroup {
  /** `source:gen:family`, unique and stable. */
  key: string;
  source: PresetSource;
  gen: number;
  genLabel: string;
  family: PresetFamily;
  presets: readonly RulesetPresetEntry[];
}

const SOURCE_ORDER: readonly PresetSource[] = ['showdown', 'smogon-draft'];
const FAMILY_ORDER: ReadonlyMap<PresetFamily, number> = new Map(PRESET_FAMILIES.map((family, index) => [family.key, index]));
const GENERATION_LABELS: ReadonlyMap<number, string> = new Map(GENERATIONS.map((generation) => [generation.num, generation.label]));
const FAMILY_LABELS: ReadonlyMap<PresetFamily, string> = new Map(PRESET_FAMILIES.map((family) => [family.key, family.label]));

function buildEntries(): RulesetPresetEntry[] {
  const entries: RulesetPresetEntry[] = [];
  for (const preset of PRESETS) {
    if (!KEY_PATTERN.test(preset.id)) continue;
    entries.push({
      id: preset.id,
      name: preset.name,
      gen: preset.gen,
      genLabel: GENERATION_LABELS.get(preset.gen) ?? `Gen ${preset.gen}`,
      source: preset.source,
      family: preset.family,
      tier: preset.tier,
      tierLabel: preset.tierLabel,
      doubles: preset.gameType === 'doubles',
      tourOverlay: preset.tourOverlay,
    });
  }
  // Picker order: source (Showdown, then the Smogon drafts), then the newest generation first (the one a league
  // picks most often), then the family, then the catalog's own order (a stable sort keeps it).
  return entries.sort(
    (a, b) =>
      SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) ||
      b.gen - a.gen ||
      (FAMILY_ORDER.get(a.family) ?? 0) - (FAMILY_ORDER.get(b.family) ?? 0),
  );
}

const ENTRIES: readonly RulesetPresetEntry[] = buildEntries();
const BY_ID: ReadonlyMap<string, RulesetPresetEntry> = new Map(ENTRIES.map((entry) => [entry.id, entry]));

/** The preset a stage starts from when an editor switches it to the preset kind: the first Showdown ladder entry of the newest generation (OU). */
export const DEFAULT_RULESET_PRESET: Key = ENTRIES[0].id;

/** All presets in picker order. */
export function listRulesetPresets(): readonly RulesetPresetEntry[] {
  return ENTRIES;
}

/** The preset of an id, or `undefined` for an unknown id (and for the ruleset builder's `blank`). */
export function getRulesetPreset(id: unknown): RulesetPresetEntry | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

export function isRulesetPresetId(id: unknown): id is Key {
  return getRulesetPreset(id) !== undefined;
}

/** The words a preset is found by: its name, id, tier, generation, family and source, lower-cased and split at anything that is not a letter or a digit. */
function searchWords(entry: RulesetPresetEntry): string[] {
  const source = entry.source === 'showdown' ? 'showdown ladder' : 'smogon draft league';
  const text = `${entry.name} ${entry.id} ${entry.tierLabel} ${entry.genLabel} ${FAMILY_LABELS.get(entry.family) ?? ''} ${source}`;
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== '');
}

/**
 * The presets that match `query`, for a picker's search box. The query is split into words and every word must be the
 * start of a word of the preset (its name, id, tier label, generation label, family or source; case-insensitive), so
 * "gen 9 ou", "gen9ou", "doubles", "sv", "draft" and "natdex" all work, and "ou" finds OU but not "doubles". A blank
 * query keeps everything.
 */
export function filterRulesetPresets(query: string): readonly RulesetPresetEntry[] {
  const wanted = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (wanted.length === 0) return ENTRIES;
  return ENTRIES.filter((entry) => {
    const words = searchWords(entry);
    return wanted.every((word) => words.some((candidate) => candidate.startsWith(word)));
  });
}

/**
 * Groups presets by source, then generation (newest first), then family, keeping the order of `entries`. A group is
 * what a picker shows under one heading.
 */
export function groupRulesetPresets(entries: readonly RulesetPresetEntry[]): readonly RulesetPresetGroup[] {
  const groups: { group: Omit<RulesetPresetGroup, 'presets'>; presets: RulesetPresetEntry[] }[] = [];
  for (const entry of entries) {
    const key = `${entry.source}:${entry.gen}:${entry.family}`;
    let found = groups.find((candidate) => candidate.group.key === key);
    if (found === undefined) {
      found = {
        group: { key, source: entry.source, gen: entry.gen, genLabel: entry.genLabel, family: entry.family },
        presets: [],
      };
      groups.push(found);
    }
    found.presets.push(entry);
  }
  return groups.map(({ group, presets }) => ({ ...group, presets }));
}
