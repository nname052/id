import { Game } from './core/Game.js';

// نقطة البداية
const statusEl = document.getElementById('status');
const bar = document.getElementById('bar');
const go = document.getElementById('go');
const start = document.getElementById('start');

// الخريطة المختارة (لازم تتعرف قبل البناء): ?map=shibin في اللينك أو آخر اختيار محفوظ
const MAPS = ['current', 'shibin'];
let mapPick = (() => {
  const q = new URLSearchParams(location.search).get('map');
  if (MAPS.includes(q)) return q;
  try { const v = localStorage.getItem('egy-map'); return MAPS.includes(v) ? v : 'current'; } catch { return 'current'; }
})();

const game = new Game(document.getElementById('app'), (text, p) => {
  statusEl.textContent = text;
  bar.style.width = `${Math.round(p * 100)}%`;
}, { map: mapPick });
window.game = game; // للتجربة من الـ Console

// اختيار العربية من شاشة البداية (بيتحفظ في الإعدادات)
const pick = document.getElementById('pick');
let picked = (() => { try { return JSON.parse(localStorage.getItem('egy-microbus-settings-v1') || '{}').vehicle; } catch { return null; } })() || 'microbus';
const syncPick = () => { for (const b of pick.children) b.classList.toggle('on', b.dataset.v === picked); };
syncPick();
pick.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  picked = b.dataset.v; syncPick();
  if (game.settings) game.settings.set('vehicle', picked);
  game.mp?.setMe({ kind: picked });
});

// اختيار الخريطة من شاشة البداية: كل خريطة عالم كامل لوحده، فالتبديل بيعيد تحميل الصفحة
// (أنضف حاجة: مفيش بواقي من الخريطة التانية في الذاكرة)
const maps = document.getElementById('maps');
const syncMap = () => { for (const b of maps.children) b.classList.toggle('on', b.dataset.m === mapPick); };
syncMap();
maps.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const m = b.dataset.m;
  if (m === mapPick) return;
  try { localStorage.setItem('egy-map', m); } catch { /* مفيش تخزين */ }
  mapPick = m; syncMap();
  go.disabled = true;
  statusEl.textContent = m === 'shibin' ? 'بنحمّل شبين الكوم الحقيقية...' : 'بنحمّل الخريطة...';
  const u = new URL(location.href); u.searchParams.delete('map');
  location.replace(u.toString());
});
if (mapPick === 'shibin') {
  // حقوق بيانات الخريطة جوه اللعبة كمان
  const a = document.createElement('div'); a.id = 'osm-ingame';
  a.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  document.body.appendChild(a);
}

game.init().then(() => {
  game.settings.set('vehicle', picked);
  if (game.player.kind !== picked) game.setVehicle(picked);
  game.mp.onLobby(renderSeats);
  game.mp.connect().then(() => { if (me.seat || me.name) game.mp.setMe({ seat: me.seat, name: me.name, kind: picked }); });
  renderSeats();
  go.disabled = false;
  go.focus({ preventScroll: true }); // من غير ما الصفحة تنزل لتحت وتخبي الاسم والأرقام
}).catch((e) => {
  console.error(e);
  game.diag?.set('hiace', `INIT FAILED — ${e.message}`, 'bad');
  statusEl.textContent = 'حصلت مشكلة: ' + e.message + ' — جرّب Chrome أو Edge محدّث.';
});

