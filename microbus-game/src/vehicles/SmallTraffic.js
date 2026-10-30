// =====================================================================
//  توكتوك وموتوسيكل للمرور (إجرائي وخفيف): كل واحد Mesh واحدة بألوان على الرؤوس (draw call واحد)
//  + السواق/الراكب بيتحط من Game (addDriver). العجل جوه نفس الـ Mesh (من بعيد اللفة مش باينة)
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { contactShadow } from './CarModels.js';

const _c = new THREE.Color();
function part(g, rgb, m) {
  g = g.index ? g.toNonIndexed() : g.clone();
  if (m) g.applyMatrix4(m);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  _c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const wheel = (x, y, z, r, w) => part(new THREE.CylinderGeometry(r, r, w, 10), [0.08, 0.08, 0.08], M(x, y, z, 0, 0, Math.PI / 2));

let mat = null;
const material = () => (mat ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }));
const geoCache = new Map();

/** توكتوك (باجاج): جسم + سقف قماش + 3 عجلات. القدام = -z */
function tuktukGeo(body) {
  const key = 'tuk' + body.join(',');
  if (geoCache.has(key)) return geoCache.get(key);
  const dark = [0.08, 0.08, 0.09], canvasC = [0.1, 0.1, 0.1];
  const g = mergeGeometries([
    part(new THREE.BoxGeometry(1.25, 0.55, 2.3), body, M(0, 0.55, 0.1)),             // الجسم
    part(new THREE.BoxGeometry(1.2, 0.5, 0.5), body, M(0, 0.85, -0.95)),              // المقدمة (لحد 1.1م)
    part(new THREE.BoxGeometry(1.05, 0.08, 0.32), body, M(0, 1.1, -0.86, 0.35)),      // تابلوه مايل بيوصّل المقدمة بالقزاز
    part(new THREE.BoxGeometry(1.3, 0.07, 2.12), canvasC, M(0, 1.74, 0.2)),           // السقف: من فوق القزاز لحد الضهر
    part(new THREE.BoxGeometry(1.26, 0.1, 0.08), dark, M(0, 1.68, -0.82)),            // حرف السقف قدام
    part(new THREE.BoxGeometry(0.06, 0.68, 0.06), dark, M(-0.58, 1.39, -0.74, -0.12)), // قوايم القزاز
    part(new THREE.BoxGeometry(0.06, 0.68, 0.06), dark, M(0.58, 1.39, -0.74, -0.12)),
    part(new THREE.BoxGeometry(0.05, 0.92, 0.05), dark, M(-0.6, 1.27, 1.22)),          // قوايم ورا
    part(new THREE.BoxGeometry(0.05, 0.92, 0.05), dark, M(0.6, 1.27, 1.22)),
    part(new THREE.BoxGeometry(1.22, 0.9, 0.06), canvasC, M(0, 1.27, 1.22)),           // ضهر قماش
    part(new THREE.BoxGeometry(1.1, 0.6, 0.03), [0.55, 0.65, 0.7], M(0, 1.4, -0.75, -0.12)), // قزاز قدام (بين القوايم، تحت حرف السقف)
    part(new THREE.BoxGeometry(1.0, 0.35, 0.5), [0.42, 0.2, 0.16], M(0, 0.95, 0.7)),  // الكنبة
    part(new THREE.BoxGeometry(1.0, 0.45, 0.12), [0.42, 0.2, 0.16], M(0, 1.3, 0.98, 0.1)), // ضهر الكنبة
    part(new THREE.BoxGeometry(0.7, 0.05, 0.05), dark, M(0, 1.12, -0.55)),            // الجادون
    part(new THREE.SphereGeometry(0.09, 6, 4), [1, 0.95, 0.75], M(0, 0.95, -1.22)),   // الفانوس
    part(new THREE.BoxGeometry(0.34, 0.12, 0.36), body, M(0, 0.56, -1.0)),            // رفرف العجلة القدامانية
    wheel(0, 0.25, -1.0, 0.25, 0.14), wheel(-0.58, 0.25, 0.75, 0.25, 0.14), wheel(0.58, 0.25, 0.75, 0.25, 0.14),
  ]);
  geoCache.set(key, g);
  return g;
}
function motoGeo(body, box = 0) {
  const key = 'moto' + body.join(',') + box;
  if (geoCache.has(key)) return geoCache.get(key);
  const dark = [0.07, 0.07, 0.08], chrome = [0.6, 0.6, 0.62];
  const g = mergeGeometries([
    wheel(0, 0.31, -0.68, 0.31, 0.1), wheel(0, 0.31, 0.68, 0.31, 0.1),
    part(new THREE.BoxGeometry(0.28, 0.32, 0.9), body, M(0, 0.62, 0)),               // الخزان/الجسم
    part(new THREE.BoxGeometry(0.26, 0.1, 0.6), dark, M(0, 0.82, 0.25)),             // الكرسي
    part(new THREE.BoxGeometry(0.06, 0.6, 0.06), chrome, M(0, 0.62, -0.62, -0.35)),   // الشوكة
    part(new THREE.BoxGeometry(0.62, 0.04, 0.04), dark, M(0, 0.96, -0.5)),            // الجادون
    part(new THREE.BoxGeometry(0.2, 0.2, 0.3), dark, M(0, 0.4, 0.05)),               // الموتور
    part(new THREE.SphereGeometry(0.08, 6, 4), [1, 0.95, 0.75], M(0, 0.86, -0.66)),
    // موتوسيكل توصيل: صندوق ورا (لون عادي، من غير أي علامة تجارية)
    ...(box ? [part(new THREE.BoxGeometry(0.42, 0.4, 0.4), box === 1 ? [0.75, 0.1, 0.08] : [0.1, 0.25, 0.6], M(0, 1.08, 0.5))] : []),
  ]);
  geoCache.set(key, g);
  return g;
}

