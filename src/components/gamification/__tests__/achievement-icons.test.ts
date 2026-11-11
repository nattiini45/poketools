import { describe, expect, it } from 'vitest';
import { Award, Flag, Flame, Star, Swords, Trophy, Users } from 'lucide-react';
import { achievementsMessages } from '@/i18n/messages/achievements';
import { achievementIcon } from '../achievement-icons';
import { achievementProgress } from '../achievement-progress';
import type { AchievementCriteria } from '@/types/achievement';

describe('achievementIcon', () => {
  it('gives every seeded achievement its own icon by key, whatever emoji is stored', () => {
    const keys = Object.keys(achievementsMessages.en);
    const icons = keys.map((key) => achievementIcon({ key, icon: '🙂', category: 'meta' }));
    expect(new Set(icons).size).toBe(keys.length);
    expect(achievementIcon({ key: 'first_win', icon: null, category: 'milestone' })).toBe(Star);
    expect(achievementIcon({ key: 'tournament_champ', icon: '🙂', category: 'rare' })).toBe(Trophy);
  });

  it('maps a known stored emoji for an admin-made achievement, with or without the variation selector', () => {
    expect(achievementIcon({ key: 'admin_made', icon: '🔥', category: 'social' })).toBe(Flame);
    expect(achievementIcon({ key: 'admin_made', icon: ' ⚔️ ', category: 'social' })).toBe(Swords);
    expect(achievementIcon({ key: 'admin_made', icon: '⚔', category: 'social' })).toBe(Swords);
  });

  it('falls back to the category icon, then to Award', () => {
    expect(achievementIcon({ key: 'admin_made', icon: '🎪', category: 'social' })).toBe(Users);
    expect(achievementIcon({ key: 'admin_made', icon: null, category: 'milestone' })).toBe(Flag);
    expect(achievementIcon({ key: 'admin_made', icon: 'not an emoji', category: 'unknown' })).toBe(Award);
  });
});

describe('achievementProgress', () => {
  const wins = (value: number): { criteria: AchievementCriteria } => ({ criteria: { type: 'cumulative', stat: 'total_wins', op: 'gte', value } });

  it('counts a "reach N" criterion against the number the profile has', () => {
    expect(achievementProgress(wins(10), { totalWins: 7 })).toEqual({ current: 7, target: 10 });
    expect(achievementProgress({ criteria: { type: 'streak', stat: 'win_streak', op: 'gte', value: 5 } }, { winStreak: 4 })).toEqual({ current: 4, target: 5 });
    expect(
      achievementProgress({ criteria: { type: 'meta', condition: 'used_unique_pokemon', op: 'gte', value: 25 } }, { uniquePokemon: 9 }),
    ).toEqual({ current: 9, target: 25 });
  });

  it('shows nothing without a count, for a one-step target, at the target, or for criteria it cannot count', () => {
    expect(achievementProgress(wins(10), undefined)).toBeNull();
    expect(achievementProgress(wins(10), {})).toBeNull();
    expect(achievementProgress(wins(1), { totalWins: 0 })).toBeNull();
    expect(achievementProgress(wins(10), { totalWins: 10 })).toBeNull();
    expect(achievementProgress({ criteria: { type: 'single_match', stat: 'kos_dealt_total', op: 'gte', value: 6 } }, { totalKos: 3 })).toBeNull();
    expect(achievementProgress({ criteria: { type: 'custom', condition: 'x' } as unknown as AchievementCriteria }, { totalWins: 3 })).toBeNull();
    expect(achievementProgress({ criteria: { type: 'streak', stat: 'win_streak', op: 'gte', value: 5 } }, { totalWins: 3 })).toBeNull();
  });
});
