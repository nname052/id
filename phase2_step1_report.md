# Phase 2, Step 1: asset inventory and selection log

Branch: `autovideo-motion-v2` · Step 1 only (no rendering, no directing brief).

## Acceptance

| Item | Result | Evidence |
|---|---|---|
| assets_manifest.json exists, covers every asset found, every entry has a measured scale and a license field | PASS | 1348 entries = 1348 files found; measured scale on all (1343 bbox in m, 5 HDRIs in px); license on all |
| selection_log.md shows 3 topics and 3 different characters | PASS | 3 topics; characters: Business_Male_03, Female_Adult_06, Male_Adult_08 |
| Scale-check list exists (even if empty) | PASS | 350 items (below and in assets_manifest.json → scale_check) |

## Counts

- Total assets: **1348** (character 57, prop 608, environment piece 638, HDRI 5, motion clip 40)
- License unclear (flagged): **0** · excluded from selection: **0**
- No local license file (license from the documented download source instead): 1101 (Kenney, Rocketbox, Poly Haven, Mixamo, RobotExpressive). Copying their license texts locally would make this stronger; not done (no downloads in this step).
- Measurement errors: 0
- Scale outliers: **350**

How scale was measured: three.js loaders in the browser (`app/player/tools/inventory.html`), exact bounding box of the meshes (skinned meshes in bind pose); glTF is in meters, FBX is cm × `UnitScaleFactor`; animation-only files use the skeleton box; HDRIs have no spatial size, so the pixel size is recorded. Re-run: `.venv/bin/python assets/tools/inventory.py` (dev server on :8000).

## Scale check (reported, not fixed)

Rule: category from whole words in the file name with a plausible real-world range; otherwise generic (prop 0.02–3 m, environment piece 0.2–80 m). `h` = height, `len` = longest horizontal side, `max` = longest side. Categories come from names, so a few may be misread; each row shows the measured value so it can be checked.

By library: furniture-kit 57, kaykit-restaurant 50, nature-kit 50, food-kit 48, city-kit-commercial 31, kaykit-city 24, city-kit-suburban 23, kaykit-furniture 18, holiday-kit 17, car-kit 15, mini-characters 10, city-kit-roads 7

