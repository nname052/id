// المخرج: الكاميرا (لقطات وعدسات وزوايا وحركة وقطع) + لمسات الأنيمي (رموز المشاعر، خطوط السرعة، الفلاش، الهزة).
// كله محسوب من t ومن مكان الشخصية التقديري (مش من الفريم اللي فات)، علشان كل فريم يترسم لوحده بنفس النتيجة.
import * as THREE from "three";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = (x) => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const D = Math.PI / 180;
const noise = (t, s = 0) => Math.sin(t * 1.13 + s) * 0.5 + Math.sin(t * 2.71 + s * 1.7) * 0.3 + Math.sin(t * 0.47 + s * 2.3) * 0.2;

// اللقطة: الارتفاع اللي بيملا الكادر (متر) + النقطة اللي الكاميرا بتبصلها + العدسة الافتراضية (مم)
export const SHOTS = {
  extreme_wide: { h: 8, a: "hips", f: 22 }, wide: { h: 4.6, a: "hips", f: 26 }, full: { h: 2.6, a: "hips", f: 32 },
  medium: { h: 1.45, a: "chest", f: 40 }, medium_close: { h: 1.0, a: "neck", f: 50 }, close: { h: 0.72, a: "head", f: 60 },
  extreme_close: { h: 0.38, a: "face", f: 85 }, over_shoulder: { h: 1.0, a: "head", f: 35, os: true },
};
export const HEIGHTS = { eye: 0, low: -24, ground: -40, high: 30, top: 68 };
export const MOVES = ["static", "push_in", "pull_out", "orbit_left", "orbit_right", "crane_up", "crane_down", "truck_left", "truck_right", "handheld", "whip_in", "slow_zoom"];

// أماكن تقديرية في جسم الشخصية (من مكانها ووضعيتها، من غير ما نستنى العضم)
export function anchors(rootPos, face, h, sit = 0, crouch = 0, lean = 0) {
  const drop = h * (0.22 * sit + 0.2 * crouch);
  const f = new THREE.Vector3(Math.sin(face), 0, Math.cos(face));
  const fw = (y, k) => rootPos.clone().add(new THREE.Vector3(0, y, 0)).add(f.clone().multiplyScalar(Math.sin(lean * D) * (y - 0.5 * h) * k));
  return { hips: fw(0.52 * h - drop, 0), chest: fw(0.72 * h - drop, 1), neck: fw(0.84 * h - drop, 1), head: fw(0.92 * h - drop, 1), face: fw(0.93 * h - drop, 1).add(f.clone().multiplyScalar(0.08 * h / 1.7)), forward: f };
}

