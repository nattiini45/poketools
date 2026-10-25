/**
 * AdminMatchBulkDialog (server render): the dialog frame is a portal, so each phase is rendered through the exported
 * body and results panel. Covers what the three actions preview, when the submit is disabled, the whole-request
 * error and the report of a finished batch, in English and German.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { AdminMatchBulkDialogBody, BulkResultsPanel, buildBatchBody } from '../AdminMatchBulkDialog';
import { summarizeBulkResults, type BulkItemResult } from '@/lib/admin/match-bulk';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';
import type { GameSummary } from '@/types/match';

const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function game(n: number, winner: string): GameSummary {
  return { id: `g${n}`, game_number: n, winner_id: winner, replay_url: '', source: 'ps_replay', stats_locked: false };
}

function row(n: number, overrides: Partial<AdminMatchRow> = {}): AdminMatchRow {
  return {
    id: ID(n),
    round_id: 'round-1',
    tournament_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    player_1_id: P1,
    player_2_id: P2,
    winner_id: null,
    status: 'pending_confirmation',
    submitter_id: null,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    player_1_name: `Mara${n}`,
    player_2_name: `Joel${n}`,
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: null,
    round_status: 'active',
    games: [],
    tournament_name: 'Spring Cup',
    season_id: 'season-1',
    season_name: 'Spring League',
    season_is_test: false,
    archived: false,
    round_name: 'Round 3',
    round_number: 3,
    best_of: 3,
    round_deadline: null,
    ...overrides,
  };
}

/** A pending match whose reported result is 2-1 for player one. */
const reported = (n: number) =>
  row(n, { winner_id: P1, winner_name: `Mara${n}`, games: [game(1, P1), game(2, P2), game(3, P1)] });

type Body = Parameters<typeof AdminMatchBulkDialogBody>[0];
const body = (props: Partial<Body> & Pick<Body, 'kind' | 'rows'>, locale: 'en' | 'de' = 'en') =>
  renderWithI18n(
    <AdminMatchBulkDialogBody
      timeZone="Europe/Berlin"
      scheduleValue=""
      onScheduleChange={() => {}}
      note=""
      onNoteChange={() => {}}
      phase="input"
      error={null}
      response={null}
      onSubmit={() => {}}
      onClose={() => {}}
      {...props}
    />,
    { locale },
  );

/** Whether the submit button (the one with type="submit") is rendered disabled. */
const submitDisabled = (html: string) =>
  /<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/.test(html);

describe('buildBatchBody', () => {
  const rows = [row(1), row(2)];
  const input = { scheduleValue: '', note: '', timeZone: 'UTC' };

  it('builds each action from the input', () => {
    expect(buildBatchBody('confirm', [reported(1), reported(2)], input)).toEqual({
      action: 'confirm',
      match_ids: [ID(1), ID(2)],
      params: {
        expected: [
          { match_id: ID(1), winner_id: P1, status: 'pending_confirmation' },
          { match_id: ID(2), winner_id: P1, status: 'pending_confirmation' },
        ],
      },
    });
    expect(buildBatchBody('schedule', rows, { ...input, scheduleValue: '2026-11-01T18:00', timeZone: 'Europe/Berlin' })).toEqual({
      action: 'schedule',
      match_ids: [ID(1), ID(2)],
      params: { scheduled_at: '2026-11-01T17:00:00.000Z' },
    });
    expect(buildBatchBody('note', rows, { ...input, note: '  Checked  ' })).toEqual({
      action: 'note',
      match_ids: [ID(1), ID(2)],
      params: { note: 'Checked' },
    });
  });

  it('sends a confirm only for the matches the preview confirms, each with the winner shown there', () => {
    const playerTwoWon = row(2, { winner_id: P2, winner_name: 'Joel2' });
    const body = buildBatchBody('confirm', [reported(1), playerTwoWon, row(3, { status: 'scheduled' }), row(4)], input);
    expect(body).toEqual({
      action: 'confirm',
      match_ids: [ID(1), ID(2)],
      params: {
        expected: [
          { match_id: ID(1), winner_id: P1, status: 'pending_confirmation' },
          { match_id: ID(2), winner_id: P2, status: 'pending_confirmation' },
        ],
      },
    });
  });

  it('has no confirm request when nothing in the selection can be confirmed', () => {
    expect(buildBatchBody('confirm', [row(3, { status: 'scheduled' }), row(4)], input)).toBeNull();
  });

  it('is null while the input is not valid', () => {
    expect(buildBatchBody('schedule', rows, input)).toBeNull();
    expect(buildBatchBody('schedule', rows, { ...input, scheduleValue: '1999-01-01T10:00' })).toBeNull();
    expect(buildBatchBody('note', rows, { ...input, note: '   ' })).toBeNull();
    expect(buildBatchBody('note', rows, { ...input, note: 'x'.repeat(2001) })).toBeNull();
  });
});

