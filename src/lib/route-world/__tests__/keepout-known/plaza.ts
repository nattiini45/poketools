/**
 * Data-surface keep-out, known violators - Plaza (fidelity wave 2, seat
 * 2A; data-surface-keepout.test.ts). Today's measured set, each with the
 * poses that catch it. The stale-entry rule holds (the KNOWN_OCCLUDED law):
 * fix a violator and its key must be deleted here, and no NEW key may be
 * added to hide a regression - move the thing out of the wedge instead.
 */
export const KEEPOUT_KNOWN: Readonly<Record<string, string>> = {
  // Padded data wedges: <item>@<face>. Seat 2G (wave 2) landed the teams Roll-Call Ledger: the
  // plates are deleted and every teams-plate key went with them (no lamp, rope or figure stands in
  // the ledger's wedge); the rest are wave 3-5 relocations (never allowlist a new one).
  'plaza:wedge:figure:loiter:4@rules:plaque:left': 'loiter spot inside the padded rules:plaque:left wedge at 2 poses (rules:tablet, rules:landed390)',
  'plaza:wedge:figure:loiter:5@rules:plaque:right': 'loiter spot inside the padded rules:plaque:right wedge at 2 poses (rules:tablet, rules:landed390)',
  'plaza:wedge:lane:walker:crossing@pulse:board': 'walker lane inside the padded pulse:board wedge at 4 poses (pulse:tablet, pulse:landed390, pulse>roster@0.25:tablet, ...)',
  'plaza:wedge:lane:walker:crossing@schedule:board': 'walker lane inside the padded schedule:board wedge at 5 poses (schedule:tablet, schedule:landed390, schedule:board:focus:390, ...)',
  'plaza:wedge:lane:walker:pulse-east-pocket@pulse:board': 'walker lane inside the padded pulse:board wedge at 7 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'plaza:wedge:lane:walker:pulse-east-pocket@schedule:board': 'walker lane inside the padded schedule:board wedge at 1 pose (schedule:landed390)',
  'plaza:wedge:lane:walker:pulse-mid-pocket@pulse:board': 'walker lane inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'plaza:wedge:lane:walker:pulse-west-pocket@pulse:board': 'walker lane inside the padded pulse:board wedge at 1 pose (pulse>roster@0.25:desktop)',
  'plaza:wedge:lane:walker:roster-north-pocket@roster:kiosk': 'walker lane inside the padded roster:kiosk wedge at 9 poses (roster:desktop, roster:tablet, roster:landed390, ...)',
  'plaza:wedge:lane:walker:rules-east-pocket@rules:plaque:right': 'walker lane inside the padded rules:plaque:right wedge at 7 poses (rules:desktop, rules:tablet, rules:landed390, ...)',
  'plaza:wedge:lane:walker:rules-west-pocket@rules:plaque:left': 'walker lane inside the padded rules:plaque:left wedge at 5 poses (rules:desktop, rules:tablet, rules:landed390, ...)',
  'plaza:wedge:lane:walker:schedule-east-pocket@schedule:board': 'walker lane inside the padded schedule:board wedge at 7 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
  'plaza:wedge:lane:walker:schedule-mid-pocket@schedule:board': 'walker lane inside the padded schedule:board wedge at 8 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
  'plaza:wedge:lane:walker:schedule-west-pocket@schedule:board': 'walker lane inside the padded schedule:board wedge at 1 pose (teams>schedule@0.75:desktop)',
  'plaza:wedge:lane:walker:south-loop@rules:plaque:left': 'walker lane inside the padded rules:plaque:left wedge at 4 poses (rules:desktop, rules:tablet, rules:landed390, ...)',
  'plaza:wedge:lane:walker:south-loop@rules:plaque:right': 'walker lane inside the padded rules:plaque:right wedge at 7 poses (rules:desktop, rules:tablet, rules:landed390, ...)',
  // Wave-2 r2 (LAW): the REGELWERK passage board is now declared (`rules:field`). These two walker
  // lanes already crossed it before the face existed - measured, not new placement; the lane move
  // belongs to the ambient-lane owner (ambient.ts AMBIENT_PATHS).
  'plaza:wedge:lane:walker:rules-center-pocket@rules:field': 'walker lane inside the padded rules:field wedge at 5 poses (rules:desktop, rules:tablet, rules:landed390, rules:field:focus:1440, rules:field:focus:390); pre-existing lane, first measured when rules:field was declared',
  'plaza:wedge:lane:walker:south-loop@rules:field': 'walker lane inside the padded rules:field wedge at 5 poses (rules:desktop, rules:tablet, rules:landed390, rules:field:focus:1440, rules:field:focus:390); pre-existing lane, first measured when rules:field was declared',
  'plaza:wedge:prop:hero:led-board-cabinet@schedule:board': 'hero prop inside the padded schedule:board wedge at 8 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
};
