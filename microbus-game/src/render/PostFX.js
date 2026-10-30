// =====================================================================
//  مؤثرات بعد الرسم (الجودة العالية على الكمبيوتر — وتتقفل/تتفتح من الإعدادات):
//  - GTAO: ضل الأركان (تحت العربيات، بين البلكونات، حرف الرصيف) — أكبر فرق في الواقعية
//  - Bloom: لمعة الفوانيس والإعلانات بالليل (خفيفة جدًا بالنهار)
//  - تدريج ألوان: دفا خفيف (شمس مصر وتراب)، تباين وتشبع معتدلين، وفينييت خفيف على الأطراف
//  الـ tone mapping (ACES) والـ sRGB بيحصلوا في OutputPass (نفس شكل الرسم العادي بالظبط من غير المؤثرات)
// =====================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uWarm: { value: 0.06 }, uSat: { value: 1.08 }, uCon: { value: 1.06 }, uVig: { value: 0.22 }, uAspect: { value: 1.7 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uWarm, uSat, uCon, uVig, uAspect; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // (لسه linear HDR قبل الـ tone mapping)
      col *= vec3(1.0 + uWarm, 1.0 + uWarm * 0.35, 1.0 - uWarm * 0.6);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.18) * uCon + 0.18;
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      col *= 1.0 - uVig * smoothstep(0.45, 1.05, length(d));
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, { ao = true } = {}) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
    const C = (this.composer = new EffectComposer(renderer, rt));
    C.setPixelRatio(renderer.getPixelRatio());
    C.addPass(new RenderPass(scene, camera));
    if (ao) {
      const g = (this.ao = new GTAOPass(scene, camera, size.x, size.y));
      g.output = GTAOPass.OUTPUT.Default;
      g.blendIntensity = 0.85;
      g.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      C.addPass(g);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.12, 0.45, 0.92);
    C.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    C.addPass(this.grade);
    C.addPass(new OutputPass());
    this.setNight(false);
  }
  setNight(on) {
    this.bloom.strength = on ? 0.55 : 0.12;
    this.bloom.threshold = on ? 0.7 : 0.92;
    const U = this.grade.uniforms;
    U.uWarm.value = on ? -0.02 : 0.06; U.uSat.value = on ? 1.02 : 1.08; U.uVig.value = on ? 0.3 : 0.22;
  }
  setSize(w, h) { this.composer.setSize(w, h); this.grade.uniforms.uAspect.value = w / h; }
  setPixelRatio(pr) { this.composer.setPixelRatio(pr); }
  render(dt) { this.composer.render(dt); }
  dispose() { this.composer.dispose(); }
}
