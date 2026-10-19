import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex, makeSeatFabric } from '../render/textures.js';
import { addBobbleDog } from './CabAccessories.js';

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

function mats(body = 0xa9a7a1) {
  return {
    dashTop: new THREE.MeshStandardMaterial({ color: 0x232529, roughness: 0.82 }),
    dashLow: new THREE.MeshStandardMaterial({ color: 0x8e8e8b, roughness: 0.7 }),
    // لون العربية من برا (الأبواب والعواميد من جوه بنفس لون الدهان — زي العربيات الحقيقية)
    body: new THREE.MeshStandardMaterial({ color: body, roughness: 0.35, metalness: 0.05 }),
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

/** شاشة الخريطة (التاكسي والميكروباص): الخريطة من الميني ماب + عنوان فوق + سطر تحت بلون العربية */
export function drawNavScreen(x, W, H, s, accent = '#e8711a', title = 'تاكسي شبين', idle = 'مستني راكب') {
  x.fillStyle = '#0b0d10'; x.fillRect(0, 0, W, H);
  if (s.mapCanvas && s.mapCanvas.width) {
    try { x.drawImage(s.mapCanvas, 0, 0, s.mapCanvas.width, s.mapCanvas.height, 0, 0, W, H - 40); } catch { /* */ }
  }
  x.fillStyle = 'rgba(0,0,0,0.65)'; x.fillRect(0, 0, W, 36);
  x.fillStyle = '#fff'; x.font = 'bold 20px Cairo, Arial'; x.textAlign = 'right'; x.direction = 'rtl'; x.textBaseline = 'middle';
  x.fillText(s.navTitle || title, W - 12, 19);
  // الساعة بتتحسب هنا بس (الشاشة بتترسم كام مرة في الثانية) مش كل فريم
  const d = new Date(), hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  x.textAlign = 'left'; x.direction = 'ltr'; x.font = '16px Arial'; x.fillStyle = '#cfd6dc'; x.fillText(`${hh}:${mm}`, 10, 19);
  x.fillStyle = accent; x.fillRect(0, H - 40, W, 40);
  x.fillStyle = '#fff'; x.font = 'bold 20px Cairo, Arial'; x.textAlign = 'center'; x.direction = 'rtl';
  x.fillText(s.navLine || idle, W / 2, H - 20);
}
const drawTaxiCenter = (x, W, H, s) => drawNavScreen(x, W, H, s);

/** الشاشة الصغيرة بين عدادين الميكروباص: الفتيس + البنزين + الكيلومترات */
export function drawVanLCD(x, W, H, s) {
  x.fillStyle = '#05080a'; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'ltr';
  x.fillStyle = s.gear === 'R' ? '#ff7a4a' : '#e6f3ff';
  x.font = `bold ${Math.round(H * 0.28)}px Arial`;
  x.fillText(s.gear === 'D' ? `D${Math.max(1, s.gearN)}` : s.gear, W / 2, H * 0.22);
  // البنزين: 8 شرط (برتقاني لما يقل)
  const n = 8, bw = (W - 28) / n, low = s.fuel < 0.15;
  for (let i = 0; i < n; i++) { x.fillStyle = (i + 0.5) / n <= s.fuel + 0.02 ? (low ? '#ff9a1a' : '#bfe6ff') : 'rgba(191,230,255,0.14)'; x.fillRect(14 + i * bw, H * 0.46, bw - 3, H * 0.1); }
  x.font = `bold ${Math.round(H * 0.08)}px Arial`; x.fillStyle = low ? '#ff9a1a' : '#7fa6b8';
  x.fillText('E', 7, H * 0.51); x.fillText('F', W - 7, H * 0.51);
  // حرارة الموتور (C—H): 6 شرط، أحمر لو سخن
  if (s.temp !== undefined) {
    const t = Math.min(1, Math.max(0, (s.temp - 40) / 80)), hot = s.temp > 108;
    for (let i = 0; i < 6; i++) { const on = (i + 0.5) / 6 <= t + 0.02; x.fillStyle = on ? (hot ? '#ff4a3a' : i >= 4 ? '#ffb24a' : '#bfe6ff') : 'rgba(191,230,255,0.14)'; x.fillRect(18 + i * ((W - 36) / 6), H * 0.6, (W - 36) / 6 - 3, H * 0.05); }
    x.font = `bold ${Math.round(H * 0.07)}px Arial`; x.fillStyle = hot ? '#ff4a3a' : '#7fa6b8';
    x.fillText('C', 8, H * 0.625); x.fillText('H', W - 8, H * 0.625);
  }
  x.font = `bold ${Math.round(H * 0.1)}px Arial`; x.fillStyle = '#cfe6f2';
  x.fillText(`${Math.floor(s.odo)} km`, W / 2, H * 0.75);
  // لمبات البيان: الكشافات (أخضر)، فرامل اليد (P أحمر)، بنزين قليل، حرارة عالية — كلها من حالة العربية الحقيقية
  const lamps = [];
  if (s.head) lamps.push(['#3fdc6a', '◐']);
  if (s.hb) lamps.push(['#ff4a3a', '(P)']);
  if (low) lamps.push(['#ff9a1a', '⛽']);
  if (s.temp > 108) lamps.push(['#ff4a3a', '🌡']);
  x.font = `bold ${Math.round(H * 0.09)}px Arial`;
  lamps.forEach(([c, t], i) => { x.fillStyle = c; x.fillText(t, W / 2 + (i - (lamps.length - 1) / 2) * W * 0.26, H * 0.9); });
}

/**
 * كابينة التاكسي. rig: الريج (فيه shell). بيرجّع { steering, eye, cockpit, mirrors[] }
 * المقاسات على السيدان (SEDAN): الزجاج الأمامي من z=-0.93 (y=0.915) لحد السقف z=-0.08 (y=1.44)
 */
export function buildTaxiCockpit(rig, { mirrorFace, body = 0x19b82a }) {
  // المقاسات على موديل التاكسي الأبيض (BYD Seal): الزجاج الأمامي من z=-0.9 (y=0.87) لحد z=-0.1 (y=1.21)،
  // السقف من جوه ≈1.2، وعرض الكابينة عند الشباك ≈±0.72 — كله جوه الجسم (مفيش حاجة طالعة برا)
  const S = rig.shell, m = mats(body);
  m.dashLow.color.set(0xcfcac0); // وش التابلوه اللي تحت فاتح والفوق غامق (مايعكسش على الزجاج)
  const g = new THREE.Group(); g.name = 'taxi-cockpit';
  S.add(g);
  const add = (geo, mat, mtx, shadow = false) => { const o = new THREE.Mesh(geo, mat); if (mtx) o.applyMatrix4(mtx); o.receiveShadow = true; o.castShadow = shadow; g.add(o); return o; };
  const W = 1.36;
  // التابلوه: سطح فوق غامق (تحت خط الزجاج بالظبط) + وش تحت فاتح
  add(extrudeAcross([[-0.9, 0.83], [-0.72, 0.885], [-0.62, 0.875], [-0.575, 0.83], [-0.64, 0.8], [-0.9, 0.79]], W), m.dashTop);
  add(extrudeAcross([[-0.64, 0.8], [-0.575, 0.83], [-0.555, 0.72], [-0.57, 0.5], [-0.7, 0.42], [-0.74, 0.8]], W - 0.04), m.dashLow);
  // غطا العداد: طرف رفيع فوق العداد (واطي — مايطلعش فوق خط الزجاج ولا يغطي الطريق)
  add(extrudeAcross([[-0.68, 0.87], [-0.64, 0.93], [-0.56, 0.935], [-0.56, 0.922], [-0.63, 0.918], [-0.66, 0.87]], 0.38, 0.01), m.dashTop, M4(-0.36, 0, 0));
  // العداد الديجيتال (ورا الدركسيون)
  const cluster = new DashScreen(512, 224, drawTaxiCluster, { fps: 6, emissive: 0.9 });
  add(new RoundedBoxGeometry(0.31, 0.115, 0.02, 3, 0.02), m.vent, M4(-0.36, 0.868, -0.6, -0.25));
  add(new THREE.PlaneGeometry(0.28, 0.1), cluster.mat, M4(-0.36, 0.869, -0.589, -0.25));
  // شاشة النص (فوق التابلوه) — فيها الخريطة
  const center = new DashScreen(400, 280, drawTaxiCenter, { fps: 4, emissive: 0.85 });
  add(new RoundedBoxGeometry(0.26, 0.17, 0.03, 3, 0.012), m.trim, M4(0.06, 0.9, -0.58, -0.26));
  add(new THREE.PlaneGeometry(0.24, 0.15), center.mat, M4(0.06, 0.902, -0.563, -0.26));
  // فتحات التكييف المدورة (زي الصورة): اتنين جنب الشاشة + طرفين
  const ventGeo = new THREE.TorusGeometry(0.042, 0.011, 8, 22), ventIn = new THREE.CircleGeometry(0.04, 18);
  for (const [vx, vy] of [[-0.12, 0.79], [0.24, 0.79], [-0.58, 0.79], [0.6, 0.79]]) {
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
  add(new THREE.BoxGeometry(1.4, 0.02, 2.2), m.carpet, M4(0, 0.25, 0.25));
  for (const sx of [-1, 1]) {
    // تابلوه الباب: تحت أسود، وفوق بلون العربية (زي الصاج من برا) + مسند + أوكرة كروم
    add(new RoundedBoxGeometry(0.05, 0.36, 1.9, 3, 0.02), m.trim, M4(sx * 0.74, 0.58, 0.3));
    add(new RoundedBoxGeometry(0.04, 0.1, 1.9, 2, 0.02), m.body, M4(sx * 0.715, 0.82, 0.3));
    add(new RoundedBoxGeometry(0.08, 0.04, 0.4, 2, 0.015), m.dashTop, M4(sx * 0.69, 0.7, -0.3));
    add(new RoundedBoxGeometry(0.025, 0.025, 0.08, 2, 0.01), m.silver, M4(sx * 0.69, 0.76, -0.55));
  }
  // الشماسات (السقف والعواميد هما الجسم نفسه من جوه — بنفس لونه)
  for (const sx of [-1, 1]) add(new RoundedBoxGeometry(0.34, 0.02, 0.15, 2, 0.01), m.headliner, M4(sx * 0.3, 1.17, -0.14, 0.1));
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
    add(new RoundedBoxGeometry(w, 0.12, 0.5, 3, 0.05), m.seat, M4(x, 0.42, z), true);
    add(new RoundedBoxGeometry(w, 0.56, 0.11, 3, 0.05), m.seat, M4(x, 0.74, z + 0.27, 0.12), true);
    add(new RoundedBoxGeometry(w * 0.55, 0.14, 0.1, 3, 0.04), m.seat, M4(x, 1.07, z + 0.3, 0.1));
  };
  seat(-0.37, -0.05, 0.5); seat(0.37, -0.05, 0.5); seat(0, 0.86, 1.22);
  // المراية اللي جوه (عريضة، فوق النص)
  const mirrors = [];
  {
    const { holder, face } = mirrorFace(0.26, 0.075);
    holder.position.set(0.02, 1.11, -0.2);
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.09, 0.03, 3, 0.02), m.mirrorBack); house.position.z = -0.018; holder.add(house);
    face.position.z = 0.002;
    g.add(holder);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.08, 6), m.mirrorBack); stalk.position.set(0.02, 1.16, -0.2); g.add(stalk);
    mirrors.push({ holder, face, side: 0, aspect: 0.26 / 0.075, fov: 14 });
  }
  // المرايات الجانبية: على مكان جراب المراية في البودي
  for (const sx of [-1, 1]) {
    const { holder, face } = mirrorFace(0.15, 0.085);
    holder.position.set(sx * 0.93, 0.93, -0.36);
    S.add(holder);
    mirrors.push({ holder, face, side: sx, aspect: 0.15 / 0.085, fov: 26 });
  }
  // عين السواق
  const eye = new THREE.Object3D(); eye.position.set(-0.36, 1.06, 0.02); g.add(eye);
  // الكلب أبو راس بتتهز (على التابلوه يمين العداد)
  const dog = addBobbleDog(g, -0.1, 0.884, -0.7, 0, 1.25);
  const st = { kmh: 0, gear: 'D', throttle: 0, fuel: 0.6, lights: false, hb: false, mapCanvas: null, navTitle: '', navLine: '' };
  const cockpit = {
    cluster, center,
    update(dt, ph, P) {
      st.kmh = ph.speed * 3.6; st.gear = ph.gearMode; st.throttle = ph.throttle;
      st.fuel = P.fuel ? P.fuel.level / P.fuel.capacity : 0.6;
      st.lights = P.headOn; st.hb = ph.handbrake > 0.1;
      st.mapCanvas = P.navCanvas; st.navTitle = P.navTitle; st.navLine = P.navLine;
      cluster.update(dt, st);
      center.update(dt, st);
    },
    setNight(on) { cluster.mat.emissiveIntensity = on ? 1.1 : 0.9; center.mat.emissiveIntensity = on ? 0.95 : 0.85; m.button.emissiveIntensity = on ? 0.6 : 0; },
  };
  return { group: g, steering, eye, eyePitch: -0.08, cockpit, mirrors, dog };
}

