// =====================================================================
//  البنزينة: على طريق الترعة (ناحية اليمين للي رايح من وسط البلد لشبين)، مظلة بعمدان، جزيرتين طلمبات،
//  ماركت صغير، ويافطة أسعار عالية. كلها Mesh واحد بألوان (vertex colors) + يافطتين → 4 draw calls.
//  التفويل: تقف في حارة جنب طلمبة (العربية واقفة) → كارت التفويل يظهر.
// =====================================================================
import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex } from '../render/textures.js';
import { groundHeight } from './ground.js';

const PAD_Y = -0.47;
export const STATION = {
  name: 'بنزينة الترعة',
  pad: { x0: 128, x1: 172, z0: 10, z1: 40 },
  canopy: { x0: 137, x1: 163, z0: 13.5, z1: 30.5, h: 5.0 },
  islands: [18, 26],                 // z لكل جزيرة طلمبات
  pumpsX: [144, 150, 156],
  lanes: [14, 22, 30],               // z لنص كل حارة تفويل
  nav: { x: 150, z: 22, name: 'بنزينة الترعة' },
  y: PAD_Y,
};

/** العربية واقفة في حارة تفويل؟ (x,z = نص العربية) */
export function atPump(x, z) {
  if (x < 139 || x > 161) return false;
  return STATION.lanes.some((lz) => Math.abs(z - lz) < 2.4);
}

function signTex(text, w, h, bg, fg, sub) {
  const c = canvas(w, h), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = '#f5c400'; x.fillRect(0, h - h * 0.12, w, h * 0.12);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.font = `bold ${Math.round(h * 0.52)}px Cairo, sans-serif`;
  x.fillText(text, w / 2, h * (sub ? 0.36 : 0.46));
  if (sub) { x.font = `bold ${Math.round(h * 0.22)}px Cairo, sans-serif`; x.fillText(sub, w / 2, h * 0.72); }
  const t = tex(c, { repeat: false }); t.anisotropy = 4;
  return t;
}

function priceTex() {
  const c = canvas(256, 384), x = c.getContext('2d');
  x.fillStyle = '#0b5e33'; x.fillRect(0, 0, 256, 384);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.font = 'bold 54px Cairo, sans-serif'; x.fillText('⛽ بنزين', 128, 52);
  const rows = [['بنزين ٨٠', '17.75'], ['بنزين ٩٢', '19.25'], ['سولار', '17.50']];
  rows.forEach(([n, p], i) => {
    const y = 140 + i * 82;
    x.fillStyle = '#111'; x.fillRect(16, y - 32, 224, 64);
    x.fillStyle = '#fff'; x.font = 'bold 26px Cairo, sans-serif'; x.textAlign = 'right'; x.fillText(n, 228, y);
    x.fillStyle = '#ffb000'; x.font = 'bold 30px monospace'; x.textAlign = 'left'; x.direction = 'ltr'; x.fillText(p, 26, y + 2); x.direction = 'rtl';
  });
  return tex(c, { repeat: false });
}