describe('AdminMatchBulkDialog confirm', () => {
  const rows = [reported(1), reported(2), row(3, { status: 'scheduled' }), row(4)];

  it('previews each match to confirm with its winner and Bo score, and the skipped ones with their reason', () => {
    const html = body({ kind: 'confirm', rows });
    expect(html).toContain('2 matches will be confirmed');
    expect(html).toContain('Mara1 vs Joel1');
    expect(html).toContain('2–1');
    expect(html).toContain('Bo3');
    expect(html).toContain('Winner: Mara1');
    expect(html).toContain('2 matches will be skipped');
    expect(html).toContain('Mara3 vs Joel3: Only matches awaiting confirmation can be confirmed in bulk.');
    expect(html).toContain('Mara4 vs Joel4: Cannot complete a match without a winner');
    expect(html).toContain('standings, ratings and streaks');
    expect(html).toContain('Confirm 2 matches');
    expect(submitDisabled(html)).toBe(false);
  });

  it('disables the submit and explains when nothing can be confirmed', () => {
    const html = body({ kind: 'confirm', rows: [row(3, { status: 'scheduled' }), row(4)] });
    expect(html).toContain('None of the selected matches can be confirmed.');
    expect(html).not.toContain('will be confirmed');
    expect(html).not.toContain('standings, ratings and streaks');
    expect(submitDisabled(html)).toBe(true);
  });

  it('is translated to German', () => {
    const html = body({ kind: 'confirm', rows }, 'de');
    expect(html).toContain('2 Spiele werden bestätigt');
    expect(html).toContain('Mara1 vs. Joel1');
    expect(html).toContain('Sieger: Mara1');
    expect(html).toContain('2 Spiele werden übersprungen');
    expect(html).toContain('Nur Spiele, die auf Bestätigung warten, lassen sich gesammelt bestätigen.');
    expect(html).toContain('2 Spiele bestätigen');
  });
});

describe('AdminMatchBulkDialog schedule', () => {
  const rows = [row(1), row(2, { status: 'disputed' }), row(3, { status: 'completed' })];

  it('shows the time zone and how many of the selection the time applies to', () => {
    const html = body({ kind: 'schedule', rows });
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('Time zone: Europe/Berlin');
    expect(html).toContain('Applies to 2 of 3 selected.');
    expect(html).toContain('1 completed match is skipped.');
    expect(submitDisabled(html)).toBe(true);
  });

  it('enables the submit for a valid time, and flags an out-of-range one', () => {
    const valid = body({ kind: 'schedule', rows, scheduleValue: '2026-11-01T18:00' });
    expect(valid).toContain('Set time for 2 matches');
    expect(submitDisabled(valid)).toBe(false);
    expect(valid).not.toContain('Enter a valid date and time.');
    const invalid = body({ kind: 'schedule', rows, scheduleValue: '1999-01-01T10:00' });
    expect(invalid).toContain('Enter a valid date and time.');
    expect(submitDisabled(invalid)).toBe(true);
  });

  it('disables the submit when only completed matches are selected', () => {
    const html = body({ kind: 'schedule', rows: [row(3, { status: 'completed' })], scheduleValue: '2026-11-01T18:00' });
    expect(html).toContain('Applies to 0 of 1 selected.');
    expect(submitDisabled(html)).toBe(true);
  });

  it('is translated to German', () => {
    const html = body({ kind: 'schedule', rows }, 'de');
    expect(html).toContain('Zeitzone: Europe/Berlin');
    expect(html).toContain('Gilt für 2 von 3 ausgewählten.');
    expect(html).toContain('1 abgeschlossenes Spiel wird übersprungen.');
  });
});

describe('AdminMatchBulkDialog note', () => {
  const rows = [row(1), row(2)];

  it('shows a live counter against the limit and disables the submit for empty or too long text', () => {
    const empty = body({ kind: 'note', rows });
    expect(empty).toContain('0 / 2,000');
    expect(empty).toContain('Existing notes are kept.');
    expect(submitDisabled(empty)).toBe(true);

    const some = body({ kind: 'note', rows, note: 'Checked with both players' });
    expect(some).toContain('25 / 2,000');
    expect(some).toContain('Add note to 2 matches');
    expect(submitDisabled(some)).toBe(false);

    const over = body({ kind: 'note', rows, note: 'x'.repeat(2001) });
    expect(over).toContain('2,001 / 2,000');
    expect(over).toContain('text-poke-danger');
    expect(submitDisabled(over)).toBe(true);
  });

  it('is translated to German', () => {
    const html = body({ kind: 'note', rows, note: 'abc' }, 'de');
    expect(html).toContain('3 / 2.000');
    expect(html).toContain('Notiz zu 2 Spielen hinzufügen');
  });
});

describe('AdminMatchBulkDialog states', () => {
  const rows = [reported(1)];

  it('disables the submit while the request is in flight', () => {
    const html = body({ kind: 'confirm', rows, phase: 'submitting' });
    expect(html).toContain('Working...');
    expect(submitDisabled(html)).toBe(true);
  });

  it('shows a whole-request failure and keeps the input', () => {
    const html = body({ kind: 'note', rows, note: 'Keep me', error: { code: 'forbidden', error: 'Forbidden' } });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Forbidden');
    expect(html).toContain('Keep me');
    expect(submitDisabled(html)).toBe(false);
  });

  it('translates a whole-request failure into German', () => {
    const html = body({ kind: 'note', rows, note: 'x', error: { code: 'forbidden', error: 'Forbidden' } }, 'de');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Dafür fehlt dir die Berechtigung.');
  });
});

