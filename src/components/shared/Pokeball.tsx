import { cn } from '@/lib/utils/cn';

/**
 * Pure-CSS Pokéball mark. Decorative only, never the app accent: every colour is a static art ink (`art.ball-red`,
 * `art.ball-ink`, `art.ball-shell`), never a palette token, so the ball looks the same in every site palette and
 * in both themes. Size it with `h-*`/`w-*`; the outline, band and button scale with it.
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
    <span aria-hidden="true" className={cn('relative block rounded-full bg-art-ball-ink', className)}>
      <span className="absolute inset-[4%] overflow-hidden rounded-full bg-art-ball-ink">
        {/* top half */}
        <span
          className={cn(
            'absolute inset-x-0 top-0 h-[46%] bg-art-ball-red',
            interactive &&
              'transition-transform duration-300 ease-out group-hover:-translate-y-[55%] group-hover:-rotate-6 motion-reduce:transform-none'
          )}
        >
          {/* gloss */}
          <span className="absolute left-[18%] top-[22%] h-[30%] w-[22%] rounded-full bg-art-ball-shell opacity-40" />
        </span>
        {/* bottom half */}
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 h-[46%] bg-art-ball-shell',
            interactive &&
              'transition-transform duration-300 ease-out group-hover:translate-y-[55%] group-hover:rotate-6 motion-reduce:transform-none'
          )}
        />
        {/* button: the ink ring is the band's colour, so the band needs no element of its own */}
        <span className="absolute left-1/2 top-1/2 h-[32%] w-[32%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-art-ball-ink">
          <span className="absolute inset-[22%] rounded-full bg-art-ball-shell" />
        </span>
      </span>
    </span>
  );
}
