# Directing brief — "How to read twenty minutes a day" (neutral)

One scene, about 11.6 s, no dialogue (this is a motion test; voice comes later).
Character and assets come from `selection_log.md`. Every size is the corrected real-world size from `assets_manifest.json`.

## Intent
A calm, ordinary moment that shows the habit: sit, pick up the book, read, look up at the viewer as if to say "just twenty minutes", put the book back. Neutral tone: no big gestures, no fast moves, plenty of stillness.

## Cast and set
| Element | Asset | Real size used |
|---|---|---|
| Character | Rocketbox `Male_Adult_08` (casual, not in a suit) | 1.83 m, factor 1.0 |
| Couch | `kaykit-furniture/couch_pillows` | seat 0.36 m, height 0.885 m (×0.723) |
| Side table (his right) | `kaykit-furniture/table_small` | top 0.72 m (×0.723) |
| Book | **procedural** `app/player/procedural_props.js#book` | 0.155 × 0.23 × 0.028 m (exact) |
| Tea cup | `food-kit/cup-tea` | 0.092 m (×0.461) |
| Floor lamp, low shelf, rug, back wall | `kaykit-furniture/lamp_standing`, `shelf_B_large_decorated`, `rug_rectangle_A`, `kaykit-restaurant/wall` | lamp 1.82 m, wall 3.0 m |

## Actions (only ones that already exist in the motion library)
| Time | Action | Motion source |
|---|---|---|
| 0.0–1.2 s | Seated, settled | mocap clip `sitting_idle` (base layer) + body preset `sit` |
| 1.2–1.5 s | Eyes then head go to the book (about 0.2 s delayed attention); torso turns ~18° toward the side table | gaze `lookPoint` + `bodyAdd.turn` |
| 1.5–2.6 s | Reach and grasp the book | `grasp.js` (same system as the cup/phone tests) |
| 2.6–4.1 s | Lift the book off the table, then bring it up to reading height in one curve | grasp carry + scene layers (lift routed above the table, reading tilt) |
| 3.6–7.0 s | Read: head down to the book, slight forward lean, left hand resting across the lap | body preset `sit_lean`, arm preset `cross` (left), gaze on the book |
| 6.9–8.2 s | Lift the eyes to the camera, small smile | gaze to camera B, face `smile`, body back to `sit` |
| 8.2–9.5 s | Put the book back on the side table (routed above the table, then straight down) | grasp place + scene routing |
| 9.5–11.6 s | Hand returns to the thigh, settles; hold at the end | grasp return + `sitting_idle` |

## Camera (two setups, three shots)
| Shot | Time | Setup | Cut reason |
|---|---|---|---|
| A | 0.00–7.07 s | Medium-wide 3/4 from front-left: couch end, side table and the whole body in frame, 36° lens | Establishes the place and shows the full action of picking up the book. |
| B | 7.07–8.37 s | Medium close-up, straight on at eye level, 30° lens | **Cut on the look**: as his eyes reach the lens, the close-up makes it direct eye contact with the viewer. |
| A2 | 8.37–11.6 s | Back to A | **Cut on action**: the book leaves the close-up frame as he places it, so we return to the wide shot to show the placement and the settle. |

No camera moves (static setups): the neutral tone wants stillness, and the cuts carry the rhythm.

## Lighting
Studio set with warm key light (lab `lights()` with day setting) and soft fill. A warm interior HDRI (`brown_photostudio_02`) is selected for the final scene in `selection_log.md`. The lab test uses the lab lighting rig so results stay comparable with Phase 1 tests.

## Pacing
Neutral and calm: about 1.2 s of stillness at the start, a 1.1 s reach, about 3 s of quiet reading, a 1.3 s look to camera, a 1.3 s placement, and about 2 s of settle and hold at the end. No beat is shorter than about 1 s.

## Known limits of this test
- The book is closed (no page-turning motion exists in the library).
- **Reading grip:** the flat-object top grip is reused for reading. From the front, the hand sits behind the book, so the book can read as floating (see the Step 2 report).
