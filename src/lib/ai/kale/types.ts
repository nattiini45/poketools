import type { RoundRecapMatchData } from '@/types/tournament-report';

// ─── Prompt Task ────────────────────────────────────────────────────

export type PipelineMode = 'decomposed' | 'single';

export interface PromptTask {
  /** Unique task ID within this pipeline run, e.g. 'match_one_liner_0', 'headline' */
  id: string;
  /** Execution stage — tasks in the same stage run in parallel */
  stage: number;
  systemPrompt: string;
  userPrompt: string;
  /** Expected max tokens for this task (decomposed tasks use fewer) */
  maxTokens: number;
}

export interface TaskResult {
  id: string;
  text: string;
  promptTokens: number;
  completionTokens: number;
}

// ─── Validation ─────────────────────────────────────────────────────

export interface ValidationError {
  type: 'wrong_player' | 'wrong_pokemon' | 'wrong_score' | 'wrong_number' | 'structural';
  detail: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ─── Report Registry ────────────────────────────────────────────────

export interface ReportParams {
  tournamentId: string;
  roundId: string;
  playerId?: string;
  seasonId?: string;
}

export interface ReportDefinition<TFactPack, TContent> {
  type: string;
  buildFactPack: (params: ReportParams) => Promise<TFactPack>;
  getPromptTasks: (factPack: TFactPack, mode: PipelineMode) => PromptTask[];
  validate: (outputs: Map<string, string>, factPack: TFactPack) => ValidationResult;
  assemble: (outputs: Map<string, string>, factPack: TFactPack) => TContent;
}

// ─── Match Facts (Recap) ────────────────────────────────────────────

export interface PokemonPerformance {
  pokemonName: string;
  totalKos: number;
  wasKoed: boolean;
  wasLead: boolean;
  isMvp: boolean;
  movesUsed: string[];
}

export interface MatchFact {
  matchId: string;
  player1Name: string;
  player2Name: string;
  winnerName: string;
  loserName: string;
  winnerScore: number;
  loserScore: number;
  /** Server-computed human-readable margin description, e.g. "the closest possible margin (1-0)" */
  marginDescription: string;
  /** Formatted score string, e.g. "2-0" */
  scoreString: string;
  player1TotalKos: number;
  player2TotalKos: number;
  gamesPlayed: number;
  mvpPokemon: string;
  mvpPlayerName: string;
  mvpKos: number;
  winnerTeam: PokemonPerformance[];
  loserTeam: PokemonPerformance[];
  /** Server-generated factual one-liner, e.g. "Ash defeated Misty 2-0, with Pikachu earning MVP honors (3 KOs)" */
  preWrittenOneLiner: string;
  /** Key performance bullet points, e.g. ["Pikachu scored 3 KOs for Ash", "Starmie was KO'd in both games"] */
  keyPerformances: string[];
}

// ─── Standing Facts ─────────────────────────────────────────────────

export interface StandingFact {
  rank: number;
  playerName: string;
  playerId: string;
  gymType: string | null;
  points: number;
  /** Formatted record, e.g. "3W-1L" */
  recordString: string;
  /** Formatted KD, e.g. "+5" or "-2" */
  kdString: string;
  /** Rank change description, e.g. "up 2 from #4" or "unchanged at #2" or "new entry" */
  rankChange: string;
  wins: number;
  losses: number;
  draws: number;
  killDifferential: number;
}

// ─── Recap Fact Pack ────────────────────────────────────────────────

export interface RecapFactPack {
  // Context
  leagueName: string | null;
  tournamentName: string;
  roundName: string;
  roundNumber: number;
  format: string;
  gen: number;
  bestOf: number;
  scoring: string;
  gymTypes: Record<string, string | null>;

  // Match facts
  matches: MatchFact[];

  // Standings
  currentStandings: StandingFact[];
  previousStandings: StandingFact[] | null;
  standingsChanges: string[];

  // Meta
  pokemonUsage: { pokemonName: string; timesBrought: number; totalKos: number }[];
  bestPerformer: { playerName: string; reason: string } | null;
  unusualPick: { pokemonName: string; playerName: string; reason: string } | null;

  // Allowlists for validation
  validPlayerNames: string[];
  validPokemonNames: string[];

  // Server-computed UI data (passed through to output)
  matchData: RoundRecapMatchData[];
  pokemonTypes: Record<string, string[]>;
}

// ─── Forecast Fact Pack ─────────────────────────────────────────────

export interface MatchupFact {
  player1Name: string;
  player2Name: string;
  player1Rank: number | null;
  player2Rank: number | null;
  headToHead: string;
  player1Team: string[];
  player2Team: string[];
  player1Record: string;
  player2Record: string;
}

export interface ForecastFactPack {
  // Context
  leagueName: string | null;
  tournamentName: string;
  roundName: string;
  roundNumber: number;
  format: string;
  gen: number;
  bestOf: number;
  scoring: string;
  gymTypes: Record<string, string | null>;

  // Matchups
  matchups: MatchupFact[];

  // Current standings
  currentStandings: StandingFact[];

  // Allowlists
  validPlayerNames: string[];
  validPokemonNames: string[];
}

// ─── Pipeline Output ────────────────────────────────────────────────

export interface PipelineResult {
  /** Total tokens across all LLM calls */
  promptTokens: number;
  completionTokens: number;
  /** Total generation time in ms */
  generationTimeMs: number;
  /** Validation errors encountered (empty if clean) */
  validationErrors: ValidationError[];
  /** Number of retries that occurred */
  retryCount: number;
}

export interface RecapPipelineResult extends PipelineResult {
  content: import('@/types/tournament-report').RoundRecapContent;
}

export interface ForecastPipelineResult extends PipelineResult {
  content: import('@/types/tournament-report').RoundForecastContent;
}
