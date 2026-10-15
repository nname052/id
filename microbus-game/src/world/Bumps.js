import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, tex } from '../render/textures.js';

// المطبات باينة جدًا: المطب كله مدهون شرايط صفرا وسودا (على نفس بروفايل الفيزياء)،
// وقبله بـ 25م يافطة تحذير "مطب" على عمود + سهمين أبيض على الأرض.

/** at(d, across, h) → [x, y, z]: d على طول الطريق من نص المطب، across بالعرض */
export function stripeBump(B, at, half, height, a0, a1) {
  const n = 10, W = 0.6, lift = 0.008;
  const H = (d) => height * 0.5 * (1 + Math.cos((Math.PI * d) / half)) + lift;
  let k = 0;
  for (let a = a0; a < a1 - 0.05; a += W, k++) {
    const b = B.get(k % 2 ? 'bumpBlack' : 'bumpYellow'), e = Math.min(a1, a + W);
    for (let i = 0; i < n; i++) {
      const d0 = -half + (2 * half * i) / n, d1 = -half + (2 * half * (i + 1)) / n;
      b.quad(at(d1, a, H(d1)), at(d1, e, H(d1)), at(d0, e, H(d0)), at(d0, a, H(d0)));
    }
  }
}

/** علامة على الأرض قبل المطب: خطين أبيض عرضيين */
export function bumpWarnLines(B, at, a0, a1) {
  const b = B.get('bumpWhite');
  for (const d of [8, 11]) b.quad(at(d + 0.25, a0, 0.007), at(d + 0.25, a1, 0.007), at(d - 0.25, a1, 0.007), at(d - 0.25, a0, 0.007));
}

const _signMats = {};
function signMaterial(kind = 'bump') {
  if (_signMats[kind]) return _signMats[kind];
  const c = canvas(256, 256), x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (kind === 'bump') {
    // مثلث تحذير أحمر وأبيض + رسمة مطب + كلمة "مطب"
    x.beginPath(); x.moveTo(128, 8); x.lineTo(250, 220); x.lineTo(6, 220); x.closePath();
    x.fillStyle = '#d61f1f'; x.fill();
    x.beginPath(); x.moveTo(128, 46); x.lineTo(218, 202); x.lineTo(38, 202); x.closePath();
    x.fillStyle = '#ffffff'; x.fill();
    x.fillStyle = '#111';
    x.beginPath(); x.moveTo(70, 182); x.quadraticCurveTo(128, 110, 186, 182); x.closePath(); x.fill();
    x.font = 'bold 44px Cairo, sans-serif'; x.direction = 'rtl';
    x.fillStyle = '#ffffff'; x.fillRect(64, 222, 128, 34);
    x.fillStyle = '#d61f1f'; x.fillText('مطب', 128, 240);
  } else if (kind.startsWith('speed')) {
    // دايرة حمرا فيها أقصى سرعة
    x.beginPath(); x.arc(128, 128, 122, 0, Math.PI * 2); x.fillStyle = '#d61f1f'; x.fill();
    x.beginPath(); x.arc(128, 128, 96, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
    x.fillStyle = '#111'; x.font = 'bold 104px Arial, sans-serif'; x.fillText(kind.slice(5), 128, 134);
  } else if (kind === 'noparking') {
    x.beginPath(); x.arc(128, 128, 122, 0, Math.PI * 2); x.fillStyle = '#d61f1f'; x.fill();
    x.beginPath(); x.arc(128, 128, 96, 0, Math.PI * 2); x.fillStyle = '#1d4ed8'; x.fill();
    x.strokeStyle = '#d61f1f'; x.lineWidth = 26; x.beginPath(); x.moveTo(60, 60); x.lineTo(196, 196); x.stroke();
  }
  _signMats[kind] = new THREE.MeshStandardMaterial({ map: tex(c, { repeat: false }), transparent: true, alphaTest: 0.4, roughness: 0.5, side: THREE.DoubleSide });
  return _signMats[kind];
}

/** يافطات على عمدان: list = [{ x, y, z, yaw, kind? }] (yaw = اتجاه وش اليافطة ناحية العربيات الجاية).
 *  kind: 'bump' (مطب) | 'speed40' / 'speed60' / 'speed80' (أقصى سرعة) | 'noparking' */
export function buildBumpSigns(list) {
  const g = new THREE.Group(); g.name = 'road-signs';
  if (!list.length) return g;
  const plates = {}, posts = [];
  for (const s of list) {
    const m = new THREE.Matrix4().makeRotationY(s.yaw).setPosition(s.x, s.y, s.z);
    (plates[s.kind || 'bump'] ||= []).push(new THREE.PlaneGeometry(0.95, 0.95).translate(0, 2.25, 0.04).applyMatrix4(m));
    posts.push(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6).translate(0, 1.25, 0).applyMatrix4(m));
  }
  for (const [kind, list2] of Object.entries(plates)) g.add(new THREE.Mesh(mergeGeometries(list2), signMaterial(kind)));
  const po = new THREE.Mesh(mergeGeometries(posts), new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5, metalness: 0.6 }));
  po.castShadow = true;
  g.add(po);
  return g;
}
