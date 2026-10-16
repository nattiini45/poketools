import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import StatRadar from '../StatRadar';
import MomentumTimeline from '../MomentumTimeline';
import GameRecapPanel from '../GameRecapPanel';
import TypeMatchupMatrix from '../TypeMatchupMatrix';
import TrackerControls from '../TrackerControls';
import TrackerScorebar from '../TrackerScorebar';
import { CasterDataProvider } from '../CasterDataContext';
import type { CasterData, CasterPlayerInfo, CasterPokemonInfo } from '@/types/caster';
import type { GameSummary } from '@/types/match';
import type { TrackerPlayerState, TrackerSlot, TrackerState } from '@/types/broadcast';

// ── Fixtures ─────────────────────────────────────────────────────────

const STATS = { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 };

const tier = { raw: 100, withItem: 100, withAbility: 100, final: 100, modifiers: { item: null, ability: null, status: null, boosts: 0 } };

function makePokemon(species: string, types: string[]): CasterPokemonInfo {
  return {
    species,
    types,
    baseStats: STATS,
    ability: 'Blaze',
    item: 'Leftovers',
    moves: ['Flamethrower'],
    spriteUrl: '',
    itemSpriteUrl: null,
    usagePct: null,
    leadPct: null,
    bringPct: null,
    koDealt: 0,
    koReceived: 0,
    speedTiers: { min: tier, neutral: tier, max: tier, scarf: tier },
  };
}

function makePlayer(id: string, name: string, pokemon: CasterPokemonInfo[]): CasterPlayerInfo {
  return {
    id,
    name,
    avatarUrl: null,
    rating: null,
    rd: null,
    record: { wins: 0, losses: 0, draws: 0 },
    signaturePokemon: null,
    streak: { type: null, count: 0 },
    team: [],
    pokemon,
    archetype: null,
    nextMatch: null,
  };
}

const casterData: CasterData = {
  matchId: 'm1',
  tournamentId: 't1',
  seasonId: 's1',
  roundName: 'Week 1',
  bestOf: 3,
  format: 'gen9ou',
  generation: 9,
  player1: makePlayer('p1', 'Alice', [makePokemon('Charizard', ['Fire', 'Flying'])]),
  player2: makePlayer('p2', 'Bob', [makePokemon('Blastoise', ['Water'])]),
  h2h: { player1Wins: 0, player2Wins: 0, draws: 0, pastMatches: [] },
  standings: null,
};

function slot(pokemon: string | null, kos = 0): TrackerSlot {
  return {
    pokemon_name: pokemon,
    was_brought: pokemon !== null,
    was_lead: false,
    was_koed: false,
    kos_dealt: kos,
    moves_used: [],
    turns_active: 0,
  };
}

function playerState(id: string, name: string, slots: TrackerSlot[]): TrackerPlayerState {
  return { player_id: id, player_name: name, avatar_url: null, slots };
}

const game: GameSummary = {
  id: 'g1',
  game_number: 1,
  winner_id: 'p1',
  replay_url: '',
  source: 'manual',
  stats_locked: false,
};

const trackerState: TrackerState = {
  match_id: 'm1',
  games_submitted: [game],
  current_game: {
    game_number: 2,
    turn: 0,
    player1: playerState('p1', 'Alice', [slot('Charizard', 2)]),
    player2: playerState('p2', 'Bob', [slot('Blastoise')]),
    moments: [],
  },
  history: [],
};

// ── Tests ────────────────────────────────────────────────────────────

