import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingEnvError } from '@/lib/env';
import {
  adminAgentEnvSchema,
  agentEnabledFor,
  agentPhaseAllowed,
  assertAdminAgentBootEnv,
  parseAdminAgentEnv,
} from '../env';

const ON = { ADMIN_AGENT_ENABLED: 'true' };
const SITE_ADMIN = { playerId: '11111111-1111-4111-8111-111111111111', isSiteAdmin: true, isAnyAdmin: true };
const LEAGUE_ADMIN = { playerId: '22222222-2222-4222-8222-222222222222', isSiteAdmin: false, isAnyAdmin: true };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseAdminAgentEnv defaults (everything off, narrowest, Q7 caps)', () => {
  const config = parseAdminAgentEnv({});

  it('is off with no variables set', () => {
    expect(config.requested).toBe(false);
    expect(config.enabled).toBe(false);
    expect(config.golive).toBe(false);
    expect(config.problems).toEqual([]);
  });

  it('defaults to the site audience, phase 0 and no allow-list', () => {
    expect(config.roles).toBe('site');
    expect(config.maxPhase).toBe(0);
    expect(config.allowedPlayerIds).toBeNull();
    expect(config.allowHosted).toBe(false);
    expect(config.liveDb).toBe(false);
  });

  it('defaults the dollar caps to $5 per conversation (warn $3), $20 per admin per day, $120 per admin per month, $80 per day overall', () => {
    expect(config.budgets).toEqual({
      conversationMicro: 5_000_000,
      conversationWarnMicro: 3_000_000,
      adminDayMicro: 20_000_000,
      adminMonthMicro: 120_000_000,
      globalDayMicro: 80_000_000,
    });
  });

  it('defaults the limits to the values of spec 18.10', () => {
    expect(config.limits).toEqual({
      turnsPerHour: 40,
      writesPerHour: 60,
      maxTextChars: 8000,
      maxStepsPerTurn: 12,
      maxToolCallsPerTurn: 30,
      maxStagingsPerTurn: 4,
      turnDeadlineSeconds: 240,
      contextRefusePercent: 80,
      maxBuildSteps: 40,
      maxBuildCreates: 10,
    });
    expect(config.caps).toEqual({
      leagueCreates: 3,
      tournamentCreates: 3,
      rulesetCreates: 5,
      formatCreates: 8,
      golive: 6,
      pinTargets: 50,
    });
    expect(config.proposalTtlMinutes).toEqual({ build: 60, golive: 15 });
  });

  it('defaults the models to Opus medium (write), Sonnet medium (read) and Haiku low (small)', () => {
    expect(config.models).toEqual({
      write: { model: 'claude-opus-5-5', effort: 'medium' },
      read: { model: 'claude-sonnet-5-5', effort: 'medium' },
      small: { model: 'claude-haiku-5-5', effort: 'low' },
    });
  });

  it('treats blank and whitespace-only values as unset', () => {
    const blank = parseAdminAgentEnv({
      ADMIN_AGENT_ENABLED: '  ',
      ADMIN_AGENT_MAX_PHASE: '',
      ADMIN_AGENT_ROLES: ' ',
      ADMIN_AGENT_ALLOWED_PLAYER_IDS: ' , ',
    });
    expect(blank.requested).toBe(false);
    expect(blank.maxPhase).toBe(0);
    expect(blank.roles).toBe('site');
    expect(blank.allowedPlayerIds).toBeNull();
    expect(blank.problems).toEqual([]);
  });
});

