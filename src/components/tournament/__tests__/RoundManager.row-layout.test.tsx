/**
 * RoundManager's round row header must wrap on a phone: the title (round name
 * and Bo label) takes its own line and the controls move below it.
 */
import { describe, expect, it } from 'vitest';
import {
  ROUND_ROW_ACTIONS_CLASS,
  ROUND_ROW_HEADER_CLASS,
  ROUND_ROW_HEADING_CLASS,
  ROUND_ROW_TITLE_CLASS,
} from '../RoundManager';

const tokens = (cls: string) => cls.split(/\s+/);

describe('round row header layout', () => {
  it('wraps the header row', () => {
    expect(tokens(ROUND_ROW_HEADER_CLASS)).toContain('flex-wrap');
  });

  it('gives the title its own full-width line on a phone, shared again from sm', () => {
    const t = tokens(ROUND_ROW_TITLE_CLASS);
    expect(t).toContain('min-w-0');
    expect(t).toContain('basis-full');
    expect(t).toContain('sm:flex-1');
    expect(t).toContain('sm:basis-0');
  });

  it('lets a long round name break instead of overflowing', () => {
    expect(tokens(ROUND_ROW_HEADING_CLASS)).toContain('break-words');
  });

  it('wraps the controls and keeps them inside the row', () => {
    const a = tokens(ROUND_ROW_ACTIONS_CLASS);
    expect(a).toContain('flex-wrap');
    expect(a).toContain('min-w-0');
    expect(a).toContain('max-w-full');
  });
});
