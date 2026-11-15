import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcup } from '@/lib/format-kit/presets/wichtelcup';
import type { FormatDefinition } from '@/lib/format-kit/types';
import type { KitContext } from '../load';
import { buildPlayerView } from '../views';
import { PLAYERS, SEED, link, stateFor } from './helpers';

// The `pools` of the player view with the shipped Wichtelcup: the New Year pool is the surprise, hidden (`when_unlocked`)
// until the organizer opens it, so it is absent from `pools` and `poolSpecies` while locked and appears only once unlocked.

const compiled = compile(wichtelcup);
if (compiled.definition === null) throw new Error('the Wichtelcup example does not compile');
const DEF = compiled.definition as FormatDefinition;
const NAMES = new Map(PLAYERS.map((id) => [id, `Name ${id}`]));
const NOW = new Date('2026-12-01T12:00:00Z');

function poolsAt(flags: Record<string, string>) {
  const state = stateFor(DEF, { flags, links: [link('p1', 'p2'), link('p2', 'p3'), link('p3', 'p1')] });
  const ctx: KitContext = {
    seasonId: 's-1',
    seed: SEED,
    revision: 1,
    def: DEF,
    state,
    tunableIssues: [],
    phases: [{ id: 'phase-1', stage: DEF.stages[0], members: PLAYERS }],
  };
  const view = buildPlayerView(ctx, 'p1', NAMES, [], NOW);
  if (!view.running) throw new Error('expected a running view');
  return view;
}

describe('the pools of the player view', () => {
  it('hides the locked New Year pool entirely in weeks 1 to 3: its existence is the surprise', () => {
    const view = poolsAt({ 'action:choose_gifts': 'open' });
    expect(view.actions.flatMap((a) => a.steps.map((s) => s.domain))).not.toContain('new_year');
    const byKey = new Map(view.pools.map((p) => [p.key, p.unlocked]));
    // A when_unlocked pool that is still locked is not named at all, so nothing tells a player it exists.
    expect(byKey.has('new_year')).toBe(false);
    expect(view.poolSpecies).not.toContain('mewtwo');
    expect(byKey.get('junk')).toBe(true);
    expect(byKey.get('premium')).toBe(true);
  });

  it('shows the New Year pool open once the organizer has set its unlock flag', () => {
    const view = poolsAt({ 'action:choose_gifts': 'open', 'domain:new_year': 'unlocked' });
    expect(view.pools.find((p) => p.key === 'new_year')).toMatchObject({ unlocked: true });
  });

  it('carries a label and no entries (a pool is only a name and a lock state)', () => {
    const view = poolsAt({});
    for (const pool of view.pools) {
      expect(Object.keys(pool).sort()).toEqual(['key', 'label', 'unlocked']);
      expect(pool.label.en?.v.length).toBeGreaterThan(0);
    }
  });

  it('never lists an admins-only pool', () => {
    const hidden: FormatDefinition = { ...DEF, domains: (DEF.domains ?? []).map((d) => (d.key === 'new_year' ? { ...d, visibility: 'admins' as const } : d)) };
    const state = stateFor(hidden, { flags: {} });
    const ctx: KitContext = { seasonId: 's-1', seed: SEED, revision: 1, def: hidden, state, tunableIssues: [], phases: [{ id: 'phase-1', stage: hidden.stages[0], members: PLAYERS }] };
    const view = buildPlayerView(ctx, 'p1', NAMES, [], NOW);
    if (!view.running) throw new Error('expected a running view');
    expect(view.pools.map((p) => p.key)).not.toContain('new_year');
  });

  it('does not name an admins-only domain in the steps of an action either: no key, no label, no lock state', () => {
    const hidden: FormatDefinition = { ...DEF, domains: (DEF.domains ?? []).map((d) => (d.key === 'premium' ? { ...d, visibility: 'admins' as const } : d)) };
    const state = stateFor(hidden, { flags: { 'action:choose_gifts': 'open' }, links: [link('p1', 'p2'), link('p2', 'p3'), link('p3', 'p1')] });
    const ctx: KitContext = { seasonId: 's-1', seed: SEED, revision: 1, def: hidden, state, tunableIssues: [], phases: [{ id: 'phase-1', stage: hidden.stages[0], members: PLAYERS }] };
    const view = buildPlayerView(ctx, 'p1', NAMES, [], NOW);
    if (!view.running) throw new Error('expected a running view');
    const steps = view.actions.flatMap((action) => action.steps);
    expect(steps.map((step) => step.domain)).toContain('junk');
    expect(steps.map((step) => step.domain)).not.toContain('premium');
    const placeholders = steps.filter((step) => step.domain === '');
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders.every((step) => step.unlocked === false && step.blocked.length === 0)).toBe(true);
    expect(view.domains.map((d) => d.key)).not.toContain('premium');
  });
});
