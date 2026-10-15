// =====================================================================
//  الحوادث والشرطة: لما العربية تتقلب أو تخبط خبطة جامدة:
//   1) الركاب بيخافوا وبينزلوا يجروا (من غير أجرة)
//   2) عربية شرطة بتيجي من أقرب طريق (بالسارينة والكشاف) — وعربيتك واقفة (عطلانة) لحد ما توصل
//   3) الظابط بيكتب المخالفة → تدفع الغرامة وتكمل
//   4) لو جريت منها: مطاردة — الشرطة بتطاردك وبتعمل مناورات (تلزق فيك، تقفل عليك من الجنب) لحد ما تمسكك
//   5) لو مسكتك: بتسحب الرخص + غرامة كبيرة، واللعبة واقفة لحد ما تدفع (حتى لو قفلت وفتحت)
// =====================================================================
import * as THREE from 'three';
import { buildSedan } from '../vehicles/SedanModel.js';
import { groundHeight } from '../world/ground.js';
import { findRoute, projectToGraph } from '../nav/RoadGraph.js';

const KEY = 'egy-police-block-v1';
const FINE = { crash: 300, flip: 500, flee: 1500 };
const ARRIVE = 9;          // الشرطة "وصلت" لما تبقى على بعد كده
const MAX_V = 34;          // أقصى سرعة لعربية الشرطة (م/ث ≈ 120 كم/س)

export class Incidents {
  constructor(scene, { hud, wallet, licenses, passengers, audio } = {}) {
    Object.assign(this, { scene, hud, wallet, licenses, passengers, audio });
    this.state = 'idle';
    this.car = buildSedan({ livery: 'police', lod: 1, seeThrough: false });
    this.car.root.visible = false;
    scene.add(this.car.root);
    this.p = { x: 0, z: 0, yaw: 0, v: 0, vx: 0, vz: 0 };
    this.col = { cx: 0, cz: 0, hx: 0.9, hz: 2.25, angle: 0, mass: 1600, restitution: 0.2, vx: 0, vz: 0, kind: 'car' };
    this._flash = 0;
    this._cool = 0;
    // لو كان فيه غرامة مش مدفوعة (اتمسكت وقفلت اللعبة): اللعبة بتفضل واقفة لحد ما تدفع
    try { this.blocked = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { this.blocked = null; }
  }

  /** العربية ممنوعة تتحرك؟ (Game بيصفّر البنزين ويشد الفرامل) */
  get hold() { return this.state === 'wait' || this.state === 'blocked'; }
  get busy() { return this.state !== 'idle'; }
  get chasing() { return this.state === 'chase'; }

  navTarget() { return null; }

  /** لما اللعبة تبدأ: لو فيه حظر قديم */
  start(ph) {
    if (this.blocked) { this.state = 'blocked'; this.at = { x: ph.x, z: ph.z }; this._blockCard(); }
  }

  /** حادثة: kind = 'flip' | 'crash' */
  trigger(kind, ph, playerKind) {
    if (this.state !== 'idle' || this._cool > 0) return;
    this.kind = kind; this.vkind = playerKind;
    this.fine = FINE[kind];
    // 1) الركاب
    const n = this.passengers?.panicExit?.(ph) || 0;
    if (n) this.hud?.toast(`😱 الركاب اتخضوا ونزلوا يجروا (${n}) — من غير أجرة`, 3);
    // 2) عربية الشرطة جاية من بعيد على الطريق
    if (!this._spawn(ph, 140, 230)) { this._finish(); return; }
    this.state = 'wait';
    this.at = { x: ph.x, z: ph.z };
    this.t = 0;
    this.audio?.siren?.(true);
    setTimeout(() => this.hud?.toast(kind === 'flip' ? '🚓 العربية اتقلبت — الشرطة جاية، استنى مكانك' : '🚓 حادثة! الشرطة جاية — استنى مكانك', 3.5), n ? 3200 : 0);
  }

  /** مكان ظهور الشرطة: نقطة على الطرق بعيد عنك بمسافة طريق معقولة */
  _spawn(ph, dMin, dMax) {
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, r = dMin + Math.random() * (dMax - dMin);
      const q = projectToGraph(ph.x + Math.cos(a) * r, ph.z + Math.sin(a) * r, 120);
      if (!q) continue;
      const d = Math.hypot(q.x - ph.x, q.z - ph.z);
      if (d < dMin * 0.6) continue;
      const route = findRoute(q.x, q.z, ph.x, ph.z);
      if (!route || route.length > dMax * 2.2) continue;
      const P = this.p;
      P.x = q.x; P.z = q.z; P.v = 6;
      const n = route.pts[Math.min(route.pts.length - 1, 2)];
      P.yaw = Math.atan2(-(n.x - q.x), -(n.z - q.z));
      this.route = route; this.ri = 0; this._rt = 1.2;
      this.car.root.visible = true;
      return true;
    }
    return false;
  }

