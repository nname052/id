# PROGRESS — Shibin El Kom: Realism & Living City Upgrade

Baseline: Artifact Version 32 (branch `claude/festive-bohr-xry4vg`, V31 backup on `backup/v31`).

Legend: [x] done + covered by a test · [~] partial · [!] limitation / needs the user

## 0. Data & references
- [!] Google Earth / Maps / Street View imagery is proprietary and this environment's network blocks it.
      Geometry and names come from OpenStreetMap (ODbL) only; nothing is invented and labelled as real.
- [!] OSM coverage of Shibin is thin: 13 building footprints, 2 places of worship, 11 schools, 7 university areas.
      Everything else is generated along the real streets (Delta style rules) and labelled as generated in metadata.

## 5. Real Shibin El Kom (highest priority)
- [x] Elevated bridge كوبرى شبين الكوم العلوي — data fix: the westbound carriageway dropped to the ground
      mid-bridge (ramp detection only compared the first chain edge's name, an unnamed link). Fixed in
      `tools/osm/build_region.py`, data regenerated (only the 4 bridge edges changed in the road graph).
- [x] Bridge structure: earth-filled ramps with retaining walls to the ground (+ wall colliders), T-piers
      (column, cap, footing) kept off cross streets, New-Jersey parapets + steel handrail, panelled concrete.
- [x] Streets cut by a low ramp (deck < 3.4 m) are closed at the wall (GPS/traffic don't route under 1.6 m decks).
- [x] Physics audit — `bridge-audit`: retaining walls block ground cars only, 6 real crossings with ≥ 5.1 m
      clearance, no pier in a cross street, parapets on the whole high deck, max grade 6.6 %;
      `road-surface`: 12/12 elevated drives with no steps/flips/collisions.
- [x] Real OSM buildings styled by type with their OSM names (schools, station, malls, hotel, apartments).
- [x] Real station footprint used for Shibin station; Masjid Seif (dome + minaret) and Church of the Virgin
      (two towers) at their OSM locations.
- [x] Real street names, widths, lanes, landmarks (from previous passes).

## 4. Railway
- [x] Main line traced from OSM rails (4.98 km), train (loco + 5 coaches) runs both ways, stops centred at
      Shibin station and the new station; each car follows the curve.
- [x] 4 OSM level crossings (Shubra Bas road, Talaat Harb, Masgid El-Gebaly, unnamed); Denshway is an OSM
      tunnel → no gates. Barriers lower 320 m before the train, lamps flash, bell, barrier colliders,
      reopen after the train; AI traffic queues before closed gates. Test: `rail-system`.
- [x] Station: real footprint + 160 m platform, canopy, benches, signals that turn red while a train is near.

## 2. Pedestrian accidents & emergency response
- [x] Hit pedestrians are thrown and fall; minor hits get up and walk back; severe hits stay down with a
      small dark stain (non-graphic). Bystanders flee, police respond, traffic stops before the victim.
- [x] Ambulance (white HiAce, red stripe, "إسعاف", flashing bar, siren) routes in over the road graph,
      two paramedics treat and stretcher the victim, ambulance drives to the nearest OSM hospital.
      Test: `accident-ems`.

## 3. Checkpoints
- [x] Officer walks to the driver's window before the licence check and back; second officer guards the car;
      AI traffic slows to 3.5 m/s through an active checkpoint. Test: `checkpoint`.

## 1. Living city
- [x] Rush-hour density by time of day (day ×1.2, sunset ×1.35, night ×0.55 of the setting).
- [x] Pedestrians enter shops, window-shop, come back out to the pavement (never onto the road).
- [x] Horn: the car ahead speeds up / a loading microbus leaves / gives way if a lane is free; crossing
      pedestrians hurry. Test: `living-city`.

## 4b. Destructibles
- [x] Street trees and utility poles break on hits ≥ ~16 km/h and fall in the direction of travel
      (wires on that pole drop), lie with a ground collider, AI traffic stops before them. Test: `destructibles`.

## 6. Graphics & vehicles
- [x] Mobile: MSAA on MED/HIGH, per-tier resolution raised (MED 1.2 → 1.4), road no longer turns white
      (ground z-fighting fixed in V32).
- [x] Vehicles: Egyptian plates on all HiAce (was the model's Japanese plate), traffic HiAce brake lights on
      the real rear edge (were 20 cm outside), tuk-tuk cabin rebuilt (windshield framed, roof, dash, seat back),
      sedan mirror arm reaches the body.
- [!] Real-device FPS/thermals need checking on a phone (tests run on software rendering).

## Regression / publish
- [~] Full suite + tier-perf, build, publish new Artifact version (see final report).
