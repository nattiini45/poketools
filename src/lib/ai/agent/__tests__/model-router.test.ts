import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentModelEntry } from '../provider';

// ─── Mocks ───────────────────────────────────────────────────────────

const m = vi.hoisted(() => ({ streamText: vi.fn() }));

vi.mock('ai', () => ({ streamText: m.streamText }));

vi.mock('../provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../provider')>();
  return {
    ...actual,
    createCompatibleModel: vi.fn(() => 'fake-model'),
    getAgentProviderOptions: vi.fn(() => undefined),
    isModelConfigured: vi.fn(() => true),
  };
});

import {
  selectModels,
  streamWithFallback,
  AgentExhaustedError,
} from '../model-router';
import { isModelConfigured, createCompatibleModel } from '../provider';

// ─── Fake streamText results ─────────────────────────────────────────

function ok(text = 'answer') {
  return {
    finishReason: Promise.resolve('stop'),
    text: Promise.resolve(text),
    toolCalls: Promise.resolve([]),
  };
}

type StreamParams = { onError?: (e: { error: unknown }) => void };

/**
 * Model the LAZY `streamText` failure path exactly as ai v6 behaves: the call
 * itself does NOT throw and the settled promises reject only with a causeless
 * `AI_NoOutputGeneratedError` wrapper — the REAL provider error (the one with
 * the status / `authentication_error` type) is delivered solely through the
 * `onError` callback. Returns a `mockImplementation` factory so the mock can
 * read `onError` off the params it was called with.
 *
 * The old mocks rejected `result.text` with the real error directly, which is
 * why the unit tests passed while the live path misclassified auth as
 * `empty_truncated` — the router never saw the real error.
 */
function lazyProviderFailure(realError: unknown) {
  return (params: StreamParams) => {
    // Surface the real error the way the SDK does — via onError, during
    // consumption — never as a throw at call time.
    params.onError?.({ error: realError });
    const wrapper = Object.assign(
      new Error('No output generated. Check the stream for errors.'),
      { name: 'AI_NoOutputGeneratedError' },
    );
    return {
      finishReason: Promise.reject(wrapper),
      text: Promise.reject(wrapper),
      toolCalls: Promise.reject(wrapper),
    };
  };
}

function rateLimited() {
  return lazyProviderFailure(Object.assign(new Error('rate limit exceeded'), { statusCode: 429 }));
}
function emptyCompletion() {
  return {
    finishReason: Promise.resolve('stop'),
    text: Promise.resolve('   '),
    toolCalls: Promise.resolve([]),
  };
}
function truncated() {
  return {
    finishReason: Promise.resolve('length'),
    text: Promise.resolve('partial...'),
    toolCalls: Promise.resolve([]),
  };
}
function badToolCall() {
  return {
    finishReason: Promise.resolve('tool-calls'),
    text: Promise.resolve(''),
    // `species` must be a non-empty string per the real lookupPokemon schema.
    toolCalls: Promise.resolve([{ toolName: 'lookupPokemon', input: { species: 123 } }]),
  };
}
function neverSettles() {
  return {
    finishReason: new Promise<string>(() => {}),
    text: new Promise<string>(() => {}),
    toolCalls: new Promise<unknown[]>(() => {}),
  };
}
function authFailed(status = 401) {
  return lazyProviderFailure(
    Object.assign(new Error('Incorrect API key provided'), { statusCode: status }),
  );
}
function authErrorType() {
  // No HTTP status — only the provider error `type` identifies it.
  return lazyProviderFailure(
    Object.assign(new Error('request failed'), {
      name: 'AI_APICallError',
      isRetryable: false,
      data: { error: { type: 'authentication_error' } },
    }),
  );
}
function invalidModel() {
  return lazyProviderFailure(
    Object.assign(new Error('model `bogus` does not exist'), {
      name: 'AI_APICallError',
      statusCode: 400,
      isRetryable: false,
      data: { error: { type: 'invalid_request_error' } },
    }),
  );
}

// ─── Model fixtures ──────────────────────────────────────────────────

function entry(id: string, tier: AgentModelEntry['tier'] = 'T0'): AgentModelEntry {
  return { id, provider: 'deepseek', modelName: id, tier };
}

const FAST = { perCallTimeoutMs: 50, maxHops: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  m.streamText.mockReset();
  (isModelConfigured as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => true);
  // clearAllMocks wipes call history but not implementations, so restore the
  // default each test (some cases override it to throw before streaming).
  (createCompatibleModel as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => 'fake-model');
});

// ─── selectModels ────────────────────────────────────────────────────

