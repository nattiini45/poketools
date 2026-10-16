import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import AchievementGrid from '../AchievementGrid';
import RatingBadge from '../RatingBadge';
import RatingHistoryChart from '../RatingHistoryChart';
import SignatureTeam from '../SignatureTeam';
import StreakIndicator from '../StreakIndicator';
import StreakRecords from '../StreakRecords';
import type { AchievementDefinition, EarnedAchievement } from '@/types/achievement';
import type { PlayerStreaks } from '@/types/streak';

function def(key: string, name: string, description: string, extra: Partial<AchievementDefinition> = {}): AchievementDefinition {
  return {
    id: `def-${key}`,
    key,
    name,
    description,
    icon: '🏆',
    category: 'milestone',
    tier: 'bronze',
    repeatable: false,
    hidden: false,
    criteria: { type: 'cumulative', stat: 'total_wins', op: 'gte', value: 1 },
    ...extra,
  };
}

const FIRST_WIN = def('first_win', 'First Victory', 'Win your first match.');
const CUSTOM = def('custom_admin', 'Admin Special', 'Made by an admin.', { category: 'rare', tier: 'gold' });
const EARNED: EarnedAchievement = {
  ...FIRST_WIN,
  earned_at: '2026-10-09T16:30:00Z',
  times_earned: 2,
  context: null,
};

const STREAKS = {
  current_win_streak: 4,
  current_ko_streak: 2,
  current_flawless_streak: 1,
  best_win_streak: 7,
  best_loss_streak: 3,
  best_ko_streak: 5,
  best_flawless_streak: 2,
} as PlayerStreaks;

describe('gamification components in both languages', () => {
  it('AchievementGrid renders the English catalog and falls back to DB text', () => {
    const html = renderWithI18n(<AchievementGrid achievements={[]} allDefinitions={[FIRST_WIN, CUSTOM]} />);
    expect(html).toContain('Achievements');
    expect(html).toContain('First Victory');
    expect(html).toContain('Admin Special');
    expect(html).toContain('milestone');
  });

  it('AchievementGrid renders German catalog text, category and tier names', () => {
    const html = renderWithI18n(<AchievementGrid achievements={[]} allDefinitions={[FIRST_WIN, CUSTOM]} />, {
      locale: 'de',
    });
    expect(html).toContain('Erfolge');
    expect(html).toContain('Erster Sieg');
    expect(html).toContain('title="Gewinne dein erstes Spiel."');
    expect(html).toContain('Meilenstein');
    expect(html).toContain('Selten');
    // Admin-created achievements keep their DB text.
    expect(html).toContain('Admin Special');
  });

  it('an earned badge shows the localized name, tier, count and earned date', () => {
    const en = renderWithI18n(<AchievementGrid achievements={[EARNED]} allDefinitions={[FIRST_WIN]} />);
    expect(en).toContain('First Victory');
    expect(en).toContain('bronze • x2');
    expect(en).toContain('Win your first match. • Earned 9 Oct 2026');

    const de = renderWithI18n(<AchievementGrid achievements={[EARNED]} allDefinitions={[FIRST_WIN]} />, {
      locale: 'de',
    });
    expect(de).toContain('Erster Sieg');
    expect(de).toContain('Bronze • 2×');
    expect(de).toContain('Erhalten am 9. Okt');
  });

  it('RatingBadge keeps ungrouped numbers and localizes the ball name', () => {
    const numeric = renderWithI18n(<RatingBadge rating={1500.4} rd={50} />);
    expect(numeric).toContain('1500 ± 50');

    const enTier = renderWithI18n(<RatingBadge rating={1500} rd={150} variant="tier" />);
    expect(enTier).toContain('Provisional');
    expect(enTier).toContain('(provisional)');

    const deTier = renderWithI18n(<RatingBadge rating={1500} rd={150} variant="tier" />, { locale: 'de' });
    expect(deTier).toContain('Vorläufig');
    expect(deTier).toContain('(vorläufig)');
    expect(deTier).not.toContain(' Ball<');
  });

  it('RatingHistoryChart labels and dates follow the locale', () => {
    const history = [
      { recorded_at: '2026-01-05T12:00:00Z', rating_after: 1500, rd_after: 100 },
      { recorded_at: '2026-10-09T12:00:00Z', rating_after: 1550, rd_after: 80 },
    ] as Parameters<typeof RatingHistoryChart>[0]['history'];
    const de = renderWithI18n(<RatingHistoryChart history={history} />, { locale: 'de' });
    expect(de).toContain('Wertungsverlauf');
    expect(de).toContain('9. Okt. 2026');
    expect(renderWithI18n(<RatingHistoryChart history={[]} />)).toContain('No rating history yet');
  });

  it('SignatureTeam shows German species names and plurals', () => {
    const signatures = [
      { slot_number: 1, pokemon_name: 'Charizard', games_played: 12 },
    ] as Parameters<typeof SignatureTeam>[0]['signatures'];
    const en = renderWithI18n(<SignatureTeam signatures={signatures} />);
    expect(en).toContain('Charizard');
    expect(en).toContain('12 games');

    const de = renderWithI18n(<SignatureTeam signatures={signatures} />, { locale: 'de' });
    expect(de).toContain('Glurak');
    expect(de).toContain('12 Partien');
    expect(de).toContain('freigeschaltet');
  });

  it('streak components render in both languages', () => {
    const en = renderToStaticMarkup(<StreakIndicator streaks={STREAKS} />);
    expect(en).toContain('title="Win Streak"');
    expect(en).toContain('4W');

    const de = renderWithI18n(
      <>
        <StreakIndicator streaks={STREAKS} />
        <StreakRecords streaks={STREAKS} />
      </>,
      { locale: 'de' },
    );
    expect(de).toContain('title="Siegesserie"');
    expect(de).toContain('4S');
    expect(de).toContain('Serienrekorde');
    expect(de).toContain('Beste KO-Serie');
  });
});
