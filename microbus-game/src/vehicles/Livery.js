import * as THREE from 'three';
import { canvas, tex } from '../render/textures.js';

// شكل ميكروباص "شبين الكوم - داخلي": شريطة لون على الجنبين تحت الشبابيك + كتابة الخط، وشريطة رفيعة فوقها.
// بتترسم في الـ shader بتاع دهان العربية (مش ملزوقة)، فبتمشي مع الباب الجرار وبتاخد نفس الإضاءة واللمعة.
// الألوان قابلة للتغيير من الإعدادات لحد ما نظبطها على صورة حقيقية.

export const LIVERIES = {
  blue: { stripe: 0x1f4fa3, thin: 0x1f4fa3, text: 0xffffff },
  green: { stripe: 0x1d7a3e, thin: 0x1d7a3e, text: 0xffffff },
  red: { stripe: 0x8c1d22, thin: 0x8c1d22, text: 0xffffff },
  yellow: { stripe: 0xe0a91c, thin: 0x2a2a2a, text: 0x1a1a1a },
  plain: null,
};

let _tex = null;
function textTexture() {
  if (_tex) return _tex;
  // النسبة 16:1 زي الشريطة نفسها (≈4م × 0.24م) عشان الكلام مايتمطش
  const c = canvas(2048, 128), x = c.getContext('2d');
  x.clearRect(0, 0, 2048, 128);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.font = 'bold 76px Cairo, sans-serif';
  x.fillText('شبين الكوم  •  داخلي', 1024, 68);
  _tex = tex(c, { repeat: false });
  _tex.anisotropy = 4;
  return _tex;
}

/**
 * rig: ريج الميكروباص بتاع اللاعب (فيه shell و dims).
 * بيرجّع دالة set(name) لتغيير اللون.
 */
export function applyLivery(rig, name = 'blue') {
  const D = rig.dims, shell = rig.shell;
  if (!D || !shell) return () => {};
  shell.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(shell.matrixWorld).invert();
  const U = {
    uLivOn: { value: 1 },
    uLivStripe: { value: new THREE.Color() }, uLivThin: { value: new THREE.Color() }, uLivText: { value: new THREE.Color() },
    uLivTex: { value: textTexture() },
    uLivHW: { value: D.HW },
    // من باب السواق لحد قبل الإكصدام اللي ورا (z لقدام سالب)
    uLivZ: { value: new THREE.Vector2(-D.frontF + 0.62, -D.rearF - 0.22) },
    // الشريطة العريضة وتحتها الكتابة، والرفيعة فوقها تحت الشبابيك
    uLivY: { value: new THREE.Vector4(0.8, 1.04, 1.1, 1.135) },
  };
  const set = (n) => {
    const L = LIVERIES[n];
    U.uLivOn.value = L ? 1 : 0;
    if (!L) return;
    U.uLivStripe.value.set(L.stripe); U.uLivThin.value.set(L.thin); U.uLivText.value.set(L.text);
  };
  set(name);
  shell.traverse((o) => {
    if (!o.isMesh || o.userData.role !== 'paint') return;
    const M = { value: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) };
    // كل قطعة صاج لازم يبقى ليها خامة لوحدها (لو قطعتين شايلين نفس الخامة، المصفوفة بتاعة واحدة بتبوظ التانية)
    const mat = (o.material = o.material.clone());
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { uLivM: M });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uLivM;\nvarying vec3 vLiv;\nvarying float vLivSide;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLiv = (uLivM * vec4(position, 1.0)).xyz;\nvLivSide = abs(normalize(mat3(uLivM) * objectNormal).x);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uLivOn, uLivHW; uniform vec3 uLivStripe, uLivThin, uLivText; uniform sampler2D uLivTex; uniform vec2 uLivZ; uniform vec4 uLivY;
varying vec3 vLiv; varying float vLivSide;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
if (uLivOn > 0.5) {
  // الجنبين بس (مش القدام ولا الورا ولا السقف): بالمكان + اتجاه السطح
  float side = smoothstep(uLivHW - 0.14, uLivHW - 0.07, abs(vLiv.x)) * smoothstep(0.55, 0.8, vLivSide);
  float zin = smoothstep(uLivZ.x, uLivZ.x + 0.04, vLiv.z) * (1.0 - smoothstep(uLivZ.y - 0.04, uLivZ.y, vLiv.z));
  float aa = 0.004;
  float band = smoothstep(uLivY.x - aa, uLivY.x, vLiv.y) * (1.0 - smoothstep(uLivY.y, uLivY.y + aa, vLiv.y));
  float thin = smoothstep(uLivY.z - aa, uLivY.z, vLiv.y) * (1.0 - smoothstep(uLivY.w, uLivY.w + aa, vLiv.y));
  float m = side * zin;
  // الكتابة بتتقري صح من الناحيتين
  float u = (vLiv.z - uLivZ.x) / (uLivZ.y - uLivZ.x);
  if (vLiv.x > 0.0) u = 1.0 - u;
  float v = (vLiv.y - uLivY.x) / (uLivY.y - uLivY.x);
  float t = texture2D(uLivTex, vec2(u, v)).a * band;
  vec3 liv = mix(uLivStripe, uLivText, t);
  diffuseColor.rgb = mix(diffuseColor.rgb, liv, m * band);
  diffuseColor.rgb = mix(diffuseColor.rgb, uLivThin, m * thin);
}`);
    };
    mat.customProgramCacheKey = () => 'livery2';
    mat.needsUpdate = true;
  });
  return set;
}
