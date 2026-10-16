// مشاهد 3D جوه الفيديو: شخصية Mixamo بتمثّل (حركات من المكتبة) في مكان مبني من كيتات Kenney و KayKit،
// بكاميرا سينمائية وإضاءة حسب الوقت، وشكل ناعم أو أنيمي (تظليل مسطح + خطوط).
// كل حاجة حتمية: وقت كل حركة بيتحط بإيدنا (action.time) وبعدين mixer.update(0).
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { setupRig, buildPerformance, applyPose, BODY } from "./rig.js";
import { cameraAt as directorCamera, anchors, drawEmote, drawFx } from "./director.js";


const W = 1080, H = 1920;
const A = "/assets/3d/";
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = (x) => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ---------- محرّك واحد لكل المشاهد (بيرسم المشهد وبعدين بننسخه على canvas المشهد) ----------
let renderer;
function engine() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

// ---------- تحميل ----------
// كل التحميل (والصور اللي جوه الموديلات) بيعدّي على مدير واحد، علشان نستنى كل الصور قبل أول رسمة
// (FBX بيرجّع الموديل قبل ما صور الخامات تخلص، فالشخصية كانت بتطلع سودا في أول فريمات)
const manager = new THREE.LoadingManager();
let pending = 0, waiters = [];
manager.itemStart = ((orig) => function (u) { pending++; return orig.call(this, u); })(manager.itemStart);
manager.itemEnd = ((orig) => function (u) { pending--; const r = orig.call(this, u); if (pending <= 0) { waiters.forEach((f) => f()); waiters = []; } return r; })(manager.itemEnd);
manager.itemError = ((orig) => function (u) { console.warn("3D asset failed", u); return orig.call(this, u); })(manager.itemError);
const settled = () => new Promise((res) => (pending <= 0 ? res() : waiters.push(res)));
const fbx = new FBXLoader(manager), gltf = new GLTFLoader(manager);
const cache = {};
const once = (key, fn) => (cache[key] ??= fn());

const CHAR = { // نفس الكتالوج اللي في three_d.py
  Aj: ["Aj_Idle", 1.75], Ty: ["characters/Ty", 1.7], Big_Vegas: ["characters/Big_Vegas", 1.75], Timmy: ["characters/Timmy", 1.25],
  Doozy: ["characters/Doozy", 1.3], Claire: ["characters/Claire", 1.68], Amy: ["characters/Amy", 1.62], Kaya: ["characters/Kaya", 1.72],
  Megan: ["characters/Megan", 1.68], Kate: ["characters/Kate", 1.68], Jody: ["characters/Jody", 1.66], Sporty_Granny: ["characters/Sporty_Granny", 1.6],
};
const CLIP_FILE = { idle: "Aj_Idle", talking: "Aj_Talking", thinking: "Aj_Thinking", walking: "Aj_Walking" };
const WALKS = new Set(["walking", "walk_female"]);
const SOURCE = { prefix: "mixamorig", hipsY: 83.2 }; // الحركات متصدّرة على Aj

async function characterBase(name) {
  return once(`ch:${name}`, async () => {
    const [file] = CHAR[name] || CHAR.Aj;
    const root = await fbx.loadAsync(`${A}mixamo/${file}.fbx`);
    root.updateMatrixWorld(true);
    let hips;
    root.traverse((o) => { if (o.isBone && /Hips$/.test(o.name) && !hips) hips = o; });
    return { root, prefix: hips.name.replace(/Hips$/, ""), hipsY: hips.getWorldPosition(new THREE.Vector3()).y };
  });
}
const loadClip = (anim) => once(`clip:${anim}`, async () =>
  (await fbx.loadAsync(`${A}mixamo/${CLIP_FILE[anim] ? CLIP_FILE[anim] : "anims/" + anim}.fbx`)).animations[0]);

// الحركة على شخصية تانية: بادئة العضم + طول الوسط، ومن غير ما الوسط يتزحلق (الحركة في مكانها)
function retarget(clip, ch) {
  const out = clip.clone(), ratio = ch.hipsY / SOURCE.hipsY;
  out.tracks = out.tracks.map((tr) => {
    const t = tr.clone();
    t.name = t.name.replace(new RegExp("^" + SOURCE.prefix + "(?=[A-Z])"), ch.prefix);
    if (/Hips\.position$/.test(t.name)) {
      const v = t.values, x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 1] *= ratio; v[i + 2] = z0; }
    }
    return t;
  });
  return out;
}

let toonRamp;
function toonGradient() {
  if (toonRamp) return toonRamp;
  const d = new Uint8Array([55, 150, 255]); // 3 درجات ظل واضحة (شكل الأنيمي)
  toonRamp = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.needsUpdate = true;
  return toonRamp;
}
const OUTLINE = new THREE.MeshBasicMaterial({ color: "#1b1424", side: THREE.BackSide });
OUTLINE.onBeforeCompile = (sh) => {
  sh.uniforms.thick = { value: 0.012 };
  sh.vertexShader = "uniform float thick;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += normalize(normal) * thick;");
};
function addOutlines(obj, thick) {
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh && !o.userData.outline && o.geometry.attributes.normal) meshes.push(o); });
  for (const o of meshes) {
    const m = OUTLINE.clone(); m.onBeforeCompile = (sh) => { OUTLINE.onBeforeCompile(sh); sh.uniforms.thick.value = thick; };
    m.customProgramCacheKey = () => "outline" + thick;
    const ol = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, m) : new THREE.Mesh(o.geometry, m);
    if (o.isSkinnedMesh) ol.bind(o.skeleton, o.bindMatrix);
    ol.userData.outline = true; ol.castShadow = false; ol.frustumCulled = false;
    o.add(ol);
  }
}
function convertMaterials(obj, look, opts = {}) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = opts.shadow !== false; o.receiveShadow = true; o.frustumCulled = false;
    const conv = (m) => {
      const base = { map: m.map || null, color: m.color ? m.color.clone() : new THREE.Color("#fff"), transparent: m.transparent || m.opacity < 1,
                     opacity: m.opacity ?? 1, alphaTest: m.transparent ? 0.35 : 0, side: m.side };
      if (look === "anime") return new THREE.MeshToonMaterial({ ...base, gradientMap: toonGradient() });
      return new THREE.MeshStandardMaterial({ ...base, normalMap: opts.normalMaps === false ? null : (m.normalMap || null), roughness: 0.75, metalness: 0 });
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

async function character(name, heightM, look) {
  const base = await characterBase(name);
  const root = SkeletonUtils.clone(base.root);
  convertMaterials(root, look, { normalMaps: name !== "Doozy" });
  if (look === "anime") addOutlines(root, 1.4); // بوحدات الـ FBX (سم)
  root.scale.setScalar(0.01);
  root.updateMatrixWorld(true);
  let top = -Infinity, bottom = Infinity;
  const v = new THREE.Vector3();
  root.traverse((o) => { if (o.isBone) { o.getWorldPosition(v); top = Math.max(top, v.y); bottom = Math.min(bottom, v.y); } });
  root.scale.multiplyScalar(heightM / ((top - bottom) * 1.04));
  const hips = (() => { let h; root.traverse((o) => { if (o.isBone && /Hips$/.test(o.name) && !h) h = o; }); return h; })();
  const bone = (n) => { let b; root.traverse((o) => { if (o.isBone && o.name === base.prefix + n && !b) b = o; }); return b; };
  const head = bone("Head");
  // الرجلين: الكعب (عضمة الـ Foot) والصوابع (ToeBase). في الوضع الأصلي الرجل مفرودة على الأرض،
  // فبنقيس ارتفاع كل عضمة فوق النعل علشان نعرف بعدين نقطة لمس الأرض في أي وضعية
  root.updateMatrixWorld(true);
  const minY = new THREE.Box3().setFromObject(root).min.y;
  const feet = ["Left", "Right"].map((side) => {
    const ankle = bone(side + "Foot"), toe = bone(side + "ToeBase");
    const y = (b) => (b ? b.getWorldPosition(v).y - minY : 0);
    return { ankle, toe, ankleH: y(ankle), toeH: y(toe) };
  }).filter((f) => f.ankle);
  return { root, prefix: base.prefix, hipsY: base.hipsY, hips, head, feet, bone, name, mixer: new THREE.AnimationMixer(root), height: heightM };
}

function addPhone(ch) {
  let bone; ch.root.traverse((o) => { if (o.isBone && o.name === ch.prefix + "RightHand") bone = o; });
  if (!bone) return;
  ch.root.updateMatrixWorld(true);
  const s = bone.getWorldScale(new THREE.Vector3()).x;
  const phone = new THREE.Group();
  phone.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.012), new THREE.MeshStandardMaterial({ color: "#1d1d22", roughness: 0.35 })));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.135), new THREE.MeshStandardMaterial({ color: "#5aa0ff", emissive: "#2a5ab0", emissiveIntensity: 0.8 }));
  screen.position.z = 0.0065; phone.add(screen);
  phone.scale.setScalar(1 / s);
  phone.position.set(0, 0.085 / s, 0.025 / s);
  phone.rotation.set(0, Math.PI / 2, 0);
  bone.add(phone);
}

