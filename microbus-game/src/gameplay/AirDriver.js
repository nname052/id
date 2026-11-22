// =====================================================================
//  الطيران في اللعبة (STAGE 7): زي TrainDriver — اللاعب بيسيب العربية ويطير هليكوبتر أو طيارة ركاب.
//  - الموديلات بتتحمّل وقت ما تختار (مش مع تحميل اللعبة)، والفيزيا في vehicles/Aircraft.js (خطوة ثابتة 1/120 ث)
//  - الأرض للطيران = ارتفاع الشوارع/الكباري + أسطح المباني (تقدر تنزل الهليكوبتر على سطح) + الأهرامات/البرج + المطار؛
//    المية = تحطم. خبطة من الجنب في مبنى = تحطم. ريشة الهليكوبتر في حيطة = تحطم.
//  - الطيارة بتبدأ على أول الممر في "منطقة الطيران" (مطار اللعبة جنب المدينة)، والهليكوبتر من مكانك لو فيه مساحة
//    (مفيش مباني جنبك في نص قطر الريشة) — غير كده من مهبط في المطار.
//  - الكاميرات: كابينة / ورا من فوق / حرة حوالين الطيارة (نفس زرار الكاميرا).
// =====================================================================
import * as THREE from 'three';
import { AIRCRAFT_ASSETS } from '../config/assets.config.js';
import { PlaneFDM, HeliFDM, buildAircraftRig, syncAircraftRig } from '../vehicles/Aircraft.js';
import { Airport } from '../world/Airport.js';
import { FlightAudio } from '../audio/FlightAudio.js';
import { FlightMissions } from './FlightMissions.js';

const STEP = 1 / 120;
const MODEL = { heli: 'heli_206', plane: 'plane_a320' };
const WATER_Y = -0.55, WATER_FLOOR = -0.9;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

const pip = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const segD = (px, pz, ax, az, bx, bz) => { const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9, t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2)); return Math.hypot(px - ax - ex * t, pz - az - ez * t); };

export class AirDriver {
  constructor(game) {
    this.g = game; this.W = game.world; this.kind = null; this.rigs = {}; this.acc = 0; this.crashT = 0; this.orbit = 0;
    this._eye = null; this._look = null;
  }

  get active() { return !!this.kind; }

  async enter(kind) {
    const g = this.g;
    this.airport ||= new Airport(g.scene, this.W);
    const key = MODEL[kind];
    let rig = this.rigs[kind];
    if (!rig) {
      g.hud.toast(kind === 'heli' ? '🚁 بنجهّز الهليكوبتر…' : '✈️ بنجهّز الطيارة…', 2);
      const asset = await g.assets.loadLazy(key, AIRCRAFT_ASSETS[key]);
      rig = this.rigs[kind] = buildAircraftRig(asset, kind);
    }
    this.kind = kind; this.rig = rig;
    g.scene.add(rig.root);
    this.fdm = kind === 'plane' ? new PlaneFDM() : new HeliFDM({ cg: rig.cg, hub: rig.hub, R: rig.R || 5.6, skids: rig.skids, tailZ: rig.tailZ, tailY: rig.tailY });
    this.cg = kind === 'plane' ? this.fdm.s.cg : rig.cg;
    this._index();
    this.spawn();
    this._envOn();
    this.audio ||= new FlightAudio(g.audio);
    this.audio.start(kind);
    (this.mission ||= new FlightMissions(this)).start();
    const keys = g.mobile ? '' : kind === 'plane' ? ' — W/S دفع، الأسهم العصاية، A/D الدفة، V/X القلابات، G العجل، Space فرامل' : ' — W/S الـ collective، الأسهم العصاية، A/D البدالات، Z مساعد الثبات';
    g.hud.toast(kind === 'plane' ? `✈️ إنت على أول الممر في منطقة الطيران${keys}` : `🚁 الريشة بتدور… ارفع الـ collective لحد ~57% عشان تحوم${keys}`, 6);
    return true;
  }

