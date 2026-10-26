import { describe, expect, it } from 'vitest';
import { resolveSeasonEngine } from '../season-engine';

const LEGACY = ['singles', 'doubles', 'draft', 'evolution_point_buy'] as const;
const ENGINES = ['legacy', 'shadow', 'kit'] as const;

describe('resolveSeasonEngine', () => {
  it.each(LEGACY)('%s resolves to its legacy code path without an attached format', (format_type) => {
    expect(resolveSeasonEngine({ format_type })).toBe(`legacy:${format_type}`);
    expect(resolveSeasonEngine({ format_type }, null)).toBe(`legacy:${format_type}`);
    expect(resolveSeasonEngine({ format_type }, undefined)).toBe(`legacy:${format_type}`);
  });

  it.each(LEGACY)('%s stays legacy whatever an attached row says', (format_type) => {
    for (const engine of ENGINES) {
      expect(resolveSeasonEngine({ format_type }, { engine }), `${format_type}/${engine}`).toBe(
        `legacy:${format_type}`,
      );
    }
  });

  it('a custom league without an attached format is legacy:custom', () => {
    expect(resolveSeasonEngine({ format_type: 'custom' })).toBe('legacy:custom');
    expect(resolveSeasonEngine({ format_type: 'custom' }, null)).toBe('legacy:custom');
  });

  it('a custom league with engine legacy or shadow is legacy:custom', () => {
    expect(resolveSeasonEngine({ format_type: 'custom' }, { engine: 'legacy' })).toBe('legacy:custom');
    expect(resolveSeasonEngine({ format_type: 'custom' }, { engine: 'shadow' })).toBe('legacy:custom');
  });

  it('only a custom league with engine kit resolves to the kit', () => {
    expect(resolveSeasonEngine({ format_type: 'custom' }, { engine: 'kit' })).toBe('kit');
  });
});