// قطعة أثاث/مكان: بنحدد طولها الحقيقي بالمتر (أو عرضها) والمقاس بيتحسب لوحده مهما كانت وحدة الكيت
async function prop(scene, look, { f, p = [0, 0], r = 0, h, w, y = 0, shadow = true }) {
  const g = await once(`gl:${f}`, () => gltf.loadAsync(A + f));
  const o = g.scene.clone(true);
  const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3());
  const s = h ? h / size.y : w ? w / Math.max(size.x, size.z) : 1;
  o.scale.setScalar(s);
  const b2 = new THREE.Box3().setFromObject(o), c = b2.getCenter(new THREE.Vector3());
  o.position.set(-c.x, y - b2.min.y, -c.z); // متوسّطة حوالين نقطتها وقاعدتها على الأرض (أو على ارتفاع y)
  const wrap = new THREE.Group(); wrap.add(o);
  wrap.rotation.y = (r * Math.PI) / 180; wrap.position.set(p[0], 0, p[1]); // اللف حوالين مكانها
  convertMaterials(wrap, look, { shadow });
  if (look === "anime") addOutlines(o, 0.025 / s);
  scene.add(wrap);
  return wrap;
}

// ---------- الأماكن ----------
const KF = "kaykit-furniture/", FK = "furniture-kit/", KR = "kaykit-restaurant/", KC = "kaykit-city/", NK = "nature-kit/", CC = "city-kit-commercial/";
const SETS = {
  room: { indoor: true, floor: "#b98a5e", wall: "#efe2cf", props: [
    { f: KF + "bed_single_A.gltf", p: [-1.75, -1.55], h: 0.62 }, { f: KF + "shelf_B_large_decorated.gltf", p: [1.3, -2.35], w: 1.3 },
    { f: KF + "lamp_standing.gltf", p: [2.25, -1.95], h: 1.65, shadow: false, light: true }, { f: KF + "rug_oval_A.gltf", p: [0.1, 0.1], w: 2.3 },
    { f: KF + "cactus_medium_A.gltf", p: [-2.35, 0.7], h: 0.8 }, { f: KF + "pictureframe_large_A.gltf", p: [-0.4, -2.56], y: 1.35, w: 0.8 },
    { f: KF + "table_small.gltf", p: [-2.4, -2.2], h: 0.55 }, { f: KF + "lamp_table.gltf", p: [-2.4, -2.2], y: 0.55, h: 0.45, shadow: false } ] },
  living: { indoor: true, floor: "#a77b55", wall: "#e9dccb", props: [
    { f: KF + "couch_pillows.gltf", p: [0, -2.05], h: 0.85 }, { f: KF + "table_low.gltf", p: [0, -1.05], h: 0.42 },
    { f: KF + "rug_rectangle_stripes_A.gltf", p: [0, -0.7], w: 3.0 }, { f: KF + "lamp_standing.gltf", p: [-1.95, -2.15], h: 1.65, shadow: false, light: true },
    { f: KF + "shelf_B_large_decorated.gltf", p: [2.5, -1.3], r: -90, w: 1.3 }, { f: KF + "armchair_pillows.gltf", p: [-2.2, -0.3], r: 60, h: 0.85 },
    { f: KF + "pictureframe_large_B.gltf", p: [0, -2.56], y: 1.5, w: 0.8 }, { f: KF + "cactus_small_A.gltf", p: [0.35, -1.05], y: 0.42, h: 0.3 } ] },
  office: { indoor: true, floor: "#7d8794", wall: "#e4e7ea", props: [
    { f: FK + "desk.glb", p: [0, -1.45], h: 0.76 }, { f: FK + "computerScreen.glb", p: [0, -1.6], y: 0.76, h: 0.42 },
    { f: FK + "computerKeyboard.glb", p: [0, -1.3], y: 0.76, w: 0.45 }, { f: FK + "chairDesk.glb", p: [0.95, -0.85], r: -35, h: 1.05 },
    { f: FK + "bookcaseOpen.glb", p: [-2.2, -2.35], h: 2.0 }, { f: FK + "pottedPlant.glb", p: [2.25, -2.2], h: 1.15 },
    { f: FK + "lampSquareFloor.glb", p: [2.4, -0.7], h: 1.6, shadow: false, light: true }, { f: KF + "rug_rectangle_A.gltf", p: [0, -0.4], w: 2.6 } ] },
  kitchen: { indoor: true, floor: "#d9d2c5", wall: "#f1ece2", props: [
    { f: KR + "kitchencounter_straight_A_decorated.gltf", p: [-1.6, -2.25], h: 0.95 }, { f: KR + "kitchencounter_sink.gltf", p: [-0.55, -2.25], h: 0.95 },
    { f: KR + "stove_single.gltf", p: [0.5, -2.25], h: 0.95 }, { f: KR + "fridge_A_decorated.gltf", p: [1.75, -2.25], h: 2.0 },
    { f: KR + "kitchentable_A.gltf", p: [-2.0, 0.1], h: 0.78 }, { f: KR + "chair_A.gltf", p: [-2.0, 0.85], r: 180, h: 0.9 },
    { f: KR + "pot_A_stew.gltf", p: [0.5, -2.25], y: 0.95, h: 0.25 }, { f: KR + "crate_tomatoes.gltf", p: [2.4, -0.6], h: 0.35 } ] },
  // العماير: صف واحد على الرصيف التاني، كل عمارة جنب التانية بعرضها الحقيقي، وواجهتهم على بعد 9.5 متر
  street: { indoor: false, ground: "#8d8f93", row: { z: -9.5, items: [
    { f: CC + "building-a.glb", h: 9 }, { f: CC + "building-c.glb", h: 13 }, { f: CC + "building-e.glb", h: 8 }, { f: CC + "building-g.glb", h: 12 },
    { f: CC + "building-d.glb", h: 10 }, { f: CC + "building-h.glb", h: 11 }, { f: CC + "building-b.glb", h: 9 }] },
    props: [ { f: CC + "building-skyscraper-b.glb", p: [6, -40], h: 45 }, { f: CC + "building-skyscraper-d.glb", p: [-14, -46], h: 50 },
    { f: KC + "streetlight.gltf", p: [2.4, -2.3], h: 4.2 }, { f: KC + "car_taxi.gltf", p: [-3.2, -5.2], r: 90, h: 1.5 },
    { f: KC + "car_sedan.gltf", p: [4.5, -6.6], r: -90, h: 1.45 }, { f: KC + "bench.gltf", p: [-1.6, -2.1], h: 0.7 },
    { f: KC + "bush.gltf", p: [-3.1, -2.4], h: 0.9 }, { f: KC + "trash_A.gltf", p: [1.4, -2.4], h: 0.9 }, { f: KC + "firehydrant.gltf", p: [3.4, -1.4], h: 0.7 } ] },
  park: { indoor: false, ground: "#7fae5a", props: [
    { f: NK + "tree_oak.glb", p: [-3.5, -5], h: 5.5 }, { f: NK + "tree_default.glb", p: [3.8, -6.5], h: 6 }, { f: NK + "tree_detailed.glb", p: [-8, -10], h: 7 },
    { f: NK + "tree_fat.glb", p: [8, -11], h: 6.5 }, { f: NK + "tree_oak.glb", p: [0.5, -14], h: 8 }, { f: NK + "tree_default.glb", p: [-13, -16], h: 7 },
    { f: KC + "bench.gltf", p: [1.9, -1.8], r: -20, h: 0.7 }, { f: NK + "rock_largeA.glb", p: [-2.6, -2.2], h: 0.7 },
    { f: NK + "flower_redA.glb", p: [-1.6, 0.9], h: 0.35 }, { f: NK + "flower_yellowB.glb", p: [2.4, 0.4], h: 0.35 }, { f: NK + "flower_purpleA.glb", p: [-2.4, -0.4], h: 0.35 },
    { f: NK + "plant_bushLarge.glb", p: [3.2, -2.8], h: 1.1 }, { f: NK + "grass_large.glb", p: [-0.8, -1.6], h: 0.3 }, { f: NK + "path_stone.glb", p: [0, -0.4], w: 1.4 } ] },
  cafe: { indoor: true, floor: "#8a6a52", wall: "#efe0cc", props: [
    { f: KR + "kitchencounter_straight_B.gltf", p: [-1.3, -2.25], h: 1.0 }, { f: KR + "kitchencounter_straight_B_backsplash.gltf", p: [-0.3, -2.25], h: 1.0 },
    { f: KR + "shelf_papertowel_decorated.gltf", p: [1.0, -2.45], y: 1.3, w: 0.9 }, { f: KR + "table_round_A_decorated.gltf", p: [1.75, -0.9], h: 0.78 },
    { f: KR + "chair_A.gltf", p: [2.4, -0.5], r: -120, h: 0.9 }, { f: KR + "table_round_A_small_decorated.gltf", p: [-2.2, -0.2], h: 0.75 },
    { f: KR + "chair_B.gltf", p: [-2.25, 0.5], r: 180, h: 0.9 }, { f: KR + "pillar_A.gltf", p: [2.55, -2.3], h: 2.6 },
    { f: KF + "lamp_standing.gltf", p: [-2.5, -2.2], h: 1.65, shadow: false, light: true }, { f: KR + "crate_carrots.gltf", p: [0.6, -2.3], h: 0.35 } ] },
  studio: { indoor: false, studio: true, props: [] },
};

