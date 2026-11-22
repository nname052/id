// =====================================================================
//  تحكم اللمس للطيران (بيظهر بدل الدركسيون والدواسات وانت طاير):
//  - شمال: عصاية (اسحب لتحت = الأنف لفوق، يمين/شمال = ميل) — بترجع للنص لما تسيبها
//  - يمين: ذراع الدفع / الـ collective (بيفضل مكانه زي الحقيقة) + زرارين الدفة/البدالات
//  - أزرار: العجل، القلابات −/+، الفرامل (دوس كتير)، مساعد الثبات (الهليكوبتر)
// =====================================================================
export class FlightTouch {
  constructor() {
    this.state = { stickHeld: false, pitch: 0, roll: 0, yaw: 0, lever: 0, leverTouched: false, brake: 0 };
    this.actions = new Set(); this.active = false;
    const r = (this.root = document.createElement('div'));
    r.id = 'ftouch'; r.className = 'hidden';
    r.innerHTML = `
      <div class="ft-stick" id="ft-stick"><div class="ft-knob"></div></div>
      <div class="ft-right">
        <div class="ft-lever" id="ft-lever"><i></i><b></b><span>الدفع</span></div>
        <div class="ft-yaw"><button data-yaw="-1" aria-label="دفة شمال">◀</button><button data-yaw="1" aria-label="دفة يمين">▶</button></div>
      </div>
      <div class="ft-btns">
        <button data-act="siren" class="ft-plane">عجل</button>
        <button data-act="flapsUp" class="ft-plane">قلاب −</button>
        <button data-act="flapsDown" class="ft-plane">قلاب +</button>
        <button data-act="sas" class="ft-heli">SAS</button>
        <button data-hold="brake" class="ft-plane">فرامل</button>
      </div>`;
    document.body.appendChild(r);
    this._stick(r.querySelector('#ft-stick'));
    this._lever(r.querySelector('#ft-lever'));
    for (const b of r.querySelectorAll('[data-act]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.actions.add(b.dataset.act); });
    for (const b of r.querySelectorAll('[data-yaw]')) {
      const v = +b.dataset.yaw;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); this.state.yaw = v; b.classList.add('on'); });
      const up = () => { if (this.state.yaw === v) this.state.yaw = 0; b.classList.remove('on'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    }
    for (const b of r.querySelectorAll('[data-hold]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); this.state.brake = 1; b.classList.add('on'); });
      const up = () => { this.state.brake = 0; b.classList.remove('on'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    }
  }

  show(kind, lever = 0) {
    this.active = true; this.root.classList.remove('hidden');
    this.root.dataset.kind = kind;
    this.root.querySelector('.ft-lever span').textContent = kind === 'plane' ? 'الدفع' : 'Collective';
    this.setLever(lever); this.state.leverTouched = false;
  }
  hide() { this.active = false; this.root.classList.add('hidden'); Object.assign(this.state, { stickHeld: false, pitch: 0, roll: 0, yaw: 0, brake: 0 }); }
  takeActions() { const a = [...this.actions]; this.actions.clear(); return a; }
  setLever(v) { this.state.lever = v; const el = this.root.querySelector('#ft-lever'); el.querySelector('i').style.height = `${v * 100}%`; el.querySelector('b').style.bottom = `calc(${v * 100}% - 14px)`; }

  _stick(el) {
    const knob = el.querySelector('.ft-knob');
    let id = null;
    const move = (e) => {
      const b = el.getBoundingClientRect(), R = b.width / 2;
      let dx = (e.clientX - b.left - R) / R, dy = (e.clientY - b.top - R) / R;
      const L = Math.hypot(dx, dy); if (L > 1) { dx /= L; dy /= L; }
      // (منحنى ناعم: الحركات الصغيرة أدق)
      const cv = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.5);
      this.state.roll = cv(dx); this.state.pitch = cv(dy);
      knob.style.transform = `translate(${dx * R * 0.62}px, ${dy * R * 0.62}px)`;
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; el.setPointerCapture?.(id); this.state.stickHeld = true; move(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const up = (e) => { if (e.pointerId !== id) return; id = null; this.state.stickHeld = false; this.state.pitch = this.state.roll = 0; knob.style.transform = ''; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }

  _lever(el) {
    let id = null;
    const move = (e) => { const b = el.getBoundingClientRect(); this.setLever(Math.max(0, Math.min(1, 1 - (e.clientY - b.top) / b.height))); this.state.leverTouched = true; };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; el.setPointerCapture?.(id); move(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const up = (e) => { if (e.pointerId === id) id = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
}