describe('selectModels', () => {
  it('puts the vision (T0-V) model first when an image is present', () => {
    const models = selectModels(null, true);
    expect(models[0].tier).toBe('T0-V');
  });

  it('honours the user model_priority order', () => {
    const models = selectModels(
      { model_priority: ['claude-haiku-4-5', 'deepseek-v4-pro'] },
      false,
    );
    expect(models[0].id).toBe('claude-haiku-4-5');
    expect(models[1].id).toBe('deepseek-v4-pro');
  });

  it('maps the retired mimo-v2.5-pro id in a stored priority to mimo-v2.6-pro', () => {
    const models = selectModels(
      { model_priority: ['deepseek-v4-pro', 'mimo-v2.5-pro'] },
      false,
    );
    expect(models[0].id).toBe('deepseek-v4-pro');
    expect(models[1].id).toBe('mimo-v2.6-pro');
    expect(models[1].modelName).toBe('mimo-v2.6-pro');
  });

  it('drops models whose provider is not configured', () => {
    (isModelConfigured as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cfg: { id: string }) => cfg.id === 'deepseek-v4-pro',
    );
    const models = selectModels(null, false);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('deepseek-v4-pro');
  });
});

// ─── streamWithFallback: escalation triggers ─────────────────────────

const PARAMS = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('streamWithFallback escalation triggers', () => {
  it('escalates on a rate-limit / 429', async () => {
    m.streamText.mockImplementationOnce(rateLimited()).mockReturnValueOnce(ok());
    const telemetry = vi.fn();

    const { model, escalations } = await streamWithFallback(
      [entry('m0'), entry('m1')],
      PARAMS,
      telemetry,
      FAST,
    );

    expect(model.id).toBe('m1');
    expect(escalations).toEqual([{ from: 'm0', to: 'm1', reason: 'rate_limit' }]);
    expect(telemetry).toHaveBeenCalledTimes(1);
    expect(m.streamText).toHaveBeenCalledTimes(2);
  });

  it('repairs a tool-schema failure once, then escalates if it fails again', async () => {
    m.streamText
      .mockReturnValueOnce(badToolCall()) // initial
      .mockReturnValueOnce(badToolCall()) // repair (same model)
      .mockReturnValueOnce(ok()); // escalated model
    const telemetry = vi.fn();

    const { model, escalations } = await streamWithFallback(
      [entry('m0'), entry('m1')],
      PARAMS,
      telemetry,
      FAST,
    );

    expect(model.id).toBe('m1');
    expect(escalations[0].reason).toBe('tool_schema');
    // 3 calls: initial + repair on m0, then success on m1.
    expect(m.streamText).toHaveBeenCalledTimes(3);
    // The repair call re-asked the same model with the validation error appended.
    const repairCall = m.streamText.mock.calls[1][0] as { messages: { content: string }[] };
    const last = repairCall.messages[repairCall.messages.length - 1];
    expect(last.content).toMatch(/invalid arguments/i);
  });

  it('escalates on an empty completion', async () => {
    m.streamText.mockReturnValueOnce(emptyCompletion()).mockReturnValueOnce(ok());
    const { model, escalations } = await streamWithFallback(
      [entry('m0'), entry('m1')],
      PARAMS,
      undefined,
      FAST,
    );
    expect(model.id).toBe('m1');
    expect(escalations[0].reason).toBe('empty_truncated');
    // Empty completion is not a schema failure, so no repair retry.
    expect(m.streamText).toHaveBeenCalledTimes(2);
  });

  it('escalates on a truncated (finishReason=length) completion', async () => {
    m.streamText.mockReturnValueOnce(truncated()).mockReturnValueOnce(ok());
    const { escalations } = await streamWithFallback([entry('m0'), entry('m1')], PARAMS, undefined, FAST);
    expect(escalations[0].reason).toBe('empty_truncated');
  });

  it('escalates on a per-call timeout', async () => {
    m.streamText.mockReturnValueOnce(neverSettles()).mockReturnValueOnce(ok());
    const { model, escalations } = await streamWithFallback(
      [entry('m0'), entry('m1')],
      PARAMS,
      undefined,
      { perCallTimeoutMs: 30, maxHops: 2 },
    );
    expect(model.id).toBe('m1');
    expect(escalations[0].reason).toBe('timeout');
  });

  it('escalates on a 401/403 auth failure (provider-auth), not as a dead end', async () => {
    m.streamText.mockImplementationOnce(authFailed(401)).mockReturnValueOnce(ok());
    const telemetry = vi.fn();
    const { model, escalations } = await streamWithFallback(
      [entry('m0'), entry('m1')],
      PARAMS,
      telemetry,
      FAST,
    );
    expect(model.id).toBe('m1');
    expect(escalations).toEqual([{ from: 'm0', to: 'm1', reason: 'provider-auth' }]);
    expect(telemetry).toHaveBeenCalledTimes(1);
  });

  it('classifies the LAZY auth path as provider-auth (wrapper rejects, real error via onError)', async () => {
    // Regression for the live bug: ai v6 rejects the settled promises with a
    // causeless AI_NoOutputGeneratedError and delivers the real 401 only to
    // onError. The router must read onError to classify it as provider-auth —
    // NOT fall through to empty_truncated.
    m.streamText
      .mockImplementationOnce(
        lazyProviderFailure(
          Object.assign(new Error('Authentication Fails, invalid api key'), {
            name: 'AI_APICallError',
            statusCode: 401,
            isRetryable: false,
            data: { error: { type: 'authentication_error' } },
          }),
        ),
      )
      .mockReturnValueOnce(ok());

    const { model, escalations } = await streamWithFallback(
      [entry('m0'), entry('m1')],
      PARAMS,
      undefined,
      FAST,
    );

    expect(model.id).toBe('m1');
    expect(escalations[0].reason).toBe('provider-auth');
  });

  it('escalates on an authentication_error type with no HTTP status (provider-auth)', async () => {
    m.streamText.mockImplementationOnce(authErrorType()).mockReturnValueOnce(ok());
    const { model, escalations } = await streamWithFallback([entry('m0'), entry('m1')], PARAMS, undefined, FAST);
    expect(model.id).toBe('m1');
    expect(escalations[0].reason).toBe('provider-auth');
  });

  it('escalates on a non-retryable API call error like an invalid model (provider-error)', async () => {
    m.streamText.mockImplementationOnce(invalidModel()).mockReturnValueOnce(ok());
    const { model, escalations } = await streamWithFallback([entry('m0'), entry('m1')], PARAMS, undefined, FAST);
    expect(model.id).toBe('m1');
    expect(escalations[0].reason).toBe('provider-error');
    // No same-model retry — a 400 invalid model cannot be repaired by re-asking.
    expect(m.streamText).toHaveBeenCalledTimes(2);
  });

  it('escalates cleanly when model construction throws BEFORE streaming starts', async () => {
    // First tier's model can't even be built (e.g. a dead provider client);
    // the router must move on instead of crashing the whole call.
    (createCompatibleModel as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('missing api key'), { statusCode: 401 });
      })
      .mockImplementation(() => 'fake-model');
    m.streamText.mockReturnValueOnce(ok());

    const { model, escalations } = await streamWithFallback([entry('m0'), entry('m1')], PARAMS, undefined, FAST);

    expect(model.id).toBe('m1');
    expect(escalations[0].reason).toBe('provider-auth');
    // streamText only ran for the second model — the first never got that far.
    expect(m.streamText).toHaveBeenCalledTimes(1);
  });

  it('rejects with AgentExhaustedError when every model fails to even build', async () => {
    (createCompatibleModel as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(
      streamWithFallback([entry('m0'), entry('m1')], PARAMS, undefined, FAST),
    ).rejects.toBeInstanceOf(AgentExhaustedError);
    expect(m.streamText).not.toHaveBeenCalled();
  });
});

