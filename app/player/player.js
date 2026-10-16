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

  let D, P, ID, scenes = [], words = [], DURATION = 1, PACE = 1;

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
      const [x, y, w, h] = await poseRect(`/assets/${encodeURI(v.xml)}`, v.pose);
      // قص الوضعية بس (من غير ما حتت الوضعيات اللي جنبها تبان)
      const cid = `c${Math.round(x)}_${Math.round(y)}_${(visual.n = (visual.n || 0) + 1)}`;
      box.innerHTML = `<svg viewBox="${x} ${y + 4} ${w} ${h - 4}" preserveAspectRatio="xMidYMax meet"><clipPath id="${cid}"><rect x="${x}" y="${y + 4}" width="${w}" height="${h - 4}"/></clipPath>
        <image href="/assets/${encodeURI(v.asset)}" width="864" height="640" clip-path="url(#${cid})"/></svg>`;
      const img = $("image", box);
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
    const p = clamp(t / ((enter === "draw" ? 1.0 : 0.6) * PACE));
    el.style.opacity = enter === "fade" ? easeOut(p) : clamp(p * 3);
    el.style.transform = `${enterStyle(enter, p)} ${p >= 1 ? idleStyle(idle, t) : ""}`;
    if (el._paths) el._paths.forEach((x) => {
      if (!x.dataset.len) { let L = 100; try { L = x.getTotalLength(); } catch {} x.dataset.len = L; x.style.strokeDasharray = L; }
      x.style.strokeDashoffset = enter === "draw" ? x.dataset.len * (1 - easeInOut(p)) : 0;
    });
    if (el._anim) { const fr = el._anim.frameRate || 30; el._anim.goToAndStop((Math.max(0, t) * fr) % el._anim.totalFrames, true); }
  }
  // العنوان بيدخل، وآخر كلمة بيتعلّم تحتها
  function headIn(el, t, axis = "y") {
    if (!el) return;
    const p = easeOut((t - 0.15 * PACE) / (0.45 * PACE));
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
        s._t = w ? Math.max(last, w.start - sc.start - 0.08) : last + (i ? 0.16 * PACE : 0.1); last = s._t; });
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
        if (arc) arc.style.strokeDashoffset = L * (1 - p * frac);
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
      const span = clamp((sc.end - sc.start - 1.2) / sc.items.length, 0.35, 1.4);
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
      return (t) => { const p = easeOut(t / (0.5 * PACE)), b = back(clamp((t - 0.35) / (0.45 * PACE)));
        $(".chr", el).style.cssText = `opacity:${clamp(p * 2)};transform:translateY(${(1 - p) * 300 + Math.sin(t * 2.2 / PACE) * 6}px) scaleY(${1 + 0.012 * Math.sin(t * 2.2 / PACE)})`;
        $(".bubble", el).style.cssText = `opacity:${clamp(b)};transform:scale(${b})`; };
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
      for (const t of [0, 0.3, 1, ctx.duration / 2, ctx.duration]) scene.renderAt(t, ctx);
      return (t) => { try { scene.renderAt(Math.max(0, t), ctx); } catch (e) { console.warn(e); } };
    },
  };

  // ---------- الخلفيات ----------
  function buildBackground(kind) {
    const bg = $("#bg");
    bg.className = `bg-${kind}`;
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
    PACE = { calm: 1.35, normal: 1, energetic: 0.72 }[P.pace] || 1;
    words = D.words.words;
    DURATION = D.words.duration + 0.8;
    if (!D.settings.subtitles) $("#subs").style.display = "none";
    buildBackground(ID.background);
    await Promise.all([document.fonts.load(`800 100px "${ID.font_heading}"`, "عربي"), document.fonts.load(`600 50px "${ID.font_body}"`, "عربي")]);

    // توقيت كل مشهد من أول كلمة في جمله
    const firstWord = (sids) => words.find((w) => sids.includes(w.sid));
    P.scenes.forEach((sc, i) => { const fw = firstWord(sc.sentence_ids); sc.start = i === 0 ? 0 : Math.max(0, (fw ? fw.start : 0) - 0.2); });
    P.scenes.forEach((sc, i) => { sc.end = i < P.scenes.length - 1 ? P.scenes[i + 1].start : DURATION; });
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
    el.style.transform = tf;
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
    for (const { sc, el, update } of scenes) {
      const on = t >= sc.start - 0.01 && t < sc.end + overlap();
      el.style.display = on ? "" : "none";
      if (!on) continue;
      transition(el, t, sc);
      update(t - sc.start);
    }
    curtain(t);
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
