/**
 * Combobox's empty state follows `minQueryLength`: an async picker that
 * searches from one character also says "no results" for one character, and
 * the default (two characters) is unchanged. A whitespace-only query is no
 * query. The label names the input, and an unavailable option is
 * `aria-disabled` and skipped by the arrow keys. Node + static markup (no DOM):
 * the `react` mock seeds the open / typed / options state of the first render,
 * which a click and a keystroke would otherwise produce.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

const seed = vi.hoisted(() => ({
  query: '',
  open: false,
  falseSeen: 0,
  options: [] as { label: string; value: string; disabled?: boolean }[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = <T,>(initial: T | (() => T)) => {
    // Combobox's state, in declaration order: query (''), options ([]), open (false), loading (false).
    if (initial === '') return actual.useState(seed.query as T);
    if (Array.isArray(initial) && initial.length === 0) return actual.useState(seed.options as T);
    if (initial === false) return actual.useState((seed.falseSeen++ === 0 ? seed.open : false) as T);
    return actual.useState(initial);
  };
  return { ...actual, default: { ...actual, useState }, useState };
});

const { default: Combobox, asyncSearchTerm, nextEnabledIndex, pickOption, splitHighlight } = await import('../Combobox');

function render(props: { minQueryLength?: number; label?: string; placeholder?: string }, locale: 'en' | 'de' = 'en') {
  seed.falseSeen = 0;
  return renderWithI18n(
    <Combobox
      mode="async"
      fetchUrl="/api/search?q={q}"
      transformResults={() => []}
      minQueryLength={props.minQueryLength}
      label={props.label}
      placeholder={props.placeholder}
      value=""
      onChange={() => {}}
    />,
    { locale },
  );
}

beforeEach(() => {
  seed.query = '';
  seed.open = true;
  seed.falseSeen = 0;
  seed.options = [];
});

describe('Combobox empty state', () => {
  it('reports no results for a one-character query when the picker searches from one character', () => {
    seed.query = 'x';
    expect(render({ minQueryLength: 1 })).toContain('No results for “x”');
  });

  it('keeps quiet for a one-character query under the default minimum of two', () => {
    seed.query = 'x';
    expect(render({})).not.toContain('No results');
  });

  it('reports no results from the default minimum on', () => {
    seed.query = 'xy';
    expect(render({})).toContain('No results for “xy”');
  });

  it('keeps quiet below a raised minimum', () => {
    seed.query = 'xy';
    expect(render({ minQueryLength: 3 })).not.toContain('No results');
    seed.query = 'xyz';
    expect(render({ minQueryLength: 3 })).toContain('No results for “xyz”');
  });

  it('reports no results in German', () => {
    seed.query = 'x';
    expect(render({ minQueryLength: 1 }, 'de')).toContain('Keine Ergebnisse');
  });

  it('shows nothing while the dropdown is closed', () => {
    seed.query = 'x';
    seed.open = false;
    expect(render({ minQueryLength: 1 })).not.toContain('No results');
  });
});

describe('Combobox blank query', () => {
  it('searches nothing for a blank or too-short query and trims the term it does search', () => {
    expect(asyncSearchTerm(' ', 1)).toBeNull();
    expect(asyncSearchTerm('   ', 1)).toBeNull();
    expect(asyncSearchTerm('a', 1)).toBe('a');
    expect(asyncSearchTerm(' a ', 1)).toBe('a');
    expect(asyncSearchTerm(' a ', 2)).toBeNull();
    expect(asyncSearchTerm('ab', 2)).toBe('ab');
  });

  it('shows no hint for a space', () => {
    seed.query = ' ';
    expect(render({ minQueryLength: 1 })).not.toContain('No results');
  });

  it('still reports no results for a real one-character query', () => {
    seed.query = 'a';
    expect(render({ minQueryLength: 1 })).toContain('No results for “a”');
  });
});

describe('Combobox accessibility', () => {
  it('ties the label to the input', () => {
    const html = render({ label: 'Replacement' });
    const forId = /<label[^>]*for="([^"]+)"/.exec(html)?.[1];
    expect(forId).toBeTruthy();
    expect(html).toContain(`id="${forId}"`);
    expect(html).not.toContain('aria-label=');
  });

  it('names a label-less input after its placeholder', () => {
    const html = render({ placeholder: 'Search players…' });
    expect(html).toContain('aria-label="Search players…"');
  });

  it('marks an unavailable option aria-disabled and leaves the others alone', () => {
    seed.options = [
      { label: 'Ash', value: 'a', disabled: true },
      { label: 'Misty', value: 'm' },
    ];
    const html = render({ minQueryLength: 1 });
    const items = html.match(/<li[^>]*role="option"[^>]*>/g) ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('aria-disabled="true"');
    expect(items[1]).not.toContain('aria-disabled');
  });
});

describe('nextEnabledIndex', () => {
  const options = [{ label: 'a', value: 'a', disabled: true }, { label: 'b', value: 'b' }, { label: 'c', value: 'c', disabled: true }, { label: 'd', value: 'd' }];

  it('steps over unavailable options in both directions', () => {
    expect(nextEnabledIndex(options, -1, 1)).toBe(1);
    expect(nextEnabledIndex(options, 1, 1)).toBe(3);
    expect(nextEnabledIndex(options, 3, -1)).toBe(1);
  });

  it('stays put at the ends and when nothing else is pickable', () => {
    expect(nextEnabledIndex(options, 3, 1)).toBe(3);
    expect(nextEnabledIndex(options, 1, -1)).toBe(1);
    expect(nextEnabledIndex([{ label: 'a', value: 'a', disabled: true }], -1, 1)).toBe(-1);
  });
});

describe('pickOption', () => {
  it('calls onChange with the value of an enabled option and reports the pick', () => {
    const onChange = vi.fn();

    expect(pickOption({ label: 'Misty', value: 'm' }, onChange)).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('m');
  });

  it('does nothing for a disabled option, whether it is clicked or chosen with Enter', () => {
    const onChange = vi.fn();
    const option = { label: 'Ash', value: 'a', disabled: true };

    // Both paths (click and Enter) pick through this helper, so the guard is one place.
    expect(pickOption(option, onChange)).toBe(false);
    expect(pickOption(option, onChange)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('splitHighlight', () => {
  it('splits around the first case-insensitive match, keeping the text as written', () => {
    expect(splitHighlight('Ash Ketchum', 'ash')).toEqual({ before: '', match: 'Ash', after: ' Ketchum' });
    expect(splitHighlight('Ash Ketchum', 'KET')).toEqual({ before: 'Ash ', match: 'Ket', after: 'chum' });
  });

  it('finds nothing without a term or a match', () => {
    expect(splitHighlight('Ash', '')).toBeNull();
    expect(splitHighlight('Ash', 'misty')).toBeNull();
  });
});

describe('Combobox highlight', () => {
  const HIGHLIGHT = '<span class="font-bold text-poke-blue">Ash</span>';

  beforeEach(() => {
    seed.options = [{ label: 'Ash', value: 'a' }];
  });

  it.each(['ash', 'ash ', ' ash', ' ash '])('highlights the name for the async query %j (the search trims it)', (query) => {
    seed.query = query;
    expect(render({ minQueryLength: 1 })).toContain(HIGHLIGHT);
  });
});
