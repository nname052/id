// =====================================================================
//  شبين الكوم الحقيقية (من OpenStreetMap): تحميل المربعات حوالين اللاعب (Streaming) وبناها على دفعات صغيرة
//  كل فريم (مفيش تهنيج)، والمربعات البعيدة بتتشال (hysteresis: تحميل لحد 650م وشيل بعد 900م).
//  واجهة العالم اللي Game بيستخدمها: group / update / updateVisibility / queryColliders.
//  كمان بيقدّم ارتفاع الأرض للفيزيا (رصيف/ترعة/كوبري بمستويين)، وأماكن البداية والرجوع للطريق.
// =====================================================================
import * as THREE from 'three';
import { REGION_BASE, loadJSON, dropCache, buildGraph, edgePoint, edgesNear } from './ShibinData.js';
import { StreetKit } from './ShibinStreetKit.js';
import { ShibinRail } from './ShibinRail.js';
import { styledRealBuilding, buildWorship } from './ShibinCivic.js';
import { buildingMaterial, buildTileBuildings, buildRealBuilding, tileKitItems, kitGeometries } from './ShibinBuildings.js';
import { canvas, tex } from '../../render/textures.js';
import { ShibinLamps } from './ShibinLamps.js';
import { buildLandmarks, NearInstancer } from './ShibinLandmarks.js';

const LOAD_R = 780, UNLOAD_R = 1000;
const SIDE_Y = 0.15, WATER_Y = -0.55, WATER_FLOOR = -0.9;
const RAMP_FILL_H = 4.2; // تحت الارتفاع ده المطلع ردم بحيطان ساندة، وفوقه بلاطة على عواميد
// عرض الرصيف حسب نوع الطريق (نفس جدول build_region.py)
export const SIDEWALK = { motorway: 0, trunk: 2, primary: 3, secondary: 2.5, tertiary: 2, unclassified: 1.5, residential: 1.2, road: 1.2 };

const _v = new THREE.Vector3();

export class ShibinWorld {
  constructor(M, { id = 'shibin', low = false, tier = 'high' } = {}) {
    this.M = M; this.id = id; this.low = low; this.tier = tier;
    this.base = REGION_BASE(id);
    this.group = new THREE.Group(); this.group.name = `region-${id}`;
    this.tiles = new Map();
    this.queue = [];            // شغل البناء (كل عنصر دالة صغيرة)
    this.colGrid = new Map();   // صناديق التصادم الثابتة (16م)
    this.deckGrid = new Map();  // قطع الكباري (للارتفاع) 20م
    this.refY = 0;              // ارتفاع العربية الحالي (عشان نعرف هي فوق الكوبري ولا تحته)
    this.stats = { tilesLoaded: 0, buildings: 0, buildMsMax: 0, loadMs: 0 };
    this.mats = {};
  }

  async init(status = () => {}) {
    const t0 = performance.now();
    const B = this.base;
    status('تحميل خريطة شبين الكوم الحقيقية...', 0.5);
    const [meta, region, landmarks, graph] = await Promise.all([
      loadJSON(B + 'metadata/metadata.json'), loadJSON(B + 'boundaries/region.json'),
      loadJSON(B + 'landmarks/landmarks.json'), loadJSON(B + 'navigation/graph.json'),
    ]);
    this.meta = meta; this.region = region; this.landmarks = landmarks;
    this.TS = meta.tile_size;
    this.graph = buildGraph(graph);
    this.rawGraph = graph;
    // الترع والسكة كلها (ملفات صغيرة) للخريطة — بتتحفظ في الكاش فالـ streaming مش هيحمّلها تاني
    const mm = Object.entries(meta.tiles).flatMap(([n, ls]) => ls.filter((l) => l === 'water' || l === 'railways').map((l) => [l, n]));
    const mmData = await Promise.all(mm.map(([l, n]) => loadJSON(`${B}${l}/${n}.json`).then((d) => [l, d]).catch(() => [l, null])));
    this._mmWater = []; this._mmRail = [];
    for (const [l, d] of mmData) {
      if (!d) continue;
      if (l === 'water') for (const w of d.lines || []) this._mmWater.push(w);
      else for (const r of d.lines || []) if (r.kind !== 'disused') this._mmRail.push(r);
    }
    this._materials();
    this._buildRamps();
    { const K = kitGeometries();
      this.kitRoof = new NearInstancer(K.roof, K.mat, { R: this.low ? 90 : 160, max: this.low ? 70 : 260, name: 'roof-kit' });
      this.kitAC = new NearInstancer(K.ac, K.mat, { R: this.low ? 70 : 110, max: this.low ? 160 : 360, name: 'ac-kit' });
      this.group.add(this.kitRoof.mesh);
      if (!this.low) this.group.add(this.kitAC.mesh); } // الموبايل: من غير تكييفات (تفصيلة صغيرة = draw call أقل)
    // بلكونات + واجهات محلات + أعمدة كهربا وسلك + أسياخ الدور الأخير (القريب من الكاميرا بس)
    this.streetKit = new StreetKit(this, { low: this.low || this.tier === 'low', tier: this.tier });
    this.group.add(this.streetKit.group);
    this._ground();
    this._gates();
    this._landmarkSigns();
    // ملامح شبين (الاستاد/الكورنيش/الشجر/يافطات المحلات) من OSM
    let features = null;
    try { features = await loadJSON(B + 'landmarks/features.json'); } catch { /* الملف اختياري */ }
    try {
      this.landmarksLayer = buildLandmarks(this, features, { mobile: this.low });
      this.group.add(this.landmarksLayer.group);
    } catch (e) { console.warn('[landmarks]', e); this.landmarksLayer = null; }
    this.features = features;
    this.lamps = new ShibinLamps(this, { mobile: this.low, extra: this.landmarksLayer?.lampSpots || [] });
    // السكة الشغالة (قطر + مزلقانات + محطة) — قبل تحميل المربعات عشان مكان المحطة يتشال من العمارات المولّدة
    try { this.rail = new ShibinRail(this, this.group, { low: this.low }); } catch (e) { console.warn('[rail]', e); this.rail = null; }
    this._breakables(); // (بعد الشجر وأعمدة الكهربا)
    // المسجد والكنيسة اللي في OSM (قبل المربعات عشان العمارات المولّدة تتشال من مكانهم)
    try { this.worship = buildWorship(this, features, this.group); } catch (e) { console.warn('[worship]', e); this.worship = []; }
    this.group.add(this.lamps.group);
    this.stats.loadMs = Math.round(performance.now() - t0);
    return this;
  }

  // ===================== الخامات المشتركة =====================
  _materials() {
    const M = this.M;
    const DS = THREE.DoubleSide;
    // مية بحر شبين: لونها من صورة حقيقية للترعة (كوبري عمر أفندي — himoz، Commons، FAL): أخضر رمادي غامق،
    // والسما بتنعكس عليها (envMap) + تموّج خفيف بيتحرك (حسابات في الشيدر، من غير صور)
    const water = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.235, 0.298, 0.278, THREE.SRGBColorSpace), roughness: 0.07, metalness: 0, envMapIntensity: 0.9 });
    const WU = (this._waterU = { uWT: { value: 0 } });
    water.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, WU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWW; uniform float uWT;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // موجتين صغيرين بيتحركوا مع التيار + تموّج أدق: ميل السطح (gradient) → بيعوج الـ normal
  vec2 p = vWW;
  float a1 = p.x * 0.55 + p.y * 0.31 + uWT * 1.1, a2 = p.x * -0.27 + p.y * 0.83 - uWT * 0.8, a3 = (p.x + p.y) * 2.3 + uWT * 2.6;
  vec2 gr = vec2(0.55, 0.31) * cos(a1) * 0.045 + vec2(-0.27, 0.83) * cos(a2) * 0.04 + vec2(2.3, 2.3) * cos(a3) * 0.006;
  float fade = 1.0 - smoothstep(60.0, 220.0, length(vViewPosition)); // بعيد: سطح هادي (من غير وشوشة)
  normal = normalize(normal + (viewMatrix * vec4(-gr.x, 0.0, -gr.y, 0.0)).xyz * fade);
}`);
    };
    water.customProgramCacheKey = () => 'shibin-water-2';
    // "فتحة" الترعة في الأرض: الأرض (y≈0) كانت مغطية المية (-0.55) — وماكانتش بتبان غير من بعيد
    // (لما الـ polygonOffset بتاع الأرض يكبر). ده سطح مش بيترسم لون، بيكتب عمق بس فوق الترعة بعد المية،
    // فالأرض اللي تحته متترسمش. (مفيش خامات ولا draw calls تقيلة)
    const waterCut = new THREE.MeshBasicMaterial({ colorWrite: false });
    const ballast = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 1, side: DS });
    const rail = new THREE.MeshStandardMaterial({ color: 0x6b6e72, roughness: 0.35, metalness: 0.8, side: DS });
    const bank = new THREE.MeshStandardMaterial({ color: 0x7a7266, roughness: 1, side: DS }); // جناب الترعة: حيطة حجر/خرسانة (زي صور الكورنيش)
    // حرف الرصيف: بالوشين (اتجاه حلقات المضلعات مش ثابت)
    const curb = M.curb.clone(); curb.side = DS;
    // دهان الخطوط: بالوشين (اتجاه الأشرطة بيتحدد من اتجاه الخط)
    const paint = M.paint.clone(); paint.side = DS;
    // خطوط باهتة/متآكلة في حتت (مش بيضا نضيفة طول الطريق)
    paint.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPW;\nfloat hP(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }')
        .replace('#include <map_fragment>', '#include <map_fragment>\n{ float w = hP(floor(vPW / 7.0)); float g = hP(floor(vPW * 3.0)); diffuseColor.rgb *= mix(0.62, 1.0, w) * mix(0.85, 1.0, g); }');
    };
    paint.customProgramCacheKey = () => 'shibin-paint-worn';
    // الأسفلت: رقع جديدة أغمق، غطيان بلاعات، بقع زيت — كله حسابات في الـ shader (من غير صور ولا draw calls زيادة)
    const asphalt = this.M.asphalt.clone();
    asphalt.onBeforeCompile = (sh) => {
      // لمعة الشمس على الأسفلت (لما تبص ناحية الشمس الطريق كان بيبيض كله): الأسفلت المترب مطفي تقريبًا
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= 0.3; material.specularF90 = 0.25;');
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vAW; varying float vAY;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvec4 aw4 = modelMatrix * vec4(transformed, 1.0); vAW = aw4.xz; vAY = aw4.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vAW; varying float vAY;
float hA(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nA(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hA(i), hA(i + vec2(1, 0)), f.x), mix(hA(i + vec2(0, 1)), hA(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  // رقع (ترقيع) مستطيلة
  vec2 pc = floor(vAW / vec2(6.0, 4.0)); float ph = hA(pc);
  vec2 pf = fract(vAW / vec2(6.0, 4.0));
  float patchM = step(0.86, ph) * step(0.12, pf.x) * step(pf.x, 0.88) * step(0.15, pf.y) * step(pf.y, 0.85);
  diffuseColor.rgb *= mix(1.0, 0.72, patchM * step(vAY, 1.5)); // (على سطح الكوبري: من غير رقع — كانت بتبان مربعات زي العيب)
  // تفاوت لون الأسفلت + بقع زيت/تراب
  float n = nA(vAW * 0.08) * 0.6 + nA(vAW * 0.35) * 0.4;
  diffuseColor.rgb *= mix(0.86, 1.08, n) * 0.85; // أسفلت مترب: أغمق شوية من الرصيف
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.46, 0.4) * dot(diffuseColor.rgb, vec3(0.33)) * 1.7, smoothstep(0.62, 0.8, nA(vAW * 0.05 + 7.0)) * 0.35);
  // غطا بلاعة كل حوالي 25م
  vec2 mc = floor(vAW / 25.0); vec2 mp = (mc + vec2(0.3 + 0.4 * hA(mc + 3.1), 0.3 + 0.4 * hA(mc + 7.7))) * 25.0;
  float md = length(vAW - mp);
  float man = step(md, 0.38) * step(0.55, hA(mc + 1.3));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.2, 0.21) * (0.8 + 0.4 * step(0.5, fract(md * 9.0))), man);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5), step(0.38, md) * step(md, 0.44) * step(0.55, hA(mc + 1.3)) * 0.6);
}`);
    };
    asphalt.customProgramCacheKey = () => 'shibin-asphalt-wear-4';
    const foot = new THREE.MeshStandardMaterial({ color: 0xa89878, roughness: 1 });
    const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9c9890, roughness: 0.9, side: DS });
    // خرسانة الكباري: ألواح (فواصل كل 4م) + تفاوت لون + سيل مطر/تراب تحت — من غير صور
    concrete.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW; varying vec3 vCN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vCW; varying vec3 vCN;
