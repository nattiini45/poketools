'use client';

import type { ReactNode } from 'react';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import RatingBadge from '@/components/gamification/RatingBadge';
import SignatureTeam from '@/components/gamification/SignatureTeam';
import StreakChips from '@/components/gamification/StreakChips';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip from '@/components/ui/SkewChip';
import { useFormatter, useT } from '@/i18n/client';
import { profileMessages } from '@/i18n/messages/profile';
import type { PublicPlayer } from '@/types/player';
import type { ProfileHeadlineStats } from '@/types/profile';
import type { SignaturePokemon } from '@/types/signature';
import type { PlayerStreaks } from '@/types/streak';
import ResultToken from './ResultToken';

interface ProfileHeaderProps {
  player: PublicPlayer;
  headline: ProfileHeadlineStats;
  recentForm: ('W' | 'L' | 'D')[];
  /** The rating plate: a rating, `null` for an unrated player, or left out to show no rating at all. */
  rating?: { rating: number; rd: number } | null;
  /** Running streaks as chips (the page hands them over only to a signed-in viewer). */
  streaks?: PlayerStreaks | null;
  /** The six signature slots on the card's right side. */
  signatures?: SignaturePokemon[];
  /** The card's own action, e.g. "Edit profile" on the viewer's own profile. */
  action?: ReactNode;
}

function StatPlate({ label, value }: { label: string; value: string | number }) {
  return (
    <li className="skew-plate justify-items-start px-3.5 py-2">
      <span aria-hidden="true" className="skew-plate-bg border border-hairline-strong bg-surface" />
      <span className="flex flex-col">
        <span className="font-heading text-title text-fg tabular-nums">{value}</span>
        <span className="text-caption text-fg-muted">{label}</span>
      </span>
    </li>
  );
}

/**
 * The trainer card (Direction B, character select): the avatar and name on the arena sand, the rating plate and
 * streak chips, the record as scoreboard plates, and the signature team as six sprite slots behind the amber slash.
 */
export default function ProfileHeader({ player, headline, recentForm, rating, streaks, signatures, action }: ProfileHeaderProps) {
  const t = useT(profileMessages);
  const formatter = useFormatter();
  const joinedDate = player.joined_date ? formatter.instant(player.joined_date, 'monthYear') : null;

  return (
    <section
      className={
        signatures
          ? 'grid overflow-hidden rounded-poke-xl border border-hairline bg-sunken lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]'
          : 'overflow-hidden rounded-poke-xl border border-hairline bg-sunken'
      }
    >
      <div className={signatures ? 'flex flex-col gap-5 p-5 sm:p-6 lg:pr-16' : 'flex flex-col gap-5 p-5 sm:p-6'}>
        {/* Identity */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <PlayerAvatar avatarUrl={player.avatar_url} name={player.name} size={96} className="ring-4" />
          <div className="min-w-0 flex-1 basis-40">
            <h1 className="font-heading text-display text-fg [overflow-wrap:anywhere]">{player.name}</h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-body text-fg">
              {player.ps_username && (
                <span>
                  <span className="text-fg-muted">{t('header.ps')}</span> {player.ps_username}
                </span>
              )}
              {player.champions_username && (
                <span>
                  <span className="text-fg-muted">{t('header.champions')}</span> {player.champions_username}
                </span>
              )}
            </div>
            {joinedDate && <p className="mt-1 text-caption text-fg-muted">{t('header.memberSince', { date: joinedDate })}</p>}
          </div>
          {action}
        </div>

        {/* Rating and streaks */}
        {(rating !== undefined || streaks) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-1.5">
            {rating ? (
              <RatingBadge rating={rating.rating} rd={rating.rd} variant="plate" />
            ) : rating === null ? (
              <SkewChip className="px-3 py-1.5">{t('page.unrated')}</SkewChip>
            ) : null}
            {streaks && <StreakChips streaks={streaks} />}
          </div>
        )}

        {/* Headline stats */}
        <ul className="flex flex-wrap gap-x-4 gap-y-2.5 px-1.5">
          <StatPlate
            label={t('header.record')}
            value={headline.total_draws ? t('header.recordWithDraws', { wins: headline.total_wins, draws: headline.total_draws, losses: headline.total_losses }) : t('header.recordValue', { wins: headline.total_wins, losses: headline.total_losses })}
          />
          <StatPlate label={t('header.winRate')} value={formatter.percentOf(headline.win_rate, 0)} />
          <StatPlate label={t('header.totalKos')} value={formatter.number(headline.total_kos_dealt)} />
          <StatPlate label={t('header.pokemon')} value={formatter.number(headline.unique_pokemon_used)} />
          {headline.tournaments_won > 0 && (
            <StatPlate label={t('header.titles')} value={formatter.number(headline.tournaments_won)} />
          )}
        </ul>

        {/* Recent form */}
        {recentForm.length > 0 && (
          <div className="flex items-center gap-2.5">
            <span className="text-caption text-fg-muted">{t('header.form')}</span>
            <div className="flex gap-1">
              {recentForm.map((r, i) => (
                <ResultToken key={i} result={r} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Signature team */}
      {signatures && (
        <div className="relative flex flex-col gap-4 border-t border-hairline bg-elevated p-5 sm:p-6 lg:border-t-0 lg:pl-4">
          {/* The amber slash between the two sides, as on the versus slab. */}
          <span aria-hidden="true" className="absolute inset-y-0 -left-12 hidden w-24 bg-elevated lg:block [transform:skewX(var(--skew))]" />
          <span aria-hidden="true" className="absolute inset-y-0 -left-12 hidden w-1 bg-accent-fill lg:block [transform:skewX(var(--skew))]" />
          <div className="relative flex items-center gap-2.5">
            <ItemIcon item="choice-scarf" />
            <h2 className="min-w-0 flex-1 font-heading text-title text-fg">{t('page.signatures')}</h2>
            <span className="shrink-0 text-caption text-fg-muted tabular-nums">
              {t('header.signatureCount', { count: signatures.length, total: 6 })}
            </span>
          </div>
          <div className="relative">
            <SignatureTeam signatures={signatures} />
          </div>
        </div>
      )}
    </section>
  );
}
