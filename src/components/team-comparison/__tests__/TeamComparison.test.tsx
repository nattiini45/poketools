/** @vitest-environment jsdom */
import { beforeAll, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAgent } from '@ui-sdk/react/agent';
import { withI18n } from '@/test/i18n';
import { comparisonPokemon, superEffectiveStabs, type TeamComparisonData } from '@/lib/team-comparison';
import TeamComparison from '../TeamComparison';
import { ComparePlayerButton } from '../TeamComparisonDialog';

beforeAll(() => {
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.checkVisibility = () => true;
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  document.head.append(Object.assign(document.createElement('style'), { textContent: '[popover] { display: block !important }' }));
});

const mine = comparisonPokemon(['Charmeleon']);
const theirs = comparisonPokemon(['Wartortle']);
const data: TeamComparisonData = {
  leagueId: 'league', leagues: [
    { id: 'league', name: 'Example Cup', format_type: 'evolution_point_buy', start_date: null, created_at: '2026-11-01' },
    { id: 'older', name: 'Earlier Cup', format_type: 'standard', start_date: null, created_at: '2025-11-01' },
  ], mine: { hidden: false, pokemon: mine }, theirs: { hidden: false, pokemon: theirs },
  myHits: superEffectiveStabs(mine, theirs), theirHits: superEffectiveStabs(theirs, mine),
};

it('names both directions, exposes the SDK league picker and changes its value through the agent', async () => {
  const onLeagueChange = vi.fn();
  const agent = createAgent();
  render(withI18n(<TeamComparison data={data} opponentName="Maple" onLeagueChange={onLeagueChange} />));
  expect(screen.getByRole('heading', { name: 'Your team' })).toBeTruthy();
  expect(screen.getByText('Wartortle → Charmeleon: Water ×2')).toBeTruthy();
  expect(screen.getByText('No super-effective STAB hits.')).toBeTruthy();
  expect(agent.snapshot().some((entry) => entry.label === 'Comparison league')).toBe(true);
  await act(async () => { await agent.act({ steps: [{ ref: 'Comparison league', action: 'setValue', args: ['older'] }] }); });
  expect(onLeagueChange).toHaveBeenCalledWith('older');
});

it('opens from a player, fetches only on demand, and closes with Escape', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data }) });
  vi.stubGlobal('fetch', fetcher);
  const user = userEvent.setup();
  render(withI18n(<ComparePlayerButton playerId="opponent" name="Maple" />));
  expect(fetcher).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Compare teams with Maple' });
  await user.click(button);
  expect(await screen.findByRole('heading', { name: 'Your team' })).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith('/api/players/opponent/team-comparison', expect.objectContaining({ cache: 'no-store' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('labels missing types as partial coverage in both directions while retaining known hits', () => {
  render(withI18n(<TeamComparison data={{ ...data, mine: { ...data.mine, pokemon: [...mine, { species: 'MissingNo.', types: [] }] } }} opponentName="Maple" onLeagueChange={vi.fn()} />));
  expect(screen.getAllByText('Coverage is incomplete because some Pokémon have no type data. Only known hits are listed.')).toHaveLength(2);
  expect(screen.queryByText('No super-effective STAB hits.')).toBeNull();
  expect(screen.getByText('Wartortle → Charmeleon: Water ×2')).toBeTruthy();
});
