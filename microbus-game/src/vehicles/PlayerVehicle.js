import * as THREE from 'three';
import { VehiclePhysics, MICROBUS_SPEC, TAXI_SPEC_BASE, TUKTUK_SPEC_BASE } from '../physics/VehiclePhysics.js';
import { buildTaxiRig, buildTuktukRig } from './PlayerRigs.js';
import { buildRealRig, REAL_KINDS } from './RealRigs.js';
import { buildMicrobus } from './MicrobusModel.js';
import { analyzeVehicle, specFromModel, integrateHiace } from './HiaceIntegration.js';
import { Damage } from './Damage.js';
import { addBobbleDog, updateBobbles } from './CabAccessories.js';
import { groundHeight } from '../world/ground.js';
import { addDriver } from '../world/Pedestrians.js';

// الميكروباص بتاع اللاعب: بيربط الفيزياء بالموديل (عجل، دركسيون، عدادات، دواسات، فتيس، فرامل يد، سبحة، مرايات)

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const GEAR_POS = { '-1': [0.05, -0.06], 0: [0, 0], 1: [-0.05, 0.06], 2: [-0.05, -0.06], 3: [0, 0.06], 4: [0, -0.06], 5: [0.05, 0.06] };

function deepClone(root) {
  const c = root.clone(true);
  const mats = new Map();
  c.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = o.geometry.clone();
    if (!mats.has(o.material)) mats.set(o.material, o.material.clone());
    o.material = mats.get(o.material);
  });
  return c;
}

export class PlayerVehicle {
  /** خريطة حقيقية (لو مختارة): مكان البداية والرجوع للطريق بيبقى منها */
  static world = null;

  constructor(scene, assets, opts = {}) {
    this.scene = scene;
    this.lowPower = !!opts.lowPower;
    this.kind = opts.kind || 'microbus';
    this.prev = { x: 0, z: 0, yaw: 0, heave: 0, pitch: 0, roll: 0 };
    this.gearVis = new THREE.Vector2();
    this.hbVis = 0;
    this.glbSteering = null;
    // ملاكي/ربع نقل/نقل/أتوبيس: من الموديل الحقيقي (لو مش متحمّل: تاكسي بداله)
    const real = REAL_KINDS[this.kind] ? buildRealRig(this.kind, assets, { model: opts.model, paint: opts.paint }) : null;
    if (REAL_KINDS[this.kind] && !real) this.kind = 'taxi';
    if (real) {
      this.physics = new VehiclePhysics(real.spec, groundHeight);
      this.rig = real.rig;
      scene.add(this.rig.root);
    } else if (this.kind === 'taxi' || this.kind === 'tuktuk') {
      const spec = { ...MICROBUS_SPEC, ...(this.kind === 'taxi' ? TAXI_SPEC_BASE : TUKTUK_SPEC_BASE) };
      this.physics = new VehiclePhysics(spec, groundHeight);
      this.rig = this.kind === 'taxi' ? buildTaxiRig(spec, assets) : buildTuktukRig(spec, assets);
      scene.add(this.rig.root);
    } else {
      this.physics = new VehiclePhysics(MICROBUS_SPEC, groundHeight);
      this.rig = buildMicrobus({ interior: true });
      scene.add(this.rig.root);
      this._applyGLB(assets?.get('microbus'), assets?.status?.microbus);
    }
    this._archLiners();
    this._setupMirrors();
    this._setupHeadlights();
    if (this.glbIntegrated) this.damage = new Damage(this);
    // السواق (إنت): بيبان من الكاميرا اللي برا بس، ومن كرسي السواق بيختفي عشان مايغطيش الرؤية
    const eye = this.rig.eye;
    if (eye?.parent) {
      const ds = this.rig.driverSeat; // مكان قعدة السواق لو الريج محدده (التوكتوك: كرسي عالي)
      this.driver = ds ? addDriver(eye.parent, eye.position.x, ds.y, eye.position.z + (ds.dz ?? 0.1), 3, ds.knee) : addDriver(eye.parent, eye.position.x, eye.position.y - 0.78, eye.position.z + 0.1, 3);
      this.driver.castShadow = true;
    }
    this.reset(true);
  }

