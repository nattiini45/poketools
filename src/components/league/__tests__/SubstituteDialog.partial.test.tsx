/**
 * Telling a failed substitution apply apart (PR #65 review follow-up): an
 * apply that handed the group row over and then failed at the enrollment swap
 * leaves a re-checked preview equal to the confirmed one, yet the dialog must
 * still warn that the slot may already be held by the incoming player. The
 * server's exact signal decides whenever it answers (SubstituteDialog.signal
 * test); these inferences cover a request that got no answer.
 * Rendered through react-dom/server (vitest 'node' env, no DOM).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SubstitutePartialWarning,
  substituteApplyMayBePartial,
  substitutePartialState,
} from '../SubstituteDialog';
import type { SubstituteAffectedMatch, SubstituteSummary } from '@/lib/season/substitute';
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
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Phase scope, grouped phase, no scheduled matches: the finding's scenario. */
const GROUPED_NO_MATCHES = summary({
  phases: [
    { phase_id: 'phase-1', phase_name: 'Gruppenphase', seed: 3, group: { id: 'g-1', name: 'Gruppe A' } },
  ],
});

describe('substitutePartialState', () => {
  it('flags a failure after the group row moved, though the re-check equals the confirmed preview', () => {
    // The re-check resolves the group from the incoming player's row: same id.
    const recheck = summary({ phases: [{ ...GROUPED_NO_MATCHES.phases[0] }] });

    expect(substituteApplyMayBePartial(GROUPED_NO_MATCHES, recheck)).toBe(true);
    expect(substitutePartialState(GROUPED_NO_MATCHES, recheck)).toBe('possibly_partial');
  });

  it('flags a failure after proposals were cancelled, though the match is still listed', () => {
    const confirmed = summary({
      phases: [{ phase_id: 'phase-1', phase_name: 'Playoffs', seed: 1, group: null }],
      affected_matches: [MATCH],
    });

    expect(substitutePartialState(confirmed, { ...confirmed })).toBe('possibly_partial');
  });

  it('is definite when the re-check shows part of the substitution has landed', () => {
    expect(substitutePartialState(GROUPED_NO_MATCHES, summary({ roster_swapped: true }))).toBe('partial');
    expect(substituteApplyMayBePartial(GROUPED_NO_MATCHES, summary({ roster_swapped: true }))).toBe(false);
  });

  it('stays quiet when no step the preview cannot show was planned (ungrouped phase, no matches)', () => {
    const confirmed = summary({
      phases: [{ phase_id: 'phase-1', phase_name: 'Playoffs', seed: 1, group: null }],
    });

    expect(substitutePartialState(confirmed, { ...confirmed })).toBeNull();
  });
});

describe('SubstitutePartialWarning', () => {
  it('warns that the incoming player may already hold the group slot', () => {
    const text = textOf(
      renderToStaticMarkup(<SubstitutePartialWarning state="possibly_partial" inPlayerName="Bea" />),
    );

    expect(text).toContain('may have stopped partway');
    expect(text).toContain('Confirm it with Bea to finish');
    expect(text).toContain('could leave Bea holding a group slot without being enrolled');
  });

  it('keeps the definite warning for a partial apply the preview shows', () => {
    const text = textOf(renderToStaticMarkup(<SubstitutePartialWarning state="partial" inPlayerName="Bea" />));

    expect(text).toContain('stopped partway: the steps before the failure stay written');
  });

  it('renders nothing when the apply shows no sign of a write', () => {
    expect(renderToStaticMarkup(<SubstitutePartialWarning state={null} inPlayerName="Bea" />)).toBe('');
  });
});

describe('SubstitutePartialWarning in German', () => {
  it('warns about a possibly partial apply in German, with or without a preview below', () => {
    const withPreview = textOf(
      renderWithI18n(<SubstitutePartialWarning state="possibly_partial" inPlayerName="Bea" />, { locale: 'de' }),
    );
    expect(withPreview).toContain('möglicherweise mittendrin abgebrochen');
    expect(withPreview).toContain('ohne dass die Vorschau unten das zeigt');
    expect(withPreview).toContain('Bestätige ihn mit Bea');

    const noPreview = textOf(
      renderWithI18n(<SubstitutePartialWarning state="possibly_partial" inPlayerName="Bea" hasPreview={false} />, {
        locale: 'de',
      }),
    );
    expect(noPreview).not.toContain('Vorschau unten');
  });
});
