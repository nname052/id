// المشغّل: بيرسم الفيديو من scenes/plan.json و words.json. نفس الكود في المعاينة والتصدير.
// كل حاجة بتتحسب من t جوه renderAt(t) (حتمي): مفيش وقت حقيقي ولا أرقام عشوائية.
(() => {
  const params = new URLSearchParams(location.search);
  const PID = params.get("id");
  const MODE = params.get("mode") || "preview"; // preview | render
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeInOut = (x) => (x = clamp(x), x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const back = (x) => { x = clamp(x); const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // أرقام عشوائية ثابتة (للحبيبات بس)
  const rand = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  let D, scenes = [], words = [], DURATION = 1, PACE = 1;

  // ---------- تجهيز ----------
  async function setup() {
    D = await (await fetch(`/api/projects/${PID}/player-data`)).json();
    const P = D.plan.palette;
    const stage = $("#stage");
    for (const [k, v] of Object.entries(P)) stage.style.setProperty(`--${k}`, v);
    words = D.words.words;
    // إيقاع الحركة (من الخطة، حسب ذوقك): بيضرب في كل مدد الدخول والطفو
    PACE = { calm: 1.35, normal: 1, energetic: 0.72 }[D.plan.pace] || 1;
    if (D.plan.text_size === "large") stage.classList.add("large-text");
    DURATION = D.words.duration + 0.8;
    if (!D.settings.subtitles) $("#subs").style.display = "none";

    // الحبيبات: صورة ثابتة من أرقام عشوائية ببذرة ثابتة
    const g = $("#grain").getContext("2d"), img = g.createImageData(270, 480), r = rand(7);
    for (let i = 0; i < img.data.length; i += 4) { const v = 110 + r() * 145; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);

    // توقيت كل مشهد من أول كلمة في جمله
    const firstWord = (sids) => words.find((w) => sids.includes(w.sid));
    const plan = D.plan.scenes;
    plan.forEach((sc, i) => {
      const fw = firstWord(sc.sentence_ids);
      sc.start = i === 0 ? 0 : Math.max(0, (fw ? fw.start : 0) - 0.2);
    });
    plan.forEach((sc, i) => { sc.end = i < plan.length - 1 ? plan[i + 1].start : DURATION; });
    // الكلمة اللي العنصر يظهر معاها (لو موجودة في جمل المشهد)
    const norm = (s) => String(s).replace(/[^\p{L}\p{N}]/gu, "");
    plan.forEach((sc) => {
      const w = words.find((w) => sc.sentence_ids.includes(w.sid) && norm(w.word) === norm(sc.cue_word));
      // العنصر بيظهر مع كلمته، بس مش متأخر أكتر من 0.8 ثانية بعد بداية المشهد (علشان المكان ما يفضلش فاضي)
      sc.cue = w ? Math.min(Math.max(sc.start, w.start - 0.1), sc.start + 0.8) : sc.start + 0.15;
    });

    const root = $("#scenes");
    for (const sc of plan) {
      const el = document.createElement("div");
      el.className = "scene";
      el.innerHTML = `<div class="hero ${sc.kind}"></div>` + (sc.kind === "text" ? "" : `<div class="headline">${headlineHTML(sc.headline)}</div>`);
      root.appendChild(el);
      const hero = $(".hero", el);
      const svgEmoji = sc.kind === "emoji" && String(sc.asset).endsWith(".svg"); // إيموجي Fluent (لون واحد) بدل الـ Lottie الأصفر
      if (sc.kind === "illustration" || sc.kind === "icon" || svgEmoji) {
        hero.innerHTML = await (await fetch(`/assets/${sc.asset}`)).text();
        if (sc.kind === "icon") {
          sc.paths = [...hero.querySelectorAll("path, circle, line, polyline, polygon, rect, ellipse")];
          sc.paths.forEach((p) => { const L = p.getTotalLength ? p.getTotalLength() : 100; p.dataset.len = L; p.style.strokeDasharray = L; });
        }
      } else if (sc.kind === "emoji") { // مشاريع قديمة: إيموجي Lottie
        const box = document.createElement("div"); box.className = "lottie"; hero.appendChild(box);
        const data = await (await fetch(`/assets/${sc.asset}`)).json();
        sc.anim = await new Promise((res) => { const a = lottie.loadAnimation({ container: box, renderer: "svg", loop: false, autoplay: false, animationData: data }); a.addEventListener("DOMLoaded", () => res(a)); });
      } else if (sc.kind === "number") {
        const m = String(sc.number_value || "").match(/^(\D*)([\d.,]+)(.*)$/);
        sc.num = m ? { pre: m[1], val: parseFloat(m[2].replace(/,/g, "")), post: m[3], dec: (m[2].split(".")[1] || "").length } : null;
        hero.textContent = sc.number_value || "";
      } else {
        hero.innerHTML = `<div class="big">${headlineHTML(sc.headline)}</div>`;
      }
      scenes.push({ ...sc, el, hero, head: $(".headline", el) });
    }
    if (D.audio && MODE === "preview") $("#audio").src = D.audio;
    await document.fonts.ready;
    // العنوان لازم يبقى سطر واحد: لو أعرض من المساحة بنصغّر الخط (لحد 64px)
    for (const sc of scenes) {
      if (!sc.head) continue;
      sc.el.style.display = "";
      const max = 940, w = sc.head.scrollWidth;
      if (w > max) sc.head.style.fontSize = Math.max(64, parseFloat(getComputedStyle(sc.head).fontSize) * max / w) + "px";
      if (sc.head.scrollWidth > max) { sc.head.style.whiteSpace = "normal"; sc.head.style.lineHeight = "1.1"; }
    }
    // الكلمة الكبيرة (نوع text): تصغر لحد ما تدخل في مكان البطل
    for (const sc of scenes) {
      if (sc.kind !== "text") continue;
      sc.el.style.display = "";
      const big = $(".big", sc.hero);
      let fs = 190;
      while (fs > 70 && (big.scrollWidth > 860 || big.offsetHeight > 700)) { fs *= 0.93; big.style.fontSize = fs + "px"; }
    }
    window.DURATION = DURATION;
    renderAt(0);
  }

  // آخر كلمة في العنوان بتتلوّن (أو الكلمة اللي فيها *)
  function headlineHTML(text) {
    const ws = String(text || "").split(/\s+/).filter(Boolean);
    return ws.map((w, i) => (i === ws.length - 1 ? `<span class="hl">${esc(w)}</span>` : esc(w))).join(" ");
  }

  // ---------- الحركات الجاهزة ----------
  function enterStyle(kind, p, el) {
    switch (kind) {
      case "pop": return `scale(${0.2 + 0.8 * back(p)})`;
      case "slide": return `translateX(${(1 - easeOut(p)) * -420}px)`;
      case "fade": return `scale(${0.97 + 0.03 * easeOut(p)})`;
      case "draw": return `scale(${0.92 + 0.08 * easeOut(p)})`;
      default: return `translateY(${(1 - easeOut(p)) * 140}px) scale(${0.94 + 0.06 * easeOut(p)})`; // rise
    }
  }
  function idleStyle(kind, t) {
    switch (kind) {
      case "pulse": return `scale(${1 + 0.03 * Math.sin(t * 3.2)})`;
      case "wobble": return `rotate(${2.2 * Math.sin(t * 2.4)}deg)`;
      case "none": return "";
      default: return `translateY(${Math.sin(t * 1.7) * 12}px)`; // float
    }
  }

  // ---------- الرسم ----------
  function renderAt(t) {
    // الخلفية: دواير بتتحرك ببطء
    $(".b1").style.transform = `translate(${-200 + 90 * Math.sin(t * 0.23)}px, ${-160 + 70 * Math.cos(t * 0.19)}px)`;
    $(".b2").style.transform = `translate(${560 + 80 * Math.cos(t * 0.27)}px, ${1350 + 60 * Math.sin(t * 0.21)}px)`;

    for (const sc of scenes) {
      const on = t >= sc.start - 0.01 && t < sc.end + 0.35;
      sc.el.style.display = on ? "" : "none";
      if (!on) continue;
      const out = easeInOut((t - sc.end) / (0.35 * PACE));                 // خروج: طلوع لفوق + اختفاء
      const into = easeOut((t - sc.start) / (0.3 * PACE));
      sc.el.style.opacity = Math.min(into, 1 - out);
      sc.el.style.transform = `translateY(${-70 * out}px)`;

      const p = clamp((t - sc.cue) / ((sc.enter === "draw" ? 1.0 : 0.6) * PACE));
      sc.hero.style.opacity = sc.enter === "fade" ? easeOut(p) : clamp(p * 3);
      sc.hero.style.transform = `${enterStyle(sc.enter, p)} ${p >= 1 ? idleStyle(sc.idle, (t - sc.cue) / PACE) : ""}`;
      if (sc.paths) sc.paths.forEach((el) => (el.style.strokeDashoffset = sc.enter === "draw" ? el.dataset.len * (1 - easeInOut(p)) : 0));
      if (sc.anim) { const fr = sc.anim.frameRate || 30; sc.anim.goToAndStop(((Math.max(0, t - sc.cue) * fr) % sc.anim.totalFrames), true); }
      if (sc.num) {
        const v = sc.num.val * easeOut((t - sc.cue) / 1.3);
        sc.hero.textContent = sc.num.pre + v.toFixed(sc.num.dec) + sc.num.post;
      }
      if (sc.head) {
        const hp = easeOut((t - sc.start - 0.15 * PACE) / (0.45 * PACE));
        sc.head.style.opacity = hp;
        sc.head.style.transform = `translateY(${(1 - hp) * 40}px)`;
        const hl = $(".hl", sc.head);
        if (hl) hl.style.setProperty("--p", easeInOut((t - sc.start - 0.45) / 0.5));
      }
    }

    // الترجمة: الجملة اللي بتتقال دلوقتي، والكلمة الحالية ملوّنة
    const cur = words.find((w) => t >= w.start - 0.05 && t <= w.end + 0.25) || [...words].reverse().find((w) => w.start <= t);
    const subs = $("#subs");
    if (cur && t < DURATION - 0.4) {
      const line = words.filter((w) => w.sid === cur.sid);
      const key = cur.sid;
      if (subs.dataset.sid != key) { subs.innerHTML = line.map((w) => `<span data-i="${w.i}">${esc(w.word)}</span>`).join(" "); subs.dataset.sid = key; }
      subs.querySelectorAll("span").forEach((s) => { const w = words[+s.dataset.i]; s.className = (t >= w.start ? "said" : "") + (t >= w.start && t < w.end + 0.08 ? " now" : ""); });
      subs.style.opacity = 1;
    } else subs.style.opacity = 0;
  }
  window.renderAt = renderAt;

  // ---------- المعاينة (تشغيل/تقديم) ----------
  function fit() {
    if (MODE === "render") { document.body.classList.add("render"); return; }
    const s = Math.min(innerWidth / 1080, (innerHeight - 52) / 1920);
    $("#stage").style.transform = `scale(${s})`;
    $("#frame").style.bottom = "52px";
  }
  function preview() {
    $("#controls").hidden = false;
    const audio = $("#audio"), scrub = $("#scrub"), btn = $("#play");
    let playing = false, t0 = 0, base = 0;
    const now = () => (D.audio ? audio.currentTime : base + (performance.now() - t0) / 1000);
    const show = (t) => { renderAt(t); scrub.value = (t / DURATION) * 1000; $("#clock").textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; };
    const loop = () => { if (!playing) return; const t = now(); if (t >= DURATION) { playing = false; btn.textContent = "▶"; return; } show(t); requestAnimationFrame(loop); };
    btn.onclick = () => {
      playing = !playing; btn.textContent = playing ? "❚❚" : "▶";
      if (playing) { if (D.audio) audio.play(); else { t0 = performance.now(); } loop(); }
      else { if (D.audio) audio.pause(); else base = now(); }
    };
    scrub.oninput = () => { const t = (scrub.value / 1000) * DURATION; if (D.audio) audio.currentTime = t; else { base = t; t0 = performance.now(); } show(t); };
  }

  fit(); addEventListener("resize", fit);
  window.ready = setup().then(() => { if (MODE === "preview") preview(); });
})();
