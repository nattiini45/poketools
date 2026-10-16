/**
 * Data-surface keep-out, known violators - Mountain (fidelity wave 2, seat
 * 2A; data-surface-keepout.test.ts). Today's measured set, each with the
 * poses that catch it. The stale-entry rule holds (the KNOWN_OCCLUDED law):
 * fix a violator and its key must be deleted here, and no NEW key may be
 * added to hide a regression - move the thing out of the wedge instead.
 */
export const KEEPOUT_KNOWN: Readonly<Record<string, string>> = {
  // Padded data wedges: <item>@<face>. Seat 2G (wave 2) landed the teams Roll-Call Ledger: the
  // plates are deleted and every teams-plate key went with them (no lamp, rope or figure stands in
  // the ledger's wedge); the rest are wave 3-5 relocations (never allowlist a new one).
  'mountain:wedge:figure:podium:0@pulse:board': 'roster ace inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'mountain:wedge:figure:podium:1@pulse:board': 'roster ace inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'mountain:wedge:figure:podium:2@pulse:board': 'roster ace inside the padded pulse:board wedge at 7 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'mountain:wedge:figure:podium:3@pulse:board': 'roster ace inside the padded pulse:board wedge at 7 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'mountain:wedge:figure:podium:4@pulse:board': 'roster ace inside the padded pulse:board wedge at 7 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'mountain:wedge:figure:podium:5@pulse:board': 'roster ace inside the padded pulse:board wedge at 7 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'mountain:wedge:figure:wild:Frigibax@pulse:board': 'wild figure inside the padded pulse:board wedge at 2 poses (pulse:landed390, pulse>roster@0.25:mobile)',
  'mountain:wedge:figure:wild:Nacli@pulse:board': 'wild figure inside the padded pulse:board wedge at 4 poses (pulse:tablet, pulse:landed390, pulse>roster@0.25:tablet, ...)',
  'mountain:wedge:figure:wild:Sneasel@roster:frieze': 'wild figure inside the padded roster:frieze wedge at 4 poses (roster:desktop, roster:tablet, roster:landed390, ...)',
  'mountain:wedge:figure:wild:Teddiursa@roster:frieze': 'wild figure inside the padded roster:frieze wedge at 7 poses (roster:desktop, roster:tablet, roster:landed390, ...)',
  'mountain:wedge:prop:pulse-pennant:1@pulse:board': 'pennant pole inside the padded pulse:board wedge at 3 poses (pulse:tablet, pulse:landed390, pulse>roster@0.25:tablet)',
  // Figure roots in the HUD band or the 3 % edge inset at a station pose.
  'mountain:root:wild:Swinub@teams:tablet': 'figure root in the 3 % edge inset',
  // Figures turned more than 100 degrees away from a station eye (authored yaw).
  'mountain:facing:wild:Avalugg-Hisui@rules:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'mountain:facing:wild:Avalugg-Hisui@rules:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'mountain:facing:wild:Mamoswine@schedule:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'mountain:facing:wild:Mamoswine@schedule:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'mountain:facing:wild:Piloswine@schedule:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'mountain:facing:wild:Piloswine@schedule:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'mountain:facing:wild:Swinub@teams:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'mountain:facing:wild:Swinub@teams:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'mountain:facing:wild:Teddiursa@roster:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'mountain:facing:wild:Teddiursa@roster:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
};
