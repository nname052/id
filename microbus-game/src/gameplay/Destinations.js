// =====================================================================
//  أماكن التوصيل للمهمات: أقرب مستشفى (للإسعاف) / أقرب قسم شرطة (للبوكس)
//  - من البيانات الحقيقية بس: المعالم المؤكدة (landmarks) + نقط OSM (features.pois). المستشفى الأول، وبعدين العيادة.
//  - لو الخريطة مافيهاش ولا واحد: نقطة في اللعبة على طريق رئيسي في نص البلد، اسمها واضح إنها "مكان في اللعبة"
//    (مش اسم مستشفى/قسم متألف).
//  - نقطة الوقوف على أقرب شارع للمكان + علامة باينة (حلقة منوّرة + عمود نور) بلون المهمة.
// =====================================================================
import * as THREE from 'three';

const KINDS = { hospital: { lm: ['hospital'], poi: ['hospital'], poi2: ['clinic'], fallback: 'نقطة إسعاف (مكان في اللعبة)' }, police: { lm: ['police'], poi: ['police'], poi2: [], fallback: 'قسم شرطة (مكان في اللعبة)' } };

export function placesOf(world, type) {
  const K = KINDS[type], out = [], out2 = [];
  for (const l of world?.landmarks?.confirmed || []) if (K.lm.includes(l.kind) && l.inside_region !== false) out.push({ name: l.name, x: l.x, z: l.z });
  for (const p of world?.features?.pois || []) {
    if (!p.p) continue;
    const q = { name: p.name || (type === 'hospital' ? 'مستشفى' : 'قسم شرطة'), x: p.p[0], z: p.p[1] };
    if (K.poi.includes(p.kind)) out.push(q); else if (K.poi2.includes(p.kind) && p.name) out2.push(q);
  }
  // (نفس المكان متسجّل مرتين — معلم ونقطة: واحد بس)
  const uniq = (L) => L.filter((q, i) => !L.slice(0, i).some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 40));
  return { main: uniq(out), extra: uniq(out2) };
}

/** أقرب مكان من النوع ده (بالمسافة) + نقطة الوقوف على الشارع. minD: مش لازق فيك (عشان يبقى مشوار) */
export function nearestPlace(world, type, x, z, minD = 60) {
  const { main, extra } = placesOf(world, type);
  // (الأقرب — بس الاسم العربي مفضّل: "ASM E.2" اسم OSM كود؛ اللي اسمه إنجليزي بس بيتحسب أبعد 1.6×)
  const AR = /[\u0600-\u06FF]/;
  const pick = (L) => { let best = null, bd = Infinity; for (const q of L) { const d = Math.hypot(q.x - x, q.z - z), sc = d * (AR.test(q.name) ? 1 : 1.6); if (d > minD && sc < bd) { bd = sc; best = q; } } return best; };
  let P = pick(main) || pick(extra), real = !!P;
  if (!P) {
    // مفيش في الخريطة: أطول طريق رئيسي قريب من نص البلد
    const G = world.graph, MAIN = new Set(['primary', 'secondary', 'trunk', 'tertiary']);
    const c = world.spawnPose?.() || { x: 0, z: 0 };
    let e = null, bs = -Infinity;
    for (const q of G.edges) { if (q.closed || q.elevated || !MAIN.has(q.cls) || q.length < 60) continue; const m = q.pts[Math.floor(q.pts.length / 2)], sc = q.length - Math.hypot(m.x - c.x, m.z - c.z) * 0.8 - (Math.hypot(m.x - x, m.z - z) < minD ? 1e6 : 0); if (sc > bs) { bs = sc; e = q; } }
    const m = e ? e.pts[Math.floor(e.pts.length / 2)] : c;
    P = { name: KINDS[type].fallback, x: m.x, z: m.z };
  }
  const r = world.roadPose?.(P.x, P.z);
  return { name: P.name, real, px: P.x, pz: P.z, x: r ? r.x : P.x, z: r ? r.z : P.z, yaw: r?.yaw || 0 };
}

/** علامة مكان التوصيل: حلقة على الأرض + عمود نور خفيف (من بعيد باين) */
export class DropMarker {
  constructor(scene, color) {
    const g = (this.group = new THREE.Group()); g.name = 'drop-marker'; g.visible = false;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 6.2, 48).rotateX(-Math.PI / 2), mat);
    this.ring.position.y = 0.06;
    const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 26, 16, 1, true), beamMat);
    this.beam.position.y = 13;
    g.add(this.ring, this.beam);
    scene.add(g);
    this.t = 0;
  }
  show(p, y = 0) { this.group.position.set(p.x, y, p.z); this.group.visible = true; }
  hide() { this.group.visible = false; }
  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    const k = 0.5 + 0.5 * Math.sin(this.t * 3);
    this.ring.material.opacity = 0.35 + 0.35 * k; this.ring.scale.setScalar(1 + 0.06 * k);
    this.beam.material.opacity = 0.14 + 0.12 * k;
  }
}
