import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCases } from '../fixtures';
import {
  gradeCall,
  gradeKaleTask,
  gradeMatchAnalysis,
  gradeRecap,
  gradeScouting,
  gradeSlotCoach,
  gradeTeamCoach,
  servedDiffersFromRequested,
  type SpeciesLookup,
} from '../graders';
import { detectLanguage, endsCleanly, firstSentenceByDotSplit, parseLooseJson, sentenceCount } from '../text';
import type { CallRecord, KaleForecastCase, KaleRecapCase, MatchAnalysisCase, ScoutingCase, Check } from '../types';

const ROOT = path.resolve(__dirname, '../../../../..');
const all = loadCases(ROOT, ['kale-recap', 'kale-forecast', 'match-analysis', 'scouting'], 'synthetic');
const pick = <T,>(flow: string, id?: string): T =>
  all.find((c) => c.flow === flow && (id === undefined || c.case.id === id))!.case as unknown as T;

const failing = (checks: Check[]): string[] => checks.filter((c) => !c.pass).map((c) => c.id);
const hardFailing = (checks: Check[]): string[] => checks.filter((c) => c.hard && !c.pass).map((c) => c.id);

// ─── Match analysis ─────────────────────────────────────────────────

function analysisFor(c: MatchAnalysisCase, overrides: Record<string, unknown> = {}): string {
  const { expect: e } = c;
  const species = /### \w+'s Team Sheet\n- ([A-Za-z-]+)/.exec(c.userPrompt)?.[1] ?? 'Garchomp';
  return JSON.stringify({
    summary: `${e.player1} and ${e.player2} played a tight set. ${e.matchWinner} took it.`,
    turning_point: 'A Terastallization on turn four decided the first game.',
    mvp: { pokemon: species, player: e.matchWinner, reasoning: 'It carried the set.' },
    game_breakdowns: e.games.map((g) => ({ game_number: g.gameNumber, winner: g.winner, narrative: 'Early hazards, a trade, then cleanup.', key_plays: ['Hazards went up'] })),
    meta_observations: 'The picks fit the format.',
    what_if: 'Switching on turn three would have saved the lead.',
    ...(e.hasLeagueConstraint ? { league_constraint_analysis: 'Both players leaned into their constraint.' } : {}),
    ...overrides,
  });
}

