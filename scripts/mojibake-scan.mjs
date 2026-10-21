// Pure scan logic for the double-encoding ("mojibake") CI guard. No fs/process
// access -- imported by the CLI wrapper (check-mojibake.mjs) and unit-tested
// directly in scripts/__tests__/mojibake-scan.test.mjs.
//
// Background: on 2026-07-08 a remediation pass read several UTF-8 docs as
// cp1252 and re-saved them as UTF-8, double-encoding them. The tell-tale symptom
// is a UTF-8 multi-byte sequence whose lead byte got reinterpreted through
// cp1252/Latin-1:
//   - accented "e" (U+00E9, UTF-8 bytes C3 A9) becomes lead byte C3 -> U+00C3
//     followed by A9 -> U+00A9; "Poke" mangles accordingly in the incident docs
//   - em/en dashes and smart quotes (U+2013..U+2026, UTF-8 E2 80 xx) become a
//     U+00E2 + U+20AC prefix
//   - arrows (U+2190..U+2193, UTF-8 E2 86 xx) become a U+00E2 + U+2020 prefix
//
// The marker regexes are built from numeric code points (String.fromCharCode)
// so THIS source file stays pure ASCII on disk and never trips its own guard.
// At runtime the compiled regexes match the real mangled characters.

const CH = (code) => String.fromCharCode(code);

// Lead/continuation code points that double-encoding produces.
const A_TILDE = 0xc3; // mangled lead byte of accented latin letters
const A_CIRC_CAPITAL = 0xc2; // mangled lead byte of latin-1 symbols
const A_CIRC = 0xe2; // mangled lead byte of 3-byte punctuation / arrows
const EURO = 0x20ac; // second byte 0x80 of E2 80 xx punctuation, misread as cp1252
const DAGGER = 0x2020; // second byte 0x86 of E2 86 xx arrows, misread as cp1252
const LATIN1_HI_LO = 0xa0; // low bound of the Latin-1 high range (0xA0-0xBF)...
const LATIN1_HI_HI = 0xbf; // ...that a real UTF-8 continuation byte becomes.

const latin1HighClass = `[${CH(LATIN1_HI_LO)}-${CH(LATIN1_HI_HI)}]`;

// The mangled THIRD byte of a punctuation/arrow sequence (UTF-8 E2 80 xx /
// E2 86 xx) lands across several unrelated Unicode blocks once misread through
// cp1252 -- smart quotes (U+2018..U+201E), latin-1 symbols (U+00A0..U+00BF),
// latin-extended (U+0152..U+017E), or C1 controls for undefined cp1252 bytes --
// so it cannot be captured by one tidy range (in particular NOT latin1HighClass,
// which would miss em-dash -> U+201D, arrows -> U+2019, etc.). Detection thus
// anchors on the unique 2-char lead prefix; this OPTIONAL trailing char is
// captured only so the reported `match` shows the full mangled token, and can
// never block a match. Any non-ASCII char qualifies, except the three marker
// lead bytes themselves so an adjacent mangled token is never swallowed.
const continuationChar = `[^\\x00-\\x7f${CH(A_TILDE)}${CH(A_CIRC_CAPITAL)}${CH(A_CIRC)}]?`;

// Each marker: a name (surfaced in the report) and a global regex. The latin
// families are intentionally narrow -- a bare mangled lead byte would false-flag
// legitimate accented prose, so they require a Latin-1 high continuation char,
// the range double-encoding produces.
export const MARKERS = [
  // Mangled accented latin letters: C3 xx -> e.g. e (C3 A9), n (C3 B1), a (C3 A2).
  { name: 'latin-letter', re: new RegExp(CH(A_TILDE) + latin1HighClass, 'g') },
  // Mangled latin-1 symbols: C2 xx -> e.g. copyright (C2 A9), degree (C2 B0), nbsp (C2 A0).
  { name: 'latin-symbol', re: new RegExp(CH(A_CIRC_CAPITAL) + latin1HighClass, 'g') },
  // Mangled smart punctuation: E2 80 xx -> quotes, dashes, ellipsis; the optional
  // trailing char completes the reported token (e.g. em-dash, right single quote).
  { name: 'punctuation', re: new RegExp(CH(A_CIRC) + CH(EURO) + continuationChar, 'g') },
  // Mangled arrows: E2 86 xx -> left/up/right/down arrows; the optional trailing
  // char completes the reported token (e.g. the mangled right arrow).
  { name: 'arrow', re: new RegExp(CH(A_CIRC) + CH(DAGGER) + continuationChar, 'g') },
];

// A line, or the line immediately above it, containing this substring exempts
// that line from the scan -- for the rare legitimate case (e.g. an incident
// postmortem that quotes mangled text as an example). Mirrors the preceding-line
// annotation convention of the safe-error-response guard.
//   Markdown:  <!-- mojibake-allow: quoting the 2026-07-08 artifact -->
//   Code:      // mojibake-allow: fixture string
export const ALLOW_MARKER = 'mojibake-allow';

// Scan one file's text content. Returns [{ line, column, marker, match }] for
// every double-encoding marker occurrence, sorted by position. `line` and
// `column` are 1-based. Occurrences on (or directly below) an allow-marker line
// are skipped.
export function scanText(text) {
  const lines = text.split(/\r?\n/);
  const offenders = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    if (line.includes(ALLOW_MARKER) || prev.includes(ALLOW_MARKER)) continue;

    for (const { name, re } of MARKERS) {
      for (const m of line.matchAll(re)) {
        offenders.push({
          line: i + 1,
          column: m.index + 1,
          marker: name,
          match: m[0],
        });
      }
    }
  }

  offenders.sort((a, b) => a.line - b.line || a.column - b.column);
  return offenders;
}
