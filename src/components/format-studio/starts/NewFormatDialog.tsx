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
import { formatStudioEditorMessages } from '@/i18n/messages/format-studio/editor';
import { useApiErrorText } from '@/i18n/use-api-error';
import { createFormatRequest, forkFormatRequest, forkPresetRequest, type CreatedFormatResponse } from '@/lib/format-studio/editor/api';
import { DEFINITION_NAME_MAX, nameProblem } from '@/lib/studio-core/name';
import type { ApiOutcome } from '@/lib/studio-core/request';
import { applyRulesetPreset } from '@/lib/format-kit/client';
import { blankDocument } from '@/lib/format-studio/editor/document';
import {
  IMPORT_MAX_BYTES,
  prepareImport,
  stripUnknownFields,
  type ImportFailure,
  type ImportReport,
} from '@/lib/format-studio/editor/import-file';
import { START_KINDS, type StartKind } from '@/lib/format-studio/editor/starts';
import { formatEditorHref } from '../editor/hrefs';

/** What the dialog offers. Names are already in the viewer's language; nothing here is a draft or a player. */
export interface NewFormatData {
  examples: { id: string; name: string }[];
  gallery: { id: string; name: string; version: number }[];
  leagues: { id: string; name: string }[];
}

interface NewFormatFormProps {
  data: NewFormatData;
  onCancel?: () => void;
  /** For tests: start on this panel. */
  initialStart?: StartKind;
  /** For tests: an import report as if a file had been chosen. */
  initialImportReport?: ImportReport;
}

const REPORT_LIST_MAX = 20;

/** The pointers of a report, the first twenty, then how many more there are. */
function PointerList({ heading, pointers, id }: { heading: string; pointers: readonly string[]; id: string }) {
  const t = useT(formatStudioEditorMessages);
  if (pointers.length === 0) return null;
  return (
    <div>
      <p id={id} className="font-semibold text-poke-text-primary">
        {heading}
      </p>
      <ul aria-labelledby={id} className="list-disc pl-5">
        {pointers.slice(0, REPORT_LIST_MAX).map((pointer) => (
          <li key={pointer} className="break-all">
            <code>{pointer}</code>
          </li>
        ))}
        {pointers.length > REPORT_LIST_MAX && <li>{t('new.reportMore', { count: pointers.length - REPORT_LIST_MAX })}</li>}
      </ul>
    </div>
  );
}

