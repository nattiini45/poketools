import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const exec = promisify(execFile);

async function runFixture(source, { project = 'app', env = {}, transportSpy = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'unit-isolation-'));
  const fixture = join(dir, 'probe.test.ts');
  const config = join(dir, 'vitest.config.mts');
  const transport = join(dir, 'transport.ts');
  if (transportSpy) writeFileSync(transport, `
    globalThis.transportRequests = 0;
    globalThis.fetch = async () => {
      globalThis.transportRequests += 1;
      return new Response('intercepted');
    };
  `);
  writeFileSync(fixture, source);
  writeFileSync(config, `
    import base from ${JSON.stringify(join(root, 'vitest.config.ts'))};
    export default {
      ...base,
      test: {
        ...base.test,
        projects: base.test.projects.filter(p => p.test.name === ${JSON.stringify(project)}).map(p => ({
          ...p, test: {
            ...p.test,
            setupFiles: [${transportSpy ? JSON.stringify(transport) + ',' : ''} ...p.test.setupFiles],
            include: [${JSON.stringify(fixture)}], exclude: []
          }
        }))
      }
    };
  `);
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.includes('SUPABASE') || key.startsWith('LOCAL_DB_') || key === 'DATABASE_URL') delete childEnv[key];
  }
  try {
    const result = await exec(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--maxWorkers=1'], {
      cwd: root,
      env: {
        ...childEnv,
        FORMAT_PACK: 'example',
        LOCAL_STACK_DB: '0',
        NEXT_PUBLIC_SUPABASE_URL: 'https://poison.supabase.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-hosted-service-key',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-hosted-anon-key',
        SUPABASE_ACCESS_TOKEN: 'fake-hosted-access-token',
        SUPABASE_URL: 'https://poison.supabase.invalid',
        DATABASE_URL: 'postgres://fake:fake@poison.example/test',
        LOCAL_DB_SERVICE_ROLE_KEY: 'fake-hosted-local-alias',
        ...env,
      },
      timeout: 30_000,
      maxBuffer: 2_000_000,
    }).catch(error => ({ code: error.code ?? 1, stdout: error.stdout, stderr: error.stderr }));
    return { code: result.code ?? 0, output: result.stdout + result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('unit worker isolation', () => {
  it.each([['app', '0'], ['scripts', '0'], ['app', '1']])('%s replaces inherited hosted configuration with LOCAL_STACK_DB=%s and permits fetch mocks', async (project, db) => {
    const result = await runFixture(`
      import { expect, it, vi } from 'vitest';
      it('has only dummy credentials', async () => {
        expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co');
        expect(import.meta.env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co');
        expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('dummy-service-role-key');
        expect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('dummy-anon-key');
        expect(process.env.SUPABASE_ACCESS_TOKEN).toBeUndefined();
        expect(process.env.SUPABASE_URL).toBeUndefined();
        expect(process.env.DATABASE_URL).toBeUndefined();
        expect(process.env.LOCAL_DB_SERVICE_ROLE_KEY).toBeUndefined();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('mocked')));
        expect(await (await fetch('https://poison.supabase.invalid/rest/v1/rpc/rate_limit_hit')).text()).toBe('mocked');
        vi.unstubAllGlobals();
        await expect(fetch('/api/catalog')).rejects.toThrow();
        expect(await (await fetch('data:text/plain,local')).text()).toBe('local');
      });
    `, { project, env: { LOCAL_STACK_DB: db } });
    expect(result.output).not.toContain('fake-hosted-service-key');
    expect(result.code, result.output).toBe(0);
  });

  it('fails even when Supabase or application code swallows a refused request, before any socket opens', async () => {
    let requests = 0;
    let connections = 0;
    const server = createServer((_req, res) => { requests += 1; res.end('unexpected'); });
    server.on('connection', () => { connections += 1; });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
      const result = await runFixture(`
        import { it, vi } from 'vitest';
        import { get } from 'node:http';
        import { get as httpsGet } from 'node:https';
        import { supabase } from ${JSON.stringify(join(root, 'src/lib/supabase/client.ts'))};
        it('cannot hide missing mocks', async () => {
          vi.restoreAllMocks();
          vi.unstubAllGlobals();
          await supabase.rpc('rate_limit_hit', { p_key: 'test', p_window_seconds: 60, p_max: 1 });
          for (const path of ['rest/v1/rpc/rate_limit_hit', 'auth/v1/token', 'storage/v1/object/test']) {
            try { await fetch('https://poison.supabase.invalid/' + path); } catch {}
          }
          try { await fetch('http://127.0.0.1:${address.port}/rest/v1/'); } catch {}
          try { get('http://127.0.0.1:${address.port}/auth/v1/'); } catch {}
          try { httpsGet('https://127.0.0.1:${address.port}/storage/v1/'); } catch {}
        });
      `);
      expect(result.code, result.output).not.toBe(0);
      expect(result.output).toContain('[unit-isolation]');
      expect(result.output).toContain('7 unmocked network attempt(s)');
      expect(result.output).toContain('including errors swallowed by application code');
      expect(requests).toBe(0);
      expect(connections).toBe(0);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('normalizes URLs before enforcing the public dataset exception without invoking the underlying transport', async () => {
    const result = await runFixture(`
      import { expect, it } from 'vitest';
      it('cannot bypass the GET/path restriction with whitespace', async () => {
        try { await fetch(' https://pkmn.github.io/outside-dataset', { method: 'POST' }); } catch {}
        try { await fetch('ht\\ttps://pkmn.github.io/smogon/data/test', { method: 'POST' }); } catch {}
        expect(globalThis.transportRequests).toBe(0);
        expect(await (await fetch(' https://pkmn.github.io/smogon/data/test')).text()).toBe('intercepted');
        expect(globalThis.transportRequests).toBe(1);
      });
    `, { transportSpy: true });
    expect(result.code, result.output).not.toBe(0);
    expect(result.output).toContain('2 unmocked network attempt(s)');
    expect(result.output).not.toContain('AssertionError');
  });

  it('preserves the opt-in DB project credentials and loopback guard without opening a database', async () => {
    const source = `
      import { expect, it } from 'vitest';
      it('keeps explicit local config', () => {
        expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
        expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('fake-local-service-key');
        expect(process.env.LOCAL_STACK).toBe('1');
      });
    `;
    const local = await runFixture(source, { project: 'db', env: {
      LOCAL_STACK_DB: '1', LOCAL_STACK_CI: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'fake-local-service-key',
    } });
    expect(local.code, local.output).toBe(0);
    const hosted = await runFixture(source, { project: 'db', env: { LOCAL_STACK_DB: '1', LOCAL_STACK_CI: '1' } });
    expect(hosted.code).not.toBe(0);
    expect(hosted.output).toContain('not the loopback interface');
    const ci = await runFixture(source, { project: 'db', env: {
      LOCAL_STACK_DB: '1', CI: 'true', LOCAL_STACK_CI: '0', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    } });
    expect(ci.code).not.toBe(0);
    expect(ci.output).toContain('refusing to run on CI');
  });

  it('allows only an owned fixture endpoint, refuses redirects, and revokes access on close', async () => {
    let requests = 0;
    const server = createServer((_req, res) => { requests += 1; res.end('unexpected'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
      const result = await runFixture(`
        import { expect, it } from 'vitest';
        import { createServer } from 'node:http';
        import { allowLoopbackFixture } from ${JSON.stringify(join(root, 'src/test/loopback-fixture.ts'))};
        it('limits the exception to its listening server', async () => {
          expect(() => allowLoopbackFixture(createServer())).toThrow('must own a listening loopback TCP server');
          const fixture = createServer((req, res) => {
            if (req.url === '/redirect') {
              res.writeHead(302, { location: 'http://127.0.0.1:${address.port}/rest/v1/' });
            }
            res.end('owned');
          });
          await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
          allowLoopbackFixture(fixture);
          const url = 'http://127.0.0.1:' + fixture.address().port;
          try {
            expect(await (await fetch(url + '/rest/v1/')).text()).toBe('owned');
            try { await fetch('http://127.0.0.1:${address.port}/rest/v1/'); } catch {}
            try { await fetch(url + '/redirect'); } catch {}
          } finally {
            fixture.closeAllConnections();
            await new Promise(resolve => fixture.close(resolve));
          }
          try { await fetch(url + '/rest/v1/'); } catch {}
        });
      `);
      expect(result.code, result.output).not.toBe(0);
      expect(result.output).toContain('3 unmocked network attempt(s)');
      expect(requests).toBe(0);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('allows the DB project to reach an explicitly configured loopback HTTP fixture', async () => {
    let requests = 0;
    const server = createServer((_req, res) => { requests += 1; res.end('local fixture'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    try {
      const result = await runFixture(`
        import { expect, it } from 'vitest';
        it('retains local transport', async () => {
          const response = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/');
          expect(await response.text()).toBe('local fixture');
        });
      `, { project: 'db', env: {
        LOCAL_STACK_DB: '1', LOCAL_STACK_CI: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:' + address.port,
        SUPABASE_SERVICE_ROLE_KEY: 'fake-local-service-key',
      } });
      expect(result.code, result.output).toBe(0);
      expect(requests).toBe(1);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
