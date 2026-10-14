import * as THREE from 'three';
import { buildCar } from '../vehicles/CarModels.js';
import { buildTrafficHiace } from '../vehicles/TrafficHiace.js';
import { buildTuktukRig } from '../vehicles/PlayerRigs.js';
import { addDriver } from '../world/Pedestrians.js';
import { MICROBUS_SPEC, TUKTUK_SPEC_BASE, TAXI_SPEC_BASE } from '../physics/VehiclePhysics.js';

// اللعب الجماعي: كل اللي فاتحين اللعبة في نفس اللحظة بيشوفوا بعض.
// بنستخدم "presence" بتاع الـ room (كل لاعب بينشر حالته: رقمه، اسمه، عربيته، مكانه) — مفيش سيرفر.
// لو الـ room مش متاح (لينك عام، مش مسجّل دخول، أو بنجرب محليًا) اللعبة بتشتغل لوحدها عادي.

export const SEATS = 7;
const SIZES = { microbus: [0.85, 2.35], taxi: [0.88, 2.22], tuktuk: [0.68, 1.35] };
const LABEL_Y = { microbus: 2.75, taxi: 2.05, tuktuk: 2.3 };
const SEND_HZ = 12;

function labelSprite(seat, name) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(14,14,16,0.72)';
  x.beginPath(); x.roundRect(8, 16, 496, 96, 40); x.fill();
  x.fillStyle = '#f2b330'; x.beginPath(); x.arc(64, 64, 34, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#1a1408'; x.font = 'bold 48px Cairo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(seat), 64, 68);
  x.fillStyle = '#ffffff'; x.font = 'bold 50px Cairo, sans-serif'; x.direction = 'rtl';
  x.fillText((name || `لاعب ${seat}`).slice(0, 16), 300, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true }));
  s.scale.set(2.6, 0.65, 1);
  s.renderOrder = 5;
  return s;
}

export class Multiplayer {
  constructor(game) {
    this.game = game;
    this.room = null;
    this.available = false;
    this.remotes = new Map(); // peer → remote vehicle
    this.lobbyListeners = [];
    this.me = { seat: 0, name: '', kind: 'microbus' };
    this._t = 0;
  }

  async connect() {
    try {
      const use = window.claude?.use;
      this.room = use ? await use('room') : null;
    } catch { this.room = null; }
    this.available = !!this.room;
    if (!this.room) { this._emitLobby(); return; }
    this.room.onPeers(() => this._emitLobby(), () => { this.available = false; this._emitLobby(); });
    this.room.onConnection(() => this._emitLobby());
    this._emitLobby();
  }

  get connected() { return !!this.room && this.room.connected(); }

  /** اللاعبين التانيين (من غير التاب ده) */
  others() {
    if (!this.room) return [];
    return this.room.peers().filter((p) => !p.sameTab && p.kind === 'viewer' && p.presence && p.presence.seat);
  }

  /** الرقم ده محجوز لحد تاني؟ (لو اتنين اختاروا نفس الرقم: صاحب الـ peer الأصغر بياخده) */
  seatOwner(seat) {
    const mine = this.room?.peers().find((p) => p.sameTab);
    for (const p of this.others()) {
      if (p.presence.seat !== seat) continue;
      if (!mine || p.peer < mine.peer || !this.me.seat) return p;
    }
    return null;
  }

  onLobby(fn) { this.lobbyListeners.push(fn); }
  _emitLobby() { for (const fn of this.lobbyListeners) fn(this); }

  setMe(patch) {
    Object.assign(this.me, patch);
    this.room?.presence({ seat: this.me.seat || null, name: this.me.name || null, kind: this.me.kind, v: 1 }).catch(() => {});
    this._emitLobby();
  }

