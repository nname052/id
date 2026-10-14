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
