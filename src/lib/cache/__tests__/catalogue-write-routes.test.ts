/**
 * D37 freshness, catalogue writes: every route that writes a table behind a
 * catalogue read of `src/lib/cache/public-reads.ts` (point-buy list entries,
 * team roles, achievement definitions, imported meta usage) expires that
 * read's tag right after the write.
 *
 * Why: `unstable_cache` serves an entry past its TTL once more, whatever its
 * age, and refreshes it in the background. A catalogue write that expires no
 * tag (an admin import, a definition edit, the monthly usage refresh) would
 * reach the first viewer after an idle spell only on their second view.
 *
 * Two proofs, by source walk:
 * - every route under `src/app/api` that calls a catalogue writer matching
 *   `CATALOGUE_WRITER` is listed here, so a new route calling one of them
 *   cannot drop out of the check. A NEW writer function must be added to
 *   `CATALOGUE_WRITER` (or write its table in the route) to be seen;
 * - each write handler of those routes expires its catalogue tag (or is in
 *   `EXEMPT` with its reason).
 * `public-reads.test.ts` proves that each of these tags expires exactly the
 * reads that embed that catalogue (the catalogue read itself, plus the player
 * profile for achievements and the league world payload for its bound
 * point-buy version), and the route tests next to each handler check the call
 * on the success path.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const API_DIR = path.resolve(__dirname, '../../../app/api');

/** Query and import functions that write a catalogue table. */
const CATALOGUE_WRITER =
  /\b(bulkCreateListEntries|createListVersion|deactivateListVersion|bulkCreateRoles|createAchievementDefinition|updateAchievementDefinition|deleteAchievementDefinition|importFormatStats|importAllStats|upsertUsageBatch|upsertUsageRow|clearFormatUsage)\b|\.from\('(point_buy_list_entries|team_roles|achievement_definitions|meta_usage_cache)'\)/;

/**
 * Write handlers and the tag each must expire. Key:
 * `<route file relative to src/app/api>#<METHOD>`.
 */
const EXPECTED: Record<string, string> = {
  'point-buy-lists/[id]/entries/route.ts#POST': 'publicTags.pointBuyList(id)',
  'admin/import/point-buy/route.ts#POST': 'publicTags.pointBuyList(versionId)',
  'team-roles/route.ts#POST': 'publicTags.teamRoles',
  'admin/import/team-roles/route.ts#POST': 'publicTags.teamRoles',
  'admin/achievements/route.ts#POST': 'publicTags.achievements',
  'admin/achievements/[id]/route.ts#PATCH': 'publicTags.achievements',
  'admin/achievements/[id]/route.ts#DELETE': 'publicTags.achievements',
  'admin/import-stats/route.ts#POST': 'publicTags.metaUsage',
  'admin/import-usage-stats/route.ts#POST': 'publicTags.metaUsage',
  'cron/refresh-usage-stats/route.ts#GET': 'publicTags.metaUsage',
};

/** Write handlers of those routes that change nothing a cached read shows, each with its reason. */
const EXEMPT: Record<string, string> = {
  'point-buy-lists/route.ts#POST':
    'creates an empty list version under a new id; no cached read can hold entries for it yet',
  'point-buy-lists/[id]/route.ts#PATCH':
    'sets is_active on the version row; no cached read includes list versions (the matchup page reads entries by the bound version id)',
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Cron routes are invoked with GET, and their GET writes. */
const methodsFor = (rel: string) => (rel.startsWith('cron/') ? new Set([...WRITE_METHODS, 'GET']) : WRITE_METHODS);

function routeFilesUnder(relDir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(API_DIR, relDir))) {
    if (entry === '__tests__') continue;
    const rel = path.join(relDir, entry);
    if (statSync(path.join(API_DIR, rel)).isDirectory()) {
      found.push(...routeFilesUnder(rel));
    } else if (entry === 'route.ts') {
      found.push(rel.split(path.sep).join('/'));
    }
  }
  return found;
}

/** Exported HTTP handlers of a route module: METHOD → handler source. */
function handlers(source: string, methods: Set<string>): Map<string, string> {
  const starts = [
    ...source.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm),
  ];
  const found = new Map<string, string>();
  starts.forEach((match, i) => {
    const name = match[1] ?? match[2];
    if (!match[0].startsWith('export') || !methods.has(name)) return;
    const end = starts[i + 1]?.index ?? source.length;
    found.set(name, source.slice(match.index, end));
  });
  return found;
}

const LISTED_FILES = [...new Set([...Object.keys(EXPECTED), ...Object.keys(EXEMPT)].map((key) => key.split('#')[0]))];

const HANDLERS = LISTED_FILES.flatMap((rel) => {
  const source = readFileSync(path.join(API_DIR, rel), 'utf8');
  return [...handlers(source, methodsFor(rel))].map(([method, body]) => ({ key: `${rel}#${method}`, body }));
});

describe('route walk: every catalogue write expires its public read tag', () => {
  it('every route that calls a catalogue writer is listed', () => {
    const writers = routeFilesUnder('').filter((rel) =>
      CATALOGUE_WRITER.test(readFileSync(path.join(API_DIR, rel), 'utf8')),
    );
    expect(writers.sort()).toEqual([...LISTED_FILES].sort());
  });

  it('every listed handler exists and every write handler is listed', () => {
    const found = HANDLERS.map((h) => h.key).sort();
    expect(found).toEqual([...Object.keys(EXPECTED), ...Object.keys(EXEMPT)].sort());
  });

  it('every exemption gives a reason', () => {
    for (const reason of Object.values(EXEMPT)) expect(reason.length).toBeGreaterThan(20);
  });

  it.each(Object.entries(EXPECTED))('%s expires %s', (key, tag) => {
    const body = HANDLERS.find((h) => h.key === key)?.body ?? '';
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(body).toMatch(new RegExp(`expirePublicTags\\(\\[[^\\]]*${escaped}`));
  });
});
