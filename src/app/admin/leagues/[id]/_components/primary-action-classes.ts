/** The link or button around the header's primary action plate: the plate brightens on hover and dips when pressed. */
export const PRIMARY_ACTION_TARGET =
  'inline-flex max-w-full rounded-sm active:translate-y-px [&_.skew-plate-bg]:motion-safe:transition-[filter] [&_.skew-plate-bg]:motion-safe:duration-80 hover:[&_.skew-plate-bg]:brightness-105 active:[&_.skew-plate-bg]:brightness-95';

/** The plate itself: 44 px tall on a phone, 36 px from `sm` up; the label never wraps or gets a fixed width. */
export const PRIMARY_ACTION_PLATE = 'min-h-11 whitespace-nowrap px-4 text-body sm:min-h-9';
