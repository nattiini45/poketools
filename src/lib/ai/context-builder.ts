import { getMatchById } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getGamesByMatch, getBattleStatsByMatch, getOpponentBattleStatsInTournament } from '@/lib/supabase/queries/games';
import { getAggregates, getTotalGamesInScope } from '@/lib/supabase/queries/aggregates';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { decideMatchRosterVisibility, type TeamViewer } from '@/lib/team/visibility';
import { getMatchPrepTeam } from '@/lib/supabase/queries/match-prep-teams';
import { getTeamTypeAnalysis, type TeamTypeAnalysis } from '@/lib/pkmn/dex';
import { fetchReplay } from '@/lib/pkmn/replay';
import { extractBattleFrames } from '@/lib/pkmn/replay-frames';
import type { BattleStat, Aggregate } from '@/types/game';
import type { Ruleset } from '@/types/ruleset';
import type { PokemonSet } from '@/types/team';
import type { BattleFrame } from '@/types/replay-viewer';
import { renderTeamConstraints, renderCoreAssignments } from './league-context';

// ─── System Prompt ──────────────────────────────────────────────────

function buildSystemPrompt(gen: number): string {
return `You are Professor Linden, a competitive Pokémon analyst. You break down matches the way a knowledgeable friend would recap a game they just watched — casual, confident, and analytical without being stiff or academic. No scholarly metaphors, no "my research notes", no professor-speak.

VOICE AND STRUCTURE:
- Narrate chronologically: early game, midgame, key moment, cleanup/endgame. Walk through what happened and why it mattered.
- Credit players for their decisions, not luck: "Player doesn't panic", "Player's patience paid off", "Player is clearly playing around X".
- Use compact move chains — comma-separated actions without a full sentence for each: "first takes big chunks with Draco Meteor, then resets Aurora Veil, lands more Freeze-Dry chip".
- Frame key moments with evaluative language: "the scariest moment is when", "the key turning points were", "from there it's cleanup".
- When a surprise set or tech move is revealed, build it up: "reveals the tech — Upper Hand. Priority Fighting, catches the expected Sucker Punch and deletes a fully boosted Kingambit on the spot."
- Use natural conversational connectors: "From there", "Once X finally hit the field", "In the end", "Midgame is all about".
- Keep a measured tone. No emojis. No exclamation marks. Enthusiasm comes through word choice, not punctuation.
- Always use species names, never nicknames.

STYLE REFERENCE — match the tone and sentence structure of these excerpts:
"""
Game plan-wise, Player is clearly playing around Alolan Ninetales. Turn 1 Encore forces Iron Treads to keep clicking Ice Spinner into a resist, which lets Ninetales safely set Aurora Veil and even chunk Dragapult with Freeze-Dry on the switch. From there the defensive core comes in: Alomomola soaks Bronzong, pivots with Flip Turn and brings Raging Bolt in on Milotic as the Flame Orb activates.
"""
"""
The key turning points were hazard control and targeted trades. Corviknight repeatedly removed the Toxic Spikes with Defog, which meant the opponent never got the poison chip they really wanted. Rotom's Pain Split kept it usable, and burning Primarina made it much less scary over time. Once Mismagius finally hit the field, Terastallized into Electric, and set up a Nasty Plot, the entire game shifted. At plus two with Life Orb, Shadow Ball just tore through the rest of the team.
"""
"""
The scariest moment is when Kingambit comes in on a burned, chipped Alomomola. Swords Dances start stacking, Supreme Overlord is active, and this could easily snowball the whole game. But the set is built for this: Rocky Helmet punishes every contact, repeated Scalds whittle Gambit down, and after Alomomola finally drops, Sneasler jumps in and reveals the tech — Upper Hand. Priority Fighting, catches the expected Sucker Punch and deletes a fully boosted Kingambit on the spot.
"""
"""
In the end, hazard management and patience paid off — a really clean demonstration of how Encore support, Aurora Veil and smart pivoting can completely dismantle a bulky, setup-heavy team.
"""

RULES:
- This match uses Generation ${gen} rules. ONLY reference Pokémon, moves, abilities, and items that exist in Generation ${gen}. Do not suggest or mention anything introduced in a later generation.
- Only reference Pokémon, moves, abilities, and items that appear in the provided data.
- Do not hallucinate or invent information not in the context.
- Write for an audience that understands competitive Pokémon (EVs, natures, meta-game, etc.).
- Be specific: reference actual turns, HP thresholds, and KO attributions when available.
- When describing KOs, ONLY attribute them to the move or source that reduced HP to 0%. The turn-by-turn summary shows exact HP% after every hit — use these numbers. Do not fabricate damage amounts or claim a move KO'd a Pokémon if the data shows otherwise.
- The Battle Stats section shows authoritative KO counts per Pokémon. If the turn-by-turn data seems ambiguous, defer to Battle Stats.
- Do NOT reason about type effectiveness from memory. You may note what types were used, but do not claim specific resistances, weaknesses, or immunities unless the damage data clearly supports it (e.g., a move doing very little damage suggests resistance). The what_if analysis should focus on tactical choices (switching, move selection, timing) grounded in the actual battle data, not hypothetical type matchup calculations.
- Field-condition consistency in what_if: the turn-by-turn summary notes who set each weather and terrain (e.g. "Weather: SunnyDay (set by Vulpix's Drought)"). When your counterfactual removes, swaps, or benches a Pokémon, do not assume any field condition it created — weather (sun/rain/sand/snow), terrain, screens, or hazards — would still be present. If the alternate line depends on a condition, verify its setter is still on the field in that line; otherwise the condition is gone and any move relying on it (a one-turn Solar Beam under sun, a weather-boosted attack, a terrain-boosted move) would not work as described.
- Stay in character as Professor Linden throughout your analysis. Don't break character.
- Pay close attention to LEAGUE CONTEXT, TOURNAMENT CONTEXT, and FORMAT RULES — these describe special constraints (type-locking, type quotas, evolution restrictions) that are critical to your analysis.
- A league may constrain teams in ONE of several ways. Read LEAGUE CONTEXT carefully and use whichever applies:
  - "Gym Leader Typings": each player is locked to a single type. Analyze how each leaned into or diversified around their type and how the type matchup shaped the match.
  - "Assigned Core Types": this league assigns each player a fixed set of types they must build around (see the Type Quota in FORMAT RULES). Analyze how each player satisfied and leveraged their assigned types, and how the two players' assignments matched up. Do NOT call these "gym" types — they are assigned cores.
  - Neither present: the league has no per-player type constraint; do not invent one.
- When a per-player type constraint IS present (gym typings OR assigned cores), you MUST analyze its impact in the league_constraint_analysis field. When NONE is present, omit that field entirely.

OUTPUT FORMAT:
You MUST respond with a valid JSON object matching this exact schema (no markdown fences, no extra text):
{
  "summary": "2-3 sentence match overview — set the scene, name both players' team styles, and state the result",
  "turning_point": "The key moment that decided the overall match outcome",
  "mvp": {
    "pokemon": "Species name",
    "player": "Player name",
    "reasoning": "1-2 sentences explaining why — what it did and why it mattered"
  },
  "game_breakdowns": [
    {
      "game_number": 1,
      "winner": "Player name",
      "narrative": "3-5 sentence chronological recap of this game — early game, midgame, key moment, cleanup",
      "key_plays": ["Bullet point 1", "Bullet point 2"]
    }
  ],
  "meta_observations": "How the players' picks compared to the tournament meta and format constraints, referencing league rules if applicable",
  "what_if": "A specific counterfactual: if one player had made a different decision at a specific moment, how could it have changed the outcome? Be concrete — name the turn, the move, and the alternative.",
  "league_constraint_analysis": "(ONLY include when LEAGUE CONTEXT contains a per-player type constraint — Gym Leader Typings OR Assigned Core Types) How each player's type constraint shaped their team composition and in-game decisions — did they lean into their identity or stretch it? How did the two players' constraints match up and influence the flow? Use the correct framing (gym typing vs assigned core triple) for whichever the league uses."
}

CONDITIONAL FIELDS:
- league_constraint_analysis: Include ONLY when LEAGUE CONTEXT contains "Gym Leader Typings" or "Assigned Core Types". Omit entirely otherwise — never invent a constraint that is not in the context.`;
}

