import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex } from '../render/textures.js';

// زينة خفيفة في كابينة الميكروباص: عين زرقا (نَظَر) متعلقة في المراية — بندول بيتمرجح مع السبحة.
// (التابلوه نفسه نضيف زي صورة الكابينة المرجعية: من غير سجادة ولا علب ولا لافتات تغطي الرؤية)

const M4 = (x = 0, y = 0, z = 0) => new THREE.Matrix4().makeTranslation(x, y, z);

function eyeCharmTexture() {
  const c = canvas(64, 64), x = c.getContext('2d');
  for (const [r, col] of [[31, '#0b3fa8'], [22, '#ffffff'], [15, '#5ab4ff'], [8, '#0a0a14']]) { x.fillStyle = col; x.beginPath(); x.arc(32, 32, r, 0, Math.PI * 2); x.fill(); }
  return tex(c, { repeat: false });
}

/**
 * P: { wtF, wtY, z } من buildHiaceInterior (أعلى الزجاج الأمامي)
 * بترجع hanger: { obj, L } (PlayerVehicle بيمرجحها حسب التسارع والميل)
 */
export function addEyeCharm(group, { wtF, wtY, z }) {
  const charm = new THREE.Group();
  charm.position.set(0.07, wtY - 0.162, z(wtF - 0.045));
  const L = 0.11;
  const g = new GeoBuilder();
  g.setColor([0.85, 0.7, 0.3]);
  g.addGeometry(new THREE.CylinderGeometry(0.0012, 0.0012, L, 4), M4(0, -L / 2, 0));
  for (let i = 0; i < 4; i++) { g.setColor(i % 2 ? [0.1, 0.3, 0.85] : [0.95, 0.95, 0.95]); g.addGeometry(new THREE.SphereGeometry(0.005, 6, 5), M4(0, -0.02 - i * 0.018, 0)); }
  charm.add(new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 })));
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), new THREE.MeshStandardMaterial({ map: eyeCharmTexture(), roughness: 0.15, side: THREE.DoubleSide }));
  eye.position.y = -L - 0.02;
  charm.add(eye);
  group.add(charm);
  return { obj: charm, L: L + 0.02 };
}
