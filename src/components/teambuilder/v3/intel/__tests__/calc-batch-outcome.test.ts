import { describe, expect, it, vi } from 'vitest';
import { apiErrorText } from '@/i18n/api-errors';
import { errorsStats } from '@/i18n/messages/errors/stats';
import {
  batchCalcFailure,
  batchCalcOutcome,
  requestBatchCalc,
  requestThreats,
  threatsOutcome,
} from '../calc-batch-outcome';

const RESULTS = [{ defender: 'Garchomp', move_results: [] }];

describe('batchCalcOutcome', () => {
  it('keeps the results of a success body', () => {
    expect(batchCalcOutcome({ success: true, data: { results: RESULTS } })).toEqual({ results: RESULTS, error: null });
  });

  it('a 400 for an unknown attacker item clears the results and carries the catalogued error', () => {
    const body = { success: false, error: 'Unknown item: Foo Orb', code: 'unknown_item', params: { item: 'Foo Orb' } };
    const outcome = batchCalcOutcome(body);

    expect(outcome.results).toBeNull();
    expect(outcome.error).toEqual({ error: 'Unknown item: Foo Orb', code: 'unknown_item', params: { item: 'Foo Orb' } });
    expect(apiErrorText(outcome.error, { locale: 'en', catalogs: [errorsStats] })).toBe('Unknown item: Foo Orb');
  });

  it('a 429 carries rate_limited with its seconds', () => {
    const outcome = batchCalcOutcome({
      success: false,
      error: 'Rate limit exceeded. Try again in 30s.',
      code: 'rate_limited',
      params: { seconds: 30 },
    });

    expect(outcome.results).toBeNull();
    expect(apiErrorText(outcome.error, { locale: 'de', catalogs: [errorsStats] })).toContain('30');
  });

  it('a body that is neither a success nor an API error becomes unknown_error', () => {
    expect(batchCalcOutcome({ success: true })).toEqual({ results: null, error: { code: 'unknown_error' } });
    expect(batchCalcOutcome(null)).toEqual({ results: null, error: { code: 'unknown_error' } });
    expect(batchCalcOutcome('<html>')).toEqual({ results: null, error: { code: 'unknown_error' } });
  });
});

describe('batchCalcFailure', () => {
  it('a fetch TypeError is a network error', () => {
    expect(batchCalcFailure(new TypeError('Failed to fetch'))).toEqual({ results: null, error: { code: 'network_error' } });
  });

  it('a non-JSON body (SyntaxError) is unknown_error, not the raw parser message', () => {
    expect(batchCalcFailure(new SyntaxError('Unexpected token <'))).toEqual({
      results: null,
      error: { code: 'unknown_error' },
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('requestBatchCalc (the Calc tab round trip)', () => {
  it('a 400 unknown_item answer clears the previous numbers and carries the alert text', async () => {
    const body = { success: false, error: 'Unknown item: Foo Orb', code: 'unknown_item', params: { item: 'Foo Orb' } };
    const fetchImpl = vi.fn(async () => jsonResponse(body, 400));

    const outcome = await requestBatchCalc({ attacker: {} }, new AbortController().signal, fetchImpl);

    // CalcTab sets results and error from the outcome as they are: null results replace the old numbers.
    expect(outcome).toEqual({ results: null, error: { error: 'Unknown item: Foo Orb', code: 'unknown_item', params: { item: 'Foo Orb' } } });
    expect(apiErrorText(outcome!.error!, { locale: 'de', catalogs: [errorsStats] })).not.toBe('');
    expect(fetchImpl).toHaveBeenCalledWith('/api/calc/batch', expect.objectContaining({ method: 'POST' }));
  });

  it('a network failure is an outcome with network_error, not a throw', async () => {
    const outcome = await requestBatchCalc({}, new AbortController().signal, async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(outcome?.results).toBeNull();
    expect(outcome?.error).toMatchObject({ code: 'network_error' });
  });

  it('a superseded (aborted) run answers null, so an older response never overwrites a newer one', async () => {
    let release!: (r: Response) => void;
    const older = new AbortController();
    const pending = requestBatchCalc({}, older.signal, () => new Promise<Response>((resolve) => (release = resolve)));

    older.abort(); // a newer attacker started its own run
    release(jsonResponse({ success: true, data: { results: RESULTS } }));

    expect(await pending).toBeNull();
  });

  it('an abort that rejects the fetch also answers null (not an error banner)', async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await requestBatchCalc({}, controller.signal, async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    expect(outcome).toBeNull();
  });
});

describe('requestThreats / threatsOutcome (no swallowed load errors)', () => {
  const THREATS = [{ species: 'Garchomp', usage_pct: 0.3, default_set: { species: 'Garchomp' }, types: ['Dragon'] }];

  it('keeps the threats of a success body', async () => {
    const outcome = await requestThreats('gen9ou', new AbortController().signal, async () =>
      jsonResponse({ success: true, data: { threats: THREATS } }),
    );
    expect(outcome).toEqual({ threats: THREATS, error: null });
  });

  it('an error body becomes an error outcome the tab renders', () => {
    expect(threatsOutcome({ success: false, error: 'Rate limit exceeded. Try again in 5s.', code: 'rate_limited', params: { seconds: 5 } })).toEqual({
      threats: null,
      error: { error: 'Rate limit exceeded. Try again in 5s.', code: 'rate_limited', params: { seconds: 5 } },
    });
    expect(threatsOutcome('not json')).toEqual({ threats: null, error: { code: 'unknown_error' } });
  });

  it('a network failure is a network_error outcome; an abort is null', async () => {
    const failed = await requestThreats('gen9ou', new AbortController().signal, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(failed).toMatchObject({ threats: null, error: { code: 'network_error' } });

    const controller = new AbortController();
    controller.abort();
    expect(
      await requestThreats('gen9ou', controller.signal, async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    ).toBeNull();
  });
});
