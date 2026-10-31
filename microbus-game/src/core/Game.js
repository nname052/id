import * as THREE from 'three';
import { createMaterials } from '../render/materials.js';
import { loadPhotoAtlas, applyPhotoAtlas } from '../render/photoAtlas.js';
import { Environment } from '../world/Environment.js';
import { addDriver } from '../world/Pedestrians.js';
import { applyLivery } from '../vehicles/Livery.js';
import { bakeTrafficVersion, realTrafficCar } from '../vehicles/ModelFit.js';
import { buildSedan } from '../vehicles/SedanModel.js';
import { Patrol } from '../gameplay/Patrol.js';
import { PlayerVehicle } from '../vehicles/PlayerVehicle.js';
import { buildCar } from '../vehicles/CarModels.js';
import { buildTrafficHiace } from '../vehicles/TrafficHiace.js';
import { groundHeight } from '../world/ground.js';
import { surfaceAt } from '../world/ground.js';
import { CameraSystem, CAMERA_MODES } from '../camera/CameraSystem.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { AssetManager, applyTextureOverrides } from '../assets/AssetManager.js';
import { PostFX } from '../render/PostFX.js';
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
import { Emergency } from '../gameplay/Emergency.js';
import { Docs } from '../ui/Docs.js';
import { Navigator, fmtDist } from '../nav/Navigator.js';
import { Multiplayer } from '../net/Multiplayer.js';
import { MiniMap } from '../ui/MiniMap.js';
import { setGroundProvider } from '../world/ground.js';
import { setGraph, findRoute } from '../nav/RoadGraph.js';
import { ShibinWorld } from '../world/shibin/ShibinWorld.js';
import { usePacks } from '../world/shibin/ShibinData.js';
import { currentMap } from '../world/maps.js';
import { showLinePicker } from '../ui/LinePicker.js';
import { buildSmallTraffic } from '../vehicles/SmallTraffic.js';
import { Radio } from '../audio/Radio.js';
import { ShibinTraffic } from '../world/shibin/ShibinTraffic.js';
import { PoliceMission } from '../gameplay/PoliceMission.js';
import { AmbulanceMission } from '../gameplay/AmbulanceMission.js';
import { Intercity } from '../gameplay/Intercity.js';
import { Cinematic } from '../camera/Cinematic.js';
import { ShibinCrowd } from '../world/shibin/ShibinCrowd.js';
import { attachJobs } from '../world/shibin/ShibinJobs.js';
import { buildWorks } from '../world/shibin/ShibinWorks.js';
import { TouchControls, isTouchDevice } from '../ui/TouchControls.js';

const FIXED_DT = 1 / 120;
/** مستوى الجودة من الإعدادات المحفوظة: التلقائي = متوسطة على الموبايل وعالية على الكمبيوتر */
function resolveTier(v, mobile) { return ['low', 'med', 'high', 'ultra'].includes(v) ? v : v === 'saver' ? 'low' : mobile ? 'med' : 'high'; }
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

if (import.meta.env.DEV) window.__THREE = THREE; // للتجربة بس

export class Game {
  constructor(container, status) {
    this.container = container;
    this.status = status;
    this.started = false;
    // شبين الكوم الحقيقية (OpenStreetMap) — الخريطة الوحيدة
    this.map = currentMap(); this.mapId = this.map.id;
  }