async function hdri(name) {
  return once(`hdr:${name}`, async () => { const t = await new RGBELoader().loadAsync(`${A}hdri/${name}.hdr`); t.mapping = THREE.EquirectangularReflectionMapping; return t; });
}
function gradientSky(top, bottom) {
  const c = document.createElement("canvas"); c.width = 4; c.height = 256;
  const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const mix = (a, b, p) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), p).getHexString();

async function buildSet(scene, spec, look, time, pal, seed) {
  const set = SETS[spec] || SETS.studio;
  const mat = (color, rough = 0.85) => look === "anime" ? new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() }) : new THREE.MeshStandardMaterial({ color, roughness: rough });
  let lampPos = null;
  if (set.indoor) {
    // حيطان وأرضية بلون مايل لألوان الفيديو علشان كل فيديو يبان ليه شخصيته
    const wallC = mix(set.wall, pal.surface || set.wall, 0.25), floorC = mix(set.floor, pal.accent || set.floor, 0.12);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), mat(floorC, 0.7)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), mat(wallC)); back.position.set(0, 3, -2.6); back.receiveShadow = true; scene.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), mat(mix(wallC, "#000", 0.06))); left.position.set(-2.9, 3, 1.5); left.rotation.y = Math.PI / 2; left.receiveShadow = true; scene.add(left);
    const right = left.clone(); right.position.x = 2.9; right.rotation.y = -Math.PI / 2; scene.add(right);
    const base = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 0.04), mat(mix(wallC, "#000", 0.25))); base.position.set(0, 0.06, -2.58); scene.add(base);
    scene.background = new THREE.Color(mix(wallC, "#000", 0.5));
    if (look !== "anime") { scene.environment = await hdri("studio_small_09"); scene.environmentIntensity = 0.35; }
  } else if (set.studio) {
    // استوديو: خلفية منحنية بلون الفيديو (cyclorama)
    const c = pal.surface || "#2a2235";
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(c, 0.9)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const curve = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 30, 48, 1, true, Math.PI * 0.5, Math.PI), mat(c, 0.95));
    curve.material.side = THREE.BackSide; curve.rotation.y = Math.PI; scene.add(curve);
    scene.background = new THREE.Color(c);
    scene.fog = new THREE.Fog(c, 7, 22);
    if (look !== "anime") { scene.environment = await hdri("brown_photostudio_02"); scene.environmentIntensity = 0.5; }
  } else {
    const gc = time === "night" ? mix(set.ground, "#0a1030", 0.55) : set.ground;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat(gc, 0.95)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    if (spec === "street") { // رصيف + طريق بخطوط
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(200, 3.6), mat(mix(gc, "#fff", 0.25))); walk.rotation.x = -Math.PI / 2; walk.position.set(0, 0.01, -1.2); walk.receiveShadow = true; scene.add(walk);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 6), mat(mix(gc, "#000", 0.55))); road.rotation.x = -Math.PI / 2; road.position.set(0, 0.012, -6); road.receiveShadow = true; scene.add(road);
      for (let x = -40; x < 40; x += 4) { const d = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.15), mat("#f2efe6")); d.rotation.x = -Math.PI / 2; d.position.set(x, 0.015, -6); scene.add(d); }
    }
    if (look === "anime" || time === "night") {
      const sky = { day: ["#5aa9e6", "#d8efff"], sunset: [mix("#3b2a6b", pal.accent2 || "#3b2a6b", 0.3), "#ffb27a"], night: ["#050a24", "#1c2c5e"] }[time] || ["#5aa9e6", "#d8efff"];
      scene.background = gradientSky(...sky);
    } else {
      // سما حقيقية (HDRI): سما الغروب، أو واحدة من سمتين للنهار حسب المشهد
      const tex = await hdri(time === "sunset" ? "venice_sunset" : seed % 2 ? "lebombo" : "kloofendal_48d_partly_cloudy_puresky");
      scene.background = tex; scene.backgroundIntensity = 0.9; scene.environment = tex; scene.environmentIntensity = 0.4;
    }
    scene.fog = new THREE.Fog(time === "night" ? "#0d1638" : time === "sunset" ? "#e8a27a" : "#cfe3f3", 18, 70);
  }
  const placed = [];
  if (set.row) { // صف عماير: بنحمّلهم ونرصّهم جنب بعض من النص
    const objs = await Promise.all(set.row.items.map((pr) => prop(scene, look, { ...pr, p: [0, 0] })));
    const widths = objs.map((o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).x + 0.6);
    let x = -widths.slice(0, Math.floor(objs.length / 2)).reduce((a, b) => a + b, 0) - widths[Math.floor(objs.length / 2)] / 2;
    objs.forEach((o, i) => { const b = new THREE.Box3().setFromObject(o); o.position.x = x + widths[i] / 2; o.position.z = set.row.z - b.max.z; x += widths[i]; });
  }
  await Promise.all(set.props.map(async (pr) => {
    const o = await prop(scene, look, pr);
    placed.push(o);
    if (pr.light) { const b = new THREE.Box3().setFromObject(o); lampPos = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y - 0.2, (b.min.z + b.max.z) / 2); }
  }));
  return { set, lampPos, placed };
}

