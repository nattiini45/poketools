import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Disclosure from '../Disclosure';

describe('Disclosure', () => {
  it('is a bordered native <details> whose <summary> is the heading', () => {
    const html = renderToStaticMarkup(<Disclosure summary="Heading">Body</Disclosure>);
    expect(html).toMatch(/^<details class="rounded-lg border border-\[var\(--draft-border\)\] p-2">/);
    expect(html).toMatch(/<summary class="[^"]*cursor-pointer[^"]*">Heading<\/summary>Body<\/details>$/);
  });

  it('is collapsed by default and opens with defaultOpen', () => {
    expect(renderToStaticMarkup(<Disclosure summary="H">B</Disclosure>)).not.toContain(' open');
    expect(renderToStaticMarkup(<Disclosure summary="H" defaultOpen>B</Disclosure>)).toContain(' open=""');
  });

  it('takes the parent’s state when controlled', () => {
    expect(renderToStaticMarkup(<Disclosure summary="H" open onOpenChange={() => {}}>B</Disclosure>)).toContain(' open=""');
    expect(renderToStaticMarkup(<Disclosure summary="H" open={false} onOpenChange={() => {}}>B</Disclosure>)).not.toContain(' open');
  });

  it('adds the caller’s classes after its own', () => {
    expect(renderToStaticMarkup(<Disclosure summary="H" className="mt-1.5">B</Disclosure>)).toContain('p-2 mt-1.5"');
  });
});