// الكاميرا في لحظة t: shots = [{t, type, angle, height, move, lens, dutch}]
export function cameraAt(shots, t, sceneDur, A, face, bounds, fxShake = 0) {
  let i = 0; shots.forEach((s, j) => { if (t >= s.t) i = j; });
  const s = shots[i], end = shots[i + 1] ? shots[i + 1].t : sceneDur;
  const p = clamp((t - s.t) / Math.max(0.5, end - s.t)), e = ease(p);
  const S = SHOTS[s.type] || SHOTS.medium;
  let f = s.lens || S.f, angle = s.angle || 0, elev = HEIGHTS[s.height] ?? 0, dist, roll = (s.dutch ? 12 : 0) * D;
  const fov = (lensMM) => 2 * Math.atan(36 / (2 * lensMM)) / D; // كادر طولي: ارتفاع الحساس 36مم
  let distK = 1, side = 0;
  switch (s.move) {
    case "push_in": distK = lerp(1.18, 0.86, e); break;
    case "pull_out": distK = lerp(0.82, 1.2, e); break;
    case "orbit_left": angle += lerp(-22, 22, e); break;
    case "orbit_right": angle += lerp(22, -22, e); break;
    case "crane_up": elev += lerp(-14, 16, e); break;
    case "crane_down": elev += lerp(18, -10, e); break;
    case "truck_left": side = lerp(-0.5, 0.5, e); break;
    case "truck_right": side = lerp(0.5, -0.5, e); break;
    case "whip_in": angle += 70 * Math.pow(1 - clamp(p * 4), 3); break; // لفّة سريعة في أول اللقطة (أنيمي)
    case "slow_zoom": f = f * lerp(1, 1.35, e); break;
  }
  const vf = fov(f) * D;
  dist = (S.h / (2 * Math.tan(vf / 2))) * distK;
  const anchor = A[S.a].clone();
  const fwd = A.forward;
  // اتجاه الكاميرا من الشخصية: angle حوالين الشخصية (0 = قدامها)، و elev فوق/تحت
  const yaw = Math.atan2(fwd.x, fwd.z) + angle * D;
  let dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(elev * D), Math.sin(elev * D), Math.cos(yaw) * Math.cos(elev * D));
  let pos = anchor.clone().add(dir.multiplyScalar(dist));
  let look = anchor.clone();
  if (S.os) { // من ورا الكتف: الكاميرا ورا الشخصية وبتبص لقدامها
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    pos = A.head.clone().add(fwd.clone().multiplyScalar(-1.05)).add(right.multiplyScalar(-0.48)).add(new THREE.Vector3(0, 0.14, 0));
    look = A.head.clone().add(fwd.clone().multiplyScalar(3)).add(new THREE.Vector3(0, -0.2, 0));
  }
  if (side) { const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); pos.add(r.clone().multiplyScalar(side)); look.add(r.multiplyScalar(side * 0.4)); }
  if (s.move === "handheld" || fxShake) {
    const a = (s.move === "handheld" ? 0.012 : 0) + fxShake * 0.05;
    pos.add(new THREE.Vector3(noise(t * 3, 1) * a, noise(t * 3.4, 2) * a, noise(t * 2.8, 3) * a));
    roll += noise(t * 2.2, 4) * a * 0.6;
  }
  if (bounds) { // جوه أوضة: الكاميرا ما تخرجش بره الحيطان
    pos.x = clamp(pos.x, bounds.x0, bounds.x1); pos.z = clamp(pos.z, bounds.z0, bounds.z1); pos.y = clamp(pos.y, bounds.y0, bounds.y1);
  }
  pos.y = Math.max(0.12, pos.y);
  return { pos, look, fov: fov(f), roll, shot: i };
}

