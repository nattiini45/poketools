/**
 * The standard site rulesets: one `gallery` definition (kind `preset`) per standard Smogon format of
 * `SEED_FORMAT_IDS`, based on the catalog preset of the same id and published as version 1. Shared by
 * `POST /api/seed-rulesets` and the local `npm run dev:seed`. Server only.
 */
import 'server-only';

import { supabase } from '@/lib/supabase/client';
import { ltext } from '@/lib/studio-core/ltext';
import { FORMAT_DEFAULTS } from '@/lib/pkmn/formats';
import { SEED_FORMAT_IDS } from '@/lib/pkmn/seed-format-ids';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { createPublished } from '@/lib/ruleset-studio/library';

/**
 * Inserts every standard ruleset whose name is not taken yet (matched by name), so a second call writes nothing.
 * Returns how many it created.
 */
export async function seedStandardRulesets(): Promise<{ count: number }> {
  const { data: existing, error: fetchError } = await supabase.from('ruleset_definitions').select('name_text');
  if (fetchError) throw fetchError;

  const existingNames = new Set((existing ?? []).map((r) => r.name_text));
  const seedable = SEED_FORMAT_IDS.flatMap((key) =>
    key in FORMAT_DEFAULTS ? [[key, FORMAT_DEFAULTS[key]] as const] : [],
  );
  const toInsert = seedable.filter(([, fmt]) => !existingNames.has(fmt.name));

  // Each site ruleset is a `gallery` definition whose base is the catalog preset and which changes nothing: the effective
  // rules are the preset's, computed and frozen by the publish of version 1.
  let count = 0;
  for (const [key, fmt] of toInsert) {
    await createPublished({
      name: ltext('en', fmt.name),
      slugBase: key,
      document: newRulesetDocument(fmt.name, 'en', key) as unknown as Record<string, unknown>,
      ownerId: null,
      kind: 'preset',
      visibility: 'gallery',
      seasonId: null,
      changelog: ltext('en', 'Seeded from the preset catalog'),
    });
    count += 1;
  }
  return { count };
}
