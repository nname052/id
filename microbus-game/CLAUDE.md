# CLAUDE.md — continuation notes for the Egyptian microbus / Shibin El Kom driving game

## Project
- Vite + three.js 0.170 PWA, code comments in Egyptian Arabic (keep that style).
- Default map: **real Shibin El Kom** (`src/world/shibin/*`, data in `public/data/shibin`, built from OSM by
  `tools/osm/build_region.py`). The old fictional map was removed (v13): Shibin only.
- Published as a claude.ai Artifact (`dist/index.html` + `files` map). GLB models are base64-inlined in the JS
  (the Artifact host can't serve .glb), the service worker is intentionally disabled.

## Run / test
- Dev server: `NOHMR=1 npx vite --port 5173 --strictPort`; build: `npx vite build`; preview: `npx vite preview --port 4173`.
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
- Don't invent landmarks/routes and label them real; don't fake test results; real-device FPS/thermals need the user.
