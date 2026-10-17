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
const HIP_BACK = 0.15; // تقدير أولي، والتوازن الفعلي بيتظبط بالقياس // قد إيه الوسط بيرجع لورا مع ميلة الصدر (متر لكل sin الزاوية لشخص 1.7م)
// ضوضاء ناعمة حتمية (مجموع موجات بترددات مش متناسبة)
const noise = (t, s = 0) => Math.sin(t * 1.13 + s) * 0.5 + Math.sin(t * 2.71 + s * 1.7) * 0.3 + Math.sin(t * 0.47 + s * 2.3) * 0.2;

// ---------- وضعيات الدراع (مكان الإيد من مفصل الكتف بالمتر لشخص 1.7م) ----------
// x = لبره (بعيد عن الجسم، وسالب = عابر قدام الجسم)، y = لفوق، z = لقدام.
// pole = الكوع بيشاور فين، palm = الكف بيبص فين، fing = اتجاه الصوابع (لو مش مكمّلة الدراع)، hand = شكل الصوابع
export const ARMS = {
  rest:          { p: [0.06, -0.56, 0.04], pole: [0.2, 0, -1], palm: [-1, 0, 0], hand: "relaxed", clip: 1 }, // clip: الدراع الحر بيمشي مع الحركة المسجّلة لو فيه
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
// الرسغ بيلف اتجاه الصوابع من اتجاه الساعد a ناحية b بنسبة w.
// لو الاتجاهين قريبين من العكس (الدراع لتحت والصوابع المطلوبة لفوق) الاتجاه مش محدد، فبنثني ناحية الكف (زي الإيد الحقيقية)،
// والثنية محدودة ~95° (الرسغ مبيتنيش 180°)؛ الباقي بيكمّله الساعد وهو طالع
function bendDir(a, b, w, palm) {
  const cs = clamp(a.dot(b), -1, 1), d = b.clone().addScaledVector(a, -cs), sn = d.length();
  const pp = palm.clone().addScaledVector(a, -palm.dot(a));
  if (pp.lengthSq() > 1e-8) d.addScaledVector(pp.normalize(), 0.35 * smooth((0.45 - sn) / 0.45));
  if (d.lengthSq() < 1e-10) return a.clone();
  d.normalize();
  const cap = 95 * D, phi = cap * Math.tanh((Math.atan2(sn, cs) * w) / cap);
  return a.clone().multiplyScalar(Math.cos(phi)).addScaledVector(d, Math.sin(phi)).normalize();
}
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
// soft: الدراع قرب الفرد الكامل بيتفرد بنعومة (acos عند الفرد الكامل سرعته لانهائية، فالكوع كان بيتني فجأة أول ما الإيد تبدأ تطلع)
function twoBone(upper, lower, end, L1, L2, target, pole, soft = false) {
  const a = upper.getWorldPosition(V());
  const t = target.clone().sub(a);
  const Lm = L1 + L2, s0 = 0.86 * Lm, sw = 0.138 * Lm;
  const dRaw = soft && t.length() > s0 ? s0 + sw * Math.tanh((t.length() - s0) / sw) : t.length();
  const d = clamp(dRaw, Math.abs(L1 - L2) + 1e-3, Lm * 0.999);
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
    s.shX0 = wp(s.arm).x; s.shY0 = wp(s.arm).y; // مكان الكتف في الوقفة العادية (لحساب التوازن)
    s.Lu = wp(s.up).distanceTo(wp(s.leg)); s.Ll = wp(s.leg).distanceTo(wp(s.foot));
    s.ankleH = wp(s.foot).y; s.footX = wp(s.foot).x; s.toeLen = s.toe ? wp(s.toe).distanceTo(wp(s.foot)) : 0.12;
    s.toeH = s.toe ? wp(s.toe).y : 0.03 * R.k; // ارتفاع عضمة الصوابع فوق النعل في الوقفة العادية
    s.footQ0 = s.foot.getWorldQuaternion(Q());   // اتجاه الرجل وهي مفرودة على الأرض (الوضع الأصلي)
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
  // أوزان تقريبية لأجزاء الجسم (لحساب مركز الثقل)
  R.mass = Object.entries({ Hips: 0.14, Spine: 0.1, Spine1: 0.1, Spine2: 0.12, Neck: 0.03, Head: 0.07, LeftArm: 0.03, RightArm: 0.03, LeftForeArm: 0.02,
    RightForeArm: 0.02, LeftHand: 0.01, RightHand: 0.01, LeftUpLeg: 0.1, RightUpLeg: 0.1, LeftLeg: 0.045, RightLeg: 0.045 })
    .map(([n, w]) => [b(n), w]).filter(([bn]) => bn);
  // الموديل نفسه ممكن يكون نعله تحت/فوق الصفر بشوية: بنعدّل الارتفاع علشان النعل يقعد على الأرض بالظبط
  { let minY = Infinity; const v = V();
    ch.root.traverse((o) => { if (!o.isSkinnedMesh) return; const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 7) { o.getVertexPosition(i, v); o.localToWorld(v); if (v.y < minY) minY = v.y; } });
    R.ground = isFinite(minY) && Math.abs(minY) < 0.06 ? -minY : 0; }
  R.chestRestLocal = R.spine[R.spine.length - 1].getWorldQuaternion(Q()); // اتجاه الصدر في الوضع الأصلي (والجذر من غير لف)
  ch.root.rotation.y = rot0; ch.root.updateMatrixWorld(true);
  return R;
}

