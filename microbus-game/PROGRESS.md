# PROGRESS — Shibin El Kom: Realism & Living City Upgrade

Baseline: Artifact Version 32 (branch `claude/festive-bohr-xry4vg`, V31 backup on `backup/v31`).

Legend: [ ] todo · [~] in progress · [x] done (tested) · [!] limitation / needs user

## 0. Data & references
- [!] Google Earth / Maps / Street View imagery is proprietary and the session network blocks it; geometry
      comes from OpenStreetMap (ODbL) only. Building appearance = OSM tags where present + Delta style rules.

## 5. Elevated bridge (كوبرى شبين الكوم العلوي) — highest priority
- [ ] Visual audit (side/deck/under views)
- [ ] Ramps: retaining walls down to ground (no floating ramp), earth-fill look
- [ ] Piers: column + cap (T-pier) instead of plain boxes
- [ ] Parapet: jersey barrier profile + steel handrail
- [ ] Physics audit: road-surface drives (steps/flips/collisions), under-bridge clearance, ramp walls collide

## 6. Graphics & vehicles
- [ ] Mobile render quality (pixel ratio per tier, texture anisotropy, AA)
- [ ] Vehicle defects audit (protruding lights, mismatched colours, disconnected parts)

## 4. Railway
- [ ] Moving trains on the real OSM rail lines
- [ ] Level crossings: barriers, lights, bells; traffic stops
- [ ] Station (OSM) with platforms + canopy + signals

## 2. Pedestrian accidents & emergency response
- [ ] Hit pedestrians fall (non-graphic), small stain, ambulance via road graph, paramedics, transport
- [ ] Police/traffic reaction

## 3. Checkpoints
- [ ] AI traffic slows/queues at checkpoints, officer walks to stopped player vehicle

## 1. Living city
- [ ] Rush-hour density + jams on main roads/intersections
- [ ] Pedestrians entering/exiting shops, shopping, waiting
- [ ] AI reacts to player horn (speed up / give way)

## 4b. Destructibles
- [ ] Trees & utility poles knocked down by strong hits

## Regression / publish
- [ ] All tests, tier-perf vs V32, build, publish new version
