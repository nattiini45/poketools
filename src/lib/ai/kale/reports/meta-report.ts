import { AI_MAX_TOKENS } from '../../constants';
import { getAggregates, getTotalGamesInScope } from '@/lib/supabase/queries/aggregates';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import type { ReportDefinition } from '../registry';
import type { PromptTask, PipelineMode, ValidationResult, ReportParams } from '../types';
import type { MetaReportContent } from '@/types/tournament-report';

// ─── Fact Pack ──────────────────────────────────────────────────────

interface MetaReportFactPack {
  tournamentName: string;
  format: string;
  totalGames: number;
  usageData: {
    pokemonName: string;
    usagePct: number;
    totalKos: number;
    winRate: number;
    totalAppearances: number;
    totalGames: number;
    totalWins: number;
  }[];
  /** Type distribution: how many appearances per Pokémon type */
  typeDistribution: { type: string; count: number }[];
  validPokemonNames: string[];
}

async function buildFactPack(params: ReportParams): Promise<MetaReportFactPack> {
  const tournament = await getTournamentById(params.tournamentId);
  if (!tournament) throw new Error(`Tournament ${params.tournamentId} not found`);

  const ruleset = tournament.ruleset_id ? await getRulesetById(tournament.ruleset_id) : null;

  const [aggregates, totalGames] = await Promise.all([
    getAggregates('tournament', params.tournamentId),
    getTotalGamesInScope('tournament', params.tournamentId),
  ]);

  const usageData = aggregates.map((a) => ({
    pokemonName: a.pokemon_name,
    usagePct: totalGames > 0 ? Math.round((a.total_brought / totalGames) * 100) : 0,
    totalKos: a.total_kos_dealt,
    winRate: a.total_games > 0 ? Math.round((a.total_wins / a.total_games) * 100) : 0,
    totalAppearances: a.total_brought,
    totalGames: a.total_games,
    totalWins: a.total_wins,
  }));

  // Compute type distribution (simplified — aggregate by first type mention)
  const typeCounts: Record<string, number> = {};
  // Note: we don't have type data in aggregates, so we'll track by pokemon count
  // The LLM will discuss types based on known Pokémon types

  return {
    tournamentName: tournament.name,
    format: ruleset?.base_format ?? 'unknown',
    totalGames,
    usageData,
    typeDistribution: Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    validPokemonNames: aggregates.map((a) => a.pokemon_name),
  };
}

// ─── Prompts ────────────────────────────────────────────────────────

const PERSONA = `You are Kale Cabbage, competitive Pokémon meta analyst. Write sharp, data-driven analysis of the tournament meta. No emojis.`;
const RULES = `CRITICAL: Use ONLY the facts provided. Every usage percentage and stat must come from the data.`;

