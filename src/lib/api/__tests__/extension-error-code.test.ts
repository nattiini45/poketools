import { describe, expect, it } from 'vitest';
import { extensionErrorCode } from '../extension-error-code';

describe('extensionErrorCode', () => {
  it('returns the code unchanged (a branded string)', () => {
    const code = extensionErrorCode('history_person_not_found');
    expect(code).toBe('history_person_not_found');
    expect(typeof code).toBe('string');
  });

  it.each(['', 'Has-Caps', 'with space', 'dot.ted', 'ümlaut'])('rejects %j (codes are snake_case)', (bad) => {
    expect(() => extensionErrorCode(bad)).toThrow(/must be snake_case/);
  });
});
