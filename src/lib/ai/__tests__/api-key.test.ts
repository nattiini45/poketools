import { afterEach, describe, expect, it } from 'vitest';
import { anthropicApiKey } from '../api-key';

const saved = { a: process.env.ANTHROPIC_API_KEY, c: process.env.CLAUDE_API_KEY };

afterEach(() => {
  if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved.a;
  if (saved.c === undefined) delete process.env.CLAUDE_API_KEY;
  else process.env.CLAUDE_API_KEY = saved.c;
});

describe('anthropicApiKey', () => {
  it('prefers ANTHROPIC_API_KEY', () => {
    process.env.ANTHROPIC_API_KEY = 'new';
    process.env.CLAUDE_API_KEY = 'old';
    expect(anthropicApiKey()).toBe('new');
  });

  it('falls back to the deprecated CLAUDE_API_KEY', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_API_KEY = 'old';
    expect(anthropicApiKey()).toBe('old');
  });

  it('treats whitespace as unset', () => {
    process.env.ANTHROPIC_API_KEY = '   ';
    process.env.CLAUDE_API_KEY = ' old ';
    expect(anthropicApiKey()).toBe('old');
    delete process.env.CLAUDE_API_KEY;
    expect(anthropicApiKey()).toBe('');
  });
});
