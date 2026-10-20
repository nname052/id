# PROGRESS — Public link + online play with friends (after V34)

- [x] Public link: `gh-pages` branch of `nname052/id`, opened through raw.githack.com (the Artifact public share kept failing).
- [x] Online play outside Claude: Trystero (WebRTC, Nostr signalling) in `src/net/P2PRoom.js`; room from `?room=`.
      Off on localhost unless `?p2p=1`. **Not testable here** (relays blocked) — verified by the user with a friend.
- [x] Friend feedback round:
  - name label shows from 2 m to 200 m and through objects; each seat has its own colour (label, lobby, minimap + name);
  - players spawn 9 m apart on the road by seat number (were on top of each other);
  - remote car = the same PlayerVehicle (wheels spin, steering, body motion), LOD beyond 45 m; 150 ms snapshot
    interpolation (less jitter); AI traffic now brakes for remote players (was driving through them);
  - brake squeal, reverse whine and gear whine removed (they read as whistles); brake hiss lower/darker;
  - acceleration ×1.3 torque on all vehicles (microbus 0–60 km/h 7.8 s → 5.8 s), microbus shift 0.42 → 0.32 s;
  - traffic: procedural box car, box tuk-tuk and motorbike removed; tuk-tuks use the real tuk-tuk model (baked,
    texture colours sampled per vertex), parked cars use the real sedan;
  - more traffic (desktop 38 → 56, mobile 22 → 28, parked 16/8 → 26/12) and people (desktop 130 → 240, mobile 70 → 105); same-machine A/B mobile emu: CPU p50 40 → 48 ms (avg FPS 14.9 → 13.5 on a slow run day);
    "normal" traffic setting 0.7 → 0.85.
- [x] Second friend round: line picker scrolls on phones (body had touch-action:none + touchmove guard); roadside
      hailing on microbus lines (people wave ahead on the route, stop anywhere beside them); more riders per stop;
      name labels fixed screen size, stay visible when the remote car switches to LOD, own label in outside cams;
      traffic LOD keeps sedan windows (multi-material); building material swap with hysteresis (no "refreshing");
      mobile pixel ratio floor 1.3, slower step-up; mobile traffic radius 195 m. Same-machine A/B (mobile emu):
      13.2/11.9 → 13.7/12.2 avg FPS (old/new runs alternated). Tests: boarding, city-life, microbus-lines PASS.
- [x] Third round: traffic LOD colour matched to the full car (measured mean colour, same spot/light: all types
      within ~8%; glossy LOD material, sedan paint correction, glass simplified separately with its own dark
      material); far buildings use the facade texture mip (mean colour 154/151/144 vs 153/150/144); urban ground
      darker (was snow-white around the stadium); stadium outer wall rebuilt (ground floor + windows, openings,
      coping); camera never below ground in close/chase; antialias on all tiers except saver; mobile pixel ratio
      1.4–1.8; more cars (mobile 34 + 28 parked, desktop 68 + 48). A/B mobile emu: 12.3/12.6 → 11.8/11.8 FPS.
      Overpass: driving checked (car height within 12 cm of the deck along the whole ramp) — visual issue unclear.
- [x] Fourth round: traffic LOD colour re-calibrated on the car body only (the contact shadow under the full car had
      been counted → LOD tuned ~10–15% too dark); LOD now has the same contact shadow and receives shadows; LOD
      switch farther (mobile 36 → 48 m, desktop 50 → 65 m); view distance mobile 380 → 470, desktop 560 → 650,
      tile load radius 650 → 780, day haze 540 → 700 m. A/B mobile emu: 13.4/14.0 → 14.0/12.6 FPS (within noise).
- [!] Real-phone FPS with the denser city still needs checking by the user.

# PROGRESS — Audit, real-city default, performance overhaul, HiAce front fix, cockpit (V34 pass)

Checkpoint before this pass: commit `e70e504` on `claude/festive-bohr-xry4vg` (= published Artifact V33).
(A git tag `checkpoint/pre-audit-v33` was created locally; pushing tags is refused by the remote.)

## Phase 1 — Technical audit (verified against the running code, prioritised)
Measured with `tools/tests/perf-bench.mjs` (see "How measured" below). "Was" = V33 build.

