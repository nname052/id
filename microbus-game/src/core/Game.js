import * as THREE from 'three';
import { createMaterials } from '../render/materials.js';
import { Environment } from '../world/Environment.js';
import { buildStreet } from '../world/Street.js';
import { buildBuildings } from '../world/Buildings.js';
import { buildProps, LAMP_POSITIONS, PROP_COLLIDERS } from '../world/Props.js';
import { TrafficLights } from '../world/TrafficLights.js';
import { Pedestrians } from '../world/Pedestrians.js';
import { staticColliders } from '../world/layout.js';
import { PlayerVehicle } from '../vehicles/PlayerVehicle.js';
import { buildCar } from '../vehicles/CarModels.js';
import { TrafficSystem, loopProject, loopAt } from '../traffic/TrafficSystem.js';
import { RouteWorld } from '../world/RouteWorld.js';
import { ZONE_LABEL } from '../world/Route.js';
import { surfaceAt } from '../world/ground.js';
import { sideRoadAt } from '../world/RoadNetwork.js';
import { CameraSystem, CAMERA_MODES } from '../camera/CameraSystem.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { AssetManager, applyTextureOverrides } from '../assets/AssetManager.js';
import { Input } from './Input.js';
import { HUD } from '../ui/HUD.js';
import { Diagnostics } from '../ui/Diagnostics.js';
import { Settings } from '../ui/Settings.js';
import { MirrorInsets } from '../ui/MirrorInsets.js';
import { Passengers } from '../gameplay/Passengers.js';
import { TouchControls, isTouchDevice } from '../ui/TouchControls.js';

const FIXED_DT = 1 / 120;
import { sampleAt } from '../world/Route.js';
const sampleZoneName = (s) => sampleAt(s - 450).zone;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

if (import.meta.env.DEV) window.__THREE = THREE; // للتجربة بس

export class Game {
  constructor(container, status) {
    this.container = container;
    this.status = status;
    this.started = false;
  }

