// معمل الحركة (المرحلة 1): مشاهد اختبار + قياسات لكل فريم.
// 1A/1B: شخصية بتشيل كوباية من على ترابيزة، وتمسكها، وترجّعها مكان تاني (مسكة + توازن + استعداد ومتابعة).
// 1C: شخصيتين: واحد بيتكلم والتاني بيتفاعل (بصّة متأخرة 0.2 ثانية، خطوة لقدام ← خطوة لورا).
import * as THREE from "three";
import { character, buildSet, lights, engine, settled, loadClip } from "/player/player3d.js";
import { makeRetarget, clipTrack } from "/player/clips.js";
import { setupRig, buildPerformance, applyPose, stepAt, pointAt } from "/player/rig.js";
import { makeGrasp, fingerPoints, standFor, sdfLocal, handSkin, eachSkin } from "/player/grasp.js";
import { makeFace } from "/player/face.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { makeBook, BOOK } from "/player/procedural_props.js";

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
      const ct = gs.mode === "held" ? gs.contact() : null, pen = ct ? Math.min(ct.palm, ct.fingers) : null;
      // قياسات المسكة من جلد الإيد نفسه
      const s = R.side.Right, hv = handSkin(ch, s), inv = new THREE.Matrix4().compose(c.position, c.quaternion, new THREE.Vector3(1, 1, 1)).invert();
      const sd = (p) => sdfLocal(OB.shape, p.clone().applyMatrix4(inv));
      let low = Infinity, palmD = Infinity, fingD = Infinity; const pc = new THREE.Vector3(); let n = 0;
      let overLow = Infinity; const edgeZw = edgeZ;
      eachSkin(hv.palm, (v) => { low = Math.min(low, v.y); palmD = Math.min(palmD, sd(v)); pc.add(v); n++; if (v.z > edgeZw) overLow = Math.min(overLow, v.y); });
      eachSkin(hv.fing.flat(2), (v) => { low = Math.min(low, v.y); fingD = Math.min(fingD, sd(v)); if (v.z > edgeZw) overLow = Math.min(overLow, v.y); });
      pc.divideScalar(Math.max(1, n));
      const tips = [0, 1, 2, 3, 4].map((fi) => +(sd(fingerPoints(s, fi).pop()) * 1000).toFixed(1));
      const hm = s.hand.matrixWorld.clone().invert(), rel = c.position.clone().applyMatrix4(hm);
      const grip = { overTableLowY: isFinite(overLow) ? +overLow.toFixed(4) : null, wristY: +s.hand.getWorldPosition(new THREE.Vector3()).y.toFixed(4), handLowY: +low.toFixed(4), tableTop: tb.top,
        palmSkinMM: +(palmD * 1000).toFixed(1), fingSkinMM: +(fingD * 1000).toFixed(1), palmCenterMM: +(sd(pc) * 1000).toFixed(1), tipsMM: ct ? ct.tips.map((x) => +(x * 1000).toFixed(1)) : tips,
        cup: c.position.toArray().map((x) => +x.toFixed(4)), cupInHand: rel.toArray().map((x) => +(x * 100).toFixed(2)) };
      return { mode: gs.mode, pen, grip, cupY: c.position.y, cupGap: c.position.y - tb.top, actors: [R] };
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

