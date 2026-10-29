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
- [x] Fifth round (user video, iPhone): far cars looked white/silver and turned to their real colour while
      approaching — gradual, i.e. sky reflection at grazing angles, not the LOD. Traffic paint clearcoat/env
      reflection cut a lot (HiAce 1/1.2 → 0.15/0.3, sedan 0.55/0.75 → 0.15/0.3), LOD recalibrated. Then per the
      user: near cars always full quality — LOD switch at 120 m (mobile) / 180 m (desktop); building full facade
      and street detail out to 480–500 m (mobile) / 600–700 m (desktop), past the haze. Draw calls (tier-perf,
      same machine): mobile-med 182 → 193, desktop-med 255 → 385. CPU A/B mobile emu: 11.3/12.8 → 11.4/12.3 FPS.
- [x] Sixth round (v9): no LOD for visible traffic (LOD only on the low tier); buildings full facade/detail at every
      visible distance (low tier keeps the old distances); traffic paint matte (no clearcoat, env 0.25); version
      label "نسخة 9" on the start screen (to rule out cached old builds). Draw calls mobile-med 193 → 223,
      desktop-med 385 → 473. city-life PASS.
- [x] v10: frame cap 60 or 30 only (45 on a 60 Hz screen draws 3 of 4 frames = judder; saved "45" → auto);
      iPhone detected → start quality level 1, pixel ratio up to 2.0–2.1 (sharper edges); iOS home-screen web app
      (apple-mobile-web-app-capable, touch icon, no fixed start_url so ?room= is kept) + hint on the start screen.
      iPhone 13 emulation: ios=true, level 1, pixelRatio 2, cap 60, antialias on, no errors.
- [x] v11: name labels smaller (own hidden while driving, remote hidden under 8 m); traffic wheels always visible
      (were hidden beyond 70 m), front wheels steer from yaw rate, body roll in turns; traffic tuk-tuk wheels split
      out of the baked body and spin; microbus share ~40%, 11 liveries; overpass fork fix (ramp #4013 kept the car
      under the deck when entered off-centre: car inside 55% of the ramp lane now stays on the ramp; 5 ramps ×
      3 lateral offsets driven, no fall); pedestrians and roadside hail stops never inside buildings or low ramps
      (0/240 people inside). Tests: boarding, city-life, living-city, microbus-lines PASS. Draw calls
      mobile-med 223 → 253. Not reproduced: "passengers board upside down" (boarding frames look normal).