  // ===== الهاي إس (GLB) — هو عربية اللاعب الوحيدة. مفيش رجوع للميكروباص القديم المتبني بالمكعبات =====
  _applyGLB(asset, status) {
    const fail = (msg) => {
      this.hiaceError = msg;
      this.rig.shell.visible = false; // منخبّيش الفشل بعربية تانية
      this.rig.mirrors = [];
      console.error('[HiAce] FAILED:', msg);
    };
    if (!asset) return fail(status?.error || 'microbus.glb was not loaded');
    // التركيب بيعدّل الموديل نفسه (قص الصالون، فصل الباب...) → كل مرة نشتغل على نسخة جديدة من الأصل
    if (!asset._pristine) asset._pristine = deepClone(asset.holder);
    if (asset._used) asset = { ...asset, holder: deepClone(asset._pristine) };
    asset._used = true;
    try {
      const A = analyzeVehicle(asset.holder);
      if (!A.ok) return fail('could not detect the 4 wheels in the model');
      const spec = specFromModel(MICROBUS_SPEC, A);
      this.physics = new VehiclePhysics(spec, groundHeight);
      this.rig.shell.position.y = -spec.cgHeight;
      integrateHiace(this.rig, asset, spec, A);
      if (this.rig.dims) spec.roofHeight = this.rig.dims.roofY;
      this.glbIntegrated = true;
      console.info('[HiAce] wheelBase', A.wheelBase.toFixed(2), 'track', A.track.toFixed(2), 'R', A.radius.toFixed(3), 'body', (spec.halfLength * 2).toFixed(2), 'x', (spec.halfWidth * 2).toFixed(2));
    } catch (e) {
      fail('integration error: ' + (e?.message || e));
    }
  }

