// محرّك حركة إجرائي (procedural rig) لشخصيات Mixamo: من غير حركات متسجلة.
// Claude بيكتب "الأداء" كوضعيات بالكلام (الإيد على الدقن، مايل لقدام، بيبص للكاميرا…) مربوطة بالكلمات،
// والمحرّك ده بيحسب مكان كل عضمة في كل فريم:
//   - الدراعين: IK بعضمتين (الكتف والكوع بيتحسبوا من مكان الإيد المطلوب) + اتجاه الكف + شكل الصوابع.
//   - الرجلين: IK بيثبّت الرجلين على الأرض (الميلان والقعدة والقرفصة والمشي بيتحسبوا، مش متسجلين).
//   - الجسم والراس: ميلان ولفّة وتهدّل، والراس بتبص للكاميرا أو لأي اتجاه.
//   - حياة جوه الوقفة: نفَس، وتمايل خفيف، وحركة راس صغيرة، علشان الشخصية عمرها ما تتجمد.
// كل حاجة محسوبة من t (حتمية): نفس الوقت ← نفس الوضعية بالظبط.
import * as THREE from "three";

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const smooth = (x) => (x = clamp(x), x * x * (3 - 2 * x));
const D = Math.PI / 180;
// ضوضاء ناعمة حتمية (مجموع موجات بترددات مش متناسبة)
const noise = (t, s = 0) => Math.sin(t * 1.13 + s) * 0.5 + Math.sin(t * 2.71 + s * 1.7) * 0.3 + Math.sin(t * 0.47 + s * 2.3) * 0.2;

