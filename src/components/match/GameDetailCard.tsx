'use client';

import { useState } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import AnimatedSprite from '@/components/shared/AnimatedSprite';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import MovesOverflowList from '@/components/match/MovesOverflowList';
import GameDetailEditForm from '@/components/match/GameDetailEditForm';
import { motion, AnimatePresence } from '@/components/shared/motion';
import { useDataLocale, useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { matchMessages } from '@/i18n/messages/match';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { GameSummary } from '@/types/match';
import type { BattleStat } from '@/types/game';

interface GameDetailCardProps {
  game: GameSummary;
  stats: BattleStat[];
  player1Id: string;
  player2Id: string;
  player1Name: string;
  player2Name: string;
  defaultCollapsed?: boolean;
  /**
   * When true, an "Edit" button is shown that swaps the card body into an
   * inline admin edit form. The parent is responsible for gating this on
   * site-admin or per-tournament admin permissions.
   */
  canEdit?: boolean;
}

function PokemonRow({ stat, index }: { stat: BattleStat; index: number }) {
  const t = useT(matchMessages);
  const dataLocale = useDataLocale();
  const notBrought = !stat.was_brought;

  return (
    <div className={`flex items-start gap-2 py-1.5 ${notBrought ? 'opacity-40' : ''}`}>
      <AnimatedSprite delay={index * 0.05}>
        <PokemonSprite name={stat.pokemon_name} size={36} animated={!notBrought} />
      </AnimatedSprite>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <PokemonLink name={stat.pokemon_name}>
            <span className={`font-medium text-sm ${notBrought ? 'text-poke-text-muted' : 'text-poke-text-primary'}`}>
              {localizeSpecies(stat.pokemon_name, dataLocale)}
            </span>
          </PokemonLink>
          {stat.was_lead && (
            <Badge variant="blue" size="sm" className="uppercase">{t('shared.lead')}</Badge>
          )}
          {stat.kos_dealt > 0 && (
            <Badge variant="green" size="sm">
              {t('shared.kos', { count: stat.kos_dealt })}
            </Badge>
          )}
          {stat.was_koed && (
            <Badge variant="red" size="sm">{t('shared.koed')}</Badge>
          )}
          {notBrought && (
            <span className="text-[10px] text-poke-text-muted italic">{t('gameCard.notBrought')}</span>
          )}
        </div>
        {stat.moves_used.length > 0 && (
          <MovesOverflowList
            moves={stat.moves_used}
            className="text-xs text-poke-text-muted mt-0.5"
          />
        )}
        {stat.turns_active > 0 && (
          <p className="text-[10px] text-poke-text-muted mt-0.5">
            {t('gameCard.turnsActive', { count: stat.turns_active })}
          </p>
        )}
      </div>
    </div>
  );
}

function PlayerTeamColumn({
  playerName,
  stats,
  isWinner,
}: {
  playerName: string;
  stats: BattleStat[];
  isWinner: boolean;
}) {
  const sorted = [...stats].sort((a, b) => {
    // Non-brought Pokémon go to the bottom
    if (a.was_brought !== b.was_brought) return a.was_brought ? -1 : 1;
    // Leads first among brought Pokémon
    if (a.was_lead !== b.was_lead) return a.was_lead ? -1 : 1;
    return b.kos_dealt - a.kos_dealt;
  });

  return (
    <div className="flex-1 min-w-0">
      <h4 className={`text-sm font-heading font-semibold mb-2 ${isWinner ? 'text-poke-green' : 'text-poke-text-secondary'}`}>
        {playerName} {isWinner && '★'}
      </h4>
      <div className="space-y-0.5">
        {sorted.map((stat, i) => (
          <PokemonRow key={stat.id} stat={stat} index={i} />
        ))}
      </div>
    </div>
  );
}

export default function GameDetailCard({
  game,
  stats,
  player1Id,
  player2Id,
  player1Name,
  player2Name,
  defaultCollapsed = false,
  canEdit = false,
}: GameDetailCardProps) {
  const t = useT(matchMessages);
  const tEnum = useT(enumMessages);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [editing, setEditing] = useState(false);

  const p1Stats = stats.filter((s) => s.player_id === player1Id);
  const p2Stats = stats.filter((s) => s.player_id === player2Id);
  const hasStats = p1Stats.length > 0 || p2Stats.length > 0;

  const winnerName =
    game.winner_id === player1Id
      ? player1Name
      : game.winner_id === player2Id
        ? player2Name
        : null;

  const showManuallyEditedBadge = game.source === 'ps_replay' && game.stats_locked;

  function handleEditClick() {
    setCollapsed(false);
    setEditing(true);
  }

  function handleCancelEdit() {
    setEditing(false);
  }

  function handleSaved() {
    setEditing(false);
  }

  // Body is forced expanded while editing so the admin always sees their form.
  const bodyExpanded = !collapsed || editing;

  return (
    <Card variant="outlined" padding="md">
      {/* Header — clickable region toggles collapse; action buttons stop propagation */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (editing) return;
          setCollapsed((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (editing) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((prev) => !prev);
          }
        }}
        className="flex items-center justify-between w-full text-left cursor-pointer select-none focus:outline-none"
        aria-expanded={bodyExpanded}
        aria-disabled={editing}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-heading font-semibold text-poke-text-secondary">
            {t('shared.game', { n: game.game_number })}
          </span>
          {winnerName && (
            <span className="text-xs text-poke-text-muted">
              {t('gameCard.winnerLabel')} <span className="text-poke-green font-medium">{winnerName}</span>
            </span>
          )}
          <Badge variant="gray" size="sm">
            {game.source === 'ps_replay'
              ? t('gameCard.sourceReplay')
              : game.source === 'manual'
                ? t('gameCard.sourceManual')
                : enumLabel(tEnum, 'gameSource', game.source)}
          </Badge>
          {showManuallyEditedBadge && (
            <Badge variant="yellow" size="sm">{t('gameCard.manuallyEdited')}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2" data-export-hide>
          {game.replay_url && (
            <a
              href={game.replay_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-poke-blue hover:underline font-heading"
              onClick={(e) => e.stopPropagation()}
            >
              {t('gameCard.viewReplay')}
            </a>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleEditClick();
              }}
              className="text-xs text-poke-blue hover:underline font-heading"
            >
              {t('gameCard.edit')}
            </button>
          )}
          <motion.span
            animate={{ rotate: bodyExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className={`text-sm ${editing ? 'text-poke-text-muted/40' : 'text-poke-text-muted'}`}
          >
            ▾
          </motion.span>
        </div>
      </div>

      {/* Body — collapsible */}
      <AnimatePresence initial={false}>
        {bodyExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            {editing ? (
              <GameDetailEditForm
                gameId={game.id}
                source={game.source}
                currentWinnerId={game.winner_id}
                player1={{ id: player1Id, name: player1Name }}
                player2={{ id: player2Id, name: player2Name }}
                battleStats={stats}
                onCancel={handleCancelEdit}
                onSaved={handleSaved}
              />
            ) : (
              <div className="mt-3">
                {hasStats ? (
                  <div className="flex gap-4">
                    <PlayerTeamColumn
                      playerName={player1Name}
                      stats={p1Stats}
                      isWinner={game.winner_id === player1Id}
                    />
                    <div className="w-px bg-poke-border self-stretch" />
                    <PlayerTeamColumn
                      playerName={player2Name}
                      stats={p2Stats}
                      isWinner={game.winner_id === player2Id}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-poke-text-muted">{t('gameCard.noStats')}</p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
