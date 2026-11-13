'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import { X } from 'lucide-react';
import TypeBadge from '@/components/shared/TypeBadge';
import { useDataLocale, useT } from '@/i18n/client';
import { commonMessages } from '@/i18n/messages/common';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeStat, localizeType } from '@/lib/pkmn/i18n/names/misc';
import type { TeamRole } from '@/types/format-rules';
import type { MatchupSpeciesDetail, MatchupSpeciesTypeInfo } from '@/lib/evolution/matchup-types';

interface MatchupPokemonDetailProps {
  detail: MatchupSpeciesDetail | MatchupSpeciesTypeInfo;
  roles: TeamRole[];
  onClose: () => void;
}

function hasBaseStats(
  detail: MatchupSpeciesDetail | MatchupSpeciesTypeInfo,
): detail is MatchupSpeciesDetail {
  return 'baseStats' in detail && detail.baseStats != null;
}

export default function MatchupPokemonDetail({
  detail,
  roles,
  onClose,
}: MatchupPokemonDetailProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const tLegacy = useT(draftLegacyMessages);
  const tCommon = useT(commonMessages);
  const dataLocale = useDataLocale();
  const typeList = (list: string[]) => list.map((type) => localizeType(type, dataLocale));
  const baseStats = hasBaseStats(detail) ? detail.baseStats : undefined;
  const abilities = hasBaseStats(detail) ? detail.abilities : undefined;

  return (
    <div className="rounded-lg border border-[rgb(21_94_117/0.4)] bg-[rgb(8_51_68/0.1)] p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <PokemonSprite name={detail.species} size={48} />
          <div>
            <h3 className="font-semibold">{localizeSpecies(detail.species, dataLocale)}</h3>
            <div className="mt-1 flex gap-1">
              {detail.types.map((t) => (
                <TypeBadge key={t} type={t} />
              ))}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-fg-muted hover:text-fg"
          aria-label={tCommon('actions.close')}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      {baseStats && (
        <div className="mb-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
          {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map((stat) => (
            <div key={stat} className="rounded bg-elevated px-2 py-1 text-center">
              <span className="text-fg-muted">{localizeStat(stat, dataLocale, 'short')}</span>
              <p className="font-mono font-medium">{baseStats[stat]}</p>
            </div>
          ))}
        </div>
      )}

      {abilities && abilities.length > 0 && (
        <p className="mb-2 text-xs text-fg-muted">
          {t('detail.abilities', { list: abilities.map((a) => localizeAbility(a, dataLocale)).join(', ') })}
        </p>
      )}

      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <TypeList label={t('detail.weakTo')} items={typeList(detail.weaknesses)} className="text-loss" />
        <TypeList label={t('detail.resists')} items={typeList(detail.resistances)} className="text-accent-ink" />
        <TypeList label={t('detail.immune')} items={typeList(detail.immunities)} className="text-fg-muted" />
      </div>

      {roles.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-fg-muted">{t('detail.teamRoles')}</h4>
          <ul className="mt-1 space-y-0.5 text-xs">
            {roles.map((r) => (
              <li key={r.id}>
                {tLegacy(`teamRole.${r.category}`)}: {localizeMove(r.move_name, dataLocale)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TypeList({ label, items, className }: { label: string; items: string[]; className: string }) {
  return (
    <div>
      <span className="text-fg-muted">{label}</span>
      <p className={className}>{items.length > 0 ? items.join(', ') : '—'}</p>
    </div>
  );
}
