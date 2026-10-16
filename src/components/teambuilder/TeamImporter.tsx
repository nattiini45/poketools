'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { errorsTeams, errorsTournaments, type ErrorCatalog } from '@/i18n/messages/errors';
import {
  apiFailure,
  errorKey,
  useTeambuilderErrorText,
  type TeambuilderError,
} from './v3/hooks/useTeambuilderErrorText';
import type { PokemonSet, TeamValidationResult } from '@/types/team';

/** Example paste under the placeholder. Showdown text, so it stays English in every language. */
const SHOWDOWN_EXAMPLE =
  'Garchomp @ Rocky Helmet\nAbility: Rough Skin\nEVs: 252 HP / 4 Def / 252 Spe\nJolly Nature\n- Earthquake\n- Dragon Claw\n- Stealth Rock\n- Toxic';

/**
 * Catalogs for /api/import-team failures: its own codes live in `errors/teams`;
 * `ruleset_not_found` is owned by `errors/tournaments`.
 */
export const TEAM_IMPORTER_ERROR_CATALOGS: readonly ErrorCatalog[] = [errorsTeams, errorsTournaments];

interface TeamImporterProps {
  rulesetId?: string;
  onImport: (pokemon: PokemonSet[], validation: TeamValidationResult | null) => void;
}

export default function TeamImporter({ rulesetId, onImport }: TeamImporterProps) {
  const t = useT(teambuilderMessages);
  const errorText = useTeambuilderErrorText(...TEAM_IMPORTER_ERROR_CATALOGS);
  const [mode, setMode] = useState<'text' | 'url'>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<TeambuilderError | null>(null);

  async function handleImport() {
    setError(null);
    setLoading(true);

    try {
      const body: Record<string, string | undefined> = {};
      if (mode === 'text') {
        if (!text.trim()) {
          setError(errorKey('pasteTeamText'));
          return;
        }
        body.text = text;
      } else {
        if (!url.trim()) {
          setError(errorKey('enterUrl'));
          return;
        }
        body.url = url;
      }
      if (rulesetId) body.ruleset_id = rulesetId;

      const res = await fetch('/api/import-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!json.success) {
        setError(apiFailure(json, 'importFailed'));
        return;
      }

      onImport(json.data.pokemon, json.data.validation);
    } catch {
      setError(errorKey('networkError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Mode tabs */}
      <div className="flex gap-4 border-b border-poke-border">
        <button
          onClick={() => setMode('text')}
          className={`pb-2 px-1 text-sm transition-colors ${
            mode === 'text'
              ? 'border-b-2 border-poke-accent text-poke-accent font-heading font-semibold'
              : 'text-poke-text-muted hover:text-poke-text-primary'
          }`}
        >
          {t('importer.pasteTab')}
        </button>
        <button
          onClick={() => setMode('url')}
          className={`pb-2 px-1 text-sm transition-colors ${
            mode === 'url'
              ? 'border-b-2 border-poke-accent text-poke-accent font-heading font-semibold'
              : 'text-poke-text-muted hover:text-poke-text-primary'
          }`}
        >
          {t('importer.urlTab')}
        </button>
      </div>

      {/* Input */}
      {mode === 'text' ? (
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={`${t('importer.textPlaceholder')}\n\n${SHOWDOWN_EXAMPLE}`}
          className="w-full h-48 p-3 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 transition-colors font-mono resize-y"
        />
      ) : (
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://pokepast.es/abc123"
          className="w-full p-3 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20 transition-colors"
        />
      )}

      {error && <p className="text-sm text-poke-danger">{errorText(error)}</p>}

      <Button variant="primary" onClick={handleImport} loading={loading}>
        {t('importer.submit')}
      </Button>
    </div>
  );
}
