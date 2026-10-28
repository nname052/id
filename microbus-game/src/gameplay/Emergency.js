// =====================================================================
//  الإسعاف (شبين): لما ماشي يتخبط خبطة جامدة:
//   1) عربية إسعاف بتطلع من طريق على بُعد ~250م وجاية على شبكة الطرق بالسارينة والكشاف (أحمر/أزرق)
//   2) بتقف جنب المصاب، مسعفين اتنين بينزلوا من ورا، بيوصلوا له وبيكشفوا عليه شوية
//   3) بيشيلوه على نقالة لحد العربية، والعربية بتتحرك على أقرب مستشفى في البيانات (OSM) بالسارينة
//   (من غير أي مشاهد دموية: المصاب نايم بس، وبقعة صغيرة غامقة تحته)
//  المرور بيقف قبل المصاب وقبل عربية الإسعاف وهي واقفة.
// =====================================================================
import * as THREE from 'three';
import { findRoute } from '../nav/RoadGraph.js';
import { canvas, tex } from '../render/textures.js';

const V_MAX = 13;

function signTex(text, w = 512, h = 128, bg = null, fg = '#c81414') {
  const c = canvas(w, h), x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); } else x.clearRect(0, 0, w, h);
  x.fillStyle = fg; x.font = `bold ${Math.round(h * 0.62)}px Cairo, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.fillText(text, w / 2, h / 2 + 4);
  return tex(c, { repeat: false, aniso: 4 });
}

export class Emergency {
  constructor(scene, { world, crowd, traffic, makeBody, audio, hud } = {}) {
    Object.assign(this, { scene, world, crowd, traffic, audio, hud });
    this.jobs = [];
    this._makeBody = makeBody;
    this.hospitals = (world.landmarks?.confirmed || []).filter((l) => l.kind === 'hospital');
    this.dispatched = 0; this.delivered = 0;
  }

  _ambulance() {
    if (this._rig) return this._rig;
    const rig = this._makeBody('microbus');
    // أبيض + شريط أحمر + "إسعاف" على الجنبين والكبوت + كشاف فوق
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf6f6f2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    rig.root.traverse((o) => { if (o.isMesh && (o.userData.matName || '').toLowerCase() === 'paint') o.material = white; });
    const body = rig.body || rig.root;
    const bb = new THREE.Box3().setFromObject(rig.root);
    const hw = (bb.max.x - bb.min.x) / 2 - 0.2, L = bb.max.z - bb.min.z;
    const stripe = new THREE.MeshBasicMaterial({ color: 0xd8261c, side: THREE.DoubleSide });
    const word = new THREE.MeshBasicMaterial({ map: signTex('إسعاف'), transparent: true, side: THREE.DoubleSide, depthWrite: false });
    for (const sx of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.86, 0.22), stripe); s.position.set(sx * (hw + 0.215), 0.95, 0); s.rotation.y = sx * Math.PI / 2; body.add(s);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), word); w.position.set(sx * (hw + 0.22), 1.35, 0.3); w.rotation.y = sx * Math.PI / 2; body.add(w);
    }
    const bar = new THREE.Group(); bar.position.set(0, bb.max.y - bb.min.y + 0.08, -L / 2 + 1.4); body.add(bar);
    const red = new THREE.MeshStandardMaterial({ color: 0x500000, emissive: 0xff1a10, emissiveIntensity: 0 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x000a50, emissive: 0x1050ff, emissiveIntensity: 0 });
    for (const [m, x] of [[red, -0.32], [blue, 0.32]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.26), m); b.position.x = x; bar.add(b); }
    rig.bar = { red, blue };
    // النقالة (بتظهر لما بيشيلوا المصاب)
    const st = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 1.95), new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.6 }));
    top.position.y = 0.72; st.add(top);
    for (const [x, z] of [[-0.26, -0.85], [0.26, -0.85], [-0.26, 0.85], [0.26, 0.85]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.04), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6 })); l.position.set(x, 0.35, z); st.add(l); }
    st.visible = false; this.scene.add(st);
    rig.stretcher = st;
    rig.col = { cx: 0, cz: 0, hx: 1.0, hz: L / 2, angle: 0, restitution: 0.2, kind: 'car', mass: 2600, vx: 0, vz: 0 };
    rig.halfLen = L / 2;
    rig.root.visible = false;
    this.scene.add(rig.root);
    this._rig = rig;
    return rig;
  }

  /** مصاب خطير → إسعاف (واحدة شغالة بس في نفس الوقت؛ اللي بعدها بتستنى) */
  dispatch(victim) {
    this.dispatched++;
    this.jobs.push({ victim, state: 'wait', t: 6 + Math.random() * 3 });
    this.hud?.toast('🚑 حد اتصل بالإسعاف — جاية في الطريق', 3);
  }

  _routeTo(x0, z0, x1, z1) {
    const r = findRoute(x0, z0, x1, z1);
    if (!r || !r.pts || r.pts.length < 2) return null;
    return r;
  }

  _startDrive(J, r) { J.route = r; J.rs = 0; J.v = 0; }

  update(dt, cam) {
    const J = this.jobs[0];
    if (!J) return;
    const rig = this._ambulance(), P = J.victim;
    const tm = performance.now() / 1000;
    // الكشاف بيلمع وهي شغالة
    const on = J.state !== 'wait' && J.state !== 'gone';
    rig.bar.red.emissiveIntensity = on && Math.floor(tm * 3) % 2 === 0 ? 4 : 0;
    rig.bar.blue.emissiveIntensity = on && Math.floor(tm * 3) % 2 === 1 ? 4 : 0;
    if (J.state === 'wait') {
      J.t -= dt; if (J.t > 0) return;
      // طالعة من طريق على بُعد 200-320م من المصاب
      // (كانت 10 محاولات بس، ولو فشلت الإسعاف ماكانتش بتيجي خالص والمصاب بيختفي — دلوقتي لازم تيجي)
      let r = null;
      for (let k = 0; k < 40 && !r; k++) {
        const a = Math.random() * Math.PI * 2, d = (k < 20 ? 200 : 90) + Math.random() * 140;
        r = this._routeTo(P.x + Math.cos(a) * d, P.z + Math.sin(a) * d, P.x, P.z);
        if (r && r.length < (k < 20 ? 120 : 50)) r = null;
      }
      if (!r) { J.t = 2; J.tries = (J.tries || 0) + 1; if (J.tries > 5) { this.jobs.shift(); this.crowd.removeVictim(P); } return; }
      this._startDrive(J, r); J.state = 'drive';
      rig.root.visible = true;
    }
    if (J.state === 'drive' || J.state === 'leave') {
      const R = J.route;
      // قبل آخر المسار (أو عند المصاب): تهدية ناعمة
      const left = R.length - J.rs;
      const vT = Math.min(V_MAX, Math.sqrt(Math.max(0, 2 * 2.2 * (left - (J.state === 'drive' ? 6 : 0)))));
      J.v += Math.max(-4 * dt, Math.min(2 * dt, vT - J.v));
      J.rs += J.v * dt;
      this._placeOn(rig, R, J.rs, J.v);
      this.audio?.sirenAt?.(rig.root.position.x, 1.5, rig.root.position.z, true);
      if (J.state === 'drive' && (left < 7 || Math.hypot(rig.root.position.x - P.x, rig.root.position.z - P.z) < 7.5) && J.v < 1) {
        J.state = 'medics'; J.t = 0; J.v = 0;
        const [fx, fz] = [Math.sin(rig.yaw), Math.cos(rig.yaw)];
        J.back = { x: rig.root.position.x - fx * (rig.halfLen + 0.6), z: rig.root.position.z - fz * (rig.halfLen + 0.6) };
        J.medics = [0, 1].map((i) => ({ variant: 3 + i * 5, x: J.back.x + (i ? 0.5 : -0.5), z: J.back.z, y: this.world.height(J.back.x, J.back.z, 0), yaw: 0, amp: 0.8, phase: i * 2 }));
      }
      if (J.state === 'leave' && (left < 5 || (J.t += dt) > 70 || (J.t > 15 && Math.hypot(rig.root.position.x - cam.x, rig.root.position.z - cam.z) > 450))) {
        J.state = 'gone';
      }
    }
    if (J.state === 'medics' || J.state === 'carry' || J.state === 'load') this._medics(J, rig, dt);
    if (J.state === 'gone') {
      rig.root.visible = false; rig.stretcher.visible = false; this.crowd.extras.length = 0;
      this.jobs.shift(); this.delivered++;
    }
    // تصادم: عربية الإسعاف
    const p = rig.root.position;
    Object.assign(rig.col, { cx: p.x, cz: p.z, angle: rig.yaw || 0, vx: Math.sin(rig.yaw || 0) * (J.v || 0), vz: Math.cos(rig.yaw || 0) * (J.v || 0) });
  }

  _placeOn(rig, R, s, v) {
    const P = R.pts, C = R.cum || (R.cum = (() => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z)); return c; })());
    s = Math.min(s, C[C.length - 1]);
    let i = 0; while (i < P.length - 2 && C[i + 1] < s) i++;
    const a = P[i], b = P[i + 1], L = C[i + 1] - C[i] || 1, t = (s - C[i]) / L;
    // على يمين الطريق شوية (مش في نصه)
    const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
    const x = a.x + (b.x - a.x) * t - dz * 1.6, z = a.z + (b.z - a.z) * t + dx * 1.6;
    const yaw = Math.atan2(dx, dz);
    rig.yaw = rig.yaw === undefined ? yaw : rig.yaw + Math.atan2(Math.sin(yaw - rig.yaw), Math.cos(yaw - rig.yaw)) * Math.min(1, 0.15 + v * 0.02);
    rig.root.position.set(x, this.world.height(x, z, 0.5), z);
    // (rig.yaw = اتجاه السير الفعلي؛ موديل الميكروباص وشه ناحية -z → +π: كانت ماشية بضهرها)
    rig.root.rotation.set(0, rig.yaw + Math.PI, 0);
    for (const w of rig.wheels || []) w.spin && (w.spin.rotation.x -= v * 0.016 / 0.33);
  }

  _medics(J, rig, dt) {
    const P = J.victim, M = J.medics, ex = this.crowd.extras;
    J.t += dt;
    const walk = (m, tx, tz, sp) => { const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz); if (d < 0.15) { m.amp = 0; return true; } m.x += dx / d * Math.min(d, sp * dt); m.z += dz / d * Math.min(d, sp * dt); m.yaw = Math.atan2(dx, dz); m.amp = 0.9; m.phase += dt * 6; m.y = this.world.height(m.x, m.z, 0); return false; };
    const lying = { variant: P.variant, x: P.x, y: P.hit?.y ?? 0, z: P.z, yaw: P.heading, fall: 1 };
    if (J.state === 'medics') {
      // يروحوا عند المصاب (واحد عند راسه وواحد عند رجليه) ويكشفوا 4 ثواني
      const hx = Math.sin(P.heading), hz = Math.cos(P.heading);
      const a = walk(M[0], P.x - hz * 0.7, P.z + hx * 0.7, 1.5), b = walk(M[1], P.x + hz * 0.7, P.z - hx * 0.7, 1.5);
      if (a && b) { J.kneel = (J.kneel || 0) + dt; M.forEach((m) => { m.yaw = Math.atan2(P.x - m.x, P.z - m.z); m.armR = 0.6; m.armL = 0.6; }); }
      if (J.kneel > 4) {
        J.state = 'carry'; J.carry = { x: P.x, z: P.z };
        this.crowd.removeVictim(P); // المصاب بقى على النقالة (بيترسم مع المسعفين)
        rig.stretcher.visible = true;
        this.hud?.toast('🚑 المسعفين شالوا المصاب — رايحين المستشفى', 3);
      }
      ex.length = 0; ex.push(...M, lying);
      return;
    }
    if (J.state === 'carry') {
      // النقالة بين الاتنين، ماشيين لضهر العربية
      const C = J.carry, dx = J.back.x - C.x, dz = J.back.z - C.z, d = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      if (d > 0.2) { C.x += dx / d * Math.min(d, 1.1 * dt); C.z += dz / d * Math.min(d, 1.1 * dt); }
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      M[0].x = C.x + fx * 1.25; M[0].z = C.z + fz * 1.25; M[1].x = C.x - fx * 1.25; M[1].z = C.z - fz * 1.25;
      for (const m of M) { m.yaw = yaw; m.amp = d > 0.2 ? 0.7 : 0; m.phase += dt * 5; m.armR = 0.9; m.armL = 0.9; m.y = this.world.height(m.x, m.z, 0); }
      const gy = this.world.height(C.x, C.z, 0);
      rig.stretcher.position.set(C.x, gy, C.z); rig.stretcher.rotation.y = yaw;
      ex.length = 0; ex.push(...M, { variant: P.variant, x: C.x - fx * 0.85, y: gy + 0.78, z: C.z - fz * 0.85, yaw: yaw + Math.PI, fall: 1 });
      if (d <= 0.2) { J.state = 'load'; J.t = 0; }
      return;
    }
    if (J.state === 'load') {
      // دخّلوه العربية: النقالة والمسعفين بيختفوا، والعربية تتحرك على المستشفى
      if (J.t < 1.2) return;
      rig.stretcher.visible = false; ex.length = 0;
      const x = rig.root.position.x, z = rig.root.position.z;
      let H = null, bd = Infinity;
      for (const h of this.hospitals) { const d = Math.hypot(h.x - x, h.z - z); if (d < bd) { bd = d; H = h; } }
      const r = H && this._routeTo(x, z, H.x, H.z);
      if (!r) { J.state = 'gone'; return; }
      J.hospital = H?.name;
      this._startDrive(J, r); J.state = 'leave'; J.t = 0;
    }
  }

  colliders(box, out) {
    const rig = this._rig;
    if (rig?.root.visible && Math.abs(rig.col.cx - box.cx) < 30 && Math.abs(rig.col.cz - box.cz) < 30) out.push(rig.col);
  }

  /** للمرور: يقفوا قبل المصاب وقبل الإسعاف وهي واقفة */
  get stopZones() {
    const out = [];
    for (const v of this.crowd.victims) out.push({ x: v.x, z: v.z, r: 3, gap: 4 });
    const J = this.jobs[0], rig = this._rig;
    if (J && rig?.root.visible && J.state !== 'drive' && J.state !== 'leave') out.push({ x: rig.root.position.x, z: rig.root.position.z, r: 2.4, gap: rig.halfLen + 1.5 });
    return out;
  }

  debugStats() { const J = this.jobs[0]; return { dispatched: this.dispatched, delivered: this.delivered, state: J?.state || 'idle', hospital: J?.hospital || null }; }
}
