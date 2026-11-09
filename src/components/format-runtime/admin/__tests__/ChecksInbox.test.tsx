/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import ChecksInbox from '../ChecksInbox';
import { MARA, MATCH, MISTY, NAMES, SEASON, check, failResponse, okResponse, sent, text } from './helpers';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const fetchMock = vi.fn();
const LABELS = { stages: { cup: text('Cup') }, actions: { gift: text('Gift') } };

function mount(checks = [check()], total = checks.length, locale: Locale = 'en') {
  return render(withI18n(<ChecksInbox seasonId={SEASON} initial={{ checks, total }} names={NAMES} labels={LABELS} />, { locale }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mocks.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('ChecksInbox', () => {
  it('says what each source found, with the names of the players and a link to the match', () => {
    mount([
      check({ id: 'k1' }),
      check({ id: 'k2', source: 'unresolved_outcome', subject: { match_id: MATCH, players: [MARA, MISTY] } }),
      check({ id: 'k3', source: 'pairing_rematch', subject: { stage: 'cup', round: 3, rematches: 2 } }),
    ]);
    expect(screen.getByText('These players are tied in Cup and the table cannot separate them: Mara and Misty.')).toBeTruthy();
    expect(screen.getByText('The result of the match between Mara and Misty could not be decided automatically.')).toBeTruthy();
    expect(screen.getByText('2 pairings in round 3 of Cup repeat an earlier match.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the match' }).getAttribute('href')).toBe(`/admin/matches/${MATCH}`);
    expect(screen.getByText('3 open checks')).toBeTruthy();
  });

  it('a missed deadline names the match or the action, and the reason in words (an unknown reason by its code)', () => {
    mount([
      check({
        id: 'k1',
        source: 'deadline_missed',
        subject: { stage: 'cup', round: 2, match_id: MATCH, players: [MARA, MISTY], reason: 'undecidable_forfeit' },
      }),
      check({
        id: 'k2',
        source: 'deadline_missed',
        subject: { stage: 'cup', action: 'gift', player_id: MISTY, reason: 'no_valid_pick' },
      }),
      check({
        id: 'k3',
        source: 'deadline_missed',
        subject: { stage: 'cup', action: 'gift', player_id: MARA, reason: 'item_outside_domain' },
      }),
    ]);
    expect(screen.getByText('A deadline passed in round 2 of Cup before the match between Mara and Misty was finished.')).toBeTruthy();
    expect(screen.getByText(/a forfeit could not be decided automatically/)).toBeTruthy();
    expect(screen.getByText('Misty has not submitted the action Gift in time.')).toBeTruthy();
    expect(screen.getByText('No valid pick was left to choose for the player.')).toBeTruthy();
    expect(screen.getByText('Reason: item_outside_domain')).toBeTruthy();
  });

  it('a missed action whose giver the server hid says "a player", never a name or "former player"', () => {
    mount([
      check({
        id: 'k4',
        source: 'deadline_missed',
        subject: { stage: 'cup', applies: 'action', action: 'gift', giver_masked: true, reason: 'admin_review' },
      }),
    ]);
    expect(screen.getByText(/^A player has not submitted the action Gift in time\./)).toBeTruthy();
    expect(screen.queryByText(/former player/)).toBeNull();
  });

  it('an unknown source, or a subject it cannot read, gets the generic sentence and the rule label', () => {
    mount([
      check({ id: 'k1', source: 'brand_new_source', rule_id: 'r_new', rule_label: text('Late gift'), subject: { anything: 1 } }),
      check({ id: 'k2', source: 'standings_tie', subject: 'not an object' as never }),
    ]);
    expect(screen.getAllByText('This check needs an admin decision.')).toHaveLength(2);
    expect(screen.getByText('Rule: Late gift')).toBeTruthy();
    expect(screen.getByText('Rule: tie_rule')).toBeTruthy();
    expect(screen.getByText('Check')).toBeTruthy();
  });

  it('a team review lists the broken rules through the teambuilder texts and the species the replay showed', () => {
    mount([
      check({
        id: 'k1',
        source: 'team_audit',
        subject: {
          match_id: MATCH,
          round: 2,
          player_id: MISTY,
          reasons: ['rules', 'observed_mismatch', 'no_registered_team'],
          issues: [{ code: 'kit_count_max', params: { max: 1, source: 'domain premium', have: 2 }, pokemon_indexes: [0, 1] }],
          off_team: ['Pikachu'],
          edited_after_play: true,
          cause: null,
        },
      }),
    ]);
    expect(screen.getByText('The team of Misty in round 2 needs a review.')).toBeTruthy();
    expect(screen.getByText('Team rule: at most 1 Pokémon from domain premium allowed, found 2')).toBeTruthy();
    expect(screen.getByText('The replay shows Pokémon that are not on the registered team: Pikachu.')).toBeTruthy();
    expect(screen.getByText('The player had no registered team for this match.')).toBeTruthy();
    expect(screen.getByText('The team was edited after the replay was submitted.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the match' })).toBeTruthy();
  });

  it('a team review with a hidden planned team shows the redacted wording, not an empty list of rules or species', () => {
    mount([
      check({
        id: 'k1',
        source: 'team_audit',
        subject: {
          match_id: MATCH,
          round: 2,
          player_id: MISTY,
          reasons: ['rules', 'observed_mismatch'],
          issues: [{ code: 'kit_count_max', params: {}, pokemon_indexes: [0, 1] }],
          off_team: [],
          off_team_count: 1,
          team_id: null,
          team_hidden: true,
        },
      }),
    ]);
    expect(screen.getByText('The team of Misty in round 2 needs a review.')).toBeTruthy();
    expect(screen.getByText('The registered team breaks the rules of the stage. Which rules stays hidden.')).toBeTruthy();
    expect(screen.getByText('The replay shows Pokémon that are not on the registered team. Which ones stays hidden.')).toBeTruthy();
    expect(screen.getByText(/The team is still a plan, so its details are hidden/)).toBeTruthy();
    expect(screen.queryByText(/not on the registered team: /)).toBeNull();
    expect(screen.queryByText('The registered team breaks the rules of the stage:')).toBeNull();
    expect(screen.queryByText(/at most/)).toBeNull();
  });

  it('an audit that could not run says why', () => {
    mount([check({ source: 'team_audit', subject: { player_id: MARA, reasons: ['audit_unavailable'], cause: 'ruleset_missing', issues: [] } })]);
    expect(screen.getByText('The audit could not run, so the team was not checked (the ruleset is missing).')).toBeTruthy();
  });

  it('a team review of a player the league no longer has names a former player', () => {
    mount([check({ source: 'team_audit', subject: { player_id: 'ffffffff-0000-4000-8000-000000000009', reasons: ['no_registered_team'] } })]);
    expect(screen.getByText('The team of former player in round ? needs a review.')).toBeTruthy();
  });

  it('says the verdict is a record only, and has nothing to do when no check is open', () => {
    mount([], 0);
    expect(screen.getByText(/A verdict is a record only/)).toBeTruthy();
    expect(screen.getByText('No open checks.')).toBeTruthy();
  });

  it('the verdict button waits for a choice', async () => {
    const user = userEvent.setup();
    mount();
    const save = screen.getByRole('button', { name: 'Save verdict' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Confirm' }));
    expect(save.hasAttribute('disabled')).toBe(false);
  });

  it('resolves a check with its note, reads the page again and takes the card away', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ check_id: 'f0000000-0000-4000-8000-000000000001', state: 'rejected' }));
    mount();
    await user.click(screen.getByRole('radio', { name: 'Reject' }));
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), '  Mara won the coin flip  ');
    await user.click(screen.getByRole('button', { name: 'Save verdict' }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(fetchMock)).toEqual({
      url: `/api/seasons/${SEASON}/format/checks/f0000000-0000-4000-8000-000000000001/resolve`,
      method: 'POST',
      body: { verdict: 'rejected', note: 'Mara won the coin flip' },
    });
    expect(screen.getByText('Check rejected.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save verdict' })).toBeNull();
    expect(screen.getByText('No open checks.')).toBeTruthy();
  });

  it('sends no note member when the note is empty', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ check_id: 'x', state: 'confirmed' }));
    mount();
    await user.click(screen.getByRole('radio', { name: 'Confirm' }));
    await user.click(screen.getByRole('button', { name: 'Save verdict' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sent(fetchMock).body).toEqual({ verdict: 'confirmed' });
  });

  it('counts the note in characters, as the server does: an emoji is one', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), '😀');
    expect(screen.getByText('1 of 500 characters')).toBeTruthy();
  });

  it('a check resolved elsewhere answers 409: the words are shown and the page is read again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(409, 'format_check_not_open', 'This check has already been resolved.'));
    mount();
    await user.click(screen.getByRole('radio', { name: 'Confirm' }));
    await user.click(screen.getByRole('button', { name: 'Save verdict' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This check has already been resolved.');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    // The card stays until the server page says otherwise; the words stand once, in the inbox.
    expect(screen.getByRole('button', { name: 'Save verdict' })).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('the stale-verdict words outlive the card the refreshed page takes away, and go with the next verdict', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(failResponse(409, 'format_check_not_open', 'This check has already been resolved.'));
    const view = mount([check({ id: 'k1' }), check({ id: 'k2' })]);
    const first = document.querySelector('[data-check-id="k1"]') as HTMLElement;
    await user.click(within(first).getByRole('radio', { name: 'Confirm' }));
    await user.click(within(first).getByRole('button', { name: 'Save verdict' }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    // The server page, read again, no longer lists k1.
    view.rerender(withI18n(<ChecksInbox seasonId={SEASON} initial={{ checks: [check({ id: 'k2' })], total: 1 }} names={NAMES} labels={LABELS} />));
    expect(document.querySelector('[data-check-id="k1"]')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('This check has already been resolved.');

    // A later verdict that goes through clears it.
    fetchMock.mockResolvedValueOnce(okResponse({ check_id: 'k2', state: 'confirmed' }));
    await user.click(screen.getByRole('radio', { name: 'Confirm' }));
    await user.click(screen.getByRole('button', { name: 'Save verdict' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('the same failure reads in German from the catalog', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(409, 'format_check_not_open', 'This check has already been resolved.'));
    mount([check()], 1, 'de');
    await user.click(screen.getByRole('radio', { name: 'Bestätigen' }));
    await user.click(screen.getByRole('button', { name: 'Urteil speichern' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Diese Prüfung ist schon entschieden.');
  });

  it('a failure that is not a stale view is shown without a refresh', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(429, 'rate_limited', 'Too many requests.', { seconds: 9 }));
    mount();
    await user.click(screen.getByRole('radio', { name: 'Confirm' }));
    await user.click(screen.getByRole('button', { name: 'Save verdict' }));
    const alert = await screen.findByRole('alert');
    expect(mocks.refresh).not.toHaveBeenCalled();
    // Not a stale view: the words stay in the card, next to the form.
    expect(document.querySelector('[data-check-id]')!.contains(alert)).toBe(true);
  });

  it('loads the resolved checks on demand and pages through them', async () => {
    const user = userEvent.setup();
    const resolved = (id: string, state: 'confirmed' | 'rejected') =>
      check({ id, state, resolved_at: '2026-11-03T10:00:00.000Z', resolved_by: { id: MARA, name: 'Mara' }, note: id === 'r1' ? 'fine' : null });
    fetchMock
      .mockResolvedValueOnce(okResponse({ checks: [check({ id: 'still-open' }), resolved('r1', 'confirmed')], total: 3 }))
      .mockResolvedValueOnce(okResponse({ checks: [resolved('r2', 'rejected')], total: 3 }));
    mount([], 0);

    await user.click(screen.getByRole('button', { name: 'Show resolved checks' }));
    expect(await screen.findByText('Confirmed')).toBeTruthy();
    expect(sent(fetchMock, 0)).toEqual({ url: `/api/seasons/${SEASON}/format/checks?status=all&limit=20&offset=0`, method: 'GET', body: undefined });
    // An open check in the answer is not a resolved one.
    expect(document.querySelector('[data-check-id="still-open"]')).toBeNull();
    expect(screen.getByText(/Resolved by Mara/)).toBeTruthy();
    expect(screen.getByText(/Note: fine/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Rejected')).toBeTruthy();
    expect(sent(fetchMock, 1).url).toBe(`/api/seasons/${SEASON}/format/checks?status=all&limit=20&offset=2`);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Hide resolved checks' }));
    expect(screen.queryByText('Confirmed')).toBeNull();
  });

  describe('more open checks than one page', () => {
    const openChecks = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => check({ id: `open-${from + i}`, source: 'unresolved_outcome', subject: { match_id: MATCH, players: [MARA, MISTY] } }));

    it('says how many are listed of how many are open, and reads the following page on request', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(okResponse({ checks: openChecks(20, 32), total: 32 }));
      mount(openChecks(0, 20), 32);

      expect(screen.getByText('32 open checks')).toBeTruthy();
      expect(screen.getByText('Showing 20 of 32 open checks.')).toBeTruthy();
      expect(document.querySelectorAll('[data-check-id]')).toHaveLength(20);

      await user.click(screen.getByRole('button', { name: 'Show more open checks' }));
      await waitFor(() => expect(document.querySelectorAll('[data-check-id]')).toHaveLength(32));
      expect(sent(fetchMock)).toEqual({ url: `/api/seasons/${SEASON}/format/checks?status=open&limit=20&offset=20`, method: 'GET', body: undefined });
      // Everything is listed now: no gap to explain, no button.
      expect(screen.queryByRole('button', { name: 'Show more open checks' })).toBeNull();
      expect(screen.queryByText(/Showing/)).toBeNull();
      expect(screen.getByText('32 open checks')).toBeTruthy();
    });

    it('lists nothing twice when a check appeared meanwhile and the page overlaps', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(okResponse({ checks: openChecks(19, 33), total: 33 }));
      mount(openChecks(0, 20), 32);
      await user.click(screen.getByRole('button', { name: 'Show more open checks' }));
      await waitFor(() => expect(document.querySelectorAll('[data-check-id]')).toHaveLength(33));
      expect(new Set([...document.querySelectorAll('[data-check-id]')].map((el) => el.getAttribute('data-check-id'))).size).toBe(33);
    });

    it('keeps the extra page after a verdict until the server page is read again, with the count taken down', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(okResponse({ checks: openChecks(20, 24), total: 24 }));
      mount(openChecks(0, 20), 24);
      await user.click(screen.getByRole('button', { name: 'Show more open checks' }));
      await waitFor(() => expect(document.querySelectorAll('[data-check-id]')).toHaveLength(24));

      fetchMock.mockResolvedValueOnce(okResponse({ check_id: 'open-20', state: 'confirmed' }));
      const card = document.querySelector('[data-check-id="open-20"]') as HTMLElement;
      await user.click(within(card).getByRole('radio', { name: 'Confirm' }));
      await user.click(within(card).getByRole('button', { name: 'Save verdict' }));
      await waitFor(() => expect(document.querySelector('[data-check-id="open-20"]')).toBeNull());
      expect(document.querySelectorAll('[data-check-id]')).toHaveLength(23);
      expect(screen.getByText('23 open checks')).toBeTruthy();
    });

    it('reads from the new first page after the server page was read again (a verdict took a check away)', () => {
      const { rerender } = mount(openChecks(0, 20), 32);
      expect(screen.getByText('Showing 20 of 32 open checks.')).toBeTruthy();
      rerender(withI18n(<ChecksInbox seasonId={SEASON} initial={{ checks: openChecks(1, 21), total: 31 }} names={NAMES} labels={LABELS} />));
      expect(screen.getByText('31 open checks')).toBeTruthy();
      expect(screen.getByText('Showing 20 of 31 open checks.')).toBeTruthy();
      expect(document.querySelector('[data-check-id="open-0"]')).toBeNull();
      expect(document.querySelector('[data-check-id="open-20"]')).not.toBeNull();
    });

    it('shows a failure of the extra page and keeps the button', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(failResponse(429, 'rate_limited', 'Too many requests.', { seconds: 9 }));
      mount(openChecks(0, 20), 32);
      await user.click(screen.getByRole('button', { name: 'Show more open checks' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Show more open checks' })).toBeTruthy();
    });
  });

  describe('resolved history', () => {
    const resolvedRow = (id: string, overrides = {}) =>
      check({ id, state: 'rejected', resolved_at: '2026-11-03T10:00:00.000Z', resolved_by: { id: MARA, name: 'Mara' }, note: null, ...overrides });

    it('lists a row once when the next page repeats it (a new check pushed the list down)', async () => {
      const user = userEvent.setup();
      fetchMock
        .mockResolvedValueOnce(okResponse({ checks: [resolvedRow('r1'), resolvedRow('r2')], total: 4 }))
        .mockResolvedValueOnce(okResponse({ checks: [resolvedRow('r2'), resolvedRow('r3')], total: 5 }));
      mount([], 0);
      await user.click(screen.getByRole('button', { name: 'Show resolved checks' }));
      expect(await screen.findAllByText('Rejected')).toHaveLength(2);
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await waitFor(() => expect(document.querySelectorAll('[data-check-id]')).toHaveLength(3));
      const ids = [...document.querySelectorAll('[data-check-id]')].map((el) => el.getAttribute('data-check-id'));
      expect(ids).toEqual(['r1', 'r2', 'r3']);
    });

    it('a check the system closed on a match reset says so in words, not by its code', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(
        okResponse({
          checks: [
            resolvedRow('sys', { source: 'team_audit', resolved_by: null, note: 'match_reset', subject: { match_id: MATCH, player_id: MARA, reasons: ['rules'] } }),
            resolvedRow('human', { note: 'match_reset' }),
          ],
          total: 2,
        }),
      );
      mount([], 0);
      await user.click(screen.getByRole('button', { name: 'Show resolved checks' }));
      expect(await screen.findByText(/Closed automatically: the match result was reset\./)).toBeTruthy();
      // The code appears only as the free text a human typed.
      expect(screen.getAllByText(/match_reset/)).toHaveLength(1);
      expect(screen.getByText(/Note: match_reset/)).toBeTruthy();
    });

    it('the automatic closing reads in German', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(okResponse({ checks: [resolvedRow('sys', { resolved_by: null, note: 'match_reset' })], total: 1 }));
      mount([], 0, 'de');
      await user.click(screen.getByRole('button', { name: 'Erledigte Prüfungen anzeigen' }));
      expect(await screen.findByText(/Automatisch geschlossen: das Spielergebnis wurde zurückgesetzt\./)).toBeTruthy();
      expect(screen.queryByText(/match_reset/)).toBeNull();
    });
  });

  describe('resolved checks behind a page of open ones', () => {
    const resolved = (id: string) =>
      check({ id, state: 'confirmed', resolved_at: '2026-11-03T10:00:00.000Z', resolved_by: { id: MARA, name: 'Mara' }, note: null });
    const openPage = (from: number) => Array.from({ length: 20 }, (_, i) => check({ id: `o-${from + i}` }));

    it('reads on while a page holds only open checks, so "no resolved checks" never stands next to "Load more"', async () => {
      const user = userEvent.setup();
      fetchMock
        .mockResolvedValueOnce(okResponse({ checks: openPage(0), total: 45 }))
        .mockResolvedValueOnce(okResponse({ checks: [...openPage(20).slice(0, 5), resolved('r1')], total: 45 }));
      mount([], 0);
      await user.click(screen.getByRole('button', { name: 'Show resolved checks' }));
      expect(await screen.findByText('Confirmed')).toBeTruthy();
      expect(sent(fetchMock, 1).url).toBe(`/api/seasons/${SEASON}/format/checks?status=all&limit=20&offset=20`);
      expect(screen.queryByText('No resolved checks yet.')).toBeNull();
      // 20 + 6 rows read of 45: the next click continues after them.
      fetchMock.mockResolvedValueOnce(okResponse({ checks: [resolved('r2')], total: 45 }));
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(sent(fetchMock, 2).url).toBe(`/api/seasons/${SEASON}/format/checks?status=all&limit=20&offset=26`);
    });

    it('gives up after a few pages without a resolved check, and says there is none among the newest entries', async () => {
      const user = userEvent.setup();
      for (let page = 0; page < 5; page += 1) fetchMock.mockResolvedValueOnce(okResponse({ checks: openPage(page * 20), total: 400 }));
      mount([], 0);
      await user.click(screen.getByRole('button', { name: 'Show resolved checks' }));
      expect(await screen.findByText('No resolved checks among the newest entries yet.')).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(screen.queryByText('No resolved checks yet.')).toBeNull();
      expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
    });

    it('says "no resolved checks yet" only once every entry was read', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(okResponse({ checks: [check({ id: 'o-1' })], total: 1 }));
      mount([], 0);
      await user.click(screen.getByRole('button', { name: 'Show resolved checks' }));
      expect(await screen.findByText('No resolved checks yet.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });
  });

  it('moves focus to the status line after a verdict, where the focused button was taken away', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ check_id: 'x', state: 'confirmed' }));
    mount([check({ id: 'k1' }), check({ id: 'k2' })]);
    const first = document.querySelector('[data-check-id="k1"]') as HTMLElement;
    await user.click(within(first).getByRole('radio', { name: 'Confirm' }));
    await user.click(within(first).getByRole('button', { name: 'Save verdict' }));
    await waitFor(() => expect(document.querySelector('[data-check-id="k1"]')).toBeNull());
    const status = screen.getByText('Check confirmed.');
    expect(document.activeElement).toBe(status);
    // Tab continues with the next card, not from the top of the page.
    await user.tab();
    expect(document.querySelector('[data-check-id="k2"]')!.contains(document.activeElement)).toBe(true);
  });

  it('names each verdict form after the sentence of its check, so equal controls can be told apart', () => {
    mount([check({ id: 'k1' }), check({ id: 'k2', source: 'unresolved_outcome', subject: { match_id: MATCH, players: [MARA, MISTY] } })]);
    const forms = screen.getAllByRole('form');
    expect(forms.map((form) => form.getAttribute('aria-label') ?? form.getAttribute('aria-labelledby'))).not.toContain(null);
    expect(screen.getByRole('form', { name: 'These players are tied in Cup and the table cannot separate them: Mara and Misty.' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'The result of the match between Mara and Misty could not be decided automatically.' })).toBeTruthy();
    // The save button says which check it resolves, too.
    const first = document.querySelector('[data-check-id="k1"]') as HTMLElement;
    expect(within(first).getByRole('button', { name: 'Save verdict' }).getAttribute('aria-describedby')).toBe(
      within(first).getByRole('form').getAttribute('aria-labelledby'),
    );
  });

  it('a team review form is named after its headline, not the list of reasons', () => {
    mount([check({ source: 'team_audit', subject: { player_id: MARA, reasons: ['no_registered_team'], round: 2 } })]);
    expect(screen.getByRole('form', { name: 'The team of Mara in round 2 needs a review.' })).toBeTruthy();
  });

  it('renders in German', () => {
    mount([check()], 1, 'de');
    expect(screen.getByText('1 offene Prüfung')).toBeTruthy();
    expect(screen.getByText(/Diese Spieler liegen in Cup gleichauf/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Bestätigen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Urteil speichern' })).toBeTruthy();
    expect(within(screen.getByRole('radiogroup')).getAllByRole('radio')).toHaveLength(2);
  });
});
