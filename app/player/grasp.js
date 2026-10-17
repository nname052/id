// نظام مسك واحد لأي حاجة (كوباية، كتاب، موبايل…): الحاجة متوصّفة بشكلها (اسطوانة أو صندوق) كـ "دالة مسافة" (SDF)،
// ونوع المسكة بيتختار من الشكل نفسه: الحاجة الطويلة بتتمسك من الجنب (الإبهام لفوق)، والمسطحة من فوق (الكف لتحت).
// الإيد بتروح للحاجة (IK)، والصوابع والإبهام بيتقفلوا لحد ما يلمسوا السطح الحقيقي (من غير ما يدخلوا فيه)،
// والحاجة بتتحرك مع الإيد وهي ماسكاها، ولما تتحط بتقعد على السطح بالظبط وعدلة.
// كله محسوب من t: المسكة بتتقاس مرة واحدة في البداية، وبعدين كل فريم بيتحسب لوحده.
import * as THREE from "three";
import { poseFingers } from "./rig.js";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => (x = clamp(x), x * x * (3 - 2 * x));
const lerp = (a, b, p) => a + (b - a) * p;
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

// ---------- الشكل ----------
// shape = { kind: "cylinder", r, h } | { kind: "box", w, h, d } — نقطة الأصل في نص القاعدة
export function sdfLocal(shape, p) {
  if (shape.kind === "cylinder") {
    const dr = Math.hypot(p.x, p.z) - shape.r, dy = Math.abs(p.y - shape.h / 2) - shape.h / 2;
    return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0));
  }
  const q = [Math.abs(p.x) - shape.w / 2, Math.abs(p.y - shape.h / 2) - shape.h / 2, Math.abs(p.z) - shape.d / 2];
  return Math.hypot(...q.map((v) => Math.max(v, 0))) + Math.min(Math.max(...q), 0);
}
// نص عرض الحاجة في اتجاه أفقي u (بعد لفّة الحاجة)
function extentAlong(shape, q, u) {
  if (shape.kind === "cylinder") return shape.r;
  const ux = new THREE.Vector3(1, 0, 0).applyQuaternion(q), uz = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.abs(u.dot(ux)) * shape.w / 2 + Math.abs(u.dot(uz)) * shape.d / 2;
}
const isFlat = (shape) => shape.h < 0.05;

// مكان طرف الصباع (آخر عقلة + طولها تقريبًا)
export function fingerPoints(s, fi) {
  const c = s.fingers[fi], pts = c.map((b) => b.getWorldPosition(V()));
  const n = pts.length;
  if (n >= 2) pts.push(pts[n - 1].clone().add(pts[n - 1].clone().sub(pts[n - 2]).multiplyScalar(0.85)));
  return pts;
}

// ---------- مكان الوقفة ----------
// الشخص بيقف قدام حرف السطح (edge: {point, normal لناحية الشخص}) بحيث كتف الإيد اللي هتمسك يبقى في صف الحاجة،
// والجسم بعيد عن الحرف مسافة مريحة. ده اللي بيمنع الانحناء الزيادة (السبب، مش الميلة).
export function standFor(R, objPos, edge, side = "Right", gap = 0.05) {
  const k = R.k, n = edge.normal.clone().setY(0).normalize();
  const face = Math.atan2(-n.x, -n.z);                                    // الوش ناحية السطح
  const lateral = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, face);    // شمال الشخص
  const shX = (R.side[side].sign > 0 ? 1 : -1) * Math.abs(R.side[side].shX0 || 0.17 * k);
  const front = 0.13 * k + gap;                                            // من نص الجسم لقدام البطن + مسافة
  const onEdge = objPos.clone().addScaledVector(n, n.dot(edge.point.clone().sub(objPos))); // على الحرف قدام الحاجة
  const pos = onEdge.addScaledVector(n, front).addScaledVector(lateral, -shX * 0.6);
  pos.y = 0;
  return { pos, face };
}

