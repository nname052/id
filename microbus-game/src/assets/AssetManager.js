import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MODEL_ASSETS, TEXTURE_ASSETS, AUDIO_ASSETS } from '../config/assets.config.js';

// بيدور على الملفات اللي إنت حاطتها في فولدر assets/ (وقت البناء)،
// فمفيش أي طلب لملف مش موجود → مفيش أخطاء 404 في الـ Console.
const FOUND = import.meta.glob('../../assets/**/*.{glb,GLB,jpg,jpeg,png,webp,mp3,ogg,wav,m4a}', { query: '?url', import: 'default', eager: true });

const byName = {};
for (const [path, url] of Object.entries(FOUND)) {
  const parts = path.split('/');
  byName[parts.slice(-2).join('/')] = url; // مثال: "models/microbus.glb"
}

export class AssetManager {
  constructor() {
    this.models = {};
    this.textures = {};
    this.audio = {};
    this.loader = new GLTFLoader();
    // صفحة الـ Artifact بتمنع fetch لـ blob:/data: → الصور اللي جوه الـ GLB نحملها كـ <img> عادي
    this.loader.register((parser) => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
      return { name: 'force_image_textures' };
    });
    this.report = [];
    this.status = {}; // للتشخيص على الشاشة: { microbus: { ok, error } }
  }

  url(folder, file) { return byName[`${folder}/${file}`]; }

  async loadAll(onProgress = () => {}) {
    const jobs = [];
    for (const [key, cfg] of Object.entries(MODEL_ASSETS)) {
      const url = this.url('models', cfg.file);
      if (!url) this.report.push(`○ ${cfg.file}: مش موجود → Placeholder إجرائي`);
      if (!url) { this.status[key] = { ok: false, error: `${cfg.file} not in build` }; continue; }
      jobs.push(this._loadGLB(url).then((gltf) => {
        this.models[key] = this._wrap(key, cfg, gltf);
        this.status[key] = { ok: true };
        this.report.push(`✓ ${cfg.file}`);
      }).catch((e) => {
        this.status[key] = { ok: false, error: `${cfg.file}: ${e?.message || e}` };
        this.report.push(`✗ ${cfg.file}: ${e?.message || e}`);
        console.error('[Assets]', cfg.file, e);
      }));
    }
    const tl = new THREE.TextureLoader();
    for (const [key, cfg] of Object.entries(TEXTURE_ASSETS)) {
      for (const slot of ['map', 'normalMap', 'roughnessMap']) {
        const url = this.url('textures', cfg[slot]);
        if (!url) continue;
        jobs.push(tl.loadAsync(url).then((t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 8;
          if (slot === 'map') t.colorSpace = THREE.SRGBColorSpace;
          (this.textures[key] ||= { metersPerTile: cfg.metersPerTile })[slot] = t;
          this.report.push(`✓ ${cfg[slot]}`);
        }).catch(() => {}));
      }
    }
    for (const [key, file] of Object.entries(AUDIO_ASSETS)) {
      const url = this.url('audio', file);
      if (url) this.audio[key] = url;
    }
    let done = 0;
    jobs.forEach((j) => j.then(() => onProgress(++done / jobs.length)));
    await Promise.all(jobs);
    console.info('[Assets]\n' + this.report.join('\n'));
  }

  // الـ GLB مدموج في الـ JS كـ data: URI → نفكه بإيدنا من غير fetch (الـ CSP بتاع الـ Artifact ممكن يمنعه)
  async _loadGLB(url) {
    let buf;
    if (url.startsWith('data:')) {
      const b64 = url.slice(url.indexOf(',') + 1);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      buf = bytes.buffer;
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      buf = await res.arrayBuffer();
    }
    return this.loader.parseAsync(buf, '');
  }

  get(key) { return this.models[key] || null; }

  _wrap(key, cfg, gltf) {
    let scene = gltf.scene;
    // موديلات Sketchfab/Source بتيجي Skinned: نخبز الهيكل في Mesh عادي (أخف وأسهل في التحريك)
    if (!gltf.animations.length) scene = bakeSkinned(scene);
    scene.rotation.y = THREE.MathUtils.degToRad(cfg.rotationY || 0);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    let scale = 1;
    if (cfg.targetLength) scale = cfg.targetLength / Math.max(size.x, size.z);
    if (cfg.targetHeight) scale = cfg.targetHeight / size.y;
    const holder = new THREE.Group();
    holder.add(scene);
    scene.scale.multiplyScalar(scale);
    scene.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(scene);
    const c = b2.getCenter(new THREE.Vector3());
    scene.position.x -= c.x; scene.position.z -= c.z; scene.position.y -= b2.min.y;
    if (cfg.offset) { scene.position.x += cfg.offset[0]; scene.position.y += cfg.offset[1]; scene.position.z += cfg.offset[2]; }
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return {
      key, cfg, holder, animations: gltf.animations,
      /** نسخة جديدة من الموديل (للمرور والمشاة) */
      instantiate: (R = Math.random) => {
        const root = SkeletonUtils.clone(holder);
        let mixer = null;
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(root);
          const clip = gltf.animations.find((a) => /walk/i.test(a.name)) || gltf.animations[0];
          const action = mixer.clipAction(clip);
          action.time = R() * clip.duration;
          action.play();
        }
        return { root, mixer };
      },
    };
  }
}

