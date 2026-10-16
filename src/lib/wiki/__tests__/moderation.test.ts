import { describe, expect, it } from 'vitest';
import { scanWikiNoteContent } from '../moderation';

describe('scanWikiNoteContent', () => {
  it('returns no flags for ordinary competitive notes', () => {
    expect(scanWikiNoteContent('Useful on rain teams because it pressures common Water resists.')).toEqual([]);
  });

  it('flags spam-like note content', () => {
    const flags = scanWikiNoteContent('CHECK THIS OUT!!!!!!!!!!!!!! https://a.test https://b.test https://c.test https://d.test');
    expect(flags).toContain('too_many_links');
    expect(flags).toContain('repeated_characters');
  });
});