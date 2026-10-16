'use client';

import { useState, useCallback } from 'react';
import { captureNodeAsDataUrl } from '@/lib/utils/capture-node';
import { useT } from '@/i18n/client';
import { matchMessages } from '@/i18n/messages/match';

interface ExportCardButtonProps {
  targetId: string;
  filename: string;
}

export default function ExportCardButton({ targetId, filename }: ExportCardButtonProps) {
  const t = useT(matchMessages);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (exporting) return;

    setExporting(true);
    try {
      const dataUrl = await captureNodeAsDataUrl(targetId);

      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export match card:', err);
    } finally {
      setExporting(false);
    }
  }, [exporting, targetId, filename]);

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-poke-md text-xs font-heading text-poke-text-muted hover:text-poke-text-secondary hover:bg-poke-muted transition-colors disabled:opacity-50"
      title={t('exportCard.title')}
    >
      {exporting ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
        </svg>
      )}
      {exporting ? t('exportCard.exporting') : t('exportCard.save')}
    </button>
  );
}