describe('switches fail closed', () => {
  it('turns the assistant on for "true" and "1" (trimmed, any case)', () => {
    for (const value of ['true', 'TRUE', ' true ', '1']) {
      expect(parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: value }).enabled, value).toBe(true);
    }
  });

  it('treats the string "false" (and "0") as off, not as a truthy string', () => {
    for (const value of ['false', 'FALSE', '0']) {
      const config = parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: value, ADMIN_AGENT_GOLIVE: value });
      expect(config.enabled, value).toBe(false);
      expect(config.golive, value).toBe(false);
      expect(config.problems, value).toEqual([]);
    }
  });

  it('keeps the assistant off for an unreadable switch and reports the key, not the value', () => {
    for (const value of ['yes', 'on', 'enabled', '2']) {
      const config = parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: value });
      expect(config.enabled, value).toBe(false);
      expect(config.requested, value).toBe(false);
      expect(config.problems).toEqual([{ key: 'ADMIN_AGENT_ENABLED', reason: "must be 'true' or 'false' (or unset)" }]);
    }
  });

  it('never allows go-live while the assistant is off', () => {
    expect(parseAdminAgentEnv({ ADMIN_AGENT_GOLIVE: 'true' }).golive).toBe(false);
    expect(parseAdminAgentEnv({ ...ON, ADMIN_AGENT_GOLIVE: 'true' }).golive).toBe(true);
    expect(parseAdminAgentEnv({ ...ON }).golive).toBe(false);
  });

  it('switches the assistant off, with its go-live, when any value is invalid', () => {
    const config = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_GOLIVE: 'true', ADMIN_AGENT_ROLES: 'everyone' });
    expect(config.requested).toBe(true);
    expect(config.enabled).toBe(false);
    expect(config.golive).toBe(false);
    expect(config.roles).toBe('site');
    expect(config.problems).toEqual([{ key: 'ADMIN_AGENT_ROLES', reason: "must be 'site' or 'any' (or unset)" }]);
  });

  it('honours the live-db opt-in only outside CI', () => {
    expect(parseAdminAgentEnv({ ADMIN_AGENT_LIVE_DB: '1' }).liveDb).toBe(true);
    expect(parseAdminAgentEnv({ ADMIN_AGENT_LIVE_DB: '1', CI: 'true' }).liveDb).toBe(false);
    expect(parseAdminAgentEnv({ ADMIN_AGENT_ALLOW_HOSTED: '1' }).allowHosted).toBe(true);
  });
});

describe('audience and phase', () => {
  it('accepts the site and any audiences', () => {
    expect(parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ROLES: 'any' }).roles).toBe('any');
    expect(parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ROLES: 'site' }).roles).toBe('site');
  });

  it('rejects "scoped" and other names (the spec names the wider audience "any")', () => {
    const config = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ROLES: 'scoped' });
    expect(config.enabled).toBe(false);
    expect(config.problems.map((p) => p.key)).toEqual(['ADMIN_AGENT_ROLES']);
  });

  it('reads the phase cap 0-5', () => {
    for (const phase of [0, 1, 2, 3, 4, 5]) {
      expect(parseAdminAgentEnv({ ...ON, ADMIN_AGENT_MAX_PHASE: String(phase) }).maxPhase).toBe(phase);
    }
  });

  it('degrades an invalid phase cap to 0 without switching the assistant off', () => {
    for (const value of ['6', '-1', '2.5', 'two', '99']) {
      const config = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_MAX_PHASE: value });
      expect(config.maxPhase, value).toBe(0);
      expect(config.enabled, value).toBe(true);
      expect(
        config.problems.map((p) => p.key),
        value
      ).toEqual(['ADMIN_AGENT_MAX_PHASE']);
    }
  });

  it('exposes only operations of a phase at or below the cap', () => {
    const config = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_MAX_PHASE: '2' });
    expect([0, 1, 2, 3].map((phase) => agentPhaseAllowed(config, phase))).toEqual([true, true, true, false]);
    expect(agentPhaseAllowed(parseAdminAgentEnv(ON), 1)).toBe(false);
  });
});

describe('allowed player ids', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';

  it('reads a comma-separated list, trimmed, lower-cased and de-duplicated', () => {
    const config = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ALLOWED_PLAYER_IDS: ` ${A.toUpperCase()}, ${B} ,${A},` });
    expect(config.allowedPlayerIds).toEqual([A, B]);
    expect(config.enabled).toBe(true);
  });

  it('switches the assistant off when an entry is not a UUID (a dropped entry must never widen the audience)', () => {
    const config = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ALLOWED_PLAYER_IDS: `${A}, not-a-uuid` });
    expect(config.enabled).toBe(false);
    expect(config.allowedPlayerIds).toBeNull();
    expect(config.problems).toEqual([
      { key: 'ADMIN_AGENT_ALLOWED_PLAYER_IDS', reason: 'must be a comma-separated list of player UUIDs' },
    ]);
  });

  it('rejects more than 200 ids', () => {
    const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
    expect(parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ALLOWED_PLAYER_IDS: many }).enabled).toBe(false);
  });
});

