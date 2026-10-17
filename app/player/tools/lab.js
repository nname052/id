// معمل الحركة (المرحلة 1): مشاهد اختبار + قياسات لكل فريم.
// 1A/1B: شخصية بتشيل كوباية من على ترابيزة، وتمسكها، وترجّعها مكان تاني (مسكة + توازن + استعداد ومتابعة).
// 1C: شخصيتين: واحد بيتكلم والتاني بيتفاعل (بصّة متأخرة 0.2 ثانية، خطوة لقدام ← خطوة لورا).
import * as THREE from "three";
import { character, buildSet, lights, engine, settled, loadClip } from "/player/player3d.js";
import { makeRetarget, clipTrack } from "/player/clips.js";
import { setupRig, buildPerformance, applyPose, stepAt, pointAt } from "/player/rig.js";
import { makeGrasp, fingerPoints, standFor, sdfLocal } from "/player/grasp.js";
import { makeFace } from "/player/face.js";

const W = 1080, H = 1920;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => (x = clamp(x), x * x * (3 - 2 * x));
const lerp = (a, b, p) => a + (b - a) * p;
const PAL = { bg: "#20222e", surface: "#e9e4da", accent: "#3d7bd9", accent2: "#5cc8b4" };

function table(scene, x, z, top = 0.76) {
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: "#8a6a4f", roughness: 0.55 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.6), wood); slab.position.set(0, top - 0.02, 0); slab.castShadow = slab.receiveShadow = true; g.add(slab);
  for (const [lx, lz] of [[-0.46, -0.26], [0.46, -0.26], [-0.46, 0.26], [0.46, 0.26]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, top - 0.04, 0.04), wood); l.position.set(lx, (top - 0.04) / 2, lz); l.castShadow = true; g.add(l); }
  g.position.set(x, 0, z); scene.add(g);
  return { top, x, z, w: 1.0, d: 0.6 };
}
function cup(scene, r = 0.042, h = 0.105) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.88, h, 28, 1, true), m); body.position.y = h / 2; g.add(body);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(r * 0.88, 28), m); bottom.rotation.x = -Math.PI / 2; bottom.position.y = 0.002; g.add(bottom);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 28), new THREE.MeshStandardMaterial({ color: "#4a2d1a" })); coffee.rotation.x = -Math.PI / 2; coffee.position.y = h * 0.86; g.add(coffee);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material.side = THREE.DoubleSide; } });
  scene.add(g); return g;
}

// حاجات تانية للمسك (نفس النظام): صندوق بمقاسات حقيقية (متر)، الأصل في نص القاعدة
function boxObj(scene, w, h, d, color, top = null) {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.y = h / 2; b.castShadow = true; g.add(b);
  if (top) { const s = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, d * 0.92), new THREE.MeshStandardMaterial({ color: top, roughness: 0.2 })); s.rotation.x = -Math.PI / 2; s.position.y = h + 0.0005; g.add(s); }
  scene.add(g); return g;
}
const OBJECTS = {
  cup: { shape: { kind: "cylinder", r: 0.042, h: 0.105 }, make: (sc) => cup(sc, 0.042, 0.105) },
  phone: { shape: { kind: "box", w: 0.072, h: 0.009, d: 0.15 }, make: (sc) => boxObj(sc, 0.072, 0.009, 0.15, "#1d1f24", "#0b0d12"), yaw: 0.25 },
  book: { shape: { kind: "box", w: 0.155, h: 0.028, d: 0.23 }, make: (sc) => boxObj(sc, 0.155, 0.028, 0.23, "#7b2d26"), yaw: -0.15 },
};

// ---------- قياسات ----------
const MASS = { Hips: 0.14, Spine: 0.1, Spine1: 0.1, Spine2: 0.12, Neck: 0.03, Head: 0.07, LeftArm: 0.03, RightArm: 0.03, LeftForeArm: 0.02, RightForeArm: 0.02,
  LeftHand: 0.01, RightHand: 0.01, LeftUpLeg: 0.1, RightUpLeg: 0.1, LeftLeg: 0.045, RightLeg: 0.045, LeftFoot: 0.015, RightFoot: 0.015 };
