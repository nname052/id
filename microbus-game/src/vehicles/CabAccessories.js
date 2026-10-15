import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex } from '../render/textures.js';

// زينة خفيفة في كابينة الميكروباص: عين زرقا (نَظَر) متعلقة في المراية — بندول بيتمرجح مع السبحة.
// (التابلوه نفسه نضيف زي صورة الكابينة المرجعية: من غير سجادة ولا علب ولا لافتات تغطي الرؤية)

const M4 = (x = 0, y = 0, z = 0) => new THREE.Matrix4().makeTranslation(x, y, z);

function eyeCharmTexture() {
  const c = canvas(64, 64), x = c.getContext('2d');
  for (const [r, col] of [[31, '#0b3fa8'], [22, '#ffffff'], [15, '#5ab4ff'], [8, '#0a0a14']]) { x.fillStyle = col; x.beginPath(); x.arc(32, 32, r, 0, Math.PI * 2); x.fill(); }
  return tex(c, { repeat: false });
}

/**
 * P: { wtF, wtY, z } من buildHiaceInterior (أعلى الزجاج الأمامي)
 * بترجع hanger: { obj, L } (PlayerVehicle بيمرجحها حسب التسارع والميل)
 */
export function addEyeCharm(group, { wtF, wtY, z }) {
  const charm = new THREE.Group();
  charm.position.set(0.07, wtY - 0.122, z(wtF - 0.045));
  const L = 0.11;
  const g = new GeoBuilder();
  g.setColor([0.85, 0.7, 0.3]);
  g.addGeometry(new THREE.CylinderGeometry(0.0012, 0.0012, L, 4), M4(0, -L / 2, 0));
  for (let i = 0; i < 4; i++) { g.setColor(i % 2 ? [0.1, 0.3, 0.85] : [0.95, 0.95, 0.95]); g.addGeometry(new THREE.SphereGeometry(0.005, 6, 5), M4(0, -0.02 - i * 0.018, 0)); }
  charm.add(new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 })));
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), new THREE.MeshStandardMaterial({ map: eyeCharmTexture(), roughness: 0.15, side: THREE.DoubleSide }));
  eye.position.y = -L - 0.02;
  charm.add(eye);
  group.add(charm);
  return { obj: charm, L: L + 0.02 };
}

/**
 * الكلب أبو راس بتتهز (على التابلوه قدام السواق): جسم قاعد ثابت + راس على "سوستة"
 * الراس بتتهز مع البنزين/الفرامل/اللف/المطبات (PlayerVehicle بيحرّكها من rig.bobbles).
 * وشه ناحية السواق (+z). المقاس ~10 سم.
 */