  /** كل فريم: ننشر مكاننا ونحدّث عربيات التانيين */
  update(dt) {
    const g = this.game;
    if (this.room && this.me.seat && g.started) {
      this._t -= dt;
      if (this._t <= 0) {
        this._t = 1 / SEND_HZ;
        const ph = g.player.physics;
        const r = (v, k = 100) => Math.round(v * k) / k;
        this.room.presence({
          p: [r(ph.x), r(ph.z), r(ph.yaw, 1000), r(ph.heave - ph.spec.cgHeight), r(ph.pitch, 1000), r(ph.roll, 1000), r(ph.steerAngle, 1000), r(ph.forwardSpeed)],
          br: ph.brake > 0.05 ? 1 : 0, fl: ph.flip.mode ? 1 : 0, kind: g.player.kind,
          pax: g.passengers?.count || 0, money: Math.round(g.passengers?.earnings || 0),
        }).catch(() => {});
      }
    }
    this._myLabel();
    // عربيات اللاعبين التانيين
    const seen = new Set();
    for (const p of this.others()) {
      const pr = p.presence;
      if (!Array.isArray(pr.p) || pr.p.length < 8) continue;
      seen.add(p.peer);
      let R = this.remotes.get(p.peer);
      const kind = SIZES[pr.kind] ? pr.kind : 'microbus';
      if (!R || R.kind !== kind || R.seat !== pr.seat || R.name !== pr.name) { if (R) this._drop(R); R = this._make(p.peer, kind, pr.seat, pr.name); this.remotes.set(p.peer, R); }
      // الحالة الجاية + توقع بسيط بالسرعة عشان الحركة تبقى ناعمة بين الرسايل
      if (p.updatedAt !== R.at) { R.at = p.updatedAt; R.tgt = pr.p.slice(); R.age = 0; if (!R.cur) R.cur = pr.p.slice(); }
      R.age += dt;
      const [x, z, yaw, y, pitch, roll, steer, v] = R.tgt;
      const ex = x - Math.sin(yaw) * v * Math.min(R.age, 0.4), ez = z - Math.cos(yaw) * v * Math.min(R.age, 0.4);
      const k = Math.min(1, dt * 10), c = R.cur;
      c[0] += (ex - c[0]) * k; c[1] += (ez - c[1]) * k; c[3] += (y - c[3]) * k;
      let dy = yaw - c[2]; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); c[2] += dy * k;
      c[4] += (pitch - c[4]) * k; c[5] += (roll - c[5]) * k; c[6] += (steer - c[6]) * k; c[7] = v;
      if (Math.hypot(ex - c[0], ez - c[1]) > 25) { c[0] = ex; c[1] = ez; c[2] = yaw; } // اتنقل (reset)
      this._pose(R, c, dt, pr);
    }
    for (const [peer, R] of this.remotes) if (!seen.has(peer)) { this._drop(R); this.remotes.delete(peer); }
  }

  /** اسمك ورقمك فوق عربيتك إنت كمان (بيبان في كاميرا بره وفي اللعب لوحدك) */
  _myLabel() {
    const g = this.game, root = g.player?.rig?.root;
    const name = (this.me.name || '').trim();
    const key = root && (name || this.me.seat) ? `${this.me.seat}|${name}|${g.player.kind}` : '';
    if (key === this._myKey && (!this._mine || this._mine.parent === root)) return;
    this._myKey = key;
    if (this._mine) { this._mine.removeFromParent(); this._mine.material.map.dispose(); this._mine.material.dispose(); this._mine = null; }
    if (!key) return;
    const l = labelSprite(this.me.seat || '•', name);
    l.position.y = LABEL_Y[g.player.kind] ?? 2.75;
    root.add(l);
    this._mine = l;
  }

  _make(peer, kind, seat, name) {
    const g = this.game;
    let rig;
    if (kind === 'microbus' && g.assets.get('microbus_traffic')) rig = buildTrafficHiace(g.assets.get('microbus_traffic'));
    else if (kind === 'tuktuk') {
      const spec = { ...MICROBUS_SPEC, ...TUKTUK_SPEC_BASE };
      rig = buildTuktukRig(spec, g.assets);
      rig.body.position.y = spec.cgHeight; // الـ shell متظبط على مركز الثقل
      rig.baseBodyY = spec.cgHeight;
      rig.brake = rig.lights.tail;
    } else rig = g.assets.get('car_taxi') ? g._makeCar('taxi', 0xf2f2ee) : buildCar('taxi', 0xf2f2ee, { profile: 'sedan' });
    rig.baseBodyY ??= 0;
    // سواق: التوكتوك عنده مكان عين السواق؛ الباقي في _makeCar أو مكان ثابت
    if (kind === 'tuktuk' && rig.eye) addDriver(rig.eye.parent, rig.eye.position.x, rig.eye.position.y - 0.78, rig.eye.position.z + 0.1, seat);
    else if (kind === 'microbus') addDriver(rig.body, 0.45, 0.92, -1.28, seat);
    const label = labelSprite(seat, name);
    label.position.y = LABEL_Y[kind];
    rig.root.add(label);
    g.scene.add(rig.root);
    return { peer, kind, seat, name, rig, label, cur: null, tgt: null, at: 0, age: 0, spin: 0 };
  }

  _pose(R, c, dt, pr) {
    const rig = R.rig;
    rig.root.position.set(c[0], c[3], c[1]);
    rig.root.rotation.y = c[2];
    const flipped = pr.fl ? c[5] : 0;
    rig.body.rotation.set(c[4], 0, flipped || c[5] * 0.6, 'YXZ');
    rig.body.position.y = rig.baseBodyY;
    R.spin += (c[7] / (rig.wheelRadius || 0.3)) * dt;
    (rig.wheels || []).forEach((w, i) => {
      if (w.spin) w.spin.rotation.x = -R.spin;
      if (w.front && w.group) w.group.rotation.y = c[6];
    });
    if (rig.brake) rig.brake.emissiveIntensity = pr.br ? 3.5 : 0.2;
    // الاسم يبان من بعيد بس لحد 160م
    const cam = this.game.camera.position;
    R.label.visible = (c[0] - cam.x) ** 2 + (c[1] - cam.z) ** 2 < 160 * 160;
  }

  _drop(R) { R.rig.root.removeFromParent(); }

  /** صناديق تصادم عربيات اللاعبين التانيين (للفيزياء) */
  colliders(box, out) {
    for (const R of this.remotes.values()) {
      if (!R.cur) continue;
      const [x, z, yaw, , , , , v] = R.cur;
      if (Math.abs(x - box.cx) > 8 || Math.abs(z - box.cz) > 8) continue;
      const [hx, hz] = SIZES[R.kind];
      out.push({ cx: x, cz: z, hx, hz, angle: yaw, mass: R.kind === 'tuktuk' ? 450 : R.kind === 'taxi' ? 1200 : 2300, restitution: 0.2, vx: -Math.sin(yaw) * v, vz: -Math.cos(yaw) * v, kind: 'car' });
    }
  }

  /** للخريطة */
  positions() {
    const out = [];
    for (const R of this.remotes.values()) if (R.cur) out.push({ x: R.cur[0], z: R.cur[1], yaw: R.cur[2], seat: R.seat, name: R.name, kind: R.kind });
    return out;
  }
}

void TAXI_SPEC_BASE;