// =====================================================================
//  التوكتوك (صورة 3): تابلوه أصفر مقوّس + عداد مدوّر في النص + مفاتيح + درجين سود
//  + جادون أزرق بمساكات سودا وذراع فرامل + إيدين السواق ماسكين الجادون (بيلفوا معاه)
//  المقاسات على موديل التوكتوك (الحيطة اللي قدام من جوه: z ≈ -1.26 في النص و -0.95 على الجناب عند y=1)
// =====================================================================

/** شكل بيتسحب على العرض: profile(x) بيرجّع نقط [z,y] (مضلع محدّب)، والطرفين مقفولين.
 *  halfW(z): أقصى عرض عند العمق ده (عشان الطرفين يمشوا مع حيطة الموديل وميطلعوش برا الجسم) */
function loftX(x0, x1, n, profile, halfW = null) {
  const pos = [], idx = [];
  const P = profile(x0).length;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * (i / n);
    for (const [z, y] of profile(x)) pos.push(halfW ? Math.sign(x) * Math.min(Math.abs(x), halfW(z)) : x, y, z);
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < P; k++) {
    const a = i * P + k, b = i * P + ((k + 1) % P), c = a + P, d = b + P;
    idx.push(a, b, c, b, d, c);
  }
  // الطرفين (مروحة من أول نقطة)
  for (const [ring, flip] of [[0, true], [n, false]]) {
    const o = pos.length / 3;
    for (let k = 0; k < P; k++) pos.push(pos[(ring * P + k) * 3], pos[(ring * P + k) * 3 + 1], pos[(ring * P + k) * 3 + 2]);
    for (let k = 1; k < P - 1; k++) idx.push(...(flip ? [o, o + k + 1, o + k] : [o, o + k, o + k + 1]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  return toCreasedNormals(flat, 0.7);
}

function tukDialTexture() {
  const s = 256, c = canvas(s, s), x = c.getContext('2d');
  x.fillStyle = '#0a0a0c'; x.fillRect(0, 0, s, s);
  x.translate(s / 2, s / 2);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, a = a0 + (a1 - a0) * t, major = i % 2 === 0, red = i >= 13;
    x.strokeStyle = red ? '#e43' : '#f2f2f2'; x.lineWidth = major ? 5 : 2.5;
    x.beginPath(); x.moveTo(Math.cos(a) * 112, Math.sin(a) * 112); x.lineTo(Math.cos(a) * (major ? 92 : 101), Math.sin(a) * (major ? 92 : 101)); x.stroke();
    if (major) { x.fillStyle = red ? '#e43' : '#f2f2f2'; x.font = 'bold 21px Arial'; x.fillText(String(i * 5), Math.cos(a) * 72, Math.sin(a) * 72); }
  }
  x.fillStyle = '#9a9aa0'; x.font = '15px Arial'; x.fillText('km/h', 0, -30);
  // عداد البنزين الصغير تحت (E ← → F)
  const fy = 52, f0 = Math.PI * 1.2, f1 = Math.PI * 1.8;
  x.strokeStyle = '#d8d8d8'; x.lineWidth = 3; x.beginPath(); x.arc(0, fy, 34, f0, f1); x.stroke();
  x.strokeStyle = '#e43'; x.lineWidth = 5; x.beginPath(); x.arc(0, fy, 34, f0, f0 + 0.12); x.stroke();
  x.fillStyle = '#e8e8e8'; x.font = 'bold 14px Arial';
  x.fillText('E', Math.cos(f0) * 46, fy + Math.sin(f0) * 46); x.fillText('F', Math.cos(f1) * 46, fy + Math.sin(f1) * 46);
  x.font = '13px Arial'; x.fillText('⛽', 0, fy + 10);
  return tex(c, { repeat: false });
}

export function buildTuktukCockpit(rig) {
  const S = rig.shell;
  const g = new THREE.Group(); g.name = 'tuktuk-cockpit';
  S.add(g);
  const M = {
    yellow: new THREE.MeshStandardMaterial({ color: 0xf0b30a, roughness: 0.36 }),
    black: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6 }),
    hole: new THREE.MeshBasicMaterial({ color: 0x040404 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.18, metalness: 1 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x1c4fc8, roughness: 0.3, metalness: 0.35 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.88 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x96603f, roughness: 0.6 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x33404f, roughness: 0.92 }),
    mark: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0 }),
  };
  const merged = new Map();
  const K = (mat) => { if (!merged.has(mat)) merged.set(mat, new GeoBuilder()); return merged.get(mat); };
  // ===== التابلوه: حيطة صفرا مقوّسة قدام السواق (الوش مايل لقدام فوق) =====
  // جوه "البوز" بتاع الموديل بالظبط: الرف الأسود بتاعه آخره z=-0.895، والبوز مفتوح من الجناب ورا z≈-0.82
  const zr = (x) => -0.835 - 0.12 * x * x;
  const zf = (x) => Math.min(-1.23 + 1.1 * x * x + 1.2 * x ** 4, zr(x) - 0.06);
  // عرض البوز من جوه عند كل عمق (من قياس الموديل)
  const WZ = [[-1.25, 0.12], [-1.2, 0.19], [-1.1, 0.32], [-1.0, 0.41], [-0.95, 0.44], [-0.9, 0.46], [-0.85, 0.475], [-0.8, 0.48]];
  const halfW = (z) => {
    if (z <= WZ[0][0]) return WZ[0][1];
    for (let i = 1; i < WZ.length; i++) if (z <= WZ[i][0]) { const [z0, w0] = WZ[i - 1], [z1, w1] = WZ[i]; return w0 + (w1 - w0) * (z - z0) / (z1 - z0); }
    return WZ[WZ.length - 1][1];
  };
  const top = 0.99, bot = 0.74, lean = 0.02;
  const dash = new THREE.Mesh(loftX(-0.47, 0.47, 28, (x) => {
    const r = zr(x), f = zf(x);
    return [[f, bot], [f, top], [r - 0.035, top], [r - 0.01, top - 0.008], [r, top - 0.025], [r - lean, bot]];
  }, (z) => halfW(z) - 0.012), M.yellow);
  dash.receiveShadow = true; g.add(dash);
  // نقطة على وش التابلوه (متجهة للسواق) + d لبره
  const faceM = (x, y, d = 0, ex = new THREE.Matrix4()) => {
    const z = zr(x) - lean * (top - 0.025 - y) / (top - 0.025 - bot);
    const ry = Math.atan2(0.24 * x, 1), rx = Math.atan2(lean, top - 0.025 - bot);
    return M4(x, y, z, rx, ry).multiply(M4(0, 0, d)).multiply(ex);
  };
  // درجين سود (يمين وشمال)
  for (const sx of [-1, 1]) {
    K(M.black).addGeometry(new RoundedBoxGeometry(0.2, 0.12, 0.024, 2, 0.01), faceM(sx * 0.3, 0.845, 0.004));
    K(M.hole).addGeometry(new THREE.PlaneGeometry(0.17, 0.092), faceM(sx * 0.3, 0.845, 0.0165));
  }
  // مفاتيح: 3 شمال + كونتاكت ومفتاح يمين
  K(M.black).addGeometry(new RoundedBoxGeometry(0.13, 0.05, 0.014, 2, 0.006), faceM(-0.13, 0.925, 0.002));
  for (const dx of [-0.04, 0, 0.04]) {
    K(M.black).addGeometry(new RoundedBoxGeometry(0.024, 0.032, 0.02, 2, 0.006), faceM(-0.13 + dx, 0.925, 0.012, M4(0, 0, 0, 0.18)));
    K(M.mark).addGeometry(new THREE.BoxGeometry(0.012, 0.004, 0.002), faceM(-0.13 + dx, 0.932, 0.0235));
  }
  K(M.black).addGeometry(new RoundedBoxGeometry(0.09, 0.05, 0.014, 2, 0.006), faceM(0.14, 0.925, 0.002));
  K(M.chrome).addGeometry(new THREE.CylinderGeometry(0.016, 0.016, 0.008, 16).rotateX(Math.PI / 2), faceM(0.12, 0.925, 0.012));
  K(M.black).addGeometry(new THREE.BoxGeometry(0.006, 0.03, 0.03), faceM(0.12, 0.925, 0.03));
  K(M.black).addGeometry(new RoundedBoxGeometry(0.024, 0.032, 0.02, 2, 0.006), faceM(0.165, 0.925, 0.012, M4(0, 0, 0, -0.18)));

  // ===== العداد المدوّر في النص (فوق التابلوه، متوجه للسواق) =====
  const podM = M4(0, 1.075, -0.915, -0.5);
  K(M.black).addGeometry(new THREE.CylinderGeometry(0.084, 0.07, 0.07, 28).rotateX(Math.PI / 2), podM.clone().multiply(M4(0, 0, -0.037)));
  K(M.black).addGeometry(new THREE.CylinderGeometry(0.02, 0.03, 0.09, 10), M4(0, 1.0, -0.925));
  K(M.chrome).addGeometry(new THREE.TorusGeometry(0.076, 0.007, 8, 36), podM.clone().multiply(M4(0, 0, 0.002)));
  const dialMat = new THREE.MeshStandardMaterial({ map: tukDialTexture(), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
  dialMat.emissiveMap = dialMat.map;
  const pod = new THREE.Group(); pod.matrixAutoUpdate = true;
  podM.decompose(pod.position, pod.quaternion, pod.scale);
  g.add(pod);
  pod.add(new THREE.Mesh(new THREE.CircleGeometry(0.07, 40), dialMat));
  const needleMat = new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 0.7 });
  const speedPivot = new THREE.Group(); speedPivot.position.z = 0.004; pod.add(speedPivot);
  speedPivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.058, 0.002).translate(0, 0.024, 0), needleMat));
  const capM = new THREE.Mesh(new THREE.CircleGeometry(0.008, 14), M.black); capM.position.z = 0.0055; pod.add(capM);
  const fuelPivot = new THREE.Group(); fuelPivot.position.set(0, -0.07 * 2 * 52 / 256, 0.004); pod.add(fuelPivot);
  fuelPivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.02, 0.002).translate(0, 0.009, 0), needleMat));

  // ===== الجادون (أزرق) بيلف حوالين عمود مايل لورا =====
  const col = new THREE.Group();
  col.position.set(0, 1.08, -0.78);
  col.rotation.x = -Math.PI / 2 + 0.36;          // محور z المحلي = العمود (لفوق ومايل ناحية السواق)
  g.add(col);
  const steering = new THREE.Group(); col.add(steering);
  // في إحداثيات الجادون: x يمين، y لقدام، z لفوق مع العمود
  const barPts = [[-0.345, -0.1, -0.012], [-0.24, -0.068, 0], [-0.12, -0.016, 0.006], [0, 0, 0.01], [0.12, -0.016, 0.006], [0.24, -0.068, 0], [0.345, -0.1, -0.012]].map((p) => new THREE.Vector3(...p));
  const S2 = new GeoBuilder(), skin = new GeoBuilder(), sleeve = new GeoBuilder();
  const blueBar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(barPts), 40, 0.0115, 8, false), M.blue);
  blueBar.castShadow = true; steering.add(blueBar);
  // مساكات + ذراع فرامل + الإيدين
  const gripAng = Math.atan2(-0.032, 0.105);
  for (const sx of [-1, 1]) {
    const gm = M4(sx * 0.288, -0.083, -0.006, 0, 0, sx * gripAng);
    S2.addGeometry(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 14).rotateZ(Math.PI / 2), gm);
    S2.addGeometry(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 14).rotateZ(Math.PI / 2), gm.clone().multiply(M4(-sx * 0.062, 0, 0)));
    addHand(skin, sleeve, gm, sx);
  }
  const grips = new THREE.Mesh(S2.build(), M.grip); grips.castShadow = true; steering.add(grips);
  {
    const L = new GeoBuilder(), lm = M4(0.288, -0.083, -0.006, 0, 0, gripAng);
    L.addGeometry(new THREE.BoxGeometry(0.03, 0.02, 0.022), lm.clone().multiply(M4(-0.075, 0.035, 0.004)));
    L.addGeometry(new RoundedBoxGeometry(0.13, 0.012, 0.016, 2, 0.005), lm.clone().multiply(M4(0.0, 0.05, 0.0, 0, 0, -0.05)));
    const lever = new THREE.Mesh(L.build(), M.chrome); steering.add(lever);
  }
  const hands = new THREE.Group();
  hands.add(new THREE.Mesh(skin.build(), M.skin), new THREE.Mesh(sleeve.build(), M.sleeve));
  steering.add(hands);
  // العمود + الكاب اللي فوقه
  const colMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.26, 12).rotateX(Math.PI / 2).translate(0, 0, -0.13), M.black);
  col.add(colMesh);
  const capTop = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.05, 0.035, 2, 0.012), M.black); capTop.position.z = 0.005; steering.add(capTop);

  for (const [mat, gb] of merged) {
    if (gb.empty) continue;
    const m = new THREE.Mesh(gb.build(), mat); m.receiveShadow = true; m.castShadow = mat !== M.hole && mat !== M.mark;
    g.add(m);
  }
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, f0 = Math.PI * 1.2, f1 = Math.PI * 1.8;
  const cockpit = {
    update(dt, ph, P) {
      speedPivot.rotation.z = -(a0 + (a1 - a0) * Math.min(1, Math.abs(ph.speed) * 3.6 / 80)) - Math.PI / 2;
      const fuel = P.fuel ? P.fuel.level / P.fuel.capacity : 0.6;
      fuelPivot.rotation.z = -(f0 + (f1 - f0) * Math.max(0, Math.min(1, fuel))) - Math.PI / 2;
    },
    setNight(on) { dialMat.emissiveIntensity = on ? 0.5 : 0; M.mark.emissiveIntensity = on ? 0.4 : 0; },
  };
  return { group: g, steering, hands, cockpit };
}

