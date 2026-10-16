import { describe, it, expect } from 'vitest';
import { createTranslator } from '@/i18n/core';
import { agentMessages } from '@/i18n/messages/agent';
import {
  buildChatBody,
  chatErrorKeyForStatus,
  errorMessageForStatus,
  extractShowdownBlocks,
  splitBoldSegments,
  LINDEN_PERSONA,
  RATE_LIMIT_MESSAGE,
  AUTH_ERROR_MESSAGE,
  GENERIC_ERROR_MESSAGE,
  type ChatMessage,
} from '../agentChat';

describe('buildChatBody', () => {
  it('replays the full thread with the teambuilding persona', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'build me a team' },
    ];
    expect(buildChatBody(messages)).toEqual({
      messages,
      persona: LINDEN_PERSONA,
    });
    expect(LINDEN_PERSONA).toBe('linden_teambuilding');
  });

  it('strips any extra fields down to role + content', () => {
    const messages = [
      { role: 'user', content: 'x', extra: 'nope' },
    ] as unknown as ChatMessage[];
    const body = buildChatBody(messages);
    expect(body.messages).toEqual([{ role: 'user', content: 'x' }]);
    expect(Object.keys(body.messages[0])).toEqual(['role', 'content']);
  });

  it('omits conversation_id and context when no options are given', () => {
    const body = buildChatBody([{ role: 'user', content: 'hi' }]);
    expect(body).not.toHaveProperty('conversation_id');
    expect(body).not.toHaveProperty('context');
  });

  it('includes a supplied conversation id for continuity', () => {
    const body = buildChatBody([{ role: 'user', content: 'hi' }], { conversationId: 'conv-9' });
    expect(body.conversation_id).toBe('conv-9');
  });

  it('forwards only the non-empty context fields', () => {
    const body = buildChatBody([{ role: 'user', content: 'hi' }], {
      context: { format: 'gen9ou', team_id: undefined },
    });
    expect(body.context).toEqual({ format: 'gen9ou' });
  });
});

describe('extractShowdownBlocks', () => {
  it('returns fenced blocks that look like a Showdown paste', () => {
    const text =
      'Here you go:\n```\nGarchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 4 Def / 252 Spe\n- Earthquake\n```';
    const blocks = extractShowdownBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('Garchomp @ Choice Scarf');
  });

  it('ignores fenced blocks that are not Showdown sets', () => {
    expect(extractShowdownBlocks('```\njust some code\n```')).toEqual([]);
  });

  it('returns nothing when there are no code fences', () => {
    expect(extractShowdownBlocks('Garchomp is weak to Ice.')).toEqual([]);
  });
});

describe('errorMessageForStatus', () => {
  it('maps 429 to the friendly daily-limit message', () => {
    expect(errorMessageForStatus(429)).toBe(RATE_LIMIT_MESSAGE);
  });

  it('maps auth failures to the sign-in message', () => {
    expect(errorMessageForStatus(401)).toBe(AUTH_ERROR_MESSAGE);
    expect(errorMessageForStatus(403)).toBe(AUTH_ERROR_MESSAGE);
  });

  it('maps statuses to agent.errors keys, translated in both languages', () => {
    expect(chatErrorKeyForStatus(429)).toBe('rateLimited');
    expect(chatErrorKeyForStatus(401)).toBe('signInRequired');
    expect(chatErrorKeyForStatus(403)).toBe('signInRequired');
    expect(chatErrorKeyForStatus(500)).toBe('unavailable');
    const de = createTranslator(agentMessages, 'de');
    expect(de(`errors.${chatErrorKeyForStatus(429)}`)).toContain('Chat-Limit');
    expect(createTranslator(agentMessages, 'en')(`errors.${chatErrorKeyForStatus(429)}`)).toBe(RATE_LIMIT_MESSAGE);
  });

  it('falls back to a generic message for everything else', () => {
    expect(errorMessageForStatus(500)).toBe(GENERIC_ERROR_MESSAGE);
    expect(errorMessageForStatus(400)).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe('splitBoldSegments', () => {
  it('returns a single plain segment when there is no markup', () => {
    expect(splitBoldSegments('just text')).toEqual([{ text: 'just text', bold: false }]);
  });

  it('marks the run between ** markers as bold', () => {
    expect(splitBoldSegments('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
  });

  it('drops empty fragments (e.g. leading bold)', () => {
    expect(splitBoldSegments('**bold** rest')).toEqual([
      { text: 'bold', bold: true },
      { text: ' rest', bold: false },
    ]);
  });

  it('returns no segments for an empty line', () => {
    expect(splitBoldSegments('')).toEqual([]);
  });
});
