import * as THREE from 'three';
import { createMaterials } from '../render/materials.js';
import { Environment } from '../world/Environment.js';
import { buildStreet } from '../world/Street.js';
import { buildBuildings } from '../world/Buildings.js';
import { buildProps, LAMP_POSITIONS } from '../world/Props.js';
import { TrafficLights } from '../world/TrafficLights.js';
import { Pedestrians } from '../world/Pedestrians.js';
import { staticColliders } from '../world/layout.js';
import { PlayerVehicle } from '../vehicles/PlayerVehicle.js';
import { buildCar } from '../vehicles/CarModels.js';
import { TrafficSystem } from '../traffic/TrafficSystem.js';
import { CameraSystem, CAMERA_MODES } from '../camera/CameraSystem.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { AssetManager, applyTextureOverrides } from '../assets/AssetManager.js';
import { Input } from './Input.js';
import { HUD } from '../ui/HUD.js';
import { TouchControls, isTouchDevice } from '../ui/TouchControls.js';

const FIXED_DT = 1 / 120;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  constructor(container, status) {
    this.container = container;
    this.status = status;
    this.started = false;
  }

  async init() {
    const S = this.status;
    S('تحميل الخطوط العربية...', 0.05);
    await Promise.all(['Lalezar', 'Rakkas', 'Lemonada', 'El Messiri', 'Aref Ruqaa', 'Cairo'].map((f) => document.fonts.load(`40px "${f}"`).catch(() => {})));

    S('البحث عن موديلات وخامات إضافية...', 0.1);
    this.assets = new AssetManager();
    await this.assets.loadAll();

    // ===== الرندر =====
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    this.mobile = isTouchDevice();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.mobile ? 1 : 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1200);
    window.addEventListener('resize', () => this._resize());

    S('توليد خامات الأسفلت والعمارات...', 0.2);
    await nextFrame();
    this.M = createMaterials();
    applyTextureOverrides(this.assets, this.M);

    S('السما والشمس...', 0.4);
    await nextFrame();
    this.env = new Environment(renderer, this.scene, this.M);
    if (this.mobile) this.env.sun.shadow.mapSize.set(1024, 1024);

    S('بناء الشارع...', 0.5);
    await nextFrame();
    this.scene.add(buildStreet(this.M));
    S('بناء العمارات والمحلات...', 0.6);
    await nextFrame();
    this.scene.add(buildBuildings(this.M));
    this.scene.add(buildProps(this.M));
    this.lights = new TrafficLights();
    this.scene.add(this.lights.group);

    S('تجهيز الميكروباص...', 0.72);
    await nextFrame();
    this.audio = new AudioSystem(this.assets);
    this.player = new PlayerVehicle(this.scene, this.assets);
    this.player.lowPower = this.mobile;
    this.player.physics.onImpact = (v) => { this.audio.impact(v); this.cams.shake = Math.min(1.5, v / 4); };

    S('المرور والمشاة...', 0.82);
    await nextFrame();
    this.traffic = new TrafficSystem(this.scene, this.lights, (type, color) => this._makeCar(type, color), this.audio);
    this.peds = new Pedestrians(this.scene, this.assets);
    this.statics = staticColliders();
    this._colliders = (box) => {
      const out = [];
      for (const s of this.statics) out.push(s);
      this.traffic.colliders(box, out);
      return out;
    };

    this.input = new Input();
    if (this.mobile) { document.body.classList.add('touch'); this.touch = new TouchControls(); this.input.touch = this.touch; }
    this.hud = new HUD();
    this.cams = new CameraSystem(this.camera, this.player, renderer.domElement);
    this.cams.mode = 3; // سينمائية ورا شاشة البداية

    // أنوار الشارع بالليل: عدد صغير من الأنوار بنحركها لأقرب أعمدة (أداء)
    this.lampLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffd8a0, 0, 26, 1.6);
      l.visible = false;
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.env.listeners.push((p) => this._onTimeChange(p));

    S('تجهيز الشيدرز...', 0.92);
    await nextFrame();
    this.player.syncVisuals(0);
    this.cams.update(0.016);
    try { await renderer.compileAsync(this.scene, this.camera); } catch { /* مش مدعوم في كل المتصفحات */ }
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.lampTimer = 0;
    renderer.setAnimationLoop(() => this._frame());
    S('جاهز!', 1);
  }

  _makeCar(type, color) {
    const map = { sedan: 'car_sedan', boxy: 'car_old', taxi: 'car_taxi', microbus: 'microbus_traffic' };
    const a = this.assets.get(map[type]);
    if (a) {
      const { root } = a.instantiate();
      const wrap = new THREE.Group();
      wrap.add(root);
      return { root: wrap, body: root, wheels: [], length: a.cfg.targetLength, width: 1.8, brake: null };
    }
    return buildCar(type, color);
  }

  async start() {
    await this.audio.start();
    this.started = true;
    this.cams.mode = 0;
    this.cams.snap = true;
    this.hud.show();
    if (this.touch) { this.touch.show(); document.getElementById('help').classList.add('hidden'); this.hud.helpTimer = 0; }
    if (this.mobile) document.documentElement.requestFullscreen?.().catch(() => {});
    this.hud.toast(this.mobile ? 'دوس بنزين واسحب الدركسيون' : 'إنت دلوقتي في كرسي السواق — دوس W', 3);
  }

  /** جودة تلقائية: لو الجهاز ضعيف (FPS قليل) نقلل الدقة والضلال */
  _adaptQuality(dt) {
    if (!this.started) return;
    const q = (this._q ||= { t: 0, frames: 0, level: 0, cooldown: 4 });
    q.t += dt; q.frames++;
    q.cooldown -= dt;
    if (q.t < 3) return;
    const fps = q.frames / q.t;
    q.t = 0; q.frames = 0;
    if (fps < 40 && q.cooldown <= 0 && q.level < 2) {
      q.level++;
      q.cooldown = 4;
      if (q.level === 1) this.renderer.setPixelRatio(1);
      if (q.level === 2) {
        this.renderer.setPixelRatio(0.8);
        this.env.sun.shadow.mapSize.set(1024, 1024);
        this.env.sun.shadow.map?.dispose();
        this.env.sun.shadow.map = null;
      }
      this._resize();
      console.info('[Quality] تقليل الجودة تلقائيًا → مستوى', q.level, `(${fps.toFixed(0)} FPS)`);
    }
  }

  /** للتجربة: شغّل المحاكاة بسرعة من غير رسم (game.debugSim(3, {throttle:1})) */
  debugSim(seconds, input = {}) {
    const inp = { throttle: 0, brake: 0, steer: 0, handbrake: 0, actions: {}, ...input };
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) {
      this.player.beforeStep();
      this.player.physics.step(FIXED_DT, inp, this._colliders);
      if (i % 4 === 0) { this.lights.update(FIXED_DT * 4); this.traffic.update(FIXED_DT * 4, this.player); }
      this.player.syncVisuals(FIXED_DT, 1);
    }
    const p = this.player.physics;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), kmh: +(p.speed * 3.6).toFixed(1), gear: p.gear, steerWheelDeg: Math.round(p.steeringWheelAngle * 57.3), yawDeg: Math.round(p.yaw * 57.3) };
  }

  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _onTimeChange(p) {
    const night = !!p.night;
    this.player.setNight(night || p.elevation < 8);
    for (const l of this.lampLights) { l.visible = p.lampsOn; l.intensity = p.night ? 90 : 25; }
  }

  _frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    const input = this.started ? this.input.read() : { throttle: 0, brake: 0, steer: 0, handbrake: 1, actions: {} };
    const a = input.actions;
    if (a.camera) this.hud.toast(`الكاميرا: ${this.cams.next()}`);
    if (a.reset) { this.player.reset(); this.hud.toast('رجعت للطريق'); }
    if (a.time) this.hud.toast(`الوقت: ${this.env.cycle()}`);
    if (a.help) this.hud.toggleHelp();
    if (a.fps) this.hud.toggleFps();
    if (a.mute) this.hud.toast(this.audio.toggleMute() ? 'الصوت مقفول' : 'الصوت شغال');

    // ===== الفيزياء بخطوة ثابتة =====
    this.acc += dt;
    let steps = 0;
    const ph = this.player.physics;
    while (this.acc >= FIXED_DT && steps < 8) {
      this.player.beforeStep();
      ph.step(FIXED_DT, input, this._colliders);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === 8) this.acc = 0;
    // صوت المطبات
    let bump = 0;
    for (const w of ph.wheels) bump = Math.max(bump, w.compressionVel);
    if (bump > 0.35 && !this._bumpCd) { this.audio.thump(bump * 0.5); this._bumpCd = 0.15; }
    this._bumpCd = Math.max(0, (this._bumpCd || 0) - dt);

    this.lights.update(dt);
    this.traffic.update(dt, this.player);
    this.player.syncVisuals(dt, this.acc / FIXED_DT);
    this.cams.update(dt, input);
    this.peds.update(dt, this.camera.position);
    this.env.update(this.player.rig.root.position);

    // أقرب أعمدة نور بالليل
    this.lampTimer -= dt;
    if (this.lampTimer <= 0 && this.env.preset.lampsOn) {
      this.lampTimer = 0.4;
      const c = this.camera.position;
      const near = [...LAMP_POSITIONS].sort((p1, p2) => p1.distanceToSquared(c) - p2.distanceToSquared(c)).slice(0, this.lampLights.length);
      near.forEach((p, i) => this.lampLights[i].position.copy(p));
    }

    this._adaptQuality(dt);
    const inside = this.cams.modeId === 'cockpit';
    this.audio.update(dt, { player: this.player, camera: this.camera, traffic: this.traffic, inside, horn: input.horn });
    this.hud.update(dt, ph, this.lights);
    if (this.touch) this.touch.setWheelAngle(ph.steeringWheelAngle);

    if (inside) this.player.renderMirrors(this.renderer, this.scene, this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}

export { CAMERA_MODES };
