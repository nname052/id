import * as THREE from 'three';
import { person, seatedFigure } from '../world/Pedestrians.js';
import { loopAt, LOOP } from '../traffic/TrafficSystem.js';
import { groundHeight } from '../world/ground.js';
import { roadPointAt, ROADS, SIDEWALK_W, onOtherCarriageway } from '../world/RoadNetwork.js';
import { crossingAt } from '../world/layout.js';
import { nearJunction, ZONE_LABEL } from '../world/Route.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex, rng } from '../render/textures.js';

// الركاب: مواقف على الطريق، ناس مستنية بتشاور، بتركب من الباب الجرار لما تقف جنبهم،
// وكل راكب رايح موقف معين وبينزل لما توقف عنده. الأجرة متسجلة (earnings) عشان نبني عليها بعدين.

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
    this._buildMarkers();
    try { this.total = +(localStorage.getItem('egy-microbus-money') || 0) || 0; } catch { this.total = 0; }
    this.earnings = this.total;
    this._complainCd = 0;
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
      for (const side of [1, -1]) this.stops.push({ ...mk(q, side, def.off, q.half - 1.15, def.name, 'terminal'), fixed: true, waiting: [], cooldown: 0 });
    }
  }

  _activate(c) {
    const st = this.stops.find((x) => x.cand === c);
    if (st) return st;
    const n = { ...c, cand: c, waiting: [], cooldown: 0 };
    this.stops.push(n);
    return n;
  }

  /** كل شوية: نفعّل أماكن جديدة قدامك ونشيل البعيد */
  _manageStops(ph) {
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
    const want = Math.round(5 + 4 * density);
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
    for (const st of this.stops) {
      const has = st.waiting.some((w) => w.state === 'wait' || w.state === 'toDoor');
      const dest = dests.has(st);
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

  // ===== الأجرة والاعتراضات =====
  _complain(text, hit = 0.12) {
    for (const p of this.onboard) p.mood = Math.max(0.2, (p.mood ?? 1) - hit);
    if (this._complainCd > 0) return;
    this._complainCd = 5;
    this.hud?.toast(`🗣️ ${text}`, 2.6);
    this.audio?.chatterBurst?.();
  }

  _watchDriving(dt, ph) {
    this._complainCd = Math.max(0, this._complainCd - dt);
    if (!this.onboard.length) return;
    const kmh = ph.speed * 3.6;
    const pick = (a) => a[Math.floor(this.R() * a.length)];
    if (ph.lastImpact > 2.5) this._complain(pick(['حاسب يا أسطى! هتموتنا!', 'إيه يا عم الخبطة دي؟!', 'العربية اتخبطت يا جدع!']), 0.25);
    else if (ph.accelLong < -6.5 && kmh > 15) this._complain(pick(['براحة على الفرامل يا أسطى!', 'إيه الفرملة دي؟ راسي اتخبطت!', 'هدّي يا عم!']), 0.1);
    else if (Math.abs(ph.accelLat) > 5.2) this._complain(pick(['براحة في اللف يا أسطى!', 'إنت سايق ولا طاير؟', 'هنتقلب كده!']), 0.1);
    else if (kmh > 95) this._complain(pick(['هدّي السرعة شوية يا أسطى!', 'إحنا مش في سباق!']), 0.06);
    if (ph.flip?.mode) this._complain('يا نهار أسود! العربية اتقلبت!', 0.5);
  }

  _saveMoney() { try { localStorage.setItem('egy-microbus-money', String(Math.round(this.earnings * 10) / 10)); } catch { /* */ } }

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
    if (!terminal && this.R() > 0.7 + 0.3 * density) { stop.cooldown = 15; return; }
    const n = terminal ? 8 + Math.floor(this.R() * 8 * density) : 2 + Math.floor(this.R() * (2 + 3 * density));
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
    // رايح مكان عشوائي بعيد شوية (250م - 1.4كم) على أي طريق
    for (let i = 0; i < 40; i++) {
      const c = this.cands[Math.floor(this.R() * this.cands.length)];
      const d = Math.hypot(c.x - from.x, c.z - from.z);
      if (d > 250 && d < 1400) return this._activate(c);
    }
    return this._activate(this.cands[Math.floor(this.R() * this.cands.length)]);
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

    // --- أماكن الركوب العشوائية حواليك ---
    this._mgT = (this._mgT ?? 0) - dt;
    if (this._mgT <= 0) { this._mgT = 0.7; this._manageStops(ph); }
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
        const sideOk = (st.x - vx) * rx + (st.z - vz) * rz > 0.5;
        if (!sideOk || !this._inMarker(st, ph)) {
          // واقف قريب بس مش في المكان المظبوط
          if (sideOk && Math.hypot(st.mx - vx, st.mz - vz) < 14 && !this._nearNote) { this._nearNote = 1; this.hud?.toast('قرّب على العلامة اللي على الأرض عشان الناس تركب', 2.5); }
          continue;
        }
        let k = 0;
        for (const p of st.waiting) {
          if (p.state !== 'wait') continue;
          if (free - k <= 0) { if (!this._fullNote) { this.hud?.toast('الميكروباص كامل!', 2); this._fullNote = 1; } break; }
          p.state = 'toDoor'; p.delay = 0.3 + k * 0.8; k++;
        }
      }
      // --- نزول: حد نازل في الموقف ده ---
      for (const st of this.stops) {
        const sideOk = (st.x - vx) * rx + (st.z - vz) * rz > 0.5;
        if (!sideOk || !this._inMarker(st, ph)) continue;
        // اللي نازل هنا + اللي عدّينا محطته (بينزل في أي موقف بعدها)
        const out = this.onboard.filter((p) => !p.leaving && ((p.dest && (p.dest === st || (p.dest.cand && p.dest.cand === st.cand) || (st.fixed && p.dest.fixed))) || p.missed));
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
      else if (p.near && d > 45) { p.missed = true; p.mood = Math.max(0.2, (p.mood ?? 1) - 0.3); this._complainCd = 0; this._complain(`يا أسطى عدّيت ${p.dest.name}! نزّلني في أي موقف`, 0); }
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
      const fare = Math.round(p.fare * (mood > 0.85 ? 1 : mood > 0.55 ? 0.75 : 0.5) * 2) / 2;
      this.earnings += fare;
      this._saveMoney();
      this.hud?.setMoney?.(this.earnings);
      this.audio?.coins?.();
      const msg = mood > 0.85 ? `نزل راكب ودفع ${fare} ج 👍` : mood > 0.55 ? `دفع ${fare} ج بس — "سواقتك مش ولابد"` : `دفع ${fare} ج بالعافية — "مش دافع غير نص الأجرة!"`;
      this.hud?.toast(msg, 2.6);
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
    if (p.dest && !this.stops.includes(p.dest)) this.stops.push(p.dest); // الوجهة لازم تفضل مفعّلة
    const free = this.seats.filter((s) => !s.pax);
    if (!free.length) { p.state = 'return'; return; }
    const seat = free[Math.floor(this.R() * free.length)];
    const kindFare = { microbus: 1, taxi: 3, tuktuk: 1.4 }[this.player.kind] || 1;
    const pax = { seed: Math.floor(this.R() * 1e6), dest: p.dest, fare: Math.round((5 + Math.floor(this.R() * 4) * 2.5) * kindFare * 2) / 2, seat, mood: 1 };
    seat.pax = pax;
    this.onboard.push(pax);
    p.stop.waiting.splice(p.stop.waiting.indexOf(p), 1);
    if (!p.stop.waiting.length) p.stop.cooldown = p.stop.kind === 'terminal' ? 6 : 20;
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
