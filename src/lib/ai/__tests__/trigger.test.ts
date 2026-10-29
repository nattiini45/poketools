import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tournament-report-generator', () => ({
  generateTournamentReportAsync: vi.fn(),
}));

import { triggerTournamentReport, triggerMatchAnalysis } from '../trigger';
import { generateTournamentReportAsync } from '../tournament-report-generator';

const mockGenerateReport = vi.mocked(generateTournamentReportAsync);

describe('triggerTournamentReport', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it('does nothing when no AI key is configured', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;

    triggerTournamentReport('t-1', 'r-1', 'round_recap');

    expect(mockGenerateReport).not.toHaveBeenCalled();
  });

  it('ignores the removed KALE_API_KEY: the Claude key is the only one', () => {
    process.env.KALE_API_KEY = 'kale-key';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;

    triggerTournamentReport('t-1', 'r-1', 'round_recap');

    expect(mockGenerateReport).not.toHaveBeenCalled();
  });

  it('calls generateTournamentReportAsync when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    mockGenerateReport.mockResolvedValue(undefined as never);

    triggerTournamentReport('t-1', 'r-1', 'round_forecast');

    expect(mockGenerateReport).toHaveBeenCalledWith('t-1', 'r-1', 'round_forecast');
  });

  it('swallows errors from the async generator (fire-and-forget)', async () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGenerateReport.mockRejectedValue(new Error('Generation failed'));

    triggerTournamentReport('t-1', 'r-1', 'round_recap');

    // Wait for microtask to resolve the catch
    await new Promise((r) => setTimeout(r, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ai/trigger] Failed to trigger round_recap'),
      expect.any(Error),
    );
  });
});

describe('triggerMatchAnalysis', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('does nothing when ANTHROPIC_API_KEY is not set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    triggerMatchAnalysis('match-1', null);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fires fetch to match-analysis endpoint when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    process.env.NEXTAUTH_URL = 'https://poketools.example';

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', fetchSpy);

    triggerMatchAnalysis('match-123', 'session=abc');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://poketools.example/api/ai/match-analysis',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          cookie: 'session=abc',
        }),
        body: JSON.stringify({ match_id: 'match-123' }),
      }),
    );
  });

  it('uses VERCEL_URL when NEXTAUTH_URL is not set', () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    delete process.env.NEXTAUTH_URL;
    process.env.VERCEL_URL = 'my-app.vercel.app';

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', fetchSpy);

    triggerMatchAnalysis('match-1', null);

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://my-app.vercel.app/api/ai/match-analysis',
    );
  });

  it('falls back to localhost when no URL env vars are set', () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    delete process.env.NEXTAUTH_URL;
    delete process.env.VERCEL_URL;

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', fetchSpy);

    triggerMatchAnalysis('match-1', null);

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'http://localhost:3000/api/ai/match-analysis',
    );
  });

  it('does not include cookie header when cookie is null', () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    process.env.NEXTAUTH_URL = 'https://poketools.example';

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', fetchSpy);

    triggerMatchAnalysis('match-1', null);

    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty('cookie');
  });

  it('logs error but does not throw when fetch fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    process.env.NEXTAUTH_URL = 'https://poketools.example';

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    triggerMatchAnalysis('match-1', null);

    // Wait for the .catch to execute
    await new Promise((r) => setTimeout(r, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ai/trigger] Failed to trigger match analysis'),
      expect.any(Error),
    );
  });

  it('logs error when analysis endpoint returns non-ok', async () => {
    process.env.ANTHROPIC_API_KEY = 'claude-key';
    process.env.NEXTAUTH_URL = 'https://poketools.example';

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal error'),
    }));

    triggerMatchAnalysis('match-1', null);

    await new Promise((r) => setTimeout(r, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ai/trigger] Analysis trigger failed: 500'),
    );
  });
});