describe('caps, limits and models', () => {
  it('reads dollar amounts, decimals included, as micro-dollars', () => {
    const config = parseAdminAgentEnv({
      ...ON,
      ADMIN_AGENT_BUDGET_CONVERSATION_USD: '2.5',
      ADMIN_AGENT_BUDGET_ADMIN_DAY_USD: '10',
      ADMIN_AGENT_BUDGET_ADMIN_MONTH_USD: '50',
      ADMIN_AGENT_BUDGET_GLOBAL_DAY_USD: '0.5',
    });
    expect(config.budgets).toMatchObject({
      conversationMicro: 2_500_000,
      conversationWarnMicro: 1_500_000, // 60% of the hard stop when no warn level is set
      adminDayMicro: 10_000_000,
      adminMonthMicro: 50_000_000,
      globalDayMicro: 500_000,
    });
    expect(config.enabled).toBe(true);
  });

  it('takes an explicit warn level and requires it below the hard stop', () => {
    expect(parseAdminAgentEnv({ ...ON, ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD: '4' }).budgets.conversationWarnMicro).toBe(
      4_000_000
    );
    const config = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD: '5' });
    expect(config.enabled).toBe(false);
    expect(config.problems).toEqual([
      { key: 'ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD', reason: 'must be below ADMIN_AGENT_BUDGET_CONVERSATION_USD' },
    ]);
  });

  it('rejects zero, negative, non-numeric and absurd amounts', () => {
    for (const value of ['0', '-5', 'five', '5 USD', '$5', '1e3', '9999999']) {
      const config = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_BUDGET_ADMIN_DAY_USD: value });
      expect(config.enabled, value).toBe(false);
      expect(
        config.problems.map((p) => p.key),
        value
      ).toEqual(['ADMIN_AGENT_BUDGET_ADMIN_DAY_USD']);
      expect(config.budgets.adminDayMicro, value).toBe(20_000_000);
    }
  });

  it('reads integer limits within their bounds and rejects the rest', () => {
    const ok = parseAdminAgentEnv({
      ...ON,
      ADMIN_AGENT_TURNS_PER_HOUR: '10',
      ADMIN_AGENT_CAP_LEAGUE_CREATES: '0',
      ADMIN_AGENT_TURN_DEADLINE_SECONDS: '280',
    });
    expect(ok.limits.turnsPerHour).toBe(10);
    expect(ok.caps.leagueCreates).toBe(0);
    expect(ok.limits.turnDeadlineSeconds).toBe(280);
    expect(ok.enabled).toBe(true);
    for (const [key, value] of [
      ['ADMIN_AGENT_TURNS_PER_HOUR', '0'],
      ['ADMIN_AGENT_TURNS_PER_HOUR', '1.5'],
      ['ADMIN_AGENT_TURNS_PER_HOUR', 'many'],
      ['ADMIN_AGENT_TURN_DEADLINE_SECONDS', '300'],
      ['ADMIN_AGENT_CAP_LEAGUE_CREATES', '-1'],
    ] as const) {
      const config = parseAdminAgentEnv({ ...ON, [key]: value });
      expect(config.enabled, `${key}=${value}`).toBe(false);
      expect(config.problems.map((p) => p.key)).toEqual([key]);
    }
  });

  it('bounds the proposal lifetimes to 5-240 minutes', () => {
    expect(
      parseAdminAgentEnv({
        ...ON,
        ADMIN_AGENT_PROPOSAL_TTL_BUILD_MINUTES: '5',
        ADMIN_AGENT_PROPOSAL_TTL_GOLIVE_MINUTES: '240',
      }).proposalTtlMinutes
    ).toEqual({ build: 5, golive: 240 });
    for (const value of ['4', '241']) {
      expect(parseAdminAgentEnv({ ...ON, ADMIN_AGENT_PROPOSAL_TTL_GOLIVE_MINUTES: value }).enabled, value).toBe(false);
    }
  });

  it('accepts Anthropic model ids and efforts up to high, and rejects xhigh, max and other providers', () => {
    const config = parseAdminAgentEnv({
      ...ON,
      ADMIN_AGENT_MODEL_WRITE: 'claude-opus-5-5',
      ADMIN_AGENT_EFFORT_WRITE: 'high',
      ADMIN_AGENT_EFFORT_READ: 'low',
    });
    expect(config.models.write).toEqual({ model: 'claude-opus-5-5', effort: 'high' });
    expect(config.models.read.effort).toBe('low');
    for (const [key, value] of [
      ['ADMIN_AGENT_EFFORT_WRITE', 'xhigh'],
      ['ADMIN_AGENT_EFFORT_WRITE', 'max'],
      ['ADMIN_AGENT_MODEL_READ', 'gpt-5'],
      ['ADMIN_AGENT_MODEL_READ', 'https://example.test/claude-x'],
    ] as const) {
      const bad = parseAdminAgentEnv({ ...ON, [key]: value });
      expect(bad.enabled, `${key}=${value}`).toBe(false);
      expect(bad.problems.map((p) => p.key)).toEqual([key]);
    }
  });

  it('keeps the valid values when another key is invalid', () => {
    const config = parseAdminAgentEnv({
      ...ON,
      ADMIN_AGENT_TURNS_PER_HOUR: '5',
      ADMIN_AGENT_ROLES: 'nope',
      ADMIN_AGENT_ALLOWED_PLAYER_IDS: '',
    });
    expect(config.limits.turnsPerHour).toBe(5);
    expect(config.roles).toBe('site');
  });

  it('only reads ADMIN_AGENT_* keys, never another variable', () => {
    expect(Object.keys(adminAgentEnvSchema.shape).every((key) => key.startsWith('ADMIN_AGENT_'))).toBe(true);
  });
});

