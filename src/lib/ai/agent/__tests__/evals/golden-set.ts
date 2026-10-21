/**
 * §8.4 eval golden set — ~25 prompts that gate the T0 model choice and catch
 * tool-call regressions before any user-facing route is cut over to the agent.
 *
 * Each case is declarative DATA: a prompt, the persona to run it under, optional
 * request context, and an `expect` block of cheap, deterministic checks:
 *   - `mustCallTools`        — tool names the run MUST invoke (subset check).
 *   - `answerMustContain`    — strings (case-insensitive) / regexes the final
 *                              answer must match (every one must hit).
 *   - `answerMustNotContain` — strings / regexes the answer must NOT match.
 *
 * Ground-truth values are NOT hand-typed where a tool can produce them:
 *   - dex / type facts were verified against `@pkmn/data` while authoring (e.g.
 *     Garchomp base HP 108; Garchomp CANNOT learn Ice Beam in gen 9 — the dex is
 *     the source of truth even where training data disagrees);
 *   - damage expectations are COMPUTED here by importing `calculateDamage`
 *     directly, so the KO descriptor an answer must contain always matches what
 *     `@smogon/calc` actually returns (never hardcoded);
 *   - usage cases pull the live top-usage list so "mentions a top-5 mon" stays
 *     correct as the metagame shifts (see {@link loadGoldenSet}).
 *
 * Architecture note (teambuild cases): the `linden_teambuilding` persona wires
 * the `buildTeam` meta-tool (+ `createPokepaste`) ALONGSIDE the 10 §5 LLM tools
 * (PRD §4 persona table; see `orchestrator.ts` `toolNamesFor`). Free-form 10-tool
 * assembly proved too heavy for the T0 models — they exhausted the step budget
 * and timed out — so a full-team request is now satisfied by ONE `buildTeam`
 * call (the deterministic assembler chains usage → coverage → validation) whose
 * result the model presents as Showdown sets. These cases therefore gate on the
 * `buildTeam` call plus a Showdown-format answer. The runner mocks pokepast.es
 * regardless as a network safety net.
 */
import { calculateDamage } from '../../tools/calc';
import { getUsageStats } from '../../tools/smogon';
import type { CalculateDamageInput } from '../../tools/schemas';
import type { AgentContext, AgentPersona } from '../../types';

// ─── Case shape ──────────────────────────────────────────────────────

export interface EvalExpect {
  /** Tool names the run must invoke at least once (subset of the called set). */
  mustCallTools?: string[];
  /** Every entry must appear in the answer (string = case-insensitive substring). */
  answerMustContain?: Array<string | RegExp>;
  /** No entry may appear in the answer. */
  answerMustNotContain?: Array<string | RegExp>;
}

