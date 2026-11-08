import { describe, expect, it } from 'vitest';
import { e2eBuildEnv } from '../e2e-build.mjs';

describe('e2eBuildEnv', () => {
  it('pins the example format pack whatever the caller has set', () => {
    expect(e2eBuildEnv({ FORMAT_PACK: 'private' }).FORMAT_PACK).toBe('example');
  });

  it('adds the heap the build needs, and keeps the caller options', () => {
    expect(e2eBuildEnv({}).NODE_OPTIONS).toBe('--max-old-space-size=8192');
    expect(e2eBuildEnv({ NODE_OPTIONS: '--trace-warnings' }).NODE_OPTIONS).toBe('--trace-warnings --max-old-space-size=8192');
  });

  it('leaves a heap the caller chose', () => {
    expect(e2eBuildEnv({ NODE_OPTIONS: '--max-old-space-size=8192' }).NODE_OPTIONS).toBe('--max-old-space-size=8192');
  });

  it('does not touch the rest of the environment', () => {
    expect(e2eBuildEnv({ PATH: '/bin' }).PATH).toBe('/bin');
  });
});
