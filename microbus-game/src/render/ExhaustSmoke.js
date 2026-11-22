// =====================================================================
//  دخان الشكمان: لما تدوس بنزين جامد (أكتر من 80%) العادم بيطلع دخان من الماسورة اللي ورا —
//  أكتر وأتقل على السرعة الواطية واللفّات العالية، ونفخة مع كل نقلة فتيس، ونفخة كبيرة لو دست وانت واقف.
//  الديزل (ميكروباص/نقل/أتوبيس/إسعاف) دخانه رمادي أغمق، البنزين أفتح، وعربية الجولف (كهربا) من غير دخان.
//  رسمة واحدة (Points + شيدر صغير): كل نفخة بتكبر وتبهت في ~1.5 ث وبتطلع لفوق وبتتأخر ورا العربية.
// =====================================================================
import * as THREE from 'three';

const DIESEL = new Set(['microbus', 'truck', 'bus', 'ambulance', 'pickup', 'police']);
const NONE = new Set(['golf']);

export class ExhaustSmoke {
  constructor(scene, { max = 160 } = {}) {
    this.max = max; this.n = 0; this.acc = 0; this._gear = null;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(99); this.life = new Float32Array(max).fill(1);
    this.size0 = new Float32Array(max); this.dark = new Float32Array(max);
    const g = (this.geo = new THREE.BufferGeometry());
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1); this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1); this.aAlpha.setUsage(THREE.DynamicDrawUsage);
    this.aDark = new THREE.BufferAttribute(this.dark, 1); this.aDark.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aSize', this.aSize); g.setAttribute('aAlpha', this.aAlpha); g.setAttribute('aDark', this.aDark);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aDark; varying float vA; varying float vD;
        uniform float uScale;
        void main() { vA = aAlpha; vD = aDark; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aAlpha > 0.001 ? aSize * uScale / max(0.5, -mv.z) : 0.0; }`,
      fragmentShader: `varying float vA; varying float vD;
        void main() { vec2 q = gl_PointCoord - 0.5; float d = length(q);
          float a = vA * smoothstep(0.5, 0.08, d) * (0.85 + 0.15 * sin(q.x * 17.0 + q.y * 11.0));
          if (a < 0.01) discard;
          vec3 c = mix(vec3(0.78, 0.77, 0.75), vec3(0.32, 0.31, 0.30), vD);
          gl_FragColor = vec4(c, a); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 2; this.points.name = 'exhaust-smoke';
    scene.add(this.points);
  }

  _emit(x, y, z, vx, vy, vz, size, life, dark) {
    const i = this.n++ % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size0[i] = size; this.dark[i] = dark;
  }

  /** كل فريم: الانبعاث من مكان الماسورة + تحريك النفخات */
  update(dt, player, input, camera, renderer) {
    const ph = player?.physics;
    if (camera && renderer) this.mat.uniforms.uScale.value = renderer.domElement.height * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    if (ph && !NONE.has(player.kind) && !ph.engineOff) {
      const thr = Math.max(0, input?.throttle || 0), v = Math.abs(ph.forwardSpeed || 0);
      const rpmK = ph.spec?.maxRpm ? Math.min(1, (ph.rpm || 0) / ph.spec.maxRpm) : 0.5;
      const diesel = DIESEL.has(player.kind);
      let rate = 0;
      if (thr > 0.8) rate = (diesel ? 26 : 14) * (0.35 + 0.65 * Math.max(0, 1 - v / 22)) * (0.6 + 0.6 * rpmK);
      // نقلة فتيس وانت دايس: نفخة
      if (this._gear !== null && ph.gear !== this._gear && thr > 0.5) this._burst = 0.18;
      this._gear = ph.gear;
      // دست جامد وانت واقف: نفخة كبيرة
      if (thr > 0.8 && v < 1.5 && !this._wasHard) this._burst = 0.35;
      this._wasHard = thr > 0.8;
      if (this._burst > 0) { rate += diesel ? 70 : 40; this._burst -= dt; }
      this.acc += rate * dt;
      if (this.acc >= 1) {
        const B = ph.getBox(), [fx, fz] = ph.forward, side = diesel ? 0.55 : -0.45;
        // الماسورة: آخر العربية، على جنب، واطية
        const ex = B.cx - fx * (B.hz + 0.05) + fz * side * B.hx, ez = B.cz - fz * (B.hz + 0.05) - fx * side * B.hx;
        const ey = (ph.heave - ph.spec.cgHeight) + 0.32;
        while (this.acc >= 1) {
          this.acc -= 1;
          const j = () => (Math.random() - 0.5) * 0.5;
          this._emit(ex + j() * 0.2, ey, ez + j() * 0.2,
            ph.vx * 0.35 - fx * 1.6 + j(), 0.45 + Math.random() * 0.35, ph.vz * 0.35 - fz * 1.6 + j(),
            0.22 + Math.random() * 0.12, 1.1 + Math.random() * 0.7, diesel ? 0.75 : 0.35);
        }
      }
    }
    // تحريك/تكبير/تبهيت
    const S = this.aSize.array, A = this.aAlpha.array;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { A[i] = 0; continue; }
      live++;
      const a = (this.age[i] += dt), k = a / this.life[i];
      const drag = Math.max(0, 1 - 2.2 * dt);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + 0.25 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      S[i] = this.size0[i] * (1 + k * 5.5);
      A[i] = 0.42 * (1 - k) * Math.min(1, a * 8);
    }
    this.live = live;
    this.points.visible = live > 0;
    if (live > 0 || this._wasLive) { this.aPos.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true; this.aDark.needsUpdate = true; }
    this._wasLive = live > 0;
  }
}
