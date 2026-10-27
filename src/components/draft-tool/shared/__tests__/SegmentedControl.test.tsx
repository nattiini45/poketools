import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import SegmentedControl, { stepSegment, type SegmentedOption } from '../SegmentedControl';

const noop = () => {};
type Size = 'small' | 'medium' | 'large';
const three: readonly SegmentedOption<Size>[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

describe('stepSegment (keyboard contract)', () => {
  it('Right and Down go forward, Left and Up go back, both wrapping', () => {
    expect(stepSegment(three, 'small', 'ArrowRight')).toBe('medium');
    expect(stepSegment(three, 'small', 'ArrowDown')).toBe('medium');
    expect(stepSegment(three, 'large', 'ArrowRight')).toBe('small');
    expect(stepSegment(three, 'medium', 'ArrowLeft')).toBe('small');
    expect(stepSegment(three, 'medium', 'ArrowUp')).toBe('small');
    expect(stepSegment(three, 'small', 'ArrowLeft')).toBe('large');
  });

  it('Home and End jump to the first and last option', () => {
    expect(stepSegment(three, 'medium', 'Home')).toBe('small');
    expect(stepSegment(three, 'medium', 'End')).toBe('large');
  });

  it('two options toggle with every arrow', () => {
    const two = three.slice(0, 2);
    expect(stepSegment(two, 'small', 'ArrowRight')).toBe('medium');
    expect(stepSegment(two, 'small', 'ArrowLeft')).toBe('medium');
    expect(stepSegment(two, 'medium', 'ArrowDown')).toBe('small');
  });

  it('skips disabled options and ignores other keys', () => {
    const gap = three.map((o) => (o.value === 'medium' ? { ...o, disabled: true } : o));
    expect(stepSegment(gap, 'small', 'ArrowRight')).toBe('large');
    expect(stepSegment(gap, 'large', 'ArrowLeft')).toBe('small');
    expect(stepSegment(gap, 'small', 'End')).toBe('large');
    expect(stepSegment(three, 'small', 'Enter')).toBeNull();
    expect(stepSegment(three, 'small', 'a')).toBeNull();
    expect(stepSegment(three.map((o) => ({ ...o, disabled: true })), 'small', 'ArrowRight')).toBeNull();
  });

  it('starts from the matching end when the current value is not selectable', () => {
    const gap = three.map((o) => (o.value === 'medium' ? { ...o, disabled: true } : o));
    expect(stepSegment(gap, 'medium', 'ArrowRight')).toBe('small');
    expect(stepSegment(gap, 'medium', 'ArrowLeft')).toBe('large');
  });
});

describe('SegmentedControl markup', () => {
  const render = (props: Partial<Parameters<typeof SegmentedControl<Size>>[0]> = {}) =>
    renderWithI18n(<SegmentedControl<Size> value="medium" onChange={noop} options={three} ariaLabel="Size" {...props} />);

  it('is a named radiogroup with one radio per option and the selection checked', () => {
    const html = render();
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Size"');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true"[^>]*>Medium</);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });

  it('keeps one tab stop, on the selected option', () => {
    const html = render({ value: 'large' });
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true" tabindex="0"[^>]*>Large</);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it('fills the checked option with the accent, gives phones a 44 px target and the shared focus ring', () => {
    const html = render();
    expect(html).toMatch(/aria-checked="true"[^>]*class="[^"]*bg-\[var\(--draft-accent-fill,var\(--poke-accent\)\)\]/);
    expect(html).toMatch(/aria-checked="false"[^>]*class="[^"]*bg-\[var\(--draft-surface,var\(--poke-surface\)\)\]/);
    expect(html).toContain('min-h-[44px]');
    expect(html).toContain('md:min-h-0');
    expect(html).toContain('focus-visible:outline-[var(--poke-focus)]');
  });

  it('disables and mutes the whole control but keeps rendering the selection', () => {
    const html = render({ disabled: true });
    expect(html).toContain('aria-disabled="true"');
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true"[^>]*>Medium</);
    expect(html).toContain('opacity-60');
  });

  it('disables a single option only', () => {
    const html = render({ options: three.map((o) => (o.value === 'large' ? { ...o, disabled: true } : o)) });
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(1);
    expect(html).not.toContain('aria-disabled');
  });

  it('takes an extra class on the group', () => {
    expect(render({ className: 'mb-2' })).toMatch(/role="radiogroup"[^>]*class="[^"]*mb-2/);
  });
});
