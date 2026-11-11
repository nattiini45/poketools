/** @vitest-environment jsdom */
/**
 * PickSelector in a league without a pool list: rows come from the species search API, whose results carry a
 * name and no types, as objects or as bare names.
 */
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';

vi.mock('@/components/ui/Modal', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { default: PickSelector } = await import('../PickSelector');

function mockSearch(data: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('PickSelector, unrestricted search', () => {
  it.each([
    ['objects without types', [{ name: 'Garchomp', id: 'garchomp' }, { name: 'Gardevoir', id: 'gardevoir' }]],
    ['bare names', ['Garchomp', 'Gardevoir']],
  ])('lists the species the search returns as %s', async (_shape, data) => {
    mockSearch(data);
    const user = userEvent.setup();
    render(withI18n(<PickSelector takenPokemon={new Set()} draftType="snake" remainingBudget={0} onPick={() => {}} onClose={() => {}} />));

    await user.type(screen.getByRole('textbox'), 'gar');

    expect(await screen.findByText('Garchomp')).toBeTruthy();
    expect(screen.getByText('Gardevoir')).toBeTruthy();
  });
});
