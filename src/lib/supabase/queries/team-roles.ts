import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type { TeamRole, TeamRoleCategory } from '@/types/format-rules';

type TeamRoleRow = Tables<'team_roles'>;

function toRole(row: TeamRoleRow): TeamRole {
  return {
    id: row.id,
    species_form: row.species_form,
    stage: row.stage,
    category: row.category as TeamRoleCategory,
    move_name: row.move_name,
    source: row.source,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

/** Get all active roles for a specific species/form. */
export async function getRolesForSpecies(speciesForm: string): Promise<TeamRole[]> {
  const { data, error } = await supabase
    .from('team_roles')
    .select('*')
    .eq('species_form', speciesForm)
    .eq('is_active', true)
    .order('category');

  if (error) throw error;
  return data.map(toRole);
}

/** Get all active roles for multiple species/forms at once. */
export async function getRolesForSpeciesBatch(speciesForms: string[]): Promise<TeamRole[]> {
  if (speciesForms.length === 0) return [];

  const { data, error } = await supabase
    .from('team_roles')
    .select('*')
    .in('species_form', speciesForms)
    .eq('is_active', true)
    .order('category');

  if (error) throw error;
  return data.map(toRole);
}

/** Get all roles in a specific category. */
export async function getRolesByCategory(category: TeamRoleCategory): Promise<TeamRole[]> {
  const { data, error } = await supabase
    .from('team_roles')
    .select('*')
    .eq('category', category)
    .eq('is_active', true)
    .order('species_form');

  if (error) throw error;
  return data.map(toRole);
}

/** Get all active team roles. */
export async function getActiveRoles(): Promise<TeamRole[]> {
  const { data, error } = await supabase
    .from('team_roles')
    .select('*')
    .eq('is_active', true)
    .order('species_form');

  if (error) throw error;
  return data.map(toRole);
}

/** Bulk create/upsert team roles (used by import). */
export async function bulkCreateRoles(
  entries: {
    species_form: string;
    stage?: number | null;
    category: TeamRoleCategory;
    move_name: string;
    source?: string | null;
  }[]
): Promise<number> {
  if (entries.length === 0) return 0;

  const rows: TablesInsert<'team_roles'>[] = entries.map((e) => ({
    species_form: e.species_form,
    stage: e.stage ?? null,
    category: e.category,
    move_name: e.move_name,
    source: e.source ?? null,
  }));

  const { error } = await supabase
    .from('team_roles')
    .upsert(rows, { onConflict: 'species_form,category,move_name' });

  if (error) throw error;
  return entries.length;
}
