// فيديو السبورة البيضاء: إيد ماسكة قلم بترسم وتكتب خطوة خطوة.
// - الرسومات والأيقونات بتترسم خط بخط (stroke-dashoffset)، وسن القلم ماشي على نفس الخط (getPointAtLength)، والألوان بتتملا بعد الحدود.
// - الكلام بيتكتب من اليمين للشمال (قص تدريجي) والإيد ماشية على السطر.
// - الأسهم والخطوط تحت الكلام والدواير بتترسم بخط إيد متعرّج شوية.
// كل حاجة محسوبة من t (حتمية) زي باقي المشغّل.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = (x) => (x = clamp(x), x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const cache = {};
const text = async (url) => (cache[url] ??= await (await fetch(url)).text());

// ---------- الإيد ----------
const HAND_W = 780, HAND_SRC_W = 1040, TIP = [20, 170]; // سن القلم جوه الرسمة الأصلية
let hand;
export async function handLayer(stage) {
  if (hand) return hand;
  const el = document.createElement("div");
  el.id = "hand";
  el.innerHTML = await text("/player/hand.svg");
  const sv = el.querySelector("svg"); const k = HAND_W / HAND_SRC_W;
  sv.setAttribute("width", HAND_W); sv.setAttribute("height", 360 * k);
  el.style.cssText = `position:absolute;left:0;top:0;width:${HAND_W}px;transform-origin:${TIP[0] * k}px ${TIP[1] * k}px;z-index:7;pointer-events:none;will-change:transform`;
  stage.appendChild(el);
  hand = { el, k };
  return hand;
}
// بيحط سن القلم عند (x, y). الزاوية بتتغيّر شوية مع المكان علشان الحركة تبان طبيعية
export function placeHand(st) {
  if (!hand) return;
  if (!st || !st.visible) { hand.el.style.opacity = 0; return; }
  const k = hand.k, ang = 36 + (st.x - 540) / 60 + (st.y - 900) / 90;
  hand.el.style.opacity = 1;
  hand.el.style.transform = `translate(${st.x - TIP[0] * k}px, ${st.y - TIP[1] * k}px) rotate(${ang}deg)`;
}

// ---------- أماكن العناصر على السبورة ----------
function zones(n) {
  const T = 250, B = 1180, L = 80, R = 1000, Wd = R - L, Hd = B - T;
  if (n <= 1) return [{ x: L, y: T + 40, w: Wd, h: Hd - 80 }];
  if (n === 2) return [{ x: L, y: T, w: Wd, h: Hd / 2 - 20 }, { x: L, y: T + Hd / 2 + 20, w: Wd, h: Hd / 2 - 20 }];
  if (n === 3) return [{ x: L, y: T, w: Wd, h: Hd * 0.42 }, { x: L + Wd / 2 + 20, y: T + Hd * 0.47, w: Wd / 2 - 20, h: Hd * 0.53 }, { x: L, y: T + Hd * 0.47, w: Wd / 2 - 20, h: Hd * 0.53 }];
  return [0, 1, 2, 3].map((i) => ({ x: i % 2 ? L : L + Wd / 2 + 20, y: i < 2 ? T : T + Hd / 2 + 20, w: Wd / 2 - 20, h: Hd / 2 - 20 }));
}