describe('broadcast tracker i18n (T15)', () => {
  it('StatRadar SVG labels use the Pokémon data locale', () => {
    const en = renderToStaticMarkup(<StatRadar stats={STATS} />);
    expect(en).toContain('>HP</text>');
    expect(en).toContain('>SpA</text>');

    const de = renderWithI18n(<StatRadar stats={STATS} />, { locale: 'de' });
    expect(de).toContain('>KP</text>');
    expect(de).toContain('>Sp.-Angr.</text>');
    expect(de).toContain('>Init.</text>');

    // "Keep Pokémon terms in English" keeps the English stat labels
    const mixed = renderWithI18n(<StatRadar stats={STATS} />, { locale: 'de', dataLocale: 'en' });
    expect(mixed).toContain('>Atk</text>');
  });

  it('MomentumTimeline SVG game labels are localized', () => {
    const ui = (
      <CasterDataProvider data={casterData}>
        <MomentumTimeline gamesSubmitted={[game]} />
      </CasterDataProvider>
    );
    expect(renderWithI18n(ui)).toContain('>G1</text>');
    expect(renderWithI18n(ui, { locale: 'de' })).toContain('>P1</text>');
  });

  it('GameRecapPanel builds one localized sentence with German Pokémon names', () => {
    const ui = (
      <CasterDataProvider data={casterData}>
        <GameRecapPanel gameNumber={1} winnerId="p1" state={trackerState} seriesScore={[1, 0]} />
      </CasterDataProvider>
    );
    const en = renderWithI18n(ui);
    expect(en).toContain('Game 1 Recap');
    expect(en).toContain('<span class="font-bold">Alice</span> wins Game 1. Charizard led with 2 KOs.');
    expect(en).toContain('Series is now <span class="font-mono font-bold">1-0</span>.');

    const de = renderWithI18n(ui, { locale: 'de' });
    expect(de).toContain('Rückblick Partie 1');
    expect(de).toContain('<span class="font-bold">Alice</span> gewinnt Partie 1. Glurak war mit 2 KOs am stärksten.');
    expect(de).toContain('Die Serie steht jetzt <span class="font-mono font-bold">1–0</span>.');
  });

  it('TypeMatchupMatrix localizes species and legend', () => {
    const ui = (
      <CasterDataProvider data={casterData}>
        <TypeMatchupMatrix />
      </CasterDataProvider>
    );
    const en = renderWithI18n(ui);
    expect(en).toContain('Immune');
    expect(en).toContain('title="Charizard"');

    const de = renderWithI18n(ui, { locale: 'de' });
    expect(de).toContain('Immun');
    expect(de).toContain('title="Glurak"');
    expect(de).toContain('title="Turtok"');
  });

  it('TrackerControls renders German chrome and moment labels', () => {
    const noop = () => {};
    const submit = async () => {};
    const ui = <TrackerControls state={trackerState} dispatch={noop} onSubmitGame={submit} producerMode />;
    const en = renderWithI18n(ui);
    expect(en).toContain('Submit Game 2');
    expect(en).toContain('Turning Point');

    const de = renderWithI18n(ui, { locale: 'de' });
    expect(de).toContain('Partie 2 eintragen');
    expect(de).toContain('Wendepunkt');
    expect(de).toContain('Moment markieren');
  });

  it('translates the stored solo placeholder names on display, not real names', () => {
    const noop = () => {};
    const submit = async () => {};
    const soloState: TrackerState = {
      ...trackerState,
      current_game: {
        ...trackerState.current_game,
        player1: playerState('p1', 'Me', [slot('Charizard')]),
        player2: playerState('solo-opponent', 'Opponent', [slot('Blastoise')]),
      },
    };
    const solo = <TrackerControls state={soloState} dispatch={noop} onSubmitGame={submit} />;
    const en = renderWithI18n(solo);
    expect(en).toContain('>Me</button>');
    expect(en).toContain('>Opponent</button>');

    const de = renderWithI18n(solo, { locale: 'de' });
    expect(de).toContain('>Ich</button>');
    expect(de).toContain('>Gegner</button>');

    const real = renderWithI18n(
      <TrackerControls state={trackerState} dispatch={noop} onSubmitGame={submit} />,
      { locale: 'de' },
    );
    expect(real).toContain('>Alice</button>');
    expect(real).toContain('>Bob</button>');
  });

  it('TrackerScorebar uses "Zug" for the battle turn in German', () => {
    const noop = () => {};
    const de = renderWithI18n(
      <TrackerScorebar state={trackerState} dispatch={noop} showTurnCounter />,
      { locale: 'de' },
    );
    expect(de).toContain('Zug 0');
    expect(de).toContain('aria-label="Nächster Zug"');
    expect(de).not.toContain('Runde');
  });
});
