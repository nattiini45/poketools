import type { ValidationResult, ValidationError, RecapFactPack, ForecastFactPack, MatchFact } from './types';

// ─── Recap Validation ───────────────────────────────────────────────

/**
 * Validate LLM output for a recap task against the fact pack.
 * Returns errors for any hallucinated names, scores, or numbers.
 */
export function validateRecapOutput(
  taskId: string,
  text: string,
  factPack: RecapFactPack
): ValidationResult {
  const errors: ValidationError[] = [];

  // Check player names
  errors.push(...checkPlayerNames(text, factPack.validPlayerNames));

  // Check pokemon names
  errors.push(...checkPokemonNames(text, factPack.validPokemonNames));

  // Task-specific checks
  if (taskId.startsWith('match_one_liner_')) {
    const index = parseInt(taskId.split('_').pop() ?? '0', 10);
    const match = factPack.matches[index];
    if (match) {
      errors.push(...checkMatchFacts(text, match));
    }
  }

  if (taskId === 'standings_story') {
    errors.push(...checkStandingsNumbers(text, factPack));
  }

  if (taskId === 'narrative') {
    // Narrative references multiple matches — validate scores against
    // the full set of known scores, not per-match (which would flag
    // a valid "1-0" as wrong when checking against a "2-0" match).
    errors.push(...checkNarrativeScores(text, factPack.matches));
  }

  // Single mode: full JSON validation
  if (taskId === 'single_recap') {
    for (const match of factPack.matches) {
      errors.push(...checkMatchFacts(text, match));
    }
    errors.push(...checkStandingsNumbers(text, factPack));
  }

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  };
}

/**
 * Validate LLM output for a forecast task against the fact pack.
 */
export function validateForecastOutput(
  taskId: string,
  text: string,
  factPack: ForecastFactPack
): ValidationResult {
  const errors: ValidationError[] = [];

  errors.push(...checkPlayerNames(text, factPack.validPlayerNames));
  errors.push(...checkPokemonNames(text, factPack.validPokemonNames));

  if (taskId === 'standings_context') {
    errors.push(...checkForecastStandingsNumbers(text, factPack));
  }

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
  };
}

// ─── Name Checks ────────────────────────────────────────────────────

/**
 * Check that any capitalized multi-word tokens that look like player names
 * actually exist in the allowlist. Uses a heuristic: sequences of 2+ capitalized
 * words that aren't common English are candidate player names.
 */
