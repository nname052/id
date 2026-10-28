// =====================================================================
//  عمارات المدينة الحقيقية: صندوق واحد مشترك + InstancedMesh لكل مربع (draw call واحد للمربع كله)
//  الواجهة بتترسم في الـ shader من أطلس الشبابيك والمحلات الموجود:
//  - الدور الأرضي محلات (على الشوارع الكبيرة) أو مدخل عمارة
//  - الأدوار: شبابيك/بلكونات من الأطلس، والجناب غالبًا حيطة صمّا (العمارات المصرية لازقة في بعض)
//  - طوب أحمر بهيكل خرساني أو محارة بألوان مصرية
// =====================================================================
import * as THREE from 'three';

const GF = 3.6, FH = 3.0, PARAPET = 0.9;

// ألوان المحارة المصرية (بيج/كريمي/وردي فاتح/أصفر باهت/رمادي) + الطوب
const TINTS = [
  [1.0, 0.97, 0.95], [0.98, 0.95, 0.92], [0.96, 0.93, 0.9], // طوب (لون الطوب من الأطلس)
  [0.86, 0.72, 0.52], [0.9, 0.8, 0.62], [0.86, 0.66, 0.58], [0.88, 0.78, 0.5], [0.74, 0.72, 0.68],
];

let _geo = null;
/** صندوق وحدة (من غير قاع): x,z من -0.5 لـ 0.5 و y من 0 لـ 1. aFace: 0 قدام(+z) 1 ورا 2 يمين(+x) 3 شمال 4 سطح */
function unitBox() {
  if (_geo) return _geo;
  const P = [], N = [], F = [], I = [];
  const quad = (a, b, c, d, n, f) => {
    const k = P.length / 3;
    for (const v of [a, b, c, d]) { P.push(...v); N.push(...n); F.push(f); }
    I.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const h = 0.5;
  quad([-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h], [0, 0, 1], 0);
  quad([h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h], [0, 0, -1], 1);
  quad([h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h], [1, 0, 0], 2);
  quad([-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h], [-1, 0, 0], 3);
  quad([-h, 1, h], [h, 1, h], [h, 1, -h], [-h, 1, -h], [0, 1, 0], 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(F, 1));
  g.setIndex(I);
  return (_geo = g);
}

/** خامة واحدة مشتركة لكل عمارات المدينة (low = من غير صور: للمربعات البعيدة) */
export function buildingMaterial(M, { low = false } = {}) {
  const fp = M.facadePlaster, fb = M.facadeBrick, shop = M.shop;
  const U = {
    uFacP: { value: fp.map }, uFacB: { value: fb.map }, uShop: { value: shop.map },
    uEmP: { value: fp.emissiveMap }, uEmB: { value: fb.emissiveMap }, uEmS: { value: shop.emissiveMap || shop.map },
    uNight: { value: 0 },
    // لون الطوب الصافي: من صور شبين الحقيقية لو اتحملت (M.photoWall)، وإلا الأحمر المولّد
    uBrickC: { value: new THREE.Vector3(...(M.photoWall ? M.photoWall.brick : [0.56, 0.27, 0.18])) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1 });
  mat.userData.U = U;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFace;\nattribute vec4 aInfo;\nvarying vec3 vB;\nflat varying vec3 vSz;\nflat varying vec4 vInfo;\nflat varying float vFace;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vB = position * vSz; vInfo = aInfo; vFace = aFace;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uFacP, uFacB, uShop, uEmP, uEmB, uEmS;
uniform float uNight;
uniform vec3 uBrickC;
// flat: قيم ثابتة للعمارة كلها (لو اتعملها interpolation الـ hash بيتغير من بكسل للتاني = نقط وتشويش)
varying vec3 vB; flat varying vec3 vSz; flat varying vec4 vInfo; flat varying float vFace;
float h1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 cellUV(float cell, vec2 f) {
  f = clamp(f, 0.004, 0.996);
  return vec2((mod(cell, 4.0) + f.x) / 4.0, 1.0 - (floor(cell / 4.0) + 1.0 - f.y) / 2.0);
}`)
      .replace('#include <map_fragment>', `
vec3 fcol = vec3(1.0); vec3 fem = vec3(0.0);
{
  float floors = vInfo.x, style = vInfo.y, flags = vInfo.z, seed = vInfo.w;
  bool brick = style < 2.5;
  float face = floor(vFace + 0.5);
  float faceLen = face < 1.5 ? vSz.x : vSz.z;
  float u = (face < 0.5 ? vB.x : face < 1.5 ? -vB.x : face < 2.5 ? -vB.z : vB.z) + faceLen * 0.5;
  float y = vB.y;
  float top = GF_ + floors * FH_;
  // ===== كل قراءات الصور برا أي if (عشان مستوى الـ mipmap يتحسب صح ومفيش نقط/تشويش) =====
  float bays = max(1.0, floor(faceLen / 3.3 + 0.5)), bw = faceLen / bays;
  vec2 wc = vec2(u / bw, (y - GF_) / FH_);
  vec2 gx = dFdx(wc) * vec2(0.25, 0.5), gy = dFdy(wc) * vec2(0.25, 0.5);
  float bay = floor(wc.x), row = floor(wc.y);
  float prim = floor(h1(vec2(seed, 1.0)) * 8.0);
  float cell = h1(vec2(bay * 7.0 + seed, row)) < 0.62 ? prim : floor(h1(vec2(bay, row + seed * 3.0)) * 8.0);
  vec2 uvW = cellUV(cell, fract(wc));
  vec3 tP = textureGrad(uFacP, uvW, gx, gy).rgb, tB = textureGrad(uFacB, uvW, gx, gy).rgb;
  vec3 eP = textureGrad(uEmP, uvW, gx, gy).rgb, eB = textureGrad(uEmB, uvW, gx, gy).rgb;
  float sbays = max(1.0, floor(faceLen / 3.4 + 0.5)), sw = faceLen / sbays;
  vec2 sc = vec2(u / sw, y / GF_);
  vec2 sgx = dFdx(sc) * vec2(0.25, 0.5), sgy = dFdy(sc) * vec2(0.25, 0.5);
  float sbay = floor(sc.x);
  float doorBay = floor(h1(vec2(seed, 9.0)) * sbays);
  bool shopF = mod(flags, 2.0) > 0.5;
  float scell = abs(sbay - doorBay) < 0.5 ? 7.0 : shopF ? floor(h1(vec2(sbay, seed)) * 7.0) : -1.0;
  vec2 uvS = cellUV(max(scell, 0.0), fract(sc));
  vec3 tS = textureGrad(uShop, uvS, sgx, sgy).rgb, eS = textureGrad(uEmS, uvS, sgx, sgy).rgb;
  // ===== الحيطة الصمّا (طوب أحمر بمونة أو محارة) — مع تنعيم للبعيد =====
  vec3 wall;
  if (brick) {
    vec2 bq = vec2(u / 0.25, y / 0.085); bq.x += mod(floor(bq.y), 2.0) * 0.5;
    vec2 bf = fract(bq), fw = fwidth(bq);
    float aa = clamp(max(fw.x, fw.y) * 2.6 - 0.25, 0.0, 1.0); // بعيد/مايل: لون الطوب المتوسط بدل خطوط (moire)
    float mortar = clamp(step(bf.x, 0.06) + step(bf.y, 0.12), 0.0, 1.0);
    vec3 bc = uBrickC * mix(0.82 + 0.3 * h1(floor(bq) + seed), 0.97, aa);
    wall = mix(mix(bc, vec3(0.66, 0.62, 0.56), mortar), mix(uBrickC * 0.97, vec3(0.66, 0.62, 0.56), 0.17), aa);
    float slab = step(mod(y - GF_, FH_), 0.22) * step(GF_ - 0.01, y);
    wall = mix(wall, vec3(0.62, 0.61, 0.58), slab);
  } else {
    wall = vec3(0.74, 0.71, 0.66) * (0.9 + 0.1 * h1(floor(vec2(u, y) * 0.8) + seed));
    // خط كل دور + بقع وسخ تحت
    wall *= 1.0 - 0.06 * step(mod(y - GF_, FH_), 0.15) * step(GF_, y);
    wall *= mix(0.86, 1.0, smoothstep(0.0, 2.5, y));
  }
  bool front = face < 0.5;
  bool windows = front || (face < 1.5 && h1(vec2(seed, 3.0)) < 0.7) || (face > 1.5 && face < 3.5 && h1(vec2(seed, face)) < 0.12);
  if (face > 3.5) {
    fcol = vec3(0.42, 0.41, 0.39) * (0.82 + 0.18 * h1(floor(vB.xz * 0.7) + seed));
  } else if (y < GF_) {
    if (front && scell >= 0.0) {
      fcol = tS; fem = eS * uNight * 0.8;
      // بعض المحلات مقفولة بالصاج (باب صاج متقفل) — بيكسر تكرار صور المحلات
      if (scell < 6.5 && h1(vec2(sbay * 3.0 + seed, 21.0)) < 0.28) {
        vec2 fs = fract(sc);
        float rib = 0.5 + 0.5 * sin(y * 48.0);
        vec3 sh = mix(vec3(0.44, 0.45, 0.46), vec3(0.58, 0.59, 0.6), rib) * (0.85 + 0.25 * h1(vec2(sbay, seed + 4.0)));
        bool inF = fs.x > 0.06 && fs.x < 0.94 && fs.y < 0.8;
        fcol = inF ? sh * mix(0.75, 1.0, smoothstep(0.0, 0.25, fs.y)) : wall * 0.8;
        fem = vec3(0.0);
      }
    }
    else fcol = wall * 0.8;
  } else if (y < top && windows) {
    fcol = brick ? tB : tP * vec3(0.86, 0.84, 0.8);
    fem = (brick ? eB : eP) * uNight * step(0.45, h1(vec2(bay + seed, row * 5.0)));
    // عمق: أعمدة بين الفتحات + بلاطة الدور بارزة (خط فاتح وتحته ضل)
    vec2 fw2 = fract(wc);
    float aa2 = clamp(max(fwidth(wc.x), fwidth(wc.y)) * 3.0, 0.0, 1.0);
    if (!brick) {
      float pil = (1.0 - step(0.055, fw2.x)) + step(0.945, fw2.x);
      fcol = mix(fcol, wall * 1.05, pil * (1.0 - aa2));
    }
    float slabL = 1.0 - step(0.06, fw2.y), shad = step(0.06, fw2.y) * (1.0 - step(0.1, fw2.y));
    fcol = mix(fcol, (brick ? vec3(0.64, 0.63, 0.6) : wall * 1.08), slabL * (1.0 - aa2));
    fcol *= 1.0 - 0.28 * shad * (1.0 - aa2);
  } else if (y >= top) {
    fcol = vec3(0.6, 0.59, 0.56) * (0.92 + 0.08 * h1(vec2(floor(u), seed)));
  } else fcol = wall;
  // ===== العُمر والتراب (رخيص: حسابات بس من غير صور) =====
  if (face < 3.5) {
    // بقع دهان/ترميم كبيرة، وتراب الدلتا (بيج رمادي) على كل الواجهة
    float patchN = h1(floor(vec2(u / 4.5, y / 3.2)) + seed * 1.7);
    fcol *= mix(0.9, 1.05, patchN);
    fcol = mix(fcol, vec3(0.62, 0.58, 0.5) * dot(fcol, vec3(0.33)) * 1.6, 0.1);
    // خطوط مطر تحت الشبابيك (عمود رفيع بيغمق لتحت)
    if (y >= GF_ && y < top) {
      float fx = fract(wc.x), fy = fract(wc.y);
      float st = step(0.42, fx) * step(fx, 0.58) * smoothstep(0.3, 0.0, fy) * step(0.4, h1(vec2(bay, seed + row)));
      fcol *= 1.0 - 0.13 * st;
    }
    // وسخ تحت الدروة (فوق) ووسخ الشارع (تحت)
    fcol *= 1.0 - 0.12 * smoothstep(top - 1.2, top, y) * step(y, top);
    fcol *= mix(0.8, 1.0, smoothstep(0.0, 1.0, y));
  }
}
diffuseColor.rgb *= fcol;`)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = fem;')
      .replaceAll('GF_', GF.toFixed(2)).replaceAll('FH_', FH.toFixed(2));
    // البعيد: شبابيك بسيطة من غير صور (أخف)
    // (كانت شبابيك مرسومة بلون الحيطة × 0.32 = لون مختلف عن القريب → العمارة "بتتغير" لما تقرب)
    // دلوقتي: نفس صورة الواجهة بس من نسخة صغيرة (mip) — نفس اللون المتوسط وأرخص
    if (low) sh.fragmentShader = sh.fragmentShader.replace('fcol = brick ? tB : tP * vec3(0.86, 0.84, 0.8);', 'fcol = brick ? textureLod(uFacB, uvW, 3.0).rgb : textureLod(uFacP, uvW, 3.0).rgb * vec3(0.86, 0.84, 0.8);');
  };
  mat.customProgramCacheKey = () => (low ? 'shibin-bld-low-5' : 'shibin-bld-4');
  return mat;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

/**
 * list = [[cx, cz, w, d, angle, floors, style, flags], ...] → InstancedMesh + colliders
 * angle: الـ z المحلي للعمارة = ناحية الشارع (الواجهة)
 */
export function buildTileBuildings(list, mat) {
  const base = unitBox();
  const n = list.length;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('normal', base.attributes.normal);
  g.setAttribute('aFace', base.attributes.aFace);
  g.setIndex(base.index);
  const info = new Float32Array(n * 4);
  const mesh = new THREE.InstancedMesh(g, mat, n);
  const cols = [];
  for (let i = 0; i < n; i++) {
    const [cx, cz, w, d, a, floors, style, flags] = list[i];
    const h = GF + floors * FH + PARAPET;
    _m.compose(_p.set(cx, 0, cz), _q.setFromAxisAngle(_Y, a), _s.set(w, h, d));
    mesh.setMatrixAt(i, _m);
    const t = TINTS[style % TINTS.length], dirt = 0.76 + ((i * 7919) % 100) / 100 * 0.2;
    mesh.setColorAt(i, _c.setRGB(t[0] * dirt, t[1] * dirt, t[2] * dirt));
    info[i * 4] = floors; info[i * 4 + 1] = style; info[i * 4 + 2] = flags; info[i * 4 + 3] = ((cx * 13.1 + cz * 7.7) % 97 + 97) % 97 / 9.7;
    cols.push({ cx, cz, hx: w / 2, hz: d / 2, angle: a, restitution: 0.1, kind: 'building', h });
  }
  g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.name = 'buildings';
  return { mesh, colliders: cols };
}

/** المباني الحقيقية من OSM (قليلة): حيطان + سطح من المضلع */
export function buildRealBuilding(b, mat) {
  const h = GF + Math.max(1, b.floors) * FH;
  const pos = [], nor = [], col = [], idx = [];
  const tint = [0.64, 0.58, 0.49];
  for (const ring of b.rings) {
    for (let i = 0; i + 3 < ring.length; i += 2) {
      const ax = ring[i], az = ring[i + 1], bx = ring[i + 2], bz = ring[i + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      const k = pos.length / 3;
      pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
      for (let j = 0; j < 4; j++) { nor.push(nx, 0, nz); col.push(...tint); }
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2); // الوشين (اتجاه الحلقة مش مضمون)
    }
  }
  const k0 = pos.length / 3;
  for (let i = 0; i < b.v.length; i += 2) { pos.push(b.v[i], h, b.v[i + 1]); nor.push(0, 1, 0); col.push(0.6, 0.59, 0.56); }
  for (let i = 0; i < b.i.length; i += 3) idx.push(k0 + b.i[i], k0 + b.i[i + 2], k0 + b.i[i + 1], k0 + b.i[i], k0 + b.i[i + 1], k0 + b.i[i + 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return { mesh: m, h };
}

export const BUILDING_DIMS = { GF, FH, PARAPET };

// =====================================================================
//  إكسسوارات العمارات (للمربعات القريبة بس): على السطح خزان مية + دش + أوضة سلم،
//  وعلى الواجهة تكييفات. كل نوع InstancedMesh واحدة للمربع (2 draw calls) ومن غير ضل.
// =====================================================================
let _kit = null;
function kitParts() {
  if (_kit) return _kit;
  const c = new THREE.Color();
  const col = (g, rgb, m) => {
    g = g.index ? g.toNonIndexed() : g.clone(); if (m) g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
  };
  const M = (x, y, z, rx = 0, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1));
  const merge = (list) => {
    const pos = [], nor = [], cl = [];
    for (const g of list) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); cl.push(...g.attributes.color.array); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    return g;
  };
  const roof = merge([
    col(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 6, 1, true), [0.1, 0.1, 0.11], M(1.2, 0.85, 0.6)),      // خزان بلاستيك أسود
    col(new THREE.CircleGeometry(0.55, 6).rotateX(-Math.PI / 2), [0.12, 0.12, 0.13], M(1.2, 1.4, 0.6)),
    col(new THREE.BoxGeometry(1.2, 0.3, 1.2), [0.55, 0.53, 0.5], M(1.2, 0.15, 0.6)),                // قاعدة الخزان
    col(new THREE.CylinderGeometry(0.5, 0.5, 1.0, 6, 1, true), [0.85, 0.85, 0.82], M(-0.2, 0.8, 1.4)),        // خزان أبيض
    col(new THREE.CircleGeometry(0.5, 6).rotateX(-Math.PI / 2), [0.8, 0.8, 0.78], M(-0.2, 1.3, 1.4)),
    col(new THREE.CylinderGeometry(0.42, 0.06, 0.18, 7, 1, true), [0.82, 0.82, 0.8], M(-1.4, 1.05, -0.6, -0.9, 0.5)), // دش
    col(new THREE.BoxGeometry(0.05, 0.9, 0.05), [0.3, 0.3, 0.3], M(-1.4, 0.45, -0.6)),
    col(new THREE.BoxGeometry(2.4, 2.4, 2.6), [0.66, 0.62, 0.56], M(0.4, 1.2, -1.8)),                // أوضة السلم
    col(new THREE.BoxGeometry(0.9, 1.9, 0.05), [0.28, 0.2, 0.14], M(0.4, 0.95, -0.48)),               // باب السطح
  ]);
  const ac = merge([
    col(new THREE.BoxGeometry(0.8, 0.52, 0.42), [0.86, 0.86, 0.84], M(0, 0, 0)),
    col(new THREE.CircleGeometry(0.19, 6), [0.25, 0.25, 0.26], M(0.12, 0, 0.215)),
      ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  return (_kit = { roof, ac, mat });
}

/** أماكن الإكسسوارات لعمارات مربع: { roofs: [[x,y,z,yaw]], acs: [...] } — بتتملي في NearInstancer (القريب من الكاميرا بس) */
export function tileKitItems(list) {
  const roofs = [], acs = [];
  for (let i = 0; i < list.length; i++) {
    const [cx, cz, w, d, a, floors] = list[i];
    const r = (k) => { const v = Math.sin((cx * 12.9898 + cz * 78.233 + k * 37.719) * 0.01) * 43758.5453; return v - Math.floor(v); };
    const h = GF + floors * FH + PARAPET;
    const ca = Math.cos(a), sa = Math.sin(a);
    const at = (lx, lz) => [cx + lx * ca + lz * sa, cz - lx * sa + lz * ca];
    if (w > 7 && d > 7 && r(1) < 0.75) {
      const [x, z] = at((r(2) - 0.5) * (w - 6), (r(3) - 0.5) * (d - 6));
      roofs.push([x, h - PARAPET + 0.02, z, a + Math.floor(r(4) * 4) * Math.PI / 2]);
    }
    const nAC = floors > 0 ? Math.floor(r(5) * 3.2) : 0;
    for (let k = 0; k < nAC; k++) {
      const fl = Math.floor(r(10 + k) * floors), lx = (r(20 + k) - 0.5) * (w - 2);
      const [x, z] = at(lx, d / 2 + 0.22);
      acs.push([x, GF + fl * FH + 0.55, z, a]);
    }
  }
  return { roofs, acs };
}

export function kitGeometries() { const K = kitParts(); return K; }