describe('gradeMatchAnalysis', () => {
  const gym = pick<MatchAnalysisCase>('match-analysis', 'ma-gym-bo3-replays');
  const open = pick<MatchAnalysisCase>('match-analysis', 'ma-open-bo3-replays');

  it('passes a complete, correct answer', () => {
    expect(hardFailing(gradeMatchAnalysis(analysisFor(gym), gym))).toEqual([]);
    expect(hardFailing(gradeMatchAnalysis(analysisFor(open), open))).toEqual([]);
  });

  it('fails parse on prose and on truncated JSON, and says why', () => {
    expect(hardFailing(gradeMatchAnalysis('Here is my analysis of the match.', gym))).toEqual(['parse']);
    const cut = analysisFor(gym).slice(0, 120);
    expect(hardFailing(gradeMatchAnalysis(cut, gym))).toEqual(['parse']);
  });

  it('tolerates fences and a preamble, as the app parser does', () => {
    const wrapped = `Sure.\n\`\`\`json\n${analysisFor(gym)}\n\`\`\``;
    expect(hardFailing(gradeMatchAnalysis(wrapped, gym))).toEqual([]);
  });

  it('catches a wrong game winner, a wrong game count and an invented MVP', () => {
    const swapped = analysisFor(gym, {
      game_breakdowns: gym.expect.games.map((g) => ({ game_number: g.gameNumber, winner: gym.expect.player2 === g.winner ? gym.expect.player1 : gym.expect.player2, narrative: 'x', key_plays: ['y'] })),
    });
    expect(hardFailing(gradeMatchAnalysis(swapped, gym))).toContain('game_winners');
    const oneGame = analysisFor(gym, { game_breakdowns: [{ game_number: 1, winner: gym.expect.player1, narrative: 'x', key_plays: ['y'] }] });
    expect(hardFailing(gradeMatchAnalysis(oneGame, gym))).toContain('game_count');
    const invented = analysisFor(gym, { mvp: { pokemon: 'Missingno', player: gym.expect.player1, reasoning: 'r' } });
    expect(hardFailing(gradeMatchAnalysis(invented, gym))).toContain('mvp_pokemon_in_data');
    const stranger = analysisFor(gym, { mvp: { pokemon: 'Kingambit', player: 'Somebody Else', reasoning: 'r' } });
    expect(hardFailing(gradeMatchAnalysis(stranger, gym))).toContain('mvp_player');
  });

  it('requires league_constraint_analysis exactly when the league has a constraint', () => {
    const noField = JSON.parse(analysisFor(gym)) as Record<string, unknown>;
    delete noField.league_constraint_analysis;
    expect(hardFailing(gradeMatchAnalysis(JSON.stringify(noField), gym))).toEqual(['constraint_field']);
    expect(hardFailing(gradeMatchAnalysis(analysisFor(open, { league_constraint_analysis: 'invented' }), open))).toEqual(['constraint_field']);
  });

  it('reports style slips as soft failures only', () => {
    const checks = gradeMatchAnalysis(analysisFor(gym, { summary: 'What a match! 🔥 A great set between two players.' }), gym);
    expect(hardFailing(checks)).toEqual([]);
    expect(failing(checks)).toEqual(expect.arrayContaining(['no_exclamation', 'no_emoji']));
  });

  it('checks the output language of a German case', () => {
    const de = pick<MatchAnalysisCase>('match-analysis', 'ma-gym-de-sweep');
    const english = gradeMatchAnalysis(analysisFor(de, { summary: 'The match was a tight set with the better plan on one side and the more patient one on the other.' }), de);
    expect(failing(english)).toContain('language');
    const german = gradeMatchAnalysis(
      analysisFor(de, {
        summary: 'Die beiden Spieler lieferten sich ein enges Duell, und der Sieger hat das Spiel mit Geduld und einem guten Plan für sich entschieden.',
        turning_point: 'Die Terakristallisierung in der vierten Runde war der Wendepunkt des ersten Spiels.',
        what_if: 'Wenn der Spieler früher gewechselt hätte, wäre die Führung nicht verloren gegangen.',
        meta_observations: 'Die Auswahl passt zu dem Format und zu den Regeln der Liga.',
        league_constraint_analysis: 'Beide Spieler sind ihrem Typ treu geblieben und haben ihn gut genutzt.',
        game_breakdowns: de.expect.games.map((g) => ({ game_number: g.gameNumber, winner: g.winner, narrative: 'Das Spiel ist mit einem Wechsel auf den Stahl-Pokémon entschieden worden.', key_plays: ['Die Stealth Rock sind früh gesetzt worden'] })),
      }),
      de,
    );
    expect(failing(german)).not.toContain('language');
  });
});

// ─── Scouting ───────────────────────────────────────────────────────

const lookup: SpeciesLookup = {
  exists: (name) => name !== 'Missingno',
  types: (name) => ({ Heatran: ['Fire', 'Steel'], Skeledirge: ['Fire', 'Ghost'], Garchomp: ['Dragon', 'Ground'] })[name] ?? null,
};

function scoutingFor(c: ScoutingCase, overrides: Record<string, unknown> = {}): string {
  const base = {
    opponent_profile: 'A patient player who likes long games.',
    signature_pokemon: [{ pokemon: c.expect.opponentSpecies[0] ?? 'Garchomp', usage_note: 'Brought most games.' }],
    tendencies: { lead_patterns: 'Leads with hazards.', play_style: 'Defensive.', favorite_moves: 'Stealth Rock.' },
    meta_positioning: 'Against the current.',
    recommendations: { threats_to_watch: ['Garchomp'], suggested_leads: 'Lead with a pivot.', coverage_gaps: 'Few answers to boosters.', key_advice: 'Stay patient.' },
    ...(c.hasUserTeam
      ? { matchup_analysis: { your_advantages: 'Speed.', their_advantages: 'Bulk.', neutral_ground: 'Hazards.' } }
      : {
          suggested_picks: [
            { pokemon: 'Heatran', role: 'Wall', set_summary: 'Leftovers / Flash Fire / Magma Storm', reasoning: 'Fire-type and legal.' },
            { pokemon: 'Skeledirge', role: 'Cleric', set_summary: 'Boots / Unaware / Torch Song', reasoning: 'Fire-type.' },
            { pokemon: 'Heatran', role: 'Wall 2', set_summary: 'x', reasoning: 'y' },
          ],
        }),
  };
  return JSON.stringify({ ...base, ...overrides });
}