  exit() {
    const g = this.g;
    if (!this.kind) return;
    this.rig.root.removeFromParent();
    this.audio?.stop();
    this._envOff();
    this.mission?.clear?.();
    const B = this.fdm.B;
    this.kind = null;
    // العربية بتنزل على أقرب شارع (لو برّه المدينة: مكان البداية)
    const rp = this.W.roadPose?.(B.pos.x, B.pos.z);
    const sp = rp && Math.hypot(rp.x - B.pos.x, rp.z - B.pos.z) < 150 ? rp : this.W.spawnPose?.();
    if (sp) { g.player.physics.reset(sp.x, sp.z, sp.yaw || 0); g.player._savePrev?.(); }
  }

  /** مكان البداية */
  spawn(again = false) {
    const F = this.fdm, A = this.airport, ph = this.g.player.physics;
    if (this.kind === 'plane') {
      const s = A.runwayStart(1); F.place(s.x, 0, s.z, s.yaw);
      this.home = { x: s.x, z: s.z, yaw: s.yaw };
    } else {
      let p = again && this.home ? this.home : null;
      if (!p) {
        const R = (this.rig.R || 5.6) + 1.5;
        p = this._clearAt(ph.x, ph.z, R) ? { x: ph.x, z: ph.z, yaw: ph.yaw } : null;
        if (!p) { const hp = A.helipads[1]; p = { x: hp.x, z: hp.z, yaw: Math.PI / 2 }; this.g.hud.toast('🚁 مفيش مساحة للريشة جنبك — بدأت من مهبط المطار', 3); }
      }
      F.place(p.x, this._terrain(p.x, p.z, 50), p.z, p.yaw);
      this.home = p;
    }
    this.crashT = 0; this.acc = 0;
    syncAircraftRig(this.rig, F, 0, this.cg);
    this.g.cams.snap = true; this._eye = null;
  }

