# Phase 1 — 3D motion foundation

Branch: `autovideo-motion-v2`

**Status: CLOSED WITH OPEN ITEMS** (Phase 2 not started; waiting for approval)

## What works (verified on 5b0818e, re-checked at closure)

| Check | Result |
|---|---|
| 1A cup: hand height over the table | lowest skin point 0.9245 m vs table top 0.92 m (+4.5 mm), never below |
| 1A cup: palm to cup surface while held | 1.9 mm, constant over all 72 held frames |
| 1A cup: finger penetration | none (closest finger skin +0.2 mm) |
| 1A cup: cup in hand while carried | 1 unique offset over 72 frames (no slip, no float); 0.0 mm jump at attach |
| 1A cup: placed on table | 0.0 mm gap |
| 1A cup: feet / balance | sole 0.0 cm (−0.1 mm rounding), COM outside feet 0.0 cm |
| 1A cup: largest pop | 1.88 cm/frame at 1.6 s (hand turning over the table edge; continuous at 30 fps) |
| 1A cup: torso lean | ~5° (was 53°): standing-height counter + `standFor` placement |
| 1C duo: feet / balance | 0.0 cm / 0.0 cm |
| 1C duo: largest pop | 4.65 cm/frame at 7.1 s (known, real motion); no pops above 5 cm |
| 1C duo: gaze | delayed attention: A turns at 0.27 s (B speaks at 0), B at 0.67 s (A speaks at 0.4) |
| 1C duo: pointing | `pointAt` aims at B with the hand on B's side, never crosses the body |
| Old 3D scenes (fridge, Rocketbox, cartoon, body, look) | render fully, 0 page errors; see the asset 404s open item |

Foundation: Mixamo clips retargeted onto any skeleton (`clips.js`) as the base layer; IK, balance, gaze and planted feet as correction layers (`rig.js`); one grasp system for cup / phone / book (`grasp.js`).

## Open items

1. **Grasp visual quality**: see Known issues below.
2. **Book lift motion**: the book's edge should be raised before the grasp. Today it is pinched flat from above.
3. **Phone scene head-turn pop**: 4.3 cm/frame at 5.2 s, from the head turning to camera (not from the grasp).
4. **A's arm return after pointing (1C)**: the arm holds still a little long before blending back to the clip.
5. **Missing Rocketbox specular textures (assets, pre-existing)**: the fridge and Rocketbox scenes log 404s for `*_specular.png` (e.g. `m008_body_specular.png`) that the FBX files reference but were never downloaded. Not a Phase 1 regression: the loader is unchanged and the files are absent from `assets/3d/rocketbox/`. The scenes render fully.

## Phase 1 commits

| Commit | Summary |
|---|---|
| `0a67ad4` | 3D motion engine: balance, reach IK, planted steps, smooth hands |
| `0f67470` | Grasp: pick up, hold and place real objects |
| `8d12c83` | Motion lab: Phase 1 test scenes with per-frame metrics |
| `4bcb2bd` | Mocap base layer + generic grasp system; cup scene upright |
| `2a14042` | Duo: clip-driven talk/listen, pointAt aimed at the other person, natural back step |
| `8ea8e5d` | Grasp: same system on phone and book (flat objects use an edge pinch) |
| `5b0818e` | Grasp: skin-accurate contact, above-surface reach, exact held orientation |
| `54a4571` | Phase 1 report: record grasp visual quality as a known issue |

## Known issues

### Grasp visual quality (open)
Grasp visual quality: palm curves unnaturally during grip; hand does not read as wrapped around the cup in close-up. Numeric checks pass. Needs visual fix in a later pass. Affects cup, book, phone.

Frames to review (1A cup close-up, `videos/_tests/phase1/1A_cup_hand.mp4`, rendered by `tests/motion_lab.py cup hand`):

| Stage | Time |
|---|---|
| Reach | 1.55 s |
| Grasp | 2.45 s |
| Lift  | 3.0 s |

Stage sheet with the same frames from two angles: `videos/_tests/phase1/fixes/grasp_fix_stages_closeup.png`.
Videos are local only (`videos/` is gitignored); re-render with the command above.
