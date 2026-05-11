# Map / Heat-Layer — Future Ideas

Deferred enhancements explored alongside the initial heat-layer rollout. Listed here so the angles aren't lost; not committed work.

## Time-decay heat
Spots fade out of the heat layer over weeks (e.g. exponential decay on `captured_at`) so the map answers **"where is it dirty *now*?"** instead of **"where did anyone ever take a photo?"**. Rewards going to current hotspots.

## Time-slider animation
A scrubber on the map timeline that animates the heat layer through months/years. Strong storytelling for impact reports and stakeholder demos: watch the city clean up.

## Brand / material heat layers
Filter the heat layer by detected-item category — "show plastic heat", "show cigarette heat", "show <brand> heat". Doubles as environmental insight, advocacy material, and a policy lever.

## "My heat" mode
Personal heat map of a single user's contribution — their own routes and pickup density. Strong motivation hook and ideal for year-in-review / personal-stats cards.

## Cleanup-planning view for organizers
Heat layer of unpicked spots + a draggable proposed-cleanup pin. As the pin moves, show "if we cleaned here, we'd cover X kg of estimated litter / Y items." Makes the map a planning tool, not just a display.

## Public, unauthenticated landing-page map
Currently `MapPage` lives behind the AppShell auth wall. A read-only heat view on a public route would serve the casual-visitor / city-stakeholder audience without requiring an account. Needs a separate route + a sanitized API surface.

## Before/after cleanup heat-diff
Visualize a past cleanup's actual impact by diffing the heat layer between the day-before and day-after dates. Concrete proof that an event reduced local litter density.

## Adaptive zoom-driven UX (already partially implemented)
The current adaptive setup uses MapLibre `minzoom`/`maxzoom`: heat at zoom < 11, clusters 11–14, dots ≥ 14. Refinements worth considering later:
- Smooth crossfade between heat and clusters at the transition zoom
- Auto-snap zoom to the cleanest level when the user clicks a heat hotspot
