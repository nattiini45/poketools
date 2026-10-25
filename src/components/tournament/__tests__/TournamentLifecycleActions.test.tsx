/**
 * Lifecycle actions: Mark Completed while a phase or tournament is running,
 * Reopen once it is completed. The reopen confirmation states the
 * consequences in both languages (the dialog itself is a portal, so the
 * strings are asserted on the catalog).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from '@/i18n/core';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import type { TournamentStatus } from '@/types/tournament';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import TournamentLifecycleActions from '../TournamentLifecycleActions';

function render(status: TournamentStatus, seasonId: string | null = null): string {
  return renderToStaticMarkup(
    <TournamentLifecycleActions
      tournamentId="0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21"
      tournamentName="Spring Cup"
      seasonId={seasonId}
      status={status}
      isArchived={false}
      canDelete={false}
    />,
  );
}

describe('TournamentLifecycleActions', () => {
  it('shows Reopen and hides Mark Completed for a completed tournament', () => {
    const html = render('completed');
    expect(html).toContain('Reopen');
    expect(html).not.toContain('Mark Completed');
  });

  it('shows Reopen for a completed league phase too', () => {
    expect(render('completed', '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f')).toContain('Reopen');
  });

  it.each<TournamentStatus>(['upcoming', 'active'])('shows Mark Completed and no Reopen while %s', (status) => {
    const html = render(status);
    expect(html).toContain('Mark Completed');
    expect(html).not.toContain('Reopen');
  });

  it('keeps the archive action next to Reopen', () => {
    expect(render('completed')).toContain('Archive');
  });
});

describe('reopen confirmation copy', () => {
  const en = createTranslator(tournamentsAdminMessages, 'en');
  const de = createTranslator(tournamentsAdminMessages, 'de');

  it('names the phase or tournament in the title', () => {
    expect(en('lifecycle.reopenTitlePhase', { name: 'Group Stage' })).toBe('Reopen phase "Group Stage"?');
    expect(en('lifecycle.reopenTitleTournament', { name: 'Spring Cup' })).toBe('Reopen tournament "Spring Cup"?');
    expect(de('lifecycle.reopenTitlePhase', { name: 'Gruppenphase' })).toBe('Phase „Gruppenphase“ wieder öffnen?');
    expect(de('lifecycle.reopenTitleTournament', { name: 'Frühlingscup' })).toBe(
      'Turnier „Frühlingscup“ wieder öffnen?',
    );
  });

  it('states that standings stay untouched and completion is announced again', () => {
    for (const key of ['lifecycle.reopenConsequencePhase', 'lifecycle.reopenConsequenceTournament'] as const) {
      expect(en(key)).toContain('standings');
      expect(en(key)).toContain('Discord');
      expect(de(key)).toContain('Tabellen');
      expect(de(key)).toContain('Discord');
    }
  });

  it('warns about players already advanced only for a phase', () => {
    expect(en('lifecycle.reopenConsequencePhase')).toContain('next phase');
    expect(en('lifecycle.reopenConsequenceTournament')).not.toContain('next phase');
    expect(de('lifecycle.reopenConsequencePhase')).toContain('nächste Phase');
    expect(de('lifecycle.reopenConsequenceTournament')).not.toContain('nächste Phase');
  });

  it('has a failure text and confirm label in both languages', () => {
    expect(en('lifecycle.reopenFailedPhase')).toBe('Failed to reopen phase');
    expect(en('lifecycle.reopenFailedTournament')).toBe('Failed to reopen tournament');
    expect(de('lifecycle.reopenFailedPhase')).toContain('wieder geöffnet');
    expect(de('lifecycle.reopenConfirm')).toBe('Wieder öffnen');
  });
});
