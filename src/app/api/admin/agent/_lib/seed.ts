/**
 * The seed a conversation starts from (plan 5.2): a whitelisted key plus ids, never free text from a URL. The server
 * checks the shape here and then runs the REAL guard for the entity it names, for the live admin, before the seed is
 * stored; the seed is context for the model, not authority.
 */
import { z } from 'zod';
import { SEED_AREAS, SEED_KEYS, SEED_TABS, type ConversationSeed } from '@/components/admin/assistant/types';
import { guardFor } from '@/lib/ai/admin-agent/registry/guard';

/** Which seed keys and entity kinds each area admits. */
const AREA_RULES = {
  admin: { seeds: [], entity: null },
  leagues: { seeds: ['new_league'], entity: null },
  league: { seeds: ['readiness'], entity: 'season' },
  rulesets: { seeds: ['describe_ruleset'], entity: 'rulesetViewer' },
  formats: { seeds: ['describe_format'], entity: 'formatViewer' },
  tournaments: { seeds: ['new_tournament'], entity: null },
  tournament: { seeds: [], entity: 'tournament' },
} as const satisfies Record<(typeof SEED_AREAS)[number], { seeds: readonly (typeof SEED_KEYS)[number][]; entity: string | null }>;

export const seedSchema = z
  .strictObject({
    area: z.enum(SEED_AREAS),
    seed: z.enum(SEED_KEYS).optional(),
    entity: z.guid().optional(),
    tab: z.enum(SEED_TABS).optional(),
  })
  .superRefine((seed, ctx) => {
    const rule = AREA_RULES[seed.area];
    if (seed.seed !== undefined && !(rule.seeds as readonly string[]).includes(seed.seed)) {
      ctx.addIssue({ code: 'custom', path: ['seed'], message: 'seed_not_allowed_for_area' });
    }
    if (seed.entity !== undefined && rule.entity === null) ctx.addIssue({ code: 'custom', path: ['entity'], message: 'entity_not_allowed_for_area' });
    if (seed.tab !== undefined && seed.area !== 'league') ctx.addIssue({ code: 'custom', path: ['tab'], message: 'tab_only_for_league' });
    if (seed.seed === 'readiness' && seed.entity === undefined) ctx.addIssue({ code: 'custom', path: ['entity'], message: 'entity_required' });
  });

/**
 * Runs the guard of the seed's entity for the live admin (the same `require*` helper the entity's own routes use) and
 * returns the seed to store, ids lower-cased. A guard that refuses throws its own error (404 or 403): the seed is not stored.
 */
export async function validateSeed(seed: z.output<typeof seedSchema>): Promise<ConversationSeed> {
  const rule = AREA_RULES[seed.area];
  if (seed.entity !== undefined && rule.entity !== null) {
    await guardFor({ kind: rule.entity, id: seed.entity } as Parameters<typeof guardFor>[0]);
  }
  return {
    area: seed.area,
    ...(seed.seed === undefined ? {} : { seed: seed.seed }),
    ...(seed.entity === undefined ? {} : { entity: seed.entity.toLowerCase() }),
    ...(seed.tab === undefined ? {} : { tab: seed.tab }),
  };
}
