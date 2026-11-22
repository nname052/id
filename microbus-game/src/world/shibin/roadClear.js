// =====================================================================
//  "مفيش مبنى على الطريق" — شبكة أمان وقت بناء كل مربع (لكل المدن، من غير إعادة بناء الداتا):
//  أي مبنى (مولّد أو حقيقي من OSM) بصمته بتلمس أسفلت أي طريق (نص العرض + هامش) بيتشال.
//  (الضغط في إسكندرية/الجيزة كان بيحرّك المباني الحقيقية فبعضها وقع على الأسفلت؛ والفاليديتور كان بيشيك المولّد بس)
// =====================================================================
import { edgesNear } from './ShibinData.js';

const ptSeg = (px, pz, ax, az, bx, bz) => {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2));
  return Math.hypot(px - ax - ex * t, pz - az - ez * t);
};
const cross = (ax, az, bx, bz, cx, cz) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
const segSeg = (a0x, a0z, a1x, a1z, b0x, b0z, b1x, b1z) => {
  const d1 = cross(b0x, b0z, b1x, b1z, a0x, a0z), d2 = cross(b0x, b0z, b1x, b1z, a1x, a1z);
  const d3 = cross(a0x, a0z, a1x, a1z, b0x, b0z), d4 = cross(a0x, a0z, a1x, a1z, b1x, b1z);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  return Math.min(ptSeg(a0x, a0z, b0x, b0z, b1x, b1z), ptSeg(a1x, a1z, b0x, b0z, b1x, b1z), ptSeg(b0x, b0z, a0x, a0z, a1x, a1z), ptSeg(b1x, b1z, a0x, a0z, a1x, a1z));
};
const pip = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };

/** P = [[x,z],...] (مقفول أو لأ). true لو المضلع بيلمس أسفلت أي طريق (half + margin) */
export function blocksRoad(graph, P, margin = 0.5) {
  let cx = 0, cz = 0, r = 0;
  for (const [x, z] of P) { cx += x; cz += z; } cx /= P.length; cz /= P.length;
  for (const [x, z] of P) r = Math.max(r, Math.hypot(x - cx, z - cz));
  for (const e of edgesNear(graph, cx, cz, r + 25)) {
    if (e.closed) continue;
    const lim = e.half + margin;
    const pts = e.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      // سريع: بعيد عن المبنى خالص؟
      if (ptSeg(cx, cz, a.x, a.z, b.x, b.z) > r + lim) continue;
      if (pip(P, a.x, a.z) || pip(P, b.x, b.z)) return true;
      for (let k = 0, j = P.length - 1; k < P.length; j = k++) if (segSeg(a.x, a.z, b.x, b.z, P[j][0], P[j][1], P[k][0], P[k][1]) < lim) return true;
    }
  }
  return false;
}

export function rectPoly(cx, cz, w, d, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + u * w / 2 * c + v * d / 2 * s, cz - u * w / 2 * s + v * d / 2 * c]);
}
