import * as THREE from 'three';
import { HumanBatch, humanVariants, seatedGeometry, humanStaticMaterial } from '../world/Humans.js';
import { loopAt, LOOP } from '../traffic/TrafficSystem.js';
import { groundHeight } from '../world/ground.js';
import { roadPointAt, ROADS, SIDEWALK_W, onOtherCarriageway } from '../world/RoadNetwork.js';
import { crossingAt } from '../world/layout.js';
import { nearJunction, ZONE_LABEL } from '../world/Route.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex, rng } from '../render/textures.js';
import { GRAPH, findRoute, trackRoute } from '../nav/RoadGraph.js';
import { LINES, POIS, TRIP_RANGE, tripFare, payment } from './Jobs.js';
import { fmtDist } from '../nav/Navigator.js';

// الركاب: ناس مستنية بتشاور، بتركب من الباب لما تقف جنبهم في العلامة، وكل راكب رايح مكان معين.
// نوعين شغل:
//  - الميكروباص (line): خط ثابت من الموقف الكبير بمحطات لحد آخر الخط، والرجوع بالعكس. الناس بتركب في الموقف والمحطات بس.
//  - التاكسي/التوكتوك (trip): زبون (أو مجموعة) بيشاور من الرصيف، رايح وجهة واضحة، والأجرة بالمسافة ويدفع وتديله الباقي.
// الفلوس بتروح المحفظة (Wallet).
const MODE = { microbus: 'line', taxi: 'trip', tuktuk: 'trip' };
// الأماكن اللي ينفع التوكتوك يشتغل فيها (شوارع جوه البلد والقرى، مش الطرق السريعة)
const TUK_KINDS = new Set(['city', 'residential', 'village', 'agri', 'shibin', 'side']);