export function addBobbleDog(group, x, y, z, yaw = 0, scale = 1) {
  const root = new THREE.Group();
  root.position.set(x, y, z); root.rotation.y = yaw; root.scale.setScalar(scale);
  const S = (sx, sy, sz) => new THREE.Vector3(sx, sy, sz);
  const T = (px, py, pz, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => new THREE.Matrix4().compose(S(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), S(sx, sy, sz));
  const tan = [0.78, 0.55, 0.3], brown = [0.42, 0.25, 0.12], dark = [0.05, 0.04, 0.04], cream = [0.93, 0.85, 0.7];
  const b = new GeoBuilder();
  b.setColor([0.12, 0.12, 0.13]); b.addGeometry(new THREE.CylinderGeometry(0.03, 0.033, 0.008, 18), T(0, 0.004, 0)); // قاعدة لاصقة
  b.setColor(tan);
  b.addGeometry(new THREE.SphereGeometry(0.026, 14, 10), T(0, 0.034, -0.004, 1, 1.25, 1.1));        // الجسم (قاعد)
  b.addGeometry(new THREE.SphereGeometry(0.014, 10, 8), T(-0.016, 0.016, -0.012, 1, 0.8, 1.4));       // رجلين ورا
  b.addGeometry(new THREE.SphereGeometry(0.014, 10, 8), T(0.016, 0.016, -0.012, 1, 0.8, 1.4));
  for (const sx of [-1, 1]) b.addGeometry(new THREE.CylinderGeometry(0.006, 0.0065, 0.036, 8), T(sx * 0.011, 0.024, 0.016)); // رجلين قدام
  b.setColor(cream); b.addGeometry(new THREE.SphereGeometry(0.017, 10, 8), T(0, 0.042, 0.012, 1, 1.2, 0.7)); // صدر فاتح
  b.setColor(brown); b.addGeometry(new THREE.CylinderGeometry(0.003, 0.005, 0.03, 6), T(0, 0.022, -0.034, 1, 1, 1, -1.0));     // ديل
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  root.add(new THREE.Mesh(b.build(), bodyMat));
  // الراس: نقطة الارتكاز عند الرقبة
  const head = new THREE.Group(); head.position.set(0, 0.062, 0.004); root.add(head);
  const h = new GeoBuilder();
  h.setColor(tan); h.addGeometry(new THREE.SphereGeometry(0.024, 16, 12), T(0, 0.02, 0.004, 1.05, 0.95, 1));
  h.setColor(cream); h.addGeometry(new THREE.SphereGeometry(0.012, 12, 8), T(0, 0.012, 0.025, 1.1, 0.85, 1));   // البوز
  h.setColor(dark); h.addGeometry(new THREE.SphereGeometry(0.005, 8, 6), T(0, 0.017, 0.036));                // المناخير
  for (const sx of [-1, 1]) {
    h.setColor(dark); h.addGeometry(new THREE.SphereGeometry(0.0042, 8, 6), T(sx * 0.0095, 0.027, 0.022));    // العينين
    h.setColor(brown); h.addGeometry(new THREE.SphereGeometry(0.011, 10, 8), T(sx * 0.024, 0.016, 0.0, 0.45, 1.5, 0.9, 0, sx * 0.25)); // ودان مدلدلة
  }
  h.setColor([0.9, 0.35, 0.4]); h.addGeometry(new THREE.SphereGeometry(0.004, 6, 5), T(0, 0.004, 0.03, 1, 0.5, 1.2)); // لسان
  head.add(new THREE.Mesh(h.build(), bodyMat));
  group.add(root);
  return { root, head, st: { px: 0, vx: 0, pz: 0, vz: 0, py: 0, vy: 0 } };
}

/** هز الراس: سوستة + مخمّد (التسارع والميل والمطبات بيزقّوها) */
export function updateBobbles(list, dt, ph) {
  if (!list || !list.length) return;
  const h = Math.min(dt, 0.04), k = 260, c = 3.2;
  const ax = ph.accelLong || 0, al = ph.accelLat || 0, hv = ph.heaveVel || 0, v = Math.abs(ph.speed || 0);
  for (const d of list) {
    const s = d.st;
    // اهتزاز خفيف وهي ماشية (الموتور/الطريق)
    const jig = v > 0.5 ? Math.sin(performance.now() * 0.023) * Math.min(1, v / 8) * 3 : 0;
    s.vx += (-k * s.px - c * s.vx - ax * 2.2 + jig) * h; s.px += s.vx * h;           // لقدام/لورا (نودّ)
    s.vz += (-k * s.pz - c * s.vz + al * 2.2) * h; s.pz += s.vz * h;                  // يمين/شمال
    s.vy += (-k * 1.6 * s.py - c * s.vy - hv * 30) * h; s.py += s.vy * h;            // لفوق/لتحت (المطبات)
    s.px = Math.max(-0.7, Math.min(0.7, s.px)); s.pz = Math.max(-0.6, Math.min(0.6, s.pz)); s.py = Math.max(-0.25, Math.min(0.25, s.py));
    d.head.rotation.set(s.px + s.py, 0, s.pz);
  }
}
