# Phase 2, Step 1.5: per-library scale correction

Branch: `autovideo-motion-v2` · scale applied at manifest level only (original asset files untouched). No scene built.

## Acceptance

| Item | Result | Evidence |
|---|---|---|
| Every library has a stated correction factor with its evidence | PASS | 19 libraries, each with value + reason + evidence (HDRI: no spatial size, factor 1.0) |
| Manifest has both raw and corrected scale for every asset | PASS | 1348/1348 assets have `scale` (raw) + `scale_factor` + `scale_corrected` |
| Items still out of range after correction are listed with reasons | PASS | 119 items, each with a reason (`scale_check` in the manifest and below) |
| The 3 selected topics' props are within ±15% of their reference | PASS | 9/9 selected props and 6/6 selected environment pieces pass; 6 failing candidates were swapped or dropped (listed) |
| Rocketbox factor is 1.0 and heights are verified | PASS | factor 1.0; 20 characters, 1.729–1.826 m |

## Out-of-range counts

| | Before correction | After correction |
|---|---|---|
| Props + environment pieces outside their plausible range | 350 | 119 |

## Library factors

Factor = median of (real reference ÷ measured) over reference items **from the same library**. `seat`/`top` = height of the largest horizontal surface (measured from the mesh), not the bounding box. Characters: 1.0 when the median height is already adult (1.6–1.9 m).

| Library | Factor | Evidence (asset: measured → reference) | Spread |
|---|---|---|---|
| (root) | ×0.392 | median character height 4.4612 m (range 4.4612–4.4612, n=1) | — |
| car-kit | ×1.153 | sedan h 1.3→1.45; police h 1.3→1.55; taxi h 1.5→1.6; suv h 1.3→1.7 | 1.23× |
| city-kit-commercial | ×5.111 | detail-parasol-a h 0.45→2.3; detail-parasol-b h 0.45→2.3 | 1.00× |
| city-kit-roads | ×8.176 | construction-cone h 0.0938→0.7; road-sign-stop h 0.4941→2.2; light-square h 0.6→6.0; light-curved h 0.675→6.0 | 2.25× |
| city-kit-suburban | ×4.074 | fence h 0.27→1.1; fence-1x2 h 0.27→1.1; fence-2x2 h 0.27→1.1 | 1.00× |
| food-kit | ×0.461 | mug h 0.2734→0.1; cup h 0.2→0.1; glass h 0.2851→0.12; bottle-ketchup h 0.3931→0.2 | 1.39× |
| furniture-kit | ×1.956 | desk top 0.3834→0.75; table top 0.3259→0.75; chair seat 0.2409→0.45; chairDesk seat 0.2324→0.45; loungeSofa h 0.46→0.85; wall h 1.2895→2.7; kitchenCabinet top 0.3904→0.9 | 1.25× |
| hdri | ×1.0 | HDRI images have no spatial size | — |
| holiday-kit | ×2.05 | cabin-door-rotate h 1→2.05; cabin-wall h 1→2.4; bench h 0.7305→0.85 | 2.06× |
| kaykit-adventurers | ×0.73 | median character height 2.3978 m (range 2.187–2.7157, n=5) | — |
| kaykit-city | ×3.932 | car_sedan h 0.3688→1.45; car_hatchback h 0.3688→1.45; car_stationwagon h 0.3688→1.45; bench h 0.1→0.45 | 1.14× |
| kaykit-furniture | ×0.723 | chair_A seat 0.5002→0.45; table_medium top 0.9975→0.75; couch h 1.2241→0.85; book_single h 0.5→0.22 | 2.05× |
| kaykit-restaurant | ×0.749 | chair_A seat 0.4983→0.45; kitchentable_A top 1.0012→0.75; kitchencounter_straight_A top 0.9975→0.9; door_A h 2.8→2.05; wall h 4→2.7 | 1.34× |
| mini-characters | ×1.818 | wheelchair h 0.495→0.9; wheelchair-deluxe h 0.495→0.9; aid-cane h 0.315→0.9; aid-crutch h 0.31→1.3; aid-glasses len 0.33→0.14 | 9.89× |
| mixamo | ×1.0 | median character height 1.8611 m (range 1.4738–2.1161, n=15) | — |
| nature-kit | ×2.935 | canoe len 1.15→4.6; bed len 0.7473→1.9; fence_simple h 0.345→1.1; tent_smallClosed h 0.5611→1.2; sign h 0.4088→1.2 | 1.87× |
| rocketbox | ×1.0 | median character height 1.7985 m (range 1.7288–1.8257, n=20) | — |
| ual1 | ×1.0 | median character height 1.8287 m (range 1.8287–1.8287, n=2) | — |
| ual2 | ×1.0 | median character height 1.8175 m (range 1.8062–1.8287, n=2) | — |

