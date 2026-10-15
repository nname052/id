import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex, fitFont } from '../render/textures.js';
import { ROAD } from './layout.js';

// كوبري مشاة فوق الشارع الرئيسي (زي كباري المشاة الزرقا في مصر): عمدان على الرصيف وفي الجزيرة،
// سلم من كل ناحية نازل على الرصيف، سور حديد أزرق، ويافطة إعلان على الجنب. بيرجّع { group, colliders }
export function buildFootbridge(z = -92) {
  const g = new GeoBuilder(), cols = [];
  const H = 5.7, W = 2.4, X = ROAD.sidewalkOuter - 1.0; // نهاية الكوبري فوق الرصيف
  const z0 = z - W / 2, z1 = z + W / 2;
  const blue = [0.12, 0.36, 0.66], conc = [0.72, 0.7, 0.66];
  // البلاطة
  g.setColor(conc); g.box(-X - 1.1, H - 0.35, z0, X + 1.1, H, z1);
  // السور (قوائم + درابزين) على الجنبين
  g.setColor(blue);
  for (const zz of [z0, z1 - 0.06]) {
    g.box(-X - 1.1, H + 1.05, zz, X + 1.1, H + 1.12, zz + 0.06);
    g.box(-X - 1.1, H + 0.5, zz, X + 1.1, H + 0.55, zz + 0.06);
    for (let x = -X - 1.1; x <= X + 1.1; x += 0.6) g.box(x, H, zz, x + 0.05, H + 1.12, zz + 0.06);
  }
  // سقف خفيف
  g.setColor([0.85, 0.85, 0.82]); g.box(-X - 1.1, H + 2.3, z0 - 0.2, X + 1.1, H + 2.38, z1 + 0.2);
  for (let x = -X; x <= X; x += 4) for (const zz of [z0, z1 - 0.08]) { g.setColor(blue); g.box(x, H + 1.12, zz, x + 0.08, H + 2.3, zz + 0.08); }
  // العمدان: على الرصيفين وفي الجزيرة
  for (const x of [-X, 0, X]) {
    g.setColor(conc); g.box(x - 0.3, 0, z - 0.3, x + 0.3, H - 0.35, z + 0.3);
    cols.push({ cx: x, cz: z, hx: 0.32, hz: 0.32, angle: 0, restitution: 0.1, kind: 'pole' });
  }
  // السلالم: نازلة على الرصيف ناحية +z (جنب الواجهات)
  for (const sx of [-1, 1]) {
    const x0 = sx * (X - 0.9), x1 = sx * (X + 0.9), lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const n = 22, run = 10.5, y0 = ROAD.sidewalkHeight;
    for (let k = 0; k < n; k++) {
      const yy = y0 + (H - y0) * (1 - (k + 1) / n), za = z1 + (k * run) / n, zb = z1 + ((k + 1) * run) / n;
      g.setColor(k % 2 ? conc : [0.66, 0.64, 0.6]);
      g.box(lo, yy - 0.12, za, hi, yy + (H - y0) / n, zb);
    }
    // درابزين السلم
    g.setColor(blue);
    for (const xx of [lo, hi - 0.05]) for (let k = 0; k <= n; k += 2) { const zz = z1 + (k * run) / n, yy = y0 + (H - y0) * (1 - k / n); g.box(xx, yy, zz, xx + 0.05, yy + 1.0, zz + 0.05); }
    // تحت السلم: حيطة (عشان مايبانش طاير) + جسم تصادم
    g.setColor(conc); g.box(lo + 0.2, 0, z1 + run * 0.55, hi - 0.2, y0 + (H - y0) * 0.4, z1 + run * 0.6);
    cols.push({ cx: (lo + hi) / 2, cz: z1 + run / 2, hx: (hi - lo) / 2, hz: run / 2, angle: 0, restitution: 0.1, kind: 'wall' });
  }
  const group = new THREE.Group(); group.name = 'footbridge';
  const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 }));
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  // يافطة على جنب الكوبري (من الناحيتين)
  const c = canvas(1024, 160), x = c.getContext('2d');
  x.fillStyle = '#0f3d6e'; x.fillRect(0, 0, 1024, 160);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  fitFont(x, 'كوبري مشاة — عدّي من فوق وحافظ على حياتك', 980, 64); x.fillText('كوبري مشاة — عدّي من فوق وحافظ على حياتك', 512, 84);
  const t = tex(c, { repeat: false });
  for (const sz of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.1), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
    p.position.set(0, H - 0.2 - 1.05 + 0.3, z + sz * (W / 2 + 0.02)); if (sz < 0) p.rotation.y = Math.PI;
    p.position.y = H + 0.55;
    group.add(p);
  }
  return { group, colliders: cols };
}
