// مسك الحاجات: الإيد بتروح للحاجة (IK)، والصوابع بتتقفل لحد ما تلمس سطحها الحقيقي (من غير ما تدخل فيها)،
// والحاجة بتتحرك مع الإيد وهي ماسكاها، ولما تتحط بتقعد على السطح بالظبط.
// كله محسوب من t: بنقيس المسكة مرة واحدة في البداية (وضعية لحظة المسك) وبعدين كل فريم بيتحسب لوحده.
import * as THREE from "three";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => (x = clamp(x), x * x * (3 - 2 * x));
const lerp = (a, b, p) => a + (b - a) * p;
const D = Math.PI / 180;
const V = () => new THREE.Vector3();

function rotateWorld(bone, q) {
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.multiply(q.clone().multiply(wq)));
  bone.updateMatrixWorld(true);
}
// نفس طريقة ثني الصوابع اللي في rig.js (لصباع واحد)
function curlChain(s, fi, deg) {
  const chain = s.fingers[fi], ang = deg * D;
  const n0 = chain[1] || chain[0].children.find((c) => c.isBone);
  const hinge = n0 ? n0.getWorldPosition(V()).sub(chain[0].getWorldPosition(V())).normalize().cross(s.palmN).normalize() : s.palmN.clone();
  chain.forEach((bone, ji) => {
    const nxt = chain[ji + 1] || bone.children.find((c) => c.isBone);
    if (!nxt) return;
    const axis = fi === 4 ? s.palmN.clone() : hinge;
    const a = fi === 4 ? -ang * 0.5 * s.sgn : ang * (ji === 0 ? 0.8 : 1);
    if (axis.lengthSq() > 1e-6) rotateWorld(bone, new THREE.Quaternion().setFromAxisAngle(axis, a));
  });
}
// مكان طرف الصباع (آخر عقلة + طولها تقريبًا)
export function fingerPoints(s, fi) {
  const c = s.fingers[fi], pts = c.map((b) => b.getWorldPosition(V()));
  const n = pts.length;
  if (n >= 2) pts.push(pts[n - 1].clone().add(pts[n - 1].clone().sub(pts[n - 2]).multiplyScalar(0.85)));
  return pts;
}
// بُعد نقطة عن محور الكوباية (خط رأسي)
const axisDist = (p, c) => Math.hypot(p.x - c.x, p.z - c.z);

/** cfg = { R, side: "Right", obj, radius, height, from (قاعدة الحاجة على الترابيزة), to (مكان الحطّ),
 *   t: { reach, grasp, lift, place, release, back }, pose(t, reach) ← بيطبّق وضعية الشخصية كلها في لحظة t }
 *  بيرجّع update(t) ← بيدّي reach للدراع، ومكان الحاجة، و bodyAdd (استعداد/متابعة) */