// النعل الحقيقي: أوطى نقطة في الموديل نفسه (رؤوس الرجلين بعد ما العضم يحرّكها)، مش تقدير من العضم
function soleVerts(ch) {
  if (ch._soleIdx) return ch._soleIdx;
  const out = [];
  ch.root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const pos = o.geometry.attributes.position, v = new THREE.Vector3();
    o.updateMatrixWorld(true);
    const idx = [];
    for (let i = 0; i < pos.count; i++) { o.getVertexPosition(i, v); o.localToWorld(v); if (v.y < 0.06) idx.push(i); }
    if (idx.length) out.push({ mesh: o, idx: idx.filter((_, j) => j % 3 === 0) });
  });
  return (ch._soleIdx = out);
}
function soleY(ch) {
  let m = Infinity; const v = new THREE.Vector3();
  for (const { mesh, idx } of soleVerts(ch)) for (const i of idx) { mesh.getVertexPosition(i, v); mesh.localToWorld(v); if (v.y < m) m = v.y; }
  return m;
}
function measure(R) {
  const ch = R.ch, wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const feet = [];
  for (const f of ch.feet) feet.push(wp(f.ankle));
  const sole = soleY(ch);
  // مركز الثقل فوق قاعدة الرجلين؟
  let m = 0; const com = new THREE.Vector3();
  for (const [n, w] of Object.entries(MASS)) { const b = ch.bone(n); if (b) { com.add(wp(b).multiplyScalar(w)); m += w; } }
  com.divideScalar(m);
  const fq = ch.root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const loc = (p) => p.clone().sub(ch.root.position).applyQuaternion(fq);
  const fl = feet.map(loc), cl = loc(com);
  const x0 = Math.min(...fl.map((p) => p.x)) - 0.05, x1 = Math.max(...fl.map((p) => p.x)) + 0.05;
  const z0 = Math.min(...fl.map((p) => p.z)) - 0.06, z1 = Math.max(...fl.map((p) => p.z)) + 0.2; // من الكعب لأطراف الصوابع
  const outside = Math.hypot(Math.max(x0 - cl.x, 0, cl.x - x1), Math.max(z0 - cl.z, 0, cl.z - z1));
  R._comZ = { com: +cl.z.toFixed(3), heel: +z0.toFixed(3), toe: +z1.toFixed(3) };
  const bones = [], names = []; ch.root.traverse((o) => { if (o.isBone) { bones.push(wp(o)); names.push(o.name); } });
  return { sole, comOut: outside, bones, names };
}

// طبقة الحركة المسجّلة للمشهد: الكليبات بالأسماء على الزمن (entries: [{name, start, end?, speed?}])
let SRC = null;
async function clipLayer(ch, R, entries, fade = 0.8) {
  SRC ||= await character("Aj", 1.8, "soft");
  const rt = makeRetarget(SRC, ch, R.rest);
  const list = await Promise.all(entries.map(async (e) => ({ ...e, clip: await loadClip(e.name) })));
  const track = clipTrack(list, fade);
  return (t) => rt.sample(track(t));
}

