/**
 * The substitute route's exact partial signal in the dialog (PR #65 test-pass
 * follow-ups, round 3): a failed apply that answered says exactly what it
 * wrote, the warning comes from that signal and survives a failed re-check,
 * and only an unanswered request falls back to inferring it from the
 * re-checked preview. Rendered through react-dom/server (vitest 'node' env,
 * no DOM).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SubstitutePartialWarning,
  applySubstitute,
  describeSubstitutePartial,
  nextSubstituteFailureNotice,
  type SubstituteApplyOutcome,
  type SubstituteApplyResponse,
} from '../SubstituteDialog';
import type { SubstitutePartialApply, SubstituteSummary } from '@/lib/season/substitute';
import type { ApiResult } from '@/types/api';
import { createTranslator } from '@/i18n/core';
import { leagueRosterMessages } from '@/i18n/messages/league-roster';
import { renderWithI18n } from '@/test/i18n';

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

/** Phase scope, grouped phase, no scheduled matches. */
const CONFIRMED = summary({
  phases: [
    { phase_id: 'phase-1', phase_name: 'Gruppenphase', seed: 3, group: { id: 'g-1', name: 'Gruppe A' } },
  ],
});

/** The group row moved, then the enrollment swap failed. */
const GROUP_ONLY: SubstitutePartialApply = {
  written: {
    proposals_cancelled: [],
    matches_repaired: [],
    matches_skipped: [],
    groups_handed_over: [{ phase_id: 'phase-1', group_id: 'g-1' }],
    enrollments_swapped: [],
    roster_swapped: false,
  },
  phase_ids: ['phase-1'],
  stopped_at: { step: 'enrollment', phase_id: 'phase-1', match_id: null },
};

function failed(error: string, partial: SubstitutePartialApply | null | 'absent'): SubstituteApplyResponse {
  return partial === 'absent'
    ? { success: false, error }
    : { success: false, error, code: 'ENROLLMENT_CHANGED', partial };
}

const recheckOk = (data: SubstituteSummary) =>
  vi.fn(async (): Promise<ApiResult<SubstituteSummary>> => ({ success: true, data }));
const recheckFails = () =>
  vi.fn(async (): Promise<ApiResult<SubstituteSummary>> => {
    throw new Error('network down');
  });

describe('applySubstitute', () => {
  it('returns the summary of a completed apply, with no re-check', async () => {
    const done = summary({ roster_swapped: true });
    const recheck = recheckOk(done);

    const outcome = await applySubstitute(CONFIRMED, async () => ({ success: true, data: done }), recheck);

    expect(outcome).toEqual({ ok: true, summary: done });
    expect(recheck).not.toHaveBeenCalled();
  });

  it("warns from the server's signal after a failure that handed only the group row over (the re-check looks untouched)", async () => {
    // The re-check resolves the same group from the incoming player's row.
    const outcome = await applySubstitute(
      CONFIRMED,
      async () => failed('Outgoing player is no longer enrolled', GROUP_ONLY),
      recheckOk({ ...CONFIRMED }),
    );

    expect(outcome).toEqual({
      ok: false,
      // The server's refusal is kept whole (English text + code), and rendered by code.
      error: { api: { error: 'Outgoing player is no longer enrolled', code: 'ENROLLMENT_CHANGED' } },
      partial: 'partial',
      written: GROUP_ONLY,
      preview: CONFIRMED,
    });
  });

  it('keeps the warning when the re-check after the failure fails too', async () => {
    const outcome = await applySubstitute(
      CONFIRMED,
      async () => failed('Outgoing player is no longer enrolled', GROUP_ONLY),
      recheckFails(),
    );

    expect(outcome).toMatchObject({ ok: false, partial: 'partial', written: GROUP_ONLY, preview: null });
  });

  it('keeps the warning when the re-check answers with an error', async () => {
    const outcome = await applySubstitute(
      CONFIRMED,
      async () => failed('connection reset', GROUP_ONLY),
      vi.fn(async (): Promise<ApiResult<SubstituteSummary>> => ({
        success: false,
        error: 'Outgoing player is not enrolled in this phase',
      })),
    );

    expect(outcome).toMatchObject({ ok: false, partial: 'partial', preview: null });
  });

  it('shows no warning when the server says nothing was written, whatever the re-check shows', async () => {
    // partial: null is exact: another change made the preview differ, not this apply.
    const outcome = await applySubstitute(
      CONFIRMED,
      async () => failed('Outgoing player is no longer enrolled', null),
      recheckOk(summary()),
    );

    expect(outcome).toMatchObject({ ok: false, partial: null, written: null, preview: summary() });
  });

  it('reads a failure rejected before the substitution ran (no partial field) as nothing written', async () => {
    const outcome = await applySubstitute(CONFIRMED, async () => failed('Forbidden', 'absent'), recheckFails());

    expect(outcome).toMatchObject({ ok: false, error: { api: { error: 'Forbidden' } }, partial: null, written: null });
  });

  it('falls back to the re-checked preview when the request itself failed (no answer, no signal)', async () => {
    const apply = async (): Promise<SubstituteApplyResponse> => {
      throw new Error('network down');
    };

    const unchanged = await applySubstitute(CONFIRMED, apply, recheckOk({ ...CONFIRMED }));
    expect(unchanged).toMatchObject({
      ok: false,
      error: { key: 'applyFailed' },
      partial: 'possibly_partial',
      written: null,
    });

    const changed = await applySubstitute(CONFIRMED, apply, recheckOk(summary()));
    expect(changed).toMatchObject({ partial: 'partial', written: null });
  });

  it('counts an unanswered request whose re-check also failed as possibly partial', async () => {
    const outcome = await applySubstitute(
      CONFIRMED,
      async () => {
        throw new Error('network down');
      },
      recheckFails(),
    );

    expect(outcome).toMatchObject({ ok: false, partial: 'possibly_partial', preview: null });
  });
});

