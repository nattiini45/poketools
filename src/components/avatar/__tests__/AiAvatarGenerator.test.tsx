import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AiAvatarGenerator, { GalleryThumb, galleryImageSrc } from '../AiAvatarGenerator';
import { renderWithI18n } from '@/test/i18n';

const ORIGINAL = 'https://proj.supabase.co/storage/v1/object/public/avatars/gallery/'
  + '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.png';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('galleryImageSrc', () => {
  it('uses the 256 px thumbnail stored next to the original', () => {
    expect(galleryImageSrc(ORIGINAL, false)).toBe(`${ORIGINAL}.thumb.webp`);
  });

  it('falls back to the original once the thumbnail failed to load', () => {
    expect(galleryImageSrc(ORIGINAL, true)).toBe(ORIGINAL);
  });

  it('keeps URLs outside the avatars bucket unchanged', () => {
    expect(galleryImageSrc('https://example.com/x.png', false)).toBe('https://example.com/x.png');
  });

  it('keeps URLs of another Supabase project or off the path whitelist unchanged', () => {
    const otherProject = ORIGINAL.replace('proj.supabase.co', 'other.supabase.co');
    expect(galleryImageSrc(otherProject, false)).toBe(otherProject);
    const offWhitelist = 'https://proj.supabase.co/storage/v1/object/public/avatars/gallery/p1/a.png';
    expect(galleryImageSrc(offWhitelist, false)).toBe(offWhitelist);
  });
});

describe('GalleryThumb', () => {
  it('renders the thumbnail, lazily and without the image optimizer', () => {
    const html = renderToStaticMarkup(<GalleryThumb imageUrl={ORIGINAL} alt="Previous generation" size={64} />);

    expect(html).toContain(`src="${ORIGINAL}.thumb.webp"`);
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('/_next/image');
  });
});

describe('AiAvatarGenerator (i18n)', () => {
  it('renders its English copy verbatim', () => {
    const html = renderWithI18n(<AiAvatarGenerator playerId="p1" />);
    expect(html).toContain('Pick your choices');
    expect(html).toContain('10 generations per day');
    expect(html).toContain('Art Style');
    expect(html).toContain('Trainer Style');
    expect(html).toContain('>Anime<');
  });

  it('renders German chrome and choice labels under the de locale', () => {
    const html = renderWithI18n(<AiAvatarGenerator playerId="p1" />, { locale: 'de' });
    expect(html).toContain('Triff deine Auswahl');
    expect(html).toContain('10 Erstellungen pro Tag');
    expect(html).toContain('Galerie wird geladen …');
    expect(html).toContain('>Stil<');
    expect(html).toContain('Trainer-Typ');
    expect(html).toContain('>Realistisch<');
    // The selected option of a collapsed category shows its German label.
    expect(html).toContain('>Junge<');
    expect(html).not.toContain('Pick your choices');
  });
});
