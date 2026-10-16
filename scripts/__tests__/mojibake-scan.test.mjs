import { describe, it, expect } from 'vitest';
import { scanText, MARKERS, ALLOW_MARKER } from '../mojibake-scan.mjs';

// All mojibake fixtures are built from raw code points via `fromCharCode` so
// THIS test file stays pure ASCII on disk -- otherwise the CI guard (which scans
// scripts/**/*.mjs) would flag its own fixtures. Each helper reproduces the
// exact byte sequence a UTF-8 char picks up when double-encoded through cp1252.
const cc = (...codes) => String.fromCharCode(...codes);

// UTF-8 C3 A9 = accented "e" mangled -- the "Poke" symptom from the incident.
const E_ACUTE = cc(0xc3, 0xa9);
// UTF-8 C3 A2 = accented "a" mangled -- the report's second latin-letter example.
const A_CIRC = cc(0xc3, 0xa2);
// UTF-8 E2 80 99 = right single quote mangled -- smart-quote symptom.
const SMART_QUOTE = cc(0xe2, 0x20ac, 0x2122);
// UTF-8 E2 80 94 = em dash mangled -- dash symptom.
const EM_DASH = cc(0xe2, 0x20ac, 0x201d);
// UTF-8 E2 86 92 = right arrow mangled -- arrow symptom.
const ARROW = cc(0xe2, 0x2020, 0x2019);
// UTF-8 C2 A9 = copyright mangled -- latin-1 symbol symptom.
const COPYRIGHT = cc(0xc2, 0xa9);

describe('scanText', () => {
  it('flags a mangled accented letter (the Poke / a-circ symptom)', () => {
    expect(scanText(`Welcome to Pok${E_ACUTE}Tools`)).toEqual([
      { line: 1, column: 15, marker: 'latin-letter', match: E_ACUTE },
    ]);
    expect(scanText(A_CIRC)[0].marker).toBe('latin-letter');
  });

  it('flags a mangled smart quote and em dash under the punctuation marker', () => {
    expect(scanText(SMART_QUOTE)[0].marker).toBe('punctuation');
    expect(scanText(EM_DASH)[0].marker).toBe('punctuation');
  });

  it('reports the full 3-char token (not just the lead prefix) for punctuation', () => {
    // The optional third char makes the report actionable: the reader sees the
    // whole mangled token, not the family-shared "a-circ + euro" prefix.
    expect(scanText(SMART_QUOTE)[0].match).toBe(SMART_QUOTE);
    expect(scanText(EM_DASH)[0].match).toBe(EM_DASH);
  });

  it('flags a mangled arrow under the arrow marker and reports the full token', () => {
    expect(scanText(ARROW)[0].marker).toBe('arrow');
    expect(scanText(ARROW)[0].match).toBe(ARROW);
  });

  it('still detects the 2-char prefix when no continuation char follows', () => {
    const prefixOnly = cc(0xe2, 0x20ac); // bare "a-circ + euro", no trailing byte
    const off = scanText(prefixOnly);
    expect(off).toHaveLength(1);
    expect(off[0].marker).toBe('punctuation');
    expect(off[0].match).toBe(prefixOnly);
  });

  it('does not let one mangled token swallow the lead byte of the next', () => {
    // Two adjacent punctuation tokens must be reported as two offenders.
    const off = scanText(SMART_QUOTE + EM_DASH);
    expect(off).toHaveLength(2);
    expect(off.map((o) => o.match)).toEqual([SMART_QUOTE, EM_DASH]);
  });

  it('flags a mangled latin-1 symbol under the latin-symbol marker', () => {
    expect(scanText(COPYRIGHT)[0].marker).toBe('latin-symbol');
  });

  it('reports 1-based line and column of each offender', () => {
    const src = `clean line\nsecond ${E_ACUTE} line`;
    expect(scanText(src)).toEqual([
      { line: 2, column: 8, marker: 'latin-letter', match: E_ACUTE },
    ]);
  });

  it('reports multiple offenders on one line, sorted by column', () => {
    const src = `${COPYRIGHT} then ${ARROW}`;
    const offenders = scanText(src);
    expect(offenders.map((o) => o.marker)).toEqual(['latin-symbol', 'arrow']);
    expect(offenders[0].column).toBeLessThan(offenders[1].column);
  });

  it('does not flag clean ASCII, including "->" arrows and accent-free prose', () => {
    expect(scanText('Poke league -- normal ASCII, a -> b, cafe resume')).toEqual([]);
  });

  it('does not flag legitimate (correctly-encoded) accented text', () => {
    // A single, correctly-encoded accented char is not the mangled 2-byte pair.
    const cafe = 'caf' + cc(0xe9); // "cafe" with a real accented e (U+00E9)
    expect(scanText(cafe)).toEqual([]);
  });

  it('exempts an occurrence on a line carrying the allow marker', () => {
    const src = `Example of the bug: ${E_ACUTE} <!-- ${ALLOW_MARKER}: quoting the artifact -->`;
    expect(scanText(src)).toEqual([]);
  });

  it('exempts an occurrence on the line directly below an allow marker', () => {
    const src = `// ${ALLOW_MARKER}: fixture below\nconst mangled = "Pok${E_ACUTE}";`;
    expect(scanText(src)).toEqual([]);
  });

  it('does not let an allow marker exempt a later, unrelated line', () => {
    const src = `// ${ALLOW_MARKER}: only the next line\nclean\nPok${E_ACUTE}`;
    expect(scanText(src)).toHaveLength(1);
    expect(scanText(src)[0].line).toBe(3);
  });

  it('handles CRLF line endings', () => {
    const src = `line1\r\nPok${E_ACUTE}\r\nline3`;
    expect(scanText(src)[0].line).toBe(2);
  });

  it('returns an empty array for empty input', () => {
    expect(scanText('')).toEqual([]);
  });
});

describe('MARKERS', () => {
  it('exposes the four documented double-encoding families', () => {
    expect(MARKERS.map((m) => m.name)).toEqual([
      'latin-letter',
      'latin-symbol',
      'punctuation',
      'arrow',
    ]);
  });

  it('compiles every marker as a global regex', () => {
    for (const { re } of MARKERS) expect(re.flags).toContain('g');
  });
});
