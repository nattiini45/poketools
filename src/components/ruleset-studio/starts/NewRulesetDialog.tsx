'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import RulesetPresetSelect from '@/components/ruleset/RulesetPresetSelect';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import { LOCALES, type Locale } from '@/i18n/config';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useLocale, useT } from '@/i18n/client';
import { errorsAdmin } from '@/i18n/messages/errors/admin';
import { errorsCommon } from '@/i18n/messages/errors/common';
import { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { useApiErrorText } from '@/i18n/use-api-error';
import { DEFAULT_RULESET_PRESET, getRulesetPreset } from '@/lib/pkmn/ruleset-preset-catalog';
import { createRulesetRequest, forkRulesetRequest, type CreatedRulesetResponse } from '@/lib/ruleset-studio/editor/api';
import { IMPORT_MAX_BYTES, prepareImport, type ImportFailure, type ImportReport } from '@/lib/ruleset-studio/editor/import-file';
import { START_KINDS, presetStartBody, type StartKind } from '@/lib/ruleset-studio/editor/starts';
import { DEFINITION_NAME_MAX, nameProblem } from '@/lib/studio-core/name';
import type { ApiOutcome } from '@/lib/studio-core/request';
import { rulesetEditorHref } from '../hrefs';

/** What the dialog offers. Names are already in the viewer's language; nothing here is a draft or a player. */
export interface NewRulesetData {
  /** Rulesets another admin shared (or the gallery offers) that can be copied: their last published version. */
  shared: { id: string; name: string; version: number }[];
}

interface NewRulesetFormProps {
  data: NewRulesetData;
  onCancel?: () => void;
}

const REPORT_LIST_MAX = 20;

/** The problems of a chosen file: the first twenty paths with their codes, then how many more there are. */
function ImportReportView({ report }: { report: ImportReport }) {
  const t = useT(rulesetStudioMessages);
  if (report.issues.length === 0) {
    return (
      <p role="status" className="rounded-poke-md border border-poke-border bg-poke-elevated p-3 text-sm text-poke-text-secondary">
        {t('new.reportOk')}
      </p>
    );
  }
  return (
    <div role="status" className="space-y-2 rounded-poke-md border border-poke-border bg-poke-elevated p-3 text-sm text-poke-text-secondary">
      <p id="re-import-issues" className="font-semibold text-poke-text-primary">
        {t('new.reportIssues', { count: report.issues.length })}
      </p>
      <ul aria-labelledby="re-import-issues" className="list-disc pl-5">
        {report.issues.slice(0, REPORT_LIST_MAX).map((issue) => (
          <li key={`${issue.path}:${issue.code}`} className="break-all">
            <code>{issue.path === '' ? '/' : issue.path}</code> <code>{issue.code}</code>
          </li>
        ))}
        {report.issues.length > REPORT_LIST_MAX && <li>{t('new.reportMore', { count: report.issues.length - REPORT_LIST_MAX })}</li>}
      </ul>
    </div>
  );
}

/**
 * The four ways to start a ruleset: blank, from a catalog rule preset (with the Smogon tour extras as a toggle for the
 * draft presets that have them), from a shared ruleset, or from a `.json` file. One radio group chooses the start and the
 * panel below it asks for what that start needs. Creating goes through the library API and ends in the editor; a failure
 * shows its message in the viewer's language and the form stays usable for another try. A file is only parsed, never
 * evaluated, and a file with problems is not imported.
 */
export function NewRulesetForm({ data, onCancel }: NewRulesetFormProps) {
  const t = useT(rulesetStudioMessages);
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);

  const [start, setStart] = useState<StartKind>('blank');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Locale>(locale);
  const [preset, setPreset] = useState(DEFAULT_RULESET_PRESET);
  const [tourOverlay, setTourOverlay] = useState(false);
  const [forkId, setForkId] = useState(data.shared[0]?.id ?? '');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importFailure, setImportFailure] = useState<ImportFailure | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const chosenPreset = getRulesetPreset(preset);
  // The toggle is shown for the Smogon draft presets; only some of them have documented extras.
  const showsTourOverlay = chosenPreset?.source === 'smogon-draft';
  const hasTourOverlay = chosenPreset?.tourOverlay === true;

  // A blank ruleset needs a name; a preset start may leave it empty (the preset's own name is used).
  const problem = nameProblem(name);
  const nameChecked = start === 'blank' ? problem : name.trim() === '' ? null : problem;
  const nameError = touched && nameChecked !== null ? (nameChecked === 'required' ? t('new.nameRequired') : t('new.nameInvalid', { max: DEFINITION_NAME_MAX })) : null;
  const canSubmit =
    start === 'blank'
      ? problem === null
      : start === 'preset'
        ? nameChecked === null && chosenPreset !== undefined
        : start === 'fork'
          ? forkId !== ''
          : report !== null && report.issues.length === 0 && importFailure === null;

  const chooseFile = async (file: File | undefined) => {
    setReport(null);
    setImportFailure(null);
    setError(null);
    if (file === undefined) return;
    // The size is known before reading: a file over the limit is never read into memory.
    if (file.size > IMPORT_MAX_BYTES) {
      setImportFailure('too_large');
      return;
    }
    const result = prepareImport(await file.text(), file.size);
    if (!result.ok) {
      setImportFailure(result.reason);
      return;
    }
    setReport(result.report);
  };

  const run = async (): Promise<ApiOutcome<CreatedRulesetResponse> | null> => {
    switch (start) {
      case 'blank':
        return createRulesetRequest({ name: name.trim(), base_locale: language });
      case 'preset': {
        const body = presetStartBody({ preset, name, language, tourOverlay });
        return body === null ? null : createRulesetRequest(body);
      }
      case 'fork':
        return forkRulesetRequest(forkId);
      case 'import':
        return report === null ? null : createRulesetRequest({ document: report.document });
      default:
        return null;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setTouched(true);
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const outcome = await run();
    if (outcome === null) {
      setBusy(false);
      return;
    }
    if (outcome.ok) {
      router.push(rulesetEditorHref(outcome.data.definition.id));
      return;
    }
    setError(outcome.error);
    setBusy(false);
  };

  const submitLabel = start === 'fork' ? t('new.fork') : start === 'import' ? t('new.importCreate') : t('new.create');

  return (
    <form onSubmit={(event) => void submit(event)} aria-busy={busy} className="space-y-5" noValidate>
      <p className="text-sm text-poke-text-secondary">{t('new.intro')}</p>

      <fieldset className="space-y-2">
        <legend className="mb-1 font-heading text-sm font-semibold text-poke-text-primary">{t('new.startLegend')}</legend>
        {START_KINDS.map((kind) => (
          <div key={kind} className="flex items-start gap-3 rounded-poke-md border border-poke-border p-3">
            <input
              id={`re-start-${kind}`}
              type="radio"
              name="re-start"
              value={kind}
              checked={start === kind}
              aria-describedby={`re-start-${kind}-help`}
              onChange={() => {
                setStart(kind);
                setError(null);
              }}
              className="mt-1 h-4 w-4 shrink-0 accent-poke-accent"
            />
            <div className="min-w-0">
              <label htmlFor={`re-start-${kind}`} className="block text-sm font-semibold text-poke-text-primary">
                {t(`new.start.${kind}`)}
              </label>
              <p id={`re-start-${kind}-help`} className="text-sm text-poke-text-muted">
                {t(`new.start.${kind}Help`)}
              </p>
            </div>
          </div>
        ))}
      </fieldset>

      <div className="space-y-3">
        {(start === 'blank' || start === 'preset') && (
          <>
            {start === 'preset' && (
              <div className="space-y-1">
                <RulesetPresetSelect
                  id="re-new-preset"
                  label={t('new.presetLabel')}
                  value={preset}
                  onChange={setPreset}
                  describedBy="re-new-preset-help"
                />
                <p id="re-new-preset-help" className="text-sm text-poke-text-muted">
                  {t('new.presetHelp')}
                </p>
              </div>
            )}
            {start === 'preset' && showsTourOverlay && (
              <div className="space-y-1">
                <div className="flex min-h-11 items-center gap-2 sm:min-h-0">
                  <input
                    id="re-new-tour"
                    type="checkbox"
                    checked={hasTourOverlay && tourOverlay}
                    disabled={!hasTourOverlay}
                    aria-describedby="re-new-tour-help"
                    onChange={(event) => setTourOverlay(event.target.checked)}
                    className="h-4 w-4 shrink-0 accent-poke-accent"
                  />
                  <label htmlFor="re-new-tour" className="text-sm font-semibold text-poke-text-primary">
                    {t('new.tourOverlay')}
                  </label>
                </div>
                <p id="re-new-tour-help" className="text-sm text-poke-text-muted">
                  {hasTourOverlay ? t('new.tourOverlayHelp') : t('new.tourOverlayNone')}
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Input
                id="re-new-name"
                label={start === 'blank' ? t('new.name') : t('new.namePreset')}
                value={name}
                maxLength={DEFINITION_NAME_MAX * 2}
                autoComplete="off"
                aria-invalid={nameError !== null ? true : undefined}
                aria-describedby={nameError !== null ? 're-new-name-err' : start === 'preset' ? 're-new-name-help' : undefined}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setTouched(true)}
              />
              {nameError !== null ? (
                <p id="re-new-name-err" className="text-sm text-poke-danger">
                  {nameError}
                </p>
              ) : (
                start === 'preset' && (
                  <p id="re-new-name-help" className="text-sm text-poke-text-muted">
                    {t('new.namePresetHelp')}
                  </p>
                )
              )}
            </div>
            <Select id="re-new-language" label={t('new.language')} value={language} onChange={(event) => setLanguage(event.target.value === 'de' ? 'de' : 'en')}>
              {LOCALES.map((value) => (
                <option key={value} value={value}>
                  {value === 'en' ? t('new.english') : t('new.german')}
                </option>
              ))}
            </Select>
          </>
        )}

        {start === 'fork' &&
          (data.shared.length === 0 ? (
            <p className="text-sm text-poke-text-muted">{t('new.forkNone')}</p>
          ) : (
            <>
              <Select id="re-new-fork" label={t('new.forkLabel')} value={forkId} onChange={(event) => setForkId(event.target.value)}>
                {data.shared.map((item) => (
                  <option key={item.id} value={item.id}>
                    {t('new.forkOption', { name: item.name, version: item.version })}
                  </option>
                ))}
              </Select>
              <p className="text-sm text-poke-text-muted">{t('new.forkHelp')}</p>
            </>
          ))}

        {start === 'import' && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="re-new-file" className="block font-heading text-sm font-semibold text-poke-text-primary">
                {t('new.file')}
              </label>
              <input
                id="re-new-file"
                type="file"
                accept="application/json,.json"
                aria-describedby={importFailure !== null ? 're-new-file-err' : 're-new-file-help'}
                aria-invalid={importFailure !== null ? true : undefined}
                onChange={(event) => void chooseFile(event.target.files?.[0])}
                className="block w-full text-sm text-poke-text-primary file:mr-3 file:min-h-11 file:rounded-poke-md file:border file:border-poke-border file:bg-poke-elevated file:px-3 file:py-2 file:text-sm sm:file:min-h-0"
              />
              {importFailure !== null ? (
                <p id="re-new-file-err" className="text-sm text-poke-danger">
                  {t(`new.failure.${importFailure}`)}
                </p>
              ) : (
                <p id="re-new-file-help" className="text-sm text-poke-text-muted">
                  {t('new.fileHelp')}
                </p>
              )}
            </div>
            {report !== null && <ImportReportView report={report} />}
          </>
        )}
      </div>

      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}

      <div className="flex flex-wrap justify-end gap-3">
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {t('new.cancel')}
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={start === 'fork' && data.shared.length === 0}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** The "New ruleset" button and the dialog it opens. */
export default function NewRulesetDialog({ data }: { data: NewRulesetData }) {
  const t = useT(rulesetStudioMessages);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" className="min-h-11 sm:min-h-0" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('new.button')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title={t('new.title')}>
        <NewRulesetForm data={data} onCancel={() => setOpen(false)} />
      </Modal>
    </>
  );
}