describe('gradeScouting', () => {
  const noTeam = pick<ScoutingCase>('scouting', 'sc-gym-noteam');
  const withTeam = pick<ScoutingCase>('scouting', 'sc-gym-team');

  it('passes the right branch of the schema', () => {
    expect(hardFailing(gradeScouting(scoutingFor(noTeam), noTeam, lookup))).toEqual([]);
    expect(hardFailing(gradeScouting(scoutingFor(withTeam), withTeam, lookup))).toEqual([]);
  });

  it('fails the wrong branch: picks with a team, matchup_analysis without one', () => {
    const picksWithTeam = gradeScouting(scoutingFor(withTeam, { suggested_picks: [{ pokemon: 'Heatran', role: 'r', set_summary: 's', reasoning: 'x' }] }), withTeam, lookup);
    // the app parser drops suggested_picks when a team exists, so only the raw JSON shows the model emitted it
    expect(hardFailing(picksWithTeam)).toEqual(['branch_exclusive']);
    const matchupWithoutTeam = gradeScouting(scoutingFor(noTeam, { matchup_analysis: { your_advantages: 'a', their_advantages: 'b', neutral_ground: 'c' } }), noTeam, lookup);
    expect(hardFailing(matchupWithoutTeam)).toEqual(['branch_exclusive']);
    const emptyPicks = gradeScouting(scoutingFor(withTeam, { suggested_picks: [] }), withTeam, lookup);
    expect(hardFailing(emptyPicks)).toEqual([]);
    const noMatchup = gradeScouting(scoutingFor(withTeam, { matchup_analysis: undefined }), withTeam, lookup);
    expect(hardFailing(noMatchup)).toContain('branch_fields');
    const noPicks = gradeScouting(scoutingFor(noTeam, { suggested_picks: undefined }), noTeam, lookup);
    expect(hardFailing(noPicks)).toContain('branch_fields');
  });

  it('requires 3 to 5 picks, species that exist in the generation, and the gym type', () => {
    const two = gradeScouting(scoutingFor(noTeam, { suggested_picks: [{ pokemon: 'Heatran', role: 'r', set_summary: 's', reasoning: 'x' }, { pokemon: 'Skeledirge', role: 'r', set_summary: 's', reasoning: 'x' }] }), noTeam, lookup);
    expect(hardFailing(two)).toContain('branch_fields');
    const fake = gradeScouting(scoutingFor(noTeam, { suggested_picks: [1, 2, 3].map(() => ({ pokemon: 'Missingno', role: 'r', set_summary: 's', reasoning: 'x' })) }), noTeam, lookup);
    expect(hardFailing(fake)).toContain('picks_exist_in_gen');
    expect(noTeam.expect.userGymType).toBe('Fire');
    const offType = gradeScouting(scoutingFor(noTeam, { suggested_picks: [1, 2, 3].map(() => ({ pokemon: 'Garchomp', role: 'r', set_summary: 's', reasoning: 'x' })) }), noTeam, lookup);
    expect(hardFailing(offType)).toEqual(['picks_match_gym_type']);
  });

  it('flags a signature Pokémon the history never showed as a soft failure', () => {
    const checks = gradeScouting(scoutingFor(noTeam, { signature_pokemon: [{ pokemon: 'Pikachu', usage_note: 'n' }] }), noTeam, lookup);
    expect(hardFailing(checks)).toEqual([]);
    expect(failing(checks)).toContain('signature_in_history');
  });

  it('fails parse on cut-off JSON', () => {
    expect(hardFailing(gradeScouting(scoutingFor(noTeam).slice(0, 200), noTeam, lookup))).toEqual(['parse']);
  });
});

// ─── Kale ───────────────────────────────────────────────────────────