/**
 * إيد ماسكة مساكة الجادون (شبه حقيقية): 4 صوابع ملفوفة حوالين المساكة + كف فوق ورا + صباع إبهام من تحت + رسغ ودراع بكم
 * gm: مصفوفة المساكة (محورها x)، sx: 1 يمين / -1 شمال (الإبهام ناحية جوه)
 */
function addHand(skin, sleeve, gm, sx) {
  const rg = 0.021;
  const T = (x, y, z, rx = 0, ry = 0, rz = 0) => gm.clone().multiply(M4(x, y, z, rx, ry, rz));
  // تورس حوالين محور x: بنبنيه في xy (محوره z) ونلفّه (z→x)
  const toX = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0));
  const arcAround = (r, tube, start, span, x) => {
    const tg = new THREE.TorusGeometry(r, tube, 6, 12, span).rotateZ(start);
    return [tg, T(x, 0, 0).multiply(toX)];
  };
  const deg = Math.PI / 180;
  // الصوابع (السبابة ناحية جوه): بتبدأ فوق عند العقل وتلف قدام وتحت لحد ورا تحت
  const fx = [-0.027, -0.008, 0.01, 0.027].map((v) => v * sx); // السبابة ناحية جوه (ناحية نص الجادون)
  const tubes = [0.0098, 0.0102, 0.0094, 0.0084];
  fx.forEach((x, i) => {
    const [tg, m] = arcAround(rg + tubes[i] * 0.95, tubes[i], -120 * deg, 205 * deg, x);
    skin.addGeometry(tg, m);
    skin.addGeometry(new THREE.SphereGeometry(tubes[i] * 1.15, 8, 6), T(x, 0.004, rg + tubes[i] * 1.1)); // عُقلة
  });
  // الكف/ضهر الإيد: فوق ورا المساكة
  skin.addGeometry(new RoundedBoxGeometry(0.088, 0.075, 0.032, 3, 0.014), T(0, -0.026, 0.03, 45 * deg));
  // الإبهام: من ورا تحت ولافف لقدام تحت ناحية جوه
  {
    const [tg, m] = arcAround(rg + 0.011, 0.0105, 175 * deg, 115 * deg, -sx * 0.047);
    skin.addGeometry(tg, m);
  }
  // الرسغ + الدراع (رايح لورا وتحت وبره ناحية الكوع) + الكم
  const wrist = new THREE.Vector3(0.004 * sx, -0.068, 0.036);
  const dir = new THREE.Vector3(sx * 0.3, -0.86, -0.42).normalize();
  const limb = (r0, r1, a, b, gb) => {
    const len = b - a, cyl = new THREE.CylinderGeometry(r1, r0, len, 12, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const c = wrist.clone().addScaledVector(dir, (a + b) / 2);
    gb.addGeometry(cyl, gm.clone().multiply(new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1))));
  };
  skin.addGeometry(new THREE.SphereGeometry(0.027, 10, 8).scale(1.15, 1, 0.8), gm.clone().multiply(M4(wrist.x, wrist.y, wrist.z)));
  limb(0.026, 0.031, 0, 0.09, skin);
  limb(0.039, 0.044, 0.07, 0.34, sleeve);
}