// ---------- وضعيات الدراع (مكان الإيد من مفصل الكتف بالمتر لشخص 1.7م) ----------
// x = لبره (بعيد عن الجسم، وسالب = عابر قدام الجسم)، y = لفوق، z = لقدام.
// pole = الكوع بيشاور فين، palm = الكف بيبص فين، fing = اتجاه الصوابع (لو مش مكمّلة الدراع)، hand = شكل الصوابع
export const ARMS = {
  rest:          { p: [0.06, -0.56, 0.04], pole: [0.2, 0, -1], palm: [-1, 0, 0], hand: "relaxed" },
  hip:           { p: [0.13, -0.34, -0.04], pole: [1, 0.1, -0.7], palm: [-1, 0, 0], fing: [0, -0.5, 0.6], hand: "relaxed" },
  chin:          { p: [-0.15, 0.14, 0.15], pole: [0.3, -1, 0.2], palm: [0, 0, -1], fing: [-0.2, 1, 0], hand: "fist" },
  head:          { p: [-0.02, 0.36, 0.0], pole: [1, 0.3, 0.2], palm: [0, -1, 0], hand: "open" },
  scratch_head:  { p: [0.02, 0.33, -0.03], pole: [1, 0.4, 0], palm: [0, -1, 0], hand: "relaxed", motion: "scratch" },
  facepalm:      { p: [-0.15, 0.30, 0.14], pole: [0.4, -1, 0], palm: [0, 0, -1], fing: [0, 1, 0], hand: "open" },
  cover_mouth:   { p: [-0.17, 0.09, 0.16], pole: [0.4, -1, 0.1], palm: [0, 0, -1], fing: [-0.4, 0.6, 0], hand: "open" },
  chest:         { p: [-0.19, -0.13, 0.13], pole: [0.3, -1, 0], palm: [0, 0, -1], fing: [-1, 0.2, 0], hand: "open" },
  point_forward: { p: [0.04, 0.02, 0.62], pole: [0.3, -1, 0], palm: [-1, 0, 0], hand: "point" },
  point_side:    { p: [0.62, 0.06, 0.12], pole: [0, -1, -0.3], palm: [0, 0, 1], hand: "point" },
  point_up:      { p: [0.06, 0.62, 0.14], pole: [1, 0, 0.3], palm: [0, 0, 1], fing: [0, 1, 0], hand: "point" },
  point_self:    { p: [-0.16, -0.08, 0.2], pole: [0.4, -1, 0], palm: [0, -1, 0], fing: [-0.6, 0, -1], hand: "point" },
  wave:          { p: [0.27, 0.36, 0.12], pole: [0.4, -1, 0], palm: [0, 0, 1], fing: [0, 1, 0], hand: "open", motion: "wave" },
  raise:         { p: [0.2, 0.74, 0.08], pole: [1, 0, -0.2], palm: [-1, 0, 0], fing: [0, 1, 0], hand: "fist" },
  fist_pump:     { p: [0.12, 0.05, 0.25], pole: [0.5, -1, 0], palm: [-1, 0, 0], fing: [0, 1, 0], hand: "fist", motion: "pump" },
  open_out:      { p: [0.34, -0.26, 0.30], pole: [0.5, -1, -0.3], palm: [0, 1, 0], hand: "open" },
  explain:       { p: [0.10, -0.17, 0.40], pole: [0.6, -1, 0], palm: [-0.4, 1, 0], hand: "relaxed", motion: "beat" },
  offer:         { p: [0.12, -0.16, 0.46], pole: [0.4, -1, 0], palm: [0, 1, 0], hand: "open" },
  stop:          { p: [0.06, 0.02, 0.52], pole: [0.5, -1, 0], palm: [0, 0, 1], fing: [0, 1, 0], hand: "open" },
  cross:         { p: [-0.21, -0.20, 0.20], pole: [0.6, -1, 0.2], palm: [0, -1, 0], fing: [-1, 0, 0], hand: "relaxed" },
  shrug:         { p: [0.30, -0.33, 0.22], pole: [0.6, -1, -0.3], palm: [0, 1, 0], hand: "open" },
  thumbs_up:     { p: [0.15, -0.10, 0.36], pole: [0.5, -1, 0], palm: [-1, 0, 0], fing: [0, 0, 1], hand: "thumbs_up" },
  fist_shake:    { p: [0.12, 0.00, 0.36], pole: [0.5, -1, 0], palm: [-1, 0, 0], fing: [0, 0.5, 1], hand: "fist", motion: "shake" },
  phone_ear:     { p: [-0.05, 0.19, 0.03], pole: [0.6, -1, 0], palm: [-1, 0, 0], fing: [0, 1, 0], hand: "relaxed" },
  phone_front:   { p: [-0.08, -0.20, 0.33], pole: [0.5, -1, 0], palm: [0, 1, 0.3], hand: "relaxed", motion: "type" },
  hands_together:{ p: [-0.17, -0.14, 0.27], pole: [0.6, -1, 0], palm: [-1, 0, 0], fing: [0, 0.8, 0.6], hand: "open" },
  behind_back:   { p: [-0.06, -0.50, -0.20], pole: [1, 0, -0.5], palm: [0, 0, -1], hand: "relaxed" },
  typing:        { p: [-0.04, -0.33, 0.38], pole: [0.6, -1, 0], palm: [0, -1, 0], hand: "relaxed", motion: "type" },
  hold_cup:      { p: [-0.06, -0.20, 0.30], pole: [0.6, -1, 0], palm: [-1, 0, 0], fing: [0, 0, 1], hand: "fist" },
  reach_up:      { p: [0.18, 0.70, 0.25], pole: [1, 0, -0.2], palm: [0, 0, 1], fing: [0, 1, 0], hand: "open" },
  hands_on_knees:{ p: [0.02, -0.60, 0.42], pole: [0.8, 0, -0.2], palm: [0, -1, 0], hand: "open" },
};
// وضعيات الجسم: lean (لقدام +)، side (للشمال +)، turn (لف للشمال +)، crouch (0..1)، shoulders (رفع/تهدّل)، sit (0..1)، jump
export const BODY = {
  upright: {}, lean_forward: { lean: 14 }, lean_back: { lean: -9 }, slump: { lean: 16, shoulders: -0.6 },
  proud: { lean: -5, shoulders: 0.15 }, crouch: { crouch: 0.42, lean: 18 }, sit: { sit: 1 }, sit_lean: { sit: 1, lean: 16 },
  sit_slump: { sit: 1, lean: 20, shoulders: -0.6 }, twist_left: { turn: 22 }, twist_right: { turn: -22 }, tilt_left: { side: 7 },
  tilt_right: { side: -7 }, shrug: { shoulders: 1 }, sneak: { crouch: 0.25, lean: 22 },
};
export const HEAD = {
  camera: { look: "camera" }, forward: {}, down: { pitch: 28 }, up: { pitch: -15 }, left: { yaw: 45 }, right: { yaw: -45 },
  tilt_left: { tilt: 14 }, tilt_right: { tilt: -14 }, down_left: { pitch: 22, yaw: 30 }, down_right: { pitch: 22, yaw: -30 },
  away: { yaw: 70, pitch: 6 },
};
const HANDS = { // انثناء كل صباع بالدرجات: [السبابة، الوسطى، البنصر، الخنصر، الإبهام]
  relaxed: [18, 24, 30, 34, 10], open: [3, 3, 4, 5, 0], fist: [88, 92, 95, 95, 45], point: [0, 92, 95, 95, 40], thumbs_up: [90, 92, 95, 95, -10],
};
// حركات مستمرة فوق الوضعية (بتتكرر طول ما الوضعية ثابتة)
const MOTIONS = ["none", "nod", "shake", "bounce", "laugh", "cry", "tremble", "breathe_heavy", "talk", "look_around", "sway", "wave", "pump", "beat", "type", "scratch"];

