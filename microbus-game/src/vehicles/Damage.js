import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { canvas, tex, rng } from '../render/textures.js';

// ضرر خفيف ومتدرج: خدوش (decals) ← بعجات في الصاج (تحريك نقط الموديل) ← فوانيس مكسورة ←
// إكصدام متدلدل ← شرخ في الزجاج الأمامي. بيتجمع مع الخبطات، والـ Reset بيصلّح كله.

const MAX_DECALS = 14;

function scratchTex() {
  const c = canvas(256, 256), x = c.getContext('2d'), r = rng(9);
  x.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const a = -0.3 + r() * 0.6, l = 30 + r() * 140, x0 = 30 + r() * 196, y0 = 30 + r() * 196;
    x.strokeStyle = `rgba(${r() < 0.6 ? '230,230,225' : '70,62,55'},${0.35 + r() * 0.5})`;
    x.lineWidth = 0.6 + r() * 1.8;
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + Math.cos(a) * l, y0 + Math.sin(a) * l); x.stroke();
  }
  const g = x.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  return tex(c, { repeat: false });
}

function crackTex(seed) {
  const c = canvas(512, 512), x = c.getContext('2d'), r = rng(seed);
  x.clearRect(0, 0, 512, 512);
  x.strokeStyle = 'rgba(235,240,245,0.85)';
  const cx = 256, cy = 256;
  // شعاعي من نقطة الخبطة + دواير متكسرة
  for (let i = 0; i < 18; i++) {
    let a = (i / 18) * Math.PI * 2 + r() * 0.3, px = cx, py = cy;
    x.lineWidth = 1.2 + r();
    x.beginPath(); x.moveTo(px, py);
    const L = 120 + r() * 130;
    for (let d = 0; d < L; d += 14) { a += (r() - 0.5) * 0.35; px += Math.cos(a) * 14; py += Math.sin(a) * 14; x.lineTo(px, py); }
    x.stroke();
  }
  for (const rad of [30, 62, 100]) {
    x.lineWidth = 0.9; x.beginPath();
    for (let a = 0; a < Math.PI * 2; a += 0.35 + r() * 0.3) { const rr = rad + (r() - 0.5) * 10; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    x.closePath(); x.stroke();
  }
  x.fillStyle = 'rgba(255,255,255,0.5)'; x.beginPath(); x.arc(cx, cy, 9, 0, Math.PI * 2); x.fill();
  return tex(c, { repeat: false });
}

function shardsTex() {
  const c = canvas(128, 128), x = c.getContext('2d'), r = rng(5);
  x.fillStyle = 'rgba(20,20,22,0.85)'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(200,210,220,0.7)';
  for (let i = 0; i < 14; i++) { x.beginPath(); x.moveTo(64, 64); x.lineTo(r() * 128, r() * 128); x.stroke(); }
  return tex(c, { repeat: false });
}

export class Damage {
  constructor(player) {
    this.player = player;
    const rig = (this.rig = player.rig);
    this.shell = rig.shell;
    this.level = { front: 0, rear: 0, left: 0, right: 0, roof: 0 };
    this.broken = { headL: false, headR: false, tailL: false, tailR: false };
    this.crack = 0;
    this.decals = [];
    this.mats = {
      scratch: new THREE.MeshStandardMaterial({ map: scratchTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.6 }),
      shards: new THREE.MeshStandardMaterial({ map: shardsTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, roughness: 0.2 }),
    };
    this.crackMats = [crackTex(11), crackTex(23)].map((t) => new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    // تسخين: نرسم كل خامات الخبط من الأول بحاجة صغيرة جدًا مستخبية جوه العربية،
    // عشان الـ shader بتاعها يتبني وقت التحميل مش في نص أول خبطة (كان بيعمل تهنيج)
    for (const m of [this.mats.scratch, this.mats.shards, ...this.crackMats]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), m);
      w.position.set(0, 0.9, 0); w.frustumCulled = false; w.renderOrder = 3;
      rig.shell.add(w);
    }
    // الصاج اللي بيتبعج: كل حاجة برا ماعدا الزجاج والفوانيس والعجل والصالون
    this.meshes = [];
    rig.shell.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(rig.shell.matrixWorld).invert();
    rig.shell.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      if (rig.interiorGroup && isInside(o, rig.interiorGroup)) return;
      const role = o.userData.role || '', mat = (o.userData.matName || '').toLowerCase();
      if (/glass|windshield|tire|mirror/.test(role) || /glass|lights|wheel|logo/.test(mat) || !mat) return;
      const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const P = o.geometry.attributes.position;
      const shellPos = new Float32Array(P.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(rel); shellPos.set([v.x, v.y, v.z], i * 3); }
      this.meshes.push({ mesh: o, rel, invRel3: new THREE.Matrix3().setFromMatrix4(rel).invert(), orig: P.array.slice(), origN: o.geometry.attributes.normal?.array.slice(), shellPos, origShell: shellPos.slice() });
    });
    this.paint = [];
    this.windshield = null;
    this.lightsMeshes = [];
    rig.shell.traverse((o) => {
      if (!o.isMesh) return;
      const mat = (o.userData.matName || '').toLowerCase();
      if (mat === 'paint') this.paint.push(o);
      if (o.userData.role === 'windshield') this.windshield = o;
      if (mat === 'lights') this.lightsMeshes.push(o);
    });
    for (const b of Object.values(rig.bumpers || {})) b.group.userData.base = b.group.position.clone();
  }

  /** نقطة الخبطة (عالم) واتجاهها (من العربية للحاجة اللي خبطتها)، والشدة م/ث */
  impact(wx, wy, wz, nx, nz, speed) {
    if (speed < 2.2) return;
    const p = this.shell.worldToLocal(new THREE.Vector3(wx, wy, wz));
    const q = this.shell.getWorldQuaternion(new THREE.Quaternion()).invert();
    const n = new THREE.Vector3(nx, 0, nz).applyQuaternion(q).normalize(); // لبره (ناحية الحاجة)
    // نقربها لسطح الجسم في اتجاه الخبطة
    const D = this.rig.dims;
    if (D) { p.x = THREE.MathUtils.clamp(p.x, -D.HW, D.HW); p.z = THREE.MathUtils.clamp(p.z, -D.frontF, -D.rearF); }
    p.y = THREE.MathUtils.clamp(p.y, 0.35, 1.3);
    this._apply(p, n, speed);
  }

  /** خبطة في الانقلاب: corner 0/1 تحت، 2/3 فوق (يمين/شمال) */
  rollHit(strength, corner) {
    const D = this.rig.dims; if (!D) return;
    const side = corner === 1 || corner === 2 ? 1 : -1;
    const top = corner >= 2;
    const y = top ? D.roofY - 0.05 : 0.6;
    for (const f of [0.75, 0, -0.75]) {
      const z = THREE.MathUtils.lerp(-D.frontF, -D.rearF, 0.5 + f * 0.45);
      const p = new THREE.Vector3(side * D.HW, y, z);
      const n = new THREE.Vector3(side * (top ? 0.6 : 1), top ? 0.8 : 0, 0).normalize();
      this._apply(p, n, 3 + strength * 2.2, 'roll');
    }
    if (top) { this.crack = Math.min(2, this.crack + 1); this._updateCrack(); }
  }

  _apply(p, n, speed, kind = 'hit') {
    const D = this.rig.dims;
    // المنطقة
    const zone = D && p.z < -D.frontF + 0.6 ? 'front' : D && p.z > -D.rearF - 0.6 ? 'rear' : p.y > 1.7 ? 'roof' : p.x > 0 ? 'right' : 'left';
    this.level[zone] = Math.min(1, this.level[zone] + speed / 30);
    // 1) خدوش
    if (speed >= 2.2) this._decal(p, n, 0.45 + Math.min(0.7, speed * 0.05), this.mats.scratch);
    // 2) بعجة
    if (speed >= 4.2) this._dent(p, n, Math.min(0.13, 0.012 + (speed - 4) * 0.014), 0.32 + Math.min(0.45, speed * 0.025));
    // 3) فوانيس
    if (speed >= 6) {
      if (zone === 'front') this._breakLight(p.x < 0 ? 'headL' : 'headR', p);
      if (zone === 'rear') this._breakLight(p.x < 0 ? 'tailL' : 'tailR', p);
    }
    // 4) إكصدام متدلدل
    if (speed >= 9.5 && (zone === 'front' || zone === 'rear')) this._hangBumper(zone, p.x);
    // 5) شرخ في الزجاج الأمامي
    if (zone === 'front' && speed >= 8.5 && kind === 'hit') { if (!this.crack) this.onBreak?.(); this.crack = Math.min(2, this.crack + (speed > 14 ? 2 : 1)); this._updateCrack(); }
  }

  _decal(p, n, size, mat) {
    const targets = this.paint.length ? this.paint : this.meshes.map((m) => m.mesh);
    const world = this.shell.localToWorld(p.clone());
    const wn = n.clone().applyQuaternion(this.shell.getWorldQuaternion(new THREE.Quaternion()));
    const orient = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), wn.clone().negate(), new THREE.Vector3(0, 1, 0)));
    orient.z = Math.random() * Math.PI * 2;
    const inv = new THREE.Matrix4().copy(this.shell.matrixWorld).invert();
    const reach = new THREE.Sphere(world, size * 0.75);
    for (const t of targets) {
      t.updateMatrixWorld(true);
      // بس القطع اللي جنب مكان الخبطة (الإسقاط على كل جسم العربية كان بيقطّع اللعبة)
      if (!t.geometry.boundingBox) t.geometry.computeBoundingBox();
      if (!_box.copy(t.geometry.boundingBox).applyMatrix4(t.matrixWorld).intersectsSphere(reach)) continue;
      let g;
      try { g = new DecalGeometry(t, world, orient, new THREE.Vector3(size, size, 0.7)); } catch { continue; }
      if (!g.attributes.position.count) { g.dispose(); continue; }
      g.applyMatrix4(inv);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 3;
      this.shell.add(m);
      this.decals.push(m);
      if (this.decals.length > MAX_DECALS) { const old = this.decals.shift(); old.removeFromParent(); old.geometry.dispose(); }
    }
  }

  _dent(p, n, depth, radius) {
    const r2 = radius * radius, d = new THREE.Vector3();
    for (const m of this.meshes) {
      const S = m.shellPos, P = m.mesh.geometry.attributes.position;
      if (!m.shellBox) { m.shellBox = new THREE.Box3(); for (let i = 0; i < S.length; i += 3) m.shellBox.expandByPoint(d.set(S[i], S[i + 1], S[i + 2])); m.shellBox.expandByScalar(0.2); }
      if (!m.shellBox.intersectsSphere(_sph.set(p, radius))) continue;
      let touched = false;
      for (let i = 0; i < P.count; i++) {
        const dx = S[i * 3] - p.x, dy = S[i * 3 + 1] - p.y, dz = S[i * 3 + 2] - p.z;
        const q = dx * dx + dy * dy + dz * dz;
        if (q > r2) continue;
        const f = (1 - Math.sqrt(q) / radius) ** 2 * depth * (0.75 + 0.25 * Math.sin(i * 12.9898));
        // لجوه (عكس اتجاه الخبطة)
        S[i * 3] -= n.x * f; S[i * 3 + 1] -= n.y * f; S[i * 3 + 2] -= n.z * f;
        d.set(-n.x * f, -n.y * f, -n.z * f).applyMatrix3(m.invRel3);
        P.setXYZ(i, P.getX(i) + d.x, P.getY(i) + d.y, P.getZ(i) + d.z);
        touched = true;
      }
      if (touched) {
        P.needsUpdate = true;
        m.mesh.geometry.computeVertexNormals();
        m.mesh.geometry.computeBoundingSphere();
        m.dented = true;
      }
    }
  }

  _breakLight(key, p) {
    if (this.broken[key]) return;
    this.broken[key] = true;
    this.onBreak?.();
    if (key.startsWith('head')) {
      const i = key === 'headL' ? 0 : 1;
      const l = this.player.headlights?.[i];
      // شدة 0 بس (من غير visible=false): تغيير عدد الأنوار في المشهد بيعيد بناء كل الـ shaders = اللعبة بتهنّج ثواني
      if (l) { l.userData.broken = true; l.intensity = 0; }
      const D = this.rig.dims;
      if (D) this._decal(new THREE.Vector3(key === 'headL' ? -D.HW + 0.22 : D.HW - 0.22, 0.85, -D.frontF + 0.05), new THREE.Vector3(0, 0, -1), 0.32, this.mats.shards);
    } else {
      const tp = this.rig.tailPlanes?.[key === 'tailL' ? -1 : 1];
      if (tp) tp.visible = false;
      const D = this.rig.dims;
      if (D) this._decal(new THREE.Vector3(key === 'tailL' ? -D.HW + 0.07 : D.HW - 0.07, 0.82, -D.rearF - 0.03), new THREE.Vector3(0, 0, 1), 0.3, this.mats.shards);
    }
  }

  _hangBumper(zone, x) {
    const b = this.rig.bumpers?.[zone];
    if (!b || b.hanging) return;
    b.hanging = true;
    // جنب بيقع (الناحية اللي اتخبطت) وبيلف حوالين الجنب التاني
    const g = b.group, D = this.rig.dims;
    const side = x < 0 ? -1 : 1;
    const pivot = new THREE.Vector3(-side * (D ? D.HW - 0.1 : 0.75), 0.45, zone === 'front' ? (D ? -D.frontF : -2.3) : (D ? -D.rearF : 2.3));
    const rot = new THREE.Matrix4().makeRotationZ(side * 0.16).multiply(new THREE.Matrix4().makeRotationX(zone === 'front' ? -0.12 : 0.12));
    const m = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    g.matrixAutoUpdate = false;
    g.matrix.copy(m);
    g.matrixWorldNeedsUpdate = true;
  }

  _updateCrack() {
    if (!this.windshield || !this.crack) return;
    const D = this.rig.dims;
    if (!D) return;
    const stage = this.crack;
    if (this._crackStage === stage) return;
    this._crackStage = stage;
    if (this._crackDecal) { this._crackDecal.removeFromParent(); this._crackDecal.geometry.dispose(); }
    // نقطة الخبطة ناحية الراكب (يمين)، والشرخ بيكبر في المرحلة التانية
    const [bf, by] = D.wsBase, [tf, ty] = D.wsTop;
    const p = new THREE.Vector3(stage === 1 ? D.wsHalf * 0.45 : 0.1, by + (ty - by) * 0.45, -(bf + (tf - bf) * 0.45));
    const world = this.shell.localToWorld(p.clone());
    const dir = new THREE.Vector3(0, (ty - by), -(tf - bf)).normalize();
    const nrm = new THREE.Vector3(0, -dir.z, dir.y).applyQuaternion(this.shell.getWorldQuaternion(new THREE.Quaternion()));
    const orient = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), nrm, new THREE.Vector3(0, 1, 0)));
    const size = stage === 1 ? 0.55 : 1.6;
    this.windshield.updateMatrixWorld(true);
    let g;
    try { g = new DecalGeometry(this.windshield, world, orient, new THREE.Vector3(size, size, 1.2)); } catch { return; }
    g.applyMatrix4(new THREE.Matrix4().copy(this.shell.matrixWorld).invert());
    const m = new THREE.Mesh(g, this.crackMats[stage - 1]);
    m.renderOrder = 4;
    this.shell.add(m);
    this._crackDecal = m;
  }

  get any() { return Object.values(this.level).some((v) => v > 0) || this.crack > 0; }

  repair() {
    for (const m of this.meshes) {
      if (!m.dented) continue;
      const P = m.mesh.geometry.attributes.position;
      P.array.set(m.orig); P.needsUpdate = true;
      if (m.origN) { m.mesh.geometry.attributes.normal.array.set(m.origN); m.mesh.geometry.attributes.normal.needsUpdate = true; }
      m.mesh.geometry.computeBoundingSphere();
      m.shellPos.set(m.origShell);
      m.dented = false;
    }
    for (const d of this.decals) { d.removeFromParent(); d.geometry.dispose(); }
    this.decals = [];
    if (this._crackDecal) { this._crackDecal.removeFromParent(); this._crackDecal.geometry.dispose(); this._crackDecal = null; }
    this.crack = 0; this._crackStage = 0;
    for (const k of Object.keys(this.level)) this.level[k] = 0;
    for (const k of Object.keys(this.broken)) this.broken[k] = false;
    for (const l of this.player.headlights || []) { l.userData.broken = false; }
    this.player.setHeadlights(!!this.player.headOn);
    for (const t of Object.values(this.rig.tailPlanes || {})) t.visible = true;
    for (const b of Object.values(this.rig.bumpers || {})) { b.hanging = false; b.group.matrixAutoUpdate = true; b.group.position.copy(b.group.userData.base); b.group.rotation.set(0, 0, 0); b.group.updateMatrix(); }
  }
}

function isInside(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }

const _box = new THREE.Box3(), _sph = new THREE.Sphere();
