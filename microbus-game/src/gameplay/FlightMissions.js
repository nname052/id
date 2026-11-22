// =====================================================================
//  مهمات الطيران (STAGE 7 — Phase 12):
//  - الطيارة: "رحلة ركاب" — اقلع من ممر 36 ← عدّي من الحلقة فوق المدينة (300–700م) ← ارجع اهبط على الممر واقف.
//    الأجرة حسب الهبوط: سرعة اللمس الرأسية + بعدك عن خط النص + إنك وقفت على الممر.
//  - الهليكوبتر بالتبادل:
//    * "إسعاف جوي": روح أقرب مستشفى حقيقية (أو نقطة إسعاف في اللعبة لو مفيش) واهبط جوه الدايرة الحمرا
//    * "جولة سياحية": عدّي من حلقات فوق 3 معالم حقيقية قريبة (من بيانات المدينة) وارجع للمهبط
//  الأماكن من البيانات الحقيقية بس (Destinations / landmarks.confirmed) — مفيش أسامي متألفة.
// =====================================================================
import * as THREE from 'three';
import { nearestPlace, DropMarker } from './Destinations.js';

class Ring {
  constructor(scene, r, color) {
    this.m = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.06, 8, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false, fog: false }));
    this.m.visible = false; this.r = r; scene.add(this.m); this.t = 0;
  }
  show(x, y, z, yaw) { this.m.position.set(x, y, z); this.m.rotation.set(0, yaw, 0); this.m.visible = true; }
  hide() { this.m.visible = false; }
  update(dt) { if (!this.m.visible) return; this.t += dt; this.m.material.opacity = 0.55 + 0.25 * Math.sin(this.t * 3); }
  /** عدّى من جوه الحلقة؟ (قريب من مركزها بأقل من نص قطرها) */
  passed(p) { return this.m.visible && p.distanceTo(this.m.position) < this.r * 0.9; }
}

export class FlightMissions {
  constructor(ad) {
    this.ad = ad; this.g = ad.g; this.W = ad.W;
    this.ring = null; this.marker = null; this.state = null; this.heliTurn = 0;
  }

  start() {
    const k = this.ad.kind, g = this.g;
    this.clear();
    if (k === 'plane') {
      this.ring ||= new Ring(g.scene, 45, 0x3ad0ff);
      const [x0, z0, x1, z1] = this.W.region.bbox_local;
      this.wp = { x: (x0 + x1) / 2, y: 420, z: (z0 + z1) / 2, name: 'فوق المدينة' };
      this.state = 'takeoff'; this.title = '✈️ رحلة ركاب';
      g.hud.toast('✈️ رحلة ركاب: اقلع، عدّي من الحلقة الزرقا فوق المدينة، وارجع اهبط على الممر', 5);
    } else {
      this.heliTurn++;
      if (this.heliTurn % 2 === 1) {
        const B = this.ad.fdm.B, h = nearestPlace(this.W, 'hospital', B.pos.x, B.pos.z, 120);
        this.marker ||= new DropMarker(g.scene, 0xff3030);
        // مكان الهبوط: أقرب حتة فاضية للمستشفى (مفيش مباني في نص قطر الريشة) — مش جنب حيطة عالية
        const pad = this._pad(h.px ?? h.x, h.pz ?? h.z) || { x: h.x, z: h.z };
        this.dest = { x: pad.x, z: pad.z, y: 0, name: h.name };
        this.marker.show(this.dest, this.dest.y + 0.1);
        this.state = 'medevac'; this.title = '🚑 إسعاف جوي';
        g.hud.toast(`🚑 إسعاف جوي: فيه حالة محتاجة تتنقل — اهبط جوه الدايرة الحمرا عند ${h.name}`, 5);
      } else {
        const B = this.ad.fdm.B;
        const L = (this.W.landmarks?.confirmed || []).filter((l) => l.inside_region !== false && !['street', 'canal'].includes(l.kind))
          .map((l) => ({ l, d: Math.hypot(l.x - B.pos.x, l.z - B.pos.z) })).sort((a, b) => a.d - b.d).slice(0, 3).map((q) => q.l);
        if (!L.length) { this.heliTurn++; return this.start(); }
        this.ring ||= new Ring(g.scene, 14, 0x3ad0ff);
        this.ring.m.geometry.dispose(); this.ring.m.geometry = new THREE.TorusGeometry(14, 0.9, 8, 48); this.ring.r = 14;
        this.tour = L.map((l) => ({ x: l.x, z: l.z, y: Math.max(45, this.ad._roof(l.x, l.z) + 35), name: l.name }));
        this.tourIdx = 0; this.state = 'tour'; this.title = '📸 جولة سياحية';
        this._showTour();
        g.hud.toast(`📸 جولة سياحية: عدّي من الحلقات فوق ${this.tour.map((t) => t.name).join(' ← ')}`, 5);
      }
    }
    this.t = 0;
  }

