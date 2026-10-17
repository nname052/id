# Phase 2, Step 2: procedural book, directing brief, test scene

Branch: `autovideo-motion-v2`. `grasp.js` and `rig.js` were not changed. Original asset files were not modified.

## Acceptance

| Item | Result | Evidence |
|---|---|---|
| Book size within ±10% of real size | **PASS** | measured 0.155 × 0.028 × 0.23 m vs real 0.155 × 0.028 × 0.23 m: 0% on every axis (`assets_manifest.json` → `book_procedural`, `procedural: true`) |
| Brief exists and uses only existing actions | **PASS** | `phase2_brief_read.md`: `sitting_idle` clip, body presets `sit`/`sit_lean`, arm preset `cross`, `grasp.js`, gaze, face presets; 2 camera setups, 3 shots, cut reasons, lighting, pacing |
| Test scene frames show no clipping, no floating book, no frozen limbs | **FAIL** (2 of 3 parts pass) | see below |
| No pops above 5 cm | **PASS** | max 4.28 cm/frame at 2.0 s (right hand rising from the thigh, continuous at 30 fps); 0 frames above 5 cm |
| Old 3D scenes: zero console errors | **PASS** | fridge, Rocketbox, cartoon (scene), body, look: 0 page errors, 0 console errors |

### Item 3 in detail
- **No clipping: PASS.** Body vs couch: deepest point inside the couch 0.8 cm (back of the knee at the seat edge), checked every 0.25 s over the whole scene. Book vs table: 0 frames inside the table. Hand over the side table: lowest point 0.738 m vs top 0.723 m (never below).
- **No frozen limbs: PASS.** The left (free) arm follows the `sitting_idle` mocap (27 cm of travel over the scene) and moves to the lap while reading.
- **No floating book: FAIL.** Numerically the book is held: closest finger skin 0.1 mm from the book for all 200 held frames, the book never moves relative to the hand, and it sits exactly on the table before and after (0.723 m). **But in the front close-up while reading (4.2–7.8 s) the book reads as floating:** the flat-object top grip is reused for reading, so after the book is tilted toward his face the hand is behind it with no thumb on the front (side view in the frame sheet). Fixing it needs a dedicated reading grip in `grasp.js` (thumb on the front cover, fingers behind), which is outside this run's allowed changes. **Needs your approval.**

## Scale numbers in the scene (corrected, from the manifest)
| Item | Size |
|---|---|
| Character `Male_Adult_08` | 1.83 m (factor 1.0) |
| Couch seat / height | 0.36 m / 0.885 m |
| Side table top | 0.723 m |
| Book | 0.155 × 0.028 × 0.23 m |
| Tea cup | 0.092 m |
| Floor lamp | 1.82 m |
| Back wall | 3.0 m |

## Fixes made during this step (none in `grasp.js` / `rig.js`)
1. **Old-scene console errors:** `player3d.js` maps the never-downloaded Rocketbox `*_specular` textures to a blank in-memory image (404s gone; the materials don't use specular maps).
2. **Seated pose, scene layer:** the root sits at the hips with the feet planted via `feetW`. Otherwise the standing balance pulled the hips 43 cm off the couch.
3. **Seated corrections, scene layer:** the standing-only reach crouch and lean hip-back are cancelled with `bodyAdd`.
4. **Gaze:** soft ±65° limit plus an 18° torso turn toward the side table. The rig's hard 75° head clamp stopped the head abruptly, and on the Biped skeleton the shoulders hang from the neck, so the hand popped 4.96 cm.
5. **Lift and place routed over the table, scene layer:** with a seated (low) hold, the straight grasp path pushed the book 11.8 mm into the table edge.

## Follow-ups that belong in the shared systems (need approval to change `rig.js` / `grasp.js`)
- `grasp.js`: a reading grip for flat objects; lift/place routing above the support surface when the hold position is lower than it.
- `rig.js`: a seated mode for balance, crouch and hip-back; the head soft limit; the reach-deficit maximum (a new reach entering at small weight makes the torso lean jump: seen with a left-hand thigh rest, avoided by using the `cross` preset).

## Files
- `app/player/procedural_props.js` (new): procedural book at real size.
- `assets_manifest.json`: `book_procedural` entry (`procedural: true`, measured vs real size); counts 1,349 assets.
- `selection_log.md`: Topic 3 uses the procedural book.
- `phase2_brief_read.md` (new): directing brief.
- `app/player/tools/lab.js`: `read` scene with edit mode (shots and cuts) and close-up cameras. `tests/motion_lab.py` passes the library scale factors.
- Videos and frame sheet (local, `videos/` is gitignored): `videos/_tests/phase2/read_edit.mp4`, `read_reachClose.mp4`, `read_readClose.mp4`, `read_readSide.mp4`, `read_frames.png`.