/** "ربع نقل" (بيك أب كابينة واحدة زي النيسان/الشيفروليه المنتشرين في مصر): كابينة + صندوق، وساعات حمولة. القدام = -z
 *  load: 0 فاضي، 1 أقفاص خضار، 2 أنابيب بوتاجاز (زرقا)، 3 شكاير */
function pickupGeo(body, load) {
  const key = 'pk' + body.join(',') + load;
  if (geoCache.has(key)) return geoCache.get(key);
  const dark = [0.06, 0.06, 0.07], glass = [0.16, 0.2, 0.24], chrome = [0.62, 0.63, 0.65], lamp = [1, 0.96, 0.82], tail = [0.6, 0.05, 0.04];
  const W = 1.66, P = [];
  // (الحرفين مدورين: الصناديق الحادة كانت شكلها لعبة من قريب)
  const RB = (w, h, d, r = 0.06) => new RoundedBoxGeometry(w, h, d, 2, r);
  P.push(
    part(RB(W, 0.42, 4.75, 0.08), body, M(0, 0.62, 0)),                 // الشاسيه/الجوانب التحتانية
    part(RB(W - 0.04, 0.3, 1.25, 0.1), body, M(0, 0.98, -1.72, 0.04)),        // الكبوت
    part(RB(W - 0.06, 0.68, 1.45, 0.1), body, M(0, 1.17, -0.42)),       // الكابينة
    part(RB(W - 0.12, 0.08, 1.25, 0.035), body, M(0, 1.52, -0.36)),       // السقف
    part(new THREE.BoxGeometry(W - 0.14, 0.5, 0.04), glass, M(0, 1.24, -1.13, -0.42)), // القزاز القدام (مايل)
    part(new THREE.BoxGeometry(W - 0.2, 0.36, 0.04), glass, M(0, 1.28, 0.31)),        // القزاز الورّاني
    part(new THREE.BoxGeometry(0.04, 0.36, 1.05), glass, M(-W / 2 + 0.02, 1.27, -0.45)), // شبابيك الجنب
    part(new THREE.BoxGeometry(0.04, 0.36, 1.05), glass, M(W / 2 - 0.02, 1.27, -0.45)),
    // الصندوق: أرضية + 3 جناب + باب ورا
    part(new THREE.BoxGeometry(W - 0.1, 0.05, 2.0), dark, M(0, 0.86, 1.32)),
    part(new THREE.BoxGeometry(0.05, 0.42, 2.0), body, M(-W / 2 + 0.03, 1.05, 1.32)),
    part(new THREE.BoxGeometry(0.05, 0.42, 2.0), body, M(W / 2 - 0.03, 1.05, 1.32)),
    part(new THREE.BoxGeometry(W - 0.06, 0.42, 0.05), body, M(0, 1.05, 2.33)),
    part(new THREE.BoxGeometry(W - 0.06, 0.42, 0.05), body, M(0, 1.05, 0.33)),
    // وش وضهر
    part(RB(W + 0.04, 0.16, 0.14, 0.05), chrome, M(0, 0.5, -2.39)),       // الإكصدام
    part(new THREE.BoxGeometry(W - 0.5, 0.2, 0.03), dark, M(0, 0.86, -2.36)),          // الشبكة
    part(new THREE.BoxGeometry(0.3, 0.14, 0.04), lamp, M(-0.6, 0.88, -2.36)), part(new THREE.BoxGeometry(0.3, 0.14, 0.04), lamp, M(0.6, 0.88, -2.36)),
    part(new THREE.BoxGeometry(W + 0.02, 0.14, 0.1), dark, M(0, 0.5, 2.39)),
    part(new THREE.BoxGeometry(0.12, 0.26, 0.04), tail, M(-0.74, 0.98, 2.37)), part(new THREE.BoxGeometry(0.12, 0.26, 0.04), tail, M(0.74, 0.98, 2.37)),
    part(new THREE.BoxGeometry(0.06, 0.12, 0.16), dark, M(-W / 2 - 0.06, 1.25, -1.05)), part(new THREE.BoxGeometry(0.06, 0.12, 0.16), dark, M(W / 2 + 0.06, 1.25, -1.05)), // المرايات
    wheel(-0.7, 0.34, -1.55, 0.34, 0.22), wheel(0.7, 0.34, -1.55, 0.34, 0.22), wheel(-0.7, 0.34, 1.45, 0.34, 0.22), wheel(0.7, 0.34, 1.45, 0.34, 0.22),
  );
  if (load === 1) { // أقفاص خضار/فاكهة
    const crate = [0.58, 0.42, 0.24], prod = [[0.85, 0.35, 0.08], [0.3, 0.6, 0.15], [0.8, 0.12, 0.1]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
      const x = -0.4 + j * 0.8, z = 0.65 + i * 0.62, y = 1.05 + k * 0.32;
      P.push(part(new THREE.BoxGeometry(0.74, 0.3, 0.56), crate, M(x, y, z)));
      if (k === 1) P.push(part(new THREE.BoxGeometry(0.66, 0.06, 0.48), prod[(i + j) % 3], M(x, y + 0.16, z)));
    }
  } else if (load === 2) { // أنابيب بوتاجاز
    const blue = [0.12, 0.3, 0.62];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) P.push(part(new THREE.CylinderGeometry(0.15, 0.15, 0.62, 8), blue, M(-0.45 + j * 0.45, 1.2, 0.6 + i * 0.42)));
  } else if (load === 3) { // شكاير
    const sack = [0.82, 0.78, 0.66];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) P.push(part(new THREE.BoxGeometry(0.7, 0.28, 0.55), sack, M(-0.37 + j * 0.74, 1.04 + (i % 2) * 0.12, 0.7 + i * 0.6)));
  }
  const g = mergeGeometries(P);
  geoCache.set(key, g);
  return g;
}
/** أتوبيس النقل العام بالقاهرة (الجديد، 12م أرضيته واطية): قدام وورا أصفر وحزام أخضر تحت (من صور Commons:
 *  "Cairo electric bus at Ramses Square.jpg" و"Cairo bus with GEM advertising, Ramses Square.jpg"، CC BY-SA 4.0 — للألوان بس)
 *  والجنب غالبًا متغطي إعلان (لون واحد هنا). القدام = -z */
