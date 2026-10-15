// ارتفاع الأرض للفيزياء: المدينة (مسطحة + مطبات) أو الطريق الدائري (كباري، جبل، تضاريس)
import { groundHeight as cityGround, ROAD } from './layout.js';
import { routeSurface } from './Route.js';
import { sideSurface, sideRoadAt } from './RoadNetwork.js';

export function inCity(x, z) { return Math.abs(x) < 100 && z > ROAD.zMin && z < ROAD.zMax; }

// أرضية موقف شبين (مرسومة على -0.41): الفيزيا على نفس الارتفاع بالظبط (كانت -0.5 → العجل باين غطسان)
const TERM = { x0: 259.5, x1: 298, z0: 244, z1: 289, y: -0.41 };

export function groundHeight(x, z) {
  if (inCity(x, z)) return cityGround(x, z);
  if (x > TERM.x0 && x < TERM.x1 && z > TERM.z0 && z < TERM.z1) return TERM.y;
  const r = routeSurface(x, z);
  if (r.onRoad) return r.h;
  // الطرق الفرعية (بعد الطريق الرئيسي في الأولوية)
  const sd = sideSurface(x, z);
  return sd !== null ? sd : r.h;
}

/** نوع السطح (للصوت) */
export function surfaceAt(x, z) {
  if (inCity(x, z)) return 'city';
  const r = routeSurface(x, z);
  if (r.onRoad) return r.zone;
  const sr = sideRoadAt(x, z);
  if (sr) return sr.surface === 'dirt' ? 'dirt' : 'residential';
  return 'dirt';
}
