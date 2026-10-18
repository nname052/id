// =====================================================================
//  اختيار خط الميكروباص (أول ما تبدأ بالميكروباص، أو من زرار تغيير الخط)
//  كل خط: من/إلى، المحطات، الطول، الأجرة، الطلب المتوقع — وعلامة واضحة لو الخط مش متأكد منه كخط حقيقي
// =====================================================================
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function showLinePicker(options, onPick, { title = 'اختار خط الميكروباص' } = {}) {
  document.getElementById('linepick')?.remove();
  const el = document.createElement('div');
  el.id = 'linepick';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<div class="lp-box"><div class="lp-h">🚐 ${esc(title)}</div><div class="lp-list">${options.map((o) => `
    <button class="lp-item${o.current ? ' cur' : ''}" data-i="${o.i}">
      <span class="lp-sign" style="background:${esc(o.color)}">${esc(o.name)}</span>
      <span class="lp-route"><b>${esc(o.from)}</b> ← <b>${esc(o.to)}</b></span>
      <span class="lp-meta">${o.km} كم · ${o.stops.length} محطات · الأجرة ${o.fare} ج${o.fareNote ? ` (${esc(o.fareNote)})` : ''} · الطلب ${esc(o.demand)} (تقدير اللعبة)</span>
      <span class="lp-stops">${o.stops.map(esc).join(' • ')}</span>
      ${o.verified ? '<span class="lp-ok">خط مؤكد</span>' : '<span class="lp-warn">⚠ مسار مقترح من اللعبة — مش خط رسمي متأكد منه (أطرافه أماكن حقيقية من OSM)</span>'}
    </button>`).join('')}</div>
    <button class="lp-close">إلغاء</button></div>`;
  const close = () => el.remove();
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.lp-item');
    if (b) { close(); onPick(+b.dataset.i); return; }
    if (e.target.closest('.lp-close') || e.target === el) close();
  });
  el.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.appendChild(el);
  return close;
}
