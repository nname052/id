import * as THREE from 'three';
import { person, seatedFigure } from '../world/Pedestrians.js';
import { loopAt, LOOP } from '../traffic/TrafficSystem.js';
import { groundHeight } from '../world/ground.js';
import { roadPointAt } from '../world/RoadNetwork.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex, rng } from '../render/textures.js';

// الركاب: مواقف على الطريق، ناس مستنية بتشاور، بتركب من الباب الجرار لما تقف جنبهم،
// وكل راكب رايح موقف معين وبينزل لما توقف عنده. الأجرة متسجلة (earnings) عشان نبني عليها بعدين.

const CITY_LEN = 450;
// s على المسار الكامل (المدينة 0→450 وبعدها الطريق الدائري)
const STOP_DEFS = [
  { s: 40, name: 'موقف وسط البلد', kind: 'city' },
  { s: 268, name: 'السوق', kind: 'market' },
  { s: CITY_LEN + 150, name: 'الحي السكني', kind: 'residential' },
  { s: CITY_LEN + 930, name: 'الطريق الزراعي', kind: 'agri' },
  { s: CITY_LEN + 1205, name: 'القرية', kind: 'village' },
  { s: CITY_LEN + 1460, name: 'استراحة الصحراوي', kind: 'desert' },
  { s: CITY_LEN + 2480, name: 'طرف الطريق السريع', kind: 'highway' },
];
// مواقف على الطرق الفرعية
const SIDE_STOPS = [
  { road: 'R1', frac: 0.45, name: 'موقف الترعة', kind: 'agri' },
  { road: 'R5', frac: 0.5, name: 'شارع الميدان', kind: 'side' },
  { road: 'S1', frac: 0.45, name: 'شارع باريس', kind: 'shibin', off: 4.4 + 3.2 - 1 },
  { road: 'S2', frac: 0.06, name: 'جامعة المنوفية', kind: 'shibin', off: 5.2 + 3.2 - 1 },
  { road: 'S4', frac: 0.15, name: 'محطة القطر', kind: 'shibin', off: 3.8 + 3.2 - 1 },
  // الموقف الكبير: ناس كتير ومستنيين على طول
  { road: 'S4', frac: 0.55, name: 'موقف شبين الكوم', kind: 'terminal', off: 3.8 + 3.2 - 0.8 },
];
const URBAN = new Set(['city', 'market', 'residential']);
const MAX_WALKERS = 18;
const WALK = 1.45, _v = new THREE.Vector3(), _w = new THREE.Vector3();

function stopSign() {
  const c = canvas(256, 160), x = c.getContext('2d');
  x.fillStyle = '#0d5c8c'; x.fillRect(0, 0, 256, 160);
  x.strokeStyle = '#fff'; x.lineWidth = 8; x.strokeRect(8, 8, 240, 144);
  x.fillStyle = '#fff'; x.font = 'bold 64px Cairo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.fillText('موقف', 128, 66);
  x.font = 'bold 28px Cairo, sans-serif'; x.fillText('ميكروباص', 128, 122);
  return tex(c, { repeat: false });
}

export class Passengers {
  constructor(scene, player, { hud, audio, settings } = {}) {
    this.scene = scene;
    this.player = player;
    this.hud = hud; this.audio = audio; this.settings = settings;
    this.R = rng(4242);
    this.seats = (player.rig.paxSeats || []).map((p) => ({ ...p, pax: null }));
    this.capacity = this.seats.length;
    this.onboard = [];
    this.earnings = 0;
    this.walkers = [];
    this.pool = [];
    this.stillTime = 0;
    this.doorBusy = 0;
    this.group = new THREE.Group();
    this.group.name = 'passengers';
    scene.add(this.group);
    this._buildStops();
    // الركاب القاعدين: Mesh واحد جوه العربية بيتبني من جديد لما حد يركب/ينزل
    this.seatedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.seatedMesh = null;
    for (let i = 0; i < MAX_WALKERS; i++) {
      const p = person(this.R);
      p.root.visible = false;
      this.group.add(p.root);
      this.pool.push(p);
    }
  }

