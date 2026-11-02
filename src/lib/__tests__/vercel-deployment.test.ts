import { describe, expect, it } from 'vitest';
import { isVercelDeployment } from '../vercel-deployment';

describe('isVercelDeployment', () => {
  it('is true on a Vercel deployment (VERCEL=1)', () => {
    expect(isVercelDeployment({ VERCEL: '1' })).toBe(true);
  });

  it('is false when VERCEL is unset, empty or anything but 1', () => {
    expect(isVercelDeployment({})).toBe(false);
    expect(isVercelDeployment({ VERCEL: '' })).toBe(false);
    expect(isVercelDeployment({ VERCEL: '0' })).toBe(false);
  });
});