// ─── Public Entry Point ─────────────────────────────────────────────

export interface MatchAnalysisPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface MatchContext {
  /** Fully-rendered match context: league rules, format, meta, per-game battle
   *  stats + attributed turn-by-turn summary. Single source of truth for
   *  "everything known about a match" — consumed by the legacy prompt builder
   *  and the `getMatchAnalysisContext` agent tool alike. */
  context: string;
  /** Generation parsed from the format, for gen-locking the analysis. */
  gen: number;
}

/**
 * Gathers all context for a match — DB + @pkmn — and renders it into a single
 * focused block (league rules, format, meta, per-game stats, attributed
 * turn-by-turn). Used by {@link buildMatchAnalysisPrompt} (legacy structured
 * route) and the agent `getMatchAnalysisContext` tool.
 *
 * Team sheets follow spec §7 for an anonymous viewer (the context reaches
 * whoever asks the agent): they are included once the match is completed or
 * the tournament is `always_public`, never before.
 */
export async function gatherMatchContext(
  matchId: string
): Promise<MatchContext> {
  // 1. Core match data
  const match = await getMatchById(matchId);
  if (!match) throw new Error(`Match ${matchId} not found`);

  const [tournament, round] = await Promise.all([
    getTournamentById(match.tournament_id),
    getRoundById(match.round_id),
  ]);
  if (!tournament) throw new Error(`Tournament ${match.tournament_id} not found`);

  // 2. Season (league) context
  const season = tournament.season_id
    ? await getSeasonById(tournament.season_id)
    : null;

  // 3. Ruleset
  const ruleset = tournament.ruleset_id
    ? await getRulesetById(tournament.ruleset_id)
    : null;

  // 3. Games + battle stats
  const [games, battleStatsByGame] = await Promise.all([
    getGamesByMatch(match.id),
    getBattleStatsByMatch(match.id),
  ]);

  // 4. Teams brought to this match, gated per match (spec §7)
  const [p1Row, p2Row] = await Promise.all([
    getPlayerTeamForMatch(match.player_1_id, match),
    getPlayerTeamForMatch(match.player_2_id, match),
  ]);
  const anonymous: TeamViewer = { viewerId: null, isAdmin: false };
  const p1Team = p1Row && decideMatchRosterVisibility(p1Row, anonymous, match, tournament.team_visibility)
    ? p1Row
    : null;
  const p2Team = p2Row && decideMatchRosterVisibility(p2Row, anonymous, match, tournament.team_visibility)
    ? p2Row
    : null;

  // 5. Tournament meta (top 10 Pokémon by usage)
  const aggregates = await getAggregates('tournament', match.tournament_id);
  const totalGames = await getTotalGamesInScope('tournament', match.tournament_id);

  // 6. Type analysis for both teams (from battle stats if no team sheet)
  const p1Species = extractSpeciesFromContext(
    battleStatsByGame,
    match.player_1_id,
    p1Team?.pokemon
  );
  const p2Species = extractSpeciesFromContext(
    battleStatsByGame,
    match.player_2_id,
    p2Team?.pokemon
  );

  const gen = parseGenFromFormat(ruleset?.base_format);
  const p1TypeAnalysis: TeamTypeAnalysis | null = p1Species.length > 0 ? getTeamTypeAnalysis(p1Species, gen) : null;
  const p2TypeAnalysis: TeamTypeAnalysis | null = p2Species.length > 0 ? getTeamTypeAnalysis(p2Species, gen) : null;

  // 7. Replay frames (only for games with replays, condensed)
  const framesByGame: Record<string, BattleFrame[]> = {};
  for (const game of games) {
    if (game.replay_url && game.source === 'ps_replay') {
      try {
        const replay = await fetchReplay(game.replay_url);
        framesByGame[game.id] = extractBattleFrames(replay.log);
      } catch {
        // Non-fatal — we still have battle stats
      }
    }
  }

  // ─── Assemble User Prompt ───────────────────────────────────────

  const sections: string[] = [];

  // League/Tournament context (descriptions with special rules)
  if (season) {
    const lines = [`## LEAGUE CONTEXT`, `League: ${season.name}`];
    if (season.description) lines.push(`League Rules & Description: ${season.description}`);
    // Per-player type constraints: gym leader typings (single type) and/or
    // assigned Core Liga triples. A league uses one model — emit whichever is set.
    const seasonParts = await getSeasonParticipants(season.id);
    const p1 = seasonParts.find((p) => p.id === match.player_1_id);
    const p2 = seasonParts.find((p) => p.id === match.player_2_id);
    if (p1?.gym_type || p2?.gym_type) {
      lines.push('');
      lines.push('Gym Leader Typings:');
      if (p1?.gym_type) lines.push(`- ${match.player_1_name}: ${p1.gym_type}-type Gym Leader`);
      if (p2?.gym_type) lines.push(`- ${match.player_2_name}: ${p2.gym_type}-type Gym Leader`);
    }
    const coreLines = renderCoreAssignments([
      { name: match.player_1_name, core: p1?.core_types },
      { name: match.player_2_name, core: p2?.core_types },
    ]);
    if (coreLines.length > 0) {
      lines.push('');
      lines.push(...coreLines);
    }
    sections.push(lines.join('\n') + '\n');
  }
  if (tournament.description) {
    sections.push(`## TOURNAMENT CONTEXT\nTournament: ${tournament.name}\n${tournament.description}\n`);
  }

  // Format/Ruleset context
  sections.push(buildRulesetSection(ruleset, tournament.is_doubles, gen));

  // Tournament meta
  sections.push(buildMetaSection(aggregates, totalGames));

  // Match header
  sections.push(
    `## MATCH: ${match.player_1_name} vs ${match.player_2_name}`,
    `Best of ${round?.best_of ?? tournament.best_of_default} | Round: ${round?.name ?? 'Unknown'} | Tournament: ${tournament.name}`,
    `Match winner: ${match.winner_name ?? 'TBD'}`,
    ''
  );

  // Type analysis
  if (p1TypeAnalysis) {
    sections.push(buildTypeAnalysisSection(match.player_1_name, p1TypeAnalysis));
  }
  if (p2TypeAnalysis) {
    sections.push(buildTypeAnalysisSection(match.player_2_name, p2TypeAnalysis));
  }

  // Per-game sections
  for (const game of games) {
    const gameStats = battleStatsByGame[game.id] ?? [];
    const frames = framesByGame[game.id];

    const winnerName =
      game.winner_id === match.player_1_id
        ? match.player_1_name
        : game.winner_id === match.player_2_id
          ? match.player_2_name
          : 'Unknown';

    sections.push(`## GAME ${game.game_number}`);
    sections.push(`Winner: ${winnerName}`);
    sections.push(`Source: ${game.source === 'ps_replay' ? 'Parsed replay' : 'Manual entry'}`);

    // Team sheets (if available)
    if (p1Team?.pokemon) {
      sections.push(buildTeamSection(match.player_1_name, p1Team.pokemon));
    }
    if (p2Team?.pokemon) {
      sections.push(buildTeamSection(match.player_2_name, p2Team.pokemon));
    }

    // Battle stats
    const p1Stats = gameStats.filter((s) => s.player_id === match.player_1_id);
    const p2Stats = gameStats.filter((s) => s.player_id === match.player_2_id);
    sections.push(buildBattleStatsSection(match.player_1_name, p1Stats));
    sections.push(buildBattleStatsSection(match.player_2_name, p2Stats));

    // Condensed turn summary (replay only)
    if (frames && frames.length > 0) {
      sections.push(buildCondensedFrameSection(frames));
    }

    sections.push('');
  }

  return {
    context: sections.join('\n'),
    gen,
  };
}

