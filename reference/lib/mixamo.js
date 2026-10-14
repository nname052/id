// أدوات شخصيات Mixamo المشتركة: تحميل شخصية، وتحويل أي حركة من مكتبة anims/ عليها.
// - أسماء العضم بتختلف بين الشخصيات (mixamorigHips / mixamorig2Hips / mixamorig6Hips…): بنغيّر بادئة الحركة لبادئة الشخصية.
// - الطول بيختلف (وسط Doozy على 58 سم وMegan على 100 سم): بنضرب حركة الوسط في نسبة الطولين علشان الرجلين تفضل على الأرض.
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const loader = new FBXLoader();
const ASSETS = new URL("../../assets/", import.meta.url).href; // مسارات ثابتة مهما كان مكان الصفحة
const ROOT = ASSETS + "3d/mixamo/";
// الحركات في anims/ متصدّرة على Aj: بادئته "mixamorig" ووسطه على 83.2 سم
const SOURCE = { prefix: "mixamorig", hipsY: 83.2 };

/** بيحمّل شخصية (FBX بالسنتيمتر) ويرجّع { root, prefix, hipsY, mixer } */
export async function loadCharacter(name, { heightM = null, normalMaps = true } = {}) {
  const root = await loader.loadAsync(`${ROOT}${name}.fbx`);
  root.updateMatrixWorld(true);
  let hips;
  root.traverse((o) => {
    if (o.isBone && /Hips$/.test(o.name) && !hips) hips = o;
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      // خامات Mixamo بتيجي Phong لامعة: نحوّلها Standard بنفس الصور علشان تتماشى مع الإضاءة
      const conv = (m) => new THREE.MeshStandardMaterial({
        map: m.map, normalMap: normalMaps ? m.normalMap : null, color: m.color, roughness: 0.75, metalness: 0,
        transparent: m.transparent || m.opacity < 1, opacity: m.opacity, alphaTest: m.transparent ? 0.35 : 0, side: m.side,
      });
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    }
  });
  const prefix = hips.name.replace(/Hips$/, "");
  const hipsY = hips.getWorldPosition(new THREE.Vector3()).y;
  root.scale.setScalar(0.01);
  if (heightM) {
    // الطول من العضم (من أعلى الراس للرجل) مش من شكل الجسم: في شخصيات الجسم والعضم وحداتهم مختلفة
    root.updateMatrixWorld(true);
    let top = -Infinity, bottom = Infinity;
    const v = new THREE.Vector3();
    root.traverse((o) => { if (o.isBone) { o.getWorldPosition(v); top = Math.max(top, v.y); bottom = Math.min(bottom, v.y); } });
    root.scale.multiplyScalar(heightM / ((top - bottom) * 1.04)); // +4% للشعر فوق آخر عضمة في الراس
  }
  return { root, prefix, hipsY, mixer: new THREE.AnimationMixer(root), name };
}

const clipCache = {};
/** بيحمّل حركة من anims/ (أو ملف كامل زي "Aj_Talking") */
export async function loadClip(name) {
  if (!clipCache[name]) {
    const path = name.startsWith("Aj_") ? `${ROOT}${name}.fbx` : `${ROOT}anims/${name}.fbx`;
    clipCache[name] = (await loader.loadAsync(path)).animations[0];
  }
  return clipCache[name];
}

/** بيحوّل حركة على شخصية معيّنة: بادئة العضم + طول الوسط */
export function retarget(clip, ch) {
  const out = clip.clone();
  const ratio = ch.hipsY / SOURCE.hipsY;
  out.tracks = out.tracks
    .map((tr) => {
      const t = tr.clone();
      t.name = t.name.replace(new RegExp("^" + SOURCE.prefix + "(?=[A-Z])"), ch.prefix);
      if (/Hips\.position$/.test(t.name)) t.values = t.values.map((v) => v * ratio);
      return t;
    });
  return out;
}

/** بيشغّل حركة على شخصية ويرجّع الـ action (الوقت بيتحط بإيدنا في renderAt) */
export async function play(ch, clipName) {
  const action = ch.mixer.clipAction(retarget(await loadClip(clipName), ch));
  action.play();
  return action;
}

/** إضاءة HDRI واقعية (Poly Haven) */
export async function hdriEnvironment(renderer, scene, name = "brown_photostudio_02") {
  const { RGBELoader } = await import("three/addons/loaders/RGBELoader.js");
  const tex = await new RGBELoader().loadAsync(`${ASSETS}3d/hdri/${name}.hdr`);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = tex;
  return tex;
}

// ---------- حركة لجزء من الجسم ----------
const UPPER = /(Spine|Neck|Head|Shoulder|Arm|Hand|Thumb|Index|Middle|Ring|Pinky)/;
/** نسخة من الحركة فيها النص الفوقاني بس (أو التحتاني بس لو upper=false). مفيد لـ "قاعد + ماسك الموبايل" */
export function bodyPart(clip, upper = true) {
  const out = clip.clone();
  out.tracks = out.tracks.filter((t) => UPPER.test(t.name.split(".")[0]) === upper && !/Hips/.test(t.name));
  return out;
}

/** بيشغّل حركة (أو جزء منها) ويرجّعها. part: "full" | "upper" | "lower" */
export async function action(ch, clipName, part = "full") {
  let clip = retarget(await loadClip(clipName), ch);
  if (part !== "full") clip = bodyPart(clip, part === "upper");
  clip.name = `${clipName}:${part}`;
  const a = ch.mixer.clipAction(clip);
  a.play();
  a.setEffectiveWeight(0);
  return a;
}

const findBone = (ch, suffix) => { let b; ch.root.traverse((o) => { if (o.isBone && o.name === ch.prefix + suffix) b = o; }); return b; };

