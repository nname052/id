# Selection log — Phase 2, Steps 1, 1.5 and 2

Rules applied:
- Only assets with `license_clear: true` in `assets_manifest.json` are eligible (all 1,348 are clear; none excluded).
- No character repeats across topics.
- Serious and neutral topics use realistic, well-dressed Rocketbox people (user taste profile). Stylized characters are not used.
- One prop family per scene where possible, so the style stays consistent.
- **Step 1.5:** every size below is the **corrected** size (raw measured × the library's `scale_factor` from the manifest). A prop is kept only if its corrected size is within **±15%** of its real reference. Props that fail are swapped or dropped, never force-scaled one by one.
- Reproduce the numbers: `.venv/bin/python assets/tools/selection_check.py`.

---

## Topic 1 — Serious
**"The first hour after losing your job: three steps that keep you steady."**

| Role | Asset | Raw → corrected (m) | Reference | Result | Reason |
|---|---|---|---|---|---|
| Character | `rocketbox/Business_Male_03_facial` | 1.82 → 1.82 (×1.0) | adult 1.60–1.90 | ok | Realistic man in a suit, dignified tone, facial blendshapes for lip-sync. |
| Environment | `furniture-kit/wall`, `furniture-kit/wallWindow`, `furniture-kit/floorFull` | wall 1.29 → **2.52** (×1.956) | wall 2.4–3.0 | PASS (−7%) | Quiet home-office corner with one window. |
| Lighting | `hdri/studio_small_09` | 1024 × 512 px | n/a | — | Soft, low-contrast indoor light for a heavy moment. |
| Prop | `furniture-kit/desk` | top 0.383 → **0.75** | desk top 0.75 | PASS (+0%) | He sits at the desk to plan the next step. |
| Prop | `furniture-kit/chairDesk` | seat 0.232 → **0.455** | chair seat 0.45 | PASS (+1%) | Same family as the desk. |
| Prop | `food-kit/cup` | 0.20 → **0.092** (×0.461) | mug 0.10 | PASS (−8%) | Holding a cup = a pause to steady himself (Phase 1 grasp). |
| ~~Prop~~ | ~~`furniture-kit/laptop`~~ | 0.162 → 0.316 | open laptop ~0.24 | **dropped** (+32%) | The Kenney laptop is drawn ~1.3–1.6× larger than its own furniture; no laptop in any library passes. The "update your CV" beat needs another prop or a new asset. |
| ~~Prop~~ | ~~`food-kit/cup-coffee`~~ | 0.14 → 0.065 | mug 0.10 | **swapped** (−35%) | Replaced by `food-kit/cup`. |

## Topic 2 — Light
**"My three-minute morning coffee ritual."**

| Role | Asset | Raw → corrected (m) | Reference | Result | Reason |
|---|---|---|---|---|---|
| Character | `rocketbox/Female_Adult_06_facial` | 1.74 → 1.74 (×1.0) | adult 1.60–1.90 | ok | Casual everyday woman, friendly tone; different gender and outfit from Topic 1. |
| Environment | `furniture-kit/kitchenBar`, `furniture-kit/kitchenSink`, `furniture-kit/wallWindow`, `furniture-kit/floorFull` | counter top 0.42 → **0.82** (×1.956) | kitchen counter 0.9 | PASS (−9%) | Bright kitchen counter at standing height (Phase 1 lesson). **Swapped** from KayKit counters (see below). |
| Lighting | `hdri/kloofendal_48d_partly_cloudy_puresky` | 1024 × 512 px | n/a | — | Fresh morning daylight. |
| Prop | `food-kit/cup` | 0.20 → **0.092** | mug 0.10 | PASS (−8%) | Hero prop: picks up the cup, sips, puts it down. |
| Prop | `furniture-kit/kitchenCoffeeMachine` | 0.177 → **0.347** | coffee machine ~0.35 | PASS (−1%) | Pressing the button = first habit beat. Same family as the counter. |
| Prop | `food-kit/apple` | 0.191 → **0.088** | apple ~0.08 | PASS (+10%) | Small fresh treat = light ending. **Swapped** from the croissant. |
| ~~Environment~~ | ~~`kaykit-restaurant/kitchencounter_straight_A_backsplash`~~ | top 0.999 → 0.748 | counter 0.9 | **swapped** (−17%) | KayKit draws counters at the same height as tables, so one factor cannot fix both. |
| ~~Prop~~ | ~~`food-kit/croissant`~~ | 0.478 → 0.22 | croissant ~0.14 long | **swapped** (+57%) | Drawn far larger than the kit's cups. |

## Topic 3 — Neutral
**"How to read twenty minutes a day."**

| Role | Asset | Raw → corrected (m) | Reference | Result | Reason |
|---|---|---|---|---|---|
| Character | `rocketbox/Male_Adult_08_facial` | 1.83 → 1.83 (×1.0) | adult 1.60–1.90 | ok | Neutral everyday man, not in a suit. |
| Environment | `kaykit-restaurant/wall`, `kaykit-furniture/rug_rectangle_A`, `kaykit-furniture/shelf_B_large_decorated` | wall 4.0 → **3.00** (×0.749) | wall 2.4–3.0 | PASS (+11%) | Simple living-room corner with a full shelf as the background. |
| Lighting | `hdri/brown_photostudio_02` | 1024 × 512 px | n/a | — | Warm, even light for a calm explainer. |
| Prop | `kaykit-furniture/couch` | 1.224 → **0.885** (×0.723) | sofa 0.85 | PASS (+4%) | He sits and reads. |
| Prop | `kaykit-furniture/lamp_standing` | 2.52 → **1.82** | floor lamp ~1.6 | PASS (+14%, near the limit) | Switching it on = "pick a fixed time". |
| Prop | `food-kit/cup-tea` | 0.20 → **0.092** | mug 0.10 | PASS (−8%) | Tea beside him = "make it a ritual". |
| Prop | `procedural/book_procedural` (`app/player/procedural_props.js#book`) | built at 0.155 × 0.028 × 0.23 → measured **0.155 × 0.028 × 0.23** (×1.0) | book 0.155 × 0.23 × 0.028 | PASS (0% on every axis; limit ±10%) | Hero prop: picks up the book and reads. Procedural because no library book passes (see below). Decided by the user in Step 2. |
| ~~Prop~~ | ~~`kaykit-furniture/book_single`~~ | 0.50 → 0.361 | book 0.22 | **dropped** (+64%) | Drawn oversized; `furniture-kit/books` also fails (+34%). **No book in any library passes.** Replaced by the procedural book above. |

---

## Check: no character repeats
Business_Male_03 · Female_Adult_06 · Male_Adult_08 → **3 different characters** ✅

## Notes
- Rocketbox `scale_factor` = **1.0**: measured heights 1.729–1.826 m (all 20 characters), already real adult heights.
- Passing items that are also references for their library's factor (desk, chairDesk, cup, couch, walls) pass partly by construction. The independent checks are the coffee machine (−1%), apple (+10%), counter (−9%), floor lamp (+14%) and tea cup (−8%).
