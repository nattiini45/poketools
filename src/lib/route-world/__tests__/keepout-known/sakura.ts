/**
 * Data-surface keep-out, known violators - Sakura (fidelity wave 2, seat
 * 2A; data-surface-keepout.test.ts). Today's measured set, each with the
 * poses that catch it. The stale-entry rule holds (the KNOWN_OCCLUDED law):
 * fix a violator and its key must be deleted here, and no NEW key may be
 * added to hide a regression - move the thing out of the wedge instead.
 */
export const KEEPOUT_KNOWN: Readonly<Record<string, string>> = {
  // Padded data wedges: <item>@<face>. Seat 2G (wave 2) landed the teams Roll-Call Ledger: the
  // plates are deleted and every teams-plate key went with them (no lamp, rope or figure stands in
  // the ledger's wedge); the rest are wave 3-5 relocations (never allowlist a new one).
  'sakura:wedge:figure:grandstand:0@pulse:board': 'roster ace inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:figure:grandstand:1@pulse:board': 'roster ace inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:figure:grandstand:2@pulse:board': 'roster ace inside the padded pulse:board wedge at 6 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:figure:grandstand:2@schedule:banner:0': 'roster ace inside the padded schedule:banner:0 wedge at 1 pose (schedule:banner:0:focus:390)',
  'sakura:wedge:figure:grandstand:3@pulse:board': 'roster ace inside the padded pulse:board wedge at 3 poses (pulse:tablet, pulse:landed390, pulse:board:focus:1440)',
  'sakura:wedge:figure:grandstand:3@schedule:banner:0': 'roster ace inside the padded schedule:banner:0 wedge at 4 poses (schedule:desktop, schedule:tablet, schedule:banner:0:focus:1440, ...)',
  'sakura:wedge:figure:grandstand:5@pulse:board': 'roster ace inside the padded pulse:board wedge at 6 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:figure:grandstand:6@pulse:board': 'roster ace inside the padded pulse:board wedge at 5 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:figure:grandstand:7@pulse:board': 'roster ace inside the padded pulse:board wedge at 1 pose (pulse:landed390)',
  'sakura:wedge:figure:grandstand:7@schedule:banner:0': 'roster ace inside the padded schedule:banner:0 wedge at 4 poses (schedule:desktop, schedule:tablet, schedule:banner:0:focus:1440, ...)',
  'sakura:wedge:figure:wild:Gyarados@schedule:banner:3': 'wild figure inside the padded schedule:banner:3 wedge at 11 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
  'sakura:wedge:figure:wild:Gyarados@schedule:banner:4': 'wild figure inside the padded schedule:banner:4 wedge at 14 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
  'sakura:wedge:figure:wild:Poliwag@roster:wall': 'wild figure inside the padded roster:wall wedge at 8 poses (roster:desktop, roster:tablet, roster:landed390, ...)',
  'sakura:wedge:figure:wild:Psyduck@roster:wall': 'wild figure inside the padded roster:wall wedge at 8 poses (roster:desktop, roster:tablet, roster:landed390, ...)',
  'sakura:wedge:figure:wild:Vaporeon@pulse:board': 'wild figure inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:figure:wild:Vaporeon@schedule:banner:0': 'wild figure inside the padded schedule:banner:0 wedge at 1 pose (schedule:banner:0:focus:390)',
  'sakura:wedge:prop:bridge:rail:-1@schedule:banner:1': 'bridge rail inside the padded schedule:banner:1 wedge at 1 pose (teams>schedule@0.75:desktop)',
  'sakura:wedge:prop:bridge:rail:-1@schedule:banner:2': 'bridge rail inside the padded schedule:banner:2 wedge at 7 poses (schedule:tablet, schedule:landed390, schedule:banner:2:focus:390, ...)',
  'sakura:wedge:prop:bridge:rail:-1@schedule:banner:3': 'bridge rail inside the padded schedule:banner:3 wedge at 7 poses (schedule:tablet, schedule:landed390, schedule:banner:3:focus:390, ...)',
  'sakura:wedge:prop:bridge:rail:-1@schedule:banner:4': 'bridge rail inside the padded schedule:banner:4 wedge at 9 poses (schedule:tablet, schedule:landed390, teams>schedule@0.5:desktop, ...)',
  'sakura:wedge:prop:bridge:rail:1@schedule:banner:2': 'bridge rail inside the padded schedule:banner:2 wedge at 9 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
  'sakura:wedge:prop:bridge:rail:1@schedule:banner:3': 'bridge rail inside the padded schedule:banner:3 wedge at 10 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
  'sakura:wedge:prop:bridge:rail:1@schedule:banner:4': 'bridge rail inside the padded schedule:banner:4 wedge at 13 poses (schedule:desktop, schedule:tablet, schedule:landed390, ...)',
  'sakura:wedge:prop:pulse-fence:post:3@pulse:board': 'fence inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:prop:pulse-fence:post:4@pulse:board': 'fence inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:prop:pulse-fence:rail:0@pulse:board': 'fence inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:prop:pulse-fence:rail:1@pulse:board': 'fence inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:prop:pulse-lantern:1@pulse:board': 'lamp inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  'sakura:wedge:prop:pulse-signpost@pulse:board': 'signpost inside the padded pulse:board wedge at 8 poses (pulse:desktop, pulse:tablet, pulse:landed390, ...)',
  // Figure roots in the HUD band or the 3 % edge inset at a station pose.
  'sakura:root:wild:Gyarados@schedule:landed390': 'figure root in the 3 % edge inset',
  // Figures turned more than 100 degrees away from a station eye (authored yaw).
  'sakura:facing:wild:Ariados@rules:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Ariados@rules:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Azumarill@schedule:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Azumarill@schedule:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Grubbin@rules:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Grubbin@rules:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Gyarados@schedule:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Gyarados@schedule:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Lombre@pulse:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Poliwag@roster:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Poliwag@roster:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Slowpoke@schedule:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Slowpoke@schedule:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Venonat@rules:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Venonat@rules:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Wartortle@rules:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Wartortle@rules:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Wingull@schedule:desktop': 'authored yaw turns its back to the eye (> 100 degrees off)',
  'sakura:facing:wild:Wingull@schedule:landed390': 'authored yaw turns its back to the eye (> 100 degrees off)',
};
