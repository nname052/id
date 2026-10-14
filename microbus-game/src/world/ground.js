// ارتفاع الأرض للفيزياء: المدينة (مسطحة + مطبات) أو الطريق الدائري (كباري، جبل، تضاريس)
import { groundHeight as cityGround, ROAD } from './layout.js';
import { routeSurface } from './Route.js';
import { sideSurface, sideRoadAt } from './RoadNetwork.js';

export function inCity(x, z) { return Math.abs(x) < 100 && z > ROAD.zMin && z < ROAD.zMax; }

export function groundHeight(x, z) {
  if (inCity(x, z)) return cityGround(x, z);
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
