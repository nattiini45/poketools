import { describe, it, expect } from 'vitest';
import { assertValidUuid } from '../uuid';

describe('assertValidUuid', () => {
  it('accepts a valid lowercase UUID', () => {
    expect(() => assertValidUuid('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
  });

  it('accepts a valid uppercase UUID', () => {
    expect(() => assertValidUuid('550E8400-E29B-41D4-A716-446655440000')).not.toThrow();
  });

  it('accepts a mixed-case UUID', () => {
    expect(() => assertValidUuid('550e8400-E29B-41d4-A716-446655440000')).not.toThrow();
  });

  it('throws for an empty string', () => {
    expect(() => assertValidUuid('')).toThrow('Invalid ID: expected UUID format');
  });

  it('throws for a non-UUID string', () => {
    expect(() => assertValidUuid('not-a-uuid')).toThrow('Invalid ID: expected UUID format');
  });

  it('throws for a UUID missing hyphens', () => {
    expect(() => assertValidUuid('550e8400e29b41d4a716446655440000')).toThrow();
  });

  it('throws for a UUID with extra characters', () => {
    expect(() => assertValidUuid('550e8400-e29b-41d4-a716-446655440000x')).toThrow();
  });

  it('throws for a UUID with non-hex characters', () => {
    expect(() => assertValidUuid('550g8400-e29b-41d4-a716-446655440000')).toThrow();
  });

  it('throws for a UUID with wrong segment lengths', () => {
    expect(() => assertValidUuid('550e84-00e29b-41d4-a716-446655440000')).toThrow();
  });

  it('uses custom label in error message', () => {
    expect(() => assertValidUuid('bad', 'player_id')).toThrow(
      'Invalid player_id: expected UUID format',
    );
  });

  it('uses default label when none provided', () => {
    expect(() => assertValidUuid('bad')).toThrow('Invalid ID: expected UUID format');
  });

  it('throws for a UUID with leading/trailing spaces', () => {
    expect(() => assertValidUuid(' 550e8400-e29b-41d4-a716-446655440000 ')).toThrow();
  });

  it('throws for curly-brace-wrapped UUID', () => {
    expect(() => assertValidUuid('{550e8400-e29b-41d4-a716-446655440000}')).toThrow();
  });
});
