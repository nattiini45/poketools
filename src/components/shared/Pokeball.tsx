import { cn } from '@/lib/utils/cn';

/**
 * Pure-CSS Pokéball mark. Decorative only — never the app accent; the red
 * half is the franchise ball red (static `art.ball-red`, never a palette
 * token, so it stays the same in every site palette), the rest is
 * sand-neutral.
 * `interactive` halves spring apart on group hover (transform-only, reduced
 * motion safe) so it can double as a section divider easter egg.
 */
export default function Pokeball({
  className,
  interactive = false,
}: {
  className?: string;
  interactive?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('relative block overflow-hidden rounded-full border-2 border-poke-inverse/70 bg-poke-surface shadow-poke-md', className)}
    >
      {/* top half */}
      <span
        className={cn(
          'absolute inset-x-0 top-0 h-1/2 bg-art-ball-red',
          interactive &&
            'transition-transform duration-300 ease-out group-hover:-translate-y-[55%] group-hover:-rotate-6 motion-reduce:transform-none'
        )}
      />
      {/* bottom half */}
      <span
        className={cn(
          'absolute inset-x-0 bottom-0 h-1/2 bg-poke-surface',
          interactive &&
            'transition-transform duration-300 ease-out group-hover:translate-y-[55%] group-hover:rotate-6 motion-reduce:transform-none'
        )}
      />
      {/* equator band */}
      <span className="absolute inset-x-0 top-1/2 h-[14%] -translate-y-1/2 bg-poke-inverse/80" />
      {/* button */}
      <span className="absolute left-1/2 top-1/2 h-[30%] w-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-poke-inverse/80 bg-poke-surface">
        <span className="absolute left-1/2 top-1/2 h-1/2 w-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-poke-inverse/60" />
      </span>
      {/* gloss */}
      <span className="absolute left-[16%] top-[10%] h-[22%] w-[30%] rounded-full bg-white/40 blur-[2px]" />
    </span>
  );
}
