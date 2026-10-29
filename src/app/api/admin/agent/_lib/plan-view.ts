/**
 * The Plan as the panel shows it: sections with structured rows, the assumptions and the blockers behind a disabled Build
 * (plan 5.3). Built on the server from the stored document so the browser never needs the Plan schema, and so what it
 * receives is an allow-list: stored text (names) as `text` values, everything else enums, numbers and flags.
 *
 * `planReadiness` is run without live facts here (the panel does not read rulesets, players or the dex). The blockers it
 * reports as `fact_unavailable` are therefore "checked when the build is prepared", not problems: they are left out of the
 * blocker list and out of the section chips, and the Build card staging runs the full check with live facts.
 */
import type {
  PlanAssumptionView,
  PlanBlockerView,
  PlanRow,
  PlanRowValue,
  PlanSectionState,
  PlanSectionView,
  PlanView,
} from '@/components/admin/assistant/types';
import { planCode } from '@/lib/ai/admin-agent/plans/hash';
import { planReadiness, type PlanBlocker, type PlanSection } from '@/lib/ai/admin-agent/plans/readiness';
import {
  parsePlanDocument,
  RULESET_DELTA_CATEGORIES,
  type PlanDocument,
  type PlanPhase,
  type PlanRosterEntry,
  type RulesetDocumentDelta,
} from '@/lib/ai/admin-agent/plans/schema';
import type { PlanRecord } from '@/lib/ai/admin-agent/store/types';

type SectionName = Exclude<PlanSection, 'plan'>;
const SECTIONS: readonly SectionName[] = ['ruleset', 'format', 'league', 'phases', 'roster', 'groups', 'draft', 'tournament'];

const text = (value: string): PlanRowValue => ({ kind: 'text', text: value });
const row = (label: string, value: PlanRowValue): PlanRow => ({ label, value });

function phaseValue(phase: Pick<PlanPhase, 'bracket_type' | 'best_of' | 'is_doubles'>): PlanRowValue {
  return { kind: 'phase', bracket: phase.bracket_type, bestOf: phase.best_of, doubles: phase.is_doubles };
}

function deltaCount(delta: RulesetDocumentDelta, key: 'ban' | 'unban'): number {
  return RULESET_DELTA_CATEGORIES.reduce((sum, category) => sum + delta[category][key].length, 0);
}

function rosterCounts(entries: readonly PlanRosterEntry[]) {
  return {
    resolved: entries.filter((entry) => entry.state === 'resolved').length,
    open: entries.filter((entry) => entry.state === 'unresolved' || entry.state === 'candidates').length,
    skipped: entries.filter((entry) => entry.state === 'skipped').length,
  };
}

interface Summary {
  rows: PlanRow[];
  items: Array<{ title: string | null; rows: PlanRow[] }>;
}

function summarize(plan: PlanDocument, section: SectionName): Summary | null {
  const { slots } = plan;
  switch (section) {
    case 'ruleset': {
      const slot = slots.ruleset;
      if (slot === undefined) return null;
      const rows = [row('kind', { kind: 'word', group: 'modes', value: slot.mode })];
      if (slot.mode === 'new' || slot.mode === 'fork') {
        rows.push(row('name', text(slot.name)));
        if (slot.mode === 'new' && slot.preset !== undefined) rows.push(row('preset', text(slot.preset)));
        if (slot.mode === 'new' && slot.tour_overlay !== undefined) rows.push(row('tourOverlay', { kind: 'bool', value: slot.tour_overlay }));
        rows.push(row('bans', { kind: 'number', value: deltaCount(slot.delta, 'ban') }));
        rows.push(row('unbans', { kind: 'number', value: deltaCount(slot.delta, 'unban') }));
      }
      return { rows, items: [] };
    }
    case 'format': {
      const slot = slots.format;
      return slot === undefined ? null : { rows: [row('kind', { kind: 'word', group: 'modes', value: slot.mode })], items: [] };
    }
    case 'league': {
      const slot = slots.league;
      if (slot === undefined) return null;
      const rows = [row('name', text(slot.name)), row('formatType', { kind: 'enum', group: 'formatType', value: slot.format_type }), row('language', { kind: 'word', group: 'languages', value: slot.language })];
      if (slot.start_date !== undefined) rows.push(row('startDate', { kind: 'date', value: slot.start_date }));
      if (slot.end_date !== undefined) rows.push(row('endDate', { kind: 'date', value: slot.end_date }));
      if (slot.clone_from !== undefined) {
        rows.push(row('clonedFrom', { kind: 'bool', value: true }));
        rows.push(row('withRoster', { kind: 'bool', value: slot.clone_from.copy_roster }));
      }
      return { rows, items: [] };
    }
    case 'phases': {
      const slot = slots.phases;
      if (slot === undefined || slot.length === 0) return null;
      return { rows: [], items: slot.map((phase) => ({ title: phase.name, rows: [row('bracket', phaseValue(phase))] })) };
    }
    case 'roster': {
      const slot = slots.roster;
      if (slot === undefined) return null;
      const counts = rosterCounts(slot.entries);
      const rows = [row('matched', { kind: 'matched', resolved: counts.resolved, total: slot.entries.length })];
      if (counts.open > 0) rows.push(row('open', { kind: 'number', value: counts.open }));
      if (counts.skipped > 0) rows.push(row('skipped', { kind: 'number', value: counts.skipped }));
      if (slot.target_count !== undefined) rows.push(row('target', { kind: 'number', value: slot.target_count }));
      return { rows, items: [] };
    }
    case 'groups': {
      const slot = slots.groups;
      if (slot === undefined) return null;
      const rows = [row('groups', { kind: 'word', group: 'groupModes', value: slot.mode })];
      if (slot.count !== undefined) rows.push(row('groupCount', { kind: 'number', value: slot.count }));
      return { rows, items: [] };
    }
    case 'draft': {
      const slot = slots.draft;
      if (slot === undefined || slot.length === 0) return null;
      return {
        rows: [],
        items: slot.map((entry) => ({
          title: entry.group_key ?? null,
          rows: [
            row('engine', { kind: 'word', group: 'engines', value: entry.engine }),
            ...(entry.budget === undefined ? [] : [row('budget', { kind: 'number', value: entry.budget } as PlanRowValue)]),
          ],
        })),
      };
    }
    case 'tournament': {
      const slot = slots.tournament;
      if (slot === undefined) return null;
      return {
        rows: [
          row('name', text(slot.name)),
          row('bracket', phaseValue(slot)),
        ],
        items: [],
      };
    }
  }
}

