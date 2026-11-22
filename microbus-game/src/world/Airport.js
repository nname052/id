// =====================================================================
//  منطقة الطيران (STAGE 7): مطار صغير جنب المدينة (برّه حدود الخريطة — المدينة نفسها ماكبرتش).
//  ده مكان في اللعبة مش مطار حقيقي (الخرايط المضغوطة مافيهاش مطارات OSM) — اسمه مكتوب كده على اليافطة.
//  - ممر 2600 × 45م (اتجاهه شمال/جنوب: 36 / 18) بعلامات حقيقية: البيانو، الأرقام، خط النص المتقطع،
//    منطقة اللمس ونقطة التصويب، أنوار الحواف (بيضا) وأول الممر (خضرا) وآخره (حمرا)، PAPI (4 أنوار بتبيّن زاوية الاقتراب)
//  - ممر تاكسي موازي + 3 وصلات، ساحة طيارات، مبنى ركاب بإزاز، برج مراقبة، هنجر، 3 مهابط هليكوبتر (H)، كُم ريح
//  - كله مدموج: كام رسمة بس. الأرض رمل (y=0) — الفيزيا بتاخد ارتفاع المباني من boxes()
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvas, tex } from '../render/textures.js';

export const RWY = { len: 2600, w: 45 };

export class Airport {
  constructor(scene, W) {
    const [x0, z0, x1, z1] = W.region?.bbox_local || [-500, -500, 500, 500];
    // جنب المدينة من الشرق (~750م من آخرها)
    this.cx = x1 + 750; this.cz = (z0 + z1) / 2;
    this.group = new THREE.Group(); this.group.name = 'airport-zone';
    this.boxes = []; // [{cx, cz, hx, hz, h}] للتصادم والهبوط على الأسطح
    this.helipads = []; this.papi = [];
    this._build();
    scene.add(this.group);
    this.group.updateMatrixWorld(true);
    this.group.matrixWorldAutoUpdate = false;
  }

  /** بداية الممر (36: جاي من الجنوب ورايح شمال = -z) */
  runwayStart(dir = 1) { return { x: this.cx, z: this.cz + dir * (RWY.len / 2 - 60), yaw: dir > 0 ? 0 : Math.PI }; }
  /** نقطة اللمس (عتبة الممر من الناحية اللي جاي منها) */
  threshold(dir = 1) { return { x: this.cx, z: this.cz + dir * RWY.len / 2 }; }
  inside(x, z) { return Math.abs(x - this.cx) < 700 && Math.abs(z - this.cz) < RWY.len / 2 + 500; }

