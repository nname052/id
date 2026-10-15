import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvas, tex, makeSeatFabric } from '../render/textures.js';

// =====================================================================
//  كبائن العربيات (من الصور المرجعية) — كل عربية ليها كابينة مختلفة:
//  - التاكسي: سيدان حديثة (عداد ديجيتال + شاشة نص فيها الخريطة + فتحات تكييف مدورة + دركسيون 3 أذرع)
//  - الميكروباص / التوكتوك: في نفس الملف (بتتبني على الريج بتاعهم)
//  الأجزاء اللي بتتحرك: الدركسيون/الجادون، العدادات، الفتيس، لمبات التابلوه — بتتحدّث من cockpit.update()
// =====================================================================

const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));

/** شكل جانبي (z,y) بيتسحب على عرض العربية (x من -w/2 لـ w/2) */
export function extrudeAcross(points, width, bevel = 0.012) {
  const shape = new THREE.Shape();
  points.forEach(([u, v], i) => (i ? shape.lineTo(u, v) : shape.moveTo(u, v)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i), v = p.getY(i), w = p.getZ(i); p.setXYZ(i, w - width / 2, v, u); }
  // التبديل بين محورين بيقلب اتجاه الوشوش → نعكس الترتيب
  const idx = g.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); }
  else { const arr = p.array; for (let i = 0; i < p.count; i += 3) for (let k = 0; k < 3; k++) { const t = arr[(i + 1) * 3 + k]; arr[(i + 1) * 3 + k] = arr[(i + 2) * 3 + k]; arr[(i + 2) * 3 + k] = t; } }
  g.computeVertexNormals();
  return g;
}

/** عمود (beam) من نقطة لنقطة بمقطع مستطيل مدوّر */
export function beam(a, b, w, t, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, A.distanceTo(B), t, 2, Math.min(w, t) * 0.4), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

/** شاشة بتترسم بـ canvas (عداد ديجيتال / شاشة نص) وبتتحدّث كام مرة في الثانية بس */
export class DashScreen {
  constructor(w, h, draw, { fps = 10, emissive = 1 } = {}) {
    this.c = canvas(w, h); this.x = this.c.getContext('2d');
    this.t = tex(this.c, { repeat: false });
    this.mat = new THREE.MeshStandardMaterial({ map: this.t, emissive: 0xffffff, emissiveMap: this.t, emissiveIntensity: emissive, roughness: 0.3, toneMapped: false });
    this.draw = draw; this.dt = 1 / fps; this.acc = 1;
  }
  update(dt, state) {
    this.acc += dt;
    if (this.acc < this.dt) return;
    this.acc = 0;
    this.draw(this.x, this.c.width, this.c.height, state);
    this.t.needsUpdate = true;
  }
}

function roundRectPath(x, a, b, w, h, r) { x.beginPath(); x.roundRect(a, b, w, h, r); }

function mats() {
  return {
    dashTop: new THREE.MeshStandardMaterial({ color: 0x232529, roughness: 0.82 }),
    dashLow: new THREE.MeshStandardMaterial({ color: 0x8e8e8b, roughness: 0.7 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.6 }),
    silver: new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.42, metalness: 0.8 }),
    headliner: new THREE.MeshStandardMaterial({ color: 0xbdbab2, roughness: 0.95 }),
    pillar: new THREE.MeshStandardMaterial({ color: 0xa9a7a1, roughness: 0.9 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.55 }),
    seat: new THREE.MeshStandardMaterial({ map: makeSeatFabric(), color: 0x8c8c8c, roughness: 0.95 }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 1 }),
    vent: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.8 }),
    button: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.5, emissive: 0x2a6cff, emissiveIntensity: 0 }),
    mirrorBack: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6 }),
  };
}

