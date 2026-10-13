import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { rng } from '../render/textures.js';
import { ROAD, mainSegments } from './layout.js';

// مشاة على الأرصفة: جلابية، حجاب، لبس عادي. Placeholder إجرائي بحركة مشي بسيطة.
// لو حطيت موديل GLB فيه أنيميشن مشي (pedestrian.glb) هيستخدمه بدل كده (شوف ASSETS.md).

const SKIN = [[0.78, 0.6, 0.46], [0.66, 0.48, 0.35], [0.55, 0.4, 0.3], [0.85, 0.68, 0.55]];
const ROBE = [[0.45, 0.42, 0.38], [0.3, 0.3, 0.32], [0.9, 0.9, 0.87], [0.25, 0.3, 0.45], [0.5, 0.4, 0.3]];
const WOMAN = [[0.1, 0.1, 0.12], [0.35, 0.2, 0.3], [0.2, 0.3, 0.4], [0.45, 0.35, 0.3]];
const HIJAB = [[0.85, 0.85, 0.82], [0.5, 0.15, 0.2], [0.2, 0.35, 0.55], [0.75, 0.6, 0.45], [0.12, 0.12, 0.12]];
const SHIRT = [[0.85, 0.85, 0.85], [0.2, 0.35, 0.6], [0.6, 0.15, 0.15], [0.3, 0.45, 0.3], [0.9, 0.75, 0.4]];
const PANTS = [[0.15, 0.17, 0.25], [0.3, 0.3, 0.3], [0.35, 0.28, 0.2]];

const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

function person(R) {
  const type = R() < 0.35 ? 'galabeya' : R() < 0.55 ? 'woman' : 'casual';
  const skin = SKIN[Math.floor(R() * SKIN.length)];
  const pick = (a) => a[Math.floor(R() * a.length)];
  const s = 0.92 + R() * 0.14;
  const body = new GeoBuilder();
  const root = new THREE.Group();
  const top = type === 'galabeya' ? pick(ROBE) : type === 'woman' ? pick(WOMAN) : pick(SHIRT);
  // الجسم
  body.setColor(top);
  if (type === 'casual') body.addGeometry(new THREE.CylinderGeometry(0.17, 0.15, 0.58, 10), M(0, 1.2, 0, 0, 0, 0, 1, 1, 0.65));
  else body.addGeometry(new THREE.CylinderGeometry(0.16, 0.26, 1.28, 12), M(0, 0.82, 0, 0, 0, 0, 1, 1, 0.75));
  body.addGeometry(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(0, 1.46, 0, 0, 0, 0, 1, 0.5, 0.7));
  // الرقبة والراس
  body.setColor(skin);
  body.addGeometry(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8), M(0, 1.55, 0));
  body.addGeometry(new THREE.SphereGeometry(0.105, 12, 10), M(0, 1.67, 0.0, 0, 0, 0, 0.9, 1.08, 1));
  if (type === 'woman') {
    body.setColor(pick(HIJAB));
    body.addGeometry(new THREE.SphereGeometry(0.122, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.75), M(0, 1.68, -0.012, -0.3, 0, 0, 0.95, 1.1, 1.05));
    body.addGeometry(new THREE.CylinderGeometry(0.1, 0.19, 0.22, 12), M(0, 1.5, 0, 0, 0, 0, 1, 1, 0.8));
  } else {
    body.setColor(R() < 0.3 ? [0.6, 0.6, 0.6] : [0.08, 0.06, 0.05]);
    body.addGeometry(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), M(0, 1.69, -0.005));
    if (type === 'galabeya' && R() < 0.4) { body.setColor([0.95, 0.95, 0.93]); body.addGeometry(new THREE.CylinderGeometry(0.11, 0.115, 0.07, 12), M(0, 1.76, 0)); }
  }
  const torso = new THREE.Mesh(body.build(), mat);
  torso.castShadow = true;
  root.add(torso);

  const limb = (color, len, r0, r1) => {
    const g = new GeoBuilder();
    g.setColor(color);
    g.addGeometry(new THREE.CylinderGeometry(r0, r1, len, 7), M(0, -len / 2, 0));
    return g;
  };
  const legs = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.09, 0.9, 0);
    const lg = limb(type === 'casual' ? pick(PANTS) : top, 0.84, 0.07, 0.05);
    lg.setColor([0.1, 0.08, 0.07]);
    lg.addGeometry(new THREE.BoxGeometry(0.09, 0.06, 0.24), M(0, -0.87, 0.05));
    const leg = new THREE.Mesh(lg.build(), mat);
    leg.castShadow = true;
    pivot.add(leg);
    // في الجلابية الرجل مستخبية تحت الجلابية (بيظهر الجزء الأخير بس)
    if (type !== 'casual') leg.scale.set(0.8, 1, 0.8);
    root.add(pivot);
    legs.push(pivot);
  }
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.2, 1.43, 0);
    const ag = limb(top, 0.56, 0.05, 0.045);
    ag.setColor(skin);
    ag.addGeometry(new THREE.SphereGeometry(0.045, 8, 6), M(0, -0.6, 0));
    const arm = new THREE.Mesh(ag.build(), mat);
    arm.castShadow = true;
    pivot.add(arm);
    pivot.rotation.z = sx * 0.08;
    root.add(pivot);
    arms.push(pivot);
  }
  root.scale.setScalar(s);
  return { root, legs, arms, type };
}