  /** أقرب نقطة فيها مساحة لهبوط الهليكوبتر (دواير لحد 150م) */
  _pad(x, z) {
    const R = (this.ad.rig.R || 5.6) + 2.5;
    for (let r = 0; r <= 150; r += 8) for (let k = 0, n = r ? Math.ceil(r / 4) : 1; k < n; k++) {
      const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this.ad._clearAt(px, pz, R)) return { x: px, z: pz };
    }
    return null;
  }

  _showTour() { const p = this.tour[this.tourIdx], B = this.ad.fdm.B; this.ring.show(p.x, p.y, p.z, Math.atan2(p.x - B.pos.x, p.z - B.pos.z)); this.wp = p; }

  clear() { this.ring?.hide(); this.marker?.hide(); this.state = null; this.wp = null; this.dest = null; }

  update(dt) {
    const ad = this.ad, F = ad.fdm, B = F.B, g = this.g;
    this.ring?.update(dt); this.marker?.update(dt);
    if (!this.state) return;
    this.t += dt;
    const pay = (base, why) => { const m = Math.max(0, Math.round(base)); g.wallet?.add?.(m, 'flight', why); return m; };
    if (this.state === 'takeoff') {
      if (!F.onGround && F._agl > 60) { this.state = 'wp'; const w = this.wp; this.ring.show(w.x, w.y, w.z, Math.atan2(w.x - B.pos.x, w.z - B.pos.z)); g.hud.toast('✈️ عدّي من الحلقة الزرقا فوق المدينة', 3); }
    } else if (this.state === 'wp') {
      if (this.ring.passed(B.pos)) { this.ring.hide(); this.state = 'land'; const t = ad.airport.threshold(1); this.wp = { x: t.x, y: 0, z: t.z, name: 'ممر 36' }; g.hud.toast('👍 ارجع للمطار واهبط على ممر 36 (من الجنوب) — العجل والقلابات!', 4); }
    } else if (this.state === 'land') {
      if (F.onGround && !this.touch) this.touch = { sink: F.touchSink || 0, x: B.pos.x - ad.airport.cx };
      if (this.touch && F.V < 1.5) {
        const A = ad.airport, onRwy = Math.abs(B.pos.x - A.cx) < 22 && Math.abs(B.pos.z - A.cz) < 1300;
        if (!onRwy) { g.hud.toast('⚠️ وقفت برّه الممر — مفيش أجرة. اقلع تاني', 4); }
        else {
          const s = this.touch.sink, q = s < 1 ? 'هبوط ناعم جدًا 👌' : s < 2 ? 'هبوط كويس' : 'هبوط جامد شوية';
          const m = pay(600 - s * 120 - Math.abs(this.touch.x) * 6, 'رحلة ركاب');
          g.hud.toast(`✈️ ${q} (${s.toFixed(1)} م/ث) — الركاب نزلوا: +${m} ج`, 5);
        }
        this.touch = null; this.start();
      }
      if (F.onGround && this.touch && F.V > 1.5 && !this._warned) this._warned = false;
    } else if (this.state === 'medevac') {
      const d = Math.hypot(B.pos.x - this.dest.x, B.pos.z - this.dest.z);
      if (F.onGround && d < 14 && F.coll < 0.5) {
        const m = pay(250 + Math.max(0, 180 - this.t) * 2, 'إسعاف جوي');
        g.hud.toast(`🚑 وصّلت الحالة لـ ${this.dest.name} — +${m} ج`, 5);
        this.start();
      }
    } else if (this.state === 'tour') {
      if (this.ring.passed(B.pos)) {
        g.hud.toast(`📸 ${this.tour[this.tourIdx].name} ✓`, 2);
        this.tourIdx++;
        if (this.tourIdx >= this.tour.length) { const m = pay(120 * this.tour.length + Math.max(0, 240 - this.t), 'جولة سياحية'); g.hud.toast(`📸 الجولة خلصت — السياح مبسوطين: +${m} ج`, 5); this.start(); }
        else this._showTour();
      }
    }
  }

  /** للعدادات: اسم المهمة + المسافة والاتجاه للهدف */
  info() {
    if (!this.state) return null;
    const B = this.ad.fdm.B, t = this.state === 'medevac' ? this.dest : this.wp;
    if (!t) return { title: this.title, text: this.state === 'takeoff' ? 'اقلع من الممر' : '' };
    const dx = t.x - B.pos.x, dz = t.z - B.pos.z, d = Math.hypot(dx, dz);
    const brg = Math.round(((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360);
    let rel = Math.atan2(dx, -dz) - B.heading; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const arrow = ['⬆️', '↗️', '➡️', '↘️', '⬇️', '↙️', '⬅️', '↖️'][((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8];
    return { title: this.title, text: `${t.name || ''} · ${d > 1000 ? (d / 1000).toFixed(1) + 'كم' : Math.round(d) + 'م'} ${arrow} ${brg}°` };
  }
}
