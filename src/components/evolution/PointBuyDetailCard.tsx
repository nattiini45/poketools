'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import { useDataLocale, useLocale, useT } from '@/i18n/client';
import { leagueProse } from '@/i18n/content/prose';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { specialRulesTextFor } from '@/lib/draft/special-rules-text';
import type { PointBuyListEntry } from '@/types/point-buy';
import { type PriceGroup } from '@/types/point-buy';
import type { TeamRole } from '@/types/format-rules';
import {
  PRICE_GROUP_RANGES,
  stagesForEntry,
  type StageDisplay,
} from '@/lib/evolution/point-buy-display';

const PRICE_GROUP_COLORS: Record<PriceGroup, string> = {
  premium: 'bg-red-900/30 text-red-400',
  hoch: 'bg-orange-900/30 text-orange-400',
  mittel: 'bg-blue-900/30 text-blue-400',
  guenstig: 'bg-green-900/30 text-green-400',
  budget: 'bg-gray-800/30 text-gray-400',
};

interface PointBuyDetailCardProps {
  entry: PointBuyListEntry;
  typesBySpecies: Record<string, string[]>;
  rolesBySpecies: Record<string, TeamRole[]>;
  bannedMoves: string[];
  onClose: () => void;
  /** When true, render inline (desktop hover/pinned) instead of modal shell */
  inline?: boolean;
}