export interface EvalCase {
  id: string;
  /** Bucket for the summary breakdown. */
  category: 'dex' | 'type' | 'calc' | 'usage' | 'legality' | 'league' | 'teambuild';
  prompt: string;
  persona: AgentPersona;
  context?: AgentContext;
  expect: EvalExpect;
  /** Optional human-readable note (e.g. the computed damage range). */
  note?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** A throwaway UUID for league cases — real shape, no matching rows (we tolerate empty). */
const SAMPLE_PLAYER_ID = '00000000-0000-4000-8000-000000000001';

/** Derive the KO descriptor an answer must mention from a real calc result. */
function damageCase(
  id: string,
  prompt: string,
  input: CalculateDamageInput,
): EvalCase {
  const result = calculateDamage(input);
  if ('error' in result) {
    // A golden case must be computable: an error here is a broken case
    // (misspelt name, removed move), not an "immune" expectation.
    throw new Error(`golden-set case ${id}: calculateDamage failed (${result.error_code}): ${result.error}`);
  }
  const immune = result.damage.max === 0;
  const ko = result.ko_chance.match(/\b(OHKO|\d+HKO)\b/i)?.[1];

  const answerMustContain: Array<string | RegExp> = immune
    ? [/immune|no damage|does(n'?t| not) (affect|damage)|no effect|0%|nothing|can'?t|cannot|won'?t/i]
    : ko
      ? [new RegExp(ko.replace(/(\d)/, '$1\\s*'), 'i')]
      : [/%/];

  return {
    id,
    category: 'calc',
    prompt,
    persona: 'linden_teambuilding',
    context: { format: 'gen9ou' },
    // For a damage matchup we require the damage calculator. For an IMMUNE
    // matchup we do NOT: `calculateDamage` only reports 0 damage with no KO
    // chance for a 0× hit, so recognising the type immunity via
    // `getTypeChart`/`lookupPokemon` is an equally correct (and arguably
    // preferred) path. So immune cases gate on the immune ANSWER alone; the
    // answer regex is a strong correctness signal that the model didn't
    // hallucinate damage. (Mandating `calculateDamage` here was over-specified.)
    expect: {
      ...(immune ? {} : { mustCallTools: ['calculateDamage'] }),
      answerMustContain,
    },
    note: immune
      ? `expected: immune / 0 damage (${result.description}) — answer-gated (type immunity, not a calc)`
      : `expected: ${result.ko_chance} (${result.damage.min_pct}–${result.damage.max_pct}%)`,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Static cases (dex / type / damage / legality / league) ──────────

const DEX_CASES: EvalCase[] = [
  {
    id: 'dex-garchomp-hp',
    category: 'dex',
    prompt: 'What is Garchomp’s base HP stat?',
    persona: 'linden_teambuilding',
    expect: { mustCallTools: ['lookupPokemon'], answerMustContain: ['108'] },
  },
  {
    id: 'dex-pikachu-type',
    category: 'dex',
    prompt: 'What type is Pikachu?',
    persona: 'linden_teambuilding',
    expect: { mustCallTools: ['lookupPokemon'], answerMustContain: [/electric/i] },
  },
  {
    id: 'dex-garchomp-abilities',
    category: 'dex',
    prompt: 'Which abilities can Garchomp have?',
    persona: 'linden_teambuilding',
    expect: {
      mustCallTools: ['lookupPokemon'],
      answerMustContain: [/rough skin/i, /sand veil/i],
    },
  },
  {
    id: 'dex-dragapult-speed',
    category: 'dex',
    prompt: 'What is Dragapult’s base Speed stat?',
    persona: 'linden_teambuilding',
    expect: { mustCallTools: ['lookupPokemon'], answerMustContain: ['142'] },
  },
  {
    id: 'dex-toxapex-type',
    category: 'dex',
    prompt: 'What are Toxapex’s types?',
    persona: 'linden_teambuilding',
    expect: {
      mustCallTools: ['lookupPokemon'],
      answerMustContain: [/poison/i, /water/i],
    },
  },
  {
    id: 'dex-landorus-t-attack',
    category: 'dex',
    prompt: 'What is Landorus-Therian’s base Attack stat?',
    persona: 'linden_teambuilding',
    expect: { mustCallTools: ['lookupPokemon'], answerMustContain: ['145'] },
  },
];

const TYPE_CASES: EvalCase[] = [
  {
    // Gotcha: Ground is 2× vs Electric/Water by the chart, but Rotom-Wash has
    // Levitate → truly immune. Requires lookupPokemon to surface the ability.
    id: 'type-eq-rotom-wash',
    category: 'type',
    prompt: 'Is Earthquake effective against Rotom-Wash?',
    persona: 'linden_teambuilding',
    expect: {
      mustCallTools: ['lookupPokemon'],
      answerMustContain: [/levitate|immune|no effect|does(n'?t| not) (affect|hit)|can'?t|cannot/i],
    },
  },
  {
    id: 'type-eq-gyarados',
    category: 'type',
    prompt: 'Does Earthquake hit Gyarados?',
    persona: 'linden_teambuilding',
    expect: {
      mustCallTools: ['getTypeChart'],
      answerMustContain: [/immune|no(t| )|does(n'?t| not)|can'?t|cannot|won'?t|0/i],
    },
  },
  {
    id: 'type-swampert-weak',
    category: 'type',
    prompt: 'What type of move is super effective against Swampert?',
    persona: 'linden_teambuilding',
    expect: { mustCallTools: ['getTypeChart'], answerMustContain: [/grass/i] },
  },
  {
    id: 'type-ice-vs-garchomp',
    category: 'type',
    prompt: 'How effective is an Ice-type attack against Garchomp?',
    persona: 'linden_teambuilding',
    expect: {
      mustCallTools: ['getTypeChart'],
      answerMustContain: [/4\s*x|4×|×\s*4|quad|four times|super effective/i],
    },
  },
];

const CALC_CASES: EvalCase[] = [
  damageCase(
    'calc-cb-garchomp-eq-heatran',
    'I have a Choice Band Adamant Garchomp with 252 Attack EVs. Does its Earthquake KO a defensive 0 HP Heatran in gen 9?',
    {
      gen: 9,
      attacker: { species: 'Garchomp', item: 'Choice Band', nature: 'Adamant', evs: { atk: 252 } },
      defender: { species: 'Heatran', evs: { hp: 0, def: 0 } },
      move: 'Earthquake',
    },
  ),
  damageCase(
    'calc-great-tusk-headlong-toxapex',
    'How many hits does a 252+ Atk Great Tusk Headlong Rush need to KO a fully physically defensive (252 HP / 252 Def) Toxapex in gen 9?',
    {
      gen: 9,
      attacker: { species: 'Great Tusk', nature: 'Adamant', evs: { atk: 252 } },
      defender: { species: 'Toxapex', evs: { hp: 252, def: 252 } },
      move: 'Headlong Rush',
    },
  ),
  damageCase(
    'calc-rotom-wash-hydro-corviknight',
    'How many Hydro Pumps from a 252 SpA Modest Rotom-Wash does it take to KO a specially defensive 252 HP / 252 SpD Corviknight in gen 9?',
    {
      gen: 9,
      attacker: { species: 'Rotom-Wash', nature: 'Modest', evs: { spa: 252 } },
      defender: { species: 'Corviknight', evs: { hp: 252, spd: 252 } },
      move: 'Hydro Pump',
    },
  ),
  damageCase(
    'calc-garchomp-eq-corviknight',
    'Can a 252+ Atk Garchomp’s Earthquake damage Corviknight in gen 9?',
    {
      gen: 9,
      attacker: { species: 'Garchomp', nature: 'Adamant', evs: { atk: 252 } },
      defender: { species: 'Corviknight', evs: { hp: 252, def: 252 } },
      move: 'Earthquake',
    },
  ),
];

const LEGALITY_CASES: EvalCase[] = [
  {
    // Truth (per @pkmn/data): Garchomp CANNOT learn Ice Beam in gen 9.
    id: 'legality-garchomp-ice-beam',
    category: 'legality',
    prompt: 'Can Garchomp legally learn Ice Beam in gen 9?',
    persona: 'linden_teambuilding',
    expect: {
      mustCallTools: ['getLearnset'],
      answerMustContain: [/\bno\b|cannot|can'?t|can not|unable|does(n'?t| not) learn|not able|isn'?t able|illegal/i],
    },
  },
  {
    // Truth: Toxapex CAN learn Recover.
    id: 'legality-toxapex-recover',
    category: 'legality',
    prompt: 'Can Toxapex learn Recover?',
    persona: 'linden_teambuilding',
    expect: {
      mustCallTools: ['getLearnset'],
      answerMustContain: [/\byes\b|can learn|able to|learns recover|it can/i],
    },
  },
  {
    id: 'legality-validate-illegal-team',
    category: 'legality',
    prompt:
      'Is this gen9ou team legal? Please check it.\n\n' +
      'Garchomp @ Leftovers\nAbility: Rough Skin\nEVs: 252 Atk / 4 Def / 252 Spe\nJolly Nature\n' +
      '- Earthquake\n- Recover\n- Dragon Claw\n- Swords Dance\n',
    persona: 'linden_teambuilding',
    context: { format: 'gen9ou' },
    expect: {
      mustCallTools: ['validateTeam'],
      answerMustContain: [/illegal|not legal|invalid|isn'?t legal|can'?t|cannot|not.*learn/i],
    },
  },
];

const LEAGUE_CASES: EvalCase[] = [
  {
    id: 'league-all-time-usage',
    category: 'league',
    prompt: 'Across all of our league’s recorded games, which Pokémon have been used the most?',
    persona: 'linden_match_prep',
    expect: {
      mustCallTools: ['queryLeagueData'],
      answerMustNotContain: [/stack trace|undefined is not|cannot read prop/i],
    },
    note: 'Tolerates empty league data — gates on the tool call + a graceful answer.',
  },
  {
    id: 'league-match-history',
    category: 'league',
    prompt: `Summarise the recent match history for the player with id ${SAMPLE_PLAYER_ID}.`,
    persona: 'linden_match_prep',
    expect: {
      mustCallTools: ['getMatchHistory'],
      answerMustNotContain: [/stack trace|undefined is not|cannot read prop/i],
    },
    note: 'Throwaway player id → empty history; gates on the tool call + graceful answer.',
  },
  {
    id: 'league-upcoming-matches',
    category: 'league',
    prompt: `What upcoming matches does the player with id ${SAMPLE_PLAYER_ID} have scheduled?`,
    persona: 'linden_match_prep',
    expect: {
      mustCallTools: ['getUpcomingMatches'],
      answerMustNotContain: [/stack trace|undefined is not|cannot read prop/i],
    },
    note: 'Throwaway player id → no upcoming matches; gates on the tool call + graceful answer.',
  },
];

// ─── Dynamic cases (usage / teambuild) ───────────────────────────────

const USAGE_FORMAT = 'gen9ou';
/** Fallback OU staples if the live usage fetch is unavailable while authoring/running. */
const FALLBACK_TOP_MONS = [
  'Great Tusk',
  'Kingambit',
  'Gholdengo',
  'Dragapult',
  'Landorus',
  'Iron Valiant',
  'Zamazenta',
  'Garganacha',
];

/** Build a case-insensitive alternation regex over the format's top-usage mons. */
async function topMonsRegex(): Promise<{ re: RegExp; names: string[] }> {
  let names: string[] = [];
  try {
    const usage = await getUsageStats({ format: USAGE_FORMAT });
    names = usage.pokemon.slice(0, 8).map((p) => p.pokemon);
  } catch {
    names = [];
  }
  if (names.length === 0) names = FALLBACK_TOP_MONS;
  const re = new RegExp(names.map(escapeRegExp).join('|'), 'i');
  return { re, names };
}

// ─── Loader ──────────────────────────────────────────────────────────

/** Static cases need no async ground-truth (damage is computed synchronously). */
export const STATIC_CASES: EvalCase[] = [
  ...DEX_CASES,
  ...TYPE_CASES,
  ...CALC_CASES,
  ...LEGALITY_CASES,
  ...LEAGUE_CASES,
];

/**
 * Build the full golden set, resolving the live usage-derived ground truth for
 * the usage + teambuild cases. The runner awaits this once per process.
 */
export async function loadGoldenSet(): Promise<EvalCase[]> {
  const { re: topMons, names } = await topMonsRegex();
  const topNote = `top-usage mons: ${names.slice(0, 5).join(', ')}`;

  const usageCases: EvalCase[] = [
    {
      id: 'usage-ou-top',
      category: 'usage',
      prompt: 'Who are the most-used Pokémon in gen9ou right now?',
      persona: 'linden_teambuilding',
      context: { format: 'gen9ou' },
      expect: { mustCallTools: ['getUsageStats'], answerMustContain: [topMons] },
      note: topNote,
    },
    {
      id: 'usage-ou-threats',
      category: 'usage',
      prompt: 'What are the top metagame threats I should prepare for in gen9ou?',
      persona: 'linden_teambuilding',
      context: { format: 'gen9ou' },
      expect: { mustCallTools: ['getUsageStats'], answerMustContain: [topMons] },
      note: topNote,
    },
    {
      id: 'usage-common-item',
      category: 'usage',
      prompt:
        'Using the current gen9ou usage stats, name one of the most common Pokémon and a popular item or move it runs.',
      persona: 'linden_teambuilding',
      context: { format: 'gen9ou' },
      expect: { mustCallTools: ['getUsageStats'], answerMustContain: [topMons] },
      note: topNote,
    },
  ];

  const SHOWDOWN_SET = /ability:|evs:|tera type:|\s@\s/i;
  const teambuildCases: EvalCase[] = [
    {
      id: 'teambuild-ou-full',
      category: 'teambuild',
      prompt: 'Build me a full, legal gen9ou team and show me the Showdown sets.',
      persona: 'linden_teambuilding',
      context: { format: 'gen9ou' },
      expect: { mustCallTools: ['buildTeam'], answerMustContain: [SHOWDOWN_SET] },
      note: 'Full-team request → one buildTeam call; gates on a Showdown-format team in the answer.',
    },
    {
      id: 'teambuild-ou-core',
      category: 'teambuild',
      prompt: 'Build me a gen9ou team around Garchomp and give me the full Showdown export.',
      persona: 'linden_teambuilding',
      context: { format: 'gen9ou', core_pokemon: ['Garchomp'] },
      expect: {
        mustCallTools: ['buildTeam'],
        answerMustContain: [SHOWDOWN_SET, /garchomp/i],
      },
      note: 'Full-team request around a core → one buildTeam call; gates on a Showdown team including the requested core.',
    },
  ];

  return [...STATIC_CASES, ...usageCases, ...teambuildCases];
}
