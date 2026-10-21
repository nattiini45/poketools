import { describe, expect, it } from 'vitest';
import { recordsToCsv } from '@/lib/utils/csv';

function cellOf(value: unknown): string {
  const [, row] = recordsToCsv([{ v: value }]).split('\n');
  return row;
}

describe('recordsToCsv formula neutralization', () => {
  it('prefixes a formula cell and keeps quote doubling', () => {
    const csv = recordsToCsv([{ ps_username: '=HYPERLINK("http://x","y")' }]);
    expect(csv).toBe('"ps_username"\n"\'=HYPERLINK(""http://x"",""y"")"');
  });

  it.each([
    ['+1+1', '"\'+1+1"'],
    ['-1+1', '"\'-1+1"'],
    ['@SUM(A1)', '"\'@SUM(A1)"'],
    ['\t=1', '"\'\t=1"'],
    ['\r=1', '"\'\r=1"'],
    [' =1+1', '"\' =1+1"'],
  ])('neutralizes %j', (input, expected) => {
    expect(cellOf(input)).toBe(expected);
  });

  it('leaves numbers and booleans untouched', () => {
    expect(cellOf(-5)).toBe('"-5"');
    expect(cellOf(false)).toBe('"false"');
  });

  it('leaves plain text unchanged', () => {
    expect(cellOf('Ash')).toBe('"Ash"');
    expect(cellOf(null)).toBe('');
  });

  it('neutralizes formula-leading header keys', () => {
    const [header] = recordsToCsv([{ '=cmd': 'x' }]).split('\n');
    expect(header).toBe('"\'=cmd"');
  });

  it('leaves JSON-stringified objects unprefixed', () => {
    expect(cellOf({ a: 1 })).toBe('"{""a"":1}"');
  });
});
