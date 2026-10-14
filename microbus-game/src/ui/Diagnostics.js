// لوحة تشخيص مؤقتة في الركن: بتقول الحقيقة عن اللي شغال فعلًا في النسخة المنشورة
export const BUILD_ID = 'EGY-MICROBUS-01';

export class Diagnostics {
  constructor() {
    const el = (this.el = document.createElement('div'));
    el.id = 'diag';
    // للناس اللي بتجرب: مخفية. بتظهر لو اللينك آخره #debug أو لو فيه مشكلة في تحميل العربية
    this.visible = /debug/.test(location.hash);
    el.hidden = !this.visible;
    document.body.appendChild(el);
    this.rows = { build: `BUILD: ${BUILD_ID}`, hiace: 'HIACE: LOADING…', left: 'LEFT MIRROR: —', right: 'RIGHT MIRROR: —' };
    this.state = {};
    this._t = 0;
    this.render();
  }

  set(key, text, state) {
    if (state === 'bad' && key === 'hiace') this.el.hidden = false;
    if (this.rows[key] === text && this.state[key] === state) return;
    this.rows[key] = text;
    this.state[key] = state;
    this.render();
  }

  render() {
    this.el.innerHTML = Object.entries(this.rows)
      .map(([k, t]) => `<div class="${this.state[k] || ''}">${t.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</div>`)
      .join('');
  }

  /** بتتنادى كل فريم؛ بتحدّث حالة المرايات مرتين في الثانية */
  update(dt, player, cockpit) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.5;
    for (const [side, key, name] of [[-1, 'left', 'LEFT'], [1, 'right', 'RIGHT']]) {
      const mc = player.mirrorCams?.find((c) => c.m.side === side);
      if (!mc) { this.set(key, `${name} MIRROR: FAILED (no mirror found on model)`, 'bad'); continue; }
      if (mc.error) { this.set(key, `${name} MIRROR: FAILED (${mc.error})`, 'bad'); continue; }
      if (!mc.renders) { this.set(key, `${name} MIRROR: ${cockpit ? 'STARTING…' : 'IDLE (driver camera only)'}`, ''); continue; }
      if (mc.blank) { this.set(key, `${name} MIRROR: FAILED (image is blank)`, 'bad'); continue; }
      this.set(key, `${name} MIRROR: ${cockpit ? 'ACTIVE' : 'ACTIVE (paused outside driver cam)'} · ${mc.renders}`, 'ok');
    }
  }
}