// خط إيد متعرّج شوية (ثابت لنفس البذرة)
function wobble(points, seed, amp = 4) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * amp;
  return points.map(([x, y], i) => [x + (i && i < points.length - 1 ? r() : 0), y + (i && i < points.length - 1 ? r() : 0)]);
}
const pathD = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
function smoothD(pts) { // منحنى ناعم بيعدّي على النقط
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i], [nx, ny] = pts[i + 1]; d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`; }
  const [lx, ly] = pts[pts.length - 1]; return d + ` L${lx} ${ly}`;
}

// ---------- مشهد سبورة ----------
// sc.board = [{kind, text, value, visual, target, from, to, color, cue_word}] ، و sc.visuals متوصّلة بالترتيب للعناصر اللي فيها صورة
export async function createBoard(sc, el, ctx) {
  const P = ctx.palette, ink = P.ink || "#1d1d1f", colorOf = (c) => (c === "accent" ? P.accent : c === "accent2" ? P.accent2 : ink);
  const font = ctx.font || "Marhey", PACE = ctx.pace || 1;
  el.classList.add("board");
  const items = sc.board || [];
  const content = items.filter((x) => !["arrow", "underline", "circle"].includes(x.kind));
  const zs = zones(content.length);
  const svgLayer = svgEl("svg", { width: 1080, height: 1920, viewBox: "0 0 1080 1920", class: "wb-marks" });
  const els = [];
  let zi = 0;
  for (const [i, it] of items.entries()) {
    const e = { it, i, kind: it.kind, color: colorOf(it.color) };
    if (["illustration", "icon", "emoji"].includes(it.kind) && it.visual) {
      const z = zs[zi++];
      const box = document.createElement("div");
      box.className = `wb-art ${it.kind}`;
      box.style.cssText = `left:${z.x}px;top:${z.y}px;width:${z.w}px;height:${z.h}px;color:${e.color}`;
      box.innerHTML = await text(`/assets/${it.visual.asset}`);
      const sv = box.querySelector("svg");
      sv.setAttribute("width", z.w); sv.setAttribute("height", z.h); sv.setAttribute("preserveAspectRatio", "xMidYMid meet");
      el.appendChild(box);
      // كل الأشكال اللي هتترسم: حدود بالحبر، والألوان بتظهر بعد ما الحدود تخلص
      const shapes = [...sv.querySelectorAll("path, circle, line, polyline, polygon, rect, ellipse")].filter((s) => !s.closest("defs, clipPath, mask"));
      e.shapes = shapes.map((s) => {
        const cs = getComputedStyle(s), fill = s.getAttribute("fill") || cs.fill;
        const L = (() => { try { return s.getTotalLength(); } catch { return 0; } })();
        // لون الرسمة الأساسي (بنفسجي unDraw) بيبقى لون القلم
        if (/6c63ff/i.test(fill)) s.setAttribute("fill", P.accent);
        s.style.vectorEffect = "non-scaling-stroke";
        if (it.kind === "icon") { s.style.stroke = e.color; s.style.strokeWidth = "7px"; }
        else { s._fill = s.getAttribute("fill") || cs.fill; s.style.stroke = ink; s.style.strokeWidth = "2.6px"; s.style.fillOpacity = 0; }
        s.style.strokeDasharray = L; s.style.strokeDashoffset = L;
        return { s, L };
      }).filter((x) => x.L > 0.5);
      // أصغر الأشكال (تفاصيل صغيرة جدًا) ما بتاخدش وقت رسم: بتظهر مع الألوان
      e.total = e.shapes.reduce((n, x) => n + x.L, 0);
      e.box = box; e.zone = z; e.dur = (it.kind === "illustration" ? 2.4 : it.kind === "emoji" ? 1.4 : 1.1) * PACE;
    } else if (["text", "number"].includes(it.kind)) {
      const z = zs[zi++];
      const t = it.kind === "number" ? String(it.value || it.text || "") : String(it.text || "");
      const words = t.split(/\s+/).filter(Boolean);
      const lines = words.length > 3 && it.kind === "text" ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [t];
      const wrap = document.createElement("div");
      wrap.className = `wb-text ${it.kind}`;
      wrap.style.cssText = `left:${z.x}px;top:${z.y}px;width:${z.w}px;height:${z.h}px;color:${e.color};font-family:"${font}"`;
      wrap.innerHTML = lines.map((l) => `<div class="ln"><span>${esc(l)}</span></div>`).join("");
      el.appendChild(wrap);
      // حجم الخط: أكبر حاجة تدخل في المكان
      let fs = it.kind === "number" ? Math.min(z.h * 0.75, 300) : Math.min(150, z.h / (lines.length * 1.35));
      wrap.style.fontSize = fs + "px";
      while (fs > 44 && ([...wrap.querySelectorAll("span")].some((s) => s.offsetWidth > z.w - 20) || wrap.scrollHeight > z.h + 2)) { fs *= 0.93; wrap.style.fontSize = fs + "px"; }
      e.lines = [...wrap.querySelectorAll(".ln span")];
      // الأرقام والكلام اللاتيني بيتكتبوا من الشمال لليمين، والعربي من اليمين للشمال
      e.ltr = it.kind === "number" || !/[\u0600-\u06FF]/.test(t);
      e.box = wrap; e.zone = z;
      e.dur = clamp((0.25 + 0.075 * t.length) * PACE, 0.6, 2.2);
    } else {
      e.mark = true; e.dur = (it.kind === "circle" ? 0.7 : 0.5) * PACE;
    }
    els.push(e);
  }
  el.appendChild(svgLayer);

  // العلامات (سهم / خط تحت / دايرة): بتتبني بعد ما مكان العناصر اتعرف
  const rectOf = (idx) => { const t = els[idx]; if (!t || !t.box) return null;
    if (t.lines) { const r = t.lines.map((s) => ({ x: s.offsetLeft + t.box.offsetLeft, y: s.offsetTop + t.box.offsetTop, w: s.offsetWidth, h: s.offsetHeight }));
      const x0 = Math.min(...r.map((q) => q.x)), y0 = Math.min(...r.map((q) => q.y)), x1 = Math.max(...r.map((q) => q.x + q.w)), y1 = Math.max(...r.map((q) => q.y + q.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
    return { x: t.zone.x + t.zone.w * 0.1, y: t.zone.y + t.zone.h * 0.08, w: t.zone.w * 0.8, h: t.zone.h * 0.84 }; };
  const contentIdx = els.filter((x) => !x.mark).map((x) => x.i);
  for (const e of els.filter((x) => x.mark)) {
    const it = e.it, seed = 31 + e.i * 7;
    const tgt = rectOf(Number.isInteger(it.target) ? it.target : contentIdx[contentIdx.length - 1]);
    let d = null, head = null;
    if (it.kind === "underline" && tgt) {
      const y = tgt.y + tgt.h * 0.96;
      d = smoothD(wobble([[tgt.x + tgt.w + 10, y], [tgt.x + tgt.w * 0.66, y + 6], [tgt.x + tgt.w * 0.33, y + 2], [tgt.x - 10, y + 8]], seed, 3));
    } else if (it.kind === "circle" && tgt) {
      const cx = tgt.x + tgt.w / 2, cy = tgt.y + tgt.h / 2, rx = tgt.w / 2 + 34, ry = tgt.h / 2 + 26, pts = [];
      for (let a = 0; a <= 1.08; a += 0.04) pts.push([cx + Math.cos(-Math.PI / 2 + a * Math.PI * 2) * rx * (1 + 0.03 * Math.sin(a * 9)), cy + Math.sin(-Math.PI / 2 + a * Math.PI * 2) * ry]);
      d = smoothD(pts);
    } else if (it.kind === "arrow") {
      const a = rectOf(Number.isInteger(it.from) ? it.from : contentIdx[0]), b = rectOf(Number.isInteger(it.to) ? it.to : contentIdx[contentIdx.length - 1]);
      if (a && b && a !== b) {
        const ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2];
        const edge = (r, from, to) => { const dx = to[0] - from[0], dy = to[1] - from[1]; const s = Math.min(Math.abs((r.w / 2 + 20) / (dx || 1e-6)), Math.abs((r.h / 2 + 20) / (dy || 1e-6)), 1);
          return [from[0] + dx * s, from[1] + dy * s]; };
        const p0 = edge(a, ac, bc), p1 = edge(b, bc, ac), mid = [(p0[0] + p1[0]) / 2 + (p1[1] - p0[1]) * 0.15, (p0[1] + p1[1]) / 2 - (p1[0] - p0[0]) * 0.15];
        d = smoothD([p0, mid, p1]);
        const ang = Math.atan2(p1[1] - mid[1], p1[0] - mid[0]), L = 34;
        head = pathD([[p1[0] - L * Math.cos(ang - 0.45), p1[1] - L * Math.sin(ang - 0.45)], p1, [p1[0] - L * Math.cos(ang + 0.45), p1[1] - L * Math.sin(ang + 0.45)]]);
      }
    }
    if (!d) { e.skip = true; continue; }
    const path = svgEl("path", { d, fill: "none", stroke: e.color === ink ? P.accent : e.color, "stroke-width": 9, "stroke-linecap": "round", "stroke-linejoin": "round" });
    svgLayer.appendChild(path);
    e.path = path; e.L = path.getTotalLength(); path.style.strokeDasharray = e.L; path.style.strokeDashoffset = e.L;
    if (head) { e.head = svgEl("path", { d: head, fill: "none", stroke: path.getAttribute("stroke"), "stroke-width": 9, "stroke-linecap": "round", opacity: 0 }); svgLayer.appendChild(e.head); }
  }

  // التوقيت: كل عنصر مع كلمته، ومن غير ما عنصرين يترسموا في نفس الوقت. لو الوقت مش مكفي، الرسم بيسرع
  const live = els.filter((e) => !e.skip);
  let tcur = 0.25;
  for (const e of live) { const cue = e.it.cue_word ? ctx.cue(e.it.cue_word) : 0; e.start = Math.max(tcur, cue > 0 ? cue - 0.1 : tcur); tcur = e.start + e.dur + 0.18; }
  const avail = ctx.duration - 0.45;
  if (tcur > avail && live.length) {
    const k = clamp((avail - 0.25 - 0.18 * live.length) / live.reduce((n, e) => n + e.dur, 0), 0.25, 1);
    tcur = 0.25; for (const e of live) { e.dur *= k; e.start = Math.max(tcur, Math.min(e.start, avail - e.dur)); tcur = e.start + e.dur + 0.12; }
  }

  // نقطة سن القلم وهو بيرسم عنصر عند تقدّم p (إحداثيات المسرح)
  const pen = (e, p) => {
    if (e.shapes) {
      let left = e.total * p;
      for (const x of e.shapes) {
        if (left <= x.L) {
          const pt = x.s.getPointAtLength(Math.max(0, left)), m = x.s.getCTM();
          const q = m ? new DOMPoint(pt.x, pt.y).matrixTransform(m) : pt;
          return { x: e.zone.x + q.x, y: e.zone.y + q.y };
        }
        left -= x.L;
      }
      return null;
    }
    if (e.lines) {
      const n = e.lines.length, li = Math.min(n - 1, Math.floor(p * n)), lp = p * n - li, s = e.lines[li];
      const x0 = e.box.offsetLeft + s.offsetLeft, y0 = e.box.offsetTop + s.offsetTop;
      return { x: x0 + s.offsetWidth * (e.ltr ? lp : 1 - lp), y: y0 + s.offsetHeight * 0.72 + Math.sin(p * 60) * 6 };
    }
    if (e.path) { const pt = e.path.getPointAtLength(e.L * p); return { x: pt.x, y: pt.y }; }
    return null;
  };

  let last = { x: 1200, y: 1700 };
  return (t) => {
    let handSt = null;
    for (const e of live) {
      const p = clamp((t - e.start) / e.dur);
      if (e.shapes) {
        let left = e.total * p;
        for (const x of e.shapes) { x.s.style.strokeDashoffset = Math.max(0, x.L - Math.max(0, left)); left -= x.L; }
        // الألوان بتتملا في آخر جزء من الرسم وبعده
        const fp = clamp((t - e.start - e.dur * 0.7) / (e.dur * 0.6));
        if (e.kind !== "icon") e.shapes.forEach((x) => (x.s.style.fillOpacity = fp));
      } else if (e.lines) {
        const n = e.lines.length;
        e.lines.forEach((s, li) => { const lp = clamp(p * n - li), hide = `${(1 - lp) * 100}%`;
          s.style.clipPath = e.ltr ? `inset(-20% ${hide} -20% 0)` : `inset(-20% 0 -20% ${hide})`; });
      } else if (e.path) {
        e.path.style.strokeDashoffset = e.L * (1 - p);
        if (e.head) e.head.setAttribute("opacity", p >= 0.98 ? 1 : 0);
      }
      if (p > 0 && p < 1) { const pt = pen(e, p); if (pt) { handSt = { ...pt, visible: true }; last = pt; } }
    }
    // بين عنصرين: الإيد بتتنقل من آخر نقطة لأول نقطة في اللي بعده. وفي الآخر بتمشي بره السبورة
    if (!handSt) {
      const next = live.find((e) => t < e.start), prev = [...live].reverse().find((e) => t >= e.start + e.dur);
      if (next) {
        const gap = next.start - (prev ? prev.start + prev.dur : 0), a = prev ? pen(prev, 0.999) || last : { x: 1250, y: 1750 }, b = pen(next, 0.001) || a;
        const p = ease(1 - (next.start - t) / Math.max(0.15, Math.min(gap, 0.5)));
        handSt = { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) - Math.sin(p * Math.PI) * 40, visible: true };
      } else if (prev) {
        const a = pen(prev, 0.999) || last, p = ease((t - prev.start - prev.dur) / 0.6);
        handSt = { x: lerp(a.x, 1300, p), y: lerp(a.y, 1900, p), visible: p < 1 };
      }
    }
    return handSt;
  };
}
