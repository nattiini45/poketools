/**
 * CollapsibleSection: a collapsed body is unmounted by default (heavy sections
 * fetch nothing until opened); with `keepMounted` it stays in the tree behind
 * `hidden`, so collapse/expand only flips that attribute and the body's client
 * state (a checkbox mid-save, an unsaved draft) survives. Static markup, node env.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CollapsibleSection from '../CollapsibleSection';
import Section from '../Section';

const BODY = '<p data-body="1">Body</p>';
const body = <p data-body="1">Body</p>;

/** The markup with the toggle's open/closed bits and the generated ids removed. */
function withoutToggleState(html: string): string {
  return html
    .replace(/ hidden=""/g, '')
    .replace(/aria-expanded="(true|false)"/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/ (id|aria-controls)="[^"]*"/g, '');
}

describe('CollapsibleSection', () => {
  it('unmounts a collapsed body by default', () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection title="Heavy" defaultCollapsed>
        {body}
      </CollapsibleSection>,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(BODY);
  });

  it('keepMounted: a collapsed body stays mounted but hidden', () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection title="Settings" defaultCollapsed keepMounted>
        {body}
      </CollapsibleSection>,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<div id="[^"]+" hidden=""><div class="p-5"><p data-body="1">Body<\/p><\/div><\/div>/);
  });

  it('keepMounted: an open body is shown, and the toggle points at it', () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection title="Settings" keepMounted>
        {body}
      </CollapsibleSection>,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(BODY);
    expect(html).not.toContain('hidden=""');
    const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<div id="${controls}">`);
  });

  it('keepMounted: collapse and expand render the same body element, only `hidden` differs', () => {
    const open = renderToStaticMarkup(
      <CollapsibleSection title="Settings" keepMounted>
        {body}
      </CollapsibleSection>,
    );
    const collapsed = renderToStaticMarkup(
      <CollapsibleSection title="Settings" defaultCollapsed keepMounted>
        {body}
      </CollapsibleSection>,
    );
    expect(collapsed).not.toBe(open);
    expect(withoutToggleState(collapsed)).toBe(withoutToggleState(open));
  });

  it('Section passes keepMounted through to the collapsible section', () => {
    const html = renderToStaticMarkup(
      <Section title="Settings" collapsible defaultCollapsed keepMounted>
        {body}
      </Section>,
    );
    expect(html).toContain('hidden=""');
    expect(html).toContain(BODY);
  });
});
