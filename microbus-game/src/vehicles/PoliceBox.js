// =====================================================================
//  "البوكس" — بيك أب الشرطة المصري (من صور Commons: "Egypt police car 01/06.jpg"، CC BY 4.0):
//  صاج أسود، أبواب الكابينة بيضا، صندوق ورا متغطي بشمسية/قفص أسود، وكشاف أزرق فوق الكابينة.
//  الجسم = موديل البيك أب الحقيقي (بيك أب التسعينات، CC BY — خامة الصاج منفصلة فبتتلوّن) متلوّن؛ الأبواب البيضا والغطا والكشاف مضافين فوقه.
//  مفيش شعار ولا كتابة مرسومة (مانقلدش علامات رسمية).
// =====================================================================
import * as THREE from 'three';
import { realTrafficCar } from './ModelFit.js';

const BLACK = 0x14161a;
let _mats = null;
function mats() {
  return (_mats ||= {
    white: new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.45, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.95 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.6, metalness: 0.4 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x1a4dff, emissive: 0x0a2aff, emissiveIntensity: 0.6, roughness: 0.3 }),
  });
}

/** null لو موديل البيك أب مش موجود (اللي بيناديها يرجع للسيدان) */
export function buildPoliceBox(assets) {
  const a = assets?.get?.('pickup_90s');
  if (!a) return null;
  const car = realTrafficCar(a, BLACK);
  const M = mats();
  const bb = new THREE.Box3().setFromObject(car.body);
  const W = bb.max.x - bb.min.x, H = bb.max.y - bb.min.y, L = bb.max.z - bb.min.z;
  const y0 = bb.min.y, z0 = bb.min.z; // القدام = -z
  // الكابينة = الجزء اللي ارتفاعه قريب من السقف (من رءوس الموديل نفسه)، والصندوق = اللي وراها
  let cabZ0 = Infinity, cabZ1 = -Infinity;
  const v = new THREE.Vector3();
  car.body.traverse((o) => {
    if (!o.isMesh || o.parent !== car.body) return;
    const P = o.geometry.attributes.position;
    for (let i = 0; i < P.count; i += 3) { v.fromBufferAttribute(P, i); if (v.y > y0 + H * 0.85) { cabZ0 = Math.min(cabZ0, v.z); cabZ1 = Math.max(cabZ1, v.z); } }
  });
  if (!(cabZ1 > cabZ0)) { cabZ0 = z0 + L * 0.3; cabZ1 = z0 + L * 0.53; }
  cabZ0 -= 0.25; cabZ1 += 0.05; // الباب أعرض من السقف شوية (الشباك القدام مايل)
  // الأبواب البيضا (لوح رفيع على الجنبين، تحت الشباك)
  const door = new THREE.BoxGeometry(0.012, H * 0.3, cabZ1 - cabZ0);
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(door, M.white);
    d.position.set(s * (W / 2 - 0.02), y0 + H * 0.45, (cabZ0 + cabZ1) / 2);
    car.body.add(d);
  }
  // غطا الصندوق: شمسية سودا على قفص (أعلى شوية من سقف الكابينة زي الصورة)
  const bz0 = cabZ1 + 0.12, bz1 = bb.max.z - 0.05, bedY = y0 + H * 0.52, topY = y0 + H * 1.02;
  const cover = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, topY - bedY, bz1 - bz0), M.canvas);
  cover.position.set(0, (bedY + topY) / 2, (bz0 + bz1) / 2); cover.castShadow = true;
  car.body.add(cover);
  const bar = new THREE.BoxGeometry(0.04, 0.04, bz1 - bz0 + 0.04);
  for (const s of [-1, 1]) { const f = new THREE.Mesh(bar, M.frame); f.position.set(s * W * 0.45, topY, (bz0 + bz1) / 2); car.body.add(f); }
  // الكشاف الأزرق فوق الكابينة
  const lb = new THREE.Mesh(new THREE.BoxGeometry(W * 0.55, 0.1, 0.22), M.blue);
  lb.position.set(0, y0 + H + 0.03, (cabZ0 + cabZ1) / 2 + 0.1);
  car.body.add(lb);
  car.lights = null; car.policeBox = true;
  return car;
}
