-- Target storage buckets for PokeTools.
-- Public buckets serve objects by direct URL; avoid broad storage.objects SELECT
-- policies that allow bucket listing (see Supabase lint 0025).
-- Run on the new Professional project after public schema baseline is applied.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('avatars', 'avatars', true, 5242880),
  ('social-images', 'social-images', true, 5242880)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;
