import { describe, expect, it } from 'vitest';
import { computeArgsHash, computePreviewHash, computeProposalHash } from '../../plans/hash';
import { escalateClass } from '../class';
import {
  buildPreconditions,
  changedPreconditions,
  checkedEntries,
  fingerprintOf,
  preconditionsHash,
  ReadUnavailable,
  type FingerprintSource,
  type PreconditionSpec,
} from '../fingerprints';
import { collectUuids, unknownReferences } from '../provenance';
import { argsHashOf, sealStep, stepHashMatches, type StepDraft } from '../steps';
import { sanitizeCardText, scanStagedText } from '../text';
import { approvalTokenHash, deriveApprovalToken } from '../token';
import { checkTurnStaging, MAX_GOLIVE_PER_TURN, newTurnStaging, recordTurnStaging } from '../turn';

const SECRET = 'a-secret-that-is-long-enough-for-hmac';
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';

describe('scanStagedText (plan 6.3 item 8)', () => {
  it('finds bidi and control characters, URLs and markdown links, with a pointer to the string', () => {
    const findings = scanStagedText({
      name: 'ok',
      nested: { list: ['fine', 'a‮b', 'https://evil.example', '[x](y)', 'line\u0000break', 'discord.gg/abc'] },
    });
    expect(findings).toEqual([
      { path: '/nested/list/1', reason: 'bidi_characters' },
      { path: '/nested/list/2', reason: 'url' },
      { path: '/nested/list/3', reason: 'markdown_link' },
      { path: '/nested/list/4', reason: 'control_characters' },
      { path: '/nested/list/5', reason: 'url' },
    ]);
  });

  it('passes plain text, ordinary punctuation and non-Latin names', () => {
    expect(scanStagedText({ a: 'Gen 9 OU - Spring (2026) cup!', b: 'Ünïcödé 日本語', c: 'line one\nline two', d: 5, e: null })).toEqual([]);
  });

  it('escapes slashes and tildes in the pointer', () => {
    expect(scanStagedText({ 'a/b~c': 'x‮y' })).toEqual([{ path: '/a~1b~0c', reason: 'bidi_characters' }]);
  });
});

describe('sanitizeCardText', () => {
  it('strips hidden characters, counts them, collapses whitespace, NFC-normalises and caps the length', () => {
    expect(sanitizeCardText('  Spring‮   Cup​\u0007 ')).toEqual({ text: 'Spring Cup', hidden: 3 });
    expect(sanitizeCardText('é')).toEqual({ text: 'é', hidden: 0 });
    const long = sanitizeCardText('x'.repeat(500), 20);
    expect([...long.text]).toHaveLength(20);
    expect(long.text.endsWith('…')).toBe(true);
  });
});

describe('provenance (plan 4.5)', () => {
  it('collects uuid-valued strings only, lower-cased, skipping $ref objects and uuids inside prose', () => {
    expect(
      collectUuids({
        id: A.toUpperCase(),
        list: [B, { $ref: 'league.id' }],
        prose: `see ${A} for more`,
        number: 4,
        deep: { id: A },
      }),
    ).toEqual([A, B]);
  });

  it('returns the ids the conversation has not seen, minus the exempt ones', async () => {
    const known = async (ids: string[]) => new Set(ids.filter((id) => id === A));
    expect(await unknownReferences([A, B], new Set(), known)).toEqual([B]);
    expect(await unknownReferences([A, B], new Set([B]), known)).toEqual([]);
    let asked = false;
    expect(
      await unknownReferences([B], new Set([B]), async () => {
        asked = true;
        return new Set();
      }),
    ).toEqual([]);
    expect(asked).toBe(false);
  });
});

describe('turn limits (plan 3.4)', () => {
  it('allows one Go-live proposal and four stagings per turn', () => {
    const turn = newTurnStaging();
    expect(checkTurnStaging(turn, 'G', 4)).toBeNull();
    recordTurnStaging(turn, 'G');
    expect(checkTurnStaging(turn, 'G', 4)).toEqual({ code: 'agent_cap_reached', params: { limit: MAX_GOLIVE_PER_TURN } });
    // A Build is not a Go-live card: it still fits.
    expect(checkTurnStaging(turn, 'B', 4)).toBeNull();
    recordTurnStaging(turn, 'B');
    recordTurnStaging(turn, 'B');
    recordTurnStaging(turn, 'B');
    expect(turn).toEqual({ stagings: 4, goLive: 1 });
    expect(checkTurnStaging(turn, 'B', 4)).toEqual({ code: 'agent_cap_reached', params: { limit: 4 } });
  });
});

