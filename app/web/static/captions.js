// محرّك الترجمة: نفس الكود بيشتغل في المعاينة الحية في الاستوديو وفي رسم الفيديو النهائي (Chromium فريم فريم)،
// فاللي بتشوفه في المعاينة هو اللي بيطلع في الفيديو بالظبط. كل حاجة محسوبة من الوقت t (حتمي).
(function () {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const eo = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const back = (x) => { x = clamp(x); const c = 1.8; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const SIZES = { s: 42, m: 52, l: 64, xl: 86 };
  const DEFAULT = { mode: "karaoke", font: "Alexandria", font_url: "", weight: 700, size: "m", color: "#ffffff", accent: "#7ee2b8",
    upcoming: "dim", position: "bottom", outline: 0, outline_color: "#000000", border: "none", border_color: "#ffffff",
    box: "none", box_color: "rgba(0,0,0,0.55)", shadow: true, glow: false, anim: "fade", enter: "fade" };

  // السطر بيتقسم مجموعات صغيرة في وضع «1–3 كلمات»
  function chunks(words, maxW = 3, maxC = 16) {
    const out = []; let cur = [];
    words.forEach((w, i) => { cur.push(w); const nx = words[i + 1], n = cur.reduce((s, x) => s + x.word.length, 0);
      if (!nx || cur.length >= maxW || n >= maxC || /[،,.!?؟…]$/.test(w.word) || nx.start - w.end >= 0.25) { out.push(cur); cur = []; } });
    return out;
  }

  function create(root, opts) {
    const W = opts.W || 1080, H = opts.H || 1920;
    const st = Object.assign({}, DEFAULT, opts.style || {});
    const fs = Math.round((st.size_px || SIZES[st.size] || 52) * H / 1920);
    const cues = [];
    (opts.cues || []).forEach((c) => {
      const ws = (c.words || []).filter((w) => w.word && w.word.trim()).map((w) => ({ word: w.word.replace(/[،,.؛;:]$/, ""), start: w.start, end: w.end }));
      if (!ws.length) return;
      if (st.mode === "chunks") {
        const g = chunks(ws);
        g.forEach((gw, k) => cues.push({ id: c.id + "_" + k, start: k ? gw[0].start : c.start, end: g[k + 1] ? g[k + 1][0].start : Math.min(c.end, gw[gw.length - 1].end + 0.6), words: gw }));
      } else cues.push({ id: c.id, start: c.start, end: c.end, words: ws });
    });
    root.innerHTML = "";
    // كل محرّك ليه CSS خاص بيه بس (كان CSS آخر ستايل بيغطي على كل الستايلات اللي في نفس الصفحة)
    const uid = "cap" + (create.n = (create.n || 0) + 1);
    root.classList.add(uid);
    const style = document.createElement("style");
    const ol = Math.round((st.outline || 0) * H / 1920);
    const shadow = [];
    if (st.shadow) shadow.push("0 2px 8px rgba(0,0,0,.75)", "0 0 2px rgba(0,0,0,.9)");
    if (st.glow) shadow.push(`0 0 ${Math.round(fs * .25)}px ${st.accent}`, `0 0 ${Math.round(fs * .55)}px ${st.accent}`);
    style.textContent = (st.font_url ? `@font-face{font-family:CapF_${uid};src:url(${st.font_url});font-weight:100 900}` : "") +
      `.${uid} .cap-wrap{position:absolute;left:${W * .07}px;right:${W * .07}px;text-align:center;direction:rtl;pointer-events:none}
       .${uid} .cap{display:inline-block;max-width:100%;text-wrap:balance;font:${st.weight} ${fs}px/1.45 ${st.font_url ? `CapF_${uid}` : `"${st.font}"`},sans-serif;color:${st.color};
         padding:${Math.round(fs * .18)}px ${Math.round(fs * .38)}px;border-radius:${Math.round(fs * .32)}px;
         ${shadow.length ? `text-shadow:${shadow.join(",")};` : ""}${ol ? `-webkit-text-stroke:${ol}px ${st.outline_color};paint-order:stroke fill;` : ""}
         ${st.box === "line" ? `background:${st.box_color};` : ""}${st.border === "line" ? `box-shadow:inset 0 0 0 ${Math.max(2, Math.round(fs * .06))}px ${st.border_color};` : ""}}
       .${uid} .cap .w{display:inline-block;position:relative;padding:0 ${Math.round(fs * .1)}px;border-radius:${Math.round(fs * .22)}px;transform-origin:50% 70%;will-change:transform}`;
    root.appendChild(style);
    const wrap = document.createElement("div"); wrap.className = "cap-wrap";
    if (st.position === "top") wrap.style.top = (H * .1) + "px";
    else if (st.position === "middle") wrap.style.top = (H * .56) + "px";
    else wrap.style.bottom = (H * (1 - .8)) + "px";
    const line = document.createElement("div"); line.className = "cap"; wrap.appendChild(line); root.appendChild(wrap);
    let curId = null, spans = [];

    function build(c) {
      line.innerHTML = c.words.map((w) => `<span class="w">${w.word.replace(/[&<>]/g, "")}</span>`).join(" ");
      spans = [...line.querySelectorAll(".w")]; curId = c.id;
    }
    // الحالة دي بالنسبة لكلمة: اتقالت / الحالية / لسه
    function render(t) {
      const c = cues.find((x) => t >= x.start && t < x.end);
      if (!c) { wrap.style.visibility = "hidden"; curId = null; return "none"; }
      wrap.style.visibility = "visible";
      if (c.id !== curId) build(c);
      // دخول السطر كله
      const ce = clamp((t - c.start) / 0.25);
      let lt = "";
      if (st.enter === "slide") lt = `translateY(${(1 - eo(ce)) * fs * .6}px)`;
      else if (st.enter === "pop") lt = `scale(${0.8 + 0.2 * back(ce)})`;
      line.style.transform = lt; line.style.opacity = st.enter === "none" ? 1 : eo(ce);
      let cur = -1;
      c.words.forEach((w, i) => { if (t >= w.start - 0.02) cur = i; });
      const sig = [c.id, cur];
      spans.forEach((sp, i) => {
        const w = c.words[i], past = i < cur, now = i === cur, fut = i > cur;
        const p = clamp((t - w.start) / 0.22);
        let op = 1, tf = "", bg = "", bd = "", clip = "", color = "";
        if (fut) { op = st.upcoming === "hide" || st.mode === "words" ? 0 : st.upcoming === "dim" ? 0.4 : 1; }
        if (now) {
          color = st.accent;
          if (st.box === "word") bg = st.accent;
          if (st.border === "word") bd = `inset 0 0 0 ${Math.max(2, Math.round(fs * .06))}px ${st.border_color}`;
          if (p < 1) sig.push(Math.round(p * 20));
          const a = st.anim;
          if (a === "fade") op = (st.upcoming === "dim" ? 0.4 : st.upcoming === "hide" ? 0 : 1) + (1 - (st.upcoming === "dim" ? 0.4 : st.upcoming === "hide" ? 0 : 1)) * eo(p);
          else if (a === "pop") tf = `scale(${0.55 + 0.6 * back(p) - 0.15 * eo(p)})`;
          else if (a === "slide") { tf = `translateY(${(1 - eo(p)) * fs * .45}px)`; op = 0.2 + 0.8 * eo(p); }
          else if (a === "typewriter") clip = `inset(-30% 0 -30% ${(1 - eo(p)) * 100}%)`;
          else if (a === "bounce") tf = `translateY(${-Math.sin(clamp(p * 1.4) * Math.PI) * fs * .22}px)`;
          else if (a === "zoom") tf = `scale(${1.28 - 0.16 * eo(p)})`;
          else if (a === "highlight") { bg = `linear-gradient(to left, ${st.accent} ${eo(p) * 100}%, transparent ${eo(p) * 100}%)`; color = "#111"; }
          else if (a === "wave") tf = `translateY(${-Math.sin(clamp(p) * Math.PI) * fs * .18}px)`;
        }
        if (past && st.anim === "highlight") { bg = ""; }
        if (st.anim === "wave" && (i === cur - 1 || i === cur + 1)) tf = `translateY(${-Math.sin(clamp(clamp((t - c.words[cur].start) / 0.22)) * Math.PI) * fs * .08}px)`;
        if (now && st.box === "word" && st.anim !== "highlight") color = isLight(st.accent) ? "#111" : "#fff";
        sp.style.opacity = op; sp.style.transform = tf; sp.style.background = bg; sp.style.boxShadow = bd; sp.style.clipPath = clip;
        sp.style.color = color; if (color === "#111" || (now && st.box === "word")) { sp.style.webkitTextStroke = "0"; sp.style.textShadow = "none"; } else { sp.style.webkitTextStroke = ""; sp.style.textShadow = ""; }
      });
      if (ce < 1) sig.push("e" + Math.round(ce * 20));
      return sig.join("|");
    }
    function isLight(hex) { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex || ""); if (!m) return false;
      const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16)); return 0.299 * r + 0.587 * g + 0.114 * b > 150; }
    return { render, cues, fs };
  }
  window.Captions = { create, DEFAULT, SIZES };
})();
