// طبقة الحركات المسجّلة (Mixamo mocap) على أي هيكل (Rocketbox أو Mixamo):
// كل عضمة بتاخد "إطار معنوي" (اتجاهها لابنها + محور تاني ثابت المعنى) في الوضع الأصلي للهيكلين،
// فالحركة بتتنقل صح حتى لو الوضع الأصلي مختلف (T-pose / A-pose) أو محاور العضم مختلفة.
// النتيجة: دوران محلي لكل عضمة (Map) + إزاحة الوسط، والـ rig بيطبّقهم كأساس وبعدين يصلّح فوقهم (IK، توازن، بصّة، رجلين على الأرض).
import * as THREE from "three";

const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoother = (x) => (x = clamp(x), x * x * x * (x * (x * 6 - 15) + 10));

const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
// ترتيب من الأب للابن؛ [اسم، الابن اللي بيحدد الاتجاه، نوع المحور التاني]
function boneSpecs() {
  const L = [["Hips", "Spine", "fwd"], ["Spine", "Spine1", "fwd"], ["Spine1", "Spine2", "fwd"], ["Spine2", "Neck", "fwd"], ["Neck", "Head", "fwd"], ["Head", null, "head"]];
  for (const S of ["Left", "Right"]) {
    L.push([S + "Shoulder", S + "Arm", "fwd"], [S + "Arm", S + "ForeArm", "fwd"], [S + "ForeArm", S + "Hand", "fwd"], [S + "Hand", S + "HandMiddle1", "palm:" + S]);
    for (const f of FINGERS) for (let j = 1; j <= 3; j++) L.push([`${S}Hand${f}${j}`, j < 3 ? `${S}Hand${f}${j + 1}` : null, "palm:" + S]);
    L.push([S + "UpLeg", S + "Leg", "fwd"], [S + "Leg", S + "Foot", "fwd"], [S + "Foot", S + "ToeBase", "up"], [S + "ToeBase", null, "up"]);
  }
  return L;
}

// الإطار المعنوي لعضمة في الوضع الحالي للهيكل (إحداثيات الجذر: الجذر من غير لف ولا مكان)
function semanticFrame(get, name, child, kind, prevDir) {
  const b = get(name); if (!b) return null;
  const p = b.getWorldPosition(V());
  let x;
  if (kind === "head") x = new THREE.Vector3(0, 1, 0);
  else if (child && get(child)) x = get(child).getWorldPosition(V()).sub(p);
  else x = prevDir ? prevDir.clone() : new THREE.Vector3(0, 1, 0);
  if (x.lengthSq() < 1e-12) x.set(0, 1, 0);
  x.normalize();
  let y;
  if (kind.startsWith("palm:")) {
    const S = kind.slice(5), ix = get(S + "HandIndex1"), pk = get(S + "HandPinky1");
    y = ix && pk ? ix.getWorldPosition(V()).sub(pk.getWorldPosition(V())) : new THREE.Vector3(0, 0, 1);
  } else y = kind === "up" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  y.addScaledVector(x, -y.dot(x));
  if (y.lengthSq() < 1e-8) { y = new THREE.Vector3(1, 0, 0).addScaledVector(x, -x.x); }
  y.normalize();
  return { q: Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y))), dir: x };
}