// ---------- مشهد 1A/1B: الكوباية ----------
async function sceneCup(scene, opts) {
  const ch = await character(opts.character || "Business_Female_02", 1.67, "soft");
  scene.add(ch.root); ch.root.position.set(0, 0, 0); ch.root.updateMatrixWorld(true);
  const R = setupRig(ch), k = R.k;
  // سطح بارتفاع الوقوف (رخامة مطبخ 0.92م): الحاجة على بعد 12 سم من الحرف، والشخص بيقف بنفسه في المكان المريح (standFor)
  const tb = table(scene, 0, 0.5, opts.top || 0.92);
  const OB = OBJECTS[opts.obj || "cup"], c = OB.make(scene); c.rotation.y = OB.yaw || 0;
  const edgeZ = tb.z - tb.d / 2;
  const from = new THREE.Vector3(-0.12, tb.top, edgeZ + 0.12), to = new THREE.Vector3(0.04, tb.top, edgeZ + 0.13);
  const stand = standFor(R, from, { point: new THREE.Vector3(0, 0, edgeZ), normal: new THREE.Vector3(0, 0, -1) }, "Right");
  const perf = buildPerformance([{ t: 0, body: "upright", head: "down", l_arm: "rest", r_arm: "rest", face: "neutral" },
    { t: 4.9, body: "upright", head: "camera", l_arm: "rest", r_arm: "rest", face: "smile", dur: 0.9 }], k);
  const base = await clipLayer(ch, R, [{ name: opts.idle || "idle", start: 0, offset: 1.5 }]);
  const pose = (t, reach, extra = {}) => {
    const { P } = perf(t);
    applyPose(R, { P, t, rootPos: stand.pos, face: stand.face, energy: 0.35, seed: 1.3, reach: reach || undefined, base: base(t), ...extra });
  };
  // إيقاع هادي: المد حوالي ثانية، والشيل والحطّ بهدوء
  const T = { reach: 1.1, grasp: 2.15, lift: 2.5, place: 3.75, release: 4.75, back: 5.0 };
  const grasp = makeGrasp({ R, obj: c, shape: OB.shape, from, to, t: T, side: "Right", pose });
  const face = makeFace(ch.face, [], false, 3);
  // تشخيص: الإيد وصلت فين واتجاهها قد إيه قريب من المطلوب لحظة المسك
  window.labGripDetail = (tt) => {
    const gs = grasp(tt); pose(tt, gs.reach, { bodyAdd: gs.bodyAdd }); gs.placeObject();
    const inv = new THREE.Matrix4().compose(c.position, c.quaternion, new THREE.Vector3(1, 1, 1)).invert();
    const s = R.side.Right, per = [];
    for (let fi = 0; fi < 5; fi++) per.push(fingerPoints(s, fi).map((p) => +(sdfLocal(gs.shape, p.clone().applyMatrix4(inv)) * 1000).toFixed(1)));
    const hand = +(sdfLocal(gs.shape, s.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv)) * 1000).toFixed(1);
    return { curls: gs.curls, per, hand, mode: gs.mode };
  };
  window.labDebugGrip = () => {
    const gs = grasp(T.grasp + 0.3); const rr = gs.reach.R;
    pose(T.grasp + 0.3, gs.reach, { noCurl: true });
    const s = R.side.Right, wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const hw = wp(s.hand), f1 = wp(s.fingers[1][0]), ix = wp(s.fingers[0][0]), pk = wp(s.fingers[3][0]);
    const fwd = f1.clone().sub(hw).normalize(), acr = ix.clone().sub(pk).normalize();
    const normal = fwd.clone().cross(acr).multiplyScalar(s.normSign).normalize();
    const r3 = (v) => v.toArray().map((x) => +x.toFixed(3));
    return { wristErr: +hw.distanceTo(rr.point).toFixed(3), wrist: r3(hw), target: r3(rr.point), fingWant: r3(rr.fing), fingGot: r3(fwd),
             palmWant: r3(rr.palm), palmGot: r3(normal), normSign: s.normSign, curls: gs.curls, cup: r3(c.position), reachLen: +(s.La + s.Lf).toFixed(3),
             shoulder: r3(wp(s.arm)),
             thumbTip: r3(fingerPoints(s, 4).pop().sub(hw)), indexTip: r3(fingerPoints(s, 0).pop().sub(hw)), pinkyTip: r3(fingerPoints(s, 3).pop().sub(hw)), toCup: r3(c.position.clone().sub(hw)) };
  };
  return {
    duration: 6.4, words: [], R, cupObj: c, tb, from, to, T,
    frame(t) {
      const gs = grasp(t);
      pose(t, gs.reach, { bodyAdd: gs.bodyAdd });
      gs.placeObject();
      if (face) face(t, "neutral", t > 4.9 ? "smile" : "neutral", smooth((t - 4.9) / 0.8));
      // قياس المسكة: أقرب عقلة لسطح الكوباية (سالب = دخلت جواها)
      const pen = gs.mode === "held" ? gs.contact() : null;
      return { mode: gs.mode, pen, cupY: c.position.y, cupGap: c.position.y - tb.top, actors: [R] };
    },
    cameras: { wide: { pos: [1.15, 1.45, 2.35], look: [0, 1.05, 0.25], fov: 34 }, hand: { pos: [0.5, 1.2, 1.15], look: [-0.06, 0.98, 0.32], fov: 30 },
      handBack: { pos: [-0.75, 1.25, 1.0], look: [-0.08, 0.98, 0.3], fov: 28 } },
  };
}

