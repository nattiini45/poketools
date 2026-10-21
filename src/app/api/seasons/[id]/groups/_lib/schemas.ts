/**
 * Request bodies of the league groups routes (`/api/seasons/[id]/groups/**`). Strict objects: an unknown key is a
 * 400 `validation_failed`, never silently dropped. The database re-checks every rule (`season_groups_replace`,
 * the membership guard), so these bounds only turn obvious mistakes into readable 400s before any read.
 */
import { z } from 'zod';

/** `season_groups.sort_order` is 1..26 (CHECK `season_groups_sort_order_range`). */
export const MAX_SEASON_GROUPS = 26;
/** A league split into fewer than two groups is not split. */
export const MIN_SEASON_GROUPS = 2;
/** Every group seats a round robin and a draft: two trainers at least (SEASON_GROUP_TOO_SMALL in the database). */
export const MIN_GROUP_MEMBERS = 2;
/** `season_groups.name`: 1..60 characters after trimming (CHECK `season_groups_name_len`). */
export const SEASON_GROUP_NAME_MAX = 60;
/** More members than any league roster has (a draft seats at most 32; leagues stay far below this). */
const MAX_GROUP_MEMBERS = 128;

const groupName = z.string().trim().min(1).max(SEASON_GROUP_NAME_MAX);

const manualGroup = z
  .object({
    name: groupName,
    player_ids: z.array(z.uuid()).max(MAX_GROUP_MEMBERS),
  })
  .strict();

/**
 * `PUT /api/seasons/[id]/groups`:
 * - `serpentine`: `group_count` groups, filled by seed (1 → A, 2 → B, 3 → B, 4 → A for two groups); existing groups
 *   keep their names by position, new ones are named `Group A`, `Group B`, …;
 * - `manual`: the groups as given (display order = array order); every participant in exactly one group, two or
 *   more per group;
 * - `clear`: no groups (the league drafts and ranks as one table again).
 */
export const seasonGroupsReplaceSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('serpentine'),
      group_count: z.number().int().min(MIN_SEASON_GROUPS).max(MAX_SEASON_GROUPS),
    })
    .strict(),
  z
    .object({
      mode: z.literal('manual'),
      groups: z
        .array(manualGroup)
        .min(MIN_SEASON_GROUPS)
        .max(MAX_SEASON_GROUPS)
        .superRefine((groups, ctx) => {
          const names = new Set<string>();
          const players = new Set<string>();
          groups.forEach((group, index) => {
            const key = group.name.toLowerCase();
            if (names.has(key)) ctx.addIssue({ code: 'custom', path: [index, 'name'], message: 'duplicate group name' });
            names.add(key);
            group.player_ids.forEach((playerId, p) => {
              const id = playerId.toLowerCase();
              if (players.has(id)) {
                ctx.addIssue({ code: 'custom', path: [index, 'player_ids', p], message: 'player in two groups' });
              }
              players.add(id);
            });
          });
        }),
    })
    .strict(),
  z.object({ mode: z.literal('clear') }).strict(),
]);
export type SeasonGroupsReplaceInput = z.infer<typeof seasonGroupsReplaceSchema>;

/** `PATCH /api/seasons/[id]/groups/[groupId]`: rename one group. */
export const seasonGroupRenameSchema = z.object({ name: groupName }).strict();

/** `PATCH /api/seasons/[id]/groups/members`: place a trainer in a group (a move, or the first placement). */
export const seasonGroupMemberSchema = z.object({ player_id: z.uuid(), group_id: z.uuid() }).strict();
