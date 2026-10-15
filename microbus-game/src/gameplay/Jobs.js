// =====================================================================
//  بيانات الشغل: خطوط الميكروباص (موقف → محطات → آخر الخط)، أماكن مشاوير التاكسي/التوكتوك، والأجرة والباقي
//  (بيانات بس — اللي بيشغلها Passengers.js)
// =====================================================================

/** خطوط الميكروباص: أول محطة = الموقف، وآخر محطة = آخر الخط (والرجوع بنفس المحطات بالعكس) */
export const LINES = [
  {
    id: 1, name: 'خط وسط البلد', to: 'وسط البلد', color: '#e8711a', fare: 10,
    stops: [
      { name: 'موقف شبين الكوم', x: 252, z: 272, terminal: true },
      { name: 'شارع باريس', x: 226, z: 300 },
      { name: 'أول شارع باريس', x: 62, z: 298 },
      { name: 'موقف وسط البلد', x: 0, z: 135 },
      { name: 'الجامع الكبير', x: 0, z: 30 },
      { name: 'السوق', x: 0, z: -93 },
      { name: 'آخر وسط البلد', x: 0, z: -215 },
    ],
  },
  {
    id: 2, name: 'خط القرية', to: 'القرية', color: '#2f9e5a', fare: 12,
    stops: [
      { name: 'موقف شبين الكوم', x: 252, z: 272, terminal: true },
      { name: 'الكليات', x: 200, z: 255 },
      { name: 'المستشفى الجامعي', x: 200, z: 116 },
      { name: 'موقف الترعة', x: 288, z: -16 },
      { name: 'القرية', x: 531, z: 26 },
    ],
  },
];

/** أماكن المشاوير (تاكسي/توكتوك). tuk = شارع ينفع للتوكتوك (مش طريق سريع/صحراوي) */
export const POIS = [
  { name: 'جامعة المنوفية', x: 200, z: 440, tuk: true },
  { name: 'الكليات', x: 200, z: 255, tuk: true },
  { name: 'المستشفى الجامعي', x: 200, z: 116, tuk: true },
  { name: 'محطة القطر', x: 252, z: 250, tuk: true },
  { name: 'موقف شبين الكوم', x: 252, z: 266, tuk: true },
  { name: 'الكورنيش', x: 146, z: 370, tuk: true },
  { name: 'قصر الثقافة', x: 145, z: 245, tuk: true },
  { name: 'شارع باريس', x: 175, z: 300, tuk: true },
  { name: 'أول شارع باريس', x: 62, z: 298, tuk: true },
  { name: 'موقف وسط البلد', x: 0, z: 135, tuk: true },
  { name: 'الجامع الكبير', x: 0, z: 30, tuk: true },
  { name: 'السوق', x: 0, z: -93, tuk: true },
  { name: 'آخر وسط البلد', x: 0, z: -215, tuk: true },
  { name: 'شارع الميدان', x: 126, z: -355, tuk: true },
  { name: 'المدرسة', x: 99, z: -508, tuk: true },
  { name: 'المقابر', x: -134, z: -306, tuk: true },
  { name: 'موقف الترعة', x: 288, z: -16, tuk: true },
  { name: 'القرية', x: 531, z: 26, tuk: true },
  { name: 'الحي السكني', x: 0, z: -425, tuk: true },
  { name: 'الطريق الزراعي', x: 499, z: -242, tuk: false },
  { name: 'استراحة الصحراوي', x: 576, z: 274, tuk: false },
];

/** مسافة المشوار المناسبة لكل عربية (بالمتر على الطريق) */
export const TRIP_RANGE = { taxi: [450, 2600], tuktuk: [140, 900] };

/** الأجرة: التاكسي بالعداد (فتحة 10ج + 4.5ج/كم)، التوكتوك مضاعفات 5 (أقل بكتير) */
export function tripFare(kind, meters) {
  const km = meters / 1000;
  if (kind === 'taxi') return Math.max(15, Math.round(10 + 4.5 * km));
  return Math.max(5, Math.ceil((4 + 9 * km) / 5) * 5);
}

/**
 * الراكب بيدفع بفلوس "مقفولة" (زي الحقيقة): أقرب 5/10/20/50/100/200 فوق الأجرة، وساعات بالظبط.
 * بيرجّع { paid, change }
 */
export function payment(fare, R = Math.random) {
  if (fare % 5 === 0 && R() < 0.25) return { paid: fare, change: 0 };
  const opts = [...new Set([5, 10, 20, 50, 100, 200].map((u) => Math.ceil(fare / u) * u).filter((v) => v > fare))].sort((a, b) => a - b);
  const r = R();
  const paid = opts[r < 0.5 ? 0 : r < 0.8 ? Math.min(1, opts.length - 1) : r < 0.95 ? Math.min(2, opts.length - 1) : opts.length - 1] ?? fare;
  return { paid, change: paid - fare };
}
