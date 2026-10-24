/**
 * The roster manager takes the league's status and archive flag from the admin
 * page (which already read the season row) instead of fetching
 * `GET /api/seasons/[id]` again on load.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isSubstitutionClosed, rosterLoadPaths, usePlayerSearch } from '../LeagueRosterManager';
import {
  unavailableForLink,
  unavailableForSubstitute,
  type PlayerSearchHit,
} from '@/lib/players/player-search';

describe('rosterLoadPaths', () => {
  it('loads roster and phases only: no league row, no preloaded player directory', () => {
    const paths = rosterLoadPaths('season-1');

    expect(paths).toEqual(['/api/seasons/season-1/participants', '/api/seasons/season-1/phases']);
    expect(paths).not.toContain('/api/seasons/season-1');
    // GET /api/players is site-admin only and returns one page: the pickers search instead
    // (see src/lib/players/__tests__/player-search.test.ts).
    expect(paths).not.toContain('/api/players');
  });
});

describe('isSubstitutionClosed (from the leagueState prop)', () => {
  it('closes substitutions for a completed or archived league', () => {
    expect(isSubstitutionClosed({ status: 'completed', archived: false })).toBe(true);
    expect(isSubstitutionClosed({ status: 'active', archived: true })).toBe(true);
    expect(isSubstitutionClosed({ status: 'active', archived: false })).toBe(false);
  });
});

/** The `usePlayerSearch` handle of one render, after it has seen a search answer. */
function searchAfterAnswer(
  unavailable: Parameters<typeof usePlayerSearch>[1],
  hits: PlayerSearchHit[],
  options?: Parameters<typeof usePlayerSearch>[2],
) {
  const handle: { search?: ReturnType<typeof usePlayerSearch> } = {};
  function Probe({ onRender }: { onRender: (search: ReturnType<typeof usePlayerSearch>) => void }) {
    onRender(usePlayerSearch('season-1', unavailable, options));
    return null;
  }
  renderToStaticMarkup(<Probe onRender={(search) => (handle.search = search)} />);
  if (!handle.search) throw new Error('the probe did not render');
  handle.search.transformResults({ success: true, data: hits, total: hits.length });
  return handle.search;
}

const AVAILABLE: PlayerSearchHit = { id: 'p-free', name: 'Free Agent', is_guest: false };
const ON_ROSTER: PlayerSearchHit = { id: 'p-roster', name: 'Rostered', is_guest: false };
const GUEST: PlayerSearchHit = { id: 'p-guest', name: 'Some Guest', is_guest: true };

describe('substitute picker selection', () => {
  const search = () =>
    searchAfterAnswer(
      (hit) => unavailableForSubstitute(hit, 'p-out', new Set([ON_ROSTER.id]), new Set()),
      [AVAILABLE, ON_ROSTER],
    );

  it('selects an available hit', () => {
    expect(search().select(AVAILABLE.id)).toEqual(AVAILABLE);
  });

  it('selects nobody when the chosen hit is one the picker refuses, instead of keeping the previous pick', () => {
    expect(search().select(ON_ROSTER.id)).toBeNull();
  });

  it('selects nobody for a cleared input or an id the search never returned', () => {
    expect(search().select('')).toBeNull();
    expect(search().select('p-unknown')).toBeNull();
  });
});

describe('link picker selection', () => {
  const search = () =>
    searchAfterAnswer((hit) => unavailableForLink(hit, 'p-guest-target'), [AVAILABLE, GUEST], {
      registeredOnly: true,
    });

  it('selects a registered account', () => {
    expect(search().select(AVAILABLE.id)).toEqual(AVAILABLE);
  });

  it('selects nobody when the chosen hit is a guest, instead of keeping the previous pick', () => {
    expect(search().select(GUEST.id)).toBeNull();
  });
});