// ---------- مشهد Phase 2: "إزاي تقرا 20 دقيقة في اليوم" (القعدة، مسك الكتاب، القراية، البصّة للكاميرا) ----------
// كل الموديلات بتتحمّل بمقاسها المصحَّح (scale_factor من assets_manifest.json لكل مكتبة)
const gltfL = new GLTFLoader();
async function placeAsset(scene, path, factor, x, z, rotY = 0) {
  const g = (await gltfL.loadAsync("/" + path)).scene;
  g.scale.setScalar(factor); g.rotation.y = rotY; g.position.set(x, 0, z); g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g, true); g.position.y -= box.min.y; g.updateMatrixWorld(true); // على الأرض بالظبط
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g); return { g, box: new THREE.Box3().setFromObject(g, true) };
}
// أعلى سطح أفقي كبير جوه موديل (سطح الترابيزة/قعدة الكنبة) في منطقة x,z معينة
function surfaceTop(g, x0, x1, z0, z1, below = 99) {
  let best = -Infinity; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  g.traverse((o) => { if (!o.isMesh) return; const pos = o.geometry.attributes.position, idx = o.geometry.index, cnt = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < cnt; i += 3) { const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      n.subVectors(b, a).cross(c.clone().sub(a)); if (n.y <= 0.9 * n.length()) continue;
      const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3, cy = (a.y + b.y + c.y) / 3;
      if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1 && cy < below) best = Math.max(best, cy); } });
  return best;
}
async function sceneRead(scene, opts) {
  const F = opts.factors || {}, f = (lib) => F[lib] ?? 1;
  const ch = await character(opts.character || "Male_Adult_08", 1.8, "soft");
  scene.add(ch.root); ch.root.position.set(0, 0, 0); ch.root.updateMatrixWorld(true);
  const R = setupRig(ch), k = R.k;
  // المكان: حيطة ورا، كنبة، ترابيزة جانبية على يمينه (عليها الكتاب والشاي)، أباجورة، سجادة
  const wall = await placeAsset(scene, "assets/3d/kaykit-restaurant/wall.gltf", f("kaykit-restaurant"), 0, -1.35);
  const rug = await placeAsset(scene, "assets/3d/kaykit-furniture/rug_rectangle_A.gltf", f("kaykit-furniture"), -0.2, 0.15);
  const couch = await placeAsset(scene, "assets/3d/kaykit-furniture/couch_pillows.gltf", f("kaykit-furniture"), 0, -0.55);
  const side = await placeAsset(scene, "assets/3d/kaykit-furniture/table_small.gltf", f("kaykit-furniture"), -1.55, -0.3);
  const lamp = await placeAsset(scene, "assets/3d/kaykit-furniture/lamp_standing.gltf", f("kaykit-furniture"), 1.45, -0.85);
  const shelf = await placeAsset(scene, "assets/3d/kaykit-furniture/shelf_B_large_decorated.gltf", f("kaykit-furniture"), 2.3, -1.05);
  const cup = await placeAsset(scene, "assets/3d/food-kit/cup-tea.glb", f("food-kit"), -1.42, -0.42, 0.6);
  const sb = side.box, sideTop = surfaceTop(side.g, sb.min.x, sb.max.x, sb.min.z, sb.max.z);
  cup.g.position.y += sideTop - cup.box.min.y; cup.g.updateMatrixWorld(true);
  const cb = couch.box, seatTop = surfaceTop(couch.g, -0.4, 0.4, cb.min.z, cb.max.z, cb.min.y + 0.6);
  // الكتاب (مرسوم بالكود بمقاسه الحقيقي) على الترابيزة الجانبية، الكعب ناحيته
  const book = makeBook(); scene.add(book);
  const from = new THREE.Vector3(-1.3, sideTop, -0.18), to = new THREE.Vector3(-1.32, sideTop, -0.14);
  book.position.copy(from); book.rotation.y = 0.25;
  // القعدة: نقطة الجسم (root) عند الوسط فوق القعدة، فتصحيح التوازن ما بيشدّش الوسط ناحية الرجلين (الوزن على الكنبة مش على الرجلين)،
  // والرجلين متثبتين على الأرض قدام الركب (feetW). كده من غير أي تعديل في rig.js
  const sitX = -0.62, hipsZ = cb.max.z - 0.3, rootPos = new THREE.Vector3(sitX, 0, hipsZ - 0.03), face = 0;
  const seat = { h: seatTop, back: 0 };
  const thigh = R.side.Left.Lu;
  const feetW = Object.fromEntries(["Left", "Right"].map((S2) => [S2, { x: sitX + R.side[S2].sign * 0.14 * k, z: hipsZ + thigh * 0.95 + 0.08, lift: 0 }]));
  const base = await clipLayer(ch, R, [{ name: "sitting_idle", start: -1, offset: 2 }]);
  // الإيقاع (هادي، محايد): يستقر، يبص للكتاب، يمد إيده، يشيله، يقرا، يرفع عينه للكاميرا، يرجّعه، يستقر
  const T = { reach: 1.5, grasp: 2.6, lift: 3.0, place: 8.6, release: 9.5, back: 9.7 };
  const perf = buildPerformance([{ t: 0, body: "sit", head: "forward", l_arm: "rest", r_arm: "rest", face: "neutral" },
    { t: 3.6, body: "sit_lean", head: "down", l_arm: "cross", r_arm: "rest", face: "thinking", dur: 1.4, ease: "slow" }, // الإيد الشمال مرتاحة على حجره وهو بيقرا (مش سايبة على حرف الكنبة)
    { t: 7.0, body: "sit", head: "forward", l_arm: "rest", r_arm: "rest", face: "smile", dur: 1.4, ease: "slow" }], k);
  const pose = (tt, reach, extra = {}) => applyPose(R, { P: perf(tt).P, t: tt, rootPos, face, seat, feetW, energy: 0.3, seed: 0.9, reach: reach || undefined, base: base(tt), ...extra });
  const grasp = makeGrasp({ R, obj: book, shape: book.userData.shape, from, to, t: T, side: "Right", pose });
  // القراية: الكتاب بيتمال ناحية وشّه وهو ماسكه (طبقة فوق المسكة: بتلف إطار الإيد كله حوالين نص الكتاب، فالمسكة نفسها ما بتتغيرش)
  const hold = T.lift + 1.4;
  { const g0 = grasp(hold); pose(hold, g0.reach); g0.placeObject(); }
  const C0 = book.localToWorld(new THREE.Vector3(0, BOOK.d / 2, 0)), W0 = grasp(hold).reach.R.point.clone();
  const left = new THREE.Vector3(1, 0, 0), up = new THREE.Vector3(0, 1, 0), back = new THREE.Vector3(0, 0, -1);
  const tiltW = (tt) => smooth((tt - (T.lift + 0.1)) / 1.0) * (1 - smooth((tt - (T.place - 0.9)) / 0.8)); // بيبدأ مع الشيل: الكتاب يطلع لمكان القراية في منحنى واحد
  const readTilt = (gs, tt) => {
    const w = tiltW(tt); if (!gs.reach || !gs.reach.R || w <= 0) return gs.reach;
    const r = gs.reach.R, q = new THREE.Quaternion().setFromAxisAngle(left, -58 * Math.PI / 180 * w);
    const C = C0.clone().addScaledVector(up, 0.24 * w).addScaledVector(back, 0.02 * w).addScaledVector(left, 0.1 * w);
    return { R: { ...r, point: C.clone().add(r.point.clone().sub(C0).applyQuaternion(q)), fing: r.fing.clone().applyQuaternion(q), palm: r.palm.clone().applyQuaternion(q) } };
  };
  // الحطّ: لو مكان المسك (قاعد) أوطى من سطح الترابيزة، الطريق المستقيم بيعدّي الكتاب من تحت حرفها.
  // طبقة فوق المسكة: الإيد تطلع فوق مكان الحطّ الأول، تعدّي فوقه، وبعدين تنزل رأسي (grasp.js ما اتغيّرش)
  const Wh = grasp(T.place).reach.R.point.clone(), Wp = grasp(T.release - 1e-3).reach.R.point.clone();
  const lift = Math.max(0, sideTop + 0.06 - Wp.y) + 0.06;
  const Wa = Wp.clone().add(new THREE.Vector3(0, lift, 0)), Wm = new THREE.Vector3((Wh.x + Wa.x) / 2, Wa.y + 0.02, (Wh.z + Wa.z) / 2);
  const cr = (p0, p1, p2, p3, f) => { const f2 = f * f, f3 = f2 * f; return new THREE.Vector3().addScaledVector(p0, -0.5 * f3 + f2 - 0.5 * f).addScaledVector(p1, 1.5 * f3 - 2.5 * f2 + 1).addScaledVector(p2, -1.5 * f3 + 2 * f2 + 0.5 * f).addScaledVector(p3, 0.5 * f3 - 0.5 * f2); };
  const placePath = (u) => { const P = [Wh, Wh, Wm, Wa, Wp, Wp], n = 3, x = Math.min(0.9999, Math.max(0, u)) * n, i = Math.floor(x); return cr(P[i], P[i + 1], P[i + 2], P[i + 3], x - i); };
  // نفس الشي في الشيل: الإيد تطلع لفوق الأول، وتخرج برّه الترابيزة، وبعدين تنزل لمكان المسك
  const LIFT = Math.min(1.1, T.place - T.lift), Wg = grasp(T.lift).reach.R.point.clone();
  const Wu = Wg.clone().add(new THREE.Vector3(0, 0.07, 0)), Wo = new THREE.Vector3((Wg.x + Wh.x) / 2, Wg.y + 0.07, (Wg.z + Wh.z) / 2);
  const liftPath = (u) => { const P = [Wg, Wg, Wu, Wo, Wh, Wh], n = 4, x = Math.min(0.9999, Math.max(0, u)) * n, i = Math.min(n - 1, Math.floor(x)); return cr(P[i], P[i + 1], P[Math.min(5, i + 2)], P[Math.min(5, i + 3)], x - i); };
  const routeLift = (rr, tt) => {
    if (!rr || !rr.R || tt < T.lift || tt >= T.lift + LIFT) return rr;
    return { R: { ...rr.R, point: liftPath(smooth((tt - T.lift) / LIFT)) } };
  };
  const routePlace = (rr, tt) => {
    if (!rr || !rr.R || tt < T.place || tt >= T.release) return rr;
    return { R: { ...rr.R, point: placePath(smooth((tt - T.place) / (T.release - T.place))) } };
  };
  // البصّة: بتتنقل بين أهداف بنعومة وبتأخير ~0.2 ثانية (انتباه متأخر، مش لفّة راس فجأة)
  const shotA = { at: 0, pos: [0.55, 1.3, 2.75], look: [-0.95, 0.78, -0.2], fov: 36, name: "A: medium-wide 3/4" };
  const shotB = { at: 7.05, pos: [-0.62, 1.12, 1.45], look: [-0.64, 0.98, -0.2], fov: 30, name: "B: medium close-up, eye level" };
  const shotA2 = { ...shotA, at: 8.35, name: "A2: back to medium-wide (placing the book)" };
  const camB = new THREE.Vector3(...shotB.pos);
  const bookC = () => book.localToWorld(new THREE.Vector3(0, BOOK.d / 2, 0));
  const ahead = new THREE.Vector3(sitX, 1.0, 2.5);
  const gazeKeys = [[0, () => ahead], [1.0, () => from.clone()], [3.2, bookC], [6.9, () => camB], [8.3, () => to.clone()], [10.1, () => ahead]];
  // الجسم بيلف ناحية الترابيزة الجانبية وهو بيبص/بيمد إيده (زي الحقيقة: الراس لوحدها ما بتلفّش 90°)
  const sideTurn = (tt) => -18 * smooth((tt - 1.0) / 0.7) * (1 - smooth((tt - 3.3) / 0.8)) - 14 * smooth((tt - 8.2) / 0.6) * (1 - smooth((tt - 9.9) / 0.7));
  const headPos = new THREE.Vector3(sitX, 1.12, hipsZ);
  const gaze = (tt) => {
    const d = tt - 0.2; let p = gazeKeys[0][1]();
    for (let i = 1; i < gazeKeys.length; i++) p = p.clone().lerp(gazeKeys[i][1](), smooth((d - gazeKeys[i][0]) / 0.55));
    // حد ناعم لِلَفّة الراس (±65°): الـ rig فيه حد ثابت 75°، ولو الهدف عدّاه الراس بتقف فجأة (وفي هيكل Biped الكتف متعلق في الرقبة فالإيد بتتنطّ)
    const v = p.clone().sub(headPos), yaw = Math.atan2(v.x, v.z), lim = 65 * Math.PI / 180;
    const yaw2 = lim * Math.tanh(yaw / lim) ; const hr = Math.hypot(v.x, v.z);
    return headPos.clone().add(new THREE.Vector3(Math.sin(yaw2) * hr, v.y, Math.cos(yaw2) * hr));
  };
  return {
    duration: 11.6, words: [], R, cupObj: book, actors: [R], T,
    frame(tt) {
      const gs = grasp(tt);
      let rr = routePlace(readTilt({ ...gs, reach: routeLift(gs.reach, tt) }, tt), tt);
      // قاعد: ثني الركب اللي الـ rig بيعمله للحاجة الواطية (للواقف) بيتلغي، علشان الوسط ما يغطسش في الكنبة (نفس معادلة rig.js بالعكس)
      let rc = 0; for (const r of Object.values(rr || {})) if (r && r.w > 0) rc = Math.max(rc, smooth((1.05 * k - r.point.y) / (0.7 * k)) * 0.26 * smooth(r.w));
      const X = window.__rd || {}; // للتشخيص بس: تعطيل طبقة طبقة
      if (X.noReach) rr = null; if (X.noCancel) rc = 0;
      // قاعد: رجوع الوسط لورا مع الميلة (توازن الواقف في rig.js: sin(lean) × 0.15) بيتلغي، علشان الركب ما تتشدّش جوه الكنبة
      const leanNow = perf(tt).P.body.lean + (gs.bodyAdd.lean || 0), hipFwd = Math.sin(Math.max(0, leanNow) * Math.PI / 180) * 0.15 * k;
      pose(tt, rr, { bodyAdd: X.noBody ? { crouch: -rc } : { ...gs.bodyAdd, crouch: -rc, shiftZ: hipFwd, turn: (gs.bodyAdd.turn || 0) + sideTurn(tt) }, lookPoint: X.noGaze ? new THREE.Vector3(sitX, 1, 2.5) : gaze(tt), lookW: 1 });
      gs.placeObject();
      const ct = gs.mode === "held" ? gs.contact() : null;
      // الكتاب: لو مش ممسوك لازم يبقى قاعد على الترابيزة (مش طاير ولا غاطس)
      const bb = new THREE.Box3().setFromObject(book);
      const s = R.side.Right, hv = handSkin(ch, s); let low = Infinity;
      eachSkin([...hv.palm, ...hv.fing.flat(2)], (v) => { if (v.x < sb.max.x && v.x > sb.min.x && v.z < sb.max.z && v.z > sb.min.z) low = Math.min(low, v.y); });
      const over = bb.max.x > sb.min.x && bb.min.x < sb.max.x && bb.max.z > sb.min.z && bb.min.z < sb.max.z;
      const bookInTable = over && bb.min.y < sideTop - 0.001 && bb.max.y > sb.min.y ? +((sideTop - bb.min.y) * 1000).toFixed(1) : 0; // مم جوه سطح الترابيزة
      return { bookInTableMM: bookInTable, mode: gs.mode, pen: ct ? Math.min(ct.palm, ct.fingers) : null, palmMM: ct ? +(ct.palm * 1000).toFixed(1) : null,
        bookBottom: +bb.min.y.toFixed(4), tableTop: +sideTop.toFixed(4), handLowOverTable: isFinite(low) ? +low.toFixed(4) : null,
        shot: tt >= shotA2.at ? "A2" : tt >= shotB.at ? "B" : "A", tilt: +tiltW(tt).toFixed(3), actors: [R] };
    },
    shots: [shotA, shotB, shotA2],
    cameras: { wide: shotA, close: shotB, reachClose: { pos: [-0.75, 1.15, 0.85], look: [-1.25, 0.78, -0.17], fov: 34 },
      readClose: { pos: [-0.2, 1.1, 0.95], look: [-0.66, 0.9, 0.0], fov: 34 }, readSide: { pos: [-1.55, 1.05, 0.15], look: [-0.66, 0.85, 0.05], fov: 34 } },
    info: { seatTop, sideTop, couch: cb, wallH: wall.box.max.y, lampH: lamp.box.max.y, cupH: cup.box.max.y - cup.box.min.y, shelfH: shelf.box.max.y, rug: rug.box.max.y },
  };
}

