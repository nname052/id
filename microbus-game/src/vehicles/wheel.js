import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder.js';

// عجلة كاملة: كاوتش (Lathe بروفايل حقيقي بجوانب منفوخة) + جنط حديد/ألومنيوم + صواميل.
// المحور على X. اتنين Mesh بس لكل عجلة (أداء). ترجع { group (للتوجيه)، spin (للدوران) }

const tireCache = new Map();
const rimCache = new Map();

function tireGeometry(R, width, rimR) {
  const key = `${R}|${width}|${rimR}`;
  if (tireCache.has(key)) return tireCache.get(key);
  const w = width / 2;
  const P = (r, y) => new THREE.Vector2(r, y);
  const pts = [
    P(rimR, -w * 0.82), P(rimR + (R - rimR) * 0.3, -w * 0.98), P(rimR + (R - rimR) * 0.7, -w * 1.02),
    P(R - 0.025, -w * 0.97), P(R - 0.004, -w * 0.82), P(R, -w * 0.6), P(R, w * 0.6), P(R - 0.004, w * 0.82),
    P(R - 0.025, w * 0.97), P(rimR + (R - rimR) * 0.7, w * 1.02), P(rimR + (R - rimR) * 0.3, w * 0.98), P(rimR, w * 0.82),
  ];
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateZ(Math.PI / 2);
  tireCache.set(key, g);
  return g;
}

function rimGeometry(width, rimR, style, side) {
  const key = `${width}|${rimR}|${style}|${side}`;
  if (rimCache.has(key)) return rimCache.get(key);
  const b = new GeoBuilder();
  const M = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const facing = (g) => g.rotateY((Math.PI / 2) * side);
  b.setColor([1, 1, 1]);
  b.addGeometry(new THREE.CylinderGeometry(rimR, rimR, width * 0.7, 24, 1, true).rotateZ(Math.PI / 2));
  if (style !== 'alloy6') b.addGeometry(facing(new THREE.CircleGeometry(rimR * 0.98, 24)), M(side * width * 0.22, 0, 0));
  if (style === 'alloy6') {
    // الوش متعمل بخامة (texture) منفصلة
  } else if (style === 'steel') {
    b.setColor([0.03, 0.03, 0.03]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.addGeometry(facing(new THREE.CircleGeometry(rimR * 0.13, 10)), M(side * width * 0.225, Math.cos(a) * rimR * 0.64, Math.sin(a) * rimR * 0.64));
    }
  } else {
    // جنط سبور بـ 5 أذرع
    b.setColor([0.05, 0.05, 0.05]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6;
      b.addGeometry(facing(new THREE.CircleGeometry(rimR * 0.22, 3)), M(side * width * 0.225, Math.cos(a) * rimR * 0.6, Math.sin(a) * rimR * 0.6));
    }
  }
  if (style !== 'alloy6') b.setColor([1.3, 1.3, 1.3]);
  if (style !== 'alloy6') b.addGeometry(new THREE.CylinderGeometry(rimR * 0.38, rimR * 0.42, 0.05, 18).rotateZ(Math.PI / 2), M(side * width * 0.24, 0, 0));
  for (let i = 0; i < (style === 'alloy6' ? 0 : 6); i++) {
    const a = (i / 6) * Math.PI * 2;
    b.addGeometry(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6).rotateZ(Math.PI / 2), M(side * width * 0.26, Math.cos(a) * rimR * 0.28, Math.sin(a) * rimR * 0.28));
  }
  b.setColor([0.04, 0.04, 0.04]);
  b.addGeometry(new THREE.CircleGeometry(rimR * 0.97, 20).rotateY((-Math.PI / 2) * side), M(-side * width * 0.3, 0, 0));
  const g = b.build();
  rimCache.set(key, g);
  return g;
}

export function buildWheel({ radius = 0.33, width = 0.21, rimRadius = 0.2, mats, style = 'steel', side = 1 }) {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const tire = new THREE.Mesh(tireGeometry(radius, width, rimRadius), mats.tire);
  tire.castShadow = true;
  tire.receiveShadow = true;
  tire.userData.role = 'tire';
  const rim = new THREE.Mesh(rimGeometry(width, rimRadius, style, side), mats.rim);
  rim.receiveShadow = true;
  rim.userData.role = 'rim';
  spin.add(tire, rim);
  if (style === 'alloy6' && mats.rimFace) {
    // وش الجنط بخامة 6 أذرع، مقعّر شوية لجوه
    const face = new THREE.Mesh(faceGeo(rimRadius, side), mats.rimFace);
    face.position.x = side * width * 0.2;
    face.userData.role = 'rimFace';
    spin.add(face);
  }
  return { group, spin };
}

const faceCache = new Map();
function faceGeo(r, side) {
  const k = `${r}|${side}`;
  if (!faceCache.has(k)) faceCache.set(k, new THREE.CircleGeometry(r * 1.0, 28).rotateY((Math.PI / 2) * side));
  return faceCache.get(k);
}
