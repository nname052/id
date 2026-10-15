// =====================================================================
//  الـ GPS: طريق لهدف (راكب/محطة/وجهة)، بيتابع مكانك عليه، وبيعيد الحساب لو خرجت عنه.
//  الحساب كل ربع ثانية بس (مش كل فريم)، وإعادة الحساب بحد أقصى مرة كل 1.5 ثانية.
// =====================================================================
import { findRoute, trackRoute } from './RoadGraph.js';

export class Navigator {
  constructor() {
    this.target = null;
    this.route = null;
    this.info = null;
    this._track = {};
    this._t = 0;
    this._age = 0;
  }

  /** هدف جديد ({x,z,name}) أو null */
  setTarget(t) {
    if (!t) { this.target = null; this.route = null; this.info = null; return; }
    if (this.target && Math.hypot(this.target.x - t.x, this.target.z - t.z) < 0.5) { this.target.name = t.name; return; }
    this.target = { x: t.x, z: t.z, name: t.name || '' };
    this.route = null;
    this._t = 0;
  }

  update(dt, ph) {
    this._age += dt;
    this._t -= dt;
    if (this._t > 0 || !this.target) return;
    this._t = 0.25;
    const off = this.info?.off ?? 0;
    if (!this.route || (off > 26 && this._age > 1.5)) {
      const [fx, fz] = ph.forward;
      this.route = findRoute(ph.x, ph.z, this.target.x, this.target.z, fx, fz);
      this._track = {};
      this._age = 0;
      if (!this.route) { this.info = null; return; }
    }
    const tr = trackRoute(this.route, ph.x, ph.z, this._track);
    if (!tr) { this.info = null; return; }
    const end = this.route.pts[this.route.pts.length - 1];
    const tail = Math.hypot(end.x - this.target.x, end.z - this.target.z);
    this.info = { remain: tr.remain + tail, next: tr.next, nextDist: tr.nextDist, off: tr.off, s: tr.s, name: this.target.name };
  }
}

/** نص قصير للمسافة: 80م / 1.2كم */
export function fmtDist(m) {
  if (m == null) return '';
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)}م`;
  return `${(m / 1000).toFixed(1)}كم`;
}

export const TURN_ICON = { left: '↰', right: '↱', uturn: '↶', straight: '↑' };
