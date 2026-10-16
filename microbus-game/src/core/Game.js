import * as THREE from 'three';
import { createMaterials } from '../render/materials.js';
import { Environment } from '../world/Environment.js';
import { buildStreet } from '../world/Street.js';
import { buildBuildings } from '../world/Buildings.js';
import { buildProps, LAMP_POSITIONS, PROP_COLLIDERS } from '../world/Props.js';
import { TrafficLights } from '../world/TrafficLights.js';
import { Crowd } from '../world/Crowd.js';
import { addDriver } from '../world/Pedestrians.js';
import { applyLivery } from '../vehicles/Livery.js';
import { bakeTrafficVersion } from '../vehicles/ModelFit.js';
import { buildSedan } from '../vehicles/SedanModel.js';
import { staticColliders } from '../world/layout.js';
import { PlayerVehicle } from '../vehicles/PlayerVehicle.js';
import { buildCar } from '../vehicles/CarModels.js';
import { buildTrafficHiace } from '../vehicles/TrafficHiace.js';
import { TERMINAL_VANS } from '../world/Shibin.js';
import { groundHeight } from '../world/ground.js';
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
import { Wallet } from '../gameplay/Wallet.js';
import { FuelSystem } from '../gameplay/Fuel.js';
import { Licenses } from '../gameplay/Licenses.js';
import { Police } from '../gameplay/Police.js';
import { Incidents } from '../gameplay/Incidents.js';
import { Race } from '../gameplay/Race.js';
import { buildRaceTrack } from '../world/RaceTrack.js';
import { buildFootbridge } from '../world/Footbridge.js';
import { buildPetrolStation, STATION, atPump } from '../world/PetrolStation.js';
import { Docs } from '../ui/Docs.js';
import { Navigator, fmtDist } from '../nav/Navigator.js';
import { Multiplayer } from '../net/Multiplayer.js';
import { MiniMap } from '../ui/MiniMap.js';
import { setGroundProvider } from '../world/ground.js';
import { setGraph, findRoute } from '../nav/RoadGraph.js';
import { ShibinWorld } from '../world/shibin/ShibinWorld.js';
import { showLinePicker } from '../ui/LinePicker.js';
import { Radio } from '../audio/Radio.js';
import { ShibinTraffic } from '../world/shibin/ShibinTraffic.js';
import { ShibinCrowd } from '../world/shibin/ShibinCrowd.js';
import { attachJobs } from '../world/shibin/ShibinJobs.js';
import { TouchControls, isTouchDevice } from '../ui/TouchControls.js';

const FIXED_DT = 1 / 120;
/** مستوى الجودة من الإعدادات المحفوظة: التلقائي = متوسطة على الموبايل وعالية على الكمبيوتر */
function resolveTier(v, mobile) { return ['low', 'med', 'high', 'ultra'].includes(v) ? v : mobile ? 'med' : 'high'; }
import { sampleAt } from '../world/Route.js';
const sampleZoneName = (s) => sampleAt(s - 450).zone;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

if (import.meta.env.DEV) window.__THREE = THREE; // للتجربة بس

export class Game {
  constructor(container, status, { map = 'current' } = {}) {
    this.container = container;
    this.status = status;
    this.started = false;
    // الخريطة: 'current' = الخريطة القديمة، 'shibin' = شبين الكوم الحقيقية (OpenStreetMap)
    this.mapId = map === 'shibin' ? 'shibin' : 'current';
  }

