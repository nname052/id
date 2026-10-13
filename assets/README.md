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

## الحاجات المهمة في الاستخدام
- **الحتمية:** كل حاجة بتتحسب من `t`. الـ Lottie بيتعمله `goToAndStop` في كل فريم، **حتى لو مستخبي**، علشان حالته ما تعتمدش على الفريم اللي قبله.
- **حركة البق:** بنبدّل بين وش مفتوح ووش مقفول (زي `concerned` و `concernedFear`) والكلمة شغالة، حسب توقيت ElevenLabs.
- **مثال كامل:** `reference/assets_demo.html`.