  /** بطانة سودا جوه رفارف العجل: من برا وتحت العربية مايبانش صاج فاتح/فراغ فوق الكاوتش */
  _archLiners() {
    const sp = this.physics.spec, R = sp.wheelRadius, rig = this.rig;
    if (this.kind === 'tuktuk') return; // التوكتوك رفارفه مفتوحة (زي الحقيقي)
    const mat = (PlayerVehicle._linerMat ||= new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95, side: THREE.DoubleSide }));
    const w0 = this.kind === 'microbus' ? 0.34 : 0.28, rr = this.kind === 'microbus' ? R + 0.12 : R + 0.07;
    for (const w of rig.wheels) {
      if (!w.group || !w.group.parent || w.group.children.length === 0) continue;
      // الميكروباص: رفرف الموديل بيقفل فوق خط نص العجلة بشوية، فالبطانة نص دايرة بس (لو نزلت أكتر بتطلع برا الجسم تحت كحلقة سودا طايرة)
      const a0 = this.kind === 'microbus' ? -Math.PI * 0.02 : -Math.PI * 0.12, aL = Math.PI - 2 * a0;
      // البطانة جوه عرض الجسم بس (لو أعرض بتخرق الصاج من الجنب وتبان حلقة سودا على الدهان)
      const ax = Math.abs(w.group.position.x), inner = ax - w0 / 2, outer = Math.min(ax + w0 / 2, (rig.dims?.HW || 9) - 0.03);
      const geo = new THREE.CylinderGeometry(rr, rr, outer - inner, 22, 1, true, a0, aL).rotateZ(Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      // shell أصله على الأرض: مركز العجلة على ارتفاع R
      m.position.set(Math.sign(w.group.position.x) * (inner + outer) / 2, R + 0.01, w.group.position.z);
      m.receiveShadow = true;
      m.userData.role = 'liner';
      rig.shell.add(m);
    }
  }

  // ===== المرايات (Render to texture حقيقي) =====
  _setupMirrors() {
    this.mirrorCams = [];
    const eyeLocal = this.rig.eye ? this.rig.eye.position.clone() : new THREE.Vector3(-0.45, 1.8, -0.8);
    for (const m of this.rig.mirrors) {
      const aspect = m.aspect || 0.7;
      const rt = new THREE.WebGLRenderTarget(aspect > 1 ? 512 : 320, aspect > 1 ? Math.round(512 / aspect) : 448, { samples: 2 });
      rt.texture.repeat.x = -1; rt.texture.offset.x = 1; // انعكاس أفقي
      m.face.material = new THREE.MeshBasicMaterial({ map: rt.texture, toneMapped: true });
      // نوجّه المراية بحيث السواق يشوف اللي وراه
      const pos = m.holder.position.clone();
      const toEye = eyeLocal.clone().sub(pos).normalize();
      // المرايات الجانبية متظبطة لبره شوية (جنب العربية يبان شريط رفيع بس، زي السواق الحقيقي)
      const rear = new THREE.Vector3(m.side * (this.glbIntegrated ? 0.2 : 0.06), m.side ? -0.07 : -0.02, 1).normalize();
      const n = toEye.add(rear).normalize();
      m.holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const cam = new THREE.PerspectiveCamera(m.fov || 22, aspect, m.side === 0 ? 0.6 : 0.3, m.side === 0 ? 70 : 130);
      this.mirrorCams.push({ m, rt, cam, renders: 0, error: null, blank: false, checked: false });
    }
    this._mirrorFrame = 0;
  }

  renderMirrors(renderer, scene, cameraPos) {
    for (let k = 0; k < (this.mirrorsPerFrame || 1); k++) this._renderOneMirror(renderer, scene, cameraPos, k);
  }

  _renderOneMirror(renderer, scene, cameraPos, k) {
    if (!this.mirrorCams.length) return;
    // على الموبايل/الجودة الأقل: المرايات بتتحدّث كل كام فريم
    const skip = (this.mirrorSkip || 0) + (this.mirrorQualitySkip ?? (this.lowPower ? 1 : 0));
    if (k === 0 && skip && (this._skipN = ((this._skipN || 0) + 1) % (skip + 1)) !== 0) { this._skipFrame = true; return; }
    if (k > 0 && this._skipFrame) return;
    this._skipFrame = false;
    // الجانبية ليها الأولوية: شمال، يمين، شمال، يمين، الداخلية
    if (!this._order) {
      const L = this.mirrorCams.findIndex((c) => c.m.side === -1), R = this.mirrorCams.findIndex((c) => c.m.side === 1), I = this.mirrorCams.findIndex((c) => c.m.side === 0);
      this._order = [L, R, L, R, I].filter((k) => k >= 0);
    }
    const mc = this.mirrorCams[this._order[this._mirrorFrame++ % this._order.length]];
    const { m, rt, cam } = mc;
    const facePos = m.face.getWorldPosition(_v1);
    const n = _v2.set(0, 0, 1).applyQuaternion(m.face.getWorldQuaternion(_q1));
    const d = _v3.copy(facePos).sub(cameraPos).normalize();
    const r = d.sub(n.multiplyScalar(2 * d.dot(n)));
    cam.position.copy(facePos);
    cam.up.set(0, 1, 0);
    cam.lookAt(_v4.copy(facePos).add(r));
    // المرايات مش محتاجة تعيد رسم خريطة الضلال (أغلى جزء) — بتستخدم بتاعة الفريم
    const sAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    // المراية رؤية ثانوية: مسافة رسم أقصر حسب الجودة، ومن غير اللي مايفرقش فيها:
    // صالون العربية نفسها (~45 draw call) في المرايات الجانبية، وديكور الليل (هالات/بقع النور) والحاجات اللي Game بيحددها
    cam.far = Math.min(m.side === 0 ? 70 : 130, this.mirrorFar || 130);
    if (cam.far !== mc._far) { mc._far = cam.far; cam.updateProjectionMatrix(); }
    const hide = this._mirrorHideList || (this._mirrorHideList = []);
    hide.length = 0;
    if (m.side !== 0 && this.rig.interiorGroup?.visible) hide.push(this.rig.interiorGroup);
    for (const o of this.mirrorHide || PlayerVehicle.mirrorHide || []) if (o?.visible) hide.push(o);
    for (const o of hide) o.visible = false;
    try {
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      for (const o of hide) o.visible = true;
      renderer.shadowMap.autoUpdate = sAuto;
      mc.renders++;
      mc.error = null;
      // مرة واحدة: نتأكد إن الصورة اللي في المراية مش فاضية — في وضع التشخيص (#debug) بس:
      // قراية البكسلات من كارت الشاشة بتوقف المعالج لحد ما الكارت يخلّص كل اللي قبلها (تهنيجة أول السواقة)
      if (!mc.checked && mc.renders >= 4 && /debug/.test(location.hash)) {
        mc.checked = true;
        const px = new Uint8Array(4 * 16);
        renderer.readRenderTargetPixels(rt, (rt.width >> 1) - 2, (rt.height >> 1) - 2, 4, 4, px);
        let mx = 0, mn = 255;
        for (let k = 0; k < px.length; k += 4) { const v = px[k] + px[k + 1] + px[k + 2]; mx = Math.max(mx, v); mn = Math.min(mn, v); }
        mc.blank = mx === 0;
      }
    } catch (e) {
      for (const o of hide) o.visible = true;
      renderer.setRenderTarget(null);
      renderer.shadowMap.autoUpdate = sAuto;
      mc.error = e?.message || String(e);
    }
  }

  /** جودة المرايات: low | med | high (دقة الصورة + كل كام فريم بتتحدّث) */
  setMirrorQuality(q) {
    const scale = { saver: 0.45, low: 0.55, med: 0.78, high: 1 }[q] || 1;
    // كل ما الجودة أعلى المرايات بتتحدّث أكتر (العربيات اللي ورا بتتحرك أنعم).
    // (العالي كان بيرسم مرايتين كل فريم = المشهد 3 مرات في الفريم → سخونة؛ دلوقتي مراية واحدة كل فريم بالتبادل)
    this.mirrorQualitySkip = { saver: 2, low: 1, med: 1, high: 0 }[q] ?? 0;
    this.mirrorsPerFrame = 1;
    this.mirrorFar = { saver: 55, low: 70, med: 95, high: 130 }[q] || 130;
    for (const mc of this.mirrorCams || []) {
      mc.base ||= [mc.rt.width, mc.rt.height];
      mc.rt.setSize(Math.round(mc.base[0] * scale), Math.round(mc.base[1] * scale));
    }
  }

  _setupHeadlights() {
    // الكشافات: 2 SpotLight بالظبط لكل عربية (نفس العدد في كل العربيات → التبديل مايعيدش بناء الشيدرز)،
    // طالعين من مكان الفانوس الحقيقي (rig.lamps) ومتوصّلين بجسم العربية فبيلفوا معاها.
    // دايمًا visible وبنغيّر الشدة بس (مفيش تقطيع لما تولّعها)
    this.headlights = [];
    const sp = this.physics.spec, D = this.rig.dims, front = D ? D.frontF : 2.55, rear = D ? -D.rearF : 2.4;
    const heads = this.rig.lamps?.head || [[-0.62, 0.92, -front + 0.05], [0.62, 0.92, -front + 0.05]];
    const pair = heads.length === 1 ? [[heads[0][0] - 0.05, heads[0][1], heads[0][2]], [heads[0][0] + 0.05, heads[0][1], heads[0][2]]] : heads;
    for (const [x, y, z] of pair) {
      const l = new THREE.SpotLight(0xfff0d6, 0, 95, 0.46, 0.65, 1.25);
      l.position.set(x, y - sp.cgHeight, z - 0.05);
      l.target.position.set(x * 1.6, -sp.cgHeight, z - 32);
      this.rig.body.add(l, l.target);
      this.headlights.push(l);
    }
    // نور الريوس: العربيات اللي ليها فوانيس مرسومة (التاكسي) بتولّع الفانوس نفسه؛ الميكروباص ليه لمبتين
    if (!this.rig.setReverse && this.kind === 'microbus' && D) {
      const rmat = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0, transparent: true, opacity: 0.9, depthWrite: false });
      this.reverseMat = rmat;
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.07), rmat);
        m.position.set(sx * (D.HW - 0.07), 0.6, rear + 0.014);
        this.rig.shell.add(m);
      }
    }
    if (!this.lowPower) {
      const rl = new THREE.SpotLight(0xffffff, 0, 18, 0.9, 0.8, 1.5);
      rl.position.set(0, 0.6 - sp.cgHeight, rear);
      rl.target.position.set(0, -sp.cgHeight, rear + 8);
      this.rig.body.add(rl, rl.target);
      this.reverseLight = rl;
    }
  }

  /** الليل: إضاءة التابلوه + تشغيل الكشافات تلقائيًا */
  /** يافطة الخط ورا الزجاج الأمامي (باينة من برا للركاب، ومن جوه وشها التاني مخفي = مش بتقفل الرؤية) */
  setLineSign(text, color = '#f2c230') {
    const D = this.rig.dims;
    if (this.kind !== 'microbus' || !D?.wsBase) return;
    if (!this._lineSignMesh) {
      this._lineSignCv = document.createElement('canvas'); this._lineSignCv.width = 256; this._lineSignCv.height = 64;
      const t = new THREE.CanvasTexture(this._lineSignCv); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.16), m);
      const [wf, wy] = D.wsBase;
      mesh.position.set((D.HW || 0.9) * 0.45, wy + 0.1, -wf + 0.18);
      mesh.rotation.y = Math.PI; // وشها لقدام (-z)
      mesh.rotation.x = 0.2;
      (this.rig.shell || this.rig.root).add(mesh);
      this._lineSignMesh = mesh;
    }
    const x = this._lineSignCv.getContext('2d');
    x.fillStyle = '#111'; x.fillRect(0, 0, 256, 64);
    x.fillStyle = color; x.fillRect(0, 0, 10, 64); x.fillRect(246, 0, 10, 64);
    x.fillStyle = '#ffe9a8'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    let fs = 34; x.font = `bold ${fs}px Cairo, sans-serif`;
    while (x.measureText(text).width > 225 && fs > 14) { fs -= 2; x.font = `bold ${fs}px Cairo, sans-serif`; }
    x.fillText(text, 128, 34);
    this._lineSignMesh.material.map.needsUpdate = true;
    this._lineSignMesh.visible = !!text;
  }

  setNight(on) {
    this._night = on;
    if (this.rig.gauges) for (const g of Object.values(this.rig.gauges)) g.mat.emissiveIntensity = on ? 0.55 : 0.0;
    if (this.rig.screen) this.rig.screen.emissiveIntensity = on ? 0.9 : 0.35;
    this.rig.cockpit?.setNight?.(on);
    if (this.rig.taxiSignMat) this.rig.taxiSignMat.emissiveIntensity = on ? 0.9 : 0.15;
    this.setHeadlights(on);
  }

  setHeadlights(on) {
    this.headOn = on;
    for (const l of this.headlights) { const ok = on && !l.userData.broken; l.intensity = ok ? 380 : 0; }
    this.rig.lights.head.emissiveIntensity = on ? 3.2 : 0.0;
    if (this.rig.lights.fog) this.rig.lights.fog.emissiveIntensity = on ? 1.5 : 0;
  }

  toggleHeadlights() { this.setHeadlights(!this.headOn); return this.headOn; }

  /** R: رجّع الميكروباص للطريق */
  /** مقلوبة؟ → نعدلها مكانها (الضرر بيفضل). غير كده → نرجع للطريق ونصلّح */
  reset(initial = false) {
    const ph = this.physics;
    const W = PlayerVehicle.world;
    if (initial) {
      const p = W ? W.spawnPose() : { x: 0, z: 0, yaw: 0 };
      ph.reset(p.x, p.z, p.yaw); this._savePrev(); return 'start';
    }
    if (ph.flip.mode) { ph.recover(); this._savePrev(); return 'recover'; }
    this.damage?.repair();
    let { x, z } = ph;
    // أقرب طريق، على الحارة اليمين في نفس اتجاهك
    const [fx, fz] = ph.forward;
    const p = W.roadPose(x, z, fx, fz) || W.spawnPose();
    ph.reset(p.x, p.z, p.yaw); this._savePrev();
    return 'road';
  }

  _savePrev() {
    const ph = this.physics, p = this.prev;
    p.x = ph.x; p.z = ph.z; p.yaw = ph.yaw; p.heave = ph.heave; p.pitch = ph.pitch; p.roll = ph.roll;
  }

  /** قبل كل خطوة فيزياء */
  beforeStep() { this._savePrev(); }

  /** تحديث الشكل (alpha = نسبة الاستيفاء بين آخر خطوتين فيزياء) */
  syncVisuals(dt, alpha = 1) {
    const ph = this.physics, p = this.prev, rig = this.rig;
    const L = (a, b) => a + (b - a) * alpha;
    let dy = ph.yaw - p.yaw;
    rig.root.position.set(L(p.x, ph.x), 0, L(p.z, ph.z));
    rig.root.rotation.y = p.yaw + dy * alpha;
    rig.body.position.y = L(p.heave, ph.heave);
    rig.body.rotation.set(L(p.pitch, ph.pitch), 0, L(p.roll, ph.roll), 'YXZ');

    // العجل
    const R = ph.spec.wheelRadius;
    const tipped = ph.flip.mode === 1;
    for (let i = 0; i < 4; i++) {
      const w = rig.wheels[i], pw = ph.wheels[i];
      if (tipped) {
        // العجل متعلق في الجسم وهو بيتقلب (مدلدل لآخر المساعد)
        _v1.set(pw.rx, R - ph.spec.cgHeight - 0.06, -pw.rf).applyEuler(rig.body.rotation).add(rig.body.position);
        w.group.position.y = _v1.y;
        w.group.position.x = _v1.x; w.group.position.z = _v1.z;
        w.group.rotation.set(rig.body.rotation.x, w.front ? ph.steerAngle : 0, rig.body.rotation.z, 'YXZ');
      } else {
        if (w._tipped) { w.group.position.x = pw.rx; w.group.position.z = -pw.rf; w.group.rotation.set(0, 0, 0); }
        w.group.position.y = pw.centerY;
        if (w.front) w.group.rotation.y = ph.steerAngle;
      }
      w._tipped = tipped;
      w.spin.rotation.x = -pw.spin;
    }
    // ميل الطريق نفسه تحت العجل (من غير هزة المساعدين) — كاميرا السواق بتمشي معاه كامل ومع المساعدين جزء بس
    {
      const W = ph.wheels;
      if (W[0].ground !== undefined) {
        this.groundPitch = Math.atan2((W[0].ground + W[1].ground) / 2 - (W[2].ground + W[3].ground) / 2, ph.spec.wheelBase);
        this.groundRoll = Math.atan2((W[1].ground + W[3].ground) / 2 - (W[0].ground + W[2].ground) / 2, ph.spec.track);
      }
    }
    if (rig.contactShadow) {
      // الضل بيمشي مع ميل الأرض (من ارتفاع الأرض تحت العجل) وبيخف لما العربية تعلى عن الأرض
      const W = ph.wheels;
      const gF = (W[0].ground + W[1].ground) / 2, gR = (W[2].ground + W[3].ground) / 2;
      const gL = (W[0].ground + W[2].ground) / 2, gRt = (W[1].ground + W[3].ground) / 2;
      const cs = rig.contactShadow;
      cs.visible = !tipped && W[0].ground !== undefined;
      if (cs.visible) {
        const gc = (gF + gR) / 2;
        cs.position.y = gc + 0.015;
        cs.rotation.set(Math.atan2(gF - gR, ph.spec.wheelBase), 0, Math.atan2(gRt - gL, ph.spec.track), 'YXZ');
        const lift = rig.body.position.y - ph.spec.cgHeight - gc;
        cs.material.opacity = 0.5 * Math.max(0, 1 - Math.max(0, lift) * 2.5);
      }
      if (rig.wheelShadows) rig.wheelShadows.forEach((b, i) => {
        const pw = W[i];
        b.visible = cs.visible && pw.ground !== undefined;
        if (!b.visible) return;
        b.position.y = pw.ground + 0.02;
        b.material.opacity = Math.max(0, 0.75 - Math.max(0, pw.centerY - pw.ground - ph.spec.wheelRadius) * 6);
        if (rig.wheels[i].front) b.rotation.y = ph.steerAngle;
      });
    }

    // الدركسيون
    const swa = ph.steeringWheelAngle;
    if (rig.steering) rig.steering.rotation.z = swa;
    if (this.glbSteering) {
      const g = this.glbSteering;
      g.node.quaternion.copy(g.q0).multiply(_q2.setFromAxisAngle(g.axis, swa));
    }

    // فوانيس الفرامل + الريوس (لكل العربيات)
    rig.lights.tail.emissiveIntensity = ph.brake > 0.05 || ph.handbrake > 0.1 ? 4 : this._night || this.headOn ? 1.2 : 0.15;
    const rev = ph.gearMode === 'R' ? 1 : 0;
    if (this.reverseMat) this.reverseMat.emissiveIntensity = rev * 2.5;
    rig.setReverse?.(rev);
    if (this.reverseLight) this.reverseLight.intensity = rev * (this._night ? 60 : 15);
    // حرارة الموتور (محاكاة بسيطة): بيبدأ بارد ويسخن مع اللفات لحد ~90°، ولو العربية واقفة يبرد شوية
    {
      const T = (this.engineTemp ??= 32), target = 86 + Math.min(1, ph.rpm / 4200) * 10 - (Math.abs(ph.speed) < 0.5 && ph.rpm < 1200 ? 4 : 0);
      this.engineTemp = T + (target - T) * Math.min(1, dt * (T < target ? 0.012 + ph.rpm / 2.5e5 : 0.02));
    }
    // الكابينة (عدادات ديجيتال/شاشات/جادون...) لو العربية ليها كابينة جديدة
    rig.cockpit?.update?.(dt, ph, this);
    // العدادات بالإبر
    if (rig.gauges) {
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      const needle = (t) => -(a0 + (a1 - a0) * THREE.MathUtils.clamp(t, 0, 1)) - Math.PI / 2;
      rig.gauges.speed.pivot.rotation.z = needle((Math.abs(ph.speed) * 3.6) / (rig.gauges.speed.max || 160));
      rig.gauges.rpm.pivot.rotation.z = needle(ph.rpm / (rig.gauges.rpm.max || 5000));
      if (rig.gauges.fuel) rig.gauges.fuel.pivot.rotation.z = needle(this.fuel ? this.fuel.level / this.fuel.capacity : 0.68);
    }
    // الدواسات
    const k = Math.min(1, dt * 14);
    const P = rig.pedals || { gas: { rotation: {} }, brake: { rotation: {} } };
    P.gas.rotation.x += (-0.4 + ph.throttle * 0.32 - P.gas.rotation.x) * k;
    P.brake.rotation.x += (-0.4 + ph.brake * 0.3 - P.brake.rotation.x) * k;
    if (P.clutch) P.clutch.rotation.x += (-0.4 + (ph.shiftTimer > 0 ? 0.32 : 0) - P.clutch.rotation.x) * k;
    const mode = ph.gearMode;
    if (rig.gearGate) {
      // فتيس أوتوماتيك على التابلوه: P R N D
      const idx = { R: 1, N: 2, D: 3 }[mode];
      const ty = rig.gearGate.top - idx * rig.gearGate.step;
      rig.gearGate.base.position.y += (ty - rig.gearGate.base.position.y) * Math.min(1, dt * 12);
    } else if (rig.gearLever) {
      const gp = GEAR_POS[ph.shiftTimer > 0.15 ? 0 : ph.gear] || [0, 0];
      this.gearVis.x += (gp[0] - this.gearVis.x) * Math.min(1, dt * 10);
      this.gearVis.y += (gp[1] - this.gearVis.y) * Math.min(1, dt * 10);
      rig.gearLever.rotation.set(0.35 - this.gearVis.y * 5, 0, -this.gearVis.x * 5);
    }
    if (rig.gearDisplay && mode !== this._mode) { this._mode = mode; rig.gearDisplay.set(mode); }
    // فرامل اليد
    this.hbVis += (ph.handbrake - this.hbVis) * Math.min(1, dt * 12);
    if (rig.handbrake) rig.handbrake.rotation.x = 0.15 + this.hbVis * 0.5;
    // الحاجات المتعلقة (سبحة، عين زرقا): بندول بيتأثر بالتسارع والميل، كل واحدة بطولها
    const g = 9.81, hdt = Math.min(dt, 0.04);
    for (const h of rig.hangers || [{ obj: rig.sebha, L: 0.2 }]) {
      const s = (h.st ||= { ax: 0, vx: 0, az: 0, vz: 0 }), Lp = h.L;
      s.vx += (-(g / Lp) * Math.sin(s.ax) + -(ph.accelLong / Lp) * Math.cos(s.ax) * 0.8) * hdt; s.vx *= 1 - 1.2 * hdt; s.ax += s.vx * hdt;
      s.vz += (-(g / Lp) * Math.sin(s.az) - (ph.accelLat / Lp) * Math.cos(s.az) * 0.8 + ph.rollVel * 4) * hdt; s.vz *= 1 - 1.2 * hdt; s.az += s.vz * hdt;
      h.obj.rotation.set(s.ax, 0, s.az);
    }
    updateBobbles(rig.bobbles, dt, ph);
  }

  /** يشيل العربية من المشهد (لما تغيّر نوع العربية) */
  dispose() {
    this.rig.root.removeFromParent();
    for (const mc of this.mirrorCams || []) mc.rt.dispose();
  }
}