const CITY_LEN = 450;
// s على المسار الكامل (المدينة 0→450 وبعدها الطريق الدائري)
const STOP_DEFS = [
  { s: 40, name: 'موقف وسط البلد', kind: 'city' },
  { s: 268, name: 'السوق', kind: 'market' },
  { s: 150, name: 'الجامع الكبير', kind: 'city' },
  { s: 390, name: 'آخر وسط البلد', kind: 'city' },
  { s: CITY_LEN + 150, name: 'الحي السكني', kind: 'residential' },
  { s: CITY_LEN + 420, name: 'الصيدلية', kind: 'residential' },
  { s: CITY_LEN + 930, name: 'الطريق الزراعي', kind: 'agri' },
  { s: CITY_LEN + 1205, name: 'القرية', kind: 'village' },
  { s: CITY_LEN + 1460, name: 'استراحة الصحراوي', kind: 'desert' },
  { s: CITY_LEN + 2480, name: 'طرف الطريق السريع', kind: 'highway' },
];
// مواقف على الطرق الفرعية
const SIDE_STOPS = [
  { road: 'R1', frac: 0.45, name: 'موقف الترعة', kind: 'agri' },
  { road: 'R5', frac: 0.5, name: 'شارع الميدان', kind: 'side' },
  { road: 'R5', frac: 0.85, name: 'المدرسة', kind: 'side' },
  { road: 'R6', frac: 0.5, name: 'المقابر', kind: 'side' },
  { road: 'S1', frac: 0.45, name: 'شارع باريس', kind: 'shibin', off: 4.4 + 3.2 - 1 },
  { road: 'S1', frac: 0.15, name: 'أول شارع باريس', kind: 'shibin', off: 4.4 + 3.2 - 1 },
  { road: 'S1', frac: 0.8, name: 'آخر شارع باريس', kind: 'shibin', off: 4.4 + 3.2 - 1 },
  { road: 'S2', frac: 0.4, name: 'الكليات', kind: 'shibin', off: 5.2 + 3.2 - 1 },
  { road: 'S2', frac: 0.75, name: 'المستشفى الجامعي', kind: 'shibin', off: 5.2 + 3.2 - 1 },
  { road: 'S3', frac: 0.3, name: 'الكورنيش', kind: 'shibin', off: 3.8 + 3.2 - 1 },
  { road: 'S3', frac: 0.7, name: 'قصر الثقافة', kind: 'shibin', off: 3.8 + 3.2 - 1 },
  { road: 'S2', frac: 0.06, name: 'جامعة المنوفية', kind: 'shibin', off: 5.2 + 3.2 - 1 },
  { road: 'S4', frac: 0.15, name: 'محطة القطر', kind: 'shibin', off: 3.8 + 3.2 - 1 },
  // الموقف الكبير: ناس كتير ومستنيين على طول
  { road: 'S4', frac: 0.55, name: 'موقف شبين الكوم', kind: 'terminal', off: 3.8 + 3.2 - 0.8 },
];
const URBAN = new Set(['city', 'market', 'residential']);
// على الموبايل عدد أقل (كل واحد ماشي = كذا قطعة بتترسم)
const MAX_WALKERS = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 30 : 44;
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
  constructor(scene, player, { hud, audio, settings, wallet } = {}) {
    this.scene = scene;
    this.player = player;
    this.hud = hud; this.audio = audio; this.settings = settings; this.wallet = wallet;
    this.mode = MODE[player.kind] || 'line';
    this.lineIdx = 0; this.lineDir = 0; this.line = null; this.linePath = null; this.lineStops = []; this.lineS = 0; this.trips = 0;
    this.trip = null;
    this.R = rng(4242);
    this.seats = (player.rig.paxSeats || []).map((p) => ({ ...p, pax: null }));
    this.capacity = this.seats.length;
    this.onboard = [];
    this.walkers = [];
    this.pool = [];
    this.stillTime = 0;
    this.doorBusy = 0;
    this.group = new THREE.Group();
    this.group.name = 'passengers';
    scene.add(this.group);
    this._buildStops();
    this._buildMarkers();
    // الركاب القاعدين: Mesh واحد جوه العربية بيتبني من جديد لما حد يركب/ينزل
    this.seatedMat = humanStaticMaterial();
    this.seatedMesh = null;
    // الماشيين (المستنيين/الراكبين/النازلين): ناس شبه حقيقيين بيترسموا بالـ instancing (الحركة في الـ shader)
    this.variants = humanVariants(12, 4242);
    this.batch = new HumanBatch(this.group, this.variants, MAX_WALKERS);
    for (let i = 0; i < MAX_WALKERS; i++) {
      const p = { root: new THREE.Object3D(), variant: i % this.variants.length, scale: 0.96 + this.R() * 0.08, amp: 0, armR: 0, armL: 0 };
      p.root.visible = false;
      this.pool.push(p);
    }
    this._resetJob();
  }

  get count() { return this.onboard.length; }
  /** الرصيد (للتوافق مع الأجزاء القديمة: multiplayer/HUD) */
  get earnings() { return this.wallet ? this.wallet.balance : 0; }

  /** العربية اتغيرت: كراسي جديدة، والركاب اللي كانوا راكبين بينزلوا */
  setPlayer(player) {
    if (this.seatedMesh) { this.seatedMesh.removeFromParent(); this.seatedMesh = null; }
    this.player = player;
    this.seats = (player.rig.paxSeats || []).map((p) => ({ ...p, pax: null }));
    this.capacity = this.seats.length;
    this.onboard = [];
    for (const w of this.walkers) if (w.state === 'toDoor') w.state = 'return';
    this.mode = MODE[player.kind] || 'line';
    this._resetJob();
    this._updateHud();
  }

  // =====================================================================
  //  نوع الشغل
  // =====================================================================
  /** بداية من الأول: الناس المستنية بتمشي، ونجهّز الخط (ميكروباص) أو المشاوير (تاكسي/توكتوك) */
  _resetJob() {
    for (const st of this.stops) {
      for (const w of [...st.waiting]) if (w.state === 'wait' || w.state === 'toDoor' || w.state === 'return') this._release(w);
      st.waiting = [];
      st.cooldown = 0;
    }
    this.stops = this.stops.filter((st) => st.terminalStop);
    this.trip = null;
    this.line = null; this.linePath = null; this.lineStops = [];
    if (this.mode === 'line') this._setupLine();
    this.hud?.setJob?.(this.jobInfo());
  }

  /** خط الميكروباص: المسار من محطة للي بعدها (أقصر طريق)، وكل محطة على الرصيف اللي على يمين اتجاه السير */
  _setupLine(announce = true) {
    // محطات الخط القديم بتتشال (والناس اللي مستنية فيها بتمشي)
    for (const st of this.lineStops) {
      if (st.terminalStop) continue;
      for (const w of [...st.waiting]) if (w.state === 'wait') this._release(w);
      const i = this.stops.indexOf(st); if (i >= 0) this.stops.splice(i, 1);
    }
    const L = LINES[this.lineIdx % LINES.length];
    const wps = this.lineDir ? [...L.stops].reverse() : L.stops;
    const path = { pts: [], cum: [], steps: [], length: 0 };
    const stopS = [0];
    let heading = this.lineDir ? null : [0, 1]; // من الموقف: طالع على شارع المحطة ناحية شارع باريس
    for (let k = 0; k < wps.length - 1; k++) {
      const a = wps[k], b = wps[k + 1];
      const r = findRoute(a.x, a.z, b.x, b.z, heading ? heading[0] : 0, heading ? heading[1] : 0);
      if (!r) { stopS.push(path.length); continue; }
      const base = path.length;
      r.pts.forEach((pt, i) => { if (i === 0 && path.pts.length) return; path.pts.push(pt); path.cum.push(base + r.cum[i]); });
      for (const st of r.steps) path.steps.push({ ...st, s: st.s + base });
      path.length = base + r.length;
      stopS.push(path.length);
      const n = r.pts.length, p1 = r.pts[n - 1], p0 = r.pts[Math.max(0, n - 4)], l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
      heading = [(p1.x - p0.x) / l, (p1.z - p0.z) / l];
    }
    const dirAt = (s) => {
      let i = 0; while (i < path.pts.length - 2 && path.cum[i + 1] < s) i++;
      const a = path.pts[Math.max(0, i - 2)], b = path.pts[Math.min(path.pts.length - 1, i + 3)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return [(b.x - a.x) / l, (b.z - a.z) / l];
    };
    const stops = [];
    wps.forEach((wp, k) => {
      const [dx, dz] = dirAt(stopS[k]);
      let st = null;
      if (wp.terminal) {
        st = this.stops.filter((x) => x.terminalStop).sort((a, b) => (b.ax * dx + b.az * dz) - (a.ax * dx + a.az * dz))[0];
      } else {
        let best = null, bs = Infinity;
        for (const c of this.cands) {
          const d = Math.hypot(c.x - wp.x, c.z - wp.z);
          if (d > 45 || c.ax * dx + c.az * dz < 0.6) continue;
          const sc = d + (c.nearX < 18 ? 40 : 0);
          if (sc < bs) { bs = sc; best = c; }
        }
        if (best) { st = { ...best, cand: best, waiting: [], cooldown: 0, fixed: true, line: true }; this.stops.push(st); }
      }
      if (!st) return;
      st.name = wp.name; st.lineIdx = stops.length;
      // مكانها على الخط = مكان العلامة نفسها (مش النقطة اللي اتعرّفت بيها)
      const tr = trackRoute(path, st.mx, st.mz, {});
      st.lineS = tr && tr.off < 30 ? tr.s : stopS[k];
      stops.push(st);
    });
    this.line = L; this.linePath = path; this.lineStops = stops; this.lineS = 0; this._lineTrack = {};
    // أول الخط (الموقف/المحطة اللي هنبدأ منها) فيه ناس مستنية من الأول — مش لازم نبعد عشان يظهروا
    const first = stops[0];
    if (first && !first.waiting.length) { first.cooldown = 0; this._spawnWaiting(first); }
    if (announce) this.hud?.toast(`🚐 ${L.name}: ${wps[0].name} ← ${wps[wps.length - 1].name}`, 3.2);
    this.hud?.setJob?.(this.jobInfo());
  }

  /** تغيير الخط (من الموقف وإنت فاضي بس) */
  cycleLine() {
    if (this.mode !== 'line') return false;
    if (this.onboard.length) { this.hud?.toast('نزّل الركاب الأول قبل ما تغيّر الخط', 2.4); return false; }
    this.lineIdx = (this.lineIdx + 1) % LINES.length; this.lineDir = 0;
    this._setupLine();
    return true;
  }

  /** المحطة الجاية على الخط (اللي لسه موصلتلهاش أو واقف فيها) */
  get nextStop() {
    if (this.mode !== 'line' || !this.lineStops.length) return null;
    return this.lineStops.find((st) => st.lineS > this.lineS - 9) || this.lineStops[this.lineStops.length - 1];
  }

  /** وجهة الـ GPS */
  navTarget(ph) {
    if (this.mode === 'line') {
      const st = this.nextStop;
      return st ? { x: st.mx, z: st.mz, name: st.name } : null;
    }
    if (this.trip) return { x: this.trip.dest.mx, z: this.trip.dest.mz, name: this.trip.dest.name };
    // فاضي: أقرب زبون بيشاور
    let best = null, bd = 420;
    for (const st of this.stops) {
      if (st.kind === 'terminal' || !st.waiting.some((w) => w.state === 'wait')) continue;
      const d = Math.hypot(st.x - ph.x, st.z - ph.z);
      if (d < bd) { bd = d; best = st; }
    }
    return best ? { x: best.mx, z: best.mz, name: 'زبون بيشاور', pickup: true } : null;
  }

  /** بيانات لوحة الشغل في الـ HUD */
  jobInfo() {
    if (this.mode === 'line') {
      const L = this.line, st = this.nextStop, last = this.lineStops[this.lineStops.length - 1];
      return { mode: 'line', title: L ? L.name : '', color: L?.color, to: last?.name || '', next: st?.name || '', pax: this.onboard.length, cap: this.capacity, fare: L?.fare, canSwitch: !this.onboard.length };
    }
    const kind = this.player.kind;
    if (this.trip) return { mode: 'trip', kind, dest: this.trip.dest.name, fare: this.trip.fare, meters: this.trip.meters, pax: this.onboard.length };
    return { mode: 'trip', kind, dest: null, pax: 0 };
  }

  // ===== أماكن الركوب =====
  // الناس بتشاور على الميكروباص من أي حتة على الرصيف (زي الحقيقة)، مش مواقف ثابتة:
  // بنجهز "أماكن ممكنة" كل ~30م على كل الطرق (على الرصيف/الجنب بس، عمرها ما تبقى على الأسفلت)،
  // ووقت اللعب بنفعّل كام مكان عشوائي حواليك وقدامك، والبعيد بيتشال. الموقف الكبير بس اللي ثابت.
  _buildStops() {
    this.stops = [];
    this.cands = [];
    this.candGrid = new Map();
    const q = {};
    const mk = (base, side, edge, laneD, name, kind) => {
      const d = side * edge;
      const x = base.x + base.rx * d, z = base.z + base.rz * d;
      const c = {
        name, kind, side, x, z, y: groundHeight(x, z),
        nx: -base.rx * side, nz: -base.rz * side,        // من الرصيف ناحية الطريق
        ax: base.dx * side, az: base.dz * side,          // اتجاه السير
        mx: base.x + base.rx * side * laneD, mz: base.z + base.rz * side * laneD,
      };
      c.my = groundHeight(c.mx, c.mz);
      return c;
    };
    const addCand = (c) => {
      this.cands.push(c);
      const k = `${Math.floor(c.x / 60)},${Math.floor(c.z / 60)}`;
      let a = this.candGrid.get(k); if (!a) this.candGrid.set(k, (a = [])); a.push(c);
    };
    // 1) الطريق الرئيسي (وسط البلد + الدائري)
    const SKIP = new Set(['bridge', 'tunnel', 'mountain', 'highway']);
    for (let s = 20; s < LOOP.length - 20; s += 30) {
      loopAt(s, q);
      if (SKIP.has(q.zone)) continue;
      const city = s < CITY_LEN;
      if (city && crossingAt(q.z, 7)) continue;
      const urban = URBAN.has(q.zone) || city;
      for (const side of [1, -1]) {
        if (!city && nearJunction(s - CITY_LEN, side, 10)) continue;
        // الأسفلت لحد 11.5م من النص برا المدينة → الناس على الجنب بعده
        addCand(mk(q, side, urban ? 11.3 : 12.6, 8.6, city ? 'وسط البلد' : ZONE_LABEL[q.zone] || 'الطريق', q.zone));
      }
    }
    // 2) الطرق الفرعية وشوارع شبين
    for (const road of ROADS) {
      if (road.style === 'highway' || road.style === 'desert') continue;
      const urban = road.style === 'urban';
      let next = 25;
      for (const p of road.samples) {
        if (p.s < next || p.s > road.length - 25) continue;
        next = p.s + 30;
        if (p.half > road.half + 0.5) continue; // بوق التقاطع
        for (const side of [1, -1]) {
          const edge = urban ? road.half + SIDEWALK_W - 1 : road.half + 1.6;
          const c = mk(p, side, edge, road.half - 1.15, road.name, urban ? 'shibin' : 'side');
          if (onOtherCarriageway(c.x, c.z, road, 1.5) || onOtherCarriageway(c.mx, c.mz, road, 1)) continue;
          addCand(c);
        }
      }
    }
    // 3) الموقف الكبير (ثابت، وفيه ناس كتير على طول)
    {
      const def = SIDE_STOPS.find((d) => d.kind === 'terminal');
      Object.assign(q, roadPointAt(def.road, def.frac));
      for (const side of [1, -1]) this.stops.push({ ...mk(q, side, def.off, q.half - 1.15, def.name, 'terminal'), fixed: true, terminalStop: true, waiting: [], cooldown: 0 });
    }
    // بُعد كل مكان عن أقرب تقاطع (منقفش الزباين في نص التقاطع)
    const xs = GRAPH.nodes.filter((n) => n.edges.length >= 3);
    for (const c of this.cands) c.nearX = Math.min(...xs.map((n) => Math.hypot(n.x - c.mx, n.z - c.mz)));
  }

  _activate(c) {
    const st = this.stops.find((x) => x.cand === c);
    if (st) return st;
    const n = { ...c, cand: c, waiting: [], cooldown: 0 };
    this.stops.push(n);
    return n;
  }

  /** كل شوية: نفعّل أماكن جديدة قدامك ونشيل البعيد (تاكسي/توكتوك بس — الميكروباص على خطه) */
  _manageStops(ph) {
    if (this.mode === 'line') return;
    const density = this.settings ? +(this.settings.get('paxDensity') ?? 1) : 1;
    const [fx, fz] = ph.forward;
    // أماكن لازم تفضل: وجهة أي راكب (راكب أو لسه مستني على الرصيف)
    const needed = new Set(this.onboard.map((o) => o.dest));
    for (const w of this.walkers) if (w.dest) needed.add(w.dest);
    this.stops = this.stops.filter((st) => {
      if (st.fixed || needed.has(st)) return true;
      const d2 = (st.x - ph.x) ** 2 + (st.z - ph.z) ** 2;
      if (d2 < 470 * 470 || st.waiting.some((w) => w.state === 'toDoor')) return true;
      for (const w of [...st.waiting]) if (w.state === 'wait') this._release(w);
      return false;
    });
    const want = Math.round(2 + 1.5 * density);
    // سقف: مايبقاش فيه أماكن كتير أوي مفعّلة (نشيل الأبعد اللي محدش محتاجه)
    const free = this.stops.filter((st) => !st.fixed && !needed.has(st) && !st.waiting.some((w) => w.state === 'toDoor'));
    if (free.length > want + 4) {
      free.sort((a, b) => ((b.x - ph.x) ** 2 + (b.z - ph.z) ** 2) - ((a.x - ph.x) ** 2 + (a.z - ph.z) ** 2));
      for (const st of free.slice(0, free.length - want - 4)) { for (const w of [...st.waiting]) if (w.state === 'wait') this._release(w); this.stops.splice(this.stops.indexOf(st), 1); }
    }
    let near = this.stops.filter((st) => !st.fixed && (st.x - ph.x) ** 2 + (st.z - ph.z) ** 2 < 330 * 330).length;
    for (let tries = 0; near < want && tries < 30; tries++) {
      const ang = this.R() * Math.PI * 2, d = 70 + this.R() * 250;
      const ux = Math.cos(ang), uz = Math.sin(ang);
      if (ux * fx + uz * fz < -0.2 && this.R() < 0.75) continue; // أغلبهم قدامك
      const a = this.candGrid.get(`${Math.floor((ph.x + ux * d) / 60)},${Math.floor((ph.z + uz * d) / 60)}`);
      if (!a) continue;
      const c = a[Math.floor(this.R() * a.length)];
      if (c.nearX < 18 || (this.player.kind === 'tuktuk' && !TUK_KINDS.has(c.kind))) continue;
      if (this.stops.some((st) => (st.x - c.x) ** 2 + (st.z - c.z) ** 2 < 70 * 70)) continue;
      this._activate(c);
      near++;
    }
  }

  // ===== علامة مكان الوقوف (مستطيل منوّر على الأرض) =====
  _buildMarkers() {
    // علامة واضحة في عز الضهر: مستطيل مليان + برواز متقطع + سهم، وعمود نور فوقه بيبان من بعيد
    const c = canvas(128, 256), x = c.getContext('2d');
    x.fillStyle = 'rgba(255,255,255,0.42)'; x.fillRect(0, 0, 128, 256);
    x.strokeStyle = '#fff'; x.lineWidth = 14; x.setLineDash([30, 14]); x.strokeRect(8, 8, 112, 240);
    x.setLineDash([]); x.fillStyle = '#fff';
    x.beginPath(); x.moveTo(64, 60); x.lineTo(100, 118); x.lineTo(28, 118); x.closePath(); x.fill(); // سهم اتجاه السير
    x.fillRect(52, 118, 24, 60);
    const t = tex(c, { repeat: false });
    // عمود النور: تدرج من تحت لفوق
    const bc = canvas(16, 128), bx = bc.getContext('2d');
    const gr = bx.createLinearGradient(0, 128, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    bx.fillStyle = gr; bx.fillRect(0, 0, 16, 128);
    const bt = tex(bc, { repeat: false });
    this.markers = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, color: 0xf2c230, transparent: true, depthWrite: false, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }));
      m.renderOrder = 2; m.visible = false;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 7, 16, 1, true).translate(0, 3.5, 0), new THREE.MeshBasicMaterial({ map: bt, color: 0xf2c230, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
      beam.renderOrder = 2;
      m.add(beam); m.userData.beam = beam;
      this.group.add(m);
      this.markers.push(m);
    }
  }

  /** العربية واقفة جوه علامة الموقف؟ */
  _inMarker(st, ph) {
    const dx = ph.x - st.mx, dz = ph.z - st.mz;
    const along = dx * st.ax + dz * st.az, lat = dx * st.nx + dz * st.nz;
    return Math.abs(along) < 3.6 && Math.abs(lat) < 1.7;
  }

  _updateMarkers(ph, t) {
    const want = [];
    const dests = new Set(this.onboard.map((o) => o.dest));
    const nextLine = this.nextStop;
    for (const st of this.stops) {
      const has = st.waiting.some((w) => w.state === 'wait' || w.state === 'toDoor') && (this.mode === 'line' ? this.lineStops.includes(st) : st.kind !== 'terminal');
      const dest = dests.has(st) || st === nextLine;
      if (!has && !dest) continue;
      const d2 = (st.mx - ph.x) ** 2 + (st.mz - ph.z) ** 2;
      if (d2 < 160 * 160) want.push([d2, st, dest]);
    }
    want.sort((a, b) => a[0] - b[0]);
    this.markers.forEach((m, i) => {
      const w = want[i];
      m.visible = !!w;
      if (!w) return;
      const [, st, dest] = w;
      m.position.set(st.mx, st.my + 0.035, st.mz);
      m.rotation.y = Math.atan2(st.ax, st.az);
      const inside = this._inMarker(st, ph);
      const col = inside ? 0x3ee07a : dest ? 0x4fc3ff : 0xf2c230;
      m.material.color.set(col);
      m.material.opacity = 0.8 + 0.2 * Math.sin(t * 4);
      const beam = m.userData.beam;
      beam.material.color.set(col);
      // العمود بيبان من بعيد ويخف لما تقرب عشان مايغطيش الرؤية
      const d = Math.sqrt(w[0]);
      beam.material.opacity = Math.min(0.9, Math.max(0.12, (d - 8) / 40)) * (0.75 + 0.25 * Math.sin(t * 3));
    });
  }

  /** الموقف على أنهي ناحية بالنسبة لاتجاه العربية دلوقتي */
  _sideOf(st, ph) {
    const [fx, fz] = ph.forward;
    return fx * st.ax + fz * st.az >= 0 ? st.side : -st.side;
  }

  // ===== ردود فعل الركاب =====
  // على أحداث حقيقية بس: خبطة، فرملة جامدة، لف عنيف، شدّة بنزين خطيرة، سرعة زيادة، تقليب.
  // التسارع متفلتر (المطبات والرجّات القصيرة مش بتتحسب)، كل حدث بيتحسب مرة واحدة (rising edge)،
  // وكل نوع له فترة راحة. الفرملة/اللف العادي مفيهمش أي رد فعل.
  _complain(text, hit = 0.12) {
    for (const p of this.onboard) p.mood = Math.max(0.2, (p.mood ?? 1) - hit);
    this._toastCd = this._toastCd || 0;
    if (this._toastCd > 0) return;
    this._toastCd = 2;
    this.hud?.toast(`🗣️ ${text}`, 2.6);
    this.audio?.chatterBurst?.();
  }

  _watchDriving(dt, ph) {
    const cd = (this._cd ||= { hit: 0, brake: 0, turn: 0, accel: 0, speed: 0, flip: 0 });
    for (const k in cd) cd[k] = Math.max(0, cd[k] - dt);
    this._toastCd = Math.max(0, (this._toastCd || 0) - dt);
    // فلتر ~0.2ث على التسارع
    const k = 1 - Math.exp(-dt * 5);
    this._aL = (this._aL ?? 0) + (ph.accelLong - (this._aL ?? 0)) * k;
    this._aT = (this._aT ?? 0) + (ph.accelLat - (this._aT ?? 0)) * k;
    if (!this.onboard.length) { this._brakeArmed = true; this._latT = this._accT = this._spdT = 0; return; }
    const kmh = Math.abs(ph.speed) * 3.6, kind = this.player.kind;
    const pick = (a) => a[Math.floor(this.R() * a.length)];
    const ev = (key, cool, hit, lines) => { if (cd[key] > 0) return; cd[key] = cool; this._complain(pick(lines), hit); };
    // 1) خبطة (الخبطات الخفيفة زي لمس الرصيف مش بتتحسب)
    if (ph.lastImpact > 2.2 && !this._hitLatch) {
      this._hitLatch = true;
      if (ph.lastImpact > 5) ev('hit', 3, 0.3, ['حاسب يا أسطى! هتموتنا!', 'يا ساتر! إيه الخبطة دي؟!', 'العربية اتدشدشت يا جدع!']);
      else ev('hit', 3, 0.15, ['حاسب يا أسطى!', 'إيه يا عم الخبطة دي؟', 'براحة يا أسطى، خبطنا!']);
    }
    if (ph.lastImpact < 0.4) this._hitLatch = false;
    // 2) فرملة جامدة: قريبة من أقصى فرملة العربية وانت ماشي (الفرملة العادية مش بتتحسب)
    const hardBrake = { microbus: 5.8, taxi: 8.0, tuktuk: 7.2 }[kind] || 7;
    if (this._brakeArmed && this._aL < -hardBrake && kmh > 20) { this._brakeArmed = false; ev('brake', 6, 0.1, ['براحة على الفرامل يا أسطى!', 'إيه الفرملة دي؟ راسي اتخبطت!', 'هدّي يا عم!']); }
    if (this._aL > -2.5) this._brakeArmed = true;
    // 3) لف عنيف: أكتر من 0.55g لمدة نص ثانية
    this._latT = Math.abs(this._aT) > 5.4 && kmh > 22 ? (this._latT || 0) + dt : 0;
    if (this._latT > 0.5) { this._latT = -1.5; ev('turn', 8, 0.08, ['براحة في اللف يا أسطى!', 'إنت سايق ولا طاير؟', 'هنتقلب كده!']); }
    // 4) شدّة بنزين خطيرة: تسارع قوي ومستمر وانت أصلًا سريع
    this._accT = this._aL > 3.2 && kmh > 35 ? (this._accT || 0) + dt : 0;
    if (this._accT > 1.2) { this._accT = -4; ev('accel', 15, 0.05, ['على مهلك يا أسطى، ورانا إيه؟', 'براحة على البنزين!']); }
    // 5) سرعة زيادة (على حسب العربية)
    const lim = kind === 'tuktuk' ? 52 : kind === 'microbus' ? 95 : 110;
    this._spdT = kmh > lim ? (this._spdT || 0) + dt : 0;
    if (this._spdT > 3) { this._spdT = -10; ev('speed', 20, 0.05, ['هدّي السرعة شوية يا أسطى!', 'إحنا مش في سباق!']); }
    // 6) العربية اتقلبت
    if (ph.flip?.mode && !this._flipLatch) { this._flipLatch = true; ev('flip', 10, 0.5, ['يا نهار أسود! العربية اتقلبت!']); }
    if (!ph.flip?.mode) this._flipLatch = false;
  }

  // ===== أدوات =====
  _take() { const p = this.pool.pop(); if (p) { p.root.visible = true; this.walkers.push(p); } return p; }
  _release(p) {
    p.root.visible = false;
    this.walkers.splice(this.walkers.indexOf(p), 1);
    this.pool.push(p);
    p.state = null;
    p.amp = p.armR = p.armL = 0;
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
    // كل راكب: شكل من الأشكال الجاهزة في وضع القعدة، وشه ناحية قدام العربية (-z)
    for (const s of occ) g.addGeometry(seatedHuman(this.variants, s.pax.seed), new THREE.Matrix4().makeRotationY(Math.PI).setPosition(s.x, s.y - 0.06, s.z + 0.04));
    this.seatedMesh = new THREE.Mesh(g.build(), this.seatedMat);
    this.seatedMesh.castShadow = true;
    this.player.rig.shell.add(this.seatedMesh);
  }

  _spawnWaiting(stop) {
    const density = this.settings ? +(this.settings.get('paxDensity') ?? 1) : 1;
    const terminal = stop.kind === 'terminal';
    let n, group = null, dest = null;
    if (this.mode === 'line') {
      // الميكروباص: الموقف مليان ناس، والمحطات اللي على الخط فيها كام واحد، وآخر الخط محدش بيركب منه
      const k = this.lineStops.indexOf(stop);
      if (k < 0) { stop.cooldown = 12; if (!terminal) return; n = 4 + Math.floor(this.R() * 4); }
      else if (k === this.lineStops.length - 1) { stop.cooldown = 20; return; }
      else if (k === 0) n = 7 + Math.floor(this.R() * 5 * density);
      else { if (this.R() > 0.55 + 0.35 * density) { stop.cooldown = 25; return; } n = 1 + Math.floor(this.R() * (1.5 + 2 * density)); }
    } else if (terminal) {
      n = 6 + Math.floor(this.R() * 6); // ناس الموقف مستنيين ميكروباص (مش هيركبوا تاكسي)
    } else {
      // تاكسي/توكتوك: زبون أو مجموعة صغيرة رايحين مكان واحد
      if (this.R() > 0.75 + 0.25 * density) { stop.cooldown = 15; return; }
      const d = this._tripDest(stop);
      if (!d) { stop.cooldown = 20; return; }
      dest = d.stop;
      group = { meters: d.meters, name: d.name };
      n = 1 + (this.R() < 0.35 ? 1 : 0) + (this.R() < 0.12 ? 1 : 0);
    }
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
      p.group = group;
      p.dest = this.mode === 'line' ? (this.lineStops.indexOf(stop) >= 0 ? this._lineDest(this.lineStops.indexOf(stop)) : null) : dest;
      stop.waiting.push(p);
    }
  }

  /** راكب الميكروباص نازل في محطة جاية على الخط (كتير منهم لآخر الخط) */
  _lineDest(k) {
    const last = this.lineStops.length - 1;
    if (k >= last - 1 || this.R() < 0.45) return this.lineStops[last];
    return this.lineStops[k + 1 + Math.floor(this.R() * (last - k - 1))];
  }

  /** مشوار تاكسي/توكتوك: مكان معروف على مسافة مناسبة، والنزول على الرصيف اللي على يمين اتجاه الوصول */
  _tripDest(from) {
    const kind = this.player.kind, [lo, hi] = TRIP_RANGE[kind] || TRIP_RANGE.taxi;
    const pool = POIS.filter((p) => (kind !== 'tuktuk' || p.tuk) && Math.hypot(p.x - from.x, p.z - from.z) < hi && Math.hypot(p.x - from.x, p.z - from.z) > lo * 0.5);
    for (let tries = 0; tries < 6 && pool.length; tries++) {
      const poi = pool.splice(Math.floor(this.R() * pool.length), 1)[0];
      const r = findRoute(from.mx, from.mz, poi.x, poi.z, from.ax, from.az);
      if (!r || r.length < lo || r.length > hi) continue;
      const n = r.pts.length, p1 = r.pts[n - 1], p0 = r.pts[Math.max(0, n - 5)], l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
      const dx = (p1.x - p0.x) / l, dz = (p1.z - p0.z) / l;
      let best = null, bs = Infinity;
      for (const c of this.cands) {
        const d = Math.hypot(c.x - poi.x, c.z - poi.z);
        if (d > 50 || c.ax * dx + c.az * dz < 0.5) continue;
        const sc = d + (c.nearX < 18 ? 35 : 0);
        if (sc < bs) { bs = sc; best = c; }
      }
      if (!best) continue;
      const st = this._activate(best);
      st.name = poi.name;
      return { stop: st, meters: r.length, name: poi.name };
    }
    return null;
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

    // --- أماكن الركوب العشوائية حواليك (تاكسي/توكتوك) + مكانك على خط الميكروباص ---
    this._mgT = (this._mgT ?? 0) - dt;
    if (this._mgT <= 0) {
      this._mgT = 0.35;
      this._manageStops(ph);
      if (this.mode === 'line' && this.linePath) {
        const tr = trackRoute(this.linePath, vx, vz, this._lineTrack);
        // بنعتبر مكانك على الخط بس لما تكون ماشي عليه فعلًا (في الموقف/خارج الخط: المحطة الجاية بتفضل زي ما هي)
        if (tr && tr.off < 12) this.lineS = Math.max(this.lineS - 30, tr.s);
        this.hud?.setJob?.(this.jobInfo());
      }
    }
    // --- ظهور/اختفاء المستنيين ---
    for (const st of this.stops) {
      st.cooldown = Math.max(0, st.cooldown - dt);
      const d2 = (st.x - vx) ** 2 + (st.z - vz) ** 2;
      // الميكروباص: المحطات اللي عدّيناها خلاص مش محتاجة ناس (توفير للماشيين)
      const behind = this.mode === 'line' && st.lineIdx !== undefined && st.lineS < this.lineS - 15 && this.lineStops.includes(st);
      if (!st.waiting.length && !st.cooldown && !behind && d2 < 380 * 380 && d2 > 45 * 45) this._spawnWaiting(st);
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
        // الميكروباص بيحمّل من محطات خطه بس، والتاكسي زبون واحد (أو مجموعة) في المرة ومش من موقف الميكروباص
        if (this.mode === 'line' && !this.lineStops.includes(st)) continue;
        if (this.mode === 'trip' && (st.kind === 'terminal' || this.trip || this.onboard.length || this.walkers.some((p) => p.state === 'toDoor' && p.stop !== st))) continue;
        const sideOk = (st.x - vx) * rx + (st.z - vz) * rz > 0.5;
        if (!sideOk || !this._inMarker(st, ph)) {
          // واقف قريب بس مش في المكان المظبوط
          if (sideOk && Math.hypot(st.mx - vx, st.mz - vz) < 14 && !this._nearNote) { this._nearNote = 1; this.hud?.toast('قرّب على العلامة اللي على الأرض عشان الناس تركب', 2.5); }
          continue;
        }
        let k = 0;
        for (const p of st.waiting) {
          if (p.state !== 'wait' || (this.mode === 'line' && !p.dest)) continue;
          if (free - k <= 0) { if (!this._fullNote) { this.hud?.toast(this.mode === 'line' ? 'الميكروباص كامل!' : 'العربية كاملة!', 2); this._fullNote = 1; } break; }
          p.state = 'toDoor'; p.delay = 0.3 + k * 0.8; k++;
        }
      }
      // --- نزول: حد نازل في الموقف ده ---
      for (const st of this.stops) {
        const sideOk = (st.x - vx) * rx + (st.z - vz) * rz > 0.5;
        if (!sideOk || !this._inMarker(st, ph)) continue;
        // اللي نازل هنا + اللي عدّينا محطته (بينزل في أي موقف بعدها)
        const out = this.onboard.filter((p) => !p.leaving && ((p.dest && (p.dest === st || (p.dest.cand && p.dest.cand === st.cand) || (st.terminalStop && p.dest.terminalStop))) || (p.missed && this.mode === 'line')));
        out.forEach((p, i) => { p.leaving = true; p.leaveDelay = 0.4 + i * 0.9; p.leaveStop = st; });
      }
    }
    if (!still) { this._fullNote = 0; this._nearNote = 0; }
    this._watchDriving(dt, ph);
    this._updateMarkers(ph, performance.now() / 1000);
    // عدّيت محطة حد؟
    for (const p of this.onboard) {
      if (!p.dest || p.missed || p.leaving) continue;
      const d = Math.hypot(p.dest.mx - vx, p.dest.mz - vz);
      if (d < 18) p.near = true;
      else if (p.near && d > 45) {
        p.mood = Math.max(0.2, (p.mood ?? 1) - 0.3); this._toastCd = 0;
        if (this.mode === 'line') { p.missed = true; this._complain(`يا أسطى عدّيت ${p.dest.name}! نزّلني في أي محطة`, 0); }
        else { p.near = false; this._complain(`يا أسطى عدّيت ${p.dest.name}! ارجع`, 0); }
      }
    }
    // --- آخر الخط: بعد ما الكل ينزل → رحلة الرجوع ---
    if (this.mode === 'line' && this.lineStops.length && !this.onboard.length && this.stillTime > 1.2) {
      const last = this.lineStops[this.lineStops.length - 1];
      if (this._inMarker(last, ph) && !this.walkers.some((w) => w.state === 'toDoor')) {
        this.trips++;
        this.lineDir ^= 1;
        this._setupLine(false);
        const L = this.line, a = this.lineStops[0], b = this.lineStops[this.lineStops.length - 1];
        this.hud?.toast(`✅ وصلت آخر الخط! ${this.lineDir ? 'رحلة الرجوع' : 'دور جديد'}: ${a?.name} ← ${b?.name}`, 3.5);
        void L;
      }
    }

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
      const w = this._take(); // لو مفيش ماشي فاضي في الـ pool: بينزل ويدفع برضو (من غير أنيميشن)
      this.onboard.splice(this.onboard.indexOf(p), 1);
      p.seat.pax = null;
      this._rebuildSeated();
      if (w) {
        w.state = 'alight'; w.x = doorP.x; w.z = doorP.z;
        const st = p.leaveStop;
        w.target = [st.x + st.ax * (this.R() - 0.5) * 2, st.z + st.az * (this.R() - 0.5) * 2];
        w.timer = 0;
      }
      // الأجرة على حسب السواقة: لو زعلان بيدفع أقل (وبيقولك)
      const mood = p.mood ?? 1;
      if (this.mode === 'line') {
        const fare = Math.round(p.fare * (mood > 0.85 ? 1 : mood > 0.55 ? 0.75 : 0.5) * 2) / 2;
        this.wallet?.add(fare, 'fare', `أجرة ميكروباص (${this.line?.name || ''})`);
        this.audio?.coins?.();
        const msg = mood > 0.85 ? `نزل راكب ودفع ${fare} ج 👍` : mood > 0.55 ? `دفع ${fare} ج بس — "سواقتك مش ولابد"` : `دفع ${fare} ج بالعافية — "مش دافع غير نص الأجرة!"`;
        this.hud?.toast(msg, 2.6);
      } else if (!this.onboard.length) this._settleTrip(mood);
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
        // العربية اتحركت (أو اترجعت للطريق بعيد): يرجع مكانه يستنى
        if (!still || !door || Math.hypot(p.x - doorP.x, p.z - doorP.z) > 30) { p.state = 'return'; continue; }
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

    this._drawWalkers();
    // --- "على جنب يا أسطى" قبل موقف حد نازل فيه ---
    for (const p of this.onboard) {
      if (p.warned || !p.dest) continue;
      const d = Math.hypot(p.dest.x - vx, p.dest.z - vz);
      if (d < 140 && d > 25) { p.warned = true; this.hud?.toast(this.mode === 'line' ? `على جنب يا أسطى! (نازل ${p.dest.name})` : `قرّبنا من ${p.dest.name} — اركن في العلامة`, 3); }
    }
  }

  _board(p) {
    if (p.dest && !this.stops.includes(p.dest)) this.stops.push(p.dest); // الوجهة لازم تفضل مفعّلة
    const free = this.seats.filter((s) => !s.pax);
    if (!free.length) { p.state = 'return'; return; }
    const seat = free[Math.floor(this.R() * free.length)];
    const pax = { seed: Math.floor(this.R() * 1e6), dest: p.dest, fare: this.mode === 'line' ? (this.line?.fare || 10) : 0, seat, mood: 1 };
    seat.pax = pax;
    this.onboard.push(pax);
    p.stop.waiting.splice(p.stop.waiting.indexOf(p), 1);
    if (!p.stop.waiting.length) p.stop.cooldown = p.stop.kind === 'terminal' ? 6 : 20;
    if (this.mode === 'trip' && !this.trip && p.group) {
      // أول واحد من المجموعة ركب: المشوار بدأ (الأجرة بالعداد على مسافة الطريق)
      const fare = tripFare(this.player.kind, p.group.meters);
      this.trip = { dest: p.dest, meters: p.group.meters, fare, t0: performance.now() };
      this.hud?.toast(`🧍 ركب زبون · رايح ${p.dest.name} (${fmtDist(p.group.meters)}) · الأجرة ${fare} ج`, 3.2);
    } else if (this.mode === 'line') this.hud?.toast(`ركب راكب · نازل ${pax.dest ? pax.dest.name : 'آخر الخط'}`, 2.2);
    this._release(p);
    this._rebuildSeated();
    this._updateHud();
  }

  /** وصلنا وجهة المشوار والكل نزل: الحساب (الأجرة، اللي دفعه، والباقي) → المحفظة */
  _settleTrip(mood = 1) {
    const t = this.trip;
    this.trip = null;
    if (!t) return;
    const fare = Math.max(5, Math.round(t.fare * (mood > 0.85 ? 1 : mood > 0.55 ? 0.85 : 0.65)));
    const pay = payment(fare, this.R);
    const label = `${this.player.kind === 'taxi' ? 'تاكسي' : 'توكتوك'}: ${t.dest.name}`;
    const credit = () => { this.wallet?.add(fare, 'fare', label); this.audio?.coins?.(); };
    if (this.hud?.showPayment) this.hud.showPayment({ fare, paid: pay.paid, change: pay.change, dest: t.dest.name, full: t.fare, mood }, credit);
    else { credit(); this.hud?.toast(`الأجرة ${fare} ج · دفع ${pay.paid} · الباقي ${pay.change}`, 3); }
    this.hud?.setJob?.(this.jobInfo());
  }

  _updateHud() { this.hud?.setPassengers?.(this.onboard.length, this.capacity); this.hud?.setJob?.(this.jobInfo()); }

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
    // الحركة نفسها في الـ shader: سرعة المشي + رفع الإيد اليمين (بيلوّح/بيشاور/بينادي)
    p.amp = mode === 'walk' ? Math.min(1.2, (speed || WALK) * 0.75) : 0;
    p.armL = 0;
    p.armR = mode === 'wave' ? 1 : mode === 'hail' ? 0.45 + 0.05 * Math.sin(p.phase * 3) : mode === 'beckon' ? 0.75 : 0;
  }

  /** بعد كل الحركة: نكتب الماشيين اللي باينين في الـ InstancedMeshes */
  _drawWalkers() {
    const B = this.batch;
    B.begin();
    for (const p of this.walkers) {
      if (!p.root.visible) continue;
      const r = p.root;
      B.add(p.variant, r.position.x, r.position.y, r.position.z, r.rotation.y, p.scale, p.phase || 0, p.amp, p.armR, p.armL);
    }
    B.flush();
  }
}

/** شكل راكب قاعد (من الأشكال الجاهزة، متخزن) */
const _seated = new Map();
function seatedHuman(variants, seed) {
  const k = Math.abs(Math.floor(seed)) % variants.length;
  if (!_seated.has(variants[k])) _seated.set(variants[k], seatedGeometry(variants[k].geo));
  return _seated.get(variants[k]);
}

export { STOP_DEFS };
void LOOP;
