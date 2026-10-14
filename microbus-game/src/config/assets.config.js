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
  car_taxi: { file: 'car_taxi.glb', targetLength: 4.4, rotationY: 180 },
  microbus_traffic: { file: 'microbus_traffic.glb', targetLength: 4.95, rotationY: 180 },
  // المشاة (يفضّل يكون فيه أنيميشن اسمه فيه "walk")  →  assets/models/pedestrian.glb
  pedestrian: { file: 'pedestrian.glb', targetHeight: 1.72, rotationY: 0 },
};

// خامات PBR حقيقية (اختياري) → assets/textures/
// تقدر تنزلها مجانًا من ambientcg.com أو polyhaven.com (رخصة CC0)
export const TEXTURE_ASSETS = {
  asphalt: { map: 'asphalt_color.jpg', normalMap: 'asphalt_normal.jpg', roughnessMap: 'asphalt_roughness.jpg', metersPerTile: 7 },
  sidewalk: { map: 'sidewalk_color.jpg', normalMap: 'sidewalk_normal.jpg', roughnessMap: 'sidewalk_roughness.jpg', metersPerTile: 2 },
};

// أصوات (اختياري) → assets/audio/
// لو مش موجودة: اللعبة بتولّد الصوت بالكود (Web Audio synth)
export const AUDIO_ASSETS = {
  engineLoop: 'engine_loop.mp3',     // لوب موتور ديزل ثابت (هنغيّر الـ pitch حسب الـ RPM)
  horn: 'horn.mp3',                  // كلاكس
  ambience: 'street_ambience.mp3',   // دوشة شارع (لوب)
};