// الأثاث ما يدخلش في الشخصية: أي حاجة جوه مساحة حركتها بتتزق لبره (أو بتتشال لو مفيش مكان)
function clearArea(scene, placed, zone) {
  for (const o of placed) {
    const b = new THREE.Box3().setFromObject(o);
    if (b.max.y < 0.12) continue; // سجاد: عادي
    const nx = Math.max(zone.x0 - b.max.x, b.min.x - zone.x1, 0), nz = Math.max(zone.z0 - b.max.z, b.min.z - zone.z1, 0);
    if (nx > 0 || nz > 0) continue; // بعيد
    // أقصر اتجاه للخروج
    const moves = [[zone.x0 - b.max.x - 0.05, 0], [zone.x1 - b.min.x + 0.05, 0], [0, zone.z0 - b.max.z - 0.05]];
    moves.sort((m1, m2) => Math.hypot(...m1) - Math.hypot(...m2));
    const [dx, dz] = moves[0];
    if (Math.hypot(dx, dz) > 1.6) { scene.remove(o); continue; }
    o.position.x += dx; o.position.z += dz;
  }
}

function lights(scene, setInfo, time, look, pal = {}) {
  const { set, lampPos } = setInfo;
  const night = time === "night", sunset = time === "sunset";
  const k = look === "anime" ? 1.15 : 1;
  scene.add(new THREE.HemisphereLight(night ? "#5a6cb0" : sunset ? "#ffc9a0" : "#eef6ff", night ? "#120f1c" : "#6b5a48", (night ? 0.08 : sunset ? 1.0 : 1.5) * k));
  const sun = new THREE.DirectionalLight(night ? "#8fa4ff" : sunset ? "#ff9a55" : "#fff3e0", (night ? 0.45 : sunset ? 2.6 : 2.4) * k);
  sun.position.set(sunset ? 7 : 4, sunset ? 3 : 8, 5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005;
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 40 });
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(night ? "#5f6fb0" : "#ffe0c0", (night ? 0.18 : 0.5) * k); fill.position.set(-4, 2.5, 6); scene.add(fill);
  // نور الضهر بلون الفيديو التاني، ونور الأباجورة باللون المميز: الإضاءة نفسها بتحكي بألوان الهوية
  const rim = new THREE.DirectionalLight(night ? mix("#7fa0ff", pal.accent2 || "#7fa0ff", 0.6) : "#ffffff", (night ? 1.6 : 1.1) * k); rim.position.set(-2, 3.5, -5); scene.add(rim); // نور من ورا بيفصل الشخصية عن الخلفية
  const key = new THREE.SpotLight(night ? mix("#ffd2a8", pal.accent || "#ffd2a8", 0.35) : "#fff4e6", (night ? 7 : 14) * k, 14, 0.32, 0.85, 1.4);
  key.position.set(2.2, 3.4, 4.2); key.target.position.set(0, 1.0, 0); scene.add(key, key.target);
  if (set.indoor && lampPos) {
    const lamp = new THREE.PointLight(mix("#ffb062", pal.accent || "#ffb062", 0.5), night ? 26 : 5, 8, 2); lamp.position.copy(lampPos); scene.add(lamp);
  }
  if (set.studio) { const spot = new THREE.SpotLight("#ffffff", 60, 18, 0.5, 0.6, 1.5); spot.position.set(0, 7, 4); spot.target.position.set(0, 0.8, 0); spot.castShadow = true; scene.add(spot, spot.target); }
}

