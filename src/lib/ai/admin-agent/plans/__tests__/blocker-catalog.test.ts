/**
 * Catalog completeness for the readiness blockers (plan 3.9 test 7): a blocker marked `catalog` must already exist in
 * an error catalog. The `todo` ones are the assistant's own codes that still need an entry in `errors/admin-assistant`
 * (EN and DE); this test lists them so the gap is visible, and fails if a code is marked `todo` but already exists
 * (flip the flag in `PLAN_BLOCKERS` when the catalog gains it).
 */
import { describe, expect, it } from 'vitest';
import adminEn from '@/i18n/messages/errors/admin/en';
import adminAssistantEn from '@/i18n/messages/errors/admin-assistant/en';
import draftEn from '@/i18n/messages/errors/draft/en';
import draftLegacyEn from '@/i18n/messages/errors/draft-legacy/en';
import seasonsEn from '@/i18n/messages/errors/seasons/en';
import tournamentsEn from '@/i18n/messages/errors/tournaments/en';
import commonEn from '@/i18n/messages/errors/common/en';
import { PLAN_BLOCKERS, PLAN_BLOCKER_CODES } from '../readiness';

const catalog = new Set<string>([
  ...Object.keys(adminEn),
  ...Object.keys(adminAssistantEn),
  ...Object.keys(draftEn),
  ...Object.keys(draftLegacyEn),
  ...Object.keys(seasonsEn),
  ...Object.keys(tournamentsEn),
  ...Object.keys(commonEn),
]);

describe('readiness blocker codes', () => {
  it('every code marked `catalog` is in an error catalog', () => {
    const missing = PLAN_BLOCKER_CODES.filter((code) => PLAN_BLOCKERS[code].catalog === 'catalog' && !catalog.has(code));
    expect(missing).toEqual([]);
  });

  it('every code marked `todo` is still absent (flip the flag once the catalog has it)', () => {
    const present = PLAN_BLOCKER_CODES.filter((code) => PLAN_BLOCKERS[code].catalog === 'todo' && catalog.has(code));
    expect(present).toEqual([]);
  });

  it('uses flat codes: lower snake_case, or the route\'s own upper-case code', () => {
    for (const code of PLAN_BLOCKER_CODES) expect(code).toMatch(/^(?:[a-z][a-z0-9_]*|[A-Z][A-Z0-9_]*)$/);
  });
});
