import * as THREE from 'three';
import { Buckets } from '../render/GeoBuilder.js';
import { ROAD, CROSSINGS, mainSegments } from '../world/layout.js';
import { rng } from '../render/textures.js';
import { CAR_COLORS } from '../vehicles/CarModels.js';

// المرور: عربيات ماشية في الحارات بنموذج IDM (Intelligent Driver Model)
// - بتقف في الأحمر وتمشي في الأخضر، وفي الأصفر بتقرر حسب مسافة الوقوف
// - بتحافظ على مسافة من اللي قدامها (وكمان من الميكروباص بتاعك)
// - سرعات مختلفة لكل سواق + كلاكس لو حد واقف قدامها كتير (طبعًا مصر!)

const TYPES = ['sedan', 'boxy', 'taxi', 'microbus', 'sedan', 'taxi', 'boxy'];

export class TrafficSystem {
  constructor(scene, lights, makeCar, audio) {
    this.scene = scene;
    this.lights = lights;
    this.makeCar = makeCar;
    this.audio = audio;
    this.R = rng(99);
    this.cars = [];
    this.parked = [];
    this.lanes = this._buildLanes();
    this._spawn();
    this._spawnParked();
    this._finishBake();
  }

  _buildLanes() {
    const lanes = [];
    const sig = CROSSINGS.find((c) => c.signal);
    const L = ROAD.zMax - ROAD.zMin - 6;
    for (const x of ROAD.lanes) {
      // رايح ناحية -Z (يمين الطريق)
      lanes.push({
        id: `S${x}`, ox: x, oz: ROAD.zMax - 3, dx: 0, dz: -1, length: L, group: 'main',
        stop: sig ? (ROAD.zMax - 3) - (sig.z + sig.half + 4.6) : null, cars: [],
      });
      lanes.push({
        id: `N${x}`, ox: -x, oz: ROAD.zMin + 3, dx: 0, dz: 1, length: L, group: 'main',
        stop: sig ? (sig.z - sig.half - 4.6) - (ROAD.zMin + 3) : null, cars: [],
      });
    }
    if (sig) {
      const Lc = sig.xMax - sig.xMin - 4;
      lanes.push({ id: 'E', ox: sig.xMin + 2, oz: sig.z + 3.2, dx: 1, dz: 0, length: Lc, group: 'cross', stop: -(ROAD.curb + 4.4) - (sig.xMin + 2), cars: [] });
      lanes.push({ id: 'W', ox: sig.xMax - 2, oz: sig.z - 3.2, dx: -1, dz: 0, length: Lc, group: 'cross', stop: (sig.xMax - 2) - (ROAD.curb + 4.4), cars: [] });
    }
    return lanes;
  }

  _newCar(lane, s) {
    const R = this.R;
    const type = TYPES[Math.floor(R() * TYPES.length)];
    const rig = this.makeCar(type, CAR_COLORS[Math.floor(R() * CAR_COLORS.length)]);
    this.scene.add(rig.root);
    const car = {
      rig, lane, s, type,
      v: 6 + R() * 4,
      v0: (type === 'microbus' ? 12.5 : 11) + R() * 4.5,  // الميكروباصات أسرع شوية :)
      len: rig.length || 4.4, width: rig.width || 1.8,
      aMax: 1.3 + R() * 0.6, b: 2.6,
      T: 1.1 + R() * 0.6, s0: 1.8 + R() * 1.2,
      bumped: 0, waitBehindPlayer: 0, honkCooldown: 3 + R() * 6, decidedGo: false,
      acc: 0, spin: 0, mass: type === 'microbus' ? 2300 : 1250,
      x: 0, z: 0, yaw: 0,
    };
    lane.cars.push(car);
    this.cars.push(car);
    this._place(car);
    return car;
  }

  _spawn() {
    const R = this.R;
    for (const lane of this.lanes) {
      const count = lane.group === 'main' ? 7 : 3;
      let s = 10 + R() * 20;
      for (let i = 0; i < count && s < lane.length - 10; i++) {
        this._newCar(lane, s);
        s += 30 + R() * 40;
      }
    }
  }

