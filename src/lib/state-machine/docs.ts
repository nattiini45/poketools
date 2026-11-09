import type { MachineSpec } from './machine';

export const STATE_MACHINES_DOC_PATH = 'docs/state-machines.md';

const HEADER = `# State machines

<!-- Generated from src/lib/state-machine/registry.ts by \`npm run docs:state-machines\`. Do not edit by hand: change the machine's definition and regenerate. src/lib/state-machine/__tests__/docs.test.ts fails when this file is stale. -->

Each machine below is a column, timestamp or flag combination that moves through states, defined once, as data, with \`defineMachine\` (\`src/lib/state-machine/machine.ts\`). The rules for writers are in AGENTS.md ("Transitions go through the machine"); the decision is ADR 0004 (\`docs/adr/0004-explicit-state-machines.md\`).

- A writer calls \`machine.assertTransition(from, to, actor)\` before it writes, and guards the UPDATE with the source states (\`.in(column, machine.sourcesOf(to))\`, or \`.eq(column, from)\`), so a row that moved on in between is not overwritten.
- UI derives the available actions from \`machine.transitionsFrom(state, actor)\` instead of re-listing statuses.
- A refused move is an \`IllegalTransitionError\` (409, or 403 for the wrong actor) with a catalog code.
`;

const label = (spec: MachineSpec<string, string>, actors: readonly string[], event: string) =>
  actors.length === spec.actors.length ? event : `${event} (${actors.join(', ')})`;

const cell = (value: string) => value.replace(/\|/g, '\\|');

function renderMachine(spec: MachineSpec<string, string>): string {
  const lines: string[] = [];
  lines.push(`## ${spec.title}`, '');
  lines.push(`- **Id:** \`${spec.id}\``);
  lines.push(`- **State lives in:** ${spec.storage}`);
  if (spec.doc) lines.push(`- **Module doc:** \`${spec.doc}\``);
  lines.push(`- **States:** ${spec.states.map((s) => `\`${s}\``).join(', ')}`);
  lines.push(`- **Actors:** ${spec.actors.map((a) => `\`${a}\``).join(', ')}`);
  lines.push('', spec.summary, '');
  lines.push('```mermaid', 'stateDiagram-v2');
  for (const s of spec.initial) lines.push(`  [*] --> ${s}`);
  for (const t of spec.transitions) {
    for (const from of t.from) lines.push(`  ${from} --> ${t.to}: ${label(spec, t.actors, t.event)}`);
  }
  for (const s of spec.terminal) lines.push(`  ${s} --> [*]`);
  lines.push('```', '');
  lines.push('| Event | From | To | Actors | Writers | Note |', '| --- | --- | --- | --- | --- | --- |');
  for (const t of spec.transitions) {
    lines.push(
      `| \`${t.event}\` | ${t.from.map((s) => `\`${s}\``).join(', ')} | \`${t.to}\` | ${t.actors.join(', ')} | ${t.writers
        .map((w) => `\`${cell(w)}\``)
        .join('<br>')} | ${cell(t.note ?? '')} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** The whole of docs/state-machines.md: deterministic, so the docs test can compare it byte for byte. */
export function renderStateMachinesDoc(machines: readonly MachineSpec<string, string>[]): string {
  const sorted = [...machines].sort((a, b) => a.id.localeCompare(b.id));
  const index = sorted.map((m) => `- [${m.title}](#${m.title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')}) — \`${m.storage}\``);
  return [HEADER, '## Machines', '', ...index, '', ...sorted.map(renderMachine)].join('\n');
}