  async init() {
    const S = this.status;
    this.diag = new Diagnostics();
    S('تحميل الخطوط العربية...', 0.05);
    await Promise.all(['Lalezar', 'Rakkas', 'Lemonada', 'El Messiri', 'Aref Ruqaa', 'Cairo'].map((f) => document.fonts.load(`40px "${f}"`).catch(() => {})));

    S('البحث عن موديلات وخامات إضافية...', 0.1);
    this.assets = new AssetManager();
    await this.assets.loadAll();

    // ===== الرندر =====
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    this.mobile = isTouchDevice();
    this.basePR = Math.min(window.devicePixelRatio, this.mobile ? 1.25 : 1.5);
    renderer.setPixelRatio(this.basePR);
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
    if (this.mobile) {
      this.env.sun.shadow.mapSize.set(1024, 1024);
      const c = this.env.sun.shadow.camera; c.left = c.bottom = -38; c.right = c.top = 38; c.updateProjectionMatrix();
    }

    S('بناء الشارع...', 0.5);
    await nextFrame();
    this.scene.add(buildStreet(this.M));
    S('بناء العمارات والمحلات...', 0.6);
    await nextFrame();
    this.scene.add(buildBuildings(this.M, { low: this.mobile }));
    this.scene.add(buildProps(this.M));
    S('بناء الطرق: كوبري، ريف، قرية، صحرا، جبل...', 0.66);
    await nextFrame();
    this.route = new RouteWorld(this.M, { low: this.mobile });
    this.scene.add(this.route.group);
    this.route._mosque(104, 0, -168, -Math.PI / 2); // جامع آخر الشارع الشعبي
    this.lights = new TrafficLights();
    this.scene.add(this.lights.group);

    S('تجهيز الميكروباص...', 0.72);
    await nextFrame();
    this.audio = new AudioSystem(this.assets);
    this.player = new PlayerVehicle(this.scene, this.assets, { lowPower: this.mobile });
    if (this.player.glbIntegrated) this.diag.set('hiace', 'HIACE: LOADED', 'ok');
    else {
      this.diag.set('hiace', `HIACE: FAILED — ${this.player.hiaceError}`, 'bad');
      const f = document.createElement('div');
      f.id = 'hiace-fail';
      f.textContent = `HIACE: FAILED — ${this.player.hiaceError}`;
      document.body.appendChild(f);
    }
    this.player.lowPower = this.mobile;
    this._wirePhysics();

    S('المرور والمشاة...', 0.82);
    await nextFrame();
    this.traffic = new TrafficSystem(this.scene, this.lights, (type, color) => this._makeCar(type, color), this.audio, { perLane: this.mobile ? 9 : 13 });
    this.traffic.viewDist = this.mobile ? 260 : 360;
    this.peds = new Pedestrians(this.scene, this.assets, this.mobile ? 12 : 24);
    this.statics = staticColliders();
    // أعمدة النور والشجر والأكشاك في المدينة
    for (const p of PROP_COLLIDERS) this.statics.push({ cx: p.x, cz: p.z, hx: p.hx ?? p.r * 0.85, hz: p.hz ?? p.r * 0.85, angle: 0, restitution: 0.1, kind: p.kind || 'prop' });
    this._colliders = (box) => {
      const out = [];
      for (const s of this.statics) if (Math.abs(s.cx - box.cx) < s.hx + 8 && Math.abs(s.cz - box.cz) < s.hz + 8) out.push(s);
      this.route.queryColliders(box.cx, box.cz, out);
      this.traffic.colliders(box, out);
      return out;
    };

    this.input = new Input();
    if (this.mobile) { document.body.classList.add('touch'); this.touch = new TouchControls(); this.input.touch = this.touch; }
    this.hud = new HUD();
    this.settings = new Settings({ mobile: this.mobile });
    this.settings.mount(this.touch ? this.touch.root.querySelector('.t-top') : null);
    this.cams = new CameraSystem(this.camera, this.player, renderer.domElement);
    this.cams.settings = this.settings;
    this.mirrorInsets = new MirrorInsets(this.player, this.touch);
    this.passengers = new Passengers(this.scene, this.player, { hud: this.hud, audio: this.audio, settings: this.settings });
    this.passengers._updateHud();
    this.settings.onChange((k, v) => this._applySetting(k, v));
    if (this.player.damage) this.player.damage.onBreak = () => this.audio.glass();
    this.cams.mode = 3; // سينمائية ورا شاشة البداية

    // أنوار الشارع بالليل: عدد صغير من الأنوار بنحركها لأقرب أعمدة (أداء)
    this.lampLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffd8a0, 0, 26, 1.6);
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.env.listeners.push((p) => this._onTimeChange(p));

