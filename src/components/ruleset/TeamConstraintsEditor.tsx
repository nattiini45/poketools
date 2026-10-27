'use client';

import type { TeamConstraints, TierKey } from '@/types/ruleset';
import { POKEMON_TYPES } from '@/types/season';
import { formatPack } from '@/lib/format-pack';
import { useDataLocale, useT } from '@/i18n/client';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { isEmptyTeamConstraints } from '@/lib/pkmn/team-constraints';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

/** A newly enabled type quota starts from the format pack's Core Liga default. */
const QUOTA_DEFAULT = formatPack.coreLiga.typeQuotaDefault;

interface TeamConstraintsEditorProps {
  value: TeamConstraints | null;
  onChange: (value: TeamConstraints | null) => void;
}

const TIER_OPTIONS: TierKey[] = [
  'ZU', 'PU', 'PUBL', 'NU', 'NUBL', 'RU', 'RUBL',
  'UU', 'UUBL', 'OU', 'Uber', 'AG',
];

/**
 * The Team constraints section of the Ruleset Studio editor. Lets admins compose the optional team
 * constraints block on a ruleset: type quotas, tera match, evolution stage,
 * and Eviolite tier cap. Renders nothing structured when `value` is null —
 * the master toggle at the top creates an empty constraints object so the
 * inner controls can mutate it.
 */