/**
 * Assembles the LLM prompts for the legacy structured match-analysis route.
 * Thin wrapper over {@link gatherMatchContext} + the Professor Linden system
 * prompt.
 */
export async function buildMatchAnalysisPrompt(
  matchId: string
): Promise<MatchAnalysisPrompt> {
  const { context, gen } = await gatherMatchContext(matchId);
  return {
    systemPrompt: buildSystemPrompt(gen),
    userPrompt: context,
  };
}

// ─── Pre-Match Scouting ─────────────────────────────────────────────

function buildScoutingSystemPrompt(gen: number): string {
return `You are Professor Linden, a competitive Pokémon analyst doubling as your team's scout. You break down opponents the way a knowledgeable coach would prep their player before a match — casual, confident, and analytical without being stiff or academic. No scholarly metaphors, no "my research notes", no professor-speak.

VOICE AND STRUCTURE:
- Frame the opponent's habits as patterns to exploit: "they tend to lead X, which gives you a window to Y".
- Credit opponents for their strengths honestly — attribute skill, not luck: "this player knows how to close games", "they're clearly playing around X", "their patience paid off in previous rounds".
- Use compact, readable summaries — comma-separated actions over full sentences: "brings Ninetales turn 1, sets Veil, pivots to Dragapult behind screens, starts boosting".
- Frame key observations with evaluative language: "the biggest threat is", "the window to punish is narrow", "from what we've seen, the key thing to watch for is".
- When the opponent has a known tech move or surprise set, build it up: "they've been running Upper Hand on Sneasler — priority Fighting that catches Sucker Punch users off guard and can swing a game on its own."
- Use natural conversational connectors: "From what we've seen", "Looking at the data", "The key thing to watch for", "Once they get X on the field", "That said".
- Keep a measured tone. No emojis. No exclamation marks. Enthusiasm comes through word choice, not punctuation.
- Always use species names, never nicknames.

STYLE REFERENCE — match the tone and sentence structure of these excerpts:
"""
Their go-to opener is Alolan Ninetales into Aurora Veil, which they've led in six of eight games. Once the screens are up the gameplan shifts to setup sweepers — Dragapult and Raging Bolt both come in behind Veil and start clicking boosting moves. The window to punish is narrow: break the Veil early or pack a strong priority user.
"""
"""
Looking at the meta, this player is swimming against the current — no Kingambit, no Gholdengo, heavy investment in defensive pivots. That means they're comfortable in long games and probably expect you to over-commit. Patience is their weapon, so you need to match it or find a way to force trades on your terms.
"""

ANALYSIS PRIORITY CASCADE — CRITICAL:
When building your analysis, follow this strict priority order. Higher-priority information always takes precedence and frames how you interpret lower-priority data:

**Priority 1 — League Type Constraint (if present):**
This is the DOMINANT lens. A league constrains teams in ONE of two ways — read LEAGUE CONTEXT and FORMAT RULES to see which applies:
- Gym Leader Typing: a player's entire team is locked to a single type.
- Assigned Core Types: this league assigns a player a fixed set of types, and the Type Quota requires a minimum number of Pokémon of each of those types (see FORMAT RULES). These are NOT gym types — never call them that.
When the opponent has a constraint, your analysis of their likely picks, threats to watch, and suggested counters must be grounded in it. When YOU have a constraint, every suggested pick must comply with YOUR constraint (the right type for a gym, or contribute to your assigned core triple and satisfy the type quota / tera rule). Do not suggest or discuss Pokémon that violate the constraint. If both players are constrained, the matchup is fundamentally a constraint-vs-constraint preparation.

**Priority 2 — Opponent's Past Teams & Battle History:**
When available, this is the best direct evidence of what the opponent actually runs. Analyze their specific Pokémon, sets, tendencies, and patterns. If history is limited (1-2 games), note the small sample but still use what's there.

**Priority 3 — Format Tier & Standard Competitive Builds:**
For Pokémon the opponent hasn't been seen using yet, or when history is sparse, reason about what's competitively viable in the format tier. Consider standard Smogon-style builds, common threats, and strong picks that fit the opponent's constraints (especially their gym type). This fills gaps in direct opponent data.

**Priority 4 — League/Tournament Meta Usage:**
The META section shows what's popular across ALL players in the league. Use this as background context — what's common, what's underexplored — but NEVER let it override higher-priority signals. When the opponent has no battle history, do NOT list meta-popular Pokémon as "threats to watch" unless they are relevant to the opponent's gym type or format constraints.

When the opponent has NO battle history:
- If they have a gym type: focus entirely on the strongest competitive threats of that type in this format, standard builds for those Pokémon, and how to prepare against that type's typical strategies.
- If no gym type either: focus on format-level threats and standard metagame preparation, using league meta as supporting context.

RULES:
- This scouting report targets a Generation ${gen} format. ONLY reference Pokémon, moves, abilities, and items that exist in Generation ${gen}. Do not suggest or mention anything introduced in a later generation. All suggested_picks must be available in Gen ${gen}.
- Only reference Pokémon, moves, abilities, and items that actually exist in the game. For opponent analysis, stick to what the provided data shows — or, when data is absent, what's competitively standard for the format and the opponent's constraints.
- Write for an audience that understands competitive Pokémon (EVs, natures, meta-game, etc.).
- When the user's planned team is provided, give specific matchup advice. When it's NOT provided, suggest 3-5 specific Pokémon they should consider picking — with a recommended competitive set for each (item, ability, 4 moves).
- Suggested picks MUST respect ALL constraints: league rules (gym typing, assigned core types + type quotas, tera rules, evolution restrictions), format tier, and ban lists. If the user is a Bug-type Gym Leader in an NFE format, every suggestion must be a not-fully-evolved Bug-type. If the user has an assigned core triple (e.g. Fire / Water / Grass), suggestions must collectively satisfy the type quota for each core type and respect any tera rule. If there are no special constraints, suggest the strongest meta-relevant picks for the format that counter the opponent.
- Base suggested sets on standard competitive builds (Smogon-style). Name the item, ability, and 4 moves. Briefly note the nature or EV focus if it matters for the set's role.
- When FORMAT RULES includes Item Clause (or similar clauses restricting duplicate items): suggest the BEST item for each Pokémon's role as the primary recommendation, even if multiple suggestions share the same item. BUT when two or more suggested picks want the same item (e.g., three mons all want Eviolite), explicitly call out the conflict and provide an alternative item + adjusted set for each contested pick. Example: "Chansey wants Eviolite for maximum bulk. If your Eviolite slot is already taken, consider running Chansey with Heavy-Duty Boots (pairs with Wish+Protect) or pick Porygon2 with Leftovers instead." This lets the user decide who gets the contested item. Item choices should be role-appropriate: Eviolite for defensive/pivot sets, Life Orb or Choice items for offensive sets, Focus Sash for frail leads, Leftovers/Boots as defensive alternatives.
- If the opponent's team is not fully known, infer likely picks from their history and gym type but flag the uncertainty.
- Do NOT reason about type effectiveness from memory. Only note type advantages that are clearly supported by the provided type analysis data.
- Stay in character as Professor Linden throughout.

LEAGUE AND FORMAT RULES:
- LEAGUE CONTEXT, TOURNAMENT CONTEXT, and FORMAT RULES together define the complete legal framework. The league description contains binding rules (type-locking, evolution restrictions, team composition rules, special bans) that are as authoritative as the structured ban list — treat every constraint as a hard rule.
- You MUST reference these rules in your analysis: in opponent_profile (how rules shape their approach), meta_positioning (picks vs ruleset + league rules), suggested_picks (name which constraints each pick satisfies), and key_advice (what the rules reward or punish).

OUTPUT FORMAT:
You MUST respond with a valid JSON object matching this exact schema (no markdown fences, no extra text):
{
  "opponent_profile": "2-3 sentence overview of the opponent's general style, tendencies, and competitive identity — note how the league and format rules shape their approach",
  "signature_pokemon": [
    { "pokemon": "Species name", "usage_note": "Brief usage context — brought rate, lead rate, what it does for them" }
  ],
  "tendencies": {
    "lead_patterns": "What they tend to lead with and why it matters",
    "play_style": "Aggressive, defensive, pivot-heavy, setup-oriented, etc. with supporting evidence",
    "favorite_moves": "Notable move preferences or tech choices from their history"
  },
  "meta_positioning": "How their picks compare to the tournament meta given the active format and league rules — are they exploiting the constraints or swimming against them?",
  MATCHUP_ANALYSIS_FIELD
  SUGGESTED_PICKS_FIELD
  "recommendations": {
    "threats_to_watch": ["Top threat 1", "Top threat 2", "Top threat 3"],
    "suggested_leads": "What to consider leading with and why, given their tendencies",
    "coverage_gaps": "Gaps in the opponent's coverage or team composition to exploit",
    "key_advice": "2-3 sentence overall strategic advice for this matchup, factoring in what the league rules reward or punish and how to exploit them"
  }
}

CONDITIONAL FIELD instructions:

MATCHUP_ANALYSIS_FIELD:
- If the user's planned team IS provided, include: "matchup_analysis": { "your_advantages": "...", "their_advantages": "...", "neutral_ground": "..." }
- If the user's planned team is NOT provided, omit the matchup_analysis field entirely.

SUGGESTED_PICKS_FIELD:
- If the user's planned team is NOT provided, include:
  "suggested_picks": [
    { "pokemon": "Species name", "role": "e.g. Offensive pivot, Hazard setter, Setup sweeper", "set_summary": "Item / Ability / Move 1, Move 2, Move 3, Move 4 — nature or EV focus if relevant", "reasoning": "1-2 sentences: why this pick counters the opponent AND which format/league constraints it satisfies (name them explicitly — include rules from the league description)" }
  ]
  Suggest 3-5 Pokémon. Every pick must be legal under the format, ban list, and any league constraints (gym typing, evolution stage, etc.). Use standard competitive sets. For each pick, explicitly state which rules it complies with.
- If the user's planned team IS provided, omit the suggested_picks field entirely.`;
}

