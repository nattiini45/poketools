import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcup } from '@/lib/format-kit/presets/wichtelcup';
import type { FormatDefinition } from '@/lib/format-kit/types';
import type { KitContext } from '../load';
import { buildPlayerView } from '../views';
import { PLAYERS, SEED, link, stateFor } from './helpers';

// The `pools` of the player view with the shipped Wichtelcup: the New Year pool is in no action step (the only step
// pools are junk and premium), so only `pools` can tell the teambuilder card that it is locked and when it opens.

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
  it('lists the locked New Year pool in weeks 1 to 3 although no action step draws from it', () => {
    const view = poolsAt({ 'action:choose_gifts': 'open' });
    expect(view.actions.flatMap((a) => a.steps.map((s) => s.domain))).not.toContain('new_year');
    const byKey = new Map(view.pools.map((p) => [p.key, p.unlocked]));
    expect(byKey.get('new_year')).toBe(false);
    expect(byKey.get('junk')).toBe(true);
    expect(byKey.get('premium')).toBe(true);
  });

  it('shows the New Year pool open once the week 4 unlock has set its flag', () => {
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
});