// ---------- أدوات العضم ----------
const _tmpQ = Q(), _tmpQ2 = Q(), _tmpV = V(), _tmpV2 = V();
function rotateWorld(bone, q) { // بيلف العضمة لفّة في إحداثيات العالم
  const pq = bone.parent.getWorldQuaternion(_tmpQ).invert();
  const wq = bone.getWorldQuaternion(_tmpQ2);
  bone.quaternion.copy(pq.multiply(q.clone().multiply(wq)));
  bone.updateMatrixWorld(true);
}
function aim(bone, child, target) { // بيوجّه العضمة علشان اللي بعدها يروح ناحية الهدف
  const a = bone.getWorldPosition(V()), c = child.getWorldPosition(V());
  const d0 = c.sub(a).normalize(), d1 = target.clone().sub(a).normalize();
  if (d0.lengthSq() < 1e-8 || d1.lengthSq() < 1e-8) return;
  rotateWorld(bone, Q().setFromUnitVectors(d0, d1));
}
// IK بعضمتين: الكوع بيتحسب من طول العضمتين واتجاه الـ pole
function twoBone(upper, lower, end, L1, L2, target, pole) {
  const a = upper.getWorldPosition(V());
  const t = target.clone().sub(a);
  const d = clamp(t.length(), Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.999);
  const dir = t.normalize();
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const perp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0); perp.normalize();
  const elbow = a.clone().add(dir.clone().multiplyScalar(cosA * L1)).add(perp.multiplyScalar(sinA * L1));
  aim(upper, lower, elbow);
  aim(lower, end, a.clone().add(dir.multiplyScalar(d)));
}

