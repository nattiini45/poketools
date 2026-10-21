import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GroupPoolPicker from '../GroupPoolPicker';

const LABELS = { nav: 'Draft groups', mine: 'your group', showing: 'Showing the draft of Group B.' };
const OPTIONS = [
  { groupId: 'a', label: 'Group A', href: '/leagues/s1/draft-room?pool=pa', current: false, mine: false },
  { groupId: 'b', label: 'Group B', href: '/leagues/s1/draft-room?pool=pb', current: true, mine: true },
];

describe('GroupPoolPicker', () => {
  it('a labelled nav with one link per group; the shown one is aria-current, the viewer’s marked', () => {
    const html = renderToStaticMarkup(<GroupPoolPicker options={OPTIONS} labels={LABELS} />);
    expect(html).toContain('<nav aria-label="Draft groups"');
    expect(html).toContain('href="/leagues/s1/draft-room?pool=pa"');
    expect(html).toMatch(/aria-current="page"[^>]*>Group B/);
    expect(html).toContain('your group');
    expect(html).toContain('Showing the draft of Group B.');
  });

  it('44px targets, token colours with palette fallbacks, motion only when allowed, no red and no violet', () => {
    const html = renderToStaticMarkup(<GroupPoolPicker options={OPTIONS} labels={LABELS} />);
    expect(html).toContain('min-h-11');
    expect(html).toContain('var(--draft-border,var(--poke-border))');
    expect(html).toContain('motion-safe:transition-colors');
    expect(html).not.toMatch(/danger|#7C3AED|--draft-cta/i);
  });

  it('a read-only note for another group’s draft, announced as a note; absent otherwise', () => {
    const readOnly = 'You can follow this draft, but you pick only in your own group’s draft.';
    const html = renderToStaticMarkup(<GroupPoolPicker options={OPTIONS} labels={{ ...LABELS, readOnly }} />);
    expect(html).toMatch(new RegExp(`<p role="note"[^>]*>${readOnly}</p>`));
    expect(renderToStaticMarkup(<GroupPoolPicker options={OPTIONS} labels={LABELS} />)).not.toContain('role="note"');
  });

  it('renders nothing for a single group', () => {
    expect(renderToStaticMarkup(<GroupPoolPicker options={OPTIONS.slice(0, 1)} labels={LABELS} />)).toBe('');
  });
});
