# دليل الـ Assets (موديلات 3D، خامات، أصوات)

اللعبة شغالة **من غير أي ملفات خارجية**: الميكروباص والعربيات والعمارات والمشاة والأصوات كلها متعملة بالكود.
لما تحب تحسّن الشكل، حط ملف بالاسم المكتوب في الفولدر المكتوب، واعمل **Refresh** للصفحة (أو اقفل `npm run dev` وشغله تاني). اللعبة هتلاقيه وتستخدمه لوحدها.

> كل الإعدادات (الاسم، الحجم، الدوران) موجودة في: `src/config/assets.config.js`
> افتح الـ Console في المتصفح (F12) هتلاقي سطر `[Assets]` بيقولك إيه اللي اتقري وإيه اللي مش موجود.

---

## الموديل الحالي للميكروباص
`assets/models/microbus.glb` = **2005 Toyota HiAce** من Sketchfab، عمل **ActsOfDoge** (https://sketchfab.com/3d-models/2005-toyota-hiace-c8a13f7fa53e45a2b151339d402f3392)، بترخيص **Sketchfab Standard**. لازم يفضل الكريدت ده موجود، ومش مسموح تبيع أو توزّع ملف الموديل نفسه لوحده.
اللعبة بتعمل عليه تلقائيًا: تحويل الـ Skinning لـ Mesh ثابت، اكتشاف العجل الأربعة وتوصيلها بالتوجيه والدوران، ضبط الفيزياء على مقاسه الحقيقي (قاعدة عجل 2.57م، عرض 1.69م)، شيل الصالون الياباني (الدركسيون يمين) وتركيب صالون مصري (يسار)، ومرايات حقيقية مكان مرايات الموديل.

## 1) الموديلات 3D → `assets/models/`

استخدم صيغة **GLB** بس (ملف واحد). لو لقيت الموديل FBX أو OBJ، افتحه في **Blender** (مجاني) واعمل: `File → Export → glTF 2.0` واختار `glTF Binary (.glb)`.

| الـ Asset | اسم الملف بالظبط | الفولدر | تدوّر على إيه |
|---|---|---|---|
| الميكروباص بتاعك | `microbus.glb` | `assets/models/` | `minibus`, `passenger van`, `white van`, `Toyota Hiace style van` (من غير لوجو) |
| ميكروباص المرور | `microbus_traffic.glb` | `assets/models/` | نفس اللي فوق (ممكن نفس الملف بنسخة أخف) |
| عربية حديثة | `car_sedan.glb` | `assets/models/` | `low poly sedan`, `generic sedan car` |
| عربية قديمة | `car_old.glb` | `assets/models/` | `old sedan 1970`, `classic boxy car`, `retro sedan` |
| تاكسي | `car_taxi.glb` | `assets/models/` | أي sedan أبيض (وتقدر تلونه في Blender) |
| مشاة | `pedestrian.glb` | `assets/models/` | `rigged character walk animation` (لازم يكون فيه أنيميشن اسمه فيه walk) |

### منين أجيب موديلات مجانية وقانونية؟
- **Sketchfab**: https://sketchfab.com → ابحث، وبعدين فلتر **Downloadable** والرخصة **CC0** أو **CC-BY** (CC-BY معناها لازم تكتب اسم صاحب الموديل في الكريدت). اختار Download → **glTF / GLB**.
- **Poly Pizza**: https://poly.pizza (موديلات Low-poly كتير منها CC0).
- **Quaternius**: https://quaternius.com (عربيات وشخصيات CC0 فيها أنيميشن مشي جاهز — ممتاز للمشاة).
- **Kenney**: https://kenney.nl/assets (Car Kit — CC0).
- **Mixamo**: https://www.mixamo.com (شخصيات + أنيميشن مشي مجاني؛ نزّل FBX وحوله لـ GLB في Blender).

⚠️ ابعد عن أي موديل عليه لوجو ماركة حقيقية (تويوتا، مرسيدس...) لو ناوي تنشر اللعبة.

### إعدادات الميكروباص (مهم)
في `src/config/assets.config.js` جوه `microbus`:
- `rotationY`: لو الموديل ظهر بالعكس، جرّب `0` أو `90` أو `-90`.
- `targetLength`: الطول بالمتر (الموديل بيتحجّم تلقائي).
- `offset`: لو محتاج تزق الموديل لقدام/فوق شوية.
- **العجل (تلقائي)**: مع `autoWheels: true` اللعبة بتدوّر على الخامة اللي اسمها فيه wheel/tire وتلاقي العجل الأربعة لوحدها. أو سمّي الـ objects في Blender بالأسماء دي:
  `wheel_FL` (قدام شمال)، `wheel_FR` (قدام يمين)، `wheel_RL` (ورا شمال)، `wheel_RR` (ورا يمين).
  لو مش موجودين، اللعبة هتستخدم العجل الإجرائي بتاعها.
- **الدركسيون**: سمّيه `steering_wheel` وخلّي `hasInterior: true` لو الموديل فيه صالون كامل.
- الفيزياء والكاميرا والمرايات مش هيتأثروا — الموديل شكل بس.

---

## 2) خامات PBR حقيقية → `assets/textures/`

حمّل من **ambientCG** (https://ambientcg.com) أو **Poly Haven** (https://polyhaven.com/textures) — الاتنين CC0 (مجاني تمامًا).
نزّل نسخة **1K أو 2K JPG**، وغيّر أسماء الملفات كده:

| الخامة | ابحث عن | الملفات |
|---|---|---|
| الأسفلت | `Asphalt` (مثلاً Asphalt 026 على ambientCG) | `asphalt_color.jpg` ، `asphalt_normal.jpg` (خد نسخة NormalGL) ، `asphalt_roughness.jpg` |
| بلاط الرصيف | `Paving Stones` أو `Tiles` | `sidewalk_color.jpg` ، `sidewalk_normal.jpg` ، `sidewalk_roughness.jpg` |

مقاس التكرار: الأسفلت 7 متر لكل صورة، الرصيف 2 متر.

---

## 3) الأصوات → `assets/audio/`

| الصوت | اسم الملف | ابحث عن |
|---|---|---|
| موتور ديزل (لوب ثابت) | `engine_loop.mp3` | `diesel engine idle loop`, `van engine loop` |
| كلاكس | `horn.mp3` | `car horn`, `van horn` |
| دوشة شارع (لوب) | `street_ambience.mp3` | `city street ambience`, `Cairo street` |

مصادر مجانية: **Freesound** (https://freesound.org — اختار CC0)، **Pixabay Sound Effects** (https://pixabay.com/sound-effects/)، **Sonniss GDC bundle** (مجاني للألعاب).
لو مفيش ملفات، اللعبة بتولّد كل الأصوات بالكود (موتور، كاوتش، فرامل، كلاكس، شارع).