// ---------- الأداء: وضعيات مربوطة بالوقت ← قيم أرقام بتتدمج بنعومة ----------
// key = { t, dur, ease, body, head, l_arm, r_arm, l_hand, r_hand, motion, move_to:[x,z], face, emote }
function armParams(name, k) {
  const a = ARMS[name] || ARMS.rest;
  return { p: a.p.map((x) => x * k), pole: a.pole, palm: a.palm, fing: a.fing || null, hand: HANDS[a.hand] || HANDS.relaxed, motion: a.motion || null, clip: a.clip || 0 };
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
    fing: A[S].fing || B[S].fing ? lerpArr(A[S].fing || [0, 0, 0], B[S].fing || [0, 0, 0], p) : null, fingW: lerp(A[S].fing ? 1 : 0, B[S].fing ? 1 : 0, A[S].fing ? p : smooth((p - 0.15) / 0.85)), // الرسغ بيبدأ يتني بعد ما الدراع يبدأ يطلع
    hand: lerpArr(A[S].hand, B[S].hand, p), motion: p < 0.5 ? A[S].motion : B[S].motion, clip: lerp(A[S].clip || 0, B[S].clip || 0, p) };
  return o;
}
// كل المنحنيات بتبدأ وتخلص بسرعة صفر (مفيش حركة بتبدأ فجأة بسرعتها الكاملة):
// smooth عادي، snap سريع حاد (أقصر وأقوى في النص)، slow تقيل، overshoot بيعدّي الهدف سنة ويرجع بنعومة
const smoother = (x) => (x = clamp(x), x * x * x * (x * (x * 6 - 15) + 10));
const EASE = {
  smooth: (x) => smooth(x), snap: (x) => smoother(clamp(x * 1.25)), slow: (x) => smooth(smooth(x)),
  overshoot: (x) => { x = clamp(x); return smoother(x) + Math.sin(Math.PI * x) * Math.sin(Math.PI * x) * Math.sin(Math.PI * x * 0.5) * 0.09; },
};

export function buildPerformance(keys, k, PACE = 1) {
  // الانتقال بين وضعيتين رزين: حوالي 0.8 ثانية (والحادة 0.45 بس للحظات القوية)
  const ks = keys.map((x) => ({ ...x, P: keyParams(x, k), dur: (x.dur || (x.ease === "snap" ? 0.45 : x.ease === "slow" ? 1.2 : 0.8)) * PACE }));
  ks.sort((a, b) => a.t - b.t);
  // الوضعية في لحظة t: آخر وضعية بدأت بتتدمج من اللي قبلها
  return (t) => {
    let i = 0; ks.forEach((x, j) => { if (t >= x.t) i = j; });
    const cur = ks[i], prev = ks[i - 1];
    if (!prev || t < cur.t) return { P: cur.P, key: cur, prev: cur, since: Math.max(0, t - cur.t), trans: 1 };
    const raw = (t - cur.t) / cur.dur, p = (EASE[cur.ease] || EASE.smooth)(raw);
    return { P: blendParams(prev.P, cur.P, p), key: cur, prev, since: t - cur.t, trans: clamp(raw) };
  };
}

