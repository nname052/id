import * as THREE from 'three';
import { PlayerVehicle } from '../vehicles/PlayerVehicle.js';
import { makeLodMesh } from '../vehicles/TrafficLod.js';
import { groundHeight } from '../world/ground.js';

// اللعب الجماعي: كل اللي فاتحين اللعبة في نفس اللحظة بيشوفوا بعض.
// بنستخدم "presence" بتاع الـ room (كل لاعب بينشر حالته: رقمه، اسمه، عربيته، مكانه) — مفيش سيرفر.
// لو الـ room مش متاح (لينك عام، مش مسجّل دخول، أو بنجرب محليًا) اللعبة بتشتغل لوحدها عادي.

export const SEATS = 7;
const SIZES = { microbus: [0.85, 2.35], taxi: [0.88, 2.22], tuktuk: [0.68, 1.35] };
const LABEL_Y = { microbus: 2.75, taxi: 2.05, tuktuk: 2.3 };
const SEND_HZ = 12;
const DELAY = 0.15; // بنرسم العربيات التانية متأخرة 150 مللي: بين موقعين حقيقيين وصلوا (مفيش رعشة بين الرسايل)
// لون لكل رقم (فوق العربية وعلى الخريطة)
export const SEAT_COLORS = ['#f2b330', '#e8463c', '#2f9bff', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
export const seatColor = (seat) => SEAT_COLORS[(+seat || 0) % SEAT_COLORS.length];

function labelSprite(seat, name) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(14,14,16,0.72)';
  x.beginPath(); x.roundRect(8, 16, 496, 96, 40); x.fill();
  x.fillStyle = seatColor(seat); x.beginPath(); x.arc(64, 64, 34, 0, Math.PI * 2); x.fill();
  x.strokeStyle = seatColor(seat); x.lineWidth = 6; x.beginPath(); x.roundRect(8, 16, 496, 96, 40); x.stroke();
  x.fillStyle = '#1a1408'; x.font = 'bold 48px Cairo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(seat), 64, 68);
  x.fillStyle = '#ffffff'; x.font = 'bold 50px Cairo, sans-serif'; x.direction = 'rtl';
  x.fillText((name || `لاعب ${seat}`).slice(0, 16), 300, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  // depthTest مقفول: الاسم بيبان حتى لو عربية تانية/عمود واقف قدامه (كان بيستخبى لما عربيتين جنب بعض)
  // حجم ثابت على الشاشة (مقروء من بعيد ومايكبرش أوي من قريب)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, opacity: 0.92, sizeAttenuation: false }));
  s.scale.set(0.12, 0.03, 1); // (كان كبير وبيحجب الرؤية)
  s.renderOrder = 5;
  return s;
}

export class Multiplayer {
  constructor(game) {
    this.game = game;
    this.room = null;
    this.available = false;
    this.remotes = new Map(); // peer → remote vehicle
    this.lobbyListeners = [];
    this.me = { seat: 0, name: '', kind: 'microbus' };
    this._t = 0;
  }

  async connect() {
    try {
      const use = window.claude?.use;
      this.room = use ? await use('room') : null;
    } catch { this.room = null; }
    // برا Claude (اللينك العام على GitHub Pages): اتصال مباشر بين الأجهزة. الأوضة: ?room=اسم (والافتراضي "shibin")
    // (محليًا/في الاختبارات مقفول إلا بـ ?p2p=1 — عشان الاختبارات ماتتصلش بسيرفرات برا)
    if (!this.room && !window.claude) {
      const q = new URLSearchParams(location.search);
      const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
      if (q.get('p2p') === '1' || (!local && q.get('p2p') !== '0')) {
        try {
          const { joinP2PRoom } = await import('./P2PRoom.js');
          const name = (q.get('room') || 'shibin').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff_-]/g, '').slice(0, 32) || 'shibin';
          this.room = await joinP2PRoom(name);
          this.roomName = name;
        } catch (e) { console.warn('[P2P]', e); this.room = null; }
      }
    }
    this.mode = this.room?.mode || (this.room ? 'claude' : null);
    this.available = !!this.room;
    if (!this.room) { this._emitLobby(); return; }
    this.room.onPeers(() => this._emitLobby(), () => { this.available = false; this._emitLobby(); });
    this.room.onConnection(() => this._emitLobby());
    this._emitLobby();
  }

  get connected() { return !!this.room && this.room.connected(); }

  /** اللاعبين التانيين (من غير التاب ده) */
  others() {
    if (!this.room) return [];
    return this.room.peers().filter((p) => !p.sameTab && p.kind === 'viewer' && p.presence && p.presence.seat);
  }

  /** الرقم ده محجوز لحد تاني؟ (لو اتنين اختاروا نفس الرقم: صاحب الـ peer الأصغر بياخده) */
  seatOwner(seat) {
    const mine = this.room?.peers().find((p) => p.sameTab);
    for (const p of this.others()) {
      if (p.presence.seat !== seat) continue;
      if (!mine || p.peer < mine.peer || !this.me.seat) return p;
    }
    return null;
  }

  onLobby(fn) { this.lobbyListeners.push(fn); }
  _emitLobby() { for (const fn of this.lobbyListeners) fn(this); }

  setMe(patch) {
    Object.assign(this.me, patch);
    this.room?.presence({ seat: this.me.seat || null, name: this.me.name || null, kind: this.me.kind, v: 1 }).catch(() => {});
    this._emitLobby();
  }

  /** كل فريم: ننشر مكاننا ونحدّث عربيات التانيين */
  update(dt) {
    const g = this.game;
    if (this.room && this.me.seat && g.started) {
      this._t -= dt;
      if (this._t <= 0) {
        this._t = 1 / SEND_HZ;
        const ph = g.player.physics;
        const r = (v, k = 100) => Math.round(v * k) / k;
        this.room.presence({
          p: [r(ph.x), r(ph.z), r(ph.yaw, 1000), r(ph.heave - ph.spec.cgHeight), r(ph.pitch, 1000), r(ph.roll, 1000), r(ph.steerAngle, 1000), r(ph.forwardSpeed)],
          br: ph.brake > 0.05 ? 1 : 0, fl: ph.flip.mode ? 1 : 0, kind: g.player.kind, map: g.mapId || 'current',
          pax: g.passengers?.count || 0, money: Math.round(g.passengers?.earnings || 0),
        }).catch(() => {});
      }
    }
    this._myLabel();
    // اسمك فوق عربيتك: مايبانش وإنت سايق (كان بيحجب الطريق) — بيبان في الكاميرا اللي من فوق/السينمائية بس
    // اسمك فوق عربيتك: بس في الكاميرا السينمائية/اللي من فوق (وانت سايق بيحجب الطريق)
    if (this._mine) this._mine.visible = !['cockpit', 'hood', 'chase', 'close'].includes(g.cams?.modeId);
    // عربيات اللاعبين التانيين
    const seen = new Set();
    const now = performance.now() / 1000;
    for (const p of this.others()) {
      const pr = p.presence;
      if (!Array.isArray(pr.p) || pr.p.length < 8) continue;
      if ((pr.map || 'current') !== (g.mapId || 'current')) continue; // لاعب على خريطة تانية
      seen.add(p.peer);
      let R = this.remotes.get(p.peer);
      const kind = SIZES[pr.kind] ? pr.kind : 'microbus';
      if (!R || R.kind !== kind) { if (R) this._drop(R); R = this._make(p.peer, kind, pr.seat, pr.name); this.remotes.set(p.peer, R); }
      if (R.seat !== pr.seat || R.name !== pr.name) this._relabel(R, pr.seat, pr.name);
      // كل رسالة جديدة = لقطة بوقتها؛ بنرسم عند (دلوقتي − 150 مللي) بين اللقطتين اللي حواليه
      if (p.updatedAt !== R.at) {
        R.at = p.updatedAt;
        const snap = { t: now, p: pr.p.slice() };
        const last = R.snaps[R.snaps.length - 1];
        if (last && Math.hypot(snap.p[0] - last.p[0], snap.p[1] - last.p[1]) > 40) R.snaps.length = 0; // اتنقل (reset): من غير ما يتسحب على الطريق
        R.snaps.push(snap); if (R.snaps.length > 12) R.snaps.shift();
      }
      const c = this._sample(R, now - DELAY);
      if (!c) continue;
      R.cur = c;
      this._pose(R, c, dt, pr);
    }
    for (const [peer, R] of this.remotes) if (!seen.has(peer)) { this._drop(R); this.remotes.delete(peer); }
  }

  /** الحالة عند وقت t: بين لقطتين (خطي، والاتجاه بأقصر لفة)، أو توقع بالسرعة لحد نص ثانية بعد آخر لقطة */
  _sample(R, t) {
    const S = R.snaps;
    if (!S.length) return null;
    let i = S.length - 1;
    while (i > 0 && S[i - 1].t > t) i--;
    const b = S[i], a = S[i - 1];
    const out = (R._out ||= new Array(8));
    if (a && a.t <= t && b.t >= t && b.t > a.t) {
      const u = (t - a.t) / (b.t - a.t);
      for (let k = 0; k < 8; k++) out[k] = a.p[k] + (b.p[k] - a.p[k]) * u;
      let dy = b.p[2] - a.p[2]; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); out[2] = a.p[2] + dy * u;
      out[6] = a.p[6] + (b.p[6] - a.p[6]) * u;
    } else {
      // أحدث من آخر لقطة (الرسايل اتأخرت): نكمل بنفس السرعة شوية
      const L = S[S.length - 1], e = Math.max(0, Math.min(0.5, t - L.t));
      for (let k = 0; k < 8; k++) out[k] = L.p[k];
      out[0] = L.p[0] - Math.sin(L.p[2]) * L.p[7] * e; out[1] = L.p[1] - Math.cos(L.p[2]) * L.p[7] * e;
    }
    return out;
  }

  /** اسمك ورقمك فوق عربيتك إنت كمان (بيبان في كاميرا بره وفي اللعب لوحدك) */
  _myLabel() {
    const g = this.game, root = g.player?.rig?.root;
    const name = (this.me.name || '').trim();
    const key = root && (name || this.me.seat) ? `${this.me.seat}|${name}|${g.player.kind}` : '';
    if (key === this._myKey && (!this._mine || this._mine.parent === root)) return;
    this._myKey = key;
    if (this._mine) { this._mine.removeFromParent(); this._mine.material.map.dispose(); this._mine.material.dispose(); this._mine = null; }
    if (!key) return;
    const l = labelSprite(this.me.seat || '•', name);
    l.position.y = LABEL_Y[g.player.kind] ?? 2.75;
    root.add(l);
    this._mine = l;
  }

  /** عربية لاعب تاني = نفس عربية اللاعب بالظبط (نفس الموديل والعجل اللي بيلف والمساعدين)، من غير أنوار حقيقية
   * ولا مرايات (نور زيادة في المشهد = كل الشيدرز بتتجهز من الأول = تهنيجة)، وبنسخة LOD لما تبعد */
  _make(peer, kind, seat, name) {
    const g = this.game;
    const P = new PlayerVehicle(g.scene, g.assets, { lowPower: true, kind });
    const rig = P.rig;
    const lights = []; rig.root.traverse((o) => { if (o.isLight) lights.push(o); });
    for (const l of lights) { l.target?.removeFromParent(); l.removeFromParent(); }
    for (const mc of P.mirrorCams || []) mc.rt.dispose();
    P.mirrorCams = [];
    g._applyLivery?.(P, g.settings?.get('livery'));
    if (rig.interiorGroup) rig.interiorGroup.visible = false;
    if (P.driver) P.driver.visible = true;
    const label = labelSprite(seat, name);
    g.scene.add(label); // في المشهد مش تحت العربية: العربية بتستخبى لما تبعد (LOD) والاسم لازم يفضل باين
    rig.root.updateMatrixWorld(true);
    const lod = makeLodMesh(rig.root);
    if (lod) g.scene.add(lod);
    return { peer, kind, seat, name, P, rig, label, lod, cur: null, snaps: [], at: 0 };
  }

  _relabel(R, seat, name) {
    R.seat = seat; R.name = name;
    R.label.removeFromParent(); R.label.material.map.dispose(); R.label.material.dispose();
    R.label = labelSprite(seat, name); this.game.scene.add(R.label);
  }

  _pose(R, c, dt, pr) {
    const P = R.P, ph = P.physics;
    const [x, z, yaw, y, pitch, roll, steer, v] = c;
    ph.x = x; ph.z = z; ph.yaw = yaw; ph.heave = y + ph.spec.cgHeight;
    ph.pitch = pitch; ph.roll = pr.fl ? roll : roll * 0.8; ph.steerAngle = steer; ph.forwardSpeed = v;
    const gy = groundHeight(x, z);
    for (const w of ph.wheels) { w.spin = (w.spin || 0) + (v / ph.spec.wheelRadius) * dt; w.ground = gy; }
    ph.brake = pr.br ? 1 : 0;
    P._savePrev();
    // قريب: العربية كاملة (والصالون من 12م بس) — بعيد: نسخة LOD واحدة
    const cam = this.game.camera.position;
    const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2;
    const far = R.lod && d2 > 45 * 45;
    R.rig.root.visible = !far;
    if (R.lod) { R.lod.visible = far; if (far) { R.lod.position.set(x, gy, z); R.lod.rotation.set(0, yaw, 0); } }
    if (!far) {
      P.syncVisuals(dt, 1);
      if (R.rig.interiorGroup) R.rig.interiorGroup.visible = d2 < 12 * 12;
      if (P.rig.lights?.tail) P.rig.lights.tail.emissiveIntensity = pr.br ? 3.5 : 0.4;
    }
    // الاسم يبان من 2م لحد 600م (كان بيستخبى لما العربية تبعد وتتحول لنسخة LOD)
    R.label.position.set(x, y + LABEL_Y[R.kind], z);
    // قريب أوي (أقل من 8م) بيختفي عشان مايغطيش على العربية والطريق
    R.label.visible = d2 > 8 * 8 && d2 < 600 * 600;
  }

  _drop(R) {
    R.rig.root.removeFromParent();
    R.label.removeFromParent();
    if (R.lod) R.lod.removeFromParent();
  }

  /** صناديق تصادم عربيات اللاعبين التانيين (للفيزياء) */
  colliders(box, out) {
    for (const R of this.remotes.values()) {
      if (!R.cur) continue;
      const [x, z, yaw, , , , , v] = R.cur;
      if (Math.abs(x - box.cx) > 8 || Math.abs(z - box.cz) > 8) continue;
      const [hx, hz] = SIZES[R.kind];
      // صندوق ثابت لكل لاعب بيتحدّث مكانه (مفيش objects جديدة كل خطوة فيزيا)
      const col = (R.col ||= { hx, hz, mass: R.kind === 'tuktuk' ? 450 : R.kind === 'taxi' ? 1200 : 2300, restitution: 0.2, kind: 'car' });
      col.cx = x; col.cz = z; col.angle = yaw; col.vx = -Math.sin(yaw) * v; col.vz = -Math.cos(yaw) * v;
      out.push(col);
    }
  }

  /** للخريطة */
  positions() {
    const out = [];
    for (const R of this.remotes.values()) if (R.cur) { const [hw, hl] = SIZES[R.kind]; out.push({ x: R.cur[0], z: R.cur[1], y: R.cur[3], yaw: R.cur[2], v: R.cur[7], seat: R.seat, name: R.name, kind: R.kind, hw, hl, color: seatColor(R.seat) }); }
    return out;
  }
}

