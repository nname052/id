# مكتبات الرسومات المجانية

بتتنزل كلها بأمر واحد (محتاج `node` و `npm`):

```bash
uv run python assets/fetch_assets.py
```

الملفات المتنزلة مش بتترفع على git. الفهرس `assets/catalog.json` فيه اسم كل عنصر وكلماته المفتاحية، وده اللي Claude بيختار منه.

| الفولدر | فيه إيه | العدد | الرخصة |
|---|---|---|---|
| `vendor/lottie_svg.min.js` | مشغّل Lottie. بنستخدم `goToAndStop(frame, true)` جوه `renderAt(t)` | - | MIT |
| `peeps/peeps.js` | شخصيات Open Peeps: `Peeps.svg({head, face, facialHair, accessories, skin, clothing})` | 48 راس، 30 وش (تعبيرات)، 16 دقن، 8 نضارات | CC0 |
| `undraw/` | رسومات فلات لمواقف. اللون المميز `currentColor`، فبيتغيّر بـ CSS `color` | 1,740 | unDraw license (تجاري مجاني) |
| `icons/lucide/` | أيقونات خطوط، مناسبة لحركة الرسم خط بخط | 2,143 | ISC |
| `icons/tabler-outline/` و `tabler-filled/` | أيقونات | 6,238 | MIT |
| `emoji/` | إيموجي متحرك (Lottie) من Google | 879 | CC BY 4.0: اكتب "Animated emoji by Google" في وصف الفيديو |
| `lottie/` | أي أنيميشن من LottieFiles تحطه بإيدك | - | Lottie Simple License |
| `vendor/gsap/` | GSAP + MotionPath و MorphSVG و DrawSVG و SplitText: `timeline({paused:true}).seek(t)` | - | GSAP no-charge license |
| `vendor/pixi*.js` | PixiJS + المؤثرات (Godray, Glow, Bloom) للإضاءة | - | MIT |
| `vendor/three/` | Three.js. في الصفحة: importmap لـ `three` و `three/addons/`، والحركة بـ `AnimationMixer.setTime(t)` | - | MIT |
| `vendor/rive/` | مشغّل Rive (ملفات `.riv` كل واحد ليه رخصته) | - | MIT |
| `2d/toon-characters/` | 6 شخصيات كرتون: أجزاء منفصلة (راس بـ 3 تعبيرات، جسم، دراع، إيد، رجل) + 45 وضعية (8 فريمات مشي، بيفكر، بيتكلم…) | 6 | CC0 |
| `2d/modular-characters/` | أجزاء تبني بيها شخصية: بشرة، وش، شعر، هدوم | 425 | CC0 |
| `2d/shape-characters/` و `2d/animal-pack/` | شخصيات أشكال بسيطة (جسم + عيون + بق + إيدين) وحيوانات | 100 + 80 | CC0 |
| `3d/ual1/` و `3d/ual2/` | مانيكان راجل وست بنسب طبيعية + 89 حركة (بيتكلم، دراعاته متربعة، مشي، قعدة، رقص، زراعة، باركور…) | 2 | CC0 |
| `3d/kaykit-adventurers/` | فارس، بربري، ساحر، لص، فيهم 75 حركة | 5 | CC0 |
| `3d/mini-characters/` | شخصيات صغيرة فيها 32 حركة (مشي، قعدة، أيوه/لأ) | 12 | CC0 |
| `3d/furniture-kit/` و `3d/kaykit-furniture/` | أثاث أوض | 140 + 108 | CC0 |
| `3d/RobotExpressive.glb` | روبوت بـ 14 حركة وتعبيرات وش | 1 | CC0 |

## الحاجات المهمة في الاستخدام
- **الحتمية:** كل حاجة بتتحسب من `t`. الـ Lottie بيتعمله `goToAndStop` في كل فريم، **حتى لو مستخبي**، علشان حالته ما تعتمدش على الفريم اللي قبله.
- **حركة البق:** بنبدّل بين وش مفتوح ووش مقفول (زي `concerned` و `concernedFear`) والكلمة شغالة، حسب توقيت ElevenLabs.
- **مثال كامل:** `reference/assets_demo.html` (2D) و `reference/models3d_preview.html` (3D).
- **الـ 3D على الماك:** Chromium بيستخدم كارت الشاشة (ANGLE Metal) لو اتشغّل بـ `--use-angle=metal`، والسرعة حوالي 23 فريم/ثانية بمقاس 1600×900.
- **المانيكان الست** (`ual2/Mannequin_F.glb`) من غير حركات، بس هيكلها نفس هيكل المكتبة، فبتاخد أي حركة من `ual1` أو `ual2` بالاسم.
- **حزم Quaternius (ual1, ual2):** رخصة الملفات CC0، والموقع بيمنع إعادة توزيع الملفات نفسها كحزمة. علشان كده بتتنزل بالسكريبت ومش بتترفع على git.

