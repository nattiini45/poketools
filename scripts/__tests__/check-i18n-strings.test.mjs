import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHANGED_PATHSPECS,
  expandPaths,
  globToRegExp,
  isAllowlisted,
  isScannable,
  loadAllowlist,
  looksLikeText,
  parseArgs,
  run,
  scanSource,
  splitPathList,
} from '../check-i18n-strings.mjs';

// One fixture per rule and per ignore case of i18n-core §8.3. Each fixture is a
// minimal source string scanned under a repo-relative file name, which decides
// the rules that apply.

const COMPONENT = 'src/components/demo/Demo.tsx';
const rules = (src, file = COMPONENT) => scanSource(src, file).map((f) => f.rule);

describe('rule 1: JSX text', () => {
  it('flags visible text with two or more letters', () => {
    const found = scanSource('export function Demo() { return <p>Save changes</p>; }', COMPONENT);
    expect(found).toEqual([{ line: 1, column: 36, rule: 'jsx-text', text: 'Save changes' }]);
  });

  it('flags German text too', () => {
    expect(rules('const x = <p>Speichern</p>;')).toEqual(['jsx-text']);
  });

  it('ignores whitespace-only, punctuation and single letters', () => {
    expect(rules('const x = <p> · — × % → / {n}</p>;')).toEqual([]);
    expect(rules('const x = <p>x</p>;')).toEqual([]);
  });

  it('ignores short all-caps codes (HP, KO, VS, OK)', () => {
    expect(rules('const x = <p><b>HP</b><b>KO</b><b>VS</b><b>OK</b></p>;')).toEqual([]);
  });

  it('ignores allowlist tokens and format ids', () => {
    expect(rules('const x = <p>PokéTools · Bo3 · gen9ou</p>;')).toEqual([]);
    expect(rules('const x = <p>Pokémon Showdown</p>;', COMPONENT)).toEqual([]);
  });

  it('still flags prose next to a token', () => {
    expect(rules('const x = <p>Open in Showdown</p>;')).toEqual(['jsx-text']);
  });

  it('ignores HTML entities', () => {
    expect(rules('const x = <p>&nbsp;&middot;&nbsp;</p>;')).toEqual([]);
  });
});

