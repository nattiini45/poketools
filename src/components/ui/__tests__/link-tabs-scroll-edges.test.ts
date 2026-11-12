import { describe, expect, it } from 'vitest';
import { scrollEdges } from '../LinkTabs';

describe('scrollEdges', () => {
  it('shows no fade when the tabs fit', () => {
    expect(scrollEdges(0, 390, 390)).toEqual({ start: false, end: false });
  });

  it('fades only the end when the strip is at the start', () => {
    expect(scrollEdges(0, 390, 700)).toEqual({ start: false, end: true });
  });

  it('fades both edges in the middle', () => {
    expect(scrollEdges(100, 390, 700)).toEqual({ start: true, end: true });
  });

  it('fades only the start when the strip is at the end', () => {
    expect(scrollEdges(310, 390, 700)).toEqual({ start: true, end: false });
  });
});
