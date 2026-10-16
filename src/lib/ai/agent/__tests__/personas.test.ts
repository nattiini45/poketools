import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../personas';

describe('buildSystemPrompt', () => {
  it('includes the shared tool-usage policy for Linden teambuilding', () => {
    const prompt = buildSystemPrompt('linden_teambuilding', '');
    expect(prompt).toContain('Tool-usage policy');
    expect(prompt).toContain('NEVER guess or estimate numbers');
    expect(prompt).toContain('competitive Pokémon assistant');
  });

  it('includes the Linden teambuilding workflow', () => {
    const prompt = buildSystemPrompt('linden_teambuilding', '');
    expect(prompt).toContain('Professor Linden');
    expect(prompt).toContain('Mode: Teambuilding');
    expect(prompt).toContain('Validate the core');
    expect(prompt).toContain('validateTeam');
    // Re-run analysis on changes is part of the sketch.
    expect(prompt).toMatch(/re-run/i);
  });

  it('steers full-team requests to a single buildTeam call', () => {
    const prompt = buildSystemPrompt('linden_teambuilding', '');
    expect(prompt).toContain('buildTeam');
    expect(prompt).toMatch(/buildTeam ONCE/);
  });

  it('includes the match-prep workflow in match-prep mode', () => {
    const prompt = buildSystemPrompt('linden_match_prep', '');
    expect(prompt).toContain('Mode: Match Prep');
    expect(prompt).toContain('Scout the opponent');
    expect(prompt).toContain('calculateDamage');
  });

  it('appends the rendered context pack when provided', () => {
    const md = '## Player context\n- Profile — favourites: Garchomp';
    const prompt = buildSystemPrompt('linden_teambuilding', md);
    expect(prompt).toContain(md);
  });

  it('omits an empty context pack cleanly', () => {
    const prompt = buildSystemPrompt('linden_teambuilding', '   ');
    expect(prompt).not.toContain('## Player context');
  });

  it('builds the Kale persona with grounding policy and both workflows', () => {
    const prompt = buildSystemPrompt('kale', '');
    // Shared base is still composed in.
    expect(prompt).toContain('Tool-usage policy');
    // Kale voice + grounding guardrail.
    expect(prompt).toContain('Kale');
    expect(prompt).toContain('Grounding policy');
    expect(prompt).toMatch(/MUST come from a tool result/);
    // Both workflows are advertised.
    expect(prompt).toContain('Mode: Round Recap');
    expect(prompt).toContain('Mode: Round Forecast');
    expect(prompt).toContain('queryLeagueData');
    expect(prompt).toContain('getUpcomingMatches');
  });

  it('appends the context pack for Kale too', () => {
    const md = '## Player context\n- Profile';
    expect(buildSystemPrompt('kale', md)).toContain(md);
  });
});
