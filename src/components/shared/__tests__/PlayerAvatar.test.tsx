import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import PlayerAvatar, { pickAvatarSrc } from '../PlayerAvatar';

const THUMB = 'https://proj.supabase.co/storage/v1/object/public/avatars/gallery/p1/a.png.thumb.webp';
const DISCORD = 'https://cdn.discordapp.com/avatars/1/abc.png';

describe('pickAvatarSrc', () => {
  it('prefers the custom avatar, then Discord', () => {
    expect(pickAvatarSrc([THUMB, DISCORD], [])).toBe(THUMB);
    expect(pickAvatarSrc([null, DISCORD], [])).toBe(DISCORD);
  });

  it('skips sources that failed to load', () => {
    expect(pickAvatarSrc([THUMB, DISCORD], [THUMB])).toBe(DISCORD);
    expect(pickAvatarSrc([THUMB, DISCORD], [THUMB, DISCORD])).toBeNull();
  });

  it('returns null when nothing is set (initials fallback)', () => {
    expect(pickAvatarSrc([undefined, null, ''], [])).toBeNull();
  });
});

describe('PlayerAvatar', () => {
  it('serves the custom thumbnail as-is, bypassing the image optimizer', () => {
    const html = renderToStaticMarkup(<PlayerAvatar avatarUrl={THUMB} name="Ash Ketchum" size={32} />);

    expect(html).toContain(`src="${THUMB}"`);
    expect(html).not.toContain('/_next/image');
    expect(html).toContain('width="32"');
  });

  it('renders initials when there is no image', () => {
    const html = renderToStaticMarkup(<PlayerAvatar name="Ash Ketchum" size={40} />);

    expect(html).toContain('>AK<');
    expect(html).not.toContain('<img');
  });

  it('names the avatar in the viewer language', () => {
    expect(renderWithI18n(<PlayerAvatar name="Ash Ketchum" size={40} />)).toContain(
      'aria-label="Ash Ketchum&#x27;s avatar"',
    );
    const de = renderWithI18n(<PlayerAvatar avatarUrl={THUMB} name="Ash Ketchum" size={32} />, { locale: 'de' });
    expect(de).toContain('alt="Avatar von Ash Ketchum"');
  });
});
