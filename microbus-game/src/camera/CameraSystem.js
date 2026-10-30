import * as THREE from 'three';
import { groundHeight } from '../world/ground.js';

// 3 كاميرات بس: كرسي السواق / ورا العربية / حرة 360° حوالين العربية. زرار واحد (C / الزرار اللي على الشاشة) بيلف عليهم
// واللي اخترته آخر مرة بيتحفظ

export const CAMERA_MODES = [
  { id: 'cockpit', label: 'من كرسي السواق' },
  { id: 'chase', label: 'ورا العربية' },
  { id: 'orbit', label: 'حرة 360°' },
];
const MODE_KEY = 'egy-microbus-cam-v1';

const _bus = new THREE.Vector3(), _q3 = new THREE.Quaternion(), _v2 = new THREE.Vector3();

// زووم كل كاميرا (بيتحفظ): كرسي السواق = زاوية الرؤية من الإعدادات (fov)،
// والكاميرات اللي برا = مضاعف للمسافة/الزاوية. الحدود بتمنع الكاميرا تدخل جوه العربية أو تبعد أوي
const ZOOM_KEY = 'egy-microbus-zoom-v1';
const ZOOM_LIMITS = { chase: [0.62, 1.75], orbit: [0.45, 2.6] };
const FOV_LIMITS = [70, 115]; // زاوية الرؤية بالعرض (كرسي السواق)
// حركة الراس/الأفق في كرسي السواق: [قصور الراس، كام من ميل المساعدين (قدام/ورا)، كام من الميلان (يمين/شمال)]
// ميل الطريق نفسه (كوبري/مطلع) بيتاخد كامل دايمًا — اللي بيتقلل هو هزة المساعدين بس (أفق ثابت وانت سايق)
const MOTION = { normal: [1, 0.45, 0.3], low: [0.5, 0.25, 0.12], off: [0, 0, 0] };
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();

export class CameraSystem {
  constructor(camera, player, dom) {
    this.camera = camera;
    this.player = player;
    this.mode = 0;
    this.chaseYaw = 0;
    this.chasePos = new THREE.Vector3();
    this.headOffset = new THREE.Vector3();
    this.headVel = new THREE.Vector3();
    this.look = { yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0, idle: 0 };
    // الكاميرا الحرة: زاوية حوالين العربية (نسبة لاتجاهها) + ميل لفوق/لتحت — مابترجعش للنص لوحدها
    this.orbit = { yaw: 0.6, pitch: 0.32, pos: new THREE.Vector3() };
    this.attract = false; // شاشة البداية: الحرة بتلف لوحدها ببطء
    this.shake = 0;
    this.zoom = { chase: 1, orbit: 1 };
    try { Object.assign(this.zoom, JSON.parse(localStorage.getItem(ZOOM_KEY) || '{}')); } catch { /* مفيش تخزين */ }
    this._initMouse(dom);
    this._initZoom(dom);
    this.snap = true;
  }

  /** f > 1 = بعّد، f < 1 = قرّب (للكاميرا الحالية) */
  zoomBy(f) {
    const id = this.modeId;
    if (id === 'cockpit') {
      if (!this.settings) return;
      const fov = THREE.MathUtils.clamp(this.settings.get('fovH') * f, FOV_LIMITS[0], FOV_LIMITS[1]);
      this.settings.set('fovH', Math.round(fov));
      return;
    }
    const lim = ZOOM_LIMITS[id];
    if (!lim) return;
    this.zoom[id] = THREE.MathUtils.clamp(this.zoom[id] * f, lim[0], lim[1]);
    clearTimeout(this._zoomSave);
    this._zoomSave = setTimeout(() => { try { localStorage.setItem(ZOOM_KEY, JSON.stringify(this.zoom)); } catch { /* */ } }, 400);
  }

