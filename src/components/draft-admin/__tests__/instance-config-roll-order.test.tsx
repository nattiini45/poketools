/** @vitest-environment jsdom */
/**
 * "Roll order" in a DOM: a roll replaces the seats on the server and the form then takes the server's order, so it must
 * not run while the admin holds hand edits that are not saved (they would vanish). The button waits, with a hint that
 * says why, and is available again once the order is saved or moved back. Both languages.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { toDraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';
import InstanceConfigForm from '../InstanceConfigForm';

function open(locale: Locale) {
  const dto = snapshot({ pool: { ...snapshot().pool, kind: 'initial', phase: 'setup', status: 'pending' } });
  const onRollOrder = vi.fn(async () => null);
  render(
    withI18n(
      <InstanceConfigForm
        vm={toDraftViewModel(dto)}
        dto={dto}
        onSaveConfig={vi.fn(async () => null)}
        onPatchRedraft={vi.fn(async () => null)}
        onRollOrder={onRollOrder}
      />,
      { locale },
    ),
  );
  return { onRollOrder, user: userEvent.setup(), t: createTranslator(draftAdminMessages, locale) };
}

describe('InstanceConfigForm: Roll order and unsaved seat edits', () => {
  it.each(['en', 'de'] as const)('is disabled with a hint while the seat order differs from the saved one, and back after moving it back (%s)', async (locale) => {
    const { onRollOrder, user, t } = open(locale);
    const roll = () => screen.getByRole('button', { name: t('config.rollOrder') }) as HTMLButtonElement;
    expect(roll().disabled).toBe(false);
    expect(screen.getByText(t('config.rollOrderHint'))).toBeTruthy();

    await user.click(screen.getByRole('button', { name: t('config.moveDown', { name: 'Dawn' }) }));
    expect(roll().disabled).toBe(true);
    expect(screen.getByText(t('config.rollOrderUnsaved'))).toBeTruthy();
    await user.click(roll());
    expect(onRollOrder).not.toHaveBeenCalled();

    // Moving the player back makes the local order equal the saved one again.
    await user.click(screen.getByRole('button', { name: t('config.moveUp', { name: 'Dawn' }) }));
    expect(roll().disabled).toBe(false);
    await user.click(roll());
    expect(onRollOrder).toHaveBeenCalledTimes(1);
  });

  it('the hint text exists in both languages and differs from the plain hint', () => {
    for (const locale of ['en', 'de'] as const) {
      const t = createTranslator(draftAdminMessages, locale);
      expect(t('config.rollOrderUnsaved')).not.toBe(t('config.rollOrderHint'));
    }
  });
});
