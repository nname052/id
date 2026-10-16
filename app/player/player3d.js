// مشاهد 3D جوه الفيديو: شخصية Mixamo بتمثّل (حركات من المكتبة) في مكان مبني من كيتات Kenney و KayKit،
// بكاميرا سينمائية وإضاءة حسب الوقت، وشكل ناعم أو أنيمي (تظليل مسطح + خطوط).
// كل حاجة حتمية: وقت كل حركة بيتحط بإيدنا (action.time) وبعدين mixer.update(0).
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

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
const fbx = new FBXLoader(), gltf = new GLTFLoader();
const cache = {};
const once = (key, fn) => (cache[key] ??= fn());

const CHAR = { // نفس الكتالوج اللي في three_d.py
  Aj: ["Aj_Idle", 1.75], Ty: ["characters/Ty", 1.7], Big_Vegas: ["characters/Big_Vegas", 1.75], Timmy: ["characters/Timmy", 1.25],
  Doozy: ["characters/Doozy", 1.3], Claire: ["characters/Claire", 1.68], Amy: ["characters/Amy", 1.62], Kaya: ["characters/Kaya", 1.65],
  Megan: ["characters/Megan", 1.68], Kate: ["characters/Kate", 1.68], Jody: ["characters/Jody", 1.66], Sporty_Granny: ["characters/Sporty_Granny", 1.6],
};
const CLIP_FILE = { idle: "Aj_Idle", talking: "Aj_Talking", thinking: "Aj_Thinking", walking: "Aj_Walking" };
const SITTING = new Set(["sitting_idle", "sitting_talking", "sitting_laughing", "stand_to_sit", "sit_to_stand", "typing"]);
const ONE_SHOT = new Set(["stand_to_sit", "sit_to_stand", "sitting_floor"]);
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
  let head; root.traverse((o) => { if (o.isBone && o.name === base.prefix + "Head") head = o; });
  return { root, prefix: base.prefix, hipsY: base.hipsY, hips, head, mixer: new THREE.AnimationMixer(root), height: heightM };
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
  street: { indoor: false, ground: "#8d8f93", props: [
    { f: CC + "building-a.glb", p: [-8, -12], h: 13 }, { f: CC + "building-c.glb", p: [-2.5, -12.5], h: 16 }, { f: CC + "building-e.glb", p: [3.5, -12], h: 12 },
    { f: CC + "building-g.glb", p: [9, -12.5], h: 15 }, { f: CC + "building-skyscraper-b.glb", p: [0, -26], h: 40 }, { f: CC + "building-d.glb", p: [-14, -11], h: 11 },
    { f: KC + "streetlight.gltf", p: [2.4, -2.3], h: 4.2 }, { f: KC + "car_taxi.gltf", p: [-3.2, -5.2], r: 90, h: 1.5 },
    { f: KC + "car_sedan.gltf", p: [4.5, -6.6], r: -90, h: 1.45 }, { f: KC + "bench.gltf", p: [-1.6, -2.1], h: 0.7 },
    { f: KC + "bush.gltf", p: [-3.1, -2.4], h: 0.9 }, { f: KC + "trash_A.gltf", p: [1.4, -2.4], h: 0.9 }, { f: KC + "firehydrant.gltf", p: [3.4, -1.4], h: 0.7 } ] },
  park: { indoor: false, ground: "#7fae5a", props: [
    { f: NK + "tree_oak.glb", p: [-3.5, -5], h: 5.5 }, { f: NK + "tree_default.glb", p: [3.8, -6.5], h: 6 }, { f: NK + "tree_detailed.glb", p: [-8, -10], h: 7 },
    { f: NK + "tree_fat.glb", p: [8, -11], h: 6.5 }, { f: NK + "tree_oak.glb", p: [0.5, -14], h: 8 }, { f: NK + "tree_default.glb", p: [-13, -16], h: 7 },
    { f: KC + "bench.gltf", p: [1.9, -1.8], r: -20, h: 0.7 }, { f: NK + "rock_largeA.glb", p: [-2.6, -2.2], h: 0.7 },
    { f: NK + "flower_redA.glb", p: [-1.6, 0.9], h: 0.35 }, { f: NK + "flower_yellowB.glb", p: [2.4, 0.4], h: 0.35 }, { f: NK + "flower_purpleA.glb", p: [-2.4, -0.4], h: 0.35 },
    { f: NK + "plant_bushLarge.glb", p: [3.2, -2.8], h: 1.1 }, { f: NK + "grass_large.glb", p: [-0.8, -1.6], h: 0.3 }, { f: NK + "path_stone.glb", p: [0, -0.4], w: 1.4 } ] },
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

