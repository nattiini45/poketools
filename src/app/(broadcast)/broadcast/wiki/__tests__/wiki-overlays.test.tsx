import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

// Wiki overlays have no league: no content-locale DB read may happen.
const { resolveContentLocale } = vi.hoisted(() => ({ resolveContentLocale: vi.fn() }));
vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: vi.fn(),
}));

import WikiMoveOverlay from '../moves/[name]/page';
import WikiAbilityOverlay from '../abilities/[name]/page';
import WikiItemOverlay from '../items/[name]/page';
import WikiTeraOverlay from '../tera/[type]/page';

type Sp = Record<string, string | string[] | undefined>;
const props = <K extends string>(key: K, value: string, sp: Sp) => ({
  params: Promise.resolve({ [key]: value } as Record<K, string>),
  searchParams: Promise.resolve(sp),
});

async function html(el: Promise<ReactElement | undefined> | ReactElement | undefined): Promise<string> {
  const node = await el;
  if (!node) throw new Error('page rendered nothing');
  return renderToStaticMarkup(node);
}

describe('broadcast wiki overlays (T14)', () => {
  it('move: German name, labels, percent and game description by default', async () => {
    const out = await html(WikiMoveOverlay(props('name', 'Flamethrower', {})));
    expect(out).toContain('lang="de"');
    expect(out).toContain('Flammenwurf');
    expect(out).toContain('Stärke');
    expect(out).toContain('Genauigkeit');
    expect(out).toContain('AP');
    expect(out).toMatch(/100\s%/);
    expect(out).toContain('Starke Feuer-Attacke');
    expect(resolveContentLocale).not.toHaveBeenCalled();
  });

  it('move: ?lang=en keeps the English text', async () => {
    const out = await html(WikiMoveOverlay(props('name', 'Flamethrower', { lang: 'en' })));
    expect(out).toContain('lang="en"');
    expect(out).toContain('Flamethrower');
    expect(out).toContain('Power');
    expect(out).toContain('Accuracy');
    expect(out).toContain('100%');
  });

  it('ability and item: German names and descriptions', async () => {
    const ability = await html(WikiAbilityOverlay(props('name', 'Intimidate', {})));
    expect(ability).toContain('Bedroher');
    expect(ability).toContain('einschüchtert');
    const item = await html(WikiItemOverlay(props('name', 'Leftovers', {})));
    expect(item).toContain('Überreste');
    expect(item).toContain('alt="Überreste"');
  });

  it('tera: label and type badge follow the overlay language', async () => {
    const de = await html(WikiTeraOverlay(props('type', 'fire', {})));
    expect(de).toContain('Tera-Typ');
    expect(de).toContain('Feuer');
    const en = await html(WikiTeraOverlay(props('type', 'fire', { lang: 'en' })));
    expect(en).toContain('Tera Type');
    expect(en).toContain('Fire');
  });
});
