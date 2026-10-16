import type { PokemonSet } from '@/types/team';
import type { TrackerDispatchAction } from '@/lib/broadcast/tracker-reducer';
import type { CastSessionRealtimeAction } from '@/types/cast-session';
import { getSupabaseRealtimeClient } from '@/lib/supabase/realtime-client';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─── Channel message types ─────────────────────────────────────────

export type CastChannelMessage =
  | { type: 'facing'; player1Slot: number | null; player2Slot: number | null; pokemon1: PokemonSet | null; pokemon2: PokemonSet | null }
  | { type: 'team_update'; player: 1 | 2; team: PokemonSet[] }
  | { type: 'set_update'; player: 1 | 2; slot: number; set: Partial<PokemonSet> }
  | { type: 'studio_action'; action: CastSessionRealtimeAction }
  | { type: 'tracker_action'; action: TrackerDispatchAction }
  | { type: 'tracker_sync'; matchId: string; gameNumber: number }
  | { type: 'request_sync' }
  | { type: 'timer_sync'; endTime: number | null; label: string }
  | { type: 'lower_third_update'; text: string; subtext: string; visible: boolean; preset: string | null };

export type CastChannelStatus = 'local-only' | 'connecting' | 'connected' | 'error' | 'closed';

interface CastChannelOptions {
  realtimeKey?: string | null;
  onStatusChange?: (status: CastChannelStatus) => void;
}

interface CastRealtimeEnvelope {
  senderId: string;
  sentAt: number;
  message: CastChannelMessage;
}

function createSenderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCastChannelMessage(value: unknown): value is CastChannelMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  return [
    'facing',
    'team_update',
    'set_update',
    'studio_action',
    'tracker_action',
    'tracker_sync',
    'request_sync',
    'timer_sync',
    'lower_third_update',
  ].includes(value.type);
}

function parseEnvelope(payload: unknown): CastRealtimeEnvelope | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.senderId !== 'string') return null;
  if (typeof payload.sentAt !== 'number') return null;
  if (!isCastChannelMessage(payload.message)) return null;
  return payload as unknown as CastRealtimeEnvelope;
}

function createLocalChannel(channelName: string) {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(channelName);
}

// ─── Channel wrapper ───────────────────────────────────────────────

export function createCastChannel(sessionId: string, options: CastChannelOptions = {}) {
  const channelName = `cast-studio-${sessionId}`;
  const senderId = createSenderId();
  const localChannel = createLocalChannel(channelName);
  const realtimeClient = options.realtimeKey ? getSupabaseRealtimeClient() : null;
  let realtimeChannel: RealtimeChannel | null = null;
  let messageHandler: ((msg: CastChannelMessage) => void) | null = null;

  if (realtimeClient && options.realtimeKey) {
    options.onStatusChange?.('connecting');
    realtimeChannel = realtimeClient.channel(`${channelName}-${options.realtimeKey}`, {
      config: { broadcast: { self: false } },
    });
    realtimeChannel
      .on('broadcast', { event: 'cast_sync' }, ({ payload }: { payload: unknown }) => {
        const envelope = parseEnvelope(payload);
        if (!envelope || envelope.senderId === senderId) return;
        messageHandler?.(envelope.message);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') options.onStatusChange?.('connected');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') options.onStatusChange?.('error');
        if (status === 'CLOSED') options.onStatusChange?.('closed');
      });
  } else {
    options.onStatusChange?.('local-only');
  }

  return {
    send(msg: CastChannelMessage) {
      localChannel?.postMessage(msg);
      if (!realtimeChannel) return;
      void realtimeChannel.send({
        type: 'broadcast',
        event: 'cast_sync',
        payload: {
          senderId,
          sentAt: Date.now(),
          message: msg,
        },
      }).catch(() => {
        options.onStatusChange?.('error');
      });
    },

    onMessage(handler: (msg: CastChannelMessage) => void) {
      messageHandler = handler;
      if (!localChannel) return;
      localChannel.onmessage = (event: MessageEvent<CastChannelMessage>) => handler(event.data);
    },

    close() {
      localChannel?.close();
      if (realtimeChannel) {
        void realtimeClient?.removeChannel(realtimeChannel);
      }
      options.onStatusChange?.('closed');
    },
  };
}