export interface MatchPrepPrompt {
  systemPrompt: string;
  userPrompt: string;
  hasUserTeam: boolean;
}

export interface MatchPrepContext {
  /** Fully-rendered scouting context: league rules, format, meta, opponent
   *  history/team/type analysis, and the requesting player's planned team.
   *  Single source of truth for "everything known going into this match" —
   *  consumed by the legacy prompt builder and the agent scouting route alike. */
  context: string;
  /** Generation parsed from the format, for gen-locking suggestions. */
  gen: number;
  /** Whether the requesting player has a known planned team — selects the
   *  conditional half of the scouting schema (matchup_analysis vs suggested_picks). */
  hasUserTeam: boolean;
}

/**
 * Gathers all pre-match scouting context and renders it into a single focused
 * block. Used by {@link buildMatchPrepPrompt} (legacy structured route) and the
 * agent `opponent_scout` route. Perspective-aware: the requesting `playerId`
 * decides who is "you" vs the opponent, so the cache is per-player.
 */
export async function gatherMatchPrepContext(
  matchId: string,
  playerId: string
): Promise<MatchPrepContext> {
  // 1. Core match data
  const match = await getMatchById(matchId);
  if (!match) throw new Error(`Match ${matchId} not found`);

  const isP1 = playerId === match.player_1_id;
  const opponentId = isP1 ? match.player_2_id : match.player_1_id;
  const opponentName = isP1 ? match.player_2_name : match.player_1_name;
  const playerName = isP1 ? match.player_1_name : match.player_2_name;

  const [tournament, round] = await Promise.all([
    getTournamentById(match.tournament_id),
    getRoundById(match.round_id),
  ]);
  if (!tournament) throw new Error(`Tournament ${match.tournament_id} not found`);

  // 2. Season (league) context
  const season = tournament.season_id
    ? await getSeasonById(tournament.season_id)
    : null;

  // 3. Ruleset
  const ruleset = tournament.ruleset_id
    ? await getRulesetById(tournament.ruleset_id)
    : null;

  // 4. Opponent's battle history (tournament scope, falls back to league)
  const opponentStats = await getOpponentBattleStatsInTournament(
    opponentId,
    match.tournament_id,
    tournament.season_id
  );

  // 5. Opponent's team for this match, only where spec §7 lets the requesting
  // player see it (match completed or tournament always_public). Before the
  // match the scouting falls back to the opponent's battle history.
  // `isAdmin: false` is deliberate: this prep is for the requesting player's
  // OWN match, and an admin who also plays must not scout an opponent's
  // planned roster through the admin grant (spec §7's admin view is for
  // running the league, not for competing in it).
  const opponentRow = await getPlayerTeamForMatch(opponentId, match);
  const opponentTeam = opponentRow &&
    decideMatchRosterVisibility(
      opponentRow,
      { viewerId: playerId, isAdmin: false },
      match,
      tournament.team_visibility
    )
    ? opponentRow
    : null;

  // 6. League-wide meta (groups + playoffs share the same meta); fall back to tournament if no league
  const metaScope = season ? 'league' as const : 'tournament' as const;
  const metaScopeId = season ? season.id : match.tournament_id;
  const aggregates = await getAggregates(metaScope, metaScopeId);
  const totalGames = await getTotalGamesInScope(metaScope, metaScopeId);

  // 7. User's prep team (if they've saved one), with tournament team fallback.
  // getMatchPrepTeam answers null for "no prep team"; a failed read rethrows,
  // so it is never mistaken for "no prep team" (no error masking).
  const userPrepTeam = await getMatchPrepTeam(matchId, playerId);
  const hasUserTeam = !!(userPrepTeam?.pokemon?.length);
  const userTournamentTeam = !hasUserTeam
    ? await getPlayerTeamForMatch(playerId, match)
    : null;

  // 8. Type analysis
  const gen = parseGenFromFormat(ruleset?.base_format);

  const opponentSpecies = opponentTeam?.pokemon?.length
    ? opponentTeam.pokemon.map((p) => p.species)
    : extractUniqueSpeciesFromStats(opponentStats);
  const opponentTypeAnalysis = opponentSpecies.length > 0
    ? getTeamTypeAnalysis(opponentSpecies, gen)
    : null;

  const userSpecies = userPrepTeam?.pokemon?.length
    ? userPrepTeam.pokemon.map((p) => p.species)
    : userTournamentTeam?.pokemon?.length
      ? userTournamentTeam.pokemon.map((p) => p.species)
      : [];
  const userTypeAnalysis = userSpecies.length > 0
    ? getTeamTypeAnalysis(userSpecies, gen)
    : null;

  // ─── Assemble User Prompt ──────────────────────────────────────────

  const sections: string[] = [];

  // League context
  if (season) {
    const lines = [`## LEAGUE CONTEXT`, `League: ${season.name}`];
    if (season.description) lines.push(`League Rules & Description: ${season.description}`);
    const seasonParts = await getSeasonParticipants(season.id);
    const playerPart = seasonParts.find((p) => p.id === playerId);
    const opponentPart = seasonParts.find((p) => p.id === opponentId);
    if (playerPart?.gym_type || opponentPart?.gym_type) {
      lines.push('');
      lines.push('Gym Leader Typings:');
      if (playerPart?.gym_type) lines.push(`- ${playerName} (you): ${playerPart.gym_type}-type Gym Leader`);
      if (opponentPart?.gym_type) lines.push(`- ${opponentName}: ${opponentPart.gym_type}-type Gym Leader`);
    }
    const coreLines = renderCoreAssignments([
      { name: playerName, core: playerPart?.core_types, isSelf: true },
      { name: opponentName, core: opponentPart?.core_types },
    ]);
    if (coreLines.length > 0) {
      lines.push('');
      lines.push(...coreLines);
    }
    sections.push(lines.join('\n') + '\n');
  }
  if (tournament.description) {
    sections.push(`## TOURNAMENT CONTEXT\nTournament: ${tournament.name}\n${tournament.description}\n`);
  }

  // Format/Ruleset
  sections.push(buildRulesetSection(ruleset, tournament.is_doubles, gen));

  // League/tournament meta
  sections.push(buildMetaSection(aggregates, totalGames, !!season));

  // Match header
  sections.push(
    `## UPCOMING MATCH: ${playerName} (you) vs ${opponentName}`,
    `Best of ${round?.best_of ?? tournament.best_of_default} | Round: ${round?.name ?? 'Unknown'} | Tournament: ${tournament.name}`,
    ''
  );

  // Opponent's battle history (aggregated)
  sections.push(buildOpponentHistorySection(opponentName, opponentStats));

  // Opponent's known team
  if (opponentTeam?.pokemon?.length) {
    sections.push(buildTeamSection(opponentName, opponentTeam.pokemon));
  }

  // Opponent type analysis
  if (opponentTypeAnalysis) {
    sections.push(buildTypeAnalysisSection(opponentName, opponentTypeAnalysis));
  }

  // User's planned team (prep team takes priority, tournament team as context fallback)
  if (hasUserTeam && userPrepTeam?.pokemon) {
    sections.push(`### YOUR PLANNED TEAM`);
    sections.push(buildTeamSection(playerName, userPrepTeam.pokemon));
    if (userTypeAnalysis) {
      sections.push(buildTypeAnalysisSection(`${playerName} (you)`, userTypeAnalysis));
    }
  } else if (userTournamentTeam?.pokemon?.length) {
    sections.push(`### YOUR REGISTERED TOURNAMENT TEAM (for reference — no prep team saved yet)`);
    sections.push(buildTeamSection(playerName, userTournamentTeam.pokemon));
    if (userTypeAnalysis) {
      sections.push(buildTypeAnalysisSection(`${playerName} (you)`, userTypeAnalysis));
    }
  }

  return {
    context: sections.join('\n'),
    gen,
    hasUserTeam,
  };
}