async function buildSet(scene, spec, look, time, pal, sitting) {
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
  } else if (set.studio) {
    // استوديو: خلفية منحنية بلون الفيديو (cyclorama)
    const c = pal.surface || "#2a2235";
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(c, 0.9)); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const curve = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 30, 48, 1, true, Math.PI * 0.5, Math.PI), mat(c, 0.95));
    curve.material.side = THREE.BackSide; curve.position.set(0, 0, 0); curve.rotation.y = Math.PI; scene.add(curve);
    scene.background = new THREE.Color(c);
    scene.fog = new THREE.Fog(c, 7, 22);
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
      const tex = await hdri(time === "sunset" ? "venice_sunset" : "kloofendal_48d_partly_cloudy_puresky");
      scene.background = tex; scene.backgroundIntensity = 0.9;
    }
    scene.fog = new THREE.Fog(time === "night" ? "#0d1638" : time === "sunset" ? "#e8a27a" : "#cfe3f3", 18, 70);
  }
  const props = [...set.props];
  if (sitting && !["living"].includes(spec)) props.push({ f: KF + "chair_A.gltf", p: [0, -0.32], r: 0, h: 0.95, seat: true });
  await Promise.all(props.map(async (pr) => {
    if (sitting && spec === "office" && pr.f.endsWith("chairDesk.glb")) return;
    const o = await prop(scene, look, pr);
    if (pr.light) { const b = new THREE.Box3().setFromObject(o); lampPos = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y - 0.2, (b.min.z + b.max.z) / 2); }
  }));
  return { set, lampPos };
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
function cameraAt(kind, p, ch, x0) {
  const h = ch.height, cx = x0;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const e = ease(p);
  switch (kind) {
    case "push_in": return { pos: P(cx + 0.25, h * 0.85, lerp(4.4, 2.5, e)), look: P(cx, h * 0.62, 0), fov: 42 };
    case "pull_out": return { pos: P(cx, lerp(h * 0.85, h * 1.4, e), lerp(2.0, 5.8, e)), look: P(cx, h * 0.55, 0), fov: 42 };
    case "orbit": { const a = lerp(-0.6, 0.6, e); return { pos: P(cx + Math.sin(a) * 3.4, h * 0.8, Math.cos(a) * 3.4), look: P(cx, h * 0.58, 0), fov: 42 }; }
    case "low_angle": return { pos: P(cx + 0.4, 0.35, lerp(3.2, 2.6, e)), look: P(cx, h * 0.75, 0), fov: 48 };
    case "high_angle": return { pos: P(cx + 0.3, lerp(4.4, 3.8, e), 2.6), look: P(cx, h * 0.35, 0), fov: 46 };
    case "close_up": return { pos: P(cx + lerp(0.15, -0.1, e), h * 0.9, lerp(1.45, 1.15, e)), look: P(cx, h * 0.84, 0), fov: 38 };
    case "tracking": return { pos: P(cx + 0.3, h * 0.75, 3.4), look: P(cx, h * 0.6, 0), fov: 42 };
    case "dutch": return { pos: P(cx - 0.4, h * 0.8, lerp(3.4, 2.7, e)), look: P(cx, h * 0.62, 0), fov: 44, roll: -0.2 };
    default: return { pos: P(cx + lerp(-0.2, 0.2, e), h * 1.0, 6.2), look: P(cx, h * 0.55, 0), fov: 40 }; // static_wide
  }
}