  _build() {
    const g = this.group, cx = this.cx, cz = this.cz, L = RWY.len, Wr = RWY.w;
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
    // ===== الأرض (رمل + تراب) =====
    const sandC = canvas(256, 256), sx = sandC.getContext('2d');
    sx.fillStyle = '#c6aa7c'; sx.fillRect(0, 0, 256, 256);
    let s = 3; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 3000; i++) { sx.fillStyle = `rgba(${R() < 0.5 ? '120,95,60' : '235,215,175'},${0.08 + R() * 0.12})`; sx.fillRect(R() * 256, R() * 256, 1 + R() * 4, 1 + R() * 3); }
    const sand = tex(sandC); sand.repeat.set(1400 / 24, (L + 1000) / 24);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, L + 1000, 8, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: sand, roughness: 1, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 3 }));
    ground.position.set(cx, -0.03, cz); ground.receiveShadow = true; ground.name = 'airport-ground'; g.add(ground);

    // ===== الأسفلت (الممر + التاكسي + الساحة) =====
    const asph = [];
    const rect = (x, z, w, d, y = 0) => asph.push(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, y, z));
    rect(cx, cz, Wr, L, 0.02);
    const tx = cx - 190; rect(tx, cz, 23, L - 200, 0.015);
    for (const k of [-1, 0, 1]) rect((cx + tx) / 2, cz + k * (L / 2 - 160), cx - tx, 23, 0.016);
    const ax = cx - 380, aw = 330, ad = 420; rect(ax, cz, aw, ad, 0.014);
    rect(tx - 20, cz, 40, 30, 0.015);
    const asphTex = (() => { const c = canvas(256, 256), x = c.getContext('2d'); x.fillStyle = '#4a4a4c'; x.fillRect(0, 0, 256, 256); let q = 9; const r = () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 5000; i++) { const v = 50 + r() * 50; x.fillStyle = `rgba(${v},${v},${v + 3},0.35)`; x.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2); } return tex(c); })();
    asphTex.repeat.set(1, 1);
    const ag = mergeGeometries(asph); { const p = ag.attributes.position, uv = ag.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 14, p.getZ(i) / 14); }
    const am = new THREE.Mesh(ag, new THREE.MeshStandardMaterial({ map: asphTex, roughness: 0.92, color: 0xd8d8d8, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    am.receiveShadow = true; am.name = 'airport-asphalt'; g.add(am);

    // ===== العلامات (أبيض/أصفر) =====
    const wht = [], yel = [];
    const mark = (arr, x, z, w, d) => arr.push(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, 0.035, z));
    for (let z = -L / 2 + 120; z < L / 2 - 120; z += 50) mark(wht, cx, cz + z + 15, 0.9, 30); // خط النص المتقطع
    for (const dir of [-1, 1]) {
      const zt = cz + dir * (L / 2 - 6);
      for (let k = -8; k <= 8; k++) if (Math.abs(k) > 1) mark(wht, cx + k * 2.4, zt - dir * 22, 1.6, 30); // البيانو
      mark(wht, cx, cz + dir * (L / 2 - 1), Wr, 1.5);
      for (const side of [-1, 1]) {
        mark(wht, cx + side * 9, cz + dir * (L / 2 - 400), 10, 45); // نقطة التصويب
        for (const dz of [150, 300, 450, 600]) for (let j = 0; j < (dz < 300 ? 3 : dz < 600 ? 2 : 1); j++) mark(wht, cx + side * (6 + j * 3), cz + dir * (L / 2 - dz - 50), 1.8, 22);
      }
      for (const side of [-1, 1]) mark(wht, cx + side * (Wr / 2 - 1), cz, 0.9, L - 20); // الحواف
    }
    mark(yel, tx, cz, 0.6, L - 220);
    for (const k of [-1, 0, 1]) mark(yel, (cx + tx) / 2, cz + k * (L / 2 - 160), cx - tx, 0.6);
    // مواقف الطيارات + المهابط
    for (let i = 0; i < 3; i++) mark(yel, ax + 60, cz - 120 + i * 120, 0.5, 70);
    const mk = (arr, mat) => { const m = new THREE.Mesh(mergeGeometries(arr), mat); m.receiveShadow = true; g.add(m); return m; };
    mk(wht, new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    mk(yel, new THREE.MeshStandardMaterial({ color: 0xe8c22a, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));

    // أرقام الممر (36 / 18) + مهابط H: خامة كتابة
    const label = (txt, w, d, x, z, rot) => {
      const c = canvas(256, 512), q = c.getContext('2d'); q.clearRect(0, 0, 256, 512); q.fillStyle = '#f2f2ee';
      q.font = 'bold 300px Arial'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText(txt, 128, 260);
      const t = tex(c); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      m.position.set(x, 0.04, z); m.rotation.y = rot; g.add(m);
    };
    label('36', 14, 28, cx, cz + L / 2 - 80, 0);
    label('18', 14, 28, cx, cz - L / 2 + 80, Math.PI);
    // مهابط الهليكوبتر: دايرة + H
    const hpC = canvas(256, 256), hq = hpC.getContext('2d');
    hq.fillStyle = '#3d3f44'; hq.beginPath(); hq.arc(128, 128, 126, 0, Math.PI * 2); hq.fill();
    hq.strokeStyle = '#f2f2ee'; hq.lineWidth = 12; hq.beginPath(); hq.arc(128, 128, 100, 0, Math.PI * 2); hq.stroke();
    hq.fillStyle = '#f2f2ee'; hq.font = 'bold 150px Arial'; hq.textAlign = 'center'; hq.textBaseline = 'middle'; hq.fillText('H', 128, 136);
    const hpT = tex(hpC);
    for (let i = 0; i < 3; i++) {
      const x = ax - 110, z = cz - 140 + i * 140;
      const m = new THREE.Mesh(new THREE.CircleGeometry(12, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: hpT, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      m.position.set(x, 0.045, z); m.receiveShadow = true; g.add(m);
      this.helipads.push({ x, z, name: `مهبط ${i + 1}` });
    }

    // ===== المباني (مدموجة): مبنى الركاب + البرج + الهنجر =====
    const box = (x, z, w, d, h, y0 = 0, collide = true) => { if (collide) this.boxes.push({ cx: x, cz: z, hx: w / 2, hz: d / 2, h: h + y0 }); return new THREE.BoxGeometry(w, h, d).translate(x, y0 + h / 2, z); };
    const term = [], glass = [], roof = [];
    const tX = ax - 230;
    term.push(box(tX, cz, 40, 240, 12));
    glass.push(new THREE.BoxGeometry(0.4, 7, 236).translate(tX + 20.1, 6, cz));
    roof.push(new THREE.BoxGeometry(46, 1.2, 248).translate(tX, 12.6, cz));
    // جسور الركاب (بوابات)
    for (let i = 0; i < 3; i++) term.push(box(tX + 40, cz - 120 + i * 120, 40, 4, 4, 4, false));
    // البرج
    const tw = [ax - 60, cz + 260];
    term.push(new THREE.CylinderGeometry(3.2, 4.2, 38, 16).translate(tw[0], 19, tw[1])); this.boxes.push({ cx: tw[0], cz: tw[1], hx: 4.5, hz: 4.5, h: 46 });
    glass.push(new THREE.CylinderGeometry(7, 6, 5, 16).translate(tw[0], 40.5, tw[1]));
    roof.push(new THREE.CylinderGeometry(7.6, 7.6, 1, 16).translate(tw[0], 43.5, tw[1]));
    // الهنجر
    const hg = [ax + 20, cz - 330];
    term.push(box(hg[0], hg[1], 80, 60, 20));
    roof.push(new THREE.CylinderGeometry(30, 30, 80, 20, 1, true, Math.PI, Math.PI).rotateZ(-Math.PI / 2).scale(1, 0.33, 1).translate(hg[0], 20, hg[1])); // (سقف مقوّس)
    const wallC = canvas(256, 128), wq = wallC.getContext('2d');
    wq.fillStyle = '#e8e2d6'; wq.fillRect(0, 0, 256, 128); for (let i = 0; i < 256; i += 8) { wq.fillStyle = 'rgba(0,0,0,0.06)'; wq.fillRect(i, 0, 2, 128); }
    const tm = new THREE.Mesh(mergeGeometries(term), new THREE.MeshStandardMaterial({ map: tex(wallC), roughness: 0.8 }));
    const gm = new THREE.Mesh(mergeGeometries(glass), new THREE.MeshStandardMaterial({ color: 0x5b7f98, roughness: 0.15, metalness: 0.6, emissive: 0x112233 }));
    const rm = new THREE.Mesh(mergeGeometries(roof), M(0x9aa0a6, { metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide }));
    for (const m of [tm, gm, rm]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    this.glassMat = gm.material;
    // يافطة: مكان في اللعبة (مش مطار حقيقي)
    {
      const c = canvas(1024, 160), q = c.getContext('2d'); q.fillStyle = '#123a5c'; q.fillRect(0, 0, 1024, 160);
      q.fillStyle = '#fff'; q.font = 'bold 70px Cairo, Arial'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.direction = 'rtl';
      q.fillText('منطقة الطيران — مطار اللعبة', 512, 82);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 9.4), new THREE.MeshBasicMaterial({ map: tex(c), toneMapped: false }));
      m.position.set(tX + 20.4, 9.5, cz); m.rotation.y = Math.PI / 2; g.add(m);
      const m2 = m.clone(); m2.position.set(tX - 20.4, 9.5, cz); m2.rotation.y = -Math.PI / 2; g.add(m2);
    }

    // ===== أنوار الممر (Instanced) =====
    const lightGeo = new THREE.BoxGeometry(0.5, 0.35, 0.5);
    const lights = [];
    for (let z = -L / 2; z <= L / 2; z += 60) for (const side of [-1, 1]) lights.push([cx + side * (Wr / 2 + 1.5), cz + z, 0xfff6e0]);
    for (const dir of [-1, 1]) for (let k = -10; k <= 10; k++) lights.push([cx + k * 2.2, cz + dir * (L / 2 + 1), dir > 0 ? 0x30ff70 : 0xff3030]);
    for (let z = -L / 2 + 120; z < L / 2 - 120; z += 30) lights.push([cx, cz + z, 0xfff6e0]);
    const lm = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lights.length);
    const mm = new THREE.Matrix4(), col = new THREE.Color();
    lights.forEach(([x, z, c], i) => { mm.makeTranslation(x, 0.2, z); lm.setMatrixAt(i, mm); lm.setColorAt(i, col.set(c)); });
    lm.name = 'runway-lights'; g.add(lm);
    // PAPI: 4 أنوار شمال الممر عند نقطة التصويب لكل اتجاه (أبيض = عالي، أحمر = واطي — 3° مظبوط = 2 أبيض و2 أحمر)
    for (const dir of [-1, 1]) {
      const zp = cz + dir * (L / 2 - 400), arr = [];
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
        m.position.set(cx - Wr / 2 - 15 - k * 9, 0.6, zp); g.add(m); arr.push(m);
      }
      this.papi.push({ dir, z: zp, x: cx - Wr / 2 - 25, lights: arr, ang: [3.5, 3.17, 2.83, 2.5] });
    }
    // كُم الريح (برتقاني وأبيض)
    {
      const P = [];
      P.push(new THREE.CylinderGeometry(0.12, 0.12, 8, 6).translate(0, 4, 0));
      const sock = new THREE.CylinderGeometry(0.5, 0.9, 5, 10, 1, true).rotateZ(Math.PI / 2).translate(2.6, 7.6, 0);
      const m1 = new THREE.Mesh(mergeGeometries([P[0]]), M(0xdddddd)); const m2 = new THREE.Mesh(sock, M(0xff7a1a, { side: THREE.DoubleSide }));
      for (const m of [m1, m2]) { m.position.set(cx + 60, 0, cz + L / 2 - 300); g.add(m); }
      m2.rotation.y = 0.6;
    }
  }

  /** PAPI: لون كل لمبة حسب زاوية الطيارة عن نقطة التصويب */
  updatePapi(px, py, pz) {
    for (const P of this.papi) {
      const d = (pz - P.z) * P.dir; // المسافة قبل نقطة التصويب (من ناحية الاقتراب)
      const ang = d > 20 ? Math.atan2(py, d) * 180 / Math.PI : 3;
      P.lights.forEach((m, k) => m.material.color.set(ang > P.ang[k] ? 0xffffff : 0xff2a2a));
    }
  }

  /** أعلى سطح (للهبوط/التصادم) عند النقطة */
  roofAt(x, z) {
    let h = 0;
    for (const b of this.boxes) if (Math.abs(x - b.cx) < b.hx && Math.abs(z - b.cz) < b.hz) h = Math.max(h, b.h);
    return h;
  }
}
