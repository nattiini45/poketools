/**
 * Helpers for component tests that read an HTML string: static markup, or `container.innerHTML` of a Testing Library render. They read the HTML string the way a screen reader's tree would:
 * every control needs a name, no template placeholder may be left in the text, every id is used once. Shared by the
 * Format Studio, the Ruleset Studio and the studio shell tests.
 */
import { expect } from 'vitest';

/** What React writes for a text child. */
export const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const CONTROL = /<(input|select|textarea)\b([^>]*)>/g;

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match === null ? null : match[1];
}

/** Every `input`, `select` and `textarea` has an `id` that a `label` points to, or an `aria-label` / `aria-labelledby`. */
export function expectLabelledControls(html: string): void {
  const labelled = new Set([...html.matchAll(/<label\b[^>]*\sfor="([^"]*)"/g)].map((m) => m[1]));
  const problems: string[] = [];
  for (const match of html.matchAll(CONTROL)) {
    const attrs = match[2];
    if (attribute(attrs, 'type') === 'hidden') continue;
    const id = attribute(attrs, 'id');
    const named = attribute(attrs, 'aria-label') !== null || attribute(attrs, 'aria-labelledby') !== null;
    if (!named && (id === null || !labelled.has(id))) problems.push(match[0]);
  }
  expect(problems).toEqual([]);
}

/**
 * The text of some markup: each `<style>` block replaced by a space, each tag by `separator`. Repeats until
 * nothing is left to strip (the loop is the shape CodeQL expects for multi-character stripping).
 */
export function stripMarkup(html: string, separator = ''): string {
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, separator);
  } while (text !== previous);
  return text;
}

/** No `undefined`, no `[object Object]`, no `{placeholder}` of a template that was not filled. */
export function expectNoLeftovers(html: string): void {
  expect(stripMarkup(html, ' ')).not.toMatch(/undefined|\[object|\{[a-z_]+\}/);
}

/** Every element id in the markup is used once. */
export function expectUniqueIds(html: string): void {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  expect(duplicates).toEqual([]);
}
