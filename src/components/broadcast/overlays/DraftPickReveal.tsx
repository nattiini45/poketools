'use client';

import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayPokemonSprite from '../shared/OverlayPokemonSprite';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig } from '@/types/broadcast';
import { useT } from '@/i18n/client';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { useDraftOverlayBoard, type OverlayBoard, type OverlayLines, type OverlayPick } from './DraftViewer';

interface DraftPickRevealProps {
  config: OverlayConfig;
  draftPoolId: string;
  /** Line id → English stage names from the bound list (server-built). */
  lines?: OverlayLines;
  autoAdvance?: boolean;
}

const NO_LINES: OverlayLines = {};

export default function DraftPickReveal({
  config,
  draftPoolId,
  lines = NO_LINES,
  autoAdvance = true,
}: DraftPickRevealProps) {
  // autoAdvance=false freezes the overlay on its first pick: poll once (very slow cadence).
  const pollMs = autoAdvance ? config.poll : 24 * 60 * 60 * 1000;
  const { board } = useDraftOverlayBoard(draftPoolId, pollMs, lines);
  // The newest pick is the one on screen; a new key restarts the reveal animation.
  const newest = board && board.picks.length > 0 ? board.picks[board.picks.length - 1] : null;

  return <DraftPickRevealCard config={config} board={board} pick={newest} revealKey={newest?.key ?? ''} />;
}

interface DraftPickRevealCardProps {
  config: OverlayConfig;
  board: OverlayBoard | null;
  pick: OverlayPick | null;
  /** Changes with every new pick (restarts the reveal animation). */
  revealKey: string;
}

/** The rendered reveal (exported for tests: it renders without fetching). */
export function DraftPickRevealCard({ config, board, pick, revealKey }: DraftPickRevealCardProps) {
  const tg = useT(glossaryMessages);
  const ts = useT(draftScreenMessages);
  const tShared = useT(draftSharedMessages);
  const tLegacy = useT(draftLegacyBoardMessages);
  const tb = useT(broadcastOverlaysMessages);

  if (!pick) {
    // Before the first pick: paused, else who is on the clock, else the idle line.
    const onClock = board && !board.complete && !board.paused ? board.onClock : null;
    return (
      <div className="w-full h-full flex items-center justify-center">
        {board?.paused ? (
          <div className="uppercase text-xl font-bold" style={{ color: 'var(--broadcast-text-muted)' }}>
            {tg('draft.paused')}
          </div>
        ) : onClock ? (
          <div className="text-xl" style={{ color: 'var(--broadcast-text-muted)' }}>
            {tg('draft.playerOnClock', { name: onClock.name ?? tb('common.unknownPlayer') })}
          </div>
        ) : (
          <div className="text-xl" style={{ color: 'var(--broadcast-text-muted)' }}>
            {ts('overlay.waitingForPick')}
          </div>
        )}
      </div>
    );
  }

  // Tier color (legacy tier drafts); EPB lines use the default tier colour.
  const tierColor =
    pick.tier === 'S' ? 'var(--tier-s)'
      : pick.tier === 'A' ? 'var(--tier-a)'
        : pick.tier === 'B' ? 'var(--tier-b)'
          : 'var(--tier-c)';

  const detail: string[] = [];
  if (pick.tier) detail.push(tLegacy('tierList.tier', { tier: pick.tier }));
  if (pick.price != null) detail.push(tShared('points', { n: pick.price }));

  return (
    <div className="relative w-full h-full flex items-center justify-center" key={revealKey}>
      <div className="flex flex-col items-center gap-6">
        {/* Silhouette → reveal */}
        <AnimatedReveal animation="silhouetteFill" delay={500}>
          <div className="rounded-full p-4" style={{ boxShadow: `0 0 60px ${tierColor}` }}>
            <OverlayPokemonSprite pokemon={pick.sprite} size={160} glowColor={tierColor} />
          </div>
        </AnimatedReveal>

        {/* Name + tier slam */}
        <AnimatedReveal animation="shakeSlam" delay={1500}>
          <div className="text-center">
            <div className="text-4xl font-black" style={{ color: 'var(--broadcast-text)' }}>
              {pick.label}
            </div>
            {detail.length > 0 && (
              <div className="text-xl font-bold mt-1" style={{ color: tierColor }}>
                {detail.join(' · ')}
              </div>
            )}
          </div>
        </AnimatedReveal>

        {/* Player attribution */}
        <AnimatedReveal animation="fadeIn" delay={2200}>
          <div className="text-center" style={{ color: 'var(--broadcast-text-muted)' }}>
            <div className="text-lg font-semibold">{pick.playerName ?? tb('common.unknownPlayer')}</div>
            <div className="text-sm">{ts('clock.roundPick', { round: pick.round, pick: pick.pickNumber })}</div>
          </div>
        </AnimatedReveal>
      </div>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}
