/** @vitest-environment jsdom */
/**
 * `LadderCard` and its challenge rows in a DOM: a Challenge button only for the players the view says can be
 * challenged, the three answers (withdraw, accept, decline) sent to the right request, a lapsed challenge with no
 * buttons, the link of an accepted one, a refused request shown under its row, and both languages.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { LadderView } from '@/lib/format-engine/runtime/view-types';
import { ANNA, CARA, ME, PHASE_ID, SEASON_ID, challenge, ladder } from './fixtures';

const mocks = vi.hoisted(() => ({ make: vi.fn(), answer: vi.fn(), withdraw: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/client-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/client-api')>()),
  makeChallengeRequest: mocks.make,
  answerChallengeRequest: mocks.answer,
  withdrawChallengeRequest: mocks.withdraw,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import LadderCard from '../LadderCard';

const CHALLENGE_ID = '5e150000-0000-4000-8000-0000000000c1';
const ok = { ok: true, data: { challenge: challenge() } };

function setup(over: Partial<LadderView> = {}, { locale = 'en', closed = false }: { locale?: Locale; closed?: boolean } = {}) {
  const onReload = vi.fn(async () => {});
  const onStatus = vi.fn();
  const user = userEvent.setup();
  render(withI18n(<LadderCard seasonId={SEASON_ID} ladder={ladder(over)} viewerId={ME} closed={closed} onReload={onReload} onStatus={onStatus} />, { locale }));
  return { user, onReload, onStatus, t: createTranslator(formatRuntimePlayerMessages, locale) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LadderCard: the table', () => {
  it('ranks the players and enables Challenge only for the targets the view names', () => {
    const { t } = setup();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(within(rows[2]).getByText(t('ladder.you'))).toBeTruthy();
    // The viewer's own row has no button; an unnamed player is "former player".
    expect(within(rows[2]).queryByRole('button')).toBeNull();
    expect(within(rows[3]).getByText(t('player.former'), { exact: false })).toBeTruthy();

    expect((screen.getByRole('button', { name: t('ladder.challengeAria', { name: 'Anna' }) }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: t('ladder.challengeAria', { name: 'Ben' }) }) as HTMLButtonElement).disabled).toBe(false);
    const far = screen.getByRole('button', { name: t('ladder.challengeAria', { name: t('player.former') }) }) as HTMLButtonElement;
    expect(far.disabled).toBe(true);
    // The reason is written once and tied to the disabled button.
    expect(document.getElementById(far.getAttribute('aria-describedby')!)?.textContent).toBe(t('ladder.outOfRange'));
  });

  it('with no open round nobody can be challenged and the page says why', () => {
    const { t } = setup({ round: null, targets: [] });
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(t('ladder.noRound'))).toBeTruthy();
  });

  it('in a closed league no Challenge button is enabled', () => {
    setup({}, { closed: true });
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('Challenge sends the phase and the defender, then reloads', async () => {
    mocks.make.mockResolvedValue(ok);
    const { user, onReload, t } = setup();
    await user.click(screen.getByRole('button', { name: t('ladder.challengeAria', { name: 'Anna' }) }));
    expect(mocks.make).toHaveBeenCalledWith(SEASON_ID, PHASE_ID, ANNA);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('a refused challenge shows the reason; a conflict also reloads the view', async () => {
    mocks.make.mockResolvedValue({ ok: false, status: 409, error: { code: 'challenge_cooldown' } });
    const { user, onReload, t } = setup();
    await user.click(screen.getByRole('button', { name: t('ladder.challengeAria', { name: 'Ben' }) }));
    expect(screen.getByRole('alert').textContent).toContain('too recently');
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('a rank range the standings moved out of shows the reason and reloads, so the button of a target out of range goes', async () => {
    mocks.make.mockResolvedValue({ ok: false, status: 400, error: { code: 'challenge_rank_range' } });
    const { user, onReload, t } = setup();
    await user.click(screen.getByRole('button', { name: t('ladder.challengeAria', { name: 'Anna' }) }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('a bad request shows the reason and does not reload', async () => {
    mocks.make.mockResolvedValue({ ok: false, status: 400, error: { code: 'challenge_self' } });
    const { user, onReload, t } = setup();
    await user.click(screen.getByRole('button', { name: t('ladder.challengeAria', { name: 'Anna' }) }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onReload).not.toHaveBeenCalled();
  });
});

describe('LadderCard: the viewer\'s challenges', () => {
  it('an outgoing open challenge can be withdrawn, as the challenger', async () => {
    mocks.withdraw.mockResolvedValue(ok);
    const { user, onReload, t } = setup({ challenges: [challenge()] });
    expect(screen.getByText(t('ladder.outgoing', { name: 'Ben' }))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('ladder.acceptAria', { name: 'Ben' }) })).toBeNull();
    await user.click(screen.getByRole('button', { name: t('ladder.withdrawAria', { name: 'Ben' }) }));
    expect(mocks.withdraw).toHaveBeenCalledWith(SEASON_ID, CHALLENGE_ID, 'self');
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('an incoming open challenge can be accepted or declined', async () => {
    mocks.answer.mockResolvedValue(ok);
    const incoming = challenge({ challenger: { id: CARA, name: 'Cara' }, defender: { id: ME, name: 'Me' } });
    const { user, onReload, t } = setup({ challenges: [incoming] });
    expect(screen.getByText(t('ladder.incoming', { name: 'Cara' }))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('ladder.withdrawAria', { name: 'Cara' }) })).toBeNull();

    await user.click(screen.getByRole('button', { name: t('ladder.acceptAria', { name: 'Cara' }) }));
    expect(mocks.answer).toHaveBeenLastCalledWith(SEASON_ID, CHALLENGE_ID, true);
    await user.click(screen.getByRole('button', { name: t('ladder.declineAria', { name: 'Cara' }) }));
    expect(mocks.answer).toHaveBeenLastCalledWith(SEASON_ID, CHALLENGE_ID, false);
    expect(onReload).toHaveBeenCalledTimes(2);
  });

  it('a lapsed challenge reads as expired and has no buttons', () => {
    const { t } = setup({ challenges: [challenge({ lapsed: true })] });
    expect(screen.getByText(t('ladder.state.expired'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('ladder.withdrawAria', { name: 'Ben' }) })).toBeNull();
  });

  it('an open challenge shows when it expires', () => {
    setup({ challenges: [challenge()] });
    expect(document.querySelector('time[datetime="2026-10-11T10:00:00.000Z"]')).toBeTruthy();
  });

  it('an accepted challenge links to its match and has no buttons', () => {
    const matchId = '5e150000-0000-4000-8000-0000000000d1';
    const { t } = setup({ challenges: [challenge({ state: 'accepted', match_id: matchId })] });
    expect(screen.getByRole('link', { name: t('ladder.matchLink') }).getAttribute('href')).toBe(`/tournaments/${PHASE_ID}/matches/${matchId}`);
    expect(screen.queryByRole('button', { name: t('ladder.withdrawAria', { name: 'Ben' }) })).toBeNull();
  });

  it.each(['accepted', 'declined', 'expired', 'cancelled'] as const)('a %s challenge offers no answer to either side', (state) => {
    const incoming = challenge({ id: '5e150000-0000-4000-8000-0000000000c2', state, challenger: { id: CARA, name: 'Cara' }, defender: { id: ME, name: 'Me' } });
    const { t } = setup({ challenges: [challenge({ state }), incoming] });
    expect(screen.queryByRole('button', { name: t('ladder.withdrawAria', { name: 'Ben' }) })).toBeNull();
    expect(screen.queryByRole('button', { name: t('ladder.acceptAria', { name: 'Cara' }) })).toBeNull();
    expect(screen.queryByRole('button', { name: t('ladder.declineAria', { name: 'Cara' }) })).toBeNull();
  });

  it('answers are not offered in a closed league', () => {
    const incoming = challenge({ challenger: { id: CARA, name: 'Cara' }, defender: { id: ME, name: 'Me' } });
    const { t } = setup({ challenges: [incoming] }, { closed: true });
    expect(screen.queryByRole('button', { name: t('ladder.acceptAria', { name: 'Cara' }) })).toBeNull();
  });

  it('says there is no notification and that the viewer has no challenges yet', () => {
    const { t } = setup();
    expect(screen.getByText(t('ladder.none'))).toBeTruthy();
    expect(screen.getByText(t('ladder.noNotice'))).toBeTruthy();
  });
});

describe('LadderCard: focus and announcements', () => {
  const rowOf = () => document.querySelector(`[data-challenge="${CHALLENGE_ID}"]`);

  it('a sent challenge moves focus to the challenges heading and announces it', async () => {
    mocks.make.mockResolvedValue(ok);
    const { user, onStatus, t } = setup();
    await user.click(screen.getByRole('button', { name: t('ladder.challengeAria', { name: 'Anna' }) }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: t('ladder.yours') }));
    expect(onStatus).toHaveBeenCalledWith('challengeSent');
  });

  it('a refused challenge neither moves focus nor announces anything', async () => {
    mocks.make.mockResolvedValue({ ok: false, status: 400, error: { code: 'challenge_rank_range' } });
    const { user, onStatus, t } = setup();
    const button = screen.getByRole('button', { name: t('ladder.challengeAria', { name: 'Anna' }) });
    await user.click(button);
    expect(document.activeElement).toBe(button);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['withdraw', 'ladder.withdrawAria', 'challengeWithdrawn', undefined, 'Ben', () => mocks.withdraw],
    ['accept', 'ladder.acceptAria', 'challengeAccepted', { challenger: { id: CARA, name: 'Cara' }, defender: { id: ME, name: 'Me' } }, 'Cara', () => mocks.answer],
    ['decline', 'ladder.declineAria', 'challengeDeclined', { challenger: { id: CARA, name: 'Cara' }, defender: { id: ME, name: 'Me' } }, 'Cara', () => mocks.answer],
  ] as const)('%s moves focus to the challenge row and announces it', async (_name, aria, status, over, who, mock) => {
    mock().mockResolvedValue(ok);
    const { user, onStatus, t } = setup({ challenges: [challenge(over)] });
    await user.click(screen.getByRole('button', { name: t(aria, { name: who }) }));
    expect(document.activeElement).toBe(rowOf());
    expect(onStatus).toHaveBeenCalledWith(status);
  });
});

describe('LadderCard: German', () => {
  it('renders the ladder in German', () => {
    setup({ challenges: [challenge()] }, { locale: 'de' });
    expect(screen.getByRole('heading', { name: 'Herausforderungsleiter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anna herausfordern' })).toBeTruthy();
    expect(screen.getByText('An Ben')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deine Herausforderung an Ben zurückziehen' })).toBeTruthy();
  });
});

describe('LadderCard: the reason under the table', () => {
  it('names every refusal the rules can give: range, the open-challenge cap, a challenge between the pair, cooldown', () => {
    const { t } = setup();
    const text = t('ladder.outOfRange');
    expect(text).toMatch(/range/);
    expect(text).toMatch(/most open challenges/);
    expect(text).toMatch(/open challenge between you and that player/);
    expect(text).toMatch(/cooldown/);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('a player with no rank is told so instead of being sent to the range rule', () => {
    const { t } = setup({ my_rank: null, targets: [] });
    expect(screen.getByText(t('ladder.notRankedHint'))).toBeTruthy();
    expect(screen.queryByText(t('ladder.outOfRange'))).toBeNull();
  });

  it('says the same in German', () => {
    const { t } = setup({ my_rank: null, targets: [] }, { locale: 'de' });
    expect(t('ladder.notRankedHint')).toMatch(/nicht auf dieser Leiter/);
    expect(screen.getByText(t('ladder.notRankedHint'))).toBeTruthy();
  });
});
