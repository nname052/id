// واجهة بسيطة: السرعة، الفتيس، عداد اللفات، اسم الكاميرا، رسائل، مساعدة
// + لوحة الشغل (خط الميكروباص / مشوار التاكسي)، ولفة الـ GPS الجاية، وكارت الحساب (الأجرة والباقي)
import { fmtDist, TURN_ICON } from '../nav/Navigator.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class HUD {
  constructor() {
    this.el = document.getElementById('hud');
    this.speed = document.getElementById('hud-speed');
    this.gear = document.getElementById('hud-gear');
    this.gearNum = document.getElementById('hud-gear-n');
    this.rpm = document.getElementById('hud-rpm');
    this.steer = document.getElementById('hud-steer');
    this.toastEl = document.getElementById('toast');
    this.help = document.getElementById('help');
    this.fpsEl = document.getElementById('fps');
    this.signal = document.getElementById('hud-signal');
    this.toastTimer = 0;
    this.fpsOn = false;
    this.frames = 0; this.fpsTime = 0;
    this.helpTimer = 14;
    // لوحة الشغل (فوق في النص)
    this.jobEl = document.createElement('div');
    this.jobEl.id = 'job'; this.jobEl.className = 'hidden';
    this.jobEl.innerHTML = '<div class="job-1"></div><div class="job-2"></div><button class="job-sw" title="غيّر الخط">⇄</button>';
    document.body.appendChild(this.jobEl);
    this.job1 = this.jobEl.querySelector('.job-1'); this.job2 = this.jobEl.querySelector('.job-2'); this.jobSw = this.jobEl.querySelector('.job-sw');
    this.jobSw.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.onSwitchLine?.(); });
    // اللفة الجاية (جنب الخريطة)
    this.navEl = document.createElement('div');
    this.navEl.id = 'navpill'; this.navEl.className = 'hidden';
    document.body.appendChild(this.navEl);
    // كارت الحساب
    this.payEl = document.createElement('div');
    this.payEl.id = 'paycard'; this.payEl.className = 'hidden';
    document.body.appendChild(this.payEl);
    this.payEl.addEventListener('pointerdown', (e) => { if (e.target.closest('.pc-ok')) { e.preventDefault(); this._payOk(); } });
    window.addEventListener('keydown', (e) => { if (e.code === 'Enter' && this._pay) this._payOk(); });
    this._job = null; this._nav = null; this._jobHtml = ['', ''];
  }

  // ===== لوحة الشغل =====
  setJob(info) { this._job = info; this._renderJob(); }
  setNav(info) { this._nav = info; this._renderJob(); this._renderNav(); }

  _renderJob() {
    const j = this._job;
    if (!j || !this._shown) { this.jobEl.classList.add('hidden'); return; }
    this.jobEl.classList.remove('hidden');
    const d = this._nav?.remain != null ? fmtDist(this._nav.remain) : '';
    let a, b;
    if (j.mode === 'line') {
      a = `<i style="background:${esc(j.color)}"></i><b>${esc(j.title)}</b> <span>← ${esc(j.to)}</span>`;
      b = `المحطة الجاية: <b>${esc(j.next)}</b>${d ? ` · ${d}` : ''}`;
    } else if (j.dest) {
      a = `📍 <b>${esc(j.dest)}</b>`;
      b = `${d ? `${d} · ` : ''}الأجرة <b>${j.fare} ج</b>`;
    } else {
      a = `🙋 <b>${j.kind === 'tuktuk' ? 'توكتوك' : 'تاكسي'}</b> <span>فاضي</span>`;
      b = d ? `أقرب زبون بيشاور · ${d}` : 'دوّر على زبون بيشاور (علامة صفرا)';
    }
    if (a !== this._jobHtml[0]) { this.job1.innerHTML = a; this._jobHtml[0] = a; }
    if (b !== this._jobHtml[1]) { this.job2.innerHTML = b; this._jobHtml[1] = b; }
    this.jobSw.classList.toggle('hidden', !(j.mode === 'line' && j.canSwitch));
  }

  _renderNav() {
    const n = this._nav;
    if (!n || !this._shown || n.remain == null) { this.navEl.classList.add('hidden'); return; }
    this.navEl.classList.remove('hidden');
    const turn = n.next && n.nextDist < 400 ? n.next : null;
    const html = turn?.start ? '<b>↶</b> لف وارجع' : turn ? `<b>${TURN_ICON[turn.turn] || '↑'}</b> ${fmtDist(n.nextDist)}` : n.remain < 60 ? '<b>📍</b> وصلت' : `<b>↑</b> ${fmtDist(n.remain)}`;
    if (html !== this._navHtml) { this.navEl.innerHTML = html; this._navHtml = html; }
  }

  // ===== كارت الحساب: الأجرة، الزبون دفع كام، والباقي =====
  showPayment({ fare, paid, change, dest, full, mood }, onOk) {
    if (this._pay) this._payOk(); // حساب قديم لسه مفتوح → يتقفل الأول
    this._pay = { onOk, t: 9 };
    const cut = full && fare < full ? `<div class="pc-n">${mood < 0.55 ? 'زعلان من السواقة — دفع أقل' : 'خصم عشان السواقة'} (${full} ج)</div>` : '';
    this.payEl.innerHTML = `<div class="pc-h">💵 الحساب · ${esc(dest)}</div>
      <div class="pc-r"><span>الأجرة</span><b>${fare} ج</b></div>
      <div class="pc-r"><span>الزبون دفع</span><b>${paid} ج</b></div>
      <div class="pc-r pc-c"><span>الباقي ليه</span><b>${change} ج</b></div>${cut}
      <button class="pc-ok">${change ? 'ادّيله الباقي ✓' : 'تمام ✓'}</button>`;
    this.payEl.classList.remove('hidden');
  }

  _payOk() {
    const p = this._pay;
    if (!p) return;
    this._pay = null;
    this.payEl.classList.add('hidden');
    p.onOk?.();
  }

  setMoney(v) {
    const el = (this.moneyEl ||= document.getElementById('hud-money'));
    if (el) { el.textContent = `${Math.round(v)}`; el.parentElement?.classList.toggle('neg', v < 0); }
  }

  setPassengers(n, cap) {
    const el = (this.paxEl ||= document.getElementById('hud-pax'));
    if (el) el.textContent = `${n}/${cap}`;
  }

  show() { this.el.classList.remove('hidden'); this.help.classList.remove('hidden'); this._shown = true; this._renderJob(); }

  toast(text, sec = 2) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = sec;
  }

  toggleHelp() { this.help.classList.toggle('hidden'); this.helpTimer = 0; }
  toggleFps() { this.fpsOn = !this.fpsOn; this.fpsEl.classList.toggle('hidden', !this.fpsOn); }

  update(dt, ph, lights) {
    const kmh = Math.round(ph.speed * 3.6);
    this.speed.textContent = kmh;
    const gm = ph.gearMode;
    const gtxt = gm === 'D' ? `D${ph.gear}` : gm;
    if (gtxt !== this._g) { this._g = gtxt; this.gear.textContent = gm === 'D' ? 'D' : gm; this.gear.className = gm; this.gearNum.textContent = gm === 'D' ? `سرعة ${ph.gear}` : gm === 'R' ? 'ريوس' : 'محايد'; }
    this.rpm.style.width = `${Math.min(100, (ph.rpm / 4500) * 100)}%`;
    this.rpm.classList.toggle('red', ph.rpm > 3800);
    const deg = Math.round((ph.steeringWheelAngle * 180) / Math.PI);
    this.steer.style.transform = `rotate(${-deg}deg)`;
    if (lights && this.signal) {
      const s = lights.state('main');
      this.signal.className = `sig ${s}`;
    }
    if (this._pay && (this._pay.t -= dt) <= 0) this._payOk(); // لو مدستش: الحساب بيتقفل لوحده
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this.helpTimer > 0) {
      this.helpTimer -= dt;
      if (this.helpTimer <= 0) this.help.classList.add('hidden');
    }
    this.frames++; this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      if (this.fpsOn) this.fpsEl.textContent = `${Math.round(this.frames / this.fpsTime)} FPS`;
      this.frames = 0; this.fpsTime = 0;
    }
  }
}