describe('gradeKaleTask', () => {
  const recap = pick<KaleRecapCase>('kale-recap');
  const forecast = pick<KaleForecastCase>('kale-forecast');
  const match = recap.factPack.matches[0];

  it('passes a one-liner that states the right score and winner', () => {
    const text = `${match.winnerName} beat ${match.loserName} ${match.scoreString} behind ${match.mvpPokemon}.`;
    const grade = gradeKaleTask('match_one_liner_0', text, 'kale-recap', recap.factPack);
    expect(hardFailing(grade.checks)).toEqual([]);
    expect(grade.validator.wrong_score).toBe(0);
  });

  it('counts wrong_score and wrong_player from the app validator', () => {
    const wrongScore = gradeKaleTask('match_one_liner_0', `${match.winnerName} won 9-9 over ${match.loserName}.`, 'kale-recap', recap.factPack);
    expect(wrongScore.validator.wrong_score).toBe(1);
    expect(hardFailing(wrongScore.checks)).toContain('match_one_liner_0:validator');
    const wrongWinner = gradeKaleTask('match_one_liner_0', `${match.loserName} defeated ${match.winnerName} in a close one.`, 'kale-recap', recap.factPack);
    expect(wrongWinner.validator.wrong_player).toBe(1);
    expect(hardFailing(wrongWinner.checks)).toContain('match_one_liner_0:validator');
  });

  it('does not claim the validator catches a misspelled or invented player name (checkPlayerNames is a no-op)', () => {
    const invented = gradeKaleTask('headline', 'Zelda Quincy stunned the league with a perfect round of play today.', 'kale-recap', recap.factPack);
    expect(invented.validator.wrong_player).toBe(0);
    expect(hardFailing(invented.checks)).toEqual([]);
  });

  it('requires the forecast storyline task to return complete JSON', () => {
    const good = gradeKaleTask('matchup_storyline_0', '```json\n{"storyline":"s","edge":"e","key_pokemon":"k"}\n```', 'kale-forecast', forecast.factPack);
    expect(hardFailing(good.checks)).toEqual([]);
    const missing = gradeKaleTask('matchup_storyline_0', '{"storyline":"s"}', 'kale-forecast', forecast.factPack);
    expect(hardFailing(missing.checks)).toEqual(['matchup_storyline_0:parse']);
    const prose = gradeKaleTask('matchup_storyline_0', 'A fine matchup.', 'kale-forecast', forecast.factPack);
    expect(hardFailing(prose.checks)).toEqual(['matchup_storyline_0:parse']);
  });

  it('fails an empty answer and reports length and punctuation slips as soft', () => {
    expect(hardFailing(gradeKaleTask('headline', '', 'kale-recap', recap.factPack).checks)).toContain('headline:non_empty');
    const loud = gradeKaleTask('headline', 'What a round! Everything changed in the standings today and nobody saw it coming. Truly.', 'kale-recap', recap.factPack);
    expect(failing(loud.checks)).toEqual(expect.arrayContaining(['headline:no_exclamation', 'headline:length']));
    expect(hardFailing(loud.checks)).toEqual([]);
  });

  it('needs a narrative that is not cut off mid-sentence', () => {
    const cut = gradeKaleTask('narrative', 'First paragraph about the round.\n\nSecond paragraph that stops mid-wor', 'kale-recap', recap.factPack);
    expect(hardFailing(cut.checks)).toContain('narrative:ends_cleanly');
  });
});

// ─── Call-level checks ──────────────────────────────────────────────

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  taskId: 'main', requestedModel: 'claude-sonnet-5-5', servedModel: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 16000,
  inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, outputChars: 1, ms: 1, costUsd: 0, failedAttemptUsd: 0, costEstimated: false,
  stopReason: 'end_turn', truncated: false, refused: false, fallback: false, error: null, ...over,
});

