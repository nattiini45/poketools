import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structure rules of the assistant's routes, pages and components (plan 3.2, 3.9, 6.1; AGENTS.md). They read the source, so
 * a later edit that breaks a rule fails here instead of in review.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const ROUTES = path.join(ROOT, 'src/app/api/admin/agent');
const COMPONENTS = path.join(ROOT, 'src/components/admin/assistant');
const PAGES = path.join(ROOT, 'src/app/admin/assistant');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== '_ops') out.push(...walk(full));
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const read = (file: string) => readFileSync(file, 'utf8');
/** Source without comments, so prose in a header cannot trip a code rule. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const routeFiles = walk(ROUTES).filter((file) => file.endsWith('route.ts'));
const libFiles = walk(path.join(ROUTES, '_lib'));
const componentFiles = walk(COMPONENTS);
const pageFiles = walk(PAGES);

const importsOf = (file: string): string[] => [...code(file).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('the route table', () => {
  it('is exactly the routes of the spec table that exist in phase 0', () => {
    expect(routeFiles.map((file) => path.relative(ROUTES, file).split(path.sep).join('/')).sort()).toEqual([
      'conversations/[id]/messages/route.ts',
      'conversations/[id]/route.ts',
      'conversations/route.ts',
      'proposals/[id]/approve/route.ts',
      'proposals/[id]/decline/route.ts',
      'proposals/[id]/resume/route.ts',
      'proposals/[id]/route.ts',
    ]);
  });

  it.each(routeFiles.map((file) => [rel(file), file]))('%s runs the live guard and the audience check before anything else', (_name, file) => {
    const text = code(file);
    const body = text.slice(text.indexOf('try {'));
    const guard = body.indexOf('authorizeAgent(');
    expect(guard).toBeGreaterThan(-1);
    for (const later of ['adminAgentStore', 'getAdminAgent', 'readAgentJson', 'checkRateLimit', 'getCard', 'getApprovalToken']) {
      const at = body.indexOf(later);
      if (at !== -1) expect(at, later).toBeGreaterThan(guard);
    }
  });

  it.each(routeFiles.map((file) => [rel(file), file]))('%s answers failures through safeErrorResponse and exports only handlers', (_name, file) => {
    const text = code(file);
    expect(text).toMatch(/catch \(err\) \{\s*return safeErrorResponse\(err,/);
    expect(text).not.toMatch(/\.message\b/);
    expect(text).not.toMatch(/\bconsole\.error\(err/);
    const exports = [...text.matchAll(/export (?:async function|const) (\w+)/g)].map((m) => m[1]);
    expect(exports.filter((name) => !['GET', 'POST', 'maxDuration'].includes(name))).toEqual([]);
  });

  it.each(routeFiles.filter((file) => /export async function POST/.test(read(file))).map((file) => [rel(file), file]))(
    '%s refuses a missing or cross-site origin',
    (_name, file) => {
      expect(code(file)).toContain('assertSameOriginRequest(request)');
    },
  );

  it('names every limiter bucket within the limiter\'s pattern and fails closed', () => {
    const buckets: string[] = [];
    for (const file of [...routeFiles, path.join(ROUTES, '_lib/approve.ts')]) {
      for (const match of code(file).matchAll(/checkRateLimit\(\s*'([^']+)'[\s\S]*?\)/g)) {
        buckets.push(match[1]);
        expect(match[0], `${rel(file)} ${match[1]}`).toContain("failMode: 'closed'");
      }
    }
    expect(buckets.sort()).toEqual(['admin-agent-decline', 'admin-agent-new', 'admin-agent-turn', 'admin-agent-write']);
    for (const bucket of buckets) expect(bucket).toMatch(/^[a-z0-9][a-z0-9:_-]{0,63}$/);
  });

  it('only the chat route and the two routes that run steps set a duration, and it is 300 seconds', () => {
    const withDuration = routeFiles.filter((file) => /export const maxDuration/.test(code(file)));
    expect(withDuration.map(rel).sort()).toEqual([
      'src/app/api/admin/agent/conversations/[id]/messages/route.ts',
      'src/app/api/admin/agent/proposals/[id]/approve/route.ts',
      'src/app/api/admin/agent/proposals/[id]/resume/route.ts',
    ]);
    for (const file of withDuration) expect(code(file)).toContain('export const maxDuration = 300;');
  });
});

describe('the chat route', () => {
  const chat = path.join(ROUTES, 'conversations/[id]/messages/route.ts');

  it('is not tied to the connection: no request signal, and the completion goes to after()', () => {
    const text = code(chat);
    expect(text).not.toMatch(/\.signal\b|AbortController|\.aborted\b/);
    expect(text).toMatch(/after\(started\.completion\)/);
    expect(text).toMatch(/new Response\(started\.stream, \{ headers: SSE_HEADERS \}\)/);
  });

  it('cannot reach an approval token or an executor, directly or through the files it shares', () => {
    // `approve.ts` is the approve side's wiring (it imports the executor on purpose); only approve and resume import it.
    for (const file of [chat, ...libFiles.filter((f) => !/views\.ts$|plan-view\.ts$|seed\.ts$|approve\.ts$/.test(f))]) {
      for (const specifier of importsOf(file)) {
        expect(specifier, rel(file)).not.toMatch(/proposals\/serve|executor|_ops/);
      }
    }
  });

  it('takes its history from the server by id: the body carries no history', () => {
    const text = code(chat);
    expect(text).not.toMatch(/messages\s*:\s*z\./);
    expect(text).toContain('client_msg_id');
  });
});

describe('the assistant\'s own tables', () => {
  it.each([...routeFiles, ...libFiles, ...componentFiles, ...pageFiles].map((file) => [rel(file), file]))('%s never names an admin_agent table or function', (_name, file) => {
    expect(code(file)).not.toMatch(/admin_agent_/);
    expect(code(file)).not.toMatch(/\.from\(\s*['"`]/);
    expect(code(file)).not.toMatch(/\.rpc\(/);
  });
});

describe('the client', () => {
  it.each(componentFiles.map((file) => [rel(file), file]))('%s uses fetch only: no Supabase client, no server module', (_name, file) => {
    const text = code(file);
    for (const specifier of importsOf(file)) {
      expect(specifier, rel(file)).not.toMatch(/^@\/lib\/supabase|^@supabase\/|server-only|^@\/lib\/auth\/|^@\/auth$/);
    }
    // The lib types the shared view shapes borrow are erased at build time; a runtime import from the assistant core would
    // pull server code (and the plan schema) into the browser bundle.
    for (const match of text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(@\/lib\/ai\/admin-agent[^']*)'/gms)) {
      throw new Error(`${rel(file)} imports ${match[1]} at runtime`);
    }
    expect(text).not.toMatch(/dangerouslySetInnerHTML|\beval\(|new Function\(/);
  });

  it('the stream reader never follows the request: it reads the response body and stops when it ends', () => {
    const sse = code(path.join(COMPONENTS, 'sse.ts'));
    expect(sse).toContain('getReader()');
    expect(sse).not.toMatch(/EventSource/);
  });

  it('pages run the live gate, never the token copy', () => {
    for (const file of pageFiles.filter((f) => /page\.tsx$/.test(f))) {
      const text = code(file);
      expect(text, rel(file)).toContain('assistantPageGate()');
      expect(text, rel(file)).not.toMatch(/getSessionPlayer|isAdmin\(|isAnyAdmin\(\)/);
    }
    expect(code(path.join(PAGES, 'gate.ts'))).toContain('getLiveAccess()');
  });
});
