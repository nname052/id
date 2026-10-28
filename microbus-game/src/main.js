import { Game } from './core/Game.js';
import { seatColor } from './net/Multiplayer.js';
import { PHOTO_SOURCES } from './render/photoAtlas.js';

// نقطة البداية
// آيفون من سفاري (مش من الشاشة الرئيسية): نوضّح إزاي تبقى ملء الشاشة (سفاري مابيسمحش بملء الشاشة للصفحات)
{
  const ios = /iPhone|iPod/.test(navigator.userAgent);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (ios && !standalone) document.getElementById('ioshint')?.style.setProperty('display', 'block');
}
const statusEl = document.getElementById('status');
const bar = document.getElementById('bar');
const go = document.getElementById('go');
const start = document.getElementById('start');

const game = new Game(document.getElementById('app'), (text, p) => {
  statusEl.textContent = text;
  bar.style.width = `${Math.round(p * 100)}%`;
});
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

{
  // مصادر الصور الحقيقية (المصوّر + الرخصة + لينك كل صورة): من نفس ملف الأطلس عشان مايختلفوش
  const ul = document.getElementById('photo-list');
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const LIC = { 'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/' };
  const lic = (l) => (LIC[l] ? `<a href="${LIC[l]}" target="_blank" rel="noopener">${esc(l)}</a>` : esc(l));
  if (ul) ul.innerHTML = PHOTO_SOURCES.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> — ${esc(s.author)} · ${lic(s.license)}</li>`).join('')
    + '<li>اتقصت حتت من الصور واتعدّل منظورها ولونها عشان تبقى خامات (واجهات، محلات، أسفلت، رصيف) — نفس الرخصة.</li>';
}

{
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
    b.style.borderColor = seatColor(i); b.style.boxShadow = `inset 0 -4px 0 ${seatColor(i)}`; // لون اللاعب (فوق عربيته وعلى الخريطة)
    b.querySelector('small').textContent = owner ? (owner.presence.name || 'محجوز') : me.seat === i ? (me.name || 'إنت') : 'فاضي';
    seatsEl.appendChild(b);
  }
  if (!mp) lobbyStatus.textContent = 'بيتحمّل...';
  else if (!mp.available) lobbyStatus.textContent = 'اللعب الجماعي مش متاح هنا دلوقتي. تقدر تلعب لوحدك.';
  else {
    const n = mp.others().length;
    const where = mp.mode === 'p2p' ? ` · أوضة "${mp.roomName}"` : '';
    lobbyStatus.textContent = (mp.connected ? `أونلاين${where} · ${n ? `${n} لاعب تاني موجود` : 'مفيش حد تاني لسه — ابعت اللينك لصحابك'}` : 'بيتصل...') + (me.seat ? '' : ' — اختار رقمك');
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
// (شاشة البداية والإعدادات واختيار الخط مستثنيين: لازم يتعمل فيهم سكرول على الموبايل وهو مقلوب بالعرض)
const stop = (e) => { if (e.cancelable && !e.target.closest?.('#settings, #start, #linepick')) e.preventDefault(); };
document.addEventListener('touchmove', stop, { passive: false });
document.addEventListener('gesturestart', stop, { passive: false });
document.addEventListener('gesturechange', stop, { passive: false });
document.addEventListener('dblclick', stop, { passive: false });
document.addEventListener('selectstart', stop);
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouchEnd < 300) stop(e); lastTouchEnd = now; }, { passive: false });
