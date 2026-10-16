# EvoLiga Route World

The 3D League Challenge plaza layered over the EvoLiga league page (`/leagues/[id]` for Evolution Point Buy seasons). This glossary owns the vocabulary the spec and the code share; it says what each term is, never how it is built.

## Language

### Place

**Plaza**:
The single grand hall the visitor stands in; every landmark sits on one of its four walls.
_Avoid_: Route, hall (as a synonym), scene

**Station**:
One of the five orbit endpoints the camera rests on: `pulse`, `roster`, `teams`, `schedule`, `rules`.
_Avoid_: Section (that is the DOM element), chapter, slide

**Station view**:
The composed frame the visitor sees while resting at a Station; the plaza is always visible around the landmark.
_Avoid_: Screen, page, shot

**Landmark**:
The furniture a Station looks at: a Board, the Poké Center desk, the statue row, the challenge gate.
_Avoid_: Furniture item, prop (props are the small pieces a landmark is built from)

### Data surfaces

**Board**:
An in-world LED display that shows league data as a stadium board would: large type, few rows, rotating pages. Puls and Spielplan are Boards.
_Avoid_: Screen, jumbotron, cabinet, monitor, table

**Board page**:
One rotation of a Board's content (for example rows 1–6 of the Tabelle).
_Avoid_: Slide, view

**Focus panel**:
The teal-glass DOM panel that docks beside a focused Subject and carries the full, readable data (the whole Tabelle, a team, a line).
_Avoid_: Modal, dialog, overlay (the URL contract still uses `?team=` / `?mon=` / `?board=`)

### Camera

**Conductor**:
The scroll-to-station progress that moves the camera between Stations; it exposes `exact`, `smooth` and `pin`.
_Avoid_: Scroll driver, timeline

**Subject**:
A world object the visitor can focus: a Board, an Ace, the desk PC, a gate plaque. Every Subject has real bounds.
_Avoid_: Hotspot, target, proxy

**Focus**:
The visitor-initiated close framing of one Subject, with bounded orbit and dolly; releasing returns to the Station view.
_Avoid_: Zoom, inspect, detail mode

**Framing**:
The camera pose computed from a Subject's bounds so the Subject fills the frame at a readable size regardless of its real height.
_Avoid_: Auto-zoom, fit

### Figures

**Figure**:
Any Pokémon rendered in the plaza at its Pokédex height (1 world unit = 1 metre).
_Avoid_: Model, sprite, hero (hero was the old budget term for a GLB figure)

**Ace**:
The Figure that represents one participant on the east plinth row; it is the participant's current form.
_Avoid_: Statue, hero, mascot

**Ambient figure**:
A roster Figure that lives on the plaza for presence only; it carries no league data and is never a Subject.
_Avoid_: Wild Pokémon, NPC, extra

**Nurse figure**:
The Poké Center Figure behind the west desk.
_Avoid_: Chansey (the species may vary)

**Colossal rule**:
The placement rule for an Ace taller than 2.5 m: it stands on the plaza ground behind the plinth row instead of on a plinth.
_Avoid_: Giant mode, clamp

**Pedestal insert**:
The raised block added inside a plinth so a very small Ace's eye-line meets the camera.
_Avoid_: Riser, booster

### Tiers and quality

**Route tier**:
The experience with the R3F plaza active over the page.
_Avoid_: 3D mode, full mode

**Lite tier**:
The DOM-only page with motion choreography and no canvas; the permanent fallback and the accessible form of every word on the page.
_Avoid_: Fallback mode, mobile mode

**Quality rung**:
One step on the quality ladder the governor descends under frame-time pressure (DPR, shadows, post-processing, ambient figure count).
_Avoid_: Preset, level

### Evidence

**Bar**:
Private reference stills (maintainer-only) that define the art direction (Legends Z-A Lumiose register).
_Avoid_: Mood board, inspiration, target

**Look sheet**:
The one-page composition brief for one Station, derived from the Bar, that a review judges against.
_Avoid_: Rubric, checklist, spec

**Still**:
A harness capture of one Station view at one viewport in one theme, with its pose sidecar.
_Avoid_: Screenshot, render, frame

**Largest gap**:
The single most important difference between a Still and the Bar named in a verdict; the next round's correction target.
_Avoid_: Issue list, feedback
