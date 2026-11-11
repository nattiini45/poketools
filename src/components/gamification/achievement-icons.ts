import { createElement } from 'react';
import {
  Award,
  Backpack,
  BookOpen,
  ChartNoAxesColumn,
  Crosshair,
  Crown,
  Flag,
  Flame,
  Gem,
  GraduationCap,
  Heart,
  Medal,
  Rocket,
  Shield,
  Skull,
  Sparkles,
  Star,
  Sword,
  Swords,
  Target,
  Trophy,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AchievementCategory } from '@/types/achievement';

/**
 * Lucide icons for achievements (redesign C4). `achievement_definitions.icon` stores whatever an admin typed,
 * usually an emoji; the profile draws one icon system instead. Resolution order: the definition's key (the seeded
 * catalog, `src/i18n/messages/achievements`), then the stored emoji, then the category, then `Award`.
 */
const BY_KEY: Record<string, LucideIcon> = {
  first_win: Star,
  ten_wins: Medal,
  fifty_wins: Award,
  hundred_wins: Gem,
  clean_sweep: Zap,
  flawless: Sparkles,
  giant_killer: Sword,
  streak_5: Flame,
  streak_10: Rocket,
  collector_25: Backpack,
  collector_50: GraduationCap,
  collector_100: BookOpen,
  iron_wall: Shield,
  ko_machine: Crosshair,
  tournament_champ: Trophy,
  back_to_back: Crown,
};

const BY_EMOJI: Record<string, LucideIcon> = {
  '🏆': Trophy,
  '🥇': Medal,
  '🥈': Medal,
  '🥉': Medal,
  '🏅': Medal,
  '🎖': Award,
  '👑': Crown,
  '⭐': Star,
  '🌟': Star,
  '✨': Sparkles,
  '💎': Gem,
  '🔥': Flame,
  '⚡': Zap,
  '🚀': Rocket,
  '⚔': Swords,
  '🗡': Sword,
  '🛡': Shield,
  '🎯': Target,
  '💀': Skull,
  '❤': Heart,
  '📚': BookOpen,
  '📖': BookOpen,
  '🎓': GraduationCap,
  '🎒': Backpack,
  '👥': Users,
  '🤝': Users,
  '🚩': Flag,
  '🏁': Flag,
  '📊': ChartNoAxesColumn,
  '📈': ChartNoAxesColumn,
};

const BY_CATEGORY: Record<AchievementCategory, LucideIcon> = {
  combat: Swords,
  milestone: Flag,
  social: Users,
  rare: Gem,
  meta: ChartNoAxesColumn,
};

/** The emoji without its variation selector, so "⚔" and "⚔️" are one key. */
function emojiKey(icon: string): string {
  return icon.trim().replace(/\uFE0F/g, '');
}

export function achievementIcon(definition: { key: string; icon: string | null; category: string }): LucideIcon {
  return (
    BY_KEY[definition.key] ??
    (definition.icon ? BY_EMOJI[emojiKey(definition.icon)] : undefined) ??
    BY_CATEGORY[definition.category as AchievementCategory] ??
    Award
  );
}

/** The achievement's icon, decorative: the name beside it labels the badge. */
export function AchievementIcon({ definition, className }: { definition: Parameters<typeof achievementIcon>[0]; className?: string }) {
  return createElement(achievementIcon(definition), { 'aria-hidden': true, className });
}
