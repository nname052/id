// =====================================================================
//  مشهد قصير قبل المهمة (3–4 ثواني): الكاميرا بتلف حوالين الهدف بشريطين سود فوق وتحت وعنوان،
//  وأي زرار / لمسة بتتخطاه. اللعبة نفسها شغالة عادي في الخلفية.
// =====================================================================
import * as THREE from 'three';

export class Cinematic {
  constructor() {
    const el = (this.el = document.createElement('div'));
    el.id = 'cine'; el.className = 'hidden';
    el.innerHTML = '<div class="cine-bar top"></div><div class="cine-bar bot"><div class="cine-t"></div><div class="cine-s"></div></div><button class="cine-skip">تخطي ⏭</button>';
    document.body.appendChild(el);
    this.tEl = el.querySelector('.cine-t'); this.sEl = el.querySelector('.cine-s');
    const skip = () => { if (this.active) this.stop(); };
    el.querySelector('.cine-skip').addEventListener('click', skip);
    window.addEventListener('keydown', skip);
    el.addEventListener('pointerdown', skip);
    this.active = false;
    this._look = new THREE.Vector3();
  }
  /** target(): {x, z} (بيتنادى كل فريم — الهدف ممكن يكون بيتحرك) */
  play({ target, title, sub = '', dur = 3.6, onEnd = null }) {
    this.target = target; this.dur = dur; this.t = 0; this.onEnd = onEnd; this.active = true;
    this.tEl.textContent = title; this.sEl.textContent = sub;
    this.el.classList.remove('hidden'); document.body.classList.add('cine-on');
  }
  stop() {
    if (!this.active) return;
    this.active = false; this.el.classList.add('hidden'); document.body.classList.remove('cine-on');
    const f = this.onEnd; this.onEnd = null; f?.();
  }
  /** بعد كاميرا اللعبة: بنحط الكاميرا في مكان المشهد (لفة 70° حوالين الهدف وهي بتقرّب) */
  update(dt, camera) {
    if (!this.active) return;
    this.t += dt;
    const p = this.target?.();
    if (!p || this.t >= this.dur) { this.stop(); return; }
    const k = this.t / this.dur, a = (p.yaw || 0) + 0.6 + k * 1.2, r = 16 - 6 * k;
    camera.position.set(p.x + Math.sin(a) * r, 5.5 - 2 * k, p.z + Math.cos(a) * r);
    this._look.set(p.x, 1.0, p.z);
    camera.lookAt(this._look);
  }
}
