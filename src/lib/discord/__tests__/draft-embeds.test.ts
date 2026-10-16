/**
 * Draft-tool Discord embeds (B-CRON, draft-backend §11.3): every event in `en`
 * and `de`, the ping rule, the Discord timestamp tokens, and the delegation
 * from `buildEmbed`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDraftEmbed, discordTimestamps, isDraftEmbedData } from '../draft-embeds';
import { buildEmbed } from '../embeds';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';
import type { DiscordEventPayload, DraftTurnData } from '@/types/discord';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
});

const DEADLINE = '2026-10-11T21:59:59Z';
const UNIX = 1791755999;

function payload(event_type: DiscordEventPayload['event_type'], data: DiscordEventPayload['data']): DiscordEventPayload {
  return { event_type, tournament_id: '', season_id: 'season-1', data };
}

const turn: DraftTurnData = {
  kind: 'draft_turn',
  season_name: 'EvoLiga S1',
  player_name: 'Misty',
  player_discord_id: '123456',
  deadline_at: DEADLINE,
  timer_seconds: 43200,
  mode: 'slow',
  round: 3,
  pick_number: 17,
  is_makeup: false,
};

const turnPayload = payload('draft_turn_started', turn);
const reminderPayload = payload('draft_turn_reminder', { ...turn, kind: 'draft_turn_reminder', threshold: '4h' });
const blockedPayload = payload('draft_slot_blocked', {
  kind: 'draft_admin_alert', season_name: 'EvoLiga S1', player_name: 'Brock', alert_kind: 'blocked',
});
const inplacePayload = payload('draft_slot_blocked', {
  kind: 'draft_admin_alert', season_name: 'EvoLiga S1', player_name: 'Brock', alert_kind: 'inplace_timeout',
});
const redraftPayload = payload('draft_redraft_published', {
  kind: 'draft_redraft_published',
  season_name: 'EvoLiga S1',
  drops: [
    { player_name: 'Ash', base: 'Teddiursa', stage3: 'Ursaluna-Bloodmoon', transferred_real_kills: 1 },
    { player_name: 'Misty', base: 'Oshawott', stage3: 'Samurott-Hisui', transferred_real_kills: 4 },
  ],
});
const linePickPayload = payload('draft_pick_made', {
  kind: 'draft_pick',
  player_name: 'Ash',
  pokemon_name: 'Teddiursa',
  pick_number: 5,
  round: 1,
  season_name: 'EvoLiga S1',
  next_picker_name: 'Misty',
  next_picker_discord_id: '123456',
  line: { base: 'Teddiursa', stage3: 'Ursaluna-Bloodmoon' },
});

describe('discordTimestamps', () => {
  it('renders the <t:…:F> and <t:…:R> tokens for an ISO instant', () => {
    expect(discordTimestamps(DEADLINE)).toEqual({ full: `<t:${UNIX}:F>`, relative: `<t:${UNIX}:R>` });
  });
  it('returns null for an unparseable instant', () => {
    expect(discordTimestamps('not a date')).toBeNull();
  });
});

describe('draft_turn_started', () => {
  it('en: title, body, Discord timestamps, league-zone line, round/pick fields', () => {
    const { embed } = buildDraftEmbed(turnPayload, DEFAULT_FORMAT_OPTIONS, 'en');
    expect(embed.title).toBe('On the clock — EvoLiga S1');
    expect(embed.description).toContain("**Misty**, you're on the clock!");
    expect(embed.description).toContain(`Deadline: <t:${UNIX}:F> (<t:${UNIX}:R>)`);
    expect(embed.description).toMatch(/League time: .*23:59/);
    expect(embed.fields).toEqual([
      { name: 'Round', value: '3', inline: true },
      { name: 'Pick #', value: '17', inline: true },
    ]);
  });

  it('de: German copy and the league time in Berlin time', () => {
    const { embed } = buildDraftEmbed(turnPayload, DEFAULT_FORMAT_OPTIONS, 'de');
    expect(embed.title).toBe('Am Zug – EvoLiga S1');
    expect(embed.description).toContain('Du bist am Zug, **Misty**!');
    expect(embed.description).toContain(`Frist: <t:${UNIX}:F> (<t:${UNIX}:R>)`);
    expect(embed.description).toContain('Ligazeit: So., 11. Okt., 23:59 MESZ');
    expect(embed.fields?.[0].name).toBe('Runde');
  });

  it('pings the player in the message content whenever the Discord id is present', () => {
    expect(buildDraftEmbed(turnPayload, { ...DEFAULT_FORMAT_OPTIONS, ping_next_drafter: false }, 'en').content).toBe('<@123456>');
    const noId = payload('draft_turn_started', { ...turn, player_discord_id: undefined });
    expect(buildDraftEmbed(noId, DEFAULT_FORMAT_OPTIONS, 'en').content).toBeUndefined();
  });

  it('marks a make-up pick', () => {
    const makeup = payload('draft_turn_started', { ...turn, is_makeup: true });
    expect(buildDraftEmbed(makeup, DEFAULT_FORMAT_OPTIONS, 'de').embed.fields?.map((f) => f.name)).toContain('Nachhol-Pick');
    expect(buildDraftEmbed(makeup, DEFAULT_FORMAT_OPTIONS, 'en').embed.fields?.map((f) => f.name)).toContain('Make-up pick');
  });
});

describe('draft_turn_started in a live draft', () => {
  const live = (timer_seconds: number) =>
    payload('draft_turn_started', { ...turn, mode: 'live', timer_seconds, deadline_at: '2026-10-11T12:02:00Z' });

  it('en: the pick time in minutes, no deadline date, same ping', () => {
    const { embed, content } = buildDraftEmbed(live(120), DEFAULT_FORMAT_OPTIONS, 'en');
    expect(embed.title).toBe('On the clock — EvoLiga S1');
    expect(embed.description).toContain("**Misty**, you're on the clock!");
    expect(embed.description).toContain('You have **2 minutes** to pick.');
    expect(embed.description).not.toContain('Deadline');
    expect(embed.description).not.toContain('League time');
    expect(embed.description).not.toContain('<t:');
    expect(content).toBe('<@123456>');
  });

  it('de: German pick time, singular and plural', () => {
    expect(buildDraftEmbed(live(180), DEFAULT_FORMAT_OPTIONS, 'de').embed.description).toContain(
      'Du hast **3 Minuten** für deinen Pick.',
    );
    const one = buildDraftEmbed(live(60), DEFAULT_FORMAT_OPTIONS, 'de').embed.description;
    expect(one).toContain('Du hast **1 Minute** für deinen Pick.');
    expect(one).not.toContain('Frist');
    expect(buildDraftEmbed(live(60), DEFAULT_FORMAT_OPTIONS, 'en').embed.description).toContain(
      'You have **1 minute** to pick.',
    );
  });

  it('a timer that is not whole minutes reads in seconds (never rounded)', () => {
    expect(buildDraftEmbed(live(90), DEFAULT_FORMAT_OPTIONS, 'en').embed.description).toContain(
      'You have **90 seconds** to pick.',
    );
    expect(buildDraftEmbed(live(90), DEFAULT_FORMAT_OPTIONS, 'de').embed.description).toContain(
      'Du hast **90 Sekunden** für deinen Pick.',
    );
  });

  it('slow keeps the deadline wording', () => {
    const { embed } = buildDraftEmbed(turnPayload, DEFAULT_FORMAT_OPTIONS, 'en');
    expect(embed.description).toContain(`Deadline: <t:${UNIX}:F>`);
    expect(embed.description).not.toContain('to pick.');
  });
});

describe('draft_turn_reminder', () => {
  it('en: threshold in the title, still on the clock, pinged', () => {
    const result = buildDraftEmbed(reminderPayload, DEFAULT_FORMAT_OPTIONS, 'en');
    expect(result.embed.title).toBe('Reminder: 4 hours left — EvoLiga S1');
    expect(result.embed.description).toContain("**Misty**, you're still on the clock.");
    expect(result.embed.description).toContain(`<t:${UNIX}:R>`);
    expect(result.content).toBe('<@123456>');
  });

  it('de: German threshold and copy', () => {
    const { embed } = buildDraftEmbed(reminderPayload, DEFAULT_FORMAT_OPTIONS, 'de');
    expect(embed.title).toBe('Erinnerung: noch 4 Stunden – EvoLiga S1');
    expect(embed.description).toContain('Du bist immer noch am Zug, **Misty**.');
    expect(embed.description).toContain('Frist:');
  });

  it('the 1h reminder uses the singular', () => {
    const oneHour = payload('draft_turn_reminder', { ...turn, kind: 'draft_turn_reminder', threshold: '1h' });
    expect(buildDraftEmbed(oneHour, DEFAULT_FORMAT_OPTIONS, 'de').embed.title).toBe('Erinnerung: noch 1 Stunde – EvoLiga S1');
    expect(buildDraftEmbed(oneHour, DEFAULT_FORMAT_OPTIONS, 'en').embed.title).toBe('Reminder: 1 hour left — EvoLiga S1');
  });
});

describe('draft_slot_blocked (admin alert)', () => {
  it('en: blocked and in-place timeout texts', () => {
    const blocked = buildDraftEmbed(blockedPayload, DEFAULT_FORMAT_OPTIONS, 'en');
    expect(blocked.embed.title).toBe('Admin action needed — EvoLiga S1');
    expect(blocked.embed.description).toContain('**Brock** can no longer fill their roster');
    expect(buildDraftEmbed(inplacePayload, DEFAULT_FORMAT_OPTIONS, 'en').embed.description).toContain('**Brock** ran out of time');
  });

  it('de: German texts', () => {
    const blocked = buildDraftEmbed(blockedPayload, DEFAULT_FORMAT_OPTIONS, 'de');
    expect(blocked.embed.title).toBe('Admin-Eingriff nötig – EvoLiga S1');
    expect(blocked.embed.description).toContain('kann den Kader mit dem Restbudget nicht mehr füllen');
    expect(buildDraftEmbed(inplacePayload, DEFAULT_FORMAT_OPTIONS, 'de').embed.description).toContain('Nachhol-Pick');
  });

  it('never pings', () => {
    expect(buildDraftEmbed(blockedPayload, { ...DEFAULT_FORMAT_OPTIONS, ping_next_drafter: true }, 'en').content).toBeUndefined();
  });
});

describe('draft_redraft_published', () => {
  it('en: one line per drop with the line label and the transferred kills (plural)', () => {
    const { embed, content } = buildDraftEmbed(redraftPayload, DEFAULT_FORMAT_OPTIONS, 'en');
    expect(embed.title).toBe('Redraft: drops revealed — EvoLiga S1');
    expect(embed.description).toBe(
      '**Ash** drops Teddiursa → Ursaluna-Bloodmoon (1 kill transferred)\n' +
        '**Misty** drops Oshawott → Samurott-Hisui (4 kills transferred)',
    );
    expect(content).toBeUndefined();
  });

  it('de: German line labels from the pkmn layer', () => {
    const { embed } = buildDraftEmbed(redraftPayload, DEFAULT_FORMAT_OPTIONS, 'de');
    expect(embed.title).toBe('Redraft: Abgaben veröffentlicht – EvoLiga S1');
    expect(embed.description).toContain('**Ash** gibt Teddiursa → Blutmond-Ursaluna ab (1 Kill wird übertragen)');
    expect(embed.description).toContain('Ottaro → Hisui-Admurai ab (4 Kills werden übertragen)');
  });

  it('no drops reads as such', () => {
    const empty = payload('draft_redraft_published', { kind: 'draft_redraft_published', season_name: 'S', drops: [] });
    expect(buildDraftEmbed(empty, DEFAULT_FORMAT_OPTIONS, 'de').embed.description).toBe('Niemand hat eine Linie abgegeben.');
  });
});

describe('draft_pick_made with a line', () => {
  it('en: localized line label, outbound chrome, ping only when the webhook opts in', () => {
    const plain = buildDraftEmbed(linePickPayload, DEFAULT_FORMAT_OPTIONS, 'en');
    expect(plain.embed.title).toBe('Draft Pick — EvoLiga S1');
    expect(plain.embed.description).toBe('**Ash** picked **Teddiursa → Ursaluna-Bloodmoon**');
    expect(plain.embed.footer?.text).toBe('Next pick: Misty');
    expect(plain.content).toBeUndefined();
    const pinged = buildDraftEmbed(linePickPayload, { ...DEFAULT_FORMAT_OPTIONS, ping_next_drafter: true }, 'en');
    expect(pinged.content).toMatch(/^<@123456> /);
  });

  it('de: German line label', () => {
    const { embed } = buildDraftEmbed(linePickPayload, DEFAULT_FORMAT_OPTIONS, 'de');
    expect(embed.description).toBe('**Ash** hat **Teddiursa → Blutmond-Ursaluna** gepickt');
    expect(embed.fields?.[0].name).toBe('Runde');
  });
});

describe('buildEmbed delegation', () => {
  it('routes the four draft events and a line-carrying pick to the draft builder', () => {
    for (const p of [turnPayload, reminderPayload, blockedPayload, redraftPayload, linePickPayload]) {
      expect(buildEmbed(p, DEFAULT_FORMAT_OPTIONS, 'de')).toEqual(buildDraftEmbed(p, DEFAULT_FORMAT_OPTIONS, 'de'));
    }
  });

  it('a legacy pick without a line keeps the old embed', () => {
    const legacy = payload('draft_pick_made', {
      kind: 'draft_pick', player_name: 'Ash', pokemon_name: 'Pikachu', pick_number: 1, round: 1, season_name: 'S1',
    });
    expect(isDraftEmbedData(legacy.data)).toBe(false);
    expect(buildEmbed(legacy, DEFAULT_FORMAT_OPTIONS, 'en').embed.description).toBe('**Ash** selected **Pikachu**');
  });

  it('buildDraftEmbed refuses a non-draft event', () => {
    const match = payload('match_disputed', {
      kind: 'match_disputed', player_1_name: 'A', player_2_name: 'B', disputer_name: 'A', tournament_name: 'T',
    });
    expect(() => buildDraftEmbed(match, DEFAULT_FORMAT_OPTIONS, 'en')).toThrow(/not a draft embed/);
  });
});