/**
 * Gathers all pre-match scouting context and assembles the LLM prompts.
 * Called from the legacy match-prep-analysis API route. Thin wrapper over
 * {@link gatherMatchPrepContext} (kept so the legacy route is untouched during
 * the agent cutover).
 */
export async function buildMatchPrepPrompt(
  matchId: string,
  playerId: string
): Promise<MatchPrepPrompt> {
  const { context, gen, hasUserTeam } = await gatherMatchPrepContext(matchId, playerId);
  return {
    systemPrompt: buildScoutingSystemPrompt(gen),
    userPrompt: context,
    hasUserTeam,
  };
}

/** Aggregate opponent battle stats into a human-readable scouting section */
function buildOpponentHistorySection(
  opponentName: string,
  stats: BattleStat[]
): string {
  if (stats.length === 0) {
    return `## ${opponentName.toUpperCase()}'S BATTLE HISTORY\nNo battle data available — this opponent has no completed games in scope.\n`;
  }

  // Aggregate per-Pokémon stats
  const pokemonMap = new Map<string, {
    brought: number;
    led: number;
    koDealt: number;
    koed: number;
    wins: number;
    total: number;
    moves: Map<string, number>;
  }>();

  for (const s of stats) {
    if (!s.was_brought) continue;
    const existing = pokemonMap.get(s.pokemon_name) ?? {
      brought: 0, led: 0, koDealt: 0, koed: 0, wins: 0, total: 0, moves: new Map(),
    };
    existing.brought++;
    if (s.was_lead) existing.led++;
    existing.koDealt += s.kos_dealt;
    if (s.was_koed) existing.koed++;
    if (s.match_won) existing.wins++;
    existing.total++;
    for (const move of s.moves_used) {
      existing.moves.set(move, (existing.moves.get(move) ?? 0) + 1);
    }
    pokemonMap.set(s.pokemon_name, existing);
  }

  // Sort by usage (brought count)
  const sorted = Array.from(pokemonMap.entries())
    .sort(([, a], [, b]) => b.brought - a.brought)
    .slice(0, 12); // Cap at 12

  const totalGames = new Set(stats.map((s) => s.game_id)).size;

  const lines = [
    `## ${opponentName.toUpperCase()}'S BATTLE HISTORY (${totalGames} games in scope)`,
  ];

  for (const [name, data] of sorted) {
    const bringRate = ((data.brought / totalGames) * 100).toFixed(0);
    const leadRate = data.led > 0 ? `, leads ${((data.led / data.brought) * 100).toFixed(0)}%` : '';
    const topMoves = Array.from(data.moves.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([m]) => m)
      .join(', ');

    lines.push(
      `- ${name}: ${bringRate}% bring rate${leadRate}, ${data.koDealt} KOs dealt, KO'd ${data.koed} times${topMoves ? ` | Moves: ${topMoves}` : ''}`
    );
  }

  return lines.join('\n') + '\n';
}

