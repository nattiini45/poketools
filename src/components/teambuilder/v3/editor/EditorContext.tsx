'use client';

import { createContext, useContext } from 'react';
import type { EditorState, EditorAction } from './state';

interface EditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorContext must be used within TeamsEditor');
  return ctx;
}
