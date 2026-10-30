import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REMOVED_KALE_SETTINGS,
  resetRemovedKaleSettingsWarning,
  warnRemovedKaleSettings,
} from '../removed-settings';

function warnings(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

describe('warnRemovedKaleSettings', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetRemovedKaleSettingsWarning();
    for (const name of REMOVED_KALE_SETTINGS) vi.stubEnv(name, '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubEnv('CLAUDE_API_KEY', '');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('stays silent when no removed variable is set', () => {
    warnRemovedKaleSettings();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns once, names every removed variable that is set, and never logs a value', () => {
    vi.stubEnv('KALE_PROVIDER', 'secret-provider-value');
    vi.stubEnv('KALE_FALLBACK_MODEL', 'secret-model-value');

    warnRemovedKaleSettings();
    warnRemovedKaleSettings();

    const lines = warnings(warnSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toBe(
      'KALE_PROVIDER, KALE_FALLBACK_MODEL are no longer used; Kale follows CLAUDE_MODEL / CLAUDE_FALLBACK_MODEL and ANTHROPIC_API_KEY.',
    );
    expect(JSON.stringify(lines[0])).not.toContain('secret');
  });

  it('says so when no Anthropic key is configured', () => {
    vi.stubEnv('KALE_API_KEY', 'old-key');
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    warnRemovedKaleSettings();

    const [line] = warnings(warnSpy);
    expect(line.message).toContain('KALE_API_KEY is no longer used');
    expect(line.message).toContain('No Anthropic API key is configured');
    expect(line.anthropic_key_configured).toBe(false);
    expect(JSON.stringify(line)).not.toContain('old-key');
  });

  it('does not add the missing-key note when a key is configured', () => {
    vi.stubEnv('KALE_MODEL', 'x');

    warnRemovedKaleSettings();

    const [line] = warnings(warnSpy);
    expect(line.message).not.toContain('No Anthropic API key');
    expect(line.anthropic_key_configured).toBe(true);
  });
});