// ---------- مشهد 1C: شخصيتين ----------
async function sceneDuo(scene) {
  const A = await character("Business_Male_02", 1.8, "soft"), B = await character("Business_Female_04", 1.67, "soft");
  for (const c of [A, B]) { scene.add(c.root); c.root.position.set(0, 0, 0); c.root.rotation.y = 0; c.root.updateMatrixWorld(true); }
  const RA = setupRig(A), RB = setupRig(B);
  // الكلام: A بيتكلم الأول، وبعدين B بترد
  const W1 = "بص أنا عارف إن القرار صعب بس لازم نحسمه النهارده".split(" "), W2 = "طب استنى شوية أنا محتاجة أفكر الأول".split(" ");
  const words = (list, t0, step) => list.map((w, i) => ({ word: w, start: t0 + i * step, end: t0 + i * step + step * 0.85 }));
  const wA = words(W1, 0.5, 0.36), wB = words(W2, 5.6, 0.34);
  const speakA = (t) => t >= 0.4 && t <= wA[wA.length - 1].end + 0.1, speakB = (t) => t >= 5.5 && t <= wB[wB.length - 1].end + 0.1;
  // الأماكن: A شمال الكادر وB يمين. A بياخد خطوة لقدام ناحيتها عند "لازم"، وB بترجع خطوة لورا بعد 0.25 ثانية (رد فعل)
  const A0 = new THREE.Vector3(-0.62, 0, 0.05), A1 = new THREE.Vector3(-0.36, 0, 0.05);
  const B0 = new THREE.Vector3(0.62, 0, 0.05), B1 = new THREE.Vector3(0.82, 0, -0.07);
  const stepA = (t) => clamp((t - 2.9) / 0.85), stepB = (t) => clamp((t - 3.15) / 0.8);
  const faceA = 62 * Math.PI / 180, faceB = -62 * Math.PI / 180;
  const perfA = buildPerformance([
    { t: 0, body: "upright", head: "forward", l_arm: "rest", r_arm: "explain", face: "serious", dur: 0.9 },
    { t: 2.85, body: "lean_forward", head: "forward", l_arm: "rest", r_arm: "rest", face: "serious", dur: 0.6 },
    { t: 4.6, body: "upright", head: "down", l_arm: "rest", r_arm: "rest", face: "thinking", dur: 1.0, ease: "slow" },
    { t: 6.6, body: "upright", head: "forward", l_arm: "rest", r_arm: "rest", face: "neutral", motion: "nod", dur: 0.9 },
    { t: 8.6, body: "upright", head: "forward", l_arm: "rest", r_arm: "chest", face: "warm", dur: 1.0, ease: "slow" }], RA.k);
  const perfB = buildPerformance([
    { t: 0, body: "upright", head: "down", l_arm: "rest", r_arm: "rest", face: "neutral", dur: 0.9 },
    { t: 3.1, body: "lean_back", head: "tilt_right", l_arm: "chest", r_arm: "rest", face: "worried", dur: 0.6 },
    { t: 5.4, body: "upright", head: "forward", l_arm: "rest", r_arm: "stop", face: "serious", dur: 0.7 },
    { t: 7.0, body: "upright", head: "forward", l_arm: "rest", r_arm: "rest", face: "thinking", dur: 1.0, ease: "slow" },
    { t: 8.8, body: "upright", head: "forward", l_arm: "rest", r_arm: "rest", face: "neutral", dur: 1.0, ease: "slow" }], RB.k);
  // الحركة المسجّلة تحت كل واحد: A بيتكلم بإيده بهدوء (asking_question) وبعدين يقف عادي؛ B بتسمع، وبعدين بتفكر (thinking)
  const baseA = await clipLayer(A, RA, [{ name: "idle", start: -1, end: 0.5 }, { name: "asking_question", start: 0.5, end: 4.4 }, { name: "idle", start: 4.4, offset: 2 }]);
  const baseB = await clipLayer(B, RB, [{ name: "idle", start: -1, end: 6.9, offset: 4 }, { name: "thinking", start: 6.9, end: 9.0, offset: 0.5 }, { name: "idle", start: 9.0, offset: 1 }]);
  // A بيشاور على B (على صدرها) وهو بيقول "لازم نحسمه"
  const pointW = (t) => smooth((t - 2.9) / 0.55) * (1 - smooth((t - 4.25) / 0.6));
  // البصّة: كل واحد بيبص للتاني، بس بعد 0.2 ثانية من ما التاني يبدأ يتكلم (رد فعل طبيعي)، وفي التفكير بيبص لتحت
  const lookW = (t, startSpeak, away) => Math.max(smooth((t - startSpeak - 0.2) / 0.35), 0) * (1 - (away ? away(t) : 0));
  const faceAfn = makeFace(A.face, wA, true, 5), faceBfn = makeFace(B.face, wB, true, 7);
  const pulse = (ws, t) => ws.reduce((m, w) => m + Math.exp(-Math.pow((t - w.start - 0.06) / 0.13, 2)), 0);
  return {
    duration: 10.5, words: [...wA, ...wB], actors: [RA, RB],
    frame(t) {
      const sA = stepAt(RA, A0, A1, faceA, stepA(t), "Right"), sB = stepAt(RB, B0, B1, faceB, stepB(t), "Left");
      const pA = sA.root, pB = sB.root, bA = baseA(t), bB = baseB(t);
      const headPos = (R2) => R2.head.getWorldPosition(new THREE.Vector3());
      // A: بيبص لـ B طول ما بيتكلم، وبيبص لتحت وهو بيفكر (4.6–5.8)، وبيرجع يبصلها بعد ما تبدأ ترد بـ 0.2
      const awayA = (tt) => smooth((tt - 4.6) / 0.5) * (1 - smooth((tt - 5.8) / 0.4));
      const lwA = Math.max(lookW(t, 0, awayA), lookW(t, 5.5));
      const { P: PA, key: kA, prev: prA, trans: trA } = perfA(t), { P: PB, key: kB, prev: prB, trans: trB } = perfB(t);
      // B: بتبص لتحت في الأول، وبعد ما A يبدأ يتكلم بـ 0.2 بترفع عينها له
      const lwB = lookW(t, 0.4);
      applyPose(RB, { P: PB, t, rootPos: pB, face: faceB, energy: 0.4 + 0.4 * smooth((t - 2.8) / 0.6) * (1 - smooth((t - 4.8) / 0.8)), seed: 2.1, lookPoint: headPos(RA), lookW: lwB,
        feetW: sB.feetW, speaking: speakB(t), wordPulse: pulse(wB, t), base: bB, bodyAdd: { crouch: sB.crouch } });
      const pw = pointW(t), aim = pw > 0 ? pointAt(RA, pA, faceA, headPos(RB).add(new THREE.Vector3(0, -0.3, 0)), pw) : null;
      applyPose(RA, { P: PA, t, rootPos: pA, face: faceA, energy: 0.4 + 0.45 * smooth((t - 2.4) / 0.6) * (1 - smooth((t - 4.3) / 0.8)), seed: 0.4, lookPoint: headPos(RB), lookW: lwA,
        feetW: sA.feetW, speaking: speakA(t), wordPulse: pulse(wA, t), base: bA, reach: aim ? aim.reach : undefined,
        bodyAdd: { crouch: sA.crouch, turn: aim ? aim.bodyAdd.turn : 0 } });
      // B مرة تانية بعد ما A اتحرك (علشان تبص لمكان راسه الجديد)
      applyPose(RB, { P: PB, t, rootPos: pB, face: faceB, energy: 0.4 + 0.4 * smooth((t - 2.8) / 0.6) * (1 - smooth((t - 4.8) / 0.8)), seed: 2.1, lookPoint: headPos(RA), lookW: lwB,
        feetW: sB.feetW, speaking: speakB(t), wordPulse: pulse(wB, t), base: bB, bodyAdd: { crouch: sB.crouch } });
      faceAfn(t, (prA || kA).face, kA.face, trA); faceBfn(t, (prB || kB).face, kB.face, trB);
      return { lookA: lwA, lookB: lwB, speaking: speakA(t) ? "A" : speakB(t) ? "B" : "-", actors: [RA, RB] };
    },
    cameras: { wide: { pos: [2.3, 1.55, 3.7], look: [0.12, 1.05, 0], fov: 44 },
      closeA: { pos: [0.0, 1.45, 1.55], look: [-0.45, 1.2, 0.05], fov: 30 }, closeB: { pos: [0.35, 1.4, 1.6], look: [0.72, 1.15, 0.0], fov: 30 },
      legsA: { pos: [-0.05, 0.55, 1.45], look: [-0.5, 0.42, 0.05], fov: 34 }, legsB: { pos: [1.2, 0.55, 1.5], look: [0.72, 0.42, 0.0], fov: 34 } },
  };
}