/** What a chosen file contains, in words: the errors, the fields to drop, the notes. */
function ImportReportView({ report, strip, onStrip }: { report: ImportReport; strip: boolean; onStrip: (next: boolean) => void }) {
  const t = useT(formatStudioEditorMessages);
  const hasUnknown = report.unknownFields.length > 0 || report.reserved.length > 0;
  return (
    <div role="status" className="space-y-2 rounded-poke-md border border-poke-border bg-poke-elevated p-3 text-sm text-poke-text-secondary">
      <p>{t('new.reportErrors', { count: report.errorCount })}</p>
      <PointerList id="fe-import-unknown" heading={t('new.reportUnknown', { count: report.unknownFields.length })} pointers={report.unknownFields} />
      <PointerList id="fe-import-reserved" heading={t('new.reportReserved', { count: report.reserved.length })} pointers={report.reserved} />
      {report.notes.length > 0 && <p>{t('new.reportNotes', { count: report.notes.length })}</p>}
      {hasUnknown && (
        <div className="flex min-h-11 items-center gap-2 sm:min-h-0">
          <input
            id="fe-import-strip"
            type="checkbox"
            checked={strip}
            onChange={(event) => onStrip(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-poke-accent"
          />
          <label htmlFor="fe-import-strip" className="text-poke-text-primary">
            {t('new.stripUnknown')}
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * The four ways to start a format: blank, from an example, from a league's structure, or from a `.json` file.
 * One radio group chooses the start and the panel below it asks for what that start needs. A blank format and a
 * shipped example can also pre-pick a rule preset (`ruleset-presets.ts` says what that sets on every stage; the
 * document stays fully editable). Creating goes through the library API and ends in the editor; a failure shows
 * its message in the viewer's language and the form stays usable for another try. A file is only parsed, never
 * evaluated.
 */
export function NewFormatForm({ data, onCancel, initialStart = 'blank', initialImportReport }: NewFormatFormProps) {
  const t = useT(formatStudioEditorMessages);
  const locale = useLocale();
  const router = useRouter();
  const errorText = useApiErrorText(errorsAdmin, errorsCommon);

  const [start, setStart] = useState<StartKind>(initialStart);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Locale>(locale);
  const [example, setExample] = useState(() => (data.examples[0] !== undefined ? `preset:${data.examples[0].id}` : ''));
  // A rule preset id, or '' for none; offered for a blank format and for a shipped example.
  const [rulesetPreset, setRulesetPreset] = useState('');
  const [leagueId, setLeagueId] = useState(data.leagues[0]?.id ?? '');
  const [report, setReport] = useState<ImportReport | null>(initialImportReport ?? null);
  const [importFailure, setImportFailure] = useState<ImportFailure | null>(null);
  const [strip, setStrip] = useState(initialImportReport !== undefined && (initialImportReport.unknownFields.length > 0 || initialImportReport.reserved.length > 0));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);

  const problem = nameProblem(name);
  const nameError = touched && problem !== null ? (problem === 'required' ? t('new.nameRequired') : t('new.nameInvalid', { max: DEFINITION_NAME_MAX })) : null;
  const presetExample = example.startsWith('preset:');
  const offersPreset = start === 'blank' || (start === 'example' && presetExample);
  const canSubmit =
    start === 'blank' ? problem === null : start === 'example' ? example !== '' : start === 'league' ? leagueId !== '' : report !== null && importFailure === null;

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
    setStrip(result.report.unknownFields.length > 0 || result.report.reserved.length > 0);
  };

  const run = async (): Promise<ApiOutcome<CreatedFormatResponse> | null> => {
    switch (start) {
      case 'blank': {
        const document = blankDocument(name.trim(), language);
        // The author typed the name, so it stays as it is.
        return createFormatRequest({ document: rulesetPreset === '' ? document : applyRulesetPreset(document, rulesetPreset) });
      }
      case 'example':
        return presetExample
          ? forkPresetRequest(example.slice('preset:'.length), rulesetPreset === '' ? undefined : rulesetPreset)
          : forkFormatRequest(example.slice('gallery:'.length));
      case 'import':
        return report === null ? null : createFormatRequest({ document: strip ? stripUnknownFields(report) : report.document });
      default:
        return null;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setTouched(true);
    if (!canSubmit) return;
    if (start === 'league') {
      router.push(`/admin/formats/league/${encodeURIComponent(leagueId)}`);
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await run();
    if (outcome === null) {
      setBusy(false);
      return;
    }
    if (outcome.ok) {
      router.push(formatEditorHref(outcome.data.definition.id));
      return;
    }
    setError(outcome.error);
    setBusy(false);
  };

  const submitLabel =
    start === 'blank' ? t('new.create') : start === 'example' ? t('new.fork') : start === 'league' ? t('new.leagueOpen') : t('new.importCreate');

  return (
    <form onSubmit={(event) => void submit(event)} aria-busy={busy} className="space-y-5" noValidate>
      <p className="text-sm text-poke-text-secondary">{t('new.intro')}</p>

      <fieldset className="space-y-2">
        <legend className="mb-1 font-heading text-sm font-semibold text-poke-text-primary">{t('new.startLegend')}</legend>
        {START_KINDS.map((kind) => (
          <div key={kind} className="flex items-start gap-3 rounded-poke-md border border-poke-border p-3">
            <input
              id={`fe-start-${kind}`}
              type="radio"
              name="fe-start"
              value={kind}
              checked={start === kind}
              aria-describedby={`fe-start-${kind}-help`}
              onChange={() => {
                setStart(kind);
                setError(null);
              }}
              className="mt-1 h-4 w-4 shrink-0 accent-poke-accent"
            />
            <div className="min-w-0">
              <label htmlFor={`fe-start-${kind}`} className="block text-sm font-semibold text-poke-text-primary">
                {t(`new.start.${kind}`)}
              </label>
              <p id={`fe-start-${kind}-help`} className="text-sm text-poke-text-muted">
                {t(`new.start.${kind}Help`)}
              </p>
            </div>
          </div>
        ))}
      </fieldset>

      <div className="space-y-3">
        {start === 'blank' && (
          <>
            <div className="space-y-1">
              <Input
                id="fe-new-name"
                label={t('new.name')}
                value={name}
                maxLength={DEFINITION_NAME_MAX * 2}
                autoComplete="off"
                aria-invalid={nameError !== null ? true : undefined}
                aria-describedby={nameError !== null ? 'fe-new-name-err' : undefined}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setTouched(true)}
              />
              {nameError !== null && (
                <p id="fe-new-name-err" className="text-sm text-poke-danger">
                  {nameError}
                </p>
              )}
            </div>
            <Select id="fe-new-language" label={t('new.language')} value={language} onChange={(event) => setLanguage(event.target.value === 'de' ? 'de' : 'en')}>
              {LOCALES.map((value) => (
                <option key={value} value={value}>
                  {value === 'en' ? t('fields.english') : t('fields.german')}
                </option>
              ))}
            </Select>
          </>
        )}

        {start === 'example' && (
          <>
            <p className="text-sm font-semibold text-poke-text-primary">{t('new.exampleCaption')}</p>
            <Select id="fe-new-example" label={t('new.exampleLabel')} value={example} onChange={(event) => setExample(event.target.value)}>
              <optgroup label={t('new.groupShipped')}>
                {data.examples.map((item) => (
                  <option key={item.id} value={`preset:${item.id}`}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
              {data.gallery.length > 0 && (
                <optgroup label={t('new.groupGallery')}>
                  {data.gallery.map((item) => (
                    <option key={item.id} value={`gallery:${item.id}`}>
                      {t('new.galleryOption', { name: item.name, version: item.version })}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </>
        )}

        {offersPreset && (
          <div className="space-y-1">
            <RulesetPresetSelect
              id="fe-new-preset"
              label={t('new.presetLabel')}
              value={rulesetPreset}
              onChange={setRulesetPreset}
              noneLabel={t('new.presetNone')}
              describedBy="fe-new-preset-help"
            />
            <p id="fe-new-preset-help" className="text-sm text-poke-text-muted">
              {t('new.presetHelp')}
            </p>
          </div>
        )}

        {start === 'league' &&
          (data.leagues.length === 0 ? (
            <p className="text-sm text-poke-text-muted">{t('new.leagueNone')}</p>
          ) : (
            <>
              <Select id="fe-new-league" label={t('new.leagueLabel')} value={leagueId} onChange={(event) => setLeagueId(event.target.value)}>
                {data.leagues.map((league) => (
                  <option key={league.id} value={league.id}>
                    {league.name}
                  </option>
                ))}
              </Select>
              <p className="text-sm text-poke-text-muted">{t('new.leagueHelp')}</p>
            </>
          ))}

        {start === 'import' && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="fe-new-file" className="block font-heading text-sm font-semibold text-poke-text-primary">
                {t('new.file')}
              </label>
              <input
                id="fe-new-file"
                type="file"
                accept="application/json,.json"
                aria-describedby={importFailure !== null ? 'fe-new-file-err' : 'fe-new-file-help'}
                aria-invalid={importFailure !== null ? true : undefined}
                onChange={(event) => void chooseFile(event.target.files?.[0])}
                className="block w-full text-sm text-poke-text-primary file:mr-3 file:min-h-11 file:rounded-poke-md file:border file:border-poke-border file:bg-poke-elevated file:px-3 file:py-2 file:text-sm sm:file:min-h-0"
              />
              {importFailure !== null ? (
                <p id="fe-new-file-err" className="text-sm text-poke-danger">
                  {t(`new.failure.${importFailure}`)}
                </p>
              ) : (
                <p id="fe-new-file-help" className="text-sm text-poke-text-muted">
                  {t('new.fileHelp')}
                </p>
              )}
            </div>
            {report !== null && <ImportReportView report={report} strip={strip} onStrip={setStrip} />}
          </>
        )}
      </div>

      {error !== null && <Alert variant="error">{errorText(error)}</Alert>}

      <div className="flex flex-wrap justify-end gap-3">
        {onCancel !== undefined && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {t('save.cancel')}
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={start === 'league' && data.leagues.length === 0}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** The "New format" button and the dialog it opens. */
export default function NewFormatDialog({ data }: { data: NewFormatData }) {
  const t = useT(formatStudioEditorMessages);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="primary" className="min-h-11 sm:min-h-0" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('new.button')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title={t('new.title')}>
        <NewFormatForm data={data} onCancel={() => setOpen(false)} />
      </Modal>
    </>
  );
}
