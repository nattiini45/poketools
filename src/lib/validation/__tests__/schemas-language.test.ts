import { describe, it, expect } from 'vitest';
import {
  contentLanguageSchema,
  DRAFT_DISCORD_EVENT_TYPES,
  discordEventTypeSchema,
  seasonCreateSchema,
  seasonUpdateSchema,
  webhookCreateSchema,
  webhookLanguageSchema,
  webhookUpdateSchema,
} from '../schemas';

const SEASON_BASE = { name: 'EvoLiga S3', format_type: 'evolution_point_buy' } as const;
const WEBHOOK_BASE = {
  scope_type: 'season',
  scope_id: '00000000-0000-4000-8000-000000000001',
  webhook_url: 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL',
  label: 'League feed',
} as const;

describe('season language (i18n-core §6.1)', () => {
  it.each(['de', 'en'])('create accepts %s', (language) => {
    const r = seasonCreateSchema.safeParse({ ...SEASON_BASE, language });
    expect(r.success).toBe(true);
    expect(r.success && r.data.language).toBe(language);
  });

  it('create: language is optional (the column default de applies)', () => {
    const r = seasonCreateSchema.safeParse(SEASON_BASE);
    expect(r.success).toBe(true);
    expect(r.success && r.data.language).toBeUndefined();
  });

  it.each(['fr', 'DE', '', 'league', null, 1])('create rejects %p', (language) => {
    expect(seasonCreateSchema.safeParse({ ...SEASON_BASE, language }).success).toBe(false);
  });

  it.each(['de', 'en'])('update accepts %s alone', (language) => {
    const r = seasonUpdateSchema.safeParse({ language });
    expect(r.success).toBe(true);
    expect(r.success && r.data.language).toBe(language);
  });

  it.each(['fr', 'league', null])('update rejects %p', (language) => {
    expect(seasonUpdateSchema.safeParse({ language }).success).toBe(false);
  });

  it('contentLanguageSchema mirrors LOCALES', () => {
    expect(contentLanguageSchema.options).toEqual(['en', 'de']);
  });
});

describe('webhook format_options.language', () => {
  it.each(['league', 'de', 'en'])('create accepts %s', (language) => {
    const r = webhookCreateSchema.safeParse({ ...WEBHOOK_BASE, format_options: { language } });
    expect(r.success).toBe(true);
    expect(r.success && r.data.format_options?.language).toBe(language);
  });

  it.each(['league', 'de', 'en'])('update accepts %s', (language) => {
    const r = webhookUpdateSchema.safeParse({ format_options: { language } });
    expect(r.success).toBe(true);
    expect(r.success && r.data.format_options?.language).toBe(language);
  });

  it('language is optional next to the existing options', () => {
    const r = webhookCreateSchema.safeParse({ ...WEBHOOK_BASE, format_options: { spoiler_results: false } });
    expect(r.success).toBe(true);
    expect(r.success && r.data.format_options?.language).toBeUndefined();
  });

  it.each(['fr', 'EN', '', null])('create and update reject %p', (language) => {
    expect(webhookCreateSchema.safeParse({ ...WEBHOOK_BASE, format_options: { language } }).success).toBe(false);
    expect(webhookUpdateSchema.safeParse({ format_options: { language } }).success).toBe(false);
  });

  it('webhookLanguageSchema options', () => {
    expect(webhookLanguageSchema.options).toEqual(['league', 'en', 'de']);
  });
});

describe('draft Discord events (draft-backend §11.3)', () => {
  // The enum spreads DRAFT_DISCORD_EVENT_TYPES; `DiscordEventType`
  // (src/types/discord.ts) carries the same four names.
  const DRAFT_EVENTS = [
    'draft_turn_started',
    'draft_turn_reminder',
    'draft_slot_blocked',
    'draft_redraft_published',
  ] as const;

  it('lists exactly the four draft event names', () => {
    expect([...DRAFT_DISCORD_EVENT_TYPES]).toEqual([...DRAFT_EVENTS]);
  });

  it.each(DRAFT_EVENTS)('%s is accepted by the enum', (name) => {
    expect(discordEventTypeSchema.safeParse(name).success).toBe(true);
  });

  it('existing events still parse', () => {
    expect(discordEventTypeSchema.safeParse('draft_pick_made').success).toBe(true);
    expect(discordEventTypeSchema.safeParse('match_confirmed').success).toBe(true);
  });

  it.each(['draft_turn_ended', 'draft_redraft', 'DRAFT_TURN_STARTED', ''])('unknown event %p fails', (name) => {
    expect(discordEventTypeSchema.safeParse(name).success).toBe(false);
  });

  it('a webhook event_filter rejects an unknown event', () => {
    expect(webhookCreateSchema.safeParse({ ...WEBHOOK_BASE, event_filter: ['draft_pick_made'] }).success).toBe(true);
    expect(webhookUpdateSchema.safeParse({ event_filter: ['draft_pick_made', 'nope'] }).success).toBe(false);
  });
});