describe('rule 6: string literals as JSX children (Kilo 4245127344)', () => {
  it('flags a literal, a ternary, an && branch, a ?? fallback and a prose template', () => {
    expect(rules("const x = <p>{'Save changes'}</p>;")).toEqual(['jsx-expr']);
    expect(rules("const x = <p>{ok ? 'Yes' : 'No'}</p>;")).toEqual(['jsx-expr', 'jsx-expr']);
    expect(rules("const x = <p>{busy && 'Saving'}</p>;")).toEqual(['jsx-expr']);
    expect(rules("const x = <p>{name ?? 'Unknown player'}</p>;")).toEqual(['jsx-expr']);
    expect(rules('const x = <p>{`${n} picks left`}</p>;')).toEqual(['jsx-expr']);
    expect(rules("const x = <>{'Speichern'}</>;")).toEqual(['jsx-expr']);
  });

  it('reports the literal itself, 1-based', () => {
    expect(scanSource("const x = <p>{ok ? 'Yes' : 'No'}</p>;", COMPONENT)).toEqual([
      { line: 1, column: 20, rule: 'jsx-expr', text: 'Yes' },
      { line: 1, column: 28, rule: 'jsx-expr', text: 'No' },
    ]);
  });

  it('ignores symbols, codes, tokens, keys, class names and non-literals', () => {
    expect(rules("const x = <p>{' '}{'·'}{'—'}{ok ? '✓' : '○'}{'HP'}{'KO'}</p>;")).toEqual([]);
    expect(rules('const x = <p>{`${a} VS ${b} · ${c}`}{`${a} / ${b}`}{`#${n}`}</p>;')).toEqual([]);
    expect(rules("const x = <p>{'PokéTools'}{'gen9ou'}{t('ui.save')}{label}{n > 0 && count}</p>;")).toEqual([]);
    expect(rules("const x = <p>{`${id}.png`}{'text-sm font-bold'}{'https://example.com'}</p>;")).toEqual([]);
    expect(rules("const x = <p>{ok && cls('Yes')}{fmt('Yes')}</p>;")).toEqual([]);
  });

  it('walks +, x!, as/satisfies, parentheses, tagged templates, arrays and an array receiver', () => {
    expect(rules("const x = <p>{'Total: ' + n}</p>;")).toEqual(['jsx-expr']);
    expect(rules("const x = <p>{n + ' picks left'}</p>;")).toEqual(['jsx-expr']);
    expect(rules("const x = <p>{'Save ' + 'changes'}</p>;")).toEqual(['jsx-expr', 'jsx-expr']);
    expect(rules("const x = <p>{(label ?? 'Unknown player')!}</p>;")).toEqual(['jsx-expr']);
    expect(rules("const x = <p>{('Save changes' as string)}</p>;")).toEqual(['jsx-expr']);
    expect(rules("const x = <p>{'Save changes' satisfies string}</p>;")).toEqual(['jsx-expr']);
    expect(rules('const x = <p>{tag`Save changes`}</p>;')).toEqual(['jsx-expr']);
    expect(rules('const x = <p>{tag`${n} picks left`}</p>;')).toEqual(['jsx-expr']);
    expect(rules("const x = <p>{['Save', 'changes']}</p>;")).toEqual(['jsx-expr', 'jsx-expr']);
    expect(rules("const x = <p>{['Save', 'changes'].join(' ')}</p>;")).toEqual(['jsx-expr', 'jsx-expr']);
    expect(rules("const x = <p>{ok && ['Yes'].join()}</p>;")).toEqual(['jsx-expr']);
  });

  it('walks the arguments of join and concat: a separator and a payload render', () => {
    expect(rules("const x = <p>{names.join(' and ')}</p>;")).toEqual(['jsx-expr']);
    expect(rules("const x = <p>{a.concat(' and ')}</p>;")).toEqual(['jsx-expr']);
    expect(rules("const x = <p>{a.concat(['Save', 'changes'], ok ? 'Yes' : 'No')}</p>;")).toEqual([
      'jsx-expr',
      'jsx-expr',
      'jsx-expr',
      'jsx-expr',
    ]);
    expect(rules("const x = <p>{a.concat(...['Save changes'])}</p>;")).toEqual(['jsx-expr']);
    expect(scanSource("const x = <p>{['Save'].join(' and ')}</p>;", COMPONENT).map((f) => f.text)).toEqual([
      'Save',
      'and',
    ]);
    // A punctuation-only separator is not prose, and t() inside a join argument stays a call.
    expect(rules("const x = <p>{names.join(', ')}{names.join(t('draft.and'))}</p>;")).toEqual([]);
  });

  it('keeps the arguments of every other receiver method exempt', () => {
    expect(rules("const x = <p>{items.filter((i) => i !== 'Save changes').join(', ')}</p>;")).toEqual([]);
    expect(rules("const x = <p>{items.find((i) => i.label === 'Save changes')}</p>;")).toEqual([]);
    expect(rules("const x = <p>{items.at(-1)}{items.slice(0, 2)}{items.findLast((i) => i === 'Last one')}</p>;")).toEqual(
      [],
    );
    expect(rules("const x = <p>{items.sort((a, b) => a.localeCompare(b, 'Some locale'))}</p>;")).toEqual([]);
    // Prose as a DIRECT argument (not inside a callback): only join/concat arguments render,
    // so walking every receiver method's arguments would flag these.
    expect(rules("const x = <p>{[a, b].find(cb, 'Some locale text')}</p>;")).toEqual([]);
    expect(rules("const x = <p>{[a, b].filter(cb, 'Another prose string')}</p>;")).toEqual([]);
    expect(rules("const x = <p>{[a, b].findLast(cb, 'Yet more words')}{[a, b].sort(cb, 'Sorted by name')}</p>;")).toEqual(
      [],
    );
  });

  it('never walks call arguments: t(), cn() and friends are not prose', () => {
    expect(rules("const x = <p>{t('some.key')}</p>;")).toEqual([]);
    expect(rules("const x = <p>{t('Save changes')}{cn('Save changes')}{items.map((i) => 'Save changes')}</p>;")).toEqual(
      [],
    );
    expect(rules("const x = <p>{t('some.key') + ' ' + t('other.key')}</p>;")).toEqual([]);
  });

  it('does not walk the receiver of .map(): a list of keys iterated, not rendered', () => {
    expect(rules("const x = <p>{(['intel', 'opponent'] as const).map((k) => <b key={k}>{t(k)}</b>)}</p>;")).toEqual([]);
    expect(rules("const x = <p>{['Save', 'changes'].filter(Boolean).join(' ')}</p>;")).toEqual(['jsx-expr', 'jsx-expr']);
  });

  it('ignores attribute expressions (rule 2 owns them) and <style>/<script> bodies', () => {
    expect(rules("const x = <a href={'/leagues'} className={'text-sm'} data-x={'Some words'} />;")).toEqual([]);
    expect(rules('const x = <style>{`.a { color: red } body { margin: 0 }`}</style>;')).toEqual([]);
  });

  it('honours i18n-ignore on the preceding line', () => {
    const src = ['const x = (', '  <p>', "    {/* i18n-ignore: dev-only */}", "    {ok ? 'Yes' : 'No'}", '  </p>', ');'];
    expect(rules(src.join('\n'))).toEqual([]);
  });

  it('a marker above a multi-line child covers every leaf of it', () => {
    const marked = [
      'const x = (',
      '  <p>',
      '    {/* i18n-ignore: dev-only */}',
      '    {cond',
      "      ? 'Yes'",
      "      : 'No'}",
      '  </p>',
      ');',
    ];
    expect(rules(marked.join('\n'))).toEqual([]);
    const arr = ['const x = (', '  <p>', '    {/* i18n-ignore: dev-only */}', '    {[', "      'Save',", "      'changes',", '    ]}', '  </p>', ');'];
    expect(rules(arr.join('\n'))).toEqual([]);
  });

  it('without a marker, or with a marker that has no reason, a multi-line child is still flagged', () => {
    const bare = ['const x = (', '  <p>', '    {cond', "      ? 'Yes'", "      : 'No'}", '  </p>', ');'];
    expect(scanSource(bare.join('\n'), COMPONENT)).toEqual([
      { line: 4, column: 9, rule: 'jsx-expr', text: 'Yes' },
      { line: 5, column: 9, rule: 'jsx-expr', text: 'No' },
    ]);
    const noReason = ['const x = (', '  <p>', '    {/* i18n-ignore: */}', ...bare.slice(2)];
    expect(rules(noReason.join('\n'))).toEqual(['jsx-expr', 'jsx-expr']);
  });

  it('a marker inside a multi-line child still covers only the leaf below it', () => {
    const src = [
      'const x = (',
      '  <p>',
      '    {cond',
      '      ? // i18n-ignore: dev-only',
      "        'Yes'",
      "      : 'No'}",
      '  </p>',
      ');',
    ];
    expect(scanSource(src.join('\n'), COMPONENT).map((f) => f.text)).toEqual(['No']);
  });

  it('applies where rules 1-4 apply: not under src/app/api or outside app/components/lib', () => {
    expect(rules("const x = <p>{'Save changes'}</p>;", 'src/app/api/x/route.tsx')).toEqual([]);
    expect(rules("const x = <p>{'Save changes'}</p>;", 'src/types/x.tsx')).toEqual([]);
    expect(rules("const x = <p>{'Save changes'}</p>;", 'src/lib/x/y.tsx')).toEqual(['jsx-expr']);
  });
});

