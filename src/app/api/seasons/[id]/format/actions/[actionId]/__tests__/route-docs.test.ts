import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The route comments are the maintainers' list of what the database can refuse under the player action endpoints. They
// drifted once (the capacity and stale-format refusals were added to the tests and the library header, not here), so a
// refusal a route maps must be named in its comment.
const dir = join(process.cwd(), 'src', 'app', 'api', 'seasons', '[id]', 'format', 'actions', '[actionId]');
const docOf = (file: string) => {
  const text = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  const start = text.indexOf('/**', text.indexOf('interface RouteParams'));
  return text.slice(start, text.indexOf('*/', start));
};

describe('player action route doc comments', () => {
  it('the submit route names every database refusal a submit can 409 on', () => {
    const doc = docOf(join('submit', 'route.ts'));
    for (const code of ['action_locked', 'resource_item_taken', 'resource_capacity_reached', 'format_context_stale']) {
      expect(doc).toContain(`\`${code}\``);
    }
  });

  it('the save route names the refusals a draft save can 409 on', () => {
    const doc = docOf('route.ts');
    for (const code of ['action_locked', 'format_context_stale']) expect(doc).toContain(`\`${code}\``);
  });
});

describe('CHANGELOG migration note', () => {
  it('does not offer re-creating only the functions without the revision column, sequence and trigger', () => {
    const text = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
    const note = text.slice(text.indexOf('The migrations were edited in place'));
    const sentence = note.slice(0, note.indexOf('there is nothing to run'));
    for (const name of ['season_formats.revision', 'season_format_revision_seq', 'trg_season_formats_revision']) {
      expect(sentence).toContain(name);
    }
  });
});
