// =====================================================================
//  السباق: 3 لفات في حلبة شبين. اقف في مربعات البداية (ورا خط البداية) → "ابدأ السباق"
//  → 3 عربيات منافسة (ذكاء بسيط على خط السباق: بتهدّي في المنحنيات وبتسرّع في المستقيم)
//  → إشارة البداية (5 لمبات حمرا وبعدين تطفي = انطلق) → عداد اللفات والوقت والمركز → النتيجة والجايزة.
// =====================================================================
import { RACE, RACE_GRID, RACE_Y, raceProject } from '../world/RaceTrack.js';

const LAPS = 3;
const PRIZE = [400, 200, 100, 0];
const AI_COLORS = [0xd62828, 0x1d4ed8, 0x111111];
const AI_NAMES = ['حمادة', 'كريم', 'عم سيد'];

const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };

export class Race {
  constructor(game) {
    this.g = game;
    this.state = 'idle';
    this.track = game.raceTrack;
    this.ai = [];
    this.el = document.createElement('div');
    this.el.id = 'racebar'; this.el.className = 'hidden';
    document.body.appendChild(this.el);
    this._pr = { i: 0, s: 0, d: 0 };
    this._cool = 0;
  }

  get active() { return this.state === 'countdown' || this.state === 'racing'; }
  /** العربية لازم تقف (العد التنازلي) */
  get hold() { return this.state === 'countdown'; }

  colliders(box, out) {
    if (!this.ai.length || this.state === 'idle') return;
    for (const a of this.ai) {
      if (Math.abs(a.x - box.cx) > 9 || Math.abs(a.z - box.cz) > 9) continue;
      const c = a.col; c.cx = a.x; c.cz = a.z; c.angle = a.yaw; c.vx = -Math.sin(a.yaw) * a.v; c.vz = -Math.cos(a.yaw) * a.v;
      out.push(c);
    }
  }

  update(dt, ph) {
    this._cool = Math.max(0, this._cool - dt);
    const L = RACE.length;
    const pr = raceProject(ph.x, ph.z, this._pr);
    if (this.state === 'idle') {
      // واقف في مربعات البداية (آخر 35م قبل الخط) → كارت "ابدأ السباق"
      const inBox = pr && Math.abs(pr.d) < RACE.half && pr.s > L - 36 && pr.s < L - 3;
      this._boxT = inBox && ph.speed < 1 ? (this._boxT || 0) + dt : 0;
      if (this._boxT > 0.8 && !this._cool && !this.g.hud.cardOpen && !this.g.incidents?.busy) {
        this._cool = 12;
        this.g.hud.showCard({
          title: '🏁 حلبة شبين — سباق 3 لفات', tone: 'fuel',
          rows: [['المنافسين', AI_NAMES.join(' · ')], ['الجايزة', `الأول ${PRIZE[0]} ج · التاني ${PRIZE[1]} ج · التالت ${PRIZE[2]} ج`]],
          note: 'استنى الإشارة الحمرا تطفي وانطلق',
          buttons: [{ label: 'ابدأ السباق', onClick: () => this.start() }, { label: 'مش دلوقتي', cls: 'alt' }],
        });
      }
      return;
    }
    if (this.state === 'countdown') {
      this.t += dt;
      const on = Math.min(5, Math.floor(this.t / 0.8));
      this.track.lights.forEach((m, k) => { m.emissiveIntensity = k < on && this.t < 4.6 ? 4 : 0; });
      this.el.innerHTML = this.t < 4.6 ? `<b>${on >= 5 ? 'استعد...' : 5 - on}</b>` : '<b class="go">انطلق!</b>';
      this._aiPose(0);
      if (this.t >= 4.6) { this.state = 'racing'; this.t = 0; this.g.audio?.engineStart?.(); }
      return;
    }
    if (this.state === 'racing') {
      this.t += dt;
      // تقدم اللاعب: لفة بتتحسب لما تعدي الخط بعد ما تكون عدّيت نص الحلبة
      if (pr && Math.abs(pr.d) < 40) {
        if (pr.s > L * 0.4 && pr.s < L * 0.6) this.half = true;
        if (this.half && this.lastS > L - 60 && pr.s < 60) {
          this.lap++; this.half = false;
          const lt = this.t - this.lapT0; this.lapT0 = this.t;
          this.best = Math.min(this.best, lt);
          if (this.lap >= LAPS) { this._finish(); return; }
          this.g.hud.toast(`🏁 لفة ${this.lap}/${LAPS} — ${fmt(lt)}`, 2);
        }
        this.lastS = pr.s;
        this.prog = this.lap * L + (this.half || pr.s < L * 0.6 ? pr.s : pr.s - L);
      }
      // بعدت عن الحلبة: السباق اتلغى
      if (!pr || Math.abs(pr.d) > 60) { this._offT = (this._offT || 0) + dt; if (this._offT > 4) { this.g.hud.toast('السباق اتلغى (خرجت من الحلبة)', 3); this._end(); return; } } else this._offT = 0;
      this._aiDrive(dt);
      // المركز
      let pos = 1;
      for (const a of this.ai) if (a.prog > this.prog) pos++;
      this.pos = pos;
      this.el.innerHTML = `<span>لفة <b>${Math.min(LAPS, this.lap + 1)}/${LAPS}</b></span><span>${fmt(this.t)}</span><span>المركز <b>${pos}/${this.ai.length + 1}</b></span>`;
    }
  }

