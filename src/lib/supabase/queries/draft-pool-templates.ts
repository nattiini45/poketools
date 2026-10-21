import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type { DraftPoolTemplate, DraftPoolTemplateFormData, PoolMode } from '@/types/draft-pool';

type TemplateRow = Tables<'draft_pool_templates'>;

function toTemplate(row: TemplateRow): DraftPoolTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_by: row.created_by,
    pool_mode: row.pool_mode as PoolMode,
    entries: (row.entries ?? []) as unknown as DraftPoolTemplate['entries'],
    created_at: row.created_at,
  };
}

/** List all templates, newest first. */
export async function listTemplates(): Promise<DraftPoolTemplate[]> {
  const { data, error } = await supabase
    .from('draft_pool_templates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map(toTemplate);
}

/** Get a single template by ID. */
export async function getTemplate(id: string): Promise<DraftPoolTemplate | null> {
  const { data, error } = await supabase
    .from('draft_pool_templates')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toTemplate(data) : null;
}

/** Create a new template. */
export async function createTemplate(
  input: DraftPoolTemplateFormData,
  createdBy?: string
): Promise<DraftPoolTemplate> {
  const insert: TablesInsert<'draft_pool_templates'> = {
    name: input.name,
    description: input.description ?? null,
    pool_mode: input.pool_mode,
    entries: JSON.parse(JSON.stringify(input.entries)),
    created_by: createdBy ?? null,
  };

  const { data, error } = await supabase
    .from('draft_pool_templates')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return toTemplate(data);
}

/** Delete a template. */
export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('draft_pool_templates')
    .delete()
    .eq('id', id);

  if (error) throw error;
}