| Library | Asset | Type | Category | Dim | Measured (m) | Plausible (m) |
|---|---|---|---|---|---|---|
| car-kit | hatchback-sports | prop | car | len | 2.85 | 3.2–6.5 |
| car-kit | police | prop | car | len | 3.1 | 3.2–6.5 |
| car-kit | race | prop | car | len | 2.5598 | 3.2–6.5 |
| car-kit | race-future | prop | car | len | 2.6598 | 3.2–6.5 |
| car-kit | sedan | prop | car | len | 2.55 | 3.2–6.5 |
| car-kit | sedan-sports | prop | car | len | 2.55 | 3.2–6.5 |
| car-kit | suv | prop | car | len | 2.7 | 3.2–6.5 |
| car-kit | suv-luxury | prop | car | len | 2.85 | 3.2–6.5 |
| car-kit | taxi | prop | car | len | 2.75 | 3.2–6.5 |
| car-kit | tractor-police | prop | car | len | 2.3016 | 3.2–6.5 |
| car-kit | van | prop | car | len | 2.75 | 3.2–6.5 |
| car-kit | firetruck | prop | large vehicle | len | 3.4 | 5.0–13.0 |
| car-kit | garbage-truck | prop | large vehicle | len | 3.45 | 5.0–13.0 |
| car-kit | truck | prop | large vehicle | len | 2.95 | 5.0–13.0 |
| car-kit | truck-flat | prop | large vehicle | len | 2.7451 | 5.0–13.0 |
| city-kit-commercial | building-a | environment | building | h | 1.293 | 4.0–300.0 |
| city-kit-commercial | building-b | environment | building | h | 1.293 | 4.0–300.0 |
| city-kit-commercial | building-c | environment | building | h | 0.893 | 4.0–300.0 |
| city-kit-commercial | building-d | environment | building | h | 1.293 | 4.0–300.0 |
| city-kit-commercial | building-e | environment | building | h | 0.893 | 4.0–300.0 |
| city-kit-commercial | building-f | environment | building | h | 1.693 | 4.0–300.0 |
| city-kit-commercial | building-g | environment | building | h | 1.693 | 4.0–300.0 |
| city-kit-commercial | building-h | environment | building | h | 1.293 | 4.0–300.0 |
| city-kit-commercial | building-i | environment | building | h | 1.68 | 4.0–300.0 |
| city-kit-commercial | building-j | environment | building | h | 1.693 | 4.0–300.0 |
| city-kit-commercial | building-k | environment | building | h | 1.47 | 4.0–300.0 |
| city-kit-commercial | building-l | environment | building | h | 2.27 | 4.0–300.0 |
| city-kit-commercial | building-m | environment | building | h | 3.15 | 4.0–300.0 |
| city-kit-commercial | building-n | environment | building | h | 2.48 | 4.0–300.0 |
| city-kit-commercial | building-skyscraper-a | environment | building | h | 2.88 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-a | environment | building | h | 2 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-b | environment | building | h | 2.225 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-c | environment | building | h | 2.25 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-d | environment | building | h | 1.75 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-e | environment | building | h | 1.8 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-f | environment | building | h | 2 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-g | environment | building | h | 2 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-h | environment | building | h | 2.1 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-i | environment | building | h | 1.775 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-j | environment | building | h | 1.75 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-k | environment | building | h | 1.55 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-l | environment | building | h | 1.85 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-m | environment | building | h | 1.975 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-n | environment | building | h | 0.7 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-wide-a | environment | building | h | 1.1 | 4.0–300.0 |
| city-kit-commercial | low-detail-building-wide-b | environment | building | h | 1.15 | 4.0–300.0 |
| city-kit-roads | construction-cone | environment | generic environment piece | max | 0.0938 | 0.2–80.0 |
| city-kit-roads | road-sign-object-stop | environment | generic environment piece | max | 0.1256 | 0.2–80.0 |
| city-kit-roads | road-sign-object-street | environment | generic environment piece | max | 0.1925 | 0.2–80.0 |
| city-kit-roads | road-sign-object-warning | environment | generic environment piece | max | 0.1338 | 0.2–80.0 |
| city-kit-roads | traffic-light-object-hanging | environment | generic environment piece | max | 0.1432 | 0.2–80.0 |
| city-kit-roads | traffic-light-object-horizontal | environment | generic environment piece | max | 0.1432 | 0.2–80.0 |
| city-kit-roads | traffic-light-object-vertical | environment | generic environment piece | max | 0.1432 | 0.2–80.0 |
| city-kit-suburban | building-type-a | environment | building | h | 0.8335 | 4.0–300.0 |
| city-kit-suburban | building-type-b | environment | building | h | 1.1375 | 4.0–300.0 |
| city-kit-suburban | building-type-c | environment | building | h | 1.0335 | 4.0–300.0 |
| city-kit-suburban | building-type-d | environment | building | h | 1.2375 | 4.0–300.0 |
| city-kit-suburban | building-type-e | environment | building | h | 1.1375 | 4.0–300.0 |
| city-kit-suburban | building-type-f | environment | building | h | 1.1375 | 4.0–300.0 |
| city-kit-suburban | building-type-g | environment | building | h | 0.7682 | 4.0–300.0 |
| city-kit-suburban | building-type-h | environment | building | h | 0.7375 | 4.0–300.0 |
| city-kit-suburban | building-type-i | environment | building | h | 0.7375 | 4.0–300.0 |
| city-kit-suburban | building-type-j | environment | building | h | 1.0375 | 4.0–300.0 |
| city-kit-suburban | building-type-k | environment | building | h | 1.1496 | 4.0–300.0 |
| city-kit-suburban | building-type-l | environment | building | h | 1.0492 | 4.0–300.0 |
| city-kit-suburban | building-type-m | environment | building | h | 0.7375 | 4.0–300.0 |
| city-kit-suburban | building-type-n | environment | building | h | 1.1375 | 4.0–300.0 |
| city-kit-suburban | building-type-o | environment | building | h | 1.1375 | 4.0–300.0 |
| city-kit-suburban | building-type-p | environment | building | h | 0.918 | 4.0–300.0 |
| city-kit-suburban | building-type-q | environment | building | h | 0.918 | 4.0–300.0 |
| city-kit-suburban | building-type-r | environment | building | h | 1.1411 | 4.0–300.0 |
| city-kit-suburban | building-type-s | environment | building | h | 1.1375 | 4.0–300.0 |
| city-kit-suburban | building-type-t | environment | building | h | 1.1563 | 4.0–300.0 |
| city-kit-suburban | building-type-u | environment | building | h | 1.1375 | 4.0–300.0 |
| city-kit-suburban | tree-large | environment | tree | h | 0.767 | 1.5–35.0 |
| city-kit-suburban | tree-small | environment | tree | h | 0.567 | 1.5–35.0 |
| food-kit | bottle-oil | prop | bottle/can | h | 0.6218 | 0.1–0.4 |
| food-kit | can-open | prop | bottle/can | h | 0.4071 | 0.1–0.4 |
| food-kit | carton | prop | bottle/can | h | 0.5905 | 0.1–0.4 |
| food-kit | soda | prop | bottle/can | h | 0.4324 | 0.1–0.4 |
| food-kit | soda-bottle | prop | bottle/can | h | 0.5804 | 0.1–0.4 |
| food-kit | wine-red | prop | bottle/can | h | 0.6989 | 0.1–0.4 |
| food-kit | wine-white | prop | bottle/can | h | 0.6556 | 0.1–0.4 |
| food-kit | cup-saucer | prop | cup/mug | h | 0.038 | 0.06–0.2 |
| food-kit | glass | prop | cup/mug | h | 0.2851 | 0.06–0.2 |
| food-kit | glass-wine | prop | cup/mug | h | 0.4999 | 0.06–0.2 |
| food-kit | mug | prop | cup/mug | h | 0.2734 | 0.06–0.2 |
| food-kit | soda-glass | prop | cup/mug | h | 0.4134 | 0.06–0.2 |
| food-kit | banana | prop | food item | max | 0.6299 | 0.02–0.45 |
| food-kit | carrot | prop | food item | max | 0.7163 | 0.02–0.45 |
| food-kit | cheese | prop | food item | max | 0.68 | 0.02–0.45 |
| food-kit | cheese-slicer | prop | food item | max | 0.6184 | 0.02–0.45 |
| food-kit | corn-dog | prop | food item | max | 0.6044 | 0.02–0.45 |
| food-kit | croissant | prop | food item | max | 0.4777 | 0.02–0.45 |
| food-kit | fish | prop | food item | max | 0.6208 | 0.02–0.45 |
| food-kit | fish-bones | prop | food item | max | 0.6358 | 0.02–0.45 |
| food-kit | meat-cooked | prop | food item | max | 0.5754 | 0.02–0.45 |
| food-kit | meat-raw | prop | food item | max | 0.5754 | 0.02–0.45 |
| food-kit | meat-ribs | prop | food item | max | 0.5354 | 0.02–0.45 |
| food-kit | meat-tenderizer | prop | food item | max | 0.5408 | 0.02–0.45 |
| food-kit | pepper-mill | prop | food item | max | 0.5481 | 0.02–0.45 |
| food-kit | pineapple | prop | food item | max | 0.4716 | 0.02–0.45 |
| food-kit | popsicle | prop | food item | max | 0.49 | 0.02–0.45 |
| food-kit | popsicle-chocolate | prop | food item | max | 0.49 | 0.02–0.45 |
| food-kit | skewer | prop | food item | max | 0.5967 | 0.02–0.45 |
| food-kit | skewer-vegetables | prop | food item | max | 0.5967 | 0.02–0.45 |
| food-kit | watermelon | prop | food item | max | 0.4761 | 0.02–0.45 |
| food-kit | cake | prop | pizza/cake | max | 0.6392 | 0.15–0.5 |
| food-kit | cake-birthday | prop | pizza/cake | max | 0.6392 | 0.15–0.5 |
| food-kit | cake-slicer | prop | pizza/cake | max | 0.7246 | 0.15–0.5 |
| food-kit | mincemeat-pie | prop | pizza/cake | max | 0.6131 | 0.15–0.5 |
| food-kit | pie | prop | pizza/cake | max | 0.9504 | 0.15–0.5 |
| food-kit | pizza | prop | pizza/cake | max | 0.8418 | 0.15–0.5 |
| food-kit | pizza-cutter | prop | pizza/cake | max | 0.536 | 0.15–0.5 |
| food-kit | bowl | prop | plate/bowl | max | 0.5798 | 0.08–0.4 |
| food-kit | bowl-broth | prop | plate/bowl | max | 0.5798 | 0.08–0.4 |
| food-kit | bowl-cereal | prop | plate/bowl | max | 0.6346 | 0.08–0.4 |
| food-kit | bowl-soup | prop | plate/bowl | max | 0.5798 | 0.08–0.4 |
| food-kit | plate | prop | plate/bowl | max | 0.8918 | 0.08–0.4 |
| food-kit | plate-broken | prop | plate/bowl | max | 0.8918 | 0.08–0.4 |
| food-kit | plate-deep | prop | plate/bowl | max | 0.8918 | 0.08–0.4 |
| food-kit | plate-dinner | prop | plate/bowl | max | 0.8918 | 0.08–0.4 |
| food-kit | plate-rectangle | prop | plate/bowl | max | 0.8586 | 0.08–0.4 |
| food-kit | plate-sauerkraut | prop | plate/bowl | max | 0.8918 | 0.08–0.4 |
| furniture-kit | bathtub | prop | bathtub | len | 1.19 | 1.2–1.9 |
| furniture-kit | bedBunk | prop | bed | len | 1.095 | 1.8–2.4 |
| furniture-kit | bedDouble | prop | bed | len | 1.125 | 1.8–2.4 |
| furniture-kit | bedSingle | prop | bed | len | 1.125 | 1.8–2.4 |
| furniture-kit | cabinetBed | prop | bed | len | 0.266 | 1.8–2.4 |
| furniture-kit | cabinetBedDrawer | prop | bed | len | 0.266 | 1.8–2.4 |
| furniture-kit | chair | prop | chair | h | 0.47 | 0.65–1.2 |
| furniture-kit | chairCushion | prop | chair | h | 0.46 | 0.65–1.2 |
| furniture-kit | chairDesk | prop | chair | h | 0.6076 | 0.65–1.2 |
| furniture-kit | chairModernCushion | prop | chair | h | 0.46 | 0.65–1.2 |
| furniture-kit | chairModernFrameCushion | prop | chair | h | 0.46 | 0.65–1.2 |
| furniture-kit | chairRounded | prop | chair | h | 0.455 | 0.65–1.2 |
| furniture-kit | loungeChair | prop | chair | h | 0.46 | 0.65–1.2 |
| furniture-kit | loungeChairRelax | prop | chair | h | 0.63 | 0.65–1.2 |
| furniture-kit | loungeDesignChair | prop | chair | h | 0.4 | 0.65–1.2 |
| furniture-kit | computerMouse | prop | computer | max | 0.0851 | 0.2–0.6 |
| furniture-kit | tableCoffeeGlass | prop | cup/mug | h | 0.23 | 0.06–0.2 |
| furniture-kit | tableCoffeeGlassSquare | prop | cup/mug | h | 0.23 | 0.06–0.2 |
| furniture-kit | tableGlass | prop | cup/mug | h | 0.3267 | 0.06–0.2 |
| furniture-kit | desk | prop | desk | h | 0.3844 | 0.6–0.85 |
| furniture-kit | deskCorner | environment | desk | h | 0.3844 | 0.6–0.85 |
| furniture-kit | doorway | environment | door | h | 1.0095 | 1.9–2.6 |
| furniture-kit | doorwayFront | environment | door | h | 1.0095 | 1.9–2.6 |
| furniture-kit | doorwayOpen | environment | door | h | 1.0095 | 1.9–2.6 |
| furniture-kit | wallDoorway | environment | door | h | 1.2895 | 1.9–2.6 |
| furniture-kit | wallDoorwayWide | environment | door | h | 1.2895 | 1.9–2.6 |
| furniture-kit | kitchenFridge | prop | fridge | h | 0.92 | 1.4–2.1 |
| furniture-kit | kitchenFridgeBuiltIn | prop | fridge | h | 0.8687 | 1.4–2.1 |
| furniture-kit | kitchenFridgeLarge | prop | fridge | h | 0.92 | 1.4–2.1 |
| furniture-kit | kitchenFridgeSmall | prop | fridge | h | 0.6002 | 1.4–2.1 |
| furniture-kit | dryer | prop | kitchen appliance | h | 0.47 | 0.8–1.0 |
| furniture-kit | kitchenStove | prop | kitchen appliance | h | 0.45 | 0.8–1.0 |
| furniture-kit | kitchenStoveElectric | prop | kitchen appliance | h | 0.45 | 0.8–1.0 |
| furniture-kit | washer | prop | kitchen appliance | h | 0.47 | 0.8–1.0 |
| furniture-kit | lampWall | environment | lamp | h | 0.0928 | 0.2–2.0 |
| furniture-kit | televisionAntenna | prop | screen | max | 0.2645 | 0.3–1.8 |
| furniture-kit | loungeDesignSofa | prop | sofa | len | 1.12 | 1.2–2.8 |
| furniture-kit | loungeSofa | prop | sofa | len | 0.98 | 1.2–2.8 |
| furniture-kit | loungeSofaCorner | environment | sofa | len | 0.98 | 1.2–2.8 |
| furniture-kit | loungeSofaLong | prop | sofa | len | 0.98 | 1.2–2.8 |
| furniture-kit | loungeSofaOttoman | prop | sofa | len | 0.45 | 1.2–2.8 |
| furniture-kit | kitchenCabinetUpperLow | prop | storage furniture | h | 0.195 | 0.3–2.4 |
| furniture-kit | cabinetBedDrawerTable | prop | table | h | 0.2632 | 0.35–1.15 |
| furniture-kit | lampRoundTable | prop | table | h | 0.3142 | 0.35–1.15 |
| furniture-kit | lampSquareTable | prop | table | h | 0.29 | 0.35–1.15 |
| furniture-kit | table | prop | table | h | 0.3267 | 0.35–1.15 |
| furniture-kit | tableCloth | prop | table | h | 0.3267 | 0.35–1.15 |
| furniture-kit | tableCoffee | prop | table | h | 0.23 | 0.35–1.15 |
| furniture-kit | tableCoffeeSquare | prop | table | h | 0.23 | 0.35–1.15 |
| furniture-kit | tableCross | prop | table | h | 0.3474 | 0.35–1.15 |
| furniture-kit | tableCrossCloth | prop | table | h | 0.3474 | 0.35–1.15 |
| furniture-kit | wall | environment | wall piece | h | 1.2895 | 2.2–4.5 |
| furniture-kit | wallCorner | environment | wall piece | h | 1.2895 | 2.2–4.5 |
| furniture-kit | wallCornerRond | environment | wall piece | h | 1.2895 | 2.2–4.5 |
| furniture-kit | wallHalf | environment | wall piece | h | 1.2895 | 2.2–4.5 |
| furniture-kit | wallWindow | environment | wall piece | h | 1.2895 | 2.2–4.5 |
| furniture-kit | wallWindowSlide | environment | wall piece | h | 1.2895 | 2.2–4.5 |
| holiday-kit | cabin-door-rotate | environment | door | h | 1 | 1.9–2.6 |
| holiday-kit | cabin-doorway | environment | door | h | 1 | 1.9–2.6 |
| holiday-kit | cabin-doorway-center | environment | door | h | 0.2 | 1.9–2.6 |
| holiday-kit | cabin-doorway-left | environment | door | h | 1 | 1.9–2.6 |
| holiday-kit | cabin-doorway-right | environment | door | h | 1 | 1.9–2.6 |
| holiday-kit | cabin-overhang-door-rotate | environment | door | h | 1 | 1.9–2.6 |
| holiday-kit | cabin-overhang-doorway | environment | door | h | 1 | 1.9–2.6 |
| holiday-kit | snow-flat-large | prop | generic prop | max | 3.0945 | 0.02–3.0 |
| holiday-kit | candy-cane-green | prop | walking aid | h | 0.4518 | 0.8–1.6 |
| holiday-kit | candy-cane-red | prop | walking aid | h | 0.4518 | 0.8–1.6 |
| holiday-kit | sock-green-cane | prop | walking aid | h | 0.7302 | 0.8–1.6 |
| holiday-kit | sock-red-cane | prop | walking aid | h | 0.7302 | 0.8–1.6 |
| holiday-kit | cabin-wall | environment | wall piece | h | 1 | 2.2–4.5 |
| holiday-kit | cabin-wall-low | environment | wall piece | h | 0.4 | 2.2–4.5 |
| holiday-kit | cabin-wall-roof | environment | wall piece | h | 1 | 2.2–4.5 |
| holiday-kit | cabin-wall-roof-center | environment | wall piece | h | 1 | 2.2–4.5 |
| holiday-kit | cabin-wall-wreath | environment | wall piece | h | 1 | 2.2–4.5 |
| kaykit-city | building_A | environment | building | h | 1.65 | 4.0–300.0 |
| kaykit-city | building_A_withoutBase | environment | building | h | 1.5501 | 4.0–300.0 |
| kaykit-city | building_B | environment | building | h | 1.65 | 4.0–300.0 |
| kaykit-city | building_B_withoutBase | environment | building | h | 1.5501 | 4.0–300.0 |
| kaykit-city | building_C | environment | building | h | 2.9766 | 4.0–300.0 |
| kaykit-city | building_C_withoutBase | environment | building | h | 2.2501 | 4.0–300.0 |
| kaykit-city | building_D | environment | building | h | 2.97 | 4.0–300.0 |
| kaykit-city | building_D_withoutBase | environment | building | h | 2.2501 | 4.0–300.0 |
| kaykit-city | building_E | environment | building | h | 2.35 | 4.0–300.0 |
| kaykit-city | building_E_withoutBase | environment | building | h | 2.2501 | 4.0–300.0 |
| kaykit-city | building_F | environment | building | h | 2.35 | 4.0–300.0 |
| kaykit-city | building_F_withoutBase | environment | building | h | 2.2501 | 4.0–300.0 |
| kaykit-city | building_G | environment | building | h | 2.9764 | 4.0–300.0 |
| kaykit-city | building_G_withoutBase | environment | building | h | 2.2501 | 4.0–300.0 |
| kaykit-city | building_H | environment | building | h | 3.05 | 4.0–300.0 |
| kaykit-city | building_H_withoutBase | environment | building | h | 2.9501 | 4.0–300.0 |
| kaykit-city | watertower | environment | building | h | 0.67 | 4.0–300.0 |
| kaykit-city | car_hatchback | environment | car | len | 0.8061 | 3.2–6.5 |
| kaykit-city | car_police | environment | car | len | 0.9381 | 3.2–6.5 |
| kaykit-city | car_sedan | environment | car | len | 0.9381 | 3.2–6.5 |
| kaykit-city | car_stationwagon | environment | car | len | 0.9381 | 3.2–6.5 |
| kaykit-city | car_taxi | environment | car | len | 0.9381 | 3.2–6.5 |
| kaykit-city | trash_A | environment | generic environment piece | max | 0.1333 | 0.2–80.0 |
| kaykit-city | trash_B | environment | generic environment piece | max | 0.0708 | 0.2–80.0 |
| kaykit-furniture | bed_double_A | prop | bed | len | 3.1 | 1.8–2.4 |
| kaykit-furniture | bed_double_B | prop | bed | len | 3.1 | 1.8–2.4 |
| kaykit-furniture | bed_single_A | prop | bed | len | 3 | 1.8–2.4 |
| kaykit-furniture | bed_single_B | prop | bed | len | 3 | 1.8–2.4 |
| kaykit-furniture | book_set | prop | book | max | 0.78 | 0.12–0.4 |
| kaykit-furniture | book_single | prop | book | max | 0.5 | 0.12–0.4 |
| kaykit-furniture | armchair | prop | chair | h | 1.2241 | 0.65–1.2 |
| kaykit-furniture | armchair_pillows | prop | chair | h | 1.2241 | 0.65–1.2 |
| kaykit-furniture | chair_A | prop | chair | h | 1.2583 | 0.65–1.2 |
| kaykit-furniture | chair_A_wood | prop | chair | h | 1.2583 | 0.65–1.2 |
| kaykit-furniture | chair_B | prop | chair | h | 1.2583 | 0.65–1.2 |
| kaykit-furniture | chair_B_wood | prop | chair | h | 1.2583 | 0.65–1.2 |
| kaykit-furniture | chair_C | prop | chair | h | 1.2029 | 0.65–1.2 |
| kaykit-furniture | chair_stool | prop | chair | h | 0.5 | 0.65–1.2 |
| kaykit-furniture | chair_stool_wood | prop | chair | h | 0.5 | 0.65–1.2 |
| kaykit-furniture | lamp_standing | prop | lamp | h | 2.52 | 0.2–2.0 |
| kaykit-furniture | couch | prop | sofa | len | 3 | 1.2–2.8 |
| kaykit-furniture | couch_pillows | prop | sofa | len | 3 | 1.2–2.8 |
| kaykit-restaurant | chair_A | prop | chair | h | 1.208 | 0.65–1.2 |
| kaykit-restaurant | chair_B | prop | chair | h | 1.208 | 0.65–1.2 |
| kaykit-restaurant | chair_stool | prop | chair | h | 0.5 | 0.65–1.2 |
| kaykit-restaurant | door_A | environment | door | h | 2.8 | 1.9–2.6 |
| kaykit-restaurant | door_B | environment | door | h | 2.8 | 1.9–2.6 |
| kaykit-restaurant | wall_doorway | environment | door | h | 4 | 1.9–2.6 |
| kaykit-restaurant | food_burger | prop | food item | max | 0.95 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_burger_cooked | prop | food item | max | 0.7 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_burger_trash | prop | food item | max | 0.7 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_burger_uncooked | prop | food item | max | 0.7 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_carrot | prop | food item | max | 1.27 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_carrot_chopped | prop | food item | max | 1.3317 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_carrot_pieces | prop | food item | max | 0.7191 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_cheese | prop | food item | max | 0.9766 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_cheese_chopped | prop | food item | max | 1.0205 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_cheese_slice | prop | food item | max | 0.8243 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_lettuce | prop | food item | max | 1.1334 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_lettuce_chopped | prop | food item | max | 1.7981 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_lettuce_slice | prop | food item | max | 0.8069 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_onion | prop | food item | max | 0.8624 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_onion_chopped | prop | food item | max | 1.2253 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_onion_rings | prop | food item | max | 0.7758 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_potato | prop | food item | max | 0.78 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_potato_chopped | prop | food item | max | 1.0466 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_potato_mashed | prop | food item | max | 0.6358 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_steak | prop | food item | max | 1.0521 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_steak_pieces | prop | food item | max | 0.647 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_tomato | prop | food item | max | 0.75 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_tomato_slice | prop | food item | max | 0.65 | 0.02–0.45 |
| kaykit-restaurant | food_ingredient_tomato_slices | prop | food item | max | 0.76 | 0.02–0.45 |
| kaykit-restaurant | fridge_A | prop | fridge | h | 2.5 | 1.4–2.1 |
| kaykit-restaurant | fridge_A_decorated | prop | fridge | h | 2.5 | 1.4–2.1 |
| kaykit-restaurant | fridge_B | prop | fridge | h | 2.5 | 1.4–2.1 |
| kaykit-restaurant | pillar_A | prop | generic prop | max | 4.1 | 0.02–3.0 |
| kaykit-restaurant | pillar_B | prop | generic prop | max | 4.1 | 0.02–3.0 |
| kaykit-restaurant | oven | prop | kitchen appliance | h | 2.02 | 0.8–1.0 |
| kaykit-restaurant | stove_multi | prop | kitchen appliance | h | 1.2 | 0.8–1.0 |
| kaykit-restaurant | stove_multi_countertop | prop | kitchen appliance | h | 0.27 | 0.8–1.0 |
| kaykit-restaurant | stove_multi_decorated | prop | kitchen appliance | h | 1.7159 | 0.8–1.0 |
| kaykit-restaurant | stove_single | prop | kitchen appliance | h | 1.2077 | 0.8–1.0 |
| kaykit-restaurant | stove_single_countertop | prop | kitchen appliance | h | 0.2777 | 0.8–1.0 |
| kaykit-restaurant | bowl | prop | plate/bowl | max | 0.95 | 0.08–0.4 |
| kaykit-restaurant | bowl_dirty | prop | plate/bowl | max | 0.95 | 0.08–0.4 |
| kaykit-restaurant | bowl_small | prop | plate/bowl | max | 0.75 | 0.08–0.4 |
| kaykit-restaurant | plate | prop | plate/bowl | max | 0.95 | 0.08–0.4 |
| kaykit-restaurant | plate_dirty | prop | plate/bowl | max | 0.95 | 0.08–0.4 |
| kaykit-restaurant | plate_small | prop | plate/bowl | max | 0.75 | 0.08–0.4 |
| kaykit-restaurant | stew_bowl | prop | plate/bowl | max | 0.7854 | 0.08–0.4 |
| kaykit-restaurant | table_round_A_decorated | prop | table | h | 1.8572 | 0.35–1.15 |
| kaykit-restaurant | table_round_A_small_decorated | prop | table | h | 1.8 | 0.35–1.15 |
| mini-characters | aid-glasses | prop | glasses | max | 0.33 | 0.11–0.17 |
| mini-characters | aid-sunglasses | prop | glasses | max | 0.33 | 0.11–0.17 |
| mini-characters | aid-cane | prop | walking aid | h | 0.315 | 0.8–1.6 |
| mini-characters | aid-cane-blind | prop | walking aid | h | 0.31 | 0.8–1.6 |
| mini-characters | aid-cane-low-vision | prop | walking aid | h | 0.31 | 0.8–1.6 |
| mini-characters | aid-crutch | prop | walking aid | h | 0.31 | 0.8–1.6 |
| mini-characters | wheelchair | prop | wheelchair | h | 0.495 | 0.8–1.2 |
| mini-characters | wheelchair-deluxe | prop | wheelchair | h | 0.495 | 0.8–1.2 |
| mini-characters | wheelchair-power | prop | wheelchair | h | 0.5717 | 0.8–1.2 |
| mini-characters | wheelchair-power-deluxe | prop | wheelchair | h | 0.6253 | 0.8–1.2 |
| nature-kit | bed | environment | bed | len | 0.7473 | 1.8–2.4 |
| nature-kit | bed_floor | environment | bed | len | 0.7473 | 1.8–2.4 |
| nature-kit | flower_purpleC | environment | generic environment piece | max | 0.1825 | 0.2–80.0 |
| nature-kit | flower_yellowA | environment | generic environment piece | max | 0.1925 | 0.2–80.0 |
| nature-kit | flower_yellowC | environment | generic environment piece | max | 0.1811 | 0.2–80.0 |
| nature-kit | tree_blocks | environment | tree | h | 1.185 | 1.5–35.0 |
| nature-kit | tree_blocks_dark | environment | tree | h | 1.185 | 1.5–35.0 |
| nature-kit | tree_blocks_fall | environment | tree | h | 1.185 | 1.5–35.0 |
| nature-kit | tree_cone | environment | tree | h | 1.4303 | 1.5–35.0 |
| nature-kit | tree_cone_dark | environment | tree | h | 1.4303 | 1.5–35.0 |
| nature-kit | tree_cone_fall | environment | tree | h | 1.4303 | 1.5–35.0 |
| nature-kit | tree_detailed | environment | tree | h | 1.3324 | 1.5–35.0 |
| nature-kit | tree_detailed_dark | environment | tree | h | 1.3324 | 1.5–35.0 |
| nature-kit | tree_detailed_fall | environment | tree | h | 1.3324 | 1.5–35.0 |
| nature-kit | tree_fat | environment | tree | h | 1.1504 | 1.5–35.0 |
| nature-kit | tree_fat_darkh | environment | tree | h | 1.1504 | 1.5–35.0 |
| nature-kit | tree_fat_fall | environment | tree | h | 1.1504 | 1.5–35.0 |
| nature-kit | tree_oak | environment | tree | h | 1.2262 | 1.5–35.0 |
| nature-kit | tree_oak_dark | environment | tree | h | 1.2262 | 1.5–35.0 |
| nature-kit | tree_oak_fall | environment | tree | h | 1.2262 | 1.5–35.0 |
| nature-kit | tree_palmBend | environment | tree | h | 1.3799 | 1.5–35.0 |
| nature-kit | tree_palmDetailedShort | environment | tree | h | 1.124 | 1.5–35.0 |
| nature-kit | tree_palmDetailedTall | environment | tree | h | 1.4235 | 1.5–35.0 |
| nature-kit | tree_palmShort | environment | tree | h | 1.0562 | 1.5–35.0 |
| nature-kit | tree_palmTall | environment | tree | h | 1.3557 | 1.5–35.0 |
| nature-kit | tree_pineGroundA | environment | tree | h | 0.9145 | 1.5–35.0 |
| nature-kit | tree_pineGroundB | environment | tree | h | 1.042 | 1.5–35.0 |
| nature-kit | tree_pineRoundA | environment | tree | h | 1.3664 | 1.5–35.0 |
| nature-kit | tree_pineRoundB | environment | tree | h | 1.1959 | 1.5–35.0 |
| nature-kit | tree_pineRoundC | environment | tree | h | 1.2529 | 1.5–35.0 |
| nature-kit | tree_pineRoundD | environment | tree | h | 1.0817 | 1.5–35.0 |
| nature-kit | tree_pineRoundE | environment | tree | h | 1.2546 | 1.5–35.0 |
| nature-kit | tree_pineRoundF | environment | tree | h | 1.2545 | 1.5–35.0 |
| nature-kit | tree_pineSmallA | environment | tree | h | 0.9672 | 1.5–35.0 |
| nature-kit | tree_pineSmallB | environment | tree | h | 1.0086 | 1.5–35.0 |
| nature-kit | tree_pineSmallC | environment | tree | h | 1.1231 | 1.5–35.0 |
| nature-kit | tree_pineSmallD | environment | tree | h | 0.9556 | 1.5–35.0 |
| nature-kit | tree_plateau | environment | tree | h | 1.2493 | 1.5–35.0 |
| nature-kit | tree_plateau_dark | environment | tree | h | 1.2493 | 1.5–35.0 |
| nature-kit | tree_plateau_fall | environment | tree | h | 1.2493 | 1.5–35.0 |
| nature-kit | tree_small | environment | tree | h | 1.11 | 1.5–35.0 |
| nature-kit | tree_small_dark | environment | tree | h | 1.11 | 1.5–35.0 |
| nature-kit | tree_small_fall | environment | tree | h | 1.11 | 1.5–35.0 |
| nature-kit | tree_thin | environment | tree | h | 1.4903 | 1.5–35.0 |
| nature-kit | tree_thin_dark | environment | tree | h | 1.4903 | 1.5–35.0 |
| nature-kit | tree_thin_fall | environment | tree | h | 1.4903 | 1.5–35.0 |
| nature-kit | cliff_blockSlopeHalfWalls_rock | environment | wall piece | h | 0.5 | 2.2–4.5 |
| nature-kit | cliff_blockSlopeHalfWalls_stone | environment | wall piece | h | 0.5 | 2.2–4.5 |
| nature-kit | cliff_blockSlopeWalls_rock | environment | wall piece | h | 1 | 2.2–4.5 |
| nature-kit | cliff_blockSlopeWalls_stone | environment | wall piece | h | 1 | 2.2–4.5 |