// ---------- الواجهة اللي السكريبت بيستخدمها ----------
let S, cam, r, scene, prevBones = null, prevVel = null;
window.setupLab = async (name, camName = "wide", opts = {}) => {
  r = engine(); scene = new THREE.Scene();
  const set = await buildSet(scene, "studio", "soft", "day", PAL, 1);
  lights(scene, set, "day", "soft", PAL);
  S = name === "duo" ? await sceneDuo(scene) : name === "clips" ? await sceneClips(scene, opts) : name === "read" ? await sceneRead(scene, opts) : await sceneCup(scene, opts);
  await settled();
  // "edit": المشهد بيدّي لقطات بأوقات قطع (shots)؛ غير كده كاميرا ثابتة بالاسم
  const c = camName === "edit" && S.shots ? S.shots[0] : S.cameras[camName] || S.cameras.wide;
  cam = new THREE.PerspectiveCamera(c.fov, W / H, 0.05, 100); cam.position.set(...c.pos); cam.lookAt(new THREE.Vector3(...c.look));
  S._editMode = camName === "edit" && !!S.shots;
  document.body.appendChild(r.domElement); r.domElement.style.cssText = "position:absolute;left:0;top:0;width:1080px;height:1920px";
  prevBones = null; prevVel = null; window.__S = S;
  return S.duration;
};
// بيرسم لحظة t وبيرجّع القياسات (لازم الفريمات تتنادى بالترتيب علشان قياس "النطّة" بين فريمين)
window.labFrame = (t) => {
  if (S._editMode) { // القطع: اللقطة اللي وقتها بدأ
    const sh = S.shots.filter((x) => t >= x.at).pop() || S.shots[0];
    cam.fov = sh.fov; cam.updateProjectionMatrix(); cam.position.set(...sh.pos); cam.lookAt(new THREE.Vector3(...sh.look));
  }
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
