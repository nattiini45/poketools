/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScoutingReportCard from '../ScoutingReportCard';

vi.mock('@/lib/feature-flags', () => ({ ENABLE_AGENT_MATCH_ANALYSIS: true }));
vi.mock('@/i18n/client', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    useDataLocale: () => 'en',
    useLocale: () => 'de',
    useRequestTime: () => 0,
    useT: (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});

describe('phase scouting requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a phase match off the legacy agent route and renders its coded refusal', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json(
      { success: false, error: 'Unexpected fallback', code: 'phase_storage_unavailable' },
      { status: 503 },
    )));
    vi.stubGlobal('fetch', fetchMock);
    render(<ScoutingReportCard nativePhase matchId="phase-match" analysis={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scout Opponent' }));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/ai/match-prep-analysis', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ match_id: 'phase-match', force: false }),
    }));
    expect(await screen.findByText('Ligaphasen sind während der Wartung vorübergehend nicht verfügbar.')).toBeTruthy();
  });

  it('keeps a terminal SSE frame that is split across response chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"status":"fai'));
        controller.enqueue(encoder.encode('led","code":"phase_storage_unavailable"}\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(stream))));
    render(<ScoutingReportCard nativePhase matchId="phase-match" analysis={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scout Opponent' }));
    expect(await screen.findByText('Ligaphasen sind während der Wartung vorübergehend nicht verfügbar.')).toBeTruthy();
  });
});
