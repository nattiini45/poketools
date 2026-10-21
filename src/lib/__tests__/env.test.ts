import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertBootEnv,
  bootEnvSchemas,
  bootstrapEnvSchema,
  bootstrapModeEnvSchema,
  discordOAuthEnvSchema,
  MissingEnvError,
  rateLimitEnvSchema,
  readEnv,
  requireEnv,
  supabaseAuthEnvSchema,
  supabaseServerEnvSchema,
} from '@/lib/env';

const SECRET = 'sk-sentinel-should-never-appear';

afterEach(() => {
  vi.unstubAllEnvs();
});

function readError(fn: () => unknown): MissingEnvError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MissingEnvError);
    return err as MissingEnvError;
  }
  throw new Error('expected readEnv to throw');
}

describe('readEnv', () => {
  it('returns the raw values unchanged when the group is valid', () => {
    const env = readEnv(supabaseServerEnvSchema, {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: '  key-with-spaces  ',
    });
    expect(env).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: '  key-with-spaces  ',
    });
  });

  it('returns only the keys of the schema', () => {
    const env = readEnv(discordOAuthEnvSchema, {
      DISCORD_CLIENT_ID: 'id',
      DISCORD_CLIENT_SECRET: 'secret',
      UNRELATED: 'x',
    });
    expect(Object.keys(env).sort()).toEqual(['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET']);
  });

  it('reports every missing key of the group in one error, not just the first', () => {
    const err = readError(() => readEnv(supabaseServerEnvSchema, {}));
    expect(err.problems).toEqual([
      { key: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'missing' },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', reason: 'missing' },
    ]);
    expect(err.name).toBe('MissingEnvError');
    expect(err.message).toContain('NEXT_PUBLIC_SUPABASE_URL (missing), SUPABASE_SERVICE_ROLE_KEY (missing)');
    expect(err.message).toContain('Copy .env.example to .env.local');
  });

  it.each(['', '   ', '\t'])('treats %j as missing', (value) => {
    const err = readError(() =>
      readEnv(discordOAuthEnvSchema, { DISCORD_CLIENT_ID: value, DISCORD_CLIENT_SECRET: 'ok' })
    );
    expect(err.problems).toEqual([{ key: 'DISCORD_CLIENT_ID', reason: 'missing' }]);
  });

  it.each(['not a url', 'ftp://example.com', 'javascript:alert(1)'])(
    'reports a non-http(s) Supabase URL %j as invalid',
    (value) => {
      const err = readError(() =>
        readEnv(supabaseAuthEnvSchema, { NEXT_PUBLIC_SUPABASE_URL: value, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' })
      );
      expect(err.problems).toEqual([{ key: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'not an http(s) URL' }]);
    }
  );

  it('never puts a value into the error message', () => {
    const err = readError(() =>
      readEnv(supabaseServerEnvSchema, { NEXT_PUBLIC_SUPABASE_URL: SECRET, SUPABASE_SERVICE_ROLE_KEY: '' })
    );
    expect(err.message).not.toContain(SECRET);
    expect(JSON.stringify(err.problems)).not.toContain(SECRET);
  });

  it('keeps the wording scripts/run-season-audit.ts classifies as an infrastructure error', () => {
    const err = readError(() => readEnv(discordOAuthEnvSchema, {}));
    expect(err.message).toMatch(/Missing required environment variable/i);
  });

  it('reads process.env by default', () => {
    vi.stubEnv('DISCORD_CLIENT_ID', 'from-env-id');
    vi.stubEnv('DISCORD_CLIENT_SECRET', 'from-env-secret');
    expect(readEnv(discordOAuthEnvSchema)).toEqual({
      DISCORD_CLIENT_ID: 'from-env-id',
      DISCORD_CLIENT_SECRET: 'from-env-secret',
    });
  });

  it('accepts the hosted and local Supabase URL shapes', () => {
    for (const url of ['https://abcdefghijklmnop.supabase.co', 'http://127.0.0.1:54321', 'https://placeholder.supabase.co']) {
      expect(readEnv(supabaseServerEnvSchema, { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'k' }))
        .toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: url });
    }
  });
});

describe('rateLimitEnvSchema', () => {
  it('accepts postgres, memory and unset; trims and treats blank as unset', () => {
    expect(readEnv(rateLimitEnvSchema, {})).toEqual({ RATE_LIMIT_STORE: undefined, VERCEL: undefined });
    expect(readEnv(rateLimitEnvSchema, { RATE_LIMIT_STORE: ' postgres ', VERCEL: '1' })).toEqual({
      RATE_LIMIT_STORE: 'postgres',
      VERCEL: '1',
    });
    expect(readEnv(rateLimitEnvSchema, { RATE_LIMIT_STORE: 'memory' }).RATE_LIMIT_STORE).toBe('memory');
    expect(readEnv(rateLimitEnvSchema, { RATE_LIMIT_STORE: '   ', VERCEL: '' })).toEqual({
      RATE_LIMIT_STORE: undefined,
      VERCEL: undefined,
    });
  });

  it.each(['redis', 'Postgres', 'durable'])('rejects RATE_LIMIT_STORE=%j without echoing it', (value) => {
    const err = readError(() => readEnv(rateLimitEnvSchema, { RATE_LIMIT_STORE: value }));
    expect(err.problems).toEqual([{ key: 'RATE_LIMIT_STORE', reason: "must be 'postgres' or 'memory' (or unset)" }]);
    expect(err.message).not.toContain(value);
  });
});

