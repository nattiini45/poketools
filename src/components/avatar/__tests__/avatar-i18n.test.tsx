/**
 * T18: the avatar panels render through the `avatar`, `avatar/wardrobe` and
 * `avatar/ai-choices` namespaces. English stays verbatim; German follows the
 * viewer's locale. Errors are stored as objects and translated at render.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AI_CHOICE_CATEGORIES } from '@/lib/avatar/prompt-template';
import { getCategory } from '@/lib/avatar/manifest';
import { avatarAiChoicesMessages } from '@/i18n/messages/avatar/ai-choices';
import { renderWithI18n } from '@/test/i18n';
import AvatarCategoryPicker from '../AvatarCategoryPicker';
import ShowdownPicker from '../ShowdownPicker';
import PhotoTransformPanel from '../PhotoTransformPanel';
import AvatarBuilder from '../AvatarBuilder';
import {
  avatarErrorFromBody,
  avatarErrorFromCatch,
  avatarLocalError,
} from '../avatar-error';

describe('avatar/ai-choices messages cover AI_CHOICE_CATEGORIES', () => {
  const { en, de } = avatarAiChoicesMessages;

  it('every category and option has an English label equal to the prompt-template label', () => {
    for (const cat of AI_CHOICE_CATEGORIES) {
      expect(en.categories[cat.id]).toBe(cat.label);
      const options = en.options[cat.id] as Record<string, string>;
      for (const opt of cat.options) {
        expect(options[opt.id]).toBe(opt.label);
      }
      expect(Object.keys(options)).toEqual(cat.options.map((o) => o.id));
    }
    expect(Object.keys(en.categories)).toEqual(AI_CHOICE_CATEGORIES.map((c) => c.id));
  });

  it('has German labels', () => {
    expect(de.categories.hair_style).toBe('Frisur');
    expect(de.options.accessory.pokeball_cap).toBe('Pokéball-Kappe');
  });
});

describe('avatar error state', () => {
  it('keeps the API body, or nothing when it carries no message', () => {
    expect(avatarErrorFromBody({ success: false, error: 'Rate limited', code: 'rate_limited' }, 'saveFailed')).toEqual({
      api: { error: 'Rate limited', code: 'rate_limited' },
      fallback: 'saveFailed',
    });
    expect(avatarErrorFromBody({ success: false }, 'saveFailed')).toEqual({ api: null, fallback: 'saveFailed' });
  });

  it('maps a failed fetch to the network_error code', () => {
    expect(avatarErrorFromCatch(new TypeError('Failed to fetch'), 'generateFailed')).toEqual({
      api: { code: 'network_error' },
      fallback: 'generateFailed',
    });
    expect(avatarLocalError('photoType')).toEqual({ api: null, fallback: 'photoType' });
  });
});

describe('AvatarCategoryPicker', () => {
  const hats = getCategory('male', 'hats');
  if (!hats) throw new Error('manifest has no hats category');

  it('renders the English labels verbatim', () => {
    const html = renderToStaticMarkup(
      <AvatarCategoryPicker gender="male" category={hats} selectedOptionId={null} onSelect={() => undefined} />,
    );
    expect(html).toContain('Hats &amp; Accessories');
    expect(html).toContain('(optional)');
    expect(html).toContain('>None<');
  });

  it('renders German labels under the de locale', () => {
    const html = renderWithI18n(
      <AvatarCategoryPicker gender="male" category={hats} selectedOptionId={null} onSelect={() => undefined} />,
      { locale: 'de' },
    );
    expect(html).toContain('Hüte &amp; Accessoires');
    expect(html).toContain('>Keins<');
    expect(html).not.toContain('Hats &amp; Accessories');
  });
});

describe('ShowdownPicker', () => {
  it('renders the search placeholder in German', () => {
    const html = renderWithI18n(<ShowdownPicker playerId="p1" />, { locale: 'de' });
    expect(html).toContain('placeholder="Trainer suchen …"');
  });

  it('keeps the English placeholder', () => {
    expect(renderWithI18n(<ShowdownPicker playerId="p1" />)).toContain('placeholder="Search trainers..."');
  });
});

describe('PhotoTransformPanel', () => {
  it('renders the steps and the daily limit in German', () => {
    const html = renderWithI18n(<PhotoTransformPanel playerId="p1" />, { locale: 'de' });
    expect(html).toContain('Foto hochladen');
    expect(html).toContain('So funktioniert’s');
    expect(html).toContain('10 Umwandlungen pro Tag');
  });

  it('keeps the English copy verbatim', () => {
    const html = renderWithI18n(<PhotoTransformPanel playerId="p1" />);
    expect(html).toContain('Upload Photo');
    expect(html).toContain('10 transforms per day');
  });
});

describe('AvatarBuilder', () => {
  it('renders the mode tabs and the layer tabs in German', () => {
    const html = renderWithI18n(<AvatarBuilder playerId="p1" />, { locale: 'de' });
    expect(html).toContain('Mit KI erstellen');
    expect(html).toContain('Avatar speichern');
    expect(html).toContain('Hautton');
  });

  it('keeps the English labels verbatim', () => {
    const html = renderWithI18n(<AvatarBuilder playerId="p1" />);
    expect(html).toContain('Generate with AI');
    expect(html).toContain('Save Avatar');
    expect(html).toContain('Skin Tone');
  });
});