// ---------- الكاميرا ----------
function cameraAt(kind, p, ch, x0, z0 = 0) {
  const h = ch.height, cx = x0;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const e = ease(p);
  switch (kind) {
    case "push_in": return { pos: P(cx + 0.25, h * 0.85, z0 + lerp(4.4, 2.5, e)), look: P(cx, h * 0.62, z0), fov: 42 };
    case "pull_out": return { pos: P(cx, lerp(h * 0.85, h * 1.4, e), z0 + lerp(2.0, 5.8, e)), look: P(cx, h * 0.55, z0), fov: 42 };
    case "orbit": { const a = lerp(-0.6, 0.6, e); return { pos: P(cx + Math.sin(a) * 3.4, h * 0.8, z0 + Math.cos(a) * 3.4), look: P(cx, h * 0.58, z0), fov: 42 }; }
    case "low_angle": return { pos: P(cx + 0.4, 0.35, z0 + lerp(3.2, 2.6, e)), look: P(cx, h * 0.75, z0), fov: 48 };
    case "high_angle": return { pos: P(cx + 0.3, lerp(4.4, 3.8, e), z0 + 2.6), look: P(cx, h * 0.35, z0), fov: 46 };
    case "close_up": return { pos: P(cx + lerp(0.15, -0.1, e), h * 0.9, z0 + lerp(1.5, 1.25, e)), look: P(cx, h * 0.84, z0), fov: 38 };
    case "tracking": return { pos: P(cx + 0.3, h * 0.8, z0 + 4.3), look: P(cx, h * 0.6, z0), fov: 42 };
    case "dutch": return { pos: P(cx - 0.4, h * 0.8, z0 + lerp(3.4, 2.7, e)), look: P(cx, h * 0.62, z0), fov: 44, roll: -0.2 };
    default: return { pos: P(cx + lerp(-0.2, 0.2, e), h * 1.0, z0 + 6.2), look: P(cx, h * 0.55, z0), fov: 40 }; // static_wide
  }
}

// ---------- أداء الشخصية ----------
// الوضعية في أول وآخر كل حركة: واقف / قاعد على كرسي / قاعد على الأرض
const POSTURE = { stand_to_sit: ["stand", "sit"], sit_to_stand: ["sit", "stand"], sitting_floor: ["stand", "floor"] };
for (const a of ["sitting_idle", "sitting_talking", "sitting_laughing", "typing"]) POSTURE[a] = ["sit", "sit"];
const postureOf = (a) => POSTURE[a] || ["stand", "stand"];
// حركات بتتكرر من غير قطع (loop). الباقي بيتعمل مرة واحدة وبعدها الشخصية بترجع لوقفة طبيعية بنعومة
const LOOPS = new Set(["idle", "happy_idle", "sad_idle", "bored", "walking", "walk_female", "typing", "texting", "phone_call", "sitting_idle",
                       "sitting_talking", "talking", "dancing_hiphop", "dancing_silly", "thinking", "looking_around"]);
const JUMPY = new Set(["cheering", "victory", "excited", "dancing_hiphop", "dancing_silly"]); // فيها نط: ما نثبتش الرجل لتحت
const FILLER = { stand: "idle", sit: "sitting_idle", floor: null };
const XF = 0.5; // مدة الدمج بين حركتين (من غير نطّة في الوضعية)

// الخطة: [{anim, start}] ← تسلسل كامل: بيدخّل حركة القعدة/القيام لو الوضعية اتغيّرت، ووقفة طبيعية بعد الحركات اللي بتخلص
function performance(planned, durOf, sceneDur) {
  const seq = [];
  let posture = postureOf(planned[0].anim)[0];
  for (let i = 0; i < planned.length; i++) {
    let { anim, start } = planned[i];
    const [from, to] = postureOf(anim);
    if (from !== posture) {
      const tr = posture === "sit" && from === "stand" ? "sit_to_stand" : posture === "stand" && from === "sit" ? "stand_to_sit" : null;
      if (tr) { seq.push({ anim: tr, start }); start += durOf(tr) * 0.85; }
    }
    seq.push({ anim, start });
    posture = to;
    const next = planned[i + 1] ? planned[i + 1].start : sceneDur + 1;
    const end = start + durOf(anim);
    if (!LOOPS.has(anim) && end - XF < next - 0.3 && FILLER[posture]) seq.push({ anim: FILLER[posture], start: end - XF, filler: true });
  }
  for (let i = 1; i < seq.length; i++) seq[i].start = Math.max(seq[i].start, seq[i - 1].start + 0.4);
  return seq;
}

// ---------- البق (للشخصيات اللي فيها بق منفصل) ----------
// بنخفي البق الأصلي وقت الكلام، ونرسم مكانه بق كرتون بيتفتح ويتقفل مع حروف الكلمة اللي بتتقال
function addMouth(ch) {
  let lips;
  ch.root.traverse((o) => { if (o.isMesh && !o.userData.outline && /Mouth|^h_Geo$/i.test(o.name) && !lips) lips = o; });
  const head = ch.head;
  if (!lips || !head) return null;
  // في الوضعية الأصلية: الوش ناحية +Z
  const rotY = ch.root.rotation.y; ch.root.rotation.y = 0; ch.root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(lips);
  ch.root.rotation.y = rotY; ch.root.updateMatrixWorld(true);
  const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3());
  ch.root.rotation.y = 0; ch.root.updateMatrixWorld(true);
  const world = new THREE.Matrix4().makeTranslation(c.x, c.y - size.y * 0.03, bb.max.z - size.z * 0.05);
  const g = new THREE.Group();
  const part = (color, z, geo = new THREE.CircleGeometry(1, 40)) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.8 })); m.position.z = z; g.add(m); return m;
  };
  const LIP = { Claire: "#b3202c", Sporty_Granny: "#a5445a", Big_Vegas: "#8a4a3c", Kaya: "#7a4636" };
  const parts = { lip: part(LIP[ch.name] || "#8a4f40", 0), inner: part("#2e0f10", 0.0012), tongue: part("#c4596a", 0.0022), teeth: part("#f4efe6", 0.0024, new THREE.PlaneGeometry(1, 1)) };
  head.add(g);
  const local = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(world);
  local.decompose(g.position, g.quaternion, g.scale);
  ch.root.rotation.y = rotY; ch.root.updateMatrixWorld(true);
  g.visible = false;
  return { group: g, parts, lips, W: size.x * 0.165, H: size.x * 0.11 };
}
function setMouth(m, o) {
  const speaking = o > 0.04;
  m.lips.visible = !speaking; m.group.visible = speaking;
  if (!speaking) return;
  const W = m.W, H = m.H * o + 0.002, e = 0.004;
  m.parts.lip.scale.set(W + e, H + e, 1);
  m.parts.inner.scale.set(W - e / 2, H, 1);
  const th = Math.min(0.007, H * 0.6);
  m.parts.teeth.scale.set(W * 1.1, th, 1); m.parts.teeth.position.y = H - th / 2 - 0.001;
  m.parts.tongue.scale.set(W * 0.55, H * 0.45, 1); m.parts.tongue.position.y = -H * 0.55;
}
// فتحة البق من توقيت الكلمات (بعد ما الصوت يتعمل): الحروف بتتوزع على مدة الكلمة، المتحركة أوسع، و م ب ف مقفولة
function lipTrack(words) {
  const op = (c) => ("مبف".includes(c) ? 0.06 : "اأإآىَ".includes(c) ? 1.0 : "وُ".includes(c) ? 0.7 : "يِ".includes(c) ? 0.6 : /[ً-ْ]/.test(c) ? -1 : 0.42);
  const chars = [];
  for (const w of words) {
    const letters = [...w.word].map(op).filter((x) => x >= 0);
    const d = (w.end - w.start) / Math.max(1, letters.length);
    letters.forEach((o, i) => chars.push({ s: w.start + i * d, e: w.start + (i + 1) * d, w: o }));
  }
  const raw = (x) => { let v = 0; for (const c of chars) { if (x < c.s - 0.05 || x > c.e + 0.05) continue;
    v = Math.max(v, c.w * clamp((x - c.s + 0.03) / 0.05) * clamp((c.e - x + 0.03) / 0.05)); } return v; };
  return (x) => (raw(x - 0.03) + raw(x) + raw(x + 0.03)) / 3;
}