  _spawnParked() {
    const R = rng(1234);
    for (const sx of [-1, 1]) {
      for (const [zs, ze] of mainSegments(9)) {
        for (let z = zs - 3; z > ze + 3; z -= 5.6 + R() * 4) {
          if (R() < 0.35) { z -= 3; continue; }
          const type = ['sedan', 'boxy', 'taxi', 'sedan', 'boxy', 'microbus'][Math.floor(R() * 6)];
          const rig = this.makeCar(type, CAR_COLORS[Math.floor(R() * CAR_COLORS.length)]);
          const len = rig.length || 4.4;
          z -= len / 2;
          const x = sx * (ROAD.parkCenter + (R() - 0.5) * 0.3);
          const yaw = (sx > 0 ? 0 : Math.PI) + (R() - 0.5) * 0.06;
          rig.root.position.set(x, 0, z);
          rig.root.rotation.y = yaw;
          rig.root.updateMatrixWorld(true);
          this._bake(rig);
          this.parked.push({ cx: x, cz: z, hx: (rig.width || 1.8) / 2, hz: len / 2, angle: yaw, restitution: 0.1, mass: 3000, kind: 'parked' });
          z -= len / 2;
        }
      }
    }
  }

  /** دمج العربيات المركونة في عدد قليل من الـ Meshes (أداء أعلى بكتير) */
  _bake(rig) {
    if (!this._parkB) { this._parkB = new Buckets(); this._parkMats = {}; }
    rig.root.traverse((o) => {
      if (!o.isMesh) return;
      const role = o.userData.role || `m_${o.material.uuid}`;
      if (!this._parkMats[role]) {
        let m = o.material;
        if (role === 'paint') { m = o.material.clone(); m.vertexColors = true; m.color.set(0xffffff); }
        this._parkMats[role] = m;
      }
      const b = this._parkB.get(role);
      const c = role === 'paint' ? o.material.color : null;
      b.setColor(c ? [c.r, c.g, c.b] : [1, 1, 1]);
      b.addGeometry(o.geometry, o.matrixWorld);
    });
  }

  _finishBake() {
    if (!this._parkB) return;
    const g = new THREE.Group();
    g.name = 'parked-cars';
    this._parkB.toMeshes(this._parkMats, g);
    g.traverse((o) => {
      if (!o.isMesh) return;
      const r = o.name;
      if (r === 'glass' || r === 'windshield' || r === 'shadow' || r === 'decal') o.castShadow = false;
      if (r === 'shadow') o.renderOrder = 1;
    });
    this.scene.add(g);
    this._parkB = null;
  }

  _place(car) {
    const l = car.lane;
    car.x = l.ox + l.dx * car.s;
    car.z = l.oz + l.dz * car.s;
    car.yaw = Math.atan2(-l.dx, -l.dz);
  }

  /** كل العربيات كصناديق تصادم (للفيزياء) */
  colliders(box, out) {
    const r = Math.hypot(box.hx, box.hz) + 4;
    for (const c of this.cars) {
      if (Math.abs(c.x - box.cx) > r || Math.abs(c.z - box.cz) > r) continue;
      out.push({
        cx: c.x, cz: c.z, hx: c.width / 2, hz: c.len / 2, angle: c.yaw, mass: c.mass, restitution: 0.15,
        vx: c.lane.dx * c.v, vz: c.lane.dz * c.v, kind: 'car', car: c,
        onHit: () => { c.bumped = 2.5; c.v = 0; c.honkCooldown = Math.min(c.honkCooldown, 0.4); },
      });
    }
    for (const p of this.parked) {
      if (Math.abs(p.cx - box.cx) > r || Math.abs(p.cz - box.cz) > r) continue;
      out.push(p);
    }
  }

