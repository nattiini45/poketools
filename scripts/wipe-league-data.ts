/**
 * One-off script to delete all tournament and league data from Supabase.
 * Keeps: players, rulesets, draft_pool_templates
 *
 * Usage: npx tsx scripts/wipe-league-data.ts
 *
 * Loads env from .env.local automatically.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Parse .env.local manually (no dotenv dependency needed)
function loadEnvLocal() {
  try {
    const envPath = resolve(process.cwd(), '.env.local');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local might not exist if env vars are set another way
  }
}
loadEnvLocal();

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient<Database>(url, key);

// Deletion order: leaf tables first, respecting FK constraints.
// `filterCol` is needed because Supabase requires a WHERE clause on DELETE.
// Tables with composite PKs (no `id` column) use a different column.
const TABLES_TO_WIPE: { table: string; filterCol: string }[] = [
  // Stats layer (references games, players)
  { table: 'battle_stats', filterCol: 'id' },
  { table: 'aggregates', filterCol: 'id' },
  // Game layer (references matches)
  { table: 'games', filterCol: 'id' },
  // Match prep (references matches, players)
  { table: 'match_prep_teams', filterCol: 'id' },
  // Match layer (references rounds, tournaments, players)
  { table: 'matches', filterCol: 'id' },
  // Round layer (references tournaments)
  { table: 'rounds', filterCol: 'id' },
  // Tournament participants & groups (composite PKs — filter on player_id)
  { table: 'tournament_group_members', filterCol: 'player_id' },
  { table: 'tournament_groups', filterCol: 'id' },
  { table: 'tournament_participants', filterCol: 'player_id' },
  // Draft layer (references draft_pools, players, seasons)
  { table: 'draft_picks', filterCol: 'id' },
  // Teams (references players, seasons, tournaments, draft_pools)
  { table: 'teams', filterCol: 'id' },
  // Draft pools (references seasons)
  { table: 'draft_pools', filterCol: 'id' },
  { table: 'draft_pool_entries', filterCol: 'id' },
  { table: 'draft_tier_limits', filterCol: 'id' },
  // Evolution tracking (references seasons, players)
  { table: 'evolution_tiers', filterCol: 'id' },
  { table: 'evolution_tracker', filterCol: 'id' },
  // Season participants (composite PK — filter on player_id)
  { table: 'season_participants', filterCol: 'player_id' },
  // Resource admins (references players — but entries are for tournaments/seasons)
  { table: 'resource_admins', filterCol: 'id' },
  // Core entities
  { table: 'tournaments', filterCol: 'id' },
  { table: 'seasons', filterCol: 'id' },
];

async function wipe() {
  console.log('Wiping tournament & league data (keeping players, rulesets, templates)...\n');

  for (const { table, filterCol } of TABLES_TO_WIPE) {
    // neq on a non-nullable column with an impossible value → selects all rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error, count } = await (supabase.from as any)(table)
      .delete({ count: 'exact' })
      .neq(filterCol, '00000000-0000-0000-0000-000000000000');

    if (error) {
      console.error(`  ✗ ${table}: ${error.message}`);
    } else {
      console.log(`  ✓ ${table}: ${count ?? '?'} rows deleted`);
    }
  }

  console.log('\nDone. Players, rulesets, and draft pool templates were preserved.');
}

wipe().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
