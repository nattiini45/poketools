import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The phase of one form submission (`useSubmitPhase`, `src/lib/ui/use-submit-phase.ts`). `done` is a success that
 * leaves the page (a create that navigates, an import that finished): nothing leaves it, so the submit button stays
 * disabled until the navigation or a new form (a new `resetKey`) replaces it. A success that keeps the form open (an
 * edit save, a dry run) goes back to `idle`.
 */
export const SUBMIT_PHASES = ['idle', 'submitting', 'done', 'failed'] as const;
export type SubmitPhase = (typeof SUBMIT_PHASES)[number];
/** What a submission tells the hook when it lands. */
export type SubmitOutcome = Exclude<SubmitPhase, 'submitting'>;

const HOOK = 'src/lib/ui/use-submit-phase.ts';
const FORMS = [
  HOOK,
  'src/components/tournament/TournamentForm.tsx',
  'src/components/league/wizard/NewCompetitionWizard.tsx',
  'src/components/league/EpbImportPanel.tsx',
];

export const submitPhaseMachine = defineMachine({
  id: 'client.submit_phase',
  title: 'Form submission',
  storage: 'client: useSubmitPhase (TournamentForm, NewCompetitionWizard, EpbImportPanel)',
  summary:
    'One submission at a time. A failure stays retryable; a success that navigates away is final, so a second click while the next page loads cannot create the same tournament or league twice.',
  states: SUBMIT_PHASES,
  initial: ['idle'],
  terminal: ['done'],
  actors: ['viewer', 'request'],
  transitions: [
    { event: 'submit', from: ['idle', 'failed'], to: 'submitting', actors: ['viewer'], writers: FORMS },
    { event: 'succeed', from: ['submitting'], to: 'done', actors: ['request'], writers: FORMS, note: 'A create that navigates, a live import.' },
    { event: 'settle', from: ['submitting'], to: 'idle', actors: ['request'], writers: FORMS, note: 'A success that keeps the form open: an edit save, a dry run.' },
    { event: 'fail', from: ['submitting'], to: 'failed', actors: ['request'], writers: FORMS, note: 'The form shows the error; a retry is a new submit.' },
  ],
});