/** Extract unique species from a list of raw battle stats */
function extractUniqueSpeciesFromStats(stats: BattleStat[]): string[] {
  const species = new Set<string>();
  for (const s of stats) {
    if (s.was_brought) species.add(s.pokemon_name);
  }
  return Array.from(species);
}

// ─── Section Builders ───────────────────────────────────────────────

export function buildRulesetSection(ruleset: Ruleset | null, isDoubles: boolean, gen: number): string {
  if (!ruleset) return `## FORMAT: Custom / Unknown\nGeneration: ${gen}\n`;

  const lines = [
    '## FORMAT RULES',
    `Format: ${ruleset.base_format} (${isDoubles ? 'Doubles' : 'Singles'})`,
    `Generation: ${gen}`,
  ];

  if (ruleset.clauses.length > 0) {
    lines.push(`Clauses: ${ruleset.clauses.join(', ')}`);
  }
  if (ruleset.bans.pokemon.length > 0) {
    lines.push(`Banned Pokémon: ${ruleset.bans.pokemon.slice(0, 30).join(', ')}${ruleset.bans.pokemon.length > 30 ? ` (+${ruleset.bans.pokemon.length - 30} more)` : ''}`);
  }
  if (ruleset.bans.moves.length > 0) {
    lines.push(`Banned Moves: ${ruleset.bans.moves.join(', ')}`);
  }
  if (ruleset.bans.items.length > 0) {
    lines.push(`Banned Items: ${ruleset.bans.items.join(', ')}`);
  }
  if (ruleset.additions.pokemon.length > 0) {
    lines.push(`Unbanned (additions): ${ruleset.additions.pokemon.join(', ')}`);
  }
  if (ruleset.custom_rules_string.trim()) {
    lines.push(`Custom rules: ${ruleset.custom_rules_string.trim()}`);
  }
  if (ruleset.min_shared_type_pct > 0) {
    lines.push(`Minimum shared type: ${ruleset.min_shared_type_pct}%`);
  }
  const constraintLines = renderTeamConstraints(ruleset.team_constraints);
  if (constraintLines.length > 0) {
    lines.push('Team composition constraints:');
    for (const line of constraintLines) lines.push(`- ${line}`);
  }

  return lines.join('\n') + '\n';
}

