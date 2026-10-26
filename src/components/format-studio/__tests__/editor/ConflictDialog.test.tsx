/**
 * The "changed elsewhere" dialog body (static markup): the revision in the message, the three choices, the second
 * step that says a reload discards unsaved changes, and a failed reload.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { ConflictDialogBody } from '../../editor/dialogs/ConflictDialog';
import { expectNoLeftovers } from './test-helpers';

function render(over: { dirty?: boolean; step?: 'choose' | 'confirmReload'; busy?: boolean; error?: ApiErrorLike | null; locale?: Locale } = {}) {
  return renderWithI18n(
    <ConflictDialogBody
      serverRev={7}
      dirty={over.dirty ?? true}
      step={over.step ?? 'choose'}
      busy={over.busy ?? false}
      error={over.error ?? null}
      onReload={() => undefined}
      onConfirmReload={() => undefined}
      onKeepMine={() => undefined}
      onCancel={() => undefined}
    />,
    { locale: over.locale ?? 'en' },
  );
}

describe('ConflictDialogBody', () => {
  it('names the saved revision and offers Reload, Keep mine and Cancel', () => {
    const html = render();
    expect(html).toContain('This format was changed elsewhere (saved revision 7).');
    for (const label of ['Reload', 'Keep mine', 'Cancel']) expect(html).toContain(`>${label}<`);
    expect(html).not.toContain('Reloading discards');
    expectNoLeftovers(html);
  });

  it('the first button after Cancel is Reload, so it can take focus when the dialog opens', () => {
    const html = render();
    expect(html.indexOf('>Reload<')).toBeGreaterThan(html.indexOf('>Cancel<'));
    expect(html.indexOf('>Reload<')).toBeLessThan(html.indexOf('>Keep mine<'));
  });

  it('with unsaved changes the second step says they are discarded and drops Keep mine', () => {
    const html = render({ dirty: true, step: 'confirmReload' });
    expect(html).toContain('Reloading discards your unsaved changes.');
    expect(html).toContain('Reload and discard my changes');
    expect(html).not.toContain('>Keep mine<');
  });

  it('without unsaved changes the second step does not exist', () => {
    const html = render({ dirty: false, step: 'confirmReload' });
    expect(html).not.toContain('Reloading discards');
    expect(html).toContain('>Reload<');
    expect(html).toContain('>Keep mine<');
  });

  it('a failed reload shows its message in an alert', () => {
    const html = render({ error: { code: 'network_error' } });
    expect(html).toContain('role="alert"');
  });

  it('is in German for a German viewer', () => {
    const html = render({ locale: 'de' });
    expect(html).toContain('anderswo geändert');
    expect(html).toContain('Revision 7');
    expect(html).toContain('>Neu laden<');
    expect(html).toContain('>Meine behalten<');
    expect(html).toContain('>Abbrechen<');
    expect(render({ locale: 'de', step: 'confirmReload' })).toContain('gehen deine ungespeicherten Änderungen verloren');
  });

  it('Cancel is disabled while a reload runs', () => {
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled=""[^>]*>Cancel</);
  });
});