// ---------- تجهيز الشخصية ----------
export function setupRig(ch) {
  const b = (n) => ch.bone(n);
  const R = { ch, rest: new Map(), side: {} };
  ch.root.updateMatrixWorld(true);
  ch.root.traverse((o) => { if (o.isBone) R.rest.set(o, o.quaternion.clone()); });
  R.hips = b("Hips"); R.hipsRest = R.hips.position.clone();
  R.spine = [b("Spine"), b("Spine1"), b("Spine2")].filter(Boolean);
  R.neck = b("Neck"); R.head = b("Head");
  const rot0 = ch.root.rotation.y; ch.root.rotation.y = 0; ch.root.position.set(0, 0, 0); ch.root.updateMatrixWorld(true);
  const wp = (o) => o.getWorldPosition(V());
  R.hipsW0 = wp(R.hips); // مكان الوسط في الوضع الأصلي (والشخصية واقفة في النص ووشها لـ +Z)
  R.k = ch.height / 1.7;
  for (const S of ["Left", "Right"]) {
    const s = { sign: S === "Left" ? 1 : -1 };
    s.clav = b(S + "Shoulder"); s.arm = b(S + "Arm"); s.fore = b(S + "ForeArm"); s.hand = b(S + "Hand");
    s.up = b(S + "UpLeg"); s.leg = b(S + "Leg"); s.foot = b(S + "Foot"); s.toe = b(S + "ToeBase");
    s.La = wp(s.arm).distanceTo(wp(s.fore)); s.Lf = wp(s.fore).distanceTo(wp(s.hand));
    s.Lu = wp(s.up).distanceTo(wp(s.leg)); s.Ll = wp(s.leg).distanceTo(wp(s.foot));
    s.ankleH = wp(s.foot).y; s.footX = wp(s.foot).x; s.toeLen = s.toe ? wp(s.toe).distanceTo(wp(s.foot)) : 0.12;
    s.fingers = ["Index", "Middle", "Ring", "Pinky", "Thumb"].map((f) => [1, 2, 3].map((i) => b(`${S}Hand${f}${i}`)).filter(Boolean));
    // اتجاه الكف في الوضع الأصلي (علشان نعرف "وش" الكف من مكان الصوابع)
    const m = s.fingers[1][0], ix = s.fingers[0][0], pk = s.fingers[3][0];
    if (m && ix && pk) {
      const fwd = wp(m).sub(wp(s.hand)).normalize(), acr = wp(ix).sub(wp(pk)).normalize();
      // الكف في T-pose بيبص لتحت: بنختار الإشارة اللي تخلّي (الصوابع × العرض) يطلع لتحت
      s.normSign = -(Math.sign(fwd.clone().cross(acr).y) || 1);
    }
    R.side[S] = s;
  }
  R.legLen = R.side.Left.Lu + R.side.Left.Ll;
  R.chestRestLocal = R.spine[R.spine.length - 1].getWorldQuaternion(Q()); // اتجاه الصدر في الوضع الأصلي (والجذر من غير لف)
  ch.root.rotation.y = rot0; ch.root.updateMatrixWorld(true);
  return R;
}

