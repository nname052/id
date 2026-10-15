import * as THREE from 'three';
import { canvas, tex } from '../render/textures.js';

// شكل الميكروباص:
// - "shibin" (الافتراضي، من صورة ميكروباص شبين الحقيقي): الجسم تركواز، وزوايا تحت قدام وورا صفرا بحرف مايل،
//   ولافتة "شبين الكوم" بيضا صغيرة ورا الزجاج الأمامي في ركن الراكب.
// - الباقي: جسم أبيض بشريطة لون + كتابة "شبين الكوم • داخلي".
// كله بيترسم في الـ shader بتاع دهان العربية (مش ملزوق)، فبيمشي مع الباب الجرار وبياخد نفس الإضاءة واللمعة.

export const LIVERIES = {
  shibin: { mode: 2, body: 0x0d9d92, corner: 0xf5c800, sign: true },
  blue: { mode: 1, body: 0xf3f1ec, stripe: 0x1f4fa3, thin: 0x1f4fa3, text: 0xffffff },
  green: { mode: 1, body: 0xf3f1ec, stripe: 0x1d7a3e, thin: 0x1d7a3e, text: 0xffffff },
  red: { mode: 1, body: 0xf3f1ec, stripe: 0x8c1d22, thin: 0x8c1d22, text: 0xffffff },
  plain: { mode: 0, body: 0xf3f1ec },
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

function signTexture() {
  const c = canvas(512, 112), x = c.getContext('2d');
  x.fillStyle = '#f7f7f2'; x.beginPath(); x.roundRect(4, 4, 504, 104, 18); x.fill();
  x.fillStyle = '#0f7f77'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.font = 'bold 74px Cairo, sans-serif';
  x.fillText('شبين الكوم', 256, 60);
  const t = tex(c, { repeat: false }); t.anisotropy = 4;
  return t;
}

/**
 * rig: ريج الميكروباص بتاع اللاعب (فيه shell و dims).
 * بيرجّع دالة set(name) لتغيير الشكل.
 */
export function applyLivery(rig, name = 'shibin') {
  const D = rig.dims, shell = rig.shell;
  if (!D || !shell) return () => {};
  shell.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(shell.matrixWorld).invert();
  const U = {
    uLivMode: { value: 0 },
    uLivStripe: { value: new THREE.Color() }, uLivThin: { value: new THREE.Color() }, uLivText: { value: new THREE.Color() },
    uLivCorner: { value: new THREE.Color() },
    uLivTex: { value: textTexture() },
    uLivHW: { value: D.HW },
    // من باب السواق لحد قبل الإكصدام اللي ورا (z لقدام سالب)
    uLivZ: { value: new THREE.Vector2(-D.frontF + 0.62, -D.rearF - 0.22) },
    // الشريطة العريضة وتحتها الكتابة، والرفيعة فوقها تحت الشبابيك
    uLivY: { value: new THREE.Vector4(0.8, 1.04, 1.1, 1.135) },
    // أول وآخر العربية (للزوايا الصفرا)
    uLivEnds: { value: new THREE.Vector2(-D.frontF, -D.rearF) },
  };
  const paints = [];
  // لافتة "شبين الكوم" ورا الزجاج الأمامي (من جوه، باينة من برا)
  let sign = null;
  if (D.wsBase && D.wsTop) {
    // تحت في ركن الراكب (زي الميكروباصات الحقيقية) — صغيرة ومش بتقفل رؤية السواق من جوه
    const [bf, by] = D.wsBase, [tf, ty] = D.wsTop, t = 0.15;
    const z = -(bf + (tf - bf) * t) + 0.05, y = by + (ty - by) * t;
    const w = Math.min(0.62, D.wsHalf * 0.8);
    // FrontSide: بتبان من برا بس (من جوه ماكانتش بتتقري — كلام مقلوب بيزحم الرؤية)
    sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 112 / 512), new THREE.MeshBasicMaterial({ map: signTexture(), side: THREE.FrontSide, toneMapped: false }));
    sign.position.set(D.wsHalf - w / 2 - 0.05, y, z);
    // بنلفها تبص لقدام (−z) وبعدين نميلها لورا زي الزجاج بالظبط
    sign.rotation.set(Math.atan2(bf - tf, ty - by), Math.PI, 0);
    sign.renderOrder = 3;
    shell.add(sign);
  }
  const set = (n) => {
    const L = LIVERIES[n] || LIVERIES.shibin;
    U.uLivMode.value = L.mode;
    if (L.stripe) { U.uLivStripe.value.set(L.stripe); U.uLivThin.value.set(L.thin); U.uLivText.value.set(L.text); }
    if (L.corner) U.uLivCorner.value.set(L.corner);
    for (const m of paints) m.color.set(L.body);
    trimOut.value.set(L.body);
    // من جوه بنفس لون العربية من برا (العواميد وإطار الشبابيك وتجليد الأبواب) — زي الصاج الحقيقي
    trimIn.value.set(L.body).multiplyScalar(0.92);
    if (rig.mats?.pillarTrim) rig.mats.pillarTrim.color.set(L.body);
    if (rig.mats?.doorCard) rig.mats.doorCard.color.set(L.body);
    if (sign) sign.visible = !!L.sign;
  };
  // إطار الزجاج والعواميد: كانت سودا خالص (بتبان "سواد من قدام"). من برا بلون العربية، ومن جوه رمادي بلاستيك
  const trimOut = { value: new THREE.Color() }, trimIn = { value: new THREE.Color(0x77756f) };
  shell.traverse((o) => {
    if (!o.isMesh || o.userData.role !== 'trim') return;
    const mat = (o.material = o.material.clone());
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uTrimOut: trimOut, uTrimIn: trimIn });
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uTrimOut, uTrimIn;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = gl_FrontFacing ? uTrimOut * 0.92 : uTrimIn;');
    };
    mat.customProgramCacheKey = () => 'trim1';
    mat.roughness = 0.45;
    mat.needsUpdate = true;
  });
  shell.traverse((o) => {
    if (!o.isMesh || o.userData.role !== 'paint') return;
    const M = { value: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) };
    // كل قطعة صاج لازم يبقى ليها خامة لوحدها (لو قطعتين شايلين نفس الخامة، المصفوفة بتاعة واحدة بتبوظ التانية)
    const mat = (o.material = o.material.clone());
    paints.push(mat);
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { uLivM: M });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uLivM;\nvarying vec3 vLiv;\nvarying float vLivSide;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLiv = (uLivM * vec4(position, 1.0)).xyz;\nvLivSide = abs(normalize(mat3(uLivM) * objectNormal).x);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uLivMode, uLivHW; uniform vec3 uLivStripe, uLivThin, uLivText, uLivCorner; uniform sampler2D uLivTex; uniform vec2 uLivZ, uLivEnds; uniform vec4 uLivY;
varying vec3 vLiv; varying float vLivSide;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  // الجنبين (بالمكان + اتجاه السطح)
  float sideF = smoothstep(0.55, 0.8, vLivSide);
  float side = smoothstep(uLivHW - 0.14, uLivHW - 0.07, abs(vLiv.x)) * sideF;
  vec3 texel = diffuseColor.rgb / max(diffuse, vec3(0.001)); // درجة الصاج من غير اللون
  if (uLivMode > 1.5) {
    // زوايا صفرا تحت: قدام لحد بعد العجلة بحرف مايل، وورا حوالين العجلة اللي ورا
    float zf = vLiv.z - uLivEnds.x;           // المسافة من قدام
    float zr = uLivEnds.y - vLiv.z;           // المسافة من ورا
    float y = vLiv.y;
    float fr = (1.0 - smoothstep(0.83, 0.86, y)) * (1.0 - smoothstep(-0.015, 0.015, zf - (1.2 + (0.85 - y) * 0.55)));
    float rr = (1.0 - smoothstep(0.93, 0.96, y)) * (1.0 - smoothstep(-0.015, 0.015, zr - (1.45 + (0.95 - y) * 0.5)));
    // من قدام/ورا: بس على الحرف (زي الصورة، جنب الفانوس)
    float edge = max(sideF, smoothstep(uLivHW - 0.3, uLivHW - 0.24, abs(vLiv.x)));
    float m = max(fr, rr) * edge * step(0.2, y);
    diffuseColor.rgb = mix(diffuseColor.rgb, uLivCorner * texel, m);
  } else if (uLivMode > 0.5) {
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
    diffuseColor.rgb = mix(diffuseColor.rgb, liv * texel, m * band);
    diffuseColor.rgb = mix(diffuseColor.rgb, uLivThin * texel, m * thin);
  }
}`);
    };
    mat.customProgramCacheKey = () => 'livery3';
    mat.needsUpdate = true;
  });
  set(name);
  return set;
}