describe('class escalation (plan 3.5 rule 1)', () => {
  it('only ever raises', () => {
    expect(escalateClass('B', [])).toBe('B');
    expect(escalateClass('B', ['G'])).toBe('G');
    expect(escalateClass('G', ['B'])).toBe('G');
    expect(escalateClass('G', [])).toBe('G');
  });
});

describe('approval token', () => {
  it('is 256 bits, deterministic for one proposal and admin, and different for any other', () => {
    const token = deriveApprovalToken(SECRET, A, B);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveApprovalToken(SECRET, A.toUpperCase(), B)).toBe(token);
    expect(deriveApprovalToken(SECRET, B, B)).not.toBe(token);
    expect(deriveApprovalToken(SECRET, A, A)).not.toBe(token);
    expect(deriveApprovalToken(`${SECRET}x`, A, B)).not.toBe(token);
    expect(approvalTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(approvalTokenHash(token)).not.toBe(token);
  });

  it('refuses a missing or short secret', () => {
    expect(() => deriveApprovalToken('', A, B)).toThrow();
    expect(() => deriveApprovalToken('short', A, B)).toThrow();
  });
});

const step = (overrides: Partial<StepDraft> = {}): StepDraft => ({
  key: 'league',
  op: 'league_create',
  class: 'B',
  method: 'POST',
  route_template: '/api/seasons',
  path_params: {},
  query: {},
  body_template: { name: 'Cup', format_type: 'singles', ruleset_id: A },
  min_role: 'any',
  blocked_by: [],
  entity_type: 'season',
  creates: true,
  ref_key: 'league',
  verify: 'season_exists',
  reversal: 'archive_league',
  preconditions: [],
  outward_effects: [],
  targets: [],
  ...overrides,
});
const ids = { adminId: A, conversationId: B, proposalId: '00000000-0000-4000-8000-000000000003' };

describe('hash stability (plan 4.5 "Binding the approval to the exact request")', () => {
  it('args_hash does not depend on key order and covers every field the request is built from', () => {
    const base = argsHashOf(step(), ids);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(argsHashOf(step({ body_template: { ruleset_id: A, format_type: 'singles', name: 'Cup' } }), ids)).toBe(base);
    for (const changed of [
      step({ body_template: { name: 'Cup 2', format_type: 'singles', ruleset_id: A } }),
      step({ op: 'phase_create' }),
      step({ method: 'PUT' }),
      step({ route_template: '/api/tournaments' }),
      step({ path_params: { id: A } }),
      step({ query: { x: 1 } }),
      step({ key: 'other' }),
    ]) {
      expect(argsHashOf(changed, ids)).not.toBe(base);
    }
    // Bound to the admin, the conversation and the proposal: a step cannot be moved to another proposal.
    expect(argsHashOf(step(), { ...ids, adminId: B })).not.toBe(base);
    expect(argsHashOf(step(), { ...ids, conversationId: A })).not.toBe(base);
    expect(argsHashOf(step(), { ...ids, proposalId: A })).not.toBe(base);
  });

  it('a symbolic reference is hashed as the template, not as a resolved value', () => {
    const ref = step({ path_params: { id: { $ref: 'league.id' } } });
    expect(argsHashOf(ref, ids)).toBe(argsHashOf(step({ path_params: { id: { $ref: 'league.id' } } }), ids));
    expect(argsHashOf(ref, ids)).not.toBe(argsHashOf(step({ path_params: { id: A } }), ids));
  });

  it('a sealed step verifies, and fails once any field is edited', () => {
    const sealed = sealStep(step(), ids);
    expect(stepHashMatches(sealed, ids)).toBe(true);
    expect(stepHashMatches({ ...sealed, route_template: '/api/other' }, ids)).toBe(false);
    expect(stepHashMatches(sealed, { ...ids, proposalId: A })).toBe(false);
  });

  it('proposal_hash ignores the order of acknowledgements and duplicates, but not their content or the step order', () => {
    const base = { stepArgsHashes: ['a'.repeat(64), 'b'.repeat(64)], preconditionsHash: 'c'.repeat(64), acksRequired: ['x', 'y'] };
    const hash = computeProposalHash(base);
    expect(computeProposalHash({ ...base, acksRequired: ['y', 'x', 'x'] })).toBe(hash);
    expect(computeProposalHash({ ...base, acksRequired: ['x'] })).not.toBe(hash);
    expect(computeProposalHash({ ...base, stepArgsHashes: [...base.stepArgsHashes].reverse() })).not.toBe(hash);
    expect(computeProposalHash({ ...base, preconditionsHash: 'd'.repeat(64) })).not.toBe(hash);
  });

  it('preview_hash covers the preview, the outward effects, the targets and the locale', () => {
    const base = { preview: { a: 1 }, outwardEffects: [{ key: 'k' }], targets: [{ id: A }], locale: 'en' };
    const hash = computePreviewHash(base);
    expect(computePreviewHash({ ...base, preview: { a: 2 } })).not.toBe(hash);
    expect(computePreviewHash({ ...base, outwardEffects: [] })).not.toBe(hash);
    expect(computePreviewHash({ ...base, targets: [{ id: B }] })).not.toBe(hash);
    expect(computePreviewHash({ ...base, locale: 'de' })).not.toBe(hash);
    expect(computePreviewHash({ preview: { a: 1 }, outwardEffects: [{ key: 'k' }], targets: [{ id: A }], locale: 'en' })).toBe(hash);
  });

  it('matches the formula of the plans module for the same input', () => {
    const sealed = sealStep(step(), ids);
    expect(sealed.args_hash).toBe(
      computeArgsHash({
        v: 1,
        op: 'league_create',
        method: 'POST',
        route_template: '/api/seasons',
        path_params: {},
        query: {},
        body_template: { name: 'Cup', format_type: 'singles', ruleset_id: A },
        admin_id: ids.adminId,
        conversation_id: ids.conversationId,
        proposal_id: ids.proposalId,
        step_key: 'league',
      }),
    );
  });
});

