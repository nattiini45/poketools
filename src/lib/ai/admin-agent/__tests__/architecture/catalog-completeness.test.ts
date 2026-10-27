/**
 * Plan 3.9 test 7, catalog completeness: every code the assistant can emit exists in the EN and the DE error catalog.
 *
 * `src/i18n/__tests__/error-codes.test.ts` and `parity.test.ts` already hold the repository-wide rules (flat unique keys,
 * every `code: '<x>'` literal under `src/lib` is a key, EN and DE have the same keys). This test adds the view from the
 * assistant: it collects the codes the assistant's own tables and constructors can produce (store, loop, dispatch, registry,
 * readers, previews, staging, the Plan's readiness blockers) and checks each one against both languages, with the same
 * placeholders. It is a ratchet for the codes that are known to be missing: the list below can only shrink. A new code the
 * catalog does not have fails here, with its file, instead of reaching a model or a client as an unrenderable string.
 *
 * Not scanned on purpose: `plans/` (its `code:` fields are Plan edit and issue codes that reach the model inside the text
 * of a `validation_failed`, not as an API code) and `env.ts` (zod issue codes for configuration problems).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { ERROR_CATALOGS } from '@/i18n/messages/errors';
import { LOOP_CODES, codesPendingInCatalog } from '../../loop/codes';
import { PLAN_BLOCKERS } from '../../plans';
import { ADMIN_AGENT_STORE_ERROR_STATUS } from '../../store/errors';
import { isTestPath, relFromRepo, SRC_ROOT, stripComments, walkFiles } from './graph';

const AGENT = 'src/lib/ai/admin-agent';

const en = new Map<string, string>();
const de = new Map<string, string>();
for (const catalog of Object.values(ERROR_CATALOGS)) {
  for (const [code, text] of Object.entries(catalog.en)) en.set(code, String(text));
  for (const [code, text] of Object.entries(catalog.de)) de.set(code, String(text));
}

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)[^}]*\}/g)].map((m) => m[1]).sort();

/**
 * Codes that are emitted and not yet in a catalog, by design of the work in progress. A code may leave this list when the
 * catalog gains it, and none may join it without an owner to add the text. Computed from the tables that carry the flag:
 *  - `PLAN_BLOCKERS` marks 21 readiness blockers `catalog: 'todo'` (`plans/__tests__/blocker-catalog.test.ts` holds that flag). They
 *    reach the model as finding codes and the Plan panel through its own `blockers.<code>` texts (`admin-assistant-cards`),
 *    never as an API error code, so they do not need an `errors/*` entry;
 *  - `LOOP_CODES` names five causes the loop distinguishes; the catalog has them all now and the list is empty.
 */
const pendingBlockers = Object.entries(PLAN_BLOCKERS).filter(([, info]) => info.catalog === 'todo').map(([code]) => code);
const pending = new Set<string>([...pendingBlockers, ...codesPendingInCatalog()]);

/** The most the pending list may hold: it only shrinks. */
const KNOWN_PENDING_LOOP: readonly string[] = [];

// ─── What the source can emit ────────────────────────────────────────

const SCANNED_LAYERS = ['store', 'loop', 'dispatch', 'registry', 'readers', 'previews', 'proposals'];
const files = walkFiles(path.join(SRC_ROOT, 'lib/ai/admin-agent'), (rel) => /\.tsx?$/.test(rel) && !isTestPath(rel)).filter((file) => {
  const rel = relFromRepo(file).replace(`${AGENT}/`, '');
  return SCANNED_LAYERS.some((layer) => rel.startsWith(`${layer}/`)) || rel === 'index.ts';
});

const PATTERNS: RegExp[] = [
  /\bcode:\s*'([A-Za-z][A-Za-z0-9_]*)'/g,
  /\b(?:AdminAgentStoreError|AdminAgentLoopError|StageRefusal|toolError|failureResult)\(\s*'([A-Za-z][A-Za-z0-9_]*)'/g,
];

function literalCodes(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of files) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern)) found.set(match[1], (found.get(match[1]) ?? new Set()).add(relFromRepo(file).replace(`${AGENT}/`, '')));
    }
  }
  return found;
}

/** Codes the dispatcher falls back to by outcome kind (`dispatch/outcome.ts`), which are not written as `code:` fields. */
const DISPATCH_DEFAULTS = ['forbidden', 'not_found_generic', 'step_failed', 'validation_failed', 'unknown_outcome', 'unknown_error', 'upstream_timeout', 'unauthenticated', 'agent_harness_error', 'rate_limited', 'rate_limit_unavailable'];