/** يطبّق الخامات الحقيقية لو موجودة */
export function applyTextureOverrides(assets, M) {
  const apply = (mat, t) => {
    if (!t) return;
    const rep = 1;
    for (const slot of ['map', 'normalMap', 'roughnessMap']) {
      if (t[slot]) { t[slot].repeat.set(rep, rep); mat[slot] = t[slot]; }
    }
    mat.needsUpdate = true;
  };
  apply(M.asphalt, assets.textures.asphalt);
  apply(M.sidewalkTop, assets.textures.sidewalk);
}

/** يحوّل كل SkinnedMesh لـ Mesh ثابت بنفس الشكل بالظبط (bind pose) في إحداثيات الموديل */
export function bakeSkinned(root) {
  root.updateMatrixWorld(true);
  let any = false;
  root.traverse((o) => { if (o.isSkinnedMesh) any = true; });
  if (!any) return root;
  const out = new THREE.Group();
  out.name = root.name || 'baked';
  const v = new THREE.Vector3(), n = new THREE.Vector3(), p2 = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    const pos = src.attributes.position, nor = src.attributes.normal;
    const P = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3);
    nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) {
        if (nor) { n.fromBufferAttribute(nor, i); p2.copy(v).addScaledVector(n, 0.01); o.applyBoneTransform(i, p2); }
        o.applyBoneTransform(i, v);
        if (nor) n.subVectors(p2, v).normalize();
      } else if (nor) n.fromBufferAttribute(nor, i);
      v.applyMatrix4(o.matrixWorld);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      if (nor) { if (!o.isSkinnedMesh) n.applyMatrix3(nm); n.normalize(); N[i * 3] = n.x; N[i * 3 + 1] = n.y; N[i * 3 + 2] = n.z; }
    }
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    if (nor) g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); else g.computeVertexNormals();
    for (const k of ['uv', 'uv1', 'color']) if (src.attributes[k]) g.setAttribute(k, src.attributes[k]);
    if (src.index) g.setIndex(src.index);
    // تصحيح اتجاه المثلثات: كل مثلث لازم وشه يبص في نفس اتجاه الـ normals بتاعة الموديل
    // (الموديلات اللي خامتها DoubleSide غالبًا فيها مثلثات مقلوبة)
    if (g.index && nor) fixWinding(g);
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, o.material);
    m.name = o.name;
    m.userData.matName = o.material?.name || '';
    out.add(m);
  });
  return out;
}

function fixWinding(g) {
  const idx = g.index.array.slice(), P = g.attributes.position.array, N = g.attributes.normal.array;
  let flipped = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = N[a] + N[b] + N[c], ny = N[a + 1] + N[b + 1] + N[c + 1], nz = N[a + 2] + N[b + 2] + N[c + 2];
    if (fx * nx + fy * ny + fz * nz < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; flipped++; }
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.userData.flipped = flipped;
}