function getPromptTasks(factPack: unknown, mode: PipelineMode): PromptTask[] {
  const fp = factPack as MetaReportFactPack;

  const usageTable = fp.usageData.slice(0, 15)
    .map((u) => `${u.pokemonName}: ${u.usagePct}% usage, ${u.totalKos} KOs, ${u.winRate}% WR (${u.totalAppearances} apps in ${fp.totalGames} games)`)
    .join('\n');

  if (mode === 'single') {
    return [{
      id: 'single_meta_report',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nRespond with JSON:\n{"headline":"","narrative":"","top_pokemon":[{"pokemon_name":"","role":"","analysis":""}],"type_trends":"","emerging_threats":""}`,
      userPrompt: `Tournament: ${fp.tournamentName}\nFormat: ${fp.format}\nGames: ${fp.totalGames}\n\nUsage:\n${usageTable}`,
      maxTokens: AI_MAX_TOKENS.kaleTask,
    }];
  }

  return [
    {
      id: 'meta_headline',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite a single headline about the dominant meta trend.`,
      userPrompt: `Tournament: ${fp.tournamentName}\nTop 5:\n${fp.usageData.slice(0, 5).map((u) => `${u.pokemonName} (${u.usagePct}%)`).join(', ')}`,
      maxTokens: AI_MAX_TOKENS.kaleTask,
    },
    {
      id: 'top_pokemon_analysis',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nFor each of the top 5 Pokémon, write a JSON array: [{"pokemon_name":"","role":"brief role description","analysis":"1-2 sentences on performance"}]`,
      userPrompt: `Usage data:\n${usageTable}`,
      maxTokens: AI_MAX_TOKENS.kaleTask,
    },
    {
      id: 'type_trends',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite 2-3 sentences about type-based trends visible in the usage data.`,
      userPrompt: `Usage data:\n${usageTable}`,
      maxTokens: AI_MAX_TOKENS.kaleTask,
    },
    {
      id: 'emerging_threats',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite 2-3 sentences about emerging or underrated picks (lower usage but high win rate or KOs).`,
      userPrompt: `Full usage (sorted by usage %):\n${fp.usageData.map((u) => `${u.pokemonName}: ${u.usagePct}% usage, ${u.winRate}% WR, ${u.totalKos} KOs`).join('\n')}`,
      maxTokens: AI_MAX_TOKENS.kaleTask,
    },
    {
      id: 'meta_narrative',
      stage: 2,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite a 3-4 paragraph meta analysis narrative. Discuss the top performers, type trends, and emerging threats. Use specific stats.`,
      userPrompt: `Tournament: ${fp.tournamentName} | ${fp.format} | ${fp.totalGames} games\n\nUsage:\n${usageTable}`,
      maxTokens: AI_MAX_TOKENS.kaleTask,
    },
  ];
}

// ─── Assembly ───────────────────────────────────────────────────────

function assemble(outputs: Map<string, string>, factPack: unknown): MetaReportContent {
  const fp = factPack as MetaReportFactPack;

  const serverUsageData = fp.usageData.slice(0, 20).map((u) => ({
    pokemon_name: u.pokemonName,
    usage_pct: u.usagePct,
    total_kos: u.totalKos,
    win_rate: u.winRate,
  }));

  // Parse top pokemon analysis
  let topPokemon: { pokemon_name: string; role: string; analysis: string }[] = [];
  const topRaw = outputs.get('top_pokemon_analysis') ?? '';
  try {
    const arrStart = topRaw.indexOf('[');
    const arrEnd = topRaw.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      const parsed = JSON.parse(topRaw.slice(arrStart, arrEnd + 1));
      if (Array.isArray(parsed)) {
        topPokemon = parsed.map((p: Record<string, unknown>) => ({
          pokemon_name: String(p.pokemon_name ?? ''),
          role: String(p.role ?? ''),
          analysis: String(p.analysis ?? ''),
        }));
      }
    }
  } catch { /* use empty */ }

  // Handle single mode
  if (outputs.has('single_meta_report')) {
    try {
      const raw = outputs.get('single_meta_report') ?? '';
      let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
      cleaned = cleaned.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) {
        const p = JSON.parse(cleaned.slice(start, end + 1));
        const str = (v: unknown, f = ''): string => typeof v === 'string' ? v : f;
        return {
          headline: str(p.headline, `${fp.tournamentName} Meta Report`),
          narrative: str(p.narrative),
          usage_data: serverUsageData,
          top_pokemon: Array.isArray(p.top_pokemon) ? p.top_pokemon.map((tp: Record<string, unknown>) => ({
            pokemon_name: String(tp.pokemon_name ?? ''),
            role: String(tp.role ?? ''),
            analysis: String(tp.analysis ?? ''),
          })) : topPokemon,
          type_trends: str(p.type_trends),
          emerging_threats: str(p.emerging_threats),
        };
      }
    } catch { /* fall through */ }
  }

  return {
    headline: outputs.get('meta_headline')?.trim() || `${fp.tournamentName} Meta Report`,
    narrative: outputs.get('meta_narrative')?.trim() || '',
    usage_data: serverUsageData,
    top_pokemon: topPokemon,
    type_trends: outputs.get('type_trends')?.trim() || '',
    emerging_threats: outputs.get('emerging_threats')?.trim() || '',
  };
}

// ─── Validation ─────────────────────────────────────────────────────

function validate(_taskId: string, text: string, factPack: unknown): ValidationResult {
  const fp = factPack as MetaReportFactPack;
  const errors: { type: 'wrong_player' | 'wrong_pokemon' | 'wrong_score' | 'wrong_number' | 'structural'; detail: string; severity: 'error' | 'warning' }[] = [];

  // Check usage percentages
  const pctPattern = /(\d+)%/g;
  let match;
  while ((match = pctPattern.exec(text)) !== null) {
    const pct = parseInt(match[1], 10);
    if (pct > 0 && pct <= 100 && !fp.usageData.some((u) => u.usagePct === pct || u.winRate === pct)) {
      errors.push({ type: 'wrong_number', detail: `${pct}% doesn't match any known usage or win rate`, severity: 'warning' });
    }
  }

  return { valid: errors.filter((e) => e.severity === 'error').length === 0, errors };
}

export const metaReportDefinition: ReportDefinition = {
  type: 'meta_report',
  buildFactPack,
  getPromptTasks,
  validate,
  assemble,
};