describe('rule 2: text attributes', () => {
  it('flags a listed attribute with a string literal', () => {
    expect(rules('const x = <input placeholder="Search players" />;')).toEqual(['jsx-attr']);
    expect(rules('const x = <button aria-label="Close dialog" />;')).toEqual(['jsx-attr']);
  });

  it('flags *Label/*Text/*Title/*Message/*Placeholder names and expression literals', () => {
    expect(rules("const x = <Dialog confirmLabel={'Delete it'} />;")).toEqual(['jsx-attr']);
    expect(rules('const x = <Card emptyStateText={`Nothing here`} />;')).toEqual(['jsx-attr']);
    expect(rules("const x = <Card heading={busy ? 'Saving' : 'Saved'} />;")).toEqual(['jsx-attr', 'jsx-attr']);
  });

  it('ignores non-text attributes (className, href, key, id, name, type, role, data-*, style)', () => {
    const src =
      'const x = <a className="text-sm font-bold" href="/leagues" key="Row one" id="Main area" name="Full name" ' +
      'type="button" role="Main region" data-label="Some label" style={{}}>{n}</a>;';
    expect(rules(src)).toEqual([]);
  });

  it('ignores CSS-looking strings and URLs in text attributes', () => {
    expect(rules('const x = <img alt="https://example.com/a.png" title="hover:bg-poke-surface" />;')).toEqual([]);
  });
});

