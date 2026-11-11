/**
 * The top-bar save badges: `warned` ("saved, rules not met") and `unchecked` ("saved, rules could not be checked") show
 * only while nothing newer than the saved team is in the editor, and they are translated.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import SaveStatusChips from '../SaveStatusChips';

const render = (saveStatus: Parameters<typeof SaveStatusChips>[0]['saveStatus'], dirty = false, locked = false, locale: 'en' | 'de' = 'en') =>
  renderWithI18n(<SaveStatusChips saveStatus={saveStatus} dirty={dirty} locked={locked} />, { locale });

describe('SaveStatusChips', () => {
  it('shows the amber "rules not met" chip for a warned save', () => {
    const html = render('warned');
    expect(html).toContain('Saved, rules not met');
    // The documented warning pairing: the accent ink on the accent wash (a skewed plate), never a static amber shade.
    expect(html).toContain('text-accent-ink');
    expect(html).toContain('bg-accent-subtle');
    expect(html).not.toContain('amber-');
    expect(html).not.toContain('Saved</span>');
  });

  it('shows the neutral "unchecked" chip for an unchecked save', () => {
    const html = render('unchecked');
    expect(html).toContain('Saved, rules could not be checked');
    expect(html).not.toContain('accent');
  });

  it('hides both advisory chips while the editor is dirty and shows "unsaved" instead', () => {
    for (const status of ['warned', 'unchecked'] as const) {
      const html = render(status, true);
      expect(html).not.toContain('Saved, rules');
      expect(html).toContain('Unsaved');
    }
  });

  it('keeps the plain saved chip for a clean save and shows nothing when idle', () => {
    expect(render('saved')).toContain('>Saved<');
    expect(render('saved')).not.toContain('rules');
    expect(render('idle')).not.toContain('Saved');
  });

  it('is translated', () => {
    expect(render('warned', false, false, 'de')).toContain('Gespeichert, Regeln nicht erfüllt');
    expect(render('unchecked', false, false, 'de')).toContain('Gespeichert, Regeln konnten nicht geprüft werden');
  });

  it('announces the advisory chips through one always-mounted live region', () => {
    const region = (html: string) => /<span[^>]*role="status"[^>]*>([^<]*)<\/span>/.exec(html);
    // The region exists before the status flips, empty, so the later text is announced; the chips carry no role.
    for (const status of ['idle', 'saving', 'saved', 'error'] as const) expect(region(render(status))?.[1]).toBe('');
    expect(region(render('warned'))?.[1]).toBe('Saved, rules not met');
    expect(region(render('unchecked'))?.[1]).toBe('Saved, rules could not be checked');
    expect(region(render('warned', true))?.[1]).toBe('');
    expect(render('warned').match(/role="status"/g)).toHaveLength(1);
    expect(region(render('warned', false, false, 'de'))?.[1]).toBe('Gespeichert, Regeln nicht erfüllt');
  });
});
