import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { ADMIN_AGENT_PHASES } from '../../env';
import { buildToolSet, chooseStrictTools, schemaCost, STRICT_LIMITS } from '../index';

/**
 * The strict budget (spike S4): the Messages API refuses a whole request with more than 20 strict tools, more than 24
 * optional or more than 16 union-typed parameters across the strict schemas. Every set the registry can build must fit.
 */
describe('strict budget', () => {
  it('counts optional and union parameters at every depth', () => {
    expect(
      schemaCost({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: ['string', 'null'] },
          c: { type: 'array', items: { type: 'object', properties: { d: { type: 'number' }, e: { anyOf: [{ type: 'string' }, { type: 'number' }] } }, required: ['d'] } },
        },
        required: ['a'],
      }),
    ).toMatchObject({ optional: 3, unions: 2, enumChars: 0 });
  });

  it('prefers stage-only tools, then P, then R, and stops at the limits', () => {
    const optional = (n: number) => ({ type: 'object', properties: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { type: 'string' }])) });
    const chosen = chooseStrictTools([
      { name: 'read_a', class: 'R', inputSchema: optional(0) },
      { name: 'preview_a', class: 'P', inputSchema: optional(0) },
      { name: 'propose_a', class: 'B', inputSchema: optional(20) },
      { name: 'propose_b', class: 'G', inputSchema: optional(5) },
    ]);
    expect([...chosen]).toEqual(['propose_a', 'preview_a', 'read_a']);
  });

  it('caps the number of strict tools', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `t${String(i).padStart(2, '0')}`, class: 'R' as const, inputSchema: { type: 'object', properties: {} } }));
    expect(chooseStrictTools(many).size).toBe(STRICT_LIMITS.tools);
  });

  for (const maxPhase of ADMIN_AGENT_PHASES) {
    for (const role of ['site', 'scoped'] as const) {
      it(`keeps the ${role} set of phase ${maxPhase} within the API limits`, () => {
        const strict = buildToolSet({ role, maxPhase }).tools.filter((tool) => tool.strict);
        const cost = strict
          .map((tool) => schemaCost(tool.input_schema))
          .reduce((a, b) => ({ optional: a.optional + b.optional, unions: a.unions + b.unions, enumChars: a.enumChars + b.enumChars, bytes: a.bytes + b.bytes }));
        expect(strict.length).toBeGreaterThan(0);
        expect(strict.length).toBeLessThanOrEqual(STRICT_LIMITS.tools);
        expect(cost.optional).toBeLessThanOrEqual(STRICT_LIMITS.optional);
        expect(cost.unions).toBeLessThanOrEqual(STRICT_LIMITS.unions);
        expect(cost.enumChars).toBeLessThanOrEqual(STRICT_LIMITS.enumChars);
        expect(cost.bytes).toBeLessThanOrEqual(STRICT_LIMITS.bytes);
      });
    }
  }
});