  async init() {
    const S = this.status;
    this._initT0 = performance.now();
    this.diag = new Diagnostics();
    // صور شوارع شبين الحقيقية (ملف واحد): بيتحمل بالتوازي مع الخطوط والموديلات
    const photos = loadPhotoAtlas();
    S('تحميل الخطوط العربية...', 0.05);
    await Promise.all(['Lalezar', 'Rakkas', 'Lemonada', 'El Messiri', 'Aref Ruqaa', 'Cairo'].map((f) => document.fonts.load(`40px "${f}"`).catch(() => {})));

    S('البحث عن موديلات وخامات إضافية...', 0.1);
    this.assets = new AssetManager();
    const tA = performance.now();
    await this.assets.loadAll();
    this._assetsMs = Math.round(performance.now() - tA);

    // ===== الرندر =====
    // مستوى الجودة بيتحدد قبل إنشاء الرندر (الـ MSAA ونوع الضل مينفعش يتغيروا بعد كده)
    this.mobile = isTouchDevice();
    // آيفون/آيباد: كارت شاشة قوي → دقة أعلى (حواف ناعمة) من غير ما الفريمات تقع
    this.ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const saved = (() => { try { return JSON.parse(localStorage.getItem('egy-microbus-settings-v1') || '{}'); } catch { return {}; } })();
    this.tier = resolveTier(saved.graphics, this.mobile);
    this.saverBoot = saved.graphics === 'saver';
    // الموبايل: MSAA في المتوسطة والعالية (كروت الموبايل tile-based: الـ 4x MSAA تقريبًا ببلاش على الشاشة نفسها
    // وبيشيل التسنين اللي كان باين) — الواطية وموفّر البطارية من غيره
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: !this.saverBoot, /* (كان مقفول في الجودة الواطية = حواف مسننة/مبكسلة؛ كروت الموبايل بتنعّم الحواف برخص) */ powerPreference: this.mobile ? 'default' : 'high-performance' }));
    this.basePR = Math.min(window.devicePixelRatio, this.mobile ? 1.55 : 1.5);
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
    // (?photos=0: من غير صور الواجهات الحقيقية — للمقارنة)
    this.photoAtlas = /[?&]photos=0/.test(location.search) ? false : applyPhotoAtlas(this.M, await photos);
    applyTextureOverrides(this.assets, this.M);

    S('السما والشمس...', 0.4);
    await nextFrame();
    this.env = new Environment(renderer, this.scene, this.M);
    if (this.mobile) {
      this.env.sun.shadow.mapSize.set(1024, 1024);
      const c = this.env.sun.shadow.camera; c.left = c.bottom = -38; c.right = c.top = 38; c.updateProjectionMatrix();
    }

    // ===== شبين الكوم الحقيقية: المربعات بتتحمل حوالين اللاعب، والأرض والـ GPS من نفس البيانات =====
    const t0 = performance.now();
    if (this.map.packed) usePacks(this.mapId);
    this.world = await new ShibinWorld(this.M, { id: this.mapId, name: this.map.name, water: this.map.water, spawn: this.map.spawn, ground: this.map.ground, assets: this.assets, low: this.mobile, tier: this.saverBoot ? 'low' : this.tier }).init(S);
    this.scene.add(this.world.group);
    this.route = this.world;
    setGroundProvider(this.world);
    setGraph(this.world.graph);
    attachJobs(this.world, findRoute);
    this.works = buildWorks(this.world); this.scene.add(this.works); // أعمال طرق (ديكور حيّ)
    this.findRoute = findRoute; // (للاختبارات والقياس: حساب مسار على شبكة الطرق من الـ Console)
    PlayerVehicle.world = this.world;
    this.lights = { update() {}, state: () => 'green' }; // (مفيش إشارات مرور مرسومة)
    this.loadInfo = { assetsMs: this._assetsMs, worldMs: Math.round(performance.now() - t0) };

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
    // (أوقات مراحل التحميل — loadInfo.stages، لاختبار سرعة التحميل)
    const tS = performance.now(), mark = (k) => { (this._stages ||= {})[k] = Math.round(performance.now() - tS); };
    this.traffic = new ShibinTraffic(this.scene, (type, color, o) => this._makeCar(type, color, o), this.audio, this.world, { count: this.saverBoot ? 14 : this.tier === 'low' ? 20 : this.mobile ? 42 : 84, parked: this.tier === 'low' ? 14 : this.mobile ? 28 : 48 });
    mark('traffic');
    this.traffic.viewDist = this.mobile ? 150 : 190;
    if (this.mobile) { this.traffic.activeR = 195; this.traffic.despawnR = 240; }
    this.crowdBase = this.tier === 'low' ? 80 : this.mobile ? 105 : 240; // (المدينة كانت فاضية: ناس أكتر بكتير)
    this.crowd = new ShibinCrowd(this.scene, this.world, { count: this.crowdBase, variants: this.mobile || this.tier === 'low' ? 12 : 20 });
    this.crowd.traffic = this.traffic; this.traffic.crowd = this.crowd; mark('crowd');
    // المرايات مش بترسم هالات/بقع نور الأعمدة (ديكور)
    PlayerVehicle.mirrorHide = [this.world.lamps?.glow, this.world.lamps?.pools].filter(Boolean);
    this.traffic.lodNear = this.tier === 'low' ? 90 : 1e5; // كل العربيات اللي باينة بكامل جودتها (النسخة الخفيفة للجودة الواطية بس)
    this.statics = [];

    const colOut = [];
    this._colliders = (box) => {
      const out = colOut; out.length = 0; // نفس المصفوفة كل مرة (مفيش garbage كل خطوة فيزيا)
      for (const s of this.statics) if (Math.abs(s.cx - box.cx) < s.hx + 8 && Math.abs(s.cz - box.cz) < s.hz + 8) out.push(s);
      this.route.queryColliders(box.cx, box.cz, out);
      this.traffic.colliders(box, out);
      this.mp?.colliders(box, out);
      this.incidents?.colliders(box, out);
      this.police?.colliders(box, out);
      this.world?.rail?.colliders(box, out);
      this.emergency?.colliders(box, out);
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
    this.passengers = new Passengers(this.scene, this.player, { hud: this.hud, audio: this.audio, settings: this.settings, wallet: this.wallet, world: this.world });
    this.passengers._updateHud(); mark('passengers');
    this.hud.setMoney(this.wallet.balance);
    this.hud.onSwitchLine = () => this.openLinePicker();
    // البنزين (تانك لكل عربية) + الرخص وأيام اللعبة + البنزينة + كماين المرور + لوحة المحفظة والرخص
    this.fuel = new FuelSystem({ hud: this.hud, wallet: this.wallet });
    this.fuel.attach(this.player);
    this.licenses = new Licenses({ wallet: this.wallet, hud: this.hud });
    this.police = new Police(this.scene, { hud: this.hud, wallet: this.wallet, licenses: this.licenses, spots: this.world.policeSpots, assets: this.tier !== 'low' ? this.assets : null });
    // أماكن محجوزة (محطات ركوب + كماين): مفيش عربيات مركونة فيها
    this.world.nearReserved = (x, z, r) =>
      this.passengers.stops.some((st) => (st.mx ?? st.x) - x < r + 8 && x - (st.mx ?? st.x) < r + 8 && Math.hypot((st.mx ?? st.x) - x, (st.mz ?? st.z) - z) < r + 8) ||
      (this.world.policeSpots || []).some((sp) => Math.hypot(sp.q.x - x, sp.q.z - z) < r + 40);
    mark('police');
    this.incidents = new Incidents(this.scene, { hud: this.hud, wallet: this.wallet, licenses: this.licenses, passengers: this.passengers, audio: this.audio });
    // حوادث المشاة + الإسعاف (شبين)
    if (this.crowd?.extras) {
      this.emergency = new Emergency(this.scene, { world: this.world, crowd: this.crowd, traffic: this.traffic, makeBody: (t) => this._makeCarBody(t, 0xffffff, {}), audio: this.audio, hud: this.hud });
      this.traffic.extraStops = () => { const a = this.emergency.stopZones, b = this.patrol?.stopZones; return b?.length ? [...a, ...b] : a; };
      this.traffic.extraSlows = () => {
        const a = this.police?.slowZones || [], b = this.emergency?.slowZones || [], out = b.length ? [...a, ...b] : [...a];
        // عربيتك بالسارينة: اللي قدامك في نفس الاتجاه بيهدّي ويركن على جنب لحد ما تعدي
        const P = this.player, ph = P?.physics;
        if (P?.sirenOn && ph) { const [fx, fz] = ph.forward; out.push({ x: ph.x + fx * 30, z: ph.z + fz * 30, r: 38, v: 3.5, yield: { fx, fz } }); }
        return out;
      };
      this.crowd.onHit = (p, severe, v) => {
        this.audio?.thump?.(Math.min(1, v / 12));
        this.hud?.toast(severe ? '⚠️ خبطت حد جامد! — الإسعاف والشرطة جايين' : '⚠️ خبطت واحد ماشي — الإسعاف جاية له، والشرطة جاية', 3);
        this.emergency.dispatch(p); // أي خبطة: الإسعاف بتيجي (المصاب بيفضل واقع لحد ما تشيله)
        if (this.started) this.incidents.trigger(severe ? 'ped' : 'pedMinor', this.player.physics, this.player.kind);
      };
    }
    // هروب من كمين → مطاردة من مكان عربية الكمين على شبكة الطرق
    this.police.onFlee = (c, x, z) => this.incidents.pursueFrom(x, z, this.player.physics, this.player.kind);
    this.incidents.onFinish = () => this.police.chaseOver();
    mark('emergency');
    if (this.traffic) this.patrol = new Patrol(this.scene, { traffic: this.traffic, audio: this.audio, hud: this.hud, incidents: this.incidents });
    // مهمات الشرطة (لما تسوق البوكس) + المشهد القصير اللي قبلها
    this.cine = new Cinematic();
    if (this.traffic) this.policeMission = new PoliceMission({ traffic: this.traffic, audio: this.audio, hud: this.hud, wallet: this.wallet, cine: this.cine });
    if (this.world) this.intercity = new Intercity({ world: this.world, hud: this.hud, wallet: this.wallet, passengers: this.passengers });
    if (this.world && this.crowd) this.ambulanceMission = new AmbulanceMission({ world: this.world, crowd: this.crowd, audio: this.audio, hud: this.hud, wallet: this.wallet, cine: this.cine });
        this.docs = new Docs(this, this.touch ? this.touch.root.querySelector('.t-top') : null);
    this.mp = new Multiplayer(this);
    if (this.traffic) this.traffic.remotePlayers = () => this.mp.positions();
    mark('missions');
    this.minimap = new MiniMap(this); mark('minimap');
    this.settings.onChange((k, v) => this._applySetting(k, v));
    if (this.player.damage) this.player.damage.onBreak = () => this.audio.glass();
    this.cams.mode = 2; this.cams.attract = true; // ورا شاشة البداية: الكاميرا الحرة بتلف حوالين العربية

    // أنوار الشارع بالليل: عدد صغير من الأنوار بنحركها لأقرب أعمدة (أداء)
    // كل PointLight بيتحسب في كل بكسل لكل الخامات (حتى وهو مطفي بالنهار) → عدد قليل على حسب الجهاز.
    // شبين: النور الرئيسي مزيّف (لمبات منوّرة + بقع نور) والأنوار الحقيقية قليلة جنبك بس
    this.lampLights = [];
    const nLamps = this.tier === 'low' ? 0 : this.mobile ? 0 : 3;
    for (let i = 0; i < nLamps; i++) {
      const l = new THREE.PointLight(0xffd8a0, 0, 26, 1.6);
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.env.listeners.push((p) => this._onTimeChange(p));

    // الإعدادات المحفوظة (قبل تجهيز الشيدرز: الضل والجودة بيغيروا نوع الشيدر المطلوب)
    for (const [k, v] of Object.entries(this.settings.values)) this._applySetting(k, v);
    // العربيات التانية (تاكسي/توكتوك) مش بتتبني وقت التحميل: بتتبني في الخلفية بعد ما السواقة تبدأ (_prepareVehicles)
    // ولو اللاعب بدّل قبلها بتتبني ساعتها (setVehicle) — التحميل أسرع ~نص ثانية + شيدرزهم
    this._applyLivery(this.player, this.settings.get('livery'));
    this.player.syncVisuals(0);
    this.cams.update(0.016);
    // شبين: المربعات اللي حوالين البداية بتتحمل الأول (اللي اللاعب هيشوفه)، والباقي بيكمل في الخلفية وهو بيسوق
    const sp = this.world.spawnPose(), cam = this.camera;
    cam.position.set(sp.x + 12, 10, sp.z + 12); cam.lookAt(sp.x, 0, sp.z); cam.updateMatrixWorld();
    // المرحلة (أ): المربعات القريبة بس (~300 م حوالين البداية) قبل "جاهز" — الباقي بيكمل في الخلفية وانت بتسوق
    // (كانت بتستنى كل المربعات لحد مدى الرؤية كله ~700 م)
    for (let k = 0; k < 400 && (this.world.queue.length || this.world.stats.tilesLoaded < 4 || k < 3); k++) {
      S(`تحميل شوارع ${this.map.name} حواليك...`, 0.9 + Math.min(0.06, k * 0.002));
      this.world.updateVisibility(cam.position, 180);
      this.world.update(0.016);
      await nextFrame();
    }
    // ===== الشيدرز: مرة واحدة لكل المشهد بعد ما المدينة اتحملت =====
    // (كانت بتتجهز للعربيات بس قبل المدينة → أول فريم كان بيجهز شيدرز المدينة على المين ثريد = تهنيج 3-5 ث)
    // compileAsync بيجهزهم بالتوازي (KHR_parallel_shader_compile) من غير ما يوقف الصفحة.
    // الحاجات المستخبية دلوقتي (عربيات المرور قبل ما تظهر، نسخ الـ LOD، الليل...) بتتفتح لحظة عشان شيدرزها تتجهز كمان
    S('تجهيز الشيدرز...', 0.97);
    await nextFrame();
    await this.precompile([this.scene], true, (f) => S('تجهيز الشيدرز...', 0.97 + f * 0.025));
    try { this._applyPostFX(); } catch (e) { console.warn('[postfx]', e); this.postfx = null; }
    { renderer.render(this.scene, this.camera); this.loadInfo.readyMs = Math.round(performance.now() - this._initT0); this.loadInfo.stages = this._stages; }
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.lampTimer = 0;
    renderer.setAnimationLoop((t) => this._tick(t));
    // الصفحة مستخبية (تاب تاني/التطبيق في الخلفية): مفيش رسم ولا فيزيا ولا مرور ولا صوت خالص
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.paused = true; renderer.setAnimationLoop(null);
        this.audio?.ctx?.state === 'running' && this.audio.ctx.suspend().catch(() => {});
      } else if (this.paused) {
        this.paused = false; this.clock.getDelta(); this._tickT = undefined; this._tickAcc = 0;
        renderer.setAnimationLoop((t) => this._tick(t));
        this.audio?.ctx?.state === 'suspended' && !this.audio.muted && this.audio.ctx.resume().catch(() => {});
      }
    });
    S('جاهز!', 1);
  }

  /**
   * تجهيز شيدرز كل خامات المشهد (compile بيلف على كل الأشكال، حتى المستخبية) — من غير رسم.
   * لو كارت الشاشة بيدعم KHR_parallel_shader_compile: بيتجهزوا بالتوازي ومن غير ما الصفحة تقف.
   * لو مش بيدعمه: الربط (link) بيحصل في أول استخدام = أول فريم بعد "جاهز" كان بيقف ثواني →
   * بنخلّص الربط هنا وقت التحميل على دفعات (وشريط التحميل بيتحرك)
   */
  async precompile(roots, withMirrors = true, onProgress = null) {
    void roots;
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
      // نسخة المرايات (الرسم جوه render target بيحتاج نسخة شيدر مختلفة)
      const rt = withMirrors && this.player?.mirrorCams?.[0]?.rt;
      if (rt) { this.renderer.setRenderTarget(rt); await this.renderer.compileAsync(this.scene, this.camera); }
      this.renderer.setRenderTarget(null);
      // المرايات اللي على حرف الشاشة (مشهد لوحده بكاميرا Ortho) — كانت بتتجهز أول ما تدوس "يلا بينا" (~نص ثانية)
      if (this.mirrorInsets) await this.renderer.compileAsync(this.mirrorInsets.scene, this.mirrorInsets.cam);
    } catch (e) { console.warn('[precompile]', e); }
    this.renderer.setRenderTarget(null);
    const progs = this.renderer.info.programs || [];
    // سقف وقت (6 ث): على جهاز بطيء جدًا/كارت مشغول التحميل مايقفش — اللي مالحقش بيتربط وقت أول استخدام زي الأول
    let t0 = performance.now();
    const until = t0 + 6000;
    for (let i = 0; i < progs.length && performance.now() < until; i++) {
      progs[i].getUniforms(); // (لو اتربط خلاص: ولا حاجة)
      if (performance.now() - t0 > 40) { onProgress?.(i / progs.length * 0.6); await nextFrame(); t0 = performance.now(); }
    }
    // الصور كمان بتترفع على كارت الشاشة دلوقتي (مش أول ما تتشاف: عدادات/شاشات الكابينة كانت بتترفع لما تدوس "يلا بينا")
    const texs = new Set();
    this.scene.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) for (const k in m) { const v = m[k]; if (v && v.isTexture && !v.isRenderTargetTexture) texs.add(v); }
    });
    let i = 0;
    for (const t of texs) {
      if (performance.now() > until) break;
      try { this.renderer.initTexture(t); } catch { /* */ }
      if (performance.now() - t0 > 40) { onProgress?.(0.6 + (i / texs.size) * 0.4); await nextFrame(); t0 = performance.now(); }
      i++;
    }
  }

  /**
   * بعد ما السواقة تبدأ: العربيات التانية بتتبني وشيدرزها بتتجهز في الخلفية عشان التبديل يبقى لحظي.
   * بناء عربية = ~0.3 ث على كمبيوتر و~1 ث على موبايل (مرة واحدة) → بيحصل بس والعربية واقفة
   * (موقف/إشارة/ركاب) مش وانت بتسوق. لو اللاعب بدّل قبلها: setVehicle بيبنيها ساعتها.
   */
  async _prepareVehicles() {
    const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 300)));
    const stopped = async () => {
      let still = 0;
      while (still < 1.2) {
        await new Promise((r) => setTimeout(r, 300));
        const ph = this.player.physics;
        still = !this.paused && Math.abs(ph.speed) < 0.3 ? still + 0.3 : 0;
      }
    };
    for (const kind of ['microbus', 'taxi', 'tuktuk']) {
      if (this.vehicles[kind]) continue;
      await new Promise((r) => setTimeout(r, 2500));
      await stopped();
      await idle();
      if (this.vehicles[kind]) continue;
      const v = new PlayerVehicle(this.scene, this.assets, { lowPower: this.mobile, kind });
      v.lowPower = this.mobile;
      v.rig.root.removeFromParent();
      this.vehicles[kind] = v;
      this._applyLivery(v, this.settings.get('livery'));
      // شيدرزها من غير ما تدخل المشهد: compile(العربية، الكاميرا، المشهد) = خاماتها بأنوار المشهد + أنوارها هي.
      // أنوار العربية الحالية بتتطفي لحظة (وقت ما مفاتيح الشيدرز بتتحسب) → نفس عدد الأنوار اللي هيبقى لما
      // العربية الجديدة تحل مكانها. (لو اتحطت في المشهد جنب الحالية: عدد الأنوار بيتغير = كل خامات المدينة
      // بتتجهز من الأول في نص السواقة = تهنيجة ~1.5 ث)
      const mine = [];
      this.player.rig.root.traverse((o) => { if (o.isLight && o.visible) { o.visible = false; mine.push(o); } });
      const hid = [];
      v.rig.root.traverse((o) => { if (!o.visible && !o.isLight) { o.visible = true; hid.push(o); } });
      let p;
      try { p = this.renderer.compileAsync(v.rig.root, this.camera, this.scene); } catch (e) { console.warn('[prepare]', e); }
      for (const o of mine) o.visible = true;
      try { await p; } catch { /* */ }
      for (const o of hid) o.visible = false;
    }
  }

  // أحداث الفيزياء: خبطات (صوت + هزة كاميرا) — بتتوصل تاني لو الفيزياء اتعملت من جديد
  _wirePhysics() {
    const ph = this.player.physics;
    // الخبطة الواحدة بتطلع عشرات الأحداث (كل خطوة فيزيا وهي لازقة): بناخد أقوى واحدة بس،
    // والبعجة/الخدش بيتحسبوا بعد الفيزيا مرة واحدة (كانوا سبب اللاج وقت الخبط)
    ph.onImpact = (v, px, pz, other, nx, nz) => {
      // شجرة/عمود كهربا: الخبطة الجامدة (≈16 كم/س+) بتوقّعه ناحية الحركة (قبل فلتر تكرار الخبطات)
      if (other?.kind === 'breakable' && v >= 4.5 && this.world?.breakProp?.(other, ph.vx, ph.vz)) this.hud?.toast(other.inst?.mesh.name === 'kit-pole' ? '⚡ وقّعت عمود كهربا!' : '🌳 وقّعت شجرة!', 2.2);
      const now = performance.now();
      const fresh = now - (this._hitT || 0) > 350;
      if (!fresh && v < (this._hitV || 0) * 1.6) return;
      this._hitT = now; this._hitV = v;
      this.audio.impact(v); this.cams && (this.cams.shake = Math.min(1.5, v / 4));
      // خبطة جامدة (≈ 30 كم/س في حاجة) → حادثة: الركاب بيخافوا والشرطة جاية (مش في السباق، ومش عربية الشرطة نفسها وهي بتطاردك)
      // (حكّة بالجنب في سور/حيطة ثابتة — زي سور الكوبري وانت ماشي جنبه — مش حادثة: لازم الخبطة تبقى بالوش/الضهر
      //  أو جامدة أوي ≈ 43 كم/س عمودي على السور. كانت الركاب بينزلوا يجروا من حكّة في سور الكوبري)
      const [fx, fz] = ph.forward, headOn = nx === undefined || Math.abs(fx * nx + fz * nz) > 0.6;
      const crash = v >= 8.5 && (other?.mass || headOn || v >= 12);
      if (crash && this.started && other !== this.incidents?.col) this.incidents?.trigger('crash', ph, this.player.kind);
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
    if (opts.parked) return this._makeCarBody(type, color, opts);
    const rig = this._makeCarBody(type, color, opts);
    // كل عربية فيها سواق (قاعد على الشمال زي مصر)
    this._driverSeed = (this._driverSeed || 0) + 1;
    // (موديل الهاي إس بتاع المرور دركسيونه يمين، فالسواق قاعد قدامه)
    const seat = type === 'microbus' ? [0.45, 0.92, -1.28] : rig.driverSeat || [-0.37, 0.42, -0.05];
    addDriver(rig.body || rig.root, ...seat, this._driverSeed);
    return rig;
  }

  _makeCarBody(type, color, opts = {}) {
    // موديلات حقيقية (Sketchfab CC BY) لو اتحمّلت: الربع نقل والنقل الخفيف — غير كده الشكل الإجرائي
    if ((type === 'pickup' || type === 'truck') && this.tier !== 'low') {
      const keys = type === 'pickup' ? ['pickup_90s', 'pickup_toyota', 'pickup_p404', 'pickup_datsun', 'pickup_hilux'] : ['truck_canter'];
      const real = keys.map((k) => this.assets.get(k)).filter(Boolean);
      if (real.length) {
        this._realPk = ((this._realPk || 0) + 1) % real.length;
        const car = realTrafficCar(real[this._realPk], color) // (المركونة كمان بلون — كانت بلون الموديل الأصلي: أبيض غالبًا);
        car.lights = null;
        return car;
      }
    }
    if (type === 'bus') {
      // القاهرة/الجيزة: أتوبيس النقل العام بألوانه (متأكدة من صور). باقي المدن: أتوبيس حقيقي (كاروسا، CC BY) لو موجود — غير كده نقل
      if (CTA_MAPS.has(this.mapId || 'shibin')) return buildSmallTraffic('bus');
      const a = this.tier !== 'low' && this.assets.get('bus_karosa');
      if (a) { const car = realTrafficCar(a); car.lights = null; return car; }
      return buildSmallTraffic('truck');
    }
    if (type === 'pickup' || type === 'bus' || type === 'truck' || type === 'moto') return buildSmallTraffic(type);
    if (type === 'tuktuk' || type === 'moto') {
      // التوكتوك: نفس موديل التوكتوك الحقيقي (مخبوز خفيف) بدل الشكل الإجرائي المربع
      const a = this.assets.get('tuktuk_model');
      if (!a) return buildSmallTraffic(type);
      const T = bakeTrafficVersion(a, { tuktuk: true, wheelRe: /^Rin/i });
      const body = new THREE.Group(), wrap = new THREE.Group();
      wrap.add(body);
      const s = new THREE.Mesh(T.solid, T.solidMat); s.castShadow = true; body.add(s);
      if (T.glass) { const gl = new THREE.Mesh(T.glass, T.glassMat); gl.userData.role = 'glass'; gl.renderOrder = 2; body.add(gl); }
      // العجل بيلف (كان مخبوز في الجسم = التوكتوك ماشي كتلة واحدة)
      const wheels = (T.wheels || []).map((W) => {
        const pivot = new THREE.Group(); pivot.position.copy(W.center); body.add(pivot);
        for (const { g, mat } of W.parts) { const m = new THREE.Mesh(g, mat); m.castShadow = true; pivot.add(m); }
        return { group: pivot, spin: pivot, front: W.center.z < 0 };
      });
      return { root: wrap, body, wheels, wheelRadius: 0.225, length: 2.65, width: 1.35, brake: null, driverSeat: [0, 0.55, -0.45] };
    }
    if ((type === 'taxi' || type === 'sedan') && opts.parked) {
      // المركونة: نفس السيدان بخامة مشتركة (مفيش فوانيس شغالة)
      const car = buildSedan({ livery: type === 'taxi' ? 'taxi' : color, lod: 1, seeThrough: false });
      car.brake = null; car.lights = null;
      return car;
    }
    // الملاكي: موديلات عربيات حقيقية منتشرة في مصر لو موجودة (لانوس/فيرنا/صني — tools/models/sketchfab.mjs)،
    // بخاماتها الأصلية ولون الصاج بتاع العربية. التاكسي بيفضل السيدان بألوان تاكسي المحافظة
    if (type === 'sedan' && this.tier !== 'low') { // (الجودة الواطية: السيدان الإجرائي — draw calls أقل)
      const real = (this._realCars ||= ['car_lanos', 'car_verna', 'car_sunny', 'car_corolla_old', 'car_corolla', 'car_fiat128', 'car_peugeot504', 'car_corolla_ke80', 'car_corolla_e70', 'car_lada', 'car_logan', 'car_nexia'].map((k) => this.assets.get(k)).filter(Boolean));
      if (real.length) {
        this._realK = ((this._realK || 0) + 1) % real.length;
        const car = realTrafficCar(real[this._realK], color);
        car.lights = null;
        return car;
      }
    }
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

  /** أونلاين: كل رقم بيبدأ في مكان (9م ورا اللي قبله على نفس الطريق) — كانوا كلهم بيبدأوا فوق بعض */
  _spawnForSeat(seat) {
    const W = this.world;
    if (!W || !(seat > 1)) return;
    const sp = W.spawnPose(), fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw), back = (seat - 1) * 9;
    const p = W.roadPose(sp.x - fx * back, sp.z - fz * back, fx, fz);
    if (!p) return;
    this.player.physics.reset(p.x, p.z, p.yaw); this.player._savePrev();
    this.cams.snap = true;
  }

  async start() {
    await this.audio.start();
    if (this.mp?.available) this._spawnForSeat(this.mp.me.seat);
    this.started = true;
    this.cams.mode = CameraSystem.savedMode(); this.cams.attract = false;
    this.cams.snap = true;
    this.hud.show();
    this.minimap.show();
    if (this.touch) { this.touch.show(); document.getElementById('help').classList.add('hidden'); this.hud.helpTimer = 0; }
    if (this.mobile) document.documentElement.requestFullscreen?.().catch(() => {});
    this.hud.toast(this.mobile ? 'امسك الدركسيون ولفّه، ودوس بنزين' : 'إنت دلوقتي في كرسي السواق — دوس W', 3);
    this.incidents.start(this.player.physics);
    this._prepareVehicles();
    // الميكروباص في شبين: اختار خطك الأول (اللعبة شغالة عادي في الخلفية، واختيار تاني من زرار تغيير الخط)
    if (this.world && this.player.kind === 'microbus' && this.passengers.LINES.length > 1) this.openLinePicker();
  }

  /** وجهة يدوية من الخريطة الكبيرة ({x,z,name}) */
  setUserTarget(t) {
    this.userTarget = t ? { x: t.x, z: t.z, name: t.name } : null;
    this._navT = 0;
    if (t) this.hud.toast(`🧭 الـ GPS: ${t.name}`, 2.2);
  }

  /** انتقال فوري لمكان على الخريطة (زرار "انتقل فورًا"): على أقرب شارع، في الحارة اليمين، والعربية واقفة */
  teleportTo(t) {
    const W = this.world, ph = this.player?.physics;
    if (!W || !ph || !t) return false;
    if (this.passengers.onboard?.length) { this.hud.toast('نزّل الركاب الأول قبل الانتقال', 2.4); return false; }
    const pose = W.roadPose(t.x, t.z);
    if (!pose || Math.hypot(pose.x - t.x, pose.z - t.z) > 80) { this.hud.toast('مفيش شارع قريب من المكان ده', 2.2); return false; }
    ph.reset(pose.x, pose.z, pose.yaw);
    this.player._savePrev();
    W.updateVisibility?.({ x: pose.x, z: pose.z }, this.viewDist || 560);
    this.cams.snap = true;
    this.userTarget = null; this._navT = 0;
    this.hud.toast(`📍 إنت دلوقتي عند: ${t.name}`, 2.4);
    return true;
  }

  /** بداية الوردية: العربية في أول محطة الخط (الموقف) واقفة في العلامة، والباب ناحية الرصيف */
  startLineShift() {
    const P = this.passengers, st = P.lineStops?.[0], ph = this.player.physics;
    if (!st || P.onboard.length) return;
    if (Math.hypot(st.mx - ph.x, st.mz - ph.z) < 40) return;
    for (const sgn of [1, -1]) {
      ph.reset(st.mx, st.mz, Math.atan2(-st.ax * sgn, -st.az * sgn));
      const [fx, fz] = ph.forward; if ((st.x - ph.x) * -fz + (st.z - ph.z) * fx > 0.5) break;
    }
    this.player._savePrev();
    this.world?.updateVisibility?.(this.camera.position, this.viewDist || 560);
    this.cams.snap = true;
    this.hud.toast(`🚏 إنت في ${st.name} — أول الخط. الركاب هيشاوروا لك`, 3);
  }

  openLinePicker() {
    const P = this.passengers;
    if (P.mode !== 'line') return;
    if (P.onboard.length) { this.hud.toast('نزّل الركاب الأول قبل ما تغيّر الخط', 2.4); return; }
    showLinePicker(P.lineOptions(), (i) => {
      if (!P.selectLine(i)) return;
      // أول اختيار (بداية اللعب) بس: العربية بتبدأ في الموقف. بعد كده تغيير الخط مش بينقل العربية —
      // بتفضل مكانها والـ GPS بيوديك لأول الخط
      if (!this._shiftStarted) { this._shiftStarted = true; this.startLineShift(); return; }
      const st = P.lineStops?.[0], ph = this.player.physics;
      if (!st) return;
      this.userTarget = null; this._navT = 0;
      const d = Math.hypot(st.mx - ph.x, st.mz - ph.z);
      this.hud.toast(d < 40 ? `🚏 إنت في ${st.name} — أول الخط` : `🧭 الـ GPS هيوديك لأول الخط: ${st.name} (${d < 1000 ? Math.round(d / 10) * 10 + ' م' : (d / 1000).toFixed(1) + ' كم'})`, 3.2);
    });
  }

  /** سقف الفريمات: على الموبايل 60/120 فريم = كارت شاشة شغال على الآخر = سخونية. الافتراضي 60 (أو 30 لو الجهاز مش ملاحق) */
  get fpsCap() {
    const v = this.settings?.get('fpsCap') ?? 'auto';
    if (v === 'max') return 0;
    if (v !== 'auto' && v !== '45') return +v; // (45 اتشالت: مش سلسة على شاشات 60/120)
    // موفّر البطارية: 30 دايمًا. الكمبيوتر: 60 (شاشات 120 هرتز كانت بترسم 120 فريم = سخونة من غير فايدة)
    if (this.settings?.get('graphics') === 'saver') return 30;
    if (!this.mobile) return 60;
    // الموبايل "تلقائي" = 30 ثابتة: أغلب الموبايلات مابتمسكش 60 في مدينة كاملة، فكانت بتلعب 40–55 فريم بإيقاع
    // مش منتظم مع شاشة 60 (الصورة "بتربش") وبتسخن من محاولة الـ 60. 30 بانتظام = حركة ناعمة وسخونية أقل
    // (اللي عايز 60 يختارها من الإعدادات)
    return 30;
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
    const q = (this._q ||= { t: 0, frames: 0, level: this.mobile ? (this.ios ? 1 : 2) : 0, good: 0, cooldown: 3 });
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
      // (الموبايل بيستنى أطول قبل ما يعلّي: كان بيطلع وينزل كل شوية → الصورة والعمارات البعيدة بتتغير قدامك)
      if (q.good > (this.mobile ? 45 : 8) && q.level > min) { q.level--; q.good = 0; q.cooldown = 4; this._applyQuality(q.level, fps); }
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
    // (كانت 1.5/1.35/1.2/1.0/0.85 — على شاشة 3x المتوسطة كانت بتتمط 2.5 مرة = مبكسلة/مغبشة)
    // (الأوطى كانت 1.15/1.0 = مبكسلة جدًا على شاشات الموبايل الحادة: أقل حاجة دلوقتي 1.3 — بنوفّر من الضل ومسافة الرؤية بدلها)
    // (الآيفون: 2.1 كان بيرسم 4.4 بكسل لكل نقطة × 60 فريم = سخونية؛ 1.8 = 27% بكسلات أقل وفرق شبه مش باين)
    const MPR = this.ios ? [2.0, 1.8, 1.65, 1.5, 1.4] : [1.8, 1.65, 1.55, 1.45, 1.4];
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
    // مسافة الضل: أقصر في الجودة الأقل = حاجات أقل في رسمة الضل (ودقة أحسن في نفس الخريطة)
    { const ext = level >= 4 ? 32 : level >= 3 ? 40 : level >= 2 ? 50 : 60, C = this.env.sun.shadow.camera;
      if (C.right !== ext) { C.left = -ext; C.right = ext; C.top = ext; C.bottom = -ext; C.updateProjectionMatrix(); } }
    const L = Math.max(0, level), far = level < 0 ? 1.25 : [1, 0.95, 0.85, 0.75, 0.65][L];
    this.player.mirrorSkip = [0, 1, 2, 3, 5][L];
    this._qCrowd = [1, 0.9, 0.75, 0.6, 0.5][L] * (this.saver ? 0.8 : 1);
    this._applySetting('crowd', this.settings?.get('crowd') ?? 'normal');
    this.traffic.viewDist = (this.mobile ? 190 : 260) * far;
    this.viewDist = (this.mobile ? 470 : 650) * far; // (العمارات بتبان لمسافة أبعد)
    this.scene.fog.far = Math.min(this.env.preset.fogFar, this.viewDist + 60);
    console.info('[Quality] مستوى', level, `pixelRatio ${pr.toFixed(2)}`, `(${fps.toFixed(0)} FPS)`);
  }


  /** للتجربة: شغّل المحاكاة بسرعة من غير رسم (game.debugSim(3, {throttle:1})) */
  debugSim(seconds, input = {}) {
    const inp = { throttle: 0, brake: 0, steer: 0, handbrake: 0, actions: {}, ...input };
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) {
      const ph = this.player.physics;
      this.world.refY = ph.heave - ph.spec.cgHeight; // زي اللعب الحقيقي بالظبط
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
    if (this.postfx) { this.postfx.setPixelRatio(this.renderer.getPixelRatio()); this.postfx.setSize(window.innerWidth, window.innerHeight); }
    this.mirrorInsets?.resize(window.innerWidth, window.innerHeight);
  }

  /** كثافة المرور = اختيار الإعدادات × وقت اليوم (نهار/عصاري = ساعة ذروة وزحمة، بالليل أخف) */
  _applyTrafficDensity() {
    const base = { off: 0, low: 0.4, normal: 0.85, high: 1 }[this.settings?.get('traffic') ?? 'normal'] ?? 0.7;
    const p = this.env?.preset || {};
    const tk = p.night ? 0.55 : p.elevation < 12 ? 1.35 : 1.2;
    this.traffic?.setDensity?.(Math.min(1, base * tk));
  }

  _onTimeChange(p) {
    this._applyTrafficDensity();
    const night = !!p.night;
    this._night = night || p.elevation < 8;
    this.postfx?.setNight(this._night);
    this.player.setNight(night || p.elevation < 8);
    this.traffic?.setNight(night || p.elevation < 8);
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
    // البنزين خلص: جركن طوارئ (مرة كل نص دقيقة لو قلت "استنى")
    this._jerryCd = Math.max(0, (this._jerryCd || 0) - dt);
    this._emptyT = this.fuel.empty && ph.speed < 0.3 ? (this._emptyT || 0) + dt : 0;
    if (this._emptyT > 2 && !this._jerryCd && !this.hud.cardOpen) {
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

  setVehicle(kind) {
    if (!this.player || this.player.kind === kind) return;
    const o = this.player.physics, at = { x: o.x, z: o.z, yaw: o.yaw };
    const moved = this.started;
    // العربية الحالية بتتشال من المشهد بس (بتفضل محفوظة)، والجديدة جاهزة من وقت التحميل
    this.player.rig.root.removeFromParent();
    let next = this.vehicles[kind];
    if (!next) {
      next = this.vehicles[kind] = new PlayerVehicle(this.scene, this.assets, { lowPower: this.mobile, kind, ...this._garage() });
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
    this.cams.snap = true;
    next.setNight(!!this._night);
    if (this.settings.get('headlights') !== 'auto') this._applySetting('headlights', this.settings.get('headlights'));
    this.audio.setEngineKind(kind);
    this.diag.set('hiace', kind === 'microbus' ? (next.glbIntegrated ? 'HIACE: LOADED' : 'HIACE: FAILED') : `VEHICLE: ${kind.toUpperCase()}`, 'ok');
    next.syncVisuals(0.016, 1);
    if (next.damage) next.damage.onBreak = () => this.audio.glass();
    this.onVehicleChange?.(kind);
  }

  /** اختيار الجراج (الملاكي: الموديل واللون) */
  _garage() {
    const PAINT = { silver: 0xb9bdc0, white: 0xeeeeea, black: 0x16181b, red: 0x9c1b1b, blue: 0x1d3f7a, beige: 0xcbb68e };
    return { model: this.settings?.get('carModel') || 'car_logan', paint: PAINT[this.settings?.get('carPaint')] ?? PAINT.silver };
  }

  /** الجراج اتغيّر: الملاكي بتتبني من جديد (ولو انت سايقها بتتبدّل في نفس المكان) */
  _rebuildCar() {
    const cur = this.player?.kind === 'car';
    if (this.vehicles?.car) { if (!cur) this.vehicles.car.dispose(); delete this.vehicles.car; }
    if (this.insets) delete this.insets.car; // (المرايات اللي على حرف الشاشة متربطة بالعربية القديمة)
    if (cur) { const keep = this.player; this.player = { kind: 'none', rig: keep.rig, physics: keep.physics }; this.setVehicle('car'); keep.dispose(); }
  }

  /** المؤثرات السينمائية (PostFX.js): تلقائي = الكمبيوتر على الجودة العالية/الألترا بس */
  _applyPostFX() {
    const v = this.settings?.get('postfx') || 'auto', g = this.settings?.get('graphics') || 'auto';
    const on = v === 'on' || (v === 'auto' && !this.mobile && !this.saverBoot && (this.tier === 'high' || g === 'high' || g === 'ultra'));
    if (on && !this.postfx) {
      this.postfx = new PostFX(this.renderer, this.scene, this.camera, { ao: !this.mobile });
      this.postfx.setSize(window.innerWidth, window.innerHeight);
      this.postfx.setNight(!!this._night);
    } else if (!on && this.postfx) { this.postfx.dispose(); this.postfx = null; }
  }

  _applyLivery(P, v) {
    if (P.kind !== 'microbus' || !P.rig.dims || !P.rig.shell) return;
    if (!P._liv) P._liv = applyLivery(P.rig, v); else P._liv(v);
  }

  /**
   * مكان العين اللي اتطلب (ظبط الكرسي) لازم يفضل جوه الكابينة: لو الكرسي لورا/لفوق أوي العين كانت بتطلع
   * جوه جسم العربية (الشاشة كلها لون العربية — "شاشة خضرا") أو جوه مسند الكرسي، وأول ما تدوس بنزين الراس
   * بترجع لورا كمان. بنمد شعاع من مكان العين الأصلي للمكان المطلوب ونقف قبل أي سطح، ونسيب مسافة أمان حواليها
   * (لورا: قصور الراس مع البنزين، ولفوق، وللجناب).
   */
  _clearEye(rig, want) {
    const par = rig.eye.parent;
    par.updateWorldMatrix(true, false);
    const meshes = [];
    rig.root.traverse((o) => { if (o.isMesh && o.visible && o !== this.passengers?.seatedMesh) meshes.push(o); });
    const sides = new Map();
    for (const m of meshes) for (const mat of [].concat(m.material)) if (mat && !sides.has(mat)) { sides.set(mat, mat.side); mat.side = THREE.DoubleSide; }
    const rc = (this._eyeRc ||= new THREE.Raycaster());
    const W = (v) => v.clone().applyMatrix4(par.matrixWorld);
    const hit = (fromL, dirL, len) => {
      const a = W(fromL), b = W(fromL.clone().addScaledVector(dirL, len));
      const d = b.sub(a); const L = d.length(); if (L < 1e-4) return null;
      rc.set(a, d.divideScalar(L)); rc.far = L; rc.near = 0;
      const h = rc.intersectObjects(meshes, false)[0];
      return h ? h.distance / L * len : null;
    };
    const base = rig.eyeBase.clone(), pos = want.clone();
    try {
      // 1) من العين الأصلية للمكان المطلوب: نقف قبل أول سطح بـ 8 سم
      const dir = pos.clone().sub(base), len = dir.length();
      if (len > 1e-3) { dir.divideScalar(len); const t = hit(base, dir, len + 0.08); if (t !== null) pos.copy(base).addScaledVector(dir, Math.max(0, t - 0.08)); }
      // 2) مسافة أمان: لورا 12 سم (الراس بترجع مع البنزين)، فوق 10، الجناب 9، قدام 6
      const M = [[new THREE.Vector3(0, 0, 1), 0.12], [new THREE.Vector3(0, 1, 0), 0.1], [new THREE.Vector3(1, 0, 0), 0.09], [new THREE.Vector3(-1, 0, 0), 0.09], [new THREE.Vector3(0, 0, -1), 0.06]];
      //    (الدفع عمره ما يعدّي مكان العين الأصلي: الوضع الافتراضي زي ما هو)
      for (let it = 0; it < 2; it++) for (const [d, m] of M) {
        const t = hit(pos, d, m); if (t === null) continue;
        for (const ax of ['x', 'y', 'z']) {
          if (!d[ax]) continue;
          const nv = pos[ax] - d[ax] * (m - t);
          pos[ax] = d[ax] > 0 ? Math.max(nv, Math.min(base[ax], pos[ax])) : Math.min(nv, Math.max(base[ax], pos[ax]));
        }
      }
    } finally {
      for (const [mat, s] of sides) mat.side = s;
    }
    return pos;
  }

  /** تطبيق إعداد (عند البداية ولما يتغير من اللوحة) */
  _applySetting(k, v) {
    switch (k) {
      case 'vehicle': this.setVehicle(v); break;
      case 'mirrorInsets': this.mirrorInsets.mode = v; break;
      case 'keySteer': this.player.physics.keySens = +v; break;
      case 'seat': case 'seatH': case 'seatZ': {
        // مكان العين = الكرسي (قريب/عادي/لورا) + ظبط دقيق (ارتفاع، لقدام/لورا) — الكاميرا بتتنقل له بنعومة
        const rig = this.player.rig;
        if (rig.eyeBase) {
          const o = { near: [-0.16, -0.03], normal: [0, 0], back: [0.14, 0.04] }[this.settings.get('seat')] || [0, 0];
          const h = (this.settings.get('seatH') || 0) / 100, zf = (this.settings.get('seatZ') || 0) / 100;
          rig.eye.position.copy(this._clearEye(rig, new THREE.Vector3(rig.eyeBase.x, rig.eyeBase.y + o[1] + h, rig.eyeBase.z + o[0] + zf)));
        }
        break;
      }
      case 'mirrorQuality': this.player.setMirrorQuality(this.saver ? 'saver' : v); break;
      case 'livery': for (const P of Object.values(this.vehicles || {})) this._applyLivery(P, v); break;
      case 'graphics': {
        const fixed = { saver: 4, low: 3, med: 2, high: 0, ultra: -1 }[v];
        this.saver = v === 'saver';
        this.player.setMirrorQuality(this.saver ? 'saver' : this.settings.get('mirrorQuality'));
        if (this.saver && this.settings.get('crowd') !== 'low') this._applySetting('crowd', this.settings.get('crowd'));
        const q = (this._q ||= { t: 0, frames: 0, level: this.mobile ? (this.ios ? 1 : 2) : 0, good: 0, cooldown: 3 });
        if (fixed !== undefined) { q.level = fixed; this._applyQuality(fixed, this.fps || 0); }
        else { q.level = this.mobile ? (this.ios ? 1 : 2) : 0; q.cooldown = 2; this._applyQuality(q.level, this.fps || 0); }
        break;
      }
      case 'postfx': this._applyPostFX(); break;
      case 'carModel': case 'carPaint': this._rebuildCar(); break;
      case 'shadows': this._applyQuality(this._q?.level || 0, this.fps || 0); break;
      case 'timeOfDay': if (this.env.presetName !== v) this.env.setPreset(v); break;
      case 'headlights':
        if (v === 'auto') this.player.setHeadlights(!!this.player._night); else this.player.setHeadlights(v === 'on');
        this.touch?.setLights(this.player.headOn);
        break;
      case 'masterVol': case 'engineVol': this.audio.setVolumes(this.settings.get('masterVol') / 100, this.settings.get('engineVol') / 100); break;
      case 'traffic': this._applyTrafficDensity(); break;
      case 'crowd': this.crowd?.setCount(this.crowdBase * ({ low: 0.45, normal: 1, high: 1.6 }[v] ?? 1) * (this._qCrowd ?? 1)); break;
      default: break;
    }
  }

  _frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    let input = this.started ? this.input.read() : { throttle: 0, brake: 0, steer: 0, handbrake: 1, actions: {} };
    // الشرطة جاية بعد حادثة / الشرطة مسكتك ومدفعتش: العربية واقفة (الدركسيون بس)
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
      this.world.refY = ph.heave - ph.spec.cgHeight;
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
      if (ph.flipped) this.incidents.trigger('flip', ph, this.player.kind);
      this.hud.toast(this.mobile ? 'العربية اتقلبت! دوس زرار ↺ عشان تعدلها' : 'العربية اتقلبت! دوس R عشان تعدلها', 4);
      this.touch?.root.querySelector('[data-act="reset"]')?.classList.add('lit');
    }

    this.lights.update(dt);
    this.traffic.update(dt, this.player, this.camera.position);
    if (this.world?.rail) { this.world.rail.audio ||= this.audio; this.world.rail.update(dt, this.camera.position); }
    this.route.update(dt);
    this._visTimer = (this._visTimer || 0) - dt;
    if (this._visTimer <= 0) {
      this._visTimer = 0.25;
      this.route.updateVisibility(this.camera.position, this.viewDist || (this.mobile ? 380 : 560));
      this.player.surface = surfaceAt(ph.x, ph.z);
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
    }
    this.player.syncVisuals(dt, this.acc / FIXED_DT);
    this.cams.update(dt, input);
    this.cine?.update(dt, this.camera);
    if (this.player.driver) this.player.driver.visible = this.cams.mode !== 0;
    // إيدين السواق على الجادون بتبان من الكابينة بس (من برا الموديل بتاع السواق هو اللي باين)
    if (this.player.rig.hands) this.player.rig.hands.visible = this.cams.mode === 0;
    this.crowd.update(dt, this.camera.position, this.player.physics, this.camera.getWorldDirection(this._camDir || (this._camDir = new THREE.Vector3())));
    this.emergency?.update(dt, this.camera.position);
    this.passengers.camPos = this.camera.position;
    if (this.started) this.passengers.update(dt, ph);
    // البنزين، الرخص، الكماين، والبنزينة
    if (this.started) {
      this.fuel.update(dt, ph);
      this.licenses.update(dt);
      this.police.update(dt, ph, this.player.kind, this.clock.elapsedTime);
      this.incidents.update(dt, ph);
      // (الدورية بتاعة المرور بتقف وإنت سايق البوكس — الحوادث بقت مهماتك إنت)
      if (this.player.kind !== 'police') this.patrol?.update(dt, ph);
      // السارينة (الإسعاف/البوكس): بإيدك (G / الزرار) أو لوحدها وقت المهمة. بتشغّل الصوت والكشاف، والمرور بيفسح
      {
        const k = this.player.kind, em = k === 'police' || k === 'ambulance';
        const PM = this.policeMission, AM = this.ambulanceMission;
        const auto = (k === 'police' && PM?.state === 'chase') || (k === 'ambulance' && (AM?.state === 'toCase' || AM?.state === 'toHosp'));
        const on = em && (this._sirenManual ?? auto);
        if (!em) this._sirenManual = undefined;
        this.player.sirenOn = on;
        this.audio.playerSiren?.(on, k === 'police' ? 'police' : 'ambulance');
        document.body.classList.toggle('emergency', em); document.body.classList.toggle('siren-on', !!on);
      }
      this.policeMission?.update(dt, ph, this.player);
      this.ambulanceMission?.update(dt, ph, this.player);
      if (!this.incidents.busy) this.intercity?.update(dt, ph, this.player.kind);
      this.works?.userData.update(dt, ph.x, ph.z);
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
        const pm = this.policeMission?.navTarget() || this.ambulanceMission?.navTarget();
        if (this.player.kind === 'police') this.hud.policeJob = this.policeMission?.jobInfo();
        if (this.player.kind === 'ambulance') this.hud.ambJob = this.ambulanceMission?.jobInfo();
        const lowFuel = this.fuel.frac < 0.15 && !this.passengers.trip && !this.passengers.onboard.length;
        this.hud.navOverride = pol ? 'police' : lowFuel ? 'fuel' : null;
        // "اذهب إلى هنا" من الخريطة: بيخلص لما توصل (أو لو ركب زبون/الكمين)
        const ut = this.userTarget;
        if (ut && Math.hypot(ut.x - ph.x, ut.z - ph.z) < 22) { this.hud.toast(`📍 وصلت: ${ut.name}`, 2.4); this.userTarget = null; }
        if (this.userTarget && this.passengers.trip) this.userTarget = null; // زبون التاكسي له الأولوية
        this.nav.setTarget(pol || pm || this.userTarget || (this.passengers.navTarget(ph)));
        this.hud.setNav(this.nav.info);
        this.hud.setFuel(this.fuel.frac);
        const P = this.player, info = this.nav.info, job = this.passengers.jobInfo();
        P.navCanvas = this.minimap.navCv;
        P.navTitle = job.mode === 'line' ? job.title : job.dest ? `📍 ${job.dest}` : '';
        P.navLine = job.mode === 'line' ? `المحطة الجاية: ${job.next}` : job.dest ? `${info ? fmtDist(info.remain) + ' · ' : ''}الأجرة ${job.fare} ج` : '';
      }
      this.nav.update(dt, ph);
    }
    // (الشمس بتتحرك بس في فريم رسم خريطة الضل — تحت)
    this.env.update(this.player.rig.root.position, (((this._shadowTick || 0) + 1) % (this.shadowEvery || 1)) === 0);

    // أقرب أعمدة نور بالليل
    this.lampTimer -= dt;
    if (this.saver && this.lampLights.length && this.lampLights[0].intensity) for (const l of this.lampLights) l.intensity = 0;
    if (this.lampTimer <= 0 && this.env.preset.lampsOn && !this.saver) {
      this.lampTimer = 0.4;
      // أقرب N أعمدة (اختيار من غير ما نعمل مصفوفات جديدة كل مرة)
      const c = this.camera.position, L = this.lampLights, n = L.length;
      const best = (this._lampBest ||= new Array(n).fill(null)), bd = (this._lampD ||= new Float64Array(n));
      bd.fill(Infinity);
      for (const p of this.world.lamps.near) {
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
    // الكلاكس: اللي قدامك بيستجيب (يسرّع/يفسحلك حارة/الميكروباص يخلّص تحميل)، واللي بيعدّي الشارع بيستعجل
    if (input.actions?.siren) {
      const k = this.player.kind;
      if (k === 'police' || k === 'ambulance') { this._sirenManual = !this.player.sirenOn; this.hud.toast(this._sirenManual ? '🚨 السارينة شغالة — العربيات هتفسحلك' : 'السارينة اتقفلت', 1.8); }
      else this.hud.toast('السارينة في الإسعاف والبوكس بس', 1.6);
    }
    if (input.horn) { this._hornT = (this._hornT || 0) - dt; if (this._hornT <= 0) { this._hornT = 0.6; this.traffic.honked?.(this.player.physics); this.crowd?.honked?.(this.player.physics); } } else this._hornT = 0;
    this.audio.update(dt, { player: this.player, camera: this.camera, traffic: this.traffic, inside, horn: input.horn, passengers: this.passengers?.count, crowd: this.crowd });
    this.hud.update(dt, ph, this.lights);
    if (this.touch) this.touch.update(ph.steeringWheelAngle);

    if (inside) this.player.renderMirrors(this.renderer, this.scene, this.camera.position);
    this.diag.update(dt, this.player, inside);
    try { this.mp.update(dt); } catch (e) { if (!this._mpErr) { this._mpErr = 1; console.warn('[MP]', e); } } // اللعب الجماعي مايوقفش اللعبة لو فيه خطأ
    this.minimap.update(dt);
    // الضل: بيتحدّث كل فريم في الجودة العالية، وكل 2-3 فريمات في الواطية (أخف بكتير ومفيش إعادة بناء شيدرز)
    const sm = this.renderer.shadowMap;
    this._shadowTick = ((this._shadowTick || 0) + 1) % (this.shadowEvery || 1);
    sm.autoUpdate = false;
    if (this._shadowTick === 0) sm.needsUpdate = true;
    if (this.postfx) this.postfx.render(dt); else this.renderer.render(this.scene, this.camera);
    if (this.mirrorInsets.update(this.camera, inside && this.started)) this.mirrorInsets.render(this.renderer);
  }
}

const CTA_MAPS = new Set(['cairo', 'cairo_east', 'giza']);
export { CAMERA_MODES };