// ---------- البق ----------
/** بق كرتون مكان شفايف الشخصية (المِش اللي اسمه فيه Mouth أو h_Geo)، متعلّق في عضمة الراس.
 *  لازم يتنادى والشخصية لسه في وضعيتها الأصلية (قبل أي حركة)، ووشها ناحية +Z. */
export function addMouth(ch) {
  let lips;
  ch.root.traverse((o) => { if (o.isMesh && /Mouth|^h_Geo$/i.test(o.name) && !lips) lips = o; });
  const head = findBone(ch, "Head");
  if (!lips || !head) return null;
  ch.root.updateMatrixWorld(true);
  lips.computeBoundingBox(); // SkinnedMesh: بيحسب بالعضم، فالمكان مطابق للي بيترسم
  const bb = lips.boundingBox.clone().applyMatrix4(lips.matrixWorld);
  const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3());
  const world = new THREE.Matrix4().makeTranslation(c.x, c.y - size.y * 0.03, bb.max.z - size.z * 0.05);
  const g = new THREE.Group();
  const part = (color, z, geo = new THREE.CircleGeometry(1, 40)) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    m.position.z = z; g.add(m); return m;
  };
  const parts = { lip: part("#8a4f40", 0), inner: part("#2e0f10", 0.0012), tongue: part("#c4596a", 0.0022),
                  teeth: part("#f4efe6", 0.0024, new THREE.PlaneGeometry(1, 1)) };
  head.add(g);
  const local = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(world);
  local.decompose(g.position, g.quaternion, g.scale);
  g.visible = false;
  // الجروب واخد scale عكس الراس من decompose، فالمقاسات جواه بالمتر الحقيقي على طول
  ch.mouth = { group: g, parts, lips, W: size.x * 0.145, H: size.x * 0.095, unit: 1 };
  return ch.mouth;
}

/** o من 0 (مقفول) لـ 1 (مفتوح على الآخر) */
export function setMouth(ch, o) {
  const m = ch.mouth;
  if (!m) return;
  const speaking = o > 0.04;
  m.lips.visible = !speaking;
  m.group.visible = speaking;
  if (!speaking) return;
  const W = m.W, H = m.H * o + 0.002 * m.unit, e = 0.004 * m.unit;
  m.parts.lip.scale.set(W + e, H + e, 1);
  m.parts.inner.scale.set(W - e / 2, H, 1);
  const th = Math.min(0.007 * m.unit, H * 0.6);
  m.parts.teeth.scale.set(W * 1.1, th, 1);
  m.parts.teeth.position.y = H - th / 2 - 0.001 * m.unit;
  m.parts.tongue.scale.set(W * 0.55, H * 0.45, 1);
  m.parts.tongue.position.y = -H * 0.55;
}

/** فتحة البق من توقيت حروف ElevenLabs: الحروف المتحركة أوسع، و م ب ف مقفولة، والسكتات مقفولة */
export function lipTrack(alignment) {
  const op = (ch) => {
    if (" .,!?؟…\n".includes(ch)) return 0;
    if ("مبف".includes(ch)) return 0.06;
    if ("اأإآىَ".includes(ch)) return 1.0;
    if ("وُ".includes(ch)) return 0.7;
    if ("يِ".includes(ch)) return 0.6;
    return 0.42;
  };
  const chars = []; let tag = false;
  alignment.characters.forEach((c, i) => {
    if (c === "[") tag = true;
    chars.push({ s: alignment.character_start_times_seconds[i], e: alignment.character_end_times_seconds[i], w: tag ? 0 : op(c) });
    if (c === "]") tag = false;
  });
  const raw = (x) => { let v = 0; for (const c of chars) { if (x < c.s - 0.05 || x > c.e + 0.05) continue;
    v = Math.max(v, c.w * Math.min(1, Math.max(0, (x - c.s + 0.03) / 0.05)) * Math.min(1, Math.max(0, (c.e - x + 0.03) / 0.05))); } return v; };
  return (x) => (raw(x - 0.03) + raw(x) + raw(x + 0.03)) / 3;
}

/** كلمات الجملة بتوقيتها (من غير الـ tags) للترجمة */
export function wordTimes(alignment) {
  const words = []; let cur = null, tag = false;
  alignment.characters.forEach((c, i) => {
    const s = alignment.character_start_times_seconds[i], e = alignment.character_end_times_seconds[i];
    if (c === "[") tag = true;
    if (!tag && c.trim()) { if (!cur) cur = { text: "", start: s, end: e }; cur.text += c; cur.end = e; }
    else if (cur) { words.push(cur); cur = null; }
    if (c === "]") tag = false;
  });
  if (cur) words.push(cur);
  return words;
}

// ---------- موبايل في الإيد ----------
export function addPhone(ch, hand = "RightHand") {
  const bone = findBone(ch, hand);
  const s = bone.getWorldScale(new THREE.Vector3()).x;
  const phone = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.012), new THREE.MeshStandardMaterial({ color: "#1d1d22", roughness: 0.35 }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.135), new THREE.MeshStandardMaterial({ color: "#5aa0ff", emissive: "#2a5ab0", emissiveIntensity: 0.6 }));
  screen.position.z = 0.0065;
  phone.add(body, screen);
  phone.scale.setScalar(1 / s);
  // عضمة الإيد عند الرسغ ومحورها Y ناحية الصوابع: نزحلق الموبايل لنص الكف ونلفّه يبقى في اتجاه الصوابع
  phone.position.set(0.0, 0.085 / s, 0.025 / s);
  phone.rotation.set(0, Math.PI / 2, 0);
  phone.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  bone.add(phone);
  ch.phone = phone;
  return phone;
}
