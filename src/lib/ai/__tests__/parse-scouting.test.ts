import { describe, it, expect } from 'vitest';
import { parseScoutingResponse } from '../parse-scouting';

const base = {
  opponent_profile: 'A patient sun pilot.',
  signature_pokemon: [{ pokemon: 'Vulpix', usage_note: 'Leads to set Drought.' }],
  tendencies: { lead_patterns: 'Leads Vulpix.', play_style: 'Setup.', favorite_moves: 'Solar Beam.' },
  meta_positioning: 'Sun core.',
  recommendations: {
    threats_to_watch: ['Scovillain'],
    suggested_leads: 'Lead a sun blocker.',
    coverage_gaps: 'Weak to rain.',
    key_advice: 'Deny the sun.',
  },
};

describe('parseScoutingResponse', () => {
  it('parses a clean no-team report and keeps suggested_picks, drops matchup_analysis', () => {
    const json = JSON.stringify({
      ...base,
      suggested_picks: [{ pokemon: 'Rhydon', role: 'Wall', set_summary: 'Eviolite / ...', reasoning: 'Blanks sweepers.' }],
      matchup_analysis: { your_advantages: 'x', their_advantages: 'y', neutral_ground: 'z' },
    });

    const result = parseScoutingResponse(json, false);

    expect(result.opponent_profile).toBe('A patient sun pilot.');
    expect(result.suggested_picks).toHaveLength(1);
    expect(result.suggested_picks?.[0].pokemon).toBe('Rhydon');
    // hasUserTeam=false → matchup_analysis is excluded even if the model sends it.
    expect(result.matchup_analysis).toBeUndefined();
  });

  it('parses a with-team report and keeps matchup_analysis, drops suggested_picks', () => {
    const json = JSON.stringify({
      ...base,
      matchup_analysis: { your_advantages: 'x', their_advantages: 'y', neutral_ground: 'z' },
      suggested_picks: [{ pokemon: 'Rhydon', role: 'Wall', set_summary: '...', reasoning: '...' }],
    });

    const result = parseScoutingResponse(json, true);

    expect(result.matchup_analysis?.your_advantages).toBe('x');
    expect(result.suggested_picks).toBeUndefined();
  });

  it('strips <think> blocks and markdown fences before parsing', () => {
    const wrapped = `<think>let me scout</think>\n\`\`\`json\n${JSON.stringify(base)}\n\`\`\``;
    const result = parseScoutingResponse(wrapped, false);
    expect(result.recommendations.threats_to_watch).toEqual(['Scovillain']);
  });

  it('throws when no JSON object is present', () => {
    expect(() => parseScoutingResponse('the professor is unavailable', false)).toThrow(
      /No JSON object/,
    );
  });

  it('throws when a required field is missing', () => {
    const json = JSON.stringify({ ...base, opponent_profile: undefined });
    expect(() => parseScoutingResponse(json, false)).toThrow(/opponent_profile/);
  });
});
