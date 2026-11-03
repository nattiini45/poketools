'use client';

/** Copies the Showdown paste; the only interactive part of the shared-team page. */
export default function CopyPasteButton({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
      }}
      className="mt-2 px-3 py-1.5 text-xs bg-poke-blue text-poke-on-blue rounded-poke-md hover:bg-poke-blue/80 transition-colors"
    >
      {label}
    </button>
  );
}