export function buildPetrolStation(scene) {
  const S = STATION, g = new GeoBuilder(), y = PAD_Y;
  const box = (col, x0, y0, z0, x1, y1, z1) => { g.setColor(col); g.box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)); };
  // الأرضية + المدخل والمخرج (بيمشوا مع ميل الأرض لحد حرف الطريق)
  box([0.36, 0.36, 0.37], S.pad.x0, y - 0.05, S.pad.z0, S.pad.x1, y, S.pad.z1);
  for (const [xa, xb] of [[130, 139], [161, 170]]) {
    g.setColor([0.33, 0.33, 0.34]);
    for (let z = 2.4; z < S.pad.z0; z += 1) {
      const h = (xx, zz) => groundHeight(xx, zz) + 0.035;
      g.quad([xa, h(xa, z + 1), z + 1], [xb, h(xb, z + 1), z + 1], [xb, h(xb, z), z], [xa, h(xa, z), z]);
    }
  }
  // خطوط الحارات
  for (const lz of S.lanes) for (let x = 139; x < 161; x += 3) box([0.92, 0.92, 0.88], x, y + 0.002, lz - 0.06, x + 1.6, y + 0.006, lz + 0.06);
  // الجزر + الطلمبات
  for (const iz of S.islands) {
    box([0.78, 0.77, 0.74], 139, y, iz - 0.7, 161, y + 0.18, iz + 0.7);
    for (const ex of [139, 160.4]) box([0.95, 0.8, 0.1], ex, y + 0.181, iz - 0.7, ex + 0.6, y + 0.185, iz + 0.7);
    for (const px of S.pumpsX) {
      box([0.94, 0.94, 0.92], px - 0.45, y + 0.18, iz - 0.3, px + 0.45, y + 1.95, iz + 0.3);
      box([0.1, 0.55, 0.25], px - 0.47, y + 1.95, iz - 0.32, px + 0.47, y + 2.15, iz + 0.32);
      for (const sz of [-1, 1]) {
        box([0.06, 0.08, 0.1], px - 0.3, y + 1.35, iz + sz * 0.302, px + 0.3, y + 1.75, iz + sz * 0.304); // الشاشة
        box([0.12, 0.12, 0.12], px - 0.38, y + 0.7, iz + sz * 0.3, px - 0.26, y + 1.1, iz + sz * 0.38); // المسدس
      }
    }
    // العمدان
    for (const cx of [141.5, 158.5]) box([0.85, 0.85, 0.83], cx - 0.22, y + 0.18, iz - 0.22, cx + 0.22, y + S.canopy.h, iz + 0.22);
  }
  // المظلة: سقف + حرف أخضر وأصفر
  const C = S.canopy, cy = y + C.h;
  box([0.95, 0.95, 0.94], C.x0, cy, C.z0, C.x1, cy + 0.5, C.z1);
  box([0.04, 0.48, 0.24], C.x0 - 0.05, cy + 0.08, C.z0 - 0.05, C.x1 + 0.05, cy + 0.62, C.z0 + 0.05);
  box([0.04, 0.48, 0.24], C.x0 - 0.05, cy + 0.08, C.z1 - 0.05, C.x1 + 0.05, cy + 0.62, C.z1 + 0.05);
  box([0.04, 0.48, 0.24], C.x0 - 0.05, cy + 0.08, C.z0, C.x0 + 0.05, cy + 0.62, C.z1);
  box([0.04, 0.48, 0.24], C.x1 - 0.05, cy + 0.08, C.z0, C.x1 + 0.05, cy + 0.62, C.z1);
  box([0.96, 0.78, 0.06], C.x0 - 0.06, cy + 0.02, C.z0 - 0.06, C.x1 + 0.06, cy + 0.1, C.z1 + 0.06);
  // الماركت
  box([0.86, 0.8, 0.68], 162, y, 32, 172, y + 3.6, 40);
  box([0.18, 0.28, 0.36], 161.98, y + 0.3, 33, 162, y + 2.6, 39); // واجهة إزاز
  box([0.04, 0.48, 0.24], 161.9, y + 2.8, 32, 162, y + 3.5, 40);
  // يافطة الأسعار (عمود)
  box([0.3, 0.3, 0.32], 125.8, y, 5.8, 126.2, y + 6.2, 6.2);
  const mesh = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  const root = new THREE.Group(); root.name = 'petrol-station';
  root.add(mesh);
  // نور المظلة من تحت (بيبان بالليل) — من غير لمبة حقيقية
  const under = new THREE.Mesh(new THREE.PlaneGeometry(C.x1 - C.x0 - 1, C.z1 - C.z0 - 1).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf4f4ee }));
  under.position.set((C.x0 + C.x1) / 2, cy - 0.01, (C.z0 + C.z1) / 2);
  root.add(under);
  root.userData.under = under;
  // يافطة الاسم على حرف المظلة اللي ناحية الطريق + يافطة الأسعار بوشين
  const nameMat = new THREE.MeshBasicMaterial({ map: signTex(S.name, 1024, 128, '#0b7a3b', '#ffffff') });
  const nm = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.75), nameMat);
  nm.position.set((C.x0 + C.x1) / 2, cy + 0.36, C.z0 - 0.09); nm.rotation.y = Math.PI;
  root.add(nm);
  const pm = new THREE.MeshBasicMaterial({ map: priceTex(), side: THREE.DoubleSide });
  const pp = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 3.0), pm);
  pp.position.set(126, y + 4.6, 6); pp.rotation.y = Math.PI / 2;
  root.add(pp);
  scene.add(root);
  // الكولايدرز (العمدان، الطلمبات على الجزر، الماركت، عمود اليافطة)
  const cols = [];
  for (const iz of S.islands) cols.push({ cx: 150, cz: iz, hx: 11, hz: 0.7, angle: 0, restitution: 0.05, kind: 'curb' });
  cols.push({ cx: 167, cz: 36, hx: 5, hz: 4, angle: 0, restitution: 0.1, kind: 'building' });
  cols.push({ cx: 126, cz: 6, hx: 0.25, hz: 0.25, angle: 0, restitution: 0.1, kind: 'pole' });
  return { root, colliders: cols, setNight(on) { under.material.color.setScalar(on ? 1.6 : 0.95); } };
}