function busGeo(side) {
  const key = 'bus' + side.join(',');
  if (geoCache.has(key)) return geoCache.get(key);
  const yellow = [0.93, 0.8, 0.06], green = [0.18, 0.62, 0.2], glass = [0.08, 0.1, 0.12], dark = [0.05, 0.05, 0.06], roof = [0.82, 0.83, 0.84], led = [1, 0.45, 0.05], lamp = [1, 0.96, 0.82];
  const RB = (w, h, d, r = 0.12) => new RoundedBoxGeometry(w, h, d, 2, r);
  const L = 11.9, W = 2.5, P = [
    part(RB(W, 2.75, L, 0.16), side, M(0, 1.72, 0)),                                  // الجسم (الجنب: إعلان/لون)
    part(RB(W + 0.02, 2.7, 0.9, 0.16), yellow, M(0, 1.72, -L / 2 + 0.42)),            // الوش أصفر
    part(RB(W + 0.02, 2.7, 0.7, 0.16), yellow, M(0, 1.72, L / 2 - 0.32)),             // الضهر أصفر
    part(new THREE.BoxGeometry(W + 0.04, 0.32, L - 0.2), green, M(0, 0.52, 0)),        // الحزام الأخضر تحت
    part(new THREE.BoxGeometry(W + 0.03, 1.0, L - 1.9), glass, M(0, 2.12, 0.1)),       // شبابيك الجنب
    part(new THREE.BoxGeometry(W - 0.25, 1.55, 0.05), glass, M(0, 1.95, -L / 2 - 0.01)), // الزجاج القدام
    part(new THREE.BoxGeometry(W - 0.6, 0.9, 0.05), glass, M(0, 2.25, L / 2 + 0.01)),   // الزجاج الورّاني
    part(new THREE.BoxGeometry(1.7, 0.22, 0.06), led, M(0, 2.9, -L / 2 - 0.02)),        // لوحة الخط (LED)
    part(new THREE.BoxGeometry(0.06, 2.2, 1.15), glass, M(W / 2 + 0.02, 1.5, -L / 2 + 1.5)), // الباب القدام (يمين)
    part(new THREE.BoxGeometry(0.06, 2.2, 1.25), glass, M(W / 2 + 0.02, 1.5, 0.6)),          // الباب النص
    part(RB(1.8, 0.32, 3.2, 0.1), roof, M(0, 3.24, -1.2)),                                // تكييف السقف
    part(new THREE.BoxGeometry(0.34, 0.16, 0.05), lamp, M(-0.9, 0.85, -L / 2 - 0.02)), part(new THREE.BoxGeometry(0.34, 0.16, 0.05), lamp, M(0.9, 0.85, -L / 2 - 0.02)),
    part(new THREE.BoxGeometry(W + 0.06, 0.2, 0.12), dark, M(0, 0.42, -L / 2 - 0.03)), part(new THREE.BoxGeometry(W + 0.06, 0.2, 0.12), dark, M(0, 0.42, L / 2 + 0.03)),
    part(new THREE.BoxGeometry(0.08, 0.2, 0.3), dark, M(-W / 2 - 0.18, 2.4, -L / 2 + 0.1)), part(new THREE.BoxGeometry(0.08, 0.2, 0.3), dark, M(W / 2 + 0.18, 2.4, -L / 2 + 0.1)), // المرايات
    wheel(-1.05, 0.5, -L / 2 + 2.6, 0.5, 0.3), wheel(1.05, 0.5, -L / 2 + 2.6, 0.5, 0.3), wheel(-1.05, 0.5, L / 2 - 3.2, 0.5, 0.3), wheel(1.05, 0.5, L / 2 - 3.2, 0.5, 0.3),
  ];
  const g = mergeGeometries(P);
  geoCache.set(key, g);
  return g;
}
/** نقل خفيف "جامبو" (كابينة فوق الموتور زي الكانتر/الإيسوزو المنتشرين): كابينة + صندوق مقفول أو مفتوح بمشمع. القدام = -z */
function truckGeo(cab, kind) {
  const key = 'trk' + cab.join(',') + kind;
  if (geoCache.has(key)) return geoCache.get(key);
  const RB = (w, h, d, r = 0.08) => new RoundedBoxGeometry(w, h, d, 2, r);
  const glass = [0.1, 0.12, 0.14], dark = [0.06, 0.06, 0.07], chrome = [0.6, 0.6, 0.62], lamp = [1, 0.96, 0.82], tail = [0.6, 0.05, 0.04];
  const W = 2.1, P = [
    part(new THREE.BoxGeometry(0.9, 0.22, 7.2), dark, M(0, 0.62, 0.3)),                 // الشاسيه
    part(RB(W, 1.55, 1.7, 0.12), cab, M(0, 1.55, -2.85)),                              // الكابينة
    part(new THREE.BoxGeometry(W - 0.2, 0.7, 0.05), glass, M(0, 1.85, -3.71)),          // الزجاج القدام
    part(new THREE.BoxGeometry(0.05, 0.5, 0.8), glass, M(-W / 2 - 0.01, 1.85, -3.05)), part(new THREE.BoxGeometry(0.05, 0.5, 0.8), glass, M(W / 2 + 0.01, 1.85, -3.05)),
    part(new THREE.BoxGeometry(W - 0.5, 0.3, 0.04), dark, M(0, 1.05, -3.72)),           // الشبكة
    part(new THREE.BoxGeometry(0.3, 0.15, 0.04), lamp, M(-0.75, 1.0, -3.72)), part(new THREE.BoxGeometry(0.3, 0.15, 0.04), lamp, M(0.75, 1.0, -3.72)),
    part(new THREE.BoxGeometry(W + 0.05, 0.2, 0.12), chrome, M(0, 0.68, -3.72)),
    part(new THREE.BoxGeometry(0.08, 0.35, 0.12), dark, M(-W / 2 - 0.2, 2.0, -3.5)), part(new THREE.BoxGeometry(0.08, 0.35, 0.12), dark, M(W / 2 + 0.2, 2.0, -3.5)),
    part(new THREE.BoxGeometry(0.15, 0.2, 0.04), tail, M(-0.95, 0.85, 3.86)), part(new THREE.BoxGeometry(0.15, 0.2, 0.04), tail, M(0.95, 0.85, 3.86)),
    wheel(-0.85, 0.45, -2.6, 0.45, 0.28), wheel(0.85, 0.45, -2.6, 0.45, 0.28), wheel(-0.85, 0.45, 2.3, 0.45, 0.32), wheel(0.85, 0.45, 2.3, 0.45, 0.32),
  ];
  if (kind === 0) { // صندوق مقفول (ألومنيوم/أبيض)
    P.push(part(RB(W + 0.1, 2.2, 5.6, 0.05), [0.85, 0.86, 0.87], M(0, 2.0, 1.05)));
  } else { // صندوق مفتوح جنابه حديد + مشمع فوق الحمولة
    const side = kind === 1 ? [0.2, 0.35, 0.6] : [0.55, 0.12, 0.1], tarp = kind === 1 ? [0.18, 0.4, 0.22] : [0.7, 0.55, 0.25];
    P.push(part(new THREE.BoxGeometry(W + 0.05, 0.08, 5.6), dark, M(0, 0.98, 1.05)));
    for (const s of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.06, 0.75, 5.6), side, M(s * (W / 2), 1.38, 1.05)));
    P.push(part(new THREE.BoxGeometry(W, 0.75, 0.06), side, M(0, 1.38, 3.83)), part(new THREE.BoxGeometry(W, 0.75, 0.06), side, M(0, 1.38, -1.73)));
    P.push(part(RB(W - 0.1, 0.9, 5.4, 0.25), tarp, M(0, 1.9, 1.05)));
  }
  const g = mergeGeometries(P);
  geoCache.set(key, g);
  return g;
}
const TRUCK_CABS = [[0.92, 0.92, 0.9], [0.92, 0.92, 0.9], [0.15, 0.3, 0.6], [0.7, 0.1, 0.08]];