  // ===================== الأرض والعوائق =====================
  _index() {
    const L = this.W._bldFoot || [];
    if (this._nIdx === L.length) return;
    this._nIdx = L.length;
    const grid = (this.grid = new Map()), CS = 25;
    let maxH = 0;
    for (const b of L) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of b.P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const o = { P: b.P, h: b.h || 10, x0, x1, z0, z1 }; maxH = Math.max(maxH, o.h);
      for (let i = Math.floor(x0 / CS); i <= Math.floor(x1 / CS); i++) for (let j = Math.floor(z0 / CS); j <= Math.floor(z1 / CS); j++) { const k = i * 100003 + j; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(o); }
    }
    for (const o of this.W.airObstacles || []) maxH = Math.max(maxH, o.h);
    this.maxH = Math.max(maxH, 50);
  }

  /** أعلى سطح مبنى/معلم عند النقطة */
  _roof(x, z) {
    let h = 0;
    const a = this.grid?.get(Math.floor(x / 25) * 100003 + Math.floor(z / 25));
    if (a) for (const o of a) if (o.h > h && x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && pip(o.P, x, z)) h = o.h;
    for (const o of this.W.airObstacles || []) {
      const dx = x - o.cx, dz = z - o.cz;
      if (o.kind === 'pyr') {
        const c = Math.cos(o.ang), s = Math.sin(o.ang), lx = dx * c + dz * s, lz = -dx * s + dz * c;
        const k = Math.max(Math.abs(lx) / o.hw, Math.abs(lz) / o.hd); if (k < 1) h = Math.max(h, o.h * (1 - k));
      } else if (dx * dx + dz * dz < o.r * o.r) h = Math.max(h, o.h);
    }
    if (this.airport) h = Math.max(h, this.airport.roofAt(x, z));
    return h;
  }

  _terrain(x, z, y) {
    const t = this.W.height(x, z, y);
    return t <= WATER_FLOOR + 0.05 ? WATER_Y : t;
  }

  /** دالة الأرض للفيزيا: { y, water, roof } */
  _groundFn() {
    if (this._gf) return this._gf;
    const out = { y: 0, water: false, roof: false };
    const gf = (x, z, y) => {
      const t = this.W.height(x, z, y), r = this._roof(x, z);
      out.water = t <= WATER_FLOOR + 0.05 && r <= 0; out.roof = r > 0;
      out.y = Math.max(out.water ? WATER_Y : t, r);
      return out;
    };
    // ريشة الهليكوبتر: أي مبنى/معلم في نص قطرها وأعلى منها = خبطة
    gf.rotorHit = (x, y, z, R) => {
      const CS = 25;
      for (let i = Math.floor((x - R) / CS); i <= Math.floor((x + R) / CS); i++) for (let j = Math.floor((z - R) / CS); j <= Math.floor((z + R) / CS); j++) {
        const a = this.grid?.get(i * 100003 + j); if (!a) continue;
        for (const o of a) {
          if (o.h < y - 0.3 || x < o.x0 - R || x > o.x1 + R || z < o.z0 - R || z > o.z1 + R) continue;
          if (pip(o.P, x, z)) return o.h > y + 0.3; // (فوق السطح نفسه: مش خبطة — ده هبوط على السطح)
          for (let k = 0, m = o.P.length - 1; k < o.P.length; m = k++) if (segD(x, z, o.P[m][0], o.P[m][1], o.P[k][0], o.P[k][1]) < R) return true;
        }
      }
      for (const b of this.airport?.boxes || []) if (b.h > y - 0.3 && Math.abs(x - b.cx) < b.hx + R && Math.abs(z - b.cz) < b.hz + R && !(Math.abs(x - b.cx) < b.hx && Math.abs(z - b.cz) < b.hz && b.h < y + 0.3)) return true;
      return false;
    };
    return (this._gf = gf);
  }

  /** مفيش مباني أعلى من 1م في نص قطر R حوالين النقطة (عشان الهليكوبتر تبدأ هنا) */
  _clearAt(x, z, R) {
    this._index();
    if (this._roof(x, z) > 1) return false;
    for (let a = 0; a < 16; a++) for (const r of [R * 0.35, R * 0.7, R]) { const px = x + Math.cos(a / 16 * Math.PI * 2) * r, pz = z + Math.sin(a / 16 * Math.PI * 2) * r; if (this._roof(px, pz) > 1) return false; }
    return this.W.height(x, z, 0) > WATER_FLOOR + 0.05;
  }

  // ===================== كل فريم =====================
  update(dt, input) {
    const g = this.g, F = this.fdm, B = F.B, a = input.actions || {};
    if (!this.kind) return;
    this._index();
    const fly = input.fly || {};
    // أزرار
    if (this.kind === 'plane') {
      if (a.siren) g.hud.toast(F.toggleGear() ? (F.gearDown ? '⬇️ العجل نازل' : '⬆️ العجل اتلم') : 'العجل مايتلمش وانت على الأرض', 1.6);
      if (a.flapsDown) { F.setFlaps(1); g.hud.toast(`القلابات: ${['0', '1', '2', 'FULL'][F.flapIdx]}`, 1.2); }
      if (a.flapsUp) { F.setFlaps(-1); g.hud.toast(`القلابات: ${['0', '1', '2', 'FULL'][F.flapIdx]}`, 1.2); }
    } else if (a.sas) { F.sas = !F.sas; g.hud.toast(F.sas ? 'مساعد الثبات (SAS) شغال' : 'مساعد الثبات مقفول — تحكم مباشر', 1.8); }
    if (a.reset) { this.spawn(true); g.hud.toast('رجعت لمكان البداية', 1.5); return; }
    // التحطم: رسالة + نرجع بعد 3ث
    if (F.crashed) {
      if (!this.crashT) {
        this.crashT = 3;
        const why = { water: 'وقعت في المية', rotor: 'الريشة خبطت في مبنى', rollover: 'الهليكوبتر اتقلبت على جنبها', hard: 'هبطت جامد أوي', body: 'جسم الطيارة خبط في الأرض', obstacle: 'خبطت في مبنى' }[F.crashed] || 'تحطمت';
        g.hud.toast(`💥 ${why} — بنرجعك تاني…`, 3);
        this.audio?.crash();
      }
      this.crashT -= dt;
      if (this.crashT <= 0) { this.spawn(true); if (this.kind === 'plane') this.mission?.start(); }
      this._syncPlayer(); return;
    }
    const ctl = { pitch: fly.pitch || 0, roll: fly.roll || 0, yaw: fly.yaw || 0, brake: Math.max(input.handbrake || 0, fly.brake || 0) };
    if (fly.lever != null && fly.leverAbs) { if (this.kind === 'plane') ctl.thr = fly.lever; else ctl.coll = fly.lever; } else ctl.lever = fly.lever || 0;
    // الأرض قريبة؟ (فوق كل حاجة بكتير مش محتاجين نحسب التلامس كل خطوة)
    const gf = this._groundFn();
    const ground0 = Math.max(this._terrain(B.pos.x, B.pos.z, B.pos.y - 3), this._roof(B.pos.x, B.pos.z));
    F._agl = B.pos.y - this.cg.y - ground0;
    const far = B.pos.y - this.maxH > 60;
    const gfx = far ? Object.assign(() => ({ y: -1e9, water: false, roof: false }), { rotorHit: null }) : gf;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 12) { F.step(STEP, ctl, gfx); this.acc -= STEP; n++; if (F.crashed) break; }
    if (n >= 12) this.acc = 0;
    syncAircraftRig(this.rig, F, dt, this.cg);
    this.airport.updatePapi(B.pos.x, B.pos.y - this.cg.y, B.pos.z);
    this.audio?.update(dt, F, this.kind, g.camera, B.pos);
    this.mission?.update?.(dt);
    this._syncPlayer();
  }

  /** مكان اللاعب للخريطة الصغيرة/المرور/تحميل المربعات = مكان الطيارة */
  _syncPlayer() {
    const ph = this.g.player.physics, B = this.fdm.B;
    ph.x = B.pos.x; ph.z = B.pos.z; ph.vx = 0; ph.vz = 0; ph.yaw = Math.atan2(-B.f.x, -B.f.z);
  }

  // ===================== الكاميرا =====================
  camera(cam, mode, dt, input) {
    const B = this.fdm.B, rig = this.rig, plane = this.kind === 'plane';
    const P = B.pos;
    const hideBody = mode === 0;
    rig.model.visible = !hideBody;
    if (!plane && rig.main) rig.main.pivot.visible = true;
    if (rig.disc) rig.disc.visible = true;
    if (mode === 0) {
      // الكابينة: عين الطيار (شمال في الطيارة، يمين في الهليكوبتر) — الكاميرا ماشية مع جسم الطيارة
      const eye = plane ? _v.set(-0.55, 4.25, -16.2).sub(this.cg) : _v.set(0.38, 2.05, this.rig.hub.z - 1.75).sub(this.cg);
      cam.position.copy(P).add(eye.applyQuaternion(B.q));
      _q.setFromAxisAngle(_v2.set(1, 0, 0), plane ? -0.1 : -0.16);
      cam.quaternion.copy(B.q).multiply(_q);
      if (input?.lookX) cam.quaternion.multiply(_q.setFromAxisAngle(_v2.set(0, 1, 0), -input.lookX * 1.2));
    } else {
      // ورا من فوق (بتتبع اتجاه الطيران) / حرة حوالين الطيارة
      const D = plane ? 62 : 20, H = plane ? 14 : 6.5;
      let hx = B.f.x, hz = B.f.z; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      if (mode === 2) { this.orbit += ((input?.lookX || 0) * 1.6 + 0.12) * dt; const c = Math.cos(this.orbit), s = Math.sin(this.orbit); const nx = hx * c - hz * s, nz = hx * s + hz * c; hx = nx; hz = nz; }
      const tx = P.x - hx * D, ty = P.y + H, tz = P.z - hz * D;
      const e = this._eye || (this._eye = new THREE.Vector3(tx, ty, tz));
      const k = Math.min(1, dt * (mode === 2 ? 2.5 : 3.5));
      e.x += (tx - e.x) * k; e.y += (ty - e.y) * k; e.z += (tz - e.z) * k;
      // (الكاميرا ماتنزلش تحت الأرض)
      e.y = Math.max(e.y, this._terrain(e.x, e.z, e.y) + 1.5);
      cam.position.copy(e);
      cam.lookAt(P.x + hx * (plane ? 18 : 4), P.y + (plane ? 2 : 1), P.z + hz * (plane ? 18 : 4));
    }
    cam.updateMatrixWorld();
  }

  // ===================== البيئة (ضباب أبعد، أرض بعيدة، مدى الرؤية) =====================
  _envOn() {
    const g = this.g, cam = g.camera;
    this._saved = { far: cam.far, near: cam.near, fogFar: g.scene.fog.far, fogNear: g.scene.fog.near, view: g.viewDist };
    cam.far = 7000; cam.near = 0.3; cam.updateProjectionMatrix();
    g.viewDist = g.mobile ? 900 : 1400;
    if (!this.farGround) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb59a6e, roughness: 1 }));
      m.position.set(this.airport.cx - 800, -2.0, this.airport.cz); m.name = 'far-ground'; m.receiveShadow = false;
      this.farGround = m;
    }
    g.scene.add(this.farGround);
    document.body.classList.add('flying', this.kind === 'plane' ? 'fly-plane' : 'fly-heli');
  }
  _envOff() {
    const g = this.g, cam = g.camera, s = this._saved;
    if (s) { cam.far = s.far; cam.near = s.near; cam.updateProjectionMatrix(); g.viewDist = s.view; g.scene.fog.far = s.fogFar; g.scene.fog.near = s.fogNear; }
    this.farGround?.removeFromParent();
    document.body.classList.remove('flying', 'fly-plane', 'fly-heli');
  }
  /** الضباب أبعد وانت طاير (بيتنادي بعد ما الجودة تظبط الضباب) */
  fog() {
    const f = this.g.scene.fog, B = this.fdm.B;
    const alt = Math.max(0, B.pos.y);
    f.near = 250 + alt * 2; f.far = Math.min(4200, 1600 + alt * 6);
  }

  // ===================== العدادات =====================
  hud() {
    const g = this.g, H = g.hud, F = this.fdm, B = F.B;
    const kt = Math.round(B.vel.length() * 1.944), kmh = Math.round(B.vel.length() * 3.6);
    H.speed.textContent = kmh;
    const gtxt = this.kind === 'plane' ? (F.gearDown ? 'G↓' : 'G↑') : F.sas ? 'SAS' : 'DIR';
    if (gtxt !== this._g) { this._g = gtxt; H.gear.textContent = gtxt; H.gear.className = ''; H.gearNum.textContent = this.kind === 'plane' ? 'طيارة' : 'هليكوبتر'; }
    const el = (this.panel ||= this._panel());
    const alt = Math.round(B.pos.y - this.cg.y), agl = Math.max(0, Math.round(F._agl ?? alt)), vs = B.vel.y;
    const hdg = Math.round(((B.heading * 180 / Math.PI) % 360 + 360) % 360);
    const pow = this.kind === 'plane' ? F.throttle : F.coll;
    const warn = F.crashed ? 'تحطم' : F.stall ? 'انهيار! نزّل الأنف وزوّد الدفع' : F.vrs > 0.4 ? 'دوامة الريشة! اطلع لقدام' : F.tailStrike ? 'الديل خبط في الأرض!' : (this.kind === 'plane' && !F.onGround && agl < 250 && vs < -12) ? 'اسحب لفوق!' : (this.kind === 'plane' && !F.gearDown && agl < 120 && vs < -2) ? 'نزّل العجل (G)' : '';
    const rows = [
      ['السرعة', `${kt} عقدة`], ['الارتفاع', `${agl} م`], ['صعود/نزول', `${vs >= 0 ? '+' : ''}${vs.toFixed(1)} م/ث`], ['الاتجاه', `${hdg}°`],
      [this.kind === 'plane' ? 'الدفع' : 'Collective', `${Math.round(pow * 100)}%`],
      this.kind === 'plane' ? ['القلابات', ['0', '1', '2', 'FULL'][F.flapIdx]] : ['الريشة', `${Math.round(F.rpm * 100)}%`],
    ];
    const mi = this.mission?.info();
    const key = rows.map((r) => r[1]).join('|') + warn + (mi ? mi.title + mi.text : '');
    if (key !== this._pk) {
      this._pk = key;
      el.rows.innerHTML = rows.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
      el.warn.textContent = warn; el.warn.style.display = warn ? '' : 'none';
      el.bar.style.height = `${Math.round(pow * 100)}%`;
      el.mis.innerHTML = mi ? `<b>${mi.title}</b> ${mi.text}` : ''; el.mis.style.display = mi ? '' : 'none';
    }
    this._att(el.att, B);
  }
  _panel() {
    const d = document.createElement('div'); d.id = 'flight-hud';
    d.innerHTML = '<canvas width="96" height="96"></canvas><div class="fh-rows"></div><div class="fh-pow"><i></i></div><div class="fh-warn"></div><div class="fh-mis"></div>';
    document.body.appendChild(d);
    return { root: d, att: d.querySelector('canvas'), rows: d.querySelector('.fh-rows'), bar: d.querySelector('.fh-pow i'), warn: d.querySelector('.fh-warn'), mis: d.querySelector('.fh-mis') };
  }
  /** مؤشر الوضع (الأفق الصناعي): سما/أرض + خطوط الميل */
  _att(c, B) {
    const x = c.getContext('2d'), W = c.width, H = c.height, pitch = B.pitch, bank = B.bank;
    x.save(); x.clearRect(0, 0, W, H);
    x.beginPath(); x.arc(W / 2, H / 2, W / 2 - 1, 0, Math.PI * 2); x.clip();
    x.translate(W / 2, H / 2); x.rotate(-bank);
    const py = pitch * 180 / Math.PI * 2.2;
    x.fillStyle = '#3f8fd6'; x.fillRect(-W, -H * 2 + py, W * 2, H * 2);
    x.fillStyle = '#8a5a2b'; x.fillRect(-W, py, W * 2, H * 2);
    x.strokeStyle = '#fff'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(-W, py); x.lineTo(W, py); x.stroke();
    for (const d of [-20, -10, 10, 20]) { const y = py - d * 2.2; x.beginPath(); x.moveTo(-10, y); x.lineTo(10, y); x.stroke(); }
    x.restore();
    x.strokeStyle = '#ffd23a'; x.lineWidth = 3; x.beginPath(); x.moveTo(W / 2 - 26, H / 2); x.lineTo(W / 2 - 8, H / 2); x.moveTo(W / 2 + 8, H / 2); x.lineTo(W / 2 + 26, H / 2); x.stroke();
    x.fillStyle = '#ffd23a'; x.fillRect(W / 2 - 2, H / 2 - 2, 4, 4);
  }
  hidePanel() { if (this.panel) this.panel.root.style.display = 'none'; }
  showPanel() { if (this.panel) this.panel.root.style.display = ''; }
}
