---
status: accepted
date: 2026-09-02
---

# Focus: scroll keeps the stations, tap gives the zoom

The route-world bible made page scroll the only macro control and the canvas `pointer-events: none`; there was no way to get closer to anything, so the previous board pulled the station cameras into the jumbotrons (6.4 m dead-on) to make board text legible, and the plaza disappeared from the frame. We decided to keep page scroll as the station conductor (the DOM-in-document-order structure and the Lite tier depend on it) and add one new interaction, Focus: tapping a Subject (a Board, an Ace, the desk PC, a gate plaque) blends the camera to a framing computed from the Subject's real bounds, allows bounded drag-orbit (±25° yaw, ±10° pitch) and pinch / ctrl+wheel dolly (0.6–1.8× the framing distance), and opens the existing `?team=` / `?mon=` overlay (or the new `?board=` panel) restyled as a teal-glass Focus panel docked beside the Subject. Esc, tap-away, or a page scroll releases Focus. Station views therefore stay plaza-framed (a Board fills 50–60% of the frame with plaza around it) and full legibility lives in Focus, where a 0.4 m Pichu and a 6.5 m Gyarados each get a framing that fits.

## Considered options

- Drop page scroll and make the page a game-style canvas (WorldNav chips drive cinematic moves, wheel = dolly): rejected for this project; it breaks the structural contract of the shipped page and needs a new accessibility story. Recorded as a possible follow-up.
- Free OrbitControls everywhere: rejected; unbounded orbit destroys authored compositions and fights the conductor.
- In-canvas panels (`drei/Html` or textures) instead of the existing overlays: rejected; the DOM overlays already carry the URL contract and keyboard/dialog semantics the spec requires.

## Consequences

- The canvas receives pointer events in the Route tier (the hidden DOM sections beneath it are not interactive there anyway); the WorldNav HUD stays above it.
- While a Subject is focused, wheel input is captured for dolly and page scroll is suspended until release, so Focus can never leave the conductor and the camera disagreeing.
- Every Subject must be a named proxy with computed bounds; ambient figures are deliberately not Subjects.
