/**
 * The wiki entry pages in both languages: German names from the pkmn layer, the German game text from
 * `descriptions.server.ts` (swapped in after the locale-neutral memo), and the "EN" tag when no German text
 * exists. "Keep Pokémon terms in English" (data locale 'en' with a German UI) keeps the names English only.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { getWikiAbilityDetail, getWikiItemDetail, getWikiMoveDetail } from '@/lib/wiki/index-rows.server';
import { localizeWikiEntry } from '@/lib/wiki/localize-entry.server';
import WikiAbilityContent from '../WikiAbilityContent';
import WikiItemContent from '../WikiItemContent';
import WikiMoveContent from '../WikiMoveContent';
import WikiNotesSection from '../WikiNotesSection';

function earthquake() {
  const move = getWikiMoveDetail('Earthquake');
  if (!move) throw new Error('Earthquake missing from @pkmn/data');
  return move;
}

describe('WikiMoveContent', () => {
  it('renders the English entry unchanged in English', () => {
    const { entry, descFallback } = localizeWikiEntry('move', earthquake(), 'en');
    const html = renderToStaticMarkup(
      <WikiMoveContent move={entry} locale="en" dataLocale="en" descFallback={descFallback} />,
    );
    expect(html).toContain('Earthquake');
    expect(html).toContain('Base Power');
    expect(html).toContain('Introduced in Generation 1');
    expect(html).toContain('100%');
    expect(descFallback).toBe(false);
  });

  it('renders German names, labels and the German game text in German', () => {
    const { entry, descFallback } = localizeWikiEntry('move', earthquake(), 'de');
    const html = renderWithI18n(
      <WikiMoveContent move={entry} locale="de" dataLocale="de" descFallback={descFallback} />,
      { locale: 'de' },
    );
    expect(html).toContain('Erdbeben');
    expect(html).toContain('Boden');
    expect(html).toContain('Stärke');
    expect(html).toContain('Genauigkeit');
    expect(html).toContain('Eingeführt in Generation 1');
    expect(html).toMatch(/100\s%/); // de-DE: no-break space before the percent sign
    expect(entry.description).not.toBe(earthquake().description);
    expect(html).toContain(entry.description);
    // One German game text: no second "Summary" block.
    expect(html).not.toContain('Kurzfassung');
    expect(descFallback).toBe(false);
  });

  it('keeps Pokémon terms English with a German UI when the data locale is English', () => {
    const { entry } = localizeWikiEntry('move', earthquake(), 'de');
    const html = renderWithI18n(<WikiMoveContent move={entry} locale="de" dataLocale="en" />, {
      locale: 'de',
      dataLocale: 'en',
    });
    expect(html).toContain('Earthquake');
    expect(html).not.toContain('Erdbeben');
    expect(html).toContain('Stärke');
  });
});

describe('WikiItemContent / WikiAbilityContent', () => {
  it('renders German item and ability names in German', () => {
    const leftovers = getWikiItemDetail('Leftovers');
    const intimidate = getWikiAbilityDetail('Intimidate');
    if (!leftovers || !intimidate) throw new Error('fixture missing');
    const item = localizeWikiEntry('item', leftovers, 'de');
    const ability = localizeWikiEntry('ability', intimidate, 'de');
    const html = renderWithI18n(
      <>
        <WikiItemContent item={item.entry} locale="de" dataLocale="de" descFallback={item.descFallback} />
        <WikiAbilityContent ability={ability.entry} locale="de" dataLocale="de" descFallback={ability.descFallback} />
      </>,
      { locale: 'de' },
    );
    expect(html).toContain('Überreste');
    expect(html).toContain('Bedroher');
    expect(html).toContain('Beschreibung');
    expect(html).toContain('Eingeführt in Generation 3');
  });

  it('labels the competitive rating in German', () => {
    const intimidate = getWikiAbilityDetail('Intimidate');
    if (!intimidate) throw new Error('fixture missing');
    const html = renderWithI18n(
      <WikiAbilityContent ability={{ ...intimidate, rating: 3.5 }} locale="de" dataLocale="de" />,
      { locale: 'de' },
    );
    expect(html).toContain('Competitive-Wertung:');
    expect(html).toContain('3,5/5');
  });

  it('tags an English fallback description with "EN" in German', () => {
    const intimidate = getWikiAbilityDetail('Intimidate');
    if (!intimidate) throw new Error('fixture missing');
    const html = renderWithI18n(
      <WikiAbilityContent ability={intimidate} locale="de" dataLocale="de" descFallback />,
      { locale: 'de' },
    );
    // The German title stays outside the English span; only the tag text is lang="en".
    expect(html).toMatch(/<abbr title="[^"]+"[^>]*><span lang="en">EN<\/span><\/abbr>/);
    expect(html).not.toMatch(/<abbr[^>]*lang="en"/);
  });
});

describe('WikiNotesSection', () => {
  it('renders the sign-in prompt in English and German', () => {
    const props = { entityType: 'move', entityName: 'Earthquake', notes: [], unauthenticated: true } as const;
    expect(renderToStaticMarkup(<WikiNotesSection {...props} notes={[]} />)).toContain(
      'Sign in with Discord to read and submit community notes.',
    );
    const de = renderWithI18n(<WikiNotesSection {...props} notes={[]} />, { locale: 'de' });
    expect(de).toContain('Community-Notizen');
    expect(de).toContain('Anmelden');
  });

  it('renders notes with a localized date and German report reasons', () => {
    const note = {
      id: 'n1',
      entity_type: 'move' as const,
      entity_name: 'Earthquake',
      author_id: 'p1',
      author_name: 'Ash',
      content: 'Great spread move.',
      scope_type: 'global' as const,
      scope_id: null,
      approved: true,
      created_at: '2026-10-09T16:30:00Z',
      updated_at: '2026-10-09T16:30:00Z',
    };
    const html = renderWithI18n(<WikiNotesSection entityType="move" entityName="Earthquake" notes={[note]} />, {
      locale: 'de',
    });
    expect(html).toContain('Von Ash');
    expect(html).toContain('Okt');
    expect(html).toContain('Melden');
    expect(html).toContain('Notiz einreichen');
  });
});