- [x] v12 bridges: all bridge components analysed (2 flyovers 6 m + 16 small canal bridges ≤1 m). Found and fixed:
      (1) car on the ground road that joins a ramp at 1.4 m (OSM quirk) grabbed the deck → 94 cm step → launched
      18 m and flipped: decks are only taken when ≤40 cm above the car + physics caps upward heave speed/pitch rate;
      (2) at a ramp's lane edge the "nearer ground road" rule dropped a car that was already on the ramp → it stays
      on the ramp when its height matches; (3) low-ramp side walls now also block ground-level cars (not where the
      wall sits on a ground road at a fork or inside another ramp's lane). 5 ramps × 3 lateral offsets: no fall,
      no flip. Small bridges: profile slope ≤5%, pitch on the deck ~4°. Tests: city-life, bridge-audit,
      road-surface (0 flips) PASS.
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

## v13 (round: online taxi, ambulance, police, wider streets)
- [x] Online: remote taxi/tuk-tuk threw in `makeLodMesh` (mixed array types in `mergeGeometries`) every frame inside
      `mp.update` → fixed (all parts Float32) + try/catch so one bad remote can't stall the game.
- [x] Ambulance drove backwards (model faces −z) → rotated +π, wheel spin sign fixed. Ambulance is always dispatched on a hit.
- [x] Hit pedestrian no longer gets up right after falling (`keepDown` in `ShibinCrowd._hitStep`).
- [x] `Patrol.js`: an AI car hits another and flees → police chase it (siren, catches it, stops it, leaves).
- [x] Old fictional map and all its code deleted; only real Shibin ("شبين الكوم"). OSM rebuild is deterministic (GEN_VERSION 3).
- [x] Streets widened (`build_region.py` WIDTH / lane 3.6). Tests: road-surface, bridge-audit, city-life, microbus-lines pass.
- [x] Traffic HiAce brake lights: soft additive glow instead of a flat red box on the body.
- [x] Road works (`ShibinWorks.js`): ~19 zones on main roads (cones, barriers, sand mound, sign), shown within 230 m.
      Positions are chosen deterministically from the road graph — decoration, not real works sites.
- [!] Not done / unverified: real photos of Shibin could not be fetched (network blocked) → no photo-based redesign;
      freezes/heat need on-device profiling; "passengers upside down" not reproducible without a screenshot.

## v14 (bridge flip from the user's screenshot)
- [x] Microbus lying on its side on "كوبرى شبين الكوم العلوي": reproduced with a new sweep (5 bridge chains × lateral
      offset 0/0.8/1.0/1.25 × 35/60 km/h): 10/40 flips before. Causes (traced per wheel): (1) the opposite-direction
      deck next to the car, 30–40 cm higher, got picked under the right wheels only → instant 15° roll → flip;
      (2) the 3 m soft edge on low ramps made a cross slope under wheels near the parapet.
      Fixes: `ShibinWorld.height` picks the deck by distance + 8×height difference from the car (not the nearest line
      alone) and averages only surfaces within 15 cm; edge softening 1.2 m; ramp/ground-road rule margin 0.3 m;
      `VehiclePhysics` keeps each wheel within −45/+30 cm of the ground under the car centre; static walls give 25%
      of the side-impact roll (cars scrape parapets instead of tipping). After: 0 flips at offsets 0–1.0; 2 runs at
      1.25 (driving into the parapet from outside the deck) still tip.
- [x] Traffic cars pitch with the ramp slope (were level, half sunk into the ramp).
- [x] More traffic: mobile 42 (was 34), desktop 84 (was 68).
- [x] iPhone pixel ratio 2.0/1.8/… (was 2.1/2.0/…) — ~27% fewer pixels at the default level (heat).
- [x] Road works: more on شارع جمال عبد الناصر (paving/widening works there reported in Menoufia news).
- Tests: bridge-audit PASS, road-surface 0 flips (same hits as before: random traffic/breakables), city-life PASS.

## v15 (real Shibin photos as textures)
- [x] Network opened by the user (Wikimedia allowed). Searched Commons (Category:Shebin El-Kom + subcategories, Arabic/English
      file search): 42 files found, with author + licence recorded. Flickr/Mapillary not used (API keys needed).
- [x] `tools/photos/build_atlas.py` + `sources.json`: cuts 24 perspective-corrected cells (8 brick bays, 8 plaster bays,
      8 ground-floor shops/entrances) + a tileable asphalt patch + station-plaza paving out of 8 photos by Faris knight
      (CC BY-SA 4.0) → one JPEG `public/textures/shibin-photo-atlas.jpg` (2048×1792, ~445 KB) + `src/render/photoAtlas.json`.
- [x] Runtime (`src/render/photoAtlas.js`): loaded once in parallel with fonts/models, painted onto the existing canvas
      atlases (same sizes, same mipmaps → no extra GPU memory, textures or draw calls). Falls back to the generated
      textures if the file fails/times out (9 s). Night windows = light colour × darkness of the glass in the photo.
      Plain brick wall colour comes from the photos (`uBrickC`).
- [x] Start screen: "مصادر الصور" list (file, author, licence link) generated from the same JSON; CREDITS.md updated.
- [!] Corniche wall/railing of Bahr Shibin: only small (≤500 px) or watermarked photos on Commons → not turned into a
      texture; corniche stays procedural. Photos with people/vehicles/brands in front of shops were skipped.
- Tests: default-map PASS, city-life PASS, bridge-audit PASS, road-surface 13 drives, 0 steps, 0 flips (hits = random traffic/breakables, as in v14).

## v16 (user report round: lines, passengers, police, accidents, bridge, canal, sidewalks)
- [x] Changing the microbus line no longer teleports the car: it stays put and the GPS leads to the first stop
      (only the very first pick at game start places the car at the terminal).
- [x] Line colours: every waiting passenger has a floating diamond in their line's colour; ~30-40% at stops/roadside wait
      for *other* lines (they don't wave and don't board). Stop markers use your line's colour. Toast if you stop for
      people of another line.
- [x] "Walking backwards": the walk-cycle knee bend was exactly π out of phase (knees bent in stance, not swing) on
      every pedestrian/passenger → swapped. Seated passengers verified facing forward in all 3 vehicles.
- [x] Green screen in the cockpit: seat "back" +15 cm put the eye inside the body shell (whole screen = body colour),
      worse when accelerating (head inertia). `_clearEye` raycasts from the default eye to the requested one against the
      vehicle meshes and keeps 6-12 cm clearance (never moves the default position). 18 seat/vehicle combos checked.
- [x] Police patrol no longer drives through cars: look-ahead avoidance (overtake on a free side or follow), oriented-box
      check before every move/turn, push-out if a car drives into it; traffic treats it as a stop zone.
      Measured over 8 forced chases: 53 → 0-2 overlap frames.
- [x] Accidents: 2-4 nearest people run to the injured person and stay around them until the ambulance takes them
      (traffic stops for them); ambulance route search no longer gives up after 10 tries (40 tries + retries).
      `accident-ems` now also checks ≥2 helpers arrive.
- [x] Bridge by Maxim Mall (كوبرى شبين العلوي + ramp 641): lamp poles were placed on the neighbouring carriageway's deck
      (two decks 5 m apart) → elevated lamps validated against other decks; repair-patch squares removed on decks;
      photo asphalt de-shaded (no checkerboard).
- [x] Canal (ترعة بحر شبين) was invisible up close (ground plane covered it) → depth cut-out; water colour from a real
      photo of the canal (himoz, FAL), animated ripples in the shader; banks stone grey.
- [x] Sidewalk spikes in junctions paved (tools/osm/clean_sidewalks.py, 0.5% of sidewalk area);
      8 real OSM buildings (mostly schools) stood on widened asphalt → footprints pulled back (audit_buildings.py).
- [x] Tuktuk mirror stalks re-attached (rebuilt after widening); facades use mostly one photo cell per building.
- [!] Not done: Google Maps/Earth/Street View imagery can't be used (licence); Mapillary needs an access token;
      KartaView had no coverage. OSM canal width (~10 m) looks narrower than photos of Bahr Shibin (~35 m) — not
      changed without a licensed source. The microbus's curved kerb-view mirror is part of the HiAce model (kept).

## v17 (real building footprints + roundabouts)
- [x] OSM still has only 13 buildings in Shibin (checked via Overpass on 2026-10-28). Imported **Microsoft Global ML
      Building Footprints** (ODbL, satellite-derived, release 2026-02-03): 6,622 footprints → 27,449 rectangles
      (clipped off roads/sidewalks/decks/water/rail/OSM buildings/stadium, split into ~11 m cells for complex blocks),
      replacing 28,109 generated buildings inside the city; 5,700 generated outside the coverage stay.
      Heights are NOT in the data → floors/style copied from the nearest previously generated building (estimate).
      audit_buildings --fix afterwards: 1 asphalt / 10 sidewalk raster touches left of 32,919.
- [x] 7 OSM roundabouts (junction=roundabout): a building stood on the main roundabout's island → islands now grass +
      yellow/black kerb (colliders) + palms; buildings inside rings removed.
- [x] Building side faces get windows more often (street-facing sides of split blocks were blank).
- [x] Perf (tier-perf, same build, old vs new buildings): mobile-med 359 → 361 draw calls, 307k → 307k triangles, heap 125 MB.
- [!] Governorate HQ (ديوان عام محافظة المنوفية): no location in OSM, Nominatim or Wikidata, and no geotagged Commons
      photo → not placed (news only says a new HQ is planned on أرض المهبط, حي شرق). Needs a location from the user.
- Tests: default-map, city-life, street-kit, bridge-audit, living-city, boarding, accident-ems, tier-perf, visual-tour PASS.

## v18 (bridge ramp "high piece / low piece")
- [x] Both ramps of كوبرى شبين العلوي: the two carriageways' decks overlap side by side but rose at different rates →
      in the overlap strip two surfaces up to 1.07 m (west, edges 3987/4016) and 0.71 m (east, 3988/3990) apart; a car
      on the seam sat half high / half low. `tools/osm/unify_ramps.py` gives both the same height where they overlap
      (blend over 3 m, endpoints fixed, slope capped at 8%), decks + road-graph heights. Max step now 0.12 m (foot of
      the west ramp), max grade 8.0%. bridge-audit PASS, road-surface 13 drives / 0 steps / 0 flips.

## v19 (bridge: bouncing on the ramps + passengers fleeing on the bridge)
- [x] Bounce: ramp heights had a saw-tooth after unify_ramps (grade 6% → 0% → 3% → -4% within metres at the ramp feet)
      and `ShibinWorld.height` blended the clamped segment-end height with the next segment = a ripple every 4 m.
      `tools/osm/smooth_ramps.py` (monotone ramps + vertical curves, twins coupled, 8% cap; deck heights copied from the
      graph) + slope extrapolation past segment ends. Drive probe on 6 bridge edges at 30/50 km/h: max vertical
      acceleration 3–5 → 0.2–1.0 m/s², 0 impacts, 0 incidents. Drawn deck vs physics surface: 0.21 → 0.01 m.
- [x] Panic: the two one-way carriageways of the upper bridge are 5–7 m apart in OSM but 8 m wide each → inner lanes
      ~1 m from the opposite inner lane (head-on = "crash" → passengers flee). `edge.laneLo/laneHi` keep traffic lanes
      out of the opposite direction (1 lane if < 5.4 m). Side scrapes on static walls (bridge parapet) are no longer a
      crash unless head-on or ≥ 12 m/s into the wall; hitting a car still is.
- Tests: bridge-audit, city-life (overlapsMax 0), accident-ems, boarding PASS; road-surface 13 drives / 0 steps / 0 flips;
      lane-scan bumps 6 → 1 (a 10 cm edge at the east ramp foot).
- [!] The exact spot the user saw wasn't reproduced; the fixes cover the two causes found by the probe.

## v20 (Egypt: 26 governorate capitals + seated passengers)
- [x] Passengers sat facing forward with legs/arms bent backwards: `seatedGeometry` rotated thighs/arms the wrong way
      (+x rotation sends limbs to -z, the face is +z). Fixed signs; boarding test PASS (microbus/taxi/tuk-tuk).
- [x] Cities: picker on the start screen (list + Egypt outline from OSM relation 1473947), `?map=<id>`.
      Pipeline `tools/osm/egypt/*`: Egypt PBF (download.openstreetmap.fr, 2026-10-29) → `osmium extract` per city,
      `make_configs.py` (bbox ±2 km around the OSM place node; landmarks auto-picked from OSM tags, Arabic names only),
      `build_region.py` (+ multipolygon water: Nile/lakes, + sea from `natural=coastline`), Microsoft footprints
      (`fetch_ms.py`; none for Kharga/Marsa Matruh), roundabouts, ramps, audits → `pack_city.py` (5 gzip files/city,
      55 MB total; Artifact file limit 511). Tiles are kept as JSON text in the pack and parsed on demand.
- [x] Lines in other cities: from the main station/bus station to real OSM landmarks 0.9–3 km away (gameplay
      approximation, verified:false, fare ~7 EGP marked approximate). Spawn = main station (or centre).
- [x] Water colour per map (sea blue / Nile / canal green). Mosques/churches instanced (Cairo has ~65).
- [x] Free 3D model: Poly Haven "Plastic Monobloc Chair 01" (CC0) at every OSM café (chairs + small tables on the
      sidewalk). Kenney car kit (CC0) was tried and rejected: toy proportions don't fit the game.
- [x] Shop signs were mirrored (UVs reversed on both faces) — now readable.
- [!] "All of Egypt" at building level doesn't fit (≈1M km²; Artifact ≤256 MB): each capital's centre (~16 km²).

## v21 (governorate liveries, monuments, wider big cities, real-model pipeline)
- [x] Taxi + microbus colours per governorate (`maps.js` taxi {body, accent, style}): Cairo/Giza white + black checker,
      Alexandria black with yellow doors, Port Said white/blue, Kafr El Sheikh white/yellow, Menoufia green/yellow,
      Ismailia orange/white (sources conflict); others: white + checker (unverified). Microbus "لون المحافظة" = white
      with the governorate colour stripe + city name (Shibin keeps the real turquoise). Player taxi (Seal) + traffic sedans.
- [x] Wider maps: Giza 10.6×7 km (pyramids, Sphinx, GEM, Moneeb), Cairo 6.5×5 (Ramses, Egyptian Museum, Cairo Tower,
      Citadel, Azhar), Alexandria 8.6×7.5 (whole corniche Qaitbay→Stanley), Luxor 9.4×7 (temples + airport),
      Hurghada 6×8.6 (airport), Aswan 4.6×5. Spawn hints (Alex: Raml station; Giza: pyramids; Luxor: temple).
- [x] Monuments (`Monuments.js`): pyramids from OSM footprints + known heights, Sphinx, Cairo Tower, Pompey's Pillar,
      Qaitbay, Bibliotheca; airports from OSM runways/taxiways. OSM buildings inside a monument are not drawn twice.
- [x] Fixes found on the way: sky box stayed at the origin (black sky >2 km away — big cities); OSM `building=yes`
      drawn as blue glass malls (now apartments; castles/mosques stone); real-building roofs black (double-sided
      triangles + averaged normals); desert ground for desert/coastal cities; base pack released after load.
- [x] Real models: ToxSam repos checked (all stylised/fantasy → rejected for near-player use), Kenney (toy) rejected,
      CGTrader/BlendSwap need login. Sketchfab CC BY candidates verified by API (Lanos, Verna, Sunny, Bajaj tuk-tuk,
      Sphinx, Cairo Tower, Muhammad Ali Mosque); `tools/models/sketchfab.mjs` downloads + re-checks licence + simplifies
      (gltf-transform) + writes credits — needs `SKETCHFAB_API_TOKEN`. Game code ready (`realTrafficCar`, monuments).
- [x] ambientCG Asphalt031 (CC0) normal/roughness on the asphalt.
- [!] Big-city load (SwiftShader): Giza ~35 s, heap ~255 MB on the mobile profile (Shibin 139 MB). Real devices not measured.
- Audit: `docs/AUDIT.md` (`tools/osm/egypt/audit_cities.py`).
