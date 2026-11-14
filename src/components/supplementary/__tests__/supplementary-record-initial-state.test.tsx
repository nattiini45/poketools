import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

const mocks = vi.hoisted(() => ({ included: true }));
vi.mock('@pack-extensions', () => ({ default: {
  includeSupplementaryRecords: async () => mocks.included,
  supplementaryPlayerRecord: async () => ({ played: 6, wins: 3, draws: 1, losses: 2, titles: 1, runnerUps: 0 }),
} }));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: async () => ({ playerId: 'fixture-viewer' }) }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});

import RecordSection from '../SupplementaryRecordSection';

beforeEach(() => { mocks.included = true; });

describe('supplementary profile initial state', () => {
  it('renders included figures in server HTML through the real section without JavaScript', async () => {
    const html = renderWithI18n(<>{await RecordSection({ playerId: 'fixture-player' })}</>);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('3 W · 1 D · 2 L');
    expect(html).toContain('1 title');
    expect(html).toContain('They are not part of the live statistics above.');
  });

  it('omits excluded records from server HTML', async () => {
    mocks.included = false;
    expect(await RecordSection({ playerId: 'fixture-player' })).toBeNull();
  });
});
