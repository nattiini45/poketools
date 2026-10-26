/**
 * The "Start from an existing league" picker (react-dom/server, vitest 'node'
 * env): the blank entry first, the sources with their counts, the options
 * off by default, the admin option for site admins only, and both languages.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import CloneSourcePicker from '../CloneSourcePicker';
import type { CloneSourceOption } from '@/lib/league-admin/clone-source';

function source(overrides: Partial<CloneSourceOption> = {}): CloneSourceOption {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Autumn League',
    format_type: 'singles',
    status: 'completed',
    archived: false,
    is_test_season: false,
    ruleset_id: null,
    route_theme: 'auto',
    language: 'en',
    description: '',
    phase_count: 3,
    participant_count: 12,
    ...overrides,
  };
}

const pointBuy = source({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Evolution Cup',
  format_type: 'evolution_point_buy',
  archived: true,
  phase_count: 1,
  participant_count: 1,
});

function render(
  props: Partial<React.ComponentProps<typeof CloneSourcePicker>> = {},
  locale: 'en' | 'de' = 'en',
): string {
  return renderWithI18n(
    <CloneSourcePicker
      sources={[source(), pointBuy]}
      isSiteAdmin={false}
      sourceId={null}
      copyRoster={false}
      copyAdmins={false}
      onSourceChange={vi.fn()}
      onCopyRosterChange={vi.fn()}
      onCopyAdminsChange={vi.fn()}
      {...props}
    />,
    { locale },
  );
}

const SELECTED = '11111111-1111-4111-8111-111111111111';

describe('CloneSourcePicker', () => {
  it('lists "Blank league" first, then the sources with type, phase and player counts', () => {
    const html = render();
    const options = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);

    expect(options).toEqual([
      ['', 'Blank league'],
      [SELECTED, 'Autumn League · Singles · 3 phases · 12 players'],
      [pointBuy.id, 'Evolution Cup · Evolution Point Buy · 1 phase · 1 player · archived'],
    ]);
    expect(html).toContain('Start from');
  });

  it('does not offer a custom-format league, and renders nothing when only custom leagues exist', () => {
    const custom = source({ id: '33333333-3333-4333-8333-333333333333', name: 'Studio Cup', format_type: 'custom' });
    const html = render({ sources: [source(), custom, pointBuy] });
    const values = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);

    expect(values).toEqual(['', SELECTED, pointBuy.id]);
    expect(html).not.toContain('Studio Cup');
    expect(render({ sources: [custom] })).toBe('');
    expect(render({ sources: [custom], sourceId: custom.id })).toBe('');
  });

  it('shows nothing about options until a source is picked', () => {
    const html = render();

    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('Copied from the source');
  });

  it('renders nothing when there is no source to start from', () => {
    expect(render({ sources: [] })).toBe('');
  });

  it('offers the roster option unchecked with the player count', () => {
    const html = render({ sourceId: SELECTED });
    const roster = html.match(/<input[^>]*id="clone-copy-roster"[^>]*>/)?.[0] ?? '';

    expect(roster).toContain('type="checkbox"');
    expect(roster).not.toContain('checked');
    expect(html).toContain('Copy the roster (12 players)');
  });

  it('shows the roster option as checked once chosen', () => {
    const html = render({ sourceId: SELECTED, copyRoster: true });

    expect(html.match(/<input[^>]*id="clone-copy-roster"[^>]*>/)?.[0]).toContain('checked');
  });

  it('hides the league-admin option from everyone but site admins', () => {
    expect(render({ sourceId: SELECTED, isSiteAdmin: false })).not.toContain('clone-copy-admins');
    expect(render({ sourceId: SELECTED, isSiteAdmin: false })).not.toContain('Copy the league admins');

    const html = render({ sourceId: SELECTED, isSiteAdmin: true });
    const admins = html.match(/<input[^>]*id="clone-copy-admins"[^>]*>/)?.[0] ?? '';
    expect(admins).toContain('type="checkbox"');
    expect(admins).not.toContain('checked');
    expect(html).toContain('Copy the league admins');
  });

  it('says what is copied and what is not', () => {
    const html = render({ sourceId: SELECTED });

    expect(html).toContain('Settings and 3 phases');
    expect(html).toMatch(/Not copied:[^<]*point-buy list[^<]*tokens[^<]*draft data/);
    expect(html).toContain('Dates and the name come from this form.');
    expect(html).not.toContain('A point-buy league is set up as usual');
  });

  it('adds the point-buy note for a point-buy source', () => {
    const html = render({ sourceId: pointBuy.id });

    expect(html).toContain('A point-buy league is set up as usual: format rules and the point-buy list are not copied.');
    expect(html).toContain('Settings and 1 phase (');
    expect(html).toContain('Copy the roster (1 player)');
  });

  it('renders in German without fallback keys', () => {
    const html = render({ sourceId: SELECTED, isSiteAdmin: true }, 'de');

    expect(html).not.toMatch(/picker\./);
    expect(html).toContain('Starten mit');
    expect(html).toContain('Leere Liga');
    expect(html).toContain('Autumn League · Einzel · 3 Phasen · 12 Spieler');
    expect(html).toContain('Kader übernehmen (12 Spieler)');
    expect(html).toContain('Liga-Admins übernehmen');
    expect(html).toContain('Wird aus der Vorlage übernommen');
    expect(html).toMatch(/Nicht übernommen:[^<]*Point-Buy-Liste[^<]*Token[^<]*Draft-Daten/);
    expect(html).not.toContain('Copy the roster');
    expect(html).not.toContain('Blank league');
  });
});