describe('assertBootEnv (fail fast at server boot, lead ruling round 5)', () => {
  it('passes for a valid or unset RATE_LIMIT_STORE', () => {
    for (const source of [{}, { RATE_LIMIT_STORE: 'memory' }, { RATE_LIMIT_STORE: ' postgres ', VERCEL: '1' }]) {
      expect(() => assertBootEnv(source)).not.toThrow();
    }
  });

  it('throws one MissingEnvError naming RATE_LIMIT_STORE for an invalid value, without echoing it', () => {
    const err = readError(() => assertBootEnv({ RATE_LIMIT_STORE: 'redis' }));
    expect(err.problems).toEqual([{ key: 'RATE_LIMIT_STORE', reason: "must be 'postgres' or 'memory' (or unset)" }]);
    expect(err.message).not.toContain('redis');
  });

  it('reads process.env by default', () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'durable');
    expect(() => assertBootEnv()).toThrow(MissingEnvError);
  });

  it('covers the rate limiter group', () => {
    expect(bootEnvSchemas).toContain(rateLimitEnvSchema);
  });
});

describe('instrumentation register()', () => {
  it('validates the boot env in the Node.js runtime and stops the boot on an invalid value', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('RATE_LIMIT_STORE', 'redis');
    const { register } = await import('@/instrumentation');
    await expect(register()).rejects.toThrow(MissingEnvError);
    vi.stubEnv('RATE_LIMIT_STORE', 'memory');
    await expect(register()).resolves.toBeUndefined();
  });

  it('skips the edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    vi.stubEnv('RATE_LIMIT_STORE', 'redis');
    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
  });
});

describe('bootstrapEnvSchema', () => {
  it('treats unset, empty and whitespace-only BOOTSTRAP_SECRET as not configured', () => {
    for (const source of [{}, { BOOTSTRAP_SECRET: '' }, { BOOTSTRAP_SECRET: '   ' }]) {
      expect(readEnv(bootstrapEnvSchema, source)).toEqual({ BOOTSTRAP_SECRET: undefined });
    }
  });

  it('keeps a set secret exactly as written (no trimming: it is compared byte for byte)', () => {
    expect(readEnv(bootstrapEnvSchema, { BOOTSTRAP_SECRET: ` ${SECRET} ` }).BOOTSTRAP_SECRET).toBe(` ${SECRET} `);
  });
});

describe('bootstrapModeEnvSchema', () => {
  it("reads 'true' / 'false' and treats unset or blank as off", () => {
    expect(readEnv(bootstrapModeEnvSchema, { BOOTSTRAP_MODE_ENABLED: 'true' }).BOOTSTRAP_MODE_ENABLED).toBe('true');
    expect(readEnv(bootstrapModeEnvSchema, { BOOTSTRAP_MODE_ENABLED: ' false ' }).BOOTSTRAP_MODE_ENABLED).toBe('false');
    for (const source of [{}, { BOOTSTRAP_MODE_ENABLED: '' }]) {
      expect(readEnv(bootstrapModeEnvSchema, source).BOOTSTRAP_MODE_ENABLED).toBeUndefined();
    }
  });

  it('throws MissingEnvError for any other value (a typo never enables or silently disables it)', () => {
    expect(() => readEnv(bootstrapModeEnvSchema, { BOOTSTRAP_MODE_ENABLED: 'yes' })).toThrow(MissingEnvError);
  });
});

describe('requireEnv', () => {
  it('returns a set value', () => {
    vi.stubEnv('SOME_KEY', 'value');
    expect(requireEnv('SOME_KEY')).toBe('value');
  });

  it('throws the single-key message for an unset or empty value', () => {
    vi.stubEnv('SOME_KEY', '');
    expect(() => requireEnv('SOME_KEY')).toThrow('Missing required environment variable: SOME_KEY');
  });
});

describe('env schemas stay documented', () => {
  const example = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
  const keys = [
    ...Object.keys(supabaseServerEnvSchema.shape),
    ...Object.keys(supabaseAuthEnvSchema.shape),
    ...Object.keys(discordOAuthEnvSchema.shape),
    ...Object.keys(rateLimitEnvSchema.shape),
    ...Object.keys(bootstrapEnvSchema.shape),
  ];

  it.each([...new Set(keys)])('%s is listed in .env.example', (key) => {
    expect(example).toMatch(new RegExp(`^#?\\s*${key}=`, 'm'));
  });
});