  async init() {
    const S = this.status;
    this._initT0 = performance.now();
    this.diag = new Diagnostics();
    S('تحميل الخطوط العربية...', 0.05);
    await Promise.all(['Lalezar', 'Rakkas', 'Lemonada', 'El Messiri', 'Aref Ruqaa', 'Cairo'].map((f) => document.fonts.load(`40px "${f}"`).catch(() => {})));

    S('البحث عن موديلات وخامات إضافية...', 0.1);
    this.assets = new AssetManager();
    await this.assets.loadAll();

    // ===== الرندر =====
    // مستوى الجودة بيتحدد قبل إنشاء الرندر (الـ MSAA ونوع الضل مينفعش يتغيروا بعد كده)
    this.mobile = isTouchDevice();
    const saved = (() => { try { return JSON.parse(localStorage.getItem('egy-microbus-settings-v1') || '{}'); } catch { return {}; } })();
    this.tier = resolveTier(saved.graphics, this.mobile);
    // الموبايل: من غير MSAA في الواطية/المتوسطة (أكبر توفير لحرارة كارت الشاشة بعد الدقة)
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: !this.mobile || this.tier === 'high' || this.tier === 'ultra', powerPreference: this.mobile ? 'default' : 'high-performance' }));
    this.basePR = Math.min(window.devicePixelRatio, this.mobile ? 1.25 : 1.5);
    renderer.setPixelRatio(this.basePR);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = this.mobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
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

    if (this.mapId === 'shibin') {
      // ===== شبين الكوم الحقيقية: المربعات بتتحمل حوالين اللاعب، والأرض والـ GPS من نفس البيانات =====
      const t0 = performance.now();
      this.world = await new ShibinWorld(this.M, { low: this.mobile }).init(S);
      this.scene.add(this.world.group);
      this.route = this.world;
      setGroundProvider(this.world);
      setGraph(this.world.graph);
      attachJobs(this.world, findRoute);
      PlayerVehicle.world = this.world;
      this.raceTrack = null;
      this.lights = new TrafficLights(); // (الإشارات بتاعة الخريطة القديمة مش بتترسم هنا)
      this.loadInfo = { worldMs: Math.round(performance.now() - t0) };
    } else {
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
      // حلبة السباق (غرب البلد)
      this.raceTrack = buildRaceTrack(this.M);
      this.scene.add(this.raceTrack.group);
      this.lights = new TrafficLights();
      this.scene.add(this.lights.group);
    }

    S('تجهيز الميكروباص...', 0.72);
    await nextFrame();
    this.audio = new AudioSystem(this.assets);
    this.settings = new Settings({ mobile: this.mobile });
    this.audio.engineKind = this.settings.get('vehicle');
    this.player = new PlayerVehicle(this.scene, this.assets, { lowPower: this.mobile, kind: this.settings.get('vehicle') });
    if (this.player.kind !== 'microbus') this.diag.set('hiace', `VEHICLE: ${this.player.kind.toUpperCase()}`, 'ok');
    else if (this.player.glbIntegrated) this.diag.set('hiace', 'HIACE: LOADED', 'ok');
    else {
      this.diag.set('hiace', `HIACE: FAILED — ${this.player.hiaceError}`, 'bad');
      const f = document.createElement('div');
      f.id = 'hiace-fail';
      f.textContent = `HIACE: FAILED — ${this.player.hiaceError}`;
      document.body.appendChild(f);
    }
    this.player.lowPower = this.mobile;
    // كل العربيات بتتعمل مرة واحدة وبتتحفظ (تبديل العربية = تبديل جاهز، مش بناء من الأول)
    this.vehicles = { [this.player.kind]: this.player };
    this.insets = {};
    this._wirePhysics();

    S('المرور والمشاة...', 0.82);
    await nextFrame();
    if (this.world) {
      this.traffic = new ShibinTraffic(this.scene, (type, color, o) => this._makeCar(type, color, o), this.audio, this.world, { count: this.tier === 'low' ? 12 : this.mobile ? 16 : 28, parked: this.tier === 'low' ? 6 : this.mobile ? 8 : 16 });
      this.traffic.viewDist = this.mobile ? 150 : 190;
      this.crowdBase = this.mobile ? 70 : 130;
      this.crowd = new ShibinCrowd(this.scene, this.world, { count: this.crowdBase });
      this.crowd.traffic = this.traffic; this.traffic.crowd = this.crowd;
      this.statics = [];
    } else {
      this.traffic = new TrafficSystem(this.scene, this.lights, (type, color, o) => this._makeCar(type, color, o), this.audio, { perLane: this.mobile ? 11 : 16, sideMul: this.mobile ? 1.5 : 1 });
      this.traffic.viewDist = this.mobile ? 190 : 260;
      this.crowdBase = this.mobile ? 80 : 160;
      this.crowd = new Crowd(this.scene, { count: this.crowdBase, assets: this.assets });
      this.statics = staticColliders();
      // كوبري مشاة فوق الشارع الرئيسي
      { const fb = buildFootbridge(); this.scene.add(fb.group); this.statics.push(...fb.colliders); }
      // أعمدة النور والشجر والأكشاك في المدينة
      for (const p of PROP_COLLIDERS) this.statics.push({ cx: p.x, cz: p.z, hx: p.hx ?? p.r * 0.85, hz: p.hz ?? p.r * 0.85, angle: 0, restitution: 0.1, kind: p.kind || 'prop' });
    }
    const colOut = [];
    this._colliders = (box) => {
      const out = colOut; out.length = 0; // نفس المصفوفة كل مرة (مفيش garbage كل خطوة فيزيا)
      for (const s of this.statics) if (Math.abs(s.cx - box.cx) < s.hx + 8 && Math.abs(s.cz - box.cz) < s.hz + 8) out.push(s);
      this.route.queryColliders(box.cx, box.cz, out);
      this.traffic.colliders(box, out);
      this.mp?.colliders(box, out);
      this.incidents?.colliders(box, out);
      this.police?.colliders(box, out);
      this.raceTrack?.colliders(box, out);
      this.race?.colliders(box, out);
      return out;
    };

    this.input = new Input();
    if (this.mobile) { document.body.classList.add('touch'); this.touch = new TouchControls(); this.input.touch = this.touch; this.touch.maxWheel = this.player.physics.maxWheelAngle; }
    this.hud = new HUD();
    this.settings.mount(this.touch ? this.touch.root.querySelector('.t-top') : null);
    // الراديو (اختياري، من غير أي بث متضمن)
    this.radio = new Radio({ hud: this.hud, settings: this.settings });
    this.radio.mountSettings(this.settings.panel);
    this.settings.onChange((k, v) => { if (k === 'radioVol') this.radio.setVolume(v / 100); });
    this.cams = new CameraSystem(this.camera, this.player, renderer.domElement);
    this.cams.settings = this.settings;
    this.cams.colliders = this._colliders;
    this.mirrorInsets = this.insets[this.player.kind] = new MirrorInsets(this.player, this.touch);
    this.wallet = new Wallet(this.hud);
    this.nav = new Navigator();
    this.passengers = new Passengers(this.scene, this.player, { hud: this.hud, audio: this.audio, settings: this.settings, wallet: this.wallet, world: this.world || null });
    this.passengers._updateHud();
    this.hud.setMoney(this.wallet.balance);
    this.hud.onSwitchLine = () => (this.world ? this.openLinePicker() : this.passengers.cycleLine());
    // البنزين (تانك لكل عربية) + الرخص وأيام اللعبة + البنزينة + كماين المرور + لوحة المحفظة والرخص
    this.fuel = new FuelSystem({ hud: this.hud, wallet: this.wallet });
    this.fuel.attach(this.player);
    this.licenses = new Licenses({ wallet: this.wallet, hud: this.hud });
    // البنزينة بتاعة الخريطة القديمة (مفيش بنزينة مؤكدة في بيانات شبين → البنزين بالجركن بس هناك)
    this.station = this.world ? null : buildPetrolStation(this.scene);
    if (this.station) this.statics.push(...this.station.colliders);
    this.police = new Police(this.scene, { hud: this.hud, wallet: this.wallet, licenses: this.licenses, spots: this.world ? this.world.policeSpots : null });
    // أماكن محجوزة (محطات ركوب + كماين): مفيش عربيات مركونة فيها
    if (this.world) this.world.nearReserved = (x, z, r) =>
      this.passengers.stops.some((st) => (st.mx ?? st.x) - x < r + 8 && x - (st.mx ?? st.x) < r + 8 && Math.hypot((st.mx ?? st.x) - x, (st.mz ?? st.z) - z) < r + 8) ||
      (this.world.policeSpots || []).some((sp) => Math.hypot(sp.q.x - x, sp.q.z - z) < r + 40);
    this.incidents = new Incidents(this.scene, { hud: this.hud, wallet: this.wallet, licenses: this.licenses, passengers: this.passengers, audio: this.audio });
    // هروب من كمين → مطاردة من مكان عربية الكمين على شبكة الطرق
    this.police.onFlee = (c, x, z) => this.incidents.pursueFrom(x, z, this.player.physics, this.player.kind);
    this.incidents.onFinish = () => this.police.chaseOver();
    this.race = this.raceTrack ? new Race(this) : null;
    this.docs = new Docs(this, this.touch ? this.touch.root.querySelector('.t-top') : null);
    this.mp = new Multiplayer(this);
    this.minimap = new MiniMap(this);
    // ميكروباصات راكنة في موقف شبين الكوم
    {
      const a = this.assets.get('microbus_traffic');
      if (a && !this.world) for (const v of TERMINAL_VANS) {
        const r = buildTrafficHiace(a);
        r.root.position.set(v.x, groundHeight(v.x, v.z), v.z); r.root.rotation.y = v.yaw;
        this.scene.add(r.root);
        this.statics.push({ cx: v.x, cz: v.z, hx: r.width / 2, hz: r.length / 2, angle: v.yaw, restitution: 0.1, kind: 'parked' });
      }
    }
    this.settings.onChange((k, v) => this._applySetting(k, v));
    if (this.player.damage) this.player.damage.onBreak = () => this.audio.glass();
    this.cams.mode = 3; // سينمائية ورا شاشة البداية
    if (this.world) this.cams.cinePoints = this.world.cinePoints();

    // أنوار الشارع بالليل: عدد صغير من الأنوار بنحركها لأقرب أعمدة (أداء)
    // كل PointLight بيتحسب في كل بكسل لكل الخامات (حتى وهو مطفي بالنهار) → عدد قليل على حسب الجهاز.
    // شبين: النور الرئيسي مزيّف (لمبات منوّرة + بقع نور) والأنوار الحقيقية قليلة جنبك بس
    this.lampLights = [];
    const nLamps = this.tier === 'low' ? 0 : this.mobile ? (this.world ? 0 : 2) : this.world ? 3 : 6;
    for (let i = 0; i < nLamps; i++) {
      const l = new THREE.PointLight(0xffd8a0, 0, 26, 1.6);
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.env.listeners.push((p) => this._onTimeChange(p));

    // الإعدادات المحفوظة (قبل تجهيز الشيدرز: الضل والجودة بيغيروا نوع الشيدر المطلوب)
    for (const [k, v] of Object.entries(this.settings.values)) this._applySetting(k, v);
    // العربيات التانية بتتجهز دلوقتي (وقت التحميل) عشان التبديل في نص اللعب يبقى لحظي:
    // بنبنيهم مرة واحدة، ونجهز الشيدرز بتاعتهم بنفس عدد الأنوار (عربية واحدة في المشهد كل مرة)
    for (const kind of ['microbus', 'taxi', 'tuktuk']) {
      if (this.vehicles[kind]) continue;
      S('تجهيز العربيات...', 0.88);
      await nextFrame();
      const v = new PlayerVehicle(this.scene, this.assets, { lowPower: this.mobile, kind });
      v.lowPower = this.mobile;
      v.rig.root.removeFromParent();
      this.vehicles[kind] = v;
      this._applyLivery(v, this.settings.get('livery'));
    }
    this._applyLivery(this.player, this.settings.get('livery'));
    S('تجهيز الشيدرز...', 0.92);
    await nextFrame();
    // كل عربية: نسخة الشاشة + نسخة المرايات (الرسم جوه render target بيحتاج شيدر مختلف)
    const warmRT = new THREE.WebGLRenderTarget(64, 64), warmCam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    const warm = async (v) => {
      v.syncVisuals(0);
      // رسمة صغيرة مخفية للعربية من برا ومن جوه: بترفع الأشكال والصور على كارت الشاشة من دلوقتي
      const r = v.rig.root.position;
      for (const [dx, dy, dz] of [[6, 2.5, 6], [-6, 2, -6], [0, 1.4, 0]]) {
        warmCam.position.set(r.x + dx, r.y + dy, r.z + dz); warmCam.lookAt(r.x, r.y + 1, r.z); warmCam.updateMatrixWorld();
        renderer.setRenderTarget(warmRT); renderer.render(this.scene, warmCam);
      }
      renderer.setRenderTarget(null);
      try {
        await renderer.compileAsync(this.scene, this.camera);
        const rt = v.mirrorCams?.[0]?.rt;
        if (rt) { renderer.setRenderTarget(rt); await renderer.compileAsync(this.scene, this.camera); renderer.setRenderTarget(null); }
      } catch { renderer.setRenderTarget(null); }
    };
    for (const v of Object.values(this.vehicles)) {
      if (v === this.player) continue;
      this.player.rig.root.removeFromParent(); this.scene.add(v.rig.root);
      await warm(v);
      v.rig.root.removeFromParent(); this.scene.add(this.player.rig.root);
    }
    this.cams.update(0.016);
    await warm(this.player);
    warmRT.dispose();
    // تسخين: نلف الكاميرا على كل المناطق مرة (بالضلال) عشان مفيش تقطيع أول ما تشوف حاجة جديدة
    if (this.world) {
      // شبين: نحمّل المربعات اللي حوالين البداية كاملة قبل ما نبدأ (ومن غير تقطيع بعد كده)
      const sp = this.world.spawnPose(), cam = this.camera;
      cam.position.set(sp.x + 12, 10, sp.z + 12); cam.lookAt(sp.x, 0, sp.z); cam.updateMatrixWorld();
      for (let k = 0; k < 400 && (this.world.queue.length || this.world.stats.tilesLoaded < 4 || k < 3); k++) {
        S('تحميل شوارع شبين حواليك...', 0.92 + Math.min(0.07, k * 0.002));
        this.world.updateVisibility(cam.position, this.viewDist || 560);
        this.world.update(0.016);
        await nextFrame();
      }
      renderer.render(this.scene, cam);
      this.loadInfo.readyMs = Math.round(performance.now() - this._initT0);
    } else {
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
      // الحلبة (برا الطريق الدائري): رسمة واحدة عشان شيدرزها تتجهز من دلوقتي
      cam.position.set(-300, 60, 220); cam.lookAt(-410, 0, 60); cam.updateMatrixWorld();
      renderer.render(this.scene, cam);
      this.route.updateVisibility(this.player.rig.root.position, 600);
    }
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.lampTimer = 0;
    renderer.setAnimationLoop((t) => this._tick(t));
    S('جاهز!', 1);
  }

  // أحداث الفيزياء: خبطات (صوت + هزة كاميرا) — بتتوصل تاني لو الفيزياء اتعملت من جديد
  _wirePhysics() {
    const ph = this.player.physics;
    // الخبطة الواحدة بتطلع عشرات الأحداث (كل خطوة فيزيا وهي لازقة): بناخد أقوى واحدة بس،
    // والبعجة/الخدش بيتحسبوا بعد الفيزيا مرة واحدة (كانوا سبب اللاج وقت الخبط)
    ph.onImpact = (v, px, pz, other, nx, nz) => {
      const now = performance.now();
      const fresh = now - (this._hitT || 0) > 350;
      if (!fresh && v < (this._hitV || 0) * 1.6) return;
      this._hitT = now; this._hitV = v;
      this.audio.impact(v); this.cams && (this.cams.shake = Math.min(1.5, v / 4));
      // خبطة جامدة (≈ 30 كم/س في حاجة) → حادثة: الركاب بيخافوا والشرطة جاية (مش في السباق، ومش عربية الشرطة نفسها وهي بتطاردك)
      if (v >= 8.5 && this.started && !this.race?.active && other !== this.incidents?.col) this.incidents?.trigger('crash', ph, this.player.kind);
      if (this.player.damage && nx !== undefined && v >= 2.2) {
        const q = this._dmgQ;
        if (!q || v > q[5]) this._dmgQ = [px, ph.heave - ph.spec.cgHeight + 0.65, pz, nx, nz, v];
      }
    };
    ph.onRollHit = (hit, corner) => {
      // الانقلاب بيطلع خبطات كتير ورا بعض: صوت/ضرر مرة كل ربع ثانية بس
      const now = performance.now();
      if (now - (this._rollT || 0) < 250) return;
      this._rollT = now;
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

  _makeCar(type, color, opts = {}) {
    // المركونة: نسخة "مخبوزة" خفيفة (من غير سواق)
    if (opts.parked) return this._makeCarBody(type === 'taxi' || type === 'sedan' ? 'boxy' : type, color, opts);
    const rig = this._makeCarBody(type, color, opts);
    // كل عربية فيها سواق (قاعد على الشمال زي مصر)
    this._driverSeed = (this._driverSeed || 0) + 1;
    // (موديل الهاي إس بتاع المرور دركسيونه يمين، فالسواق قاعد قدامه)
    const seat = type === 'microbus' ? [0.45, 0.92, -1.28] : rig.driverSeat || [-0.37, 0.42, -0.05];
    addDriver(rig.body || rig.root, ...seat, this._driverSeed);
    return rig;
  }

  _makeCarBody(type, color, opts = {}) {
    // التاكسي والملاكي: نفس شكل السيدان (BYD F3) — التاكسي بألوان شبين، والملاكي بألوان مختلفة.
    // geometry وشيدر مشتركين؛ كل عربية ليها خامة (نفس البرنامج) عشان فوانيس الفرامل بتاعتها لوحدها
    if ((type === 'taxi' || type === 'sedan') && !opts.parked) {
      const car = buildSedan({ livery: type === 'taxi' ? 'taxi' : color, lod: 1, seeThrough: false, uniqueMat: true });
      const U = car.U;
      car.brake = { set emissiveIntensity(v) { U.uBrake.value = v > 2 ? 1 : 0; U.uTail.value = v > 0.5 ? 0.6 : 0.12; } };
      car.lights = { head: { set emissiveIntensity(v) { U.uHead.value = v > 0.1 ? 1 : 0; } } };
      car.wheelRadius = 0.31;
      car.driverSeat = [-0.36, 0.5, -0.12];
      return car;
    }
    const map = { sedan: 'car_sedan', boxy: 'car_old', taxi: 'car_taxi', seal: 'car_taxi', microbus: 'microbus_traffic' };
    const a = this.assets.get(map[type]);
    if (a && a.cfg.trafficHiace) return buildTrafficHiace(a);
    if (a) {
      // نسخة مدموجة خفيفة (2 draw calls) بدل الموديل الكامل لكل عربية
      const T = bakeTrafficVersion(a);
      const body = new THREE.Group(), wrap = new THREE.Group();
      wrap.add(body);
      const s = new THREE.Mesh(T.solid, T.solidMat); s.castShadow = true; body.add(s);
      if (T.glass) { const gl = new THREE.Mesh(T.glass, T.glassMat); gl.userData.role = 'glass'; gl.renderOrder = 2; body.add(gl); }
      return { root: wrap, body, wheels: [], length: a.cfg.targetLength, width: 1.8, brake: null };
    }
    return buildCar(type, color);
  }

  async start() {
    await this.audio.start();
    this.started = true;
    this.cams.mode = 0;
    this.cams.snap = true;
    this.hud.show();
    this.minimap.show();
    if (this.touch) { this.touch.show(); document.getElementById('help').classList.add('hidden'); this.hud.helpTimer = 0; }
    if (this.mobile) document.documentElement.requestFullscreen?.().catch(() => {});
    this.hud.toast(this.mobile ? 'امسك الدركسيون ولفّه، ودوس بنزين' : 'إنت دلوقتي في كرسي السواق — دوس W', 3);
    this.incidents.start(this.player.physics);
    // الميكروباص في شبين: اختار خطك الأول (اللعبة شغالة عادي في الخلفية، واختيار تاني من زرار تغيير الخط)
    if (this.world && this.player.kind === 'microbus' && this.passengers.LINES.length > 1) this.openLinePicker();
  }

  /** وجهة يدوية من الخريطة الكبيرة ({x,z,name}) */
  setUserTarget(t) {
    this.userTarget = t ? { x: t.x, z: t.z, name: t.name } : null;
    this._navT = 0;
    if (t) this.hud.toast(`🧭 الـ GPS: ${t.name}`, 2.2);
  }

  openLinePicker() {
    const P = this.passengers;
    if (P.mode !== 'line') return;
    if (P.onboard.length) { this.hud.toast('نزّل الركاب الأول قبل ما تغيّر الخط', 2.4); return; }
    showLinePicker(P.lineOptions(), (i) => P.selectLine(i));
  }

  /** سقف الفريمات: على الموبايل 60/120 فريم = كارت شاشة شغال على الآخر = سخونية. الافتراضي 45 (أو 30 في الواطية) */
  get fpsCap() {
    const v = this.settings?.get('fpsCap') ?? 'auto';
    if (v === 'max') return 0;
    if (v !== 'auto') return +v;
    if (!this.mobile) return 0;
    const L = this._q?.level ?? 2;
    return L >= 3 ? 30 : L >= 1 ? 45 : 60;
  }

  _tick(t) {
    const cap = this.fpsCap;
    if (cap) {
      const iv = 1000 / cap, last = this._tickT ?? t - iv;
      // تراكم: لو الشاشة 60 والسقف 45 بنرسم 3 من كل 4 بانتظام (مش متقطع)
      this._tickAcc = Math.min(iv * 2, (this._tickAcc || 0) + (t - last));
      this._tickT = t;
      if (this._tickAcc < iv - 1.5) return;
      this._tickAcc -= iv;
    } else this._tickT = t;
    this._frame();
  }

  /** جودة ديناميكية: لو الـ FPS نزل نقلل الدقة/الضلال/المرايات/مسافة الرؤية، ولو علي نرجّعها */
  _adaptQuality(dt) {
    if (!this.started) return;
    if (this.settings && this.settings.get('graphics') !== 'auto') { this.fps = this._fpsMeasure(dt) ?? this.fps; return; }
    const q = (this._q ||= { t: 0, frames: 0, level: this.mobile ? 2 : 0, good: 0, cooldown: 3 });
    q.t += dt; q.frames++; q.cooldown -= dt;
    if (q.t < 1.5) return;
    const fps = q.frames / q.t;
    q.t = 0; q.frames = 0;
    this.fps = fps;
    // الهدف = سقف الفريمات (لو فيه) — مش 60 على طول
    const target = this.fpsCap || 60, max = 4, min = this.mobile ? 1 : -1;
    if (q.cooldown <= 0 && q.level < max && (fps < target * 0.6 || (fps < target * 0.82 && q.level < 2))) {
      q.level++; q.cooldown = 3; q.good = 0; this._applyQuality(q.level, fps);
    } else if (fps > target * 0.95) {
      q.good += 1.5;
      // مستقر على الهدف فترة طويلة → نطلع درجة (الموبايل مش أعلى من "عالية")
      if (q.good > (this.mobile ? 20 : 8) && q.level > min) { q.level--; q.good = 0; q.cooldown = 4; this._applyQuality(q.level, fps); }
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
    // ألترا (-1): دقة الشاشة الكاملة + ضل عالي الدقة
    // الدقة آخر حاجة بتقل (وعمرها ما تنزل عن دقة الشاشة العادية): الجرافيك المبكسل أوحش من ضل أقل أو مسافة رؤية أقصر
    const floor = Math.min(1, window.devicePixelRatio || 1);
    // الموبايل: الدقة بسقف ثابت لكل مستوى (شاشات 3x بترسم 9 أضعاف البكسلات من غير فرق واضح)
    const MPR = [1.5, 1.35, 1.2, 1.0, 0.85];
    const pr = this.mobile
      ? Math.min(window.devicePixelRatio, level < 0 ? 1.75 : MPR[level])
      : level < 0 ? Math.min(window.devicePixelRatio, 2) : Math.max(floor, [base, base, base * 0.9, base * 0.8, base * 0.72][level]);
    this.renderer.setPixelRatio(pr);
    this._resize();
    const sh = level < 0 ? (this.mobile ? 2048 : 4096) : level >= 4 ? 512 : level >= 2 ? 1024 : this.mobile ? 1024 : 2048;
    if (this.env.sun.shadow.mapSize.x !== sh) { this.env.sun.shadow.mapSize.set(sh, sh); this.env.sun.shadow.map?.dispose(); this.env.sun.shadow.map = null; }
    // الضل بيتقفل/يتفتح من الإعدادات بس (تغييره بيعيد بناء كل الشيدرز = تهنيج).
    // الجودة الواطية بتقلل الدقة وبتحدّث الضل كل كام فريم بدل كل فريم
    this.env.sun.castShadow = this.settings?.get('shadows') !== 'off';
    this.shadowEvery = level >= 4 ? 3 : level >= 3 ? 2 : this.mobile && level >= 1 ? 2 : 1;
    const L = Math.max(0, level), far = level < 0 ? 1.25 : [1, 0.95, 0.85, 0.75, 0.65][L];
    this.player.mirrorSkip = [0, 1, 2, 3, 5][L];
    this._qCrowd = [1, 0.9, 0.75, 0.6, 0.5][L];
    this._applySetting('crowd', this.settings?.get('crowd') ?? 'normal');
    this.traffic.viewDist = (this.mobile ? 190 : 260) * far;
    this.viewDist = (this.mobile ? 380 : 560) * far;
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
      const ph = this.player.physics;
      if (this.world) this.world.refY = ph.heave - ph.spec.cgHeight; // زي اللعب الحقيقي بالظبط
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
    this._night = night || p.elevation < 8;
    this.player.setNight(night || p.elevation < 8);
    this.traffic?.setNight(night || p.elevation < 8);
    this.station?.setNight(night || p.elevation < 8);
    this.world?.setNight(night || p.elevation < 8);
    this.touch?.setLights(this.player.headOn);
    // الأنوار دايمًا visible (الشدة بس بتتغير) عشان مفيش إعادة بناء شيدرز
    for (const l of this.lampLights) l.intensity = !p.lampsOn ? 0 : p.night ? 90 : 25;
    const hm = this.settings?.get('headlights');
    if (hm && hm !== 'auto') { this.player.setHeadlights(hm === 'on'); this.touch?.setLights(this.player.headOn); }
  }

  /** تغيير نوع العربية (ميكروباص / تاكسي / توكتوك) في نفس المكان */
  /** البنزينة: واقف في حارة جنب طلمبة → كارت التفويل. والبنزين خالص في الطريق → كارت الجركن */
  _stationUpdate(dt, ph) {
    const at = this.station ? atPump(ph.x, ph.z) : null;
    this._pumpT = at && ph.speed < 0.6 ? (this._pumpT || 0) + dt : 0;
    if (this._pumpT > 0.7 && !this._fuelCard && !this.hud.cardOpen) this._openFuelCard();
    if (this._fuelCard && (!at || ph.speed > 1.5) && !this.fuel.filling) {
      if (this.hud.cardOpen && this.hud._pay?.fuel) this.hud.closeCard();
      this._fuelCard = false;
    }
    // البنزين خلص: جركن طوارئ (مرة كل نص دقيقة لو قلت "استنى")
    this._jerryCd = Math.max(0, (this._jerryCd || 0) - dt);
    this._emptyT = this.fuel.empty && ph.speed < 0.3 ? (this._emptyT || 0) + dt : 0;
    if (this._emptyT > 2 && !this._jerryCd && !this.hud.cardOpen && !at) {
      this._jerryCd = 30;
      const t = this.fuel.tank, liters = Math.min(5, t.capacity * 0.2), cost = Math.round(this.fuel.cost(liters) * 1.6 + 40);
      this.hud.showCard({
        title: '⛽ البنزين خلص!', tone: 'danger',
        rows: [['جركن طوارئ', `${liters} لتر`], ['السعر (بالتوصيل)', `${cost} ج`, 'pc-c']],
        note: 'يوصلك لأقرب بنزينة — بيتخصم حتى لو الرصيد مش مكفي',
        buttons: [{ label: 'اطلب جركن', onClick: () => { const c = this.fuel.jerrycan(); this.hud.toast(`⛽ وصل الجركن — دفعت ${c} ج`, 3); } }, { label: 'استنى', cls: 'alt' }],
      });
    }
  }

  _openFuelCard() {
    const F = this.fuel, t = F.tank, space = F.space(), bal = this.wallet.balance;
    this._fuelCard = true;
    if (space < 0.5) { this.hud.toast('⛽ التانك مليان', 2); return; }
    const price = t.spec.price;
    const small = Math.min(space, t.capacity >= 40 ? 10 : 2), by100 = Math.min(space, 100 / price);
    const opts = [
      { label: 'فوّل التانك', sub: `${space.toFixed(1)} لتر · ${Math.round(F.cost(space))} ج`, l: space },
      { label: `${small} لتر`, sub: `${Math.round(F.cost(small))} ج`, l: small },
      { label: 'بـ 100 ج', sub: `${by100.toFixed(1)} لتر`, l: by100 },
    ];
    this.hud.showCard({
      title: `⛽ ${STATION.name} — ${t.spec.type} ${price} ج/لتر`, tone: 'fuel',
      rows: [['في التانك', `${Math.round((t.level / t.capacity) * 100)}% · ${t.level.toFixed(1)}/${t.capacity} لتر`], ['رصيدك', `${Math.round(bal)} ج`]],
      note: bal < F.cost(small) ? 'الفلوس مش مكفية — اشتغل الأول' : 'اختار وهو بيفوّل في ثواني',
      buttons: opts.map((o) => ({ label: o.label, sub: o.sub, disabled: Math.round(F.cost(o.l)) > bal + 0.01, onClick: () => this._buyFuel(o.l) })),
    });
    if (this.hud._pay) this.hud._pay.fuel = true;
  }

  _buyFuel(liters) {
    const got = this.fuel.buy(liters, (l, cost) => this.hud.toast(`✅ اتفوّل ${l.toFixed(1)} لتر — دفعت ${cost} ج`, 3));
    this.hud.toast(got ? '⛽ بيفوّل...' : 'الفلوس مش مكفية', 2);
  }

  setVehicle(kind) {
    if (!this.player || this.player.kind === kind) return;
    const o = this.player.physics, at = { x: o.x, z: o.z, yaw: o.yaw };
    const moved = this.started;
    // العربية الحالية بتتشال من المشهد بس (بتفضل محفوظة)، والجديدة جاهزة من وقت التحميل
    this.player.rig.root.removeFromParent();
    let next = this.vehicles[kind];
    if (!next) {
      next = this.vehicles[kind] = new PlayerVehicle(this.scene, this.assets, { lowPower: this.mobile, kind });
      next.lowPower = this.mobile;
      this._applyLivery(next, this.settings.get('livery'));
    } else this.scene.add(next.rig.root);
    this.player = next;
    if (moved) next.physics.reset(at.x, at.z, at.yaw); else next.reset(true);
    next._savePrev();
    this._wirePhysics();
    this.cams.player = next; this.cams.snap = true;
    this.mirrorInsets = this.insets[kind] ||= new MirrorInsets(next, this.touch);
    this.mirrorInsets.mode = this.settings.get('mirrorInsets');
    this.passengers.setPlayer(next);
    this.fuel?.attach(next);
    if (this.touch) this.touch.maxWheel = next.physics.maxWheelAngle;
    for (const k of ['keySteer', 'mirrorQuality', 'seat', 'headlights']) this._applySetting(k, this.settings.get(k));
    next.setNight(!!this._night);
    if (this.settings.get('headlights') !== 'auto') this._applySetting('headlights', this.settings.get('headlights'));
    this.audio.setEngineKind(kind);
    this.diag.set('hiace', kind === 'microbus' ? (next.glbIntegrated ? 'HIACE: LOADED' : 'HIACE: FAILED') : `VEHICLE: ${kind.toUpperCase()}`, 'ok');
    next.syncVisuals(0.016, 1);
    if (next.damage) next.damage.onBreak = () => this.audio.glass();
    this.onVehicleChange?.(kind);
  }

  _applyLivery(P, v) {
    if (P.kind !== 'microbus' || !P.rig.dims || !P.rig.shell) return;
    if (!P._liv) P._liv = applyLivery(P.rig, v); else P._liv(v);
  }

  /** تطبيق إعداد (عند البداية ولما يتغير من اللوحة) */
  _applySetting(k, v) {
    switch (k) {
      case 'vehicle': this.setVehicle(v); break;
      case 'mirrorInsets': this.mirrorInsets.mode = v; break;
      case 'keySteer': this.player.physics.keySens = +v; break;
      case 'seat': {
        const rig = this.player.rig;
        if (rig.eyeBase) { const o = { near: [-0.16, -0.03], normal: [0, 0], back: [0.14, 0.04] }[v] || [0, 0]; rig.eye.position.set(rig.eyeBase.x, rig.eyeBase.y + o[1], rig.eyeBase.z + o[0]); }
        break;
      }
      case 'mirrorQuality': this.player.setMirrorQuality(v); break;
      case 'livery': for (const P of Object.values(this.vehicles || {})) this._applyLivery(P, v); break;
      case 'graphics': {
        const fixed = { low: 3, med: 2, high: 0, ultra: -1 }[v];
        const q = (this._q ||= { t: 0, frames: 0, level: this.mobile ? 2 : 0, good: 0, cooldown: 3 });
        if (fixed !== undefined) { q.level = fixed; this._applyQuality(fixed, this.fps || 0); }
        else { q.level = this.mobile ? 2 : 0; q.cooldown = 2; this._applyQuality(q.level, this.fps || 0); }
        break;
      }
      case 'shadows': this._applyQuality(this._q?.level || 0, this.fps || 0); break;
      case 'timeOfDay': if (this.env.presetName !== v) this.env.setPreset(v); break;
      case 'headlights':
        if (v === 'auto') this.player.setHeadlights(!!this.player._night); else this.player.setHeadlights(v === 'on');
        this.touch?.setLights(this.player.headOn);
        break;
      case 'masterVol': case 'engineVol': this.audio.setVolumes(this.settings.get('masterVol') / 100, this.settings.get('engineVol') / 100); break;
      case 'traffic': this.traffic.setDensity({ off: 0, low: 0.35, normal: 0.7, high: 1 }[v] ?? 0.7); break;
      case 'crowd': this.crowd?.setCount(this.crowdBase * ({ low: 0.45, normal: 1, high: 1.6 }[v] ?? 1) * (this._qCrowd ?? 1)); break;
      default: break;
    }
  }

  _frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    let input = this.started ? this.input.read() : { throttle: 0, brake: 0, steer: 0, handbrake: 1, actions: {} };
    // الشرطة جاية بعد حادثة / الشرطة مسكتك ومدفعتش: العربية واقفة (الدركسيون بس)
    if (this.race?.hold) input = { ...input, throttle: 0, brake: 1, actions: {} };
    if (this.incidents?.hold) input = { ...input, throttle: 0, brake: 1, handbrake: 1, actions: { ...input.actions, reset: input.actions.reset && !this.incidents.blocked } };
    const a = input.actions;
    if (a.camera) this.hud.toast(`الكاميرا: ${this.cams.next()}`);
    if (a.zoomIn) this.cams.zoomBy(1 / 1.15);
    if (a.zoomOut) this.cams.zoomBy(1.15);
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
      if (this.world) this.world.refY = ph.heave - ph.spec.cgHeight;
      this.player.beforeStep();
      ph.step(FIXED_DT, input, this._colliders);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (this._dmgQ) { const q = this._dmgQ; this._dmgQ = null; this.player.damage?.impact(...q); }
    this.player.damage?.step(); // شغل الضرر التقيل: حاجة واحدة بس كل فريم
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
      if (ph.flipped && !this.race?.active) this.incidents.trigger('flip', ph, this.player.kind);
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
      // الحلبة بعيدة (غرب البلد): بتترسم بس لما تقرب منها
      if (this.raceTrack) { const c = this.camera.position; this.raceTrack.group.visible = Math.hypot(c.x + 410, c.z - 65) < 250 + (this.viewDist || 400) * 0.5; }
      this.player.surface = surfaceAt(ph.x, ph.z);
      if (this.world) {
        // اسم الشارع الحقيقي (من OSM) لما تدخله — الشارع اللي مالوش اسم مش بيطلع له اسم
        // (بيتغير بعد قراءتين متتاليتين بس، عشان مايرعشش عند التقاطعات)
        const st = this.world.streetAt(ph.x, ph.z);
        const key = st ? st.name || `~${st.edge.cls}${st.edge.elevated ? 'b' : ''}` : '';
        if (key === this._streetCand) {
          if (key !== this._zone && this.started) {
            this._zone = key;
            const cls = st?.edge.cls.replace('_link', '');
            const generic = !st ? '' : st.edge.elevated ? 'كوبري (مالوش اسم مسجّل)' : ['primary', 'trunk', 'motorway', 'secondary'].includes(cls) ? 'طريق رئيسي (مالوش اسم مسجّل)' : 'شارع جانبي';
            this.hud.setStreet(st?.name || null, generic);
          }
        } else this._streetCand = key;
      } else {
      // اسم المنطقة لما تدخلها
      // على طريق فرعي: اسمه، غير كده اسم المنطقة على الطريق الرئيسي
      const side = sideRoadAt(ph.x, ph.z);
      const onMain = surfaceAt(ph.x, ph.z) !== 'dirt' && !side;
      const pr = onMain || !side ? loopProject(ph.x, ph.z) : null;
      const zone = side ? `road:${side.id}` : pr && pr.d !== undefined && Math.abs(pr.d) > 25 ? this._zone : pr ? (pr.s < 450 ? 'city' : sampleZoneName(pr.s)) : null;
      const label = side ? side.name : ZONE_LABEL[zone] || zone;
      if (zone && zone !== this._zone && this.started) { if (this._zone) this.hud.toast(label, 1.6, true); this._zone = zone; }
      }
    }
    this.player.syncVisuals(dt, this.acc / FIXED_DT);
    this.cams.update(dt, input);
    if (this.player.driver) this.player.driver.visible = this.cams.mode !== 0;
    // إيدين السواق على الجادون بتبان من الكابينة بس (من برا الموديل بتاع السواق هو اللي باين)
    if (this.player.rig.hands) this.player.rig.hands.visible = this.cams.mode === 0;
    this.crowd.update(dt, this.camera.position, this.player.physics, this.camera.getWorldDirection(this._camDir || (this._camDir = new THREE.Vector3())));
    this.passengers.camPos = this.camera.position;
    if (this.started) this.passengers.update(dt, ph);
    // البنزين، الرخص، الكماين، والبنزينة
    if (this.started) {
      this.fuel.update(dt, ph);
      this.licenses.update(dt);
      this.police.update(dt, ph, this.player.kind, this.clock.elapsedTime);
      this.incidents.update(dt, ph);
      this.race?.update(dt, ph);
      this._stationUpdate(dt, ph);
      this.docs.update(dt);
    }
    // الـ GPS: الهدف من الشغل (المحطة الجاية / الزبون / الوجهة)، والطريق بيتحسب ويتابع كل ربع ثانية
    // الأولوية: "اركن على جنب" في الكمين ← البنزين قليل (وإنت فاضي) ← الشغل
    if (this.started) {
      this._navT = (this._navT || 0) - dt;
      if (this._navT <= 0) {
        this._navT = 0.25;
        const pol = this.police.navTarget() || this.incidents.navTarget?.();
        const lowFuel = this.fuel.frac < 0.15 && !this.passengers.trip && !this.passengers.onboard.length;
        this.hud.navOverride = pol ? 'police' : lowFuel ? 'fuel' : null;
        // "اذهب إلى هنا" من الخريطة: بيخلص لما توصل (أو لو ركب زبون/الكمين)
        const ut = this.userTarget;
        if (ut && Math.hypot(ut.x - ph.x, ut.z - ph.z) < 22) { this.hud.toast(`📍 وصلت: ${ut.name}`, 2.4); this.userTarget = null; }
        if (this.userTarget && this.passengers.trip) this.userTarget = null; // زبون التاكسي له الأولوية
        this.nav.setTarget(pol || this.userTarget || (lowFuel && this.station ? STATION.nav : this.passengers.navTarget(ph)));
        this.hud.setNav(this.nav.info);
        this.hud.setFuel(this.fuel.frac);
        const P = this.player, info = this.nav.info, job = this.passengers.jobInfo();
        P.navCanvas = this.minimap.navCv;
        P.navTitle = job.mode === 'line' ? job.title : job.dest ? `📍 ${job.dest}` : '';
        P.navLine = job.mode === 'line' ? `المحطة الجاية: ${job.next}` : job.dest ? `${info ? fmtDist(info.remain) + ' · ' : ''}الأجرة ${job.fare} ج` : '';
      }
      this.nav.update(dt, ph);
    }
    this.env.update(this.player.rig.root.position);

    // أقرب أعمدة نور بالليل
    this.lampTimer -= dt;
    if (this.lampTimer <= 0 && this.env.preset.lampsOn) {
      this.lampTimer = 0.4;
      // أقرب N أعمدة (اختيار من غير ما نعمل مصفوفات جديدة كل مرة)
      const c = this.camera.position, L = this.lampLights, n = L.length;
      const best = (this._lampBest ||= new Array(n).fill(null)), bd = (this._lampD ||= new Float64Array(n));
      bd.fill(Infinity);
      for (const p of this.world ? this.world.lamps.near : LAMP_POSITIONS) {
        const d = p.distanceToSquared(c);
        if (d >= bd[n - 1]) continue;
        let k = n - 1;
        while (k > 0 && bd[k - 1] > d) { bd[k] = bd[k - 1]; best[k] = best[k - 1]; k--; }
        bd[k] = d; best[k] = p;
      }
      for (let i = 0; i < n; i++) if (best[i]) L[i].position.copy(best[i]);
    }

    this._adaptQuality(dt);
    const inside = this.cams.modeId === 'cockpit';
    this.audio.update(dt, { player: this.player, camera: this.camera, traffic: this.traffic, inside, horn: input.horn, passengers: this.passengers?.count, crowd: this.crowd });
    this.hud.update(dt, ph, this.lights);
    if (this.touch) this.touch.update(ph.steeringWheelAngle);

    if (inside) this.player.renderMirrors(this.renderer, this.scene, this.camera.position);
    this.diag.update(dt, this.player, inside);
    this.mp.update(dt);
    this.minimap.update(dt);
    // الضل: بيتحدّث كل فريم في الجودة العالية، وكل 2-3 فريمات في الواطية (أخف بكتير ومفيش إعادة بناء شيدرز)
    const sm = this.renderer.shadowMap;
    this._shadowTick = ((this._shadowTick || 0) + 1) % (this.shadowEvery || 1);
    sm.autoUpdate = false;
    if (this._shadowTick === 0) sm.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    if (this.mirrorInsets.update(this.camera, inside && this.started)) this.mirrorInsets.render(this.renderer);
  }
}

export { CAMERA_MODES };
