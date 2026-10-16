import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BoardFocusPanel from '../BoardFocusPanel';
import { buildPreviewRoute } from '@/app/(public)/route-preview/fixtures';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';

/**
 * The docked schedule panel must not drop any Section 8 match status: the
 * SPIELPLAN board collapses `pending_confirmation`/`disputed` to `beendet`
 * (`FIXTURE_STATUS` in board-content.ts) and the glass FixtureList keeps
 * their own pills — but a status filtered out of BOTH panel tabs is invisible
 * content. Rendered through react-dom/server (no DOM needed); fixture rows
 * carry `data-fixture="<match id>"`, and the disputed pill its own word.
 */

function withStatus(fixture: LeagueFixture, id: string, status: LeagueFixture['match']['status']): LeagueFixture {
  return { ...fixture, match: { ...fixture.match, id, status } };
}

function renderSchedulePanel(fixtures: LeagueFixture[], locale: 'de' | 'en' = 'de'): string {
  const data = buildPreviewRoute();
  if (!data.league) throw new Error('preview fixtures always carry a league row');
  return renderToStaticMarkup(
    createElement(BoardFocusPanel, {
      kind: 'schedule' as const,
      league: data.league,
      stages: data.stages,
      standings: data.standings,
      fixtures,
      locale,
    }),
  );
}

describe('BoardFocusPanel schedule tabs cover every match status', () => {
  const data = buildPreviewRoute();
  const active = data.stages.find((stage) => stage.status === 'active');
  expect(active).toBeDefined();
  const playedBase = data.fixtures.find(
    (fixture) => fixture.stageId === active?.id && fixture.match.status === 'completed',
  );
  expect(playedBase).toBeDefined();

  const fixtures: LeagueFixture[] = [
    ...data.fixtures,
    withStatus(playedBase as LeagueFixture, 'match-panel-pending', 'pending_confirmation'),
    withStatus(playedBase as LeagueFixture, 'match-panel-disputed', 'disputed'),
  ];
  const html = renderSchedulePanel(fixtures);

  it('shows pending_confirmation fixtures in the results page', () => {
    expect(html).toContain('data-fixture="match-panel-pending"');
  });

  it('shows disputed fixtures in the results page, with their own pill', () => {
    expect(html).toContain('data-fixture="match-panel-disputed"');
    // The glass register surfaces the exception the board collapses.
    expect(html).toContain('Strittig');
  });

  it('follows the viewer: English board words for an English viewer (i18n D11)', () => {
    const english = renderSchedulePanel(fixtures, 'en');
    expect(english).toContain('Disputed');
    expect(english).toContain('Results');
    expect(english).not.toContain('Strittig');
    // German tabs and pills for a German viewer.
    expect(html).toContain('Ergebnisse');
  });

  it('keeps completed fixtures in the results page', () => {
    expect(html).toContain(`data-fixture="${(playedBase as LeagueFixture).match.id}"`);
  });

  it('keeps scheduled fixtures in the open page', () => {
    const scheduled = data.fixtures.find(
      (fixture) => fixture.stageId === active?.id && fixture.match.status === 'scheduled',
    );
    expect(scheduled).toBeDefined();
    expect(html).toContain(`data-fixture="${(scheduled as LeagueFixture).match.id}"`);
  });
});
