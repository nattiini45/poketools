import { describe, expect, it } from 'vitest';
import { NEGATIVE_FIXTURES, fixtureDiagnostics } from '@/lib/format-kit/__tests__/fixtures/negative';
import {
  DEFAULT_SELECTION,
  errorId,
  fieldId,
  jumpCandidates,
  pointerTarget,
  type Selection,
} from '../../editor/targets';

const target = (section: Selection['section'], index: number): Selection => ({ section, index });

describe('pointerTarget', () => {
  it.each([
    ['/identity', target('identity', 0)],
    ['/identity/name', target('identity', 0)],
    ['/identity/name/en/v', target('identity', 0)],
    ['/identity/summary', target('identity', 0)],
    ['/identity/based_on', target('identity', 0)],
    ['/stages', target('stage', 0)],
    ['/stages/0', target('stage', 0)],
    ['/stages/3', target('stage', 3)],
    ['/stages/2/key', target('stage', 2)],
    ['/stages/1/pairing/legs', target('stage', 1)],
    ['/stages/1/rank/4', target('stage', 1)],
    ['/stages/1/series/overrides/2/round', target('stage', 1)],
    ['/stages/12/groups/count', target('stage', 12)],
    ['/edges', target('edges', 0)],
    ['/edges/0', target('edges', 0)],
    ['/edges/2/select/1/when', target('edges', 2)],
    ['/edges/2/select/1/when/args/0', target('edges', 2)],
    ['/rules', target('rules', 0)],
    ['/rules/4', target('rules', 4)],
    ['/rules/4/text/en/v', target('rules', 4)],
    ['/text', null],
    ['/text/sections', target('text', 0)],
    ['/text/sections/5', target('text', 5)],
    ['/text/sections/5/body', target('text', 5)],
    ['/theme', target('theme', 0)],
    ['/theme/world', target('theme', 0)],
  ] as const)('%s -> section target', (pointer, expected) => {
    expect(pointerTarget(pointer)).toEqual(expected);
  });

  it.each([
    [''],
    ['/'],
    ['/schema_version'],
    ['/views'],
    ['/views/0'],
    ['/views/0/stages/1'],
    ['/modules'],
    ['/modules/1/facts/0'],
    ['/attributes'],
    ['/note'],
    ['/text/other'],
    ['/stages/x'],
    ['/stages/-1'],
    ['/stages/01'],
    ['/stages/1.5'],
    ['no-slash'],
    ['/bad~escape'],
  ])('%j has no place in the form', (pointer) => {
    expect(pointerTarget(pointer)).toBeNull();
  });

  it('has a default selection on the first stage', () => {
    expect(DEFAULT_SELECTION).toEqual({ section: 'stage', index: 0 });
  });

  it('maps every pointer the compiler emits to a part of the form or to nothing, never to a bad index', () => {
    const seen = new Set<string>();
    for (const fixture of NEGATIVE_FIXTURES) {
      for (const d of fixtureDiagnostics(fixture)) seen.add(d.json_pointer);
    }
    expect(seen.size).toBeGreaterThan(30);
    for (const pointer of seen) {
      const found = pointerTarget(pointer);
      if (found === null) continue;
      expect(Number.isInteger(found.index) && found.index >= 0, pointer).toBe(true);
    }
    // The compiler points at least at stages, edges, rule text and the document root.
    const sections = new Set([...seen].map((p) => pointerTarget(p)?.section ?? 'none'));
    for (const expected of ['stage', 'edges', 'none']) expect(sections.has(expected as never), expected).toBe(true);
  });
});

describe('fieldId', () => {
  it('joins the segments with a dash after ff-', () => {
    expect(fieldId('/stages/0/pairing/legs')).toBe('ff-stages-0-pairing-legs');
    expect(fieldId('/identity/name/en/v')).toBe('ff-identity-name-en-v');
    expect(fieldId('/stages')).toBe('ff-stages');
    expect(fieldId('')).toBe('ff-');
  });

  it('uses only lower-case letters, digits, underscores and dashes', () => {
    for (const pointer of ['/stages/0/Pairing', '/a b/ä/€', '/x~0y/z~1w', '/rules/3/text/de/v', '/UPPER', '/a-b']) {
      expect(fieldId(pointer), pointer).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it('is stable and different for different pointers', () => {
    const pointers = [
      '/stages/0/key',
      '/stages/1/key',
      '/stages/0/name/en/v',
      '/stages/0/name/de/v',
      '/edges/0/select/0/n',
      '/edges/0/select/1/n',
      '/a-b',
      '/a/b',
      '/A',
      '/a',
      '/x~1y',
      '/x/y',
      '/x~0y',
    ];
    const ids = pointers.map(fieldId);
    expect(new Set(ids).size).toBe(pointers.length);
    expect(pointers.map(fieldId)).toEqual(ids);
  });

  it('builds the message id from the field id', () => {
    expect(errorId('/stages/0/pairing/legs')).toBe('ff-stages-0-pairing-legs-err');
    expect(errorId('/stages/0/pairing/legs')).toMatch(/^[a-z0-9_-]+$/);
  });
});

describe('jumpCandidates', () => {
  it('lists the pointer and each parent, most specific first, without the root', () => {
    expect(jumpCandidates('/stages/0/pairing/legs')).toEqual([
      'ff-stages-0-pairing-legs',
      'ff-stages-0-pairing',
      'ff-stages-0',
      'ff-stages',
    ]);
  });

  it('has one entry for a first-level pointer and none for the root', () => {
    expect(jumpCandidates('/theme')).toEqual(['ff-theme']);
    expect(jumpCandidates('')).toEqual([]);
    expect(jumpCandidates('bad')).toEqual([]);
  });

  it('starts with the id fieldId gives the pointer', () => {
    const pointer = '/edges/1/select/0/n';
    expect(jumpCandidates(pointer)[0]).toBe(fieldId(pointer));
  });
});