float hC(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float nC(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hC(i), hC(i + vec2(1, 0)), f.x), mix(hC(i + vec2(0, 1)), hC(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 q = abs(vCN.y) > 0.7 ? vCW.xz : vec2(vCW.x + vCW.z, vCW.y);
  float n = nC(q * 0.6) * 0.5 + nC(q * 2.3) * 0.3 + nC(q * 9.0) * 0.2;
  diffuseColor.rgb *= 0.86 + 0.24 * n;
  float jf = fract((vCW.x + vCW.z) / 4.0), jd = min(jf, 1.0 - jf) * 4.0; // المسافة (م) لأقرب فاصل
  float joint = 1.0 - smoothstep(0.015, 0.045, jd);
  diffuseColor.rgb *= 1.0 - 0.18 * clamp(joint, 0.0, 1.0) * step(abs(vCN.y), 0.7);
  diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 1.6, vCW.y)); // وسخ الشارع تحت
  diffuseColor.rgb *= vCN.y < -0.7 ? 0.7 : 1.0; // بطن البلاطة أغمق
}`);
    };
    concrete.customProgramCacheKey = () => 'shibin-concrete-1';
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8e92, roughness: 0.45, metalness: 0.6, side: DS });
    const pitch = new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.95 });
    this.mats = { asphalt, water, waterCut, ballast, rail, bank, foot, plain, concrete, steel, pitch, curb, paint, bld: buildingMaterial(M), bldLow: buildingMaterial(M, { low: true }) };
  }

  setNight(on) {
    for (const m of [this.mats.bld, this.mats.bldLow]) m.userData.U.uNight.value = on ? 1 : 0;
    this.lamps?.setNight(on);
    this.landmarksLayer?.setNight(on);
    this.streetKit?.setNight(on);
  }

  /**
   * الكباري للفيزيا: كل وصلة عالية في الشبكة بخطها الكامل (الارتفاع بيبدأ من صفر بالراحة) — نفس الارتفاعات
   * اللي المرور ماشي عليها. + رسم الجزء الواطي من المطلع (أقل من 45سم) اللي ملف المربعات مكانش بيرسمه
   */
  _buildRamps() {
    const pos = [], col = [], uv = [], idx = [];
    for (const e of this.graph.edges) {
      if (!e.elevated) continue;
      const P = e.pts, hw = e.half;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        const sgm = { ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, hw: hw + 0.3, edge: e.src, e };
        const x0 = Math.floor((Math.min(a.x, b.x) - hw - 1) / 20), x1 = Math.floor((Math.max(a.x, b.x) + hw + 1) / 20);
        const z0 = Math.floor((Math.min(a.z, b.z) - hw - 1) / 20), z1 = Math.floor((Math.max(a.z, b.z) + hw + 1) / 20);
        for (let gi = x0; gi <= x1; gi++) for (let gj = z0; gj <= z1; gj++) {
          const k = gi * 100003 + gj; let arr = this.deckGrid.get(k); if (!arr) this.deckGrid.set(k, (arr = [])); arr.push(sgm);
        }
        // الرسم: الجزء الواطي بس (العالي متبني في المربع) — لحد 1م: سطح الكوبري المرسوم بقى بيبدأ من ارتفاع
        // الشبكة نفسه (smooth_ramps.py) فرجله ممكن تبقى على 0.6-1م؛ التداخل معاه مش باين (نفس الارتفاع + 1سم)
        if (Math.min(a.y, b.y) > 1.05 || Math.max(a.y, b.y) < 0.005) continue;
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, rx = -dz / L * hw, rz = dx / L * hw;
        const k = pos.length / 3;
        pos.push(a.x - rx, a.y + 0.012, a.z - rz, a.x + rx, a.y + 0.012, a.z + rz, b.x + rx, b.y + 0.012, b.z + rz, b.x - rx, b.y + 0.012, b.z - rz);
        for (let q = 0; q < 4; q++) col.push(0.92, 0.92, 0.92);
        uv.push((a.x - rx) / 7, (a.z - rz) / 7, (a.x + rx) / 7, (a.z + rz) / 7, (b.x + rx) / 7, (b.z + rz) / 7, (b.x - rx) / 7, (b.z - rz) / 7);
        const cr = (2 * rx) * ((b.z + rz) - (a.z - rz)) - (2 * rz) * ((b.x + rx) - (a.x - rx));
        if (cr > 0) idx.push(k, k + 2, k + 1, k, k + 3, k + 2); else idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
    }
    this._blockRampCrossings();
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.mats.asphalt); m.receiveShadow = true; m.name = 'ramps';
    this.group.add(m);
  }

  /**
   * شارع أرضي بيقطع مطلع كوبري في حتة واطية (السطح تحت 3.4م → مفيش عربية تعدّي من تحت): الشارع ده في الحقيقة
   * بيقفل عند حيطة المطلع. بنقفل الوصلة دي في الشبكة (GPS والمرور مايعدّوش منها) والمطلع بيتردم عادي.
   */
  _blockRampCrossings() {
    this.rampBlocked = [];
    for (const r of this.graph.edges) {
      if (!r.elevated) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1], ym = ((a.y || 0) + (b.y || 0)) / 2;
        if (ym < 0.6 || ym > 3.4) continue;
        for (const e of this.groundCrossings(a, b, r)) { e.closed = true; e.rampBlocked = true; this.rampBlocked.push(e.id); }
      }
    }
  }

  /** الشوارع الأرضية اللي خطها بيقطع القطعة a→b فعلًا (مش بس بتنتهي عندها) — من غير الشوارع المتوصلة بالوصلة r */
  groundCrossings(a, b, r) {
    const cross = (a, b, c, d) => { const d1 = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x), d2 = (b.x - a.x) * (d.z - a.z) - (b.z - a.z) * (d.x - a.x), d3 = (d.x - c.x) * (a.z - c.z) - (d.z - c.z) * (a.x - c.x), d4 = (d.x - c.x) * (b.z - c.z) - (d.z - c.z) * (b.x - c.x); return d1 * d2 < 0 && d3 * d4 < 0; };
    const out = [];
    for (const e of edgesNear(this.graph, (a.x + b.x) / 2, (a.z + b.z) / 2, 30)) {
      if (e.elevated || e.closed || out.includes(e)) continue;
      if (r && (e.from === r.from || e.from === r.to || e.to === r.from || e.to === r.to)) continue;
      for (let j = 0; j < e.pts.length - 1; j++) if (cross(a, b, e.pts[j], e.pts[j + 1])) { out.push(e); break; }
    }
    return out;
  }

  // ===================== الحاجات اللي بتتكسر (شجر + عواميد كهربا) =====================
  /** كل شجرة/عمود ليه تصادم صغير؛ الخبطة الجامدة بتوقّعه (breakProp) */
  _breakables() {
    this.fallen = [];
    const add = (inst, r, h) => { if (!inst) return; for (const it of inst.items) this._addCollider({ cx: it.x, cz: it.z, hx: r, hz: r, angle: 0, restitution: 0.12, kind: 'breakable', item: it, inst, h, yMax: 2.5 }, null); };
    const tree = this.landmarksLayer?.instancers?.find((q) => q.mesh.name === 'trees');
    add(tree, 0.22, 4.5);
    add(this.streetKit?.pole, 0.17, 8.6);
  }

  /** العربية خبطت حاجة بتتكسر بسرعة v (م/ث) في اتجاه (vx,vz) → بتقع ناحية الحركة */
  breakProp(c, vx, vz) {
    if (c.dead) return false;
    c.dead = true;
    const it = c.item, inst = c.inst;
    it.ok = false;
    // السلك اللي متعلق في العمود ده بيقع معاه
    if (this.streetKit && inst === this.streetKit.pole) for (const w of this.streetKit.wire.near(it.x, it.z, 50)) if (w.ext?.from === it || w.ext?.to === it) w.ok = false;
    if (this._lastCam) { inst.update(this._lastCam); this.streetKit?.wire.update(this._lastCam); }
    const pivot = new THREE.Group(); pivot.position.set(it.x, it.y, it.z);
    const m = new THREE.Mesh(inst.mesh.geometry, inst.mesh.material);
    m.rotation.y = it.yaw; m.scale.set(it.ext?.sx ?? it.scale, it.sy, it.ext?.sz ?? it.scale); m.castShadow = true;
    pivot.add(m); this.group.add(pivot);
    const l = Math.hypot(vx, vz) || 1;
    const F = { pivot, ax: new THREE.Vector3(vz / l, 0, -vx / l), a: 0, w: 0.4, t: 0, x: it.x, z: it.z, dx: vx / l, dz: vz / l, h: c.h, done: false };
    this.fallen.push(F);
    return true;
  }

  _updateFallen(dt) {
    for (let i = this.fallen.length - 1; i >= 0; i--) {
      const F = this.fallen[i]; F.t += dt;
      if (!F.done) {
        F.w += 4.5 * dt * Math.cos(F.a); F.a = Math.min(Math.PI / 2 - 0.06, F.a + F.w * dt); // بيتسارع زي الجاذبية لحد ما ينام
        F.pivot.quaternion.setFromAxisAngle(F.ax, F.a);
        if (F.a >= Math.PI / 2 - 0.06) {
          F.done = true;
          // نايم على الأرض: تصادم بطوله (من على الأرض بس)
          const L = F.h * 0.9, cx = F.x + F.dx * L / 2, cz = F.z + F.dz * L / 2;
          F.col = { cx, cz, hx: 0.3, hz: L / 2, angle: Math.atan2(F.dx, F.dz), restitution: 0.2, kind: 'prop', yMax: 1.2 };
          this._addCollider(F.col, null);
        }
      }
      // بعد دقيقة البلدية شالته
      if (F.t > 60) { F.pivot.removeFromParent(); if (F.col) F.col.dead = true; this.fallen.splice(i, 1); }
    }
  }

  /** للمرور: حاجة واقعة في الشارع */
  get fallenStops() { return this.fallen.filter((F) => F.done).map((F) => ({ x: F.x + F.dx * F.h * 0.45, z: F.z + F.dz * F.h * 0.45, r: Math.max(3, F.h * 0.5), gap: 2 })); }

  /** شارع أرضي معدّي تحت النقطة دي (جوه عرضه + هامش)؟ */
  _groundRoadUnder(x, z, pad = 0, cross = null) {
    for (const e of edgesNear(this.graph, x, z, 30)) {
      if (e.elevated || e.closed) continue;
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i], b = e.pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
        if ((a.y || 0) > 0.3 || (b.y || 0) > 0.3) continue;
        // cross=[dx,dz]: الشوارع اللي بتعدّي بالعرض بس (مش الشارع اللي الكوبري ماشي فوقه بطوله)
        if (cross && Math.abs((ex * cross[0] + ez * cross[1]) / Math.sqrt(l2)) > 0.6) continue;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
        if (Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t)) < e.half + 0.8 + pad) return true;
      }
    }
    return false;
  }

  /** فيه طريق على الأرض (مش كوبري) خطه أقرب من d للنقطة دي، والنقطة جوه عرضه؟ (نادر: بيتنادى عند أطراف المطالع بس) */
  _groundRoadNearer(x, z, d, deck) {
    const G = this.graph, C = G.CELL, cx = Math.floor(x / C), cz = Math.floor(z / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = G.grid.get(`${cx + i},${cz + j}`);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 2) {
        const e = arr[k];
        if (e.elevated || e.closed) continue;
        // الطريق اللي بيكمّل الكوبري نفسه (متوصل بيه) مش "شارع موازي"
        if (deck && (e.from === deck.from || e.from === deck.to || e.to === deck.from || e.to === deck.to)) continue;
        const a = e.pts[arr[k + 1]], b = e.pts[arr[k + 1] + 1];
        const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
        const dd = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
        if (dd < d && dd < e.half - (d === Infinity ? 0.3 : 0)) return true;
      }
    }
    return false;
  }

  /** مكان مايتمشيش فيه على الرجل: جوه عمارة، أو جوه/تحت مطلع كوبري واطي (ردم مقفول مش كوبري مفتوح) */
  walkBlocked(x, z) {
    const segs = this.deckGrid.get(Math.floor(x / 20) * 100003 + Math.floor(z / 20));
    if (segs) for (const s of segs) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2));
      const h = s.ay + (s.by - s.ay) * t;
      if (h > 0.35 && h < 4.3 && Math.hypot(x - (s.ax + ex * t), z - (s.az + ez * t)) < s.hw + 0.6) return true;
    }
    const a = this.colGrid.get(Math.floor(x / 16) * 100003 + Math.floor(z / 16));
    if (a) for (const c of a) {
      if (c.kind !== 'building' || c.dead) continue;
      const dx = x - c.cx, dz = z - c.cz, ca = Math.cos(c.angle), sa = Math.sin(c.angle);
      if (Math.abs(dx * ca - dz * sa) < c.hx + 0.1 && Math.abs(dx * sa + dz * ca) < c.hz + 0.1) return true;
    }
    return false;
  }

  /** النقطة دي تحت (أو على) سطح أي كوبري؟ */
  _underDeck(x, z) {
    const segs = this.deckGrid.get(Math.floor(x / 20) * 100003 + Math.floor(z / 20));
    if (!segs) return false;
    for (const s of segs) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2));
      if (Math.hypot(x - (s.ax + ex * t), z - (s.az + ez * t)) < s.hw + 0.5) return true;
    }
    return false;
  }

  /** النقطة دي على سطح أي كوبري/مطلع تاني (غير edge) بأي ارتفاع؟ (سور المطلع الواطي مايتقفلش جوه حارة مطلع جنبه) */
  _onOtherDeck(x, z, edgeId) {
    const segs = this.deckGrid.get(Math.floor(x / 20) * 100003 + Math.floor(z / 20));
    if (!segs) return false;
    for (const s of segs) {
      if (s.edge === edgeId) continue;
      const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2));
      if (Math.hypot(x - (s.ax + ex * t), z - (s.az + ez * t)) < s.hw + 0.3) return true;
    }
    return false;
  }

  /** النقطة دي على سطح كوبري تاني (غير edge) في نفس الارتفاع تقريبًا؟ */
  _insideOtherDeck(x, z, y, edgeId) {
    const segs = this.deckGrid.get(Math.floor(x / 20) * 100003 + Math.floor(z / 20));
    if (!segs) return false;
    for (const s of segs) {
      if (s.edge === edgeId) continue;
      const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2));
      if (Math.hypot(x - (s.ax + ex * t), z - (s.az + ez * t)) < s.hw + 0.2 && Math.abs(s.ay + (s.by - s.ay) * t - y) < 1.6) return true;
    }
    return false;
  }

  // أرض المنطقة كلها: تراب/أرض (الغيطان والفراغات بين البيوت)
  _ground() {
    const [x0, z0, x1, z1] = this.region.bbox_local;
    const pad = 600;
    const w = x1 - x0 + pad * 2, d = z1 - z0 + pad * 2;
    // مقسومة (مش مثلثين بطول المنطقة كلها): المثلث العملاق بيبوّظ دقة الـ depth وكانت الأرض بتطلع فوق الأسفلت (الطريق يبيض)
    const g = new THREE.PlaneGeometry(w, d, Math.ceil(w / 200), Math.ceil(d / 200)).rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 9, uv.getY(i) * d / 9);
    const mat = this.M.dirt.clone();
    mat.map = this.M.dirt.map.clone(); mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; mat.map.needsUpdate = true;
    mat.color.set(0xb9ab8c);
    // جوه المدينة الأرض تراب/أسمنت مترب (مش غيطان خضرا): ماسك من شبكة الطرق نفسها (كل حتة قريبة من شوارع كتير = مدينة)
    {
      const N = 512, c = canvas(N, N), x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, N, N);
      const sx = N / w, sz = N / d, ox = (x0 - pad), oz = (z0 - pad);
      x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = 90 * sx; // (أقوى: جنب كوبري/شارع لوحده كانت بتطلع غيط بخضرة)
      for (const e of this.graph.edges) {
        if (e.cls === 'track' || e.cls === 'service' && e.length > 300) continue;
        x.beginPath(); e.pts.forEach((q, i) => { const X = (q.x - ox) * sx, Z = (q.z - oz) * sz; if (i) x.lineTo(X, Z); else x.moveTo(X, Z); }); x.stroke();
      }
      const mask = tex(c, { repeat: false, srgb: false });
      mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping; mask.minFilter = THREE.LinearFilter; mask.generateMipmaps = false;
      const U = { uMask: { value: mask }, uMB: { value: new THREE.Vector4(ox, oz, w, d) } };
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uMask; uniform vec4 uMB; varying vec2 vGW;')
          .replace('#include <map_fragment>', `#include <map_fragment>
{
  float urb = smoothstep(0.25, 0.75, texture2D(uMask, (vGW - uMB.xy) / uMB.zw).r);
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
  // (كانت فاتحة أوي = بتبان زي التلج في الشمس حوالين الاستاد والأراضي الفاضية) — تراب أغمق وبتفاصيل الصورة
  vec3 dust = vec3(0.5, 0.45, 0.38) * (0.55 + 0.9 * lum);
  diffuseColor.rgb = mix(diffuseColor.rgb, dust, urb * 0.75);
}`);
      };
      mat.customProgramCacheKey = () => 'shibin-ground-urban-2';
    }
    mat.polygonOffset = true; mat.polygonOffsetFactor = 2; mat.polygonOffsetUnits = 2; // دايمًا ورا الأسفلت والأرصفة
    const m = new THREE.Mesh(g, mat);
    m.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
    m.receiveShadow = true; m.name = 'ground';
    this.group.add(m);
  }

  // ===================== بوابات التوسع (حدود المنطقة) =====================
  _gates() {
    const G = new THREE.Group(); G.name = 'expansion-gates';
    const jersey = new THREE.MeshStandardMaterial({ color: 0xdcd8cf, roughness: 0.85 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.6 });
    const c = canvas(512, 192), x = c.getContext('2d');
    x.fillStyle = '#f2c230'; x.fillRect(0, 0, 512, 192);
    x.fillStyle = '#111'; x.fillRect(0, 0, 512, 14); x.fillRect(0, 178, 512, 14);
    x.font = 'bold 64px Cairo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    x.fillText('الطريق مقفول', 256, 72);
    x.font = 'bold 34px Cairo, sans-serif'; x.fillText('أعمال توسعة — قريبًا', 256, 140);
    const signMat = new THREE.MeshStandardMaterial({ map: tex(c, { repeat: false }), roughness: 0.6 });
    const block = new THREE.BoxGeometry(1.9, 0.8, 0.55), cap = new THREE.BoxGeometry(1.92, 0.12, 0.57);
    const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), board = new THREE.PlaneGeometry(2.2, 0.82);
    this.gateList = [];
    // كل قطعة من نوع واحد = InstancedMesh واحدة (كانت ~1400 Mesh منفصلة: الشجرة كلها بتتلف كل فريم
    // لحساب المصفوفات، وكل كتلة خرسانة قريبة = draw call لوحدها)
    const lists = new Map(); // geo|mat → [matrix]
    const _o = new THREE.Object3D();
    const put = (geo, mat, x, y, z, ry, shadow = false) => {
      const k = `${geo.uuid}|${mat.uuid}`;
      if (!lists.has(k)) lists.set(k, { geo, mat, shadow, ms: [] });
      _o.position.set(x, y, z); _o.rotation.set(0, ry, 0); _o.updateMatrix();
      lists.get(k).ms.push(_o.matrix.clone());
    };
    for (const gt of this.region.gates) {
      const e = this.graph.edges.find((ed) => ed.src === gt.edge) || null;
      // اتجاه الطريق عند البوابة (برا المنطقة)
      const yaw = gt.heading;
      const half = (gt.road_width || 6) / 2 + 1.2;
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      // جوه المنطقة بمتر عشان تبان قبل الحد
      const cx = gt.x - fx * 1.2, cz = gt.z - fz * 1.2;
      const n = Math.max(2, Math.ceil((half * 2) / 1.95));
      for (let k = 0; k < n; k++) {
        const off = -half + (k + 0.5) * (half * 2 / n);
        const bx = cx + rx * off, bz = cz + rz * off;
        put(block, jersey, bx, 0.4, bz, yaw + Math.PI / 2, true);
        put(cap, stripe, bx, 0.86, bz, yaw + Math.PI / 2);
      }
      const sx = cx - fx * 0.8, sz = cz - fz * 0.8;
      for (const o of [-0.95, 0.95]) put(pole, stripe, sx + rx * o, 1.1, sz + rz * o, 0);
      put(board, signMat, sx, 1.85, sz, yaw + Math.PI);
      put(board, signMat, sx + fx * 0.02, 1.85, sz + fz * 0.02, yaw);
      // حاجز غير مرئي على عرض الطريق كله (مفيش عدّي)
      this._addCollider({ cx, cz, hx: half + 0.5, hz: 0.6, angle: yaw, restitution: 0.15, kind: 'wall', gate: gt.id }, null);
      this.gateList.push({ ...gt, edgeRef: e });
    }
    for (const { geo, mat, shadow, ms } of lists.values()) {
      const im = new THREE.InstancedMesh(geo, mat, ms.length);
      ms.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = shadow;
      G.add(im);
    }
    // ثابتة: المصفوفات بتتحسب مرة واحدة بس
    G.updateMatrixWorld(true); G.matrixAutoUpdate = false; G.matrixWorldAutoUpdate = false;
    this.group.add(G);
  }

  // ===================== يافطات المعالم (أماكنها من OSM بس) =====================
  _landmarkSigns() {
    const G = new THREE.Group(); G.name = 'landmarks';
    const pole = new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.6 });
    this.landmarkPoints = [];
    for (const L of this.landmarks.confirmed) {
      if (!L.inside_region || L.kind === 'street' || L.kind === 'canal') continue;
      // أقرب شارع للمعلم → اليافطة على الرصيف ناحية المعلم (عمرها ما تبقى على الأسفلت)
      const near = edgesNear(this.graph, L.x, L.z, 160).filter((e) => !e.closed && !e.elevated);
      const cands = [];
      for (const e of near) for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i], b = e.pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(0, Math.min(1, ((L.x - a.x) * ex + (L.z - a.z) * ez) / l2));
        const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(L.x - px, L.z - pz);
        cands.push({ e, px, pz, d, dx: ex / Math.sqrt(l2), dz: ez / Math.sqrt(l2) });
      }
      cands.sort((a, b) => a.d - b.d);
      // أقرب مكان اليافطة فيه مش على طريق تاني (تقاطع/مطلع كوبري) ولا تحت كوبري
      let best = null, nx = 0, nz = 0, sx = 0, sz = 0;
      for (const c of cands.slice(0, 40)) {
        let qx = -c.dz, qz = c.dx;
        if ((L.x - c.px) * qx + (L.z - c.pz) * qz < 0) { qx = -qx; qz = -qz; }
        const sw = SIDEWALK[c.e.cls.replace('_link', '')] || 0;
        const off = c.e.half + Math.max(0.5, sw - 0.4);
        const x = c.px + qx * off, z = c.pz + qz * off;
        const r = this.nearestRoad(x, z, 30);
        if (r && r.e !== c.e && r.d < r.e.half + 1.5 || this._underDeck(x, z)) continue;
        best = c; nx = qx; nz = qz; sx = x; sz = z; break;
      }
      if (!best) continue;
      const { e } = best;
      const c = canvas(640, 160), x = c.getContext('2d');
      x.fillStyle = '#0d4f8c'; x.fillRect(0, 0, 640, 160);
      x.strokeStyle = '#fff'; x.lineWidth = 6; x.strokeRect(8, 8, 624, 144);
      x.fillStyle = '#fff'; x.font = 'bold 54px Cairo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
      let fs = 54; while (x.measureText(L.name).width > 590 && fs > 26) { fs -= 4; x.font = `bold ${fs}px Cairo, sans-serif`; }
      x.fillText(L.name, 320, 84);
      const m = new THREE.MeshStandardMaterial({ map: tex(c, { repeat: false }), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.06 });
      m.emissiveMap = m.map;
      const yaw = Math.atan2(nx, nz);
      for (const o of [-1.2, 1.2]) { const p = new THREE.Mesh(pole, poleMat); p.position.set(sx + best.dx * o, SIDE_Y + 1.7, sz + best.dz * o); G.add(p); }
      const bd = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.75, 0.08), [poleMat, poleMat, poleMat, poleMat, m, m]);
      bd.position.set(sx, 3.2, sz); bd.rotation.y = yaw + Math.PI; bd.castShadow = true; G.add(bd);
      this._addCollider({ cx: sx, cz: sz, hx: 1.4, hz: 0.25, angle: Math.atan2(best.dx, best.dz) + Math.PI / 2, restitution: 0.1, kind: 'prop' }, null);
      this.landmarkPoints.push({ id: L.id, name: L.name, kind: L.kind, x: L.x, z: L.z, sx, sz, rx: best.px, rz: best.pz, edge: e });
    }
    this.group.add(G);
  }

  // ===================== التصادم =====================
  _addCollider(c, tile) {
    const C = 16;
    const r = Math.hypot(c.hx, c.hz);
    const x0 = Math.floor((c.cx - r) / C), x1 = Math.floor((c.cx + r) / C), z0 = Math.floor((c.cz - r) / C), z1 = Math.floor((c.cz + r) / C);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 100003 + j;
      let a = this.colGrid.get(k); if (!a) this.colGrid.set(k, (a = []));
      a.push(c);
      if (tile) tile.colKeys.push(k, c);
    }
  }

  _removeTileColliders(tile) {
    const ks = tile.colKeys;
    for (let i = 0; i < ks.length; i += 2) {
      const a = this.colGrid.get(ks[i]); if (!a) continue;
      const j = a.indexOf(ks[i + 1]); if (j >= 0) { a[j] = a[a.length - 1]; a.pop(); }
      if (!a.length) this.colGrid.delete(ks[i]);
    }
    tile.colKeys.length = 0;
  }

  queryColliders(cx, cz, out) {
    const C = 16, i0 = Math.floor((cx - 10) / C), i1 = Math.floor((cx + 10) / C), j0 = Math.floor((cz - 10) / C), j1 = Math.floor((cz + 10) / C);
    const y = this.refY;
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.colGrid.get(i * 100003 + j); if (!a) continue;
      for (const c of a) {
        if (seen.has(c)) continue; seen.add(c);
        // المستوى: الحواجز اللي على الكوبري للعربيات اللي فوقه بس، وجناب الترعة للي تحت
        if (c.dead) continue;
        if (c.item) { if (c.item.ok === undefined && c.inst?.check) c.item.ok = c.inst.check(c.item); if (c.item.ok === false) continue; }
        if (c.yMin !== undefined && y < c.yMin) continue;
        if (c.yMax !== undefined && y > c.yMax) continue;
        out.push(c);
      }
    }
  }

  // ===================== ارتفاع الأرض (للفيزيا والناس) =====================
  height(x, z, yHint) {
    const ref = yHint ?? this.refY;
    let g = 0;
    const T = this.tiles.get(this._tkey(Math.floor(x / this.TS), Math.floor(z / this.TS)));
    if (T && T.ready) {
      if (T.sideGrid && inTriGrid(T.sideGrid, x, z)) g = SIDE_Y;
      else if (T.waterGrid && inTriGrid(T.waterGrid, x, z)) g = WATER_FLOOR;
    }
    // الكباري: أعلى سطح تحت العربية (أو على مستوى طلعتها)
    const segs = this.deckGrid.get(Math.floor(x / 20) * 100003 + Math.floor(z / 20));
    if (segs) {
      // أقرب سطح كوبري (بالمسافة من خطه) من اللي العربية ممكن تكون عليهم — مش "الأعلى":
      // الأعلى كان بيلقط الكوبري اللي جنبك أو طرف قطعة ممدود قبل بدايتها = قفزة/انقلاب
      let bestD = Infinity, bestSc = Infinity, bh = null, bestE = null, bestHw = 0;
      const cand = this._cand || (this._cand = []); cand.length = 0;
      for (const s of segs) {
        const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez || 1e-9;
        const tr = ((x - s.ax) * ex + (z - s.az) * ez) / l2, t = Math.max(0, Math.min(1, tr));
        const d = Math.hypot(x - (s.ax + ex * t), z - (s.az + ez * t));
        if (d > s.hw) continue;
        // الارتفاع بعد طرف القطعة (لحد 1.5م) = امتداد ميلها مش ارتفاع الطرف: التنعيم تحت كان بيخلط ارتفاع الطرف
        // الثابت مع القطعة اللي بعدها = تموّج كل 4م في المطلع (العربية بتتنطط وهي طالعة)
        const te = Math.max(-1.5 / Math.sqrt(l2), Math.min(1 + 1.5 / Math.sqrt(l2), tr));
        let h = s.ay + (s.by - s.ay) * te;
        // أول المطلع (واطي): حرفه الجانبي منحدر ناعم مش عتبة (لو حارة شارع جنبه بتلمسه)
        // (عرض الحرف الناعم 1.2م مش 3م: الـ 3م كان بيعمل ميل جانبي تحت العجل اللي ماشية جنب السور → انقلاب)
        // (التنعيم بيقل تدريجيًا بين 0.4 و 1م — كان بيتقطع فجأة عند 0.5 = عتبة 10سم في الكباري الصغيرة)
        if (h < 1) { const k = Math.min(1, (s.hw - d) / 1.2), b = h <= 0.4 ? 1 : (1 - h) / 0.6; h *= 1 - (1 - k) * b; }
        // بنفضل على السطح اللي العربية عليه: بس الأسطح القريبة من ارتفاعها (±0.8م) — مطلع جنب كوبري
        // أعلى/أوطى منه مايشقلبش العربية — ومن بينهم الأقرب لخطه (عشان التفريعة تمشي مع اللي ماشي عليها)
        // (الطلوع على سطح أعلى من العربية: لحد 40سم بس زي الرصيف — كان 80سم: العربية اللي على الأرض جنب المطلع
        //  بتمسك سطحه فجأة = قفزة 94سم في فريم واحد → تطير وتتقلب. النزول لسه لحد 80سم)
        if (h - ref > 0.4 || ref - h > 0.8 || h < g - 0.05) continue;
        cand.push(d, h);
        // الأقرب لخطه + عقوبة على فرق الارتفاع عن العربية: الكوبري التاني (الاتجاه العكسي) اللي لازق جنبك وأعلى بـ 30-40سم
        // كان بيتلقط تحت عجلتين بس → العربية بتميل فجأة وتتقلب. عند التفريعة السطحين نفس الارتفاع فمفيش فرق
        const sc = d + Math.abs(h - ref) * 8;
        if (sc < bestSc) { bestSc = sc; bestD = d; bh = h; bestE = s.e; bestHw = s.hw; }
      }
      // تنعيم عند انحناءات الخط: متوسط موزون للقطع القريبة (وزن بينزل لصفر خطيًا) — مفيش عتبات عند الكوع
      if (cand.length > 2) {
        let sw = 0, sh = 0;
        const h0 = bh;
        for (let k = 0; k < cand.length; k += 2) { if (Math.abs(cand[k + 1] - h0) > 0.15) continue; const w = Math.max(0, bestD + 0.8 - cand[k]); sw += w; sh += w * cand[k + 1]; }
        if (sw > 0) bh = sh / sw;
      }
      // أول/آخر المطلع (واطي) جنب شارع على الأرض موازي ليه: لو العربية أقرب لخط الشارع، فهي على الشارع
      // (بس لو العربية مش في قلب حارة المطلع: عند التفريعة الشارع الأرضي بيلمس المطلع، وكانت العربية اللي ماشية
      //  على المطلع بتتحسب على الشارع → المطلع يعلى فوقها وهي تفضل تحته = "دخلت الكوبري ولقيت نفسي تحت")
      if (bh !== null && bh < 1.2 && bestD > bestHw * 0.55 && (ref < bh - 0.3 ? this._groundRoadNearer(x, z, Infinity, null) : bh < 0.8 && Math.abs(ref - bh) > 0.08 && this._groundRoadNearer(x, z, bestD, bestE))) bh = null; // (اللي ماشي على المطلع فعلًا — ارتفاعه = ارتفاعه — بيفضل عليه حتى عند حرفه)
      if (bh !== null) g = bh;
    }
    return g;
  }

  surface(x, z) {
    return 'city';
  }

  // ===================== Streaming =====================
  _tkey(i, j) { return i * 1000 + j; }

  update(dt) {
    if (this._waterU) this._waterU.uWT.value += dt;
    if (this.fallen?.length) this._updateFallen(dt);
    // بنبني على دفعات: ميزانية وقت صغيرة كل فريم
    const budget = this.low ? 4 : 7;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budget) {
      const job = this.queue.shift();
      const s = performance.now();
      job();
      const ms = performance.now() - s;
      if (ms > this.stats.buildMsMax) { this.stats.buildMsMax = ms; this.stats.buildMaxJob = job.label || job.toString().slice(0, 60); }
    }
  }

  /** كل ربع ثانية: المربعات المطلوبة حوالين الكاميرا، والبعيد بيتشال */
  updateVisibility(cam, viewDist = 560) {
    const TS = this.TS, cx = cam.x, cz = cam.z;
    this.lamps?.update(0.25, cam);
    this.landmarksLayer?.update(0.25, cam);
    this._lastCam = cam;
    this._kitT = (this._kitT || 0) - 0.25; if (this._kitT <= 0) { this._kitT = 0.5; this.kitRoof?.update(cam); this.kitAC?.update(cam); this.streetKit?.update(cam); }
    const tiles = this.meta.tiles;
    const r = Math.min(LOAD_R, viewDist + 120);
    const i0 = Math.floor((cx - r) / TS), i1 = Math.floor((cx + r) / TS), j0 = Math.floor((cz - r) / TS), j1 = Math.floor((cz + r) / TS);
    const want = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const name = `t_${i}_${j}`;
      if (!tiles[name]) continue;
      const d = tileDist(cx, cz, i, j, TS);
      if (d > r) continue;
      const k = this._tkey(i, j);
      if (!this.tiles.has(k)) want.push({ k, i, j, name, d });
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want.slice(0, 3)) this._loadTile(w);
    for (const [k, T] of this.tiles) {
      const d = tileDist(cx, cz, T.i, T.j, TS);
      if (d > UNLOAD_R) { this._unloadTile(T); this.tiles.delete(k); continue; }
      if (!T.ready) continue;
      // LOD: التفاصيل (علامات/حرف الرصيف/قضبان) قريب بس، والعمارات البعيدة بخامة من غير صور
      // الموبايل: التفاصيل والواجهات الكاملة لمسافة أقصر (الشيدر الكامل أغلى حاجة في البكسل)
      // (هامش 25م: من غير كده المربع اللي على الحد بيقلب رايح جاي = العمارات "بتتجدد" قدامك)
      const hy = (on, R) => d < R - (on ? -25 : 25);
      // كل العمارات اللي باينة بكامل جودتها (الواطية في الجودة الواطية بس)
      const lowT = this.tier === 'low';
      T.detail.visible = hy(T.detail.visible, lowT ? 300 : 1e5);
      if (T.bld) { T._hi = hy(T._hi, lowT ? 320 : 1e5); T.bld.material = T._hi ? this.mats.bld : this.mats.bldLow; }
      T.group.visible = d < viewDist + 200;
    }
    this.stats.tilesLoaded = [...this.tiles.values()].filter((t) => t.ready).length;
  }

  _loadTile(w) {
    const layers = this.meta.tiles[w.name];
    const T = { k: w.k, i: w.i, j: w.j, name: w.name, ready: false, dead: false, group: new THREE.Group(), detail: new THREE.Group(), colKeys: [], deckKeys: [], nB: 0 };
    T.group.name = w.name; T.group.add(T.detail);
    this.tiles.set(w.k, T);
    Promise.all(layers.map((L) => loadJSON(`${this.base}${L}/${w.name}.json`).then((d) => [L, d]))).then((arr) => {
      if (T.dead) return;
      const D = Object.fromEntries(arr);
      // كل طبقة شغلانة لوحدها (البناء متوزع على كذا فريم)
      const job = (label, f) => { f.label = label; this.queue.push(f); };
      // الطرق على 4 دفعات (أسفلت/رصيف+حرف/علامات/كباري): كانت شغلانة واحدة ~40 مللي على موبايل متوسط
      if (D.roads) for (const part of ['asphalt', 'sidewalk', 'marks', 'decks']) job('roads-' + part, () => !T.dead && this._buildRoads(T, D.roads, part));
      if (D.water) job('water', () => !T.dead && this._buildWater(T, D.water));
      if (D.railways) job('rail', () => !T.dead && this._buildRail(T, D.railways));
      if (D.buildings) job('buildings', () => !T.dead && this._buildBuildings(T, D.buildings));
      this.queue.push(() => {
        if (T.dead) return;
        T.ready = true;
        this.group.add(T.group);
        // المربع ثابت: المصفوفات بتتحسب مرة واحدة (مش كل فريم لكل شكل جوه المربع)
        T.group.updateMatrixWorld(true); T.group.matrixAutoUpdate = false; T.group.matrixWorldAutoUpdate = false;
      });
    }).catch((e) => { console.warn('[Shibin] tile', w.name, e); this.tiles.delete(w.k); });
  }

  _unloadTile(T) {
    T.dead = true;
    // ملفات المربع مش محتاجينها في الذاكرة بعد ما اتشال (لو رجعنا بنحمّلها تاني — الكاش بتاع المتصفح بيخليها سريعة)
    for (const L of this.meta.tiles[T.name] || []) dropCache(`${this.base}${L}/${T.name}.json`);
    this._removeTileColliders(T);
    for (const [k, s] of T.deckKeys) { const a = this.deckGrid.get(k); if (a) { const j = a.indexOf(s); if (j >= 0) a.splice(j, 1); if (!a.length) this.deckGrid.delete(k); } }
    T.group.removeFromParent();
    T.group.traverse((o) => {
      if (!o.geometry) return;
      // الصندوق المشترك بتاع العمارات مايتمسحش: بنفصل الـ attributes المشتركة الأول وبعدين نمسح الخاصة بالمربع
      if (o.userData.sharedGeo) { o.dispose(); return; } // إكسسوارات العمارات: الـ geometry مشتركة بين كل المربعات
      if (o.isInstancedMesh) {
        const g = o.geometry;
        for (const n of ['position', 'normal', 'aFace']) g.deleteAttribute(n);
        g.setIndex(null); g.dispose(); o.dispose();
      } else o.geometry.dispose();
    });
    this.stats.buildings -= T.nB;
    this.kitRoof?.removeTag(T.name); this.kitAC?.removeTag(T.name); this.streetKit?.removeTile(T.name);
  }

  // ---------- الطرق ----------
  _buildRoads(T, R, part = null) {
    const M = this.M, all = !part;
    if ((all || part === 'asphalt') && R.asphalt) {
      const g = flatGeo(R.asphalt.v, R.asphalt.i, 0, 1 / 7, [0.92, 0.92, 0.92]);
      const m = new THREE.Mesh(g, this.mats.asphalt); m.receiveShadow = true; m.name = 'asphalt';
      T.group.add(m);
    }
    if ((all || part === 'asphalt') && R.foot) { const m = new THREE.Mesh(flatGeo(R.foot.v, R.foot.i, 0.03, 1 / 4), this.mats.foot); m.receiveShadow = true; T.group.add(m); }
    if ((all || part === 'sidewalk') && R.sidewalk) {
      const S = R.sidewalk;
      const m = new THREE.Mesh(flatGeo(S.v, S.i, SIDE_Y, 1 / 2, [0.86, 0.84, 0.8]), M.sidewalkTop); m.receiveShadow = true; m.name = 'sidewalk';
      T.group.add(m);
      const curb = curbGeo(S.rings, 0, SIDE_Y, T, this.TS);
      if (curb) { const c = new THREE.Mesh(curb, this.mats.curb); c.receiveShadow = true; T.detail.add(c); }
      T.sideGrid = triGrid(S.v, S.i, 6);
    }
    if ((all || part === 'marks') && R.marks?.length) {
      const g = marksGeo(R.marks);
      if (g) { const m = new THREE.Mesh(g, this.mats.paint); m.renderOrder = 1; T.detail.add(m); }
    }
    if ((all || part === 'decks') && R.decks?.length) this._buildDecks(T, R.decks);
  }

  _buildDecks(T, decks) {
    const M = this.M, pos = [], nor = [], uvs = [], col = [], idx = [], cpos = [], cnor = [], cidx = [], rpos = [], rnor = [], ridx = [];
    const pushQuad = (P, N, I, a, b, c, d, n) => { const k = P.length / 3; P.push(...a, ...b, ...c, ...d); for (let q = 0; q < 4; q++) N.push(...n); I.push(k, k + 1, k + 2, k, k + 2, k + 3); };
    for (const D of decks) {
      const p = D.p, n = p.length / 3, hw = D.w / 2;
      const L = [], Rr = [];
      for (let i = 0; i < n; i++) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
        let dx = p[b * 3] - p[a * 3], dz = p[b * 3 + 2] - p[a * 3 + 2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const rx = -dz, rz = dx;
        L.push([x - rx * hw, y, z - rz * hw]); Rr.push([x + rx * hw, y, z + rz * hw]);
        // قطع الكوبري للارتفاع
        if (i < n - 1) {
          const s = { ax: x, ay: y, az: z, bx: p[(i + 1) * 3], by: p[(i + 1) * 3 + 1], bz: p[(i + 1) * 3 + 2], hw: hw + 0.3 };
          const xs = [Math.floor((Math.min(s.ax, s.bx) - hw) / 20), Math.floor((Math.max(s.ax, s.bx) + hw) / 20)];
          const zs = [Math.floor((Math.min(s.az, s.bz) - hw) / 20), Math.floor((Math.max(s.az, s.bz) + hw) / 20)];
          void xs; void zs; // (ارتفاع الكباري للفيزيا بقى من خط الشبكة نفسه — _buildRamps)
          // سور الكوبري (تصادم للي فوقه بس)
          const segL = Math.hypot(s.bx - s.ax, s.bz - s.az), ang = Math.atan2(s.bx - s.ax, s.bz - s.az), ym = Math.min(s.ay, s.by);
          if (ym > 0.6) for (const sd of [-1, 1]) {
            // السور ده جوه سطح كوبري تاني (اتجاهين قريبين من بعض في OSM)؟ → مايتحطش (كان بيقفل الحارة)
            const px = (s.ax + s.bx) / 2 + rx * (hw + 0.15) * sd, pz = (s.az + s.bz) / 2 + rz * (hw + 0.15) * sd;
            if (this._insideOtherDeck(px, pz, ym, D.edge)) continue;
            // المطلع الواطي (ردم مقفول، تحت 4.3م): السور بيقفل كمان على العربيات اللي على الأرض جنبه
            // (كانت بتعدّي جوه جنب المطلع) — إلا لو مكان السور على أسفلت شارع أرضي (التفريعة: مانقفلش حارته)
            const solid = ym < 4.3 && !this._groundRoadNearer(px, pz, Infinity, null) && !this._onOtherDeck(px, pz, D.edge);
            this._addCollider({ cx: px, cz: pz, hx: 0.15, hz: segL / 2 + 0.2, angle: ang, restitution: 0.2, kind: 'edge', yMin: solid ? -2 : ym - 0.9, yMax: Math.max(s.ay, s.by) + 1.2 }, T);
          }
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const l0 = L[i], l1 = L[i + 1], r0 = Rr[i], r1 = Rr[i + 1];
        // السطح (أسفلت)
        const k = pos.length / 3;
        pos.push(...l0, ...r0, ...r1, ...l1);
        for (let q = 0; q < 4; q++) { nor.push(0, 1, 0); col.push(0.92, 0.92, 0.92); }
        uvs.push(l0[0] / 7, l0[2] / 7, r0[0] / 7, r0[2] / 7, r1[0] / 7, r1[2] / 7, l1[0] / 7, l1[2] / 7);
        // وش السطح لفوق (اتجاه الخط مش معروف مسبقًا)
        const cr = (r0[0] - l0[0]) * (r1[2] - l0[2]) - (r0[2] - l0[2]) * (r1[0] - l0[0]);
        if (cr > 0) idx.push(k, k + 2, k + 1, k, k + 3, k + 2); else idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
        // الجناب + السور + تحت
        const dn = (v, dy) => [v[0], v[1] + dy, v[2]];
        const sx = r0[0] - l0[0], sz = r0[2] - l0[2], sl = Math.hypot(sx, sz) || 1;
        const nl = [-sx / sl, 0, -sz / sl], nr = [sx / sl, 0, sz / sl];
        if (Math.max(l0[1], l1[1]) > 0.4) {
          // السور اللي جوه سطح كوبري تاني (مطلع بيتفرّع/بيعدّي جنبه) مايتبنيش — كان بيخرق الكوبري التاني
          const ym = (l0[1] + l1[1]) / 2;
          const inL = this._insideOtherDeck((l0[0] + l1[0]) / 2, (l0[2] + l1[2]) / 2, ym, D.edge);
          const inR = this._insideOtherDeck((r0[0] + r1[0]) / 2, (r0[2] + r1[2]) / 2, ym, D.edge);
          // المطلع الواطي (لحد 4.2م): ردم بحيطان ساندة لحد الأرض (مش سطح طاير) — العالي: بلاطة 0.9م على عواميد
          // (مايتردمش لو فيه شارع أرضي معدّي تحته)
          // (الشوارع اللي بتقطع المطلع تحت 3.4م اتقفلت في الشبكة — _blockRampCrossings — فالردم بيكمّل عادي فوقها)
          const fill = Math.max(l0[1], l1[1]) < RAMP_FILL_H && !(ym > 3.4 && this._groundRoadUnder((l0[0] + r1[0]) / 2, (l0[2] + r1[2]) / 2, 0));
          const lowY = (v) => (fill ? [v[0], -0.1, v[2]] : dn(v, -0.9));
          if (!inL) pushQuad(cpos, cnor, cidx, lowY(l1), lowY(l0), dn(l0, 0.12), dn(l1, 0.12), nl);
          if (!inR) pushQuad(cpos, cnor, cidx, lowY(r0), lowY(r1), dn(r1, 0.12), dn(r0, 0.12), nr);
          if (!fill) pushQuad(cpos, cnor, cidx, dn(l0, -0.9), dn(l1, -0.9), dn(r1, -0.9), dn(r0, -0.9), [0, -1, 0]);
          // حاجز نيوجيرسي: الوش اللي برا قايم، واللي ناحية الأسفلت مايل (قاعدة 0.55م → راس 0.22م) + ماسورة حديد فوق
          const off = (v, nn, d) => [v[0] + nn[0] * d, v[1], v[2] + nn[2] * d];
          for (const [side, a0, a1, inward, out, skip] of [['L', l0, l1, nr, nl, inL], ['R', r1, r0, nl, nr, inR]]) {
            if (skip) continue;
            const b0 = off(a0, inward, 0.55), b1 = off(a1, inward, 0.55), m0 = off(a0, inward, 0.34), m1 = off(a1, inward, 0.34), t0 = off(a0, inward, 0.22), t1 = off(a1, inward, 0.22);
            pushQuad(cpos, cnor, cidx, dn(a1, 0.12), dn(a0, 0.12), dn(a0, 0.88), dn(a1, 0.88), out);                       // برا
            pushQuad(cpos, cnor, cidx, dn(b0, 0), dn(b1, 0), dn(m1, 0.3), dn(m0, 0.3), [inward[0] * 0.8, 0.6, inward[2] * 0.8]); // الميل التحتاني
            pushQuad(cpos, cnor, cidx, dn(m0, 0.3), dn(m1, 0.3), dn(t1, 0.88), dn(t0, 0.88), [inward[0] * 0.98, 0.15, inward[2] * 0.98]);
            pushQuad(cpos, cnor, cidx, dn(a0, 0.88), dn(t0, 0.88), dn(t1, 0.88), dn(a1, 0.88), [0, 1, 0]);                   // الراس
            // الماسورة: صندوق رفيع فوق نص الحاجز + قايم كل ~3م
            const c0 = off(a0, inward, 0.11), c1 = off(a1, inward, 0.11);
            const rq = (P, Q, h0, h1, wv) => { const w0 = off(P, out, wv), w1 = off(Q, out, wv), u0 = off(P, inward, wv), u1 = off(Q, inward, wv);
              pushQuad(rpos, rnor, ridx, dn(w1, h1), dn(w0, h1), dn(w0, h0), dn(w1, h0), out); pushQuad(rpos, rnor, ridx, dn(u0, h1), dn(u1, h1), dn(u1, h0), dn(u0, h0), inward);
              pushQuad(rpos, rnor, ridx, dn(w0, h0), dn(u0, h0), dn(u1, h0), dn(w1, h0), [0, 1, 0]); };
            rq(c0, c1, 1.16, 1.1, 0.035);
            const sl = Math.hypot(a1[0] - a0[0], a1[2] - a0[2]), np = Math.max(1, Math.round(sl / 3));
            for (let q = 0; q < np; q++) {
              const t = q / np, P = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
              const dx2 = (c1[0] - c0[0]) / (sl || 1) * 0.03, dz2 = (c1[2] - c0[2]) / (sl || 1) * 0.03;
              rq([P[0] - dx2, P[1], P[2] - dz2], [P[0] + dx2, P[1], P[2] + dz2], 1.1, 0.88, 0.025);
            }
            void side;
          }
          // تصادم الحيطة الساندة للي ماشي تحت جنب المطلع (العربيات اللي فوق السطح مش بتتأثر)
          if (fill && Math.min(l0[1], l1[1]) > 0.7) for (const [a0, a1, nn, skip] of [[l0, l1, nl, inL], [r0, r1, nr, inR]]) {
            if (skip) continue;
            const sl = Math.hypot(a1[0] - a0[0], a1[2] - a0[2]); if (sl < 0.5) continue;
            this._addCollider({ cx: (a0[0] + a1[0]) / 2 + nn[0] * 0.2, cz: (a0[2] + a1[2]) / 2 + nn[2] * 0.2, hx: 0.25, hz: sl / 2, angle: Math.atan2(a1[0] - a0[0], a1[2] - a0[2]), restitution: 0.15, kind: 'wall', yMax: Math.min(l0[1], l1[1]) - 0.6 }, T);
          }
        }
      }
      // عواميد تحت الكوبري كل ~24م
      let acc = 0;
      for (let i = 1; i < n; i++) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
        acc += Math.hypot(x - p[(i - 1) * 3], z - p[(i - 1) * 3 + 2]);
        if (acc < 24 || y < RAMP_FILL_H - 0.3) continue;
        const hh = y - 0.9, w = 1.0, cw = Math.min(D.w * 0.45, 3.2), capH = 1.1;
        const dx = x - p[(i - 1) * 3], dz = z - p[(i - 1) * 3 + 2], l = Math.hypot(dx, dz) || 1, ang = Math.atan2(dx / l, dz / l);
        if (this._groundRoadUnder(x, z, 1.2, [dx / l, dz / l])) continue; // مايتحطش عمود في نص شارع معدّي من تحت (يتأجل للنقطة اللي بعدها)
        acc = 0;
        // عمود T: جسم العمود + راس عرضها قد البلاطة تقريبًا (زي كباري مصر الخرسانة)
        for (const box of [
          new THREE.BoxGeometry(cw, hh - capH + 0.05, w).translate(0, (hh - capH) / 2, 0),
          new THREE.BoxGeometry(Math.min(D.w - 0.6, cw + 3.4), capH, w + 0.3).translate(0, hh - capH / 2, 0),
          new THREE.BoxGeometry(cw + 0.5, 0.25, w + 0.5).translate(0, 0.12, 0), // قاعدة
        ]) {
          const P2 = box.rotateY(ang).translate(x, 0, z).toNonIndexed();
          const base = cpos.length / 3;
          for (let q = 0; q < P2.attributes.position.count; q++) { cpos.push(P2.attributes.position.getX(q), P2.attributes.position.getY(q), P2.attributes.position.getZ(q)); cnor.push(P2.attributes.normal.getX(q), P2.attributes.normal.getY(q), P2.attributes.normal.getZ(q)); cidx.push(base + q); }
        }
        // العمود تحت: تصادم للي تحت الكوبري
        this._addCollider({ cx: x, cz: z, hx: (cw + 0.5) / 2, hz: (w + 0.5) / 2, angle: ang, restitution: 0.1, kind: 'prop', yMax: 1.5 }, T);
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, this.mats.asphalt); m.receiveShadow = true; m.castShadow = true; m.name = 'deck'; T.group.add(m);
    }
    if (cidx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(cnor, 3)); g.setIndex(cidx);
      const m = new THREE.Mesh(g, this.mats.concrete); m.castShadow = true; m.receiveShadow = true; m.name = 'deck-structure'; T.group.add(m);
    }
    if (ridx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(rnor, 3)); g.setIndex(ridx);
      const m = new THREE.Mesh(g, this.mats.steel); m.name = 'deck-rail'; T.detail.add(m);
    }
  }

  // ---------- الميه ----------
  _buildWater(T, W) {
    if (W.water) {
      // الترتيب مهم: المية والجناب → الفتحة (عمق بس) → الأرض وكل حاجة تانية
      const m = new THREE.Mesh(flatGeo(W.water.v, W.water.i, WATER_Y, 1 / 6), this.mats.water); m.name = 'water'; m.renderOrder = -3; m.receiveShadow = true; T.group.add(m);
      const bank = curbGeo(W.water.rings, WATER_FLOOR - 0.2, 0, T, this.TS);
      if (bank) { const b = new THREE.Mesh(bank, this.mats.bank); b.receiveShadow = true; b.renderOrder = -3; T.group.add(b); }
      const cut = new THREE.Mesh(flatGeo(W.water.v, W.water.i, 0.005, 1 / 6), this.mats.waterCut); cut.name = 'water-cut'; cut.renderOrder = -2; T.group.add(cut);
      T.waterGrid = triGrid(W.water.v, W.water.i, 6);
      // جناب الترعة: حاجز (للي على الأرض بس — اللي على الكوبري فوقها)
      for (const ring of W.water.rings) {
        for (let i = 0; i + 3 < ring.length; i += 2) {
          const ax = ring[i], az = ring[i + 1], bx = ring[i + 2], bz = ring[i + 3];
          if (onTileEdge(ax, az, bx, bz, T, this.TS)) continue;
          const L = Math.hypot(bx - ax, bz - az); if (L < 0.3) continue;
          // نقسمها حتت 2م، والحتة اللي تحت كوبري مالهاش حاجز (العربية فوقها بتعدي على الكوبري)
          const n = Math.max(1, Math.ceil(L / 2)), ang = Math.atan2(bx - ax, bz - az);
          for (let k = 0; k < n; k++) {
            const cx = ax + (bx - ax) * (k + 0.5) / n, cz = az + (bz - az) * (k + 0.5) / n;
            if (this._underDeck(cx, cz)) continue;
            this._addCollider({ cx, cz, hx: 0.2, hz: L / n / 2 + 0.05, angle: ang, restitution: 0.2, kind: 'edge', yMax: 0.45 }, T);
          }
        }
      }
    }
  }

  // ---------- السكة الحديد ----------
  _buildRail(T, Rl) {
    const bal = [], rails = [];
    for (const l of Rl.lines || []) {
      if (l.kind === 'disused') continue;
      ribbon(bal, l.p, 1.6, 0.04, 0.04);
      for (const o of [-0.72, 0.72]) ribbon(rails, offsetLine(l.p, o), 0.035, 0.16, 0.04, true);
    }
    if (bal.length) T.detail.add(meshFrom(bal, this.mats.ballast, true));
    if (rails.length) T.detail.add(meshFrom(rails, this.mats.rail, false));
    for (const pl of Rl.platforms || []) {
      const m = new THREE.Mesh(flatGeo(pl.v, pl.i, 0.8, 1 / 2, [0.8, 0.78, 0.74]), this.M.sidewalkTop); m.receiveShadow = true; T.group.add(m);
      const side = curbGeo(pl.rings, 0, 0.8, T, this.TS);
      if (side) T.group.add(new THREE.Mesh(side, this.mats.concrete));
    }
  }

  // ---------- العمارات ----------
  _buildBuildings(T, Bd) {
    // أماكن محجوزة (المحطة…): العمارات المولّدة اللي جواها بتتشال
    if (this.exclude?.length && Bd.gen?.length) Bd = { ...Bd, gen: Bd.gen.filter(([x, z, w, d]) => !this.exclude.some((r) => { const dx = x - r.cx, dz = z - r.cz, ca = Math.cos(r.angle), sa = Math.sin(r.angle); const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca; const m = Math.max(w, d) / 2; return Math.abs(lx) < r.hx + m && Math.abs(lz) < r.hz + m; })) };
    if (Bd.gen?.length) {
      const P = (this.stats.bldParts ||= { geo: 0, kit: 0, street: 0, col: 0, real: 0, n: 0 }); let t = performance.now();
      const lap = (k) => { const n = performance.now(); P[k] = Math.max(P[k], n - t); t = n; };
      const { mesh, colliders } = buildTileBuildings(Bd.gen, this.mats.bld);
      T.group.add(mesh); T.bld = mesh; T.nB = Bd.gen.length; lap('geo');
      // خزانات/دشات/أوض سلم/تكييفات: بتترسم للعمارات القريبة من الكاميرا بس (instancing واحد لكل نوع)
      const kit = tileKitItems(Bd.gen);
      for (const [x, y, z, yaw] of kit.roofs) this.kitRoof.add(x, y, z, yaw, 1, 1, T.name);
      if (!this.low) for (const [x, y, z, yaw] of kit.acs) this.kitAC.add(x, y, z, yaw, 1, 1, T.name);
      lap('kit');
      this.streetKit?.addTile(T.name, Bd.gen); lap('street');
      for (const c of colliders) this._addCollider(c, T);
      lap('col'); P.n = Math.max(P.n, Bd.gen.length);
      this.stats.buildings += T.nB;
    }
    for (const rb of Bd.real || []) {
      // مبنى OSM حقيقي: واجهة حسب نوعه + يافطة باسمه (المحطة/المدارس/المولات…)
      const { group } = styledRealBuilding(rb, this);
      T.group.add(group);
      if (rb.kind === 'train_station') this.rail?.realStationLoaded?.(rb);
      // التصادم: صناديق صغيرة على حيطان المضلع
      for (const ring of rb.rings) for (let i = 0; i + 3 < ring.length; i += 2) {
        const ax = ring[i], az = ring[i + 1], bx = ring[i + 2], bz = ring[i + 3], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.3) continue;
        this._addCollider({ cx: (ax + bx) / 2, cz: (az + bz) / 2, hx: 0.3, hz: L / 2, angle: Math.atan2(bx - ax, bz - az), restitution: 0.1, kind: 'building' }, T);
      }
    }
  }

  // ===================== أماكن على الطريق =====================
  /** أقرب نقطة على طريق عربيات + اتجاهه */
  nearestRoad(x, z, maxR = 300) {
    let best = null;
    for (const e of edgesNear(this.graph, x, z, Math.min(maxR, 120))) {
      if (e.closed) continue;
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i], b = e.pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
        const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(x - px, z - pz);
        if (!best || d < best.d) best = { e, i, t, x: px, z: pz, y: a.y + (b.y - a.y) * t, d, dx: ex / Math.sqrt(l2), dz: ez / Math.sqrt(l2), s: e.cum[i] + Math.sqrt(l2) * t };
      }
    }
    return best;
  }

  /** وضع العربية على حارتها اليمين (في اتجاه fwd لو ينفع) */
  roadPose(x, z, fx = 0, fz = 0) {
    const p = this.nearestRoad(x, z);
    if (!p) return null;
    let dir = fx * p.dx + fz * p.dz >= 0 ? 1 : -1;
    if (p.e.oneway) dir = 1;
    const dx = p.dx * dir, dz = p.dz * dir;
    // الحارة اليمين: يمين اتجاه السير = (-dz, dx)
    const off = p.e.oneway ? Math.min(1.6, p.e.half * 0.4) : Math.min(1.9, p.e.half * 0.5);
    const rx = -dz, rz = dx;
    return { x: p.x + rx * off, z: p.z + rz * off, y: p.y, yaw: Math.atan2(-dx, -dz), edge: p.e };
  }

  /** مكان البداية: جنب محطة القطر (من OSM) على الطريق */
  spawnPose() {
    const st = this.landmarks.confirmed.find((l) => l.id === 'station_shibin') || { x: 0, z: 0 };
    const lp = this.landmarkPoints.find((l) => l.id === 'station_shibin');
    const p = this.roadPose(lp ? lp.rx : st.x, lp ? lp.rz : st.z);
    return p || { x: 0, z: 0, yaw: 0 };
  }

  /** اسم الشارع اللي إنت عليه (من OSM بس — الشارع اللي مالوش اسم بيرجع '') */
  streetAt(x, z) {
    const p = this.nearestRoad(x, z, 40);
    if (!p || p.d > p.e.half + 4) return null;
    return { name: p.e.name, edge: p.e };
  }

  /** نقط كاميرا السينما (شاشة البداية): فوق الشوارع الرئيسية الحقيقية */
  cinePoints() {
    const out = [];
    const big = this.graph.edges.filter((e) => ['primary', 'secondary', 'tertiary'].includes(e.cls) && e.length > 60 && !e.elevated);
    const sp = this.spawnPose();
    big.sort((a, b) => Math.hypot(a.pts[0].x - sp.x, a.pts[0].z - sp.z) - Math.hypot(b.pts[0].x - sp.x, b.pts[0].z - sp.z));
    for (const e of big.slice(0, 14)) {
      const q = edgePoint(e, e.length / 2);
      const k = out.length % 2 ? 1 : -1;
      out.push(new THREE.Vector3(q.x - q.dz * k * (e.half + 1.2), 8 + (out.length % 3) * 4, q.z + q.dx * k * (e.half + 1.2)));
    }
    return out;
  }

  /** بيانات الخريطة الصغيرة (الطرق الحقيقية + الترع + السكة + المعالم + البوابات) */
  minimapData() {
    const MAJOR = new Set(['primary', 'trunk', 'secondary', 'motorway']);
    const roads = [];
    for (const e of this.graph.edges) {
      if (e.closed) continue;
      const p = [];
      for (const q of e.pts) p.push(q.x, q.z);
      roads.push({ p, w: e.width, major: MAJOR.has(e.cls.replace('_link', '')) });
    }
    roads.sort((a, b) => a.w - b.w);
    const byName = new Map();
    for (const e of this.graph.edges) {
      if (!e.name || e.closed) continue;
      const t = byName.get(e.name) || { len: 0, best: null };
      t.len += e.length; if (!t.best || e.length > t.best.length) t.best = e;
      byName.set(e.name, t);
    }
    const streetLabels = [...byName.entries()].sort((a, b) => b[1].len - a[1].len).slice(0, 40).map(([name, t]) => {
      const q = edgePoint(t.best, t.best.length / 2);
      return { name, x: q.x, z: q.z };
    });
    return {
      bbox: this.region.bbox_local, boundary: this.region.polygon, roads,
      water: this._mmWater, rail: this._mmRail, gates: this.region.gates, streetLabels,
      landmarks: this.landmarkPoints.map((l) => ({ name: l.name, x: l.x, z: l.z })),
    };
  }
}

// ===================== مساعدات الهندسة =====================
function tileDist(x, z, i, j, TS) {
  const dx = Math.max(i * TS - x, 0, x - (i + 1) * TS), dz = Math.max(j * TS - z, 0, z - (j + 1) * TS);
  return Math.hypot(dx, dz);
}

/** مثلثات مسطحة (x,z) على ارتفاع y + uv عالمي + لون اختياري */
function flatGeo(v, ix, y, uvScale, color) {
  const n = v.length / 2, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = v[i * 2]; pos[i * 3 + 1] = y; pos[i * 3 + 2] = v[i * 2 + 1];
    uv[i * 2] = v[i * 2] * uvScale; uv[i * 2 + 1] = v[i * 2 + 1] * uvScale;
    nor[i * 3 + 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (color) { const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set(color, i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
  // earcut بيطلع المثلثات بأي اتجاه: نخليها كلها وشها لفوق
  const I = n > 65535 ? new Uint32Array(ix.length) : new Uint16Array(ix.length);
  for (let k = 0; k < ix.length; k += 3) {
    const a = ix[k], b = ix[k + 1], c = ix[k + 2];
    const cross = (v[b * 2] - v[a * 2]) * (v[c * 2 + 1] - v[a * 2 + 1]) - (v[b * 2 + 1] - v[a * 2 + 1]) * (v[c * 2] - v[a * 2]);
    if (cross > 0) { I[k] = a; I[k + 1] = c; I[k + 2] = b; } else { I[k] = a; I[k + 1] = b; I[k + 2] = c; }
  }
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  return g;
}

function onTileEdge(ax, az, bx, bz, T, TS) {
  const e = 0.05;
  const x0 = T.i * TS, x1 = (T.i + 1) * TS, z0 = T.j * TS, z1 = (T.j + 1) * TS;
  return (Math.abs(ax - bx) < e && (Math.abs(ax - x0) < e || Math.abs(ax - x1) < e)) || (Math.abs(az - bz) < e && (Math.abs(az - z0) < e || Math.abs(az - z1) < e));
}

/** حيطان رأسية على حواف المضلعات (حرف الرصيف / جناب الترعة) — مش على حدود المربع */
function curbGeo(rings, y0, y1, T, TS, both = false) {
  const pos = [], nor = [], uv = [], idx = [];
  for (const r of rings) {
    for (let i = 0; i + 3 < r.length; i += 2) {
      const ax = r[i], az = r[i + 1], bx = r[i + 2], bz = r[i + 3];
      if (onTileEdge(ax, az, bx, bz, T, TS)) continue;
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.02) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      const k = pos.length / 3;
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      for (let q = 0; q < 4; q++) nor.push(nx, 0, nz);
      uv.push(0, 0, L, 0, L, 1, 0, 1);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      if (both) idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // حلقات earcut ممكن تبقى باتجاهين: نخلي الحيطة تترسم من الناحيتين
  return g;
}

/** علامات الطريق: متقطعة (3م خط / 5م فاضي) أو متصلة */
function marksGeo(marks) {
  const pos = [], idx = [];
  const W = 0.07;
  for (const m of marks) {
    const p = m.p, solid = m.s === 1, dash = m.t === 'c' ? 3 : 2.5, gap = m.t === 'c' ? 5 : 6;
    let acc = 0, on = true, left = dash;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L, rx = -dz * W, rz = dx * W;
      let s = 0;
      while (s < L) {
        const step = solid ? L - s : Math.min(left, L - s);
        if (on || solid) {
          const x0 = ax + dx * s, z0 = az + dz * s, x1 = ax + dx * (s + step), z1 = az + dz * (s + step);
          const k = pos.length / 3;
          pos.push(x0 - rx, 0.02, z0 - rz, x0 + rx, 0.02, z0 + rz, x1 + rx, 0.02, z1 + rz, x1 - rx, 0.02, z1 - rz);
          idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
        }
        s += step; left -= step;
        if (left <= 1e-6 && !solid) { on = !on; left = on ? dash : gap; }
      }
      acc += L;
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = pos.length / 3, nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { nor[i * 3 + 1] = 1; uv[i * 2] = pos[i * 3] * 0.25; uv[i * 2 + 1] = pos[i * 3 + 2] * 0.25; }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function offsetLine(p, o) {
  const out = [], n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = p[b * 2] - p[a * 2], dz = p[b * 2 + 1] - p[a * 2 + 1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    out.push(p[i * 2] - dz * o, p[i * 2 + 1] + dx * o);
  }
  return out;
}

/** شريط (عرض hw*2) على ارتفاع y، ولو box=true بجناب (للقضبان) */
function ribbon(out, p, hw, y, h, box = false) {
  const n = p.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const rx = -(bz - az) / L * hw, rz = (bx - ax) / L * hw;
    out.push([ax - rx, y, az - rz], [ax + rx, y, az + rz], [bx + rx, y, bz + rz], [bx - rx, y, bz - rz], [0, 1, 0]);
    if (box) {
      const y0 = y - h;
      out.push([ax + rx, y0, az + rz], [bx + rx, y0, bz + rz], [bx + rx, y, bz + rz], [ax + rx, y, az + rz], [rx / hw, 0, rz / hw]);
      out.push([bx - rx, y0, bz - rz], [ax - rx, y0, az - rz], [ax - rx, y, az - rz], [bx - rx, y, bz - rz], [-rx / hw, 0, -rz / hw]);
    }
  }
}

function meshFrom(quads, mat, receive) {
  const n = quads.length / 5, pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), idx = [];
  for (let q = 0; q < n; q++) {
    const N = quads[q * 5 + 4];
    for (let k = 0; k < 4; k++) { pos.set(quads[q * 5 + k], q * 12 + k * 3); nor.set(N, q * 12 + k * 3); }
    const b = q * 4; idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = receive;
  return m;
}

/** شبكة مثلثات للسؤال السريع "النقطة دي جوه الرصيف/الميه؟" */
function triGrid(v, ix, C) {
  const grid = new Map();
  for (let k = 0; k < ix.length; k += 3) {
    const a = ix[k] * 2, b = ix[k + 1] * 2, c = ix[k + 2] * 2;
    // مثلث مساحته صفر (شريحة من التقريب): كان بيتحسب "جوه" لأي نقطة على خطه = مطب مخفي 15سم في نص الحارة
    if (Math.abs((v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[b + 1] - v[a + 1]) * (v[c] - v[a])) < 0.02) continue;
    const x0 = Math.floor(Math.min(v[a], v[b], v[c]) / C), x1 = Math.floor(Math.max(v[a], v[b], v[c]) / C);
    const z0 = Math.floor(Math.min(v[a + 1], v[b + 1], v[c + 1]) / C), z1 = Math.floor(Math.max(v[a + 1], v[b + 1], v[c + 1]) / C);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const key = i * 100003 + j; let arr = grid.get(key); if (!arr) grid.set(key, (arr = [])); arr.push(k);
    }
  }
  return { grid, v, ix, C };
}

function inTriGrid(G, x, z) {
  const arr = G.grid.get(Math.floor(x / G.C) * 100003 + Math.floor(z / G.C));
  if (!arr) return false;
  const v = G.v, ix = G.ix;
  for (const k of arr) {
    const a = ix[k] * 2, b = ix[k + 1] * 2, c = ix[k + 2] * 2;
    const d1 = (x - v[b]) * (v[a + 1] - v[b + 1]) - (v[a] - v[b]) * (z - v[b + 1]);
    const d2 = (x - v[c]) * (v[b + 1] - v[c + 1]) - (v[b] - v[c]) * (z - v[c + 1]);
    const d3 = (x - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (z - v[a + 1]);
    const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return true;
  }
  return false;
}

void _v;
