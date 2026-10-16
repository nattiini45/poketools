import { describe, it, expect } from 'vitest';
import { scanSource, findCatchBlocks } from '../safe-error-scan.mjs';

// Regression fixtures for the two bypass holes found in code review, plus the
// documented exemptions. Each fixture is a minimal route-shaped source string.

describe('scanSource', () => {
  it('flags a raw return even when safeErrorResponse appears later in the block (Hole 1)', () => {
    const src = `
export async function PATCH() {
  try {
    return ok();
  } catch (err) {
    if (err instanceof SpecificError) {
      return NextResponse.json({ success: false, error: 'generic' }, { status: 400 });
    }
    return safeErrorResponse(err, 'Failed');
  }
}`;
    const offenders = scanSource(src);
    expect(offenders).toHaveLength(1);
  });

  it('flags a raw return in a rethrowing block (Hole 2)', () => {
    const src = `
try {
  work();
} catch (err) {
  if (err instanceof SpecificError) {
    return NextResponse.json({ success: false }, { status: 400 });
  }
  throw err;
}`;
    expect(scanSource(src)).toHaveLength(1);
  });

  it('does not flag a pure rethrow block', () => {
    const src = `
try {
  work();
} catch (err) {
  cleanup();
  throw err;
}`;
    expect(scanSource(src)).toHaveLength(0);
  });

  it('does not flag a block whose only return is safeErrorResponse', () => {
    const src = `
try {
  work();
} catch (err) {
  return safeErrorResponse(err, 'Failed to work');
}`;
    expect(scanSource(src)).toHaveLength(0);
  });

  it('does not flag a raw return preceded by console.error of the caught error', () => {
    const src = `
try {
  work();
} catch (err) {
  if (isFkViolation(err)) {
    console.error('[players] delete blocked:', err);
    return NextResponse.json({ success: false, error: 'Referenced elsewhere.' }, { status: 409 });
  }
  return safeErrorResponse(err, 'Failed to delete');
}`;
    expect(scanSource(src)).toHaveLength(0);
  });

  it('still flags when console.error logs something other than the caught error', () => {
    const src = `
try {
  work();
} catch (err) {
  console.error('something happened');
  return NextResponse.json({ success: false }, { status: 500 });
}`;
    expect(scanSource(src)).toHaveLength(1);
  });

  it('does not flag a return annotated with the allow marker', () => {
    const src = `
try {
  work();
} catch (err) {
  // safe-error-response-allow: intentional raw 204, nothing to log
  return new Response(null, { status: 204 });
}`;
    expect(scanSource(src)).toHaveLength(0);
  });

  it('accepts any console.error in a bare catch (no identifier to reference)', () => {
    const src = `
try {
  work();
} catch {
  console.error('stream closed early');
  return new Response(null, { status: 499 });
}`;
    expect(scanSource(src)).toHaveLength(0);
  });

  it('attributes returns in nested catches to the inner block', () => {
    const src = `
try {
  try {
    inner();
  } catch (innerErr) {
    if (innerErr instanceof X) {
      return NextResponse.json({ success: false }, { status: 400 });
    }
    throw innerErr;
  }
} catch (err) {
  console.error('[outer]', err);
  return safeErrorResponse(err, 'Failed');
}`;
    // The outer block's console.error must NOT excuse the inner raw return.
    expect(scanSource(src)).toHaveLength(1);
  });

  it('reports 1-based line numbers of the offending return', () => {
    const src = `line1\ntry {\n  work();\n} catch (err) {\n  return NextResponse.json({}, { status: 500 });\n}`;
    const offenders = scanSource(src);
    expect(offenders).toHaveLength(1);
    expect(offenders[0].line).toBe(5);
  });
});

describe('findCatchBlocks', () => {
  it('captures the caught identifier and handles bare catch', () => {
    const src = `try {} catch (err) { a(); } try {} catch { b(); }`;
    const blocks = findCatchBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].param).toBe('err');
    expect(blocks[1].param).toBeNull();
  });

  it('ignores braces inside strings and comments', () => {
    const src = 'try {} catch (e) { const s = "}"; // }\n /* } */ return safeErrorResponse(e, "f"); }';
    const blocks = findCatchBlocks(src);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toContain('safeErrorResponse');
  });
});