Low-confidence factors (wide spread or few references): `mini-characters` (spread 9.9×: chibi props drawn at mixed scales), `city-kit-roads` (2.25×), `holiday-kit` (2.06×), `kaykit-furniture` (2.05×, the oversized book), `city-kit-commercial` (only the parasols as reference).

## Selection spot check (corrected sizes, ±15%)

| Topic | Role | Asset | Measure | Raw (m) | Factor | Corrected (m) | Reference | Deviation | Result |
|---|---|---|---|---|---|---|---|---|---|
| 1 serious | prop | `furniture-kit/desk` | top | 0.383 | ×1.956 | 0.75 | 0.75 (table/desk top ~0.75 m) | +0% | PASS |
| 1 serious | prop | `furniture-kit/chairDesk` | seat | 0.232 | ×1.956 | 0.455 | 0.45 (chair seat ~0.45 m) | +1% | PASS |
| 1 serious | prop | `food-kit/cup` | h | 0.2 | ×0.461 | 0.092 | 0.1 (mug ~0.10 m) | -8% | PASS |
| 1 serious | env | `furniture-kit/wall` | h | 1.29 | ×1.956 | 2.522 | 2.7 (wall 2.4-3.0 m) | -7% | PASS |
| 1 serious | env | `furniture-kit/wallWindow` | h | 1.29 | ×1.956 | 2.522 | 2.7 (wall 2.4-3.0 m) | -7% | PASS |
| 2 light | prop | `food-kit/cup` | h | 0.2 | ×0.461 | 0.092 | 0.1 (mug ~0.10 m) | -8% | PASS |
| 2 light | prop | `furniture-kit/kitchenCoffeeMachine` | h | 0.177 | ×1.956 | 0.347 | 0.35 (drip coffee machine ~0.35 m (typical)) | -1% | PASS |
| 2 light | prop | `food-kit/apple` | h | 0.191 | ×0.461 | 0.088 | 0.08 (apple ~0.08 m (typical)) | +10% | PASS |
| 2 light | env | `furniture-kit/kitchenBar` | top | 0.419 | ×1.956 | 0.819 | 0.9 (kitchen counter ~0.9 m) | -9% | PASS |
| 2 light | env | `furniture-kit/kitchenSink` | top | 0.42 | ×1.956 | 0.822 | 0.9 (kitchen counter ~0.9 m) | -9% | PASS |
| 2 light | env | `furniture-kit/wallWindow` | h | 1.29 | ×1.956 | 2.522 | 2.7 (wall 2.4-3.0 m) | -7% | PASS |
| 3 neutral | prop | `kaykit-furniture/couch` | h | 1.224 | ×0.723 | 0.885 | 0.85 (sofa ~0.85 m tall) | +4% | PASS |
| 3 neutral | prop | `kaykit-furniture/lamp_standing` | h | 2.52 | ×0.723 | 1.822 | 1.6 (floor lamp ~1.6 m (typical)) | +14% | PASS |
| 3 neutral | prop | `food-kit/cup-tea` | h | 0.2 | ×0.461 | 0.092 | 0.1 (mug ~0.10 m) | -8% | PASS |
| 3 neutral | env | `kaykit-restaurant/wall` | h | 4 | ×0.749 | 2.996 | 2.7 (wall 2.4-3.0 m) | +11% | PASS |
| 1 serious | rejected | `furniture-kit/laptop` | h | 0.162 | ×1.956 | 0.316 | 0.24 (open laptop ~0.24 m (typical)) | +32% | rejected (FAIL) |
| 1 serious | rejected | `food-kit/cup-coffee` | h | 0.14 | ×0.461 | 0.065 | 0.1 (mug ~0.10 m) | -35% | rejected (FAIL) |
| 2 light | rejected | `food-kit/croissant` | len | 0.478 | ×0.461 | 0.22 | 0.14 (croissant ~0.14 m long (typical)) | +57% | rejected (FAIL) |
| 2 light | rejected | `kaykit-restaurant/kitchencounter_straight_A_backsplash` | top | 0.999 | ×0.749 | 0.748 | 0.9 (kitchen counter ~0.9 m) | -17% | rejected (FAIL) |
| 3 neutral | rejected | `kaykit-furniture/book_single` | h | 0.5 | ×0.723 | 0.361 | 0.22 (book ~0.22 m tall) | +64% | rejected (FAIL) |
| 3 neutral | rejected | `furniture-kit/books` | len | 0.15 | ×1.956 | 0.294 | 0.22 (book ~0.22 m tall) | +34% | rejected (FAIL) |

