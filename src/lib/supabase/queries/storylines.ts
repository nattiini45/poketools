import { supabase } from '../client';
import type { Storyline, StorylineInsert, StorylineUpdate } from '@/types/storyline';

type StorylineCreate = StorylineInsert & { created_by: string };

/** A league's storylines, featured first, then the most recently updated. */
export async function listStorylinesBySeason(seasonId: string): Promise<Storyline[]> {
  const { data, error } = await supabase
    .from('season_storylines')
    .select('*')
    .eq('season_id', seasonId)
    .order('featured', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data as Storyline[];
}

export async function getStorylineById(id: string): Promise<Storyline | null> {
  const { data, error } = await supabase.from('season_storylines').select('*').eq('id', id).maybeSingle();

  if (error) throw error;
  return data as Storyline | null;
}

export async function createStoryline(input: StorylineCreate): Promise<Storyline> {
  const { data, error } = await supabase
    .from('season_storylines')
    .insert({
      season_id: input.season_id,
      title: input.title,
      body: input.body,
      tags: input.tags ?? [],
      featured: input.featured ?? false,
      created_by: input.created_by,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Storyline;
}

/** Update the given fields and stamp `updated_at`; throws when the storyline does not exist (`.single()`). */
export async function updateStoryline(id: string, fields: StorylineUpdate): Promise<Storyline> {
  const { data, error } = await supabase
    .from('season_storylines')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Storyline;
}

export async function deleteStoryline(id: string): Promise<void> {
  const { error } = await supabase.from('season_storylines').delete().eq('id', id);
  if (error) throw error;
}
