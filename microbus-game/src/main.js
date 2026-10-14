import { Game } from './core/Game.js';

// نقطة البداية
const statusEl = document.getElementById('status');
const bar = document.getElementById('bar');
const go = document.getElementById('go');
const start = document.getElementById('start');

const game = new Game(document.getElementById('app'), (text, p) => {
  statusEl.textContent = text;
  bar.style.width = `${Math.round(p * 100)}%`;
});
window.game = game; // للتجربة من الـ Console

game.init().then(() => {
  go.disabled = false;
  go.focus();
}).catch((e) => {
  console.error(e);
  statusEl.textContent = 'حصلت مشكلة: ' + e.message + ' — جرّب Chrome أو Edge محدّث.';
});

const begin = async () => {
  if (go.disabled) return;
  start.classList.add('hidden');
  await game.start();
};
go.addEventListener('click', begin);
window.addEventListener('keydown', (e) => { if (e.code === 'Enter' && !start.classList.contains('hidden')) begin(); });

// PWA: تسجيل الـ Service Worker في نسخة الإنتاج بس
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// منع سكرول/زووم/تحديد النص أثناء القيادة (موبايل)
const stop = (e) => { if (e.cancelable) e.preventDefault(); };
document.addEventListener('touchmove', stop, { passive: false });
document.addEventListener('gesturestart', stop, { passive: false });
document.addEventListener('gesturechange', stop, { passive: false });
document.addEventListener('dblclick', stop, { passive: false });
document.addEventListener('selectstart', stop);
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => { const now = Date.now(); if (now - lastTouchEnd < 300) stop(e); lastTouchEnd = now; }, { passive: false });
