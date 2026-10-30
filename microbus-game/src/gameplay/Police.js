// =====================================================================
//  كماين المرور: كمينين على الطرق (شارع باريس وطريق الترعة). الكمين مش دايمًا شغال: لما تقرب بيتقرر
//  (نسبة)، ولو اتفتشت فيه بيقفل فترة. الظابط بيشاور تقف → بيفتش على رخصة القيادة ورخصة العربية:
//  سليمة → "اتفضل". منتهية → "اركن على جنب" في مكان محدد → غرامة بتتخصم من المحفظة.
//  لو مقفتش: غرامة هروب. عربية شرطة بكشاف أحمر/أزرق بيلمع (خامة واحدة مشتركة) + أقماع + ظابط.
// =====================================================================
import * as THREE from 'three';
import { buildSedan } from '../vehicles/SedanModel.js';
import { buildPoliceBox } from '../vehicles/PoliceBox.js';
import { groundHeight } from '../world/ground.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex } from '../render/textures.js';
import { LICENSE } from './Licenses.js';

const FINE = { driver: 500, vehicle: 400, flee: 1000 };
const CHANCE = 0.75;        // احتمال إن الكمين يبقى شغال لما تقرب
const COOL = 8 * 60;       // بعد التفتيش: الكمين ده بيرتاح 8 دقايق
const M4 = (x = 0, y = 0, z = 0, ry = 0) => new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);

function signTexture() {
  const c = canvas(256, 192), x = c.getContext('2d');
  x.fillStyle = '#c81414'; x.fillRect(0, 0, 256, 192);
  x.strokeStyle = '#fff'; x.lineWidth = 10; x.strokeRect(8, 8, 240, 176);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.font = 'bold 78px Cairo, sans-serif'; x.fillText('قف', 128, 72);
  x.font = 'bold 34px Cairo, sans-serif'; x.fillText('كمين مرور', 128, 146);
  return tex(c, { repeat: false });
}

/** حاجز مرور: لوح مخطط أحمر وأبيض على رجلين (A) */
function barrierTexture() {
  const c = canvas(256, 64), x = c.getContext('2d');
  x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#d81a1a';
  for (let i = -2; i < 10; i++) { x.beginPath(); x.moveTo(i * 32, 64); x.lineTo(i * 32 + 16, 64); x.lineTo(i * 32 + 48, 0); x.lineTo(i * 32 + 32, 0); x.closePath(); x.fill(); }
  x.strokeStyle = '#222'; x.lineWidth = 4; x.strokeRect(2, 2, 252, 60);
  return tex(c, { repeat: false });
}