selected props within ±15%: 9/9; selected environment pieces within ±15%: 6/6

## Rocketbox

`scale_factor` = **1.0** for all 20 Rocketbox characters. Measured heights 1.729–1.826 m, already within 1.73–1.83 m; no correction applied.

## Still out of range after correction (reported, not fixed)

By library: kaykit-restaurant 41, furniture-kit 16, car-kit 12, food-kit 11, holiday-kit 10, city-kit-suburban 7, kaykit-furniture 7, mini-characters 6, nature-kit 6, kaykit-city 2, city-kit-commercial 1

| Library | Asset | Category | Dim | Corrected (m) | Plausible (m) | Reason |
|---|---|---|---|---|---|---|
| car-kit | race | car | len | 2.9514 | 3.2–6.5 | stylized proportion: the kit draws this item smaller than its reference set (0.92x off range) |
| car-kit | race-future | car | len | 3.0667 | 3.2–6.5 | stylized proportion: the kit draws this item smaller than its reference set (0.96x off range) |
| car-kit | sedan | car | len | 2.9402 | 3.2–6.5 | stylized proportion: the kit draws this item smaller than its reference set (0.92x off range) |
| car-kit | sedan-sports | car | len | 2.9402 | 3.2–6.5 | stylized proportion: the kit draws this item smaller than its reference set (0.92x off range) |
| car-kit | suv | car | len | 3.1131 | 3.2–6.5 | stylized proportion: the kit draws this item smaller than its reference set (0.97x off range) |
| car-kit | taxi | car | len | 3.1707 | 3.2–6.5 | stylized proportion: the kit draws this item smaller than its reference set (0.99x off range) |
| car-kit | tractor-police | car | len | 2.6537 | 3.2–6.5 | stylized proportion: the kit draws this item smaller than its reference set (0.83x off range) |
| car-kit | van | car | len | 3.1707 | 3.2–6.5 | stylized proportion: the kit draws this item smaller than its reference set (0.99x off range) |
| car-kit | firetruck | large vehicle | len | 3.9202 | 5.0–13.0 | stylized proportion: the kit draws this item smaller than its reference set (0.78x off range) |
| car-kit | garbage-truck | large vehicle | len | 3.9779 | 5.0–13.0 | stylized proportion: the kit draws this item smaller than its reference set (0.80x off range) |
| car-kit | truck | large vehicle | len | 3.4014 | 5.0–13.0 | stylized proportion: the kit draws this item smaller than its reference set (0.68x off range) |
| car-kit | truck-flat | large vehicle | len | 3.1651 | 5.0–13.0 | stylized proportion: the kit draws this item smaller than its reference set (0.63x off range) |
| city-kit-commercial | low-detail-building-n | building | h | 3.5777 | 4.0–300.0 | stylized proportion: the kit draws this item smaller than its reference set (0.89x off range) |
| city-kit-suburban | building-type-a | building | h | 3.3957 | 4.0–300.0 | stylized proportion: the kit draws this item smaller than its reference set (0.85x off range) |
| city-kit-suburban | building-type-g | building | h | 3.1296 | 4.0–300.0 | stylized proportion: the kit draws this item smaller than its reference set (0.78x off range) |
| city-kit-suburban | building-type-h | building | h | 3.0046 | 4.0–300.0 | stylized proportion: the kit draws this item smaller than its reference set (0.75x off range) |
| city-kit-suburban | building-type-i | building | h | 3.0046 | 4.0–300.0 | stylized proportion: the kit draws this item smaller than its reference set (0.75x off range) |
| city-kit-suburban | building-type-m | building | h | 3.0046 | 4.0–300.0 | stylized proportion: the kit draws this item smaller than its reference set (0.75x off range) |
| city-kit-suburban | building-type-p | building | h | 3.7399 | 4.0–300.0 | stylized proportion: the kit draws this item smaller than its reference set (0.93x off range) |
| city-kit-suburban | building-type-q | building | h | 3.7399 | 4.0–300.0 | stylized proportion: the kit draws this item smaller than its reference set (0.93x off range) |
| food-kit | can-small | bottle/can | h | 0.0743 | 0.1–0.4 | stylized proportion: the kit draws this item smaller than its reference set (0.74x off range) |
| food-kit | soda-can-crushed | bottle/can | h | 0.0833 | 0.1–0.4 | stylized proportion: the kit draws this item smaller than its reference set (0.83x off range) |
| food-kit | cup-saucer | cup/mug | h | 0.0175 | 0.06–0.2 | smaller than the kit's reference set by 0.3x: stylized item or the file name category does not fit this object |
| food-kit | glass-wine | cup/mug | h | 0.2305 | 0.06–0.2 | stylized proportion: the kit draws this item larger than its reference set (1.15x off range) |
| food-kit | pot-lid | plant/vase | h | 0.0546 | 0.1–2.2 | stylized proportion: the kit draws this item smaller than its reference set (0.55x off range) |
| food-kit | pot-stew-lid | plant/vase | h | 0.0546 | 0.1–2.2 | stylized proportion: the kit draws this item smaller than its reference set (0.55x off range) |
| food-kit | plate | plate/bowl | max | 0.4111 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.03x off range) |
| food-kit | plate-broken | plate/bowl | max | 0.4111 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.03x off range) |
| food-kit | plate-deep | plate/bowl | max | 0.4111 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.03x off range) |
| food-kit | plate-dinner | plate/bowl | max | 0.4111 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.03x off range) |
| food-kit | plate-sauerkraut | plate/bowl | max | 0.4111 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.03x off range) |
| furniture-kit | bathtub | bathtub | len | 2.3276 | 1.2–1.9 | stylized proportion: the kit draws this item larger than its reference set (1.23x off range) |
| furniture-kit | cabinetBed | bed | len | 0.5203 | 1.8–2.4 | smaller than the kit's reference set by 0.3x: stylized item or the file name category does not fit this object |
| furniture-kit | cabinetBedDrawer | bed | len | 0.5203 | 1.8–2.4 | smaller than the kit's reference set by 0.3x: stylized item or the file name category does not fit this object |
| furniture-kit | loungeChairRelax | chair | h | 1.2323 | 0.65–1.2 | stylized proportion: the kit draws this item larger than its reference set (1.03x off range) |
| furniture-kit | computerMouse | computer | max | 0.1665 | 0.2–0.6 | stylized proportion: the kit draws this item smaller than its reference set (0.83x off range) |
| furniture-kit | tableCoffeeGlass | cup/mug | h | 0.4499 | 0.06–0.2 | stylized proportion: the kit draws this item larger than its reference set (2.25x off range) |
| furniture-kit | tableCoffeeGlassSquare | cup/mug | h | 0.4499 | 0.06–0.2 | stylized proportion: the kit draws this item larger than its reference set (2.25x off range) |
| furniture-kit | tableGlass | cup/mug | h | 0.639 | 0.06–0.2 | larger than the kit's reference set by 3.2x: stylized item or the file name category does not fit this object |
| furniture-kit | kitchenFridgeSmall | fridge | h | 1.174 | 1.4–2.1 | stylized proportion: the kit draws this item smaller than its reference set (0.84x off range) |
| furniture-kit | rugRectangle | generic prop | max | 3.0709 | 0.02–3.0 | no category reference for this name; generic range only (review by eye) |
| furniture-kit | rugRounded | generic prop | max | 3.0709 | 0.02–3.0 | no category reference for this name; generic range only (review by eye) |
| furniture-kit | washerDryerStacked | kitchen appliance | h | 1.8386 | 0.8–1.0 | stylized proportion: the kit draws this item larger than its reference set (1.84x off range) |
| furniture-kit | lampWall | lamp | h | 0.1815 | 0.2–2.0 | stylized proportion: the kit draws this item smaller than its reference set (0.91x off range) |
| furniture-kit | loungeSofaOttoman | sofa | len | 0.8802 | 1.2–2.8 | stylized proportion: the kit draws this item smaller than its reference set (0.73x off range) |
| furniture-kit | toilet | toilet | h | 0.8822 | 0.35–0.85 | stylized proportion: the kit draws this item larger than its reference set (1.04x off range) |
| furniture-kit | toiletSquare | toilet | h | 0.8822 | 0.35–0.85 | stylized proportion: the kit draws this item larger than its reference set (1.04x off range) |
| holiday-kit | cabin-doorway-center | door | h | 0.41 | 1.9–2.6 | smaller than the kit's reference set by 0.2x: stylized item or the file name category does not fit this object |
| holiday-kit | lantern | generic prop | max | 3.5615 | 0.02–3.0 | no category reference for this name; generic range only (review by eye) |
| holiday-kit | snow-bunker | generic prop | max | 3.9766 | 0.02–3.0 | no category reference for this name; generic range only (review by eye) |
| holiday-kit | snow-flat | generic prop | max | 3.8062 | 0.02–3.0 | no category reference for this name; generic range only (review by eye) |
| holiday-kit | snow-flat-large | generic prop | max | 6.3437 | 0.02–3.0 | no category reference for this name; generic range only (review by eye) |
| holiday-kit | cabin-wall | wall piece | h | 2.05 | 2.2–4.5 | stylized proportion: the kit draws this item smaller than its reference set (0.93x off range) |
| holiday-kit | cabin-wall-low | wall piece | h | 0.82 | 2.2–4.5 | smaller than the kit's reference set by 0.4x: stylized item or the file name category does not fit this object |
| holiday-kit | cabin-wall-roof | wall piece | h | 2.05 | 2.2–4.5 | stylized proportion: the kit draws this item smaller than its reference set (0.93x off range) |
| holiday-kit | cabin-wall-roof-center | wall piece | h | 2.05 | 2.2–4.5 | stylized proportion: the kit draws this item smaller than its reference set (0.93x off range) |
| holiday-kit | cabin-wall-wreath | wall piece | h | 2.05 | 2.2–4.5 | stylized proportion: the kit draws this item smaller than its reference set (0.93x off range) |
| kaykit-city | watertower | building | h | 2.6344 | 4.0–300.0 | stylized proportion: the kit draws this item smaller than its reference set (0.66x off range) |
| kaykit-city | car_hatchback | car | len | 3.1696 | 3.2–6.5 | stylized proportion: the kit draws this item smaller than its reference set (0.99x off range) |
| kaykit-furniture | book_set | book | max | 0.5639 | 0.12–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.41x off range) |
| kaykit-furniture | chair_stool | chair | h | 0.3615 | 0.65–1.2 | stylized proportion: the kit draws this item smaller than its reference set (0.56x off range) |
| kaykit-furniture | chair_stool_wood | chair | h | 0.3615 | 0.65–1.2 | stylized proportion: the kit draws this item smaller than its reference set (0.56x off range) |
| kaykit-furniture | shelf_A_big | storage furniture | h | 0.2892 | 0.3–2.4 | stylized proportion: the kit draws this item smaller than its reference set (0.96x off range) |
| kaykit-furniture | shelf_A_small | storage furniture | h | 0.2892 | 0.3–2.4 | stylized proportion: the kit draws this item smaller than its reference set (0.96x off range) |
| kaykit-furniture | shelf_B_large | storage furniture | h | 0.2892 | 0.3–2.4 | stylized proportion: the kit draws this item smaller than its reference set (0.96x off range) |
| kaykit-furniture | shelf_B_small | storage furniture | h | 0.2892 | 0.3–2.4 | stylized proportion: the kit draws this item smaller than its reference set (0.96x off range) |
| kaykit-restaurant | chair_stool | chair | h | 0.3745 | 0.65–1.2 | stylized proportion: the kit draws this item smaller than its reference set (0.58x off range) |
| kaykit-restaurant | wall_doorway | door | h | 2.996 | 1.9–2.6 | stylized proportion: the kit draws this item larger than its reference set (1.15x off range) |
| kaykit-restaurant | food_burger | food item | max | 0.7116 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.58x off range) |
| kaykit-restaurant | food_ingredient_burger_cooked | food item | max | 0.5243 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.17x off range) |
| kaykit-restaurant | food_ingredient_burger_trash | food item | max | 0.5243 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.17x off range) |
| kaykit-restaurant | food_ingredient_burger_uncooked | food item | max | 0.5243 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.17x off range) |
| kaykit-restaurant | food_ingredient_carrot | food item | max | 0.9512 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (2.11x off range) |
| kaykit-restaurant | food_ingredient_carrot_chopped | food item | max | 0.9974 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (2.22x off range) |
| kaykit-restaurant | food_ingredient_carrot_pieces | food item | max | 0.5386 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.20x off range) |
| kaykit-restaurant | food_ingredient_cheese | food item | max | 0.7315 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.63x off range) |
| kaykit-restaurant | food_ingredient_cheese_chopped | food item | max | 0.7644 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.70x off range) |
| kaykit-restaurant | food_ingredient_cheese_slice | food item | max | 0.6174 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.37x off range) |
| kaykit-restaurant | food_ingredient_lettuce | food item | max | 0.8489 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.89x off range) |
| kaykit-restaurant | food_ingredient_lettuce_chopped | food item | max | 1.3468 | 0.02–0.45 | larger than the kit's reference set by 3.0x: stylized item or the file name category does not fit this object |
| kaykit-restaurant | food_ingredient_lettuce_slice | food item | max | 0.6044 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.34x off range) |
| kaykit-restaurant | food_ingredient_onion | food item | max | 0.6459 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.44x off range) |
| kaykit-restaurant | food_ingredient_onion_chopped | food item | max | 0.9177 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (2.04x off range) |
| kaykit-restaurant | food_ingredient_onion_rings | food item | max | 0.5811 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.29x off range) |
| kaykit-restaurant | food_ingredient_potato | food item | max | 0.5842 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.30x off range) |
| kaykit-restaurant | food_ingredient_potato_chopped | food item | max | 0.7839 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.74x off range) |
| kaykit-restaurant | food_ingredient_potato_mashed | food item | max | 0.4762 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.06x off range) |
| kaykit-restaurant | food_ingredient_steak | food item | max | 0.788 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.75x off range) |
| kaykit-restaurant | food_ingredient_steak_pieces | food item | max | 0.4846 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.08x off range) |
| kaykit-restaurant | food_ingredient_tomato | food item | max | 0.5617 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.25x off range) |
| kaykit-restaurant | food_ingredient_tomato_slice | food item | max | 0.4869 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.08x off range) |
| kaykit-restaurant | food_ingredient_tomato_slices | food item | max | 0.5692 | 0.02–0.45 | stylized proportion: the kit draws this item larger than its reference set (1.26x off range) |
| kaykit-restaurant | pillar_A | generic prop | max | 3.0709 | 0.02–3.0 | no category reference for this name; generic range only (review by eye) |
| kaykit-restaurant | pillar_B | generic prop | max | 3.0709 | 0.02–3.0 | no category reference for this name; generic range only (review by eye) |
| kaykit-restaurant | oven | kitchen appliance | h | 1.513 | 0.8–1.0 | stylized proportion: the kit draws this item larger than its reference set (1.51x off range) |
| kaykit-restaurant | stove_multi_countertop | kitchen appliance | h | 0.2022 | 0.8–1.0 | smaller than the kit's reference set by 0.3x: stylized item or the file name category does not fit this object |
| kaykit-restaurant | stove_multi_decorated | kitchen appliance | h | 1.2852 | 0.8–1.0 | stylized proportion: the kit draws this item larger than its reference set (1.29x off range) |
| kaykit-restaurant | stove_single_countertop | kitchen appliance | h | 0.208 | 0.8–1.0 | smaller than the kit's reference set by 0.3x: stylized item or the file name category does not fit this object |
| kaykit-restaurant | bowl | plate/bowl | max | 0.7116 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.78x off range) |
| kaykit-restaurant | bowl_dirty | plate/bowl | max | 0.7116 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.78x off range) |
| kaykit-restaurant | bowl_small | plate/bowl | max | 0.5617 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.40x off range) |
| kaykit-restaurant | plate | plate/bowl | max | 0.7116 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.78x off range) |
| kaykit-restaurant | plate_dirty | plate/bowl | max | 0.7116 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.78x off range) |
| kaykit-restaurant | plate_small | plate/bowl | max | 0.5617 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.40x off range) |
| kaykit-restaurant | stew_bowl | plate/bowl | max | 0.5883 | 0.08–0.4 | stylized proportion: the kit draws this item larger than its reference set (1.47x off range) |
| kaykit-restaurant | table_round_A_decorated | table | h | 1.391 | 0.35–1.15 | stylized proportion: the kit draws this item larger than its reference set (1.21x off range) |
| kaykit-restaurant | table_round_A_small_decorated | table | h | 1.3482 | 0.35–1.15 | stylized proportion: the kit draws this item larger than its reference set (1.17x off range) |
| mini-characters | aid-glasses | glasses | max | 0.5999 | 0.11–0.17 | larger than the kit's reference set by 3.5x: stylized item or the file name category does not fit this object |
| mini-characters | aid-sunglasses | glasses | max | 0.5999 | 0.11–0.17 | larger than the kit's reference set by 3.5x: stylized item or the file name category does not fit this object |
| mini-characters | aid-cane | walking aid | h | 0.5727 | 0.8–1.6 | stylized proportion: the kit draws this item smaller than its reference set (0.72x off range) |
| mini-characters | aid-cane-blind | walking aid | h | 0.5636 | 0.8–1.6 | stylized proportion: the kit draws this item smaller than its reference set (0.70x off range) |
| mini-characters | aid-cane-low-vision | walking aid | h | 0.5636 | 0.8–1.6 | stylized proportion: the kit draws this item smaller than its reference set (0.70x off range) |
| mini-characters | aid-crutch | walking aid | h | 0.5636 | 0.8–1.6 | stylized proportion: the kit draws this item smaller than its reference set (0.70x off range) |
| nature-kit | crops_bambooStageB | crop plant | h | 2.6122 | 0.05–2.5 | stylized proportion: the kit draws this item larger than its reference set (1.04x off range) |
| nature-kit | crops_cornStageB | crop plant | h | 2.935 | 0.05–2.5 | stylized proportion: the kit draws this item larger than its reference set (1.17x off range) |
| nature-kit | crops_cornStageC | crop plant | h | 3.6688 | 0.05–2.5 | stylized proportion: the kit draws this item larger than its reference set (1.47x off range) |
| nature-kit | crops_cornStageD | crop plant | h | 3.6688 | 0.05–2.5 | stylized proportion: the kit draws this item larger than its reference set (1.47x off range) |
| nature-kit | cliff_blockSlopeHalfWalls_rock | wall piece | h | 1.4675 | 2.2–4.5 | stylized proportion: the kit draws this item smaller than its reference set (0.67x off range) |
| nature-kit | cliff_blockSlopeHalfWalls_stone | wall piece | h | 1.4675 | 2.2–4.5 | stylized proportion: the kit draws this item smaller than its reference set (0.67x off range) |
