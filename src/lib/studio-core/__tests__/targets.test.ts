import { describe, expect, it } from 'vitest';
import { errorId, fieldId, jumpCandidates } from '../targets';

describe('field ids', () => {
  it('join the prefix and the pointer segments, only [a-z0-9_-]', () => {
    expect(fieldId('ff', '/stages/0/name')).toBe('ff-stages-0-name');
    expect(fieldId('rf', '/pokemon/ban')).toBe('rf-pokemon-ban');
    expect(fieldId('ff', '/stages/0/name')).toMatch(/^[a-z0-9_-]+$/);
  });

  it('the prefix tells the studios apart', () => {
    expect(fieldId('ff', '/identity/name')).not.toBe(fieldId('rf', '/identity/name'));
  });

  it('writes every character outside [a-z0-9_] as _x<hex>_ so a segment never holds the joiner', () => {
    expect(fieldId('ff', '/a-b/C')).toBe('ff-a_x2d_b-_x43_');
    expect(fieldId('ff', '/a-b')).not.toBe(fieldId('ff', '/a/b'));
  });

  it('a pointer that cannot be parsed still gives a safe id', () => {
    expect(fieldId('ff', 'no-leading-slash')).toMatch(/^ff-[a-z0-9_-]+$/);
  });

  it('the message id is the field id plus -err', () => {
    expect(errorId('ff', '/stages/0/name')).toBe('ff-stages-0-name-err');
  });
});

describe('jumpCandidates', () => {
  it('lists the pointer then each parent down to the first segment', () => {
    expect(jumpCandidates('ff', '/stages/0/pairing/legs')).toEqual(['ff-stages-0-pairing-legs', 'ff-stages-0-pairing', 'ff-stages-0', 'ff-stages']);
    expect(jumpCandidates('rf', '/moves/ban/3')).toEqual(['rf-moves-ban-3', 'rf-moves-ban', 'rf-moves']);
  });

  it('is empty for the document root and for a malformed pointer', () => {
    expect(jumpCandidates('ff', '')).toEqual([]);
    expect(jumpCandidates('ff', 'stages')).toEqual([]);
  });
});
