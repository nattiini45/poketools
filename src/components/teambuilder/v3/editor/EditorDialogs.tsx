'use client';

import { useState, useCallback } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import TeamImporter from '@/components/teambuilder/TeamImporter';
import { exportTeamText } from '@/lib/pkmn/teams';
import { useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { errorsTeams } from '@/i18n/messages/errors';
import {
  apiFailure,
  errorKey,
  useTeambuilderErrorText,
  type TeambuilderError,
} from '../hooks/useTeambuilderErrorText';
import type { PokemonSet, TeamValidationResult } from '@/types/team';

// ── Import Dialog ──────────────────────────────────────────────────────

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  rulesetId?: string | null;
  onImport: (pokemon: PokemonSet[], validation: TeamValidationResult | null) => void;
}

export function ImportDialog({ open, onClose, rulesetId, onImport }: ImportDialogProps) {
  const t = useT(teambuilderMessages);
  const handleImport = useCallback(
    (pokemon: PokemonSet[], validation: TeamValidationResult | null) => {
      onImport(pokemon, validation);
      onClose();
    },
    [onImport, onClose],
  );

  return (
    <Modal open={open} onClose={onClose} title={t('dialogs.importTitle')} size="md">
      <TeamImporter rulesetId={rulesetId ?? undefined} onImport={handleImport} />
    </Modal>
  );
}

// ── Export Dialog ──────────────────────────────────────────────────────

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  team: (PokemonSet | null)[];
}

export function ExportDialog({ open, onClose, team }: ExportDialogProps) {
  const t = useT(teambuilderMessages);
  return (
    <Modal open={open} onClose={onClose} title={t('dialogs.exportTitle')} size="md">
      <ExportPanel team={team} />
    </Modal>
  );
}

/**
 * The export body: the Showdown text plus copy / download. The text is
 * Showdown's own format and stays English in every language (pkmn-l10n §5.5);
 * only the button labels are translated.
 */
export function ExportPanel({ team }: { team: (PokemonSet | null)[] }) {
  const t = useT(teambuilderMessages);
  const pokemon = team.filter((s): s is PokemonSet => s !== null);
  const text = exportTeamText(pokemon);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the textarea content
    }
  }, [text]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'team.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [text]);

  return (
    <div className="space-y-3">
      <textarea
        readOnly
        value={text}
        lang="en"
        className="w-full h-48 p-3 border border-poke-border bg-poke-elevated rounded-poke-md text-sm text-poke-text-primary font-mono resize-y"
      />
      <div className="flex gap-2">
        <Button variant="primary" onClick={handleCopy}>
          {copied ? t('dialogs.copied') : t('dialogs.copyToClipboard')}
        </Button>
        <Button variant="secondary" onClick={handleDownload}>
          {t('dialogs.downloadTxt')}
        </Button>
      </div>
    </div>
  );
}

// ── Share Dialog ───────────────────────────────────────────────────────

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  teamId: string | null;
}

export function ShareDialog({ open, onClose, teamId }: ShareDialogProps) {
  const t = useT(teambuilderMessages);
  const errorText = useTeambuilderErrorText(errorsTeams);
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<TeambuilderError | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/teams/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      const json = (await res.json()) as { success?: boolean; shareUrl?: string; error?: string };
      if (!json.success) {
        setError(apiFailure(json, 'shareFailed'));
        return;
      }
      setShareUrl(json.shareUrl ?? '');
    } catch (err) {
      setError(err instanceof TypeError ? { kind: 'api', error: toApiErrorLike(err) } : errorKey('shareFailed'));
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  return (
    <Modal open={open} onClose={onClose} title={t('dialogs.shareTitle')} size="sm">
      <div className="space-y-3">
        {!teamId && (
          <p className="text-sm text-poke-text-muted">{t('dialogs.saveBeforeSharing')}</p>
        )}
        {teamId && !shareUrl && (
          <>
            <p className="text-sm text-poke-text-muted">
              {t('dialogs.shareIntro')}
            </p>
            {error && <p className="text-sm text-poke-danger">{errorText(error)}</p>}
            <Button variant="primary" onClick={handleGenerate} loading={loading}>
              {t('dialogs.generateLink')}
            </Button>
          </>
        )}
        {shareUrl && (
          <>
            <input
              readOnly
              value={shareUrl}
              className="w-full p-2 border border-poke-border bg-poke-elevated rounded-poke-md text-sm text-poke-text-primary"
            />
            <Button variant="primary" onClick={handleCopy}>
              {copied ? t('dialogs.copied') : t('dialogs.copyLink')}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Publish Dialog ─────────────────────────────────────────────────────

interface PublishDialogProps {
  open: boolean;
  onClose: () => void;
  teamId: string | null;
}

export function PublishDialog({ open, onClose, teamId }: PublishDialogProps) {
  const t = useT(teambuilderMessages);
  const errorText = useTeambuilderErrorText(errorsTeams);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<TeambuilderError | null>(null);
  const [published, setPublished] = useState(false);

  const handlePublish = useCallback(async () => {
    if (!teamId) return;
    if (!title.trim()) { setError(errorKey('titleRequired')); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/teams/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          title: title.trim(),
          description: description.trim() || undefined,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!json.success) {
        setError(apiFailure(json, 'publishFailed'));
        return;
      }
      setPublished(true);
    } catch (err) {
      setError(err instanceof TypeError ? { kind: 'api', error: toApiErrorLike(err) } : errorKey('publishFailed'));
    } finally {
      setLoading(false);
    }
  }, [teamId, title, description, tags]);

  if (published) {
    return (
      <Modal open={open} onClose={onClose} title={t('dialogs.publishedTitle')} size="sm">
        <div className="space-y-3">
          <p className="text-sm text-poke-text-secondary">
            {t('dialogs.publishedBody')}
          </p>
          <Button variant="primary" onClick={onClose}>{t('dialogs.done')}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={t('dialogs.publishTitle')} size="md">
      <div className="space-y-3">
        {!teamId && (
          <p className="text-sm text-poke-text-muted">{t('dialogs.saveBeforePublishing')}</p>
        )}
        {teamId && (
          <>
            <div>
              <label className="block text-xs text-poke-text-muted mb-1">{t('dialogs.titleLabel')}</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('dialogs.titlePlaceholder')}
                className="w-full p-2 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-poke-text-muted mb-1">{t('dialogs.descriptionLabel')}</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('dialogs.descriptionPlaceholder')}
                rows={3}
                className="w-full p-2 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-poke-text-muted mb-1">{t('dialogs.tagsLabel')}</label>
              <input
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder={t('dialogs.tagsPlaceholder')}
                className="w-full p-2 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary"
              />
            </div>
            {error && <p className="text-sm text-poke-danger">{errorText(error)}</p>}
            <div className="flex gap-2">
              <Button variant="primary" onClick={handlePublish} loading={loading}>
                {t('dialogs.publish')}
              </Button>
              <Button variant="secondary" onClick={onClose}>
                {t('dialogs.cancel')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