## شخصيات Mixamo (بتتنزل من Claude بعد ما تسجّل دخول في mixamo.com)
- **الفولدر:** `assets/3d/mixamo/`. **مش على git**: رخصة Mixamo مجانية للاستخدام التجاري، بس ممنوع إعادة توزيع الملفات نفسها.
- **`characters/`: 11 شخصية** (T-pose بالجلد): بنات: Claire, Amy, Kaya, Sporty_Granny, Megan, Kate, Jody. ولاد: Timmy, Ty, Big_Vegas, Doozy. + `Aj_*.fbx` (Aj بأربع حركات).
  - الكرتون (زي Aj): Claire, Amy, Kaya, Sporty_Granny, Ty, Timmy, Big_Vegas, Doozy. شبه الواقعي (أتقل، 50MB+): Megan, Kate, Jody.
  - Claire و Kaya و Sporty_Granny و Big_Vegas و Ty فيهم عضم للوش (300+ عضمة): ممكن نستخدمه بعدين لبق حقيقي.
- **`anims/`: 40 حركة** من غير جلد (متصدّرة على Aj): walk_female (في مكانه)، happy_idle، sad_idle، waving، waving_both، clapping، cheering، victory، pointing، nod_yes، shake_no، shake_no_thoughtful، shake_no_annoyed، laughing، crying، angry_gesture، angry_point، shrug، looking_around، texting، phone_call، sitting_idle، sitting_talking، stand_to_sit، sit_to_stand، typing، drinking، dancing_silly، dancing_hiphop، excited، surprised، defeated، bored، hands_forward، happy_gesture، yelling، relieved_sigh، asking_question، sitting_laughing، sitting_floor.
- **الاستخدام:** `reference/lib/mixamo.js`: `loadCharacter(name, {heightM})` و `play(ch, "waving")`. بيحل فرقين لوحده:
  1. بادئة العضم بتختلف (`mixamorigHips` / `mixamorig2Hips` / `mixamorig6Hips`…).
  2. الطول بيختلف: حركة الوسط بتتضرب في نسبة الطول، والطول نفسه بيتقاس من العضم (في شخصيات الجسم والعضم وحداتهم مختلفة).
- **Doozy:** لازم `{ normalMaps: false }`، الـ normal map بتاعه بيسوّد الجسم.
- **تنزيل شخصيات أو حركات زيادة:** `assets/tools/mixamo_export.js` (بيتشغّل جوه صفحة mixamo.com وإنت مسجّل دخول).
- **أمثلة:** `reference/room_aj.html` (مشهد كامل بصوت وبق)، `reference/cast_showcase.html` (كل الشخصيات).

## أماكن ومشاهد (CC0، بتتنزل بالسكريبت)
| الفولدر | فيه إيه |
|---|---|
| `3d/city-kit-suburban/` و `city-kit-commercial/` و `city-kit-roads/` | بيوت، محلات، شوارع وأرصفة (Kenney) |
| `3d/car-kit/` | عربيات (Kenney) |
| `3d/food-kit/` | 200 أكلة ومشروب (Kenney) |
| `3d/nature-kit/` | شجر، صخور، زرع، طرق (Kenney) |
| `3d/holiday-kit/` | زينة ومناسبات (Kenney) |
| `3d/kaykit-restaurant/` و `3d/kaykit-city/` | مطعم ومدينة بستايل KayKit |
| `3d/hdri/` | 5 إضاءات واقعية (Poly Haven، CC0): استوديو، استوديو صغير، سما فيها سحاب، غروب، خارجي. `hdriEnvironment()` في `lib/mixamo.js` |

## مش متاح دلوقتي
- **Quaternius Ultimate Modular Women/Men** (10 ستات و11 راجل بوشوش وشعر، و24 حركة): على Google Drive بس، وجوجل قافل التنزيل التلقائي ("Quota exceeded"). ممكن تتنزل بإيدك من quaternius.com وتتحط في `assets/3d/quaternius-women/` و `quaternius-men/`.