export default function PointBuyDetailCard({
  entry,
  typesBySpecies,
  rolesBySpecies,
  bannedMoves,
  onClose,
  inline = false,
}: PointBuyDetailCardProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const tLegacy = useT(draftLegacyMessages);
  const tGlossary = useT(glossaryMessages);
  const tEnums = useT(enumMessages);
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const bannedSet = new Set(bannedMoves.map((m) => m.toLowerCase()));
  const stages = stagesForEntry(entry, typesBySpecies, rolesBySpecies, bannedSet);
  const species = (name: string) => localizeSpecies(name, dataLocale);
  const baseLabel = species(entry.base_pokemon);
  const [minPrice, maxPrice] = PRICE_GROUP_RANGES[entry.price_group];

  // German workbook prose: shown verbatim with lang="de" (i18n-core §5.4).
  const rationale = leagueProse(entry.rationale);
  const history = leagueProse(entry.historical_data);
  const specialText = specialRulesTextFor(entry, locale);
  // Thresholds come from the entry (league overrides already applied), never from literals.
  const stage2Threshold = entry.kills_to_stage2;
  const stage3Threshold = entry.additional_kills_to_stage3 ?? 0;
  const finalStage = entry.stage3_pokemon ?? entry.stage2_pokemon;

  const shellClass = inline
    ? 'w-full max-w-md rounded-xl border border-poke-border bg-poke-surface p-4 shadow-xl'
    : 'max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-poke-border bg-poke-surface p-6 sm:rounded-xl';

  return (
    <div className={shellClass} role="dialog" aria-label={t('pointBuy.detailsAria', { name: baseLabel })}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{baseLabel}</h2>
          <p className="text-sm text-poke-text-secondary">
            {t('pointBuy.lineNumber', { n: entry.line_number })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-poke-text-secondary hover:bg-poke-elevated"
          aria-label={t('pointBuy.closeDetails')}
        >
          ✕
        </button>
      </div>

      {/* Evolution line with sprites */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {stages.map((stage, i) => (
          <div key={stage.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-poke-text-muted">→</span>}
            <div className="flex flex-col items-center">
              <PokemonSprite name={stage.species} size={40} />
              <span className="mt-0.5 max-w-20 truncate text-center text-[10px] font-medium">
                {species(stage.species)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-poke-elevated p-3">
          <span className="text-xs text-poke-text-secondary">{tGlossary('price.price')}</span>
          <p className="text-lg font-bold">{entry.price}</p>
        </div>
        <div className="rounded-lg bg-poke-elevated p-3">
          <span className="text-xs text-poke-text-secondary">{t('pointBuy.priceGroup')}</span>
          <p className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${PRICE_GROUP_COLORS[entry.price_group]}`}>
            {tLegacy('priceGroupRange', {
              group: enumLabel(tEnums, 'priceGroup', entry.price_group),
              min: minPrice,
              max: maxPrice,
            })}
          </p>
        </div>
        <div className="rounded-lg bg-poke-elevated p-3">
          <span className="text-xs text-poke-text-secondary">{t('pointBuy.killsToStage2')}</span>
          <p className="text-lg font-bold">{entry.kills_to_stage2}</p>
        </div>
        <div className="rounded-lg bg-poke-elevated p-3">
          <span className="text-xs text-poke-text-secondary">{t('pointBuy.additionalToStage3')}</span>
          <p className="text-lg font-bold">{entry.additional_kills_to_stage3 ?? '—'}</p>
          <p className="mt-0.5 text-[10px] text-poke-text-muted">{t('pointBuy.resetsAfterStage2')}</p>
        </div>
      </div>

      {/* Ratings — show null as em dash */}
      <div className="mt-3 flex flex-wrap gap-2">
        <RatingChip label={t('pointBuy.early')} value={entry.early_rating} color="green" />
        <RatingChip label={t('pointBuy.mid')} value={entry.mid_rating} color="blue" />
        <RatingChip label={t('pointBuy.late')} value={entry.late_rating} color="purple" />
      </div>

      {rationale.text && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold text-poke-text-secondary">{t('pointBuy.rationale')}</h3>
          <p lang={rationale.lang} className="mt-1 text-sm text-poke-text">{rationale.text}</p>
        </div>
      )}

      {history.text && (
        <div className="mt-3">
          <h3 className="text-xs font-semibold text-poke-text-secondary">{t('pointBuy.history')}</h3>
          <p lang={history.lang} className="mt-1 text-sm text-poke-text">{history.text}</p>
        </div>
      )}

      {(entry.special_rules || specialText.text) && (
        <div className="mt-3 rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3">
          <h3 className="text-xs font-semibold text-yellow-500">{t('pointBuy.specialRules')}</h3>
          {specialText.text && (
            <p lang={specialText.lang} className="mt-1 text-xs text-poke-text">{specialText.text}</p>
          )}
          {entry.special_rules && (
            <ul className="mt-1 space-y-0.5 text-xs text-poke-text">
              {entry.special_rules.scatterbug && (
                <li>
                  {t('pointBuy.rule.scatterbug', {
                    count: stage2Threshold,
                    more: stage3Threshold,
                    stage2: species(entry.stage2_pokemon),
                    stage3: species(finalStage),
                  })}
                </li>
              )}
              {entry.special_rules.no_cocoon_rule && (
                <li>{t('pointBuy.rule.noCocoon', { base: baseLabel })}</li>
              )}
              {entry.special_rules.cosmog && (
                <li>{t('pointBuy.rule.cosmog', { s2: stage2Threshold, s3: stage3Threshold })}</li>
              )}
              {entry.special_rules.no_redraft && <li>{t('pointBuy.rule.noRedraft')}</li>}
            </ul>
          )}
        </div>
      )}

      {/* Per-stage types, tera, roles */}
      <div className="mt-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-poke-text-secondary">
          {t('pointBuy.stages')}
        </h3>
        {stages.map((stage) => (
          <StageBlock key={stage.key} stage={stage} />
        ))}
      </div>

      {entry.sources && (
        <p className="mt-3 text-[10px] text-poke-text-muted">{t('pointBuy.sources', { sources: entry.sources })}</p>
      )}
      {entry.legacy_tier && (
        <p className="text-[10px] text-poke-text-muted">{t('pointBuy.legacyTier', { tier: entry.legacy_tier })}</p>
      )}
    </div>
  );
}

function RatingChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color: 'green' | 'blue' | 'purple';
}) {
  const colors = {
    green: 'bg-green-900/30 text-green-400',
    blue: 'bg-blue-900/30 text-blue-400',
    purple: 'bg-purple-900/30 text-purple-400',
  };
  return (
    <span className={`rounded px-2 py-1 text-xs ${colors[color]}`}>
      {label}: {value ?? '—'}
    </span>
  );
}

function StageBlock({ stage }: { stage: StageDisplay }) {
  const t = useT(draftLegacyEvolutionMessages);
  const tLegacy = useT(draftLegacyMessages);
  const dataLocale = useDataLocale();
  return (
    <div className="rounded-lg bg-poke-elevated p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {tLegacy('stage', { n: stage.stageNumber })}: {localizeSpecies(stage.species, dataLocale)}
        </span>
        <span className="text-[10px] text-poke-text-secondary">{tLegacy(`tera.${stage.teraRule}`)}</span>
      </div>
      {stage.types.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {stage.types.map((type) => (
            <TypeBadge key={type} type={type} />
          ))}
        </div>
      )}
      {stage.roles.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[10px] text-poke-text-secondary">
          {stage.roles.map((r) => (
            <li key={r.id}>
              {tLegacy(`teamRole.${r.category}`)}: {localizeMove(r.move_name, dataLocale)}
            </li>
          ))}
        </ul>
      )}
      {stage.roles.length === 0 && (
        <p className="mt-1 text-[10px] text-poke-text-muted">{t('pointBuy.noRoles')}</p>
      )}
    </div>
  );
}