describe('rule 3: setters, dialogs, toasts', () => {
  it('flags a literal first argument', () => {
    expect(rules("function Demo() { const run = () => setError('Could not save the team'); }")).toEqual(['call-arg']);
    expect(rules("function f() { if (window.confirm('Delete this phase?')) go(); }")).toEqual(['call-arg']);
    expect(rules("function f() { alert('Copied to clipboard'); }")).toEqual(['call-arg']);
    expect(rules("function f() { toast.error('Upload failed'); toastSuccess('Saved it'); }")).toEqual([
      'call-arg',
      'call-arg',
    ]);
  });

  it('flags a prose template and a literal fallback', () => {
    expect(rules('function f() { setMessage(`Imported ${n} entries`); }')).toEqual(['call-arg']);
    expect(rules("function f() { setError(json.error ?? 'Failed to load'); }")).toEqual(['call-arg']);
  });

  it('ignores non-prose templates and non-literals', () => {
    expect(rules('function f() { setError(`${a}/${b}`); setError(json.error); setError(null); }')).toEqual([]);
  });

  it('does not treat other objects’ confirm() as a dialog', () => {
    expect(rules("function f() { dialog.confirm('Delete this phase?'); }")).toEqual([]);
  });
});

describe('rule 4: label-like object properties', () => {
  it('flags two words or a capitalised word of three letters', () => {
    expect(rules("const tabs = [{ id: 'a', label: 'Match overview' }];")).toEqual(['object-text']);
    expect(rules("const tabs = [{ id: 'a', title: 'Standings' }];")).toEqual(['object-text']);
  });

  it('ignores single lowercase words, short codes and other keys', () => {
    expect(rules("const x = { label: 'primary', text: 'ok', title: 'KO', value: 'Some value', key: 'Main area' };")).toEqual(
      [],
    );
  });

  it('applies to src/components and src/app only', () => {
    const src = "export const x = { label: 'Match overview' };";
    expect(rules(src, 'src/app/(public)/demo/page.tsx')).toEqual(['object-text']);
    expect(rules(src, 'src/lib/demo/labels.ts')).toEqual([]);
  });
});

describe('rule 5: locale hazards', () => {
  it('flags argument-less toLocale*String()', () => {
    expect(rules('const s = d.toLocaleDateString();', 'src/lib/demo/x.ts')).toEqual(['locale']);
    expect(rules('const s = n.toLocaleString();', 'src/hooks/useX.ts')).toEqual(['locale']);
    expect(rules("const s = d.toLocaleDateString('de-DE', o);", 'src/hooks/useX.ts')).toEqual(['locale']);
    expect(rules('const s = d.toLocaleDateString(tag, o);', 'src/hooks/useX.ts')).toEqual([]);
  });

  it('flags Intl formatters with an undefined locale, but not the browser-zone probe', () => {
    expect(rules('const f = new Intl.DateTimeFormat(undefined, o);', 'src/lib/x.ts')).toEqual(['locale']);
    expect(rules('const f = Intl.NumberFormat(undefined);', 'src/lib/x.ts')).toEqual(['locale']);
    expect(rules('const z = Intl.DateTimeFormat().resolvedOptions().timeZone;', 'src/lib/x.ts')).toEqual([]);
  });

  it('flags hard-coded locale tags, not type-level ones', () => {
    expect(rules("const t = 'en-US';", 'src/lib/x.ts')).toEqual(['locale']);
    expect(rules("const t = `en-GB`;", 'src/lib/x.ts')).toEqual(['locale']);
    expect(rules("type T = 'de-DE';", 'src/lib/x.ts')).toEqual([]);
  });

  it('flags the clock read during a component render only', () => {
    expect(rules('export function Card() { const now = Date.now(); return null; }')).toEqual(['locale']);
    expect(rules('export const Card = () => { const d = new Date(); return null; };')).toEqual(['locale']);
    expect(rules('function Card() { const t = useMemo(() => Date.now(), []); return null; }')).toEqual(['locale']);
    expect(rules('function Card() { useEffect(() => { start(Date.now()); }, []); return null; }')).toEqual([]);
    expect(rules('function Card() { const onClick = () => Date.now(); return null; }')).toEqual([]);
    expect(rules('function formatAge() { return Date.now(); }')).toEqual([]);
    expect(rules('function Card() { const d = new Date(iso); return null; }')).toEqual([]);
  });

  it('does not treat route handlers as components', () => {
    const src = 'export async function POST() { const at = new Date(); return at; }';
    expect(rules(src, 'src/app/api/demo/route.ts')).toEqual([]);
  });

  it('never scans src/i18n', () => {
    expect(rules("const t = { en: 'en-GB', de: 'de-DE' };", 'src/i18n/config.ts')).toEqual([]);
  });
});

