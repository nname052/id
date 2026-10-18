import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// السماء + الشمس + الضباب + إضاءة البيئة (IBL)
// النظام جاهز لأوقات مختلفة: day / sunset / night  (اضغط T في اللعبة)
// ومتغير wetness (0..1) لتجهيز الشوارع المبلولة والمطر لاحقًا.

export const TIME_PRESETS = {
  day: {
    // شمس الدلتا: سما فيها شبورة/تراب خفيف (مش أزرق صافي)، ضباب بيج دافي، والإضاءة المحيطة أقل شوية عشان الضل يبان
    label: 'نهار', elevation: 52, azimuth: 135, sunColor: 0xffecd2, sunIntensity: 3.5, hemi: 0.3,
    turbidity: 6.5, rayleigh: 1.5, mie: 0.006, mieG: 0.82, fog: 0xcfc7b6, fogNear: 70, fogFar: 540, exposure: 0.55,
    lampsOn: false, windows: 0, envIntensity: 0.7,
  },
  sunset: {
    label: 'غروب', elevation: 6, azimuth: 250, sunColor: 0xffa860, sunIntensity: 2.4, hemi: 0.25,
    turbidity: 10, rayleigh: 2.6, mie: 0.01, mieG: 0.88, fog: 0xc89878, fogNear: 50, fogFar: 420, exposure: 0.75,
    lampsOn: true, windows: 0.35, envIntensity: 0.8,
  },
  night: {
    label: 'ليل', elevation: 30, azimuth: 60, sunColor: 0x8aa0d0, sunIntensity: 0.22, hemi: 0.13,
    turbidity: 2, rayleigh: 0.2, mie: 0.002, mieG: 0.7, fog: 0x10141e, fogNear: 30, fogFar: 300, exposure: 1.35,
    lampsOn: true, windows: 1.0, envIntensity: 0.2, night: true,
  },
};

export class Environment {
  constructor(renderer, scene, materials) {
    this.renderer = renderer;
    this.scene = scene;
    this.materials = materials;
    this.wetness = 0;
    this.listeners = [];

    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -60; cam.right = 60; cam.top = 60; cam.bottom = -60; cam.near = 1; cam.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6a5a48, 0.3);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog(0xc9ccc8, 70, 520);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.envRT = null;
    // نجوم وقمر بالليل
    {
      const n = 1400, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random(), v = Math.random() * 0.48 + 0.02;
        const th = u * Math.PI * 2, ph = Math.acos(1 - v * 2) ;
        const r = 1800;
        pos[i * 3] = Math.sin(ph) * Math.cos(th) * r; pos[i * 3 + 1] = Math.cos(ph) * r; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
      this.stars.visible = false;
      scene.add(this.stars);
      this.moon = new THREE.Mesh(new THREE.SphereGeometry(40, 20, 12), new THREE.MeshBasicMaterial({ color: 0xf2f0e2, fog: false }));
      this.moon.visible = false;
      scene.add(this.moon);
    }
    this.sunDir = new THREE.Vector3();
    this.setPreset('day');
  }

  setPreset(name) {
    const p = TIME_PRESETS[name];
    this.presetName = name;
    this.preset = p;
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    for (const sky of [this.sky, this.envSky]) {
      const u = sky.material.uniforms;
      u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mie; u.mieDirectionalG.value = p.mieG;
      u.sunPosition.value.copy(this.sunDir);
    }
    this.sky.visible = !p.night;
    if (this.stars) { this.stars.visible = !!p.night; this.moon.visible = !!p.night; }
    this.scene.background = p.night ? new THREE.Color(0x05070c) : null;
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.intensity = p.hemi;
    this.scene.fog.color.set(p.fog);
    this.scene.fog.near = p.fogNear; this.scene.fog.far = p.fogFar;
    this.renderer.toneMappingExposure = p.exposure;

    // إضاءة البيئة (انعكاسات الزجاج والعربيات) من السماء نفسها
    if (this.envRT) this.envRT.dispose();
    if (p.night) {
      const s = new THREE.Scene();
      s.background = new THREE.Color(0x101420);
      this.envRT = this.pmrem.fromScene(s, 0.04);
    } else {
      this.envRT = this.pmrem.fromScene(this.envScene, 0.02);
    }
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = p.envIntensity;

    const M = this.materials;
    for (const m of [M.facadePlaster, M.facadeBrick]) m.emissiveIntensity = p.windows * 0.9;
    M.signs.emissiveIntensity = p.night ? 0.9 : p.lampsOn ? 0.4 : 0.05;
    M.shop.emissiveIntensity = p.night ? 1.0 : p.lampsOn ? 0.5 : 0.15;
    M.lampGlass.emissiveIntensity = p.lampsOn ? 6 : 0;
    this.setWetness(this.wetness);
    for (const f of this.listeners) f(p);
  }

  cycle() {
    const keys = Object.keys(TIME_PRESETS);
    this.setPreset(keys[(keys.indexOf(this.presetName) + 1) % keys.length]);
    return this.preset.label;
  }

  /** تجهيز للمطر: 0 = ناشف، 1 = مبلول (الأسفلت يلمع ويغمق) */
  setWetness(w) {
    this.wetness = w;
    const a = this.materials.asphalt;
    a.roughness = 1 - 0.75 * w;
    a.color.setScalar(1 - 0.35 * w);
    this.materials.sidewalkTop.roughness = 0.92 - 0.5 * w;
  }

  /** الضل بيتبع اللاعب عشان دقته تفضل عالية */
  update(focus) {
    const d = 120;
    this.sun.position.set(focus.x + this.sunDir.x * d, focus.y + this.sunDir.y * d, focus.z + this.sunDir.z * d);
    this.sun.target.position.copy(focus);
    if (this.stars && this.stars.visible) { this.stars.position.copy(focus); this.moon.position.copy(focus).addScaledVector(this.sunDir, 1600); }
    // تثبيت الضل على بكسلات الـ shadow map لتقليل الرعشة
    this.sun.target.updateMatrixWorld();
  }
}
