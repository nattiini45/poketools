/**
 * The substitution preview in a league with a custom format: it tells the admin that the incoming player inherits the seat's
 * format data and how many entries move, warns about a seat that stays with a player who keeps another phase, and merges the
 * `format_moved` step of a failed apply into the partial notice. Rendered through react-dom/server (vitest 'node' env).
 */
import { describe, expect, it } from 'vitest';
import {
  SubstitutePreviewView,
  SubstituteWarnings,
  nextSubstituteFailureNotice,
  substituteApplyWasPartial,
  type SubstituteApplyOutcome,
} from '../SubstituteDialog';
import type { SubstituteSummary } from '@/lib/season/substitute';
import { renderWithI18n } from '@/test/i18n';

const ROWS = { relation_links: 2, resource_items: 3, action_submissions: 1, player_attrs: 1, track_progress: 0, challenges: 1 };

function summary(overrides: Partial<SubstituteSummary> = {}): SubstituteSummary {
  return {
    roster_swapped: true,
    phases: [{ phase_id: 'phase-1', phase_name: 'Gruppenphase', seed: 3, group: null }],
    affected_matches: [],
    matches_repaired: 0,
    matches_skipped: [],
    ...overrides,
  };
}

const textOf = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('SubstitutePreviewView in a league with a format', () => {
  it('says the incoming player inherits the seat and how many entries move, with the rows per table', () => {
    const text = textOf(
      renderWithI18n(
        <SubstitutePreviewView preview={summary({ format: { moved: true, total: 8, rows: ROWS, kept_phase_ids: [] } })} />,
      ),
    );

    expect(text).toContain('Format data: 8 entries move to the incoming player');
    expect(text).toContain('The event log and adjustments stay with the outgoing player');
    expect(text).toContain('Links 2, items 3, picks 1, attributes 1, progress 0, open challenges 1');
  });

  it('says the same in German, with the singular for one entry', () => {
    const text = textOf(
      renderWithI18n(
        <SubstitutePreviewView preview={summary({ format: { moved: true, total: 1, rows: { ...ROWS, resource_items: 0 }, kept_phase_ids: [] } })} />,
        { locale: 'de' },
      ),
    );

    expect(text).toContain('Formatdaten: 1 Eintrag wechselt zum Ersatzspieler');
  });

  it('says nothing moves when the outgoing player holds no format data', () => {
    const text = textOf(
      renderWithI18n(
        <SubstitutePreviewView
          preview={summary({
            format: {
              moved: true,
              total: 0,
              rows: { relation_links: 0, resource_items: 0, action_submissions: 0, player_attrs: 0, track_progress: 0, challenges: 0 },
              kept_phase_ids: [],
            },
          })}
        />,
      ),
    );

    expect(text).toContain('Format data: the outgoing player holds none, so nothing moves');
  });

  it('warns that a seat stays with a player who keeps another phase, instead of announcing a move', () => {
    const text = textOf(
      renderWithI18n(
        <SubstitutePreviewView
          preview={summary({
            roster_swapped: false,
            format: { moved: false, total: 0, rows: { ...ROWS, relation_links: 0, resource_items: 0, action_submissions: 0, player_attrs: 0, challenges: 0 }, kept_phase_ids: ['phase-2'] },
            warnings: [{ code: 'substitute_format_seat_kept', params: { phases: 'Finals' } }],
          })}
        />,
      ),
    );

    expect(text).toContain('The outgoing player stays in Finals, so their format data');
    expect(text).not.toContain('entries move to the incoming player');
  });

  it('shows no format line in a league without a format', () => {
    const text = textOf(renderWithI18n(<SubstitutePreviewView preview={summary()} />));

    expect(text).not.toContain('Format data');
  });
});

describe('SubstituteWarnings', () => {
  it('renders each warning from its code in the viewer language, and nothing without one', () => {
    const warnings: SubstituteSummary['warnings'] = [{ code: 'substitute_format_seat_kept', params: { phases: 'Finals' } }];

    expect(textOf(renderWithI18n(<SubstituteWarnings warnings={warnings} />, { locale: 'de' }))).toContain('Der ausscheidende Spieler bleibt in Finals');
    expect(renderWithI18n(<SubstituteWarnings warnings={[]} />)).toBe('');
    expect(renderWithI18n(<SubstituteWarnings warnings={undefined} />)).toBe('');
  });
});

describe('the partial notice of a failed apply that already moved the format data', () => {
  it('keeps the move across later failed applies', () => {
    const moved = { total: 8, rows: ROWS };
    const failed = (formatMoved: typeof moved | null): Extract<SubstituteApplyOutcome, { ok: false }> => ({
      ok: false,
      error: { key: 'applyFailed' },
      partial: 'partial',
      preview: null,
      written: {
        written: {
          format_moved: formatMoved,
          proposals_cancelled: [],
          matches_repaired: [],
          matches_skipped: [],
          groups_handed_over: [],
          enrollments_swapped: [],
          roster_swapped: false,
        },
        phase_ids: [],
        stopped_at: null,
      },
    });
    const confirmed = summary();

    const first = nextSubstituteFailureNotice(null, failed(moved), confirmed);
    const second = nextSubstituteFailureNotice(first, failed(null), confirmed);

    expect(second?.written?.written.format_moved).toEqual(moved);
  });
});

describe('inferring a partial apply when the server gave no signal', () => {
  it('counts format rows that moved meanwhile (the preview now shows none left) as a partial write', () => {
    const withRows = summary({ format: { moved: true, total: 8, rows: ROWS, kept_phase_ids: [] } });
    const moved = summary({
      format: { moved: true, total: 0, rows: { relation_links: 0, resource_items: 0, action_submissions: 0, player_attrs: 0, track_progress: 0, challenges: 0 }, kept_phase_ids: [] },
    });

    expect(substituteApplyWasPartial(withRows, moved)).toBe(true);
    expect(substituteApplyWasPartial(withRows, withRows)).toBe(false);
  });
});
