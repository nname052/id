# CLAUDE.md — continuation notes for the Egyptian microbus / Shibin El Kom driving game

## Project
- Vite + three.js 0.170 PWA, code comments in Egyptian Arabic (keep that style).
- Default map: **real Shibin El Kom** (`src/world/shibin/*`, data in `public/data/shibin`, built from OSM by
  `tools/osm/build_region.py`). The old fictional map was removed (v13): Shibin only.
- **Other Egyptian cities (v20)**: 26 governorate capitals (`src/world/maps.js`, picker on the start screen, `?map=<id>`).
  Same code (`ShibinWorld` with `id`), data built by `tools/osm/egypt/build_city.sh <id>` (Egypt PBF from
  download.openstreetmap.fr → `osmium extract` per city in `../data/osm/egypt/cities`, configs from `make_configs.py`,
  MS footprints from `fetch_ms.py`) into `../data/cities/<id>` (raw, not in git), then `pack_city.py` → 5 gzip+base64 .txt files in
  `public/packs/<id>/` (the Artifact allows 511 files). `ShibinData.loadJSON` reads packs transparently (`usePacks`).
  Everything Shibin-specific must stay behind `world.id === 'shibin'` or a landmark lookup (`mainStation()`).
- Published as a claude.ai Artifact (`dist/index.html` + `files` map). GLB models are base64-inlined in the JS
  (the Artifact host can't serve .glb), the service worker is intentionally disabled.

## Data post-processing (run after `tools/osm/build_region.py`, in this order)
- `python3 tools/osm/import_ms_buildings.py` — real building footprints (Microsoft Global ML Building
  Footprints, ODbL, quadkey 122121120 filtered to the city bbox) replace the generated buildings inside the city.
- `python3 tools/osm/roundabouts.py tools/osm/roundabouts_overpass.json` — OSM roundabout islands (grass/kerb/palms)
  into features.json; removes buildings inside the rings.
- `python3 tools/osm/unify_ramps.py` (run 4×) — both carriageways of a ramp share one height where their decks overlap.
- `python3 tools/osm/smooth_ramps.py` — ramps rise monotonically + vertical curves (no 4 m "saw-tooth"), twins kept
  together; deck heights are then copied from the graph (physics = drawn surface).
- `python3 tools/osm/audit_buildings.py --fix` — shrinks/removes building rectangles that touch asphalt/sidewalk/decks.
- `python3 tools/osm/clean_sidewalks.py` — paves the sidewalk "spikes" inside junctions (convex hull of the junction asphalt).
- `python3 tools/osm/audit_buildings.py --fix-real` — pulls real OSM footprints off widened asphalt; without flags it
  only reports overlaps (generated buildings vs asphalt/sidewalk/bridge decks; should print zeros).
- `python3 tools/photos/build_atlas.py` — rebuilds `public/textures/shibin-photo-atlas.jpg` + `src/render/photoAtlas.json`
  from the Commons photos in `tools/photos/sources.json` (cache in `tools/photos/cache`, not in git).

## Run / test
- Dev server: `NOHMR=1 npx vite --port 5173 --strictPort`; build: `npx vite build`; preview: `npx vite preview --port 4173`.
- Cities smoke test: `node tools/tests/cities.mjs <url> [id ...]` (every map opens, drives, no errors).
- All tests: `TAIL=3 sh tools/tests/run-all.sh` (Playwright + SwiftShader, ~1.5 h). Run heavy tests one at a time:
  running them in parallel starves the e2e mobile page (20 min timeouts).
- Do not use `pkill -f <pattern>` in shell commands (it can match the shell itself → exit 144); use `pgrep` + PID.
- Performance: `node tools/tests/perf-bench.mjs <url> desktop|mobile cold|warm` (`PROF=1` adds a CPU profile;
  use the dev server URL for readable function names). Draw calls are skipped on purpose (no GPU here) —
  never report its FPS as real-device FPS.

## Things that are easy to break
- **Shader warm-up** (`Game.precompile`): compile once after the start tiles exist; link programs during loading.
  Never add an extra vehicle (with its own lights) to the scene for warm-up — a different light count recompiles
  every material. Use `renderer.compileAsync(obj, camera, scene)` with the current vehicle's lights hidden.
- **Static world**: tile groups and expansion gates have `matrixWorldAutoUpdate = false` after build. Anything that
  moves must not be added under them. Hidden traffic rigs skip matrix updates (`skipHidden` in ShibinTraffic).
- **Traffic LOD** (`TrafficLod.js`): shape cache key = geometry content, not uuid; per-colour vertex colours.
- **HiAce interior** (`HiaceIntegration.js`): `clipInteriorToBody` keeps the dashboard/floor inside the rounded
  front; `tools/tests/hiace-front.mjs` fails if interior shows through the body again.
- **Cockpit camera** (`CameraSystem.js`): `fovH` is horizontal FOV; horizon uses `player.groundPitch/groundRoll`
  + partial suspension (`MOTION` table). `tools/tests/cockpit-view.mjs` checks cabin %, road visibility, horizon roll.
- **Deck height** (`ShibinWorld.height`): past a segment end the height follows the segment's slope (≤1.5 m), not the
  clamped end height — the clamped value + the neighbour blend made a bump every 4 m on ramps.
- **Twin one-way carriageways** (bridge: OSM lines 5–7 m apart, 8 m wide): `edge.laneLo/laneHi` (ShibinData) keep traffic
  lanes out of the opposite direction; static-wall side scrapes are not a "crash" (Game onImpact).
- **Canal water**: the ground plane (y≈0) covers the water (y=-0.55). Water draws first (renderOrder -3), then a
  depth-only "cut" over the canal (renderOrder -2), then the ground. Keep that order or the canal disappears up close.
- **Photo textures**: never add photos without author/licence in `sources.json`; Google Maps/Earth/Street View are not allowed.
- Don't invent landmarks/routes and label them real; don't fake test results; real-device FPS/thermals need the user.
