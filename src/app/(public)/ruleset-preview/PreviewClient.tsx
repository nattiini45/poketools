'use client';

import { useEffect, useRef } from 'react';
import RulesetEditor, { type RulesetEditorProps } from '@/components/ruleset-studio/editor/RulesetEditor';
import { createFakeLibrary, type FakeLibraryState } from './fake-library';

interface PreviewClientProps {
  editor: RulesetEditorProps;
}

/**
 * The real Ruleset Studio editor over a fixture draft. While it is mounted, `fetch` answers the ruleset library routes
 * (save, reload, publish) from memory, so the dev page needs no database and spends no Supabase quota; every other request
 * (the entry catalog, the preset rules) goes to the real, dex-only routes.
 */
export default function PreviewClient({ editor }: PreviewClientProps) {
  const state = useRef<FakeLibraryState>({ definitionId: editor.definitionId, rev: editor.initial.draftRev, document: editor.initial.document, versions: editor.published?.versionNo ?? 0 });

  useEffect(() => {
    const original = window.fetch;
    window.fetch = createFakeLibrary(state.current, original.bind(window));
    return () => {
      window.fetch = original;
    };
  }, []);

  return <RulesetEditor {...editor} />;
}