// ---------- الأداء: وضعيات مربوطة بالوقت ← قيم أرقام بتتدمج بنعومة ----------
// key = { t, dur, ease, body, head, l_arm, r_arm, l_hand, r_hand, motion, move_to:[x,z], face, emote }
function armParams(name, k) {
  const a = ARMS[name] || ARMS.rest;
  return { p: a.p.map((x) => x * k), pole: a.pole, palm: a.palm, fing: a.fing || null, hand: HANDS[a.hand] || HANDS.relaxed, motion: a.motion || null };
}
function keyParams(key, k) {
  const body = { lean: 0, side: 0, turn: 0, crouch: 0, shoulders: 0, sit: 0, jump: 0, ...(BODY[key.body] || {}), ...(key.body_adjust || {}) };
  const head = { yaw: 0, pitch: 0, tilt: 0, look: null, ...(HEAD[key.head] || {}) };
  const L = armParams(key.l_arm, k), Rr = armParams(key.r_arm, k);
  if (key.l_hand && HANDS[key.l_hand]) L.hand = HANDS[key.l_hand];
  if (key.r_hand && HANDS[key.r_hand]) Rr.hand = HANDS[key.r_hand];
  return { body, head, L, R: Rr, motion: key.motion || "none" };
}
const lerpArr = (a, b, p) => a.map((x, i) => lerp(x, b[i], p));
function blendParams(A, B, p) {
  const o = { body: {}, head: {}, motion: p < 0.5 ? A.motion : B.motion };
  for (const k in B.body) o.body[k] = lerp(A.body[k] || 0, B.body[k] || 0, p);
  for (const k of ["yaw", "pitch", "tilt"]) o.head[k] = lerp(A.head[k] || 0, B.head[k] || 0, p);
  o.head.lookW = lerp(A.head.look ? 1 : 0, B.head.look ? 1 : 0, p);
  for (const S of ["L", "R"]) o[S] = { p: lerpArr(A[S].p, B[S].p, p), pole: lerpArr(A[S].pole, B[S].pole, p), palm: lerpArr(A[S].palm, B[S].palm, p),
    fing: A[S].fing || B[S].fing ? lerpArr(A[S].fing || [0, 0, 0], B[S].fing || [0, 0, 0], p) : null, fingW: lerp(A[S].fing ? 1 : 0, B[S].fing ? 1 : 0, p),
    hand: lerpArr(A[S].hand, B[S].hand, p), motion: p < 0.5 ? A[S].motion : B[S].motion };
  return o;
}
const EASE = {
  smooth: (x) => smooth(x), snap: (x) => 1 - Math.pow(1 - clamp(x), 4), slow: (x) => smooth(smooth(x)),
  overshoot: (x) => { x = clamp(x); const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
};

export function buildPerformance(keys, k, PACE = 1) {
  const ks = keys.map((x) => ({ ...x, P: keyParams(x, k), dur: (x.dur || (x.ease === "snap" ? 0.28 : x.ease === "slow" ? 0.9 : 0.5)) * PACE }));
  ks.sort((a, b) => a.t - b.t);
  // الوضعية في لحظة t: آخر وضعية بدأت بتتدمج من اللي قبلها
  return (t) => {
    let i = 0; ks.forEach((x, j) => { if (t >= x.t) i = j; });
    const cur = ks[i], prev = ks[i - 1];
    if (!prev || t < cur.t) return { P: cur.P, key: cur, since: Math.max(0, t - cur.t), trans: 1 };
    const raw = (t - cur.t) / cur.dur, p = (EASE[cur.ease] || EASE.smooth)(raw);
    return { P: blendParams(prev.P, cur.P, p), key: cur, since: t - cur.t, trans: clamp(raw) };
  };
}

// ---------- تطبيق الوضعية على العضم ----------
// st = { P (قيم الوضعية), rootPos, face (راديان), walk: {phase, speed} , camPos, speaking, wordPulse, t, seat }
export function applyPose(R, st) {
  const { ch } = R, P = st.P, t = st.t, k = R.k, B = P.body;
  // 1) رجوع للوضع الأصلي
  for (const [bone, q] of R.rest) bone.quaternion.copy(q);
  R.hips.position.copy(R.hipsRest);
  ch.root.position.set(st.rootPos.x, 0, st.rootPos.z);
  ch.root.rotation.y = st.face;
  ch.root.updateMatrixWorld(true);
  const rootQ = ch.root.getWorldQuaternion(Q());
  const toW = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(rootQ); // من إحداثيات الشخصية للعالم (اتجاه)
  const at = (x, y, z) => toW(x, y, z).add(ch.root.position);                 // نقطة
  const motion = P.motion;

  // 2) الوسط: قرفصة/قعدة/نطّة + نفَس + تمايل + مشي
  const breathe = Math.sin(t * 2 * Math.PI / (motion === "breathe_heavy" ? 1.6 : 3.6));
  const sway = noise(t * 0.35, 3) * 0.018 * k;
  const walkBob = st.walk ? -Math.abs(Math.cos(st.walk.phase * Math.PI)) * 0.035 * k * st.walk.amt : 0;
  const bounce = motion === "bounce" ? Math.abs(Math.sin(t * 7)) * 0.05 * k : 0;
  const laugh = motion === "laugh" ? Math.abs(Math.sin(t * 11)) * 0.015 * k : 0;
  const jumpY = B.jump ? Math.sin(clamp(B.jump) * Math.PI) * 0.0 : 0;
  const sitDrop = (R.hipsW0.y - (st.seat ? st.seat.h + 0.09 * k : R.hipsW0.y * 0.55)) * smooth(B.sit);
  const crouchDrop = R.hipsW0.y * 0.42 * B.crouch;
  const hipsH = R.hipsW0.y - sitDrop - crouchDrop + walkBob + bounce + laugh + jumpY + breathe * 0.003 * k;
  // في القعدة الوسط بيرجع لورا ناحية الكرسي
  const hipsBack = (st.seat ? st.seat.back : 0.12 * k) * smooth(B.sit);
  const hipsW = at(R.hipsW0.x + sway, hipsH, R.hipsW0.z - hipsBack);
  R.hips.position.copy(R.hips.parent.worldToLocal(hipsW.clone()));
  R.hips.updateMatrixWorld(true);
  // ميلان الحوض الخفيف مع الجسم
  rotateWorld(R.hips, Q().setFromAxisAngle(toW(1, 0, 0), (B.lean * 0.25 + (st.walk ? 4 * st.walk.amt : 0)) * D));

  // 3) الرجلين: IK على الأرض (أو على الكرسي في القعدة)
  for (const S of ["Left", "Right"]) {
    const s = R.side[S]; if (!s.up || !s.leg || !s.foot) continue;
    const sgn = s.sign;
    let fx = s.footX * (1 + B.crouch * 0.4), fz = 0.02 * k, fy = s.ankleH;
    // في القعدة الرجلين بيفضلوا قدام الكرسي (مكان الوقوف تقريبًا) والركبة بتتني
    if (B.sit > 0) { fz = lerp(fz, (st.seat ? 0.06 : 0.36) * k, smooth(B.sit)); fx = lerp(fx, s.footX * 1.2, B.sit); }
    if (st.walk && st.walk.amt > 0) { // دورة مشي: الرجل ثابتة على الأرض نص الدورة، وبتتنقل لقدام بقوس في النص التاني
      const u = ((st.walk.phase + (sgn > 0 ? 0 : 1)) % 2) / 2, stride = 0.62 * k * st.walk.amt;
      if (u < 0.5) fz += stride * (0.25 - u);
      else { const v = (u - 0.5) * 2; fz += stride * (-0.25 + v * 0.5); fy += Math.sin(v * Math.PI) * 0.11 * k * st.walk.amt; }
    }
    if (B.jump) fy += Math.sin(clamp(B.jump) * Math.PI) * 0;
    const target = at(fx, fy, fz);
    const pole = toW(sgn * 0.12, 0, 1).normalize();
    twoBone(s.up, s.leg, s.foot, s.Lu, s.Ll, target, pole);
    // الرجل مفرودة على الأرض ووشها لقدام
    if (s.toe) aim(s.foot, s.toe, at(fx * 1.02, Math.max(0.02 * k, fy - s.ankleH + 0.02 * k), fz + s.toeLen));
  }

  // 4) العمود الفقري: ميلان + لفّة + ميلان جانبي (موزّعين على 3 فقرات) + نفَس + حركات
  let lean = B.lean + breathe * 0.8 + (motion === "laugh" ? Math.sin(t * 11) * 3 : 0) + (motion === "cry" ? Math.sin(t * 9) * 1.5 : 0);
  let turn = B.turn + (st.walk ? Math.sin(st.walk.phase * Math.PI) * 5 * st.walk.amt : 0) + noise(t * 0.3, 7) * 1.5;
  const side = B.side + noise(t * 0.27, 11) * 1.2;
  for (const sp of R.spine) {
    const n = R.spine.length;
    rotateWorld(sp, Q().setFromAxisAngle(toW(0, 1, 0), (turn / n) * D));
    rotateWorld(sp, Q().setFromAxisAngle(toW(1, 0, 0), (lean / n) * D));
    rotateWorld(sp, Q().setFromAxisAngle(toW(0, 0, 1), (-side / n) * D));
  }
  // الكتفين: رفع (هزّ الكتف) أو تهدّل
  const shrugUp = B.shoulders + (motion === "cry" ? Math.abs(Math.sin(t * 9)) * 0.3 : 0) + (motion === "laugh" ? Math.abs(Math.sin(t * 11)) * 0.2 : 0);
  for (const S of ["Left", "Right"]) { const s = R.side[S]; if (s.clav) rotateWorld(s.clav, Q().setFromAxisAngle(toW(0, 0, 1), -s.sign * shrugUp * 12 * D)); }

  // 5) الراس والرقبة: اتجاه + بصّة للكاميرا + إيماءات
  const H = P.head;
  let yaw = H.yaw, pitch = H.pitch, tilt = H.tilt;
  if (H.lookW > 0 && st.camPos && R.head) {
    const hp = R.head.getWorldPosition(V()), dirW = st.camPos.clone().sub(hp);
    const loc = dirW.applyQuaternion(rootQ.clone().invert());
    const cy = Math.atan2(loc.x, loc.z) / D, cp = -Math.atan2(loc.y, Math.hypot(loc.x, loc.z)) / D;
    yaw = lerp(yaw, clamp(cy - turn, -75, 75), H.lookW); pitch = lerp(pitch, clamp(cp + lean * 0.6, -35, 40), H.lookW);
  }
  if (motion === "nod") pitch += Math.sin(t * 7) * 9;
  if (motion === "shake") yaw += Math.sin(t * 9) * 16;
  if (motion === "look_around") { yaw += Math.sin(t * 1.3) * 45; pitch += Math.sin(t * 0.9) * 6; }
  if (motion === "tremble") { yaw += Math.sin(t * 31) * 2; pitch += Math.sin(t * 27) * 2; }
  if (st.speaking) pitch += (st.wordPulse || 0) * 5 + Math.sin(t * 3.1) * 1.2; // إيماءة صغيرة مع كل كلمة
  yaw += noise(t * 0.6, 21) * 2.2; pitch += noise(t * 0.5, 23) * 1.6 - lean * 0.45; tilt += noise(t * 0.4, 29) * 1.5;
  for (const [bone, w] of [[R.neck, 0.4], [R.head, 0.6]]) {
    if (!bone) continue;
    rotateWorld(bone, Q().setFromAxisAngle(toW(0, 1, 0), yaw * w * D));
    rotateWorld(bone, Q().setFromAxisAngle(toW(1, 0, 0), pitch * w * D));
    rotateWorld(bone, Q().setFromAxisAngle(toW(0, 0, 1), -tilt * w * D));
  }

  // 6) الدراعين: IK لمكان الإيد (بالنسبة للصدر بعد الميلان) + حركات + اتجاه الكف + الصوابع
  const chest = R.spine[R.spine.length - 1];
  const chestQ = chest.getWorldQuaternion(Q());
  const chestRestQ = rootQ.clone().multiply(R.chestRestLocal);
  const chestDelta = chestQ.clone().multiply(chestRestQ.clone().invert());
  for (const [S, key] of [["Left", "L"], ["Right", "R"]]) {
    const s = R.side[S], A = P[key]; if (!s.arm || !s.fore || !s.hand) continue;
    const sgn = s.sign;
    let [x, y, z] = A.p;
    // أرجحة الدراع مع المشي (عكس الرجل)
    if (st.walk && st.walk.amt > 0 && (A.p[1] < -0.45 * k)) z += Math.sin(st.walk.phase * Math.PI + (sgn > 0 ? Math.PI : 0)) * 0.16 * k * st.walk.amt;
    const m = A.motion;
    if (m === "wave") { x += Math.sin(t * 9) * 0.09 * k; }
    if (m === "pump") { y += Math.abs(Math.sin(t * 6)) * 0.12 * k; }
    if (m === "shake") { x += Math.sin(t * 17) * 0.025 * k; y += Math.sin(t * 19) * 0.02 * k; }
    if (m === "scratch") { x += Math.sin(t * 14) * 0.02 * k; }
    if (m === "type") { y += Math.abs(Math.sin(t * 13 + sgn)) * 0.012 * k; }
    if (m === "beat" || (st.speaking && A.p[2] > 0.25 * k)) y += (st.wordPulse || 0) * 0.04 * k; // الإيد بتنبض مع الكلام
    y += breathe * 0.004 * k;
    const shoulder = s.arm.getWorldPosition(V());
    const off = new THREE.Vector3(x * sgn, y, z).applyQuaternion(rootQ).applyQuaternion(chestDelta);
    const target = shoulder.clone().add(off);
    const pole = new THREE.Vector3(A.pole[0] * sgn, A.pole[1], A.pole[2]).applyQuaternion(rootQ).applyQuaternion(chestDelta).normalize();
    twoBone(s.arm, s.fore, s.hand, s.La, s.Lf, target, pole);
    // اتجاه الكف والصوابع
    const f1 = s.fingers[1] && s.fingers[1][0], ix = s.fingers[0] && s.fingers[0][0], pk = s.fingers[3] && s.fingers[3][0];
    if (f1 && ix && pk) {
      const hw = s.hand.getWorldPosition(V());
      const foreDir = hw.clone().sub(s.fore.getWorldPosition(V())).normalize();
      const fingDesired = A.fing && A.fingW > 0.01
        ? foreDir.clone().lerp(new THREE.Vector3(A.fing[0] * sgn, A.fing[1], A.fing[2]).applyQuaternion(rootQ).applyQuaternion(chestDelta).normalize(), A.fingW).normalize()
        : foreDir;
      const cur = f1.getWorldPosition(V()).sub(hw).normalize();
      rotateWorld(s.hand, Q().setFromUnitVectors(cur, fingDesired));
      const fwd = f1.getWorldPosition(V()).sub(hw).normalize();
      const acr = ix.getWorldPosition(V()).sub(pk.getWorldPosition(V())).normalize();
      const normal = fwd.clone().cross(acr).multiplyScalar(s.normSign).normalize();
      const want = new THREE.Vector3(A.palm[0] * sgn, A.palm[1], A.palm[2]).applyQuaternion(rootQ).applyQuaternion(chestDelta);
      want.sub(fwd.clone().multiplyScalar(want.dot(fwd)));
      if (want.lengthSq() > 1e-4) {
        want.normalize();
        const ang = Math.atan2(normal.clone().cross(want).dot(fwd), normal.dot(want));
        rotateWorld(s.hand, Q().setFromAxisAngle(fwd, ang));
      }
      // الصوابع: انثناء ناحية الكف
      const fwd2 = f1.getWorldPosition(V()).sub(s.hand.getWorldPosition(V())).normalize();
      const acr2 = ix.getWorldPosition(V()).sub(pk.getWorldPosition(V())).normalize();
      const palmN = fwd2.clone().cross(acr2).multiplyScalar(s.normSign).normalize();
      s.fingers.forEach((chain, fi) => {
        const ang = A.hand[fi] * D;
        chain.forEach((bone, ji) => {
          const nxt = chain[ji + 1] || (bone.children.find((c) => c.isBone));
          if (!nxt) return;
          const dir = nxt.getWorldPosition(V()).sub(bone.getWorldPosition(V())).normalize();
          const axis = fi === 4 ? palmN.clone() : dir.clone().cross(palmN).normalize();
          const a = fi === 4 ? -ang * 0.5 * sgn : ang * (ji === 0 ? 0.8 : 1);
          if (axis.lengthSq() > 1e-6) rotateWorld(bone, Q().setFromAxisAngle(axis, a));
        });
      });
    }
  }
  ch.root.updateMatrixWorld(true);
}

export { MOTIONS };