// ---------- مشهد clips: حركة مسجّلة (Mixamo) على شخصية Rocketbox عن طريق إعادة الاستهداف ----------
async function sceneClips(scene, opts) {
  const ch = await character(opts.character || "Business_Male_02", 1.8, "soft");
  scene.add(ch.root); ch.root.position.set(0, 0, 0); ch.root.updateMatrixWorld(true);
  const R = setupRig(ch), src = await character("Aj", 1.8, "soft");
  const rt = makeRetarget(src, ch, R.rest);
  const names = (opts.clips || "idle,talking").split(",");
  const clips = await Promise.all(names.map((n) => loadClip(n)));
  const seg = 9 / clips.length;
  const track = clipTrack(clips.map((c, i) => ({ clip: c, start: i * seg, end: i < clips.length - 1 ? (i + 1) * seg : null })), 0.8);
  const perf = buildPerformance([{ t: 0, body: "upright", head: "forward", l_arm: "rest", r_arm: "rest", face: "neutral" }], R.k);
  window.labDbgRT = (tt) => {
    const out = {}, wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const base = rt.sample(track(tt));
    const dir = (c, a, b) => { const A = c.bone(a), B = c.bone(b); return A && B ? wp(B).sub(wp(A)).normalize().toArray().map((x) => +x.toFixed(2)) : null; };
    const srcD = {}; for (const [a, b] of [["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["Spine", "Neck"], ["Neck", "Head"], ["LeftShoulder", "LeftArm"]]) srcD[a] = dir(src, a, b);
    applyPose(R, { P: perf(tt).P, t: tt, rootPos: new THREE.Vector3(0, 0, 0), face: 0, energy: 0.4, seed: 0.7, base, baseW: 1 });
    for (const [a, b] of [["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["Spine", "Neck"], ["Neck", "Head"], ["LeftShoulder", "LeftArm"]]) out[a] = { src: srcD[a], tgt: dir(ch, a, b) };
    // نفس الشي من غير الـ rig: نطبّق الأساس بس
    for (const [bn, q] of R.rest) bn.quaternion.copy(base.q.get(bn) || q); ch.root.rotation.y = 0; ch.root.updateMatrixWorld(true);
    for (const [a, b] of [["LeftArm", "LeftForeArm"], ["Spine", "Neck"], ["Neck", "Head"]]) out[a].raw = dir(ch, a, b);
    out.abdFix = +(rt.abdFix * 57.3).toFixed(1);
    return out;
  };
  return {
    duration: 9, words: [], actors: [R],
    frame(t) {
      const base = rt.sample(track(t));
      applyPose(R, { P: perf(t).P, t, rootPos: new THREE.Vector3(0, 0, 0), face: 0.35, energy: 0.4, seed: 0.7, base });
      return { actors: [R] };
    },
    cameras: { wide: { pos: [0.9, 1.3, 3.2], look: [0, 1.0, 0], fov: 38 } },
  };
}

// ---------- الواجهة اللي السكريبت بيستخدمها ----------
let S, cam, r, scene, prevBones = null, prevVel = null;
window.setupLab = async (name, camName = "wide", opts = {}) => {
  r = engine(); scene = new THREE.Scene();
  const set = await buildSet(scene, "studio", "soft", "day", PAL, 1);
  lights(scene, set, "day", "soft", PAL);
  S = name === "duo" ? await sceneDuo(scene) : name === "clips" ? await sceneClips(scene, opts) : await sceneCup(scene, opts);
  await settled();
  const c = S.cameras[camName] || S.cameras.wide;
  cam = new THREE.PerspectiveCamera(c.fov, W / H, 0.05, 100); cam.position.set(...c.pos); cam.lookAt(new THREE.Vector3(...c.look));
  document.body.appendChild(r.domElement); r.domElement.style.cssText = "position:absolute;left:0;top:0;width:1080px;height:1920px";
  prevBones = null; prevVel = null; window.__S = S;
  return S.duration;
};
// بيرسم لحظة t وبيرجّع القياسات (لازم الفريمات تتنادى بالترتيب علشان قياس "النطّة" بين فريمين)
window.labFrame = (t) => {
  const info = S.frame(t);
  r.render(scene, cam);
  const ms = info.actors.map(measure);
  let jump = 0, pop = 0, popBone = "";
  const bones = ms.flatMap((m) => m.bones);
  if (prevBones && prevBones.length === bones.length) {
    const vel = bones.map((b, i) => b.clone().sub(prevBones[i]));
    vel.forEach((v) => (jump = Math.max(jump, v.length())));
    if (prevVel) vel.forEach((v, i) => { const a = v.distanceTo(prevVel[i]); if (a > pop) { pop = a; popBone = ms.flatMap((m) => m.names)[i]; } }); // تغيّر السرعة بين فريمين
    prevVel = vel;
  }
  prevBones = bones;
  return { t, dbg: info.actors[0]._dbg, dbgB: info.actors[1] && info.actors[1]._dbg, comZ: info.actors[0]._comZ, sole: Math.min(...ms.map((m) => m.sole)), comOut: Math.max(...ms.map((m) => m.comOut)), jump, pop, popBone, ...Object.fromEntries(Object.entries(info).filter(([kk]) => kk !== "actors")) };
};
window.labDebugFeet = (tt) => {
  S.frame(tt);
  const R0 = S.actors ? S.actors[0] : null;
  const info = S.frame(tt), Rr = info.actors[0], ch = Rr.ch, wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const r3 = (v) => +v.toFixed(3);
  const per = {};
  for (const { mesh, idx } of soleVerts(ch)) { const v = new THREE.Vector3(); let m = Infinity, at = null;
    for (const i of idx) { mesh.getVertexPosition(i, v); mesh.localToWorld(v); if (v.y < m) { m = v.y; at = v.clone(); } }
    per[mesh.name] = { min: r3(m), x: r3(at.x), z: r3(at.z) }; }
  return { ground: Rr.ground, rootY: r3(ch.root.position.y), hipsY: r3(wp(Rr.hips).y),
    feet: ["Left", "Right"].map((S2) => { const s = Rr.side[S2]; return { S2, ankle: r3(wp(s.foot).y), ankleH: r3(s.ankleH), toe: r3(wp(s.toe).y), toeH: r3(s.toeH), knee: r3(wp(s.leg).y) }; }), per };
};
window.labDebugHand = (ts) => ts.map((tt) => {
  const info = S.frame(tt), Rr = info.actors[0], s = Rr.side.Left, wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const r3 = (v) => v.toArray().map((x) => +x.toFixed(3));
  const tip = wp(s.fingers[1][2]), hand = wp(s.hand), f1 = wp(s.fingers[1][0]);
  return { t: tt, hand: r3(hand), mid1: r3(f1), midTip: r3(tip), palmN: s.palmN ? r3(s.palmN) : null };
});
window.labReady = true;
