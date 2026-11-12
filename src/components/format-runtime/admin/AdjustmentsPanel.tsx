'use client';

import { useId, useState, type FormEvent } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useFormatter, useT } from '@/i18n/client';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import { applyAdjustmentRequest } from '@/lib/format-engine/runtime/client-api-admin';
import type { AdjustmentTargets, SubmittableAdjustKind } from '@/lib/format-engine/runtime/view-types';
import { unsavedMarker } from '@/lib/league-admin/unsaved';
import { BUTTON_TOUCH, TEXT_MAX, codePointLength } from './admin-shared';
import {
  EMPTY_POINTS,
  EMPTY_RELATION,
  EMPTY_RESOURCE,
  apiOnlyKindsOf,
  formKindsOf,
  isPointsDirty,
  isRelationDirty,
  isResourceDirty,
  parsePoints,
  parseRelation,
  parseResource,
  type FormKind,
  type Parsed,
} from './adjust-form';
import PointsFields from './PointsFields';
import RelationFields from './RelationFields';
import ResourceFields from './ResourceFields';
import { useAdminRequest } from './useAdminRequest';

export interface AdjustmentsPanelProps {
  seasonId: string;
  /** The kinds the format allows (`allowed_adjustments`). */
  allowed: readonly SubmittableAdjustKind[];
  targets: AdjustmentTargets;
}

/**
 * The manual adjustment form of the Live tab. It builds the kinds that have a complete, safe form here (points, resource,
 * reveal a relation), limited to the kinds the format allows; the others stay available through the API and the
 * assistant, and a note says so. Every adjustment needs a reason (500 characters, counted as the server counts them).
 * While the form holds input it marks itself unsaved, so the tab strip asks before the admin leaves the tab.
 */
export default function AdjustmentsPanel({ seasonId, allowed, targets }: AdjustmentsPanelProps) {
  const t = useT(formatRuntimeAdminMessages);
  const formatter = useFormatter();
  const { pending, errorMessage, run, refresh, clearError } = useAdminRequest();
  const kinds = formKindsOf(allowed);
  const apiOnly = apiOnlyKindsOf(allowed);

  const [chosen, setChosen] = useState<FormKind | null>(null);
  const [points, setPoints] = useState(EMPTY_POINTS);
  const [resource, setResource] = useState(EMPTY_RESOURCE);
  const [relation, setRelation] = useState(EMPTY_RELATION);
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const counterId = useId();

  const kind: FormKind | null = chosen !== null && kinds.includes(chosen) ? chosen : (kinds[0] ?? null);
  const trimmed = reason.trim();
  const length = codePointLength(trimmed);
  const tooLong = length > TEXT_MAX;
  const holdsDomain = typeof targets.resources.find((candidate) => candidate.key === resource.resource)?.holds_domain === 'string';

  const parsed: Parsed | null =
    kind === 'points' ? parsePoints(points) : kind === 'resource' ? parseResource(resource, holdsDomain) : kind === 'relation' ? parseRelation(relation) : null;
  const dirty = reason !== '' || isPointsDirty(points) || isResourceDirty(resource) || isRelationDirty(relation);

  function reset() {
    setPoints(EMPTY_POINTS);
    setResource(EMPTY_RESOURCE);
    setRelation(EMPTY_RELATION);
    setReason('');
    setAttempted(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || parsed === null) return;
    setAttempted(true);
    setRecorded(false);
    if (!parsed.ok || trimmed === '' || tooLong) return;
    const out = await run(() => applyAdjustmentRequest(seasonId, { reason: trimmed, adjustment: parsed.body }));
    if (!out.ok) return;
    reset();
    setRecorded(true);
    refresh();
  }

  const apiOnlyNote =
    apiOnly.length === 0
      ? null
      : t('adjust.apiOnly', { kinds: formatter.list(apiOnly.map((value) => t(`adjust.kind.${value}`)), 'conjunction') });

  if (kind === null) {
    return (
      <div className="space-y-3" data-live-adjustments>
        <p className="text-body text-fg-muted">{t('adjust.noForms')}</p>
        {apiOnlyNote !== null && <p className="text-body text-fg-muted">{apiOnlyNote}</p>}
      </div>
    );
  }

  const draftProblem = attempted && parsed !== null && !parsed.ok ? parsed.error : null;

  return (
    <div className="space-y-3" data-live-adjustments>
      <p className="text-body text-fg-muted">{t('adjust.intro')}</p>
      <form onSubmit={submit} className="space-y-4" aria-busy={pending} {...unsavedMarker(dirty)}>
        <Select
          label={t('adjust.fields.kind')}
          value={kind}
          disabled={pending}
          onChange={(event) => {
            setChosen(event.target.value as FormKind);
            setAttempted(false);
            clearError();
          }}
        >
          {kinds.map((value) => (
            <option key={value} value={value}>
              {t(`adjust.kind.${value}`)}
            </option>
          ))}
        </Select>

        {kind === 'points' && <PointsFields targets={targets} value={points} onChange={setPoints} disabled={pending} />}
        {kind === 'resource' && <ResourceFields targets={targets} value={resource} onChange={setResource} disabled={pending} />}
        {kind === 'relation' && <RelationFields targets={targets} value={relation} onChange={setRelation} disabled={pending} />}

        <div className="space-y-1.5">
          <Textarea
            label={t('adjust.reason.label')}
            hint={t('adjust.reason.hint')}
            value={reason}
            disabled={pending}
            aria-describedby={counterId}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
          />
          <p id={counterId} className={`text-caption ${tooLong ? 'text-loss' : 'text-fg-muted'}`}>
            {t('adjust.reason.counter', { used: length, max: TEXT_MAX })}
          </p>
        </div>

        {draftProblem !== null && <Alert variant="warning">{t(`adjust.error.${draftProblem}`)}</Alert>}
        {attempted && trimmed === '' && draftProblem === null && <Alert variant="warning">{t('adjust.reason.required')}</Alert>}
        {errorMessage !== null && <Alert variant="error">{errorMessage}</Alert>}
        <div role="status" aria-live="polite" className="text-body text-live">
          {recorded ? t('adjust.result.recorded') : ''}
        </div>

        <Button type="submit" className={BUTTON_TOUCH} loading={pending} disabled={tooLong}>
          {t('adjust.submit')}
        </Button>
      </form>
      {apiOnlyNote !== null && <p className="text-body text-fg-muted">{apiOnlyNote}</p>}
    </div>
  );
}
