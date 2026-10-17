# Selection log — Phase 2, Step 1

Rules applied:
- Only assets with `license_clear: true` in `assets_manifest.json` are eligible (all 1,348 are clear; none excluded).
- No character repeats across topics.
- Serious and neutral topics use realistic, well-dressed Rocketbox people (user taste profile). Stylized characters (KayKit 2.2–2.7 m, Kenney minis 0.7 m, RobotExpressive 4.5 m) are not used.
- One prop family per scene where possible, so the style stays consistent.
- Sizes below are the **measured** bounding boxes from the manifest (x, y=height, z, in meters). Scale problems are **reported, not fixed** (Step 1 scope).

---

## Topic 1 — Serious
**"The first hour after losing your job: three steps that keep you steady."**

| Role | Asset (manifest path) | Measured size (m) | Scale status | Reason |
|---|---|---|---|---|
| Character | `assets/3d/rocketbox/Business_Male_03/Business_Male_03_facial.fbx` | 1.35 × **1.82** × 0.34 | ok (adult male) | Realistic man in a suit: fits a serious, dignified tone; facial blendshapes for lip-sync. |
| Environment | `furniture-kit/wall`, `furniture-kit/wallWindow`, `furniture-kit/floorFull` | wall 1.0 × **1.29** × 0.05; floor 1.0 × 0.05 × 1.0 | **wall flagged** (1.29 m vs 2.2–4.5 m) | Quiet home office corner with one window: plain and calm, nothing distracting. |
| Lighting | `assets/3d/hdri/studio_small_09.hdr` | 1024 × 512 px | n/a (image) | Soft, low-contrast indoor light for a heavy moment. |
| Prop | `furniture-kit/desk` | 0.73 × **0.38** × 0.39 | **flagged** (0.38 m vs 0.6–0.85 m) | He sits down at the desk to plan the next step. |
| Prop | `furniture-kit/chairDesk` | 0.34 × **0.61** × 0.31 | **flagged** (0.61 m vs 0.65–1.2 m) | Matches the desk (same family). |
| Prop | `furniture-kit/laptop` | 0.26 × 0.16 × 0.24 | not flagged, but the family is ~0.5× real size (see note) | Opening the laptop = "update your CV" beat. |
| Prop | `food-kit/cup-coffee` | 0.22 × 0.14 × 0.29 | not flagged (height inside the cup range) | Holding a cup = a pause to steady himself; uses the Phase 1 grasp system. |

## Topic 2 — Light
**"My three-minute morning coffee ritual."**

| Role | Asset (manifest path) | Measured size (m) | Scale status | Reason |
|---|---|---|---|---|
| Character | `assets/3d/rocketbox/Female_Adult_06/Female_Adult_06_facial.fbx` | 1.22 × **1.74** × 0.37 | ok (adult female) | Casual everyday woman: friendly, light tone; different gender and outfit from Topic 1. |
| Environment | `kaykit-restaurant/kitchencounter_straight_A_backsplash`, `kaykit-restaurant/kitchencounter_sink_backsplash`, `kaykit-restaurant/floor_kitchen` | counter 2.0 × **1.20** × 2.04; sink 2.0 × 1.80 × 2.04; floor 4.0 × 0.5 × 4.0 | not flagged (no counter rule), but KayKit is ~1.3× real (a counter top should be ~0.9 m) | Bright kitchen counter: the action happens at a counter at standing height (Phase 1 lesson). |
| Lighting | `assets/3d/hdri/kloofendal_48d_partly_cloudy_puresky.hdr` | 1024 × 512 px | n/a (image) | Fresh morning daylight. |
| Prop | `food-kit/cup-coffee` | 0.22 × 0.14 × 0.29 | not flagged | The hero prop: picks up the cup, sips, puts it down. |
| Prop | `furniture-kit/kitchenCoffeeMachine` | 0.19 × **0.18** × 0.24 | not flagged (no rule), but ~0.5× real (a real machine is ~0.35 m) | Pressing the button = the first habit beat. |
| Prop | `food-kit/croissant` | 0.35 × 0.19 × **0.48** | **flagged** (0.48 m vs 0.02–0.45 m) | Small treat = light, warm ending. |

## Topic 3 — Neutral
**"How to read twenty minutes a day."**

| Role | Asset (manifest path) | Measured size (m) | Scale status | Reason |
|---|---|---|---|---|
| Character | `assets/3d/rocketbox/Male_Adult_08/Male_Adult_08_facial.fbx` | 1.35 × **1.83** × 0.34 | ok (adult male) | Neutral everyday man, not in a suit: separates the explainer tone from Topic 1. |
| Environment | `kaykit-furniture/rug_rectangle_A`, `kaykit-furniture/shelf_B_large_decorated`, `kaykit-restaurant/wall` | rug 3.0 × 0.1 × 2.0; shelf 2.0 × 0.82 × 0.5; wall 4.0 × 4.0 × 0.5 | not flagged | Simple living-room corner with a full shelf as the background. |
| Lighting | `assets/3d/hdri/brown_photostudio_02.hdr` | 1024 × 512 px | n/a (image) | Warm, even light for a calm explainer. |
| Prop | `kaykit-furniture/couch` | **3.0** × 1.22 × 1.6 | **flagged** (length 3.0 m vs 1.2–2.8 m) | He sits and reads. |
| Prop | `kaykit-furniture/lamp_standing` | 1.0 × **2.52** × 1.0 | **flagged** (2.52 m vs 0.2–2.0 m) | Reading lamp: switching it on = "pick a fixed time". |
| Prop | `kaykit-furniture/book_single` | 0.26 × **0.50** × 0.37 | **flagged** (0.50 m vs 0.12–0.40 m) | The hero prop: picks up the book (same grasp system as the cup). |
| Prop | `food-kit/cup-tea` | 0.24 × 0.20 × 0.29 | not flagged | Tea beside the book = "make it a ritual". |

---

## Check: no character repeats
Business_Male_03 · Female_Adult_06 · Male_Adult_08 → **3 different characters** ✅

## Notes for Step 2 (not acted on now)
- **Family scale factors (measured):** Kenney `furniture-kit` is about **0.5×** real size (wall 1.29 m, chair 0.47 m, desk 0.38 m). KayKit is about **1.3×** (counter 1.2 m, lamp 2.52 m, couch 3.0 m). Props should be normalized to real meters per family or per category before use (planned Phase 2 item).
- **No phone model** exists in any library (Phase 1 used a procedural box). A phone topic would need a procedural prop or a new asset (no downloads in this step).
- **Missing specular textures** for Rocketbox (excluded on purpose by `assets/tools/fetch_rocketbox.py`) cause the 404s seen at Phase 1 closure. They are harmless.