// ---------- المشهد ----------
// sc.scene3d = { set, character, actions: [{anim, cue_word}], camera, look, time, facing }
export async function createScene3D(sc, el, ctx) {
  const s3 = sc.scene3d, look = (ctx.look || s3.look) === "anime" ? "anime" : "soft", time = s3.time || "day";
  const r = engine();
  const scene = new THREE.Scene();
  const anims = (s3.actions && s3.actions.length ? s3.actions : [{ anim: "idle" }]).slice(0, 3);
  const sitting = anims.some((a) => SITTING.has(a.anim));
  const setInfo = await buildSet(scene, s3.set, look, time, ctx.palette, sitting);
  lights(scene, setInfo, time, look, ctx.palette || {});
  const [, hgt] = CHAR[s3.character] || CHAR.Aj;
  const ch = await character(s3.character in CHAR ? s3.character : "Aj", hgt, look);
  const walking = anims.some((a) => WALKS.has(a.anim));
  ch.root.rotation.y = walking ? Math.PI / 2 : { side: Math.PI / 2.4, three_quarter: Math.PI / 7 }[s3.facing] || 0;
  if (sitting) ch.root.position.z = -0.12;
  scene.add(ch.root);
  if (anims.some((a) => ["phone_call", "texting"].includes(a.anim))) addPhone(ch);
  const actions = [];
  for (const a of anims) {
    const clip = retarget(await loadClip(a.anim), ch);
    const act = ch.mixer.clipAction(clip); act.play(); act.setEffectiveWeight(0);
    actions.push({ act, dur: clip.duration, anim: a.anim, start: 0, word: a.cue_word });
  }
  // كل حركة بتبدأ مع كلمتها (أو بالتساوي على طول المشهد)
  actions.forEach((a, i) => { a.start = i === 0 ? 0 : (a.word && ctx.cue(a.word) > 0.2 ? ctx.cue(a.word) : (ctx.duration * i) / actions.length); });
  for (let i = 1; i < actions.length; i++) actions[i].start = Math.max(actions[i].start, actions[i - 1].start + 0.8);

  const cam = new THREE.PerspectiveCamera(42, W / H, 0.05, 300);
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; canvas.className = "c3d";
  el.prepend(canvas);
  const g2 = canvas.getContext("2d");
  const XF = 0.35; // مدة الانتقال بين حركتين

  return (t) => {
    // الحركات
    let k = 0; actions.forEach((a, i) => { if (t >= a.start) k = i; });
    const blend = k === 0 ? 1 : clamp((t - actions[k].start) / XF);
    actions.forEach((a, i) => {
      const w = i === k ? blend : i === k - 1 ? 1 - blend : 0;
      a.act.setEffectiveWeight(w);
      const lt = Math.max(0, t - a.start);
      a.act.time = ONE_SHOT.has(a.anim) ? Math.min(lt, a.dur - 0.01) : lt % a.dur;
    });
    ch.mixer.update(0);
    // المشي: الشخصية بتتحرك في المكان والكاميرا ماشية جنبها
    const p = clamp(t / Math.max(1, ctx.duration));
    const x0 = walking ? lerp(-1.4, 1.4, p) : 0;
    ch.root.position.x = x0;
    // طول الشخصية "الحالي" من مكان راسها: لو قاعدة أو على الأرض الكاميرا بتنزل معاها
    ch.root.updateMatrixWorld(true);
    const headY = ch.head ? ch.head.getWorldPosition(new THREE.Vector3()).y + 0.12 : ch.height;
    const c = cameraAt(walking && s3.camera === "static_wide" ? "tracking" : s3.camera, p, { height: Math.max(0.7, headY) }, walking ? x0 : 0);
    cam.fov = c.fov; cam.updateProjectionMatrix();
    cam.position.copy(c.pos); cam.lookAt(c.look);
    if (c.roll) cam.rotateZ(c.roll);
    r.toneMapping = look === "anime" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    r.render(scene, cam);
    g2.drawImage(r.domElement, 0, 0);
  };
}