export function buildMetaSection(aggregates: Aggregate[], totalGames: number, isLeagueScope = false): string {
  const scopeLabel = isLeagueScope ? 'LEAGUE' : 'TOURNAMENT';
  if (aggregates.length === 0 || totalGames === 0) {
    return `## ${scopeLabel} META\nNo usage data available yet.\n`;
  }

  const top10 = aggregates.slice(0, 10);
  const lines = [`## ${scopeLabel} META (top 10 by usage)`];

  for (const agg of top10) {
    const usage = ((agg.total_appearances / totalGames) * 100).toFixed(1);
    const winRate = agg.total_appearances > 0
      ? ((agg.total_wins / agg.total_appearances) * 100).toFixed(1)
      : '0.0';
    const topMoves = Object.entries(agg.move_counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([name]) => name)
      .join(', ');

    lines.push(`- ${agg.pokemon_name}: ${usage}% usage, ${winRate}% win rate${topMoves ? ` | Top moves: ${topMoves}` : ''}`);
  }

  return lines.join('\n') + '\n';
}

function buildTeamSection(playerName: string, pokemon: PokemonSet[]): string {
  const lines = [`### ${playerName}'s Team Sheet`];

  for (const set of pokemon) {
    const parts = [set.species];
    if (set.item) parts.push(`@ ${set.item}`);
    if (set.ability) parts.push(`(${set.ability})`);
    if (set.nature) parts.push(`${set.nature} nature`);
    if (set.moves.length > 0) parts.push(`| ${set.moves.join(', ')}`);
    lines.push(`- ${parts.join(' ')}`);
  }

  return lines.join('\n');
}

