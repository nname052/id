// =====================================================================
//  أعمال طرق: كام موقع شغل (كوانز + حواجز + كوم رمل + علامة تحذير) على الطرق الرئيسية بجنب الرصيف.
//  الأماكن بتتختار من الشبكة الحقيقية بشكل ثابت (نفس الأماكن كل مرة) — "ديكور حيّ" مش مواقع حقيقية.
//  بتظهر بس لما تقرّب منها، وارتفاعها بيتظبط من الأرض بعد ما المربع يتحمّل.
// =====================================================================
import * as THREE from 'three';
import { edgePoint } from './ShibinData.js';
import { groundHeight } from '../ground.js';

const OK = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
const SHOW_R = 230;

function hash(n) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }

// (emissive خفيف عشان الألوان الفاقعة متبقاش سودا في الضل)
const mat = (c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.38 });

export function buildWorks(world, { max = 36 } = {}) {
  const G = world.graph;
  const orange = mat(0xf26a1b);
  const white = mat(0xf2f2ee);
  const sand = mat(0x9a8260);
  const yellow = mat(0xf2c200);
  const dark = mat(0x2b2b2b);
  const coneG = new THREE.ConeGeometry(0.17, 0.62, 7).translate(0, 0.31, 0);
  const baseG = new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.02, 0);
  const stripeG = new THREE.CylinderGeometry(0.105, 0.125, 0.08, 7).translate(0, 0.33, 0);
  const barG = new THREE.BoxGeometry(2.0, 0.14, 0.06);
  const legG = new THREE.BoxGeometry(0.06, 0.9, 0.06).translate(0, 0.45, 0);
  const moundG = new THREE.ConeGeometry(1.6, 0.9, 8).translate(0, 0.45, 0).scale(1, 1, 0.8);
  const signG = new THREE.BoxGeometry(0.8, 0.8, 0.04).translate(0, 1.6, 0);
  const postG = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 5).translate(0, 0.6, 0);

  const root = new THREE.Group(); root.name = 'works';
  const zones = [];
  let n = 0;
  for (const e of G.edges) {
    if (n >= max) break;
    if (!OK.has(e.cls) || e.bridge || e.elevated || e.tunnel || e.closed || e.length < 90 || e.width < 7) continue;
    if (hash(e.id * 7 + 3) > 0.11) continue;
    const s = e.length * (0.35 + hash(e.id) * 0.3);
    const p = edgePoint(e, s);
    const g = new THREE.Group();
    const side = hash(e.id + 11) > 0.5 ? 1 : -1;
    const yaw = Math.atan2(p.dx, p.dz); // محور z المحلي = اتجاه الطريق
    const lat = e.half - 0.75;
    const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m; };
    // كوانز بامتداد 16م + تضييق (taper) في الأول
    for (let i = 0; i <= 8; i++) {
      const z = -8 + i * 2, x = side * (lat - (i < 3 ? (3 - i) * 0.45 : 0));
      add(coneG, orange, x, 0, z); add(baseG, dark, x, 0, z); add(stripeG, white, x, 0, z);
    }
    // حواجز خشب مقلمة قدام الحفرة + كوم رمل + علامة
    for (const z of [-2.2, 2.2]) {
      const x = side * (lat - 0.6);
      add(barG, yellow, x, 0.75, z, Math.PI / 2); add(legG, dark, x, 0, z - 0.9); add(legG, dark, x, 0, z + 0.9);
    }
    add(moundG, sand, side * (lat - 1.2), 0, 0);
    add(postG, dark, side * (lat + 0.2), 0, -9.5); add(signG, yellow, side * (lat + 0.2), 0, -9.5);
    g.rotation.y = yaw; // الـ x المحلي = عرضي على الطريق
    g.position.set(p.x, -9999, p.z); g.visible = false; g.matrixAutoUpdate = true;
    g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    root.add(g);
    zones.push({ g, x: p.x, z: p.z, placed: false });
    n++;
  }
  let t = 0;
  root.userData.update = (dt, px, pz) => {
    t -= dt; if (t > 0) return; t = 0.5;
    for (const z of zones) {
      const d2 = (z.x - px) ** 2 + (z.z - pz) ** 2, near = d2 < SHOW_R * SHOW_R;
      if (near && !z.placed) {
        const y = groundHeight(z.x, z.z);
        if (Number.isFinite(y)) { z.g.position.y = y; z.placed = true; }
      }
      z.g.visible = near && z.placed;
    }
  };
  root.userData.count = zones.length;
  return root;
}
