/**
 * The eval harness must not hide a tool call the strict schema refuses: the model never sees the server-set fields, so
 * the failure shows only in the tool RESULT.
 */
import { describe, expect, it } from 'vitest';
import { hasToolSchemaFailure } from '../eval-scoring';
import { AGENT_TOOLS } from '../tools/registry';
import { executeTool } from '../tools/execute';
import { applyToolOverrides } from '../orchestrator';
import { dryRunIdentity } from '../memory';

const team = [{ species: 'Garchomp', moves: ['Earthquake'] }];
const MATCH = '00000000-0000-4000-8000-0000000000a1';

describe('hasToolSchemaFailure', () => {
  it('is false for a clean run', () => {
    const steps = [
      { toolCalls: [{ toolName: 'validateTeam', input: { team, format: 'gen9ou' } }], toolResults: [{ toolName: 'validateTeam', output: { valid: true } }] },
    ];
    expect(hasToolSchemaFailure(steps, AGENT_TOOLS)).toBe(false);
  });

  it('counts a call the model-facing schema refuses, and an unknown tool', () => {
    expect(hasToolSchemaFailure([{ toolCalls: [{ toolName: 'validateTeam', input: { format: 'gen9ou' } }] }], AGENT_TOOLS)).toBe(true);
    expect(hasToolSchemaFailure([{ toolCalls: [{ toolName: 'nope', input: {} }] }], AGENT_TOOLS)).toBe(true);
  });

  it('counts a call the STRICT schema refused after the overrides, seen only in the tool result', () => {
    const steps = [
      {
        toolCalls: [{ toolName: 'getMatchAnalysisContext', input: { matchId: MATCH } }],
        toolResults: [{ toolName: 'getMatchAnalysisContext', output: { error: "Invalid input for 'getMatchAnalysisContext': requesterId: Invalid UUID" } }],
      },
    ];
    expect(hasToolSchemaFailure(steps, AGENT_TOOLS)).toBe(true);
  });

  it('does not count other tool errors (a refusal, a timeout) as schema failures', () => {
    const steps = [{ toolResults: [{ toolName: 'getMatchAnalysisContext', output: { error: 'No match context is available for that match id.' } }] }];
    expect(hasToolSchemaFailure(steps, AGENT_TOOLS)).toBe(false);
  });
});

describe('the harness identity passes the strict schemas (the regression)', () => {
  const overrides = { userId: dryRunIdentity('deepseek-v4-pro'), rulesetId: null, playerCore: null, seasonId: null };

  it.each([
    ['validateTeam', { team, format: 'gen9ou' }],
    ['getMatchAnalysisContext', { matchId: MATCH }],
    ['getMatchHistory', {}],
    ['getUpcomingMatches', {}],
  ])('%s is not refused by its strict schema', (name, input) => {
    const strict = AGENT_TOOLS[name].inputSchema.safeParse(applyToolOverrides(name, input, overrides));
    expect(strict.success).toBe(true);
  });

  it('while the old eval-<model> id is refused by them (why the harness needed a UUID)', async () => {
    const old = { ...overrides, userId: 'eval-deepseek-v4-pro' };
    const result = await executeTool('getMatchAnalysisContext', applyToolOverrides('getMatchAnalysisContext', { matchId: MATCH }, old));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.startsWith('Invalid input for')).toBe(true);
  });
});
