'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import {
  OVERLAY_CATEGORIES,
  OVERLAY_TYPES,
  OVERLAY_DEFAULTS,
  THEME_OPTIONS,
  ANIMATION_OPTIONS,
  BRAND_POSITION_OPTIONS,
  buildOverlayUrl,
  type OverlayTypeKey,
} from '@/lib/broadcast/url-builder';
import type { OverlayConfig, BroadcastPresetConfig } from '@/types/broadcast';
import type { PublicMatch } from '@/lib/match/public-match';
import type { SeasonWithDetails } from '@/types/season';
import type { DraftPoolWithDetails } from '@/types/draft';
import type { TournamentWithDetails } from '@/types/tournament';
import type { Round } from '@/types/round';
import type { ApiResult } from '@/types/api';
import { useLocale, useT } from '@/i18n/client';
import { LOCALES, isLocale, type Locale } from '@/i18n/config';
import { creatorContentMessages } from '@/i18n/messages/creator/content';
import { draftPoolFormatText } from '@/i18n/content/draft-pool-format';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { translateEngineLabel } from '@/i18n/content/engine-labels';

interface OverlayUrlBuilderProps {
  matches: PublicMatch[];
  seasons: SeasonWithDetails[];
  draftPools: DraftPoolWithDetails[];
  onSavePreset?: (name: string, typeKey: OverlayTypeKey, config: BroadcastPresetConfig) => void;
  savingPreset?: boolean;
  /** Pre-fill the overlay type when loading a preset. */
  initialType?: OverlayTypeKey;
  /** Pre-fill config values when loading a preset. */
  initialConfig?: BroadcastPresetConfig;
}