  /** صناديق التصادم (عربية الشرطة جسم حقيقي: لو خبطتها بتتزق، ولو هي زقتك بتتزق) */
  colliders(box, out) {
    if (this.state === 'idle' || !this.car.root.visible) return;
    const c = this.col, P = this.p;
    if (Math.abs(P.x - box.cx) > 9 || Math.abs(P.z - box.cz) > 9) return;
    c.cx = P.x; c.cz = P.z; c.angle = P.yaw; c.vx = P.vx; c.vz = P.vz;
    out.push(c);
  }

  update(dt, ph) {
    this._cool = Math.max(0, this._cool - dt);
    if (this.state === 'idle') return;
    const P = this.p;
    const dx = ph.x - P.x, dz = ph.z - P.z, dist = Math.hypot(dx, dz);
    if (this.state === 'wait') {
      this.t += dt;
      this._drive(dt, ph, dist, 'arrive');
      if (dist < ARRIVE + 6 && P.v < 1.5) { this.state = 'ticket'; this._ticketCard(); }
      else if (this.t > 60) { P.x = ph.x - 30; P.z = ph.z; } // اتزنقت: نقرّبها
    } else if (this.state === 'ticket') {
      P.v = Math.max(0, P.v - dt * 8); this._move(dt);
      // اتحركت قبل ما تدفع = هروب
      if (Math.hypot(ph.x - this.at.x, ph.z - this.at.z) > 14 && ph.speed > 3) { this.hud?.closeCard?.(); this._startChase(); }
    } else if (this.state === 'chase') {
      this.t += dt;
      this._drive(dt, ph, dist, 'chase');
      // مسكتك: لازقة فيك وإنت شبه واقف
      this._catchT = dist < 7.5 && ph.speed < 2.5 ? (this._catchT || 0) + dt : 0;
      if (this._catchT > 1.2) this._caught();
      // بعدت أوي (اتلففت/اتزنقت): بتظهر وراك تاني
      this._farT = dist > 260 ? (this._farT || 0) + dt : 0;
      if (this._farT > 4) { this._farT = 0; this._spawnBehind(ph); }
      this._noteT = (this._noteT || 0) - dt;
      if (this._noteT <= 0) { this._noteT = 14; this.hud?.toast('🚨 الشرطة وراك! اقف على جنب', 2.4); }
    } else if (this.state === 'blocked') {
      P.v = 0;
      if (this.hud && !this.hud.cardOpen) this._blockCard(); // كارت تاني قفله: يرجع (لازم تدفع)
    }
    if (this.state === 'ticket' && this.hud && !this.hud.cardOpen) this._ticketCard();
    this._sync(dt, dist);
  }

  /** قيادة عربية الشرطة: على طريق الـ GPS لحد ما تقرب، وبعدين مطاردة مباشرة بمناورات */
  _drive(dt, ph, dist, mode) {
    const P = this.p;
    let tx, tz, want;
    this._rt -= dt;
    const direct = dist < (mode === 'chase' ? 45 : 30);
    if (!direct && (this._rt <= 0 || !this.route)) {
      this._rt = 1.2;
      this.route = findRoute(P.x, P.z, ph.x, ph.z, -Math.sin(P.yaw), -Math.cos(P.yaw)) || this.route;
      this.ri = 0;
    }
    if (!direct && this.route) {
      // نقطة على الطريق قدامها بمسافة (pure pursuit)
      const pts = this.route.pts;
      while (this.ri < pts.length - 1 && Math.hypot(pts[this.ri].x - P.x, pts[this.ri].z - P.z) < 9 + P.v * 0.5) this.ri++;
      tx = pts[this.ri].x; tz = pts[this.ri].z;
      want = mode === 'chase' ? MAX_V : Math.min(22, 8 + dist * 0.15);
    } else if (mode === 'chase') {
      // مناورات: من ورا بتلزق في ركن عربيتك (تزقك)، ومن الجنب بتقفل عليك قدام
      const [fx, fz] = ph.forward, rx = -fz, rz = fx;
      const along = -(dx(P, ph) * fx + dz(P, ph) * fz); // موجب = الشرطة ورا
      const side = (P.x - ph.x) * rx + (P.z - ph.z) * rz;
      const lead = Math.min(1.2, dist / 25);
      let ax = ph.x + ph.vx * lead, az = ph.z + ph.vz * lead;
      if (along > 3) { ax += rx * Math.sign(side || 1) * 1.1; az += rz * Math.sign(side || 1) * 1.1; } // تخبط الركن (PIT)
      else if (along > -4) { ax += fx * 6; az += fz * 6; }                                       // جنبك: تدخل قدامك
      tx = ax; tz = az;
      want = Math.min(MAX_V, Math.max(12, ph.speed * 1.18 + 3));
    } else {
      // وصلت: تقف ورا عربيتك
      const [fx, fz] = ph.forward;
      tx = ph.x - fx * 8; tz = ph.z - fz * 8;
      const d2 = Math.hypot(tx - P.x, tz - P.z);
      want = Math.min(12, d2 * 0.8);
    }
    // لف ناحية الهدف
    const ang = Math.atan2(-(tx - P.x), -(tz - P.z));
    let d = ang - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxTurn = (1.6 + 8 / (2 + P.v)) * dt;
    P.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
    if (Math.abs(d) > 1.2) want = Math.min(want, 7);
    P.v += Math.max(-14 * dt, Math.min(7 * dt, want - P.v));
    this._move(dt);
  }