  _initZoom(dom) {
    // عجلة الماوس
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY > 0 ? 1.07 : 1 / 1.07); }, { passive: false });
    // + / - من الكيبورد
    window.addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT') return;
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoomBy(1 / 1.1);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoomBy(1.1);
    });
    // صباعين على الشاشة (Pinch): قرّب/بعّد. صباع واحد بيفضل للبص حواليك
    const pts = new Map();
    let lastD = 0;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { lastD = dist(); this.look.dragging = false; this.pinching = true; }
    });
    window.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && lastD > 0) { const d = dist(); if (d > 0) { this.zoomBy(lastD / d); lastD = d; } }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) { lastD = 0; this.pinching = pts.size > 0; } };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _sens() { return this.settings ? this.settings.get('lookSens') : 1; }

  get modeId() { return CAMERA_MODES[this.mode]?.id || 'free'; }

  /** آخر كاميرا اختارها اللاعب (أول مرة: كرسي السواق) */
  static savedMode() {
    try { const i = +localStorage.getItem(MODE_KEY); return i >= 0 && i < CAMERA_MODES.length ? i : 0; } catch { return 0; }
  }

  next() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.snap = true;
    this.look.yaw = 0; this.look.pitch = 0;
    try { localStorage.setItem(MODE_KEY, String(this.mode)); } catch { /* مفيش تخزين */ }
    return CAMERA_MODES[this.mode].label;
  }

  _initMouse(dom) {
    dom.addEventListener('pointerdown', (e) => { this.look.dragging = true; this.look.lastX = e.clientX; this.look.lastY = e.clientY; });
    window.addEventListener('pointerup', () => { this.look.dragging = false; });
    window.addEventListener('pointercancel', () => { this.look.dragging = false; });
    window.addEventListener('blur', () => { this.look.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.look.dragging || this.pinching) return;
      // الزرار اتساب برا الشاشة (بيحصل كتير على الماك) → وقف السحب بدل ما الكاميرا تفضل تلف لوحدها
      if (e.pointerType === 'mouse' && !e.buttons) { this.look.dragging = false; return; }
      const dx = e.clientX - this.look.lastX, dy = e.clientY - this.look.lastY;
      this.look.lastX = e.clientX; this.look.lastY = e.clientY;
      if (this.modeId === 'orbit') { this._orbitBy(-dx * 0.006 * this._sens(), dy * 0.004 * this._sens()); return; }
      this.look.yaw = THREE.MathUtils.clamp(this.look.yaw - dx * 0.004 * this._sens(), -2.2, 2.2);
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - dy * 0.003 * this._sens(), -0.7, 0.6);
      this.look.idle = 0;
    });
  }

  _orbitBy(dyaw, dpitch) {
    const o = this.orbit;
    o.yaw = Math.atan2(Math.sin(o.yaw + dyaw), Math.cos(o.yaw + dyaw));
    o.pitch = THREE.MathUtils.clamp(o.pitch + dpitch, -0.12, 1.35); // من مستوى الأرض تقريبًا لحد فوق العربية
  }

  /** الكاميرا اللي ورا متدخلش جوه عمارة: لو الخط من العربية للكاميرا بيخبط في مبنى نقرّبها */
  _avoidWalls(px, pz, cam) {
    if (!this.colliders) return;
    const dx = cam.x - px, dz = cam.z - pz;
    const box = { cx: (px + cam.x) / 2, cz: (pz + cam.z) / 2, hx: Math.abs(dx) / 2 + 2, hz: Math.abs(dz) / 2 + 2, angle: 0 };
    const list = this.colliders(box).filter((c) => c.kind === 'building' || c.kind === 'wall' || c.kind === 'edge');
    if (!list.length) return;
    let tMax = 1;
    for (let t = 0.25; t <= 1.0001; t += 0.05) {
      const x = px + dx * t, z = pz + dz * t;
      const hit = list.some((c) => {
        const ca = Math.cos(c.angle || 0), sa = Math.sin(c.angle || 0), rx = x - c.cx, rz = z - c.cz;
        const lx = rx * ca - rz * sa, lz = rx * sa + rz * ca;
        return Math.abs(lx) < c.hx + 0.4 && Math.abs(lz) < c.hz + 0.4;
      });
      if (hit) { tMax = Math.max(0.25, t - 0.08); break; }
    }
    if (tMax < 1) { cam.x = px + dx * tMax; cam.z = pz + dz * tMax; cam.y += (1 - tMax) * 1.5; }
  }

  /** look: دخل الجيم باد (العصاية اليمين) */
  update(dt, input) {
    if (this.mode === 99) return; // كاميرا حرة للتجربة
    const p = this.player;
    const ph = p.physics;
    const cam = this.camera;
    const root = p.rig.root;
    const id = this.modeId;

    if (id === 'orbit' && input && (Math.abs(input.lookX) > 0.1 || Math.abs(input.lookY) > 0.1)) {
      this._orbitBy(-input.lookX * dt * 2.2 * this._sens(), input.lookY * dt * 1.2 * this._sens());
    } else if (input && (Math.abs(input.lookX) > 0.1 || Math.abs(input.lookY) > 0.1)) {
      this.look.yaw = THREE.MathUtils.clamp(this.look.yaw - input.lookX * dt * 2.5 * this._sens(), -2.2, 2.2);
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - input.lookY * dt * 1.5 * this._sens(), -0.7, 0.6);
      this.look.idle = 0;
    }
    if (input && input.lookBack) { this.look.yaw = Math.PI * 0.95; this.look.idle = 0; }
    // النظرة بترجع للنص لوحدها بعد شوية
    if (!this.look.dragging) {
      this.look.idle += dt;
      if (this.look.idle > 1.2) {
        const k = Math.min(1, dt * 2.5);
        this.look.yaw -= this.look.yaw * k; this.look.pitch -= this.look.pitch * k;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 3);

    if (id === 'cockpit') {
      // زاوية الرؤية بالعرض من الإعدادات → زاوية الكاميرا بالطول على قد الشاشة (موبايل عريض = نفس المنظر من غير تمطيط)
      const hf = THREE.MathUtils.degToRad(this.settings ? this.settings.get('fovH') : 92);
      cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / Math.max(0.5, cam.aspect))), 40, 85);
      cam.near = 0.04;
      const [kHead, kPitch, kRoll] = MOTION[this.settings?.get('camMotion')] || MOTION.normal;
      // قصور الراس (head inertia): زنبرك بسيط
      const target = _v.set(
        THREE.MathUtils.clamp(-ph.accelLat * 0.006, -0.05, 0.05) * kHead,
        THREE.MathUtils.clamp(-ph.heaveVel * 0.01, -0.03, 0.03) * kHead,
        THREE.MathUtils.clamp(ph.accelLong * 0.007, -0.05, 0.05) * kHead,
      );
      const k = 60, d = 11;
      this.headVel.addScaledVector(target.sub(this.headOffset), k * dt).multiplyScalar(Math.max(0, 1 - d * dt));
      this.headOffset.addScaledVector(this.headVel, dt);
      const eye = p.rig.eye;
      // مكان العين بيتنقل بنعومة لما الكرسي يتظبط (مش نطّة)
      if (this.snap || !this._eyeL || this._eyeOf !== eye) { this._eyeL = eye.position.clone(); this._eyeOf = eye; }
      else this._eyeL.lerp(eye.position, Math.min(1, dt * 5));
      eye.parent.updateWorldMatrix(true, false);
      // لما تبص ورا: الراس بتلف وتميل ناحية نص الكابينة (زي السواق الحقيقي وهو بيرجع)
      const ay = Math.abs(this.look.yaw);
      const turn = Math.min(1, Math.max(0, (ay - 1.0) / 1.6));
      const lean = _v2.set(0.34 * turn, 0.1 * turn, 0.18 * turn);
      const pos = _v.copy(this.headOffset).add(lean).add(this._eyeL).applyMatrix4(eye.parent.matrixWorld);
      cam.position.copy(pos);
      // الأفق: اتجاه العربية + ميل الطريق كامل + جزء من ميل المساعدين (كان كله = الأفق بيتهز مع كل مطب ولفة)
      const gp = p.groundPitch ?? ph.pitch, gr = p.groundRoll ?? ph.roll;
      const camPitch = gp + (ph.pitch - gp) * kPitch, camRoll = gr + (ph.roll - gr) * kRoll;
      p.rig.root.getWorldQuaternion(_q);
      _q.multiply(_q3.setFromEuler(_e.set(camPitch, 0, camRoll, 'YXZ')));
      // بص شوية في اتجاه اللفة (زي السواق الحقيقي)
      const steerLook = ph.steerSmooth * 0.07 * Math.min(1, Math.abs(ph.forwardSpeed) / 6);
      _e.set((p.rig.eyePitch ?? -0.2) + this.look.pitch, this.look.yaw + steerLook, 0, 'YXZ');
      cam.quaternion.copy(_q).multiply(_q3.setFromEuler(_e));
    } else if (id === 'chase') {
      // ورا العربية وفوقها. كله من مكان العربية المرسوم (interpolated) مش من الفيزيا الخام —
      // الفرق بينهم كان بيبان رعشة. المكان نفسه مربوط بالعربية من غير تأخير (التأخير كان بيخلي الكاميرا
      // تتأخر ~2م على 70 كم/س فالعربية تبان صغيرة وبعيدة)؛ اللي بيتنعّم: الاتجاه والارتفاع والمسافة بس
      cam.fov = 58; cam.near = 0.1;
      const yaw = root.rotation.y;
      if (this.snap) this.chaseYaw = yaw;
      let diff = yaw - this.chaseYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.chaseYaw += diff * Math.min(1, dt * 4);
      // المسافة على قد العربية × زووم اللاعب — ثابتة (مفيش بُعد مع السرعة)
      const z = this.zoom.chase, size = ph.spec.halfLength * 2;
      const want = (size * 0.8 + 2.6) * z;
      const height = (ph.spec.roofHeight ?? 2) * 0.55 + 1.35 * (0.6 + 0.4 * z);
      const camYaw = this.chaseYaw + this.look.yaw;
      // ارتفاع الجسم المرسوم، متنعّم شوية (المساعدين بيهزّوا الجسم مش الكاميرا كلها)
      const bodyY = p.rig.body.position.y - ph.spec.cgHeight;
      if (this.snap || this._chaseY === undefined) this._chaseY = bodyY;
      this._chaseY += (bodyY - this._chaseY) * Math.min(1, dt * 7);
      const baseY = this._chaseY;
      const sx = Math.sin(camYaw), sz = Math.cos(camYaw);
      const target = _v.set(root.position.x + sx * want, baseY + height + this.look.pitch * 3, root.position.z + sz * want);
      target.y = Math.max(target.y, baseY + 0.9); // مايبقاش تحت مستوى العربية
      this._avoidWalls(root.position.x, root.position.z, target);
      // المسافة بعد تفادي الحيطان: بتقرّب بسرعة وبترجع براحة (من غير نط)
      const d = Math.hypot(target.x - root.position.x, target.z - root.position.z);
      if (this.snap || this._chaseD === undefined) this._chaseD = d;
      this._chaseD += (d - this._chaseD) * Math.min(1, dt * (d < this._chaseD ? 14 : 3));
      this.chasePos.set(root.position.x + sx * this._chaseD, target.y, root.position.z + sz * this._chaseD);
      cam.position.copy(this.chasePos);
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      cam.lookAt(root.position.x + fx * 2.2, baseY + (ph.spec.roofHeight ?? 2) * 0.6, root.position.z + fz * 2.2);
    } else {
      // حرة 360°: بتلف حوالين العربية بالسحب (ماوس/صباع) أو العصاية اليمين، وبتقرّب/تبعد بالعجلة أو بصباعين
      cam.fov = 55; cam.near = 0.1;
      const o = this.orbit;
      if (this.attract) this._orbitBy(dt * 0.12, 0);
      const baseY = p.rig.body.position.y - ph.spec.cgHeight;
      const size = ph.spec.halfLength * 2, dist = (size * 0.9 + 3.2) * this.zoom.orbit;
      const yaw = root.rotation.y + Math.PI + o.yaw, cp = Math.cos(o.pitch);
      const focusY = baseY + (ph.spec.roofHeight ?? 2) * 0.45;
      const target = _v.set(root.position.x + Math.sin(yaw) * cp * dist, focusY + Math.sin(o.pitch) * dist, root.position.z + Math.cos(yaw) * cp * dist);
      // ماتدخلش جوه مبنى، وماتنزلش تحت الأرض
      this._avoidWalls(root.position.x, root.position.z, target);
      target.y = Math.max(target.y, groundHeight(target.x, target.z) + 0.45, baseY + 0.35);
      if (this.snap) o.pos.copy(target); else o.pos.lerp(target, Math.min(1, dt * 12));
      cam.position.copy(o.pos);
      cam.lookAt(root.position.x, focusY, root.position.z);
    }
    if (this.shake > 0) {
      // هزة الخبطة: موجات ناعمة (مش رقم عشوائي جديد كل فريم = رعشة)
      const t = (this._shT = (this._shT || 0) + dt);
      cam.position.x += (Math.sin(t * 37) + Math.sin(t * 23 + 1.3) * 0.5) * this.shake * 0.02;
      cam.position.y += (Math.sin(t * 31 + 0.7) + Math.sin(t * 19 + 2.1) * 0.5) * this.shake * 0.02;
    }
    cam.updateProjectionMatrix();
    this.snap = false;
  }
}
