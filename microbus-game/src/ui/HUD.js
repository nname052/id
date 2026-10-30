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
    this.payEl.addEventListener('pointerdown', (e) => { const b = e.target.closest('.pc-ok'); if (b) { e.preventDefault(); e.stopPropagation(); this._payOk(+b.dataset.i || 0); } });
    window.addEventListener('keydown', (e) => {
      if (!this._pay) return;
      if (e.code === 'Enter') this._payOk(0);
      const n = /^Digit([1-4])$/.exec(e.code); if (n) this._payOk(+n[1] - 1);
    });
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
    if (this.navOverride === 'police') { a = '🚨 <b>اركن على جنب</b>'; b = `العلامة الزرقا${d ? ` · ${d}` : ''}`; }
    else if (this.navOverride === 'fuel') { a = '⛽ <b>البنزين قليل</b>'; b = `روح ${'بنزينة الترعة'}${d ? ` · ${d}` : ''}`; }
    else if (j.mode === 'free' && j.kind === 'police') {
      const pj = this.policeJob;
      if (pj?.chase) { a = '🚨 <b>مطاردة</b> <span>عربية خبطت وهربت</span>'; b = `المسافة <b>${pj.dist}م</b> · فاضل ${pj.left}ث${pj.close > 0 ? ` · بتقف ${Math.round(pj.close * 100)}%` : ''}`; }
      else { a = '🚓 <b>دورية</b> <span>بوكس شرطة</span>'; b = 'استنى البلاغ الجاي — لف في المنطقة'; }
    }
    else if (j.mode === 'free' && j.kind === 'ambulance') {
      const aj = this.ambJob || {};
      if (aj.state === 'toCase') { a = '🚑 <b>حالة طوارئ</b> <span>روح للمصاب</span>'; b = `${d || aj.dist + 'م'} · فاضل ${aj.left}ث`; }
      else if (aj.state === 'load') { a = '🩺 <b>بيشيلوا المصاب</b>'; b = `استنى واقف · ${Math.round((aj.load || 0) * 100)}%`; }
      else if (aj.state === 'toHosp') { a = `🏥 <b>${esc(aj.hosp || 'المستشفى')}</b>`; b = `${d || aj.dist + 'م'} · فاضل ${aj.left}ث`; }
      else { a = '🚑 <b>إسعاف</b> <span>جاهز</span>'; b = 'استنى البلاغ الجاي'; }
    }
    else if (j.mode === 'free') {
      a = `${{ car: '🚗', pickup: '🛻', truck: '🚚' }[j.kind] || '🚗'} <b>سواقة حرة</b> <span>${{ car: 'ملاكي', pickup: 'ربع نقل', truck: 'نقل' }[j.kind] || ''}</span>`;
      b = d ? `المكان اللي اخترته · ${d}` : 'لف في المدينة براحتك';
    } else if (j.mode === 'line') {
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

  // ===== كارت عام (حساب المشوار، البنزينة، الغرامة، الجركن): كارت واحد بس في المرة =====
  // buttons: [{ label, sub, onClick, disabled, cls }] — def: اللي بيحصل لو الكارت اتقفل لوحده/اتبدّل (زي تسجيل الأجرة)
  showCard({ title, rows = [], note = '', buttons = [], timeout = 0, def = null, tone = '' }) {
    if (this._pay) this._closeCard(true);
    this._pay = { t: timeout || Infinity, def, buttons };
    const rowsHtml = rows.map(([a, b, cls]) => `<div class="pc-r ${cls || ''}"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
    const btns = buttons.map((b, i) => `<button class="pc-ok ${b.cls || ''}" data-i="${i}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}${b.sub ? `<small>${esc(b.sub)}</small>` : ''}</button>`).join('');
    this.payEl.className = tone;
    this.payEl.innerHTML = `<div class="pc-h">${esc(title)}</div>${rowsHtml}${note ? `<div class="pc-n">${esc(note)}</div>` : ''}<div class="pc-btns n${buttons.length}">${btns}</div>`;
  }
  get cardOpen() { return !!this._pay; }
  /** قفل الكارت: runDef = نفّذ الافتراضي (لو اتقفل من غير ما تختار) */
  _closeCard(runDef = false) {
    const p = this._pay;
    if (!p) return;
    this._pay = null;
    this.payEl.className = 'hidden';
    if (runDef) p.def?.();
  }
  closeCard() { this._closeCard(true); }
  _payOk(i = 0) {
    const p = this._pay;
    if (!p) return;
    const b = p.buttons[i];
    if (!b || b.disabled) return;
    this._pay = null;
    this.payEl.className = 'hidden';
    b.onClick?.();
  }

  /** حساب المشوار: الأجرة، الزبون دفع كام، والباقي */
  showPayment({ fare, paid, change, dest, full, mood }, onOk) {
    const note = full && fare < full ? `${mood < 0.55 ? 'زعلان من السواقة — دفع أقل' : 'خصم عشان السواقة'} (الأجرة كانت ${full} ج)` : '';
    this.showCard({
      title: `💵 الحساب · ${dest}`,
      rows: [['الأجرة', `${fare} ج`], ['الزبون دفع', `${paid} ج`], ['الباقي ليه', `${change} ج`, 'pc-c']],
      note, timeout: 9, def: onOk,
      buttons: [{ label: change ? 'ادّيله الباقي ✓' : 'تمام ✓', onClick: onOk }],
    });
  }

  // ===== عداد البنزين في اللوحة =====
  setFuel(frac) {
    const el = (this.fuelEl ||= document.getElementById('hud-fuel'));
    if (!el) return;
    const w = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    if (w !== this._fuelW) { el.style.width = w; this._fuelW = w; }
    el.parentElement.parentElement.classList.toggle('low', frac < 0.15);
  }

  /** اسم الشارع الحالي: name = اسم حقيقي من OSM، أو null + وصف عام للشارع اللي مالوش اسم (من غير ما نألّف اسم) */
  setStreet(name, generic) {
    const box = (this.streetBox ||= document.getElementById('street')), el = (this.streetEl ||= document.getElementById('street-name'));
    if (!box) return;
    const text = name || generic || '';
    if (text === this._street) return;
    this._street = text;
    box.classList.toggle('hidden', !text);
    if (text) { el.textContent = text; el.classList.toggle('unnamed', !name); }
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

  /** رسالة صغيرة فوق. minor = رسايل ثانوية (كلام الركاب، اسم المنطقة): مابتظهرش لو فيه رسالة شغالة
   *  أو لو لسه فيه واحدة ثانوية من شوية. ونفس الرسالة مابتتكررش ورا بعض — عشان الشاشة تفضل فاضية للسواقة */
  toast(text, sec = 2, minor = false) {
    const now = performance.now() / 1000;
    if (text === this._lastToast && now - this._lastToastT < 12) return;
    if (minor && (this.toastTimer > 0 || now - (this._minorT || -99) < 9)) return;
    if (minor) this._minorT = now;
    this._lastToast = text; this._lastToastT = now;
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = Math.min(sec, minor ? 2 : 3);
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
    if (this._pay && (this._pay.t -= dt) <= 0) this._closeCard(true); // لو مدستش: الكارت بيتقفل لوحده (بالاختيار الافتراضي)
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