describe('nextSubstituteFailureNotice', () => {
  const failure = (
    partial: 'partial' | 'possibly_partial' | null,
    written: SubstitutePartialApply | null,
  ): Extract<SubstituteApplyOutcome, { ok: false }> => ({
    ok: false,
    error: { key: 'applyFailed' },
    partial,
    written,
    preview: null,
  });

  it('keeps an earlier warning when a later failed apply wrote nothing', () => {
    const first = nextSubstituteFailureNotice(null, failure('partial', GROUP_ONLY), CONFIRMED);
    expect(first).toEqual({ partial: 'partial', written: GROUP_ONLY, confirmed: CONFIRMED });

    expect(nextSubstituteFailureNotice(first, failure(null, null), summary())).toBe(first);
    expect(nextSubstituteFailureNotice(null, failure(null, null), CONFIRMED)).toBeNull();
  });

  it('adds what a later failed apply wrote to the earlier writes', () => {
    const first = nextSubstituteFailureNotice(null, failure('partial', GROUP_ONLY), CONFIRMED);
    const enrollment: SubstitutePartialApply = {
      written: { ...GROUP_ONLY.written, groups_handed_over: [], enrollments_swapped: ['phase-1'] },
      phase_ids: ['phase-1'],
      stopped_at: { step: 'roster', phase_id: null, match_id: null },
    };

    const next = nextSubstituteFailureNotice(first, failure('partial', enrollment), summary());

    expect(next).toEqual({
      partial: 'partial',
      written: {
        written: { ...GROUP_ONLY.written, enrollments_swapped: ['phase-1'] },
        phase_ids: ['phase-1'],
        stopped_at: { step: 'roster', phase_id: null, match_id: null },
      },
      confirmed: CONFIRMED,
    });
  });
});

describe('describeSubstitutePartial', () => {
  it('names each written step, with the phases from the confirmed preview', () => {
    const lines = describeSubstitutePartial(
      {
        written: {
          proposals_cancelled: ['m-1'],
          matches_repaired: ['m-1', 'm-2'],
          matches_skipped: ['m-3'],
          groups_handed_over: [{ phase_id: 'phase-1', group_id: 'g-1' }],
          enrollments_swapped: ['phase-1', 'phase-9'],
          roster_swapped: true,
        },
        phase_ids: ['phase-1', 'phase-9'],
        stopped_at: null,
      },
      CONFIRMED,
    );

    expect(lines).toEqual([
      'Pending proposals cancelled on 1 match',
      '2 matches re-paired',
      'Group slot handed over in Gruppenphase',
      'Enrollment moved in Gruppenphase, a phase',
      'League roster swapped',
    ]);
  });
});

describe('SubstitutePartialWarning with the exact signal', () => {
  it('lists what was written', () => {
    const text = textOf(
      renderToStaticMarkup(
        <SubstitutePartialWarning state="partial" inPlayerName="Bea" written={GROUP_ONLY} confirmed={CONFIRMED} />,
      ),
    );

    expect(text).toContain('stopped partway: the steps before the failure stay written');
    expect(text).toContain('The preview below is what is still open.');
    expect(text).toContain('Group slot handed over in Gruppenphase');
    expect(text).toContain('another replacement would leave Bea in the slots already handed over');
  });

  it('does not point at a preview when the re-check failed', () => {
    const text = textOf(
      renderToStaticMarkup(
        <SubstitutePartialWarning
          state="partial"
          inPlayerName="Bea"
          written={GROUP_ONLY}
          confirmed={CONFIRMED}
          hasPreview={false}
        />,
      ),
    );

    expect(text).not.toContain('preview below');
    expect(text).toContain('The check of what is still open failed too');
    expect(text).toContain('Group slot handed over in Gruppenphase');
  });
});

describe('the written steps in German', () => {
  const ALL_STEPS: SubstitutePartialApply = {
    written: {
      proposals_cancelled: ['m-1', 'm-2'],
      matches_repaired: ['m-1'],
      matches_skipped: [],
      groups_handed_over: [{ phase_id: 'phase-1', group_id: 'g-1' }],
      enrollments_swapped: ['phase-1'],
      roster_swapped: true,
    },
    phase_ids: ['phase-1'],
    stopped_at: null,
  };

  it('describes each step with German plurals', () => {
    expect(describeSubstitutePartial(ALL_STEPS, CONFIRMED, createTranslator(leagueRosterMessages, 'de'))).toEqual([
      'Offene Vorschläge für 2 Spiele storniert',
      '1 Spiel neu gepaart',
      'Gruppenplatz übergeben in: Gruppenphase',
      'Eintrag verschoben in: Gruppenphase',
      'Ligakader getauscht',
    ]);
  });

  it('renders the partial warning in German', () => {
    const text = textOf(
      renderWithI18n(
        <SubstitutePartialWarning state="partial" inPlayerName="Bea" written={GROUP_ONLY} confirmed={CONFIRMED} />,
        { locale: 'de' },
      ),
    );

    expect(text).toContain('Der Wechsel ist mittendrin abgebrochen');
    expect(text).toContain('Die Vorschau unten zeigt, was noch offen ist.');
    expect(text).toContain('Gruppenplatz übergeben in: Gruppenphase');
    expect(text).toContain('würde Bea auf den bereits übergebenen Plätzen lassen');
  });
});
