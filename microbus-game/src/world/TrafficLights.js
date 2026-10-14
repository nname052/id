import * as THREE from 'three';
import { ROAD, CROSSINGS } from './layout.js';
import { GeoBuilder } from '../render/GeoBuilder.js';

// إشارة مرور حقيقية: أحمر → أخضر → أصفر → أحمر، لمجموعتين (الشارع الرئيسي / الجانبي)
// مع فترة "أحمر للكل" للأمان. عربيات الـ AI بتقرا الحالة من هنا.

const CYCLE = [
  { main: 'green', cross: 'red', t: 20 },
  { main: 'yellow', cross: 'red', t: 3 },
  { main: 'red', cross: 'red', t: 2 },
  { main: 'red', cross: 'green', t: 13 },
  { main: 'red', cross: 'yellow', t: 3 },
  { main: 'red', cross: 'red', t: 2 },
];

const COLORS = { red: 0xff2a1a, yellow: 0xffb000, green: 0x20ff60 };

export class TrafficLights {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'traffic-lights';
    this.time = 4;
    this.phase = 0;
    this.crossing = CROSSINGS.find((c) => c.signal);
    // خامة لكل لون لكل مجموعة
    this.mats = {};
    for (const g of ['main', 'cross']) {
      this.mats[g] = {};
      for (const c of ['red', 'yellow', 'green']) {
        this.mats[g][c] = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: COLORS[c], emissiveIntensity: 0, roughness: 0.25 });
      }
    }
    this.lights = []; // نقطة ضوء صغيرة عند كل إشارة رئيسية
    this._build();
    this._apply();
  }

  state(group) { return CYCLE[this.phase][group]; }
  /** الوقت الباقي في المرحلة الحالية */
  get remaining() { return CYCLE[this.phase].t - this.time; }

  update(dt) {
    this.time += dt;
    if (this.time >= CYCLE[this.phase].t) {
      this.time = 0;
      this.phase = (this.phase + 1) % CYCLE.length;
      this._apply();
    }
  }

  _apply() {
    for (const g of ['main', 'cross']) {
      const s = this.state(g);
      for (const c of ['red', 'yellow', 'green']) {
        const m = this.mats[g][c];
        const on = c === s;
        m.emissiveIntensity = on ? 9 : 0.03;
        m.color.set(on ? COLORS[c] : 0x1a1a1a);
      }
    }
  }

  // كل الأجزاء بتتجمع: هيكل واحد + أعمدة واحد + 6 لمبات (لون × مجموعة) = 8 draw calls بس
  _head(group, x, y, z, ry, scale = 1) {
    const base = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(scale, scale, scale));
    const at = (px, py, pz) => new THREE.Matrix4().multiplyMatrices(base, new THREE.Matrix4().makeTranslation(px, py, pz));
    this.B.housing.addGeometry(new THREE.BoxGeometry(0.36, 1.05, 0.26), base);
    this.B.housing.addGeometry(new THREE.BoxGeometry(0.6, 1.3, 0.03), at(0, 0, -0.14));
    ['red', 'yellow', 'green'].forEach((c, i) => {
      this.B[`${group}-${c}`].addGeometry(this.lampGeo, at(0, 0.33 - i * 0.33, 0.135));
      this.B.housing.addGeometry(this.visorGeo, at(0, 0.33 - i * 0.33 + 0.1, 0.2));
    });
  }

  _build() {
    const c = this.crossing;
    if (!c) return;
    this.housingMat = new THREE.MeshStandardMaterial({ color: 0x1a1d1a, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9a9e9a, roughness: 0.5, metalness: 0.6 });
    this.lampGeo = new THREE.CircleGeometry(0.12, 20);
    this.visorGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.2, 16, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
    this.B = { housing: new GeoBuilder(), poles: new GeoBuilder() };
    for (const g of ['main', 'cross']) for (const col of ['red', 'yellow', 'green']) this.B[`${g}-${col}`] = new GeoBuilder();
    const h = ROAD.sidewalkHeight;
    const pole = (x, z, height = 5.6) => {
      this.B.poles.addGeometry(new THREE.CylinderGeometry(0.09, 0.12, height, 10), new THREE.Matrix4().makeTranslation(x, h + height / 2, z));
    };
    const arm = (x0, z0, x1, z1, y) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, 0, z1 - z0).normalize());
      this.B.poles.addGeometry(new THREE.CylinderGeometry(0.07, 0.08, len, 8), new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, y, (z0 + z1) / 2), q, new THREE.Vector3(1, 1, 1)));
    };
    const cb = ROAD.curb + 0.6;
    // الشارع الرئيسي: اللي رايح -Z (x>0) بيشوف إشارة على يمينه قبل التقاطع + واحدة فوق الحارات
    const zN = c.z + c.half + 4.9, zS = c.z - c.half - 4.9;
    pole(cb, zN, 6.3); arm(cb, zN, 3.5, zN, 6.1);
    this._head('main', cb, h + 3.6, zN, 0);
    this._head('main', 4.6, 5.45, zN, 0);
    this._head('main', cb, h + 3.6, c.z - c.half - 1.0, 0); pole(cb, c.z - c.half - 1.0, 3.1); // إشارة بعد التقاطع
    pole(-cb, zS, 6.3); arm(-cb, zS, -3.5, zS, 6.1);
    this._head('main', -cb, h + 3.6, zS, Math.PI);
    this._head('main', -4.6, 5.45, zS, Math.PI);
    this._head('main', -cb, h + 3.6, c.z + c.half + 1.0, Math.PI); pole(-cb, c.z + c.half + 1.0, 3.1);
    // الشارع الجانبي
    const xW = -(ROAD.curb + 4.6), xE = ROAD.curb + 4.6;
    const zr = c.z + c.half + 0.6, zl = c.z - c.half - 0.6;
    pole(xW, zr, 6.3); arm(xW, zr, xW, c.z + 1.5, 6.1);
    this._head('cross', xW, h + 3.6, zr, -Math.PI / 2);
    this._head('cross', xW, 5.45, c.z + 2.6, -Math.PI / 2);
    pole(xE, zl, 6.3); arm(xE, zl, xE, c.z - 1.5, 6.1);
    this._head('cross', xE, h + 3.6, zl, Math.PI / 2);
    this._head('cross', xE, 5.45, c.z - 2.6, Math.PI / 2);
    // نبني الـ Meshes
    const housing = new THREE.Mesh(this.B.housing.build(), this.housingMat); housing.castShadow = true;
    const poles = new THREE.Mesh(this.B.poles.build(), poleMat); poles.castShadow = true;
    this.group.add(housing, poles);
    for (const g of ['main', 'cross']) for (const col of ['red', 'yellow', 'green']) this.group.add(new THREE.Mesh(this.B[`${g}-${col}`].build(), this.mats[g][col]));
    this.B = null;
  }
}
