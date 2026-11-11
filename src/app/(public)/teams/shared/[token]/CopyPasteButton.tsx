'use client';

import { Copy } from 'lucide-react';
import Button from '@/components/ui/Button';

/** Copies the Showdown paste; the only interactive part of the shared-team page. */
export default function CopyPasteButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      className="max-sm:h-11"
      onClick={() => {
        void navigator.clipboard.writeText(text);
      }}
    >
      <Copy className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
