// =====================================================================
//  خرايط اللعبة: شبين الكوم (الأصلية) + عواصم محافظات مصر — كلها من OpenStreetMap
//  (tools/osm/egypt/*: نفس طريقة شبين: شوارع/كباري/مية/سكة من OSM + بصمات مباني Microsoft من الأقمار الصناعية).
//  كل مدينة = مربع ~4×4 كم حوالين وسطها (نقطة place=city في OSM). البيانات المضغوطة في public/packs/<id>/.
//  الاختيار: ?map=<id> في اللينك، أو من شاشة البداية (بيتحفظ). water: لون المية (sea = بحر/قناة/بحيرة، nile = النيل)
// =====================================================================
export const MAPS = [
  { id: 'shibin', name: 'شبين الكوم', gov: 'المنوفية', lat: 30.5545, lon: 31.0098, packed: false },
  { id: 'cairo', name: 'القاهرة', gov: 'القاهرة', lat: 30.0444, lon: 31.2357, water: 'nile' },
  { id: 'giza', name: 'الجيزة', gov: 'الجيزة', lat: 29.9871, lon: 31.2118, water: 'nile' },
  { id: 'alex', name: 'الإسكندرية', gov: 'الإسكندرية', lat: 31.1992, lon: 29.8952, water: 'sea' },
  { id: 'banha', name: 'بنها', gov: 'القليوبية', lat: 30.4625, lon: 31.1841, water: 'nile' },
  { id: 'portsaid', name: 'بورسعيد', gov: 'بورسعيد', lat: 31.2632, lon: 32.3055, water: 'sea' },
  { id: 'suez', name: 'السويس', gov: 'السويس', lat: 29.9745, lon: 32.5371, water: 'sea' },
  { id: 'ismailia', name: 'الإسماعيلية', gov: 'الإسماعيلية', lat: 30.6044, lon: 32.2771, water: 'sea' },
  { id: 'damietta', name: 'دمياط', gov: 'دمياط', lat: 31.4167, lon: 31.8214, water: 'sea' },
  { id: 'mansoura', name: 'المنصورة', gov: 'الدقهلية', lat: 31.0376, lon: 31.3865, water: 'nile' },
  { id: 'zagazig', name: 'الزقازيق', gov: 'الشرقية', lat: 30.5853, lon: 31.5035 },
  { id: 'tanta', name: 'طنطا', gov: 'الغربية', lat: 30.7834, lon: 30.9983 },
  { id: 'kafrsheikh', name: 'كفر الشيخ', gov: 'كفر الشيخ', lat: 31.1089, lon: 30.9427 },
  { id: 'damanhur', name: 'دمنهور', gov: 'البحيرة', lat: 31.0375, lon: 30.4711 },
  { id: 'faiyum', name: 'الفيوم', gov: 'الفيوم', lat: 29.3074, lon: 30.84 },
  { id: 'benisuef', name: 'بني سويف', gov: 'بني سويف', lat: 29.073, lon: 31.0983, water: 'nile' },
  { id: 'minya', name: 'المنيا', gov: 'المنيا', lat: 28.0893, lon: 30.7571, water: 'nile' },
  { id: 'asyut', name: 'أسيوط', gov: 'أسيوط', lat: 27.1833, lon: 31.1854, water: 'nile' },
  { id: 'sohag', name: 'سوهاج', gov: 'سوهاج', lat: 26.5477, lon: 31.6993, water: 'nile' },
  { id: 'qena', name: 'قنا', gov: 'قنا', lat: 26.1593, lon: 32.7163, water: 'nile' },
  { id: 'luxor', name: 'الأقصر', gov: 'الأقصر', lat: 25.7021, lon: 32.6472, water: 'nile' },
  { id: 'aswan', name: 'أسوان', gov: 'أسوان', lat: 24.0911, lon: 32.8973, water: 'nile' },
  { id: 'hurghada', name: 'الغردقة', gov: 'البحر الأحمر', lat: 27.2226, lon: 33.8307, water: 'sea' },
  { id: 'kharga', name: 'الخارجة', gov: 'الوادي الجديد', lat: 25.4523, lon: 30.5416 },
  { id: 'matruh', name: 'مرسى مطروح', gov: 'مطروح', lat: 31.3529, lon: 27.2395, water: 'sea' },
  { id: 'arish', name: 'العريش', gov: 'شمال سيناء', lat: 31.1236, lon: 33.7984, water: 'sea' },
  { id: 'tor', name: 'الطور', gov: 'جنوب سيناء', lat: 28.2417, lon: 33.6236, water: 'sea' },
].map((m) => ({ packed: true, ...m }));

const KEY = 'egy-map';
/** الخريطة الحالية: ?map=… ولا آخر اختيار ولا شبين */
export function currentMap() {
  let id = null;
  try { id = new URLSearchParams(location.search).get('map'); } catch { /* */ }
  if (!id) try { id = localStorage.getItem(KEY); } catch { /* */ }
  return MAPS.find((m) => m.id === id) || MAPS[0];
}
/** تغيير الخريطة = تحميل الصفحة تاني (كل حاجة بتتبني من البيانات الجديدة) */
export function switchMap(id) {
  try { localStorage.setItem(KEY, id); } catch { /* */ }
  const u = new URL(location.href); u.searchParams.set('map', id);
  location.href = u.toString();
}