/** Which section an assumption belongs to, by the prefix of its key (`league.language`, `legs.regular_season`). */
function assumptionSection(key: string): PlanSection | null {
  const head = key.split(/[.:]/, 1)[0];
  if (head === 'legs' || head === 'phase' || head === 'phases') return 'phases';
  return (['plan', ...SECTIONS] as string[]).includes(head) ? (head as PlanSection) : null;
}

function refSection(refKey: string): SectionName {
  if (refKey.startsWith('phase.')) return 'phases';
  if (refKey.startsWith('draft.')) return 'draft';
  return refKey as SectionName;
}

/** The chip for a section once the `fact` blockers are set aside (mirrors the readiness chips for the non-blocked cases). */
function stateOf(plan: PlanDocument, section: SectionName, counted: readonly PlanBlocker[], reported: PlanSectionState | undefined): PlanSectionState {
  const mine = counted.filter((blocker) => blocker.section === section);
  if (mine.some((blocker) => blocker.kind === 'engine_gap')) return 'engine_gap';
  if (mine.length > 0) return 'needs_input';
  if (reported !== undefined && reported !== 'needs_input') return reported;
  // Only fact blockers were behind "needs input": decide the way readiness does for an unblocked section.
  if (summarize(plan, section) === null) return 'empty';
  const unconfirmed = plan.assumptions.some((assumption) => !assumption.confirmed && assumptionSection(assumption.key) === section);
  if (unconfirmed) return 'assumed';
  const refs = Object.keys(plan.refs).filter((key) => refSection(key) === section);
  return refs.length > 0 ? 'built' : 'ready';
}

function blockerView(blocker: PlanBlocker): PlanBlockerView {
  const params: PlanBlockerView['params'] = {};
  for (const [key, value] of Object.entries(blocker.params)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') params[key] = value;
  }
  return { code: blocker.code, section: blocker.section, path: blocker.path, params };
}

function assumptionValue(value: unknown): PlanRowValue | null {
  if (typeof value === 'string') return text(value.length > 200 ? `${value.slice(0, 199)}…` : value);
  if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number', value };
  if (typeof value === 'boolean') return { kind: 'bool', value };
  return null;
}

export function toPlanView(record: PlanRecord): PlanView | null {
  const parsed = parsePlanDocument(record.doc);
  if (!parsed.ok) {
    console.error('[admin-agent] a stored plan no longer matches its schema', record.id);
    return null;
  }
  const plan = parsed.plan;
  const readiness = planReadiness(plan);
  const counted = readiness.blockers.filter((blocker) => blocker.kind !== 'fact');

  const sections: PlanSectionView[] = [];
  for (const section of SECTIONS) {
    const summary = summarize(plan, section);
    const state = stateOf(plan, section, counted, readiness.sections[section]?.state);
    if (summary === null && state === 'empty') continue;
    sections.push({
      section,
      state,
      blockers: counted.filter((blocker) => blocker.section === section).length,
      rows: summary?.rows ?? [],
      items: summary?.items ?? [],
    });
  }

  const assumptions: PlanAssumptionView[] = plan.assumptions.map((assumption) => ({
    key: assumption.key,
    source: assumption.source,
    confirmed: assumption.confirmed,
    value: assumptionValue(assumption.value),
  }));

  return {
    id: record.id,
    mode: record.mode === 'amend' ? 'amend' : 'create',
    status: record.status as PlanView['status'],
    revision: record.revision,
    code: planCode(record.doc_hash),
    title: plan.title,
    contentLocale: plan.contentLocale,
    sections,
    assumptions,
    ready: counted.length === 0,
    blockers: counted.map(blockerView),
    warnings: readiness.warnings.map(blockerView),
  };
}