const sgnOf = (s) => s.sign;
// ثني الصوابع (مشترك بين الوضعيات والمسك): curls = [سبابة، وسطى، بنصر، خنصر، إبهام عبر الكف، (معاكسة الإبهام اختياري)].
// المعاكسة بتلف الإبهام ناحية وش الكف (زي ما بنمسك كوباية)، والثني عبر الكف بعدها.
export function poseFingers(s, curls, sgn) {
  const palmN = s.palmN, hw = s.hand.getWorldPosition(V());
  const fwd = s.fingers[1] && s.fingers[1][0] ? s.fingers[1][0].getWorldPosition(V()).sub(hw).normalize() : V();
  s.fingers.forEach((chain, fi) => {
    if (!chain || !chain.length) return;
    const ang = (curls[fi] || 0) * D;
    if (fi === 4 && curls[5]) { // معاكسة: لفّة حوالين اتجاه الإيد ناحية وش الكف
      const tp = chain[chain.length - 1].getWorldPosition(V()).sub(chain[0].getWorldPosition(V()));
      const dirSign = Math.sign(fwd.clone().cross(tp).dot(palmN)) || 1;
      rotateWorld(chain[0], Q().setFromAxisAngle(fwd, curls[5] * D * dirSign));
    }
    // محور الثني واحد للصباع كله (مفصلة)، بيتحسب من أوله قبل ما يتني (لو اتحسب من كل عقلة بعد الثني بيتقلب في القفلة الكاملة)
    const n0 = chain[1] || chain[0].children.find((c) => c.isBone);
    const baseDir = n0 ? n0.getWorldPosition(V()).sub(chain[0].getWorldPosition(V())).normalize() : fwd.clone();
    const hinge = baseDir.clone().cross(palmN).normalize();
    chain.forEach((bone, ji) => {
      const nxt = chain[ji + 1] || (bone.children.find((c) => c.isBone));
      if (!nxt) return;
      const axis = fi === 4 ? palmN.clone() : hinge;
      const a = fi === 4 ? -ang * 0.5 * sgn : ang * (ji === 0 ? 0.8 : 1);
      if (axis.lengthSq() > 1e-6) rotateWorld(bone, Q().setFromAxisAngle(axis, a));
    });
  });
}
// ---------- تطبيق الوضعية على العضم ----------
// st = { P (قيم الوضعية), rootPos, face (راديان), walk: {phase, speed} , camPos, speaking, wordPulse, t, seat }
export function applyPose(R, st) {
  const { ch } = R, P = st.P, t = st.t, k = R.k, B = P.body;
  // 1) رجوع للأساس: الحركة المسجّلة (st.base من clips.js) لو موجودة، وإلا الوضع الأصلي.
  // الدراعين والصوابع بيبدأوا من الوضع الأصلي (الـ IK بيحطهم)، وفي الآخر بيتدمجوا مع الحركة المسجّلة بوزن الدراع الحر
  const BQ = st.base && st.base.q, baseW = BQ ? clamp(st.baseW ?? 1) : 0;
  if (!R.armSet) { R.armSet = new Set(); for (const S of ["Left", "Right"]) { const s = R.side[S]; [s.arm, s.fore, s.hand, ...(s.fingers || []).flat()].forEach((b) => b && R.armSet.add(b)); } }
  for (const [bone, q] of R.rest) bone.quaternion.copy(BQ && !R.armSet.has(bone) && BQ.get(bone) ? q.clone().slerp(BQ.get(bone), baseW) : q);
  R.hips.position.copy(R.hipsRest);
  ch.root.position.set(st.rootPos.x, R.ground || 0, st.rootPos.z);
  ch.root.rotation.y = st.face;
  ch.root.updateMatrixWorld(true);
  const rootQ = ch.root.getWorldQuaternion(Q());
  const toW = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(rootQ); // من إحداثيات الشخصية للعالم (اتجاه)
  const at = (x, y, z) => toW(x, y, z).add(ch.root.position);                 // نقطة
  const motion = P.motion;

  // 2) الوسط: قرفصة/قعدة/نطّة + نفَس + تمايل + مشي
  // الطاقة (0 = سكون هادي، 1 = توتر): بتتحكم في النفَس وكمية الحياة في الوقفة
  const E = st.energy ?? 0.5, life = 0.45 + E * 0.75;
  const breathe = Math.sin(t * 2 * Math.PI / (motion === "breathe_heavy" ? 1.6 : lerp(4.2, 2.8, E)));
  // نقل الوزن: بيقف على رجل شوية وبعدين ينقل للتانية بنعومة (مش تمايل عشوائي)
  const wsRaw = Math.tanh(2.6 * Math.sin((2 * Math.PI * t) / lerp(7.5, 4.5, E) + (st.seed || 0)));
  // وهي بتمد إيدها نقل الوزن بيهدى بالتدريج (مش مرة واحدة)
  const wReach = Math.max(0, ...Object.values(st.reach || {}).map((r) => (r && r.w) || 0));
  const ws = wsRaw * (1 - smooth((st.walk && st.walk.amt) || 0)) * lerp(1, 0.3, smooth(wReach / 0.5));
  // لو فيه حركة مسجّلة تحت، هي اللي بتدّي التمايل والنفَس؛ الإجرائي بيقل علشان ما يتضاعفش
  const procIdle = 1 - 0.75 * baseW;
  const sway = ws * 0.03 * k * life * procIdle;
  const bh = BQ && st.base.hips ? st.base.hips.clone().multiplyScalar(baseW) : V();
  // التوازن: لو الإيد رايحة لقدام بعيد أو لتحت، الصدر بيميل والوسط بيرجع لورا بنسبة ثابتة (مركز الثقل يفضل فوق الرجلين)،
  // ولو الميلة كبيرة الركب بتتني شوية. الميلة المطلوبة بتتحسب بالقياس (مش بتقدير)، وبمنحنى ناعم علشان ما يحصلش وقوف مفاجئ.
  const add = st.bodyAdd || {};
  const softplus = (x, e) => (x + Math.sqrt(x * x + e * e)) / 2; // max(0, x) بس ناعمة
  const walkBob = st.walk ? -Math.abs(Math.cos(st.walk.phase * Math.PI)) * 0.035 * k * st.walk.amt : 0;
  const bounce = motion === "bounce" ? Math.abs(Math.sin(t * 7)) * 0.05 * k : 0;
  const laugh = motion === "laugh" ? Math.abs(Math.sin(t * 11)) * 0.015 * k : 0;
  const sitDrop = (R.hipsW0.y - (st.seat ? st.seat.h + 0.09 * k : R.hipsW0.y * 0.55)) * smooth(B.sit);
  const hipsBack = (st.seat ? st.seat.back : 0.12 * k) * smooth(B.sit); // في القعدة الوسط بيرجع لورا ناحية الكرسي
  const bal = { crouch: 0 };
  let reachLean = 0, leanAll = B.lean + (add.lean || 0), comShift = 0, reachCrouch = 0;
  // الحاجة الواطية (تحت مستوى الوسط) بتخلّي الركب تتني شوية من أول المد وبالتدريج
  for (const r of Object.values(st.reach || {})) {
    if (!r || !(r.w > 0)) continue;
    const y = r.point.y - ch.root.position.y;
    reachCrouch = Math.max(reachCrouch, smooth((1.05 * k - y) / (0.7 * k)) * 0.26 * smooth(r.w));
  }
  // مركز الثقل الأفقي في إحداثيات الشخصية (z لقدام)
  const comLocalZ = () => { const c = V(); let m = 0; for (const [bn, w] of R.mass) { c.add(bn.getWorldPosition(V()).multiplyScalar(w)); m += w; }
    return c.divideScalar(m).sub(ch.root.position).applyQuaternion(rootQ.clone().invert()).z; };
  // المنطقة المريحة لمركز الثقل فوق الرجل (من قرب الكعب لقبل الصوابع): جواها ما بنصلّحش، وبره بنرجّعه بنعومة
  const comLo = -0.02 * k, comHi = 0.09 * k;
  const comErr = (z) => { const lo = z - comLo, hi = z - comHi; return (hi + Math.sqrt(hi * hi + 1e-4)) / 2 - (-lo + Math.sqrt(lo * lo + 1e-4)) / 2; };
  let turn = B.turn + (add.turn || 0) + (st.walk ? Math.sin(st.walk.phase * Math.PI) * 5 * st.walk.amt : 0) + noise(t * 0.3, 7) * 1.5 * life;
  const side = B.side + (add.side || 0) - ws * 1.6 * life + noise(t * 0.27, 11) * 0.8 * life;
  const extraLean = () => (motion === "laugh" ? Math.sin(t * 11) * 3 : 0) + (motion === "cry" ? Math.sin(t * 9) * 1.5 : 0) + breathe * 0.8;
  const placeHips = () => {
    const L = leanAll + reachLean;
    bal.crouch = reachCrouch; // ثني الركب حسب وطاية الحاجة (مش حسب الميلة)
    const back = Math.sin(Math.max(0, L) * D) * HIP_BACK * k + comShift;
    const crouchDrop = R.hipsW0.y * 0.42 * (B.crouch + bal.crouch + (add.crouch || 0));
    const hipsH = R.hipsW0.y - sitDrop - crouchDrop + walkBob + bounce + laugh + breathe * 0.003 * k;
    R.hips.quaternion.copy(BQ && BQ.get(R.hips) ? R.rest.get(R.hips).clone().slerp(BQ.get(R.hips), baseW) : R.rest.get(R.hips));
    const hipsW = at(R.hipsW0.x + sway + bh.x + (add.shiftX || 0), hipsH + bh.y, R.hipsW0.z - hipsBack - back + bh.z * 0.5 + (add.shiftZ || 0));
    R.hips.position.copy(R.hips.parent.worldToLocal(hipsW.clone()));
    R.hips.updateMatrixWorld(true);
    rotateWorld(R.hips, Q().setFromAxisAngle(toW(1, 0, 0), (L * 0.25 + (st.walk ? 4 * st.walk.amt : 0)) * D)); // ميلان الحوض مع الجسم
    rotateWorld(R.hips, Q().setFromAxisAngle(toW(0, 0, 1), ws * 3.2 * life * procIdle * D)); // الحوض بيميل ناحية الرجل اللي مش شايلة الوزن
  };
  const applySpine = (L) => {
    for (const sp of R.spine) { sp.quaternion.copy(BQ && BQ.get(sp) ? R.rest.get(sp).clone().slerp(BQ.get(sp), baseW) : R.rest.get(sp)); }
    R.spine[0].updateMatrixWorld(true);
    for (const sp of R.spine) {
      const n = R.spine.length;
      rotateWorld(sp, Q().setFromAxisAngle(toW(0, 1, 0), (turn / n) * D));
      rotateWorld(sp, Q().setFromAxisAngle(toW(1, 0, 0), (L / n) * D));
      rotateWorld(sp, Q().setFromAxisAngle(toW(0, 0, 1), (-side / n) * D));
    }
  };
  // 4) الوسط والعمود الفقري مع بعض: 4 تكرارات ثابتة (من غير شروط وقوف) فالنتيجة ناعمة مع الوقت
  const reaches = Object.entries(st.reach || {}).filter(([, r]) => r && r.w > 0);
  // تأثير التصحيح بيزيد بنعومة مع الميلة (من غير عتبات تقطع الحركة فجأة)
  const balW = () => smooth((Math.max(Math.abs(leanAll), reachLean) - 1.5) / 6);
  const leaning = true;
  for (let it = 0; it < 6; it++) {
    placeHips();
    applySpine(leanAll + reachLean + extraLean());
    if (!leaning) break;
    // التوازن بالقياس: الوسط بيتزحزح لحد ما مركز الثقل يبقى فوق الرجلين
    if (it > 0) comShift += comErr(comLocalZ()) * 0.85;
    if (!reaches.length) continue;
    let deficit = -Infinity;
    for (const [kk, r] of reaches) {
      const sd = R.side[kk === "L" ? "Left" : "Right"]; if (!sd || !sd.arm) continue;
      const d = sd.arm.getWorldPosition(V()).distanceTo(r.point) - (sd.La + sd.Lf) * 0.94; // جوه المدى اللي الدراع فيه بيوصل الهدف بالظبط (الفرد الناعم)
      deficit = Math.max(deficit, d * clamp(r.w));
    }
    reachLean = Math.min(65, softplus(reachLean + (deficit / (0.42 * k)) / D, 3));
  }
  // الميلة بتبدأ من صفر مع بداية المد (مش قفزة صغيرة لما المد يظهر)
  // الصدر بيميل مع حركة الإيد نفسها (مش يخلّص الميلة الأول): الميلة بتمشي مع وزن المد
  if (reaches.length) { const wmax = Math.max(...reaches.map(([, r]) => r.w)); reachLean *= smooth(wmax); placeHips(); applySpine(leanAll + reachLean + extraLean()); }
  let lean = leanAll + reachLean + extraLean();
  R._dbg = { reachLean: +reachLean.toFixed(2), comShift: +comShift.toFixed(4), crouch: +bal.crouch.toFixed(4), leanAll: +leanAll.toFixed(2), ws: +ws.toFixed(3) };
  // الكتفين: رفع (هزّ الكتف) أو تهدّل
  const shrugUp = B.shoulders + (motion === "cry" ? Math.abs(Math.sin(t * 9)) * 0.3 : 0) + (motion === "laugh" ? Math.abs(Math.sin(t * 11)) * 0.2 : 0);
  for (const S of ["Left", "Right"]) { const s = R.side[S]; if (s.clav) rotateWorld(s.clav, Q().setFromAxisAngle(toW(0, 0, 1), -s.sign * shrugUp * 12 * D)); }

  // 3) الرجلين (بتتحل بعد العمود الفقري: في هيكل Biped الفخدين متعلقين في الفقرات، فأي ميلة كانت بتشيلهم معاها): IK على الأرض (أو على الكرسي في القعدة)
  const solveLegs = () => {
    for (const S of ["Left", "Right"]) {
      const s = R.side[S]; if (!s.up || !s.leg || !s.foot) continue;
      const sgn = s.sign;
      let fx = s.footX * (1 + (B.crouch + bal.crouch) * 0.4) + (st.stance ? sgn * st.stance * k : 0), fz = 0.02 * k + (st.footZ ? st.footZ[sgn > 0 ? 0 : 1] * k : 0), fy = s.ankleH;
      // في القعدة الرجلين بيفضلوا قدام الكرسي (مكان الوقوف تقريبًا) والركبة بتتني
      if (B.sit > 0) { fz = lerp(fz, (st.seat ? 0.06 : 0.36) * k, smooth(B.sit)); fx = lerp(fx, s.footX * 1.2, B.sit); }
      if (st.walk && st.walk.amt > 0) { // دورة مشي: الرجل ثابتة على الأرض نص الدورة، وبتتنقل لقدام بقوس في النص التاني
        const u = ((st.walk.phase + (sgn > 0 ? 0 : 1)) % 2) / 2, stride = 0.62 * k * st.walk.amt;
        if (u < 0.5) fz += stride * (0.25 - u);
        else { const v = (u - 0.5) * 2; fz += stride * (-0.25 + v * 0.5); fy += Math.sin(v * Math.PI) * 0.11 * k * st.walk.amt; }
      }
      if (B.jump) fy += Math.sin(clamp(B.jump) * Math.PI) * 0;
      let target = at(fx, fy, fz);
    // خطوة حقيقية: الرجل متثبتة في مكان في العالم (ما بتتزحلقش)، وبتترفع بس وهي بتتنقل
    if (st.feetW && st.feetW[S]) { const fw = st.feetW[S]; target = new THREE.Vector3(fw.x, s.ankleH + (fw.lift || 0) + (R.ground || 0), fw.z); fy = s.ankleH + (fw.lift || 0); }
      const pole = toW(sgn * 0.12, 0, 1).normalize();
      twoBone(s.up, s.leg, s.foot, s.Lu, s.Ll, target, pole);
      // الرجل مفرودة على الأرض ووشها لقدام
      // الرجل المزروعة على الأرض بتفضل مفرودة بالظبط زي الوقفة العادية (بتلف بس مع اتجاه الجسم)، فالنعل ما يغطسش ولا يميل
      { const want = rootQ.clone().multiply(s.footQ0);
        if (fy > s.ankleH + 0.005) want.premultiply(Q().setFromAxisAngle(toW(1, 0, 0), -clamp((fy - s.ankleH) / (0.1 * k)) * 12 * D)); // وهي مرفوعة في المشي الصوابع لتحت شوية
        const pq = s.foot.parent.getWorldQuaternion(Q()).invert();
        s.foot.quaternion.copy(pq.multiply(want)); s.foot.updateMatrixWorld(true); }
    }
  };
  solveLegs();

  // 5) الراس والرقبة: اتجاه + بصّة للكاميرا + إيماءات
  const H = P.head;
  let yaw = H.yaw, pitch = H.pitch, tilt = H.tilt;
  const lookP = st.lookPoint || st.camPos, lookW = st.lookPoint ? (st.lookW ?? 1) : H.lookW;
  if (lookW > 0 && lookP && R.head) {
    const hp = R.head.getWorldPosition(V()), dirW = lookP.clone().sub(hp);
    const loc = dirW.applyQuaternion(rootQ.clone().invert());
    const cy = Math.atan2(loc.x, loc.z) / D, cp = -Math.atan2(loc.y, Math.hypot(loc.x, loc.z)) / D;
    yaw = lerp(yaw, clamp(cy - turn, -75, 75), lookW); pitch = lerp(pitch, clamp(cp + lean * 0.6, -35, 40), lookW);
  }
  if (motion === "nod") pitch += Math.sin(t * 7) * 9;
  if (motion === "shake") yaw += Math.sin(t * 9) * 16;
  if (motion === "look_around") { yaw += Math.sin(t * 1.3) * 45; pitch += Math.sin(t * 0.9) * 6; }
  if (motion === "tremble") { yaw += Math.sin(t * 31) * 2; pitch += Math.sin(t * 27) * 2; }
  if (st.speaking) pitch += (st.wordPulse || 0) * 5 + Math.sin(t * 3.1) * 1.2; // إيماءة صغيرة مع كل كلمة
  if (st.headAdd) { yaw += st.headAdd.yaw || 0; pitch += st.headAdd.pitch || 0; tilt += st.headAdd.tilt || 0; }
  yaw += noise(t * 0.6, 21) * 2.2 * life; pitch += noise(t * 0.5, 23) * 1.6 * life - lean * 0.45; tilt += noise(t * 0.4, 29) * 1.5 * life;
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
    // الإيد بتنبض مع الكلام: بتدخل بالتدريج كل ما الإيد تتقدّم لقدام (مش عتبة فجأة بتعمل نطّة في نص الحركة)
    const beatW = m === "beat" ? 1 : st.speaking ? smooth((A.p[2] - 0.18 * k) / (0.14 * k)) : 0;
    y += (st.wordPulse || 0) * 0.03 * k * beatW;
    y += breathe * 0.004 * k;
    const shoulder = s.arm.getWorldPosition(V());
    // الدراع المرخي (نازل جنب الجسم) بيتدلّى بالجاذبية تحت الكتف، مش بيلف مع الصدر لما يميل
    const hang = smooth((-0.4 * k - A.p[1]) / (0.12 * k));
    const offChest = new THREE.Vector3(x * sgn, y, z).applyQuaternion(rootQ).applyQuaternion(chestDelta);
    const offGrav = new THREE.Vector3(x * sgn, y, z * 0.4).applyQuaternion(rootQ);
    const off = offChest.lerp(offGrav, hang);
    const target = shoulder.clone().add(off);
    // الإيد ماسكة حاجة بعينها (مقبض التلاجة، الكيبورد، الكوباية عند البق…): بندمج ناحيتها
    const rch = st.reach && st.reach[key];
    if (rch && rch.w > 0) target.lerp(rch.point, clamp(rch.w));
    const pole = new THREE.Vector3(A.pole[0] * sgn, A.pole[1], A.pole[2]).applyQuaternion(rootQ).applyQuaternion(chestDelta).normalize();
    // وهي ماسكة/بتمد إيدها: الكوع ثابت لتحت ولبره (زي الطبيعي) علشان الدراع ما يتقلبش وهي بترجع
    if (rch && rch.w > 0) pole.lerp(new THREE.Vector3(0.55 * sgn, -1, -0.25).applyQuaternion(rootQ).normalize(), clamp(rch.w * 1.5)).normalize();
    twoBone(s.arm, s.fore, s.hand, s.La, s.Lf, target, pole, true);
    // اتجاه الكف والصوابع
    const f1 = s.fingers[1] && s.fingers[1][0], ix = s.fingers[0] && s.fingers[0][0], pk = s.fingers[3] && s.fingers[3][0];
    if (f1 && ix && pk) {
      const hw = s.hand.getWorldPosition(V());
      const foreDir = hw.clone().sub(s.fore.getWorldPosition(V())).normalize();
      // الاتجاه بيلف على قوس (مش خلط خطّي): من تحت لفوق الخلط الخطي بيعدّي على صفر ويتقلب فجأة
      const palmW = new THREE.Vector3(A.palm[0] * sgn, A.palm[1], A.palm[2]).applyQuaternion(rootQ).applyQuaternion(chestDelta);
      if (rch && rch.palm && rch.w > 0) palmW.lerp(rch.palm, clamp(rch.w));
      let fingDesired = A.fing && A.fingW > 0.01
        ? bendDir(foreDir, new THREE.Vector3(A.fing[0] * sgn, A.fing[1], A.fing[2]).applyQuaternion(rootQ).applyQuaternion(chestDelta).normalize(), A.fingW, palmW)
        : foreDir;
      if (rch && rch.fing && rch.w > 0) fingDesired = bendDir(fingDesired, rch.fing, clamp(rch.w), palmW);
      // الكف كله في دورة واحدة: من إطار الإيد الحالي (صوابع + كف) لإطار الهدف.
      // (لفّ الصوابع الأول وبعدين الكف كان بيتقلب 180° لما الصوابع تعكس اتجاهها، زي الإيد وهي طالعة للدقن)
      const fwd = f1.getWorldPosition(V()).sub(hw).normalize();
      const acr = ix.getWorldPosition(V()).sub(pk.getWorldPosition(V())).normalize();
      const normal = fwd.clone().cross(acr).multiplyScalar(s.normSign);
      normal.sub(fwd.clone().multiplyScalar(normal.dot(fwd))).normalize();
      const want = new THREE.Vector3(A.palm[0] * sgn, A.palm[1], A.palm[2]).applyQuaternion(rootQ).applyQuaternion(chestDelta);
      if (rch && rch.palm && rch.w > 0) want.lerp(rch.palm, clamp(rch.w));
      want.sub(fingDesired.clone().multiplyScalar(want.dot(fingDesired)));
      // لو الكف المطلوب موازي للصوابع (مش محدد): نسيب الكف على أقرب وضع ليه بنعومة بدل ما نختار عشوائي
      const nSw = normal.clone().applyQuaternion(Q().setFromUnitVectors(fwd, fingDesired));
      want.addScaledVector(nSw, 0.002 + 0.3 * smooth((0.3 - want.length()) / 0.3));
      want.sub(fingDesired.clone().multiplyScalar(want.dot(fingDesired))).normalize();
      const frame = (f, n) => new THREE.Matrix4().makeBasis(f, n, f.clone().cross(n));
      const qFrom = Q().setFromRotationMatrix(frame(fwd, normal)), qTo = Q().setFromRotationMatrix(frame(fingDesired, want));
      rotateWorld(s.hand, qTo.multiply(qFrom.invert()));
      // الصوابع: انثناء ناحية الكف
      const fwd2 = f1.getWorldPosition(V()).sub(s.hand.getWorldPosition(V())).normalize();
      const acr2 = ix.getWorldPosition(V()).sub(pk.getWorldPosition(V())).normalize();
      const palmN = fwd2.clone().cross(acr2).multiplyScalar(s.normSign).normalize();
      const curls = rch && rch.curls ? [...A.hand.map((a, i) => lerp(a, rch.curls[i], clamp(rch.w))), lerp(0, rch.curls[5] || 0, clamp(rch.w))] : A.hand;
      s.palmN = palmN; s.sgn = sgn;
      if (st.noCurl) continue; // للقياس: الصوابع مفرودة
      poseFingers(s, curls, sgn);
    }
  }
  // 7) الدراع الحر (وزن clip) بيرجع للحركة المسجّلة: دمج محلي على السلسلة كلها، فالدراع متصل وحي ومش متجمد.
  // الإيد اللي ماسكة حاجة (reach) ما بتتدمجش علشان تفضل على الحاجة بالظبط
  if (BQ) for (const [S, key] of [["Left", "L"], ["Right", "R"]]) {
    const s = R.side[S], rch = st.reach && st.reach[key];
    const w = baseW * clamp(P[key].clip || 0) * (1 - clamp(rch && rch.w ? rch.w * 1.5 : 0));
    if (w <= 1e-4) continue;
    for (const b of [s.arm, s.fore, s.hand, ...(s.fingers || []).flat()]) { const qb = b && BQ.get(b); if (qb) b.quaternion.slerp(qb, w); }
    // تصحيح التلامس: الجسم ده عرضه غير الجسم اللي اتسجلت عليه الحركة، فالدراع الحر بيقرّب/يبعد بالفرق.
    // بيتطبق بس على الدراع النازل جنب الجسم (الإشارات الكبيرة زي ما هي)
    const fix = st.base.abdFix || 0;
    if (fix) {
      s.arm.parent.updateMatrixWorld(true);
      const dl = s.fore.getWorldPosition(V()).sub(s.arm.getWorldPosition(V())).applyQuaternion(rootQ.clone().invert());
      const abd = Math.atan2(dl.x * sgnOf(s), -dl.y) / D; // زاوية بعد الدراع عن الجسم (درجة)
      const bell = 1 - smooth((abd - 20) / 35);
      rotateWorld(s.arm, Q().setFromAxisAngle(toW(0, 0, 1), -sgnOf(s) * fix * bell * w));
    }
  }
  ch.root.updateMatrixWorld(true);
}

