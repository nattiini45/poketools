/**
 * `FormatAttachPanel` (renderToStaticMarkup, no DOM): the attach panel of a custom league's Format tab. The inner view
 * components are rendered with their state passed as props; the panel itself is rendered in its three starting states
 * (started, attached, unattached). The button rules are table-tested through `attachButtonState`.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { createTranslator } from '@/i18n/core';
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import type { Locale } from '@/i18n/config';
import { ltext } from '@/lib/format-kit/client';
import type { AttachPreview } from '@/lib/format-studio/editor/attach-preview';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import FormatAttachPanel, {
  AttachBlockedReason,
  AttachedSummary,
  ManualPhasesNotice,
  Picker,
  StartedNotice,
  type FormatAttachPanelProps,
} from '../../attach/FormatAttachPanel';
import {
  attachButtonState,
  candidateGroup,
  groupCandidates,
  type AttachBlockReason,
  type AttachButtonInput,
  type AttachCandidateView,
  type AttachedFormatView,
} from '../../attach/attach-state';

const S1 = '5e150000-0000-4000-8000-000000000001';
const PHASES_HREF = `/admin/leagues/${S1}?tab=phases`;
const HASH = 'a3f9c2d41b7e8805e6d1f0c9b2a47385c6e1d0f9a8b7c6d5e4f3a2b1c0d9e8f7';

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

function expectNoLeftovers(html: string) {
  expect(html).not.toMatch(/undefined|\[object|NaN/);
  expect(html).not.toMatch(/\{[a-z_]+\}/);
  expect(html).not.toMatch(/Ã|Â|�/);
}

function render(ui: ReactNode, locale: Locale = 'en') {
  return renderWithI18n(<>{ui}</>, { locale });
}

const ATTACHED: AttachedFormatView = {
  definition_id: 'def-1',
  version_no: 2,
  spec_hash: HASH,
  frozen_at: '2026-10-09T12:00:00.000Z',
  name: ltext('en', 'Spring Cup', 'Frühlingspokal'),
  stageCount: 3,
  createdPhases: 3,
};

const candidate = (over: Partial<AttachCandidateView> = {}): AttachCandidateView => ({
  id: 'f-1',
  slug: 'spring-cup',
  name: ltext('en', 'Spring Cup', 'Frühlingspokal'),
  version_no: 2,
  content_hash: HASH,
  visibility: 'private',
  ownerName: 'Sam',
  mine: true,
  ...over,
});

const CANDIDATES: AttachCandidateView[] = [
  candidate({ id: 'a', slug: 'a', name: ltext('en', 'Mine A', 'Meins A'), mine: true }),
  candidate({ id: 'b', slug: 'b', name: ltext('en', 'Shared B', 'Geteilt B'), mine: false, visibility: 'league', ownerName: 'Robin' }),
  candidate({ id: 'c', slug: 'c', name: ltext('en', 'Gallery C', 'Galerie C'), mine: false, visibility: 'gallery', ownerName: null }),
  candidate({ id: 'd', slug: 'd', name: ltext('en', 'Other D', 'Anderes D'), mine: false, visibility: 'private', ownerName: 'Kim' }),
];

const PANEL: FormatAttachPanelProps = {
  seasonId: S1,
  started: false,
  rulesetId: 'ruleset-1',
  seasonLanguage: 'en',
  manualPhaseCount: 0,
  attached: null,
  candidates: CANDIDATES,
  capped: false,
  phasesHref: PHASES_HREF,
};

const OK_PREVIEW: AttachPreview = {
  ok: true,
  stages: [{ key: 'main', order: 1, name: 'Main', bracketType: 'round_robin', bestOf: 3, doubles: false, ruleset: 'league' }],
  warnings: [],
  leagueRulesetMissing: 0,
};

describe('attachButtonState', () => {
  const ready: AttachButtonInput = { started: false, selected: true, preview: OK_PREVIEW, manualPhaseCount: 0, busy: false };

  it('is enabled when a valid version is chosen on a league that can take it', () => {
    expect(attachButtonState(ready)).toEqual({ enabled: true, reason: null });
  });

  it.each<[string, Partial<AttachButtonInput>, AttachBlockReason]>([
    ['the league has started', { started: true }, 'started'],
    ['nothing is selected', { selected: false, preview: null }, 'nothing_selected'],
    ['the preview is still loading', { preview: null }, 'loading'],
    ['the version has errors', { preview: { ok: false, reason: 'invalid', firstError: 'schema_refine' } }, 'invalid'],
    ['a stage needs the league ruleset and there is none', { preview: { ...OK_PREVIEW, leagueRulesetMissing: 2 } }, 'ruleset_missing'],
    ['the league has hand-made phases', { manualPhaseCount: 1 }, 'manual_phases'],
    ['a request is running', { busy: true }, 'busy'],
  ])('is disabled when %s', (_name, patch, reason) => {
    expect(attachButtonState({ ...ready, ...patch })).toEqual({ enabled: false, reason });
  });

  it('names the first reason when several apply: started, then busy, then the choice, then the league', () => {
    const everything: AttachButtonInput = {
      started: true,
      selected: false,
      preview: null,
      manualPhaseCount: 3,
      busy: true,
    };
    expect(attachButtonState(everything).reason).toBe('started');
    expect(attachButtonState({ ...everything, started: false }).reason).toBe('busy');
    expect(attachButtonState({ ...everything, started: false, busy: false }).reason).toBe('nothing_selected');
    expect(attachButtonState({ ...ready, preview: { ...OK_PREVIEW, leagueRulesetMissing: 1 }, manualPhaseCount: 2 }).reason).toBe(
      'ruleset_missing',
    );
    expect(attachButtonState({ ...ready, manualPhaseCount: 2 }).reason).toBe('manual_phases');
  });
});

describe('picker groups', () => {
  it('yours first, then shared, gallery and other admins; an empty group is left out', () => {
    expect(groupCandidates(CANDIDATES).map((g) => g.group)).toEqual(['mine', 'league', 'gallery', 'others']);
    expect(groupCandidates([CANDIDATES[2], CANDIDATES[0]]).map((g) => g.group)).toEqual(['mine', 'gallery']);
    expect(groupCandidates([])).toEqual([]);
  });

  it('a format of yours is yours whatever its visibility', () => {
    for (const visibility of ['private', 'league', 'gallery'] as const) {
      expect(candidateGroup({ mine: true, visibility })).toBe('mine');
    }
    expect(candidateGroup({ mine: false, visibility: 'private' })).toBe('others');
  });

  it('keeps the order of the input inside a group', () => {
    const two = [candidate({ id: 'x', mine: true }), candidate({ id: 'y', mine: true })];
    expect(groupCandidates(two)[0].items.map((c) => c.id)).toEqual(['x', 'y']);
  });
});

describe('StartedNotice and ManualPhasesNotice', () => {
  it.each(['en', 'de'] as const)('the started notice is a note in %s', (locale) => {
    const html = render(<StartedNotice />, locale);
    const t = createTranslator(formatStudioAttachMessages, locale);
    expect(html).toContain('role="note"');
    expect(html).toContain(esc(t('panel.startedNotice')));
  });

  it('the manual phases notice names the count and links to the Phases tab', () => {
    const html = render(<ManualPhasesNotice count={2} phasesHref={PHASES_HREF} />);
    expect(html).toContain('role="note"');
    expect(html).toContain('This league has 2 hand-made phases. Attaching a format needs a league without them.');
    expect(html).toContain(`href="${PHASES_HREF}"`);
    expect(render(<ManualPhasesNotice count={1} phasesHref={PHASES_HREF} />)).toContain('1 hand-made phase.');
    const de = render(<ManualPhasesNotice count={2} phasesHref={PHASES_HREF} />, 'de');
    expect(de).toContain('2 von Hand angelegte Phasen');
    expect(de).toContain('Phasen öffnen');
  });
});

describe('AttachedSummary', () => {
  it('shows the name, version, hash prefix, frozen time, phases created and the links', () => {
    const html = render(<AttachedSummary attached={ATTACHED} phasesHref={PHASES_HREF} started={false} />);
    expect(html).toContain('Spring Cup');
    expect(html).toContain('Version 2');
    expect(html).toContain(`<code title="${HASH}"`);
    expect(html).toContain(`>${HASH.slice(0, 12)}</code>`);
    expect(html).not.toContain(`>${HASH}</code>`);
    expect(html).toContain('Attached on 9 Oct 2026');
    expect(html).toContain('3 phases created');
    expect(html).toContain(`href="${PHASES_HREF}"`);
    expect(html).toContain('href="/admin/formats/def-1"');
    expect(html).toContain('Open source format');
    expect(html).toContain('Copy');
    expectNoLeftovers(html);
  });

  it('offers Re-attach and Detach while the league has not started', () => {
    const html = render(<AttachedSummary attached={ATTACHED} phasesHref={PHASES_HREF} started={false} />);
    expect(html).toContain('Re-attach…');
    expect(html).toContain('>Detach<');
  });

  it('a started league keeps the summary and loses both buttons', () => {
    const html = render(<AttachedSummary attached={ATTACHED} phasesHref={PHASES_HREF} started />);
    expect(html).toContain('Spring Cup');
    expect(html).not.toContain('Re-attach');
    expect(html).not.toContain('>Detach<');
  });

  it('a deleted source format is a note, not a link', () => {
    const html = render(
      <AttachedSummary attached={{ ...ATTACHED, definition_id: null }} phasesHref={PHASES_HREF} started={false} />,
    );
    expect(html).toContain('The source format was deleted. The league keeps its frozen copy.');
    expect(html).not.toContain('/admin/formats/');
  });

  it('one phase is worded in the singular', () => {
    const html = render(
      <AttachedSummary attached={{ ...ATTACHED, createdPhases: 1 }} phasesHref={PHASES_HREF} started={false} />,
    );
    expect(html).toContain('1 phase created');
  });

  it('German: the name follows the viewer language and the labels are translated', () => {
    const html = render(<AttachedSummary attached={ATTACHED} phasesHref={PHASES_HREF} started={false} />, 'de');
    expect(html).toContain('Frühlingspokal');
    expect(html).toContain('Angehängtes Format');
    expect(html).toContain('Angehängt am 9. Okt. 2026');
    expect(html).toContain('3 Phasen erstellt');
    expect(html).toContain('Neu anhängen …');
    expect(html).toContain('>Format entfernen<');
    expectNoLeftovers(html);
  });
});

describe('Picker', () => {
  it('a labelled select with the formats grouped by where they come from', () => {
    const html = render(<Picker candidates={CANDIDATES} capped={false} selectedId="" onSelect={() => {}} />);
    const id = /<select id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<label for="${id}"`);
    expect(html).toContain('Choose a published format');
    for (const group of ['Your formats', 'Shared with league admins', 'Gallery', 'Formats of other admins']) {
      expect(html).toContain(`<optgroup label="${group}">`);
    }
    expect(html).toContain('>Mine A (version 2, yours)</option>');
    expect(html).toContain('>Shared B (version 2, Robin)</option>');
    expect(html).toContain('>Gallery C (version 2, gallery)</option>');
    expect(html).toContain('>Other D (version 2, Kim)</option>');
    expect(html).not.toContain('Sam');
    expectNoLeftovers(html);
  });

  it('marks the chosen format', () => {
    const html = render(<Picker candidates={CANDIDATES} capped={false} selectedId="b" onSelect={() => {}} />);
    expect(html).toMatch(/<option value="b" selected="">Shared B/);
  });

  it('German: names follow the viewer language, groups are translated', () => {
    const html = render(<Picker candidates={CANDIDATES} capped={false} selectedId="" onSelect={() => {}} />, 'de');
    expect(html).toContain('Veröffentlichtes Format auswählen');
    expect(html).toContain('<optgroup label="Deine Formate">');
    expect(html).toContain('>Meins A (Version 2, von dir)</option>');
    expect(html).toContain('<optgroup label="Mit Liga-Admins geteilt">');
    expectNoLeftovers(html);
  });

  it('a capped list says how many are shown', () => {
    const html = render(<Picker candidates={CANDIDATES} capped selectedId="" onSelect={() => {}} />);
    expect(html).toContain('Showing the first 4 formats only.');
    expect(render(<Picker candidates={CANDIDATES} capped={false} selectedId="" onSelect={() => {}} />)).not.toContain(
      'Showing the first',
    );
  });

  it('no candidates: an empty state with a link to the Format Studio, no select', () => {
    const html = render(<Picker candidates={[]} capped={false} selectedId="" onSelect={() => {}} />);
    expect(html).toContain('No published formats yet');
    expect(html).toContain('href="/admin/formats"');
    expect(html).not.toContain('<select');
    const de = render(<Picker candidates={[]} capped={false} selectedId="" onSelect={() => {}} />, 'de');
    expect(de).toContain('Noch keine veröffentlichten Formate');
  });

  it('can be disabled while a request runs', () => {
    expect(render(<Picker candidates={CANDIDATES} capped={false} selectedId="" onSelect={() => {}} disabled />)).toContain(
      'disabled=""',
    );
  });
});

describe('AttachBlockedReason', () => {
  it.each<[AttachBlockReason, string, string]>([
    ['started', 'This league has started. Its format is locked.', 'Diese Liga hat begonnen. Ihr Format ist gesperrt.'],
    ['nothing_selected', 'Choose a published format first.', 'Wähle zuerst ein veröffentlichtes Format.'],
    ['loading', 'The phases are still loading.', 'Die Phasen werden noch geladen.'],
    [
      'invalid',
      'This version has errors. Pick another one or fix it in the editor first.',
      'Diese Version hat Fehler. Wähle eine andere oder behebe sie zuerst im Editor.',
    ],
    [
      'manual_phases',
      'Remove the hand-made phases on the Phases tab first.',
      'Entferne zuerst die von Hand angelegten Phasen im Tab „Phasen“.',
    ],
    ['busy', 'Working on it…', 'Wird ausgeführt …'],
  ])('%s', (reason, en, de) => {
    expect(render(<AttachBlockedReason reason={reason} id="why" />)).toBe(
      `<p id="why" class="text-sm text-poke-text-muted" data-attach-reason="${reason}">${esc(en)}</p>`,
    );
    expect(render(<AttachBlockedReason reason={reason} />, 'de')).toContain(esc(de));
  });

  it('the ruleset sentence counts the stages that need the league ruleset', () => {
    const one = render(<AttachBlockedReason reason="ruleset_missing" rulesetCount={1} />);
    expect(one).toContain('1 stage uses the league’s default ruleset, but this league has none.');
    expect(one).toContain('Pick a format that names a ruleset for every stage.');
    expect(render(<AttachBlockedReason reason="ruleset_missing" rulesetCount={3} />)).toContain('3 stages use the league’s');
    expect(render(<AttachBlockedReason reason="ruleset_missing" rulesetCount={2} />, 'de')).toContain(
      '2 Stages nutzen das Standard-Regelwerk der Liga',
    );
  });
});

describe('FormatAttachPanel', () => {
  describe('a league that has started', () => {
    const html = render(<FormatAttachPanel {...PANEL} started attached={ATTACHED} />);

    it('keeps the attached summary and the locked notice, with no picker and no change button', () => {
      expect(html).toContain('This league has started. Its format is locked.');
      expect(html).toContain('Spring Cup');
      expect(html).not.toContain('<select');
      expect(html).not.toContain('Re-attach');
      expect(html).not.toContain('>Detach<');
      expect(html).not.toContain('>Attach<');
      expectNoLeftovers(html);
    });

    it('an unattached started league shows only the notice', () => {
      const bare = render(<FormatAttachPanel {...PANEL} started />);
      expect(bare).toContain('This league has started');
      expect(bare).not.toContain('<select');
      expect(bare).not.toContain('<button');
    });

    it('a started league does not show the hand-made phases notice either', () => {
      expect(render(<FormatAttachPanel {...PANEL} started manualPhaseCount={2} />)).not.toContain('hand-made');
    });
  });

  describe('an attached league that has not started', () => {
    const html = render(<FormatAttachPanel {...PANEL} attached={ATTACHED} />);

    it('shows the summary with Re-attach and Detach, and keeps the picker closed', () => {
      expect(html).toContain('Attached format');
      expect(html).toContain('Re-attach…');
      expect(html).toContain('>Detach<');
      expect(html).not.toContain('<select');
    });
  });

  describe('a league with no format', () => {
    const html = render(<FormatAttachPanel {...PANEL} />);
    const t = createTranslator(formatStudioAttachMessages, 'en');

    it('is the anchor of the readiness link and explains what attaching does', () => {
      expect(html).toContain('id="format-attach"');
      expect(html).toContain(esc(t('panel.intro')));
    });

    it('shows the picker and an Attach button that is disabled, with the reason beside it', () => {
      expect(html).toContain('<select');
      const button = /<button[^>]*>[^<]*(?:<svg[^>]*>.*?<\/svg>)?Attach<\/button>/.exec(html)?.[0];
      expect(button, html).toBeTruthy();
      expect(button).toContain('disabled=""');
      const describedBy = /aria-describedby="([^"]+)"/.exec(button as string)?.[1];
      expect(describedBy).toBeTruthy();
      expect(html).toContain(`<p id="${describedBy}"`);
      expect(html).toContain('Choose a published format first.');
      expect(html).toContain('data-attach-reason="nothing_selected"');
    });

    it('does not offer Detach or Re-attach', () => {
      expect(html).not.toContain('Detach');
      expect(html).not.toContain('Re-attach');
    });

    it('hand-made phases: the notice with the Phases link is shown and the button stays disabled', () => {
      const withManual = render(<FormatAttachPanel {...PANEL} manualPhaseCount={2} />);
      expect(withManual).toContain('This league has 2 hand-made phases.');
      expect(withManual).toContain(`href="${PHASES_HREF}"`);
      expect(withManual).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Attach<\/button>/);
    });

    it('a capped list says so', () => {
      expect(render(<FormatAttachPanel {...PANEL} capped />)).toContain('Showing the first 4 formats only.');
    });

    it('no candidates: the empty state replaces the select, and the button is still there, disabled', () => {
      const empty = render(<FormatAttachPanel {...PANEL} candidates={[]} />);
      expect(empty).toContain('No published formats yet');
      expect(empty).not.toContain('<select');
    });

    it('German', () => {
      const de = render(<FormatAttachPanel {...PANEL} manualPhaseCount={1} />, 'de');
      expect(de).toContain('Veröffentlichtes Format auswählen');
      expect(de).toContain('Anhängen');
      expect(de).toContain('Wähle zuerst ein veröffentlichtes Format.');
      expect(de).toContain('1 von Hand angelegte Phase');
      expectNoLeftovers(de);
    });

    it('English: no German is left', () => {
      expect(html).not.toMatch(/Anhängen|Wähle|Phasen/);
      expectNoLeftovers(html);
    });
  });

  it('a re-attach has no leftover state: the markup before any click is the same on every render', () => {
    expect(render(<FormatAttachPanel {...PANEL} attached={ATTACHED} />)).toBe(
      render(<FormatAttachPanel {...PANEL} attached={ATTACHED} />),
    );
  });
});