// ===== اللوبي: رقم من 1 لـ 7 + اسم (اللعب الجماعي) =====
const seatsEl = document.getElementById('seats'), nameEl = document.getElementById('pname'), lobbyStatus = document.getElementById('lobby-status');
// Enter / "تم" في كيبورد الموبايل: يقفل الكيبورد (واللعبة بتبدأ من مستمع Enter العام تحت)
nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameEl.blur(); });
const LS = 'egy-microbus-player';
let me = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } })();
me.seat = me.seat || 0; me.name = me.name || '';
nameEl.value = me.name;
const saveMe = () => { try { localStorage.setItem(LS, JSON.stringify({ seat: me.seat, name: me.name })); } catch { /* */ } };
const renderSeats = () => {
  const mp = game.mp;
  seatsEl.innerHTML = '';
  for (let i = 1; i <= 7; i++) {
    const owner = mp?.seatOwner(i);
    const b = document.createElement('button');
    b.dataset.seat = i;
    b.className = (owner ? 'taken' : '') + (me.seat === i && !owner ? ' on' : '');
    b.innerHTML = `${i}<small></small>`;
    b.querySelector('small').textContent = owner ? (owner.presence.name || 'محجوز') : me.seat === i ? (me.name || 'إنت') : 'فاضي';
    seatsEl.appendChild(b);
  }
  if (!mp) lobbyStatus.textContent = 'بيتحمّل...';
  else if (!mp.available) lobbyStatus.textContent = 'اللعب الجماعي مش متاح هنا (لازم تكون داخل بحساب Claude ومعزوم على اللعبة). تقدر تلعب لوحدك.';
  else {
    const n = mp.others().length;
    lobbyStatus.textContent = (mp.connected ? `أونلاين · ${n ? `${n} لاعب تاني موجود` : 'مفيش حد تاني لسه'}` : 'بيتصل...') + (me.seat ? '' : ' — اختار رقمك');
  }
};
seatsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const seat = +b.dataset.seat;
  if (game.mp?.seatOwner(seat)) return;
  me.seat = seat; saveMe();
  game.mp?.setMe({ seat: me.seat, name: me.name });
  renderSeats();
});
nameEl.addEventListener('input', () => { me.name = nameEl.value.trim().slice(0, 16); saveMe(); game.mp?.setMe({ name: me.name }); renderSeats(); });
renderSeats();

const begin = async () => {
  if (go.disabled) return;
  // لو الرقم اتحجز من حد تاني في الآخر: نختار أول رقم فاضي
  if (game.mp?.available && (!me.seat || game.mp.seatOwner(me.seat))) {
    for (let i = 1; i <= 7; i++) if (!game.mp.seatOwner(i)) { me.seat = i; break; }
    saveMe();
  }
  game.mp?.setMe({ seat: me.seat, name: me.name, kind: picked });
  start.classList.add('hidden');
  document.body.classList.add('playing');
  // على الموبايل: نحاول نقلب الشاشة بالعرض لوحدنا (أندرويد بيسمح من Fullscreen، الآيفون لأ → بتظهر رسالة "لف التليفون")
  if (document.body.classList.contains('touch')) {
    const el = document.documentElement;
    Promise.resolve(el.requestFullscreen?.({ navigationUI: 'hide' })).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  await game.start();
};
go.addEventListener('click', begin);
window.addEventListener('keydown', (e) => { if (e.code === 'Enter' && !start.classList.contains('hidden')) begin(); });

// الـ Service Worker متوقف مؤقتًا (صفحة الـ Artifact مش بتسمح بيه، وكان ممكن يفضّل نسخة قديمة متخزنة).
// لو فيه واحد متسجل من نسخة قديمة نشيله.
try {
  navigator.serviceWorker?.getRegistrations?.().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
} catch { /* مش متاح */ }

// منع سكرول/زووم/تحديد النص أثناء القيادة (موبايل)
// (شاشة البداية والإعدادات مستثنيين: لازم يتعمل فيهم سكرول على الموبايل وهو مقلوب بالعرض)
const stop = (e) => { if (e.cancelable && !e.target.closest?.('#settings, #start')) e.preventDefault(); };
document.addEventListener('touchmove', stop, { passive: false });
document.addEventListener('gesturestart', stop, { passive: false });
document.addEventListener('gesturechange', stop, { passive: false });
document.addEventListener('dblclick', stop, { passive: false });
document.addEventListener('selectstart', stop);
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouchEnd < 300) stop(e); lastTouchEnd = now; }, { passive: false });