  get count() { return this.onboard.length; }

  /** العربية اتغيرت: كراسي جديدة، والركاب اللي كانوا راكبين بينزلوا */
  setPlayer(player) {
    if (this.seatedMesh) { this.seatedMesh.removeFromParent(); this.seatedMesh = null; }
    this.player = player;
    this.seats = (player.rig.paxSeats || []).map((p) => ({ ...p, pax: null }));
    this.capacity = this.seats.length;
    this.onboard = [];
    for (const w of this.walkers) if (w.state === 'toDoor') w.state = 'return';
    this._updateHud();
  }

  // ===== المواقف =====
  _buildStops() {
    this.stops = [];
    const q = {};
    const poles = new GeoBuilder();
    const plates = new GeoBuilder();
    const defs = [...STOP_DEFS, ...SIDE_STOPS];
    for (const def of defs) {
      let edge;
      if (def.road) { Object.assign(q, roadPointAt(def.road, def.frac)); edge = def.off ?? q.half + 1.4; } else { loopAt(def.s, q); edge = URBAN.has(def.kind) ? 11.3 : 10.8; }
      for (const side of [1, -1]) {
        const d = side * edge;
        const x = q.x + q.rx * d, z = q.z + q.rz * d;
        // اتجاه السير اللي الموقف ده ليه: اليمين (+r) لما بنمشي في اتجاه المسار
        const dir = side;
        const stop = {
          id: this.stops.length, name: def.name, kind: def.kind, side,
          x, z, y: groundHeight(x, z),
          nx: -q.rx * side, nz: -q.rz * side,        // من الرصيف ناحية الطريق
          ax: q.dx * dir, az: q.dz * dir,            // اتجاه السير
          waiting: [], cooldown: 0,
        };
        this.stops.push(stop);
        // عمود + لافتة "موقف"
        const px = x - stop.ax * 1.6 - stop.nx * 0.4, pz = z - stop.az * 1.6 - stop.nz * 0.4, py = groundHeight(px, pz);
        poles.setColor([0.75, 0.76, 0.78]);
        poles.addGeometry(new THREE.CylinderGeometry(0.04, 0.05, 2.5, 6), new THREE.Matrix4().makeTranslation(px, py + 1.25, pz));
        const yaw = Math.atan2(stop.nx, stop.nz);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(px, py + 2.2, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
        plates.addGeometry(new THREE.PlaneGeometry(0.62, 0.39), m);
        const back = new THREE.Matrix4().compose(new THREE.Vector3(px, py + 2.2, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + Math.PI, 0)), new THREE.Vector3(1, 1, 1));
        plates.addGeometry(new THREE.PlaneGeometry(0.62, 0.39), back);
      }
    }
    const pm = new THREE.Mesh(poles.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 }));
    const sm = new THREE.Mesh(plates.build(), new THREE.MeshStandardMaterial({ map: stopSign(), roughness: 0.5 }));
    pm.castShadow = true;
    this.group.add(pm, sm);
  }

  // ===== أدوات =====
  _take() { const p = this.pool.pop(); if (p) { p.root.visible = true; this.walkers.push(p); } return p; }
  _release(p) {
    p.root.visible = false;
    this.walkers.splice(this.walkers.indexOf(p), 1);
    this.pool.push(p);
    p.state = null;
    for (const a of p.arms) a.rotation.set(0, 0, a.rotation.z > 0 ? 0.08 : -0.08);
  }

  /** نقطة قدام الباب الجرار (عالم) */
  _doorPoint(out, extra = 0.5) {
    const rig = this.player.rig, d = rig.slidingDoor;
    const c = d ? d.center : _w.set(0.85, 0.9, 0.12);
    out.set(c.x + extra, 0, c.z);
    rig.shell.localToWorld(out);
    out.y = groundHeight(out.x, out.z);
    return out;
  }

  _rebuildSeated() {
    if (this.seatedMesh) { this.seatedMesh.removeFromParent(); this.seatedMesh.geometry.dispose(); this.seatedMesh = null; }
    const occ = this.seats.filter((s) => s.pax);
    if (!occ.length) return;
    const g = new GeoBuilder();
    for (const s of occ) seatedFigure(g, rng(s.pax.seed), new THREE.Matrix4().makeTranslation(s.x, s.y, s.z));
    this.seatedMesh = new THREE.Mesh(g.build(), this.seatedMat);
    this.seatedMesh.castShadow = true;
    this.player.rig.shell.add(this.seatedMesh);
  }

  _spawnWaiting(stop) {
    const density = this.settings ? +(this.settings.get('paxDensity') ?? 1) : 1;
    const terminal = stop.kind === 'terminal';
    if (!terminal && this.R() > 0.55 + 0.4 * density) { stop.cooldown = 25; return; }
    const n = terminal ? 5 + Math.floor(this.R() * 5 * density) : 1 + Math.floor(this.R() * (1.5 + 2 * density));
    for (let i = 0; i < n; i++) {
      const p = this._take();
      if (!p) break;
      const along = (i - (n - 1) / 2) * 0.9 + (this.R() - 0.5) * 0.4;
      p.state = 'wait';
      p.stop = stop;
      p.x = stop.x + stop.ax * along - stop.nx * this.R() * 0.4;
      p.z = stop.z + stop.az * along - stop.nz * this.R() * 0.4;
      p.home = [p.x, p.z];
      p.style = ['wave', 'hail', 'beckon'][Math.floor(this.R() * 3)];
      p.phase = this.R() * 6;
      p.delay = 0;
      p.dest = this._pickDest(stop);
      stop.waiting.push(p);
    }
  }

  _pickDest(from) {
    // رايح موقف تاني (غالبًا لقدام في نفس الاتجاه)
    const others = this.stops.filter((s) => s.name !== from.name && s.side === from.side);
    return others[Math.floor(this.R() * others.length)];
  }

  // ===== الحلقة الأساسية =====
  update(dt, ph) {
    const rig = this.player.rig, door = rig.slidingDoor;
    const vx = ph.x, vz = ph.z;
    const still = ph.speed < 0.45;
    this.stillTime = still ? this.stillTime + dt : 0;
    const [fx, fz] = ph.forward;
    const rx = -fz, rz = fx; // يمين العربية (ناحية الباب)
    const doorP = this._doorPoint(_v);

    // --- ظهور/اختفاء المستنيين ---
    for (const st of this.stops) {
      st.cooldown = Math.max(0, st.cooldown - dt);
      const d2 = (st.x - vx) ** 2 + (st.z - vz) ** 2;
      if (!st.waiting.length && !st.cooldown && d2 < 380 * 380 && d2 > 45 * 45) this._spawnWaiting(st);
      else if (st.waiting.length && d2 > 480 * 480) {
        for (const p of [...st.waiting]) if (p.state === 'wait') this._release(p);
        st.waiting = st.waiting.filter((p) => p.state && p.state !== 'wait');
        st.cooldown = 10;
      }
    }

    // --- ركوب: واقف جنب موقف والباب ناحيته ---
    if (this.stillTime > 0.35 && door) {
      for (const st of this.stops) {
        const free = this.capacity - this.onboard.length - this.walkers.filter((p) => p.state === 'toDoor').length;
        if (!st.waiting.length) continue;
        const dd = Math.hypot(st.x - doorP.x, st.z - doorP.z);
        const sideOk = (st.x - vx) * rx + (st.z - vz) * rz > 0.5;
        if (dd > 7.5 || !sideOk) continue;
        let k = 0;
        for (const p of st.waiting) {
          if (p.state !== 'wait') continue;
          if (free - k <= 0) { if (!this._fullNote) { this.hud?.toast('الميكروباص كامل!', 2); this._fullNote = 1; } break; }
          p.state = 'toDoor'; p.delay = 0.3 + k * 0.8; k++;
        }
      }
      // --- نزول: حد نازل في الموقف ده ---
      for (const st of this.stops) {
        const dd = Math.hypot(st.x - doorP.x, st.z - doorP.z);
        const sideOk = (st.x - vx) * rx + (st.z - vz) * rz > 0.5;
        if (dd > 9 || !sideOk) continue;
        const out = this.onboard.filter((p) => p.dest && p.dest.name === st.name && !p.leaving);
        out.forEach((p, i) => { p.leaving = true; p.leaveDelay = 0.4 + i * 0.9; p.leaveStop = st; });
      }
    }
    if (!still) this._fullNote = 0;

    // --- الناس اللي بتنزل ---
    let busy = false;
    for (const p of [...this.onboard]) {
      if (!p.leaving) continue;
      busy = true;
      if (!still) { p.leaving = false; continue; } // العربية اتحركت: يستنى للموقف الجاي
      door.target = 1;
      if (door.open < 0.9) continue;
      p.leaveDelay -= dt;
      if (p.leaveDelay > 0) continue;
      const w = this._take();
      if (!w) continue;
      this.onboard.splice(this.onboard.indexOf(p), 1);
      p.seat.pax = null;
      this._rebuildSeated();
      w.state = 'alight'; w.x = doorP.x; w.z = doorP.z;
      const st = p.leaveStop;
      w.target = [st.x + st.ax * (this.R() - 0.5) * 2, st.z + st.az * (this.R() - 0.5) * 2];
      w.timer = 0;
      const fare = p.fare;
      this.earnings += fare;
      this.hud?.toast(`نزل راكب · +${fare} ج`, 2);
      this._updateHud();
    }

    // --- حركة كل الماشيين ---
    const cam = this.camPos;
    for (const p of [...this.walkers]) {
      p.phase = (p.phase || 0) + dt;
      // البعيدين مش بيترسموا (أداء)
      if (cam) p.root.visible = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2 < 95 * 95;
      if (p.state === 'wait') {
        // بيبص ناحية الطريق، ولو العربية جاية بيشاور
        const dist = Math.hypot(p.x - vx, p.z - vz);
        const yaw = Math.atan2(p.stop.nx - p.stop.ax * 0.5, p.stop.nz - p.stop.az * 0.5);
        this._pose(p, dist < 70 ? p.style : 'idle', 0, yaw);
        continue;
      }
      if (p.state === 'toDoor') {
        if (!still || !door) { p.state = 'return'; continue; }
        if ((p.delay -= dt) > 0) { this._pose(p, p.style, 0); continue; }
        busy = true;
        door.target = 1;
        if (this._walkTo(p, doorP.x, doorP.z, dt, door.open > 0.6 ? 0.25 : 0.9)) {
          if (door.open > 0.85) this._board(p);
        }
        continue;
      }
      if (p.state === 'return') {
        if (this._walkTo(p, p.home[0], p.home[1], dt, 0.1)) p.state = 'wait';
        continue;
      }
      if (p.state === 'alight') {
        if (this._walkTo(p, p.target[0], p.target[1], dt, 0.2)) { p.state = 'leave'; p.timer = 0; }
        continue;
      }
      if (p.state === 'leave') {
        p.timer += dt;
        const st = this.stops.find((s) => Math.hypot(s.x - p.x, s.z - p.z) < 6) || { ax: 1, az: 0 };
        p.x += st.ax * WALK * 0.8 * dt; p.z += st.az * WALK * 0.8 * dt;
        this._pose(p, 'walk', WALK, Math.atan2(st.ax, st.az));
        if (p.timer > 7 || Math.hypot(p.x - vx, p.z - vz) > 120) this._release(p);
      }
    }

    // --- الباب ---
    if (door) {
      if (busy) this.doorBusy = 0.9;
      else this.doorBusy = Math.max(0, this.doorBusy - dt);
      if (!this.doorBusy || ph.speed > 1.2) door.target = 0;
      const was = door.open;
      door.update(dt);
      if ((was === 0 && door.open > 0) || (was === 1 && door.open < 1)) this.audio?.door?.(door.target > 0.5);
    }

    // --- "على جنب يا أسطى" قبل موقف حد نازل فيه ---
    for (const p of this.onboard) {
      if (p.warned || !p.dest) continue;
      const d = Math.hypot(p.dest.x - vx, p.dest.z - vz);
      if (d < 140 && d > 25) { p.warned = true; this.hud?.toast(`على جنب يا أسطى! (نازل ${p.dest.name})`, 3); }
    }
  }

  _board(p) {
    const free = this.seats.filter((s) => !s.pax);
    if (!free.length) { p.state = 'return'; return; }
    const seat = free[Math.floor(this.R() * free.length)];
    const pax = { seed: Math.floor(this.R() * 1e6), dest: p.dest, fare: 5 + Math.floor(this.R() * 4) * 2.5, seat };
    seat.pax = pax;
    this.onboard.push(pax);
    p.stop.waiting.splice(p.stop.waiting.indexOf(p), 1);
    if (!p.stop.waiting.length) p.stop.cooldown = p.stop.kind === 'terminal' ? 6 : 40;
    this._release(p);
    this._rebuildSeated();
    this.hud?.toast(`ركب راكب · نازل ${pax.dest ? pax.dest.name : 'قدام'}`, 2.2);
    this._updateHud();
  }

  _updateHud() { this.hud?.setPassengers?.(this.onboard.length, this.capacity); }

  /** بيمشي لنقطة، وبيرجع true لما يوصل */
  _walkTo(p, tx, tz, dt, tol) {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d <= tol) { this._pose(p, 'idle', 0); return true; }
    const step = Math.min(d, WALK * dt);
    p.x += (dx / d) * step; p.z += (dz / d) * step;
    this._pose(p, 'walk', WALK, Math.atan2(dx, dz));
    return false;
  }

  _pose(p, mode, speed, yaw) {
    const r = p.root;
    if (yaw !== undefined) {
      p.heading = p.heading ?? yaw;
      p.heading += Math.atan2(Math.sin(yaw - p.heading), Math.cos(yaw - p.heading)) * 0.2;
    }
    r.position.set(p.x, groundHeight(p.x, p.z), p.z);
    r.rotation.y = p.heading || 0;
    const t = p.phase;
    const [L, R] = p.legs, [aL, aR] = p.arms;
    if (!L) return;
    if (mode === 'walk') {
      const s = Math.sin(t * 7.5) * 0.45;
      L.rotation.x = s; R.rotation.x = -s; aL.rotation.set(-s * 0.8, 0, -0.08); aR.rotation.set(s * 0.8, 0, 0.08);
      r.position.y += Math.abs(Math.cos(t * 7.5)) * 0.03;
      return;
    }
    L.rotation.x = 0; R.rotation.x = 0; aL.rotation.set(0, 0, -0.08);
    if (mode === 'wave') aR.rotation.set(-2.7, 0, 0.35 * Math.sin(t * 7));            // إيده فوق بيلوّح
    else if (mode === 'hail') aR.rotation.set(-0.95 + 0.12 * Math.sin(t * 3), 0, 0.25); // إيده ناحية الطريق (إشارة الوجهة)
    else if (mode === 'beckon') aR.rotation.set(-1.45 + 0.35 * Math.sin(t * 6), 0, 0.1);
    else aR.rotation.set(0, 0, 0.08);
  }
}

export { STOP_DEFS };
void LOOP;
