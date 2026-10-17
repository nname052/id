// فيديو السبورة البيضاء: إيد ماسكة قلم بترسم وتكتب خطوة خطوة.
// - الرسومات والأيقونات بتترسم خط بخط (stroke-dashoffset)، وسن القلم ماشي على نفس الخط (getPointAtLength)، والألوان بتتملا بعد الحدود.
// - الكلام بيتكتب من اليمين للشمال (قص تدريجي) والإيد ماشية على السطر.
// - الأسهم والخطوط تحت الكلام والدواير بتترسم بخط إيد متعرّج شوية.
// كل حاجة محسوبة من t (حتمية) زي باقي المشغّل.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = (x) => (x = clamp(x), x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
// تسارع/تباطؤ ناعم لنقل الإيد: أعلى سرعة 1.57× المتوسط (بدل 2×)
const easeMove = (x) => (1 - Math.cos(Math.PI * clamp(x))) / 2;
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
        // مع non-scaling-stroke الشرطة بتتقاس ببكسل الشاشة، والطول من getTotalLength بوحدات الرسمة الصغيرة:
        // لو استخدمنا الطول زي ما هو، الخط بيطلع متقطّع (شرط) حتى بعد ما يخلص. فبنحوّله لطول على الشاشة
        const m = s.getCTM(), Ls = L * (m ? Math.hypot(m.a, m.b) : 1);
        s.style.strokeDasharray = `${Ls} ${Ls}`; s.style.strokeDashoffset = Ls;
        return { s, L, Ls };
      }).filter((x) => x.L > 0.5);
      // أصغر الأشكال (تفاصيل صغيرة جدًا) ما بتاخدش وقت رسم: بتظهر مع الألوان
      e.total = e.shapes.reduce((n, x) => n + x.L, 0);
      e.box = box; e.zone = z; e.dur = (it.kind === "illustration" ? 2.8 : it.kind === "emoji" ? 1.6 : 1.4) * PACE;
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
      e.dur = clamp((0.3 + 0.085 * t.length) * PACE, 0.8, 2.4);
    } else {
      e.mark = true; e.dur = (it.kind === "circle" ? 0.9 : 0.7) * PACE;
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

  // ---------- طريق القلم جوه الرسمة ----------
  // الإيد الحقيقية ما بتنطّش من خط لخط: بترسم الخط اللي أقرب لمكانها، وبعدين ترفع القلم وتتنقل للي بعده بسرعة محدودة.
  // فكل رسمة ليها خطة (مرة واحدة، ثابتة): ترتيب الخطوط بالأقرب، ووقت رسم لكل خط حسب طوله، ووقت نقل بين الخطوط حسب المسافة.
  const ptAt = (e, x, len) => { const pt = x.s.getPointAtLength(clamp(len, 0, x.L)), m = x.s.getCTM();
    const q = m ? new DOMPoint(pt.x, pt.y).matrixTransform(m) : pt; return { x: e.zone.x + q.x, y: e.zone.y + q.y }; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const MOVE_SPEED = 1800; // متوسط سرعة الإيد وهي رافعة القلم (بكسل/ثانية)؛ أعلى سرعة لحظية حوالي الضعف مع التسارع والتباطؤ
  const DRAW_SPEED = 2400; // أقصى سرعة رسم بالقلم (بكسل/ثانية على مسرح 1080×1920)
  const strokePlan = (e) => {
    if (e.tl) return e.tl;
    // كل خط ممكن يكون فيه كذا حتة منفصلة (path بأكتر من M): بنلاقي أماكن القطع بالعيّنات، والقلم بيرسم حتة حتة
    // وبيرفع ويتنقل بين الحتت (ترتيب الحتت جوه الخط زي ما هو، علشان الظهور يمشي على الخط صح)
    e.shapes.forEach((x) => {
      const n = Math.min(200, Math.max(2, Math.ceil(x.L / 8))), step = x.L / n, pcs = [];
      let l0 = 0, prev = ptAt(e, x, 0);
      for (let i = 1; i <= n; i++) {
        const q = ptAt(e, x, i * step);
        if (dist(prev, q) > Math.max(25, step * 3)) { pcs.push({ l0, l1: (i - 1) * step }); l0 = i * step; }
        prev = q;
      }
      pcs.push({ l0, l1: x.L });
      x.pieces = pcs.filter((g) => g.l1 - g.l0 > 0.5).map((g) => ({ ...g, p0: ptAt(e, x, g.l0), p1: ptAt(e, x, g.l1) }));
      if (!x.pieces.length) x.pieces = [{ l0: 0, l1: x.L, p0: ptAt(e, x, 0), p1: ptAt(e, x, x.L) }];
      x.p0 = x.pieces[0].p0; x.p1 = x.pieces[x.pieces.length - 1].p1;
      x.inner = x.pieces.slice(1).reduce((m, g, i) => m + Math.max(0.03, dist(x.pieces[i].p1, g.p0) / MOVE_SPEED), 0);
    });
    // رسمة معقدة (خطوطها أطول من اللي إيد تلحق ترسمه في وقتها): القلم بيرسم الخطوط الأساسية (الأطول) بس،
    // والتفاصيل الصغيرة بتظهر مع التلوين، زي فيديوهات السبورة الحقيقية
    const budget = DRAW_SPEED * e.dur * 0.7;
    let acc = 0;
    [...e.shapes].sort((a, b) => b.L - a.L).forEach((x) => { x.noHand = acc + x.L > budget && acc > 0; if (!x.noHand) acc += x.L; });
    const nnOrder = (list) => { const rest = [...list], out = []; if (!rest.length) return out;
      let cur = rest.reduce((b, x) => (x.p0.x - x.p0.y * 0.3 > b.p0.x - b.p0.y * 0.3 ? x : b), rest[0]).p0;
      while (rest.length) { let bi = 0; for (let i = 1; i < rest.length; i++) if (dist(cur, rest[i].p0) < dist(cur, rest[bi].p0)) bi = i;
        const x = rest.splice(bi, 1)[0]; out.push(x); cur = x.p1; }
      return out; };
    // وقت النقل (بين الخطوط وبين حتت الخط الواحد) على قد المسافة، عمره ما بيتضغط. لو كتير على وقت الرسمة،
    // القلم بيرسم خطوط أقل (الأصغر بيظهر مع التلوين) بدل ما يتنقل أسرع من إيد حقيقية
    let order, mv;
    for (;;) {
      order = nnOrder(e.shapes.filter((x) => !x.noHand));
      mv = order.reduce((m, x, i) => m + x.inner + (i ? Math.max(0.03, dist(order[i - 1].p1, x.p0) / MOVE_SPEED) : 0), 0);
      if (mv <= e.dur * 0.4 || order.length <= 1) break;
      order.reduce((m, x) => (x.L < m.L ? x : m), order[0]).noHand = true;
    }
    const drawT = Math.max(0.1, e.dur - mv), tot = order.reduce((n, x) => n + Math.max(x.L, 4), 0);
    e.drawSpeed = order.length ? tot / drawT : 0; e.handShapes = order.length; e.allShapes = e.shapes.length;
    let t = 0; e.tl = [];
    const moveTo = (a, b) => { const d = Math.max(0.03, dist(a, b) / MOVE_SPEED); e.tl.push({ move: true, a, b, t0: t, t1: t + d }); t += d; };
    order.forEach((x, i) => {
      if (i) moveTo(order[i - 1].p1, x.p0);
      x.pieces.forEach((g, k) => {
        if (k) moveTo(x.pieces[k - 1].p1, g.p0);
        const d = drawT * Math.max(g.l1 - g.l0, 4 / x.pieces.length) / tot;
        e.tl.push({ x, l0: g.l0, l1: g.l1, t0: t, t1: t + d }); t += d;
      });
    });
    return e.tl;
  };
  // تقسيم وقت الكتابة: كل سطر ليه وقت، وبين كل سطرين 15% من الوقت لرجوع القلم
  const lineSeg = (e, p) => {
    const n = e.lines.length, R = n > 1 ? 0.15 : 0, w = (1 - R * (n - 1)) / n;
    let t = clamp(p);
    for (let li = 0; li < n; li++) {
      if (t <= w || li === n - 1) return { li, q: clamp(t / w), ret: false };
      t -= w;
      if (t <= R) return { li, q: clamp(t / R), ret: true };
      t -= R;
    }
    return { li: n - 1, q: 1, ret: false };
  };
  // نقطة سن القلم وهو بيرسم عنصر عند تقدّم p (إحداثيات المسرح)
  const pen = (e, p) => {
    if (e.shapes) {
      if (!e.shapes.length) return null;
      const tl = strokePlan(e), tt = clamp(p) * e.dur;
      if (!tl.length) return null; // كل خطوطها بتظهر مع التلوين (مفيش حاجة للقلم يرسمها)
      const sg = tl.find((g) => tt <= g.t1) || tl[tl.length - 1], q = clamp((tt - sg.t0) / Math.max(1e-6, sg.t1 - sg.t0));
      if (sg.move) { const u = easeMove(q); return { x: lerp(sg.a.x, sg.b.x, u), y: lerp(sg.a.y, sg.b.y, u) - Math.sin(u * Math.PI) * Math.min(18, dist(sg.a, sg.b) * 0.15), lifted: true }; }
      return ptAt(e, sg.x, sg.l0 + (sg.l1 - sg.l0) * q);
    }
    if (e.lines) {
      // سطر سطر، وبين السطرين القلم بيرجع لأول السطر اللي تحته (مش بينط في لحظة)
      const n = e.lines.length, g = lineSeg(e, p), s = e.lines[g.li];
      const ptLine = (sp, q) => ({ x: e.box.offsetLeft + sp.offsetLeft + sp.offsetWidth * (e.ltr ? q : 1 - q), y: e.box.offsetTop + sp.offsetTop + sp.offsetHeight * 0.72 });
      if (g.ret) { const a = ptLine(e.lines[g.li], 1), b = ptLine(e.lines[g.li + 1], 0), u = easeMove(g.q); return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) - Math.sin(u * Math.PI) * 20, lifted: true }; }
      const pt = ptLine(s, g.q); return { x: pt.x, y: pt.y + Math.sin(p * 60) * 6 };
    }
    if (e.path) { const pt = e.path.getPointAtLength(e.L * p); return { x: pt.x, y: pt.y }; }
    return null;
  };

  // أول وآخر نقطة للقلم في كل عنصر (هندسة بس، من غير توقيت): للرسمة البداية من فوق-يمين والنهاية في نصها تقريبًا
  const topRight = (e) => { e.shapes.forEach((x) => { if (!x.p0) { x.p0 = ptAt(e, x, 0); x.p1 = ptAt(e, x, x.L); } });
    return e.shapes.reduce((b, x) => (x.p0.x - x.p0.y * 0.3 > b.p0.x - b.p0.y * 0.3 ? x : b), e.shapes[0]).p0; };
  const beginPt = (e) => (e.shapes ? (e.shapes.length ? topRight(e) : null) : pen(e, 0.001));
  const endPt = (e) => (e.shapes ? { x: e.zone.x + e.zone.w / 2, y: e.zone.y + e.zone.h / 2 } : pen(e, 0.999));
  // التوقيت: كل عنصر مع كلمته، ومن غير ما عنصرين يترسموا في نفس الوقت.
  // لو الوقت مش مكفي: الرسم يسرع لحد 70% بس (مش لربع السرعة)، والزيادة (العلامات الأول، وبعدين آخر العناصر) بتتشال بدل ما كله يجري
  let live = els.filter((e) => !e.skip);
  const avail = ctx.duration - 0.45;
  // وقت نقل الإيد بين عنصرين (حسب المسافة، بسرعة محدودة): العنصر اللي بعده بيستنى الإيد توصل
  // تقدير مأمون: من أبعد ركن في مكان العنصر اللي قبله (القلم ممكن يخلص في أي حتة فيه)
  const farFrom = (a, pb) => { const r = a.zone || (a.path ? a.path.getBBox() : null); if (!r) return endPt(a) || pb;
    const cs = [[r.x, r.y], [r.x + (r.w ?? r.width), r.y], [r.x, r.y + (r.h ?? r.height)], [r.x + (r.w ?? r.width), r.y + (r.h ?? r.height)]];
    return cs.map(([x, y]) => ({ x, y })).reduce((m, c) => (Math.hypot(c.x - pb.x, c.y - pb.y) > Math.hypot(m.x - pb.x, m.y - pb.y) ? c : m)); };
  const travel = (a, b) => { const pb = beginPt(b); if (!pb) return 0.3; const pa = a ? farFrom(a, pb) : { x: 1250, y: 1750 };
    return clamp(Math.hypot(pa.x - pb.x, pa.y - pb.y) / MOVE_SPEED, 0.2, 0.8); };
  // 4 محاولات قبل ما نشيل أي حاجة: مع الكلام بسرعته ← مع الكلام أسرع شوية (70%) ← ورا بعض من غير الكلام ← نشيل الزيادة
  const timeIt = (k, cues) => { let tc = 0.25, prev = null;
    for (const e of live) { e.dur = e.dur0 * k; const cue = cues && e.it.cue_word ? ctx.cue(e.it.cue_word) : 0;
      const earliest = tc + (prev ? travel(prev, e) : 0.25);
      e.start = Math.max(earliest, Math.min(cue > 0 ? cue - 0.1 : earliest, avail - e.dur)); tc = e.start + e.dur; prev = e; } return tc; };
  live.forEach((e) => (e.dur0 = e.dur));
  const kFit = () => clamp((avail - 0.25 - 0.35 * live.length) / live.reduce((n, e) => n + e.dur0, 0), 0.7, 1);
  let end = timeIt(1, true);
  if (end > avail) end = timeIt(kFit(), true);
  if (end > avail) end = timeIt(kFit(), false);
  while (end > avail && live.length > 1) {
    const drop = [...live].reverse().find((e) => e.mark) || live[live.length - 1];
    drop.skip = true; drop.dropped = true; if (drop.box) drop.box.style.display = "none"; if (drop.path) drop.path.style.display = "none";
    live = live.filter((e) => e !== drop);
    end = timeIt(kFit(), false);
  }
  el.dataset.dropped = els.filter((e) => e.dropped).length;
  // للفحص بس (قراية): كل عنصر بيترسم امتى وبياخد قد إيه (بالنسبة لبداية المشهد)
  (window.__wbDebug ??= []).push({ scene: sc.id, items: live.map((e) => ({ kind: e.kind, start: +e.start.toFixed(3), dur: +e.dur.toFixed(3) })), dropped: +el.dataset.dropped });
  (window.__wbStats ??= []).push(() => ({ scene: sc.id, items: live.map((e) => ({ kind: e.kind, drawSpeed: e.drawSpeed ? Math.round(e.drawSpeed) : null, handShapes: e.handShapes ?? null, allShapes: e.allShapes ?? null })) }));

  let last = { x: 1200, y: 1700 };
  return (t) => {
    let handSt = null;
    for (const e of live) {
      const p = clamp((t - e.start) / e.dur);
      if (e.shapes) {
        // كل خط بيترسم في وقته من خطة القلم (بالترتيب الأقرب، مش ترتيب الملف)
        const tl = e.shapes.length ? strokePlan(e) : [], tt = p * e.dur;
        e.shapes.forEach((x) => (x._rev = 0));
        for (const g of tl) if (!g.move && tt >= g.t0) g.x._rev = g.l0 + (g.l1 - g.l0) * clamp((tt - g.t0) / Math.max(1e-6, g.t1 - g.t0));
        e.shapes.forEach((x) => { if (!x.noHand) x.s.style.strokeDashoffset = x.Ls * (1 - x._rev / x.L); });
        // الألوان بتتملا في آخر جزء من الرسم وبعده
        const fp = clamp((t - e.start - e.dur * 0.7) / (e.dur * 0.6));
        if (e.kind !== "icon") e.shapes.forEach((x) => (x.s.style.fillOpacity = fp));
        e.shapes.forEach((x) => { if (x.noHand) { x.s.style.strokeDashoffset = 0; x.s.style.strokeOpacity = fp; } }); // التفاصيل مع التلوين
      } else if (e.lines) {
        const g = lineSeg(e, p);
        e.lines.forEach((s, li) => { const lp = li < g.li ? 1 : li > g.li ? 0 : g.ret ? 1 : g.q, hide = `${(1 - lp) * 100}%`;
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
        // النقل للعنصر اللي بعده: بيبدأ قبله بوقت كفاية للمسافة (بسرعة محدودة)، مش في لحظة
        const a = prev ? pen(prev, 0.999) || last : { x: 1250, y: 1750 }, b = pen(next, 0.001) || a;
        const gap = next.start - (prev ? prev.start + prev.dur : 0);
        const need = Math.max(0.2, Math.hypot(a.x - b.x, a.y - b.y) / MOVE_SPEED), d = Math.min(Math.max(gap, 0.2), need);
        const p = easeMove(1 - (next.start - t) / d);
        handSt = { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) - Math.sin(p * Math.PI) * 40, visible: true };
      } else if (prev) {
        const a = pen(prev, 0.999) || last, d = clamp(Math.hypot(a.x - 1300, a.y - 1900) / MOVE_SPEED, 0.6, 1.4), p = easeMove((t - prev.start - prev.dur) / d);
        handSt = { x: lerp(a.x, 1300, p), y: lerp(a.y, 1900, p), visible: p < 1 };
      }
    }
    return handSt;
  };
}