describe('scope and ignore cases', () => {
  it('skips rules 1-4 under src/app/api but keeps locale hazards', () => {
    const src = "export function GET() { setError('Bad request body'); return d.toLocaleString(); }";
    expect(rules(src, 'src/app/api/demo/route.ts')).toEqual(['locale']);
  });

  it('skips rules 1-4 outside src/app, src/components and src/lib', () => {
    expect(rules('const x = <p>Save changes</p>;', 'src/hooks/useDemo.tsx')).toEqual([]);
  });

  it('honours `// i18n-ignore: <reason>` on the preceding line', () => {
    const src = ['function f() {', '  // i18n-ignore: Showdown export header stays English', "  setError('Team export');", '}'].join(
      '\n',
    );
    expect(rules(src)).toEqual([]);
  });

  it('honours the JSX comment form before multi-line JSX text', () => {
    const src = ['const x = (', '  <p>', '    {/* i18n-ignore: brand slogan */}', '    Gotta draft them all', '  </p>', ');'].join(
      '\n',
    );
    expect(rules(src)).toEqual([]);
  });

  it('requires a reason', () => {
    const src = ['function f() {', '  // i18n-ignore:', "  setError('Team export');", '}'].join('\n');
    expect(rules(src)).toEqual(['call-arg']);
  });

  it('ignores developer text in console.*, logger.*, expect(), new Error() and throw', () => {
    const src = [
      "function Demo() {",
      "  console.error({ message: 'Failed to load the team' });",
      "  logger.warn({ message: 'Request was slow' });",
      "  if (x) throw { message: 'Bad state here' };",
      "  const e = new UserFacingError('x', { message: 'Some message' });",
      '  return null;',
      '}',
    ].join('\n');
    expect(rules(src)).toEqual([]);
  });

  it('reports 1-based line and column for each finding', () => {
    const src = ['const a = 1;', 'const x = <p>', '  Hello world', '</p>;'].join('\n');
    expect(scanSource(src, COMPONENT)).toEqual([{ line: 3, column: 3, rule: 'jsx-text', text: 'Hello world' }]);
  });
});

describe('looksLikeText', () => {
  it('judges only the literal parts of a template and treats bare file names as paths', () => {
    expect(looksLikeText('{} VS {} · {}')).toBe(false);
    expect(looksLikeText('{}.png')).toBe(false);
    expect(looksLikeText('figure.glb')).toBe(false);
    expect(looksLikeText('{} picks left')).toBe(true);
    expect(looksLikeText('Download the file')).toBe(true);
  });

  it('classifies the documented ignore cases', () => {
    expect(looksLikeText('Save')).toBe(true);
    expect(looksLikeText('HP')).toBe(false);
    expect(looksLikeText('·')).toBe(false);
    expect(looksLikeText('flex items-center gap-2')).toBe(false);
    expect(looksLikeText('/leagues/123')).toBe(false);
    expect(looksLikeText('image/png')).toBe(false);
    expect(looksLikeText('Win/Loss')).toBe(true);
    expect(looksLikeText('EvoLiga')).toBe(false);
  });
});

