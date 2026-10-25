import { describe, expect, it, vi } from 'vitest';
import SeedingTable from '../SeedingTable';
import { renderWithI18n } from '@/test/i18n';
import type { AdminTournamentParticipant } from '@/lib/players/public-player';

const roster = [
  { id: 'p1', name: 'Alice', seed: 1, starting_bracket: 'winners' },
  { id: 'p2', name: 'Bob', seed: 2, starting_bracket: 'winners' },
] as unknown as AdminTournamentParticipant[];

function render(locale: 'en' | 'de' = 'en') {
  return renderWithI18n(
    <SeedingTable
      tournamentId="t-1"
      seasonId={null}
      enrollmentSource={null}
      sourcePhaseName={null}
      participants={roster}
      ratings={{}}
      allPlayers={[]}
      onParticipantsChange={vi.fn()}
      onEnrollmentChange={vi.fn()}
      onAddPlayer={vi.fn(async () => {})}
      onRemovePlayer={vi.fn(async () => {})}
      editable
    />,
    { locale },
  );
}

describe('SeedingTable save confirmation', () => {
  it('renders an always-present status region that is empty before a save', () => {
    expect(render()).toMatch(/<p role="status"[^>]*><\/p>/);
    expect(render()).not.toContain('Seeds saved.');
  });

  it('has a saved text in both languages', async () => {
    const { tournamentsAdminMessages } = await import('@/i18n/messages/tournaments/admin');
    expect(JSON.stringify(tournamentsAdminMessages.en)).toContain('Seeds saved.');
    expect(JSON.stringify(tournamentsAdminMessages.de)).toContain('Die Setzliste wurde gespeichert.');
  });
});
