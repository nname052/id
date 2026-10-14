import * as THREE from 'three';
import { VehiclePhysics, MICROBUS_SPEC } from '../physics/VehiclePhysics.js';
import { buildMicrobus } from './MicrobusModel.js';
import { analyzeVehicle, specFromModel, integrateHiace } from './HiaceIntegration.js';
import { PLAYER_START, ROAD, CROSSINGS } from '../world/layout.js';
import { groundHeight } from '../world/ground.js';
import { loopProject, loopAt } from '../traffic/TrafficSystem.js';

// الميكروباص بتاع اللاعب: بيربط الفيزياء بالموديل (عجل، دركسيون، عدادات، دواسات، فتيس، فرامل يد، سبحة، مرايات)

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const GEAR_POS = { '-1': [0.05, -0.06], 0: [0, 0], 1: [-0.05, 0.06], 2: [-0.05, -0.06], 3: [0, 0.06], 4: [0, -0.06], 5: [0.05, 0.06] };

export class PlayerVehicle {
  constructor(scene, assets) {
    this.scene = scene;
    this.physics = new VehiclePhysics(MICROBUS_SPEC, groundHeight);
    this.rig = buildMicrobus({ interior: true });
    scene.add(this.rig.root);
    this.prev = { x: 0, z: 0, yaw: 0, heave: 0, pitch: 0, roll: 0 };
    this.gearVis = new THREE.Vector2();
    this.hbVis = 0;
    this.glbSteering = null;
    this._applyGLB(assets?.get('microbus'), assets?.status?.microbus);
    this._setupMirrors();
    this._setupHeadlights();
    this.reset(true);
  }

  // ===== الهاي إس (GLB) — هو عربية اللاعب الوحيدة. مفيش رجوع للميكروباص القديم المتبني بالمكعبات =====
  _applyGLB(asset, status) {
    const fail = (msg) => {
      this.hiaceError = msg;
      this.rig.shell.visible = false; // منخبّيش الفشل بعربية تانية
      this.rig.mirrors = [];
      console.error('[HiAce] FAILED:', msg);
    };
    if (!asset) return fail(status?.error || 'microbus.glb was not loaded');
    try {
      const A = analyzeVehicle(asset.holder);
      if (!A.ok) return fail('could not detect the 4 wheels in the model');
      const spec = specFromModel(MICROBUS_SPEC, A);
      this.physics = new VehiclePhysics(spec, groundHeight);
      this.rig.shell.position.y = -spec.cgHeight;
      integrateHiace(this.rig, asset, spec, A);
      this.glbIntegrated = true;
      console.info('[HiAce] wheelBase', A.wheelBase.toFixed(2), 'track', A.track.toFixed(2), 'R', A.radius.toFixed(3), 'body', (spec.halfLength * 2).toFixed(2), 'x', (spec.halfWidth * 2).toFixed(2));
    } catch (e) {
      fail('integration error: ' + (e?.message || e));
    }
  }

  // ===== المرايات (Render to texture حقيقي) =====
  _setupMirrors() {
    this.mirrorCams = [];
    const eyeLocal = this.rig.eye ? this.rig.eye.position.clone() : new THREE.Vector3(-0.45, 1.8, -0.8);
    for (const m of this.rig.mirrors) {
      const aspect = m.aspect || 0.7;
      const rt = new THREE.WebGLRenderTarget(aspect > 1 ? 512 : 320, aspect > 1 ? Math.round(512 / aspect) : 448, { samples: 2 });
      rt.texture.repeat.x = -1; rt.texture.offset.x = 1; // انعكاس أفقي
      m.face.material = new THREE.MeshBasicMaterial({ map: rt.texture, toneMapped: true });
      // نوجّه المراية بحيث السواق يشوف اللي وراه
      const pos = m.holder.position.clone();
      const toEye = eyeLocal.clone().sub(pos).normalize();
      // المرايات الجانبية متظبطة لبره شوية (جنب العربية يبان شريط رفيع بس، زي السواق الحقيقي)
      const rear = new THREE.Vector3(m.side * (this.glbIntegrated ? 0.11 : 0.06), m.side ? -0.06 : -0.02, 1).normalize();
      const n = toEye.add(rear).normalize();
      m.holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const cam = new THREE.PerspectiveCamera(m.fov || 22, aspect, m.side === 0 ? 0.6 : 0.3, 160);
      this.mirrorCams.push({ m, rt, cam, renders: 0, error: null, blank: false, checked: false });
    }
    this._mirrorFrame = 0;
  }