// ===== التاكسي (صورة 1): عداد ديجيتال + شاشة خريطة =====
function drawTaxiCluster(x, W, H, s) {
  x.fillStyle = '#05070a'; x.fillRect(0, 0, W, H);
  // إطار مدوّر بلون سماوي
  x.strokeStyle = '#2bd4e8'; x.lineWidth = 4; roundRectPath(x, 6, 6, W - 12, H - 12, 34); x.stroke();
  // عمود الباور (يسار) والإيكو (يمين)
  const bar = (bx, val, label, col) => {
    x.strokeStyle = 'rgba(43,212,232,0.5)'; x.lineWidth = 3; roundRectPath(x, bx, 40, 46, H - 80, 12); x.stroke();
    const n = 12;
    for (let i = 0; i < n; i++) { x.fillStyle = i / n < val ? col : 'rgba(43,212,232,0.12)'; x.fillRect(bx + 8, H - 50 - i * ((H - 100) / n), 30, (H - 100) / n - 4); }
    x.save(); x.translate(bx - 10, H / 2); x.rotate(-Math.PI / 2); x.fillStyle = '#e8c33a'; x.font = 'bold 18px Arial'; x.textAlign = 'center'; x.fillText(label, 0, 0); x.restore();
  };
  bar(40, s.throttle, 'POWER', '#2bd4e8');
  bar(W - 86, 1 - s.throttle * 0.8, 'ECO', '#38e08a');
  // الدايرة اللي في النص: السرعة كبيرة + الفتيس
  const cx = W / 2, cy = H / 2;
  x.strokeStyle = 'rgba(43,212,232,0.35)'; x.lineWidth = 10; x.beginPath(); x.arc(cx, cy, H * 0.38, 0.75 * Math.PI, 2.25 * Math.PI); x.stroke();
  x.strokeStyle = '#2bd4e8'; x.lineWidth = 10; x.beginPath(); x.arc(cx, cy, H * 0.38, 0.75 * Math.PI, 0.75 * Math.PI + 1.5 * Math.PI * Math.min(1, s.kmh / 180)); x.stroke();
  x.fillStyle = '#ffffff'; x.font = `bold ${Math.round(H * 0.3)}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(Math.round(s.kmh)), cx, cy + 4);
  x.font = 'bold 26px Arial'; x.fillStyle = '#9fe9f2'; x.fillText(s.gear, cx - H * 0.3, cy - H * 0.05);
  x.font = '16px Arial'; x.fillStyle = '#6fb6c0'; x.fillText('km/h', cx, cy + H * 0.2);
  // بنزين (تحت يمين) + لمبات
  x.fillStyle = s.fuel < 0.15 ? '#ff9a1a' : '#6fb6c0'; x.font = 'bold 16px Arial'; x.fillText(`⛽ ${Math.round(s.fuel * 100)}%`, cx + H * 0.33, cy + H * 0.33);
  if (s.lights) { x.fillStyle = '#38e08a'; x.fillText('◖≡', cx - H * 0.33, cy + H * 0.33); }
  if (s.hb) { x.fillStyle = '#ff4a3a'; x.fillText('(P)', cx, cy + H * 0.36); }
}

function drawTaxiCenter(x, W, H, s) {
  // شاشة النص: الخريطة (من الميني ماب) + اسم الراكب والمسافة
  x.fillStyle = '#0b0d10'; x.fillRect(0, 0, W, H);
  if (s.mapCanvas && s.mapCanvas.width) {
    try { x.drawImage(s.mapCanvas, 0, 0, s.mapCanvas.width, s.mapCanvas.height, 0, 0, W, H - 40); } catch { /* */ }
  }
  x.fillStyle = 'rgba(0,0,0,0.65)'; x.fillRect(0, 0, W, 36);
  x.fillStyle = '#fff'; x.font = 'bold 20px Cairo, Arial'; x.textAlign = 'right'; x.direction = 'rtl'; x.textBaseline = 'middle';
  x.fillText(s.navTitle || 'تاكسي شبين', W - 12, 19);
  x.textAlign = 'left'; x.direction = 'ltr'; x.font = '16px Arial'; x.fillStyle = '#cfd6dc'; x.fillText(s.clock || '', 10, 19);
  x.fillStyle = '#e8711a'; x.fillRect(0, H - 40, W, 40);
  x.fillStyle = '#fff'; x.font = 'bold 20px Cairo, Arial'; x.textAlign = 'center'; x.direction = 'rtl';
  x.fillText(s.navLine || 'مستني راكب', W / 2, H - 20);
}

/**
 * كابينة التاكسي. rig: الريج (فيه shell). بيرجّع { steering, eye, cockpit, mirrors[] }
 * المقاسات على السيدان (SEDAN): الزجاج الأمامي من z=-0.93 (y=0.915) لحد السقف z=-0.08 (y=1.44)
 */
export function buildTaxiCockpit(rig, { mirrorFace }) {
  const S = rig.shell, m = mats();
  const g = new THREE.Group(); g.name = 'taxi-cockpit';
  S.add(g);
  const add = (geo, mat, mtx, shadow = false) => { const o = new THREE.Mesh(geo, mat); if (mtx) o.applyMatrix4(mtx); o.receiveShadow = true; o.castShadow = shadow; g.add(o); return o; };
  const W = 1.6;
  // التابلوه: سطح فوق غامق (من قاعدة الزجاج لحد العداد) + وش تحت رمادي فاتح
  add(extrudeAcross([[-1.0, 0.9], [-0.72, 0.905], [-0.62, 0.885], [-0.575, 0.83], [-0.64, 0.8], [-1.0, 0.85]], W), m.dashTop);
  add(extrudeAcross([[-0.64, 0.8], [-0.575, 0.83], [-0.555, 0.72], [-0.57, 0.5], [-0.7, 0.42], [-0.74, 0.8]], W - 0.04), m.dashLow);
  // غطا العداد (cowl) قدام السواق
  // غطا العداد: طرف رفيع فوق العداد (مفتوح من ناحية السواق عشان العداد يبان)
  add(extrudeAcross([[-0.8, 0.9], [-0.74, 1.03], [-0.62, 1.035], [-0.62, 1.02], [-0.72, 1.012], [-0.76, 0.9]], 0.4, 0.012), m.dashTop, M4(-0.36, 0, 0));
  // العداد الديجيتال
  const cluster = new DashScreen(512, 224, drawTaxiCluster, { fps: 12, emissive: 0.9 });
  add(new RoundedBoxGeometry(0.33, 0.135, 0.02, 3, 0.02), m.vent, M4(-0.36, 0.952, -0.715, -0.2));
  add(new THREE.PlaneGeometry(0.3, 0.118), cluster.mat, M4(-0.36, 0.953, -0.703, -0.2));
  // شاشة النص (تابلت فوق التابلوه) — فيها الخريطة
  const center = new DashScreen(400, 280, drawTaxiCenter, { fps: 6, emissive: 0.85 });
  add(new RoundedBoxGeometry(0.27, 0.19, 0.03, 3, 0.012), m.trim, M4(0.06, 0.975, -0.7, -0.26));
  add(new THREE.PlaneGeometry(0.25, 0.17), center.mat, M4(0.06, 0.977, -0.683, -0.26));
  // فتحات التكييف المدورة (زي الصورة): اتنين جنب الشاشة + طرفين
  const ventGeo = new THREE.TorusGeometry(0.042, 0.011, 8, 22), ventIn = new THREE.CircleGeometry(0.04, 18);
  for (const [vx, vy] of [[-0.12, 0.79], [0.24, 0.79], [-0.68, 0.84], [0.7, 0.84]]) {
    add(ventGeo, m.silver, M4(vx, vy, -0.566, 0.25));
    add(ventIn, m.vent, M4(vx, vy, -0.57, 0.25));
  }
  // صف زراير تحت الشاشة + لوحة تكييف
  for (let i = 0; i < 6; i++) add(new RoundedBoxGeometry(0.03, 0.018, 0.012, 2, 0.004), m.button, M4(-0.02 + i * 0.034, 0.7, -0.508, 0.08));
  add(new RoundedBoxGeometry(0.2, 0.05, 0.02, 2, 0.008), m.trim, M4(0.06, 0.63, -0.515, 0.12));
  // كونسول النص بين الكراسي + فتيس أوتوماتيك
  add(new RoundedBoxGeometry(0.2, 0.2, 0.62, 3, 0.04), m.trim, M4(0.0, 0.45, -0.2));
  const gearBase = add(new RoundedBoxGeometry(0.08, 0.02, 0.14, 2, 0.008), m.silver, M4(0.0, 0.56, -0.28));
  add(new THREE.CylinderGeometry(0.012, 0.015, 0.1, 10), m.leather, M4(0.0, 0.61, -0.29, 0.2));
  const knob = add(new THREE.SphereGeometry(0.025, 12, 8), m.leather, M4(0.0, 0.665, -0.3));
  void gearBase; void knob;
  // أرضية + باب السواق من جوه (لوح + مسند + أوكرة)
  add(new THREE.BoxGeometry(1.5, 0.02, 2.2), m.carpet, M4(0, 0.25, 0.25));
  for (const sx of [-1, 1]) {
    add(new RoundedBoxGeometry(0.06, 0.48, 1.0, 3, 0.03), m.trim, M4(sx * 0.79, 0.69, -0.36));
    add(new RoundedBoxGeometry(0.1, 0.05, 0.42, 2, 0.02), m.dashTop, M4(sx * 0.75, 0.72, -0.32));
    add(new RoundedBoxGeometry(0.03, 0.03, 0.09, 2, 0.01), m.silver, M4(sx * 0.755, 0.83, -0.62));
    // حرف الشباك من جوه (فوق الباب)
    add(new RoundedBoxGeometry(0.07, 0.035, 1.02, 2, 0.015), m.dashTop, M4(sx * 0.78, 0.94, -0.36));
  }
  // العواميد A (رمادي فاتح زي الصورة) + السقف من جوه + الشماسات
  for (const sx of [-1, 1]) {
    g.add(beam([sx * 0.75, 0.92, -0.98], [sx * 0.63, 1.405, -0.36], 0.085, 0.04, m.pillar));
    g.add(beam([sx * 0.76, 0.95, 0.17], [sx * 0.63, 1.43, 0.17], 0.09, 0.05, m.pillar)); // عمود B
    add(new RoundedBoxGeometry(0.36, 0.022, 0.17, 2, 0.01), m.headliner, M4(sx * 0.3, 1.39, -0.4, 0.1));
  }
  add(new RoundedBoxGeometry(1.3, 0.03, 1.3, 3, 0.012), m.headliner, M4(0, 1.43, 0.3));
  // الدركسيون (3 أذرع، جلد غامق ولمسة فضي)
  const tilt = new THREE.Group(); tilt.position.set(-0.36, 0.82, -0.4); tilt.rotation.x = -1.15; g.add(tilt);
  const steering = new THREE.Group(); tilt.add(steering);
  steering.add(new THREE.Mesh(new THREE.TorusGeometry(0.182, 0.019, 12, 48), m.leather));
  const hub = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.1, 0.05, 3, 0.02), m.leather); hub.position.z = 0.025; steering.add(hub);
  const hubRing = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 6, 24), m.silver); hubRing.position.z = 0.052; steering.add(hubRing);
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const sp = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.032, 0.016, 2, 0.006), a === Math.PI ? m.leather : m.silver);
    sp.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.012); sp.rotation.z = a; steering.add(sp);
  }
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.28, 12).rotateX(Math.PI / 2), m.dashTop); col.position.z = -0.15; tilt.add(col);
  // الكراسي (اللي جنب السواق باينة + الكنبة ورا)
  const seat = (x, z, w) => {
    add(new RoundedBoxGeometry(w, 0.12, 0.5, 3, 0.05), m.seat, M4(x, 0.46, z), true);
    add(new RoundedBoxGeometry(w, 0.62, 0.11, 3, 0.05), m.seat, M4(x, 0.8, z + 0.27, 0.12), true);
    add(new RoundedBoxGeometry(w * 0.55, 0.16, 0.1, 3, 0.04), m.seat, M4(x, 1.17, z + 0.31, 0.1));
  };
  seat(-0.37, -0.05, 0.5); seat(0.37, -0.05, 0.5); seat(0, 0.86, 1.3);
  // المراية اللي جوه (عريضة، فوق النص)
  const mirrors = [];
  {
    const { holder, face } = mirrorFace(0.26, 0.075);
    holder.position.set(0.02, 1.33, -0.44);
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.09, 0.03, 3, 0.02), m.mirrorBack); house.position.z = -0.018; holder.add(house);
    face.position.z = 0.002;
    g.add(holder);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.08, 6), m.mirrorBack); stalk.position.set(0.02, 1.38, -0.44); g.add(stalk);
    mirrors.push({ holder, face, side: 0, aspect: 0.26 / 0.075, fov: 14 });
  }
  // المرايات الجانبية: على مكان جراب المراية في البودي
  for (const sx of [-1, 1]) {
    const { holder, face } = mirrorFace(0.15, 0.085);
    holder.position.set(sx * 1.0, 1.0, -0.755);
    S.add(holder);
    mirrors.push({ holder, face, side: sx, aspect: 0.15 / 0.085, fov: 26 });
  }
  // عين السواق
  const eye = new THREE.Object3D(); eye.position.set(-0.36, 1.16, 0.0); g.add(eye);
  const cockpit = {
    cluster, center,
    update(dt, ph, P) {
      const st = {
        kmh: ph.speed * 3.6, gear: ph.gearMode, throttle: ph.throttle, fuel: P.fuel ? P.fuel.level / P.fuel.capacity : 0.6,
        lights: P.headOn, hb: ph.handbrake > 0.1, mapCanvas: P.navCanvas, navTitle: P.navTitle, navLine: P.navLine,
        clock: new Date().toTimeString().slice(0, 5),
      };
      cluster.update(dt, st);
      center.update(dt, st);
    },
    setNight(on) { cluster.mat.emissiveIntensity = on ? 1.1 : 0.9; center.mat.emissiveIntensity = on ? 0.95 : 0.85; m.button.emissiveIntensity = on ? 0.6 : 0; },
  };
  return { group: g, steering, eye, eyePitch: -0.1, cockpit, mirrors };
}