describe('file selection', () => {
  it('globToRegExp treats Next.js segments literally', () => {
    const re = globToRegExp('src/app/(public)/draft-preview/{fixtures,fake-source}.ts');
    expect(re.test('src/app/(public)/draft-preview/fixtures.ts')).toBe(true);
    expect(re.test('src/app/(public)/draft-preview/fake-source.ts')).toBe(true);
    expect(re.test('src/app/(public)/draft-preview/page.tsx')).toBe(false);
    expect(globToRegExp('src/app/[id]/*.tsx').test('src/app/[id]/page.tsx')).toBe(true);
    expect(globToRegExp('src/lib/ai/**/prompts/**').test('src/lib/ai/prompts/system.ts')).toBe(true);
    expect(globToRegExp('src/lib/ai/**/prompts/**').test('src/lib/ai/agent/prompts/x/y.ts')).toBe(true);
  });

  it('isScannable excludes tests, declarations, message dictionaries and non-src files', () => {
    expect(isScannable('src/components/a/B.tsx')).toBe(true);
    expect(isScannable('src/components/a/__tests__/B.test.tsx')).toBe(false);
    expect(isScannable('src/lib/a/b.test.ts')).toBe(false);
    expect(isScannable('src/test/i18n.tsx')).toBe(false);
    expect(isScannable('src/types/next-env.d.ts')).toBe(false);
    expect(isScannable('src/i18n/messages/common/en.ts')).toBe(false);
    expect(isScannable('scripts/check-i18n-strings.mjs')).toBe(false);
  });

  it('the repo allowlist has a reason per glob and lists only the draft-preview fixtures (critique F16)', () => {
    const allowlist = loadAllowlist();
    expect(allowlist.files.every((f) => f.reason.length > 0)).toBe(true);
    expect(isAllowlisted('src/app/(public)/draft-preview/fixtures.ts', allowlist)).toBe(true);
    expect(isAllowlisted('src/app/(public)/draft-preview/fake-source.ts', allowlist)).toBe(true);
    expect(isAllowlisted('src/app/(public)/draft-preview/page.tsx', allowlist)).toBe(false);
    expect(isAllowlisted('src/app/global-error.tsx', allowlist)).toBe(true);
    expect(isAllowlisted('src/app/admin/kale/page.tsx', allowlist)).toBe(true);
    expect(allowlist.tokens).toEqual(expect.arrayContaining(['PokéTools', 'EvoLiga', 'Bo3', 'Buchholz']));
  });

  it('parseArgs accepts several --paths values and rejects mixing with --all', () => {
    expect(parseArgs(['--paths', 'src/a', 'src/b/**'])).toEqual({ all: false, paths: ['src/a', 'src/b/**'] });
    expect(parseArgs(['--all'])).toEqual({ all: true, paths: null });
    expect(() => parseArgs(['--all', '--paths', 'src/a'])).toThrow();
    expect(() => parseArgs(['--paths'])).toThrow();
    expect(() => parseArgs(['--nope'])).toThrow();
  });
});