  renderMirrors(renderer, scene, cameraPos) {
    if (!this.mirrorCams.length) return;
    // على الموبايل/الجودة الأقل: المرايات بتتحدّث كل كام فريم
    const skip = (this.mirrorSkip || 0) + (this.lowPower ? 1 : 0);
    if (skip && (this._skipN = ((this._skipN || 0) + 1) % (skip + 1)) !== 0) return;
    // الجانبية ليها الأولوية: شمال، يمين، شمال، يمين، الداخلية
    if (!this._order) {
      const L = this.mirrorCams.findIndex((c) => c.m.side === -1), R = this.mirrorCams.findIndex((c) => c.m.side === 1), I = this.mirrorCams.findIndex((c) => c.m.side === 0);
      this._order = [L, R, L, R, I].filter((k) => k >= 0);
    }
    const mc = this.mirrorCams[this._order[this._mirrorFrame++ % this._order.length]];
    const { m, rt, cam } = mc;
    const facePos = m.face.getWorldPosition(_v1);
    const n = _v2.set(0, 0, 1).applyQuaternion(m.face.getWorldQuaternion(_q1));
    const d = _v3.copy(facePos).sub(cameraPos).normalize();
    const r = d.sub(n.multiplyScalar(2 * d.dot(n)));
    cam.position.copy(facePos);
    cam.up.set(0, 1, 0);
    cam.lookAt(_v4.copy(facePos).add(r));
    try {
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      mc.renders++;
      mc.error = null;
      // مرة واحدة: نتأكد إن الصورة اللي في المراية مش فاضية (للتشخيص)
      if (!mc.checked && mc.renders >= 4) {
        mc.checked = true;
        const px = new Uint8Array(4 * 16);
        renderer.readRenderTargetPixels(rt, (rt.width >> 1) - 2, (rt.height >> 1) - 2, 4, 4, px);
        let mx = 0, mn = 255;
        for (let k = 0; k < px.length; k += 4) { const v = px[k] + px[k + 1] + px[k + 2]; mx = Math.max(mx, v); mn = Math.min(mn, v); }
        mc.blank = mx === 0;
      }
    } catch (e) {
      renderer.setRenderTarget(null);
      mc.error = e?.message || String(e);
    }
  }

  _setupHeadlights() {
    this.headlights = [];
    for (const sx of [-0.72, 0.72]) {
      const l = new THREE.SpotLight(0xfff2d8, 0, 70, 0.5, 0.55, 1.6);
      const sp = this.physics.spec, front = this.rig.dims ? this.rig.dims.frontF : 2.55;
      l.position.set(sx * (this.rig.dims ? 0.85 : 1), 0.8 - sp.cgHeight, -front + 0.05);
      l.target.position.set(sx * 1.5, -sp.cgHeight, -22);
      l.visible = false;
      this.rig.body.add(l, l.target);
      this.headlights.push(l);
    }
  }

  /** الليل: إضاءة التابلوه + تشغيل الكشافات تلقائيًا */
  setNight(on) {
    this._night = on;
    if (this.rig.gauges) for (const g of Object.values(this.rig.gauges)) g.mat.emissiveIntensity = on ? 0.55 : 0.0;
    if (this.rig.screen) this.rig.screen.emissiveIntensity = on ? 0.9 : 0.35;
    this.setHeadlights(on);
  }

  setHeadlights(on) {
    this.headOn = on;
    for (const l of this.headlights) { l.visible = on; l.intensity = on ? 220 : 0; }
    this.rig.lights.head.emissiveIntensity = on ? 2.2 : 0.0;
    if (this.rig.lights.fog) this.rig.lights.fog.emissiveIntensity = on ? 1.5 : 0;
  }

  toggleHeadlights() { this.setHeadlights(!this.headOn); return this.headOn; }

  /** R: رجّع الميكروباص للطريق */
  reset(initial = false) {
    const ph = this.physics;
    if (initial) { ph.reset(PLAYER_START.x, PLAYER_START.z, PLAYER_START.yaw); this._savePrev(); return; }
    let { x, z } = ph;
    const facingNorth = Math.cos(ph.yaw) < 0; // بيبص ناحية +Z
    const onCross = CROSSINGS.find((c) => Math.abs(z - c.z) < c.half && Math.abs(x) > ROAD.curb);
    if (onCross) {
      z = onCross.z + (Math.sin(ph.yaw) < 0 ? 3.2 : -3.2);
      x = THREE.MathUtils.clamp(x, onCross.xMin + 6, onCross.xMax - 6);
      ph.reset(x, z, Math.sin(ph.yaw) < 0 ? -Math.PI / 2 : Math.PI / 2);
    } else {
      // أقرب حارة على المسار (مدينة أو طريق) في نفس اتجاهك
      const pr = loopProject(x, z);
      if (!pr) { ph.reset(PLAYER_START.x, PLAYER_START.z, PLAYER_START.yaw); this._savePrev(); return; }
      const q = loopAt(pr.s);
      const fwd = ph.forward;
      const dir = fwd[0] * q.dx + fwd[1] * q.dz >= 0 ? 1 : -1;
      const off = dir * ROAD.lanes[0];
      ph.reset(q.x + q.rx * off, q.z + q.rz * off, dir > 0 ? Math.atan2(-q.dx, -q.dz) : Math.atan2(q.dx, q.dz));
    }
    void facingNorth;
    this._savePrev();
  }

  _savePrev() {
    const ph = this.physics, p = this.prev;
    p.x = ph.x; p.z = ph.z; p.yaw = ph.yaw; p.heave = ph.heave; p.pitch = ph.pitch; p.roll = ph.roll;
  }

