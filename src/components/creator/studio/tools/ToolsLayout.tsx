'use client';

import { useEffect, useState, useRef } from 'react';
import { createCastChannel, type CastChannelMessage } from '@/lib/broadcast/channel';
import FacingPanel from './FacingPanel';
import ToolsTabs from './ToolsTabs';
import type { PokemonSet } from '@/types/team';
import { useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';

interface ToolsLayoutProps {
  sessionId: string;
  realtimeKey: string;
  generation: number;
}

/**
 * ToolsLayout — second-screen tools view.
 * Connects to the main Cast Studio tab via BroadcastChannel.
 * Shows facing Pokémon + speed/damage/field calculators.
 */
export default function ToolsLayout({ sessionId, realtimeKey, generation }: ToolsLayoutProps) {
  const t = useT(creatorStudioMessages);
  const [pokemon1, setPokemon1] = useState<PokemonSet | null>(null);
  const [pokemon2, setPokemon2] = useState<PokemonSet | null>(null);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<ReturnType<typeof createCastChannel> | null>(null);

  useEffect(() => {
    const ch = createCastChannel(sessionId, {
      realtimeKey,
      onStatusChange: (status) => {
        if (status === 'connected') setConnected(true);
      },
    });
    channelRef.current = ch;

    ch.onMessage((msg: CastChannelMessage) => {
      switch (msg.type) {
        case 'facing':
          setPokemon1(msg.pokemon1);
          setPokemon2(msg.pokemon2);
          setConnected(true);
          break;
        case 'team_update':
          // Could update local team state if needed
          setConnected(true);
          break;
      }
    });

    // Request sync from main tab
    ch.send({ type: 'request_sync' });

    return () => ch.close();
  }, [sessionId, realtimeKey]);

  return (
    <div className="space-y-6">
      {/* Connection status */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
        <span className="text-xs text-poke-text-secondary">
          {connected ? t('tools.connected') : t('tools.waiting')}
        </span>
      </div>

      {/* Facing Pokémon display */}
      <FacingPanel pokemon1={pokemon1} pokemon2={pokemon2} />

      {/* Calculator tabs */}
      <ToolsTabs pokemon1={pokemon1} pokemon2={pokemon2} generation={generation} />
    </div>
  );
}
