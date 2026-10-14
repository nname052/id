// أدوات شخصيات Mixamo المشتركة: تحميل شخصية، وتحويل أي حركة من مكتبة anims/ عليها.
// - أسماء العضم بتختلف بين الشخصيات (mixamorigHips / mixamorig2Hips / mixamorig6Hips…): بنغيّر بادئة الحركة لبادئة الشخصية.
// - الطول بيختلف (وسط Doozy على 58 سم وMegan على 100 سم): بنضرب حركة الوسط في نسبة الطولين علشان الرجلين تفضل على الأرض.
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

const loader = new FBXLoader();
const ROOT = "../assets/3d/mixamo/";
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
  const tex = await new RGBELoader().loadAsync(`../assets/3d/hdri/${name}.hdr`);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = tex;
  return tex;
}