// الزاوية اللي الدراع لازم يبعدها عن الجسم علشان الإيد تعدّي الوسط بالظبط (من شكل الجسم نفسه في الوضع الأصلي).
// الجسمين مختلفين في العرض، فالفرق بينهم هو التصحيح اللي بيخلّي الدراع الحر لازق في الجسم صح (مش طاير ولا داخل فيه)
function hangClearance(ch, rest) {
  const r0 = ch.root.rotation.y, p0 = ch.root.position.clone();
  ch.root.rotation.y = 0; ch.root.position.set(0, 0, 0);
  if (rest) for (const [b, q] of rest) b.quaternion.copy(q);
  ch.root.updateMatrixWorld(true);
  const hip = ch.bone("Hips").getWorldPosition(V()), sh = ch.bone("LeftArm").getWorldPosition(V()), hand = ch.bone("LeftHand").getWorldPosition(V());
  const fore = ch.bone("LeftForeArm").getWorldPosition(V());
  const armLen = sh.distanceTo(fore) + fore.distanceTo(hand), xs = [], v = V(), shX = Math.abs(sh.x - hip.x);
  ch.root.traverse((o) => { if (!o.isSkinnedMesh) return; const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 3) { o.getVertexPosition(i, v); o.localToWorld(v); const dx = Math.abs(v.x - hip.x); if (Math.abs(v.y - hip.y) < 0.06 && dx < shX + 0.05) xs.push(dx); } }); // جوه عرض الكتف (من غير الدراعين)
  xs.sort((a, b) => a - b);
  const hipHalf = xs.length ? xs[Math.floor(xs.length * 0.97)] : 0.17;
  ch.root.rotation.y = r0; ch.root.position.copy(p0); ch.root.updateMatrixWorld(true);
  return Math.asin(clamp((hipHalf + 0.035 - Math.abs(sh.x - hip.x)) / armLen, -0.9, 0.9));
}

// src: شخصية Mixamo (Aj) فيها الحركات؛ tgt: الشخصية اللي هتتحرك (من character())، restQ: Map عضمة ← دوران الوضع الأصلي
export function makeRetarget(src, tgt, restQ) {
  const specs = boneSpecs().filter(([n]) => src.bone(n) && tgt.bone(n));
  const prep = (ch, rest) => {
    const r0 = ch.root.rotation.y, p0 = ch.root.position.clone();
    ch.root.rotation.y = 0; ch.root.position.set(0, 0, 0);
    if (rest) for (const [b, q] of rest) b.quaternion.copy(q);
    ch.root.updateMatrixWorld(true);
    const out = {}; let prev = null;
    for (const [n, c, kind] of specs) {
      const f = semanticFrame(ch.bone, n, c, kind, prev); if (!f) continue; prev = f.dir;
      out[n] = Q().copy(ch.bone(n).getWorldQuaternion(Q())).invert().multiply(f.q); // الإطار ثابت جوه العضمة
    }
    const hips = ch.bone("Hips").getWorldPosition(V());
    ch.root.rotation.y = r0; ch.root.position.copy(p0); ch.root.updateMatrixWorld(true);
    return { C: out, hips };
  };
  // الهيكل المصدر في وضعه الأصلي (bind) قبل أي حركة
  const srcRest = new Map(); src.root.traverse((o) => { if (o.isBone) srcRest.set(o, o.quaternion.clone()); });
  const S0 = prep(src, srcRest), T0 = prep(tgt, restQ);
  const abdFix = hangClearance(src, srcRest) - hangClearance(tgt, restQ); // راديان: قد إيه الدراع الحر يقرّب من الجسم على الهدف
  const scale = (tgt.height || 1.7) / (src.height || 1.8);
  const tgtBones = specs.map(([n]) => [n, tgt.bone(n)]);
  const srcBones = specs.map(([n]) => [n, src.bone(n)]);
  const mixer = new THREE.AnimationMixer(src.root), actions = new Map();
  const action = (clip) => { if (!actions.has(clip)) { const a = mixer.clipAction(clip); a.play(); actions.set(clip, a); } return actions.get(clip); };

  // وضعية المصدر لما يتدمج كذا كليب بأوزان: [{clip, time, w}]
  function poseSource(layers) {
    for (const a of actions.values()) a.setEffectiveWeight(0);
    for (const b of srcRest.keys()) b.quaternion.copy(srcRest.get(b));
    for (const L of layers) { const a = action(L.clip); a.setEffectiveWeight(L.w); a.time = L.time; }
    mixer.update(0);
    src.root.rotation.y = 0; src.root.position.set(0, 0, 0); src.root.updateMatrixWorld(true);
  }

  const means = new Map();
  const hipsMean = (clip) => {
    if (means.has(clip)) return means.get(clip);
    const m = V(), n = 12;
    for (let i = 0; i < n; i++) { poseSource([{ clip, time: (clip.duration * (i + 0.5)) / n, w: 1 }]); m.add(src.bone("Hips").getWorldPosition(V()).sub(S0.hips)); }
    m.divideScalar(n); means.set(clip, m); return m;
  };
  // بيرجّع { q: Map(عضمة الهدف ← دوران محلي), hips: إزاحة الوسط بإحداثيات الجسم (متر) }
  function sample(layers) {
    poseSource(layers);
    const worldT = new Map(); // عضمة الهدف ← دوران عالمي (بالنسبة للجذر)
    const tgtRootQInv = tgt.root.getWorldQuaternion(Q()).invert();
    const worldOf = (b) => {
      if (worldT.has(b)) return worldT.get(b);
      if (!b.isBone) return b.getWorldQuaternion(Q()).premultiply(tgtRootQInv.clone()); // الجذر نفسه (بالنسبة لنفسه = تقريبًا الهوية مع الـ scale)
      const w = worldOf(b.parent).clone().multiply(restQ.get(b) || b.quaternion);
      worldT.set(b, w); return w;
    };
    const q = new Map();
    for (let i = 0; i < specs.length; i++) {
      const n = specs[i][0], sb = srcBones[i][1], tb = tgtBones[i][1];
      if (!S0.C[n] || !T0.C[n]) continue;
      const F = sb.getWorldQuaternion(Q()).multiply(S0.C[n]);      // إطار المصدر دلوقتي
      const W = F.multiply(Q().copy(T0.C[n]).invert());             // نفس الإطار على الهدف
      const local = worldOf(tb.parent).clone().invert().multiply(W);
      worldT.set(tb, W); q.set(tb, local);
    }
    // الوسط: بناخد بس تغيّره حوالين متوسطه في الكليب (تمايل ونفَس)، مش ارتفاعه الثابت (الممثل الأصلي واقف أوطى/أعلى من وضعه الأصلي)
    const hp = src.bone("Hips").getWorldPosition(V()).sub(S0.hips);
    for (const L of layers) hp.addScaledVector(hipsMean(L.clip), -L.w);
    hp.multiplyScalar(scale);
    return { q, hips: hp, abdFix };
  }
  return { sample, scale, abdFix };
}

