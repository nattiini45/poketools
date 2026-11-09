/** @vitest-environment jsdom */
/**
 * `ActionCard` in a DOM: the states of an action (open, draft, submitted, locked, not yet, no access, closed league), the
 * requests Save and Submit send, that a submitted pick never offers a draft save, how a refused pick is shown, and that
 * a stale answer reloads the view through the page's reload path. Both languages.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { formatRuntimePlayerMessages } from '@/i18n/messages/format-runtime/player';
import type { ActionView } from '@/lib/format-engine/runtime/view-types';
import { action, DOMAINS, SEASON_ID, step } from './fixtures';

const mocks = vi.hoisted(() => ({ save: vi.fn(), submit: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/client-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/client-api')>()),
  saveActionRequest: mocks.save,
  submitActionRequest: mocks.submit,
}));

import ActionCard from '../ActionCard';

const PICKS = [
  { step: 0, item_id: 'pikachu' },
  { step: 0, item_id: 'charizard' },
];
const ok = (state: 'draft' | 'submitted') => ({ ok: true, data: { submission: { state, picks: PICKS } } });

function setup(over: Partial<ActionView> = {}, { locale = 'en', closed = false }: { locale?: Locale; closed?: boolean } = {}) {
  const onReload = vi.fn(async (): Promise<boolean> => true);
  const onStatus = vi.fn();
  const user = userEvent.setup();
  render(
    withI18n(<ActionCard seasonId={SEASON_ID} action={action(over)} domains={DOMAINS} closed={closed} onReload={onReload} onStatus={onStatus} />, { locale }),
  );
  return { user, onReload, onStatus, t: createTranslator(formatRuntimePlayerMessages, locale) };
}

const box = (name: string) => screen.getByRole('checkbox', { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ActionCard: an open action', () => {
  it('keeps Submit and Save draft off until the picks can be sent, and caps the choices at the step count', async () => {
    const { user, t } = setup();
    const submit = screen.getByRole('button', { name: t('buttons.submit') }) as HTMLButtonElement;
    const save = screen.getByRole('button', { name: t('buttons.saveDraft') }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(save.disabled).toBe(true);

    await user.click(box('Pikachu'));
    expect(save.disabled).toBe(false);
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(t('step.counter', { picked: 1, count: 2 }))).toBeTruthy();

    await user.click(box('Charizard'));
    expect(submit.disabled).toBe(false);
    expect((box('Bulbasaur') as HTMLInputElement).disabled).toBe(true);
    // A chosen entry stays clickable, so a pick can be taken back.
    await user.click(box('Charizard'));
    expect((box('Bulbasaur') as HTMLInputElement).disabled).toBe(false);
  });

  it('Save draft sends the picks to the save route, reloads, and announces it', async () => {
    mocks.save.mockResolvedValue(ok('draft'));
    const { user, onReload, onStatus, t } = setup();
    await user.click(box('Pikachu'));
    await user.click(box('Charizard'));
    await user.click(screen.getByRole('button', { name: t('buttons.saveDraft') }));

    expect(mocks.save).toHaveBeenCalledWith(SEASON_ID, 'gifts', PICKS);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith('saved');
  });

  it('Submit sends the picks to the submit route, reloads, and announces it', async () => {
    mocks.submit.mockResolvedValue(ok('submitted'));
    const { user, onReload, onStatus, t } = setup();
    await user.click(box('Pikachu'));
    await user.click(box('Charizard'));
    await user.click(screen.getByRole('button', { name: t('buttons.submit') }));

    expect(mocks.submit).toHaveBeenCalledWith(SEASON_ID, 'gifts', PICKS);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith('submitted');
  });

  it('a submit whose reload failed keeps the picks on screen and does not announce it', async () => {
    mocks.submit.mockResolvedValue(ok('submitted'));
    const { user, onReload, onStatus, t } = setup();
    onReload.mockResolvedValue(false);
    await user.click(box('Pikachu'));
    await user.click(box('Charizard'));
    await user.click(screen.getByRole('button', { name: t('buttons.submit') }));

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onStatus).not.toHaveBeenCalled();
    expect((box('Pikachu') as HTMLInputElement).checked).toBe(true);
    expect((box('Charizard') as HTMLInputElement).checked).toBe(true);
  });

  it('shows a saved draft as the starting picks', () => {
    setup({ submission: { state: 'draft', picks: PICKS } });
    expect((box('Pikachu') as HTMLInputElement).checked).toBe(true);
    expect((box('Charizard') as HTMLInputElement).checked).toBe(true);
    expect((box('Bulbasaur') as HTMLInputElement).checked).toBe(false);
  });

  it('names the target, or says it is hidden', () => {
    const shown = setup();
    expect(screen.getByText(shown.t('actions.targetKnown', { name: 'Anna' }))).toBeTruthy();
  });

  it('says the target is hidden when the view cannot show it', () => {
    const { t } = setup({ target: null, target_hidden: true });
    expect(screen.getByText(t('actions.targetHidden'))).toBeTruthy();
  });
});

describe('ActionCard: a submitted pick', () => {
  const submitted = { state: 'submitted' as const, picks: PICKS };

  it('shows the pick and a Change pick button, not the pickers and not Save draft', () => {
    const { t } = setup({ submission: submitted });
    expect(screen.getByText(t('actions.statusSubmitted'))).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: t('buttons.saveDraft') })).toBeNull();
    expect(screen.getByRole('button', { name: t('buttons.change') })).toBeTruthy();
    expect(screen.getByText('Pikachu')).toBeTruthy();
  });

  it('Change pick opens the pickers with Submit again only, which never calls the draft save', async () => {
    mocks.submit.mockResolvedValue(ok('submitted'));
    const { user, onReload, t } = setup({ submission: submitted });
    await user.click(screen.getByRole('button', { name: t('buttons.change') }));

    expect(screen.queryByRole('button', { name: t('buttons.saveDraft') })).toBeNull();
    expect(screen.getByText(t('actions.resubmitHint'))).toBeTruthy();
    await user.click(box('Charizard'));
    await user.click(box('Bulbasaur'));
    await user.click(screen.getByRole('button', { name: t('buttons.submitAgain') }));

    expect(mocks.submit).toHaveBeenCalledWith(SEASON_ID, 'gifts', [
      { step: 0, item_id: 'pikachu' },
      { step: 0, item_id: 'bulbasaur' },
    ]);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('a resubmit whose reload failed stays in the editor with the new picks', async () => {
    mocks.submit.mockResolvedValue(ok('submitted'));
    const { user, onReload, onStatus, t } = setup({ submission: submitted });
    onReload.mockResolvedValue(false);
    await user.click(screen.getByRole('button', { name: t('buttons.change') }));
    await user.click(box('Charizard'));
    await user.click(box('Bulbasaur'));
    await user.click(screen.getByRole('button', { name: t('buttons.submitAgain') }));

    expect(onStatus).not.toHaveBeenCalled();
    expect((box('Bulbasaur') as HTMLInputElement).checked).toBe(true);
    expect((box('Charizard') as HTMLInputElement).checked).toBe(false);
  });

  it('keeps focus in the card: into the pickers on Change pick, back onto Change pick after Cancel or a resubmit', async () => {
    mocks.submit.mockResolvedValue(ok('submitted'));
    const { user, t } = setup({ submission: submitted });
    await user.click(screen.getByRole('button', { name: t('buttons.change') }));
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));

    await user.click(screen.getByRole('button', { name: t('buttons.cancel') }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t('buttons.change') }));

    await user.click(screen.getByRole('button', { name: t('buttons.change') }));
    await user.click(box('Charizard'));
    await user.click(box('Bulbasaur'));
    await user.click(screen.getByRole('button', { name: t('buttons.submitAgain') }));
    expect(await screen.findByRole('button', { name: t('buttons.change') })).toBe(document.activeElement);
  });

  it('Cancel leaves the editor and keeps the submitted pick', async () => {
    const { user, t } = setup({ submission: submitted });
    await user.click(screen.getByRole('button', { name: t('buttons.change') }));
    await user.click(box('Bulbasaur'));
    await user.click(screen.getByRole('button', { name: t('buttons.cancel') }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: t('buttons.change') })).toBeTruthy();
  });
});

describe('ActionCard: not actionable', () => {
  it.each([
    ['the window has not opened', { window: 'not_open_yet', actionable: false }, 'actions.notYet'],
    ['the window is locked', { window: 'locked', actionable: false }, 'actions.lockedWindow'],
    ['the viewer has no access', { accessible: false, actionable: false }, 'actions.noAccess'],
    ['the pick is final', { submission: { state: 'locked', picks: PICKS }, actionable: false }, 'actions.lockedPick'],
  ] as const)('%s: a summary with the reason and no controls', (_name, over, key) => {
    const { t } = setup(over as Partial<ActionView>);
    expect(screen.getByText(t(key))).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('a closed league renders the same action read-only', () => {
    const { t } = setup({}, { closed: true });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(t('actions.noPick'))).toBeTruthy();
  });
});

describe('ActionCard: a pick the server refuses', () => {
  it('lists the problems next to their step and entry, moves focus to them, and does not reload', async () => {
    mocks.submit.mockResolvedValue({
      ok: false,
      status: 422,
      error: {
        code: 'format_action_invalid',
        issues: [
          { code: 'wrong_count', step: 0 },
          { code: 'duplicate_item', step: 0, item_id: 'pikachu' },
        ],
      },
    });
    const { user, onReload, t } = setup();
    await user.click(box('Pikachu'));
    await user.click(box('Charizard'));
    await user.click(screen.getByRole('button', { name: t('buttons.submit') }));

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(t('issue.heading'))).toBeTruthy();
    expect(within(alert).getByText(t('issue.wrong_count'), { exact: false })).toBeTruthy();
    expect(within(alert).getByText(t('issue.duplicate_item'), { exact: false })).toBeTruthy();
    expect(within(alert).getAllByText(t('issue.step', { number: 1 }), { exact: false }).length).toBe(2);
    expect(document.activeElement).toBe(alert);
    // A pick that is wrong in itself (422) says nothing about the league: no reload.
    expect(onReload).not.toHaveBeenCalled();
    // The picks are still there to correct.
    expect((box('Pikachu') as HTMLInputElement).checked).toBe(true);
  });

  it.each(['item_outside_domain', 'domain_locked', 'where_false', 'capacity_exceeded'] as const)(
    'a 422 pick refused for league state (%s: the domain or a resource moved) shows its reason and reloads the view',
    async (issue) => {
      mocks.submit.mockResolvedValue({ ok: false, status: 422, error: { code: 'format_action_invalid', issues: [{ code: issue, step: 0 }] } });
      const { user, onReload, t } = setup();
      await user.click(box('Pikachu'));
      await user.click(box('Charizard'));
      await user.click(screen.getByRole('button', { name: t('buttons.submit') }));

      expect(screen.getByRole('alert')).toBeTruthy();
      expect(onReload).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['window_closed', 409],
    ['format_not_running', 409],
    ['action_unknown', 404],
    ['actor_without_link', 403],
  ] as const)('a stale refusal (%s, status %i, code format_action_invalid) shows its reason and reloads the view', async (issue, status) => {
    mocks.submit.mockResolvedValue({ ok: false, status, error: { code: 'format_action_invalid', issues: [{ code: issue }] } });
    const { user, onReload, t } = setup();
    await user.click(box('Pikachu'));
    await user.click(box('Charizard'));
    await user.click(screen.getByRole('button', { name: t('buttons.submit') }));

    expect(within(screen.getByRole('alert')).getByText(t(`issue.${issue}`), { exact: false })).toBeTruthy();
    expect(onReload).toHaveBeenCalledTimes(1);
    // The picks stay for the player to keep.
    expect((box('Pikachu') as HTMLInputElement).checked).toBe(true);
  });

  it('an item taken meanwhile (409) reloads the view and still marks the entry and keeps the picks', async () => {
    mocks.submit.mockResolvedValue({
      ok: false,
      status: 409,
      error: { code: 'format_action_invalid', issues: [{ code: 'resource_item_taken', step: 0, item_id: 'pikachu' }] },
    });
    const { user, onReload, t } = setup();
    await user.click(box('Pikachu'));
    await user.click(box('Charizard'));
    await user.click(screen.getByRole('button', { name: t('buttons.submit') }));

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(t('issue.resource_item_taken'), { exact: false })).toBeTruthy();
    expect(screen.getByText(t('step.taken'))).toBeTruthy();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect((box('Pikachu') as HTMLInputElement).checked).toBe(true);
  });

  it('a stale answer (a conflict) shows its reason and reloads the view once', async () => {
    mocks.submit.mockResolvedValue({ ok: false, status: 409, error: { code: 'action_locked' } });
    const { user, onReload, t } = setup();
    await user.click(box('Pikachu'));
    await user.click(box('Charizard'));
    await user.click(screen.getByRole('button', { name: t('buttons.submit') }));

    expect(screen.getByRole('alert').textContent).toContain('locked');
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('a request that never reached the server shows an error and does not reload', async () => {
    mocks.save.mockResolvedValue({ ok: false, status: 0, error: { code: 'network_error' } });
    const { user, onReload, t } = setup();
    await user.click(box('Pikachu'));
    await user.click(screen.getByRole('button', { name: t('buttons.saveDraft') }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onReload).not.toHaveBeenCalled();
  });
});

describe('ActionCard: a final action', () => {
  it('asks before it submits, and sends nothing until the player confirms', async () => {
    mocks.submit.mockResolvedValue(ok('submitted'));
    const { user, t } = setup({ lock: 'on_submit' });
    await user.click(box('Pikachu'));
    await user.click(box('Charizard'));
    await user.click(screen.getByRole('button', { name: t('buttons.submit') }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(t('confirm.finalBody'))).toBeTruthy();
    expect(mocks.submit).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: t('buttons.confirm') }));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it('keeps focus on the card after the confirmed submit locked the pick and removed every button', async () => {
    mocks.submit.mockResolvedValue(ok('submitted'));
    const user = userEvent.setup();
    // The page reloads the view; the server has locked the pick by then, so the card is read-only with no buttons.
    function Page() {
      const [view, setView] = useState<ActionView>(action({ lock: 'on_submit' }));
      const reload = async (): Promise<boolean> => {
        setView(action({ lock: 'on_submit', actionable: false, submission: { state: 'locked', picks: PICKS } }));
        return true;
      };
      return <ActionCard seasonId={SEASON_ID} action={view} domains={DOMAINS} closed={false} onReload={reload} onStatus={vi.fn()} />;
    }
    render(withI18n(<Page />));
    const t = createTranslator(formatRuntimePlayerMessages, 'en');
    await user.click(box('Pikachu'));
    await user.click(box('Charizard'));
    await user.click(screen.getByRole('button', { name: t('buttons.submit') }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: t('buttons.confirm') }));

    await screen.findByText(t('actions.statusLocked'));
    expect(screen.queryByRole('button', { name: t('buttons.change') })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Choose your gifts' }));
  });
});

describe('ActionCard: blocked entries and locked lists', () => {
  it('disables a blocked entry and writes the reason next to it', () => {
    const { t } = setup({ steps: [step({ blocked: [{ id: 'charizard', reason: 'taken' }, { id: 'bulbasaur', reason: 'not_eligible' }] })] });
    const taken = box('Charizard') as HTMLInputElement;
    expect(taken.disabled).toBe(true);
    expect(taken.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(taken.getAttribute('aria-describedby')!)?.textContent).toContain(t('step.taken'));
    expect((box('Bulbasaur') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(t('step.notEligible'))).toBeTruthy();
  });

  it('a list that is not unlocked yet shows no entries and keeps the buttons off', () => {
    const { t } = setup({ steps: [step({ unlocked: false })] });
    expect(screen.getByText(t('step.locked'))).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect((screen.getByRole('button', { name: t('buttons.submit') }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ActionCard: German', () => {
  it('renders the card and the buttons in German', async () => {
    const { user, t } = setup({}, { locale: 'de' });
    expect(screen.getByRole('heading', { name: 'Wähle deine Geschenke' })).toBeTruthy();
    expect(screen.getByText(t('actions.windowOpen'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entwurf speichern' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abgeben' })).toBeTruthy();
    await user.click(box('Pikachu'));
    expect(screen.getByText('1 von 2 gewählt')).toBeTruthy();
  });
});
