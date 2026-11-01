// =====================================================================
//  إعدادات الـ Assets (موديلات 3D، خامات، أصوات)
//  حط الملف بالاسم ده بالظبط في الفولدر المكتوب، واللعبة هتقراه تلقائيًا.
//  لو الملف مش موجود، اللعبة بتستخدم الموديل الإجرائي (Placeholder) اللي متعمل بالكود.
//  التفاصيل الكاملة ومصادر التحميل المجانية: ASSETS.md
// =====================================================================

export const MODEL_ASSETS = {
  // الميكروباص بتاعك  →  assets/models/microbus.glb
  microbus: {
    file: 'microbus.glb',
    targetLength: 4.69,        // طول الموديل بالمتر بعد التحجيم التلقائي (تويوتا هاي إس 2005 ≈ 4.7م)
    rotationY: 90,             // لو الموديل طالع بضهره، غيّرها لـ 0 أو 180 أو -90
    autoWheels: true,          // يكتشف العجل لوحده من اسم الخامة (wheel/tire)
    autoFit: true,             // يظبط أبعاد الفيزياء (المحاور والعجل) على مقاس الموديل
    offset: [0, 0, 0],         // إزاحة يدوية (متر) لو محتاج تظبط مكانه
    hasInterior: false,        // true لو الموديل فيه صالون داخلي كامل (هنخفي الصالون الإجرائي)
    proceduralMirrors: true,   // false لو الموديل فيه مرايات جانبية خاصة بيه
    steeringAxis: [0, 0, 1],   // محور دوران الدركسيون جوه الموديل (جرّب [0,1,0] لو بيلف غلط)
    // أسماء الـ nodes جوه الموديل (لو موجودة بنحركها؛ لو مش موجودة بنستخدم العجل الإجرائي)
    nodes: { wheelFL: 'wheel_FL', wheelFR: 'wheel_FR', wheelRL: 'wheel_RL', wheelRR: 'wheel_RR', steeringWheel: 'steering_wheel' },
  },
  // عربيات المرور (اختياري: أي واحد تحطه هيتستخدم بدل الإجرائي)
  car_sedan: { file: 'car_sedan.glb', targetLength: 4.45, rotationY: 180 },
  car_old: { file: 'car_old.glb', targetLength: 4.0, rotationY: 180 },
  // التاكسي (BYD Seal) بألوان تاكسي شبين: أخضر + شرايط صفرا — عربية اللاعب
  car_taxi: { file: 'car_taxi.glb', targetLength: 4.6, rotationY: 180, paint: 0x19b82a },
  // التوكتوك (Sketchfab) → بيتركب على ريج التوكتوك بتاع اللاعب
  tuktuk_model: { file: 'tuktuk.glb', targetLength: 2.65, rotationY: 180 },
  // شخص حقيقي (سكان ثابت) للناس الواقفة على الرصيف
  person_scan: { file: 'person_scan.glb', targetHeight: 1.74, rotationY: 0 },
  // ميكروباصات المرور: نفس موديل الهاي إس (نسخة منفصلة)
  microbus_traffic: { file: 'microbus.glb', targetLength: 4.69, rotationY: 90, trafficHiace: true },
  // عربيات المرور الحقيقية (Sketchfab، CC BY — tools/models/sketchfab.mjs بيحمّلها ويبسّطها ويكتب الحقوق).
  // لو الملف مش موجود: المرور بيستخدم السيدان الإجرائي. rotationY: الوش ناحية -z زي باقي العربيات
  car_lanos: { file: 'car_lanos.glb', targetLength: 4.24, rotationY: 180 },
  car_verna: { file: 'car_verna.glb', targetLength: 4.37, rotationY: 180 },
  car_sunny: { file: 'car_sunny.glb', targetLength: 4.34, rotationY: 180 },
  tuktuk_real: { file: 'tuktuk_real.glb', targetLength: 2.65, rotationY: 180 },
  // (بتتحمّل بـ tools/models/sketchfab.mjs — الاتجاه rotationY بيتأكد بعد التحميل)
  car_corolla_old: { file: 'car_corolla_old.glb', targetLength: 4.27, rotationY: 180 },
  car_corolla: { file: 'car_corolla.glb', targetLength: 4.62, rotationY: 180 },
  car_fiat128: { file: 'car_fiat128.glb', targetLength: 3.84, rotationY: 180 },
  car_peugeot504: { file: 'car_peugeot504.glb', targetLength: 4.49, rotationY: 180 },
  pickup_datsun: { file: 'pickup_datsun.glb', targetLength: 4.0, rotationY: 180 },
  pickup_hilux: { file: 'pickup_hilux.glb', targetLength: 5.33, rotationY: 180 },
  truck_canter: { file: 'truck_canter.glb', targetLength: 6.2, rotationY: 90, wheelR: 0.36 },
  car_corolla_ke80: { file: 'car_corolla_ke80.glb', targetLength: 4.2, rotationY: 180, wheelR: 0.28 },
  car_corolla_e70: { file: 'car_corolla_e70.glb', targetLength: 4.2, targetWidth: 1.82, rotationY: 0, wheelR: 0.28 }, // E70: عرض الجسم 1.61م (الموديل كان 1.69)
  pickup_90s: { file: 'pickup_90s.glb', targetLength: 4.7, rotationY: 270 },
  car_lada: { file: 'car_lada.glb', targetLength: 4.05, rotationY: 0, wheelR: 0.28 },
  car_logan: { file: 'car_logan.glb', targetLength: 4.25, rotationY: 180, wheelR: 0.29 },
  car_nexia: { file: 'car_nexia.glb', targetLength: 4.42, targetWidth: 1.86, rotationY: 180, wheelR: 0.29 }, // دايو نكسيا: 4.48 × 1.66 × 1.39 م (الطول بين الطول والارتفاع الحقيقيين — الموديل نسبته مختلفة)
  pickup_p404: { file: 'pickup_p404.glb', targetLength: 4.4, rotationY: 180, wheelR: 0.33 },
  pickup_toyota: { file: 'pickup_toyota.glb', targetLength: 4.35, rotationY: 180, wheelR: 0.33 },
  bus_karosa: { file: 'bus_karosa.glb', targetLength: 11, targetWidth: 2.52, rotationY: 90, wheelR: 0.5 }, // كاروسا B932: 11.05 × 2.50 م (الموديل كان 2.84 عرض)
  // المعالم الحقيقية (لو اتحمّلت): المقاس الحقيقي بالمتر
  mon_sphinx: { file: 'mon_sphinx.glb', targetLength: 73, rotationY: 0 },
  mon_cairo_tower: { file: 'mon_cairo_tower.glb', targetHeight: 187, rotationY: 0 },
  mon_ali_mosque: { file: 'mon_ali_mosque.glb', targetLength: 82, rotationY: 0 },
  // كرسي القهوة البلاستيك الأبيض (Poly Haven "Plastic Monobloc Chair 01" — Kuutti Siitonen، CC0؛ خامة اللون اتصغّرت 256)
  chair_plastic: { file: 'chair_plastic.glb', targetHeight: 0.82, rotationY: 0 },
  // المشاة (يفضّل يكون فيه أنيميشن اسمه فيه "walk")  →  assets/models/pedestrian.glb
  pedestrian: { file: 'pedestrian.glb', targetHeight: 1.72, rotationY: 0 },
};

// خامات PBR حقيقية (اختياري) → assets/textures/
// تقدر تنزلها مجانًا من ambientcg.com أو polyhaven.com (رخصة CC0)
export const TEXTURE_ASSETS = {
  // الأسفلت: النتوءات والخشونة من سكان حقيقي (ambientCG "Asphalt 031"، CC0 — اتصغّر 512)؛ اللون من صور شوارع شبين
  asphalt: { map: 'asphalt_color.jpg', normalMap: 'asphalt_normal.jpg', roughnessMap: 'asphalt_roughness.jpg', metersPerTile: 2 },
  sidewalk: { map: 'sidewalk_color.jpg', normalMap: 'sidewalk_normal.jpg', roughnessMap: 'sidewalk_roughness.jpg', metersPerTile: 2 },
};

// أصوات (اختياري) → assets/audio/
// لو مش موجودة: اللعبة بتولّد الصوت بالكود (Web Audio synth)
export const AUDIO_ASSETS = {
  engineLoop: 'engine_loop.mp3',     // لوب موتور ديزل ثابت (هنغيّر الـ pitch حسب الـ RPM)
  horn: 'horn.mp3',                  // كلاكس
  ambience: 'street_ambience.mp3',   // دوشة شارع (لوب)
};