describe('assertAdminAgentBootEnv', () => {
  it('passes with nothing set and with the assistant off, whatever else is set', () => {
    for (const source of [
      {},
      { ADMIN_AGENT_ENABLED: 'false', ADMIN_AGENT_ROLES: 'bogus', ADMIN_AGENT_MAX_PHASE: '9' },
      { ADMIN_AGENT_ENABLED: 'false', ADMIN_AGENT_BUDGET_ADMIN_DAY_USD: 'lots' },
      { ADMIN_AGENT_MAX_PHASE: '9' },
      // an unreadable switch is off, not "on and broken"
      { ADMIN_AGENT_ENABLED: 'maybe', ADMIN_AGENT_ROLES: 'bogus' },
    ]) {
      expect(() => assertAdminAgentBootEnv(source), JSON.stringify(source)).not.toThrow();
    }
  });

  it('passes with the assistant on and valid or default configuration', () => {
    expect(() => assertAdminAgentBootEnv(ON)).not.toThrow();
    expect(() =>
      assertAdminAgentBootEnv({
        ...ON,
        ADMIN_AGENT_ROLES: 'any',
        ADMIN_AGENT_MAX_PHASE: '3',
        ADMIN_AGENT_GOLIVE: 'true',
        ADMIN_AGENT_BUDGET_ADMIN_DAY_USD: '7.5',
      })
    ).not.toThrow();
  });

  it('throws one MissingEnvError naming every invalid key when the assistant is on, without echoing a value', () => {
    let error: unknown;
    try {
      assertAdminAgentBootEnv({
        ...ON,
        ADMIN_AGENT_ROLES: 'sentinel-roles',
        ADMIN_AGENT_MAX_PHASE: 'sentinel-phase',
        ADMIN_AGENT_BUDGET_GLOBAL_DAY_USD: 'sentinel-usd',
      });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(MissingEnvError);
    const problems = (error as MissingEnvError).problems;
    expect(problems.map((p) => p.key).sort()).toEqual([
      'ADMIN_AGENT_BUDGET_GLOBAL_DAY_USD',
      'ADMIN_AGENT_MAX_PHASE',
      'ADMIN_AGENT_ROLES',
    ]);
    expect((error as MissingEnvError).message).not.toContain('sentinel');
  });

  it('reports an invalid phase cap at boot even though the runtime would degrade it to 0', () => {
    expect(() => assertAdminAgentBootEnv({ ...ON, ADMIN_AGENT_MAX_PHASE: '7' })).toThrow(MissingEnvError);
  });

  it('reads process.env by default', () => {
    vi.stubEnv('ADMIN_AGENT_ENABLED', 'true');
    vi.stubEnv('ADMIN_AGENT_ROLES', 'everybody');
    expect(() => assertAdminAgentBootEnv()).toThrow(MissingEnvError);
    vi.stubEnv('ADMIN_AGENT_ENABLED', 'false');
    expect(() => assertAdminAgentBootEnv()).not.toThrow();
  });
});

describe('instrumentation register()', () => {
  it('stops the Node.js boot on an invalid assistant value only when the assistant is on', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('ADMIN_AGENT_ROLES', 'everybody');
    const { register } = await import('@/instrumentation');
    vi.stubEnv('ADMIN_AGENT_ENABLED', 'true');
    await expect(register()).rejects.toThrow(MissingEnvError);
    vi.stubEnv('ADMIN_AGENT_ENABLED', 'false');
    await expect(register()).resolves.toBeUndefined();
  });
});

