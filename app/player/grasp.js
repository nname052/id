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

// ---------- جلد الإيد ----------
// رؤوس الموديل الحقيقية بعد الـ skinning (مش مراكز العضم): الكف (عضمة الإيد غالبة) وكل عقلة في كل صباع.
// المسكة بتتظبط على الجلد ده، فالكف بيلمس فعلًا والصوابع ما بتدخلش.
export function handSkin(ch, s) {
  const key = "_skin" + s.sign; if (ch[key]) return ch[key];
  const boneIx = new Map(); s.fingers.forEach((c, fi) => c.forEach((b, j) => boneIx.set(b, [fi, j])));
  const out = { palm: [], fing: s.fingers.map((c) => c.map(() => [])) };
  ch.root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight, bones = o.skeleton.bones;
    const P = [], F = s.fingers.map((c) => c.map(() => []));
    for (let i = 0; i < si.count; i++) {
      let best = -1, bw = 0;
      for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; best = si.getComponent(i, c); } }
      const b = bones[best]; if (!b) continue;
      if (b === s.hand) P.push(i); else if (boneIx.has(b)) { const [fi, j] = boneIx.get(b); F[fi][j].push(i); }
    }
    if (P.length) out.palm.push({ mesh: o, idx: P });
    F.forEach((c, fi) => c.forEach((idx, j) => { if (idx.length) out.fing[fi][j].push({ mesh: o, idx }); }));
  });
  return (ch[key] = out);
}
export function eachSkin(lists, fn) { const v = V(); for (const { mesh, idx } of lists) for (const i of idx) { mesh.getVertexPosition(i, v); mesh.localToWorld(v); fn(v); } }
// منحنى ناعم بيعدّي على نقط (Catmull-Rom، وقت متساوي لكل جزء): سرعته متصلة عند كل نقطة
function spline(pts) {
  const n = pts.length - 1;
  return (u) => {
    const x = clamp(u) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    const f2 = f * f, f3 = f2 * f;
    return new THREE.Vector3().addScaledVector(p0, -0.5 * f3 + f2 - 0.5 * f).addScaledVector(p1, 1.5 * f3 - 2.5 * f2 + 1)
      .addScaledVector(p2, -1.5 * f3 + 2 * f2 + 0.5 * f).addScaledVector(p3, 0.5 * f3 - 0.5 * f2);
  };
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
  // المسكة على الجلد الحقيقي: الكف على بعد ~2 مم من السطح، ولا جزء من الإيد تحت السطح اللي الحاجة قاعدة عليه
  const skin = handSkin(R.ch, s), support = from.y;
  const skinMin = (lists) => { let m = Infinity; eachSkin(lists, (v) => { const d = sdf(v); if (d < m) m = d; }); return m; };
  const allFing = skin.fing.flat(2), allSkin = [...skin.palm, ...allFing];
  const skinLow = () => { let m = Infinity; eachSkin(allSkin, (v) => { if (v.y < m) m = v.y; }); return m; };
  const PALM_GAP = 0.002, CLEAR = 0.004, TOUCH = 0.0012, PEN = 0;
  const gripCenter = from.clone().addScaledVector(UP, isFlat(shape) ? shape.h / 2 : Math.min(shape.h * 0.45, shape.h - 0.025));
  for (let i = 0; i < 12; i++) {
    cfg.pose(T.grasp, reachFull(G0, null), { noCurl: true });
    const dp = skinMin(skin.palm), df = skinMin(allFing), low = skinLow();
    // نص الكف قصاد نص الحاجة على اتجاه الصوابع (زي الإيد الحقيقية): الكف هو اللي بيلمس، والصوابع تلف حواليها
    const pc = V(); let n = 0; eachSkin(skin.palm, (v) => { pc.add(v); n++; }); pc.divideScalar(Math.max(1, n));
    const along = gripCenter.clone().sub(pc).dot(G0.fing);
    const mv = new THREE.Vector3().addScaledVector(G0.fing, along * 0.8)
      .addScaledVector(G0.a, -Math.min(dp - PALM_GAP, df - 0.001)); // ناحية الحاجة (أو بعيد لو داخل)
    if (low + mv.y < support + CLEAR) mv.y += support + CLEAR - (low + mv.y);                       // فوق السطح دايمًا
    if (mv.length() < 0.0003 && Math.abs(along) < 0.002) break;
    G0 = { ...G0, wrist: G0.wrist.clone().add(mv) };
  }
  const allBones = s.fingers.flat();
  const saved = allBones.map((b) => b.quaternion.clone());
  const restore = () => { allBones.forEach((b, i) => b.quaternion.copy(saved[i])); s.hand.updateMatrixWorld(true); };
  // كل صباع بيتقفل لحد ما جلد آخر عقلتين يلمس السطح (~1 مم)، ويقف قبل ما أي جزء منه يدخل
  const tryCurl = (fi, c) => { restore(); poseFingers(s, c, s.sgn);
    return { tip: skinMin(skin.fing[fi].slice(1).flat()), all: skinMin(skin.fing[fi].flat()), low: skinLow() }; };
  const ok = (r) => r.all >= PEN && r.low >= support + CLEAR * 0.5;
  const curls = [0, 0, 0, 0, 0, 0];
  for (let fi = 0; fi < 4; fi++) {
    if (!s.fingers[fi] || !s.fingers[fi].length) continue;
    let best = 0, bestErr = Infinity;
    for (let deg = 0; deg <= 115; deg += 2.5) {
      const c = [0, 0, 0, 0, 0, 0]; c[fi] = deg;
      const r = tryCurl(fi, c);
      if (!ok(r)) break;
      const err = Math.abs(r.tip - TOUCH);
      if (err < bestErr) { bestErr = err; best = deg; }
      if (r.tip <= TOUCH) break;
    }
    curls[fi] = best;
  }
  { // الإبهام: معاكسة + ثني عبر الكف؛ الطريق كله للقفلة لازم يفضل برّه
    let best = [0, 0], bestErr = Infinity;
    for (let op = 0; op <= 80; op += 5) for (let fl = 0; fl <= 90; fl += 5) {
      const r = tryCurl(4, [0, 0, 0, 0, fl, op]);
      if (!ok(r)) continue;
      let bad = false;
      for (let f2 = 0; f2 < fl && !bad; f2 += 10) bad = !ok(tryCurl(4, [0, 0, 0, 0, f2, op]));
      if (bad) continue;
      const err = Math.abs(r.tip - TOUCH) + (op + fl) * 1e-6;
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
  // الطريق: من مكان الإيد وهي سايبة، تطلع فوق مستوى السطح الأول جنب الجسم، وبعدين تروح للحاجة من الجنب/فوق
  // (عمرها ما تعدّي من تحت السطح)، والرجوع بنفس الشكل بالعكس
  const restWrist = (tt) => { cfg.pose(tt, null); return s.hand.getWorldPosition(V()); };
  const above = (p) => new THREE.Vector3(p.x, Math.max(p.y, support + 0.075 * k), p.z).addScaledVector(bodyFwd(), 0.03 * k);
  const TB = T.back + 1.3; // الرجوع للراحة بهدوء (مش بسرعة بعد الحطّ)
  const R0 = restWrist(T.reach), R1 = restWrist(TB);
  const goPath = spline([R0, above(R0), Wpre, G0.wrist]), backPath = spline([Gplace.wrist, Wrel, above(R1), R1]);
  let t = 0;
  const seg = (t0, t1) => smooth((t - t0) / Math.max(0.05, t1 - t0));
  const path = () => { // مكان الرسغ في لحظة t
    if (t < T.grasp) return { w: seg(T.reach, T.reach + 0.55), pt: goPath(seg(T.reach, T.grasp)), G: G0 };
    if (t < T.lift) return { w: 1, pt: G0.wrist.clone(), G: G0 };
    if (t < T.place) { const p = seg(T.lift, Math.min(T.lift + 0.9, T.place)); const pt = G0.wrist.clone().lerp(Ghold.wrist, p); pt.y += Math.sin(p * Math.PI) * 0.04 * k; return { w: 1, pt, G: Ghold }; }
    if (t < T.release) { const p = seg(T.place, T.release); const pt = Ghold.wrist.clone().lerp(Gplace.wrist, p); pt.y += Math.sin(p * Math.PI) * 0.03 * k;
      const G = { fing: Ghold.fing.clone().lerp(Gplace.fing, p).normalize(), palm: Ghold.palm.clone().lerp(Gplace.palm, p).normalize() };
      return { w: 1, pt, G }; }
    return { w: 1 - seg(TB - 0.55, TB), pt: backPath(seg(T.release, TB - 0.55)), G: Gplace }; // الإيد بترجع جنب الجسم الأول، وبعدها بس بتسيب الـ IK
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
    if (t >= T.reach && t < TB) {
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
      // أقرب مسافة لجلد الإيد (كف وصوابع) من سطح الحاجة دلوقتي (سالب = جوّاها) للقياس
      contact: () => { const inv = new THREE.Matrix4().compose(obj.position, obj.quaternion, new THREE.Vector3(1, 1, 1)).invert();
        const d = (lists) => { let m = Infinity; eachSkin(lists, (v) => { m = Math.min(m, sdfLocal(shape, v.clone().applyMatrix4(inv))); }); return m; };
        return { palm: d(skin.palm), fingers: d(allFing), tips: skin.fing.map((c) => d(c.slice(1).flat())) }; },
    };
  };
}