export function makeGrasp(cfg) {
  const { R, obj, radius, height } = cfg, S = cfg.side || "Right", key = S === "Right" ? "R" : "L", s = R.side[S], k = R.k;
  const T = cfg.t, from = cfg.from.clone(), to = cfg.to.clone();
  const up = new THREE.Vector3(0, 1, 0);
  obj.position.copy(from);

  // شكل المسكة حوالين نقطة p (قاعدة الكوباية): الكف بيبص للكوباية من ناحية الكتف، والصوابع بتلف حواليها
  const gripAt = (base, shoulder, leftDir) => {
    const a = shoulder.clone().sub(base); a.y = 0; a.normalize();                 // من الكوباية للكتف (أفقي)
    const fing = up.clone().cross(a).normalize(); if (fing.dot(leftDir) < 0) fing.negate(); // الصوابع ناحية نص الجسم
    const palm = a.clone().negate();                                                 // الكف بيبص للكوباية
    const palmC = base.clone().add(up.clone().multiplyScalar(height * 0.42)).add(a.clone().multiplyScalar(radius + 0.024 * k));
    const wrist = palmC.clone().sub(fing.clone().multiplyScalar(0.06 * k)).add(a.clone().multiplyScalar(0.012 * k));
    return { wrist, fing, palm, a };
  };
  const ctxAt = (t) => { // مكان الكتف واتجاه الشمال للشخصية في لحظة t (من وضعية من غير مسكة)
    cfg.pose(t, null);
    const sh = s.arm.getWorldPosition(V());
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(R.ch.root.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(s.sign > 0 ? -1 : 1);
    return { sh, left };
  };

  // 1) قياس المسكة في لحظة المسك: الصوابع مفرودة، وبعدين كل صباع بيتني لحد ما يلمس السطح
  const c0 = ctxAt(T.grasp), G0 = gripAt(from, c0.sh, c0.left);
  const reachFull = (g, curls) => ({ [key]: { point: g.wrist, fing: g.fing, palm: g.palm, w: 1, curls } });
  cfg.pose(T.grasp, reachFull(G0, null), { noCurl: true });
  const axisC = from.clone();
  const curls = [0, 0, 0, 0, 0];
  for (let fi = 0; fi < 5; fi++) {
    if (!s.fingers[fi] || !s.fingers[fi].length) continue;
    const saved = s.fingers[fi].map((b) => b.quaternion.clone());
    const restore = () => { s.fingers[fi].forEach((b, i) => b.quaternion.copy(saved[i])); s.fingers[fi][0].updateMatrixWorld(true); };
    let best = 0, bestErr = Infinity;
    for (let deg = 0; deg <= 115; deg += 2.5) {
      restore(); curlChain(s, fi, deg);
      const pts = fingerPoints(s, fi), tip = pts[pts.length - 1];
      const inside = pts.some((p) => p.y > from.y - 0.01 && p.y < from.y + height + 0.01 && axisDist(p, axisC) < radius + 0.007);
      if (inside) break;                                        // أي عقلة دخلت جوه الكوباية: نقف عند اللي قبلها
      const err = Math.abs(axisDist(tip, axisC) - (radius + 0.013));
      if (err < bestErr) { bestErr = err; best = deg; }
      if (axisDist(tip, axisC) <= radius + 0.013) break;          // الطرف لمس السطح
    }
    restore();
    curls[fi] = best;
  }
  // 2) الحاجة متربوطة بالإيد: نقيس مكانها بالنسبة لعضمة الإيد لحظة المسك
  cfg.pose(T.grasp, reachFull(G0, curls));
  const handM0 = s.hand.matrixWorld.clone();
  const objM0 = new THREE.Matrix4().compose(from, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
  const offset = handM0.clone().invert().multiply(objM0);
  const objFromHand = () => new THREE.Matrix4().multiplyMatrices(s.hand.matrixWorld, offset);

  // 3) مكان الشيل (قدام الصدر) ومكان الحطّ
  const holdBase = (t) => { const c = ctxAt(t); const f = new THREE.Vector3(0, 0, 1).applyQuaternion(R.ch.root.getWorldQuaternion(new THREE.Quaternion()));
    return { c, base: c.sh.clone().add(f.multiplyScalar(0.36 * k)).add(c.left.clone().multiplyScalar(0.1 * k)).add(new THREE.Vector3(0, -0.36 * k, 0)) }; };
  // نهاية الحطّ: بنظبط الإيد لحد ما قاعدة الحاجة تقعد على السطح بالظبط (3 مرات تصحيح)
  const placeFix = (t, curlsNow) => {
    const c = ctxAt(t); let g = gripAt(to, c.sh, c.left);
    for (let i = 0; i < 3; i++) {
      cfg.pose(t, reachFull(g, curlsNow));
      const p = new THREE.Vector3().setFromMatrixPosition(objFromHand());
      const err = to.clone().sub(p); if (err.length() < 0.002) break;
      g = { ...g, wrist: g.wrist.clone().add(err) };
    }
    return g;
  };
  const Gplace = placeFix(T.release, curls);
  cfg.pose(T.release, reachFull(Gplace, curls));
  const objPlacedM = objFromHand();
  const placed = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
  objPlacedM.decompose(placed.p, placed.q, placed.s); placed.p.y = to.y; placed.q.identity(); // على السطح بالظبط وعدلة

  const OPEN = [6, 6, 6, 6, 0];
  // كل نقط الإيد بتتحسب مرة واحدة (مش من مكان الكتف كل فريم، علشان ما يحصلش ارتعاش)
  const cH = holdBase(T.place), Ghold = { ...G0, wrist: gripAt(cH.base, cH.c.sh, cH.c.left).wrist };
  const Wpre = G0.wrist.clone().add(G0.a.clone().multiplyScalar(0.08 * k)).add(new THREE.Vector3(0, 0.03 * k, 0));
  const Wrel = Gplace.wrist.clone().add(Gplace.a.clone().multiplyScalar(0.06 * k)).add(new THREE.Vector3(0, 0.02 * k, 0));
  const seg = (t0, t1) => smooth((t - t0) / Math.max(0.05, t1 - t0));
  let t = 0;
  const path = () => { // مكان الرسغ في لحظة t (منحنيات ناعمة بين نقط ثابتة)
    if (t < T.grasp) { const p = seg(T.reach, T.grasp); const g = smooth((p - 0.55) / 0.45); return { w: p, pt: Wpre.clone().lerp(G0.wrist, g), G: G0 }; }
    if (t < T.lift) return { w: 1, pt: G0.wrist.clone(), G: G0 };
    if (t < T.place) { const p = seg(T.lift, Math.min(T.lift + 0.9, T.place)); const pt = G0.wrist.clone().lerp(Ghold.wrist, p); pt.y += Math.sin(p * Math.PI) * 0.04 * k; return { w: 1, pt, G: Ghold }; }
    if (t < T.release) { const p = seg(T.place, T.release); const pt = Ghold.wrist.clone().lerp(Gplace.wrist, p); pt.y += Math.sin(p * Math.PI) * 0.03 * k;
      // اتجاه الإيد بيتغيّر بالتدريج من مسكة الشيل لمسكة الحطّ (مش مرة واحدة)
      const G = { fing: Ghold.fing.clone().lerp(Gplace.fing, p).normalize(), palm: Ghold.palm.clone().lerp(Gplace.palm, p).normalize() };
      return { w: 1, pt, G }; }
    const p = seg(T.release, T.release + 0.35); return { w: 1 - seg(T.back, T.back + 1.0), pt: Gplace.wrist.clone().lerp(Wrel, p), G: Gplace };
  };
  return (tt) => {
    t = tt;
    // استعداد قبل المد (ميلة صغيرة لورا ونقل الوزن على رجل الإيد) ومتابعة بعد الحطّ
    const bodyAdd = { lean: 0, shiftX: 0 };
    const ant = smooth((t - (T.reach - 0.45)) / 0.4) * (1 - smooth((t - T.reach) / 0.4));
    bodyAdd.lean -= 4 * ant;
    bodyAdd.shiftX += (s.sign > 0 ? 1 : -1) * 0.015 * k * ant;
    const follow = smooth((t - T.release) / 0.3) * (1 - smooth((t - T.release - 0.3) / 0.6));
    bodyAdd.lean += 2 * follow;

    let reach = null, mode = "rest";
    if (t >= T.reach && t < T.back + 1.0) {
      const { w, pt, G } = path();
      let c;
      if (t < T.grasp) c = OPEN;
      else if (t < T.lift) c = OPEN.map((o, i) => lerp(o, curls[i], seg(T.grasp, Math.min(T.grasp + 0.3, T.lift))));
      else if (t < T.release) c = curls;
      else c = curls.map((x, i) => lerp(x, OPEN[i], seg(T.release, T.release + 0.3)));
      reach = { point: pt, fing: G.fing, palm: G.palm, w, curls: c };
      mode = t >= T.grasp + 0.2 && t < T.release ? "held" : "rest";
    }
    return {
      reach: reach ? { [key]: reach } : null, bodyAdd, mode,
      placeObject: () => {
        if (mode === "held") { const m = objFromHand(); m.decompose(obj.position, obj.quaternion, obj.scale); }
        else if (t >= T.release) { obj.position.copy(placed.p); obj.quaternion.copy(placed.q); obj.scale.set(1, 1, 1); }
        else { obj.position.copy(from); obj.quaternion.identity(); obj.scale.set(1, 1, 1); }
      },
      curls, radius,
    };
  };
}
