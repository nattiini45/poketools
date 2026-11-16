# League standings readers

League tables count the group/table stages only. Elimination phases never add points, opponents, byes, or matchdays to that table. A completed playoff bracket supplies final placings, with tied elimination rounds sharing a rank; everyone outside the bracket follows in group-table order. Without a third-place match the semifinal losers both finish third. Statistics retain their existing scopes and totals.

| Reader | Meaning |
| --- | --- |
| League schedule and world boards (`queries/league-standings`, `worlds/route-data`) | Group-stage table and movement; separate final placings |
| League hub standings | Group tables and combined group-stage table; final placings separately |
| Non-themed league fallback (`world/default/DefaultWorld`) | Group-stage table and separate final placings |
| Home/dashboard standings preview (`stats/standings-preview`) | Final placings when available, otherwise group-stage table |
| Insights league scope | Combined group-stage table; usage and kill statistics unchanged |
| Broadcast league standings | Final placings when available, otherwise group-stage table; statistics unchanged |
| Profiles (`profile/compose`) | Each participation's own phase; playoff participations use bracket places |
| Kale season summary | League final placings when available, otherwise group-stage table |
| Kale round fact pack, player profile, tournament report context | Phase-scoped table; playoff results use bracket places |
| Broadcast caster data and recap engine | Phase-scoped table; never a merged league points table |
| Broadcast standings impact | Phase-only helper with no runtime consumers |
| AI agent standings tool | Tournament scope only; no merged league table |
| Enrollment and pairing | Source phase only, unchanged |
| Private archive history provider | Read-time final placings only where source playoff results establish them; source rows unchanged |

The implementation uses today's tournament rows and their bracket types. It does not add a phase model. Existing season/tournament cache tags and batched reads remain the invalidation and query boundaries.
