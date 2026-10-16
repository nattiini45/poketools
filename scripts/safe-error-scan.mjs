// Pure scan logic for the safe-error-response CI guard. No fs/process access —
// imported by the CLI wrapper (check-safe-error-response.mjs) and unit-tested
// directly in scripts/__tests__/safe-error-scan.test.mjs.
//
// Semantics (per-occurrence, not per-block): every `return NextResponse...` /
// `return new Response...` INSIDE a catch block is an offender unless
//   (1) the same catch block calls `console.error(<caught identifier>)`
//       somewhere BEFORE that return (the CLAUDE.md "log the original error
//       first" escape hatch), or
//   (2) the line immediately above the return carries an explicit
//       `// safe-error-response-allow: <reason>` annotation.
// `return safeErrorResponse(...)` never matches the offender pattern, so it is
// exempt by construction — no substring or `throw` block-level exemptions
// exist (those were the two bypass holes in the original design).

const RAW_RETURN = /\breturn\s+(?:NextResponse\b|new\s+NextResponse\b|new\s+Response\b)/g;
export const ALLOW_MARKER = 'safe-error-response-allow:';

// Find the matching `}` for an opening `{` at index `open` in `src`.
// Returns the index of the closing brace, or -1 if unbalanced.
export function findClosingBrace(src, open) {
  let depth = 0;
  let inStr = null; // ', ", `
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Returns array of { start, end, body, param } for each `catch` block.
// `param` is the caught identifier for `catch (err)` shapes, or null for bare
// `catch {` and destructured/non-identifier params.
export function findCatchBlocks(src) {
  const blocks = [];
  const re = /\bcatch\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    let param = null;
    if (src[i] === '(') {
      const openParen = i;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
        i++;
      }
      const inner = src.slice(openParen + 1, i - 1).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(inner)) param = inner;
      while (i < src.length && /\s/.test(src[i])) i++;
    }
    if (src[i] !== '{') continue; // not a block catch
    const open = i;
    const close = findClosingBrace(src, open);
    if (close === -1) continue;
    blocks.push({ start: open, end: close, body: src.slice(open + 1, close), param });
  }
  return blocks;
}

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Scan one file's source. Returns [{ index, line }] for each raw response
// return inside a catch block that is neither preceded by a console.error of
// the caught error nor explicitly annotated with the allow marker.
export function scanSource(src) {
  const blocks = findCatchBlocks(src);
  const offenders = [];
  const seen = new Set();

  for (const b of blocks) {
    RAW_RETURN.lastIndex = 0;
    let m;
    while ((m = RAW_RETURN.exec(b.body)) !== null) {
      const abs = b.start + 1 + m.index;
      if (seen.has(abs)) continue;
      // Attribute each return to its INNERMOST enclosing catch block — an
      // outer block skips returns that a nested catch will evaluate with the
      // correct (narrower) before-context and its own caught identifier.
      const belongsToInner = blocks.some(
        (other) => other !== b && other.start > b.start && other.end < b.end && abs > other.start && abs < other.end
      );
      if (belongsToInner) continue;
      seen.add(abs);

      const before = b.body.slice(0, m.index);
      const logged = b.param
        ? new RegExp('console\\.error\\s*\\([^;]*\\b' + escapeRegExp(b.param) + '\\b').test(before)
        : /console\.error\s*\(/.test(before);
      if (logged) continue;

      const lineStart = src.lastIndexOf('\n', abs);
      const prevLineStart = src.lastIndexOf('\n', lineStart - 1);
      const prevLine = src.slice(prevLineStart + 1, Math.max(lineStart, 0));
      if (prevLine.includes(ALLOW_MARKER)) continue;

      offenders.push({ index: abs, line: lineOf(src, abs) });
    }
  }

  return offenders.sort((a, b2) => a.index - b2.index);
}