describe('gradeCall', () => {
  it('passes a clean call', () => {
    expect(failing(gradeCall(call(), ''))).toEqual([]);
  });

  it('fails truncation and refusal, and prefixes the ids for a named task', () => {
    expect(hardFailing(gradeCall(call({ truncated: true, stopReason: 'max_tokens' }), 'headline:'))).toEqual(['headline:not_truncated']);
    expect(hardFailing(gradeCall(call({ refused: true, stopReason: 'refusal' }), ''))).toEqual(['not_refused']);
  });

  it('fails an error call and flags a fallback as soft', () => {
    expect(hardFailing(gradeCall(call({ error: 'other' }), ''))).toEqual(['call_ok']);
    const fb = gradeCall(call({ fallback: true, servedModel: 'claude-haiku-5-5' }), '');
    expect(hardFailing(fb)).toEqual([]);
    expect(failing(fb)).toEqual(['served_as_requested']);
  });

  it('tells a dated id of the same model from a different model', () => {
    expect(servedDiffersFromRequested('claude-sonnet-5-5', 'claude-sonnet-5-5-20261001')).toBe(false);
    expect(servedDiffersFromRequested('claude-sonnet-5-5', 'claude-haiku-5-5')).toBe(true);
    expect(servedDiffersFromRequested('claude-sonnet-5-5', null)).toBe(false);
  });
});

// ─── Cheap checks ───────────────────────────────────────────────────

describe('coach and recap checks', () => {
  const bullets = Array.from({ length: 6 }, (_, i) => `- Point ${i + 1} about the team, with enough words to count as a real bullet for this check.`).join('\n');
  const team = `${bullets}\n\nOverall tier rating: A.`;

  it('accepts a finished team review and rejects an empty, short or cut-off one', () => {
    expect(hardFailing(gradeTeamCoach(`${team}${team}`, 'en'))).toEqual([]);
    expect(hardFailing(gradeTeamCoach('', 'en'))).toContain('non_empty');
    expect(hardFailing(gradeTeamCoach('Too short.', 'en'))).toContain('length');
    expect(hardFailing(gradeTeamCoach(`${team}${team}\n- A final point that stops mid-wor`, 'en'))).toContain('ends_cleanly');
  });

  it('checks slot-coach length and bullet count', () => {
    const slot = '- Run Rocky Helmet over Leftovers on this set for the extra chip damage.\n- Swap Taunt for Toxic to cover bulky Water types that wall you.\n- Max out Speed to outrun the common scarfers in the tier.';
    expect(hardFailing(gradeSlotCoach(slot, 'en'))).toEqual([]);
    expect(hardFailing(gradeSlotCoach('ok', 'en'))).toContain('length');
  });

  it('checks the recap paragraph and the headline split the engine applies', () => {
    const good = 'Ada took the round with a clean sweep of Bram in the opening match. Cleo answered with a comfortable win over Dara to stay level on points.';
    expect(hardFailing(gradeRecap(good, 'en'))).toEqual([]);
    expect(failing(gradeRecap(good, 'en'))).not.toContain('headline_split');
    const abbreviation = 'Mr. Mime stole the show in the final match of the round, and the table behind it tightened up considerably.';
    expect(failing(gradeRecap(abbreviation, 'en'))).toContain('headline_split');
    expect(hardFailing(gradeRecap('Short.', 'en'))).toContain('length');
    expect(hardFailing(gradeRecap(`${good} And then it`, 'en'))).toContain('ends_cleanly');
  });
});

describe('text helpers', () => {
  it('detects English and German and abstains on short text', () => {
    expect(detectLanguage('The match was a tight one and the better plan won in the end for them.')).toBe('en');
    expect(detectLanguage('Das Spiel war ein enges Duell und der bessere Plan hat sich am Ende durchgesetzt.')).toBe('de');
    expect(detectLanguage('Garchomp Kingambit')).toBeNull();
  });

  it('counts sentences and judges endings', () => {
    expect(sentenceCount('One. Two! Three?')).toBe(3);
    expect(sentenceCount('')).toBe(0);
    expect(endsCleanly('Fine.')).toBe(true);
    expect(endsCleanly('Fine and then')).toBe(false);
  });

  it('cuts the first sentence as the recap engine does', () => {
    expect(firstSentenceByDotSplit('Der 3. Platz ging an Ada.').clean).toBe(false);
    expect(firstSentenceByDotSplit('Ada won the round convincingly. Bram followed.').clean).toBe(true);
  });

  it('parses loose JSON like the Kale assembler', () => {
    expect(parseLooseJson('<think>x</think>```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseLooseJson('no json here')).toBeNull();
    expect(parseLooseJson('{"a":')).toBeNull();
  });
});
