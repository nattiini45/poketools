/**
 * The substitution controls (PR #65 test-pass follow-ups): when Confirm is
 * offered, how a partial apply is told apart, what a done apply left as it
 * was, and which players and scopes the roster manager offers. Rendered
 * through react-dom/server (vitest 'node' env, no DOM).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SubstitutePreviewView,
  SubstituteSkippedMatches,
  substituteApplyWasPartial,
  substitutePreviewHasWork,
} from '../SubstituteDialog';
import {
  isSubstitutionClosed,
  phaseOnlyPlayers,
  substituteScopeOptions,
} from '../LeagueRosterManager';
import type { SubstituteAffectedMatch, SubstituteSummary } from '@/lib/season/substitute';
import { createTranslator } from '@/i18n/core';
import { leagueRosterMessages } from '@/i18n/messages/league-roster';
import { renderWithI18n } from '@/test/i18n';

const MATCH: SubstituteAffectedMatch = {
  match_id: 'm-1',
  tournament_id: 'phase-1',
  tournament_name: 'Gruppenphase',
  round_id: 'r-1',
  player_1_id: 'p-out',
  player_2_id: 'p-x',
  player_1_name: 'Mara',
  player_2_name: 'Xena',
};

function summary(overrides: Partial<SubstituteSummary> = {}): SubstituteSummary {
  return {
    roster_swapped: false,
    phases: [],
    affected_matches: [],
    matches_repaired: 0,
    matches_skipped: [],
    ...overrides,
  };
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

describe('substitutePreviewHasWork', () => {
  it('is false for a phase-scope preview with no phase, roster row or match to move', () => {
    expect(substitutePreviewHasWork(summary())).toBe(false);
  });

  it('is true for a roster swap, a phase slot or a match to repair', () => {
    expect(substitutePreviewHasWork(summary({ roster_swapped: true }))).toBe(true);
    expect(
      substitutePreviewHasWork(
        summary({ phases: [{ phase_id: 'phase-1', phase_name: 'Gruppenphase', seed: 3, group: null }] }),
      ),
    ).toBe(true);
    expect(substitutePreviewHasWork(summary({ affected_matches: [MATCH] }))).toBe(true);
  });

  it('the preview says there is nothing to substitute', () => {
    const text = textOf(renderToStaticMarkup(<SubstitutePreviewView preview={summary()} />));

    expect(text).toContain('Nothing to substitute');
  });
});

describe('substituteApplyWasPartial', () => {
  const confirmed = summary({
    roster_swapped: true,
    phases: [
      { phase_id: 'phase-1', phase_name: 'Gruppenphase', seed: 3, group: { id: 'g-1', name: 'Gruppe A' } },
      { phase_id: 'phase-2', phase_name: 'Playoffs', seed: 3, group: null },
    ],
    affected_matches: [MATCH],
  });

  it('is false when the check after the failure still shows the whole substitution', () => {
    expect(substituteApplyWasPartial(confirmed, { ...confirmed })).toBe(false);
  });

  it('is true when part of it has landed (a phase or a match is no longer open)', () => {
    expect(
      substituteApplyWasPartial(confirmed, summary({ roster_swapped: true, phases: [confirmed.phases[1]] })),
    ).toBe(true);
  });
});

describe('SubstituteSkippedMatches', () => {
  it('lists the planned matches a done apply left with the departed player, with the reason', () => {
    const text = textOf(
      renderToStaticMarkup(
        <SubstituteSkippedMatches
          matches={[
            { ...MATCH, reason: 'has_games' },
            { ...MATCH, match_id: 'm-2', player_2_name: 'Zed', reason: 'changed' },
          ]}
        />,
      ),
    );

    expect(text).toContain('2 planned matches were not repaired');
    expect(text).toContain('Gruppenphase: Mara vs Xena (a result was reported meanwhile)');
    expect(text).toContain('Mara vs Zed (the match changed meanwhile)');
  });

  it('renders nothing when every planned match was repaired', () => {
    expect(renderToStaticMarkup(<SubstituteSkippedMatches matches={[]} />)).toBe('');
  });
});

describe('isSubstitutionClosed', () => {
  it('closes a completed or an archived league', () => {
    expect(isSubstitutionClosed({ status: 'completed', archived: false })).toBe(true);
    expect(isSubstitutionClosed({ status: 'active', archived: true })).toBe(true);
  });

  it('keeps an upcoming or active league open, and an unloaded one (the server checks it)', () => {
    expect(isSubstitutionClosed({ status: 'active', archived: false })).toBe(false);
    expect(isSubstitutionClosed({ status: 'upcoming', archived: false })).toBe(false);
    expect(isSubstitutionClosed(null)).toBe(false);
  });
});

describe('substituteScopeOptions', () => {
  const phases = [
    { id: 'phase-1', name: 'Gruppenphase' },
    { id: 'phase-2', name: 'Playoffs' },
  ];
  const enrollment = {
    'phase-1': [{ id: 'p-out', name: 'Mara' }, { id: 'p-res', name: 'Rex' }],
    'phase-2': [{ id: 'p-x', name: 'Xena' }],
  };

  it('offers a roster player the whole league and only the phases they are enrolled in', () => {
    expect(substituteScopeOptions({ id: 'p-out', name: 'Mara', onRoster: true }, phases, enrollment)).toEqual([
      { value: 'league', label: 'Entire league (all active phases)' },
      { value: 'phase-1', label: 'Gruppenphase only' },
    ]);
  });

  it('offers a promoted reserve their phases only, never the whole league', () => {
    expect(substituteScopeOptions({ id: 'p-res', name: 'Rex', onRoster: false }, phases, enrollment)).toEqual([
      { value: 'phase-1', label: 'Gruppenphase only' },
    ]);
  });

  it('still offers a roster player a phase whose enrollment did not load', () => {
    expect(
      substituteScopeOptions({ id: 'p-out', name: 'Mara', onRoster: true }, phases, { 'phase-2': [] }),
    ).toEqual([
      { value: 'league', label: 'Entire league (all active phases)' },
      { value: 'phase-1', label: 'Gruppenphase only' },
    ]);
  });
});

describe('phaseOnlyPlayers', () => {
  it('lists players enrolled in an active phase but not on the roster, with their phases', () => {
    const phases = [
      { id: 'phase-1', name: 'Gruppenphase' },
      { id: 'phase-2', name: 'Playoffs' },
    ];
    const enrollment = {
      'phase-1': [{ id: 'p-out', name: 'Mara' }, { id: 'p-res', name: 'Rex' }],
      'phase-2': [{ id: 'p-res', name: 'Rex' }, { id: 'p-amy', name: 'Amy' }],
    };

    expect(phaseOnlyPlayers(phases, enrollment, new Set(['p-out']))).toEqual([
      { id: 'p-amy', name: 'Amy', phases: ['Playoffs'] },
      { id: 'p-res', name: 'Rex', phases: ['Gruppenphase', 'Playoffs'] },
    ]);
  });
});

describe('substitution controls in German', () => {
  it('previews the swap with translated labels and stored group names', () => {
    const text = textOf(
      renderWithI18n(
        <SubstitutePreviewView
          preview={summary({
            roster_swapped: true,
            phases: [{ phase_id: 'phase-1', phase_name: 'Vorrunde', seed: 2, group: { id: 'g-1', name: 'Group A' } }],
            affected_matches: [MATCH],
          })}
        />,
        { locale: 'de' },
      ),
    );

    expect(text).toContain('Tausch im Ligakader: Ja');
    expect(text).toContain('Phaseneinträge: 1 (Vorrunde: Gruppe A)');
    expect(text).toContain('Anzupassende Spiele (1)');
    expect(text).toContain('Gruppenphase: Mara vs. Xena');
  });

  it('pluralizes the skipped matches and names the reason', () => {
    const one = textOf(
      renderWithI18n(<SubstituteSkippedMatches matches={[{ ...MATCH, reason: 'has_games' }]} />, { locale: 'de' }),
    );
    expect(one).toContain('1 angesetztes Spiel wurde nicht angepasst');
    expect(one).toContain('Gruppenphase: Mara vs. Xena (inzwischen wurde ein Ergebnis gemeldet)');

    const two = textOf(
      renderWithI18n(
        <SubstituteSkippedMatches
          matches={[
            { ...MATCH, reason: 'has_games' },
            { ...MATCH, match_id: 'm-2', reason: 'changed' },
          ]}
        />,
        { locale: 'de' },
      ),
    );
    expect(two).toContain('2 angesetzte Spiele wurden nicht angepasst');
  });

  it('labels the scopes with the given translator', () => {
    const de = createTranslator(leagueRosterMessages, 'de');
    const phases = [{ id: 'phase-1', name: 'Gruppenphase' }];
    const enrollment = { 'phase-1': [{ id: 'p-out', name: 'Mara' }] };

    expect(substituteScopeOptions({ id: 'p-out', name: 'Mara', onRoster: true }, phases, enrollment, de)).toEqual([
      { value: 'league', label: 'Ganze Liga (alle aktiven Phasen)' },
      { value: 'phase-1', label: 'Nur Gruppenphase' },
    ]);
  });
});
