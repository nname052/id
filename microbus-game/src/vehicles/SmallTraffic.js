// =====================================================================
//  توكتوك وموتوسيكل للمرور (إجرائي وخفيف): كل واحد Mesh واحدة بألوان على الرؤوس (draw call واحد)
//  + السواق/الراكب بيتحط من Game (addDriver). العجل جوه نفس الـ Mesh (من بعيد اللفة مش باينة)
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
function motoGeo(body) {
  const key = 'moto' + body.join(',');
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
  ]);
  geoCache.set(key, g);
  return g;
}

const TUK_COLORS = [[0.06, 0.06, 0.07], [0.75, 0.6, 0.08], [0.55, 0.08, 0.08], [0.1, 0.35, 0.2]];
const MOTO_COLORS = [[0.1, 0.1, 0.12], [0.6, 0.06, 0.06], [0.08, 0.2, 0.5], [0.75, 0.75, 0.74]];

export function buildSmallTraffic(type, R = Math.random) {
  const tuk = type === 'tuktuk';
  const body = (tuk ? TUK_COLORS : MOTO_COLORS)[Math.floor(R() * 4)];
  const root = new THREE.Group(), bodyG = new THREE.Group();
  root.add(bodyG);
  const mesh = new THREE.Mesh(tuk ? tuktukGeo(body) : motoGeo(body), material());
  mesh.castShadow = true; bodyG.add(mesh);
  root.add(contactShadow(tuk ? 1.4 : 0.6, tuk ? 2.6 : 1.8));
  return {
    root, body: bodyG, wheels: [], length: tuk ? 2.7 : 1.9, width: tuk ? 1.3 : 0.75, brake: null, wheelRadius: tuk ? 0.25 : 0.31,
    driverSeat: tuk ? [0, 0.62, -0.55] : [0, 0.5, 0.18],
  };
}
