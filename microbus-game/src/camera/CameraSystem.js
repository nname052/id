import * as THREE from 'three';
import { ROAD, CROSSINGS } from '../world/layout.js';
import { LOOP, loopAt } from '../traffic/TrafficSystem.js';
import { groundHeight } from '../world/ground.js';

// 4 كاميرات: كرسي السائق / ورا الميكروباص / خارجية قريبة / سينمائية. زرار C للتبديل.

export const CAMERA_MODES = [
  { id: 'cockpit', label: 'من كرسي السائق' },
  { id: 'chase', label: 'خلف الميكروباص' },
  { id: 'close', label: 'خارجية قريبة' },
  { id: 'cinematic', label: 'سينمائية' },
];

const _bus = new THREE.Vector3(), _q3 = new THREE.Quaternion(), _v2 = new THREE.Vector3();
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
    this.cine = { pos: new THREE.Vector3(), target: new THREE.Vector3(), timer: 0 };
    this.cinePoints = this._cinePoints();
    this.shake = 0;
    this._initMouse(dom);
    this.snap = true;
  }

  get modeId() { return CAMERA_MODES[this.mode]?.id || 'free'; }

  next() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.snap = true;
    this.look.yaw = 0; this.look.pitch = 0;
    return CAMERA_MODES[this.mode].label;
  }

  _initMouse(dom) {
    dom.addEventListener('pointerdown', (e) => { this.look.dragging = true; this.look.lastX = e.clientX; this.look.lastY = e.clientY; });
    window.addEventListener('pointerup', () => { this.look.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.look.dragging) return;
      const dx = e.clientX - this.look.lastX, dy = e.clientY - this.look.lastY;
      this.look.lastX = e.clientX; this.look.lastY = e.clientY;
      this.look.yaw = THREE.MathUtils.clamp(this.look.yaw - dx * 0.004, -2.2, 2.2);
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - dy * 0.003, -0.7, 0.6);
      this.look.idle = 0;
    });
  }

  _cinePoints() {
    const pts = [];
    for (let z = ROAD.zMax - 15; z > ROAD.zMin + 10; z -= 28) {
      const side = (Math.round(z / 28) % 2) ? 1 : -1;
      // يا تحت أوراق الشجر (1.5م) يا فوقها (9.5م) عشان الكاميرا متدخلش جوه شجرة
      const high = Math.round(z / 28) % 3 === 0;
      pts.push(new THREE.Vector3(side * (ROAD.sidewalkOuter - 0.7), high ? 9.5 : 1.5, z));
    }
    for (const c of CROSSINGS) {
      pts.push(new THREE.Vector3(ROAD.curb + 4, 9, c.z + c.half + 6));
      pts.push(new THREE.Vector3(-(ROAD.curb + 4), 4, c.z - c.half - 6));
    }
    // كاميرات على طول الطريق الكبير (على الجنب، واطية أو عالية)
    for (let s = 470, k = 0; s < LOOP.length - 20; s += 55, k++) {
      const q = loopAt(s);
      const side = k % 2 ? 1 : -1, d = side * 14.5;
      const x = q.x + q.rx * d, z = q.z + q.rz * d;
      const y = Math.max(groundHeight(x, z), q.y) + (k % 3 === 0 ? 8 : 1.6);
      pts.push(new THREE.Vector3(x, y, z));
    }
    return pts;
  }

  /** look: دخل الجيم باد (العصاية اليمين) */
  update(dt, input) {
    if (this.mode === 99) return; // كاميرا حرة للتجربة
    const p = this.player;
    const ph = p.physics;
    const cam = this.camera;
    const root = p.rig.root;
    const id = this.modeId;

    if (input && (Math.abs(input.lookX) > 0.1 || Math.abs(input.lookY) > 0.1)) {
      this.look.yaw = THREE.MathUtils.clamp(this.look.yaw - input.lookX * dt * 2.5, -2.2, 2.2);
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - input.lookY * dt * 1.5, -0.7, 0.6);
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
      // زاوية رؤية أفقية ثابتة ~100° (مناسبة لشاشات الموبايل العريضة والكمبيوتر)
      const hf = THREE.MathUtils.degToRad(100);
      cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / cam.aspect)), 52, 74);
      cam.near = 0.04;
      // قصور الراس (head inertia): زنبرك بسيط
      const target = _v.set(
        THREE.MathUtils.clamp(-ph.accelLat * 0.006, -0.05, 0.05),
        THREE.MathUtils.clamp(-ph.heaveVel * 0.01, -0.03, 0.03),
        THREE.MathUtils.clamp(ph.accelLong * 0.007, -0.05, 0.05),
      );
      const k = 60, d = 11;
      this.headVel.addScaledVector(target.sub(this.headOffset), k * dt).multiplyScalar(Math.max(0, 1 - d * dt));
      this.headOffset.addScaledVector(this.headVel, dt);
      const eye = p.rig.eye;
      eye.updateWorldMatrix(true, false);
      // لما تبص ورا: الراس بتلف وتميل ناحية نص الكابينة (زي السواق الحقيقي وهو بيرجع)
      const ay = Math.abs(this.look.yaw);
      const turn = Math.min(1, Math.max(0, (ay - 1.0) / 1.6));
      const lean = _v2.set(0.34 * turn, 0.1 * turn, 0.18 * turn);
      const pos = _v.copy(this.headOffset).add(lean).applyMatrix4(eye.matrixWorld);
      cam.position.copy(pos);
      p.rig.body.getWorldQuaternion(_q);
      // بص شوية في اتجاه اللفة (زي السواق الحقيقي)
      const steerLook = ph.steerSmooth * 0.16 * Math.min(1, Math.abs(ph.forwardSpeed) / 3 + 0.3);
      _e.set((p.rig.eyePitch ?? -0.2) + this.look.pitch, this.look.yaw + steerLook, 0, 'YXZ');
      cam.quaternion.copy(_q).multiply(_q3.setFromEuler(_e));
    } else if (id === 'chase') {
      cam.fov = 60; cam.near = 0.1;
      const yaw = ph.yaw;
      if (this.snap) this.chaseYaw = yaw;
      let diff = yaw - this.chaseYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.chaseYaw += diff * Math.min(1, dt * 3.2);
      const dist = 8.2 + Math.min(ph.speed, 20) * 0.08;
      const camYaw = this.chaseYaw + this.look.yaw;
      const baseY = ph.heave - ph.spec.cgHeight;
      const target = _v.set(root.position.x + Math.sin(camYaw) * dist, baseY + 3.3 + this.look.pitch * 3, root.position.z + Math.cos(camYaw) * dist);
      if (this.snap) this.chasePos.copy(target); else this.chasePos.lerp(target, Math.min(1, dt * 9));
      cam.position.copy(this.chasePos);
      const fwd = ph.forward;
      cam.lookAt(root.position.x + fwd[0] * 2.5, baseY + 1.4, root.position.z + fwd[1] * 2.5);
    } else if (id === 'close') {
      cam.fov = 55; cam.near = 0.1;
      _m.makeRotationY(ph.yaw + this.look.yaw * 1.4);
      const off = _v.set(2.5, 1.15 + this.look.pitch * 2, -3.7).applyMatrix4(_m);
      const baseY = ph.heave - ph.spec.cgHeight;
      cam.position.set(root.position.x + off.x, baseY + off.y, root.position.z + off.z);
      cam.lookAt(root.position.x, baseY + 0.75, root.position.z);
    } else {
      // سينمائية: كاميرات ثابتة على الرصيف بتتابع الميكروباص
      const c = this.cine;
      const bus = _bus.set(root.position.x, ph.heave - ph.spec.cgHeight, root.position.z);
      const d = c.pos.distanceTo(bus);
      const fwd = ph.forward;
      const behind = (c.pos.x - bus.x) * fwd[0] + (c.pos.z - bus.z) * fwd[1] < -12;
      if (this.snap || d > 75 || behind) {
        let best = null, bestScore = Infinity;
        for (const pt of this.cinePoints) {
          const ahead = (pt.x - bus.x) * fwd[0] + (pt.z - bus.z) * fwd[1];
          const dist = pt.distanceTo(bus);
          if (ahead < 8 || dist > 70) continue;
          const score = Math.abs(dist - 35);
          if (score < bestScore) { bestScore = score; best = pt; }
        }
        if (!best) best = new THREE.Vector3(bus.x + fwd[0] * 30 + 6, bus.y + 3, bus.z + fwd[1] * 30);
        c.pos.copy(best);
        c.target.copy(bus);
      }
      c.target.lerp(_v.set(bus.x, bus.y + 1.2, bus.z), Math.min(1, dt * 4));
      cam.position.copy(c.pos);
      cam.lookAt(c.target);
      cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(5.5 / Math.max(5, d))), 14, 60);
      cam.near = 0.1;
    }
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.06;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.06;
    }
    cam.updateProjectionMatrix();
    this.snap = false;
  }
}
