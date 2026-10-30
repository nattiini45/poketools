/**
 * Server-set fields are not part of what the model sees. A value the model invents for one (a hallucinated, non-uuid id)
 * must not fail the call before `applyToolOverrides` replaces it; the strict schema runs only after the override.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from '../registry';
import { applyToolOverrides } from '../../orchestrator';

const ME = '00000000-0000-4000-8000-000000000011';
const SEASON = '00000000-0000-4000-8000-000000000002';
const MATCH = '00000000-0000-4000-8000-0000000000a1';
const overrides = { userId: ME, rulesetId: 'rs-1', playerCore: ['Fire', 'Water', 'Grass'], seasonId: SEASON };

const model = (name: string) => AGENT_TOOLS[name].modelInputSchema ?? AGENT_TOOLS[name].inputSchema;

/** The whole path of one call: the model's input, its schema, the server's overrides, the strict schema. */
function pass(name: string, modelInput: unknown) {
  const seen = model(name).safeParse(modelInput);
  if (!seen.success) return { stage: 'model' as const, error: seen.error.message };
  const strict = AGENT_TOOLS[name].inputSchema.safeParse(applyToolOverrides(name, seen.data, overrides));
  return strict.success ? { stage: 'ok' as const, data: strict.data as Record<string, unknown> } : { stage: 'strict' as const, error: strict.error.message };
}

describe('the model-facing schemas leave out what the server sets', () => {
  it.each([
    ['validateTeam', ['player_id', 'season_id']],
    ['getMatchAnalysisContext', ['requesterId']],
  ])('%s does not expose %j to the model', (name, fields) => {
    const json = JSON.stringify(model(name).safeParse({ team: [{ species: 'Garchomp', moves: ['Earthquake'] }], format: 'gen9ou', matchId: MATCH }).data);
    for (const field of fields) expect(json).not.toContain(field);
    const modelShape = (model(name) as unknown as { shape: Record<string, unknown> }).shape;
    for (const field of fields) expect(modelShape).not.toHaveProperty(field);
  });
});

describe('a hallucinated value for a server-set field is replaced, not fatal', () => {
  const team = [{ species: 'Garchomp', moves: ['Earthquake'] }];

  it('validateTeam: non-uuid player_id and season_id are dropped, then the server’s are set', () => {
    const out = pass('validateTeam', { team, format: 'gen9ou', player_id: 'my-id', season_id: 'the-league' });
    expect(out.stage).toBe('ok');
    if (out.stage === 'ok') expect(out.data).toMatchObject({ player_id: ME, season_id: SEASON });
  });

  it('validateTeam: a malformed ruleset id and player core are replaced by the resolved league’s', () => {
    const out = pass('validateTeam', { team, format: 'gen9ou', ruleset_id: '', player_core: ['only-one'] });
    expect(out.stage).toBe('ok');
    if (out.stage === 'ok') expect(out.data).toMatchObject({ ruleset_id: 'rs-1', player_core: ['Fire', 'Water', 'Grass'] });
  });

  it('buildTeam: a malformed ruleset id and player core are replaced too', () => {
    const out = pass('buildTeam', { format: 'gen9ou', ruleset_id: '', player_core: ['a', 'b'] });
    expect(out.stage).toBe('ok');
    if (out.stage === 'ok') expect(out.data).toMatchObject({ ruleset_id: 'rs-1', player_core: ['Fire', 'Water', 'Grass'] });
  });

  it('getMatchAnalysisContext: a non-uuid requesterId is dropped, then the authenticated player is set', () => {
    const out = pass('getMatchAnalysisContext', { matchId: MATCH, requesterId: 'admin' });
    expect(out.stage).toBe('ok');
    if (out.stage === 'ok') expect(out.data).toEqual({ matchId: MATCH, requesterId: ME });
  });

  it('getMatchHistory / getUpcomingMatches: the model may leave playerId out; the server fills the authenticated player', () => {
    for (const name of ['getMatchHistory', 'getUpcomingMatches']) {
      const out = pass(name, {});
      expect(out.stage, name).toBe('ok');
      if (out.stage === 'ok') expect(out.data.playerId).toBe(ME);
    }
  });

  it('a playerId the model does supply (an opponent) must still be a uuid', () => {
    expect(pass('getMatchHistory', { playerId: 'not-a-uuid' }).stage).toBe('model');
  });
});

describe('the strict schema stays strict', () => {
  it('still accepts the server-set fields, for the server to fill', () => {
    const strict = AGENT_TOOLS.validateTeam.inputSchema.safeParse({
      team: [{ species: 'Garchomp', moves: ['Earthquake'] }],
      format: 'gen9ou',
      player_id: ME,
      season_id: SEASON,
    });
    expect(strict.success).toBe(true);
    expect(AGENT_TOOLS.getMatchAnalysisContext.inputSchema.safeParse({ matchId: MATCH, requesterId: ME }).success).toBe(true);
  });

  it('a direct caller that skipped applyToolOverrides fails closed where the tool depends on the identity', () => {
    // match context: no requester, no answer
    expect(AGENT_TOOLS.getMatchAnalysisContext.inputSchema.safeParse({ matchId: MATCH }).success).toBe(false);
    // validateTeam: a league (season_id) needs its player; without a league neither is needed
    const team = [{ species: 'Garchomp', moves: ['Earthquake'] }];
    expect(AGENT_TOOLS.validateTeam.inputSchema.safeParse({ team, format: 'gen9ou', season_id: SEASON }).success).toBe(false);
    expect(AGENT_TOOLS.validateTeam.inputSchema.safeParse({ team, format: 'gen9ou' }).success).toBe(true);
    expect(AGENT_TOOLS.validateTeam.inputSchema.safeParse({ team, format: 'gen9ou', player_id: ME }).success).toBe(true);
  });

  it('rejects a non-uuid server-set field that reaches it (a server bug must not slip through)', () => {
    expect(AGENT_TOOLS.validateTeam.inputSchema.safeParse({ team: [{ species: 'Garchomp', moves: ['Earthquake'] }], format: 'gen9ou', player_id: 'x' }).success).toBe(false);
    expect(AGENT_TOOLS.getMatchAnalysisContext.inputSchema.safeParse({ matchId: MATCH, requesterId: 'x' }).success).toBe(false);
    expect(AGENT_TOOLS.getMatchHistory.inputSchema.safeParse({}).success).toBe(false);
  });
});