describe('the codes the assistant can emit', () => {
  const literals = literalCodes();

  it('collects a realistic set from the source', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(literals.size).toBeGreaterThan(30);
    for (const code of ['agent_harness_error', 'tool_not_available', 'validation_failed', 'plan_stale', 'phase_disabled']) expect(literals.has(code), code).toBe(true);
  });

  it('are all in the EN catalog, or on the pending list', () => {
    const missing = [...literals].filter(([code]) => !en.has(code) && !pending.has(code)).map(([code, where]) => `${code} (${[...where].join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('are all in the DE catalog, or on the pending list', () => {
    const missing = [...literals].filter(([code]) => !de.has(code) && !pending.has(code)).map(([code]) => code);
    expect(missing).toEqual([]);
  });

  it('read the same in both languages: the same placeholders, and a text in each', () => {
    const everything = new Set<string>([...literals.keys(), ...DISPATCH_DEFAULTS, ...Object.keys(ADMIN_AGENT_STORE_ERROR_STATUS), ...Object.values(LOOP_CODES).map((entry) => entry.fallback)]);
    for (const code of everything) {
      if (pending.has(code) && !en.has(code)) continue;
      expect(en.get(code)?.trim(), `${code} EN`).toBeTruthy();
      expect(de.get(code)?.trim(), `${code} DE`).toBeTruthy();
      expect(placeholders(de.get(code) ?? ''), `${code} placeholders`).toEqual(placeholders(en.get(code) ?? ''));
    }
  });
});

describe('the tables that carry codes', () => {
  it('has every store error code in both languages', () => {
    for (const code of Object.keys(ADMIN_AGENT_STORE_ERROR_STATUS)) {
      expect(en.has(code), `${code} EN`).toBe(true);
      expect(de.has(code), `${code} DE`).toBe(true);
    }
  });

  it('has every code the dispatcher falls back to in both languages, and uses each of them in outcome.ts', () => {
    const outcome = readFileSync(path.join(SRC_ROOT, 'lib/ai/admin-agent/dispatch/outcome.ts'), 'utf8');
    const types = readFileSync(path.join(SRC_ROOT, 'lib/ai/admin-agent/dispatch/types.ts'), 'utf8');
    for (const code of DISPATCH_DEFAULTS) {
      expect(en.has(code), `${code} EN`).toBe(true);
      expect(de.has(code), `${code} DE`).toBe(true);
      // The list must not go stale: each code is still named in the dispatch sources.
      expect(`${outcome}\n${types}`, code).toContain(code);
    }
  });

  it('has the fallback of every loop cause in the catalog, and a preferred code that is either there or on the known pending list', () => {
    for (const [cause, entry] of Object.entries(LOOP_CODES)) {
      expect(en.has(entry.fallback) && de.has(entry.fallback), `${cause} fallback ${entry.fallback}`).toBe(true);
      expect(en.has(entry.preferred) || KNOWN_PENDING_LOOP.includes(entry.preferred), `${cause} preferred ${entry.preferred}`).toBe(true);
    }
  });

  it('only shrinks the pending lists', () => {
    expect(codesPendingInCatalog().filter((code) => !KNOWN_PENDING_LOOP.includes(code))).toEqual([]);
    // 21 readiness blockers are pending (plans/ open issue 1); a new `todo` must be a decision.
    // (That a code which has reached the catalog gets its flag flipped is `plans/__tests__/blocker-catalog.test.ts`'s check.)
    expect(pendingBlockers.length).toBeLessThanOrEqual(21);
  });

  it('lets a blocker reach the model or a client only as a code with a catalog entry or an explicit pending flag', () => {
    for (const [code, info] of Object.entries(PLAN_BLOCKERS)) {
      if (info.catalog === 'catalog') expect(en.has(code) && de.has(code), `${code} is marked catalogued`).toBe(true);
      else expect(pending.has(code), code).toBe(true);
    }
  });
});

describe('the net catches what it is for', () => {
  it('finds a code in each constructor form and ignores prose and zod codes in comments', () => {
    const sample = stripComments("throw new AdminAgentStoreError('made_up_one');\nreturn toolError('made_up_two');\nreturn { ok: false, code: 'made_up_three' };\n// code: 'in_a_comment'\n/* new StageRefusal('in_a_block') */");
    const found: string[] = [];
    for (const pattern of PATTERNS) for (const match of sample.matchAll(pattern)) found.push(match[1]);
    expect(found.sort()).toEqual(['made_up_one', 'made_up_three', 'made_up_two']);
    expect(en.has('made_up_one')).toBe(false);
  });

  it('compares placeholders by name', () => {
    expect(placeholders('Used {used} of {cap}.')).toEqual(['cap', 'used']);
    expect(placeholders('Genutzt {used} von {cap}.')).toEqual(placeholders('Used {used} of {cap}.'));
    expect(placeholders('Used {count, plural, one {a} other {b}} of {cap}.')).not.toEqual(placeholders('Used of {cap}.'));
  });
});
