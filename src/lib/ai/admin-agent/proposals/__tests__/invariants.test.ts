import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import cardsEn from '@/i18n/messages/admin-assistant-cards/en';
import { STAGED_TOOLS } from '../../registry/staged';
import { BUILD_OP_ROUTES } from '../build';
import { CARD_LINE_KINDS, CARD_TEXT_KEYS } from '../card';
import { GOLIVE_NOT_STAGEABLE, GOLIVE_STAGEABLE } from '../golive';
import { PLAN_OPS } from '../../plans/ops';
import { PLAN_OP_INFO } from '../../plans/ops';
import { READ_NAMES } from '../fingerprints';
import { workedExample } from '../../plans/__tests__/fixtures';
import { deriveSteps } from '../../plans/steps';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'src/lib/ai/admin-agent/proposals');
/** The staging side. `executor.ts` is the approve side (it dispatches); its own boundaries are checked in `executor.test.ts`. */
const sources = readdirSync(DIR)
  .filter((file) => file.endsWith('.ts') && file !== 'executor.ts')
  .map((file) => ({ file, text: readFileSync(path.join(DIR, file), 'utf8') }));

interface Binding {
  method: string;
  path: string;
  class: string;
}
const bindings = (JSON.parse(readFileSync(path.join(ROOT, 'scripts/data/route-manifest-bindings.json'), 'utf8')) as { bindings: Binding[] }).bindings;

describe('every B and G tool of the registry is accounted for', () => {
  const staged = STAGED_TOOLS.filter((tool) => tool.class === 'B' || tool.class === 'G').map((tool) => tool.name);

  it('is stageable here, or listed as not stageable yet: a new tool is a conscious decision', () => {
    const known = new Set<string>(['propose_build', 'propose_undo', ...GOLIVE_STAGEABLE, ...GOLIVE_NOT_STAGEABLE]);
    expect(staged.filter((name) => !known.has(name))).toEqual([]);
    expect([...known].filter((name) => !staged.includes(name))).toEqual([]);
    expect(GOLIVE_STAGEABLE.filter((name) => (GOLIVE_NOT_STAGEABLE as readonly string[]).includes(name))).toEqual([]);
  });

  it('only stages the phase-1 Go-live tools it has fingerprints, preflight and a card for', () => {
    expect([...GOLIVE_STAGEABLE].sort()).toEqual(['propose_generate_bracket', 'propose_move_pin', 'propose_publish_ruleset', 'propose_start_phase']);
    for (const name of GOLIVE_STAGEABLE) expect(STAGED_TOOLS.find((tool) => tool.name === name)?.class).toBe('G');
  });

  it('every stageable Go-live tool declares the outward effects and the verify the card and the executor need', () => {
    for (const name of GOLIVE_STAGEABLE) {
      const tool = STAGED_TOOLS.find((entry) => entry.name === name);
      expect(tool?.outwardEffects?.length, name).toBeGreaterThan(0);
      expect(tool?.verify, name).toBeTruthy();
    }
  });
});

describe('Build ops and their routes', () => {
  it('has a route for every op the Plan can derive', () => {
    expect(Object.keys(BUILD_OP_ROUTES).sort()).toEqual([...PLAN_OPS].sort());
  });

  it('agrees with the route-manifest bindings (class B) wherever a binding exists', () => {
    const bound = new Set(bindings.filter((b) => b.class === 'B').map((b) => `${b.method} ${b.path}`));
    const unbound = Object.entries(BUILD_OP_ROUTES)
      .filter(([, route]) => !bound.has(`${route.method} ${route.routeTemplate}`))
      .map(([op]) => op)
      .sort();
    // Not bound yet (phases 2 and 4): the approve route refuses a proposal whose op has no binding, so staging them is safe.
    expect(unbound).toEqual(['draft_pool_create', 'groups_set']);
  });

  it('the registry lists the Build routes the example Plan uses', () => {
    const propose = STAGED_TOOLS.find((tool) => tool.name === 'propose_build');
    const listed = new Set((propose?.routes ?? []).map((route) => `${route.method} ${route.path}`));
    for (const step of deriveSteps(workedExample())) {
      const route = BUILD_OP_ROUTES[step.op];
      expect(listed.has(`${route.method} ${route.routeTemplate}`), step.op).toBe(true);
    }
  });

  it('every read a Plan op declares is a fingerprint read this module knows', () => {
    const reads = new Set<string>(READ_NAMES);
    for (const op of PLAN_OPS) for (const read of PLAN_OP_INFO[op].reads) expect(reads.has(read), `${op}: ${read}`).toBe(true);
    expect(reads.has('epb_battle_ruleset_head')).toBe(true);
  });
});

describe('the card text keys', () => {
  const lookup = (tree: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined), tree);

  it('maps every line kind, and each mapped key exists in the cards catalog', () => {
    expect(Object.keys(CARD_TEXT_KEYS).sort()).toEqual([...CARD_LINE_KINDS].sort());
    for (const [kind, key] of Object.entries(CARD_TEXT_KEYS)) {
      if (key !== null) expect(lookup(cardsEn, key), `${kind} -> ${key}`).toBeTypeOf('string');
    }
  });
});

describe('module boundaries (plan 3.2, 3.9 tests 3, 4 and 8)', () => {
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('never writes a domain table, calls a route or reaches the executor', () => {
    for (const { file, text } of sources) {
      const body = code(text);
      // `.update(` is the HMAC in token.ts, the one crypto module.
      expect(body, file).not.toMatch(file === 'token.ts' ? /\.(insert|upsert|delete|rpc)\s*\(/ : /\.(insert|update|upsert|delete|rpc)\s*\(/);
      expect(body, file).not.toMatch(/\.from\(\s*['"`]/);
      expect(body, file).not.toMatch(/runAsVerifiedSession|invokeRoute|from ['"]\.\.\/dispatch|executor/);
      expect(body, file).not.toMatch(/from ['"]next\//);
      expect(body, file).not.toMatch(/@\/lib\/supabase\/client|SUPABASE_SERVICE_ROLE/);
    }
  });

  it('reaches the assistant tables only through the store', () => {
    for (const { file, text } of sources) expect(code(text), file).not.toMatch(/admin_agent_/);
  });

  it('keeps every live module import in live.ts: the staging code itself is pure and injected', () => {
    for (const { file, text } of sources) {
      if (file === 'live.ts' || file === 'index.ts' || file === 'serve.ts') continue;
      expect(code(text), file).not.toMatch(/from ['"]@\/lib\/(supabase|auth|ruleset-studio\/(guards|library|pin-impact|compile))/);
      expect(code(text), file).not.toMatch(/process\.env/);
    }
  });

  it('never puts the approval token in anything but the token module and the stager that hashes and serves it', () => {
    const users = sources.filter(({ text }) => /deriveApprovalToken/.test(code(text))).map(({ file }) => file).sort();
    expect(users).toEqual(['stage.ts', 'token.ts']);
  });

  it('keeps the token getter and the card reader out of the barrel the chat loop imports', () => {
    const index = code(sources.find(({ file }) => file === 'index.ts')?.text ?? '');
    expect(index).not.toMatch(/getApprovalToken|deriveApprovalToken|getCard|\.\/serve/);
    const serve = code(sources.find(({ file }) => file === 'serve.ts')?.text ?? '');
    expect(serve).toMatch(/getApprovalToken/);
  });
});