// ─── streamWithFallback: hop limit & exhaustion ─────────────────────

describe('streamWithFallback bounds', () => {
  it('returns the first model immediately on success (no escalation)', async () => {
    m.streamText.mockReturnValueOnce(ok('done'));
    const telemetry = vi.fn();
    const { model, escalations } = await streamWithFallback([entry('m0'), entry('m1')], PARAMS, telemetry, FAST);
    expect(model.id).toBe('m0');
    expect(escalations).toEqual([]);
    expect(telemetry).not.toHaveBeenCalled();
    expect(m.streamText).toHaveBeenCalledTimes(1);
  });

  it('caps at 2 hops (3 attempts) even when more models are supplied', async () => {
    m.streamText
      .mockImplementationOnce(rateLimited())
      .mockImplementationOnce(rateLimited())
      .mockImplementationOnce(rateLimited());

    await expect(
      streamWithFallback(
        [entry('m0'), entry('m1'), entry('m2'), entry('m3')],
        PARAMS,
        undefined,
        FAST,
      ),
    ).rejects.toBeInstanceOf(AgentExhaustedError);

    // Only 3 of the 4 models are attempted.
    expect(m.streamText).toHaveBeenCalledTimes(3);
  });

  it('throws AgentExhaustedError carrying the full trigger chain', async () => {
    m.streamText
      .mockImplementationOnce(rateLimited())
      .mockReturnValueOnce(truncated())
      .mockReturnValueOnce(neverSettles());

    let caught: AgentExhaustedError | null = null;
    try {
      await streamWithFallback([entry('m0'), entry('m1'), entry('m2')], PARAMS, undefined, {
        perCallTimeoutMs: 30,
        maxHops: 2,
      });
    } catch (err) {
      caught = err as AgentExhaustedError;
    }

    expect(caught).toBeInstanceOf(AgentExhaustedError);
    expect(caught?.reasons).toEqual(['rate_limit', 'empty_truncated', 'timeout']);
    expect(caught?.escalations[2].to).toBe('(exhausted)');
  });

  it('throws immediately when given no models', async () => {
    await expect(streamWithFallback([], PARAMS, undefined, FAST)).rejects.toBeInstanceOf(
      AgentExhaustedError,
    );
  });
});