// خلط وضعيتين (لنقل ناعم بين كليبين أو بين الكليب والوضع الأصلي)
export function blendPoses(a, b, w) {
  if (!a) return b; if (!b) return a;
  const q = new Map();
  for (const [bone, qa] of a.q) { const qb = b.q.get(bone); q.set(bone, qb ? qa.clone().slerp(qb, w) : qa.clone()); }
  for (const [bone, qb] of b.q) if (!q.has(bone)) q.set(bone, qb.clone());
  return { q, hips: a.hips.clone().lerp(b.hips, w), abdFix: a.abdFix ?? b.abdFix };
}

// طبقة كليبات على الزمن: [{clip, start, end?, speed?, loop?, offset?}] بانتقالات ناعمة (fade) بين كل واحد واللي بعده.
// الوزن بيتوزع بمنحنى سرعته صفر في الأول والآخر، فمفيش نطّة لا في الوضع ولا في السرعة.
export function clipTrack(entries, fade = 0.6) {
  return (t) => {
    const out = [];
    for (const e of entries) {
      const fi = e.fade ?? fade;
      const win = smoother((t - e.start + fi) / fi) * (e.end == null ? 1 : 1 - smoother((t - e.end) / fi));
      if (win <= 1e-4) continue;
      const d = e.clip.duration, lt = Math.max(0, (t - e.start) * (e.speed || 1) + (e.offset || 0));
      out.push({ clip: e.clip, time: e.loop === false ? Math.min(lt, d - 1e-3) : lt % d, w: win });
    }
    const sum = out.reduce((s, l) => s + l.w, 0) || 1;
    for (const l of out) l.w /= sum;
    return out;
  };
}
