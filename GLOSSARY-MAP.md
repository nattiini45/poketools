# Glossary Map

This repository has more than one context with its own language. Each context's glossary lives next to the surface it describes; the system-wide decisions are in [docs/adr/](docs/adr/).

## Contexts

- [Route World](./CONTEXT.md): the 3D route worlds layered over a league page — plaza, sakura, mountain and clouds.
- [Collection](./docs/glossary/collection.md): the optional collecting layer around the leagues — Catches, Partners, Careers, Ribbons and Trainer titles.

## Relationships

- **Leagues and tournaments** are the core of the product and have no glossary of their own yet.
- **Collection → Leagues**: one way only. A trainer's Collection supplies the Pokémon they play, and a Loaner lets them play a line they do not own, but nothing collected changes a league ([ADR 0006](docs/adr/0006-collection-never-influences-a-league.md)).
- **Collection ↔ Route World**: no relationship. A route world presents a league page; the Collection never appears in it.