export class Pedestrians {
  constructor(scene, assets) {
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    scene.add(this.group);
    this.people = [];
    const R = rng(55);
    const segs = mainSegments(5);
    const glb = assets?.get('pedestrian');
    for (let i = 0; i < 26; i++) {
      const [zs, ze] = segs[Math.floor(R() * segs.length)];
      const side = R() < 0.5 ? -1 : 1;
      const standing = R() < 0.25;
      let p;
      if (glb) {
        const inst = glb.instantiate(R);
        p = { root: inst.root, mixer: inst.mixer, legs: [], arms: [], glb: true };
      } else p = person(R);
      const lane = ROAD.curb + 2.2 + R() * 1.7;
      Object.assign(p, {
        x: side * lane, z: ze + 2 + R() * (zs - ze - 4), zMin: ze + 2, zMax: zs - 2,
        dir: R() < 0.5 ? 1 : -1, speed: standing ? 0 : 0.9 + R() * 0.6, phase: R() * 10, standing,
        heading: 0,
      });
      p.root.position.set(p.x, ROAD.sidewalkHeight, p.z);
      this.group.add(p.root);
      this.people.push(p);
    }
  }

  update(dt, camPos) {
    for (const p of this.people) {
      const far = Math.abs(p.z - camPos.z) > 140;
      p.root.visible = !far;
      if (!p.standing) {
        p.z += p.dir * p.speed * dt;
        if (p.z > p.zMax) { p.dir = -1; } else if (p.z < p.zMin) { p.dir = 1; }
      }
      const targetYaw = p.standing ? (p.x > 0 ? -Math.PI / 2 : Math.PI / 2) : p.dir > 0 ? 0 : Math.PI;
      p.heading += Math.atan2(Math.sin(targetYaw - p.heading), Math.cos(targetYaw - p.heading)) * Math.min(1, dt * 4);
      p.root.position.set(p.x, ROAD.sidewalkHeight, p.z);
      p.root.rotation.y = p.heading;
      if (far) continue;
      p.phase += dt * (p.standing ? 1 : p.speed * 4.2);
      if (p.mixer) p.mixer.update(dt);
      const swing = p.standing ? 0 : Math.sin(p.phase) * 0.45;
      if (p.legs.length) {
        p.legs[0].rotation.x = swing; p.legs[1].rotation.x = -swing;
        p.arms[0].rotation.x = -swing * 0.8; p.arms[1].rotation.x = swing * 0.8;
        p.root.position.y = ROAD.sidewalkHeight + (p.standing ? 0 : Math.abs(Math.cos(p.phase)) * 0.03);
        if (p.standing) p.arms[0].rotation.x = Math.sin(p.phase) * 0.05;
      }
    }
  }
}