  update(dt, player) {
    const pl = player.physics;
    const pBox = pl.getBox();
    for (const lane of this.lanes) {
      lane.cars.sort((a, b) => b.s - a.s);
      const signal = lane.stop != null ? this.lights.state(lane.group) : 'green';
      for (let i = 0; i < lane.cars.length; i++) {
        const car = lane.cars[i];
        let gap = 1e9, vLead = car.v0;
        // العربية اللي قدامي
        if (i > 0) {
          const lead = lane.cars[i - 1];
          gap = lead.s - car.s - (lead.len + car.len) / 2;
          vLead = lead.v;
        }
        // الميكروباص بتاعك (لو في نفس الحارة قدامي)
        const relX = pBox.cx - lane.ox, relZ = pBox.cz - lane.oz;
        const along = relX * lane.dx + relZ * lane.dz;
        const lateral = Math.abs(relX * lane.dz - relZ * lane.dx);
        let playerAhead = false;
        if (lateral < 2.5 && along > car.s) {
          const g = along - car.s - car.len / 2 - pBox.hz;
          if (g < gap) { gap = g; vLead = pl.vx * lane.dx + pl.vz * lane.dz; playerAhead = true; }
        }
        // عربيات من الحارات التانية داخلة في حارتي (مثلاً عربية متخبطة)
        // الإشارة
        if (lane.stop != null) {
          const dStop = lane.stop - (car.s + car.len / 2);
          if (signal === 'green') car.decidedGo = false;
          let mustStop = signal === 'red';
          if (signal === 'yellow') {
            if (!car.decidedGo) {
              const need = (car.v * car.v) / (2 * 3.0);
              if (dStop < need * 0.7 || dStop < 1) car.decidedGo = true;
            }
            mustStop = !car.decidedGo;
          }
          if (mustStop && dStop > -0.5 && dStop < 80) {
            const g = dStop + car.s0 - 0.6;
            if (g < gap) { gap = g; vLead = 0; }
          }
        }
        // IDM
        const v = car.v;
        const dv = v - vLead;
        const sStar = car.s0 + Math.max(0, v * car.T + (v * dv) / (2 * Math.sqrt(car.aMax * car.b)));
        let a = car.aMax * (1 - Math.pow(v / car.v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
        a = Math.max(-9, Math.min(car.aMax, a));
        if (car.bumped > 0) { car.bumped -= dt; a = -9; }
        car.acc += (a - car.acc) * Math.min(1, dt * 6);
        car.v = Math.max(0, car.v + a * dt);
        if (gap < 0.3 && vLead < car.v) car.v = Math.max(0, vLead);
        car.s += car.v * dt;

        // كلاكس لو الميكروباص بتاعك سادد الطريق
        car.honkCooldown -= dt;
        if (playerAhead && car.v < 1 && gap < 10 && signal !== 'red') car.waitBehindPlayer += dt; else car.waitBehindPlayer = Math.max(0, car.waitBehindPlayer - dt);
        if ((car.waitBehindPlayer > 2.5 || car.bumped > 0) && car.honkCooldown <= 0 && this.audio) {
          this.audio.honk(car.x, 1.2, car.z, car.type === 'microbus' ? 1.2 : 1);
          car.honkCooldown = 2 + this.R() * 4;
        }

        // نهاية الحارة: نرجعها للبداية لو محدش شايف
        if (car.s > lane.length) {
          const startX = lane.ox, startZ = lane.oz;
          const endX = lane.ox + lane.dx * lane.length, endZ = lane.oz + lane.dz * lane.length;
          const far = (x, z) => Math.hypot(pl.x - x, pl.z - z) > 45;
          const last = lane.cars[lane.cars.length - 1];
          const clear = !last || last === car || last.s > 14;
          if (far(startX, startZ) && far(endX, endZ) && clear) {
            car.s = 0; car.v = 6; car.decidedGo = false;
            lane.cars.splice(i, 1); lane.cars.push(car); i--;
          } else {
            car.s = lane.length; car.v = 0;
          }
        }
        this._place(car);
      }
    }
    // المرئيات
    for (const car of this.cars) {
      const r = car.rig;
      r.root.position.set(car.x, 0, car.z);
      r.root.rotation.y = car.yaw;
      car.spin += (car.v / (r.wheelRadius || 0.3)) * dt;
      for (const w of r.wheels) w.spin.rotation.x = -car.spin;
      if (r.body) r.body.rotation.x = car.acc * 0.006;
      const braking = car.acc < -0.6 || car.v < 0.3;
      if (r.brake) r.brake.emissiveIntensity = braking ? 3.5 : 0.15;
    }
  }

  /** أقرب العربيات (للصوت) */
  nearest(x, z, n) {
    return [...this.cars].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)).slice(0, n);
  }
}
