import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BoOverrideEditor from '../BoOverrideEditor';

/** The option values of every select, in order. */
function selectOptions(html: string): number[][] {
  return [...html.matchAll(/<select[^>]*>(.*?)<\/select>/gs)].map((select) =>
    [...select[1].matchAll(/<option value="(\d+)"/g)].map((option) => Number(option[1])),
  );
}

describe('BoOverrideEditor', () => {
  it('offers the odd values up to 15 minus the default, after the "default" entry', () => {
    const html = renderToStaticMarkup(
      <BoOverrideEditor bracketType="single_elim" defaultBo={3} overrides={{}} onChange={() => {}} />,
    );
    const selects = selectOptions(html);
    expect(selects).toHaveLength(3);
    for (const options of selects) expect(options).toEqual([0, 1, 5, 7, 9, 11, 13, 15]);
  });

  it('still lists a stored even override so it is not silently replaced', () => {
    const html = renderToStaticMarkup(
      <BoOverrideEditor bracketType="single_elim" defaultBo={3} overrides={{ Finals: 4 }} onChange={() => {}} />,
    );
    const selects = selectOptions(html);
    // Quarterfinals, Semifinals, Finals: the stored 4 is listed on Finals only.
    expect(selects[2]).toEqual([0, 1, 4, 5, 7, 9, 11, 13, 15]);
    expect(selects[0]).toEqual([0, 1, 5, 7, 9, 11, 13, 15]);
    expect(html).toMatch(/<option value="4" selected="">Bo4<\/option>/);
  });

  it('renders nothing for bracket types without named rounds', () => {
    expect(
      renderToStaticMarkup(<BoOverrideEditor bracketType="swiss" defaultBo={3} overrides={{}} onChange={() => {}} />),
    ).toBe('');
  });
});

describe('BoOverrideEditor labels', () => {
  it('names every select by its round', () => {
    const html = renderToStaticMarkup(
      <BoOverrideEditor bracketType="single_elim" defaultBo={3} overrides={{}} onChange={() => {}} />,
    );
    const ids = [...html.matchAll(/<select[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    const labelled = ids.map((id) => html.match(new RegExp(`<label[^>]*for="${id.replace(/:/g, '\:')}"[^>]*>([^<]*)</label>`))?.[1]);
    expect(labelled).toEqual(['Quarterfinals', 'Semifinals', 'Finals']);
  });
});