export default function TeamConstraintsEditor({ value, onChange }: TeamConstraintsEditorProps) {
  const t = useT(rulesetMessages);
  const dl = useDataLocale();
  // Pokémon-data names in the copy come from the pkmn layer (stored values stay English).
  const eviolite = localizeItem('Eviolite', dl);
  const enabled = value !== null;

  const update = (patch: Partial<TeamConstraints>) => {
    if (!enabled) return;
    onChange({ ...(value ?? {}), ...patch });
  };

  return (
    <div className="space-y-6">
      <label className="flex items-start gap-3 p-3 border border-poke-border rounded-poke-md">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? {} : null)}
          className="mt-1 accent-poke-accent"
        />
        <div>
          <div className="text-sm font-heading font-semibold text-poke-text-primary">
            {t('constraints.enable')}
          </div>
          <p className="text-xs text-poke-text-muted">
            {t('constraints.enableHint', { item: eviolite })}
          </p>
        </div>
      </label>

      {enabled && isEmptyTeamConstraints(value) && (
        <p className="text-xs text-poke-text-muted">{t('constraints.emptyHint')}</p>
      )}

      {enabled && value && (
        <>
          {/* ── Type quotas ─────────────────────────────────────────── */}
          <fieldset className="border border-poke-border rounded-poke-md p-3 space-y-3">
            <legend className="px-1 text-sm font-heading font-semibold text-poke-text-primary">
              {t('constraints.typeQuotas')}
            </legend>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!value.type_quotas}
                onChange={(e) =>
                  update({
                    type_quotas: e.target.checked
                      ? {
                          source: QUOTA_DEFAULT.source,
                          min_per_type: QUOTA_DEFAULT.min,
                          allow_multi_count: QUOTA_DEFAULT.multiCount,
                        }
                      : undefined,
                  })
                }
                className="accent-poke-accent"
              />
              <span className="text-sm text-poke-text-primary">{t('constraints.requirePerType')}</span>
            </label>

            {value.type_quotas && (
              <div className="ml-6 space-y-2">
                <div className="flex items-center gap-3">
                  <label className="text-sm text-poke-text-secondary w-32">{t('constraints.typeSource')}</label>
                  <select
                    value={value.type_quotas.source}
                    onChange={(e) =>
                      update({
                        type_quotas: {
                          ...value.type_quotas!,
                          source: e.target.value as 'player_core' | 'fixed',
                        },
                      })
                    }
                    className="border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1 text-sm text-poke-text-primary"
                  >
                    <option value="player_core">{t('constraints.source.player_core')}</option>
                    <option value="fixed">{t('constraints.source.fixed')}</option>
                  </select>
                </div>

                {value.type_quotas.source === 'fixed' && (
                  <div>
                    <label className="text-sm text-poke-text-secondary">{t('constraints.fixedTypes')}</label>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {POKEMON_TYPES.map((type) => {
                        const list = value.type_quotas?.fixed_types ?? [];
                        const on = list.includes(type);
                        return (
                          <button
                            type="button"
                            key={type}
                            aria-pressed={on}
                            onClick={() =>
                              update({
                                type_quotas: {
                                  ...value.type_quotas!,
                                  fixed_types: on ? list.filter((x) => x !== type) : [...list, type],
                                },
                              })
                            }
                            className={`px-2 py-0.5 rounded-poke-md text-xs font-heading font-semibold ${
                              on
                                ? 'bg-poke-accent text-poke-surface'
                                : 'bg-poke-muted text-poke-text-muted hover:bg-poke-elevated'
                            }`}
                          >
                            {localizeType(type, dl)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <label className="text-sm text-poke-text-secondary w-32">{t('constraints.minPerType')}</label>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={value.type_quotas.min_per_type}
                    onChange={(e) =>
                      update({
                        type_quotas: {
                          ...value.type_quotas!,
                          min_per_type: Math.max(0, Math.min(6, Number(e.target.value) || 0)),
                        },
                      })
                    }
                    className="w-20 border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1 text-sm text-poke-text-primary"
                  />
                </div>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value.type_quotas.allow_multi_count}
                    onChange={(e) =>
                      update({
                        type_quotas: {
                          ...value.type_quotas!,
                          allow_multi_count: e.target.checked,
                        },
                      })
                    }
                    className="accent-poke-accent"
                  />
                  <span className="text-sm text-poke-text-primary">
                    {t('constraints.multiCount', {
                      pokemon: localizeSpecies('Volcanion', dl),
                      type1: localizeType('Fire', dl),
                      type2: localizeType('Water', dl),
                    })}
                  </span>
                </label>
              </div>
            )}
          </fieldset>

          {/* ── Tera match ──────────────────────────────────────────── */}
          <fieldset className="border border-poke-border rounded-poke-md p-3 space-y-2">
            <legend className="px-1 text-sm font-heading font-semibold text-poke-text-primary">
              {t('constraints.teraRestriction')}
            </legend>
            <select
              value={value.tera_match ?? 'none'}
              onChange={(e) =>
                update({
                  tera_match: e.target.value as TeamConstraints['tera_match'],
                })
              }
              className="border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1 text-sm text-poke-text-primary"
            >
              <option value="none">{t('constraints.teraMatch.none')}</option>
              <option value="player_core">{t('constraints.teraMatch.player_core')}</option>
              <option value="team_types">{t('constraints.teraMatch.team_types')}</option>
            </select>
          </fieldset>

          {/* ── Evolution stage ─────────────────────────────────────── */}
          <fieldset className="border border-poke-border rounded-poke-md p-3 space-y-2">
            <legend className="px-1 text-sm font-heading font-semibold text-poke-text-primary">
              {t('constraints.evolutionStage')}
            </legend>

            <div className="flex items-center gap-3">
              <label className="text-sm text-poke-text-secondary w-32">{t('constraints.mode')}</label>
              <select
                value={value.evolution_stage?.mode ?? 'unrestricted'}
                onChange={(e) =>
                  update({
                    evolution_stage: {
                      ...(value.evolution_stage ?? {}),
                      mode: e.target.value as 'unrestricted' | 'nfe_only_plus_n_fe',
                    },
                  })
                }
                className="border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1 text-sm text-poke-text-primary"
              >
                <option value="unrestricted">{t('constraints.modes.unrestricted')}</option>
                <option value="nfe_only_plus_n_fe">{t('constraints.modes.nfe_only_plus_n_fe')}</option>
              </select>
            </div>

            {value.evolution_stage?.mode === 'nfe_only_plus_n_fe' && (
              <>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-poke-text-secondary w-32">{t('constraints.feCap')}</label>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={value.evolution_stage.fully_evolved_cap ?? 0}
                    onChange={(e) =>
                      update({
                        evolution_stage: {
                          ...(value.evolution_stage ?? { mode: 'nfe_only_plus_n_fe' }),
                          mode: 'nfe_only_plus_n_fe',
                          fully_evolved_cap: Math.max(0, Math.min(6, Number(e.target.value) || 0)),
                        },
                      })
                    }
                    className="w-20 border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1 text-sm text-poke-text-primary"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-poke-text-secondary w-32">{t('constraints.feTierMax')}</label>
                  <select
                    value={value.evolution_stage.fully_evolved_tier_max ?? ''}
                    onChange={(e) =>
                      update({
                        evolution_stage: {
                          ...(value.evolution_stage ?? { mode: 'nfe_only_plus_n_fe' }),
                          mode: 'nfe_only_plus_n_fe',
                          fully_evolved_tier_max: (e.target.value || undefined) as TierKey | undefined,
                        },
                      })
                    }
                    className="border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1 text-sm text-poke-text-primary"
                  >
                    <option value="">{t('constraints.noCap')}</option>
                    {TIER_OPTIONS.map((tier) => (
                      <option key={tier} value={tier}>{tier}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={value.evolution_stage?.legendaries_allowed ?? true}
                onChange={(e) =>
                  update({
                    evolution_stage: {
                      ...(value.evolution_stage ?? { mode: 'unrestricted' }),
                      mode: value.evolution_stage?.mode ?? 'unrestricted',
                      legendaries_allowed: e.target.checked,
                    },
                  })
                }
                className="accent-poke-accent"
              />
              <span className="text-sm text-poke-text-primary">{t('constraints.legendariesAllowed')}</span>
            </label>
          </fieldset>

          {/* ── Eviolite cap ────────────────────────────────────────── */}
          <fieldset className="border border-poke-border rounded-poke-md p-3 space-y-2">
            <legend className="px-1 text-sm font-heading font-semibold text-poke-text-primary">
              {t('constraints.evioliteCap', { item: eviolite })}
            </legend>
            <p className="text-xs text-poke-text-muted">
              {t('constraints.evioliteHint', { item: eviolite })}
            </p>
            <select
              value={value.eviolite_tier_cap ?? ''}
              onChange={(e) =>
                update({ eviolite_tier_cap: (e.target.value || undefined) as TierKey | undefined })
              }
              className="border border-poke-border bg-poke-surface rounded-poke-md px-2 py-1 text-sm text-poke-text-primary"
            >
              <option value="">{t('constraints.noCap')}</option>
              {TIER_OPTIONS.map((tier) => (
                <option key={tier} value={tier}>{tier}</option>
              ))}
            </select>
          </fieldset>
        </>
      )}
    </div>
  );
}
