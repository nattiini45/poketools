# Route World Glossary

The vocabulary of the 3D route worlds layered over a league page (`/leagues/[id]`): the plaza, sakura, mountain and clouds themes described in [docs/worlds.md](docs/worlds.md). Terms marked _(plaza)_ belong to the plaza theme only; the rest are shared by every route world. This file covers the route-world subsystem only; it is not a glossary of the whole project. Public uses of these terms: [docs/worlds.md](docs/worlds.md) and [docs/adr/](docs/adr/). The route-world design spec is maintainer-only and not part of this repository.

## Language

### Place

**Plaza** _(plaza)_:
The single grand hall the visitor stands in; every landmark sits on one of its four walls.
_Avoid_: Route, hall (as a synonym), scene

**Station**:
One of the five orbit endpoints the camera rests on: `pulse`, `roster`, `teams`, `schedule`, `rules`.
_Avoid_: Section (that is the DOM element), chapter, slide

**Station view**:
The composed frame the visitor sees while resting at a Station; the world is always visible around the landmark.
_Avoid_: Screen, page, shot

**Landmark** _(plaza)_:
The furniture a Station looks at: a Board, the Poké Center desk, the statue row, the challenge gate.
_Avoid_: Furniture item, prop (props are the small pieces a landmark is built from)

### Data surfaces

**Board** _(plaza)_:
An in-world LED display that shows league data as a stadium board would: large type, few rows, rotating pages. The `pulse` and `schedule` Stations each look at a Board (German labels "Puls" and "Spielplan").
_Avoid_: Screen, jumbotron, cabinet, monitor, table

**Board page** _(plaza)_:
One rotation of a Board's content (for example rows 1–6 of the standings table).
_Avoid_: Slide, view

**Focus panel**:
The teal-glass DOM panel that docks beside a focused Subject and carries the full, readable data (the whole standings table, a team, a line, the rules). Its URL contract is `?team=`, `?mon=`, `?board=` and `?rules=`; "overlay" is its older name in code and in ADR-0003.
_Avoid_: Modal, dialog

### Camera

**Conductor**:
The scroll-to-station progress that moves the camera between Stations.
_Avoid_: Scroll driver, timeline

**Subject**:
A world object the visitor can focus: a Board, an Ace, the desk PC, a gate plaque. Every Subject has real bounds; ADR-0003 calls each one a "named proxy" with computed bounds.
_Avoid_: Hotspot, target

**Focus**:
The visitor-initiated close framing of one Subject, with bounded orbit and dolly; releasing returns to the Station view.
_Avoid_: Zoom, inspect, detail mode

**Framing**:
The camera pose computed from a Subject's bounds so the Subject fills the frame at a readable size regardless of its real height.
_Avoid_: Auto-zoom, fit

### Figures

**Figure**:
Any Pokémon rendered in a route world at its Pokédex height (1 world unit = 1 metre). The quality budget still counts them as "hero figures", and a Figure's moment in the spotlight is a "hero beat": both are current names, not retired ones.
_Avoid_: Model, sprite

**Ace** _(plaza)_:
The Figure that represents one participant on the east plinth row; it is the participant's current form.
_Avoid_: Statue, mascot

**Ambient figure**:
A roster Figure that lives in the world for presence only; it carries no league data and is never a Subject.
_Avoid_: Wild Pokémon, NPC, extra

**Nurse figure** _(plaza)_:
The Poké Center Figure behind the west desk.
_Avoid_: Chansey (the species may vary)

**Colossal rule** _(plaza)_:
The placement rule for an Ace taller than 1.5 m: it stands on its own low plinth (0.25 m) on a common back line, 1.4 m behind the rear pedestals. The other worlds' theme figures use a separate, taller colossal stance (2.5 m); the two thresholds are different rules that share a word.
_Avoid_: Giant mode, clamp

**Pedestal insert** _(plaza)_:
A 0.42 m stone drum on the plinth cap, under an Ace shorter than 0.5 m, so a very small Ace's eye-line meets the camera.
_Avoid_: Riser, booster

### Tiers and quality

**Route tier**:
The experience with the 3D route world active over the page.
_Avoid_: 3D mode, full mode

**Lite tier**:
The DOM-only page with motion choreography and no canvas; the permanent fallback and the accessible form of every word on the page.
_Avoid_: Fallback mode, mobile mode

**Quality rung**:
One step on the quality ladder the governor descends, strictly in order, under frame-time pressure: ambient occlusion off, resolution, ambient figure count, post-processing off, shadow fidelity, resolution again, figure detail. Landmarks, camera endpoints, copy and interaction meaning are never cut.
_Avoid_: Preset, level

### Evidence (maintainer-only)

These terms name the maintainers' art-review artifacts. The artifacts themselves are private and not part of this repository.

**Bar**:
Private reference stills that define the art direction.
_Avoid_: Mood board, inspiration, target

**Look sheet**:
The one-page composition brief for one Station, derived from the Bar, that a review judges against.
_Avoid_: Rubric, checklist, spec

**Still**:
A capture of one Station view at one viewport in one theme.
_Avoid_: Screenshot, render, frame

**Largest gap**:
The single most important difference between a Still and the Bar named in a verdict; the next round's correction target.
_Avoid_: Issue list, feedback