/** ظابط مرور: بدلة بيضا وكاب، وإيده اليمين بتتحرك (إشارة قف) */
function officer() {
  const root = new THREE.Group();
  const g = new GeoBuilder();
  const M = (x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
  g.setColor([0.1, 0.1, 0.12]);
  for (const sx of [-1, 1]) g.addGeometry(new THREE.CylinderGeometry(0.075, 0.065, 0.86, 8), M(sx * 0.1, 0.45, 0));
  g.setColor([0.06, 0.06, 0.06]);
  for (const sx of [-1, 1]) g.addGeometry(new THREE.BoxGeometry(0.11, 0.07, 0.24), M(sx * 0.1, 0.035, 0.03));
  g.setColor([0.95, 0.95, 0.93]);
  g.addGeometry(new THREE.CylinderGeometry(0.19, 0.16, 0.62, 10), M(0, 1.18, 0, 1, 1, 0.7));
  g.setColor([0.12, 0.12, 0.14]); g.addGeometry(new THREE.CylinderGeometry(0.165, 0.165, 0.06, 10), M(0, 0.9, 0, 1, 1, 0.72)); // حزام
  g.setColor([0.95, 0.95, 0.93]);
  g.addGeometry(new THREE.CylinderGeometry(0.05, 0.045, 0.56, 6), M(-0.24, 1.18, 0));
  g.setColor([0.62, 0.43, 0.3]);
  g.addGeometry(new THREE.SphereGeometry(0.105, 10, 8), M(0, 1.64, 0, 0.92, 1.08, 1));
  g.addGeometry(new THREE.SphereGeometry(0.045, 6, 5), M(-0.24, 0.87, 0));
  g.setColor([0.95, 0.95, 0.95]); g.addGeometry(new THREE.CylinderGeometry(0.115, 0.12, 0.09, 12), M(0, 1.76, 0));
  g.setColor([0.05, 0.05, 0.05]); g.addGeometry(new THREE.BoxGeometry(0.2, 0.015, 0.1), M(0, 1.72, 0.12));
  const body = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
  body.castShadow = true;
  root.add(body);
  // الدراع اليمين (بيترفع ويشاور)
  const arm = new THREE.Group(); arm.position.set(0.24, 1.44, 0);
  const a = new GeoBuilder();
  a.setColor([0.95, 0.95, 0.93]); a.addGeometry(new THREE.CylinderGeometry(0.05, 0.045, 0.56, 6), M(0, -0.28, 0));
  a.setColor([0.62, 0.43, 0.3]); a.addGeometry(new THREE.BoxGeometry(0.09, 0.12, 0.03), M(0, -0.6, 0));
  a.setColor([0.95, 0.95, 0.95]); a.addGeometry(new THREE.BoxGeometry(0.1, 0.05, 0.05), M(0, -0.57, 0)); // جوانتي أبيض
  arm.add(new THREE.Mesh(a.build(), body.material));
  root.add(arm);
  root.userData.arm = arm;
  return root;
}

export class Police {
  /** spots: أماكن الكماين. كل واحد {name, q:{x,z,dx,dz,rx,rz,half}} */
  constructor(scene, { hud, wallet, licenses, spots = [], assets = null } = {}) {
    this.hud = hud; this.wallet = wallet; this.licenses = licenses;
    this.cps = [];
    const signMat = new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.6 });
    const coneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    for (const def of spots) {
      const q = def.q;
      const road = q.half || 4;
      const root = new THREE.Group(); root.name = def.name; root.visible = false;
      const y0 = groundHeight(q.x, q.z);
      const at = (along, side) => [q.x + q.dx * along + q.rx * side, q.z + q.dz * along + q.rz * side];
      const yaw = Math.atan2(q.dx, q.dz);
      // عربية الشرطة راكنة على الجنب (مايلة شوية): كمين ورا كمين "بوكس" (بيك أب الشرطة) لو موديله موجود
      const car = (this.cps.length % 2 === 1 && buildPoliceBox(assets)) || buildSedan({ livery: 'police', lod: 1, seeThrough: false });
      const [cx, cz] = at(-9, road + 1.6);
      car.root.position.set(cx, groundHeight(cx, cz), cz);
      car.root.rotation.y = yaw + Math.PI + 0.25;
      root.add(car.root);
      // أقماع: بتضيّق الطريق من الناحيتين قدام الظابط
      const cg = new GeoBuilder();
      const cone = (x, z) => {
        const y = groundHeight(x, z);
        cg.setColor([1, 0.42, 0.05]); cg.addGeometry(new THREE.ConeGeometry(0.17, 0.62, 10), M4(x, y + 0.31, z));
        cg.setColor([0.95, 0.95, 0.95]); cg.addGeometry(new THREE.CylinderGeometry(0.105, 0.125, 0.09, 10), M4(x, y + 0.36, z));
        cg.setColor([0.08, 0.08, 0.08]); cg.addGeometry(new THREE.BoxGeometry(0.4, 0.04, 0.4), M4(x, y + 0.02, z));
      };
      for (const along of [-18, -14, 14, 18]) for (const side of [-1, 1]) { const [x, z] = at(along, side * (road - 0.4)); cone(x, z); }
      root.add(new THREE.Mesh(cg.build(), coneMat));
      // حواجز مخططة: بتضيّق الطريق لحارة واحدة في النص قدام الظابط (لازم تهدّي)، ومتلاغية مع بعض (زقزاق)
      const colliders = [];
      {
        const bg = new GeoBuilder(), plank = new GeoBuilder();
        const B = (along, side, len) => {
          const off = side * (road - len / 2 - 0.15);
          const [x, z] = at(along, off), y = groundHeight(x, z);
          const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z); // بالعرض (بيقفل جزء من الحارة)
          plank.addGeometry(new THREE.BoxGeometry(len, 0.32, 0.05).translate(0, 0.78, 0), m);
          plank.addGeometry(new THREE.BoxGeometry(len, 0.2, 0.05).translate(0, 0.36, 0), m);
          bg.setColor([0.15, 0.15, 0.16]);
          for (const e of [-1, 1]) {
            bg.addGeometry(new THREE.BoxGeometry(0.05, 0.98, 0.05).translate(e * (len / 2 - 0.08), 0.49, 0), m);
            bg.addGeometry(new THREE.BoxGeometry(0.08, 0.04, 0.5).translate(e * (len / 2 - 0.08), 0.02, 0), m);
          }
          colliders.push({ cx: x, cz: z, hx: len / 2, hz: 0.35, angle: yaw, restitution: 0.2, kind: 'prop' });
        };
        // (الشوارع اللي فيها جزيرة في النص: الحواجز على الجناب بس عشان العربية تعدي)
        const blvd = false;
        // الحواجز على الأطراف بس: الحارات نفسها فاضية (العربيات بتعدي من غير ما تخش فيها)
        const L = blvd ? 1.1 : Math.max(0.6, road - 3.2);
        for (const along of [-10, -6]) B(along, -1, L);
        for (const along of [6, 10]) B(along, 1, L);
        const pm = new THREE.MeshStandardMaterial({ map: barrierTexture(), roughness: 0.5 });
        const pmesh = new THREE.Mesh(plank.build(), pm); pmesh.castShadow = true; root.add(pmesh);
        const bmesh = new THREE.Mesh(bg.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })); root.add(bmesh);
      }
      // يافطة "قف كمين" على حامل
      const [sx, sz] = at(-15, road + 0.6);
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), signMat);
      sg.position.set(sx, groundHeight(sx, sz) + 1.4, sz); sg.rotation.y = yaw + Math.PI;
      root.add(sg);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      post.position.set(sx, groundHeight(sx, sz) + 0.5, sz); root.add(post);
      // الظابط في نص الطريق عند الكمين
      // الظابط واقف على حرف الطريق (مش في نصه — العربيات كانت بتعدي من جواه)
      const off = officer();
      { const [ox, oz] = at(-2, road + 0.6); off.position.set(ox, groundHeight(ox, oz), oz); }
      root.add(off);
      const home = off.position.clone();
      // عسكري تاني واقف جنب عربية الشرطة (حراسة) — بيبص على العربيات اللي جاية
      const guard = officer();
      { const [gx, gz] = at(-12, road + 1.0); guard.position.set(gx, groundHeight(gx, gz), gz); guard.rotation.y = yaw + Math.PI; }
      root.add(guard);
      scene.add(root);
      this.cps.push({ def, q: { x: q.x, z: q.z, dx: q.dx, dz: q.dz, rx: q.rx, rz: q.rz, half: road }, root, car, off, home, guard, colliders, state: 'idle', cool: 0, rolled: false, t: 0 });
    }
    // مكان "اركن على جنب": علامة حمرا/زرقا على الأرض
    const mk = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }));
    mk.visible = false; mk.renderOrder = 2;
    scene.add(mk);
    this.marker = mk;
    this.active = null;
    this._flash = 0;
  }

  /** الحواجز جسم حقيقي (لما الكمين ظاهر بس) */
  colliders(box, out) {
    for (const c of this.cps) {
      if (!c.root.visible || Math.abs(c.q.x - box.cx) > 30 || Math.abs(c.q.z - box.cz) > 30) continue;
      for (const b of c.colliders) out.push(b);
    }
  }

  /** بيرجّع هدف للـ GPS لو لازم تركن على جنب */
  navTarget() { return this.active?.state === 'pullover' ? { x: this.active.park.x, z: this.active.park.z, name: 'اركن على جنب' } : null; }
  get busy() { return !!this.active && this.active.state !== 'idle'; }

  update(dt, ph, kind, t) {
    for (const c of this.cps) {
      c.cool = Math.max(0, c.cool - dt);
      const dx = ph.x - c.q.x, dz = ph.z - c.q.z, d = Math.hypot(dx, dz);
      // التفعيل: لما تقرب (مرة لكل قربة)، ولو مش شغال يتخفي ومايترسمش خالص
      if (c.state === 'idle') {
        if (d < 170 && !c.rolled && c.cool <= 0) { c.rolled = true; c.on = Math.random() < CHANCE; c.root.visible = c.on; }
        if (d > 230) { c.rolled = false; if (!this.active || this.active !== c) c.root.visible = false; }
      }
      if (c.state === 'done' && d > 120) c.state = 'idle';
      if (!c.root.visible) continue;
      // الظابط بيشاور لما تقرب
      const arm = c.off.userData.arm;
      const signal = c.on && (c.state === 'idle' || c.state === 'signal') && d < 90;
      arm.rotation.x += ((signal ? -2.6 + Math.sin(t * 6) * 0.25 : 0) - arm.rotation.x) * Math.min(1, dt * 6);
      // التفتيش: بيمشي لحد شباك السواق (الشمال — مصر) وبيرجع مكانه بعد ما يخلص
      const [fx0, fz0] = ph.forward;
      // (يمين العربية = (−fz, fx) → الشمال = (fz, −fx))
      const sw = ph.spec.halfWidth + 0.7, sf = ph.spec.halfLength * 0.35;
      const win = c.state === 'check' ? { x: ph.x + fz0 * sw + fx0 * sf, z: ph.z - fx0 * sw + fz0 * sf } : null;
      const tgt = win || (c.state === 'pullover' || c.state === 'fine' ? null : { x: c.home.x, z: c.home.z });
      if (tgt) {
        const o = c.off.position, wx = tgt.x - o.x, wz = tgt.z - o.z, wd = Math.hypot(wx, wz);
        c.offArrived = wd < 0.25;
        if (!c.offArrived) { const st = Math.min(wd, 1.5 * dt); o.x += wx / wd * st; o.z += wz / wd * st; o.y = groundHeight(o.x, o.z) + Math.abs(Math.sin(t * 9)) * 0.03; c.off.rotation.y = Math.atan2(wx, wz); }
        else c.off.rotation.y = win ? Math.atan2(ph.x - o.x, ph.z - o.z) : Math.atan2(dx, dz);
      } else c.off.rotation.y = Math.atan2(dx, dz);
      if (c.guard) c.guard.rotation.y = Math.atan2(ph.x - c.guard.position.x, ph.z - c.guard.position.z);
      if (!c.on || c.cool > 0) continue;
      const along = dx * c.q.dx + dz * c.q.dz, lat = dx * c.q.rx + dz * c.q.rz;
      const onRoad = Math.abs(lat) < c.q.half + 2;
      if (c.state === 'idle' && d < 85 && onRoad && kind !== 'police') { // (البوكس بتاعك مابيتوقفش في الكمين)
        // داخل على الكمين؟ (رايح ناحيته)
        const toward = -(ph.forward[0] * dx + ph.forward[1] * dz) / Math.max(1, d) > 0.5;
        if (toward) { c.state = 'signal'; c.dir = Math.sign(along) || 1; c.stopT = 0; this.active = c; this.hud?.toast('🚓 كمين! هدّي واقف عند الظابط', 3); }
      }
      if (c.state === 'signal') {
        const inZone = Math.abs(along) < 16 && onRoad;
        if (inZone && ph.speed < 0.7) { c.stopT += dt; if (c.stopT > 0.6) { c.state = 'check'; c.t = 1.6; c.offArrived = false; this.hud?.toast('👮 الظابط جاي ناحيتك — استنى', 2); } }
        // عدّى الظابط من غير ما يقف
        if (Math.sign(along) === -c.dir && Math.abs(along) > 8 && ph.speed > 3) this._flee(c);
        else if (d > 140) { c.state = 'idle'; this.active = null; }
      } else if (c.state === 'check') {
        if (ph.speed > 2.5) { this._flee(c); continue; }
        if (!c.offArrived) continue; // لسه ماشي ناحية الشباك
        if (!c.asked) { c.asked = true; this.hud?.toast('👮 رخصك يا أسطى؟', 2); }
        c.t -= dt;
        if (c.t <= 0) {
          const probs = this.licenses ? this.licenses.problems(kind) : [];
          if (!probs.length) { this.hud?.toast('✅ اتفضل يا أسطى — الرخص سليمة', 2.6); this._done(c); }
          else {
            c.probs = probs;
            // مكان الركنة: على يمينك بعد الكمين بـ 24م
            const sgn = -c.dir, lane = c.q.half + 1.3;
            const fx = c.q.dx * sgn, fz = c.q.dz * sgn, rx = -fz, rz = fx;
            c.park = { x: c.q.x + fx * 24 + rx * lane, z: c.q.z + fz * 24 + rz * lane, ax: fx, az: fz };
            this.marker.position.set(c.park.x, groundHeight(c.park.x, c.park.z) + 0.04, c.park.z);
            this.marker.rotation.y = Math.atan2(fx, fz);
            this.marker.visible = true;
            c.state = 'pullover'; c.t = 60;
            this.hud?.toast(`🚨 اركن على جنب! (${probs.map((k) => LICENSE[k === 'driver' ? 'driver' : kind].name + ' منتهية').join(' + ')})`, 4);
          }
        }
      } else if (c.state === 'pullover') {
        c.t -= dt;
        const pd = Math.hypot(ph.x - c.park.x, ph.z - c.park.z);
        if (pd < 3.2 && ph.speed < 0.6) { c.state = 'fine'; this._fine(c, kind); }
        else if (c.t <= 0 || pd > 160) this._flee(c);
      }
    }
    // كشاف الشرطة: النصين (أزرق) بالتبادل (خامة مشتركة لكل عربيات الشرطة)
    this._flash += dt;
    const lb = this.cps[0]?.car.lightbar;
    if (lb) {
      const ph2 = Math.floor(this._flash * 6) % 4;
      lb.children[1].material.emissiveIntensity = ph2 < 2 ? (ph2 === 0 ? 3 : 0.3) : 0.15;
      lb.children[2].material.emissiveIntensity = ph2 >= 2 ? (ph2 === 2 ? 3 : 0.3) : 0.15;
    }
  }

  _fine(c, kind) {
    const rows = c.probs.map((k) => [k === 'driver' ? 'رخصة القيادة منتهية' : `${LICENSE[kind]?.name || 'رخصة العربية'} منتهية`, `${k === 'driver' ? FINE.driver : FINE.vehicle} ج`]);
    const total = rows.reduce((s, r) => s + parseInt(r[1], 10), 0);
    const pay = () => {
      this.wallet?.add(-total, 'fine', `غرامة كمين: ${rows.map((r) => r[0]).join(' + ')}`);
      this.hud?.toast('👮 اتفضل — وجدّد الرخصة في أقرب وقت (🪪)', 3.5);
      this._done(c);
    };
    this.hud?.showCard({ title: `🚓 ${c.def.name} — مخالفة`, rows: [...rows, ['الغرامة', `${total} ج`, 'pc-c']], note: 'الغرامة بتتخصم من المحفظة', tone: 'police danger', timeout: 12, def: pay, buttons: [{ label: 'ادفع الغرامة', onClick: pay }] });
  }

  _flee(c) {
    // عربية الكمين نفسها بتطلع وراك على الطرق (مش بتظهر جنبك) — ولو المطاردة مش متاحة: غرامة بالكاميرا
    const p = new THREE.Vector3(); c.car.root.getWorldPosition(p);
    if (this.onFlee?.(c, p.x, p.z)) { c.car.root.visible = false; c.chased = true; this.hud?.toast(`🚨 هربت من ${c.def.name} — عربية الشرطة طالعة وراك!`, 3.5); }
    else {
      this.wallet?.add(-FINE.flee, 'fine', `هروب من ${c.def.name}`);
      this.hud?.toast(`📸 هروب من الكمين — غرامة ${FINE.flee} ج اتخصمت`, 4);
    }
    this._done(c);
  }

  /** المطاردة خلصت: عربية الكمين ترجع مكانها (لما تبقى بعيد عنها) */
  chaseOver() { for (const c of this.cps) if (c.chased) { c.chased = false; c.car.root.visible = true; } }

  /** للمرور: كمين شغال قدامه → العربيات بتهدّي (سرعة قصوى قريب منه) */
  get slowZones() { return this.cps.filter((c) => c.root.visible && c.on && c.state !== 'done').map((c) => ({ x: c.q.x, z: c.q.z, r: 30, v: 3.5 })); }

  _done(c) {
    c.state = 'done'; c.cool = COOL; c.on = false; c.asked = false;
    this.marker.visible = false;
    if (this.active === c) this.active = null;
    // بيفضل ظاهر لحد ما تبعد (120م) وبعدين بيرجع idle ويستخبى لما تبعد أكتر
  }
}
