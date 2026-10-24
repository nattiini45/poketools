/**
 * PageContainer: the title row wraps so a wide action group (New League, the
 * lifecycle trio) drops below the title on a phone instead of widening the
 * page. Static markup, node env. The match page action group is checked at
 * source level.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PageContainer from '../PageContainer';

const ACTION = <button type="button" data-action="1">Act</button>;

function classOf(html: string, marker: string): string[] {
  const tag = html.match(new RegExp(`<[a-z]+[^>]*${marker}[^>]*>`))?.[0] ?? '';
  const cls = tag.match(/class="([^"]*)"/)?.[1] ?? '';
  return cls.split(/\s+/).filter(Boolean);
}

/** Class list of the element that directly wraps the action button. */
function actionWrapperClasses(html: string): string[] {
  const m = html.match(/<div class="([^"]*)"><button[^>]*data-action/);
  return (m?.[1] ?? '').split(/\s+/).filter(Boolean);
}

describe('PageContainer title row', () => {
  it('wraps, and its action slot can shrink and wrap instead of pushing the page wider', () => {
    const html = renderToStaticMarkup(
      <PageContainer title="Leagues" action={ACTION}>
        <p>Body</p>
      </PageContainer>,
    );
    const row = html.match(/<div class="([^"]*flex-wrap[^"]*)"/)?.[1] ?? '';
    expect(row.split(/\s+/)).toEqual(
      expect.arrayContaining(['flex', 'flex-wrap', 'justify-between', 'gap-x-4', 'gap-y-3']),
    );
    const action = actionWrapperClasses(html);
    expect(action).toEqual(expect.arrayContaining(['max-w-full', 'min-w-0']));
    expect(action).not.toContain('shrink-0');
  });

  it('gives the title block the free space and keeps the action off the far edge rule', () => {
    const html = renderToStaticMarkup(
      <PageContainer title="Leagues" subtitle="All of them" action={ACTION}>
        <p>Body</p>
      </PageContainer>,
    );
    const block = html.match(/<div class="([^"]*basis-60[^"]*)"/)?.[1] ?? '';
    expect(block.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'flex-1', 'basis-60']));
    expect(actionWrapperClasses(html)).not.toContain('ml-auto');
    expect(html).toContain('All of them');
  });

  it('renders no title block for an action-only header and right-aligns the action', () => {
    const html = renderToStaticMarkup(
      <PageContainer action={ACTION}>
        <p>Body</p>
      </PageContainer>,
    );
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('basis-60');
    expect(actionWrapperClasses(html)).toContain('ml-auto');
  });

  it('renders no action wrapper for a title-only header', () => {
    const html = renderToStaticMarkup(
      <PageContainer title="Leagues">
        <p>Body</p>
      </PageContainer>,
    );
    expect(html).toContain('<h1');
    expect(html).toContain('Leagues');
    expect(html).not.toContain('max-w-full');
    expect(html).not.toContain('ml-auto');
    expect(classOf(html, 'aria-hidden="true"')).toContain('bg-poke-accent');
  });

  it('renders no header row without a title or action', () => {
    const html = renderToStaticMarkup(
      <PageContainer>
        <p>Body</p>
      </PageContainer>,
    );
    expect(html).not.toContain('flex-wrap');
    expect(html).toContain('Body');
  });

  it('keeps the width classes', () => {
    const wide = renderToStaticMarkup(<PageContainer>x</PageContainer>);
    const narrow = renderToStaticMarkup(<PageContainer maxWidth="md">x</PageContainer>);
    expect(wide).toContain('max-w-7xl');
    expect(narrow).toContain('max-w-4xl');
    expect(narrow).not.toContain('max-w-7xl');
  });
});

describe('Match page action group', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', '..', 'app', '(public)', 'tournaments', '[id]', 'matches', '[mid]', 'page.tsx'),
    'utf8',
  );

  it('wraps its admin buttons inside the PageContainer action slot', () => {
    const idx = source.indexOf('action={');
    expect(idx).toBeGreaterThan(-1);
    expect(source.slice(idx, idx + 120)).toContain('<div className="flex flex-wrap items-center gap-2">');
  });
});
