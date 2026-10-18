// المشغّل (النسخة 2): بيرسم الفيديو من scenes/plan.json و words.json. نفس الكود في المعاينة والتصدير.
// كل فيديو ليه هوية (ألوان، خطوط، خلفية، انتقالات)، وكل مشهد ليه شكل من 12 شكل، أو كود مبتكر كتبه Claude.
// كل حاجة بتتحسب من t جوه renderAt(t) (حتمي): مفيش وقت حقيقي ولا أرقام عشوائية.
(() => {
  const params = new URLSearchParams(location.search);
  const PID = params.get("id");
  const MODE = params.get("mode") || "preview"; // preview | render
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeInOut = (x) => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x) => { x = clamp(x); const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // أرقام عشوائية ثابتة (ببذرة)
  const rand = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const norm = (s) => String(s).replace(/[^\p{L}\p{N}]/gu, "");

  let D, P, ID, scenes = [], words = [], DURATION = 1, PACE = 1, WB = null;

  // ---------- الصور من المكتبات ----------
  const cache = {};
  const text = async (url) => (cache[url] ??= await (await fetch(url)).text());
  // وضعية الشخصية: مكانها في ملف الـ XML (نفس مقاس الـ SVG)
  async function poseRect(xmlUrl, pose) {
    const xml = await text(xmlUrl);
    const m = xml.match(new RegExp(`name="${pose}" x="(\\d+)" y="(\\d+)" width="(\\d+)" height="(\\d+)"`)) ||
              xml.match(/name="idle" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/);
    return m.slice(1).map(Number);
  }
  // عنصر صورة: رسمة / أيقونة / إيموجي (بلون الفيديو) / شخصية كرتون
  async function visual(v, cls = "") {
    const box = document.createElement("div");
    box.className = `vis ${v.kind} ${cls}`;
    if (v.kind === "character") {
      const xmlUrl = `/assets/${encodeURI(v.xml)}`;
      const [x, y, w, h] = await poseRect(xmlUrl, v.pose);
      box._pose = [x, y, w, h];
      box._walk = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((i) => poseRect(xmlUrl, `walk${i}`)));
      // قص الوضعية بس (من غير ما حتت الوضعيات اللي جنبها تبان)
      const cid = `c${Math.round(x)}_${Math.round(y)}_${(visual.n = (visual.n || 0) + 1)}`;
      box.innerHTML = `<svg viewBox="${x} ${y + 4} ${w} ${h - 4}" preserveAspectRatio="xMidYMax meet"><clipPath id="${cid}"><rect x="${x}" y="${y + 4}" width="${w}" height="${h - 4}"/></clipPath>
        <image href="/assets/${encodeURI(v.asset)}" width="864" height="640" clip-path="url(#${cid})"/></svg>`;
      const img = $("image", box);
      // بيغيّر الوضعية المعروضة (للمشي: فريم ورا فريم)
      box._show = ([x, y, w, h]) => { const vb = `${x} ${y + 4} ${w} ${h - 4}`; const sv = $("svg", box);
        if (sv.getAttribute("viewBox") !== vb) { sv.setAttribute("viewBox", vb); const rc = $("rect", box); rc.setAttribute("x", x); rc.setAttribute("y", y + 4); } };
      await new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = img.getAttribute("href"); });
    } else if (String(v.asset).endsWith(".json")) { // إيموجي Lottie (مشاريع قديمة)
      const data = await (await fetch(`/assets/${v.asset}`)).json();
      box._anim = await new Promise((res) => { const a = lottie.loadAnimation({ container: box, renderer: "svg", loop: false, autoplay: false, animationData: data }); a.addEventListener("DOMLoaded", () => res(a)); });
    } else {
      box.innerHTML = await text(`/assets/${v.asset}`);
      if (v.kind === "icon") {
        box._paths = [...box.querySelectorAll("path, circle, line, polyline, polygon, rect, ellipse")]; // طولها بيتحسب لما تتعرض
      }
    }
    return box;
  }

  // ---------- الحركات الجاهزة ----------
  function enterStyle(kind, p) {
    switch (kind) {
      case "pop": return `scale(${0.2 + 0.8 * back(p)})`;
      case "slide": return `translateX(${(1 - easeOut(p)) * -420}px)`;
      case "fade": return `scale(${0.97 + 0.03 * easeOut(p)})`;
      case "draw": return `scale(${0.92 + 0.08 * easeOut(p)})`;
      default: return `translateY(${(1 - easeOut(p)) * 140}px) scale(${0.94 + 0.06 * easeOut(p)})`; // rise
    }
  }
  function idleStyle(kind, t) {
    t /= PACE;
    switch (kind) {
      case "pulse": return `scale(${1 + 0.03 * Math.sin(t * 3.2)})`;
      case "wobble": return `rotate(${2.2 * Math.sin(t * 2.4)}deg)`;
      case "none": return "";
      default: return `translateY(${Math.sin(t * 1.7) * 12}px)`; // float
    }
  }
  // دخول الصورة بالحركة المختارة + حركة هادية بعدها + رسم الأيقونة خط بخط
  function animate(el, t, enter = "rise", idle = "float") {
    if (!el) return;
    // دخول أهدى: 0.9 ثانية (والرسم خط بخط 1.4) بدل 0.6/1.0، علشان العين تلحق الفكرة
    const p = clamp(t / ((enter === "draw" ? 1.4 : 0.9) * PACE));
    el.style.opacity = enter === "fade" ? easeOut(p) : clamp(p * 3);
    el.style.transform = `${enterStyle(enter, p)} ${p >= 1 ? idleStyle(idle, t) : ""}`;
    if (el._paths) el._paths.forEach((x) => {
      if (!x.dataset.len) { let L = 100; try { L = x.getTotalLength(); } catch {} x.dataset.len = L; x.style.strokeDasharray = L; }
      x.style.strokeDashoffset = enter === "draw" ? x.dataset.len * (1 - easeInOut(p)) : 0;
      x.style.strokeOpacity = enter === "draw" && p <= 0 ? 0 : 1;   // شرطة طولها صفر بطرف مدوّر بتبان نقطة قبل الرسم
    });
    if (el._anim) { const fr = el._anim.frameRate || 30; el._anim.goToAndStop((Math.max(0, t) * fr) % el._anim.totalFrames, true); }
  }
  // العنوان بيدخل، وآخر كلمة بيتعلّم تحتها
  function headIn(el, t, axis = "y") {
    if (!el) return;
    const p = easeOut((t - 0.15 * PACE) / (0.7 * PACE));
    el.style.opacity = p;
    el.style.transform = axis === "x" ? `translateX(${(1 - p) * -60}px)` : `translateY(${(1 - p) * 40}px)`;
    const hl = el.querySelector(".hl");
    if (hl) hl.style.setProperty("--p", easeInOut((t - 0.45 * PACE) / (0.5 * PACE)));
  }

  function headHTML(txt) {
    const ws = String(txt || "").split(/\s+/).filter(Boolean);
    return ws.map((w, i) => `<span class="w${i === ws.length - 1 ? " hl" : ""}">${esc(w)}</span>`).join(" ");
  }
  // بيصغّر الخط لحد ما الكلام يدخل في العرض وعدد السطور
  function fit(el, max, minSize = 56, maxLines = 1) {
    if (!el) return;
    el.style.whiteSpace = maxLines === 1 ? "nowrap" : "normal";
    let fs = parseFloat(getComputedStyle(el).fontSize);
    // ارتفاع الكلام نفسه (مش الصندوق، لأن فيه صناديق ارتفاعها ثابت)
    const kids = [...el.querySelectorAll(".w")];
    const contentH = () => kids.length ? Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight)) - Math.min(...kids.map((k) => k.offsetTop)) : el.offsetHeight;
    const lines = () => contentH() / (parseFloat(getComputedStyle(el).lineHeight) || fs * 1.2);
    while (fs > minSize && (el.scrollWidth > max + 1 || lines() > maxLines + 0.3)) { fs *= 0.93; el.style.fontSize = fs + "px"; }
  }
  const sceneWords = (sc) => words.filter((w) => sc.sentence_ids.includes(w.sid));

  // ---------- أشكال المشاهد ----------
  // كل شكل بيبني عناصره مرة واحدة وبيرجّع update(t)، و t = الوقت من بداية المشهد
  const LAYOUT = {
    async hero(sc, el) {
      const v = sc.visuals[0] && await visual(sc.visuals[0]);
      el.innerHTML = `<div class="zone"></div><div class="hd">${headHTML(sc.headline)}</div>`;
      if (v) $(".zone", el).appendChild(v);
      fit($(".hd", el), 940);
      return (t) => { animate(v, t - sc.cueL, sc.enter, sc.idle); headIn($(".hd", el), t); };
    },
    async kinetic(sc, el) {
      el.innerHTML = `<div class="kin">${headHTML(sc.headline)}</div>`;
      const box = $(".kin", el), spans = [...box.querySelectorAll(".w")];
      fit(box, 920, 80, 4);
      // كل كلمة بتظهر وقت ما بتتقال (لو موجودة في الجملة)، وإلا ورا بعض
      const sw = sceneWords(sc);
      let last = 0;
      spans.forEach((s, i) => { const w = sw.find((w) => norm(w.word) === norm(s.textContent));
        // الكلمة بتظهر وقت ما بتتقال، بس مش متأخرة عن ترتيبها (علشان المشهد ما يفضلش فاضي لحد الكلمة)
        const byOrder = 0.12 + i * 0.22 * PACE;
        s._t = Math.max(last, Math.min(w ? w.start - sc.start - 0.08 : byOrder, byOrder)); last = s._t; });
      return (t) => spans.forEach((s) => { const p = clamp((t - s._t) / (0.35 * PACE));
        s.style.opacity = clamp(p * 2); s.style.transform = `translateY(${(1 - easeOut(p)) * 60}px) scale(${0.85 + 0.15 * back(p)})`; });
    },
    async split(sc, el) {
      const v = sc.visuals[0] && await visual(sc.visuals[0]);
      el.innerHTML = `<div class="split-vis"></div><div class="split-txt"><div class="hd">${headHTML(sc.headline)}</div><div class="bar"></div></div>`;
      if (v) $(".split-vis", el).appendChild(v);
      fit($(".split-txt .hd", el), 470, 60, 3);
      return (t) => { animate(v, t - sc.cueL, sc.enter === "draw" ? "draw" : "slide", sc.idle); headIn($(".split-txt", el), t, "x");
        $(".bar", el).style.transform = `scaleX(${easeInOut((t - 0.5) / (0.6 * PACE))})`; };
    },
    async stat(sc, el) {
      const m = String(sc.number_value || "").match(/^(\D*)([\d.,]+)(.*)$/);
      const num = m ? { pre: m[1], val: parseFloat(m[2].replace(/,/g, "")), post: m[3], dec: (m[2].split(".")[1] || "").length } : null;
      const frac = num && num.post.includes("%") ? clamp(num.val / 100) : 0.8;
      el.innerHTML = `${sc.chart === "ring" ? `<svg class="ring" viewBox="0 0 700 700"><circle class="trk" cx="350" cy="350" r="300"/><circle class="arc" cx="350" cy="350" r="300"/></svg>` : ""}
        <div class="num">${esc(sc.number_value)}</div><div class="nlabel">${esc(sc.number_label || sc.headline)}</div>
        ${sc.chart === "bar" ? `<div class="sbar"><div></div></div>` : ""}`;
      el.classList.add(`chart-${sc.chart || "none"}`);
      fit($(".num", el), sc.chart === "ring" ? 520 : 940, 120);
      fit($(".nlabel", el), 900, 50, 2);
      const arc = $(".arc", el), L = 2 * Math.PI * 300, bar = $(".sbar div", el);
      if (arc) arc.style.strokeDasharray = L;
      return (t) => {
        const p = easeOut((t - sc.cueL) / (1.3 * PACE)), n = $(".num", el);
        if (num) n.textContent = num.pre + (num.val * p).toFixed(num.dec) + num.post;
        n.style.transform = `scale(${0.6 + 0.4 * back(clamp((t - sc.cueL) / (0.5 * PACE)))})`;
        n.style.opacity = clamp((t - sc.cueL) * 4);
        if (arc) { arc.style.strokeDashoffset = L * (1 - p * frac); arc.style.strokeOpacity = p > 0 ? 1 : 0; }
        if (bar) bar.style.width = `${p * frac * 100}%`;
        headIn($(".nlabel", el), t - 0.3);
      };
    },
    async list(sc, el) {
      el.innerHTML = `<div class="hd top">${headHTML(sc.headline)}</div><div class="rows"></div>`;
      fit($(".hd", el), 940);
      const rows = $(".rows", el);
      for (const [i, it] of sc.items.entries()) {
        const row = document.createElement("div"); row.className = "row";
        row.innerHTML = `<div class="no">${i + 1}</div><div class="lb">${esc(it.label)}</div><div class="ic"></div>`;
        if (it.visual) $(".ic", row).appendChild(await visual(it.visual, "small"));
        rows.appendChild(row);
        fit($(".lb", row), 600, 44);
      }
      const span = clamp((sc.end - sc.start - 1.2) / sc.items.length, 0.5, 1.4);
      return (t) => { headIn($(".hd", el), t);
        [...rows.children].forEach((r, i) => { const t0 = 0.5 + i * span, p = clamp((t - t0) / (0.45 * PACE));
          r.style.opacity = clamp(p * 2); r.style.transform = `translateX(${(1 - easeOut(p)) * -160}px)`; animate($(".vis", r), t - t0, "pop", "none"); }); };
    },
    async versus(sc, el) {
      const [a, b] = sc.items;
      el.innerHTML = `<div class="hd top">${headHTML(sc.headline)}</div>
        <div class="side vs-a"><div class="ic"></div><div class="lb">${esc(a.label)}</div></div>
        <div class="side vs-b"><div class="ic"></div><div class="lb">${esc(b.label)}</div></div><div class="vs">VS</div>`;
      if (a.visual) $(".vs-a .ic", el).appendChild(await visual(a.visual));
      if (b.visual) $(".vs-b .ic", el).appendChild(await visual(b.visual));
      fit($(".hd", el), 940); fit($(".vs-a .lb", el), 420, 44, 2); fit($(".vs-b .lb", el), 420, 44, 2);
      return (t) => { headIn($(".hd", el), t);
        const pa = easeOut((t - 0.3) / (0.5 * PACE)), pb = easeOut((t - 0.9 * PACE) / (0.5 * PACE));
        $(".vs-a", el).style.cssText = `opacity:${pa};transform:translateX(${(1 - pa) * 500}px)`;
        $(".vs-b", el).style.cssText = `opacity:${pb};transform:translateX(${(1 - pb) * -500}px)`;
        $(".vs", el).style.transform = `translate(-50%, -50%) scale(${back(clamp((t - 1.2 * PACE) / (0.4 * PACE)))}) rotate(${4 * Math.sin(t * 2)}deg)`; };
    },
    async quote(sc, el) {
      const full = D.script.find((s) => sc.sentence_ids.includes(s.id));
      const txt = sc.headline.split(/\s+/).length >= 3 || !full ? sc.headline : full.text;
      el.innerHTML = `<div class="qcard"><div class="qmark">”</div><div class="qtxt">${headHTML(txt)}</div><div class="qline"></div></div>`;
      fit($(".qtxt", el), 780, 56, 5);
      return (t) => { const p = easeOut(t / (0.6 * PACE)), c = $(".qcard", el);
        c.style.opacity = p; c.style.transform = `translateY(${(1 - p) * 80}px) rotate(${-1.5 + 0.6 * Math.sin(t * 0.8)}deg)`;
        $(".qmark", el).style.transform = `scale(${back(clamp((t - 0.2) / (0.5 * PACE)))})`;
        $(".qline", el).style.transform = `scaleX(${easeInOut((t - 0.6) / (0.8 * PACE))})`; };
    },
    async question(sc, el) {
      el.innerHTML = `<div class="qbig">؟</div><div class="qtext">${headHTML(sc.headline)}</div>`;
      fit($(".qtext", el), 920, 70, 3);
      return (t) => { $(".qbig", el).style.transform = `translate(-50%, -50%) rotate(${-8 + 6 * Math.sin(t * 0.9)}deg) scale(${0.7 + 0.3 * easeOut(t / (0.7 * PACE))})`;
        $(".qbig", el).style.opacity = 0.18 * easeOut(t / 0.4);
        headIn($(".qtext", el), t - 0.15); };
    },
    async icon_row(sc, el) {
      el.innerHTML = `<div class="hd top">${headHTML(sc.headline)}</div><div class="grid n${sc.items.length}"></div>`;
      fit($(".hd", el), 940);
      for (const it of sc.items) {
        const c = document.createElement("div"); c.className = "cell";
        c.innerHTML = `<div class="ic"></div><div class="lb">${esc(it.label)}</div>`;
        if (it.visual) $(".ic", c).appendChild(await visual(it.visual, "small"));
        $(".grid", el).appendChild(c);
        fit($(".lb", c), 400, 40, 2);
      }
      return (t) => { headIn($(".hd", el), t);
        [...$(".grid", el).children].forEach((c, i) => { const t0 = 0.35 + i * 0.28 * PACE, p = clamp((t - t0) / (0.45 * PACE));
          c.style.opacity = clamp(p * 2); c.style.transform = `scale(${0.4 + 0.6 * back(p)})`; animate($(".vis", c), t - t0, "fade", "float"); }); };
    },
    async card(sc, el) {
      const v = sc.visuals[0] && await visual(sc.visuals[0]);
      el.innerHTML = `<div class="pcard"></div><div class="hd">${headHTML(sc.headline)}</div>`;
      if (v) $(".pcard", el).appendChild(v);
      fit($(".hd", el), 940);
      return (t) => { const p = easeOut((t - sc.cueL) / (0.6 * PACE)), c = $(".pcard", el);
        c.style.opacity = p; c.style.transform = `translateY(${(1 - p) * 120}px) rotate(${lerp(-12, -3, p) + 0.8 * Math.sin(t)}deg)`;
        animate(v, t - sc.cueL, "fade", sc.idle); headIn($(".hd", el), t); };
    },
    async character(sc, el) {
      const v = await visual(sc.visuals[0]);
      el.innerHTML = `<div class="chr"></div><div class="bubble"><div class="bt">${headHTML(sc.headline)}</div></div>`;
      $(".chr", el).appendChild(v);
      fit($(".bt", el), 460, 52, 3);
      const WALK = 1.1 * PACE; // مدة الدخول ماشي
      return (t) => {
        const p = clamp(t / WALK), walking = t < WALK && v._walk;
        if (v._show) v._show(walking ? v._walk[Math.floor(t * 11) % 8] : v._pose);
        const x = (1 - easeOut(p)) * -620, bob = walking ? Math.abs(Math.sin(t * 11 * Math.PI / 4)) * -10 : Math.sin(t * 2.2 / PACE) * 6;
        $(".chr", el).style.cssText = `opacity:${clamp(t * 6)};transform:translate(${x}px, ${bob}px) scaleY(${1 + (walking ? 0 : 0.012 * Math.sin(t * 2.2 / PACE))})`;
        const b = back(clamp((t - WALK - 0.05) / (0.45 * PACE)));
        $(".bubble", el).style.cssText = `opacity:${clamp(b)};transform:scale(${b})`; };
    },
    // مشهد سبورة بيضاء: إيد بقلم بترسم وتكتب (player_wb.js)
    async board(sc, el) {
      const wb = (WB = await import("/player/player_wb.js?v=2"));
      await wb.handLayer($("#stage"));
      const sw = sceneWords(sc);
      return await wb.createBoard(sc, el, { duration: sc.end - sc.start, palette: ID.palette, font: ID.font_heading, pace: PACE,
        cue: (word) => { const w = sw.find((x) => norm(x.word) === norm(word)); return w ? Math.max(0, w.start - sc.start) : 0; } });
    },
    // مشهد 3D: شخصية بتمثّل في مكان، بكاميرا سينمائية (player3d.js)
    async scene3d(sc, el) {
      const { createScene3D } = await import("/player/player3d.js?v=1");
      const sw = sceneWords(sc);
      const ctx = { duration: sc.end - sc.start, palette: ID.palette, look: ID.look3d, pace: PACE, dialect: D.settings.dialect,
                    words: sw.map((w) => ({ word: w.word, start: w.start - sc.start, end: w.end - sc.start })),
                    cue: (word) => { const w = sw.find((x) => norm(x.word) === norm(word)); return w ? Math.max(0, w.start - sc.start) : 0; } };
      const draw = await createScene3D(sc, el, ctx);
      el.insertAdjacentHTML("beforeend", `<div class="scrim"></div>${sc.headline ? `<div class="hd top on3d">${headHTML(sc.headline)}</div>` : ""}`);
      fit($(".hd", el), 940, 60, 2);
      draw(0);
      return (t) => { draw(Math.max(0, t)); headIn($(".hd", el), t); };
    },
    // مشهد مبتكر: موديول JS كتبه Claude للمشهد ده بالذات
    async custom(sc, el) {
      const mod = await import(`/files/${PID}/scenes/${sc.custom_file}?v=${encodeURIComponent(P.created || "")}`);
      const scene = mod.default;
      const kit = { ease: easeInOut, easeOut, easeInOut, back, clamp, lerp, rand: (s) => rand(Math.abs(Math.floor(s || 1)) || 1),
        palette: { ...ID.palette }, fonts: { heading: ID.font_heading, body: ID.font_body },
        svg: (tag, attrs = {}) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; } };
      const root = document.createElement("div"); root.className = "custom-root"; el.appendChild(root);
      await scene.setup(root, kit);
      const sw = sceneWords(sc);
      const ctx = { duration: sc.end - sc.start, cue: (word) => { const w = sw.find((x) => norm(x.word) === norm(word)); return w ? Math.max(0, w.start - sc.start) : 0; } };
      // نجرّب كام لحظة قبل التصدير: لو الكود بيقع، المشهد بيرجع لشكل جاهز
      // ونراقب لو الكود حط قيمة مش رقم (NaN) في أي شكل: ده معناه حسبة غلط هتبوّظ الرسم
      const orig = Element.prototype.setAttribute; let bad = null;
      Element.prototype.setAttribute = function (k, v) { if (/NaN|undefined|Infinity/.test(String(v))) { bad = `${k}=${v}`; return; } return orig.call(this, k, v); };
      try { for (const t of [0, 0.3, 1, ctx.duration / 2, ctx.duration]) scene.renderAt(t, ctx); }
      finally { Element.prototype.setAttribute = orig; }
      if (bad || /NaN/.test(root.innerHTML)) throw new Error("custom scene produced " + (bad || "NaN"));
      return (t) => { try { scene.renderAt(Math.max(0, t), ctx); } catch (e) { console.warn(e); } };
    },
  };

  // ---------- الخلفيات ----------
  function buildBackground(kind) {
    const bg = $("#bg");
    bg.className = `bg-${kind}`;
    // السبورة مش لازم أبيض سادة: ورقة نقط أو مربعات أو ورق دافي، ثابتة لنفس الفيديو (من رقمه) وبتتغيّر من فيديو للتاني
    if (kind === "board") { const st = ID.board_style || ["dots", "grid", "paper", "dots"][[...String(PID)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 4];
      bg.dataset.style = st; }
    bg.innerHTML = `<div class="l1"></div><div class="l2"></div><canvas id="grain" width="270" height="480"></canvas>`;
    const g = $("#grain").getContext("2d"), img = g.createImageData(270, 480), r = rand(7);
    for (let i = 0; i < img.data.length; i += 4) { const v = 110 + r() * 145; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }
  function renderBackground(t) {
    const l1 = $("#bg .l1"), l2 = $("#bg .l2"), k = ID.background;
    if (k === "blobs") { l1.style.transform = `translate(${-200 + 90 * Math.sin(t * 0.23)}px, ${-160 + 70 * Math.cos(t * 0.19)}px)`;
      l2.style.transform = `translate(${560 + 80 * Math.cos(t * 0.27)}px, ${1350 + 60 * Math.sin(t * 0.21)}px)`; }
    else if (k === "grid") l1.style.backgroundPosition = `${t * 12}px ${t * 18}px`;
    else if (k === "stripes") l1.style.backgroundPosition = `${t * 30}px 0`;
    else if (k === "split") l1.style.transform = `rotate(${-14 + 2 * Math.sin(t * 0.3)}deg)`;
    else if (k === "gradient") l1.style.transform = `rotate(${t * 4}deg) scale(1.6)`;
    else if (k === "spotlight") l1.style.transform = `translate(${Math.sin(t * 0.4) * 60}px, ${Math.cos(t * 0.33) * 80}px)`;
  }

  // ---------- تجهيز ----------
  async function setup() {
    D = await (await fetch(`/api/projects/${PID}/player-data`)).json();
    P = D.plan;
    // خطط قديمة (نسخة 1): بنحوّلها للشكل الجديد
    if (!P.identity) {
      P.identity = { palette: P.palette, font_heading: "Alexandria", font_body: "Alexandria", background: "blobs", transition: "rise" };
      P.scenes.forEach((s) => { s.layout = s.kind === "text" ? "kinetic" : s.kind === "number" ? "stat" : "hero";
        s.visuals = s.asset ? [{ kind: s.kind, asset: s.asset }] : []; s.items = []; s.chart = "none"; });
    }
    ID = P.identity;
    const st = $("#stage");
    for (const [k, v] of Object.entries(ID.palette)) st.style.setProperty(`--${k}`, v);
    st.style.setProperty("--font-h", `"${ID.font_heading}"`);
    st.style.setProperty("--font-b", `"${ID.font_body}"`);
    if (P.text_size === "large") st.classList.add("large-text");
    if (P.type === "whiteboard" || P.identity?.background === "board") st.classList.add("wb-video");
    PACE = { calm: 1.35, normal: 1, energetic: 0.72 }[P.pace] || 1;
    words = D.words.words;
    DURATION = D.words.duration + 2.2; // وقت بسيط بعد آخر كلمة علشان الفيديو يتقفل بهدوء
    if (!D.settings.subtitles) $("#subs").style.display = "none";
    buildBackground(ID.background);
    await Promise.all([document.fonts.load(`800 100px "${ID.font_heading}"`, "عربي"), document.fonts.load(`600 50px "${ID.font_body}"`, "عربي")]);

    // توقيت كل مشهد من أول كلمة في جمله
    const firstWord = (sids) => words.find((w) => sids.includes(w.sid));
    P.scenes.forEach((sc, i) => { const fw = firstWord(sc.sentence_ids); sc.start = i === 0 ? 0 : Math.max(0, (fw ? fw.start : 0) - 0.2); });
    P.scenes.forEach((sc, i) => { sc.end = i < P.scenes.length - 1 ? P.scenes[i + 1].start : DURATION; });
    // حد أدنى لوقت كل فكرة على الشاشة (الخطة بتدمج المشاهد القصيرة، وده تأمين على التوقيت الحقيقي للصوت):
    // مشهد أقصر من الحد بيندمج في اللي قبله (اللي قبله بيفضل لحد آخره)، وأول مشهد قصير بياخد اللي بعده
    const MIN_SCENE = P.min_scene || 2.5;
    for (let changed = true; changed && P.scenes.length > 1;) {
      changed = false;
      for (let i = 0; i < P.scenes.length - 1; i++) {
        const sc = P.scenes[i];
        if (sc.end - sc.start >= MIN_SCENE) continue;
        if (i === 0) { const nx = P.scenes[1]; sc.end = nx.end; sc.sentence_ids = [...sc.sentence_ids, ...nx.sentence_ids]; P.scenes.splice(1, 1); }
        else { const pv = P.scenes[i - 1]; pv.end = sc.end; pv.sentence_ids = [...pv.sentence_ids, ...sc.sentence_ids]; P.scenes.splice(i, 1); }
        changed = true; break;
      }
    }
    window.__sceneTimes = P.scenes.map((sc) => ({ id: sc.id, start: +sc.start.toFixed(3), end: +sc.end.toFixed(3) }));
    // الصورة بتظهر مع كلمتها، بس مش متأخر أكتر من 0.8 ثانية (علشان المكان ما يفضلش فاضي)
    P.scenes.forEach((sc) => {
      const w = words.find((w) => sc.sentence_ids.includes(w.sid) && norm(w.word) === norm(sc.cue_word));
      sc.cueL = w ? clamp(w.start - 0.1 - sc.start, 0, 0.8) : 0.15;
    });

    const root = $("#scenes");
    for (const sc of P.scenes) {
      const el = document.createElement("div");
      el.className = `scene L-${sc.layout}`;
      root.appendChild(el);
      let update;
      try {
        update = await (LAYOUT[sc.layout] || LAYOUT.kinetic)(sc, el);
      } catch (e) { // مشهد وقع (غالبًا مبتكر): بيرجع لشكل كلام كبير
        console.warn("scene fallback", sc.id, e);
        el.className = "scene L-kinetic"; el.innerHTML = "";
        update = await LAYOUT.kinetic(sc, el);
      }
      el.style.display = "none";
      scenes.push({ sc, el, update });
    }
    window.DURATION = DURATION;
    renderAt(0);
  }

  // ---------- الانتقالات بين المشاهد ----------
  const TR = 0.45;
  const overlap = () => (["wipe", "flash"].includes(ID.transition) ? 0 : TR * PACE);
  function transition(el, t, sc) {
    const inP = easeOut((t - sc.start) / (TR * PACE)), outP = easeInOut((t - sc.end) / (TR * PACE)), k = ID.transition;
    let tf = "", op = Math.min(inP, 1 - outP);
    if (k === "slide") { tf = `translateX(${(1 - inP) * -1080 + outP * 1080}px)`; op = 1; }
    else if (k === "zoom") tf = `scale(${lerp(1.15, 1, inP) * lerp(1, 0.88, outP)})`;
    else if (k === "rise") tf = `translateY(${(1 - inP) * 60 - 70 * outP}px)`;
    else op = 1; // wipe / flash: التغيير بيحصل تحت الستارة
    el.style.opacity = op;
    el.style.transform = `${tf} ${camera2d(sc, t - sc.start)}`;
  }
  // الكاميرا في المشاهد الـ 2D: حركة بطيئة مستمرة بتدّي إحساس سينمائي
  function camera2d(sc, t) {
    const d = Math.max(1, sc.end - sc.start), p = clamp(t / d);
    switch (sc.camera) {
      case "push": return `scale(${1 + 0.06 * easeInOut(p)})`;
      case "pull": return `scale(${1.07 - 0.07 * easeInOut(p)})`;
      case "drift": return `translateX(${lerp(-24, 24, easeInOut(p))}px) scale(1.03)`;
      case "tilt": return `rotate(${lerp(-1.2, 1.2, easeInOut(p))}deg) scale(1.04)`;
      case "shake": return `translate(${Math.sin(t * 37) * 3 * (1 - p)}px, ${Math.cos(t * 41) * 3 * (1 - p)}px)`;
      default: return "";
    }
  }
  function curtain(t) {
    const fx = $("#fx"), k = ID.transition;
    let o = 0, tf = "none";
    for (const { sc } of scenes.slice(1)) {
      const d = t - sc.start;
      if (k === "wipe" && Math.abs(d) < 0.35 * PACE) { o = 1; tf = `translateX(${lerp(-1500, 1500, easeInOut((d + 0.35 * PACE) / (0.7 * PACE)))}px) skewX(-12deg)`; }
      if (k === "flash" && d >= 0 && d < 0.22) o = 1 - d / 0.22;
    }
    fx.className = `fx-${k}`; fx.style.opacity = o; fx.style.transform = tf;
  }

  // ---------- الرسم ----------
  function renderAt(t) {
    renderBackground(t);
    let handSt = null;
    for (const { sc, el, update } of scenes) {
      const on = t >= sc.start - 0.01 && t < sc.end + overlap();
      el.style.display = on ? "" : "none";
      if (!on) continue;
      transition(el, t, sc);
      const res = update(t - sc.start);
      // الإيد بتاعة السبورة: من المشهد الحالي، ومش وقت الانتقال بين سبورتين
      if (sc.layout === "board" && t >= sc.start + TR * PACE && t < sc.end) handSt = res;
    }
    if (WB) WB.placeHand(handSt); // متزامن: لازم الإيد تتحط قبل لقطة الفريم
    curtain(t);
    const live = scenes.filter(({ sc }) => t >= sc.start && t < sc.end).pop();
    $("#subs").classList.toggle("on3d", !!live && live.sc.layout === "scene3d");
    // الترجمة: الجملة اللي بتتقال دلوقتي، والكلمة الحالية ملوّنة
    const cur = words.find((w) => t >= w.start - 0.05 && t <= w.end + 0.25) || [...words].reverse().find((w) => w.start <= t);
    const subs = $("#subs");
    if (cur && t < DURATION - 0.4) {
      if (subs.dataset.sid != cur.sid) { subs.innerHTML = words.filter((w) => w.sid === cur.sid).map((w) => `<span data-i="${w.i}">${esc(w.word)}</span>`).join(" "); subs.dataset.sid = cur.sid; }
      subs.querySelectorAll("span").forEach((s) => { const w = words[+s.dataset.i]; s.className = (t >= w.start ? "said" : "") + (t >= w.start && t < w.end + 0.08 ? " now" : ""); });
      subs.style.opacity = 1;
    } else subs.style.opacity = 0;
  }
  window.renderAt = renderAt;

  // ---------- المعاينة (تشغيل/تقديم) ----------
  function fitStage() {
    if (MODE === "render") { document.body.classList.add("render"); return; }
    const s = Math.min(innerWidth / 1080, (innerHeight - 52) / 1920);
    $("#stage").style.transform = `scale(${s})`;
    $("#frame").style.bottom = "52px";
  }
  function preview() {
    $("#controls").hidden = false;
    const audio = $("#audio"), scrub = $("#scrub"), btn = $("#play");
    if (D.audio) audio.src = D.audio;
    let playing = false, t0 = 0, base = 0;
    const now = () => (D.audio ? audio.currentTime : base + (performance.now() - t0) / 1000);
    const show = (t) => { renderAt(t); scrub.value = (t / DURATION) * 1000; $("#clock").textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; };
    const loop = () => { if (!playing) return; const t = now(); if (t >= DURATION) { playing = false; btn.textContent = "▶"; return; } show(t); requestAnimationFrame(loop); };
    btn.onclick = () => {
      playing = !playing; btn.textContent = playing ? "❚❚" : "▶";
      if (playing) { if (D.audio) audio.play(); else t0 = performance.now(); loop(); }
      else { if (D.audio) audio.pause(); else base = now(); }
    };
    scrub.oninput = () => { const t = (scrub.value / 1000) * DURATION; if (D.audio) audio.currentTime = t; else { base = t; t0 = performance.now(); } show(t); };
  }

  fitStage(); addEventListener("resize", fitStage);
  window.ready = setup().then(() => { if (MODE === "preview") preview(); });
})();
