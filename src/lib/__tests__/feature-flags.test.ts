import { describe, it, expect, vi, afterEach } from 'vitest';

// ─── Tests ────────────────────────────────────────────────────────

describe('ENABLE_KALE_CABBAGE', () => {
  const originalEnv = process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE;

  afterEach(() => {
    // Restore original env value
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE;
    } else {
      process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE = originalEnv;
    }
    vi.resetModules();
  });

  it('is true when env var is "true"', async () => {
    process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE = 'true';
    vi.resetModules();
    const { ENABLE_KALE_CABBAGE } = await import('../feature-flags');
    expect(ENABLE_KALE_CABBAGE).toBe(true);
  });

  it('is false when env var is "false"', async () => {
    process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE = 'false';
    vi.resetModules();
    const { ENABLE_KALE_CABBAGE } = await import('../feature-flags');
    expect(ENABLE_KALE_CABBAGE).toBe(false);
  });

  it('is false when env var is undefined', async () => {
    delete process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE;
    vi.resetModules();
    const { ENABLE_KALE_CABBAGE } = await import('../feature-flags');
    expect(ENABLE_KALE_CABBAGE).toBe(false);
  });

  it('is false when env var is empty string', async () => {
    process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE = '';
    vi.resetModules();
    const { ENABLE_KALE_CABBAGE } = await import('../feature-flags');
    expect(ENABLE_KALE_CABBAGE).toBe(false);
  });

  it('is false when env var is "TRUE" (case-sensitive)', async () => {
    process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE = 'TRUE';
    vi.resetModules();
    const { ENABLE_KALE_CABBAGE } = await import('../feature-flags');
    expect(ENABLE_KALE_CABBAGE).toBe(false);
  });

  it('is false when env var is "1"', async () => {
    process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE = '1';
    vi.resetModules();
    const { ENABLE_KALE_CABBAGE } = await import('../feature-flags');
    expect(ENABLE_KALE_CABBAGE).toBe(false);
  });
});

describe('ENABLE_AGENT_MATCH_ANALYSIS', () => {
  const originalEnv = process.env.NEXT_PUBLIC_AGENT_MATCH_ANALYSIS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_AGENT_MATCH_ANALYSIS;
    } else {
      process.env.NEXT_PUBLIC_AGENT_MATCH_ANALYSIS = originalEnv;
    }
    vi.resetModules();
  });

  it('is true when env var is "true" (agent path on)', async () => {
    process.env.NEXT_PUBLIC_AGENT_MATCH_ANALYSIS = 'true';
    vi.resetModules();
    const { ENABLE_AGENT_MATCH_ANALYSIS } = await import('../feature-flags');
    expect(ENABLE_AGENT_MATCH_ANALYSIS).toBe(true);
  });

  it('defaults OFF when env var is undefined (cards keep the legacy routes)', async () => {
    delete process.env.NEXT_PUBLIC_AGENT_MATCH_ANALYSIS;
    vi.resetModules();
    const { ENABLE_AGENT_MATCH_ANALYSIS } = await import('../feature-flags');
    expect(ENABLE_AGENT_MATCH_ANALYSIS).toBe(false);
  });

  it('is false when env var is "false"', async () => {
    process.env.NEXT_PUBLIC_AGENT_MATCH_ANALYSIS = 'false';
    vi.resetModules();
    const { ENABLE_AGENT_MATCH_ANALYSIS } = await import('../feature-flags');
    expect(ENABLE_AGENT_MATCH_ANALYSIS).toBe(false);
  });
});

describe('ENABLE_AGENT_POST_MATCH', () => {
  const originalEnv = process.env.NEXT_PUBLIC_AGENT_POST_MATCH;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_AGENT_POST_MATCH;
    } else {
      process.env.NEXT_PUBLIC_AGENT_POST_MATCH = originalEnv;
    }
    vi.resetModules();
  });

  it('is true when env var is "true" (post-match runs through the agent)', async () => {
    process.env.NEXT_PUBLIC_AGENT_POST_MATCH = 'true';
    vi.resetModules();
    const { ENABLE_AGENT_POST_MATCH } = await import('../feature-flags');
    expect(ENABLE_AGENT_POST_MATCH).toBe(true);
  });

  it('defaults OFF when env var is undefined (card keeps the legacy route)', async () => {
    delete process.env.NEXT_PUBLIC_AGENT_POST_MATCH;
    vi.resetModules();
    const { ENABLE_AGENT_POST_MATCH } = await import('../feature-flags');
    expect(ENABLE_AGENT_POST_MATCH).toBe(false);
  });

  it('is independent of the scouting flag', async () => {
    process.env.NEXT_PUBLIC_AGENT_POST_MATCH = 'true';
    process.env.NEXT_PUBLIC_AGENT_MATCH_ANALYSIS = 'false';
    vi.resetModules();
    const { ENABLE_AGENT_POST_MATCH, ENABLE_AGENT_MATCH_ANALYSIS } = await import('../feature-flags');
    expect(ENABLE_AGENT_POST_MATCH).toBe(true);
    expect(ENABLE_AGENT_MATCH_ANALYSIS).toBe(false);
  });
});

describe('ENABLE_ADMIN_ASSISTANT', () => {
  const originalEnv = process.env.NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT;
    } else {
      process.env.NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT = originalEnv;
    }
    vi.resetModules();
  });

  it('is true when env var is "true"', async () => {
    process.env.NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT = 'true';
    vi.resetModules();
    const { ENABLE_ADMIN_ASSISTANT } = await import('../feature-flags');
    expect(ENABLE_ADMIN_ASSISTANT).toBe(true);
  });

  it('defaults OFF when env var is undefined (the assistant UI stays hidden)', async () => {
    delete process.env.NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT;
    vi.resetModules();
    const { ENABLE_ADMIN_ASSISTANT } = await import('../feature-flags');
    expect(ENABLE_ADMIN_ASSISTANT).toBe(false);
  });

  it('is false for "false", empty, "TRUE" and "1" (exact "true" only)', async () => {
    for (const value of ['false', '', 'TRUE', '1']) {
      process.env.NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT = value;
      vi.resetModules();
      const { ENABLE_ADMIN_ASSISTANT } = await import('../feature-flags');
      expect(ENABLE_ADMIN_ASSISTANT, value).toBe(false);
    }
  });

  it('is independent of the server switch ADMIN_AGENT_ENABLED', async () => {
    process.env.NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT = 'true';
    vi.stubEnv('ADMIN_AGENT_ENABLED', 'false');
    vi.resetModules();
    const { ENABLE_ADMIN_ASSISTANT } = await import('../feature-flags');
    expect(ENABLE_ADMIN_ASSISTANT).toBe(true);
    vi.unstubAllEnvs();
  });
});