export default function OverlayUrlBuilder({
  matches,
  seasons,
  draftPools,
  onSavePreset,
  savingPreset,
  initialType,
  initialConfig,
}: OverlayUrlBuilderProps) {
  const t = useT(creatorContentMessages);
  const tBoard = useT(draftLegacyBoardMessages);
  const uiLocale = useLocale();
  const [selectedType, setSelectedType] = useState<OverlayTypeKey | ''>(initialType ?? '');
  const [entityId, setEntityId] = useState('');
  const [config, setConfig] = useState<Partial<OverlayConfig>>(initialConfig ?? {});
  const [extras, setExtras] = useState<Record<string, string>>(() => {
    if (initialConfig?.extra) {
      const stringExtras: Record<string, string> = {};
      for (const [k, v] of Object.entries(initialConfig.extra)) {
        if (k === 'lang') continue; // kept in its own state below
        stringExtras[k] = String(v);
      }
      return stringExtras;
    }
    return {};
  });
  // The overlay's language. Overlays never read the viewer's cookie
  // (i18n-core §6.5), so every generated URL carries `lang`: a loaded
  // preset's language, else the creator's current UI language.
  const [lang, setLang] = useState<Locale>(() => {
    // A top-level `lang` (overlay config shape) wins over the preset's legacy `extra.lang`.
    const topLevel = (initialConfig as Record<string, unknown> | undefined)?.lang;
    if (isLocale(topLevel)) return topLevel;
    const saved = initialConfig?.extra?.lang;
    return isLocale(saved) ? saved : uiLocale;
  });
  const [copied, setCopied] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [showSavePreset, setShowSavePreset] = useState(false);

  // Recap-specific cascading state
  const [recapTournaments, setRecapTournaments] = useState<TournamentWithDetails[]>([]);
  const [recapRounds, setRecapRounds] = useState<Round[]>([]);
  const [recapLoadingTournaments, setRecapLoadingTournaments] = useState(false);
  const [recapLoadingRounds, setRecapLoadingRounds] = useState(false);
  const recapTournamentFetchRef = useRef(0);
  const recapRoundFetchRef = useRef(0);

  const typeDef = selectedType ? OVERLAY_TYPES[selectedType] : null;

  // Fetch child tournaments when a season entity is selected for recap type
  useEffect(() => {
    if ((selectedType !== 'recap' && selectedType !== 'usage_chart') || !entityId) return;

    const fetchId = ++recapTournamentFetchRef.current;

    fetch(`/api/tournaments?season_id=${entityId}`)
      .then((res) => res.json())
      .then((json: ApiResult<TournamentWithDetails[]>) => {
        if (fetchId === recapTournamentFetchRef.current && json.success) {
          setRecapTournaments(json.data);
        }
      })
      .catch(() => {
        if (fetchId === recapTournamentFetchRef.current) setRecapTournaments([]);
      })
      .finally(() => {
        if (fetchId === recapTournamentFetchRef.current) setRecapLoadingTournaments(false);
      });
  }, [selectedType, entityId]);

  // Fetch rounds when a recap tournament is selected
  useEffect(() => {
    const tid = extras.tournament_id;
    if ((selectedType !== 'recap' && selectedType !== 'usage_chart') || !tid) return;

    const fetchId = ++recapRoundFetchRef.current;

    void fetch(`/api/tournaments/${tid}/rounds`)
      .then((res) => res.json())
      .then((json: ApiResult<Round[]>) => {
        if (fetchId === recapRoundFetchRef.current && json.success) {
          setRecapRounds(json.data);
        }
      })
      .catch(() => {
        if (fetchId === recapRoundFetchRef.current) setRecapRounds([]);
      })
      .finally(() => {
        if (fetchId === recapRoundFetchRef.current) setRecapLoadingRounds(false);
      });
  }, [selectedType, extras.tournament_id]);

  // Build entity options based on overlay type
  const entityOptions = useMemo(() => {
    if (!typeDef) return [];
    switch (typeDef.entityType) {
      case 'match':
        return matches.map((m) => ({
          value: m.id,
          label: t('common.matchup', { player1: m.player_1_name, player2: m.player_2_name }),
        }));
      case 'season':
        return seasons.map((s) => ({
          value: s.id,
          label: s.name,
        }));
      case 'draft':
        return draftPools.map((d) => ({
          value: d.id,
          label: t('builder.draftPoolOption', {
            season: d.season_name,
            draftType: draftPoolFormatText(tBoard, d),
          }),
        }));
      case 'player':
        // For player spotlight, we use a text input instead
        return [];
      default:
        return [];
    }
  }, [typeDef, matches, seasons, draftPools, t, tBoard]);

  // Compute the generated URL (always with the overlay language). The entity
  // ID is a path segment and the player type takes it as free text, so encode
  // it: a typed "/", "?" or "#" must not reshape the overlay path.
  const generatedUrl = useMemo(() => {
    if (!selectedType || !entityId) return '';
    return buildOverlayUrl(selectedType, encodeURIComponent(entityId), config, { ...extras, lang });
  }, [selectedType, entityId, config, extras, lang]);

  const handleCopy = useCallback(async () => {
    if (!generatedUrl) return;
    const fullUrl = `${window.location.origin}${generatedUrl}`;
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedUrl]);

  const handleSavePreset = useCallback(() => {
    if (!onSavePreset || !selectedType || !presetName.trim()) return;
    const presetConfig: BroadcastPresetConfig = {
      theme: config.theme,
      accent: config.accent,
      accent2: config.accent2,
      anim: config.anim,
      poll: config.poll,
      w: config.w,
      h: config.h,
      brand: config.brand,
      brandpos: config.brandpos,
      extra: { ...extras, lang },
    };
    onSavePreset(presetName.trim(), selectedType, presetConfig);
    setPresetName('');
    setShowSavePreset(false);
  }, [onSavePreset, selectedType, presetName, config, extras, lang]);

  const updateConfig = <K extends keyof OverlayConfig>(key: K, value: OverlayConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateExtra = (key: string, value: string) => {
    setExtras((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Card>
      <h3 className="text-lg font-heading font-bold text-poke-text-primary mb-4">
        {t('builder.title')}
      </h3>

      <div className="space-y-4">
        {/* Step 1: Select Overlay Type */}
        <Select
          label={t('builder.overlayType')}
          value={selectedType}
          onChange={(e) => {
            setSelectedType(e.target.value as OverlayTypeKey | '');
            setEntityId('');
            setExtras({});
            setRecapTournaments([]);
            setRecapRounds([]);
          }}
        >
          <option value="">{t('builder.selectOverlayType')}</option>
          {OVERLAY_CATEGORIES.map((cat) => (
            <optgroup key={cat.category} label={t(`overlayCategory.${cat.category}`)}>
              {cat.types.map((type) => (
                <option key={type.key} value={type.key}>
                  {t(`overlayType.${type.key}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>

        {/* Step 2: Select Entity */}
        {typeDef && typeDef.entityType !== 'player' && (
          <Select
            label={
              typeDef.entityType === 'match'
                ? t('common.match')
                : typeDef.entityType === 'season'
                  ? t('builder.leagueSeason')
                  : t('builder.draftPool')
            }
            value={entityId}
            onChange={(e) => {
              setEntityId(e.target.value);
              if (selectedType === 'recap' || selectedType === 'usage_chart') {
                setRecapTournaments([]);
                setRecapRounds([]);
                if (e.target.value) setRecapLoadingTournaments(true);
                setExtras((prev) => {
                  const next: Record<string, string> = { ...prev };
                  delete next.tournament_id;
                  delete next.round_id;
                  return next;
                });
              }
            }}
          >
            <option value="">
              {t(`builder.selectEntity.${typeDef.entityType}`)}
            </option>
            {entityOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        )}

        {typeDef && typeDef.entityType === 'player' && (
          <Input
            label={t('builder.playerId')}
            placeholder={t('builder.playerIdPlaceholder')}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          />
        )}

        {/* Step 3: Configure Overlay */}
        {typeDef && entityId && (
          <div className="border-t border-poke-border pt-4 space-y-4">
            <h4 className="text-sm font-heading font-semibold text-poke-text-secondary uppercase tracking-wider">
              {t('builder.configuration')}
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label={t('common.theme')}
                value={config.theme ?? OVERLAY_DEFAULTS.theme}
                options={THEME_OPTIONS.map((o) => ({ value: o.value, label: t(`theme.${o.value}`) }))}
                onChange={(e) => updateConfig('theme', e.target.value as OverlayConfig['theme'])}
              />
              <Select
                label={t('builder.animation')}
                value={config.anim ?? OVERLAY_DEFAULTS.anim}
                options={ANIMATION_OPTIONS.map((o) => ({ value: o.value, label: t(`animation.${o.value}`) }))}
                onChange={(e) => updateConfig('anim', e.target.value as OverlayConfig['anim'])}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-heading font-semibold text-poke-text-primary">
                  {t('builder.accentColor')}
                </label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-poke-md border border-poke-border shrink-0"
                    style={{ backgroundColor: config.accent ?? OVERLAY_DEFAULTS.accent }}
                  />
                  <input
                    type="text"
                    value={config.accent ?? OVERLAY_DEFAULTS.accent}
                    onChange={(e) => updateConfig('accent', e.target.value)}
                    placeholder="#EF4444"
                    className="w-full px-3 py-2 bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md focus:outline-none focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-heading font-semibold text-poke-text-primary">
                  {t('builder.accentColor2')}
                </label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-poke-md border border-poke-border shrink-0"
                    style={{ backgroundColor: config.accent2 ?? OVERLAY_DEFAULTS.accent2 }}
                  />
                  <input
                    type="text"
                    value={config.accent2 ?? OVERLAY_DEFAULTS.accent2}
                    onChange={(e) => updateConfig('accent2', e.target.value)}
                    placeholder="#3B82F6"
                    className="w-full px-3 py-2 bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md focus:outline-none focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label={t('builder.pollInterval')}
                type="number"
                min={1000}
                max={60000}
                step={1000}
                value={config.poll ?? OVERLAY_DEFAULTS.poll}
                onChange={(e) => updateConfig('poll', Number(e.target.value))}
              />
              <Input
                label={t('builder.width')}
                type="number"
                min={320}
                max={3840}
                value={config.w ?? OVERLAY_DEFAULTS.w}
                onChange={(e) => updateConfig('w', Number(e.target.value))}
              />
              <Input
                label={t('builder.height')}
                type="number"
                min={180}
                max={2160}
                value={config.h ?? OVERLAY_DEFAULTS.h}
                onChange={(e) => updateConfig('h', Number(e.target.value))}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t('builder.brand')}
                value={config.brand ?? ''}
                onChange={(e) => updateConfig('brand', e.target.value)}
                placeholder={t('builder.brandPlaceholder')}
              />
              <Select
                label={t('builder.brandPosition')}
                value={config.brandpos ?? OVERLAY_DEFAULTS.brandpos}
                options={BRAND_POSITION_OPTIONS.map((o) => ({ value: o.value, label: t(`brandPosition.${o.value}`) }))}
                onChange={(e) =>
                  updateConfig('brandpos', e.target.value as OverlayConfig['brandpos'])
                }
              />
            </div>

            <div className="space-y-1.5">
              <Select
                label={t('builder.overlayLanguage')}
                value={lang}
                options={LOCALES.map((l) => ({ value: l, label: t(`languageName.${l}`) }))}
                onChange={(e) => {
                  if (isLocale(e.target.value)) setLang(e.target.value);
                }}
              />
              <p className="text-xs text-poke-text-secondary">{t('builder.overlayLanguageHint')}</p>
            </div>

            {/* Recap / Usage Chart: Tournament + Round selectors */}
            {(selectedType === 'recap' || selectedType === 'usage_chart') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label={t('common.tournament')}
                  value={extras.tournament_id ?? ''}
                  onChange={(e) => {
                    setRecapRounds([]);
                    if (e.target.value) setRecapLoadingRounds(true);
                    setExtras((prev) => {
                      const next: Record<string, string> = { ...prev, tournament_id: e.target.value };
                      delete next.round_id;
                      return next;
                    });
                  }}
                  disabled={recapLoadingTournaments}
                >
                  <option value="">
                    {recapLoadingTournaments
                      ? t('common.loading')
                      : recapTournaments.length === 0
                        ? t('common.noTournaments')
                        : t('common.selectTournament')}
                  </option>
                  {recapTournaments.map((tournament) => (
                    <option key={tournament.id} value={tournament.id}>
                      {tournament.name}
                    </option>
                  ))}
                </Select>
                <Select
                  label={t('common.round')}
                  value={extras.round_id ?? ''}
                  onChange={(e) => updateExtra('round_id', e.target.value)}
                  disabled={!extras.tournament_id || recapLoadingRounds}
                >
                  <option value="">
                    {recapLoadingRounds
                      ? t('common.loading')
                      : !extras.tournament_id
                        ? t('common.selectTournamentFirst')
                        : recapRounds.length === 0
                          ? t('common.noRounds')
                          : t('common.selectRound')}
                  </option>
                  {recapRounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      {translateEngineLabel('round', r.name, uiLocale)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Output */}
        {generatedUrl && (
          <div className="border-t border-poke-border pt-4 space-y-3">
            <h4 className="text-sm font-heading font-semibold text-poke-text-secondary uppercase tracking-wider">
              {t('builder.generatedUrl')}
            </h4>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}${generatedUrl}`}
                className="flex-1 px-3 py-2 bg-poke-muted text-poke-text-primary border border-poke-border rounded-poke-md text-sm font-mono select-all"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button variant="primary" size="sm" onClick={handleCopy}>
                {copied ? t('common.copied') : t('builder.copy')}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={generatedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-poke-accent hover:underline"
              >
                {t('common.openPreview')}
              </a>

              {onSavePreset && (
                <>
                  <span className="text-poke-border">|</span>
                  <button
                    onClick={() => setShowSavePreset(!showSavePreset)}
                    className="text-sm text-poke-text-secondary hover:text-poke-text-primary transition-colors"
                  >
                    {showSavePreset ? t('common.cancel') : t('builder.saveAsPreset')}
                  </button>
                </>
              )}
            </div>

            {showSavePreset && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label={t('builder.presetName')}
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder={t('builder.presetNamePlaceholder')}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSavePreset}
                  disabled={!presetName.trim()}
                  loading={savingPreset}
                >
                  {t('builder.save')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

