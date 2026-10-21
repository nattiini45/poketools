/* eslint-disable @next/next/no-img-element */
'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { renderNodeAsPng, type ExportResult } from '@/lib/utils/export-node';
import PokemonSprite from '@/components/shared/PokemonSprite';
import type { BattleStat } from '@/types/game';
import { useT } from '@/i18n/client';
import { discoverMessages } from '@/i18n/messages/discover';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';
import { getFormatSummary } from '@/lib/pkmn/format-catalog';

interface MatchHighlightCardProps {
  player1Name: string;
  player2Name: string;
  player1Avatar?: string | null;
  player2Avatar?: string | null;
  winnerName: string | null;
  score: [number, number]; // [p1 wins, p2 wins]
  format: string;
  tournamentName?: string;
  p1Stats: BattleStat[];
  p2Stats: BattleStat[];
}

function getMvp(stats: BattleStat[]): BattleStat | null {
  const brought = stats.filter((s) => s.was_brought);
  if (brought.length === 0) return null;
  return brought.reduce((best, s) => (s.kos_dealt > best.kos_dealt ? s : best), brought[0]);
}

function PlayerColumn({
  name,
  avatar,
  isWinner,
  score,
  mvp,
}: {
  name: string;
  avatar?: string | null;
  isWinner: boolean;
  score: number;
  mvp: BattleStat | null;
}) {
  const t = useT(discoverMessages);
  return (
    <div className="flex-1 flex flex-col items-center text-center gap-3">
      {/* Avatar */}
      <div className={`
        w-16 h-16 rounded-full overflow-hidden
        border-2 ${isWinner ? 'border-yellow-400' : 'border-white/20'}
        bg-white/10 flex items-center justify-center
      `}>
        {avatar ? (
          <img src={avatar} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl font-bold text-white/50">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Name */}
      <div>
        <p className={`font-bold text-lg ${isWinner ? 'text-yellow-400' : 'text-white/80'}`}>
          {name}
        </p>
        {isWinner && (
          <p className="text-[10px] font-bold text-yellow-400/60 tracking-widest uppercase">
            {t('highlightCard.winner')}
          </p>
        )}
      </div>

      {/* Score */}
      <p className={`text-4xl font-black ${isWinner ? 'text-white' : 'text-white/50'}`}>
        {score}
      </p>

      {/* MVP */}
      {mvp && (
        <div className="flex flex-col items-center gap-1">
          <PokemonSprite name={mvp.pokemon_name} size={48} animated />
          <p className="text-[10px] text-white/40 font-medium">
            {t('highlightCard.kos', { count: mvp.kos_dealt })}
          </p>
        </div>
      )}
    </div>
  );
}

export default function MatchHighlightCard({
  player1Name,
  player2Name,
  player1Avatar,
  player2Avatar,
  winnerName,
  score,
  format,
  tournamentName,
  p1Stats,
  p2Stats,
}: MatchHighlightCardProps) {
  const t = useT(discoverMessages);
  const tEnum = useT(enumMessages);
  // A Showdown format id ('gen9ou') reads as its catalog name; a season format
  // type ('draft', 'singles') as its enum label; anything else as itself.
  const formatLabel = getFormatSummary(format)?.name ?? enumLabel(tEnum, 'formatType', format);
  const cardRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  const p1Mvp = getMvp(p1Stats);
  const p2Mvp = getMvp(p2Stats);

  // Auto-click the download link once rendered — works in Chrome.
  // Firefox ignores this (expired user activation), but the visible
  // link lets the user trigger it with a fresh click.
  useEffect(() => {
    if (result && linkRef.current) {
      linkRef.current.click();
    }
  }, [result]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.blobUrl);
    };
  }, [result]);

  const handleExport = useCallback(async () => {
    if (!cardRef.current) return;

    // Reset if already showing result
    if (result) {
      URL.revokeObjectURL(result.blobUrl);
      setResult(null);
      return;
    }

    setExporting(true);
    try {
      const exported = await renderNodeAsPng(
        cardRef.current,
        `match-${player1Name}-vs-${player2Name}.png`,
      );
      setResult(exported);
    } catch (err) {
      console.error('Failed to export highlight card:', err);
    } finally {
      setExporting(false);
    }
  }, [player1Name, player2Name, result]);

  return (
    <div className="flex flex-col gap-3">
      {/* The card (this element gets exported to PNG) */}
      <div
        ref={cardRef}
        className="
          relative w-full max-w-[600px] aspect-video
          rounded-xl overflow-hidden
          bg-gradient-to-br from-indigo-950 via-slate-900 to-gray-900
          p-6 flex flex-col
        "
        style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
      >
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-40 h-40 bg-art-card-blue/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute inset-0 shadow-[inset_0_0_60px_rgba(0,0,0,0.4)]" />

        {/* Tournament name */}
        {tournamentName && (
          <div className="relative text-center mb-1">
            <p className="text-[10px] font-bold text-white/30 tracking-[0.2em] uppercase">
              {tournamentName}
            </p>
          </div>
        )}

        {/* Format */}
        <div className="relative text-center mb-4">
          <span className="px-3 py-1 rounded-full bg-white/10 text-[10px] font-bold text-white/50 tracking-wider uppercase">
            {formatLabel}
          </span>
        </div>

        {/* VS Layout */}
        <div className="relative flex-1 flex items-center justify-center gap-6">
          <PlayerColumn
            name={player1Name}
            avatar={player1Avatar}
            isWinner={winnerName === player1Name}
            score={score[0]}
            mvp={p1Mvp}
          />

          {/* VS divider */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-px h-8 bg-white/10" />
            <span className="text-lg font-black text-white/20">VS</span>
            <div className="w-px h-8 bg-white/10" />
          </div>

          <PlayerColumn
            name={player2Name}
            avatar={player2Avatar}
            isWinner={winnerName === player2Name}
            score={score[1]}
            mvp={p2Mvp}
          />
        </div>

        {/* Branding */}
        <div className="relative text-center mt-3">
          <p className="text-[9px] text-white/15 font-bold tracking-[0.3em] uppercase">
            PokéTools
          </p>
        </div>
      </div>

      {/* Export button / Download link */}
      {result ? (
        <span className="self-start flex items-center gap-2">
          <a
            ref={linkRef}
            href={result.blobUrl}
            download={result.filename}
            className="px-4 py-2 rounded-lg bg-poke-green text-poke-on-green text-sm font-semibold hover:bg-poke-green/90 transition-all"
            onClick={() => {
              setTimeout(() => {
                URL.revokeObjectURL(result.blobUrl);
                setResult(null);
              }, 150);
            }}
          >
            {t('highlightCard.clickToSave')}
          </a>
          <button
            onClick={handleExport}
            className="text-xs text-white/40 hover:text-white/60"
            title={t('highlightCard.dismiss')}
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          onClick={handleExport}
          disabled={exporting}
          className="
            self-start px-4 py-2 rounded-lg
            bg-poke-blue text-poke-on-blue text-sm font-semibold
            hover:bg-poke-blue/90
            disabled:opacity-50 disabled:cursor-wait
            transition-all
          "
        >
          {exporting ? t('highlightCard.exporting') : t('highlightCard.download')}
        </button>
      )}
    </div>
  );
}