// ---------- لمسات الأنيمي (بتترسم 2D فوق الصورة) ----------
// emote فوق الراس: ! ? sweat anger sparkle heart idea gloom zzz music
export function drawEmote(g, kind, x, y, t, scale = 1) {
  const p = clamp(t / 0.25), out = clamp((t - 1.3) / 0.3);
  if (t < 0 || out >= 1) return;
  const pop = p < 1 ? 1 + 0.35 * Math.sin(p * Math.PI) : 1 + 0.04 * Math.sin(t * 8);
  g.save(); g.globalAlpha = 1 - out; g.translate(x, y); g.scale(pop * scale, pop * scale);
  g.lineJoin = "round"; g.lineCap = "round";
  const stroke = (c, w) => { g.strokeStyle = c; g.lineWidth = w; g.stroke(); };
  if (kind === "!" || kind === "?") {
    g.font = "900 150px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 16; g.strokeStyle = "#1b1424"; g.strokeText(kind, 0, 0);
    g.fillStyle = kind === "!" ? "#ff3b3b" : "#ffd23f"; g.fillText(kind, 0, 0);
  } else if (kind === "sweat") {
    g.beginPath(); g.moveTo(0, -50); g.bezierCurveTo(30, -5, 32, 30, 0, 40); g.bezierCurveTo(-32, 30, -30, -5, 0, -50);
    g.fillStyle = "#8fd3ff"; g.fill(); stroke("#1b1424", 7);
    g.beginPath(); g.ellipse(-8, 18, 6, 10, 0.3, 0, 7); g.fillStyle = "#fff"; g.fill();
  } else if (kind === "anger") { // علامة العرق الأحمر (💢)
    for (let i = 0; i < 4; i++) { g.save(); g.rotate(i * Math.PI / 2); g.beginPath(); g.moveTo(10, 10); g.quadraticCurveTo(45, 10, 48, 48); g.moveTo(10, 10); g.quadraticCurveTo(10, 45, 48, 48);
      stroke("#e8243a", 13); g.restore(); }
  } else if (kind === "sparkle") {
    for (const [sx, sy, r] of [[0, 0, 46], [60, -40, 24], [-55, -30, 18]]) { g.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.28 : r; g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
      g.closePath(); g.fillStyle = "#fff4a8"; g.fill(); stroke("#1b1424", 5); }
  } else if (kind === "heart") {
    g.beginPath(); g.moveTo(0, 40); g.bezierCurveTo(-70, -5, -35, -60, 0, -25); g.bezierCurveTo(35, -60, 70, -5, 0, 40);
    g.fillStyle = "#ff5c8a"; g.fill(); stroke("#1b1424", 7);
  } else if (kind === "idea") {
    g.beginPath(); g.arc(0, -10, 42, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(18, 40); g.lineTo(-18, 40); g.closePath();
    g.fillStyle = "#ffe66d"; g.fill(); stroke("#1b1424", 7);
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.5; g.beginPath(); g.moveTo(Math.cos(a) * 58, -10 + Math.sin(a) * 58); g.lineTo(Math.cos(a) * 80, -10 + Math.sin(a) * 80); stroke("#ffb703", 8); }
  } else if (kind === "gloom") { // خطوط زرقا غامقة نازلة (إحباط)
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 26, -60); g.lineTo(i * 26, 40 + Math.abs(i) * -12); stroke("rgba(40,40,90,.75)", 7); }
  } else if (kind === "zzz" || kind === "music") {
    g.font = "900 70px Arial"; g.textAlign = "center"; g.fillStyle = "#fff"; g.lineWidth = 9; g.strokeStyle = "#1b1424";
    const txt = kind === "zzz" ? "Z z" : "♪ ♫"; g.strokeText(txt, 0, Math.sin(t * 3) * 8); g.fillText(txt, 0, Math.sin(t * 3) * 8);
  }
  g.restore();
}

// خطوط السرعة / التركيز / الفلاش (فوق الكادر كله)
export function drawFx(g, kind, t, W, H, seed = 1) {
  if (t < 0) return;
  const life = kind === "flash" ? 0.22 : 0.9, out = clamp(t / life);
  if (out >= 1) return;
  g.save();
  if (kind === "flash") { g.fillStyle = `rgba(255,255,255,${(1 - out) * 0.9})`; g.fillRect(0, 0, W, H); g.restore(); return; }
  const n = 70, cx = W / 2, cy = H * 0.42;
  let s = seed * 9301;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.globalAlpha = (1 - out) * 0.85;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.05, len = 0.25 + r() * 0.35, w = 2 + r() * 7;
    // خطوط التركيز بتبدأ من بعيد (حوالين الحواف بس) علشان ما تغطيش الوش
    const r0 = (kind === "focus" ? 0.42 : 0.3) * Math.hypot(W, H) * (0.75 + r() * 0.25), r1 = r0 + len * H;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a + 0.006) * r1, cy + Math.sin(a + 0.006) * r1); g.lineTo(cx + Math.cos(a - 0.006) * r1, cy + Math.sin(a - 0.006) * r1);
    g.closePath(); g.fillStyle = kind === "speedlines" ? "rgba(255,255,255,.85)" : "rgba(20,15,30,.55)"; g.fill();
    void w;
  }
  g.restore();
}
