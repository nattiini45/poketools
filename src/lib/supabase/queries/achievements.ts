import { supabase } from '../client';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';
import type {
  AchievementCriteria,
  AchievementDefinition,
  EarnedAchievement,
  PlayerAchievement,
  AchievementCategory,
  AchievementTier,
} from '@/types/achievement';

type AchievementDefinitionRow = Tables<'achievement_definitions'>;
type PlayerAchievementRow = Tables<'player_achievements'>;

function toAchievementDefinition(row: AchievementDefinitionRow): AchievementDefinition {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    icon: row.icon,
    category: row.category as AchievementCategory,
    tier: row.tier as AchievementTier,
    repeatable: row.repeatable,
    hidden: row.hidden,
    criteria: row.criteria as unknown as AchievementCriteria,
  };
}

function toPlayerAchievement(row: PlayerAchievementRow): PlayerAchievement {
  return {
    id: row.id,
    player_id: row.player_id,
    achievement_id: row.achievement_id,
    earned_at: row.earned_at,
    context: row.context as PlayerAchievement['context'],
    times_earned: row.times_earned,
  };
}

export interface AchievementDefinitionInput {
  key: string;
  name: string;
  description: string;
  icon: string | null;
  category: AchievementCategory;
  tier: AchievementTier;
  repeatable: boolean;
  hidden: boolean;
  criteria: AchievementCriteria;
}

export async function listAchievementDefinitions(): Promise<AchievementDefinition[]> {
  const { data, error } = await supabase
    .from('achievement_definitions')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data.map(toAchievementDefinition);
}

export async function getAchievementDefinition(id: string): Promise<AchievementDefinition | null> {
  const { data, error } = await supabase
    .from('achievement_definitions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toAchievementDefinition(data) : null;
}

export async function createAchievementDefinition(
  input: AchievementDefinitionInput
): Promise<AchievementDefinition> {
  const payload: TablesInsert<'achievement_definitions'> = {
    key: input.key,
    name: input.name,
    description: input.description,
    icon: input.icon,
    category: input.category,
    tier: input.tier,
    repeatable: input.repeatable,
    hidden: input.hidden,
    criteria: input.criteria as unknown as TablesInsert<'achievement_definitions'>['criteria'],
  };

  const { data, error } = await supabase
    .from('achievement_definitions')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return toAchievementDefinition(data);
}

export async function updateAchievementDefinition(
  id: string,
  input: Partial<AchievementDefinitionInput>
): Promise<AchievementDefinition> {
  const payload: TablesUpdate<'achievement_definitions'> = {};
  if (input.key !== undefined) payload.key = input.key;
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.icon !== undefined) payload.icon = input.icon;
  if (input.category !== undefined) payload.category = input.category;
  if (input.tier !== undefined) payload.tier = input.tier;
  if (input.repeatable !== undefined) payload.repeatable = input.repeatable;
  if (input.hidden !== undefined) payload.hidden = input.hidden;
  if (input.criteria !== undefined) {
    payload.criteria = input.criteria as unknown as TablesUpdate<'achievement_definitions'>['criteria'];
  }

  const { data, error } = await supabase
    .from('achievement_definitions')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toAchievementDefinition(data);
}

export async function deleteAchievementDefinition(id: string): Promise<void> {
  const { error } = await supabase
    .from('achievement_definitions')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function getPlayerAchievements(playerId: string): Promise<EarnedAchievement[]> {
  const { data, error } = await supabase
    .from('player_achievements')
    .select(`
      id,
      player_id,
      achievement_id,
      earned_at,
      context,
      times_earned,
      achievement_definitions!inner (
        id,
        key,
        name,
        description,
        icon,
        category,
        tier,
        repeatable,
        hidden,
        criteria
      )
    `)
    .eq('player_id', playerId)
    .order('earned_at', { ascending: false });

  if (error) throw error;

  return data.map((row) => {
    const definition = row.achievement_definitions as unknown as AchievementDefinitionRow;
    const base = toAchievementDefinition(definition);
    return {
      ...base,
      earned_at: row.earned_at,
      times_earned: row.times_earned,
      context: row.context as PlayerAchievement['context'],
    };
  });
}

export async function getPlayerAchievementKeys(playerId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('player_achievements')
    .select('achievement_definitions!inner ( key )')
    .eq('player_id', playerId);

  if (error) throw error;

  const keys = data
    .map((row) => (row.achievement_definitions as unknown as { key: string }).key)
    .filter(Boolean);

  return new Set(keys);
}

export async function upsertPlayerAchievement(
  playerId: string,
  achievementId: string,
  context: PlayerAchievement['context']
): Promise<PlayerAchievement> {
  const { data: existing, error: fetchErr } = await supabase
    .from('player_achievements')
    .select('*')
    .eq('player_id', playerId)
    .eq('achievement_id', achievementId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;

  if (existing) {
    const { data, error } = await supabase
      .from('player_achievements')
      .update({
        times_earned: existing.times_earned + 1,
        earned_at: new Date().toISOString(),
        context: context as TablesUpdate<'player_achievements'>['context'],
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return toPlayerAchievement(data);
  }

  const payload: TablesInsert<'player_achievements'> = {
    player_id: playerId,
    achievement_id: achievementId,
    context: context as TablesInsert<'player_achievements'>['context'],
    times_earned: 1,
  };

  const { data, error } = await supabase
    .from('player_achievements')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return toPlayerAchievement(data);
}
