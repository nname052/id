// تصادم صناديق موجّهة (OBB) في المستوى الأفقي باستخدام Separating Axis Theorem
// box = { cx, cz, hx (نص العرض), hz (نص الطول), angle (yaw) }

function axes(b) {
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  return { rx: c, rz: -s, fx: -s, fz: -c };
}

export function boxCorners(b) {
  const a = axes(b);
  const out = [];
  for (const [sx, sf] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    out.push([b.cx + a.rx * b.hx * sx + a.fx * b.hz * sf, b.cz + a.rz * b.hx * sx + a.fz * b.hz * sf]);
  }
  return out;
}

function inside(b, a, x, z) {
  const dx = x - b.cx, dz = z - b.cz;
  return Math.abs(dx * a.rx + dz * a.rz) <= b.hx + 1e-4 && Math.abs(dx * a.fx + dz * a.fz) <= b.hz + 1e-4;
}

export function boundingRadius(b) { return Math.hypot(b.hx, b.hz); }

/** يرجع null أو { nx, nz (من A إلى B), depth, px, pz (نقطة التلامس) } */
export function obbOverlap(A, B) {
  const dxC = B.cx - A.cx, dzC = B.cz - A.cz;
  const rr = boundingRadius(A) + boundingRadius(B);
  if (dxC * dxC + dzC * dzC > rr * rr) return null;
  const a = axes(A), b = axes(B);
  const list = [[a.rx, a.rz], [a.fx, a.fz], [b.rx, b.rz], [b.fx, b.fz]];
  let best = Infinity, bnx = 0, bnz = 0;
  for (const [nx, nz] of list) {
    const ra = A.hx * Math.abs(a.rx * nx + a.rz * nz) + A.hz * Math.abs(a.fx * nx + a.fz * nz);
    const rb = B.hx * Math.abs(b.rx * nx + b.rz * nz) + B.hz * Math.abs(b.fx * nx + b.fz * nz);
    const d = dxC * nx + dzC * nz;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const sg = d >= 0 ? 1 : -1; bnx = nx * sg; bnz = nz * sg; }
  }
  // نقطة التلامس: متوسط الأركان اللي داخل الصندوق التاني
  let px = 0, pz = 0, n = 0;
  for (const [x, z] of boxCorners(A)) if (inside(B, b, x, z)) { px += x; pz += z; n++; }
  for (const [x, z] of boxCorners(B)) if (inside(A, a, x, z)) { px += x; pz += z; n++; }
  if (n) { px /= n; pz /= n; } else { px = (A.cx + B.cx) / 2; pz = (A.cz + B.cz) / 2; }
  return { nx: bnx, nz: bnz, depth: best, px, pz };
}
