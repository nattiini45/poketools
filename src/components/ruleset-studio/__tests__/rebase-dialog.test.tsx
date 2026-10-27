/**
 * The "switch the base" dialog of the ruleset editor: what it tells the author BEFORE anything is applied. Static markup with
 * the Modal replaced by a plain section (the real one renders its content in a portal); the preset rules come from the real
 * dex-only resolver. The rewrite itself (`rebase`) is covered by the ruleset-kit ops tests; here the dialog's words and states.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { resolvePresetRules } from '@/lib/pkmn/preset-rules.server';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { createTranslator } from '@/i18n/core';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { renderWithI18n } from '@/test/i18n';

vi.mock('@/components/ui/Modal', () => ({
  default: ({ open, title, children }: { open: boolean; title?: string; children: ReactNode }) =>
    open ? <section role="dialog" aria-label={title}>{children}</section> : null,
}));

import RebaseDialog, { BLANK_TARGET } from '../sections/RebaseDialog';

const OU = resolvePresetRules('gen9ou');
const doc = newRulesetDocument('Spring OU', 'en', 'gen9ou');

function render(target: string | null, over: Partial<React.ComponentProps<typeof RebaseDialog>> = {}, locale: 'en' | 'de' = 'en') {
  return renderWithI18n(
    <RebaseDialog target={target} doc={doc} fromPreset={OU} loadPreset={async () => null} onApply={vi.fn()} onClose={vi.fn()} {...over} />,
    { locale },
  );
}

describe('RebaseDialog', () => {
  it('renders nothing while no switch is asked for', () => {
    expect(render(null)).toBe('');
  });

  it('a preset target shows the dialog title with the preset name and a loading note until its rules arrive', () => {
    const html = render('gen9ubers');
    expect(html).toContain('aria-label="Switch to Gen 9 Ubers"');
    expect(html).toContain('Your ruleset keeps enforcing what it enforces today.');
    expect(html).toContain('Loading the preset…');
    // Nothing can be applied before the plan exists.
    expect(/<button[^>]*>Switch to Gen 9 Ubers<\/button>/.exec(html)?.[0]).toContain(' disabled=""');
    expect(html).not.toContain('What changes in the rules');
  });

  it('switching to a blank base keeps today’s rules: the plan is ready at once and lists what the author would see', () => {
    const html = render(BLANK_TARGET);
    expect(html).toContain('What changes in the rules');
    expect(html).toContain('The rules stay exactly the same.');
    expect(html).toContain('Keep the rules as they are');
    expect(/<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0]).toContain('checked');
    // Ready: the apply button is enabled.
    const blank = createTranslator(rulesetStudioSectionsMessages, 'en')('base.blankHeading');
    expect(new RegExp(`<button[^>]*>Switch to ${blank}</button>`).exec(html)?.[0]).not.toContain(' disabled=""');
  });

  it('speaks German', () => {
    const html = render(BLANK_TARGET, {}, 'de');
    expect(html).toContain('Dein Regelwerk setzt weiter durch, was es heute durchsetzt.');
    expect(html).toContain('Was sich an den Regeln ändert');
    expect(html).toContain('Abbrechen');
  });
});
