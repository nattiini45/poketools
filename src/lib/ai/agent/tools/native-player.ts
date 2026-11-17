import { z } from 'zod';
import { buildNativePlayerContext, getNativePlayerHistory, getNativePlayerHeadToHead,
  getNativePlayerTeams, nativePlayerContextSchema } from '../native-context';

export function createNativePlayerTools(input: unknown) {
  const context = nativePlayerContextSchema.parse(input);
  const bind = (name: string, description: string, execute: (context: unknown) => Promise<unknown>) => ({
    name,
    description,
    inputSchema: z.strictObject({}),
    execute: async (rawInput: unknown) => {
      z.strictObject({}).parse(rawInput);
      return execute(context);
    },
  });
  return {
    getPhaseMatchContext: bind('getPhaseMatchContext', 'Read the bound native match context for the current participant.', buildNativePlayerContext),
    getPhaseMatchHistory: bind('getPhaseMatchHistory', 'Read a bounded sample of your completed native phase matches.', getNativePlayerHistory),
    getPhaseHeadToHead: bind('getPhaseHeadToHead', 'Read a bounded sample against the bound opponent in this native phase.', getNativePlayerHeadToHead),
    getPhaseMatchTeams: bind('getPhaseMatchTeams', 'Read your preparation and publicly visible opponent roster for the bound match.', getNativePlayerTeams),
  };
}