    S('تجهيز الشيدرز...', 0.92);
    await nextFrame();
    this.player.syncVisuals(0);
    this.cams.update(0.016);
    try { await renderer.compileAsync(this.scene, this.camera); } catch { /* مش مدعوم في كل المتصفحات */ }
    // تسخين: نلف الكاميرا على كل المناطق مرة (بالضلال) عشان مفيش تقطيع أول ما تشوف حاجة جديدة
    {
      const spots = [100, 300, 600, 900, 1150, 1400, 1700, 1950, 2200, 2400, 2700, 3000];
      const cam = this.camera, q = {};
      for (let i = 0; i < spots.length; i++) {
        S('تجهيز الشيدرز...', 0.92 + (0.07 * i) / spots.length);
        loopAt(spots[i], q);
        cam.position.set(q.x + q.rx * 14, q.y + 6, q.z + q.rz * 14);
        cam.lookAt(q.x, q.y, q.z);
        cam.updateMatrixWorld();
        this.env.update(new THREE.Vector3(q.x, q.y, q.z));
        this.route.updateVisibility(cam.position, 600);
        renderer.render(this.scene, cam);
        await nextFrame();
      }
      this.route.updateVisibility(this.player.rig.root.position, 600);
    }
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.lampTimer = 0;
    // الإعدادات المحفوظة
    for (const [k, v] of Object.entries(this.settings.values)) this._applySetting(k, v);
    renderer.setAnimationLoop(() => this._frame());
    S('جاهز!', 1);
  }

  // أحداث الفيزياء: خبطات (صوت + هزة كاميرا) — بتتوصل تاني لو الفيزياء اتعملت من جديد
  _wirePhysics() {
    const ph = this.player.physics;
    ph.onImpact = (v, px, pz, other, nx, nz) => {
      this.audio.impact(v); this.cams && (this.cams.shake = Math.min(1.5, v / 4));
      if (this.player.damage && nx !== undefined) this.player.damage.impact(px, ph.heave - ph.spec.cgHeight + 0.65, pz, nx, nz, v);
    };
    ph.onRollHit = (hit, corner) => {
      this.audio.impact(hit * 3); if (this.cams) this.cams.shake = Math.min(1.5, hit * 0.6);
      this.player.damage?.rollHit(hit, corner);
    };
    ph.onCurb = (rise, v) => {
      if (v < 1.5 || this._curbCd > 0) return;
      const k = Math.min(1, rise * v * 0.9);
      this._curbCd = 0.12;
      this.audio.curb(k);
      this._bumpCd = 0.2; // منكررش صوت المطب
      if (this.cams) this.cams.shake = Math.max(this.cams.shake, k * 0.9);
    };
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
    this.hud.toast(this.mobile ? 'امسك الدركسيون ولفّه، ودوس بنزين' : 'إنت دلوقتي في كرسي السواق — دوس W', 3);
  }

  /** جودة ديناميكية: لو الـ FPS نزل نقلل الدقة/الضلال/المرايات/مسافة الرؤية، ولو علي نرجّعها */
  _adaptQuality(dt) {
    if (!this.started) return;
    if (this.settings && this.settings.get('graphics') !== 'auto') { this.fps = this._fpsMeasure(dt) ?? this.fps; return; }
    const q = (this._q ||= { t: 0, frames: 0, level: 0, good: 0, cooldown: 3 });
    q.t += dt; q.frames++; q.cooldown -= dt;
    if (q.t < 1.5) return;
    const fps = q.frames / q.t;
    q.t = 0; q.frames = 0;
    this.fps = fps;
    const max = 4;
    if (q.cooldown <= 0 && q.level < max && (fps < 26 || (fps < 45 && q.level < 2))) {
      q.level++; q.cooldown = 3; q.good = 0; this._applyQuality(q.level, fps);
    } else if (fps > 57) {
      q.good += 1.5;
      if (q.good > 8 && q.level > 0) { q.level--; q.good = 0; q.cooldown = 4; this._applyQuality(q.level, fps); }
    } else q.good = 0;
  }

  _fpsMeasure(dt) {
    const m = (this._fm ||= { t: 0, n: 0 });
    m.t += dt; m.n++;
    if (m.t < 1.5) return undefined;
    const f = m.n / m.t; m.t = 0; m.n = 0; return f;
  }

  _applyQuality(level, fps) {
    const base = this.basePR;
    const pr = [base, base * 0.85, base * 0.72, base * 0.62, base * 0.55][level];
    this.renderer.setPixelRatio(pr);
    this._resize();
    const sh = level >= 2 ? 1024 : this.mobile ? 1024 : 2048;
    if (this.env.sun.shadow.mapSize.x !== sh) { this.env.sun.shadow.mapSize.set(sh, sh); this.env.sun.shadow.map?.dispose(); this.env.sun.shadow.map = null; }
    this.env.sun.castShadow = level < 4 && this.settings?.get('shadows') !== 'off';
    this.player.mirrorSkip = [0, 1, 2, 3, 5][level];
    this.traffic.viewDist = (this.mobile ? 260 : 360) * [1, 0.95, 0.85, 0.75, 0.65][level];
    this.viewDist = (this.mobile ? 380 : 560) * [1, 0.95, 0.85, 0.75, 0.65][level];
    this.scene.fog.far = Math.min(this.env.preset.fogFar, this.viewDist + 60);
    console.info('[Quality] مستوى', level, `pixelRatio ${pr.toFixed(2)}`, `(${fps.toFixed(0)} FPS)`);
  }

  /** للتجربة: انقل الميكروباص لمسافة s على المسار (0 = أول شارع المدينة) */
  teleport(s, off = 2.45) {
    const q = loopAt(s);
    this.player.physics.reset(q.x + q.rx * off, q.z + q.rz * off, Math.atan2(-q.dx, -q.dz));
    this.player._savePrev();
    this.cams.snap = true;
    return q.zone;
  }

  /** للتجربة: شغّل المحاكاة بسرعة من غير رسم (game.debugSim(3, {throttle:1})) */
  debugSim(seconds, input = {}) {
    const inp = { throttle: 0, brake: 0, steer: 0, handbrake: 0, actions: {}, ...input };
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) {
      this.player.beforeStep();
      this.player.physics.step(FIXED_DT, inp, this._colliders);
      if (i % 4 === 0) { this.lights.update(FIXED_DT * 4); this.traffic.update(FIXED_DT * 4, this.player, this.camera.position); }
      this.player.syncVisuals(FIXED_DT, 1);
    }
    const p = this.player.physics;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), kmh: +(p.speed * 3.6).toFixed(1), gear: p.gear, steerWheelDeg: Math.round(p.steeringWheelAngle * 57.3), yawDeg: Math.round(p.yaw * 57.3) };
  }

  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.mirrorInsets?.resize(window.innerWidth, window.innerHeight);
  }

  _onTimeChange(p) {
    const night = !!p.night;
    this.player.setNight(night || p.elevation < 8);
    this.traffic?.setNight(night || p.elevation < 8);
    this.touch?.setLights(this.player.headOn);
    // الأنوار دايمًا visible (الشدة بس بتتغير) عشان مفيش إعادة بناء شيدرز
    for (const l of this.lampLights) l.intensity = !p.lampsOn ? 0 : p.night ? 90 : 25;
    const hm = this.settings?.get('headlights');
    if (hm && hm !== 'auto') { this.player.setHeadlights(hm === 'on'); this.touch?.setLights(this.player.headOn); }
  }

  /** تطبيق إعداد (عند البداية ولما يتغير من اللوحة) */
  _applySetting(k, v) {
    switch (k) {
      case 'mirrorInsets': this.mirrorInsets.mode = v; break;
      case 'mirrorQuality': this.player.setMirrorQuality(v); break;
      case 'graphics': {
        const fixed = { low: 3, med: 2, high: 0 }[v];
        const q = (this._q ||= { t: 0, frames: 0, level: 0, good: 0, cooldown: 3 });
        if (fixed !== undefined) { q.level = fixed; this._applyQuality(fixed, this.fps || 0); }
        else q.cooldown = 2;
        break;
      }
      case 'shadows': this._applyQuality(this._q?.level || 0, this.fps || 0); break;
      case 'timeOfDay': if (this.env.presetName !== v) this.env.setPreset(v); break;
      case 'headlights':
        if (v === 'auto') this.player.setHeadlights(!!this.player._night); else this.player.setHeadlights(v === 'on');
        this.touch?.setLights(this.player.headOn);
        break;
      case 'masterVol': case 'engineVol': this.audio.setVolumes(this.settings.get('masterVol') / 100, this.settings.get('engineVol') / 100); break;
      case 'traffic': this.traffic.setDensity({ off: 0, low: 0.35, normal: 0.65, high: 1 }[v] ?? 0.65); break;
      default: break;
    }
  }

  _frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    const input = this.started ? this.input.read() : { throttle: 0, brake: 0, steer: 0, handbrake: 1, actions: {} };
    const a = input.actions;
    if (a.camera) this.hud.toast(`الكاميرا: ${this.cams.next()}`);
    if (a.reset) {
      const r = this.player.reset();
      this.hud.toast(r === 'recover' ? 'العربية اتعدلت' : 'رجعت للطريق واتصلّحت');
      this._flipNote = false; this.touch?.root.querySelector('[data-act="reset"]')?.classList.remove('lit');
    }
    if (a.time) { this.hud.toast(`الوقت: ${this.env.cycle()}`); this.settings.set('timeOfDay', this.env.presetName); }
    if (a.lights) { const on = !this.player.headOn; this.settings.set('headlights', on ? 'on' : 'off'); this.hud.toast(on ? 'الكشافات شغالة' : 'الكشافات مطفية'); }
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
    this._curbCd = Math.max(0, (this._curbCd || 0) - dt);
    // اتقلبت: رسالة + زرار الرجوع منوّر
    if (!ph.flip.mode && this._flipNote) { this._flipNote = false; this.touch?.root.querySelector('[data-act="reset"]')?.classList.remove('lit'); }
    if (ph.flip.mode && ph.flip.rest > 0.8 && !this._flipNote) {
      this._flipNote = true;
      this.hud.toast(this.mobile ? 'العربية اتقلبت! دوس زرار ↺ عشان تعدلها' : 'العربية اتقلبت! دوس R عشان تعدلها', 4);
      this.touch?.root.querySelector('[data-act="reset"]')?.classList.add('lit');
    }

    this.lights.update(dt);
    this.traffic.update(dt, this.player, this.camera.position);
    this.route.update(dt);
    this._visTimer = (this._visTimer || 0) - dt;
    if (this._visTimer <= 0) {
      this._visTimer = 0.25;
      this.route.updateVisibility(this.camera.position, this.viewDist || (this.mobile ? 380 : 560));
      this.player.surface = surfaceAt(ph.x, ph.z);
      // اسم المنطقة لما تدخلها
      // على طريق فرعي: اسمه، غير كده اسم المنطقة على الطريق الرئيسي
      const side = sideRoadAt(ph.x, ph.z);
      const onMain = surfaceAt(ph.x, ph.z) !== 'dirt' && !side;
      const pr = onMain || !side ? loopProject(ph.x, ph.z) : null;
      const zone = side ? `road:${side.id}` : pr && pr.d !== undefined && Math.abs(pr.d) > 25 ? this._zone : pr ? (pr.s < 450 ? 'city' : sampleZoneName(pr.s)) : null;
      const label = side ? side.name : ZONE_LABEL[zone] || zone;
      if (zone && zone !== this._zone && this.started) { if (this._zone) this.hud.toast(label, 2.5); this._zone = zone; }
    }
    this.player.syncVisuals(dt, this.acc / FIXED_DT);
    this.cams.update(dt, input);
    this.peds.update(dt, this.camera.position, this.player.physics);
    this.passengers.camPos = this.camera.position;
    if (this.started) this.passengers.update(dt, ph);
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
    this.audio.update(dt, { player: this.player, camera: this.camera, traffic: this.traffic, inside, horn: input.horn, passengers: this.passengers?.count });
    this.hud.update(dt, ph, this.lights);
    if (this.touch) this.touch.update(ph.steeringWheelAngle);

    if (inside) this.player.renderMirrors(this.renderer, this.scene, this.camera.position);
    this.diag.update(dt, this.player, inside);
    this.renderer.render(this.scene, this.camera);
    if (this.mirrorInsets.update(this.camera, inside && this.started)) this.mirrorInsets.render(this.renderer);
  }
}

export { CAMERA_MODES };
