import { describe, expect, it } from 'vitest';
import {
  parseStageEndedWarning,
  stageEndedApiWarning,
  stageEndedParams,
  stageEndedWarningToApi,
  type StageEndedWarning,
} from '../stage-ended-warning';
import { encodeDownstreamMatches, parseDownstreamMatches } from '../downstream-matches';

const advanced: StageEndedWarning = {
  phase_id: 'groups',
  phase_name: 'Group stage',
  advanced: [
    { phase_id: 'a', phase_name: 'Playoffs', players: [{ id: 'p1', name: 'Ash' }, { id: 'p2', name: 'Misty' }] },
    { phase_id: 'b', phase_name: 'Consolation', players: [{ id: 'p3', name: 'Brock' }] },
  ],
};

describe('the stage-ended warning', () => {
  it('names the phase and every next phase with its players', () => {
    expect(stageEndedWarningToApi(advanced)).toEqual({
      code: 'admin_game_stage_already_ended',
      params: { phase: 'Group stage', advanced: 'Playoffs: Ash, Misty; Consolation: Brock' },
    });
  });

  it('says nobody advanced for an empty list, and that it could not be read for null: three different messages', () => {
    expect(stageEndedWarningToApi({ ...advanced, advanced: [] })).toEqual({
      code: 'admin_game_stage_already_ended_nobody',
      params: { phase: 'Group stage' },
    });
    expect(stageEndedWarningToApi({ ...advanced, advanced: null })).toEqual({
      code: 'admin_game_stage_already_ended_unlisted',
      params: { phase: 'Group stage' },
    });
  });

  it('round-trips through flat params, which an error response carries when it has no data', () => {
    for (const warning of [advanced, { ...advanced, advanced: [] }, { ...advanced, advanced: null }]) {
      expect(stageEndedApiWarning(stageEndedParams(warning))).toEqual(stageEndedWarningToApi(warning));
    }
    expect(stageEndedApiWarning({ count: 2 })).toBeNull();
    expect(stageEndedApiWarning(null)).toBeNull();
  });

  it('reads a response field defensively', () => {
    expect(parseStageEndedWarning(JSON.parse(JSON.stringify(advanced)))).toEqual(advanced);
    expect(parseStageEndedWarning({ phase_id: 'x', phase_name: 'X', advanced: null })).toEqual({ phase_id: 'x', phase_name: 'X', advanced: null });
    expect(parseStageEndedWarning(undefined)).toBeNull();
    expect(parseStageEndedWarning({ phase_id: 'x' })).toBeNull();
    expect(parseStageEndedWarning({ phase_id: 'x', phase_name: 'X', advanced: [{ phase_id: 'a', players: [] }] })).toBeNull();
    expect(parseStageEndedWarning({ phase_id: 'x', phase_name: 'X', advanced: 'Ash' })).toBeNull();
  });
});

describe('the later matches of a game change refusal', () => {
  const matches = [
    { id: 'm1', round_name: 'Semifinals', player_1_name: 'Ash; "the" Champion', player_2_name: 'Brock, Jr.', status: 'completed' as const },
    { id: 'm2', round_name: 'Finals', player_1_name: 'Ash', player_2_name: 'Misty', status: 'in_progress' as const },
  ];

  it('round-trips any player or round name', () => {
    expect(parseDownstreamMatches(encodeDownstreamMatches(matches))).toEqual(matches);
  });

  it('reads anything that is not the encoded list as no matches, and skips a malformed entry', () => {
    expect(parseDownstreamMatches(undefined)).toEqual([]);
    expect(parseDownstreamMatches(3)).toEqual([]);
    expect(parseDownstreamMatches('not json')).toEqual([]);
    expect(parseDownstreamMatches('{"id":"m1"}')).toEqual([]);
    expect(parseDownstreamMatches(JSON.stringify([{ id: 'm1' }, matches[1]]))).toEqual([matches[1]]);
  });
});