  /** قبل كل خطوة فيزياء */
  beforeStep() { this._savePrev(); }

  /** تحديث الشكل (alpha = نسبة الاستيفاء بين آخر خطوتين فيزياء) */
  syncVisuals(dt, alpha = 1) {
    const ph = this.physics, p = this.prev, rig = this.rig;
    const L = (a, b) => a + (b - a) * alpha;
    let dy = ph.yaw - p.yaw;
    rig.root.position.set(L(p.x, ph.x), 0, L(p.z, ph.z));
    rig.root.rotation.y = p.yaw + dy * alpha;
    rig.body.position.y = L(p.heave, ph.heave);
    rig.body.rotation.set(L(p.pitch, ph.pitch), 0, L(p.roll, ph.roll), 'YXZ');

    // العجل
    const R = ph.spec.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const w = rig.wheels[i], pw = ph.wheels[i];
      w.group.position.y = pw.centerY;
      if (w.front) w.group.rotation.y = ph.steerAngle;
      w.spin.rotation.x = -pw.spin;
    }
    if (rig.contactShadow) rig.contactShadow.position.y = 0.012 + groundHeight(rig.root.position.x, rig.root.position.z);

    // الدركسيون
    const swa = ph.steeringWheelAngle;
    if (rig.steering) rig.steering.rotation.z = swa;
    if (this.glbSteering) {
      const g = this.glbSteering;
      g.node.quaternion.copy(g.q0).multiply(_q2.setFromAxisAngle(g.axis, swa));
    }

    if (!rig.gauges) return;
    // العدادات
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const needle = (t) => -(a0 + (a1 - a0) * THREE.MathUtils.clamp(t, 0, 1)) - Math.PI / 2;
    rig.gauges.speed.pivot.rotation.z = needle((ph.speed * 3.6) / (rig.gauges.fuel ? 180 : 160));
    rig.gauges.rpm.pivot.rotation.z = needle(ph.rpm / 5000);
    if (rig.gauges.fuel) rig.gauges.fuel.pivot.rotation.z = needle(0.68);
    // الدواسات
    const k = Math.min(1, dt * 14);
    const P = rig.pedals;
    P.gas.rotation.x += (-0.4 + ph.throttle * 0.32 - P.gas.rotation.x) * k;
    P.brake.rotation.x += (-0.4 + ph.brake * 0.3 - P.brake.rotation.x) * k;
    if (P.clutch) P.clutch.rotation.x += (-0.4 + (ph.shiftTimer > 0 ? 0.32 : 0) - P.clutch.rotation.x) * k;
    const mode = ph.gearMode;
    if (rig.gearGate) {
      // فتيس أوتوماتيك على التابلوه: P R N D
      const idx = { R: 1, N: 2, D: 3 }[mode];
      const ty = rig.gearGate.top - idx * rig.gearGate.step;
      rig.gearGate.base.position.y += (ty - rig.gearGate.base.position.y) * Math.min(1, dt * 12);
    } else {
      const gp = GEAR_POS[ph.shiftTimer > 0.15 ? 0 : ph.gear] || [0, 0];
      this.gearVis.x += (gp[0] - this.gearVis.x) * Math.min(1, dt * 10);
      this.gearVis.y += (gp[1] - this.gearVis.y) * Math.min(1, dt * 10);
      rig.gearLever.rotation.set(0.35 - this.gearVis.y * 5, 0, -this.gearVis.x * 5);
    }
    if (rig.gearDisplay && mode !== this._mode) { this._mode = mode; rig.gearDisplay.set(mode); }
    // فرامل اليد
    this.hbVis += (ph.handbrake - this.hbVis) * Math.min(1, dt * 12);
    rig.handbrake.rotation.x = 0.15 + this.hbVis * 0.5;
    // الحاجات المتعلقة (سبحة، عين زرقا): بندول بيتأثر بالتسارع والميل، كل واحدة بطولها
    const g = 9.81, hdt = Math.min(dt, 0.04);
    for (const h of rig.hangers || [{ obj: rig.sebha, L: 0.2 }]) {
      const s = (h.st ||= { ax: 0, vx: 0, az: 0, vz: 0 }), Lp = h.L;
      s.vx += (-(g / Lp) * Math.sin(s.ax) + -(ph.accelLong / Lp) * Math.cos(s.ax) * 0.8) * hdt; s.vx *= 1 - 1.2 * hdt; s.ax += s.vx * hdt;
      s.vz += (-(g / Lp) * Math.sin(s.az) - (ph.accelLat / Lp) * Math.cos(s.az) * 0.8 + ph.rollVel * 4) * hdt; s.vz *= 1 - 1.2 * hdt; s.az += s.vz * hdt;
      h.obj.rotation.set(s.ax, 0, s.az);
    }
    // فوانيس الفرامل
    rig.lights.tail.emissiveIntensity = ph.brake > 0.05 || ph.handbrake > 0.1 ? 4 : this._night ? 1.2 : 0.15;
  }
}
