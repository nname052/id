// =====================================================================
//  مرور شبين الحقيقية: العربيات ماشية على شبكة الطرق نفسها (مش حارات مرسومة باليد)
//  - بتحترم الاتجاه الواحد، ومبتدخلش البوابات المقفولة (حدود المنطقة)
//  - في التقاطع: لفة ناعمة (منحنى) + "حجز" التقاطع لعربية واحدة في المرة (مفيش عربيات بتعدي في بعض)
//  - بتقف ورا اللي قدامها (عربية أو إنت)، وبتكلكس لو وقفت ورااك كتير
//  - عدد ثابت من العربيات (pool) بيتنقل حواليك: اللي بيبعد بيظهر في حتة تانية (مفيش إنشاء objects وقت اللعب)
// =====================================================================
import * as THREE from 'three';
import { edgePoint, edgesNear } from './ShibinData.js';
import { CAR_COLORS } from '../../vehicles/CarModels.js';
import { makeLodMesh } from '../../vehicles/TrafficLod.js';
import { findRoute } from '../../nav/RoadGraph.js';
import { canvas, tex } from '../../render/textures.js';

const TYPES = ['sedan', 'boxy', 'taxi', 'microbus', 'sedan', 'taxi', 'tuktuk', 'microbus', 'boxy', 'moto', 'sedan', 'taxi', 'tuktuk', 'microbus'];
const SMALL = { tuktuk: { vMul: 0.62, mass: 420 }, moto: { vMul: 0.9, mass: 220 } };
const ACTIVE_R = 230, SPAWN_MIN = 70, DESPAWN_R = 280;
const CLASS_W = { motorway: 3, trunk: 3, primary: 3, secondary: 2.6, tertiary: 2.2, unclassified: 1.4, residential: 1, living_street: 0.4, service: 0.25, road: 1, track: 0.15 };
const _a = {}, _b = {};

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class ShibinTraffic {
  constructor(scene, makeCar, audio, world, { count = 26, parked = 14 } = {}) {
    this.scene = scene; this.makeCar = makeCar; this.audio = audio; this.world = world; this.graph = world.graph;
    this.R = rng(9091);
    this.cars = [];
    this._stops = []; this._slows = [];
    this.parked = [];
    this.viewDist = 170;
    this.night = false;
    this.max = count;
    this.lodNear = 38;
    this.active = count;
    for (let i = 0; i < count; i++) {
      const type = TYPES[i % TYPES.length];
      const rig = makeCar(type, CAR_COLORS[Math.floor(this.R() * CAR_COLORS.length)]);
      rig.root.visible = false;
      scene.add(rig.root);
      const lod = makeLodMesh(rig.root);
      if (lod) scene.add(lod);
      this.cars.push({ lod,
        rig, type, on: false, off: false, len: rig.length || 4.4, width: rig.width || 1.8, mass: SMALL[type]?.mass || (type === 'microbus' ? 2400 : 1250),
        e: null, dir: 1, s: 0, v: 0, acc: 0, vMul: (SMALL[type]?.vMul || 1) * (0.85 + this.R() * 0.3), lane: 0, next: null, turn: null, hold: null,
        x: 0, y: 0, z: 0, yaw: 0, spin: 0, bumped: 0, kox: 0, koz: 0, honk: 3 + this.R() * 5, waitPlayer: 0, visible: false, stuck: 0,
      });
    }
    // عربيات مركونة على جنب الشارع (نسخة مخبوزة خفيفة، ثابتة) — بس في الشوارع اللي فيها مكان جنب حارة المرور
    const PT = ['sedan', 'boxy', 'taxi', 'boxy', 'microbus', 'sedan'];
    for (let i = 0; i < parked; i++) {
      const type = PT[i % PT.length];
      const rig = makeCar(type, CAR_COLORS[Math.floor(this.R() * CAR_COLORS.length)], { parked: true });
      rig.root.visible = false;
      rig.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      scene.add(rig.root);
      const lod = makeLodMesh(rig.root);
      if (lod) scene.add(lod);
      const len = type === 'microbus' ? 4.9 : rig.length || 4.4, width = type === 'microbus' ? 1.9 : rig.width || 1.8;
      this.parked.push({ lod, rig, type, on: false, len, width, x: 0, y: 0, z: 0, yaw: 0,
        col: { cx: 0, cz: 0, hx: width / 2, hz: len / 2, angle: 0, mass: 2200, restitution: 0.12, vx: 0, vz: 0, kind: 'car' } });
    }
  }

  // ===================== خطوط الميكروباص (عربيات المرور شغالة على خطوط) =====================
  /**
   * كل خط ← مسارين (رايح/جاي) كسلسلة وصلات: {e, dir, a, b} (a,b مسافات في اتجاه السير على الوصلة)
   * + المحطات اللي في النص (ri, s) + الموقف في الآخر. الرجوع بيتحسب لوحده (ممكن يختلف عن الرايح بسبب الاتجاه الواحد)
   */
  _buildLineRoutes() {
    this.lineRoutes = [];
    for (const L of this.world.lines || []) {
      const pair = [];
      for (const back of [0, 1]) {
        const stops = back ? [...L.stops].reverse() : L.stops;
        const route = [], marks = [];
        let ok = true, hx = 0, hz = 0;
        for (let k = 0; k < stops.length - 1 && ok; k++) {
          const A = stops[k], B = stops[k + 1];
          const r = findRoute(A.x, A.z, B.x, B.z, hx, hz);
          if (!r?.chain) { ok = false; break; }
          for (const el of r.chain) {
            const Lh = el.e.length, tc = (v) => (el.dir > 0 ? v : Lh - v);
            const a = el.s0 !== undefined ? tc(el.s0) : 0, b = el.s1 !== undefined ? tc(el.s1) : Lh;
            if (b - a < 0.3) continue;
            const last = route[route.length - 1];
            if (last && last.e === el.e && last.dir === el.dir && Math.abs(last.b - a) < 2) { last.b = Math.max(last.b, b); continue; }
            // لازم الوصلات تبقى متصلة (آخر وصلة خلصت عند العقدة اللي بتبدأ منها الجاية)
            if (last && (last.b < last.e.length - 1 || a > 1 || (last.dir > 0 ? last.e.to : last.e.from) !== (el.dir > 0 ? el.e.from : el.e.to))) { ok = false; break; }
            route.push({ e: el.e, dir: el.dir, a, b });
          }
          if (!ok || !route.length) { ok = false; break; }
          const last = route[route.length - 1];
          if (k < stops.length - 2) marks.push({ ri: route.length - 1, s: last.b, name: B.name });
          const n = r.pts.length, p1 = r.pts[n - 1], p0 = r.pts[Math.max(0, n - 4)], l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
          hx = (p1.x - p0.x) / l; hz = (p1.z - p0.z) / l;
        }
        if (!ok || route.length < 2) { pair.push(null); continue; }
        pair.push({ line: L, back, route, stops: marks, dest: stops[stops.length - 1].name, length: route.reduce((t, r) => t + r.b - r.a, 0) });
      }
      if (pair[0] && pair[1]) { pair[0].other = pair[1]; pair[1].other = pair[0]; this.lineRoutes.push(pair[0], pair[1]); }
    }
  }

  /** يافطة الخط على قزاز الميكروباص من قدام (للعربية الكاملة بس — من بعيد مش باينة) */
  _lineSign(c) {
    const LR = c.line;
    const key = `${LR.line.id}:${LR.back}`;
    this._signMats ||= new Map();
    let m = this._signMats.get(key);
    if (!m) {
      const cv = canvas(256, 64), x = cv.getContext('2d');
      x.fillStyle = '#111'; x.fillRect(0, 0, 256, 64);
      x.fillStyle = LR.line.color || '#f2c230'; x.fillRect(0, 0, 10, 64); x.fillRect(246, 0, 10, 64);
      x.fillStyle = '#ffe9a8'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
      let fs = 34; x.font = `bold ${fs}px Cairo, sans-serif`;
      while (x.measureText(LR.dest).width > 225 && fs > 16) { fs -= 2; x.font = `bold ${fs}px Cairo, sans-serif`; }
      x.fillText(LR.dest, 128, 34);
      m = new THREE.MeshBasicMaterial({ map: tex(cv, { repeat: false }), toneMapped: false });
      this._signMats.set(key, m);
    }
    let sg = c.rig.lineSign;
    if (!sg) {
      const bb = new THREE.Box3().setFromObject(c.rig.body || c.rig.root);
      c.rig.root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(c.rig.root.matrixWorld).invert(); bb.applyMatrix4(inv);
      sg = c.rig.lineSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), m);
      sg.position.set(0, bb.max.y - 0.42, bb.min.z - 0.01); sg.rotation.y = Math.PI;
      (c.rig.body || c.rig.root).add(sg);
    }
    sg.material = m;
  }

  _spawnLine(c, px, pz) {
    const LRs = this.lineRoutes;
    for (let t = 0; t < 14; t++) {
      const LR = LRs[Math.floor(this.R() * LRs.length)];
      const ri = Math.floor(this.R() * LR.route.length), el = LR.route[ri];
      const sT = el.a + this.R() * (el.b - el.a);
      this._at(el.e, el.dir, sT, 0, _b);
      const d = Math.hypot(_b.x - px, _b.z - pz);
      if (d < (this._first ? 25 : SPAWN_MIN) || d > ACTIVE_R) continue;
      if (!this._first && this._inView(_b.x, _b.z)) continue;
      if (this.cars.some((o) => o.on && (o.x - _b.x) ** 2 + (o.z - _b.z) ** 2 < 14 * 14)) continue;
      if (this.parked.some((q) => q.on && (q.x - _b.x) ** 2 + (q.z - _b.z) ** 2 < 8 * 8)) continue;
      c.line = LR; c.ri = ri;
      c.stopIdx = LR.stops.findIndex((st) => st.ri > ri || (st.ri === ri && st.s > sT + 3));
      if (c.stopIdx < 0) c.stopIdx = LR.stops.length;
      c.cap = 14; c.paxN = 2 + Math.floor(this.R() * 10); c.lstate = 'run'; c.atTerminal = false;
      this._lineSign(c);
      return { e: el.e, dir: el.dir, s: sT };
    }
    return null;
  }

  /** شغل الميكروباص على خطه: يقف في محطات الخط بالترتيب، وفي آخر الخط يستنى في الموقف ويرجع */
  _lineJob(c, dt, target) {
    const LR = c.line, el = LR.route[c.ri];
    if (!el || c.e !== el.e) return target;
    if (c.dwell > 0) {
      c.dwell -= dt; c.v = 0;
      if (c.dwell <= 0) {
        c.pull = null;
        if (c.atTerminal) {
          // رحلة الرجوع: لو بتبدأ من نفس الوصلة ونفس الاتجاه نكمل على طول، لو عكسه = لفة في الموقف (لما محدش شايف)
          const O = LR.other, f = O.route[0];
          if (f.e === c.e && f.dir === c.dir) { c.line = O; c.ri = 0; }
          else if (f.e === c.e && f.dir === -c.dir) {
            if (c.visible && (c.uWait = (c.uWait || 0) + 1) < 4) { c.dwell = 5; return 0; }
            c.line = O; c.ri = 0; c.dir = f.dir; c.s = Math.max(f.a, Math.min(f.b, c.e.length - c.s)); c.lane = c.laneHome = this._laneOff(c.e); c.uWait = 0;
          } else { c.line = null; return target; }
          c.atTerminal = false; c.lstate = 'run'; c.stopIdx = 0; c.paxN = 6 + Math.floor(this.R() * 9);
          this._lineSign(c);
        } else c.lstate = 'run';
      }
      return 0;
    }
    // المحطة الجاية على نفس الوصلة، أو الموقف لو دي آخر وصلة
    let haltS = null, kind = null;
    const st = LR.stops[c.stopIdx];
    if (st && st.ri === c.ri) { haltS = st.s; kind = 'stop'; }
    else if (c.ri === LR.route.length - 1) { haltS = el.b; kind = 'terminal'; }
    if (st && st.ri < c.ri) c.stopIdx++; // عدّاها (مثلًا اتولد بعدها)
    if (haltS === null) return target;
    const rem = haltS - c.s;
    if (rem < -3) { if (kind === 'stop') c.stopIdx++; c.pull = null; return target; }
    if (rem > 70) return target;
    if (!c.pull) c.pull = { s: haltS, curb: Math.max(c.lane, Math.min(c.e.half - 1.15, c.e.half * 0.8)), lane0: c.lane, kind };
    const P = c.pull;
    const k = Math.max(0, Math.min(1, 1 - (rem - 2) / 25));
    c.lane = P.lane0 + (P.curb - P.lane0) * k;
    if (rem < 1.0) {
      if (kind === 'terminal') { c.dwell = 25 + this.R() * 25; c.atTerminal = true; c.lstate = 'terminal'; c.paxN = 0; c.trips = (c.trips || 0) + 1; }
      else { c.dwell = 5 + this.R() * 8; c.lstate = 'stop'; c.stopIdx++; c.paxN = Math.max(0, Math.min(c.cap, c.paxN - Math.floor(this.R() * 4) + Math.floor(this.R() * 5))); }
      return 0;
    }
    return Math.min(target, Math.sqrt(2 * 1.8 * Math.max(0, rem)) + 0.3);
  }

  /** الميكروباص البعيد (Tier C): بيتقدم على مساره بسرعة متوسطة، بيقف في المحطات والموقف، وبيرجع يظهر لما يقرب ويبقى برا عينك */
  _virtualStep(c, dt, k, px, pz) {
    c._vAcc = (c._vAcc || 0) + dt;
    if (k % 3) return;
    dt = Math.min(0.5, c._vAcc); c._vAcc = 0;
    let LR = c.line;
    if (c.vdwell > 0) {
      c.vdwell -= dt;
      if (c.vdwell <= 0 && c.atTerminal) { LR = c.line = LR.other; c.ri = 0; c.s = LR.route[0].a; c.stopIdx = 0; c.atTerminal = false; c.paxN = 6 + Math.floor(this.R() * 9); }
      if (c.vdwell <= 0) c.lstate = 'run';
    } else {
      const el = LR.route[c.ri];
      let ns = c.s + 8.5 * dt;
      const st = LR.stops[c.stopIdx];
      if (st && st.ri === c.ri && c.s <= st.s && ns >= st.s) { ns = st.s; c.vdwell = 6 + this.R() * 6; c.stopIdx++; c.lstate = 'stop'; }
      if (ns >= el.b) {
        if (c.ri < LR.route.length - 1) { c.ri++; ns = LR.route[c.ri].a; }
        else { ns = el.b; c.vdwell = 25 + this.R() * 25; c.atTerminal = true; c.lstate = 'terminal'; c.trips = (c.trips || 0) + 1; }
      }
      c.s = ns;
    }
    const el = LR.route[c.ri];
    c.e = el.e; c.dir = el.dir;
    this._at(el.e, el.dir, c.s, 0, _b);
    c.x = _b.x; c.z = _b.z; c.y = _b.y;
    // يرجع عربية حقيقية: جوه نطاق المرور، برا عين الكاميرا، ومفيش حد مكانه
    const d2 = (c.x - px) ** 2 + (c.z - pz) ** 2;
    if (d2 < ACTIVE_R * ACTIVE_R && !c.off && !this._inView(c.x, c.z) && !this.cars.some((o) => o !== c && o.on && (o.x - c.x) ** 2 + (o.z - c.z) ** 2 < 12 * 12)) {
      c.virtual = false; c.on = true;
      c.lane = c.laneHome = this._laneOff(el.e); c.turn = null; c.next = null; c.hold = null; c.deadEnd = false; c.pull = null;
      c.dwell = Math.max(0, c.vdwell || 0); c.vdwell = 0; c.v = c.dwell > 0 ? 0 : 5; c.bumped = 0; c.kox = c.koz = 0; c.stuck = 0;
      this._at(el.e, el.dir, c.s, c.lane, _a); c.lastDx = _a.dx; c.lastDz = _a.dz;
      if (c.rig.lineSign) c.rig.lineSign.visible = true;
      this._place(c);
    }
  }

  /** حارة تانية في نفس الاتجاه لو الطريق فيه أكتر من حارة (للتخطي) — بيرجّع الإزاحات المتاحة */
  _laneSet(e) {
    if (!e.oneway) return (e.lanes || 2) >= 4 ? [0.25 * e.half, 0.75 * e.half] : null;
    const n = Math.max(1, e.lanes || 1);
    if (n < 2) return null;
    const out = []; for (let k = 0; k < n; k++) out.push(-e.half + (k + 0.5) * (e.width / n));
    return out;
  }

  /** تخطي آمن: لو اللي قدامي واقف/بطيء والحارة اللي جنبي فاضية قدام وورا ومش قريب من تقاطع أو محطة */
  _tryLaneChange(c, gap, vLead) {
    if (c.turn || c.pull || c.dwell > 0 || (c.lcCd > 0) || gap > 28 || vLead > Math.max(2, c.v * 0.6)) return;
    const set = this._laneSet(c.e); if (!set) return;
    if (c.e.length - c.s < 35 || c.s < 8) return;
    const hx = c.lastDx, hz = c.lastDz;
    let best = null;
    for (const off of set) {
      if (Math.abs(off - c.laneHome) < 0.8) continue;
      let free = true;
      for (const o of this.cars) {
        if (o === c || !o.on || o.off) continue;
        const dx = o.x - c.x, dz = o.z - c.z; if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
        const lon = dx * hx + dz * hz, lat = dx * -hz + dz * hx; // lat > 0 = يمين
        const laneLat = off - c.lane;
        if (Math.abs(lat - laneLat) < 1.6 + o.width / 2 && lon > -14 && lon < 22) { free = false; break; }
      }
      if (free && (!best || Math.abs(off - c.lane) < Math.abs(best - c.lane))) best = off;
    }
    c.lcCd = 3;
    if (best === null) return;
    c.laneHome = best; c.lcCd = 8; c.laneChanges = (c.laneChanges || 0) + 1;
  }

  /** القريب = العربية الكاملة، الأبعد = نسخة مخبوزة (draw call واحد) — بهامش عشان مايترعشش عند الحد */
  _show(o, vis, d2) {
    const R = this.lodNear, useLod = !!o.lod && vis && d2 > (o._useLod ? (R - 5) * (R - 5) : R * R);
    o._useLod = useLod;
    o.rig.root.visible = vis && !useLod;
    if (o.lod) {
      o.lod.visible = useLod;
      if (useLod) { o.lod.position.set(o.x, o.y, o.z); o.lod.rotation.set(0, o.yaw, 0); }
    }
    return useLod;
  }

  /** مكان ركنة على الوصلة دي (إزاحة من النص) أو null لو الشارع ضيق (العربية المركونة هتقفل حارة المرور) */
  _parkOff(e) {
    if (e.closed || e.elevated || e.bridge || e.noAccess) return null;
    const cls = e.cls.replace('_link', '');
    if (!['primary', 'secondary', 'tertiary', 'unclassified', 'residential'].includes(cls)) return null;
    let laneEdge; // أبعد نقطة بتوصلها عربيات المرور ناحية اليمين
    if (!e.oneway) laneEdge = (e.lanes || 2) >= 4 ? 0.75 * e.half + 1.0 : Math.max(1.0, Math.min(2.2, e.half * 0.5)) + 1.0;
    else { const n = Math.max(1, e.lanes || 1); laneEdge = n === 1 ? 1.0 : e.half; }
    const off = e.half - 1.05;
    return off - 0.95 > laneEdge + 0.25 ? off : null;
  }

  _spawnParked(q, px, pz, fx, fz, first) {
    for (let t = 0; t < 10; t++) {
      const ang = this.R() * Math.PI * 2, d = (first ? 20 : 60) + this.R() * 110;
      const ux = Math.cos(ang), uz = Math.sin(ang);
      if (!first && d < this.viewDist + 10 && ux * fx + uz * fz > -0.3) continue; // مايظهرش قدام عينك
      const near = edgesNear(this.graph, px + ux * d, pz + uz * d, 25, this._near || (this._near = []));
      if (!near.length) continue;
      const e = near[Math.floor(this.R() * near.length)];
      const off = this._parkOff(e);
      if (off === null || e.length < 30) continue;
      const s = 12 + this.R() * (e.length - 24), side = e.oneway ? 1 : this.R() < 0.5 ? 1 : -1;
      const dir = side;
      this._at(e, dir, dir > 0 ? s : e.length - s, off, _a);
      // مفيش عربية مركونة/موقف/كمين قريب
      if (!first && this._inView(_a.x, _a.z)) continue;
      if (this.parked.some((o) => o.on && o !== q && (o.x - _a.x) ** 2 + (o.z - _a.z) ** 2 < 7 * 7)) continue;
      if (this.cars.some((o) => o.on && (o.x - _a.x) ** 2 + (o.z - _a.z) ** 2 < 9 * 9)) continue;
      if (this.world.nearReserved?.(_a.x, _a.z, 14)) continue;
      const h = this.world.height(_a.x, _a.z, 0);
      if (Math.abs(h) > 0.05) continue; // لازم أسفلت (مش رصيف/ترعة/كوبري)
      q.x = _a.x; q.z = _a.z; q.y = h; q.yaw = Math.atan2(-_a.dx, -_a.dz) + (this.R() - 0.5) * 0.05;
      q.on = true;
      const r = q.rig.root; r.position.set(q.x, q.y, q.z); r.rotation.set(0, q.yaw, 0); r.updateMatrixWorld(true);
      q.col.cx = q.x; q.col.cz = q.z; q.col.angle = q.yaw;
      return true;
    }
    return false;
  }

  _updateParked(px, pz, fx, fz, cx, cz) {
    const first = !this._parkedInit; this._parkedInit = true;
    let n = 0;
    const far2 = this.viewDist * this.viewDist;
    for (const q of this.parked) {
      if (q.off) { if (q.on) { q.on = false; this._show(q, false, 0); } continue; }
      if (q.on) {
        const d2 = (q.x - px) ** 2 + (q.z - pz) ** 2;
        // بتتشال بس لما تبقى بعيدة جدًا (برا مدى الرؤية) → مفيش اختفا قدام عينك
        if (d2 > 240 * 240) { q.on = false; this._show(q, false, 0); continue; }
        const dc2 = (q.x - cx) ** 2 + (q.z - cz) ** 2;
        this._show(q, dc2 < far2, dc2);
      } else if (n++ < (first ? 99 : 1)) this._spawnParked(q, px, pz, fx, fz, first);
    }
  }

  // ===================== أماكن =====================
  _len(e) { return e.length; }
  _endNode(c) { return c.dir > 0 ? c.e.to : c.e.from; }

  /** حارة العربية على الوصلة: يمين اتجاه السير */
  _laneOff(e) {
    if (!e.oneway) {
      // باتجاهين: 4 حارات أو أكتر → يا الحارة الجوانية يا البرانية في اتجاهك
      if ((e.lanes || 2) >= 4) return (this.R() < 0.5 ? 0.25 : 0.75) * e.half;
      return Math.max(1.0, Math.min(2.2, e.half * 0.5));
    }
    const n = Math.max(1, e.lanes || 1);
    if (n === 1) return 0;
    const k = Math.floor(this.R() * n);
    return -e.half + (k + 0.5) * (e.width / n);
  }

  /** نقطة على وصلة باتجاه السير (s من أول اتجاه السير) + إزاحة الحارة */
  _at(e, dir, s, off, out) {
    const es = dir > 0 ? s : e.length - s;
    edgePoint(e, es, out);
    const dx = out.dx * dir, dz = out.dz * dir;
    out.x += -dz * off; out.z += dx * off;
    out.dx = dx; out.dz = dz;
    return out;
  }

  _allowed(e, node) {
    if (e.closed || e.noAccess) return false;
    if (e.oneway && e.from !== node) return false;
    return true;
  }

  /** اختيار الوصلة الجاية عند التقاطع (مستقيم/طريق أكبر أحسن، مفيش رجوع إلا لو طريق مسدود) */
  _pickNext(c) {
    if (c.line) {
      const el = c.line.route[c.ri], nx = c.line.route[c.ri + 1];
      if (el && nx && el.e === c.e && el.b >= c.e.length - 1) return { e: nx.e, dir: nx.dir };
      if (el && el.e === c.e) return 'hold'; // آخر الخط/محطة في نص الوصلة: مفيش لفة
      c.line = null; // خرج عن خطه (خبطة/زقة): يكمل كعربية عادية
    }
    const node = this._endNode(c);
    const inDx = c.lastDx, inDz = c.lastDz;
    let tot = 0;
    const opts = this._opts || (this._opts = []);
    opts.length = 0;
    for (const e of node.edges) {
      if (e === c.e || !this._allowed(e, node)) continue;
      const dir = e.from === node ? 1 : -1;
      this._at(e, dir, Math.min(6, e.length * 0.5), 0, _b);
      const ox = _b.x - node.x, oz = _b.z - node.z, l = Math.hypot(ox, oz) || 1;
      const straight = (ox / l) * inDx + (oz / l) * inDz;
      if (straight < -0.75) continue; // لفة حادة جدًا لورا
      const w = (CLASS_W[e.cls.replace('_link', '')] || 0.5) * (1.2 + straight);
      opts.push([e, dir, w]); tot += w;
    }
    if (!opts.length) {
      // طريق مسدود: لفة وراجع (لو مش one-way)
      if (!c.e.oneway) return { e: c.e, dir: -c.dir };
      return null;
    }
    let r = this.R() * tot;
    for (const o of opts) { r -= o[2]; if (r <= 0) return { e: o[0], dir: o[1] }; }
    const o = opts[opts.length - 1];
    return { e: o[0], dir: o[1] };
  }

  // ===================== الظهور/الاختفاء =====================
  _spawn(c, px, pz, fx, fz) {
    c.line = null;
    if (c.rig.lineSign) c.rig.lineSign.visible = false;
    if (c.type === 'microbus' && this.lineRoutes?.length && this.R() < 0.85) {
      const p = this._spawnLine(c, px, pz);
      if (p) {
        c.rig.lineSign.visible = true;
        c.e = p.e; c.dir = p.dir; c.s = p.s; c.lane = c.laneHome = this._laneOff(p.e); c.turn = null; c.next = null; c.hold = null; c.deadEnd = false; c.pull = null; c.dwell = 0;
        c.v = Math.min(8, (p.e.speed / 3.6) * 0.6); c.on = true; c.bumped = 0; c.kox = c.koz = 0; c.stuck = 0;
        this._at(p.e, p.dir, p.s, c.lane, _a); c.lastDx = _a.dx; c.lastDz = _a.dz;
        this._place(c);
        return true;
      }
      // مفيش مكان على خط قريب: الميكروباص بيبقى شغال على خط بعيد (حساب رخيص) لحد ما يقرب
      if (this.R() < 0.75) {
        const LR = this.lineRoutes[Math.floor(this.R() * this.lineRoutes.length)];
        c.line = LR; c.ri = Math.floor(this.R() * LR.route.length); c.s = LR.route[c.ri].a; c.e = LR.route[c.ri].e; c.dir = LR.route[c.ri].dir;
        c.stopIdx = LR.stops.findIndex((st) => st.ri >= c.ri); if (c.stopIdx < 0) c.stopIdx = LR.stops.length;
        c.cap = 14; c.paxN = 3 + Math.floor(this.R() * 8); c.lstate = 'run'; c.atTerminal = false; c.vdwell = 0; c._vAcc = 0;
        this._lineSign(c); c.rig.lineSign.visible = false;
        c.virtual = true;
        return true;
      }
    }
    for (let t = 0; t < 12; t++) {
      const ang = this.R() * Math.PI * 2, d = SPAWN_MIN + this.R() * (ACTIVE_R - SPAWN_MIN);
      const ux = Math.cos(ang), uz = Math.sin(ang);
      // مفيش ظهور جوه مدى الرؤية قدامك: يا برا مدى الرؤية خالص، يا وراك (أول ملي للدنيا بس مسموح في أي حتة)
      if (!this._first && d < this.viewDist + 15 && ux * fx + uz * fz > -0.35) continue;
      if (this._first && d < 25) continue;
      const near = edgesNear(this.graph, px + ux * d, pz + uz * d, 30, this._near || (this._near = []));
      const small = c.type === 'tuktuk' || c.type === 'moto';
      const cand = near.filter((e) => !e.closed && !e.noAccess && e.length > 12 && (CLASS_W[e.cls.replace('_link', '')] || 0) >= 0.4 && !(c.type === 'tuktuk' && ['primary', 'trunk', 'motorway'].includes(e.cls)));
      void small;
      // الزحمة مش في كل حتة بنفس الدرجة: وسط البلد/المواقف أكتر، الأطراف والغيطان أقل
      const cx0 = px + ux * d, cz0 = pz + uz * d, urban = Math.hypot(cx0, cz0) < 1300 ? 1 : Math.hypot(cx0, cz0) < 2200 ? 0.6 : 0.3;
      if (this.R() > urban) continue;
      if (!cand.length) continue;
      const e = cand[Math.floor(this.R() * cand.length)];
      const dir = e.oneway ? 1 : this.R() < 0.5 ? 1 : -1;
      const s = 4 + this.R() * (e.length - 8);
      // مفيش عربية قريبة على نفس الوصلة
      if (this.cars.some((o) => o.on && o.e === e && o.dir === dir && Math.abs(o.s - s) < 14)) continue;
      // مش فوق عربية مركونة، ومش قدام عينك
      this._at(e, dir, s, 0, _b);
      if (!this._first && this._inView(_b.x, _b.z)) continue;
      if (this.parked.some((q) => q.on && (q.x - _b.x) ** 2 + (q.z - _b.z) ** 2 < 8 * 8)) continue;
      c.e = e; c.dir = dir; c.s = s; c.lane = c.laneHome = this._laneOff(e); c.turn = null; c.next = null; c.hold = null; c.deadEnd = false; c.pull = null; c.dwell = 0;
      c.v = Math.min(8, (e.speed / 3.6) * 0.6); c.on = true; c.bumped = 0; c.kox = c.koz = 0; c.stuck = 0;
      this._at(e, dir, s, c.lane, _a);
      c.lastDx = _a.dx; c.lastDz = _a.dz;
      this._place(c);
      return true;
    }
    return false;
  }

  /** المكان ده هيبان للكاميرا؟ (جوه مدى الرؤية ومش ورا) → مينفعش نظهر فيه عربية */
  _inView(x, z) {
    const C = this._cam, dx = x - C.x, dz = z - C.z, d = Math.hypot(dx, dz);
    if (d > this.viewDist + 15) return false;
    if (d < 30) return true; // قريب أوي: حتى لو ورا ممكن يبان في المراية/اللفة
    return (dx * C.fx + dz * C.fz) / d > -0.35;
  }

  _release(c) {
    if (c.hold) { if (c.hold.res === c) c.hold.res = null; c.hold = null; }
  }

  // ===================== الحركة =====================
  _place(c) {
    if (c.turn) {
      const T = c.turn, u = Math.min(1, c.turnU), iu = 1 - u;
      const x = iu * iu * T.ax + 2 * iu * u * T.cx + u * u * T.bx, z = iu * iu * T.az + 2 * iu * u * T.cz + u * u * T.bz;
      const dx = 2 * iu * (T.cx - T.ax) + 2 * u * (T.bx - T.cx), dz = 2 * iu * (T.cz - T.az) + 2 * u * (T.bz - T.cz), l = Math.hypot(dx, dz) || 1;
      c.x = x; c.z = z; c.y = T.ay + (T.by - T.ay) * u; c.yaw = Math.atan2(-dx / l, -dz / l);
      c.lastDx = dx / l; c.lastDz = dz / l;
    } else {
      this._at(c.e, c.dir, c.s, c.lane, _a);
      c.x = _a.x; c.z = _a.z; c.y = _a.y; c.yaw = Math.atan2(-_a.dx, -_a.dz);
      c.lastDx = _a.dx; c.lastDz = _a.dz;
    }
    c.x += c.kox; c.z += c.koz;
  }

  /** بداية اللفة عند التقاطع: منحنى من آخر الوصلة دي لأول الجاية */
  _beginTurn(c) {
    const n = c.next, node = this._endNode(c);
    const T1 = Math.min(6, c.e.length * 0.45), T2 = Math.min(6, n.e.length * 0.45);
    const lane2 = n.e === c.e ? c.lane : this._laneOff(n.e);
    this._at(c.e, c.dir, c.e.length - T1, c.lane, _a);
    this._at(n.e, n.dir, T2, lane2, _b);
    // نقطة التحكم: تقاطع امتداد الاتجاهين (أو نص التقاطع لو متوازيين)
    let cx = node.x, cz = node.z;
    const den = _a.dx * _b.dz - _a.dz * _b.dx;
    if (Math.abs(den) > 0.15) {
      const t = ((_b.x - _a.x) * _b.dz - (_b.z - _a.z) * _b.dx) / den;
      if (t > 0 && t < T1 * 3) { cx = _a.x + _a.dx * t; cz = _a.z + _a.dz * t; }
    } else { cx = (_a.x + _b.x) / 2 + _a.dx * 2; cz = (_a.z + _b.z) / 2 + _a.dz * 2; }
    const len = Math.hypot(cx - _a.x, cz - _a.z) + Math.hypot(_b.x - cx, _b.z - cz);
    c.turn = { ax: _a.x, az: _a.z, ay: _a.y, bx: _b.x, bz: _b.z, by: _b.y, cx, cz, len: Math.max(1, len), T2, lane2 };
    c.turnU = 0;
  }

  colliders(box, out) {
    const r = Math.hypot(box.hx, box.hz) + 4;
    for (const c of this.cars) {
      if (!c.on || c.off) continue;
      if (Math.abs(c.x - box.cx) > r || Math.abs(c.z - box.cz) > r || Math.abs(c.y - (this._py || 0)) > 2.5) continue;
      out.push(this._collider(c));
    }
    for (const q of this.parked) if (q.on && Math.abs(q.x - box.cx) < r && Math.abs(q.z - box.cz) < r && Math.abs(q.y - (this._py || 0)) < 2.5) out.push(q.col);
  }

  _collider(c) {
    let col = c._col;
    if (!col) {
      col = c._col = {
        cx: 0, cz: 0, hx: c.width / 2, hz: c.len / 2, angle: 0, mass: c.mass, restitution: 0.15, vx: 0, vz: 0, kind: 'car', car: c,
        onHit: (dv, jx = 0, jz = 0) => {
          c.bumped = Math.max(c.bumped, 2.5 + Math.min(3, dv)); c.v = 0;
          c.kvx = (c.kvx || 0) + jx / c.mass; c.kvz = (c.kvz || 0) + jz / c.mass;
          c.honk = Math.min(c.honk, 0.4);
        },
        onPush: (dx, dz) => { c.kox += dx; c.koz += dz; },
      };
    }
    col.cx = c.x; col.cz = c.z; col.angle = c.yaw;
    col.vx = -Math.sin(c.yaw) * c.v + (c.kvx || 0); col.vz = -Math.cos(c.yaw) * c.v + (c.kvz || 0);
    return col;
  }

  update(dt, player, camPos) {
    const pl = player.physics;
    this._py = pl.heave - pl.spec.cgHeight;
    const [fx, fz] = pl.forward;
    const px = pl.x, pz = pl.z;
    const pBox = pl.getBox();
    let n = 0;
    const fr = (this._frame = (this._frame || 0) + 1);
    this._simT = (this._simT || 0) + dt;
    this._stops = [...(this.world.rail?.stopZones || []), ...(this.extraStops?.() || [])];
    this._slows = this.extraSlows?.() || [];
    if (!this.lineRoutes) this._buildLineRoutes();
    this._first = fr === 1;
    const C = this._cam || (this._cam = {});
    C.x = camPos ? camPos.x : px; C.z = camPos ? camPos.z : pz; C.fx = fx; C.fz = fz;
    this._updateParked(px, pz, fx, fz, camPos ? camPos.x : px, camPos ? camPos.z : pz);
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (c.off) continue;
      if (c.virtual) { this._virtualStep(c, dt, fr + i, px, pz); continue; }
      if (!c.on) { if (n++ < (this._first ? 99 : 2)) this._spawn(c, px, pz, fx, fz); continue; }
      const d2 = (c.x - px) ** 2 + (c.z - pz) ** 2;
      if (d2 > DESPAWN_R * DESPAWN_R) {
        this._release(c); c.on = false; c.rig.root.visible = false;
        // ميكروباص الخط بيكمل شغله "على الورق" وهو بعيد (حساب رخيص من غير رسم) — مش بيختفي من الخط
        if (c.line && !c.turn) { c.virtual = true; c.vdwell = 0; c.pull = null; c.dwell = 0; c._vAcc = 0; }
        continue;
      }
      // البعيد بيتحدّث كل 3 فريمات (بنفس الوقت الكلي) — القريب كل فريم
      c._dtAcc = (c._dtAcc || 0) + dt;
      if (d2 > 110 * 110 && (fr + i) % 3) continue;
      this._drive(c, Math.min(0.2, c._dtAcc), pl, pBox);
      c._dtAcc = 0;
    }
    // المرئيات
    const cx = camPos ? camPos.x : px, cz = camPos ? camPos.z : pz;
    const far2 = this.viewDist * this.viewDist;
    for (const c of this.cars) {
      const r = c.rig;
      const vis = c.on && !c.off && (c.x - cx) ** 2 + (c.z - cz) ** 2 < far2;
      c.visible = vis;
      const d2 = (c.x - cx) ** 2 + (c.z - cz) ** 2;
      if (this._show(c, vis, d2) || !vis) continue;
      const near = d2 < 70 * 70, shadow = d2 < 45 * 45;
      if (near !== c._near) { c._near = near; for (const w of r.wheels || []) w.group.visible = near; }
      if (shadow !== c._shadow) { c._shadow = shadow; r.root.traverse((o) => { if (o.isMesh && o.userData.role !== 'glass' && o.userData.role !== 'shadow') o.castShadow = shadow; }); }
      r.root.position.set(c.x, c.y, c.z);
      r.root.rotation.set(0, c.yaw, 0);
      c.spin += (c.v / (r.wheelRadius || 0.3)) * dt;
      for (const w of r.wheels || []) if (w.spin) w.spin.rotation.x = -c.spin;
      if (r.body) r.body.rotation.x = c.acc * 0.006;
      if (r.brake) r.brake.emissiveIntensity = c.acc < -0.6 || c.v < 0.3 ? 3.5 : this.night ? 1.0 : 0.15;
    }
  }

  _drive(c, dt, pl, pBox) {
    // الخبطة: وقوف + زقة بتهدى
    if (c.bumped > 0) {
      c.bumped -= dt; c.v = 0; c.acc = -9;
      c.kox += (c.kvx || 0) * dt; c.koz += (c.kvz || 0) * dt;
      c.kvx = (c.kvx || 0) * Math.exp(-dt * 3); c.kvz = (c.kvz || 0) * Math.exp(-dt * 3);
      this._place(c);
      return;
    }
    c.kox *= Math.exp(-dt * 0.8); c.koz *= Math.exp(-dt * 0.8);
    const e = c.e, L = e.length;
    if (!c.pull && c.laneHome !== undefined && c.laneHome !== c.lane && !c.turn) { const d = c.laneHome - c.lane; c.lane += Math.sign(d) * Math.min(Math.abs(d), dt * 0.9); }
    let vMax = Math.max(4, (e.speed / 3.6) * c.vMul * (e.cls === 'residential' ? 0.8 : 1));
    // مناطق تهدية (كمين شغال…): السرعة القصوى بتقل جواها
    for (const z of this._slows) if ((z.x - c.x) ** 2 + (z.z - c.z) ** 2 < z.r * z.r) vMax = Math.min(vMax, z.v);
    // ===== اللي قدامي (عربية أو اللاعب) في نفس اتجاهي =====
    let gap = 1e9, vLead = 30, playerAhead = false;
    const hx = c.lastDx, hz = c.lastDz;
    for (const o of this.cars) {
      if (o === c || !o.on || o.off) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      if (Math.abs(dx) > 45 || Math.abs(dz) > 45) continue;
      const lon = dx * hx + dz * hz; if (lon <= 0 || lon > 45) continue;
      const lat = Math.abs(dx * -hz + dz * hx); if (lat > (c.turn || o.turn ? 2.5 : 1.9)) continue; // في اللفة المسار بيقصّر: هامش أوسع
      if (Math.abs(o.y - c.y) > 2.5) continue;
      const g = lon - (o.len + c.len) / 2;
      if (g < gap) { gap = g; vLead = (o.lastDx * hx + o.lastDz * hz) * o.v; }
    }
    // ناس بتعدّي الشارع قدامي: أقف
    for (const q of this.crowd?.crossers || []) {
      if (q.cross?.blocked) continue; // واقف مستني العربية دي تمشي
      const dx = q.x - c.x, dz = q.z - c.z;
      if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
      const lon = dx * hx + dz * hz;
      if (lon > -1 && dx * dx + dz * dz < (c.len / 2 + 2.5) ** 2) { gap = 0.1; vLead = 0; continue; } // لازق في العربية (لفة/تقاطع): وقفة فورية
      if (lon <= 0) continue;
      if (Math.abs(dx * -hz + dz * hx) > c.width / 2 + 1.2) continue;
      const g = lon - c.len / 2 - 1.5;
      if (g < gap) { gap = Math.max(0.1, g); vLead = 0; }
    }
    // أماكن لازم يقف قبلها (مزلقان مقفول، كمين…): من الأنظمة التانية — بتتحسب مرة كل خطوة
    for (const z of this._stops) {
      const dx = z.x - c.x, dz = z.z - c.z;
      if (Math.abs(dx) > 45 || Math.abs(dz) > 45) continue;
      const lon = dx * hx + dz * hz; if (lon <= -0.5) continue;
      if (Math.abs(dx * -hz + dz * hx) > z.r) continue;
      const g = lon - c.len / 2 - (z.gap ?? 3.5);
      if (g < gap) { gap = Math.max(0.1, g); vLead = 0; }
    }
    for (const q of this.parked) {
      if (!q.on) continue;
      const dx = q.x - c.x, dz = q.z - c.z;
      if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
      const lon = dx * hx + dz * hz; if (lon <= 0) continue;
      if (Math.abs(dx * -hz + dz * hx) > (q.width + c.width) / 2 + 0.2) continue;
      const g = lon - (q.len + c.len) / 2;
      if (g < gap) { gap = g; vLead = 0; }
    }
    {
      const dx = pl.x - c.x, dz = pl.z - c.z;
      const lon = dx * hx + dz * hz, lat = Math.abs(dx * -hz + dz * hx);
      if (lon > 0 && lon < 50 && lat < 1.4 + pBox.hx && Math.abs(this._py - c.y) < 2.5) {
        const g = lon - c.len / 2 - pBox.hz;
        if (g < gap) { gap = g; vLead = Math.max(0, pl.vx * hx + pl.vz * hz); playerAhead = true; }
      }
    }
    // ===== التقاطع الجاي =====
    let target = vMax;
    if (!c.turn) {
      const rem = L - c.s;
      if (!c.next && rem < 40) {
        c.next = this._pickNext(c);
        if (c.next === 'hold') c.next = null;
        else if (!c.next) c.deadEnd = true;
      }
      if (c.deadEnd) {
        // طريق مقفول (اتجاه واحد/بوابة): تقف على مهلها وتتشال لما تبقى برا عينك
        target = Math.min(target, Math.sqrt(2 * 2.5 * Math.max(0, rem - 3)));
        if (!c.visible) { c.deadEnd = false; this._release(c); c.on = false; c.rig.root.visible = false; return; }
      }
      if (c.next) {
        const node = this._endNode(c);
        // سرعة اللفة على قد زاويتها
        this._at(c.next.e, c.next.dir, Math.min(6, c.next.e.length * 0.5), 0, _b);
        const ox = _b.x - node.x, oz = _b.z - node.z, l = Math.hypot(ox, oz) || 1;
        const cosT = (ox / l) * hx + (oz / l) * hz;
        const vTurn = c.next.e === c.e ? 2.5 : 3 + 9 * Math.max(0, cosT) ** 2;
        const T1 = Math.min(6, L * 0.45);
        if (rem - T1 < 30) target = Math.min(target, Math.sqrt(vTurn * vTurn + 2 * 2.5 * Math.max(0, rem - T1)));
        // حجز التقاطع (تقاطع حقيقي بس = 3 وصلات أو أكتر)
        if (node.edges.length >= 3 && rem < T1 + 14) {
          if (!c.hold || c.hold !== node) {
            const R = node.res, busy = R && R !== c && R.on && ((this._simT - node.resT) < 6 || ((this._simT - node.resT) < 15 && (R.x - node.x) ** 2 + (R.z - node.z) ** 2 < 10 * 10)); // (وقت اللعبة مش وقت الساعة) + لو اللي حاجزه لسه جوه التقاطع
            const playerIn = (pl.x - node.x) ** 2 + (pl.z - node.z) ** 2 < 11 * 11 && Math.abs(this._py - (c.y)) < 2.5;
            if (busy || playerIn) {
              const g = rem - T1 - 2.5;
              if (g < gap) { gap = Math.max(0.1, g); vLead = 0; }
            } else { this._release(c); node.res = c; node.resT = this._simT; c.hold = node; }
          }
        }
        if (rem <= T1 + 0.05 && (c.hold === this._endNode(c) || node.edges.length < 3)) this._beginTurn(c);
      }
    }
    // ===== شغل السواقين: الميكروباص (وساعات التاكسي) بيقف على جنب في أماكن الركوب يحمّل/ينزّل =====
    c.lcCd = (c.lcCd || 0) - dt;
    this._tryLaneChange(c, gap, vLead);
    target = this._job(c, dt, target);
    if (c.dwell > 0) { c.v = 0; c.acc = 0; this._place(c); return; }
    // ===== IDM =====
    const v = c.v, aMax = 1.6, b = 3, T = 1.2, s0 = 2.2;
    const sStar = s0 + Math.max(0, v * T + (v * (v - vLead)) / (2 * Math.sqrt(aMax * b)));
    let a = aMax * (1 - Math.pow(v / Math.max(1, target), 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
    a = Math.max(-8, Math.min(aMax, a));
    c.acc += (a - c.acc) * Math.min(1, dt * 6);
    c.v = Math.max(0, c.v + a * dt);
    if (gap < 0.3 && vLead < c.v) c.v = Math.max(0, vLead);
    // كلاكس لو واقف وراك
    c.honk -= dt;
    if (playerAhead && c.v < 1 && gap < 9) c.waitPlayer += dt; else c.waitPlayer = Math.max(0, c.waitPlayer - dt);
    if (c.waitPlayer > 2.5 && c.honk <= 0 && this.audio && c.visible) { this.audio.honk(c.x, c.y + 1.2, c.z, c.type === 'microbus' ? 1.2 : 1); c.honk = 2 + this.R() * 4; }
    // عربية واقفة كتير جدًا (زحمة مقفولة): تختفي وتظهر في حتة تانية بعيد عن عينك
    c.stuck = c.v < 0.2 ? c.stuck + dt : 0;
    if (c.stuck > 25 && !c.visible) { this._release(c); c.on = false; return; }
    // ===== التقدم =====
    const ds = c.v * dt;
    if (c.turn) {
      c.turnU += ds / c.turn.len;
      if (c.turnU >= 1) {
        const t = c.turn, nx = c.next;
        c.e = nx.e; c.dir = nx.dir; c.s = t.T2 + (c.turnU - 1) * t.len; c.lane = c.laneHome = t.lane2;
        if (c.line) c.ri++;
        c.turn = null; c.next = null;
      }
    } else c.s += ds;
    // سبنا التقاطع → نفك الحجز
    if (c.hold && !c.turn && c.hold !== this._endNode(c) && c.s > 8 + c.len) this._release(c); // نفك الحجز بعد ما العربية كلها تبعد عن التقاطع
    if (!c.turn && c.s > c.e.length) { c.s = c.e.length; c.v = 0; }
    this._place(c);
  }

  /** أماكن الركوب على كل وصلة (من نفس أماكن ركاب اللاعب على الأرصفة الحقيقية) */
  _stopsOn(e, side) {
    if (!this._stopIdx) {
      this._stopIdx = new Map();
      const W = this.world.stopCandidates?.();
      for (const c of W ? W.cands : []) { const k = c.edge.id * 2 + (c.side > 0 ? 0 : 1); let a = this._stopIdx.get(k); if (!a) this._stopIdx.set(k, (a = [])); a.push(c); }
    }
    return this._stopIdx.get(e.id * 2 + (side > 0 ? 0 : 1));
  }

  _job(c, dt, target) {
    if (c.line) return this._lineJob(c, dt, target);
    if (c.type !== 'microbus' && c.type !== 'taxi') return target;
    c.jobCd = (c.jobCd ?? 8 + this.R() * 20) - dt;
    const e = c.e;
    if (c.dwell > 0) {
      // واقف بيحمّل: أبواب/ركاب (منظر) — وبعدين يكمل
      c.dwell -= dt; c.v = 0;
      if (c.dwell <= 0) { c.pull = null; c.jobCd = c.type === 'microbus' ? 25 + this.R() * 35 : 60 + this.R() * 90; }
      return 0;
    }
    if (!c.pull && !c.turn && !c.deadEnd && c.jobCd <= 0 && (c.type === 'microbus' || this.R() < 0.3)) {
      const list = this._stopsOn(e, c.dir);
      if (list) for (const st of list) {
        const sT = c.dir > 0 ? st.s : e.length - st.s; // مكانه في اتجاه السير
        const ahead = sT - c.s;
        if (ahead < 18 || ahead > 60 || sT > e.length - 10) continue;
        const curb = e.half - 1.15;
        if (curb < 1.2 || this.parked.some((q) => q.on && (q.x - st.mx) ** 2 + (q.z - st.mz) ** 2 < 8 * 8)) continue;
        if (this.cars.some((o) => o !== c && o.pull && o.e === e && Math.abs((o.pull.s) - sT) < 12)) continue;
        c.pull = { s: sT, curb, lane0: c.lane };
        break;
      }
      if (!c.pull) c.jobCd = 4;
    }
    const P = c.pull;
    if (!P) return target;
    if (c.turn || c.e !== e) { c.pull = null; return target; }
    const rem = P.s - c.s;
    if (rem < -3) { c.pull = null; return target; }
    // بيقرب من الرصيف تدريجيًا في آخر 25م، وبيهدّي لحد ما يقف عند المكان
    const k = Math.max(0, Math.min(1, 1 - (rem - 2) / 25));
    c.lane = P.lane0 + (P.curb - P.lane0) * k;
    if (rem < 1.0) { c.dwell = c.type === 'microbus' ? 5 + this.R() * 7 : 3 + this.R() * 3; return 0; }
    return Math.min(target, Math.sqrt(2 * 1.8 * Math.max(0, rem)) + 0.3);
  }

  setDensity(k) {
    this.active = Math.round(this.max * k);
    const np = Math.round(this.parked.length * Math.min(1, k * 1.2));
    this.parked.forEach((q, i) => { q.off = i >= np; });
    this.cars.forEach((c, i) => {
      const off = i >= this.active;
      if (off && c.on) { this._release(c); c.on = false; }
      if (off) c.virtual = false;
      c.off = off;
      if (off) { c.visible = false; c.rig.root.visible = false; }
    });
  }

  setNight(on) {
    this.night = on;
    for (const c of this.cars) {
      if (c.rig.mats?.headlight) c.rig.mats.headlight.emissiveIntensity = on ? 2.5 : 0.05;
      if (c.rig.lights?.head) c.rig.lights.head.emissiveIntensity = on ? 2.2 : 0;
    }
  }

  nearest(x, z, n) {
    const arr = this._nearArr || (this._nearArr = []);
    arr.length = 0;
    for (const c of this.cars) if (c.visible) arr.push(c);
    arr.sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2));
    return arr.slice(0, n);
  }

  /** للاختبار: كام عربية شغالة، وهل فيه عربيتين جوه بعض */
  debugStats() {
    const on = this.cars.filter((c) => c.on && !c.off);
    let overlaps = 0;
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
      const a = on[i], b = on[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) < 1.6 && Math.abs(a.y - b.y) < 1) overlaps++;
    }
    let parkedHit = 0;
    const pk = this.parked.filter((q) => q.on);
    for (const a of on) for (const q of pk) if (Math.hypot(a.x - q.x, a.z - q.z) < 1.8) parkedHit++;
    const lc = this.cars.filter((c) => (c.on || c.virtual) && c.line);
    return { active: on.length, overlaps, moving: on.filter((c) => c.v > 1).length, parked: pk.length, parkedHit, lineMicrobuses: lc.length, lineVirtual: lc.filter((c) => c.virtual).length };
  }
}
