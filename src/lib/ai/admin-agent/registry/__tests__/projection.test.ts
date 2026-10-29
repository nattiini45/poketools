import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { ALL_TOOLS, type RunnableTool } from '../index';

/**
 * The output schemas ARE the projection (plan 3.6.2, 6.3, 6.6): a strict allow-list per tool. This test walks every
 * runnable tool's output schema and fails on
 *  - an object that is not closed (a new column could pass through),
 *  - a free-text string that is not a fenced `label` / `user_text` field (stored text that bypasses the fence),
 *  - a fenced field under a name the prompt does not teach (`label`, `*_label` or `*_labels` for a short name, `user_text` or
 *    `*_user_text` for longer text),
 *  - a field name that is one of the private player or match columns.
 */

type Schema = Record<string, unknown>;

const runnable = ALL_TOOLS.filter((tool): tool is RunnableTool => tool.class === 'R' || tool.class === 'P');

const PRIVATE_KEYS = new Set([
  'discord_id',
  'auth_user_id',
  'ban_reason',
  'suspended_until',
  'is_admin',
  'is_test_account',
  'avatar_config',
  'avatar_url',
  'password',
  'webhook_url',
  'url',
  'token',
  'ip_address',
  'submitter_id',
  'notes',
  'auto_confirm_at',
  'confirmed_at',
  'spec_seed',
]);

interface Finding {
  path: string;
  problem: string;
}

function walk(node: Schema, path: string, key: string, findings: Finding[]): void {
  const type = node.type;
  if (type === 'object') {
    if (node.additionalProperties !== false) findings.push({ path, problem: 'object is not closed' });
    for (const [name, child] of Object.entries((node.properties ?? {}) as Record<string, Schema>)) {
      if (PRIVATE_KEYS.has(name)) findings.push({ path: `${path}.${name}`, problem: 'private column name in an output' });
      walk(child, `${path}.${name}`, name, findings);
    }
    return;
  }
  if (type === 'array') {
    walk(node.items as Schema, `${path}[]`, key, findings);
    return;
  }
  if (Array.isArray(node.anyOf)) {
    for (const [index, branch] of (node.anyOf as Schema[]).entries()) walk(branch, `${path}|${index}`, key, findings);
    return;
  }
  if (type === 'string') {
    const fenced = node.fenced as string | undefined;
    if (fenced !== undefined) {
      const allowed = fenced === 'label' ? /^(.+_)?labels?$/.test(key) : key === 'user_text' || key.endsWith('_user_text');
      if (!allowed) findings.push({ path, problem: `fenced ${fenced} under the name ${key}` });
      if (node.maxLength === undefined) findings.push({ path, problem: 'fenced text without a length cap' });
      return;
    }
    const constrained = node.enum !== undefined || node.const !== undefined || node.pattern !== undefined || node.format !== undefined;
    if (!constrained) findings.push({ path, problem: 'free-text string that is neither constrained nor fenced' });
    return;
  }
  if (type === 'number' || type === 'integer' || type === 'boolean' || type === 'null') return;
  if (Array.isArray(type) && type.every((entry) => ['boolean', 'number', 'integer', 'null'].includes(String(entry)))) return;
  if (node.enum !== undefined || node.const !== undefined) return;
  findings.push({ path, problem: `unexpected schema node (${JSON.stringify(node).slice(0, 80)})` });
}

function findingsOf(tool: RunnableTool): Finding[] {
  const schema = z.toJSONSchema(tool.output, { io: 'output', unrepresentable: 'throw', reused: 'inline', cycles: 'throw' }) as Schema;
  const findings: Finding[] = [];
  walk(schema, tool.name, '', findings);
  return findings;
}

describe('output schemas are strict allow-lists', () => {
  for (const tool of runnable) {
    it(`${tool.name}: closed objects, fenced free text, no private column`, () => {
      expect(findingsOf(tool)).toEqual([]);
    });
  }

  it('catches what it is meant to catch', () => {
    const open = z.looseObject({ name: z.string() });
    const bad = z.toJSONSchema(open, { io: 'output' }) as Schema;
    const findings: Finding[] = [];
    walk(bad, 'x', '', findings);
    expect(findings.map((f) => f.problem)).toEqual(expect.arrayContaining(['object is not closed', 'free-text string that is neither constrained nor fenced']));

    const renamed = z.toJSONSchema(z.strictObject({ name: z.string().max(10).meta({ fenced: 'label' }), discord_id: z.string().regex(/^\d+$/) }), { io: 'output' }) as Schema;
    const second: Finding[] = [];
    walk(renamed, 'x', '', second);
    expect(second.map((f) => f.problem)).toEqual(expect.arrayContaining(['fenced label under the name name', 'private column name in an output']));
  });
});

describe('the strict schema is what stops a leak at run time', () => {
  it('rejects a result with an extra, unlisted field in a nested list', () => {
    const roster = runnable.find((tool) => tool.name === 'league_roster_get')!;
    const good = { players: { items: [{ id: '11111111-1111-4111-8111-111111111111', label: 'Mara', gym_type: null, group_id: null }], total: 1, truncated: false, cap: 128 } };
    expect(roster.output.safeParse(good).success).toBe(true);
    const leaky = structuredClone(good) as typeof good & { players: { items: Array<Record<string, unknown>> } };
    leaky.players.items[0].discord_id = 'discord-SECRET-111';
    expect(roster.output.safeParse(leaky).success).toBe(false);
  });
});