  start() {
    const g = this.g, S = RACE.samples, p = S[RACE.start];
    // اللاعب في أول مربع والمنافسين في الباقي
    const slot = RACE_GRID[0], yaw = Math.atan2(-p.dx, -p.dz);
    g.player.physics.reset(p.x - p.dx * slot.back + p.rx * slot.side, p.z - p.dz * slot.back + p.rz * slot.side, yaw);
    g.player._savePrev(); g.cams.snap = true;
    if (!this.ai.length) {
      for (let k = 0; k < 3; k++) {
        const rig = g._makeCar('sedan', AI_COLORS[k]);
        g.scene.add(rig.root);
        this.ai.push({ rig, name: AI_NAMES[k], skill: [0.97, 0.93, 0.89][k], col: { cx: 0, cz: 0, hx: 0.9, hz: 2.2, angle: 0, mass: 1300, restitution: 0.2, vx: 0, vz: 0, kind: 'car' } });
      }
    }
    const N = S.length;
    this.ai.forEach((a, k) => {
      const sl = RACE_GRID[k + 1];
      a.i = (RACE.start - Math.round(sl.back / 2) + N) % N; a.f = 0; a.lane = sl.side; a.v = 0; a.lap = -1; a.prog = -sl.back; a.done = false;
      a.rig.root.visible = true;
      this._aiPlace(a);
    });
    this.state = 'countdown'; this.t = 0; this.lap = 0; this.half = false; this.lastS = RACE.length - slot.back; this.lapT0 = 0; this.best = Infinity; this.prog = -slot.back;
    this.el.className = '';
    g.hud.toast('🏁 السباق هيبدأ — بص على الإشارة', 2.5);
  }

  /** العربيات المنافسة: بتمشي على خط السباق بسرعة على قد المنحنى اللي جاي */
  _aiDrive(dt) {
    const S = RACE.samples, N = S.length, L = RACE.length;
    for (const a of this.ai) {
      if (a.done) { a.v = Math.max(0, a.v - 6 * dt); }
      else {
        let k = 0;
        for (let j = 0; j < 30; j += 2) k = Math.max(k, Math.abs(S[(a.i + j + Math.round(a.v * 0.4)) % N].curv));
        const vCurve = Math.sqrt(7.5 / Math.max(k, 1e-3));
        // مطّاطية خفيفة: لو بعيد عنك ورا بيزوّد شوية ولو قدامك أوي بيهدّي (عشان السباق يفضل حلو)
        const gap = this.prog - a.prog, rubber = Math.max(-0.08, Math.min(0.1, gap / 400));
        const want = Math.min(36 * a.skill * (1 + rubber), vCurve);
        a.v += Math.max(-9 * dt, Math.min(4.2 * dt, want - a.v));
      }
      // مشي على العينات (2م)
      a.f += (a.v * dt) / 2;
      while (a.f >= 1) {
        a.f -= 1; a.i = (a.i + 1) % N;
        if (a.i === RACE.start) { a.lap++; if (a.lap >= LAPS && !a.done) { a.done = true; a.finishT = this.t; } }
      }
      a.lane += (Math.max(-3.5, Math.min(3.5, a.lane)) - a.lane) * dt; // بيرجع جوه الحارة لو اتزق
      a.prog = Math.max(0, a.lap) * L + (((a.i - RACE.start + N) % N) * 2) + (a.lap < 0 ? -L : 0);
      this._aiPlace(a);
    }
  }

  _aiPose() { for (const a of this.ai) this._aiPlace(a); }

  _aiPlace(a) {
    const S = RACE.samples, N = S.length, p = S[a.i], q = S[(a.i + 1) % N];
    const x = p.x + (q.x - p.x) * a.f + p.rx * a.lane, z = p.z + (q.z - p.z) * a.f + p.rz * a.lane;
    a.x = x; a.z = z; a.yaw = Math.atan2(-p.dx, -p.dz);
    a.rig.root.position.set(x, RACE_Y, z);
    a.rig.root.rotation.y = a.yaw;
    a.spin = (a.spin || 0) + a.v / 0.31 / 60;
    for (const w of a.rig.wheels || []) if (w.spin) w.spin.rotation.x = -a.spin;
    if (a.rig.brake) a.rig.brake.emissiveIntensity = a.v < 1 ? 3.5 : 0.15;
    // اتخبط فيها: بتتزق لجنب
    if (!a.col.onHit) a.col.onHit = (dv, jx = 0, jz = 0) => { const p2 = RACE.samples[a.i]; a.lane += (jx * p2.rx + jz * p2.rz) / a.col.mass * 0.6; a.v = Math.max(0, a.v - Math.abs(dv) * 0.5); };
  }

  _finish() {
    const g = this.g, total = this.t;
    let pos = 1;
    for (const a of this.ai) if (a.done && a.finishT < total) pos++;
    const prize = PRIZE[pos - 1] || 0;
    if (prize) g.wallet?.add(prize, 'race', `جايزة السباق (المركز ${pos})`);
    g.hud.showCard({
      title: pos === 1 ? '🏆 كسبت السباق!' : `🏁 خلصت السباق — المركز ${pos}`, tone: 'fuel',
      rows: [['الوقت', fmt(total)], ['أحسن لفة', fmt(this.best)], ['الجايزة', `${prize} ج`, 'pc-c']],
      buttons: [{ label: 'تمام', onClick: () => {} }],
    });
    this._end();
  }

  _end() {
    this.state = 'idle';
    this.el.className = 'hidden';
    this.track.lights.forEach((m) => { m.emissiveIntensity = 0; });
    this._cool = 15;
    // المنافسين بيستخبوا بعد شوية
    setTimeout(() => { if (this.state === 'idle') for (const a of this.ai) a.rig.root.visible = false; }, 6000);
  }
}