describe('run() against a scratch repo', () => {
  let root = null;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  function scratch(files) {
    root = mkdtempSync(join(tmpdir(), 'i18n-strings-'));
    const allowlist = {
      files: [{ glob: 'src/components/legacy/**', reason: 'test fixture' }],
      tokens: ['PokéTools'],
    };
    const all = { 'scripts/i18n-allowlist.json': JSON.stringify(allowlist), ...files };
    for (const [path, text] of Object.entries(all)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, 'utf8');
    }
    return root;
  }

  const files = {
    'src/components/a/Card.tsx': 'export function Card() { return <p>Hello there</p>; }',
    'src/components/a/__tests__/Card.test.tsx': 'const x = <p>Ignored test text</p>;',
    'src/components/legacy/Old.tsx': 'const x = <p>Allowlisted text</p>;',
    'src/components/b/Clean.tsx': 'export function Clean({ t }) { return <p>{t("x")}</p>; }',
  };

  it('reports and exits 0 by default', () => {
    const dir = scratch(files);
    const res = run(['--all'], { root: dir, env: {} });
    expect(res.exitCode).toBe(0);
    expect(res.files).toEqual(['src/components/a/Card.tsx', 'src/components/b/Clean.tsx']);
    expect(res.findings.map((f) => `${f.file}:${f.line}`)).toEqual(['src/components/a/Card.tsx:1']);
    expect(res.output).toContain('mode: report-only');
  });

  it('exits 1 under ENFORCE=1 when findings remain', () => {
    const dir = scratch(files);
    expect(run(['--all'], { root: dir, env: { ENFORCE: '1' } }).exitCode).toBe(1);
  });

  it('exits 0 under ENFORCE=1 for clean --paths', () => {
    const dir = scratch(files);
    const res = run(['--paths', 'src/components/b'], { root: dir, env: { ENFORCE: '1' } });
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('OK');
  });

  it('expands globs and directories in --paths', () => {
    const dir = scratch(files);
    expect(expandPaths(['src/components/**/*.tsx'], dir)).toEqual([
      'src/components/a/Card.tsx',
      'src/components/a/__tests__/Card.test.tsx',
      'src/components/b/Clean.tsx',
      'src/components/legacy/Old.tsx',
    ]);
    expect(expandPaths(['src/components/a src/components/b'], dir)).toHaveLength(3);
  });

  it('keeps commas inside a brace glob and splits on commas outside braces (L4)', () => {
    const dir = scratch(files);
    expect(splitPathList('src/types/{draft,evolution}.ts')).toEqual(['src/types/{draft,evolution}.ts']);
    expect(splitPathList('a.ts,b.ts c/{x,{y,z}}.ts')).toEqual(['a.ts', 'b.ts', 'c/{x,{y,z}}.ts']);
    expect(expandPaths(['src/components/{a,b}/*.tsx'], dir)).toEqual([
      'src/components/a/Card.tsx',
      'src/components/b/Clean.tsx',
    ]);
    expect(expandPaths(['src/components/a/Card.tsx,src/components/b/Clean.tsx'], dir)).toEqual([
      'src/components/a/Card.tsx',
      'src/components/b/Clean.tsx',
    ]);
  });

  it('exits 2 when a --paths entry matches nothing, so ENFORCE cannot pass vacuously (Kilo 4245127350)', () => {
    const dir = scratch(files);
    for (const env of [{}, { ENFORCE: '1' }]) {
      const res = run(['--paths', 'src/components/nope/Typo.tsx'], { root: dir, env });
      expect(res.exitCode).toBe(2);
      expect(res.output).toContain('--paths matched no file for: "src/components/nope/Typo.tsx"');
    }
    // One good entry does not hide a bad one, glob or directory.
    const mixed = run(['--paths', 'src/components/b', 'src/components/zz/**/*.tsx'], { root: dir, env: { ENFORCE: '1' } });
    expect(mixed.exitCode).toBe(2);
    expect(mixed.output).toContain('"src/components/zz/**/*.tsx"');
    mkdirSync(join(dir, 'src/components/empty'), { recursive: true });
    expect(run(['--paths', 'src/components/empty'], { root: dir, env: {} }).exitCode).toBe(2);
  });

  it('fails under ENFORCE when --paths selects no scannable file, warns otherwise', () => {
    const dir = scratch({ ...files, 'scripts/tool.mjs': 'export {};' });
    const enforced = run(['--paths', 'scripts/tool.mjs', 'src/components/a/__tests__'], { root: dir, env: { ENFORCE: '1' } });
    expect(enforced.exitCode).toBe(2);
    expect(enforced.output).toContain('selected no scannable');
    const report = run(['--paths', 'scripts/tool.mjs'], { root: dir, env: {} });
    expect(report.exitCode).toBe(0);
    expect(report.output).toContain('warning: --paths selected no scannable');
    // Mixed with a scannable file the non-src entry is fine.
    expect(run(['--paths', 'scripts/tool.mjs', 'src/components/b'], { root: dir, env: { ENFORCE: '1' } }).exitCode).toBe(0);
  });

  it('exits 2 on a malformed allowlist', () => {
    const dir = scratch({ ...files, 'scripts/i18n-allowlist.json': '{"files": [{"glob": "x"}], "tokens": []}' });
    expect(run(['--all'], { root: dir, env: {} }).exitCode).toBe(2);
  });

  it('changed-files mode scans files added or modified since BASE, top-level src files included', () => {
    const dir = scratch({ 'src/components/b/Clean.tsx': files['src/components/b/Clean.tsx'] });
    const git = (...args) => {
      const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
      return res.stdout.trim();
    };
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    const added = {
      'src/middleware.ts': 'export const config = { matcher: [] };',
      'src/components/a/Card.tsx': files['src/components/a/Card.tsx'],
      'docs/notes.ts': 'export const x = 1;',
    };
    for (const [path, text] of Object.entries(added)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text, 'utf8');
    }
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'change');

    expect(CHANGED_PATHSPECS.every((p) => p.startsWith(':(glob)'))).toBe(true);
    const res = run([], { root: dir, env: { BASE: base } });
    expect(res.exitCode).toBe(0);
    expect(res.files).toEqual(['src/components/a/Card.tsx', 'src/middleware.ts']);
    expect(res.findings.map((f) => f.file)).toEqual(['src/components/a/Card.tsx']);
    expect(res.output).toContain(`changed vs ${base}`);
  });

  it('changed-files mode exits 2 when BASE cannot be resolved', () => {
    const dir = scratch(files);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    expect(run([], { root: dir, env: { BASE: 'no-such-ref' } }).exitCode).toBe(2);
  });
});