  _move(dt) {
    const P = this.p;
    P.vx = -Math.sin(P.yaw) * P.v; P.vz = -Math.cos(P.yaw) * P.v;
    P.x += P.vx * dt; P.z += P.vz * dt;
  }

  _sync(dt, dist) {
    const P = this.p, r = this.car.root;
    r.position.set(P.x, groundHeight(P.x, P.z), P.z);
    r.rotation.y = P.yaw;
    // الكشاف بيلمع أحمر/أزرق
    this._flash += dt;
    const lb = this.car.lightbar;
    if (lb) {
      const k = Math.floor(this._flash * 7) % 4;
      lb.children[1].material.emissiveIntensity = k < 2 ? (k === 0 ? 3 : 0.3) : 0.15;
      lb.children[2].material.emissiveIntensity = k >= 2 ? (k === 2 ? 3 : 0.3) : 0.15;
    }
    this.audio?.sirenAt?.(P.x, 1.4, P.z, this.state === 'chase' || this.state === 'wait');
    void dist;
  }

  _spawnBehind(ph) {
    const [fx, fz] = ph.forward;
    if (!this._spawn({ x: ph.x - fx * 120, z: ph.z - fz * 120 }, 0, 60)) { this.p.x = ph.x - fx * 60; this.p.z = ph.z - fz * 60; }
    this.p.v = Math.max(15, ph.speed);
  }

  _ticketCard() {
    const total = this.fine;
    const pay = () => {
      this.wallet?.add(-total, 'fine', this.kind === 'flip' ? 'غرامة حادثة (انقلاب)' : 'غرامة حادثة');
      this.hud?.toast('👮 اتفضل — وسوق براحة', 3);
      this._finish();
    };
    this.hud?.showCard({
      title: '🚓 الشرطة — محضر حادثة', tone: 'police danger',
      rows: [[this.kind === 'flip' ? 'انقلاب عربية' : 'تصادم / سواقة متهورة', `${total} ج`], ['الغرامة', `${total} ج`, 'pc-c']],
      note: 'ادفع وكمّل — ولو جريت هتتطارد وتتسحب رخصك',
      buttons: [{ label: 'ادفع الغرامة', onClick: pay }],
    });
  }

  _startChase() {
    this.state = 'chase'; this.t = 0; this._catchT = 0; this._noteT = 0;
    this.route = null; this._rt = 0;
    this.hud?.toast('🚨 هربت من الشرطة! المطاردة بدأت', 3);
  }

  _caught() {
    const keys = ['driver', this.vkind].filter(Boolean);
    this.licenses?.revoke?.(keys);
    this.blocked = { fine: this.fine + FINE.flee, keys };
    try { localStorage.setItem(KEY, JSON.stringify(this.blocked)); } catch { /* */ }
    this.state = 'blocked';
    this.at = null;
    this.audio?.siren?.(false);
    this._blockCard();
  }

  _blockCard() {
    const b = this.blocked;
    const pay = () => {
      this.wallet?.add(-b.fine, 'fine', 'غرامة هروب من الشرطة + حادثة');
      this.blocked = null;
      try { localStorage.removeItem(KEY); } catch { /* */ }
      this.hud?.toast('🪪 دفعت الغرامة — رخصك اتسحبت، جددها من 🪪 قبل أي كمين', 4.5);
      this._finish();
    };
    this.hud?.showCard({
      title: '🚔 الشرطة مسكتك!', tone: 'police danger',
      rows: [['هروب من الشرطة', `${FINE.flee} ج`], ['الحادثة', `${b.fine - FINE.flee} ج`], ['سحب الرخص', 'رخصة القيادة + رخصة العربية'], ['الإجمالي', `${b.fine} ج`, 'pc-c']],
      note: 'مش هتعرف تكمّل غير لما تدفع (لو الفلوس مش مكفية هتبقى عليك)',
      buttons: [{ label: `ادفع ${b.fine} ج`, onClick: pay }],
      def: null,
    });
  }

  _finish() {
    this.state = 'idle';
    this.car.root.visible = false;
    this.p.v = 0;
    this._cool = 20; // مفيش حادثة جديدة على طول (الخبطات الصغيرة بعد الحادثة)
    this.audio?.siren?.(false);
  }
}

function dx(P, ph) { return ph.x - P.x; }
function dz(P, ph) { return ph.z - P.z; }

void THREE;
