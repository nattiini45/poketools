/**
 * Namespace `draft/discord` (owner B-CRON, draft-backend §11.3): the text of the
 * draft-tool Discord embeds (turn start, turn reminders, admin alerts, redraft
 * reveal, and the line-aware pick announcement). A live draft's turn start
 * names the pick time (`pickTime`), a slow draft's the deadline (`deadline`). Viewerless: `buildDraftEmbed`
 * translates with the per-webhook language `emitAsync` resolved.
 *
 * Discord markdown (`**bold**`) is part of the copy. Pokémon names never live
 * here: line labels come from `localizeLineLabel`. Deadlines are Discord
 * timestamp tokens (`<t:…:F>`, `<t:…:R>`) passed as params, which each reader's
 * client renders in their own zone and language.
 */
export default {
  turnStarted: {
    title: 'On the clock — {season}',
    body: "**{player}**, you're on the clock!",
  },
  turnReminder: {
    title: 'Reminder: {threshold} left — {season}',
    body: "**{player}**, you're still on the clock.",
  },
  threshold: {
    '8h': '8 hours',
    '4h': '4 hours',
    '1h': '1 hour',
  },
  slot: {
    round: 'Round',
    pick: 'Pick #',
    makeup: 'Make-up pick',
  },
  deadline: {
    line: 'Deadline: {discordTime} ({relative})',
    league: 'League time: {time} {zone}',
  },
  /** Live drafts: the pick timer instead of a deadline date. */
  pickTime: {
    minutes: {
      one: 'You have **{count} minute** to pick.',
      other: 'You have **{count} minutes** to pick.',
    },
    seconds: {
      one: 'You have **{count} second** to pick.',
      other: 'You have **{count} seconds** to pick.',
    },
  },
  adminAlert: {
    title: 'Admin action needed — {season}',
    blocked:
      '**{player}** can no longer fill their roster with the remaining budget. The draft is paused until an admin resolves the pick.',
    inplaceTimeout:
      "**{player}** ran out of time and nobody else is left to pick, so the make-up pick follows right away. An admin should check in.",
  },
  redraft: {
    title: 'Redraft: drops revealed — {season}',
    none: 'Nobody dropped a line.',
    dropLine: {
      one: '**{player}** drops {line} ({count} kill transferred)',
      other: '**{player}** drops {line} ({count} kills transferred)',
    },
  },
  pick: {
    lineDescription: '**{player}** picked **{line}**',
  },
} as const;
