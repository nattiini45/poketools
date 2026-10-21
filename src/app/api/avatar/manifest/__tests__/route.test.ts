import { describe, it, expect } from 'vitest';

vi.mock('@/lib/avatar/manifest', () => ({
  AVATAR_CATEGORIES_BY_GENDER: {
    male: [{ id: 'hair', label: 'Hair' }],
    female: [{ id: 'eyes', label: 'Eyes' }],
  },
}));

import { vi } from 'vitest';
import { GET } from '../route';
import { AVATAR_CATEGORIES_BY_GENDER } from '@/lib/avatar/manifest';

describe('GET /api/avatar/manifest', () => {
  it('returns the avatar manifest with cache headers', async () => {
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(AVATAR_CATEGORIES_BY_GENDER);
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=3600, s-maxage=86400',
    );
  });
});
