/**
 * Data-surface keep-out, known violators - Clouds (fidelity wave 2, seat
 * 2A; data-surface-keepout.test.ts). Today's measured set, each with the
 * poses that catch it. The stale-entry rule holds (the KNOWN_OCCLUDED law):
 * fix a violator and its key must be deleted here, and no NEW key may be
 * added to hide a regression - move the thing out of the wedge instead.
 */
export const KEEPOUT_KNOWN: Readonly<Record<string, string>> = {
  // Padded data wedges: <item>@<face>. Seat 2G (wave 2) landed the teams Roll-Call Ledger: the
  // plates are deleted and every teams-plate key went with them (no lamp, rope or figure stands in
  // the ledger's wedge); the rest are wave 3-5 relocations (never allowlist a new one).
  'clouds:wedge:figure:wild:Braviary-Hisui@roster:board': 'wild figure inside the padded roster:board wedge at 7 poses (roster:desktop, roster:tablet, roster:landed390, ...)',
  'clouds:wedge:figure:wild:Haunter@rules:tablet': 'wild figure inside the padded rules:tablet wedge at 1 pose (rules:desktop)',
  'clouds:wedge:figure:wild:Jolteon@roster:board': 'wild figure inside the padded roster:board wedge at 7 poses (roster:desktop, roster:tablet, roster:landed390, ...)',
  'clouds:wedge:figure:wild:Lugia@rules:tablet': 'wild figure inside the padded rules:tablet wedge at 5 poses (rules:desktop, rules:tablet, rules:landed390, ...)',
  'clouds:wedge:figure:wild:Pawmi@schedule:board': 'wild figure inside the padded schedule:board wedge at 8 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
  'clouds:wedge:figure:wild:Pawmot@schedule:board': 'wild figure inside the padded schedule:board wedge at 8 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
  'clouds:wedge:prop:mooring:rules@rules:tablet': 'mooring mast inside the padded rules:tablet wedge at 5 poses (rules:desktop, rules:tablet, rules:landed390, ...)',
  // Figures turned more than 100 degrees away from a station eye (authored yaw).
  'clouds:facing:wild:Braviary-Hisui@roster:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'clouds:facing:wild:Cosmog@teams:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'clouds:facing:wild:Cosmog@teams:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'clouds:facing:wild:Pawmi@schedule:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'clouds:facing:wild:Pawmi@schedule:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'clouds:facing:wild:Pawmot@schedule:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'clouds:facing:wild:Pawmot@schedule:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
};
