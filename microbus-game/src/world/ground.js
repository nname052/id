// ارتفاع الأرض للفيزياء: المدينة (مسطحة + مطبات) أو الطريق الدائري (كباري، جبل، تضاريس)
import { groundHeight as cityGround, ROAD } from './layout.js';
import { routeSurface } from './Route.js';

export function inCity(x, z) { return Math.abs(x) < 100 && z > ROAD.zMin && z < ROAD.zMax; }

export function groundHeight(x, z) {
  if (inCity(x, z)) return cityGround(x, z);
  return routeSurface(x, z).h;
}

/** نوع السطح (للصوت) */
export function surfaceAt(x, z) {
  if (inCity(x, z)) return 'city';
  const r = routeSurface(x, z);
  return r.onRoad ? r.zone : 'dirt';
}
