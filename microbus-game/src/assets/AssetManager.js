import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
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
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.report = [];
  }

  url(folder, file) { return byName[`${folder}/${file}`]; }

  async loadAll(onProgress = () => {}) {
    const jobs = [];
    for (const [key, cfg] of Object.entries(MODEL_ASSETS)) {
      const url = this.url('models', cfg.file);
      if (!url) { this.report.push(`○ ${cfg.file}: مش موجود → Placeholder إجرائي`); continue; }
      jobs.push(this.loader.loadAsync(url).then((gltf) => {
        this.models[key] = this._wrap(key, cfg, gltf);
        this.report.push(`✓ ${cfg.file}`);
      }).catch((e) => { this.report.push(`✗ ${cfg.file}: ${e.message}`); }));
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

  get(key) { return this.models[key] || null; }

  _wrap(key, cfg, gltf) {
    const scene = gltf.scene;
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
