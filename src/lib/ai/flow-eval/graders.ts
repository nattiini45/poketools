/**
 * Deterministic graders of the AI flow eval. No model judges anything here: a grader reads the
 * model's text and the data the prompt was built from and answers with `Check`s.
 *
 * - match-analysis and scouting: the app's own parsers (`parse-analysis.ts`, `parse-scouting.ts`),
 *   the required fields, and facts the fixture pins (game winners, the player names, the species
 *   a pick may name, the gym type a pick must have).
 * - Kale tasks: the app's own validator (`kale/validator.ts`). Its `wrong_score` and `wrong_player`
 *   errors are real checks; `checkPlayerNames` is a no-op in the validator and the Pokémon-name
 *   checks are warnings only, so a clean validator run proves the scores and the winner
 *   attribution are right, not that every name is.
 * - Coaches and recap: cheap checks only (non-empty, language, length, a clean ending).
 *
 * Call-level facts (truncation, refusal, fallback) become checks too, through `gradeCall`.
 */

import { parseAnalysisResponse } from '../parse-analysis';
import { parseScoutingResponse } from '../parse-scouting';
import { validateForecastOutput, validateRecapOutput } from '../kale/validator';
import type { ForecastFactPack, RecapFactPack, ValidationError } from '../kale/types';
import { baseModelId } from './pricing';
import {
  detectLanguage,
  endsCleanly,
  firstSentenceByDotSplit,
  hasEmoji,
  hasExclamation,
  paragraphCount,
  parseLooseJson,
  proseOf,
  sentenceCount,
} from './text';
import {
  emptyValidatorCounts,
  type CallRecord,
  type Check,
  type Locale,
  type MatchAnalysisCase,
  type ScoutingCase,
  type ValidatorCounts,
} from './types';

const hard = (id: string, pass: boolean, detail?: string): Check => ({ id, hard: true, pass, ...(detail ? { detail } : {}) });
const soft = (id: string, pass: boolean, detail?: string): Check => ({ id, hard: false, pass, ...(detail ? { detail } : {}) });

// ─── Species lookup ─────────────────────────────────────────────────

/** What the scouting grader needs from the Pokémon data: whether a species exists in a generation, and its types. */
export interface SpeciesLookup {
  exists(name: string, gen: number): boolean;
  types(name: string, gen: number): string[] | null;
}

/** The real lookup over `@pkmn/data`, built on first use (importing the dex is the slow part). */
export async function createDexLookup(): Promise<SpeciesLookup> {
  const [{ Dex }, { Generations }] = await Promise.all([import('@pkmn/dex'), import('@pkmn/data')]);
  const gens = new Generations(Dex);
  return {
    exists: (name, gen) => {
      const s = gens.get(gen as Parameters<typeof gens.get>[0]).species.get(name);
      return Boolean(s && s.exists);
    },
    types: (name, gen) => {
      const s = gens.get(gen as Parameters<typeof gens.get>[0]).species.get(name);
      return s && s.exists ? [...s.types] : null;
    },
  };
}

// ─── Call-level checks ──────────────────────────────────────────────

/** Truncation, refusal, errors and fallback of one call as checks. Truncation, refusal and an error fail the run. */
export function gradeCall(call: CallRecord, label: string): Check[] {
  return [
    hard(`${label}call_ok`, call.error === null || call.error === 'truncated' || call.error === 'refused', call.error ?? undefined),
    hard(`${label}not_truncated`, !call.truncated, call.truncated ? `stop_reason ${call.stopReason ?? 'max_tokens'}` : undefined),
    hard(`${label}not_refused`, !call.refused),
    soft(`${label}served_as_requested`, !call.fallback, call.fallback ? `served ${call.servedModel ?? 'fallback'}` : undefined),
  ];
}

