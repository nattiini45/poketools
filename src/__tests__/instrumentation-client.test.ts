import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { register } from '@/instrumentation-client';

// The client register() switches zod to `jitless` so its `new Function`
// feature probe never runs — under the production CSP the probe posts a
// script-src violation report even though the throw is swallowed (#137).
describe('instrumentation-client register()', () => {
  it('sets zod jitless so the eval probe answers false without probing', () => {
    register();
    expect(globalThis.__zod_globalConfig?.jitless).toBe(true);
    expect(z.core.util.allowsEval.value).toBe(false);
    // Validation still works in interpreted mode.
    expect(z.string().email().safeParse('a@b.co').success).toBe(true);
  });
});
