/**
 * DecisionMatchPanel: the admin back-link into the league admin page lands on the Phases tab and
 * names it, in both languages; viewers who are not admins get no admin links.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  function Link({ href, children, ...rest }: { href: string; children?: ReactNode; [key: string]: unknown }) {
    return createElement('a', { ...rest, href }, children);
  }
  return { default: Link };
});

import { renderWithI18n } from '@/test/i18n';
import type { EvolutionStanding } from '@/lib/tournament/evolution-standings';
import DecisionMatchPanel from '../DecisionMatchPanel';

const tied = [{ player_name: 'Ash' }, { player_name: 'Misty' }] as EvolutionStanding[];

describe('DecisionMatchPanel', () => {
  it.each([
    ['en', 'League admin: Phases'],
    ['de', 'Liga-Verwaltung: Phasen'],
  ] as const)('%s: the league admin link opens the Phases tab and names it', (locale, label) => {
    const html = renderWithI18n(
      <DecisionMatchPanel tiedPlayers={tied} tournamentId="t-1" seasonId="s-1" isAdmin />,
      { locale },
    );
    expect(html).toContain(`href="/admin/leagues/s-1?tab=phases"`);
    expect(html).toContain(`>${label}</a>`);
    expect(html).toContain('href="/admin/tournaments/t-1"');
  });

  it('shows no admin links to a viewer who is not an admin', () => {
    const html = renderWithI18n(<DecisionMatchPanel tiedPlayers={tied} tournamentId="t-1" seasonId="s-1" />);
    expect(html).not.toContain('/admin/');
  });
});