const BUS_SIDES = [[0.72, 0.06, 0.07], [0.09, 0.1, 0.14], [0.93, 0.8, 0.06], [0.75, 0.76, 0.78]];

const PICKUP_COLORS = [[0.92, 0.92, 0.9], [0.92, 0.92, 0.9], [0.13, 0.27, 0.55], [0.6, 0.62, 0.64], [0.55, 0.08, 0.07], [0.12, 0.3, 0.2]];

const TUK_COLORS = [[0.06, 0.06, 0.07], [0.75, 0.6, 0.08], [0.55, 0.08, 0.08], [0.1, 0.35, 0.2]];
const MOTO_COLORS = [[0.1, 0.1, 0.12], [0.6, 0.06, 0.06], [0.08, 0.2, 0.5], [0.75, 0.75, 0.74]];

export function buildSmallTraffic(type, R = Math.random) {
  if (type === 'bus') {
    const root = new THREE.Group(), bodyG = new THREE.Group(); root.add(bodyG);
    const mesh = new THREE.Mesh(busGeo(BUS_SIDES[Math.floor(R() * BUS_SIDES.length)]), material());
    mesh.castShadow = true; bodyG.add(mesh);
    root.add(contactShadow(2.7, 12.2));
    return { root, body: bodyG, wheels: [], length: 12, width: 2.55, brake: null, wheelRadius: 0.5, driverSeat: [-0.8, 1.05, -5.0] };
  }
  if (type === 'truck') {
    const root = new THREE.Group(), bodyG = new THREE.Group(); root.add(bodyG);
    const mesh = new THREE.Mesh(truckGeo(TRUCK_CABS[Math.floor(R() * TRUCK_CABS.length)], Math.floor(R() * 3)), material());
    mesh.castShadow = true; bodyG.add(mesh);
    root.add(contactShadow(2.3, 7.9));
    return { root, body: bodyG, wheels: [], length: 7.7, width: 2.25, brake: null, wheelRadius: 0.45, driverSeat: [-0.5, 1.3, -3.0] };
  }
  if (type === 'pickup') {
    const root = new THREE.Group(), bodyG = new THREE.Group(); root.add(bodyG);
    const mesh = new THREE.Mesh(pickupGeo(PICKUP_COLORS[Math.floor(R() * PICKUP_COLORS.length)], Math.floor(R() * 4)), material());
    mesh.castShadow = true; bodyG.add(mesh);
    root.add(contactShadow(1.8, 4.9));
    return { root, body: bodyG, wheels: [], length: 4.8, width: 1.7, brake: null, wheelRadius: 0.34, driverSeat: [-0.38, 0.62, -0.55] };
  }
  const tuk = type === 'tuktuk';
  const body = (tuk ? TUK_COLORS : MOTO_COLORS)[Math.floor(R() * 4)];
  const root = new THREE.Group(), bodyG = new THREE.Group();
  root.add(bodyG);
  const mesh = new THREE.Mesh(tuk ? tuktukGeo(body) : motoGeo(body, R() < 0.5 ? 1 + Math.floor(R() * 2) : 0), material());
  mesh.castShadow = true; bodyG.add(mesh);
  root.add(contactShadow(tuk ? 1.4 : 0.6, tuk ? 2.6 : 1.8));
  return {
    root, body: bodyG, wheels: [], length: tuk ? 2.7 : 1.9, width: tuk ? 1.3 : 0.75, brake: null, wheelRadius: tuk ? 0.25 : 0.31,
    driverSeat: tuk ? [0, 0.62, -0.55] : [0, 0.5, 0.18],
  };
}