| # | Finding (verified) | Evidence | Status |
|---|---|---|---|
| A1 | Default map was the fictional "current" city (`main.js` default `'current'`, stored pick `egy-map` could pin it) | code | **fixed** — Shibin default, new key `egy-map2` |
| A2 | City shaders were compiled on the first frame after "ready" (warm-up only covered the vehicles, before the city tiles existed) | 5.1 s main-thread task right after ready (desktop) | **fixed** — one compile pass after the start tiles |
| A3 | On GPUs without `KHR_parallel_shader_compile` programs link on first use | first frames after ready 4.4 s | **fixed** — linked during loading in 40 ms slices (41 ms) |
| A4 | Traffic LOD baked ~43x per load (cache key had colour + per-car geometry uuid → never hit) | 1.33 s | **fixed** — shape baked once, recoloured per colour: 0.43 s |
| A5 | `heightToNormal` (procedural normal maps) slow per-pixel code | 0.64 s | **fixed** — 6x faster, identical output (checked) |
| A6 | Mirror "is it blank" check used `readPixels` → full GPU sync on the first drive frames | profiler | **fixed** — only in `#debug` |
| A7 | 3,412 scene objects re-matrixed every frame (1,417 expansion-gate meshes, ~1,300 hidden traffic parts) | `updateMatrixWorld` 15% of frame CPU (mobile emu) | **fixed** — gates instanced, static tiles frozen, hidden cars skipped: 669 |
| A8 | Single tile build jobs up to 70 ms (mobile emu) | perf-bench | **improved** — roads split in 4 jobs; max 30 ms |
| A9 | Taxi + tuk-tuk built and warmed during loading although only one vehicle is driven | ~0.5 s + their shaders | **fixed** — built in the background while the van is stopped (or on switch) |
| A10 | First cockpit frame compiled the edge-mirror overlay shaders and uploaded cockpit textures | 0.5–4 s after pressing start | **fixed** — precompiled/uploaded during loading |
| A11 | All tiles within ~650 m built before "ready" | 1.7 s | **fixed** — ~300 m before ready, rest streams |
| A12 | HiAce: white patches on both front corners | screenshots + raycast | **fixed** (see Phase 5) |
| A13 | Cockpit FOV was vertical → 102° horizontal on 2.16:1 phones; eye at ~70% of windshield height; camera rolled with the full body roll; crash shake = random jitter per frame | cockpit-view test | **fixed** (see Phase 6) |
| R1 | Remaining: three.js per-draw overhead (`setProgram`/uniforms) is ~40–50% of frame CPU at ~155 draw calls (mobile MED) | CPU profile | open — needs more merging/instancing of world props |
| R2 | Remaining: ~116 shader programs at start (each lit material variant) — long compile on GPUs without parallel compile | `renderer.info.programs` | open |
| R3 | JS bundle 4.9 MB, mostly the base64-inlined GLB models (required by the Artifact host: no separate .glb fetch) | build | open (code-splitting does not shrink the models) |
| R4 | Service worker deliberately disabled (Artifact page blocks it; old SW served stale builds) → no offline mode on the Artifact | `main.js` | documented limitation |
| R5 | No turn-signal feature exists in the game; HUD "signal" = traffic light state | code | not faked; cluster shows only real states |

## Phase 2 — Real Shibin El Kom is the default
- [x] `?map` absent + nothing stored → Shibin (OSM). Old fictional map still selectable and remembered (`egy-map2`).
- [x] Start screen lists Shibin first and marks the old map as fictional. Test `default-map`: spawn on a real road
      (شارع الشهيد عبد العزيز المناخلي), camera in the driver seat, both picks persist.

## Phase 3/4 — Loading and stutter (final, built game, 2 runs each where shown; SwiftShader — see "How measured")
"Time to playable" = page open → first cockpit frame when start is pressed as soon as it unlocks (includes any
stall right after the button unlocks). Run-to-run noise here is about ±2 s.

| Metric | V33 | Now |
|---|---|---|
| Desktop cold — time to playable | 15.1 s (button 7.7 s + 4.7 s shader stall after it) | 11.3 / 11.4 s (button 10.1–10.3 s, no stall after) |
| Desktop warm (HTTP cache) — time to playable | ~8.1 s (5.9 s + 2.2 s stall) | 6.4 s |
| Mobile emu cold — time to playable | 27.6 s | 22.2 / 23.2 s |
| Mobile emu warm — time to playable | 23.5 s | 18.3 s |
| Desktop: first frame after pressing start (button pressed 1.5 s after it unlocks) | 2.3 s | 0.28 s |
| Mobile emu drive 60 s: avg FPS (cap 30) / 1% low | 24.7–25.6 / 8.7–8.8 | 26.0–27.5 / 9.2–9.7 |
| Mobile emu drive: frames > 50 ms / > 100 ms | 280–321 / 9–11 | 206–259 / 5–9 |
| Mobile emu drive: one-off stall from building another vehicle | (built at load) | none while driving (built when stopped) |
| Mobile emu: slowest single tile-build job | 70–132 ms | 59–79 ms |
| Desktop drive: frames > 50 ms / longest frame | 10–20 / 85–221 ms | 10–14 / 94–131 ms |
| Scene objects re-matrixed per frame | 3,412 | 669 |
| tier-perf mobile MED: draw calls / resident geometries / heap | 155 / 401 / 140 MB | 141 / 225 / 129 MB |
| Download (cold) | 4.75 MB | 4.59 MB |