/** True when `served` is not the model that was asked for (a fallback, ignoring a dated suffix). */
export function servedDiffersFromRequested(requested: string, served: string | null): boolean {
  return served !== null && baseModelId(served) !== baseModelId(requested);
}

// ─── Shared prose rules ─────────────────────────────────────────────

function proseRules(prose: string, locale: Locale): Check[] {
  const detected = detectLanguage(prose);
  return [
    soft('no_exclamation', !hasExclamation(prose)),
    soft('no_emoji', !hasEmoji(prose)),
    soft('language', detected === null || detected === locale, detected && detected !== locale ? `looks ${detected}, wanted ${locale}` : undefined),
  ];
}

const nonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

// ─── Match analysis ─────────────────────────────────────────────────

export function gradeMatchAnalysis(text: string, c: MatchAnalysisCase): Check[] {
  let parsed;
  try {
    parsed = parseAnalysisResponse(text);
  } catch (error) {
    return [hard('parse', false, error instanceof Error ? error.message : 'parse failed')];
  }
  const checks: Check[] = [hard('parse', true)];
  const { expect } = c;

  checks.push(
    hard('required_text', nonEmptyString(parsed.summary) && nonEmptyString(parsed.turning_point) && nonEmptyString(parsed.what_if)),
    hard('game_count', parsed.game_breakdowns.length === expect.games.length, `got ${parsed.game_breakdowns.length}, want ${expect.games.length}`),
  );

  const winnersOk = expect.games.every((g, i) => {
    const winner = parsed.game_breakdowns[i]?.winner.toLowerCase() ?? '';
    return winner.includes(g.winner.toLowerCase());
  });
  checks.push(hard('game_winners', winnersOk));

  const players = [expect.player1, expect.player2].map((n) => n.toLowerCase());
  checks.push(hard('mvp_player', players.some((p) => parsed.mvp.player.toLowerCase().includes(p))));
  checks.push(hard('mvp_pokemon_in_data', c.userPrompt.toLowerCase().includes(parsed.mvp.pokemon.toLowerCase()) && parsed.mvp.pokemon !== ''));
  checks.push(
    hard(
      'constraint_field',
      expect.hasLeagueConstraint ? nonEmptyString(parsed.league_constraint_analysis) : parsed.league_constraint_analysis === undefined,
      expect.hasLeagueConstraint ? 'league has a constraint, field missing' : 'no constraint in the league, field present',
    ),
  );
  checks.push(
    soft(
      'breakdowns_filled',
      parsed.game_breakdowns.every((g) => nonEmptyString(g.narrative) && g.key_plays.length > 0),
    ),
  );
  checks.push(soft('summary_short', parsed.summary.length <= 900, `${parsed.summary.length} chars`));
  checks.push(...proseRules(proseOf(parsed), c.locale));
  return checks;
}

// ─── Scouting ───────────────────────────────────────────────────────

