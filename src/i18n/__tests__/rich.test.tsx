import { describe, expect, it } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderRich } from '../rich';
import { createTranslator } from '../core';
import { defineDe, defineNamespace } from '../define';

const html = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);

describe('renderRich', () => {
  it('renders tags through their renderers', () => {
    const out = renderRich('Read the <link>rules</link> first', {
      link: (c: ReactNode) => <a href="/rules">{c}</a>,
    });
    expect(html(out)).toBe('Read the <a href="/rules">rules</a> first');
  });

  it('supports nesting and placeholders inside tags', () => {
    const out = renderRich('<b>Hi <i>{name}</i></b>!', {
      b: (c: ReactNode) => <strong>{c}</strong>,
      i: (c: ReactNode) => <em>{c}</em>,
      name: 'Ash',
    });
    expect(html(out)).toBe('<strong>Hi <em>Ash</em></strong>!');
  });

  it('renders an unknown tag as plain text children', () => {
    expect(html(renderRich('A <mystery>secret</mystery> B', {}))).toBe('A secret B');
  });

  it('gives sibling nodes stable keys', () => {
    const out = renderRich('<b>x</b> and <b>y</b>', { b: (c: ReactNode) => <b>{c}</b> });
    expect(Array.isArray(out)).toBe(true);
    const keys = (out as ReactNode[]).map((node) => (isValidElement(node) ? node.key : null));
    expect(keys).toEqual(['0', '1', '2']);
    const again = renderRich('<b>x</b> and <b>y</b>', { b: (c: ReactNode) => <b>{c}</b> }) as ReactNode[];
    expect(again.map((node) => (isValidElement(node) ? node.key : null))).toEqual(keys);
  });

  it('escapes markup in params (no HTML injection)', () => {
    const out = renderRich('Hello {name}', { name: '<script>alert(1)</script>' });
    const markup = html(out);
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;');
  });

  it('accepts ReactNode params and formats numbers per locale', () => {
    expect(html(renderRich('By {who}', { who: <em>Misty</em> }))).toBe('By <em>Misty</em>');
    expect(html(renderRich('{n} P', { n: 12345.5 }, 'de'))).toBe('12.345,5 P');
  });
});

describe('Translator.rich', () => {
  const en = {
    hint: 'Open the <link>draft room</link>',
    picks: { one: '<b>{count}</b> pick left', other: '<b>{count}</b> picks left' },
  } as const;
  const de = defineDe<typeof en>()({
    hint: 'Öffne den <link>Draft-Raum</link>',
    picks: { one: 'Noch <b>{count}</b> Pick', other: 'Noch <b>{count}</b> Picks' },
  });
  const ns = defineNamespace('test/rich', en, de);

  it('renders tags and plurals', () => {
    const t = createTranslator(ns, 'de');
    expect(html(t.rich('hint', { link: (c) => <a href="/x">{c}</a> }))).toBe('Öffne den <a href="/x">Draft-Raum</a>');
    expect(html(t.rich('picks', { count: 2, b: (c) => <b>{c}</b> }))).toBe('Noch <b>2</b> Picks');
  });
});