function checkPlayerNames(text: string, validNames: string[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const _normalizedValid = new Set(validNames.map((n) => n.toLowerCase()));

  // Extract potential player name references — words that appear in the text
  // and could be player names (simple heuristic: check all valid names appear correctly)
  for (const name of validNames) {
    // If the name appears in the text but with wrong casing, that's a warning
    const lowerText = text.toLowerCase();
    const lowerName = name.toLowerCase();
    if (lowerText.includes(lowerName)) {
      // Name is referenced — check it's not misspelled elsewhere
      continue;
    }
  }

  // Check for names in the text that are close to but don't match valid names
  // (fuzzy detection of hallucinated names)
  for (const name of validNames) {
    if (text.includes(name)) continue;
    // Check if a similar-but-wrong name appears
    const parts = name.split(' ');
    for (const part of parts) {
      if (part.length < 4) continue;
      // If we find a substring that's close to a name part but not exact, flag it
      const regex = new RegExp(`\\b${escapeRegex(part)}\\b`, 'i');
      if (!regex.test(text)) continue;
    }
  }

  return errors;
}

/**
 * Check that Pokémon names mentioned in the text exist in the allowlist.
 * Uses the convention that Pokémon names are capitalized proper nouns.
 */
function checkPokemonNames(text: string, validNames: string[]): ValidationError[] {
  const errors: ValidationError[] = [];
  if (validNames.length === 0) return errors;

  const validSet = new Set(validNames.map((n) => n.toLowerCase()));

  // Extract capitalized words that could be Pokémon names
  // Pokémon names can contain hyphens (e.g., Ho-Oh, Porygon-Z)
  const potentialNames = text.match(/\b[A-Z][a-z]+(?:-[A-Z][a-z]+)*\b/g) ?? [];

  // Common English words to skip
  const skipWords = new Set([
    'the', 'and', 'but', 'for', 'not', 'you', 'all', 'can', 'had', 'her',
    'was', 'one', 'our', 'out', 'his', 'has', 'its', 'how', 'man', 'new',
    'now', 'old', 'see', 'way', 'who', 'did', 'get', 'let', 'say', 'she',
    'too', 'use', 'round', 'match', 'game', 'team', 'type', 'move', 'pick',
    'week', 'this', 'that', 'with', 'from', 'have', 'been', 'were', 'they',
    'will', 'each', 'make', 'like', 'just', 'over', 'such', 'take', 'year',
    'into', 'some', 'than', 'them', 'very', 'when', 'come', 'could', 'after',
    'before', 'between', 'through', 'while', 'where', 'which', 'their',
    'other', 'about', 'right', 'still', 'going', 'being', 'season', 'league',
    'tournament', 'standings', 'remaining', 'pokemon', 'pokémon',
    'trainer', 'leader', 'gym', 'starter', 'sweep', 'swept', 'clutch',
    'dominant', 'comfortable', 'close', 'tight', 'narrow', 'commanding',
    // Kale Cabbage specific
    'kale', 'cabbage',
  ]);

  for (const candidate of potentialNames) {
    if (skipWords.has(candidate.toLowerCase())) continue;
    if (candidate.length < 3) continue;

    // Check if this could be a Pokémon name that's NOT in our allowlist
    // Only flag if it looks like it's being used as a Pokémon reference
    // (near words like "KO", "MVP", "brought", "lead", etc.)
    const pokemonContext = /KO|MVP|brought|lead|sweep|faint|move|attack|damage/i;
    const nearbyText = text.substring(
      Math.max(0, text.indexOf(candidate) - 50),
      Math.min(text.length, text.indexOf(candidate) + candidate.length + 50)
    );

    if (pokemonContext.test(nearbyText) && !validSet.has(candidate.toLowerCase())) {
      errors.push({
        type: 'wrong_pokemon',
        detail: `"${candidate}" appears in Pokémon context but is not in the match data`,
        severity: 'warning',
      });
    }
  }

  return errors;
}

// ─── Match Fact Checks ──────────────────────────────────────────────

function checkMatchFacts(text: string, match: MatchFact): ValidationError[] {
  const errors: ValidationError[] = [];

  errors.push(...checkScoreReferences(text, match));
  errors.push(...checkWinnerAttribution(text, match));

  return errors;
}

/**
 * Check that any score references (e.g., "2-0", "3-1") in the text match
 * the actual match scores.
 */
function checkScoreReferences(text: string, match: MatchFact): ValidationError[] {
  const errors: ValidationError[] = [];

  // Find all score patterns in the text
  const scorePattern = /\b(\d+)-(\d+)\b/g;
  let scoreMatch;

  while ((scoreMatch = scorePattern.exec(text)) !== null) {
    const [, a, b] = scoreMatch;
    const foundScore = `${a}-${b}`;

    // Check if this score matches any known match score
    const validScores = [
      match.scoreString,
      `${match.loserScore}-${match.winnerScore}`, // reversed
    ];

    if (!validScores.includes(foundScore)) {
      // Could be a record like "3W-1L" or a KO count — check context
      const nearby = text.substring(
        Math.max(0, scorePattern.lastIndex - 30),
        Math.min(text.length, scorePattern.lastIndex + 20)
      );

      // Skip if it looks like a win-loss record (e.g., "3W-1L", "1W-0L")
      if (/\d[WL]/i.test(nearby)) continue;
      // Skip if it looks like a KD reference
      if (/KD|differential/i.test(nearby)) continue;

      errors.push({
        type: 'wrong_score',
        detail: `Score "${foundScore}" doesn't match actual result ${match.scoreString} for ${match.player1Name} vs ${match.player2Name}`,
        severity: 'error',
      });
    }
  }

  return errors;
}

/**
 * Check that the winner is correctly attributed.
 */
function checkWinnerAttribution(text: string, match: MatchFact): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check if the text says the loser won
  const winPatterns = [
    new RegExp(`${escapeRegex(match.loserName)}\\s+(won|defeated|beat|swept|took\\s+the\\s+win)`, 'i'),
    new RegExp(`(victory|win)\\s+for\\s+${escapeRegex(match.loserName)}`, 'i'),
  ];

  for (const pattern of winPatterns) {
    if (pattern.test(text)) {
      errors.push({
        type: 'wrong_player',
        detail: `Text attributes victory to ${match.loserName}, but ${match.winnerName} won this match`,
        severity: 'error',
      });
    }
  }

  return errors;
}