// ---------- كومبارس (شخصيات Kenney الصغيرة ماشية في الخلفية) ----------
const EXTRAS = ["male-a", "female-b", "male-c", "female-d", "male-e", "female-f"];
async function extras(scene, look, seed, n, far = false) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const g = await once(`gl:mini:${EXTRAS[(seed + i) % EXTRAS.length]}`, () => gltf.loadAsync(`${A}mini-characters/character-${EXTRAS[(seed + i) % EXTRAS.length]}.glb`));
    const o = SkeletonUtils.clone(g.scene);
    const b = new THREE.Box3().setFromObject(o); o.scale.setScalar(1.45 / (b.max.y - b.min.y));
    convertMaterials(o, look); if (look === "anime") addOutlines(o, 0.02);
    const mixer = new THREE.AnimationMixer(o), clip = g.animations.find((a) => a.name === "walk");
    const act = mixer.clipAction(clip); act.play();
    const dir = i % 2 ? -1 : 1;
    o.rotation.y = dir * Math.PI / 2;
    scene.add(o);
    out.push({ o, mixer, act, dir, z: (far ? -7.4 : -5.2) - i * 0.9, x0: -7 + ((seed * 3 + i * 5) % 6), speed: 1.1 + (i % 3) * 0.15, dur: clip.duration });
  }
  return (t) => out.forEach((e) => { e.act.time = t % e.dur; e.mixer.update(0); e.o.position.set(e.dir * (e.x0 + e.speed * t), 0, e.z); });
}

// ---------- المشهد ----------
// sc.scene3d = { set, character, actions: [{anim, cue_word}], camera, time, facing, speaking }
export async function createScene3D(sc, el, ctx) {
  if (sc.scene3d && sc.scene3d.performance) return createDirectedScene(sc, el, ctx); // إخراج حر (الجديد)
  const s3 = sc.scene3d, look = (ctx.look || s3.look) === "anime" ? "anime" : "soft", time = s3.time || "day";
  const seed = [...(sc.id || "s")].reduce((n, c) => n + c.charCodeAt(0), 0);
  const r = engine();
  const scene = new THREE.Scene();
  (window.__scenes3d ??= []).push(scene); // للفحص من أدوات التطوير
  const planned0 = (s3.actions && s3.actions.length ? s3.actions : [{ anim: "idle" }]).slice(0, 3);
  const setInfo = await buildSet(scene, s3.set, look, time, ctx.palette || {}, seed);
  lights(scene, setInfo, time, look, ctx.palette || {});
  const name = s3.character in CHAR ? s3.character : "Aj";
  const ch = await character(name, CHAR[name][1], look);
  const walking = planned0.some((a) => WALKS.has(a.anim));
  ch.root.rotation.y = walking ? Math.PI / 2 : { side: Math.PI / 2.4, three_quarter: Math.PI / 7 }[s3.facing] || 0;
  scene.add(ch.root);
  if (planned0.some((a) => ["phone_call", "texting"].includes(a.anim))) addPhone(ch);

  // التوقيت: كل حركة مع كلمتها (أو بالتساوي على طول المشهد)
  const planned = planned0.map((a, i) => ({ anim: a.anim, start: i === 0 ? 0 : (a.cue_word && ctx.cue(a.cue_word) > 0.2 ? ctx.cue(a.cue_word) : (ctx.duration * i) / planned0.length) }));
  for (let i = 1; i < planned.length; i++) planned[i].start = Math.max(planned[i].start, planned[i - 1].start + 0.8);
  const clips = {};
  const need = new Set([...planned.map((a) => a.anim), "idle", "sitting_idle", "stand_to_sit", "sit_to_stand"]);
  for (const a of need) clips[a] = retarget(await loadClip(a), ch);
  const seq = performance(planned, (a) => clips[a].duration, ctx.duration);
  const actions = seq.map((x) => { const act = ch.mixer.clipAction(clips[x.anim].clone()); act.play(); act.setEffectiveWeight(0);
    return { ...x, act, dur: clips[x.anim].duration, loop: LOOPS.has(x.anim) }; });

  // الأداء في لحظة t: الحركة الحالية + اللي قبلها بتختفي بنعومة
  const pose = (t) => {
    let k = 0; actions.forEach((a, i) => { if (t >= a.start) k = i; });
    const blend = k === 0 ? 1 : clamp((t - actions[k].start) / XF);
    const sm = blend * blend * (3 - 2 * blend);
    actions.forEach((a, i) => {
      a.act.setEffectiveWeight(i === k ? sm : i === k - 1 ? 1 - sm : 0);
      const lt = Math.max(0, t - a.start);
      a.act.time = a.loop ? lt % a.dur : Math.min(lt, a.dur - 0.01);
    });
    ch.mixer.update(0);
    // قد إيه الشخصية "قاعدة" دلوقتي (0 واقفة قدام الكرسي، 1 قاعدة عليه): بيتحسب من الحركتين اللي بيتدمجوا
    const sitOf = (a) => { if (!a) return 0; const lt = clamp((t - a.start) / a.dur), sm = lt * lt * (3 - 2 * lt);
      return a.anim === "stand_to_sit" ? sm : a.anim === "sit_to_stand" ? 1 - sm : postureOf(a.anim)[1] === "sit" ? 1 : 0; };
    sitness = k === 0 ? sitOf(actions[0]) : lerp(sitOf(actions[k - 1]), sitOf(actions[k]), sm);
    return actions[k];
  };
  let sitness = 0;

  // تثبيت على الأرض: أوطى نقطة في الرجلين (كعب أو صوابع) لازم تبقى على الأرض بالظبط، فمفيش رجل بتغطس ولا بتطير
  const v = new THREE.Vector3();
  const ground = (cur) => {
    ch.root.position.y = 0; ch.root.updateMatrixWorld(true);
    let contact = Infinity;
    for (const f of ch.feet) {
      contact = Math.min(contact, f.ankle.getWorldPosition(v).y - f.ankleH);
      if (f.toe) contact = Math.min(contact, f.toe.getWorldPosition(v).y - f.toeH);
    }
    if (!isFinite(contact)) return;
    ch.root.position.y = JUMPY.has(cur.anim) ? Math.max(0, -contact) : -contact;
    ch.root.updateMatrixWorld(true);
  };

  // الكرسي: بيتحط تحت الوسط بالظبط وهي قاعدة (بنقيس الوضعية نفسها)، فمفيش قعدة في الهوا ولا رجل جوه الكرسي
  const sitIdx = actions.findIndex((a) => postureOf(a.anim)[1] === "sit" || postureOf(a.anim)[0] === "sit");
  const fwd = new THREE.Vector3(Math.sin(ch.root.rotation.y), 0, Math.cos(ch.root.rotation.y));
  const hasChair = sitIdx >= 0;
  if (hasChair) {
    const sitA = actions.find((a) => POSTURE[a.anim] && POSTURE[a.anim][0] === "sit" && POSTURE[a.anim][1] === "sit") || actions[sitIdx];
    const tSit = sitA.anim === "stand_to_sit" ? sitA.start + sitA.dur - 0.05 : sitA.start + 0.3;
    ground(pose(tSit));
    const hp = ch.hips.getWorldPosition(new THREE.Vector3());
    const seatH = Math.max(0.3, hp.y - 0.1);
    const chair = await prop(scene, look, { f: s3.set === "living" ? KF + "armchair.gltf" : KF + "chair_A.gltf", p: [hp.x - fwd.x * 0.08, hp.z - fwd.z * 0.08], r: (ch.root.rotation.y * 180) / Math.PI, h: seatH / 0.5 });
    chair.userData.seat = true;
  }
  // مساحة الشخصية (والمشي) فاضية من الأثاث
  const zone = walking ? { x0: -2.0, x1: 2.0, z0: -0.55, z1: 0.55 } : { x0: -0.65, x1: 0.65, z0: -0.6, z1: 0.6 };
  clearArea(scene, setInfo.placed, zone);

  // البق: بس لو الشخصية بتتكلم في المشهد ده (مش راوي)
  const mouth = s3.speaking ? addMouth(ch) : null;
  const lips = mouth ? lipTrack(ctx.words || []) : null;
  const crowd = ["street", "park"].includes(s3.set) ? await extras(scene, look, seed, 2, s3.set === "street") : null;

  await settled(); // كل الصور اتحمّلت
  const cam = new THREE.PerspectiveCamera(42, W / H, 0.05, 300);
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; canvas.className = "c3d";
  el.prepend(canvas);
  const g2 = canvas.getContext("2d");

  return (t) => {
    const cur = pose(t);
    // المشي: الشخصية بتتحرك في المكان والكاميرا ماشية جنبها
    const p = clamp(t / Math.max(1, ctx.duration));
    const x0 = walking ? lerp(-1.4, 1.4, p) : 0;
    // واقفة: خطوة قدام الكرسي، وبترجع عليه وهي بتقعد
    const back = hasChair ? (1 - sitness) * 0.42 : 0;
    ch.root.position.x = x0 + fwd.x * back; ch.root.position.z = fwd.z * back;
    ground(cur);
    if (mouth) setMouth(mouth, lips(t));
    if (crowd) crowd(t);
    // طول الشخصية "الحالي" من مكان راسها: لو قاعدة أو على الأرض الكاميرا بتنزل معاها
    const hw = ch.head ? ch.head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(x0, ch.height, 0);
    const c = cameraAt(walking && s3.camera === "static_wide" ? "tracking" : s3.camera, p, { height: Math.max(0.7, hw.y + 0.12) }, walking ? x0 : hw.x, hw.z);
    cam.fov = c.fov; cam.updateProjectionMatrix();
    cam.position.copy(c.pos); cam.lookAt(c.look);
    if (c.roll) cam.rotateZ(c.roll);
    r.toneMapping = look === "anime" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    r.render(scene, cam);
    g2.drawImage(r.domElement, 0, 0);
  };
}