describe('AdminMatchBulkDialog live region', () => {
  const rows = [reported(1), reported(2)];
  const results: BulkItemResult[] = [
    { id: ID(1), ok: true, code: 'ok' },
    { id: ID(2), ok: false, code: 'match_bulk_conflict' },
  ];
  const response = { action: 'confirm' as const, results, summary: summarizeBulkResults(results) };
  const region = (html: string) => /<div role="status" aria-live="polite" class="sr-only">(.*?)<\/div>/.exec(html)?.[1];

  it('is mounted empty while the input is shown and while the request runs', () => {
    expect(region(body({ kind: 'confirm', rows }))).toBe('');
    expect(region(body({ kind: 'confirm', rows, phase: 'submitting' }))).toBe('');
  });

  it('carries the outcome once the response is in, partial failures included', () => {
    const html = body({ kind: 'confirm', rows, phase: 'done', response });
    expect(region(html)).toBe('1 of 2 done, 1 changed meanwhile');
    expect(html).toContain('Mara2 vs Joel2: The match changed while the action ran');
  });

  it('speaks the outcome in German', () => {
    const html = body({ kind: 'confirm', rows, phase: 'done', response }, 'de');
    expect(region(html)).toBe('1 von 2 erledigt, 1 zwischenzeitlich geändert');
  });
});

describe('BulkResultsPanel', () => {
  const rows = [row(1), row(2), row(3), row(4), row(5)];
  const results: BulkItemResult[] = [
    { id: ID(1), ok: true, code: 'ok' },
    { id: ID(2), ok: true, code: 'match_finalize_incomplete', params: { count: 2 } },
    { id: ID(3), ok: false, code: 'match_bulk_conflict' },
    { id: ID(4), ok: false, code: 'match_bulk_not_pending' },
    { id: ID(5), ok: false, code: 'match_bulk_item_failed' },
  ];
  const render = (locale: 'en' | 'de' = 'en', list = results) =>
    renderWithI18n(<BulkResultsPanel results={list} rows={rows} onClose={() => {}} />, { locale });
  /** The list (class names and text) that follows a heading. */
  const listAfter = (html: string, heading: string) => {
    const start = html.indexOf(heading);
    if (start < 0) throw new Error(`no heading ${heading}`);
    return /<ul class="([^"]*)">(.*?)<\/ul>/.exec(html.slice(start))?.slice(1) ?? [];
  };

  it('summarises the counts in a line, and takes focus so the report is read', () => {
    const html = render();
    expect(html).toMatch(/<p [^>]*>2 of 5 done, 1 skipped, 1 changed meanwhile, 1 failed<\/p>/);
    // The announcement is the dialog's own region; a status role on text that mounts with the panel is skipped.
    expect(html).not.toContain('role="status"');
    expect(html).toMatch(/^<div tabindex="-1"/);
  });

  it('lists failures, a warning and skipped matches with translated reasons, each in its own style', () => {
    const html = render();

    const [failedClass, failedText] = listAfter(html, 'Not done');
    expect(failedClass).toContain('text-poke-danger');
    expect(failedText).toContain('Mara3 vs Joel3: The match changed while the action ran');
    expect(failedText).toContain('Mara5 vs Joel5: The action failed for this match.');

    const [warningClass, warningText] = listAfter(html, 'Done, but a follow-up step failed');
    expect(warningClass).toContain('text-poke-yellow-ink');
    expect(warningText).toContain('Mara2 vs Joel2: The result was confirmed, but 2 follow-up steps failed.');

    const [skippedClass, skippedText] = listAfter(html, '>Skipped<');
    expect(skippedClass).toContain('text-poke-text-muted');
    expect(skippedClass).not.toContain('text-poke-danger');
    expect(skippedText).toContain('Mara4 vs Joel4: Only matches awaiting confirmation can be confirmed in bulk.');

    expect(html).toContain('>Close</button>');
  });

  it('lists nothing but the summary when every match was done', () => {
    const html = render('en', [{ id: ID(1), ok: true, code: 'ok' }]);
    expect(html).toContain('1 of 1 done');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('Not done');
  });

  it('is translated to German', () => {
    const html = render('de');
    expect(html).toContain('2 von 5 erledigt');
    expect(html).toContain('1 übersprungen');
    expect(html).toContain('1 zwischenzeitlich geändert');
    expect(html).toContain('Nicht erledigt');
    expect(html).toContain('Mara3 vs. Joel3: Das Spiel hat sich während der Aktion geändert');
    expect(html).toContain('Mara4 vs. Joel4: Nur Spiele, die auf Bestätigung warten');
    expect(html).toContain('Mara2 vs. Joel2: Das Ergebnis wurde bestätigt, aber 2 Folgeschritte sind fehlgeschlagen.');
    expect(html).toContain('>Schließen</button>');
  });
});