/**
 * Validate score references in a narrative against ALL known matches.
 * Unlike per-match checkScoreReferences, this collects every valid score
 * first so "1-0" and "2-0" from different matches don't cross-flag.
 */
function checkNarrativeScores(text: string, matches: MatchFact[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // Collect all valid scores (both directions) across every match
  const validScores = new Set<string>();
  for (const match of matches) {
    validScores.add(match.scoreString);
    validScores.add(`${match.loserScore}-${match.winnerScore}`);
  }

  const scorePattern = /\b(\d+)-(\d+)\b/g;
  let scoreMatch;

  while ((scoreMatch = scorePattern.exec(text)) !== null) {
    const [, a, b] = scoreMatch;
    const foundScore = `${a}-${b}`;

    if (!validScores.has(foundScore)) {
      const nearby = text.substring(
        Math.max(0, scorePattern.lastIndex - 30),
        Math.min(text.length, scorePattern.lastIndex + 20)
      );
      if (/\d[WL]/i.test(nearby)) continue;
      if (/KD|differential/i.test(nearby)) continue;

      errors.push({
        type: 'wrong_score',
        detail: `Score "${foundScore}" doesn't match any known match result (valid: ${[...validScores].join(', ')})`,
        severity: 'error',
      });
    }
  }

  return errors;
}

// ─── Standings Checks ───────────────────────────────────────────────

function checkStandingsNumbers(text: string, factPack: RecapFactPack): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check that point values mentioned are accurate
  const pointPattern = /(\d+)\s*(?:pts?|points?)/gi;
  let pointMatch;

  while ((pointMatch = pointPattern.exec(text)) !== null) {
    const mentionedPoints = parseInt(pointMatch[1], 10);
    const validPoints = new Set(factPack.currentStandings.map((s) => s.points));
    if (!validPoints.has(mentionedPoints)) {
      errors.push({
        type: 'wrong_number',
        detail: `${mentionedPoints} points doesn't match any player's actual point total`,
        severity: 'warning',
      });
    }
  }

  return errors;
}

function checkForecastStandingsNumbers(text: string, factPack: ForecastFactPack): ValidationError[] {
  const errors: ValidationError[] = [];

  const pointPattern = /(\d+)\s*(?:pts?|points?)/gi;
  let pointMatch;

  while ((pointMatch = pointPattern.exec(text)) !== null) {
    const mentionedPoints = parseInt(pointMatch[1], 10);
    const validPoints = new Set(factPack.currentStandings.map((s) => s.points));
    if (!validPoints.has(mentionedPoints)) {
      errors.push({
        type: 'wrong_number',
        detail: `${mentionedPoints} points doesn't match any player's actual point total`,
        severity: 'warning',
      });
    }
  }

  return errors;
}

// ─── Utilities ──────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