// ======================================================================
// مشهد بإخراج حر (Claude هو المخرج): الأداء وضعيات بيحسبها rig.js، والكاميرا لقطات بيحسبها director.js.
// sc.scene3d = { set, character, time, speaking, blocking: {x, z, face},
//   performance: [{at_word|at, body, head, l_arm, r_arm, l_hand, r_hand, motion, move_to:[x,z], face, emote, fx, ease, dur}],
//   shots: [{at_word|at, type, angle, height, move, lens, dutch}] }

const INDOOR_BOUNDS = { x0: -2.75, x1: 2.75, z0: -2.45, z1: 9, y0: 0.15, y1: 2.9 };

async function createDirectedScene(sc, el, ctx) {
  const s3 = sc.scene3d, look = (ctx.look || s3.look) === "anime" ? "anime" : "soft", time = s3.time || "day";
  const seed = [...(sc.id || "s")].reduce((n, c) => n + c.charCodeAt(0), 0);
  const r = engine();
  const scene = new THREE.Scene();
  (window.__scenes3d ??= []).push(scene);
  const setInfo = await buildSet(scene, s3.set, look, time, ctx.palette || {}, seed);
  lights(scene, setInfo, time, look, ctx.palette || {});
  const name = s3.character in CHAR ? s3.character : "Aj";
  const ch = await character(name, CHAR[name][1], look);
  scene.add(ch.root);
  ch.root.position.set(0, 0, 0); ch.root.rotation.y = 0; ch.root.updateMatrixWorld(true);
  const R = setupRig(ch);
  const k = R.k, PACE = ctx.pace || 1;

  // التوقيت: كل وضعية مع كلمتها، أو بالثواني، أو بالتساوي
  const T = (x, i, n) => {
    if (x.at_word) { const c = ctx.cue(x.at_word); if (c > 0 || i === 0) return Math.max(0, c - 0.12); } // الحركة بتبدأ قبل الكلمة بشوية (anticipation)
    if (typeof x.at === "number") return x.at;
    return (ctx.duration * i) / Math.max(1, n);
  };
  const perf = (s3.performance && s3.performance.length ? s3.performance : [{ body: "upright", head: "camera", l_arm: "rest", r_arm: "rest" }])
    .map((x, i, a) => ({ ...x, t: i === 0 ? 0 : T(x, i, a.length) }));
  perf.sort((a, b) => a.t - b.t);
  for (let i = 1; i < perf.length; i++) perf[i].t = Math.max(perf[i].t, perf[i - 1].t + 0.25);
  const poseAt = buildPerformance(perf, k, PACE);

  // التحرّك في المكان (blocking): من مكان لمكان بالمشي، والوش بيلف ناحية الاتجاه
  const B0 = s3.blocking || {};
  const start = new THREE.Vector3(B0.x || 0, 0, B0.z || 0);
  let face0 = (B0.face || 0) * Math.PI / 180;
  const segs = []; let pos = start.clone();
  for (const x of perf) {
    if (x.move_to) {
      const to = new THREE.Vector3(x.move_to[0], 0, x.move_to[1]), dist = to.distanceTo(pos);
      if (dist > 0.05) { const dur = dist / (1.05 * k); segs.push({ t0: x.t, t1: x.t + dur, from: pos.clone(), to, dist }); pos = to; }
    }
  }
  const faces = perf.filter((x) => typeof x.face === "number").map((x) => ({ t: x.t, f: x.face * Math.PI / 180 }));
  const rootAt = (t) => {
    let p = start.clone(), walk = null, travel = 0, f = face0, moving = null;
    for (const s of segs) {
      if (t >= s.t1) { p = s.to.clone(); travel += s.dist; }
      else if (t >= s.t0) { const u = (t - s.t0) / (s.t1 - s.t0); p = s.from.clone().lerp(s.to, u); travel += s.dist * u; moving = s; }
    }
    for (const x of faces) if (t >= x.t) f = x.f;
    if (moving) {
      const dir = Math.atan2(moving.to.x - moving.from.x, moving.to.z - moving.from.z);
      const ramp = Math.min(clamp((t - moving.t0) / 0.3), clamp((moving.t1 - t) / 0.3));
      f = f + (((dir - f + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * clamp((t - moving.t0) / 0.3);
      walk = { phase: travel / (0.31 * k), amt: Math.max(0.25, ramp) };
    } else {
      // بعد الوصول: بيلف بنعومة للاتجاه المطلوب
      const last = [...segs].reverse().find((s) => t >= s.t1);
      if (last && !faces.some((x) => x.t > last.t0 && x.t <= t)) {
        const dir = Math.atan2(last.to.x - last.from.x, last.to.z - last.from.z), u = smooth01((t - last.t1) / 0.45);
        f = dir + (((f - dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * u;
      }
    }
    return { p, f, walk };
  };

  // الكرسي: لو فيه قعدة، بيتحط مكان القعدة بالظبط (والوسط بينزل عليه)
  const sitKey = perf.find((x) => (BODY[x.body] || {}).sit);
  let seat = null;
  if (sitKey) {
    const rs = rootAt(sitKey.t + 0.01), seatH = 0.46 * k;
    const fwd = new THREE.Vector3(Math.sin(rs.f), 0, Math.cos(rs.f));
    // الكرسي خطوة ورا مكان الوقوف: واقف قدامه، وبيرجع يقعد عليه
    const c = rs.p.clone().add(fwd.clone().multiplyScalar(-0.46 * k));
    const chairFile = s3.set === "living" ? KF + "armchair.gltf" : s3.set === "cafe" || s3.set === "kitchen" ? KR + "chair_A.gltf" : KF + "chair_A.gltf";
    await prop(scene, look, { f: chairFile, p: [c.x, c.z], r: rs.f / D2R, h: seatH / 0.5 });
    seat = { h: seatH, back: 0.44 * k };
  }
  // المساحة اللي الشخصية بتتحرك فيها فاضية من الأثاث
  const pts = [start, ...segs.map((s) => s.to)];
  clearArea(scene, setInfo.placed, { x0: Math.min(...pts.map((p) => p.x)) - 0.6, x1: Math.max(...pts.map((p) => p.x)) + 0.6,
                                     z0: Math.min(...pts.map((p) => p.z)) - 0.6, z1: Math.max(...pts.map((p) => p.z)) + 0.6 });

  const mouth = s3.speaking ? addMouth(ch) : null;
  const lips = mouth ? lipTrack(ctx.words || []) : null;
  const wordPulse = (t) => s3.speaking ? (ctx.words || []).reduce((m, w) => Math.max(m, Math.exp(-Math.pow((t - w.start - 0.05) / 0.09, 2))), 0) : 0;
  const crowd = ["street", "park"].includes(s3.set) ? await extras(scene, look, seed, 2, s3.set === "street") : null;
  const shots = (s3.shots && s3.shots.length ? s3.shots : [{ type: "medium", move: "push_in" }])
    .map((x, i, a) => ({ ...x, t: i === 0 ? 0 : T(x, i, a.length) })).sort((a, b) => a.t - b.t);
  const bounds = setInfo.set.indoor ? INDOOR_BOUNDS : null;

  await settled();
  const cam = new THREE.PerspectiveCamera(42, W / H, 0.05, 300);
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; canvas.className = "c3d";
  el.prepend(canvas);
  const g2 = canvas.getContext("2d");

  return (t) => {
    const { P, key } = poseAt(t);
    const rs = rootAt(t);
    const fxNow = perf.filter((x) => x.fx && t >= x.t && t < x.t + 1);
    const shake = fxNow.some((x) => x.fx === "shake") ? Math.max(...fxNow.filter((x) => x.fx === "shake").map((x) => 1 - (t - x.t) / 0.5), 0) : 0;
    // مرتين: الأول بتقدير للكاميرا، وبعدين الكاميرا بتتحسب من مكان الراس والصدر الحقيقي (بعد الميلان والقعدة)، والراس بتبص لها
    const st = { P, t, rootPos: rs.p, face: rs.f, walk: rs.walk, speaking: !!s3.speaking, wordPulse: wordPulse(t), seat };
    const A0 = anchors(rs.p, rs.f, ch.height, P.body.sit, P.body.crouch, P.body.lean);
    applyPose(R, { ...st, camPos: directorCamera(shots, t, ctx.duration, A0, rs.f, bounds, 0).pos });
    const A = realAnchors(R, rs.f, A0);
    const c = directorCamera(shots, t, ctx.duration, A, rs.f, bounds, shake);
    applyPose(R, { ...st, camPos: c.pos });
    if (mouth) setMouth(mouth, lips(t));
    if (crowd) crowd(t);
    cam.fov = c.fov; cam.updateProjectionMatrix();
    cam.position.copy(c.pos); cam.up.set(0, 1, 0); cam.lookAt(c.look);
    if (c.roll) cam.rotateZ(c.roll);
    r.toneMapping = look === "anime" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    r.render(scene, cam);
    g2.drawImage(r.domElement, 0, 0);
    // لمسات الأنيمي: رمز المشاعر فوق الراس + خطوط السرعة/التركيز/الفلاش
    for (const x of perf) {
      if (x.emote && t >= x.t && t < x.t + 1.6 && ch.head) {
        const hp = ch.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.28 * k, 0)).project(cam);
        if (hp.z < 1) drawEmote(g2, x.emote, (hp.x + 1) / 2 * W + 90, (1 - hp.y) / 2 * H - 40, t - x.t, clamp(1.4 / Math.max(0.3, cam.position.distanceTo(A.head)), 0.6, 1.6));
      }
      if (x.fx && x.fx !== "shake") drawFx(g2, x.fx, t - x.t, W, H, seed);
    }
    void key;
  };
}
const D2R = Math.PI / 180;
const smooth01 = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };

// أماكن الجسم الحقيقية من العضم (بعد الوضعية)
function realAnchors(R, face, est) {
  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const k = R.k, f = new THREE.Vector3(Math.sin(face), 0, Math.cos(face));
  const head = R.head ? wp(R.head).add(new THREE.Vector3(0, 0.07 * k, 0)) : est.head;
  return { hips: wp(R.hips), chest: wp(R.spine[R.spine.length - 1]), neck: R.neck ? wp(R.neck) : est.neck, head,
           face: head.clone().add(f.clone().multiplyScalar(0.06 * k)).add(new THREE.Vector3(0, -0.01 * k, 0)), forward: f };
}
