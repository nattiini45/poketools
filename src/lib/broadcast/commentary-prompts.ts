import type { CasterData } from '@/types/caster';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

export interface CommentaryPrompt {
  type: 'h2h' | 'streak' | 'off_meta' | 'signature' | 'milestone' | 'advantage' | 'series' | 'first_meeting';
  priority: number; // higher = more important
  text: string;
}

/**
 * Generate commentary prompts from caster data + current game state.
 * Pure function — no AI, no side effects.
 *
 * `locale` is the language of the prompt text; `dataLocale` the language of
 * Pokémon names in it (the viewer's "Keep Pokémon terms in English" choice).
 * Both default to English, the pre-i18n output.
 */
export function generateCommentaryPrompts(
  data: CasterData,
  currentGame: {
    gameNumber: number;
    p1KOs: number;
    p2KOs: number;
    p1Remaining: number;
    p2Remaining: number;
    seriesScore: [number, number];
  },
  locale: Locale = 'en',
  dataLocale: Locale = locale,
): CommentaryPrompt[] {
  const t = createTranslator(broadcastCasterMessages, locale);
  const species = (name: string) => localizeSpecies(name, dataLocale);
  const prompts: CommentaryPrompt[] = [];

  // ── First meeting ──────────────────────────────────────────────
  if (data.h2h.player1Wins + data.h2h.player2Wins + data.h2h.draws === 0) {
    prompts.push({
      type: 'first_meeting',
      priority: 3,
      text: t('generated.firstMeeting', { p1: data.player1.name, p2: data.player2.name }),
    });
  }

  // ── H2H context ────────────────────────────────────────────────
  const totalH2H = data.h2h.player1Wins + data.h2h.player2Wins;
  if (totalH2H > 0) {
    const dominant = data.h2h.player1Wins > data.h2h.player2Wins
      ? data.player1.name
      : data.h2h.player2Wins > data.h2h.player1Wins
        ? data.player2.name
        : null;
    if (dominant) {
      prompts.push({
        type: 'h2h',
        priority: 4,
        text: t('generated.h2hLead', {
          name: dominant,
          a: Math.max(data.h2h.player1Wins, data.h2h.player2Wins),
          b: Math.min(data.h2h.player1Wins, data.h2h.player2Wins),
        }),
      });
    }
  }

  // ── Streak context ─────────────────────────────────────────────
  for (const player of [data.player1, data.player2]) {
    if (player.streak.type === 'win' && player.streak.count >= 3) {
      prompts.push({
        type: 'streak',
        priority: 5,
        text: t('generated.winStreak', { name: player.name, count: player.streak.count }),
      });
    }
    if (player.streak.type === 'loss' && player.streak.count >= 3) {
      prompts.push({
        type: 'streak',
        priority: 4,
        text: t('generated.lossStreak', { name: player.name, count: player.streak.count }),
      });
    }
  }

  // ── Off-meta callouts ──────────────────────────────────────────
  for (const player of [data.player1, data.player2]) {
    const spicy = player.pokemon.filter((p) => p.usagePct !== null && p.usagePct < 5);
    if (spicy.length > 0) {
      prompts.push({
        type: 'off_meta',
        priority: 3,
        text: t('generated.offMeta', { name: player.name, pokemon: spicy.map((p) => species(p.species)).join(', ') }),
      });
    }
  }

  // ── Signature pokemon ──────────────────────────────────────────
  for (const player of [data.player1, data.player2]) {
    if (player.signaturePokemon) {
      prompts.push({
        type: 'signature',
        priority: 2,
        text: t('generated.signature', { name: player.name, pokemon: species(player.signaturePokemon) }),
      });
    }
  }

  // ── KO milestone ───────────────────────────────────────────────
  for (const [name, kos] of [
    [data.player1.name, currentGame.p1KOs],
    [data.player2.name, currentGame.p2KOs],
  ] as const) {
    if (kos >= 3) {
      prompts.push({
        type: 'milestone',
        priority: 6,
        text: t('generated.koMilestone', { name, kos }),
      });
    }
  }

  // ── Advantage state ────────────────────────────────────────────
  const diff = currentGame.p1Remaining - currentGame.p2Remaining;
  if (Math.abs(diff) >= 2) {
    const leader = diff > 0 ? data.player1.name : data.player2.name;
    prompts.push({
      type: 'advantage',
      priority: 5,
      text: t('generated.advantage', { name: leader, count: Math.abs(diff) }),
    });
  }

  // ── Series context ─────────────────────────────────────────────
  const [s1, s2] = currentGame.seriesScore;
  const winsNeeded = Math.ceil(data.bestOf / 2);
  if (s1 === winsNeeded - 1 || s2 === winsNeeded - 1) {
    const onPoint = s1 > s2 ? data.player1.name : data.player2.name;
    prompts.push({
      type: 'series',
      priority: 7,
      text: t('generated.matchPoint', { name: onPoint, a: s1, b: s2 }),
    });
  }

  return prompts.sort((a, b) => b.priority - a.priority);
}