export function gradeScouting(text: string, c: ScoutingCase, lookup: SpeciesLookup): Check[] {
  let parsed;
  try {
    parsed = parseScoutingResponse(text, c.hasUserTeam);
  } catch (error) {
    return [hard('parse', false, error instanceof Error ? error.message : 'parse failed')];
  }
  const checks: Check[] = [hard('parse', true)];
  const { expect } = c;

  // The app parser drops the half of the schema that does not apply, so exclusivity is checked on the raw JSON.
  const raw = parseLooseJson(text) ?? {};
  const present = (key: string): boolean => {
    const v = raw[key];
    return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
  };
  const forbidden = c.hasUserTeam ? 'suggested_picks' : 'matchup_analysis';
  checks.push(hard('branch_exclusive', !present(forbidden), `${forbidden} must be omitted ${c.hasUserTeam ? 'when the player has a team' : 'when the player has no team'}`));

  checks.push(
    hard('required_text', nonEmptyString(parsed.opponent_profile) && nonEmptyString(parsed.recommendations.key_advice)),
    hard('signature_pokemon', parsed.signature_pokemon.length > 0 && parsed.signature_pokemon.every((s) => nonEmptyString(s.pokemon))),
    hard('threats', parsed.recommendations.threats_to_watch.length > 0),
  );

  if (c.hasUserTeam) {
    const m = parsed.matchup_analysis;
    checks.push(
      hard(
        'branch_fields',
        Boolean(m && nonEmptyString(m.your_advantages) && nonEmptyString(m.their_advantages)) && parsed.suggested_picks === undefined,
        'with a team: matchup_analysis, no suggested_picks',
      ),
    );
  } else {
    const picks = parsed.suggested_picks ?? [];
    checks.push(
      hard('branch_fields', picks.length >= 3 && picks.length <= 5 && parsed.matchup_analysis === undefined, `${picks.length} picks; want 3-5 and no matchup_analysis`),
      hard('picks_exist_in_gen', picks.length > 0 && picks.every((p) => lookup.exists(p.pokemon, expect.gen)), picks.map((p) => p.pokemon).join(', ')),
      hard('picks_have_set', picks.every((p) => nonEmptyString(p.set_summary) && nonEmptyString(p.reasoning))),
    );
    if (expect.userGymType) {
      const gym = expect.userGymType.toLowerCase();
      const offType = picks.filter((p) => !(lookup.types(p.pokemon, expect.gen) ?? []).some((t) => t.toLowerCase() === gym));
      checks.push(hard('picks_match_gym_type', picks.length > 0 && offType.length === 0, offType.map((p) => p.pokemon).join(', ') || undefined));
    }
  }

  if (expect.opponentSpecies.length > 0) {
    const known = new Set(expect.opponentSpecies.map((s) => s.toLowerCase()));
    const grounded = parsed.signature_pokemon.filter((s) => known.has(s.pokemon.toLowerCase()));
    checks.push(soft('signature_in_history', grounded.length === parsed.signature_pokemon.length, `${grounded.length}/${parsed.signature_pokemon.length} named in the history`));
  }
  checks.push(...proseRules(proseOf(parsed), c.locale));
  return checks;
}

// ─── Kale tasks ─────────────────────────────────────────────────────

export interface KaleTaskGrade {
  checks: Check[];
  validator: ValidatorCounts;
}

function countValidator(errors: ValidationError[]): ValidatorCounts {
  const counts = emptyValidatorCounts();
  for (const e of errors) counts[e.type] += 1;
  return counts;
}

/** Per-task length rules: [min chars, max chars, max sentences]. */
const KALE_LENGTH: Record<string, [number, number, number]> = {
  headline: [15, 320, 2],
  forecast_headline: [15, 320, 2],
  standings_story: [40, 900, 5],
  standings_context: [40, 900, 5],
  meta_trends: [40, 900, 5],
  spotlight_reason: [20, 600, 3],
  spicy_context: [20, 600, 3],
  bold_prediction: [20, 700, 4],
};

const STORYLINE_KEYS = ['storyline', 'edge', 'key_pokemon'] as const;