/** cfg = { R, side, obj, shape (أو radius/height = اسطوانة), from (قاعدة الحاجة), to (مكان الحطّ),
 *   t: { reach, grasp, lift, place, release, back }, pose(t, reach, extra) ← بيطبّق وضعية الشخصية كلها في لحظة t }
 *  بيرجّع update(t) ← بيدّي reach للدراع، ومكان الحاجة، و bodyAdd (استعداد/متابعة) */
export function makeGrasp(cfg) {
  const { R, obj } = cfg, S = cfg.side || "Right", key = S === "Right" ? "R" : "L", s = R.side[S], k = R.k;
  const shape = cfg.shape || { kind: "cylinder", r: cfg.radius, h: cfg.height };
  const T = cfg.t, from = cfg.from.clone(), to = cfg.to.clone();
  const q0 = obj.quaternion.clone();
  obj.position.copy(from);
  const rootQ = () => R.ch.root.getWorldQuaternion(Q());
  const lateralOut = () => new THREE.Vector3(s.sign > 0 ? 1 : -1, 0, 0).applyQuaternion(rootQ()); // ناحية الإيد لبره
  const bodyFwd = () => new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ());

  // اتجاه الإبهام بالنسبة لإطار الإيد (الصوابع × الكف): بيتقاس مرة من الهيكل نفسه
  cfg.pose(T.grasp, null, { noCurl: true });
  const hw0 = s.hand.getWorldPosition(V()), f0 = s.fingers[1][0].getWorldPosition(V()).sub(hw0).normalize();
  const th0 = s.fingers[4][0].getWorldPosition(V()).sub(hw0);
  const thumbSign = Math.sign(th0.dot(f0.clone().cross(s.palmN))) || 1;
  const thumbDir = (fing, palm) => fing.clone().cross(palm).multiplyScalar(thumbSign);

  // شكل المسكة حوالين قاعدة الحاجة base
  const gripAt = (base, q, shoulder) => {
    if (isFlat(shape)) {
      // من فوق: الكف لتحت، والصوابع على العرض الأقصر (بتقفل على الحرفين)، ناحية بعيد عن الجسم
      const palm = UP.clone().negate();
      let fing = shape.kind === "box" && shape.w < shape.d ? new THREE.Vector3(1, 0, 0).applyQuaternion(q) : new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      if (fing.dot(bodyFwd()) < 0) fing.negate();
      // مفاصل الصوابع بتقعد بعد الحرف البعيد بسنة، فالصوابع تلف على الحرف لتحت والإبهام على الحرف القريب (مسكة قرصة)
      const palmC = base.clone().addScaledVector(UP, shape.h + 0.022 * k).addScaledVector(fing, extentAlong(shape, q, fing) - 0.035 * k);
      const wrist = palmC.clone().addScaledVector(fing, -0.07 * k).addScaledVector(UP, 0.02 * k);
      return { wrist, fing, palm, a: UP.clone() };
    }
    // من الجنب: الإيد جاية من ناحيتها (برّه + شوية من ناحية الكتف)، الكف بيبص للحاجة، والإبهام لفوق (زي الحقيقة)
    const toSh = shoulder.clone().sub(base).setY(0).normalize();
    const a = lateralOut().multiplyScalar(1).addScaledVector(toSh, 0.6).setY(0).normalize();
    const palm = a.clone().negate();
    let fing = UP.clone().cross(a).normalize();
    if (thumbDir(fing, palm).y < 0) fing.negate();
    const hgt = Math.min(shape.h * 0.45, shape.h - 0.025);
    const palmC = base.clone().addScaledVector(UP, hgt).addScaledVector(a, extentAlong(shape, q, a) + 0.022 * k);
    const wrist = palmC.clone().addScaledVector(fing, -0.06 * k).addScaledVector(a, 0.012 * k);
    return { wrist, fing, palm, a };
  };
  const shoulderAt = (t) => { cfg.pose(t, null); return s.arm.getWorldPosition(V()); };

  // 1) قياس المسكة لحظة المسك: الصوابع مفرودة، وبعدين كل صباع (والإبهام بمعاكسته) بيتقفل لحد ما يلمس السطح
  let G0 = gripAt(from, q0, shoulderAt(T.grasp));
  const reachFull = (g, curls) => ({ [key]: { point: g.wrist, fing: g.fing, palm: g.palm, w: 1, curls } });
  const objInv = new THREE.Matrix4().compose(from, q0, new THREE.Vector3(1, 1, 1)).invert();
  const sdf = (p) => sdfLocal(shape, p.clone().applyMatrix4(objInv));
  // الإيد المفتوحة كلها لازم تبقى برّه الحاجة قبل القفل: لو أي عقلة جوّه، الرسغ بيرجع لورا في اتجاه المسكة بقد الفرق
  for (let i = 0; i < 5; i++) {
    cfg.pose(T.grasp, reachFull(G0, null), { noCurl: true });
    let m = sdf(s.hand.getWorldPosition(V()));
    for (let fi = 0; fi < 5; fi++) for (const p of fingerPoints(s, fi)) m = Math.min(m, sdf(p));
    if (m >= 0.007) break;
    G0 = { ...G0, wrist: G0.wrist.clone().addScaledVector(G0.a, 0.007 - m + 0.002) };
  }
  const allBones = s.fingers.flat();
  const saved = allBones.map((b) => b.quaternion.clone());
  const restore = () => { allBones.forEach((b, i) => b.quaternion.copy(saved[i])); s.hand.updateMatrixWorld(true); };
  const TOUCH = 0.011, SKIN = 0.005;
  const tryCurl = (fi, c) => { restore(); poseFingers(s, c, s.sgn); const pts = fingerPoints(s, fi); return { tip: sdf(pts[pts.length - 1]), inside: pts.slice(1).some((p) => sdf(p) < SKIN) }; };
  const curls = [0, 0, 0, 0, 0, 0];
  for (let fi = 0; fi < 4; fi++) {
    if (!s.fingers[fi] || !s.fingers[fi].length) continue;
    let best = 0, bestErr = Infinity;
    for (let deg = 0; deg <= 115; deg += 2.5) {
      const c = [0, 0, 0, 0, 0, 0]; c[fi] = deg;
      const r = tryCurl(fi, c);
      if (r.inside) break;                                   // أي عقلة دخلت جوه: نقف عند اللي قبلها
      const err = Math.abs(r.tip - TOUCH);
      if (err < bestErr) { bestErr = err; best = deg; }
      if (r.tip <= TOUCH) break;                             // الطرف لمس السطح
    }
    curls[fi] = best;
  }
  { // الإبهام: معاكسة (ناحية وش الكف) + ثني عبر الكف، أقرب حاجة للمس من غير دخول
    let best = [0, 0], bestErr = Infinity;
    for (let op = 0; op <= 80; op += 5) for (let fl = 0; fl <= 90; fl += 5) {
      const c = [0, 0, 0, 0, fl, op], r = tryCurl(4, c);
      if (r.inside) continue;
      // الطريق كله للقفلة (الإبهام مفتوح ← مقفول على نفس المعاكسة) لازم يفضل برّه الحاجة، مش آخره بس
      let pathIn = false;
      for (let f2 = 0; f2 < fl && !pathIn; f2 += 10) pathIn = tryCurl(4, [0, 0, 0, 0, f2, op]).inside;
      if (pathIn) continue;
      const err = Math.abs(r.tip - TOUCH) + (op + fl) * 1e-5;
      if (err < bestErr) { bestErr = err; best = [fl, op]; }
    }
    curls[4] = best[0]; curls[5] = best[1];
  }
  restore();
  // 2) الحاجة متربوطة بالإيد: مكانها بالنسبة لعضمة الإيد لحظة المسك
  cfg.pose(T.grasp, reachFull(G0, curls));
  const offset = s.hand.matrixWorld.clone().invert().multiply(new THREE.Matrix4().compose(from, q0, new THREE.Vector3(1, 1, 1)));
  const objFromHand = () => new THREE.Matrix4().multiplyMatrices(s.hand.matrixWorld, offset);

  // 3) مكان الشيل (قدام الصدر) ومكان الحطّ
  const holdBase = (t) => { const sh = shoulderAt(t);
    return sh.clone().addScaledVector(bodyFwd(), 0.34 * k).addScaledVector(lateralOut(), -0.1 * k).add(new THREE.Vector3(0, -0.36 * k, 0)); };
  // نهاية الحطّ: بنظبط الإيد لحد ما قاعدة الحاجة تقعد على السطح بالظبط (3 مرات تصحيح)
  const placeFix = (t) => {
    let g = gripAt(to, q0, shoulderAt(t));
    for (let i = 0; i < 3; i++) {
      cfg.pose(t, reachFull(g, curls));
      const err = to.clone().sub(new THREE.Vector3().setFromMatrixPosition(objFromHand())); if (err.length() < 0.002) break;
      g = { ...g, wrist: g.wrist.clone().add(err) };
    }
    return g;
  };
  const Gplace = placeFix(T.release);
  cfg.pose(T.release, reachFull(Gplace, curls));
  const placed = { p: new THREE.Vector3().setFromMatrixPosition(objFromHand()), q: q0.clone() };
  placed.p.y = to.y; // على السطح بالظبط وعدلة

  // تجهيز الإيد وهي رايحة (pre-shape): الصوابع مفتوحة والإبهام معاكس من بدري، فالقفلة بعدها ثني بس
  const OPEN = [6, 6, 6, 6, 0, curls[5]];
  const hb = holdBase(T.place), Ghold = { ...G0, wrist: gripAt(hb, q0, shoulderAt(T.place)).wrist };
  const Wpre = G0.wrist.clone().addScaledVector(G0.a, 0.08 * k).add(new THREE.Vector3(0, 0.03 * k, 0));
  const Wrel = Gplace.wrist.clone().addScaledVector(Gplace.a, 0.06 * k).add(new THREE.Vector3(0, 0.02 * k, 0));
  let t = 0;
  const seg = (t0, t1) => smooth((t - t0) / Math.max(0.05, t1 - t0));
  const path = () => { // مكان الرسغ في لحظة t (منحنيات ناعمة بين نقط ثابتة)
    if (t < T.grasp) { const p = seg(T.reach, T.grasp); const g = smooth((p - 0.55) / 0.45); return { w: p, pt: Wpre.clone().lerp(G0.wrist, g), G: G0 }; }
    if (t < T.lift) return { w: 1, pt: G0.wrist.clone(), G: G0 };
    if (t < T.place) { const p = seg(T.lift, Math.min(T.lift + 0.9, T.place)); const pt = G0.wrist.clone().lerp(Ghold.wrist, p); pt.y += Math.sin(p * Math.PI) * 0.04 * k; return { w: 1, pt, G: Ghold }; }
    if (t < T.release) { const p = seg(T.place, T.release); const pt = Ghold.wrist.clone().lerp(Gplace.wrist, p); pt.y += Math.sin(p * Math.PI) * 0.03 * k;
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
      reach: reach ? { [key]: reach } : null, bodyAdd, mode, curls, shape,
      placeObject: () => {
        if (mode === "held") { const m = objFromHand(); m.decompose(obj.position, obj.quaternion, obj.scale); }
        else if (t >= T.release) { obj.position.copy(placed.p); obj.quaternion.copy(placed.q); obj.scale.set(1, 1, 1); }
        else { obj.position.copy(from); obj.quaternion.copy(q0); obj.scale.set(1, 1, 1); }
      },
      // أقرب مسافة لأي عقلة من سطح الحاجة دلوقتي (سالب = جوّاها) للقياس
      contact: () => { const inv = new THREE.Matrix4().compose(obj.position, obj.quaternion, new THREE.Vector3(1, 1, 1)).invert();
        let m = Infinity; for (let fi = 0; fi < 5; fi++) for (const p of fingerPoints(s, fi).slice(1)) m = Math.min(m, sdfLocal(shape, p.clone().applyMatrix4(inv))); return m; },
    };
  };
}