Target "playable in ~5 s on a capable phone with cache": **not verified** — needs a real device. In this container
(CPU-only GPU, phone emulated as a 4x slower CPU) warm time-to-playable is 18.3 s; desktop warm 6.4 s.

## Phase 5 — HiAce front white patches
- [x] Root cause: the procedural interior dashboard (`dashLow` light grey + `dashUp`) was a straight extrusion
      across the full cabin width; the HiAce nose is rounded, so both dashboard ends stuck out through the body
      skin at the front corners. Fix: dashboard/floor vertices below the windshield base are pulled 2.5 cm inside
      the skin (raycast from the cabin centre to paint/lights/black/grille). No colour overlay.
- [x] Test `hiace-front`: day / night / headlights on-off screenshots from front, 45° left/right, high front,
      sides, cockpit + raycast grid: interior hit first between wheel top and window line = 126/71/78 before → 0.

## Phase 6/7 — Cockpit camera and dashboard
- [x] Horizontal FOV setting (default 92°), eye 10 cm lower + pitch −0.10 (cabin share of the screen
      55%→51% mobile, 62%→55% desktop; steering wheel visible; road visible from ~3.5 m).
- [x] Stable horizon: road slope fully, suspension pitch 45 % / roll 30 % (hard turn: camera 2.0° vs body 7.0°).
- [x] Seat height ±12 cm and fore/aft ±15 cm sliders (persisted, smooth transition), head-motion normal/low/off,
      smooth crash shake.
- [x] Cluster: real needles (speed, rpm), LCD gear/fuel/odometer + new engine temperature (simulated warm-up)
      and indicator lamps from real state (headlights, handbrake, low fuel, overheating). Test `cockpit-view`.
- [!] Cockpit geometry polish beyond this (vents, glovebox detail) not done in this pass — camera/visibility first.

## Phase 9/10 — Regression and visual checks
- Full suite (`run-all.sh`, 22 tests): default-map, hiace-front, cockpit-view, wheel ×3, road-surface, lane-scan,
  city-life, boarding, checkpoint, audio-radio, perf-budget, microbus-lines, street-kit, bridge-audit, rail-system,
  living-city, destructibles, tier-perf — PASS.
- accident-ems failed once → real bug found (shoppers skipped the hit test) → fixed → PASS.
- shibin-e2e: phone page hung while the desktop page kept rendering on the shared software GPU (my new sync shader
  linking made it wait behind it) → linking capped at 6 s + test pauses the desktop page → item 12 PASS;
  item 4 (tile-build hitch) 41.6 ms once in the full run, 25.9 ms alone (limit 40) → PASS alone.
- Visual: `visual-tour` (start screen defaults to the real map, street chase/cockpit, bridge, night cockpit),
  `hiace-front` (front/45°/high/sides/cockpit, day/night/headlights), `cockpit-view` (phone + desktop sizes).

## Delivery
- [x] Built and published as Artifact **Version 34** (same link as V33; only `index.html` + the new JS changed).
- [x] Final checkpoint = the commit that adds this line on `claude/festive-bohr-xry4vg`.

## Recommended next steps
1. Measure on a real mid-range Android phone and an iPhone (time to playable, FPS, thermals) — the numbers above are
   from a CPU-only container.
2. Reduce draw calls further (merge per-tile props, instance shop signs/awnings) — the biggest remaining CPU cost.
3. Fewer shader variants (share materials that differ only in colour → vertex colours) to cut compile time.
4. Dashboard geometry polish (vents/glovebox/door cards) using the 2005 HiAce reference.

## How measured
- `tools/tests/perf-bench.mjs [url] desktop|mobile cold|warm` on the built game (`vite preview`).
  This container has **no GPU** (SwiftShader). Pixel drawing is ~1 s/frame here regardless of the code, so the
  benchmark skips the draw calls themselves (everything else — three.js, uploads, shader compile, streaming,
  physics, traffic, GC — is real). "Mobile" = Chrome mobile emulation + CPU ×4 slower, **not a phone**.
- Real-device FPS, GPU cost and thermals must be measured on a phone.


---

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
- [x] Denser traffic stability (`city-life` 8/8 consecutive passes): cars keep distance to a car that just
      entered the next edge; no respawn within 14 m of another car (incl. mid-turn) or 10 m of a crossing
      pedestrian; stopped cars don't drift back into a car beside them.

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
- [x] Full suite (19 tests): all pass; `shibin-e2e` 21/22 in the long sequential run — item 16 (heap +9 MB
      after the first far/back lap, flat after; limit 8) — re-run alone: 6/6, heap 172 → 169 → 169 MB.
- [x] `city-life` after the final traffic fixes: 8/8 consecutive passes.
- [x] tier-perf mobile MED: 155 draw calls, 169k triangles, 140 MB, pixelRatio 1.4 + MSAA.
- [x] Built and published as a new version of the same Artifact (V33).