export { MOTIONS };

// خطوة واحدة من مكان لمكان: الرجل اللي قدام بتتنقل الأول (0–55%) والتانية وراها (45–100%)، والجسم ماشي بينهم بنعومة.
// بيرجّع { root, feetW } لاستخدامهم في applyPose. lead = "Left" | "Right"
export function stepAt(R, P0, P1, face, p, lead = "Right") {
  const k = R.k, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), face);
  const foot = (side, P) => { const s = R.side[side]; return new THREE.Vector3(s.footX, 0, 0.02 * k).applyQuaternion(q).add(P); };
  const feetW = {};
  for (const side of ["Left", "Right"]) {
    const isLead = side === lead, u = isLead ? smooth(p / 0.55) : smooth((p - 0.45) / 0.55);
    const a = foot(side, P0), b = foot(side, P1), pos = a.clone().lerp(b, u);
    feetW[side] = { x: pos.x, z: pos.z, lift: Math.sin(Math.PI * clamp(u)) ** 2 * 0.075 * k * Math.min(1, a.distanceTo(b) / (0.15 * k)) };
  }
  // الرفعة sin² (مش sin): الركبة المفرودة بتبدأ تتني بنعومة من غير نطّة لحظة ما الرجل تسيب الأرض
  // الجسم بيتنقل مع الرجلين، وبيوطى شوية في نص الخطوة
  const root = P0.clone().lerp(P1, smooth(p));
  return { root, feetW, dip: Math.sin(Math.PI * clamp(p)) * 0.015 * k };
}