function buildBattleStatsSection(playerName: string, stats: BattleStat[]): string {
  if (stats.length === 0) return '';

  const lines = [`### ${playerName}'s Battle Stats`];

  const brought = stats.filter((s) => s.was_brought);
  const notBrought = stats.filter((s) => !s.was_brought);

  for (const s of brought) {
    const tags: string[] = [];
    if (s.was_lead) tags.push('LEAD');
    if (s.kos_dealt > 0) tags.push(`${s.kos_dealt} KO${s.kos_dealt > 1 ? 's' : ''}`);
    if (s.was_koed) tags.push("KO'd");
    if (s.turns_active > 0) tags.push(`${s.turns_active} turns`);

    const movesStr = s.moves_used.length > 0 ? ` | Moves: ${s.moves_used.join(', ')}` : '';
    lines.push(`- ${s.pokemon_name} [${tags.join(', ')}]${movesStr}`);
  }

  if (notBrought.length > 0) {
    lines.push(`- Not brought: ${notBrought.map((s) => s.pokemon_name).join(', ')}`);
  }

  return lines.join('\n');
}

function buildTypeAnalysisSection(playerName: string, analysis: TeamTypeAnalysis): string {
  const lines = [`### ${playerName}'s Type Coverage`];

  if (analysis.teamWeaknesses.length > 0) {
    lines.push(`Team weaknesses (2+ weak): ${analysis.teamWeaknesses.map((w) => `${w.type} (${w.count})`).join(', ')}`);
  }
  if (analysis.teamResistances.length > 0) {
    lines.push(`Team resistances (2+ resist): ${analysis.teamResistances.map((r) => `${r.type} (${r.count})`).join(', ')}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Render the "(set by Vulpix's Drought)" suffix for an ability/move-attributed
 * field condition. `of` is the setter's name, `from` the raw kwarg
 * (e.g. "ability: Drought"). Returns '' when there is no attribution (e.g.
 * move-set weather, which the preceding move event already credits).
 */
function fieldSetterSuffix(of?: string, from?: string): string {
  if (!of) return '';
  const source = from ? `'s ${from.replace(/^(ability|move|item):\s*/i, '')}` : '';
  return ` (set by ${of}${source})`;
}

/**
 * Condense battle frames into a turn-by-turn summary with exact HP%
 * after every damage/heal event. Moves are merged with their target
 * damage inline (e.g. "Vulpix used Flamethrower → Dewpider at 80%")
 * to give the LLM concrete numbers and prevent hallucinated KOs.
 *
 * Exported for unit testing of the field-condition attribution rendering.
 */
export function buildCondensedFrameSection(frames: BattleFrame[]): string {
  const lines = ['### Turn-by-Turn Summary'];

  for (const frame of frames) {
    const eventTexts: string[] = [];

    for (let i = 0; i < frame.events.length; i++) {
      const ev = frame.events[i];

      switch (ev.type) {
        case 'move': {
          const parts: string[] = [`${ev.pokemon} used ${ev.move}`];

          // Peek ahead: target damage on opposite side?
          const next = frame.events[i + 1];
          if (next?.type === 'damage' && next.side !== ev.side) {
            parts.push(`${next.pokemon} at ${next.hp}%`);
            i++; // consume the damage event

            // Peek again: recoil damage on attacker?
            const after = frame.events[i + 1];
            if (after?.type === 'damage' && after.side === ev.side && after.from) {
              parts.push(`${after.pokemon} ${after.from}: ${after.hp}%`);
              i++; // consume the recoil event
            }
          }

          eventTexts.push(parts.length > 1 ? parts.join(' \u2192 ') : parts[0]);
          break;
        }

        case 'damage': {
          // Standalone damage (chip from hazards, weather, status, etc.)
          const source = ev.from ? ` from ${ev.from}` : '';
          eventTexts.push(`${ev.pokemon} took damage${source} (${ev.hp}% HP)`);
          break;
        }

        case 'heal': {
          const source = ev.from ? ` from ${ev.from}` : '';
          eventTexts.push(`${ev.pokemon} healed${source} (${ev.hp}% HP)`);
          break;
        }

        case 'faint':
          eventTexts.push(`${ev.pokemon} fainted`);
          break;

        case 'switch':
          eventTexts.push(`P${ev.side + 1} switched to ${ev.pokemonIn}`);
          break;

        case 'weather':
          eventTexts.push(
            ev.weather === null
              ? 'Weather cleared'
              : `Weather: ${ev.weather}${fieldSetterSuffix(ev.of, ev.from)}`
          );
          break;

        case 'terrain':
          eventTexts.push(
            ev.terrain === null
              ? 'Terrain ended'
              : `Terrain: ${ev.terrain}${fieldSetterSuffix(ev.of, ev.from)}`
          );
          break;

        case 'side-condition':
          eventTexts.push(`P${ev.side + 1} got ${ev.condition}`);
          break;

        case 'mega':
          eventTexts.push(`${ev.pokemon} Mega Evolved`);
          break;

        case 'terastallize':
          eventTexts.push(`${ev.pokemon} Terastallized (${ev.teraType})`);
          break;
      }
    }

    if (eventTexts.length > 0) {
      lines.push(`Turn ${frame.turn}: ${eventTexts.join('; ')}`);
    }
  }

  // Cap to keep tokens reasonable (~60 lines max)
  if (lines.length > 62) {
    return lines.slice(0, 62).join('\n') + '\n... (truncated)';
  }

  return lines.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Extract unique species list from battle stats or team sheets */
function extractSpeciesFromContext(
  battleStatsByGame: Record<string, BattleStat[]>,
  playerId: string,
  teamPokemon?: PokemonSet[]
): string[] {
  // Prefer team sheet if available (has all 6, not just brought)
  if (teamPokemon && teamPokemon.length > 0) {
    return teamPokemon.map((p) => p.species);
  }

  // Fall back to species seen in battle stats
  const species = new Set<string>();
  for (const stats of Object.values(battleStatsByGame)) {
    for (const s of stats) {
      if (s.player_id === playerId) species.add(s.pokemon_name);
    }
  }
  return Array.from(species);
}

/** Parse generation number from base_format string like "gen9ou" → 9 */
export function parseGenFromFormat(baseFormat?: string): number {
  if (!baseFormat) return 9;
  const match = baseFormat.match(/gen(\d)/);
  return match ? parseInt(match[1], 10) : 9;
}