describe('agentEnabledFor', () => {
  const A = SITE_ADMIN.playerId;

  it('is false while the assistant is off', () => {
    expect(agentEnabledFor(parseAdminAgentEnv({}), SITE_ADMIN)).toBe(false);
    expect(agentEnabledFor(parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: 'false' }), SITE_ADMIN)).toBe(false);
  });

  it('admits site admins only under the site audience', () => {
    const config = parseAdminAgentEnv(ON);
    expect(agentEnabledFor(config, SITE_ADMIN)).toBe(true);
    expect(agentEnabledFor(config, LEAGUE_ADMIN)).toBe(false);
    expect(agentEnabledFor(config, { playerId: A, isSiteAdmin: false, isAnyAdmin: false })).toBe(false);
  });

  it('admits every admin under the any audience, and nobody else', () => {
    const config = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ROLES: 'any' });
    expect(agentEnabledFor(config, LEAGUE_ADMIN)).toBe(true);
    expect(agentEnabledFor(config, SITE_ADMIN)).toBe(true);
    expect(agentEnabledFor(config, { playerId: A, isSiteAdmin: false, isAnyAdmin: false })).toBe(false);
  });

  it('narrows the audience to the allow-list (case-insensitive), and an empty list means everyone', () => {
    const named = parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ROLES: 'any', ADMIN_AGENT_ALLOWED_PLAYER_IDS: LEAGUE_ADMIN.playerId });
    expect(agentEnabledFor(named, LEAGUE_ADMIN)).toBe(true);
    expect(agentEnabledFor(named, { ...LEAGUE_ADMIN, playerId: LEAGUE_ADMIN.playerId.toUpperCase() })).toBe(true);
    expect(agentEnabledFor(named, SITE_ADMIN)).toBe(false);
    expect(agentEnabledFor(named, { ...LEAGUE_ADMIN, playerId: null })).toBe(false);
    expect(agentEnabledFor(parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ALLOWED_PLAYER_IDS: '' }), SITE_ADMIN)).toBe(true);
  });

  it('is false for everyone when the configuration is invalid (fail closed)', () => {
    expect(agentEnabledFor(parseAdminAgentEnv({ ...ON, ADMIN_AGENT_ALLOWED_PLAYER_IDS: 'garbage' }), SITE_ADMIN)).toBe(false);
  });
});

describe('settings stay documented', () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');
  const example = read('.env.example');
  const flagsDoc = read('docs/feature-flags.md');
  const keys = [...Object.keys(adminAgentEnvSchema.shape), 'NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT'];

  it.each(keys)('%s is listed in .env.example', (key) => {
    expect(example).toMatch(new RegExp(`^#?\\s*${key}=`, 'm'));
  });

  it('keeps every switch off in .env.example and carries no secret-looking value', () => {
    expect(example).toMatch(/^NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT=false$/m);
    expect(example).toMatch(/^# ADMIN_AGENT_ENABLED=false$/m);
    expect(example).toMatch(/^# ADMIN_AGENT_GOLIVE=false$/m);
    expect(example).not.toMatch(/^ADMIN_AGENT_/m);
  });

  it('names the public flag and the server switch in docs/feature-flags.md', () => {
    expect(flagsDoc).toContain('NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT');
    expect(flagsDoc).toContain('ADMIN_AGENT_ENABLED');
  });

  it('documents the spec defaults in .env.example', () => {
    const config = parseAdminAgentEnv({});
    expect(example).toContain(`# ADMIN_AGENT_MAX_PHASE=${config.maxPhase}`);
    expect(example).toContain(`# ADMIN_AGENT_ROLES=${config.roles}`);
    expect(example).toContain(`# ADMIN_AGENT_BUDGET_CONVERSATION_USD=${config.budgets.conversationMicro / 1_000_000}`);
    expect(example).toContain(`# ADMIN_AGENT_BUDGET_ADMIN_DAY_USD=${config.budgets.adminDayMicro / 1_000_000}`);
    expect(example).toContain(`# ADMIN_AGENT_BUDGET_ADMIN_MONTH_USD=${config.budgets.adminMonthMicro / 1_000_000}`);
    expect(example).toContain(`# ADMIN_AGENT_BUDGET_GLOBAL_DAY_USD=${config.budgets.globalDayMicro / 1_000_000}`);
    expect(example).toContain(`# ADMIN_AGENT_TURNS_PER_HOUR=${config.limits.turnsPerHour}`);
    expect(example).toContain(`# ADMIN_AGENT_PROPOSAL_TTL_BUILD_MINUTES=${config.proposalTtlMinutes.build}`);
    expect(example).toContain(`# ADMIN_AGENT_MODEL_WRITE=${config.models.write.model}`);
  });
});
