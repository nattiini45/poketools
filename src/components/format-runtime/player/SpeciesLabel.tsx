'use client';

import type { ReactElement } from 'react';
import { useDataLocale } from '@/i18n/client';
import { speciesDisplayName } from './entry-names';

/** The name of a domain entry (a species id) in the viewer's Pokémon-data language. */
export default function SpeciesLabel({ id }: { id: string }): ReactElement {
  return <>{speciesDisplayName(id, useDataLocale())}</>;
}
