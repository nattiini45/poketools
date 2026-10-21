/**
 * Guard: no tracked source file under `src/` or `scripts/` holds a lone CR.
 *
 * A CR that is not followed by LF (a classic-Mac line end, or CR CR LF from a
 * tool that translated LF to CRLF twice) makes git's `text=auto` treat the file
 * as binary: `git diff` prints "Binary files differ", review tools hide the
 * change, and no `.gitattributes` rule normalises it. The sync-standings route
 * carried CR CR LF until the PR #65 follow-ups (see `.gitattributes`).
 *
 * CRLF on its own is allowed here: a Windows checkout made before the
 * `eol=lf` rule still has CRLF working files, and git stores them as LF.
 * Files git already treats as binary by attribute (fonts, images, `.glb`) and
 * files holding NUL bytes are skipped.
 *
 * One pass over the tree: `git ls-files --eol` already reads every working
 * file and reports a file holding a lone CR as `w/-text` (git counts a lone CR
 * as binary content). Only those few files are read again here, to tell a lone
 * CR from NUL or other binary content. Reading all ~2300 files a second time
 * made the guard miss the 5 s default under a loaded runner. The temp-repo case
 * below pins git's classification, so a git that stopped flagging lone CRs
 * fails here instead of leaving the guard blind.
 *
 * Fix a hit with `tr -d '\r' < f > f.tmp && mv f.tmp f`, then check that
 * `git diff -w` on it is empty.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ROOTS = ['src', 'scripts'];

/**
 * These cases spawn git, and the repo-wide one has git read every tracked file
 * under the roots. Like the script tests (vitest.config.ts), 5 s is too tight on
 * a cold or loaded runner; the assertions are unchanged.
 */
const GIT_IO_TIMEOUT_MS = 60_000;

const CR = 0x0d;
const LF = 0x0a;

/** Byte offset of the first CR not followed by LF, or -1. */
function firstLoneCr(bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === CR && bytes[i + 1] !== LF) return i;
  }
  return -1;
}

/** One parsed record of `git ls-files --eol -z`. */
interface EolRecord {
  file: string;
  /** git's verdict on the working-tree content: `lf`, `crlf`, `mixed`, `none`, `-text`, or '' (missing/empty). */
  worktree: string;
  /** True when `.gitattributes` marks the file binary (`-text`). */
  attrBinary: boolean;
}

function parseLsFilesEol(out: string): EolRecord[] {
  const records: EolRecord[] = [];
  for (const record of out.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const info = record.slice(0, tab);
    records.push({
      file: record.slice(tab + 1),
      worktree: /\bw\/(\S*)/.exec(info)?.[1] ?? '',
      attrBinary: /\battr\/-text\b/.test(info),
    });
  }
  return records;
}

/**
 * Files that may hold a lone CR: git saw binary-looking working content
 * (`w/-text`) in a file not marked binary by attribute. LF, CRLF, mixed and
 * no-EOL files cannot hold one, since git classes any lone CR as binary.
 */
function loneCrCandidates(records: EolRecord[]): string[] {
  return records.filter((r) => !r.attrBinary && r.worktree === '-text').map((r) => r.file);
}

function lsFilesEol(cwd: string, roots: string[]): EolRecord[] {
  const out = execFileSync('git', ['ls-files', '--eol', '-z', '--', ...roots], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parseLsFilesEol(out);
}

/** `file (byte N)` for each candidate that really holds a lone CR. */
function loneCrOffenders(cwd: string, candidates: string[]): string[] {
  const offenders: string[] = [];
  for (const file of candidates) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(cwd, file));
    } catch {
      continue; // deleted in the working tree
    }
    if (bytes.includes(0)) continue; // binary content
    const at = firstLoneCr(bytes);
    if (at !== -1) offenders.push(`${file} (byte ${at})`);
  }
  return offenders;
}

describe('firstLoneCr', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('accepts LF and CRLF line ends', () => {
    expect(firstLoneCr(bytes('a\nb\n'))).toBe(-1);
    expect(firstLoneCr(bytes('a\r\nb\r\n'))).toBe(-1);
    expect(firstLoneCr(bytes('a\r\nb\n'))).toBe(-1);
  });

  it('flags CR CR LF and a bare CR (also at the end of the file)', () => {
    expect(firstLoneCr(bytes('a\r\r\nb'))).toBe(1);
    expect(firstLoneCr(bytes('a\rb'))).toBe(1);
    expect(firstLoneCr(bytes('a\r'))).toBe(1);
  });
});

describe('loneCrCandidates', () => {
  it('keeps w/-text files and drops text and attribute-binary ones', () => {
    const out = [
      'i/lf    w/lf    attr/text=auto eol=lf \tsrc/a.ts',
      'i/lf    w/crlf  attr/text=auto eol=lf \tsrc/b.ts',
      'i/mixed w/mixed attr/                 \tsrc/c.ts',
      'i/lf    w/-text attr/text=auto eol=lf \tsrc/with space.ts',
      'i/-text w/-text attr/-text            \tsrc/font.woff2',
      'i/lf    w/      attr/text=auto eol=lf \tsrc/deleted.ts',
      '',
    ].join('\0');
    expect(loneCrCandidates(parseLsFilesEol(out))).toEqual(['src/with space.ts']);
  });
});

describe('git eol classification', () => {
  it(
    'reports working files with a lone CR as w/-text and CRLF/LF files as text',
    () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'lone-cr-'));
      try {
        const git = (...args: string[]) =>
          execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], {
            cwd: dir,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
        git('init', '-q');
        const files: Record<string, string> = {
          'lf.txt': 'a\nb\n',
          'crlf.txt': 'a\r\nb\r\n',
          'mixed.txt': 'a\r\nb\n',
          'bare-cr.txt': 'a\rb\n',
          'cr-cr-lf.txt': 'a\r\r\nb\r\n',
          'end-cr.txt': 'a\r',
          'edited.txt': 'a\nb\n',
        };
        for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
        git('add', '.');
        // A lone CR added after staging: the working tree, not the index, decides.
        writeFileSync(path.join(dir, 'edited.txt'), 'a\rb\n');

        const records = lsFilesEol(dir, ['.']);
        expect(loneCrCandidates(records).sort()).toEqual(
          ['bare-cr.txt', 'cr-cr-lf.txt', 'edited.txt', 'end-cr.txt'].sort(),
        );
        expect(loneCrOffenders(dir, loneCrCandidates(records)).sort()).toEqual(
          ['bare-cr.txt (byte 1)', 'cr-cr-lf.txt (byte 1)', 'edited.txt (byte 1)', 'end-cr.txt (byte 1)'].sort(),
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    GIT_IO_TIMEOUT_MS,
  );
});

describe('tracked source files', () => {
  it(
    'contain no lone CR (CR CR LF or bare CR)',
    () => {
      const records = lsFilesEol(REPO_ROOT, ROOTS);
      expect(records.length).toBeGreaterThan(100);
      expect(loneCrOffenders(REPO_ROOT, loneCrCandidates(records))).toEqual([]);
    },
    GIT_IO_TIMEOUT_MS,
  );
});
