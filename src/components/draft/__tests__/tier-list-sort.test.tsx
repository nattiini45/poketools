/** @vitest-environment jsdom */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAgent } from '@ui-sdk/react/agent';
import { describe, expect, it } from 'vitest';
import type { EvolutionTier } from '@/types/evolution';
import TierListDisplay from '../TierListDisplay';

Object.assign(globalThis, { __UI_SDK_STRICT__: true });
const agent = createAgent();
const tier: EvolutionTier = {
  id: 'first', season_id: 'fixture', player_id: null, base_pokemon: 'Charmander',
  stage2_pokemon: 'Charmeleon', stage2_kos: 5, stage3_pokemon: 'Charizard',
  stage3_kos: 8, power_tier: 'A', created_at: '',
};
const tiers = [tier,
  { ...tier, id: 'second', base_pokemon: 'Bulbasaur', stage2_pokemon: 'Ivysaur', stage2_kos: 3, stage3_pokemon: 'Venusaur', stage3_kos: 12 },
  { ...tier, id: 'third', base_pokemon: 'Pikachu', stage2_pokemon: 'Raichu', stage2_kos: 6, stage3_pokemon: null, stage3_kos: null },
];
const order = () => screen.getAllByRole('img').map(el => el.getAttribute('alt'));

describe('tier reference sorting', () => {
  it('cycles first-evolution sorting without mutating the reference data', async () => {
    render(<TierListDisplay tiers={tiers} tierLimits={[]} />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Kills to first evolution' });
    await user.click(button);
    expect(order()).toEqual(['Bulbasaur', 'Charmander', 'Pikachu']);
    await user.click(button);
    expect(order()).toEqual(['Pikachu', 'Charmander', 'Bulbasaur']);
    await user.click(button);
    expect(order()).toEqual(['Charmander', 'Bulbasaur', 'Pikachu']);
    expect(tiers[0].id).toBe('first');
  });

  it('lets an agent sort by cumulative final thresholds, including a two-stage line', async () => {
    render(<TierListDisplay tiers={tiers} tierLimits={[]} />);
    const entries = agent.snapshot().filter(entry => !entry.offPage && entry.component !== 'more');
    expect(entries.map(entry => entry.label)).toEqual(expect.arrayContaining(['Kills to first evolution', 'Total kills to final evolution']));
    for (const entry of entries) expect(entry.label).toBeTruthy();
    await act(async () => {
      const result = await agent.act({ steps: [{ ref: 'Total kills to final evolution', action: 'press' }] });
      expect(result.ok).toBe(true);
    });
    expect(order()).toEqual(['Pikachu', 'Charmander', 'Bulbasaur']);
  });
});
