'use client';

import { useEffect } from 'react';
import type React from 'react';
import type { EditorState, EditorAction, DraftEditorContext } from '../editor/state';
import type { DraftPool } from '@/types/draft';
import type { DraftPoolEntry } from '@/types/draft-pool';

// The signed-in player's id, fetched once per session
let cachedPlayerId: string | null | undefined;

async function getOwnPlayerId(signal: AbortSignal): Promise<string | null> {
  if (cachedPlayerId !== undefined) return cachedPlayerId;
  try {
    const res = await fetch('/api/players/me', { signal });
    const json = await res.json();
    const id: string | null = json.success ? (json.data?.id ?? null) : null;
    cachedPlayerId = id;
    return id;
  } catch {
    return null; // aborted/transient — don't cache
  }
}

/**
 * Fetches draft pool state for the current season and loads it into EditorContext.
 * Only runs when isDraftLeague && seasonId are set.
 *
 * Fetches:
 *   1. GET /api/drafts?season_id=X  → pool metadata (id, budget, pool_mode)
 *   2. GET /api/draft-pool-entries?season_id=X + /api/drafts/[id]/state + /api/players/me
 *      → entry list, rosters/taken, and our own player id (to attribute the roster)
 */
export function useDraftContext(
  state: EditorState,
  dispatch: React.Dispatch<EditorAction>,
): void {

  useEffect(() => {
    if (!state.isDraftLeague || !state.seasonId) return;

    const controller = new AbortController();

    async function load() {
      const seasonId = state.seasonId!;

      // 1. Fetch pool metadata
      const poolRes = await fetch(
        `/api/drafts?season_id=${encodeURIComponent(seasonId)}`,
        { signal: controller.signal },
      );
      const poolJson = await poolRes.json();
      if (!poolJson.success || !poolJson.data) return;
      const pool = poolJson.data as DraftPool;

      // 2. Fetch pool entries, draft state, and own player id in parallel
      const [entriesRes, stateRes, playerId] = await Promise.all([
        fetch(
          `/api/draft-pool-entries?season_id=${encodeURIComponent(seasonId)}`,
          { signal: controller.signal },
        ),
        fetch(`/api/drafts/${pool.id}/state`, { signal: controller.signal }),
        getOwnPlayerId(controller.signal),
      ]);

      const [entriesJson, draftStateJson] = await Promise.all([
        entriesRes.json(),
        stateRes.json(),
      ]);

      if (!entriesJson.success) return;

      const entries: DraftPoolEntry[] = entriesJson.data;
      const draftState = draftStateJson.success ? draftStateJson.data : null;

      // Our drafted Pokémon (drives "your pick" marking in the SpeciesPicker)
      const roster: string[] =
        playerId && draftState?.rosters ? (draftState.rosters[playerId] ?? []) : [];

      const spent = (() => {
        if (!draftState || !pool.point_budget) return null;
        // Compute from the team in the editor: sum point_cost of each species
        const teamSpecies = state.team
          .filter((s): s is NonNullable<typeof s> => s !== null && !!s.species)
          .map((s) => s.species);
        return teamSpecies.reduce((acc, species) => {
          const entry = entries.find((e) => e.pokemon_name === species);
          return acc + (entry?.point_cost ?? pool.default_point_cost ?? 0);
        }, 0);
      })();

      const ctx: DraftEditorContext = {
        poolId: pool.id,
        budget: pool.point_budget ?? null,
        defaultPointCost: pool.default_point_cost ?? null,
        spent,
        roster,
        entries,
        takenPokemon: draftState?.taken_pokemon ?? [],
      };

      dispatch({ type: 'SET_DRAFT_CONTEXT', draft: ctx });
    }

    load().catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isDraftLeague, state.seasonId]);

  // Recompute spent whenever team changes while in draft mode
  useEffect(() => {
    if (!state.draft || !state.draft.budget) return;
    const entries = state.draft.entries;
    const pool = state.draft;
    const teamSpecies = state.team
      .filter((s): s is NonNullable<typeof s> => s !== null && !!s.species)
      .map((s) => s.species);
    const spent = teamSpecies.reduce((acc, species) => {
      const entry = entries.find((e) => e.pokemon_name === species);
      return acc + (entry?.point_cost ?? pool.defaultPointCost ?? 0);
    }, 0);
    if (spent !== pool.spent) {
      dispatch({
        type: 'SET_DRAFT_CONTEXT',
        draft: { ...pool, spent },
      });
    }
  }, [state.team, state.draft, dispatch]);
}
