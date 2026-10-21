-- 3D Trainer Avatar configuration storage
-- Stores per-player trainer appearance for the 3D draft room.

create table if not exists public.trainer_avatars_3d (
  player_id uuid primary key references public.players(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.trainer_avatars_3d is 'Stores 3D trainer avatar customization for the draft room';
comment on column public.trainer_avatars_3d.config is 'TrainerConfig JSON: skinTone, hairStyle, hairColor, outfitColor, pantsColor, hatStyle, hatColor, teamColor';

-- Enable RLS (defense-in-depth; auth lives in API routes)
alter table public.trainer_avatars_3d enable row level security;
