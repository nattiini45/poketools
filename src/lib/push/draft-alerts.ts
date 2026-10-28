/**
 * Draft claims → Web Push (docs/push.md, "Claim to push mapping"). Server only.
 *
 * `dispatchDraftNotifications` (`src/lib/draft/notify.ts`) calls this with the claims
 * `draft_claim_notifications` just handed out. That function claims every due event exactly once in SQL, so a push
 * inherits the exactly-once semantics: there is no second scheduler, and quiet hours, pauses and slot changes are
 * already decided by the claim.
 *
 * | claim               | recipients                    | TTL                     | urgency |
 * |---------------------|-------------------------------|-------------------------|---------|
 * | `turn_started`      | the slot's player             | until the deadline, cap | high    |
 * | `turn_reminder`     | the slot's player             | until the deadline, cap | high    |
 * | `redraft_published` | every participant of the pool | 24 h                    | normal  |
 * | `admin_alert`       | nobody (admins have Discord)  | -                       | -       |
 *
 * Disabled push (no valid VAPID configuration) returns before any read. Never throws.
 */
import 'server-only';

import { PUSH_MAX_TTL_SECONDS, sendPushToPlayer, sendPushToPlayers, ttlUntil, type PushSpec } from '@/lib/push/send';
import { readPushConfig } from '@/lib/push/config';
import { redraftPayload, turnPayload } from '@/lib/push/payload';
import { listPoolParticipantIds } from '@/lib/supabase/queries/drafts-redraft';
import type { NotificationClaim } from '@/lib/draft/notify';

/** Sends the push messages for `claims`; resolves when every send has finished. Returns the claims it acted on. */
export async function pushDraftClaims(
  claims: readonly NotificationClaim[],
  seasonName: (seasonId: string) => string,
): Promise<number> {
  try {
    if (readPushConfig() === null) return 0;

    const work: Array<Promise<unknown>> = [];
    let acted = 0;
    for (const claim of claims) {
      switch (claim.type) {
        case 'turn_started':
        case 'turn_reminder': {
          acted += 1;
          const spec: PushSpec = {
            payloadFor: (locale) =>
              turnPayload(
                {
                  kind: claim.type,
                  leagueName: seasonName(claim.season_id),
                  seasonId: claim.season_id,
                  poolId: claim.pool_id,
                  timerSeconds: claim.timer_seconds,
                  threshold: claim.type === 'turn_reminder' ? claim.threshold : undefined,
                },
                locale,
              ),
            ttlSeconds: ttlUntil(claim.deadline_at),
            urgency: 'high',
            topicKey: `draft-${claim.pool_id}`,
          };
          work.push(sendPushToPlayer(claim.player_id, spec));
          break;
        }
        case 'redraft_published': {
          acted += 1;
          const spec: PushSpec = {
            payloadFor: (locale) =>
              redraftPayload({ leagueName: seasonName(claim.season_id), seasonId: claim.season_id, poolId: claim.pool_id }, locale),
            ttlSeconds: PUSH_MAX_TTL_SECONDS,
            urgency: 'normal',
            topicKey: `draft-${claim.pool_id}`,
          };
          work.push(listPoolParticipantIds(claim.pool_id).then((ids) => sendPushToPlayers(ids, spec)));
          break;
        }
        case 'admin_alert':
          // Admins are pinged on Discord; no push.
          break;
      }
    }

    const settled = await Promise.allSettled(work);
    for (const result of settled) {
      if (result.status === 'rejected') console.error('[push] a draft push alert failed:', result.reason);
    }
    return acted;
  } catch (err) {
    console.error('[push] dispatching draft push alerts failed:', err);
    return 0;
  }
}