describe('precondition fingerprints (plan 4.5 "Preconditions")', () => {
  class World implements FingerprintSource {
    state: Record<string, unknown> = { season_state: 'open', roster_hash: 'r1' };
    async read(read: string, target: unknown) {
      if (read === 'startup_checklist') throw new ReadUnavailable('startup_checklist');
      return { read, target, state: this.state[read] ?? null } as never;
    }
  }
  const seasonSpecs = (id: string): PreconditionSpec[] => [
    { read: 'season_state', target: { kind: 'id', id } },
    { read: 'roster_hash', target: { kind: 'id', id } },
  ];
  const scopeOf = (spec: PreconditionSpec) => (spec.target.kind === 'id' ? `season:${spec.target.id}` : null);

  it('fingerprints the first step that touches a target and defers the later ones to it', async () => {
    const world = new World();
    const entries = await buildPreconditions(
      world,
      [
        { specs: seasonSpecs(A), touches: [`season:${A}`] },
        { specs: seasonSpecs(A), touches: [`season:${A}`] },
        { specs: seasonSpecs(B), touches: [] },
      ],
      scopeOf,
    );
    expect(entries.map((step) => step.map((e) => e.fingerprint !== null))).toEqual([
      [true, true],
      [false, false],
      [true, true],
    ]);
  });

  it('never fingerprints a reference to something the proposal itself creates', async () => {
    const entries = await buildPreconditions(new World(), [{ specs: [{ read: 'season_state', target: { kind: 'ref', ref: 'league.id' } }], touches: [] }], scopeOf);
    expect(entries[0]).toEqual([{ read: 'season_state', target: { kind: 'ref', ref: 'league.id' }, fingerprint: null }]);
    expect(checkedEntries(entries[0])).toEqual([]);
  });

  it('notices a change of the state a step depended on, and only then', async () => {
    const world = new World();
    const [entries] = await buildPreconditions(world, [{ specs: seasonSpecs(A), touches: [] }], scopeOf);
    expect(await changedPreconditions(world, entries)).toEqual([]);
    world.state.roster_hash = 'r2';
    expect((await changedPreconditions(world, entries)).map((e) => e.read)).toEqual(['roster_hash']);
  });

  it('hashes the same state the same way and different state differently', async () => {
    const world = new World();
    const one = await fingerprintOf(world, 'season_state', { kind: 'id', id: A });
    expect(await fingerprintOf(world, 'season_state', { kind: 'id', id: A })).toBe(one);
    world.state.season_state = 'closed';
    expect(await fingerprintOf(world, 'season_state', { kind: 'id', id: A })).not.toBe(one);
  });

  it('the proposal-level hash changes with any entry', async () => {
    const world = new World();
    const a = await buildPreconditions(world, [{ specs: seasonSpecs(A), touches: [] }], scopeOf);
    world.state.season_state = 'closed';
    const b = await buildPreconditions(world, [{ specs: seasonSpecs(A), touches: [] }], scopeOf);
    expect(preconditionsHash(a)).not.toBe(preconditionsHash(b));
    expect(preconditionsHash(a)).toBe(preconditionsHash(a));
  });

  it('lets a read the app cannot answer surface, so staging can fail closed', async () => {
    await expect(buildPreconditions(new World(), [{ specs: [{ read: 'startup_checklist', target: { kind: 'id', id: A } }], touches: [] }], scopeOf)).rejects.toBeInstanceOf(ReadUnavailable);
  });
});
