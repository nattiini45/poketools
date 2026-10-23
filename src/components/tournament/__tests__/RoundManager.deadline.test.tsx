/**
 * RoundManager's round deadline: shown in the viewer's zone, flagged overdue
 * once it has passed on an unfinished round, and edited inline. Rendered
 * through react-dom/server (vitest 'node' env, no DOM); the save runs against
 * a fake fetch. The default test clock is 2026-10-09 12:00 UTC.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RoundManager, { isRoundOverdue, RoundDeadlineRow, saveRoundDeadline } from '../RoundManager';
import { renderWithI18n } from '@/test/i18n';
import type { Round } from '@/types/round';
import type { Tournament } from '@/types/tournament';

const NOW = Date.UTC(2026, 9, 9, 12);
const PAST = '2026-10-01T18:00:00.000Z';
const FUTURE = '2026-11-01T18:00:00.000Z';

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: 'r-1',
    tournament_id: 't-1',
    name: 'Round 1',
    round_number: 1,
    best_of: 3,
    status: 'active',
    pairings_generated: true,
    deadline: null,
    bracket_side: null,
    bye_player_ids: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isRoundOverdue', () => {
  it('is overdue when the deadline passed and the round is not completed', () => {
    expect(isRoundOverdue({ deadline: PAST, status: 'active' }, NOW)).toBe(true);
    expect(isRoundOverdue({ deadline: PAST, status: 'pending' }, NOW)).toBe(true);
  });

  it('is not overdue for a completed round, a future deadline or no deadline', () => {
    expect(isRoundOverdue({ deadline: PAST, status: 'completed' }, NOW)).toBe(false);
    expect(isRoundOverdue({ deadline: FUTURE, status: 'active' }, NOW)).toBe(false);
    expect(isRoundOverdue({ deadline: null, status: 'active' }, NOW)).toBe(false);
  });

  it('is not overdue at the exact deadline, nor for an unreadable one', () => {
    expect(isRoundOverdue({ deadline: new Date(NOW).toISOString(), status: 'active' }, NOW)).toBe(false);
    expect(isRoundOverdue({ deadline: 'garbage', status: 'active' }, NOW)).toBe(false);
  });
});

describe('saveRoundDeadline', () => {
  function jsonFetch(body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  }

  it('PATCHes the deadline to the round update endpoint', async () => {
    const round = makeRound({ deadline: FUTURE });
    const fetchImpl = jsonFetch({ success: true, data: round });

    const result = await saveRoundDeadline('t-1', 'r-1', FUTURE, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('/api/tournaments/t-1/rounds/r-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deadline: FUTURE }),
    });
    expect(result).toEqual({ success: true, data: round });
  });

  it('sends null to clear the deadline', async () => {
    const fetchImpl = jsonFetch({ success: true, data: makeRound() });

    await saveRoundDeadline('t-1', 'r-1', null, fetchImpl);

    const init = vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ deadline: null });
  });

  it('returns an API failure with its code instead of throwing', async () => {
    const fetchImpl = jsonFetch({ success: false, error: 'Forbidden', code: 'forbidden' });

    expect(await saveRoundDeadline('t-1', 'r-1', FUTURE, fetchImpl)).toEqual({
      success: false,
      error: 'Forbidden',
      code: 'forbidden',
    });
  });

  it('lets a network failure reject, for the caller to show', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    await expect(saveRoundDeadline('t-1', 'r-1', FUTURE, offline)).rejects.toThrow('Failed to fetch');
  });
});

describe('RoundDeadlineRow', () => {
  const noop = () => {};
  const render = (
    props: Partial<Parameters<typeof RoundDeadlineRow>[0]> = {},
    locale: 'en' | 'de' = 'en',
  ) =>
    renderWithI18n(
      <RoundDeadlineRow
        round={{ deadline: null, status: 'active' }}
        now={NOW}
        editing={false}
        draft=""
        saving={false}
        onEdit={noop}
        onDraftChange={noop}
        onSave={noop}
        onClear={noop}
        onCancel={noop}
        {...props}
      />,
      { locale },
    );

  it('says there is no deadline and offers to set one', () => {
    const text = textOf(render());

    expect(text).toContain('Deadline: No deadline');
    expect(text).toContain('Set deadline');
    expect(text).not.toContain('Overdue');
  });

  it('shows the deadline as a <time> in the viewer zone, with an edit button', () => {
    const html = render({ round: { deadline: FUTURE, status: 'active' } });

    expect(html).toContain(`<time dateTime="${FUTURE}"`);
    expect(textOf(html)).toContain('2026');
    expect(textOf(html)).toContain('18:00');
    expect(textOf(html)).toContain('Edit');
    expect(textOf(html)).not.toContain('Overdue');
  });

  it('marks a passed deadline on an unfinished round as overdue', () => {
    expect(textOf(render({ round: { deadline: PAST, status: 'active' } }))).toContain('Overdue');
  });

  it('does not mark a completed round as overdue', () => {
    expect(textOf(render({ round: { deadline: PAST, status: 'completed' } }))).not.toContain('Overdue');
  });

  it('shows a datetime-local editor with Save, Clear and Cancel while editing', () => {
    const html = render({
      round: { deadline: FUTURE, status: 'active' },
      editing: true,
      draft: '2026-11-01T18:00',
    });

    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-11-01T18:00"');
    expect(html).toContain('aria-label="Round deadline"');
    const text = textOf(html);
    expect(text).toContain('Save');
    expect(text).toContain('Clear');
    expect(text).toContain('Cancel');
  });

  it('hides Clear when the round has no deadline to clear', () => {
    const text = textOf(render({ editing: true, draft: '2026-11-01T18:00' }));

    expect(text).toContain('Save');
    expect(text).not.toContain('Clear');
  });

  it('disables Save for an empty draft and while saving', () => {
    const empty = render({ editing: true, draft: '' });
    const valid = render({ editing: true, draft: '2026-11-01T18:00' });
    const saving = render({ editing: true, draft: '2026-11-01T18:00', saving: true });

    const saveButton = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Save/s)?.[0] ?? '';
    expect(saveButton(empty)).toContain('disabled=""');
    expect(saveButton(valid)).not.toContain('disabled=""');
    expect(saveButton(saving)).toContain('disabled=""');
  });

  it('renders in German', () => {
    const text = textOf(render({ round: { deadline: PAST, status: 'active' } }, 'de'));

    expect(text).toContain('Frist:');
    expect(text).toContain('Überfällig');
    expect(text).toContain('Ändern');
    expect(text).not.toContain('Overdue');
  });
});

describe('RoundManager', () => {
  const tournament = {
    id: 't-1',
    bracket_type: 'round_robin',
    status: 'active',
    best_of_default: 3,
    bracket_reset_enabled: true,
  } as unknown as Tournament;

  it('shows each round deadline and flags only the unfinished overdue ones', () => {
    const rounds = [
      makeRound({ id: 'r-1', name: 'Round 1', status: 'completed', deadline: PAST }),
      makeRound({ id: 'r-2', name: 'Round 2', round_number: 2, status: 'active', deadline: PAST }),
      makeRound({ id: 'r-3', name: 'Round 3', round_number: 3, status: 'pending', deadline: FUTURE }),
      makeRound({ id: 'r-4', name: 'Round 4', round_number: 4, status: 'pending', deadline: null }),
    ];

    const html = renderWithI18n(<RoundManager tournament={tournament} initialRounds={rounds} />);

    expect(html.match(/<time /g)).toHaveLength(3);
    expect(html.match(/Overdue/g)).toHaveLength(1);
    expect(textOf(html)).toContain('No deadline');
    expect(html).toContain(`dateTime="${FUTURE}"`);
  });

  it('keeps rendering rounds without a deadline column value', () => {
    const html = renderToStaticMarkup(
      <RoundManager tournament={tournament} initialRounds={[makeRound({ deadline: null })]} />,
    );

    expect(textOf(html)).toContain('No deadline');
    expect(textOf(html)).not.toContain('Overdue');
  });
});
