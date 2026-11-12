'use client';

import { createContext, useContext } from 'react';

const CompetitionQueryContext = createContext('');

/** The search text of the enclosing `CompetitionList` (empty outside one), so the trash rows filter with it too. */
export const CompetitionQueryProvider = CompetitionQueryContext.Provider;

export function useCompetitionQuery(): string {
  return useContext(CompetitionQueryContext);
}
