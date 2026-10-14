import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex } from '../render/textures.js';

// حاجات التابلوه بتاعة الميكروباص المصري: سجادة التابلوه، علبة مناديل فرو، ماسك موبايل، صينية فكة،
// لافتة "ما شاء الله"، علم صغير، وعين زرقا متعلقة في المراية (بتتمرجح مع السبحة).
// كله خفيف: 6 draw calls تقريبًا.

const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function dashMatTexture() {
  const c = canvas(512, 256), x = c.getContext('2d'), r = rng(7);
  x.fillStyle = '#5a0f14'; x.fillRect(0, 0, 512, 256);
  // نقشة سجاد: معينات وإطار دهبي
  x.strokeStyle = '#c99a3a'; x.lineWidth = 6; x.strokeRect(10, 10, 492, 236);
  x.strokeStyle = '#1d3a5a'; x.lineWidth = 3; x.strokeRect(22, 22, 468, 212);
  for (let i = 0; i < 9; i++) {
    const cx = 52 + i * 51, cy = 128;
    x.fillStyle = i % 2 ? '#c99a3a' : '#2a5a7a';
    x.beginPath(); x.moveTo(cx, cy - 40); x.lineTo(cx + 22, cy); x.lineTo(cx, cy + 40); x.lineTo(cx - 22, cy); x.closePath(); x.fill();
    x.fillStyle = '#7a1a20'; x.beginPath(); x.arc(cx, cy, 7, 0, Math.PI * 2); x.fill();
  }
  // زغب + بهتان من الشمس + بقع قديمة (الاستهلاك)
  for (let i = 0; i < 5000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,220,200' : '20,0,0'},${0.05 + r() * 0.08})`; x.fillRect(r() * 512, r() * 256, 1.5, 1.5); }
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(255,230,190,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 6; i++) { x.fillStyle = `rgba(30,10,5,${0.12 + r() * 0.1})`; x.beginPath(); x.ellipse(r() * 512, r() * 256, 10 + r() * 30, 6 + r() * 14, r() * 3, 0, Math.PI * 2); x.fill(); }
  return tex(c, { repeat: false });
}

function furTexture(base) {
  const c = canvas(128, 128), x = c.getContext('2d'), r = rng(3);
  x.fillStyle = base; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) { x.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '60,0,40'},${0.12 + r() * 0.2})`; x.lineWidth = 1; const px = r() * 128, py = r() * 128, a = r() * 6.28; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 4, py + Math.sin(a) * 4); x.stroke(); }
  return tex(c);
}

function phoneScreen() {
  const c = canvas(128, 256), x = c.getContext('2d');
  x.fillStyle = '#e9e5da'; x.fillRect(0, 0, 128, 256);
  x.strokeStyle = '#ffffff'; x.lineWidth = 12; x.beginPath(); x.moveTo(20, 256); x.lineTo(60, 150); x.lineTo(60, 60); x.lineTo(120, 10); x.stroke();
  x.strokeStyle = '#f5c04a'; x.lineWidth = 6; x.beginPath(); x.moveTo(0, 120); x.lineTo(128, 110); x.stroke();
  x.strokeStyle = '#3a8af0'; x.lineWidth = 7; x.beginPath(); x.moveTo(20, 256); x.lineTo(60, 150); x.lineTo(60, 60); x.stroke();
  x.fillStyle = '#1a73e8'; x.beginPath(); x.moveTo(52, 190); x.lineTo(64, 166); x.lineTo(76, 190); x.closePath(); x.fill();
  x.fillStyle = '#0f5c38'; x.fillRect(0, 0, 128, 40);
  x.fillStyle = '#fff'; x.font = 'bold 18px Cairo, sans-serif'; x.textAlign = 'center'; x.fillText('↰ 300 م', 64, 27);
  return tex(c, { repeat: false });
}

function textPlate(text, w, h, bg, fg, font) {
  const c = canvas(w, h), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.strokeStyle = fg; x.lineWidth = 4; x.strokeRect(5, 5, w - 10, h - 10);
  x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.fillText(text, w / 2, h / 2 + 4);
  return tex(c, { repeat: false });
}

function eyeCharmTexture() {
  const c = canvas(64, 64), x = c.getContext('2d');
  for (const [r, col] of [[31, '#0b3fa8'], [22, '#ffffff'], [15, '#5ab4ff'], [8, '#0a0a14']]) { x.fillStyle = col; x.beginPath(); x.arc(32, 32, r, 0, Math.PI * 2); x.fill(); }
  return tex(c, { repeat: false });
}

/**
 * P: مقاسات الكابينة من buildHiaceInterior
 * { DX, IW, dashTop, dashBackF, wbF, wbY, wtF, wtY, floorY, z }
 * بترجع hangers: حاجات متعلقة بتتمرجح (بندول) — { obj, L }
 */
export function addCabAccessories(group, P) {
  const { DX, IW, dashTop, dashBackF, wbF, wbY, wtF, wtY, z } = P;
  const hangers = [];
  // ===== سجادة التابلوه (بشرّابة دهبي على الحرف) =====
  const backF = dashBackF + 0.1, frontF = wbF - 0.07;
  const depth = frontF - backF;
  const matY = (f) => dashTop + 0.006 + ((f - backF) / depth) * (wbY - 0.03 - dashTop);
  const slope = Math.atan2(wbY - 0.03 - dashTop, depth);
  {
    const w = 2 * IW - 0.12;
    const g = new THREE.PlaneGeometry(w, depth).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: dashMatTexture(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(g, mat);
    m.position.set(0, matY((backF + frontF) / 2), z((backF + frontF) / 2));
    m.rotation.x = -slope; // نفس ميل التابلوه
    m.receiveShadow = true;
    group.add(m);
  }
  const deco = new GeoBuilder();
  // شرّابة على حرف السجادة ناحية السواق
  for (let x = -IW + 0.08; x < IW - 0.07; x += 0.028) {
    deco.setColor(Math.round(x * 36) % 2 ? [0.82, 0.62, 0.2] : [0.55, 0.08, 0.1]);
    deco.addGeometry(new THREE.CylinderGeometry(0.003, 0.006, 0.035, 4), M4(x, dashTop - 0.012, z(backF - 0.012), -0.25));
  }
  // ===== ماسك موبايل + موبايل (خريطة شغالة) =====
  const phX = -0.05, phF = backF + 0.06, phY = matY(phF);
  deco.setColor([0.08, 0.08, 0.09]);
  deco.addGeometry(new THREE.CylinderGeometry(0.02, 0.026, 0.01, 12), M4(phX, phY + 0.005, z(phF)));
  deco.addGeometry(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6), M4(phX, phY + 0.04, z(phF), 0.35));
  const phone = new THREE.Group();
  phone.position.set(phX, phY + 0.11, z(phF) + 0.02);
  phone.rotation.set(-0.3, 0.35, 0, 'YXZ'); // متوجه ناحية السواق
  phone.add(new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.152, 0.01, 2, 0.006), new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.4 })));
  const scr = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: phoneScreen(), emissiveIntensity: 0.55, roughness: 0.15 });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.14), scr); s.position.z = 0.0052; phone.add(s);
  deco.setColor([0.1, 0.1, 0.1]);
  deco.addGeometry(new THREE.BoxGeometry(0.09, 0.012, 0.02), M4(phX, phY + 0.035 + 0.006, z(phF) + 0.016, -0.3, 0.35));
  group.add(phone);
  // ===== صينية الفكة (عملات + فلوس ورق) =====
  const tX = 0.2, tF = backF + 0.08, tY = matY(tF);
  deco.setColor([0.12, 0.12, 0.13]);
  deco.addGeometry(new THREE.BoxGeometry(0.16, 0.012, 0.1), M4(tX, tY + 0.006, z(tF)));
  for (const [sx, sz] of [[-1, 0], [1, 0]]) deco.addGeometry(new THREE.BoxGeometry(0.004, 0.025, 0.1), M4(tX + sx * 0.08, tY + 0.014, z(tF) + sz));
  for (const sz of [-1, 1]) deco.addGeometry(new THREE.BoxGeometry(0.16, 0.025, 0.004), M4(tX, tY + 0.014, z(tF) + sz * 0.05));
  const r = rng(11);
  for (let i = 0; i < 14; i++) {
    deco.setColor(r() < 0.5 ? [0.78, 0.66, 0.35] : [0.72, 0.72, 0.7]);
    deco.addGeometry(new THREE.CylinderGeometry(0.011, 0.011, 0.003, 10), M4(tX - 0.06 + r() * 0.12, tY + 0.014 + r() * 0.006, z(tF) - 0.035 + r() * 0.07, (r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4));
  }
  for (const [col, dx] of [[[0.55, 0.42, 0.62], -0.02], [[0.55, 0.7, 0.45], 0.03]]) {
    deco.setColor(col);
    deco.addGeometry(new THREE.BoxGeometry(0.07, 0.003, 0.035), M4(tX + dx, tY + 0.022, z(tF) + 0.02, 0, dx * 8, 0.08));
  }
  // ===== علبة مناديل بغطا فرو =====
  const bX = 0.5, bF = backF + 0.14, bY = matY(bF);
  const fur = new THREE.MeshStandardMaterial({ map: furTexture('#c2457a'), roughness: 1 });
  const tb = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.095, 0.13, 3, 0.03), fur);
  tb.position.set(bX, bY + 0.05, z(bF)); tb.rotation.y = -0.12; group.add(tb);
  deco.setColor([0.97, 0.97, 0.95]);
  deco.addGeometry(new THREE.SphereGeometry(0.035, 8, 6).scale(1, 0.55, 0.45), M4(bX, bY + 0.105, z(bF), 0, -0.12, 0.3));
  // ===== علم مصر صغير =====
  const fX = IW - 0.12, fF = frontF - 0.06, fY = matY(fF);
  deco.setColor([0.1, 0.1, 0.1]);
  deco.addGeometry(new THREE.CylinderGeometry(0.003, 0.003, 0.17, 5), M4(fX, fY + 0.085, z(fF)));
  deco.addGeometry(new THREE.CylinderGeometry(0.015, 0.018, 0.012, 10), M4(fX, fY + 0.006, z(fF)));
  for (const [col, i] of [[[0.8, 0.07, 0.1], 0], [[0.95, 0.95, 0.95], 1], [[0.05, 0.05, 0.05], 2]]) {
    deco.setColor(col);
    deco.addGeometry(new THREE.BoxGeometry(0.1, 0.022, 0.002), M4(fX - 0.05, fY + 0.16 - i * 0.022, z(fF), 0, 0.4, 0));
  }
  // ===== لافتة "ما شاء الله" =====
  {
    const t = textPlate('ما شاء الله', 256, 72, '#0e5a3a', '#e8c25a', 'bold 40px "Aref Ruqaa", Cairo, serif');
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.048), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, side: THREE.DoubleSide }));
    const pF = frontF - 0.1;
    pl.position.set(0.34, matY(pF) + 0.03, z(pF)); pl.rotation.set(-0.15, -0.15, 0, 'YXZ');
    group.add(pl);
    deco.setColor([0.75, 0.6, 0.25]);
    deco.addGeometry(new THREE.BoxGeometry(0.18, 0.008, 0.03), M4(0.34, matY(pF) + 0.004, z(pF) - 0.005, 0, -0.15, 0));
  }
  group.add(new THREE.Mesh(deco.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 })));

  // ===== عين زرقا (نَظَر) متعلقة في المراية — بندول أقصر من السبحة =====
  {
    const charm = new THREE.Group();
    charm.position.set(0.07, wtY - 0.162, z(wtF - 0.045));
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
    hangers.push({ obj: charm, L: L + 0.02 });
  }
  return { hangers, phoneScreen: scr };
}