/** Grade one Kale task output against its fact pack. `taskId` is the pipeline's id (`headline`, `match_one_liner_0`, ...). */
export function gradeKaleTask(
  taskId: string,
  text: string,
  flow: 'kale-recap' | 'kale-forecast',
  factPack: RecapFactPack | ForecastFactPack,
): KaleTaskGrade {
  const p = (id: string): string => `${taskId}:${id}`;
  const checks: Check[] = [hard(p('non_empty'), text.trim() !== '')];

  const validation =
    flow === 'kale-recap'
      ? validateRecapOutput(taskId, text, factPack as RecapFactPack)
      : validateForecastOutput(taskId, text, factPack as ForecastFactPack);
  const errorsOnly = validation.errors.filter((e) => e.severity === 'error');
  checks.push(hard(p('validator'), errorsOnly.length === 0, errorsOnly.map((e) => e.type).join(',') || undefined));
  checks.push(soft(p('validator_clean'), validation.errors.length === 0, validation.errors.length ? `${validation.errors.length} warning(s)` : undefined));

  if (taskId.startsWith('matchup_storyline_')) {
    const json = parseLooseJson(text);
    const ok = json !== null && STORYLINE_KEYS.every((k) => nonEmptyString(json[k]));
    checks.push(hard(p('parse'), ok, ok ? undefined : 'storyline JSON missing or incomplete'));
  } else {
    checks.push(soft(p('no_exclamation'), !hasExclamation(text)), soft(p('no_emoji'), !hasEmoji(text)));
    const bounds = KALE_LENGTH[taskId];
    if (bounds) {
      checks.push(soft(p('length'), text.length >= bounds[0] && text.length <= bounds[1] && sentenceCount(text) <= bounds[2], `${text.length} chars, ${sentenceCount(text)} sentences`));
    }
    if (taskId.startsWith('match_one_liner_')) {
      checks.push(soft(p('one_sentence'), sentenceCount(text) === 1 && text.length <= 420, `${sentenceCount(text)} sentences`));
    }
    if (taskId === 'narrative' || taskId === 'forecast_narrative') {
      const paragraphs = paragraphCount(text);
      checks.push(soft(p('paragraphs'), paragraphs >= 2 && paragraphs <= 6, `${paragraphs} paragraphs`));
      checks.push(hard(p('ends_cleanly'), endsCleanly(text)));
    }
  }
  const language = detectLanguage(text);
  checks.push(soft(p('language'), language === null || language === 'en'));
  return { checks, validator: countValidator(validation.errors) };
}

// ─── Coaches and recap ──────────────────────────────────────────────

function bulletCount(text: string): number {
  return (text.match(/^\s*(?:[-*•]|\d+[.)])\s+/gm) ?? []).length;
}

export function gradeTeamCoach(text: string, locale: Locale): Check[] {
  return [
    hard('non_empty', text.trim().length > 0),
    hard('length', text.length >= 400 && text.length <= 6000, `${text.length} chars`),
    hard('ends_cleanly', endsCleanly(text)),
    soft('bullets', bulletCount(text) >= 4, `${bulletCount(text)} bullet lines`),
    soft('tier_rating', /\b(?:tier|rating|rated?|bewertung)\b[^.\n]{0,40}\b[SABCDF]\b/i.test(text) || /\b[SABCDF]\s*[-–(]?\s*tier\b/i.test(text), 'S/A/B/C/D/F rating at the end'),
    soft('language', (detectLanguage(text) ?? locale) === locale),
  ];
}

export function gradeSlotCoach(text: string, locale: Locale): Check[] {
  return [
    hard('non_empty', text.trim().length > 0),
    hard('length', text.length >= 150 && text.length <= 3000, `${text.length} chars`),
    hard('ends_cleanly', endsCleanly(text)),
    soft('bullets', bulletCount(text) >= 2 && bulletCount(text) <= 7, `${bulletCount(text)} bullet lines`),
    soft('language', (detectLanguage(text) ?? locale) === locale),
  ];
}

export function gradeRecap(text: string, locale: Locale): Check[] {
  const headline = firstSentenceByDotSplit(text);
  return [
    hard('non_empty', text.trim().length > 0),
    hard('length', text.length >= 80 && text.length <= 900, `${text.length} chars`),
    hard('ends_cleanly', endsCleanly(text)),
    soft('no_headers', !/^\s*#|^\s*[-*]\s/m.test(text)),
    soft('sentences', sentenceCount(text) >= 2 && sentenceCount(text) <= 4, `${sentenceCount(text)} sentences`),
    soft('headline_split', headline.clean, `split('.')[0] = "${headline.text.slice(0, 40)}"`),
    soft('language', (detectLanguage(text) ?? locale) === locale),
  ];
}
