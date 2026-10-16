// =====================================================================
//  الحوادث والشرطة: لما العربية تتقلب أو تخبط خبطة جامدة:
//   1) الركاب بيخافوا وبينزلوا يجروا (من غير أجرة)
//   2) عربية شرطة بتيجي من أقرب طريق (بالسارينة والكشاف) وبتطاردك دقيقة — من غير ما توقف عربيتك ومن غير ما تخبطك
//   3) لو وقفت على جنب بدري: مخالفة عادية تدفعها وتكمل
//   4) لو هربت دقيقة: خلاص هربت
//   5) لو هربت شوية وبعدين وقفت جنبها = اتمسكت: سحب الرخص + غرامة كبيرة، واللعبة واقفة لحد ما تدفع
// =====================================================================
import * as THREE from 'three';
import { buildSedan } from '../vehicles/SedanModel.js';
import { groundHeight } from '../world/ground.js';
import { findRoute, projectToGraph } from '../nav/RoadGraph.js';

const KEY = 'egy-police-block-v1';
const FINE = { crash: 300, flip: 500, flee: 1500, checkpoint: 1000 };
const MAX_V = 30;          // أقصى سرعة لعربية الشرطة (م/ث ≈ 108 كم/س) — ممكن تهرب منها
const CHASE_TIME = 60;     // المطاردة دقيقة؛ لو فضلت بعيد عنها لحد ما تخلص = هربت

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

  /** العربية ممنوعة تتحرك؟ بس لو اتمسكت ومدفعتش (مفيش تجميد وقت الحادثة) */
  get hold() { return this.state === 'blocked'; }
  get busy() { return this.state !== 'idle'; }
  get chasing() { return this.state === 'chase'; }

  navTarget() { return null; }

  /** لما اللعبة تبدأ: لو فيه حظر قديم */
  start(ph) {
    if (this.blocked) { this.state = 'blocked'; this.at = { x: ph.x, z: ph.z }; this._blockCard(); }
  }

  /** حادثة: kind = 'flip' | 'crash' — الشرطة بتطاردك دقيقة: تقف على جنب (غرامة) أو تهرب */
  trigger(kind, ph, playerKind) {
    if (this.state !== 'idle' || this._cool > 0) return;
    this.kind = kind; this.vkind = playerKind;
    this.fine = FINE[kind];
    // 1) الركاب
    const n = this.passengers?.panicExit?.(ph) || 0;
    if (n) this.hud?.toast(`😱 الركاب اتخضوا ونزلوا يجروا (${n}) — من غير أجرة`, 3);
    // 2) عربية الشرطة جاية من بعيد على الطريق وبتطارد على طول (من غير ما توقف عربيتك)
    if (!this._spawn(ph, 120, 200)) { this._finish(); return; }
    this._startChase(true);
    this.audio?.siren?.(true);
    setTimeout(() => this.hud?.toast('🚓 الشرطة وراك! اقف على جنب وادفع الغرامة — أو اهرب منها دقيقة', 3.5), n ? 3200 : 0);
  }

  /** هروب من كمين: المطاردة بتبدأ من مكان عربية الكمين نفسها (على الطريق، مش جنبك) */
  pursueFrom(x, z, ph, playerKind) {
    if (this.state !== 'idle') return false;
    const q = projectToGraph(x, z, 40);
    if (!q) return false;
    this.kind = 'checkpoint'; this.vkind = playerKind; this.fine = FINE.checkpoint;
    const P = this.p;
    P.x = q.x; P.z = q.z; P.v = 3;
    P.yaw = Math.atan2(-(ph.x - q.x), -(ph.z - q.z));
    this.route = null; this.ri = 0; this._rt = 0;
    this.car.root.visible = true;
    this._startChase(true);
    this.audio?.siren?.(true);
    return true;
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

  /** صناديق التصادم (عربية الشرطة جسم حقيقي لو خبطتها — بس هي مش بتخبطك) */
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
    if (this.state === 'chase') {
      this.t += dt;
      this._drive(dt, ph, dist);
      if (dist < 60) this.near = (this.near || 0) + dt; // وقت ما الشرطة وراك على طول
      // وقفت على جنب والشرطة قريبة → المخالفة
      this._stopT = dist < 25 && ph.speed < 1 ? (this._stopT || 0) + dt : 0;
      if (this._stopT > 1.5) {
        if (this.near > 15) this._caught();       // كنت بتهرب وبعدين وقفت = اتمسكت
        else { this.state = 'ticket'; this.at = { x: ph.x, z: ph.z }; this._ticketCard(); }
      } else if (this.t >= CHASE_TIME) {
        this.hud?.toast('😎 هربت من الشرطة!', 3);
        this._finish();
        return;
      }
      this._noteT = (this._noteT || 0) - dt;
      if (this._noteT <= 0 && this.state === 'chase') { this._noteT = 15; this.hud?.toast(`🚨 الشرطة وراك — ${Math.ceil(CHASE_TIME - this.t)} ثانية`, 2.2, true); }
    } else if (this.state === 'ticket') {
      P.v = Math.max(0, P.v - dt * 8); this._move(dt);
      // اتحركت قبل ما تدفع → المطاردة بتكمل
      if (Math.hypot(ph.x - this.at.x, ph.z - this.at.z) > 14 && ph.speed > 3) { this.hud?.closeCard?.(); this._startChase(false); }
    } else if (this.state === 'blocked') {
      P.v = 0;
      if (this.hud && !this.hud.cardOpen) this._blockCard(); // كارت تاني قفله: يرجع (لازم تدفع)
    }
    if (this.state === 'ticket' && this.hud && !this.hud.cardOpen) this._ticketCard();
    this._sync(dt, dist);
  }

  /** قيادة عربية الشرطة: ماشية على الطرق (مش بتقطع من جوه العمارات)، ولما تقرب بتمشي وراك على مسافة — مش بتخبطك */
  _drive(dt, ph, dist) {
    const P = this.p;
    let tx, tz, want;
    this._rt -= dt;
    const close = dist < 22;
    if (!close && (this._rt <= 0 || !this.route)) {
      this._rt = 1.0;
      this.route = findRoute(P.x, P.z, ph.x, ph.z, -Math.sin(P.yaw), -Math.cos(P.yaw)) || this.route;
      this.ri = 0;
    }
    if (!close && this.route) {
      const pts = this.route.pts;
      while (this.ri < pts.length - 1 && Math.hypot(pts[this.ri].x - P.x, pts[this.ri].z - P.z) < 8 + P.v * 0.4) this.ri++;
      tx = pts[this.ri].x; tz = pts[this.ri].z;
      want = Math.min(MAX_V, Math.max(14, ph.speed * 1.1 + 4));
    } else {
      // وراك على بعد ~10م بنفس سرعتك تقريبًا (بتهدّي لو قربت أكتر)
      const [fx, fz] = ph.forward;
      tx = ph.x - fx * 10; tz = ph.z - fz * 10;
      const gap = dist - 10;
      want = Math.max(0, Math.min(MAX_V, ph.speed + gap * 0.8));
    }
    const ang = Math.atan2(-(tx - P.x), -(tz - P.z));
    let d = ang - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxTurn = (1.6 + 8 / (2 + P.v)) * dt;
    P.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
    if (Math.abs(d) > 1.2) want = Math.min(want, 7);
    if (dist < 7) want = 0; // عمرها ما تلزق فيك
    P.v += Math.max(-16 * dt, Math.min(7 * dt, want - P.v));
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
    this.audio?.sirenAt?.(P.x, 1.4, P.z, this.state === 'chase');
    void dist;
  }

  _ticketCard() {
    const total = this.fine;
    const pay = () => {
      this.wallet?.add(-total, 'fine', this.kind === 'flip' ? 'غرامة حادثة (انقلاب)' : this.kind === 'checkpoint' ? 'غرامة هروب من كمين' : 'غرامة حادثة');
      this.hud?.toast('👮 اتفضل — وسوق براحة', 3);
      this._finish();
    };
    this.hud?.showCard({
      title: this.kind === 'checkpoint' ? '🚓 الشرطة — هروب من كمين' : '🚓 الشرطة — محضر حادثة', tone: 'police danger',
      rows: [[this.kind === 'flip' ? 'انقلاب عربية' : this.kind === 'checkpoint' ? 'عدّيت الكمين من غير ما تقف' : 'تصادم / سواقة متهورة', `${total} ج`], ['الغرامة', `${total} ج`, 'pc-c']],
      note: 'ادفع وكمّل — ولو مشيت المطاردة هتكمل',
      buttons: [{ label: 'ادفع الغرامة', onClick: pay }],
    });
  }

  _startChase(fresh) {
    this.state = 'chase'; this._stopT = 0; this._noteT = 15;
    if (fresh) { this.t = 0; this.near = 0; }
    this.route = null; this._rt = 0;
    if (!fresh) this.hud?.toast('🚨 هربت قبل ما تدفع — المطاردة كملت', 2.5);
  }

  _caught() {
    const keys = ['driver', this.vkind].filter(Boolean);
    this.licenses?.revoke?.(keys);
    this.blocked = { fine: this.fine + FINE.flee, keys, kind: this.kind };
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
      rows: [['هروب من الشرطة', `${FINE.flee} ج`], [b.kind === 'checkpoint' ? 'الكمين' : 'الحادثة', `${b.fine - FINE.flee} ج`], ['سحب الرخص', 'رخصة القيادة + رخصة العربية'], ['الإجمالي', `${b.fine} ج`, 'pc-c']],
      note: 'مش هتعرف تكمّل غير لما تدفع (لو الفلوس مش مكفية هتبقى عليك)',
      buttons: [{ label: `ادفع ${b.fine} ج`, onClick: pay }],
      def: null,
    });
  }

  _finish() {
    this.state = 'idle';
    this.onFinish?.();
    this.car.root.visible = false;
    this.p.v = 0;
    this._cool = 20; // مفيش حادثة جديدة على طول (الخبطات الصغيرة بعد الحادثة)
    this.audio?.siren?.(false);
  }
}


void THREE;
